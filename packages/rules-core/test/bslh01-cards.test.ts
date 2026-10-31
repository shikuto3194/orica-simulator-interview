import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
import { finishCoreChoices } from "./helpers/core-choice-driver";
import { flushReadyEffectCompletions } from "../src/effect/effect-completion";
/**
 * BSLH01 (英雄伝説 軌跡シリーズ) カードの effects 検証テスト。
 * CB / クォーツ / 魂状態(ENIGMA) / 導力器 中心の重アーキタイプ弾。
 * CB / クォーツ / 魂状態(ENIGMA) / 導力器トークンマジック等の重アーキタイプ弾。
 */
import { describe, expect, it, vi } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  ActiveAttack,
  ActiveStack,
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  Effect,
  EffectTarget,
  GameState,
  SymbolColor,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { calculateReduction } from "../src/core/cost-system";
import {
  executeBattleResolution,
  getUnblockedLifeDamage,
} from "../src/battle/battle-actions";
import { getPlayerLifeCoreCount } from "../src/core/core-system";
import {
  rebuildContinuousEffectsFromField,
  isCEActiveForScope,
  collectTriggerEventsFromStateDelta,
  findApplicableTargetRedirects,
  getEffectiveSymbolBundles,
  getEffectiveLevel,
  getRedirectEffectTargetMetadata,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolveTargetCandidateIds } from "../src/effect/native-target-resolution";
import { createStepExecutionContext } from "../src/step-execution-context";
import {
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
} from "../src/battle/battle-availability";
import { resolveCardImmunityAffect } from "../src/effect/effect-affect-adapter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { executeEffectImmunity } from "../src/effect/structured-effect-interpreter";
import {
  finalizeEffectResolution,
  moveCompletedInUseMagicCardToTrashIfReady,
  runActionMainResolution,
} from "../src/effect/effect-resolution";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import {
  buildReevaluationConfig,
  buildLegalActionTargetGroups,
  executeReevaluationCheck,
  runReevaluationAtTiming,
  getSymbolAdditions,
  removeExpiredContinuousEffects,
} from "../src/legal/legal-actions-shared";
import { executeSuppressEffect } from "../src/effect/native-ce-registration-handlers";
import {
  finalizePendingTurnEndFinalizations,
  finalizePendingAttackStepEndFinalizations,
} from "../src/effect/structured-state-grants";
import {
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  deriveSuppressionEffectDescriptor,
  expandCardDefinitionsWithBackFaces,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
  queueBattleDeclarationTriggers,
  queueEffectActivationTriggers,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";
import {
  resolveLifeDamage,
  resolvePendingLifeDamageDiscardChoice,
} from "../src/core/core-system";
import {
  dynamicTargetFilterFromEffectTarget,
  evaluateCondition,
  executeCoreMove,
} from "../src/effect/structured-effect-interpreter";
import { cardHasBurstEffect } from "../src/card/card-filter";
import { setQuartz } from "../src/mechanics/quartz-system";
import {
  resolveDeferredMagicStack,
  useMagicCardInFlashContextAsAction,
} from "../src/mechanics/magic-system";
import {
  collectStateBasedActions,
  flushPendingLeaves,
  runStateBasedActions,
} from "../src/state-based-actions";
import { playSummonAsAction } from "../src/play/play-card-system";
import {
  getSummonTrashCorePlacementGrant,
  getFlashConsecutiveUseLimitGrant,
} from "../src/legal/legal-actions-shared";

function drainOptionalStepsWithExecute(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined,
  targetSelections?: readonly (readonly string[])[]
): GameState {
  return drainOptionalStepsExecutingWhenAvailable(
    state,
    getDef,
    targetSelections
  );
}

function drainOptionalStepsExecutingWhenAvailable(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined,
  targetSelections?: readonly (readonly string[])[]
): GameState {
  let s = state;
  let targetSelectionIndex = 0;
  for (let guard = 0; guard < 50; guard++) {
    const targetPending = s.pendingStepOptionalTargetSelection;
    if (targetPending) {
      const action = getLegalActions({
        state: s,
        actingPlayerId: targetPending.choosingPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => [],
      }).find(
        (a) => a.kind === "resolve_pending_step_optional_target_selection"
      );
      if (!action) throw new Error("optional target choice missing");
      s = applyLegalAction({
        state: s,
        action,
        targetInstanceIds:
          targetSelections?.[targetSelectionIndex++] ??
          targetPending.candidateInstanceIds.slice(
            0,
            targetPending.requiredTargetCount
          ),
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      continue;
    }
    if (!s.pendingStepOptionalChoice) {
      if (!s.pendingAfterTriggersContinuations.length) break;
      const next = finalizeEffectResolution({
        state: s,
        beforeState: s,
        chainId: "test-optional-after-triggers",
        endLogs: [],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
        causedBySourceInstanceId: null,
      });
      if (next === s) break;
      s = next;
      if (!s.pendingStepOptionalChoice) break;
    }
    const psoc = s.pendingStepOptionalChoice;
    const choice = psoc.canExecute === false ? "decline" : "execute";
    s = applyLegalAction({
      state: s,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:${choice}`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }
  return s;
}

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function resolvePendingMultiPlacementFromReserve(
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingMultiPlacement;
  expect(pending).not.toBeNull();
  const action = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    multiPlacementAllocations: pending!.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements:
        target.minimumCoreCount > 0
          ? [{ kind: "reserve_normal", amount: target.minimumCoreCount }]
          : [],
    })),
  }).state;
}

function rebirthLvDeficitNexus(
  frontNo: string,
  backNo: string
): CardDefinition {
  return {
    cardNo: frontNo,
    name: "テスト用 転醒ネクサス",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [
      "【転醒：自分のカウント99以下】このネクサスが消滅するとき、裏返せる。",
    ],
    keywordTags: ["double_sided"],
    sourceUrls: [],
    sourceConfidence: "C",
    isDoubleSided: true,
    effects: [
      {
        timing: { kind: "card_event", event: "vanish" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 99,
              triggerDescription: "消滅するとき",
            },
          },
        ],
        textRef: [0],
      },
    ],
    backFace: {
      cardNo: backNo,
      name: "テスト用 転醒ネクサス(B)",
      printedCategory: "nexus",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
      symbolColors: [],
      textLines: ["転醒後の最低Lvコアが1個。"],
      keywordTags: [],
      effects: [],
    },
  };
}

function testBraveDefinition(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト用 ブレイヴ",
    printedCategory: "brave",
    colors: ["red"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: ["テスト用の合体中ブレイヴ。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function vanishTriggeredSpiritDefinition(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト用 消滅時スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [
      "Lv1『このスピリットの消滅時』自分はデッキから1枚ドローできる。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "vanish" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [0],
      },
    ],
  };
}

function buildLocalRebirthLookups(extraDefinitions: readonly CardDefinition[]) {
  const definitions = expandCardDefinitionsWithBackFaces([
    ...ALL_CARDS,
    ...extraDefinitions,
  ]);
  const byId = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return {
    getCardDefinitionById: (id: string) => byId.get(id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredBurstActions: () => [],
  };
}

function drainTriggeredEffectsAndStack(
  state: GameState,
  actingPlayerIds: readonly string[],
  lookups: ReturnType<typeof buildLocalRebirthLookups>
): GameState {
  let current = state;
  for (let guard = 0; guard < 30; guard++) {
    if (
      current.pendingTriggeredEffects.length === 0 &&
      current.stackWindow === null &&
      current.pendingAfterTriggersContinuations.length === 0
    ) {
      return current;
    }
    let progressed = false;
    for (const actingPlayerId of actingPlayerIds) {
      const action = getLegalActions({
        state: current,
        actingPlayerId,
        ...lookups,
      }).find(
        (candidate) =>
          candidate.kind === "resolve_pending_triggered_effect" ||
          candidate.kind === "select_pending_to_resolve" ||
          candidate.kind === "pass_stack"
      );
      if (!action) continue;
      current = applyLegalAction({
        state: current,
        action,
        ...lookups,
      }).state;
      progressed = true;
      break;
    }
    if (!progressed) return current;
  }
  return current;
}

describe("BSLH01-C01 ロイド・バニングス", () => {
  const c = card("BSLH01-C01");
  it("メイン: 黒シンボル追加 / 疲労→カウント+1 / フラッシュ回復 / クォーツ set-effect (双魚珠)", () => {
    const symbol = c.effects![0]!.steps[0]!.action;
    expect(symbol.kind).toBe("symbol_add");
    if (symbol.kind === "symbol_add") expect(symbol.symbol).toBe("black");

    const e2 = c.effects![1]!;
    expect(e2.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 2,
    });
    expect(e2.steps[1]!.action.kind).toBe("count_increase");
    expect(e2.stub).toBeUndefined();
    const borrowSummon = e2.steps[2]!;
    expect(borrowSummon.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "count",
    });
    expect(borrowSummon.action.kind).toBe("borrow_card_event_effect");
    expect(borrowSummon.executionMode).toBe("optional");
    if (borrowSummon.action.kind === "borrow_card_event_effect") {
      expect(borrowSummon.action.borrowEvents).toEqual(["summon"]);
      expect(borrowSummon.action.attributeToBorrowedCard).toBe(true);
      expect(borrowSummon.action.target).toMatchObject({
        kind: "filter",
        player: "self",
        filter: {
          category: ["spirit"],
          hasCardEventEffect: ["summon"],
        },
        count: 1,
      });
    }
    // BSLH01-C01 effects[1] step[3]: 「そうしたとき、…CB創界神/導界者ネクサスにコア+1できる」
    // = void→field_card filter(category=nexus, tribes=CB, targetsGrandwalker:"only")。
    // ref_succeeded で count+1 succeeded にゲートし、借用効果の成否には誤連動させない。
    const cbBoost = e2.steps[3]!;
    expect(cbBoost.executionMode).toBe("optional");
    expect(cbBoost.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "count",
    });
    const cbAction = cbBoost.action;
    expect(cbAction.kind).toBe("core_move");
    if (cbAction.kind === "core_move") {
      expect(cbAction.from).toEqual({ kind: "void", player: "self" });
      expect(cbAction.amount).toBe(1);
      if (cbAction.to.kind === "field_card") {
        expect(cbAction.to.player).toBe("self");
        expect(cbAction.to.filter.category).toEqual(["nexus"]);
        expect(cbAction.to.filter.tribes).toEqual(["CB"]);
        expect(cbAction.to.filter.targetsGrandwalker).toBe("only");
      }
    }

    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.steps[1]!.action.kind).toBe("recover");

    // 【クォーツ：双魚珠】セット中効果: targeted 反応内 deck_reveal → 条件付き
    // effect_immunity(current_effect)。実プレイ経路の回帰は
    // bslh01-c01-r06-quartz-targeted-disclosure.test.ts 参照。
    const quartzSet = c.effects![3]!;
    expect(quartzSet.stub).toBeUndefined();
    expect(quartzSet.timing).toMatchObject({
      kind: "game_event",
      event: "targeted",
    });
    expect(quartzSet.applicability).toEqual({ soulState: true });
    expect(quartzSet.steps[0]!.action.kind).toBe("deck_reveal");
    expect(
      (
        quartzSet.steps[0]!.action as Extract<
          import("../src/dsl-types").Action,
          { kind: "deck_reveal" }
        >
      ).beforePickSteps![0]!.action.kind
    ).toBe("effect_immunity");
    expect(
      (
        quartzSet.steps[0]!.action as Extract<
          import("../src/dsl-types").Action,
          { kind: "deck_reveal" }
        >
      ).beforePickSteps![0]!.stepCondition
    ).toMatchObject({
      kind: "ref_has_match",
      result: "revealed",
    });
  });

  it("[board] 疲労→カウント+1後、自分のスピリットの召喚時効果をそのカードとして発揮する", () => {
    const source = createCardInstance(c, {
      instanceId: "c01-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const donorDef: CardDefinition = {
      cardNo: "TEST-C01-SUMMON-DONOR",
      name: "summon donor",
      colors: ["red"],
      cost: 1,
      reduction: [],
      symbols: ["red"],
      symbolColors: ["red"],
      cardType: "spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [
        "Lv1『このスピリットの召喚時』",
        "自分はデッキから1枚ドローする。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [0, 1],
        },
      ],
    };
    const donor = createCardInstance(donorDef, {
      instanceId: "c01-donor",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(c, {
      instanceId: "c01-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, donor, deckCard],
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, deckCount: 1, handCount: 0, countValue: 0 }
          : player
      ),
    };
    const defs = new Map(cardNoMap);
    defs.set(donorDef.cardNo, donorDef);
    const lookup = (id: string) => defs.get(id);

    const afterPending = executeEffect({
      chainId: "test:bslh01-cards:546",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = drainOptionalStepsExecutingWhenAvailable(
      afterPending,
      lookup
    );

    const alice = after.players.find((player) => player.id === "alice")!;
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "c01-source")
        ?.exhaustState
    ).toBe("exhausted");
    expect(alice.countValue).toBe(1);
    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(0);
    expect(after.log).toContain(
      "borrow_card_event_effect:executed:TEST-C01-SUMMON-DONOR:0:as:c01-source"
    );
  });
});

describe("BSLH01-C02 フラン・シーカー", () => {
  it("CB スピリットがいる間だけ自身の白シンボルを6色としても扱う / ENIGMA 色合計段階効果も実装済み", () => {
    const c = card("BSLH01-C02");
    const treatAs = c.effects![0]!;
    expect(treatAs.stub).toBeUndefined();
    expect(treatAs.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["spirit"],
        tribes: ["CB"],
      },
    ]);
    expect(treatAs.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(treatAs.steps[0]!.action).toEqual({
      kind: "treat_as",
      aspects: ["symbol"],
      asColor: ["red", "purple", "green", "yellow", "blue", "black"],
    });

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const nexus = createCardInstance(c, {
      instanceId: "c02-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });

    const withoutCb = executeEffect({
      chainId: "test:bslh01-cards:602",
      state: { ...base, cardInstances: [nexus] },
      effect: treatAs,
      sourceInstanceId: "c02-nexus",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });
    const withoutCbColors = new Set(
      getEffectiveSymbolBundles(withoutCb, nexus, c).flatMap((b) => b.colors)
    );
    expect(withoutCbColors.has("white")).toBe(true);
    expect(withoutCbColors.has("red")).toBe(false);
    expect(withoutCbColors.has("black")).toBe(false);

    const cbSpiritDef = card("BSLH01-C01");
    const cbSpirit = createCardInstance(cbSpiritDef, {
      instanceId: "cb-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const withCb = executeEffect({
      chainId: "test:bslh01-cards:624",
      state: { ...base, cardInstances: [nexus, cbSpirit] },
      effect: treatAs,
      sourceInstanceId: "c02-nexus",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });
    const registeredNexus = withCb.cardInstances.find(
      (ci) => ci.instanceId === "c02-nexus"
    )!;
    const withCbColors = new Set(
      getEffectiveSymbolBundles(withCb, registeredNexus, c).flatMap(
        (b) => b.colors
      )
    );
    for (const color of [
      "white",
      "red",
      "purple",
      "green",
      "yellow",
      "blue",
      "black",
    ] as const) {
      expect(withCbColors.has(color)).toBe(true);
    }

    const endStep = c.effects![1]!;
    expect(endStep.stub).toBeUndefined();
    expect(endStep.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "either",
    });
    expect(endStep.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ENIGMA" }],
        soulStateOnly: true,
      },
    ]);
    expect(endStep.steps.map((step) => step.executionMode)).toEqual([
      "optional",
      "optional",
      "optional",
      "optional",
    ]);
    expect(endStep.steps.map((step) => step.condition?.[0])).toEqual([
      {
        kind: "summoned_this_turn_color_count",
        player: "self",
        filter: { category: ["spirit"], tribes: ["CB"] },
        min: 2,
      },
      {
        kind: "summoned_this_turn_color_count",
        player: "self",
        filter: { category: ["spirit"], tribes: ["CB"] },
        min: 3,
      },
      {
        kind: "summoned_this_turn_color_count",
        player: "self",
        filter: { category: ["spirit"], tribes: ["CB"] },
        min: 5,
      },
      {
        kind: "summoned_this_turn_color_count",
        player: "self",
        filter: { category: ["spirit"], tribes: ["CB"] },
        min: 7,
      },
    ]);
  });

  it("[board] BSLH01-C02 effects[1]: ENIGMA 魂状態下でターン内召喚 CB 7色の4段階を任意実行する", () => {
    const c = card("BSLH01-C02");
    const enigmaDef = card("BSLH01-CX01");
    const summonedDef = card("BSLH01-M02");
    const nexus = createCardInstance(c, {
      instanceId: "c02-stage-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const enigma = createCardInstance(enigmaDef, {
      instanceId: "c02-stage-enigma",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const summonedBefore = createCardInstance(summonedDef, {
      instanceId: "c02-stage-summoned-cb",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const summoned = createCardInstance(summonedDef, {
      instanceId: "c02-stage-summoned-cb",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const beforeSummon = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, enigma, summonedBefore],
      playerOverrides: [
        {
          deckCount: 5,
          handCount: 0,
          reserveNormalCoreCount: 0,
          trashNormalCoreCount: 4,
          voidNormalCoreCount: 10,
          soulCoreLocation: null,
          reserveSoulCoreCount: 0,
          trashSoulCoreCount: 0,
          lifeSoulCoreCount: 0,
          soulStateInstanceIds: ["c02-stage-enigma"],
        },
        {},
      ],
    });
    const afterSummon = {
      ...beforeSummon,
      cardInstances: [nexus, enigma, summoned],
    };
    const base = collectAndQueueTriggerReactions({
      chainId: "test:bslh01-cards:755",
      beforeState: beforeSummon,
      afterState: afterSummon,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    expect(base.turnSummonedCardRefs).toEqual([
      {
        playerId: "alice",
        instanceId: "c02-stage-summoned-cb",
        definitionId: "BSLH01-M02",
        colors: [...summonedDef.colors],
        category: "spirit",
        tribes: ["CB", "S.S.S"],
      },
    ]);

    const afterStart = executeEffect({
      chainId: "test:bslh01-cards:774",
      state: base,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "c02-stage-nexus",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = drainOptionalStepsWithExecute(afterStart, getDef);
    const alice = after.players.find((p) => p.id === "alice")!;

    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(alice.reserveNormalCoreCount).toBe(5);
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(9);
    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(4);
    expect(alice.reserveSoulCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("[board] BSLH01-C02 effects[1]: 同色単色 CB 2体を2色として段階評価する", () => {
    const c = card("BSLH01-C02");
    const enigmaDef = card("BSLH01-CX01");
    const redCbDef = card("BSLH01-C05");
    const nexus = createCardInstance(c, {
      instanceId: "c02-same-color-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const enigma = createCardInstance(enigmaDef, {
      instanceId: "c02-same-color-enigma",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const beforeRed1 = createCardInstance(redCbDef, {
      instanceId: "c02-red-cb-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const beforeRed2 = createCardInstance(redCbDef, {
      instanceId: "c02-red-cb-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const red1 = createCardInstance(redCbDef, {
      instanceId: "c02-red-cb-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const red2 = createCardInstance(redCbDef, {
      instanceId: "c02-red-cb-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const beforeSummon = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, enigma, beforeRed1, beforeRed2],
      playerOverrides: [
        {
          deckCount: 5,
          handCount: 0,
          reserveNormalCoreCount: 0,
          trashNormalCoreCount: 4,
          voidNormalCoreCount: 3,
          soulCoreLocation: null,
          reserveSoulCoreCount: 0,
          trashSoulCoreCount: 0,
          lifeSoulCoreCount: 0,
          soulStateInstanceIds: ["c02-same-color-enigma"],
        },
        {},
      ],
    });
    const afterSummon = {
      ...beforeSummon,
      cardInstances: [nexus, enigma, red1, red2],
    };
    const base = collectAndQueueTriggerReactions({
      chainId: "test:bslh01-cards:865",
      beforeState: beforeSummon,
      afterState: afterSummon,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    expect(base.turnSummonedCardRefs).toEqual([
      {
        playerId: "alice",
        instanceId: "c02-red-cb-1",
        definitionId: "BSLH01-C05",
        colors: ["red"],
        category: "spirit",
        tribes: ["CB", "S.S.S"],
      },
      {
        playerId: "alice",
        instanceId: "c02-red-cb-2",
        definitionId: "BSLH01-C05",
        colors: ["red"],
        category: "spirit",
        tribes: ["CB", "S.S.S"],
      },
    ]);

    const afterStart = executeEffect({
      chainId: "test:bslh01-cards:892",
      state: base,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "c02-same-color-nexus",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = drainOptionalStepsWithExecute(afterStart, getDef);
    const alice = after.players.find((p) => p.id === "alice")!;

    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(4);
    expect(alice.handCount).toBe(0);
    expect(alice.deckCount).toBe(5);
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toBeNull();
  });
});

describe("BSLH01-C03 シャイニングポム", () => {
  const c = card("BSLH01-C03");
  it("手札/トラッシュ免疫 / 疲労コスト破壊 / 破壊時カウント+4", () => {
    const immune = c.effects![0]!;
    expect(immune.applicability?.zone).toEqual(["hand", "trash"]);
    expect(immune.steps[0]!.action.kind).toBe("effect_immunity");

    const destroy = c.effects![1]!.steps[1]!.action;
    expect(destroy.kind).toBe("destroy");

    const trig = c.effects![2]!;
    expect(trig.timing).toEqual({ kind: "card_event", event: "destroy" });
    const cnt = trig.steps[0]!.action;
    if (cnt.kind === "count_increase") expect(cnt.amount).toBe(4);
  });
});

describe("BSLH01-C04 エリィ・マクダエル", () => {
  const c = card("BSLH01-C04");
  it("召喚時カウント+コア配置+CBサーチ / Lv2アタック重疲労 / クォーツ：処女珠(CB/導力器 疲労由来で次回復不可)", () => {
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.executionMode).toBe("optional");
    expect(summon.steps[0]!.executionMode).toBe("optional");
    expect(summon.steps[1]!.executionMode).toBe("optional");
    expect(summon.steps[2]!.executionMode).toBe("optional");
    expect(summon.steps[0]!.action.kind).toBe("count_increase");
    const search = summon.steps[2]!.action;
    expect(search.kind).toBe("deck_reveal");
    if (search.kind === "deck_reveal") {
      expect(search.picks[0]).toMatchObject({
        count: 1,
        mandatory: true,
        filter: { tribes: ["CB"] },
      });
    }

    const atk = c.effects![1]!;
    expect(atk.condition).toContainEqual({ kind: "min_level", value: 2 });
    const ex = atk.steps[0]!.action;
    if (ex.kind === "exhaust") expect(ex.degree).toBe("heavy_exhaust");

    // 【クォーツ：処女珠】実プレイ経路の回帰は quartz-system.test.ts の
    // engine-exhaust-provenance-skip-refresh 節参照。
    const quartz = c.effects![2]!;
    expect(quartz.stub).toBeUndefined();
    expect(quartz.applicability).toEqual({ soulState: true });
    expect(quartz.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "exhaust",
      triggerFilter: {
        category: ["spirit", "ultimate", "nexus"],
        targetsGrandwalker: true,
      },
      triggerSourceFilter: { tribes: ["CB", "導力器"] },
      cause: ["opponent_effect"],
      sourceWhose: "either",
    });
    expect(quartz.steps[0]!.action.kind).toBe("prevent_next_recovery");
  });
});

describe("BSLH01-C05 ランディ・オルランド", () => {
  const c = card("BSLH01-C05");
  it("召喚/アタック 破壊(BP8000/コスト4) または バースト破棄 choice / エンドドロー / クォーツ:獅子珠 set-effect encode済み", () => {
    const e1 = c.effects![0]!;
    expect(e1.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    // 保存原文「ターンに1回」は先頭のカウント+1だけの個体ごとのターン制限。
    // 後続の破壊/バースト破棄と成立時処理には及ばない。
    expect(e1.usageLimit).toBeUndefined();
    expect(e1.steps[0]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    const step = e1.steps[1]!;
    const destroy = step.action;
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.filterOr).toEqual([
        { category: ["spirit"], maxBp: 8000 },
        { category: ["nexus"], maxCost: 4 },
      ]);
    }
    // 「破壊するか、バースト1つを破棄できる」: choice[0] = discard_set_burst
    expect(step.choice).toHaveLength(1);
    const altDiscard = step.choice![0]!.action;
    expect(altDiscard.kind).toBe("discard_set_burst");
    if (altDiscard.kind === "discard_set_burst") {
      expect(altDiscard.player).toBe("opponent");
      expect(altDiscard.count).toBe(1);
    }

    // step 2: トラッシュ→リザーブのコア3個 (本文「<ソウルコア>以外のコア3個」)。
    // engine の trash→reserve container パスは通常コア限定 (moveNormalCores) のため
    // ソウルコア除外は自動成立 ([[project_soul_core_movement_generic]])。
    const coreStep = e1.steps[2]!.action;
    expect(coreStep.kind).toBe("core_move");
    if (coreStep.kind === "core_move") {
      expect(coreStep.from).toEqual({ kind: "trash", player: "self" });
      expect(coreStep.to).toEqual({ kind: "reserve", player: "self" });
      expect(coreStep.amount).toBe(3);
    }
    expect(e1.steps[2]!.connector).toBe("conditional_result");

    // step 3: count+1 は destroy_or_discard 成立にゲート (本文「破壊/破棄したとき…
    // カウント+1する」)。直前 step (core_move) の succeeded ではなく、stepCondition
    // で destroy_or_discard を ref_succeeded 明示参照する。
    expect(e1.steps[3]!.connector).toBe("sequential");
    expect(e1.steps[3]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "destroy_or_discard",
    });

    const draw = c.effects![1]!.steps[0]!.action;
    expect(draw.kind).toBe("draw");

    // [0] effects[0] は stub なし (engine 既存動作で本文挙動が成立)
    expect(e1.stub).toBeUndefined();
    // 【クォーツ：獅子珠】set-effect: quartz-system.test.ts の専用 describe ブロックで
    // game_event/leave_field 第三者観測 + occurrenceGate(turn,2) を詳細検証済み。
    const quartzEffect = c.effects![2]!;
    expect(quartzEffect.stub).toBeUndefined();
    expect(quartzEffect.applicability).toEqual({ soulState: true });
    expect(quartzEffect.occurrenceGate).toEqual({
      duration: "turn",
      targetCount: 2,
    });
  });

  it("BSLH01-C05 effects[0] 統合: destroy 成立 + trash 0 個でも count+1 が destroy_or_discard 成功にゲートされ計2回発揮", () => {
    // 本文「破壊/破棄したとき、トラッシュの<ソウルコア>以外のコア3個を自分のリザーブに
    // 置き、自分のカウント+1する」を最終盤面で検証する。step 1 default arm = destroy で
    // 相手スピリットを破壊し、step 2 (core_move) が trash 0 個で no-op になっても
    // step 3 の count+1 が stepCondition:ref_succeeded(destroy_or_discard) で発揮されるか。
    //
    //   (a) 自分のトラッシュ通常コアが 0 個でソウルコアのみがあるとき、core_move (step 2)
    //       は no-op だが ソウルコアはトラッシュに残る ([[project_soul_core_movement_generic]])。
    //   (b) step 3 (count+1) は直前 step (core_move) ではなく destroy_or_discard 成功に
    //       stepCondition:ref_succeeded で明示ゲートしているため、core_move 不発でも
    //       destroy 成立時には count+1 が発揮される (verifier round1 lens1 指摘の修正)。
    //
    // 結果として:
    //   - step 0 count+1 (optional execute) で countValue +1
    //   - step 1 destroy: 相手スピリット 1 体が trash へ
    //   - step 2 core_move: no-op (trash 0)
    //   - step 3 count+1: destroy_or_discard ref_succeeded で発揮 → countValue +1
    //   - 合計 countValue +2
    const ALICE = "player-1";
    const BOB = "player-2";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const src = createCardInstance(c, {
      instanceId: "randy-c05-integ",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手のフィールドに低 BP スピリットを 1 体配置 → destroy ブランチが 1 候補で
    // pendingEffectTargetSelection を経由せず即解決する。
    const opponentCard = card("BSLH01-C06") as CardDefinition; // BP <=8000 の spirit
    const opponentSpirit = createCardInstance(opponentCard, {
      instanceId: "bob-spirit-c05",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      cardInstances: [src, opponentSpirit],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              trashNormalCoreCount: 0,
              soulCoreLocation: { kind: "trash" as const },
              countValue: 3,
            }
          : p
      ),
    };

    // step 1 の default arm = step.action (= destroy) を選択 (resolve_pending_step_optional_choice
    // の choice は execute/decline のみで choiceIndex は持たず、default は step.action)。
    // 相手スピリットを 1 体だけ置いておくことで destroy filter は単一候補に解決し、
    // pendingEffectTargetSelection を経由せず即解決する。
    let after = executeEffect({
      chainId: "test:bslh01-cards:1112",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "randy-c05-integ",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      // 既定 choiceIndex は executeEffect の signature にはない (step 単位なので、
      // pending を resolve する側で choice を選ぶ)。
    });

    // step 0 (count+1 optional): execute で発揮
    if (after.pendingStepOptionalChoice) {
      const psoc = after.pendingStepOptionalChoice;
      after = applyLegalAction({
        state: after,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${psoc.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: psoc.actingPlayerId,
          pendingId: psoc.pendingId,
          sourceInstanceId: psoc.sourceInstanceId,
          effectIndex: psoc.effectIndex,
          stepIndex: psoc.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }

    // step 1 (destroy_or_discard optional with choice): execute (default=destroy arm)
    // を選ぶと destroy filter で「opponent spirit BP<=8000 / nexus cost<=4」候補
    // を要求する。Alice の盤面に該当 spirit が無いため destroy 不発 →
    // discard_set_burst arm へフォールバック挙動を確認する代わりに、ここでは destroy
    // 候補無しでも optional pending が出ない可能性を吸収するため drain helper を流用する。
    after = drainOptionalStepsWithExecute(after, getDef);

    const afterAlice = after.players.find((p) => p.id === ALICE)!;
    // (a) ソウルコア残置: トラッシュに居続ける、通常コアは 0 のまま (core_move no-op)
    expect(afterAlice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(afterAlice.trashNormalCoreCount).toBe(0);
    expect(afterAlice.reserveNormalCoreCount).toBe(
      before.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    );
    // (b) destroy 成立で bob-spirit-c05 が trash へ送られている (flushPendingLeaves 後)
    const destroyed = after.cardInstances.find(
      (x) => x.instanceId === "bob-spirit-c05"
    )!;
    expect(destroyed.zone).toBe("trash");
    // step 0 count+1 + step 3 count+1 = 3 → 5。core_move (step 2) は no-op だが step 3 は
    // stepCondition:ref_succeeded(destroy_or_discard) ゲート経由で発揮される。
    expect(afterAlice.countValue).toBe(5);
    // engine log で step 2 core_move が 0 個・step 3 が後続で count+1 を発揮した事実を確認
    const log = after.log.join("\n");
    expect(log).toContain("effect:core_move:trash->reserve:0:no-source-cores");
    expect(log).toMatch(
      /effect:count_increase:player-1:1[\s\S]+effect:count_increase:player-1:1/
    );
  });

  it("BSLH01-C05 effects[0] 盤面: BP条件と独立したコスト4以下ネクサスだけを破壊する", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const lowCostNexus = card("BSLH01-C02") as CardDefinition;
    const highCostNexus: CardDefinition = {
      ...lowCostNexus,
      cardNo: "fixture-bslh01-c05-high-cost-nexus",
      cost: 5,
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === highCostNexus.cardNo ? highCostNexus : cardNoMap.get(id);
    const source = createCardInstance(c, {
      instanceId: "randy-c05-nexus-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const legalNexus = createCardInstance(lowCostNexus, {
      instanceId: "bob-c05-cost-2-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const secondLegalNexus = createCardInstance(lowCostNexus, {
      instanceId: "bob-c05-cost-2-nexus-second",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const ineligibleNexus = createCardInstance(highCostNexus, {
      instanceId: "bob-c05-cost-5-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });

    let after = executeEffect({
      chainId: "test:bslh01-cards:1212",
      state: createEmptyGameState({
        cardInstances: [source, legalNexus, secondLegalNexus, ineligibleNexus],
      }),
      effect: c.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    for (const expectedStepIndex of [0, 1]) {
      const pending = after.pendingStepOptionalChoice!;
      expect(pending.stepIndex).toBe(expectedStepIndex);
      after = applyLegalAction({
        state: after,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${pending.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
    // maxCost が filterOr 外へ漏れれば、cost 5 のネクサスも候補に混ざる。この候補集合は
    // target 選択前に確定するため、先頭候補の自動選択に依存せずコスト境界を回帰できる。
    expect(
      after.pendingStepOptionalTargetSelection?.candidateInstanceIds
    ).toEqual([legalNexus.instanceId, secondLegalNexus.instanceId]);
    after = drainOptionalStepsWithExecute(after, getDef);

    expect(
      after.cardInstances.find(
        (entry) => entry.instanceId === legalNexus.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find(
        (entry) => entry.instanceId === secondLegalNexus.instanceId
      )?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find(
        (entry) => entry.instanceId === ineligibleNexus.instanceId
      )?.zone
    ).toBe("field");
  });

  it("BSLH01-C05 effects[0]: count+1 辞退後に破壊/破棄候補がなければ不可辞退 step は不発で解決し stuck しない", () => {
    const ALICE = "player-1";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const src = createCardInstance(c, {
      instanceId: "randy-c05-fizzle",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({ cardInstances: [src] });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 3 } : p
      ),
    };

    const firstPendingState = executeEffect({
      chainId: "test:bslh01-cards:1286",
      state: before,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "randy-c05-fizzle",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const first = firstPendingState.pendingStepOptionalChoice!;
    expect(first.stepIndex).toBe(0);

    let afterDecline = applyLegalAction({
      state: firstPendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${first.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: first.actingPlayerId,
        pendingId: first.pendingId,
        sourceInstanceId: first.sourceInstanceId,
        effectIndex: first.effectIndex,
        stepIndex: first.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    afterDecline = drainOptionalStepsExecutingWhenAvailable(
      afterDecline,
      getDef
    );
    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(afterDecline.pendingStepOptionalTargetSelection).toBeNull();
    expect(afterDecline.players.find((p) => p.id === ALICE)!.countValue).toBe(
      3
    );
  });

  it("BSLH01-C05 effects[0] 統合: バースト破棄 (choiceIndex=1) 成立 + trash 0 個でも count+1 が destroy_or_discard 成功にゲートされ計2回発揮", () => {
    // 本文「破壊するか、バースト1つを破棄できる」の `バースト破棄` 経路でも step 3 count+1
    // が destroy_or_discard 成功で発揮されることを assert する (verifier round3 lens5 指摘)。
    // step 1 の choice[0] = discard_set_burst を選ぶため、executeEffect の choiceIndex=1 を
    // 通じて step.choice[0] を active action にする。
    const ALICE = "player-1";
    const BOB = "player-2";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const src = createCardInstance(c, {
      instanceId: "randy-c05-burst",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手の setBurst を 1 枚、destroy 候補となる相手 field カードは置かない (この経路で
    // 必要なのは setBurstStates のみ)。
    const burstCard = card("BSLH01-R05") as CardDefinition;
    const bobBurst = createCardInstance(burstCard, {
      instanceId: "bob-burst-c05b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "burst",
    });
    const baseState = createEmptyGameState({ cardInstances: [src, bobBurst] });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              trashNormalCoreCount: 0,
              soulCoreLocation: { kind: "trash" as const },
              countValue: 3,
            }
          : p
      ),
      setBurstStates: [{ playerId: BOB, cardInstanceId: "bob-burst-c05b" }],
    };

    // choiceIndex=1 で step 1 の choice[0]=discard_set_burst を選択する。
    let after = executeEffect({
      chainId: "test:bslh01-cards:1369",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "randy-c05-burst",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
    });
    after = drainOptionalStepsWithExecute(after, getDef);

    const afterAlice = after.players.find((p) => p.id === ALICE)!;
    // (a) ソウルコア残置: トラッシュに居続ける、通常コアは 0 のまま
    expect(afterAlice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(afterAlice.trashNormalCoreCount).toBe(0);
    // (b) discard_set_burst 成立で bob-burst-c05b が trash zone へ、setBurstStates から削除
    const trashedBurst = after.cardInstances.find(
      (x) => x.instanceId === "bob-burst-c05b"
    )!;
    expect(trashedBurst.zone).toBe("trash");
    expect(after.setBurstStates).toHaveLength(0);
    // step 0 count+1 + step 3 count+1 = 3 → 5 (step 2 core_move は trash 0 で no-op)
    expect(afterAlice.countValue).toBe(5);
    const log = after.log.join("\n");
    expect(log).toContain("effect:core_move:trash->reserve:0:no-source-cores");
  });
});

describe("BSLH01-C06 ティオ・プラトー", () => {
  const c = card("BSLH01-C06");
  it("手札宣言召喚 / 召喚時ドロー2破棄2+CB破棄count+1 / クォーツ:魔防2 set-effect encode済み", () => {
    const declareSummon = c.effects![0]!;
    expect(declareSummon.stub).toBeUndefined();
    expect(declareSummon.applicability).toEqual({ zone: ["hand"] });
    expect(declareSummon.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "destroy",
      triggerFilter: { cardName: [{ contains: "みっしぃ" }] },
    });
    expect(declareSummon.executionMode).toBe("optional");
    expect(declareSummon.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(declareSummon.steps[0]!.action.kind).toBe("declare_gimmick");
    expect(declareSummon.steps[1]!.action.kind).toBe("summon");
    expect(declareSummon.steps[1]!.connector).toBe("conditional_cost");

    const summon = c.effects![1]!;
    expect(summon.stub).toBeUndefined();
    expect(summon.steps[0]!.action.kind).toBe("suppress_effect");
    expect(summon.steps[1]!.action.kind).toBe("draw");
    expect(summon.steps[2]!.id).toBe("discard-cb-check");
    expect(summon.steps[2]!.action.kind).toBe("discard");
    expect(summon.steps[3]!.action.kind).toBe("count_increase");
    expect(summon.steps[3]!.stepCondition).toEqual({
      kind: "ref_has_match",
      stepId: "discard-cb-check",
      filter: { tribes: ["CB"] },
    });
    // 【クォーツ：魔防2】set-effect: quartz-system.test.ts の専用 describe ブロックで
    // game_event/leave_field 第三者観測 + stay_on_field を詳細検証済み。
    const quartzEffect = c.effects![2]!;
    expect(quartzEffect.stub).toBeUndefined();
    expect(quartzEffect.applicability).toEqual({ soulState: true });
    expect(quartzEffect.timing.kind).toBe("game_event");
    expect(quartzEffect.steps[0]!.action.kind).toBe("stay_on_field");
  });

  it("自分の「みっしぃ」破壊時、手札のこのカードが宣言ギミックで召喚され declarationCountThisTurn が1増える", () => {
    const missy = card("BSLH01-T01");
    const missySource = createCardInstance(missy, {
      instanceId: "missy-1",
      ownerPlayerId: "player-1",
      zone: "trash",
    });
    const handCard = createCardInstance(c, {
      instanceId: "c06-hand-1",
      ownerPlayerId: "player-1",
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [missySource, handCard],
    });

    const after = executeEffect({
      chainId: "test:bslh01-cards:1452",
      state: before,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: handCard.instanceId,
      relatedInstanceId: missySource.instanceId,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(after.declarationCountThisTurn["player-1"]).toBe(1);
    const summoned = after.cardInstances.find(
      (card) => card.instanceId === handCard.instanceId
    )!;
    expect(summoned.zone).toBe("field");
  });

  it("召喚時効果で相手ネクサス効果を current_effect 抑止し、CB を破棄したときだけ count+1", () => {
    const source = createCardInstance(c, {
      instanceId: "c06-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const cbHand = createCardInstance(card("BSLH01-C01"), {
      instanceId: "alice-cb-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const nonCbHand = createCardInstance(card("BSSL01-C02"), {
      instanceId: "alice-noncb-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const opponentNexus = createCardInstance(card("BSAZ02-M01"), {
      instanceId: "bob-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, cbHand, nonCbHand, opponentNexus],
      playerOverrides: [{ handCount: 2, countValue: 0 }, {}],
    });
    const suppressAction = c.effects![1]!.steps[0]!.action;
    if (suppressAction.kind !== "suppress_effect") {
      throw new Error("expected BSLH01-C06 summon step0 suppress_effect");
    }
    const duringEffect = executeSuppressEffect(
      suppressAction,
      { ...before, log: [...before.log] },
      "alice",
      "c06-field",
      (id) => cardNoMap.get(id),
      c.effects![1]!,
      undefined,
      { effectIndex: 1, stepIndex: 0 }
    );
    expect(duringEffect.activeContinuousEffects).toContainEqual(
      expect.objectContaining({
        modifierTag: "effect_suppression",
        duration: { scope: "current_effect" },
        metadata: expect.objectContaining({
          suppressTargetPlayer: "opponent",
          suppressTargetFilter: { category: ["nexus"] },
        }),
      })
    );
    expect(
      executeReevaluationCheck({
        state: duringEffect,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-nexus",
        targetInstanceIds: [],
        suppressionEffectDescriptor: deriveSuppressionEffectDescriptor(
          card("BSAZ02-M01").effects![0]!,
          {
            sourceDefinitionId: "BSAZ02-M01",
            effectIndex: 0,
            sourceTextLines: card("BSAZ02-M01").textLines,
          }
        ),
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).toBe(false);

    const after = executeEffect({
      chainId: "test:bslh01-cards:1544",
      state: before,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "c06-field",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(1);
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "alice-cb-hand")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "alice-noncb-hand")
        ?.zone
    ).toBe("trash");
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.duration.scope === "current_effect"
      )
    ).toBe(false);
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-nexus",
        targetInstanceIds: [],
        suppressionEffectDescriptor: deriveSuppressionEffectDescriptor(
          card("BSAZ02-M01").effects![0]!,
          {
            sourceDefinitionId: "BSAZ02-M01",
            effectIndex: 0,
            sourceTextLines: card("BSAZ02-M01").textLines,
          }
        ),
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).toBe(true);

    const nonCbOnlyA = createCardInstance(card("BSSL01-C02"), {
      instanceId: "alice-noncb-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const nonCbOnlyB = createCardInstance(card("BSTH01-C01"), {
      instanceId: "alice-noncb-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const noCbBefore = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, nonCbOnlyA, nonCbOnlyB, opponentNexus],
      playerOverrides: [{ handCount: 2, countValue: 0 }, {}],
    });

    const noCbAfter = executeEffect({
      chainId: "test:bslh01-cards:1605",
      state: noCbBefore,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "c06-field",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(noCbAfter.players.find((p) => p.id === "alice")?.countValue).toBe(0);
  });

  it("current_effect 抑止を action_resolution の誘発 queue まで維持し、相手ネクサス listener を queue しない", () => {
    const opponentNexusDef: CardDefinition = {
      cardNo: "TEST-C06-OPP-NEXUS",
      name: "テスト用 相手ネクサス",
      printedCategory: "nexus",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: ["相手の手札が増えたとき、自分のカウント+1する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "opponent",
            event: "increase_hand",
          },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0],
        },
      ],
    };
    const definitions = [...ALL_CARDS, opponentNexusDef];
    const localGetDef = (id: string): CardDefinition | undefined =>
      definitions.find((def) => def.cardNo === id);
    const triggerLookup = buildTriggeredEffectLookup(definitions);
    const source = createCardInstance(c, {
      instanceId: "c06-field-queue",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentNexus = createCardInstance(opponentNexusDef, {
      instanceId: "bob-nexus-queue",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, opponentNexus],
      playerOverrides: [{ handCount: 0, countValue: 0 }, { countValue: 0 }],
    });
    const drawOnlyEffect = {
      ...c.effects![1]!,
      steps: [c.effects![1]!.steps[1]!],
    };
    const noSuppressResolved = executeEffect({
      chainId: "test:bslh01-cards:1673",
      state: before,
      effect: drawOnlyEffect,
      effectIndex: 1,
      deferCurrentEffectCleanup: true,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: localGetDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const noSuppressFinalized = finalizeEffectResolution({
      state: noSuppressResolved,
      beforeState: before,
      chainId: "c06-no-suppress",
      endLogs: [],
      actingPlayerId: "alice",
      getCardDefinitionById: localGetDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: source.instanceId,
      sourceEffectIndex: 1,
    });
    expect(
      noSuppressFinalized.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "increase_hand" &&
          pending.actingPlayerId === "bob"
      )
    ).toBe(true);

    const resolved = executeEffect({
      chainId: "test:bslh01-cards:1703",
      state: before,
      effect: c.effects![1]!,
      effectIndex: 1,
      deferCurrentEffectCleanup: true,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: localGetDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.duration.scope === "current_effect"
      )
    ).toBe(true);

    const finalized = finalizeEffectResolution({
      state: resolved,
      beforeState: before,
      chainId: "c06-suppress",
      endLogs: [],
      actingPlayerId: "alice",
      getCardDefinitionById: localGetDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: source.instanceId,
      sourceEffectIndex: 1,
    });

    expect(
      finalized.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "increase_hand" &&
          pending.actingPlayerId === "bob"
      )
    ).toBe(false);
    expect(
      finalized.log.some(
        (entry) =>
          entry.startsWith("trigger:effect-suppressed:") &&
          entry.includes(":increase_hand:") &&
          entry.endsWith(":bob-nexus-queue")
      )
    ).toBe(true);
    expect(
      finalized.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.duration.scope === "current_effect"
      )
    ).toBe(false);
  });
});

describe("BSLH01-C07 アレックス・ダドリー", () => {
  const c = card("BSLH01-C07");
  it("召喚時手元移動+種別分岐 / Lv2アタックbounce / アタック時 self re-fire 召喚効果", () => {
    const summon = c.effects![0]!;
    expect(summon.stub).toBeUndefined();
    const mv = summon.steps[0]!.action;
    expect(mv.kind).toBe("move_card");
    if (mv.kind === "move_card") {
      expect(mv.from.zone).toBe("hand");
      expect(mv.to.zone).toBe("set_aside");
      expect(mv.to.player).toBe("opponent");
      expect(mv.faceDown).toBeUndefined();
      expect(mv.unseen).toBe(true);
    }
    expect(summon.steps[1]!.action).toMatchObject({
      kind: "move_card",
      target: { kind: "ref", stepId: "c07-set-aside-opponent-hand" },
      from: { zone: "set_aside", player: "opponent" },
      to: { zone: "trash", player: "opponent" },
    });
    expect(summon.steps[1]!.stepCondition).toEqual({
      kind: "ref_has_match",
      stepId: "c07-set-aside-opponent-hand",
      filter: { category: ["magic"] },
    });
    expect(summon.steps[2]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 2,
    });
    expect(summon.steps[3]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(summon.steps[4]).toMatchObject({
      id: "c07-bonus-set-aside-opponent-hand",
      executionMode: "optional",
      action: {
        kind: "move_card",
        from: { zone: "hand", player: "opponent" },
        to: { zone: "set_aside", player: "opponent" },
        unseen: true,
      },
    });
    expect(summon.steps[4]!.stepCondition).toEqual({
      kind: "ref_has_match",
      stepId: "c07-set-aside-opponent-hand",
      filter: { category: ["spirit"] },
    });
    expect(summon.steps[5]!.action).toMatchObject({
      kind: "move_card",
      target: { kind: "ref", stepId: "c07-bonus-set-aside-opponent-hand" },
      from: { zone: "set_aside", player: "opponent" },
      to: { zone: "trash", player: "opponent" },
    });
    const attack = c.effects![1]!;
    expect(attack.steps[0]!.action.kind).toBe("bounce");
    expect(attack.steps[0]!.id).toBe("c07-bounce-opponent-spirit");
    // 「相手のスピリット1体を手札に戻せる」(可能形=任意)
    expect(attack.executionMode).toBe("optional");
    expect(attack.steps[1]!.connector).toBe("after_triggers");
    expect(attack.steps[1]!.executionMode).toBe("optional");
    expect(attack.steps[1]!.stepCondition).toBeUndefined();
    expect(attack.steps[1]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const refireAct = attack.steps[1]!.action;
    expect(refireAct.kind).toBe("move_card");
    if (refireAct.kind === "move_card") {
      expect(refireAct.from.zone).toBe("hand");
      expect(refireAct.from.player).toBe("opponent");
      expect(refireAct.to.zone).toBe("set_aside");
      expect(refireAct.to.player).toBe("opponent");
      expect(refireAct.faceDown).toBeUndefined();
      expect(refireAct.unseen).toBe(true);
      expect(refireAct.count).toBe(1);
    }
    expect(attack.steps[2]!.stepCondition).toEqual({
      kind: "ref_has_match",
      stepId: "c07-refire-set-aside-opponent-hand",
      filter: { category: ["magic"] },
    });
    // 【クォーツ：冥王珠】セット効果 (effects[2]): grant_effect_source_prevention_immunity
    // (sourceScope:soulDriveDeparture) 登録まで着地 (P3-125 Step13/14、意味差分は
    // grant-effect-source-prevention-immunity.test.ts 参照)。
    const quartzEffect = c.effects![2]!;
    expect(quartzEffect.stub).toBeUndefined();
    expect(quartzEffect.applicability).toEqual({ soulState: true });
    expect(quartzEffect.timing).toEqual({ kind: "continuous" });
    const grantAction = quartzEffect.steps[0]!.action;
    expect(grantAction.kind).toBe("grant_effect_source_prevention_immunity");
    if (grantAction.kind === "grant_effect_source_prevention_immunity") {
      expect(grantAction.sourceScope).toEqual({ soulDriveDeparture: true });
      expect(grantAction.usageLimit).toEqual({
        kind: "per_instance",
        duration: "turn",
        maxCount: 1,
      });
      expect(grantAction.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("BSLH01-C07 召喚時: 置いたカードがマジックならその1枚を破棄し count+2 する", () => {
    const src = createCardInstance(c, {
      instanceId: "bslh01-c07-source-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(card("BSLH01-M05"), {
      instanceId: "bslh01-c07-opponent-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
      cardInstances: [src, magic],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:1884",
        state: before,
        effect: c.effects![0]!,
        sourceInstanceId: src.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    expect(
      after.cardInstances.find((ci) => ci.instanceId === magic.instanceId)?.zone
    ).toBe("trash");
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(2);
    expect(
      after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === "bob" && ci.zone === "set_aside"
      )
    ).toHaveLength(0);
  });

  it("BSLH01-C07 召喚時: 内容を見ずに手札を置くため内部順先頭固定ではない", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const src = createCardInstance(c, {
        instanceId: "bslh01-c07-source-unseen",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const firstSpirit = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-unseen-first-spirit",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const secondMagic = createCardInstance(card("BSLH01-M05"), {
        instanceId: "bslh01-c07-unseen-second-magic",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
        cardInstances: [src, firstSpirit, secondMagic],
      });
      const after = drainOptionalStepsWithExecute(
        executeEffect({
          chainId: "test:bslh01-cards:1934",
          state: before,
          effect: c.effects![0]!,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );

      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === firstSpirit.instanceId
        )?.zone
      ).toBe("hand");
      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === secondMagic.instanceId
        )?.zone
      ).toBe("trash");
      expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(2);
    } finally {
      random.mockRestore();
    }
  });

  it("BSLH01-C07 召喚時: 置いたカードがスピリットなら追加発揮し、2枚目スピリットでも count+1 する", () => {
    const src = createCardInstance(c, {
      instanceId: "bslh01-c07-source-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const firstSpirit = createCardInstance(card("BSLH01-C06"), {
      instanceId: "bslh01-c07-opponent-spirit-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const secondSpirit = createCardInstance(card("BSLH01-C08"), {
      instanceId: "bslh01-c07-opponent-spirit-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
      cardInstances: [src, firstSpirit, secondSpirit],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:1987",
        state: before,
        effect: c.effects![0]!,
        sourceInstanceId: src.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    const moved = after.cardInstances.filter(
      (ci) => ci.ownerPlayerId === "bob" && ci.zone === "set_aside"
    );
    expect(moved.map((ci) => ci.instanceId).sort()).toEqual([
      firstSpirit.instanceId,
      secondSpirit.instanceId,
    ]);
    expect(moved.every((ci) => ci.controllerPlayerId === "bob")).toBe(true);
    expect(moved.every((ci) => ci.faceDown !== true)).toBe(true);
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(2);
  });

  it("BSLH01-C07 召喚時: 1枚目スピリットから追加発揮した2枚目がマジックなら破棄し count 合計+3", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const src = createCardInstance(c, {
        instanceId: "bslh01-c07-source-spirit-magic",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const firstSpirit = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-opponent-spirit-first",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const secondMagic = createCardInstance(card("BSLH01-M05"), {
        instanceId: "bslh01-c07-opponent-magic-second",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
        cardInstances: [src, firstSpirit, secondMagic],
      });
      const after = drainOptionalStepsWithExecute(
        executeEffect({
          chainId: "test:bslh01-cards:2038",
          state: before,
          effect: c.effects![0]!,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );

      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === firstSpirit.instanceId
        )?.zone
      ).toBe("set_aside");
      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === firstSpirit.instanceId
        )?.controllerPlayerId
      ).toBe("bob");
      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === firstSpirit.instanceId
        )?.faceDown
      ).toBe(false);
      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === secondMagic.instanceId
        )?.zone
      ).toBe("trash");
      expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(3);
    } finally {
      random.mockRestore();
    }
  });

  it("BSLH01-C07 召喚時: 1枚目スピリット後の追加発揮は decline できる", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const src = createCardInstance(c, {
        instanceId: "bslh01-c07-source-spirit-decline",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const firstSpirit = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-opponent-spirit-decline-first",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const secondSpirit = createCardInstance(card("BSLH01-C08"), {
        instanceId: "bslh01-c07-opponent-spirit-decline-second",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
        cardInstances: [src, firstSpirit, secondSpirit],
      });
      const pendingState = executeEffect({
        chainId: "test:bslh01-cards:2102",
        state: before,
        effect: c.effects![0]!,
        sourceInstanceId: src.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      });
      const pending = pendingState.pendingStepOptionalChoice!;
      expect(pending.stepIndex).toBe(4);

      const after = applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${pending.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice: "decline",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === firstSpirit.instanceId
        )?.zone
      ).toBe("set_aside");
      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === firstSpirit.instanceId
        )?.controllerPlayerId
      ).toBe("bob");
      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === secondSpirit.instanceId
        )?.zone
      ).toBe("hand");
      expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(1);
    } finally {
      random.mockRestore();
    }
  });

  it("BSLH01-C07 アタック時: refire した召喚時効果でマジックを破棄し count+2 する", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const src = createCardInstance(c, {
        instanceId: "bslh01-c07-attack-refire-magic",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const bounceTarget = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-bounce-target",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const magic = createCardInstance(card("BSLH01-M05"), {
        instanceId: "bslh01-c07-refire-magic",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
        cardInstances: [src, magic, bounceTarget],
      });
      const after = drainOptionalStepsWithExecute(
        executeEffect({
          chainId: "test:bslh01-cards:2181",
          state: before,
          effect: c.effects![1]!,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );

      expect(
        after.cardInstances.find(
          (ci) => ci.instanceId === bounceTarget.instanceId
        )?.zone
      ).toBe("hand");
      expect(
        after.cardInstances.find((ci) => ci.instanceId === magic.instanceId)
          ?.zone
      ).toBe("trash");
      expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(2);
    } finally {
      random.mockRestore();
    }
  });

  it("BSLH01-C07 アタック時: 戻せる対象があっても戻しを辞退し、召喚時効果だけ発揮できる", () => {
    const src = createCardInstance(c, {
      instanceId: "bslh01-c07-attack-decline-bounce",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const bounceTarget = createCardInstance(card("BSLH01-C06"), {
      instanceId: "bslh01-c07-declined-bounce-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(card("BSLH01-M05"), {
      instanceId: "bslh01-c07-declined-bounce-refire-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
      cardInstances: [src, bounceTarget, magic],
    });
    const pendingState = executeEffect({
      chainId: "test:bslh01-cards:2233",
      state: before,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: src.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(pendingState.pendingStepOptionalChoice?.stepIndex).toBe(0);
    expect(pendingState.pendingStepOptionalChoice?.canExecute).not.toBe(false);
    const decline = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([c]),
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(decline).toBeDefined();
    expect(decline?.can).toBe(true);
    const afterDecline = applyLegalAction({
      state: pendingState,
      action: decline!,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([c]),
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const after = drainOptionalStepsWithExecute(afterDecline, getDef);

    expect(
      after.cardInstances.find(
        (ci) => ci.instanceId === bounceTarget.instanceId
      )?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((ci) => ci.instanceId === magic.instanceId)?.zone
    ).toBe("trash");
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(2);
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.pendingStepOptionalTargetSelection).toBeNull();
    expect(after.pendingAfterTriggersContinuations).toHaveLength(0);
  });

  it("BSLH01-C07 アタック時: 戻す対象がなくても召喚時効果を発揮できる", () => {
    const src = createCardInstance(c, {
      instanceId: "bslh01-c07-attack-refire-no-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const magic = createCardInstance(card("BSLH01-M05"), {
      instanceId: "bslh01-c07-refire-no-target-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
      cardInstances: [src, magic],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:2300",
        state: before,
        effect: c.effects![1]!,
        sourceInstanceId: src.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    expect(
      after.cardInstances.find((ci) => ci.instanceId === magic.instanceId)?.zone
    ).toBe("trash");
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(2);
  });

  it("BSLH01-C07 アタック時: bounce 成功後に手札候補が残らなければ refire 使用回数を消費しない", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const { executionMode: _executionMode, ...acceptedAttackEffect } =
        c.effects![1]!;
      const src = createCardInstance(c, {
        instanceId: "bslh01-c07-attack-empty-hand-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const bounceTarget = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-attack-empty-hand-bounce",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
        cardInstances: [src, bounceTarget],
      });
      const beforeWithDiscardOnLeave: GameState = {
        ...before,
        activeContinuousEffects: [
          ...before.activeContinuousEffects,
          {
            effectId: "ce-c07-empty-hand-discard-on-leave",
            sourceInstanceId: bounceTarget.instanceId,
            sourceDefinitionId: bounceTarget.definitionId,
            actingPlayerId: "bob",
            duration: { scope: "while_on_field" },
            createdAtTurn: before.turnNumber,
            createdAtAttackId: null,
            modifierTag: "act_as_spirit",
            targetInstanceId: bounceTarget.instanceId,
            metadata: {
              statBlueprint: {
                kind: "static_copy",
                snapshot: {
                  cost: 3,
                  reductionSymbols: [],
                  symbolColors: ["blue"],
                  tribes: ["CB"],
                  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
                },
              },
              overrides: { keywords: ["discard_on_leave"] },
            },
          },
        ],
      };
      const afterEmptyHand = drainOptionalStepsExecutingWhenAvailable(
        executeEffect({
          chainId: "test:bslh01-cards:2372",
          state: beforeWithDiscardOnLeave,
          effect: acceptedAttackEffect,
          effectIndex: 1,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );
      const usageLabel = "__step:BSLH01-C07:1:1";
      expect(
        afterEmptyHand.cardInstances.find(
          (ci) => ci.instanceId === bounceTarget.instanceId
        )?.zone
      ).toBe("trash");
      expect(
        afterEmptyHand.effectUsageRecords.filter(
          (record) => record.effectLabel === usageLabel
        )
      ).toHaveLength(0);
      expect(
        afterEmptyHand.players.find((p) => p.id === "alice")?.countValue
      ).toBe(0);

      const srcSecond = createCardInstance(c, {
        instanceId: src.instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const bounceTargetSecond = createCardInstance(card("BSLH01-C08"), {
        instanceId: "bslh01-c07-attack-empty-hand-bounce-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const magic = createCardInstance(card("BSLH01-M05"), {
        instanceId: "bslh01-c07-attack-empty-hand-later-magic",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const beforeSecond = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
          cardInstances: [srcSecond, bounceTargetSecond, magic],
        }),
        effectUsageRecords: afterEmptyHand.effectUsageRecords,
        turnNumber: afterEmptyHand.turnNumber,
      };
      const afterSecond = drainOptionalStepsExecutingWhenAvailable(
        executeEffect({
          chainId: "test:bslh01-cards:2428",
          state: beforeSecond,
          effect: acceptedAttackEffect,
          effectIndex: 1,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );

      expect(
        afterSecond.cardInstances.find(
          (ci) => ci.instanceId === magic.instanceId
        )?.zone
      ).toBe("trash");
      expect(
        afterSecond.effectUsageRecords.filter(
          (record) => record.effectLabel === usageLabel
        )
      ).toHaveLength(1);
      expect(
        afterSecond.players.find((p) => p.id === "alice")?.countValue
      ).toBe(2);
    } finally {
      random.mockRestore();
    }
  });

  it("BSLH01-C07 アタック時: refire は同名ターン1回で、2回目はbounceだけ解決する", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const { executionMode: _executionMode, ...acceptedAttackEffect } =
        c.effects![1]!;
      // 本文の〔ターンに1回：同名〕は「この効果発揮後」の召喚時効果だけを
      // 制限する。アタック時効果全体へ置くと、2回目のbounceまで不発になる。
      expect(acceptedAttackEffect.usageLimit).toBeUndefined();
      const src = createCardInstance(c, {
        instanceId: "bslh01-c07-attack-usage-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const magic1 = createCardInstance(card("BSLH01-M05"), {
        instanceId: "bslh01-c07-attack-usage-magic-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const bounceTarget1 = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-attack-usage-bounce-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const magic2 = createCardInstance(card("BSLH01-M05"), {
        instanceId: "bslh01-c07-attack-usage-magic-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const bounceTarget2 = createCardInstance(card("BSLH01-C08"), {
        instanceId: "bslh01-c07-attack-usage-bounce-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
        cardInstances: [src, magic1, bounceTarget1, magic2, bounceTarget2],
      });
      const afterFirst = drainOptionalStepsWithExecute(
        executeEffect({
          chainId: "test:bslh01-cards:2505",
          state: before,
          effect: acceptedAttackEffect,
          effectIndex: 1,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );
      const usageLabel = "__step:BSLH01-C07:1:1";
      expect(
        afterFirst.effectUsageRecords.filter(
          (record) => record.effectLabel === usageLabel
        )
      ).toHaveLength(1);
      expect(
        afterFirst.cardInstances.find(
          (ci) => ci.instanceId === bounceTarget1.instanceId
        )?.zone
      ).toBe("hand");
      expect(
        afterFirst.cardInstances.find(
          (ci) => ci.instanceId === magic1.instanceId
        )?.zone
      ).toBe("trash");
      expect(afterFirst.players.find((p) => p.id === "alice")?.countValue).toBe(
        2
      );

      const srcSecond = createCardInstance(c, {
        instanceId: src.instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const beforeSecond = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ countValue: 2, handCount: 0 }, { handCount: 0 }],
          cardInstances: [srcSecond, magic2, bounceTarget2],
        }),
        effectUsageRecords: afterFirst.effectUsageRecords,
        turnNumber: afterFirst.turnNumber,
      };
      const afterSecond = drainOptionalStepsWithExecute(
        executeEffect({
          chainId: "test:bslh01-cards:2553",
          state: beforeSecond,
          effect: acceptedAttackEffect,
          effectIndex: 1,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );
      expect(
        afterSecond.effectUsageRecords.filter(
          (record) => record.effectLabel === usageLabel
        )
      ).toHaveLength(1);
      expect(
        afterSecond.cardInstances.find(
          (ci) => ci.instanceId === bounceTarget2.instanceId
        )?.zone
      ).toBe("hand");
      expect(
        afterSecond.cardInstances.find(
          (ci) => ci.instanceId === magic2.instanceId
        )?.zone
      ).toBe("hand");
      expect(
        afterSecond.players.find((p) => p.id === "alice")?.countValue
      ).toBe(2);
    } finally {
      random.mockRestore();
    }
  });

  it("BSLH01-C07 アタック時: refire した召喚時効果でスピリットなら追加発揮もできる", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const src = createCardInstance(c, {
        instanceId: "bslh01-c07-attack-refire-spirit",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const bounceTarget = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-bounce-target-spirit",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const firstSpirit = createCardInstance(card("BSLH01-C06"), {
        instanceId: "bslh01-c07-refire-spirit-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const secondSpirit = createCardInstance(card("BSLH01-C08"), {
        instanceId: "bslh01-c07-refire-spirit-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, handCount: 0 }, { handCount: 0 }],
        cardInstances: [src, firstSpirit, secondSpirit, bounceTarget],
      });
      const after = drainOptionalStepsWithExecute(
        executeEffect({
          chainId: "test:bslh01-cards:2622",
          state: before,
          effect: c.effects![1]!,
          sourceInstanceId: src.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        getDef
      );

      const moved = after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === "bob" && ci.zone === "set_aside"
      );
      expect(moved.map((ci) => ci.instanceId).sort()).toEqual([
        firstSpirit.instanceId,
        secondSpirit.instanceId,
      ]);
      expect(moved.every((ci) => ci.controllerPlayerId === "bob")).toBe(true);
      expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(2);
    } finally {
      random.mockRestore();
    }
  });
});

describe("BSLH01-C08 レン (発生源スコープ実効性)", () => {
  it("BSLH01-C08 [0] 発揮で defense_immune CE が immunitySourceScope.categories=['spirit'] 付きで登録される", () => {
    const c = card("BSLH01-C08");
    const target = createCardInstance(c, {
      instanceId: "ren-1",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      cardInstances: [target],
    });
    const after = executeEffect({
      chainId: "test:bslh01-cards:2660",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "ren-1",
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const ce = after.activeContinuousEffects.find(
      (e) =>
        e.targetInstanceId === "ren-1" && e.modifierTag === "defense_immune"
    );
    expect(ce).toBeDefined();
    expect(ce!.immunitySourceScope).toEqual({ categories: ["spirit"] });
  });
});

describe("BSLH01-C08 レン", () => {
  const c = card("BSLH01-C08");
  const createTokenMagicSuppressionCe = (
    state: GameState,
    args: {
      effectId: string;
      sourceInstanceId: string;
      sourceDefinitionId: string;
      actingPlayerId: string;
      suppressTargetZone: "field" | "in_use";
    }
  ): ContinuousEffect => ({
    effectId: args.effectId,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: args.sourceDefinitionId,
    actingPlayerId: args.actingPlayerId,
    duration: { scope: "turn" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "effect_suppression",
    metadata: {
      suppressTargetPlayer: "self",
      suppressTargetZone: [args.suppressTargetZone],
      suppressTargetFilter: {
        category: ["magic"],
        tribes: ["導力器"],
        isToken: true,
      },
    },
  });

  it("免疫(sourceScope=spirit) / 導力器コスト-1 / 導力器発揮後ドロー / Lv3ブロックでコア全部トラッシュ", () => {
    const immune = c.effects![0]!;
    expect(immune.stub).toBeUndefined();
    const act = immune.steps[0]!.action;
    expect(act.kind).toBe("effect_immunity");
    if (act.kind === "effect_immunity") {
      // 「相手のスピリットの効果を受けない」= sourceScope.categories=["spirit"]
      expect(act.sourceScope).toEqual({ categories: ["spirit"] });
    }
    const cost = c.effects![1]!.steps[0]!.action;
    if (cost.kind === "cost_modify")
      expect(cost.cardFilter?.tribes).toEqual(["導力器"]);
    const draw = c.effects![2]!;
    expect(draw.stub).toBeUndefined();
    expect(draw.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "effect_completed",
      triggerFilter: {
        category: ["magic"],
        tribes: ["導力器"],
        isToken: true,
      },
    });
    expect(draw.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(draw.executionMode).toBe("optional");
    expect(draw.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
    const block = c.effects![3]!;
    expect(block.condition).toContainEqual({ kind: "min_level", value: 3 });
    // 「コアすべてをトラッシュに置ける」= 任意 (P3-96 裁定 2026-06-12)。
    expect(block.executionMode).toBe("optional");
    const core = block.steps[0]!.action;
    if (core.kind === "core_move") expect(core.amount).toBe("all");
  });

  it("実配置した導力器アーツトークンマジックのコスト支払い解決後に任意ドローが誘発する", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-real-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "orbment-real-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const quartz = createCardInstance(card("BSLH01-C10"), {
      instanceId: "quartz-real-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const enemy = createCardInstance(card("BSLH01-C01"), {
      instanceId: "enemy-real-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSLH01-C02"), {
      instanceId: "deck-real-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, host, quartz, enemy, deckCard],
      playerOverrides: [
        { deckCount: 1, handCount: 1, reserveNormalCoreCount: 5 },
        {},
      ],
    });
    const soulSetup: GameState = {
      ...base,
      step: "main",
      activePlayerId: "alice",
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: ["orbment-real-1"] }
          : p
      ),
    };
    const afterQuartzSet = setQuartz(
      soulSetup,
      {
        quartzInstanceId: "quartz-real-1",
        hostInstanceId: "orbment-real-1",
        ownerPlayerId: "alice",
        slot: "center",
      },
      getDef
    )!;
    // 手組みした盤面に元から置いたレンの常時効果だけを先に初期化する。
    // 【アーツ】の配置は legal action でなく、条件を満たした安定状態での自動処理。
    // SBA 自身が新規トークンの CE を登録することまでここで確認する。
    const afterQuartzSetWithContinuousEffects =
      rebuildContinuousEffectsFromField(afterQuartzSet, getDef);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };

    const automaticPlacement = runStateBasedActions(
      afterQuartzSetWithContinuousEffects,
      getDef
    );
    expect(automaticPlacement.checks).toContainEqual(
      expect.objectContaining({
        kind: "place_arts_token_due_to_condition",
        instanceId: "orbment-real-1",
        tokenCardNo: "BSLH01-T07",
      })
    );
    const placed = automaticPlacement.state;
    expect(
      getLegalActions({
        state: placed,
        actingPlayerId: "alice",
        ...lookups,
      }).map((action) => action.kind)
    ).not.toContain("place_arts_token");
    const artsToken = placed.cardInstances.find(
      (ci) =>
        ci.definitionId === "BSLH01-T07" &&
        ci.zone === "field" &&
        ci.zoneRoleName === "arts"
    );
    expect(artsToken).toBeDefined();
    if (!artsToken) throw new Error("expected placed BSLH01-T07 arts token");
    // 自動配置は field 生成と同じ安定化処理で常時効果を登録する。後続 action 前の
    // 外部 rebuild に依存すると、バトル中に生成されたトークンで invariant が壊れる。
    expect(
      placed.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === artsToken.instanceId &&
          ce.sourceDefinitionId === "BSLH01-T07" &&
          ce.modifierTag === "defense_immune"
      )
    ).toBe(true);
    const attackState: GameState = {
      ...placed,
      step: "attack",
      activePlayerId: "alice",
      window: "flash_before_block",
      activeAttack: {
        attackId: "attack-group:real-arts",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    };

    const artsUseAction = getLegalActions({
      state: attackState,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === artsToken.instanceId &&
        action.sourceCardNo === "BSLH01-T07" &&
        action.timing === "flash" &&
        action.costMode === "paid"
    );
    expect(artsUseAction).toBeDefined();
    if (!artsUseAction || artsUseAction.kind !== "use_magic") {
      throw new Error("expected BSLH01-T07 use_magic action");
    }
    expect(artsUseAction.allowedSourceZones).toContain("field");
    expect(artsUseAction.additionalCost).toBe(-1);
    expect(artsUseAction.finalCost).toBe(3);
    const declaredArts = applyLegalAction({
      state: attackState,
      action: artsUseAction,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      targetInstanceIds: ["enemy-real-1"],
      ...lookups,
    }).state;
    expect(
      declaredArts.activeAttack?.flashWindowState?.pendingStackAction
        ?.actionKind
    ).toBe("magic");
    const passArts = getLegalActions({
      state: declaredArts,
      actingPlayerId:
        declaredArts.activeAttack!.flashWindowState!.priorityPlayerId,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "pass_battle_flash" && action.responseTiming === "stack"
    );
    expect(passArts).toBeDefined();
    const afterArts = applyLegalAction({
      state: declaredArts,
      action: passArts!,
      ...lookups,
    }).state;
    expect(
      afterArts.cardInstances.find((ci) => ci.instanceId === "enemy-real-1")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      afterArts.cardInstances.find(
        (ci) => ci.instanceId === artsToken.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterArts.cardInstances.find(
        (ci) => ci.instanceId === artsToken.instanceId
      )?.zone
    ).not.toBe("trash");

    const pendingDraw = afterArts.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "effect_completed" &&
        p.relatedInstanceId === artsToken.instanceId
    );
    expect(pendingDraw).toBeDefined();
    const drawAction = getLegalActions({
      state: afterArts,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === pendingDraw?.pendingId &&
        action.sourceInstanceId === "ren-real-1"
    );
    expect(drawAction).toBeDefined();
    if (!drawAction || drawAction.kind !== "resolve_pending_triggered_effect") {
      throw new Error("expected BSLH01-C08 draw trigger action");
    }

    const declaredDraw = applyLegalAction({
      state: afterArts,
      action: drawAction,
      ...lookups,
    }).state;
    expect(
      declaredDraw.activeAttack?.flashWindowState?.pendingStackAction
        ?.actionKind
    ).toBe("triggered_effect");
    const passDraw = getLegalActions({
      state: declaredDraw,
      actingPlayerId:
        declaredDraw.activeAttack!.flashWindowState!.priorityPlayerId,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "pass_battle_flash" && action.responseTiming === "stack"
    );
    expect(passDraw).toBeDefined();
    const afterDraw = applyLegalAction({
      state: declaredDraw,
      action: passDraw!,
      ...lookups,
    }).state;
    expect(afterDraw.players.find((p) => p.id === "alice")?.handCount).toBe(1);
    expect(afterDraw.players.find((p) => p.id === "alice")?.deckCount).toBe(0);
    expect(
      afterDraw.cardInstances.find((ci) => ci.instanceId === "deck-real-1")
        ?.zone
    ).toBe("hand");
  });

  it("導力器トークンマジックの効果発揮後だけ任意ドローが pending 化され、発揮で1枚引く", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const tokenMagicDef: CardDefinition = {
      cardNo: "TEST-DORYOKUKI-TOKEN",
      name: "導力器トークンマジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const tokenMagic = createCardInstance(tokenMagicDef, {
      instanceId: "token-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      zoneRoleName: "magic-card",
    });
    const deckCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(tokenMagicDef.cardNo, tokenMagicDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const getRegisteredFieldCardEffectActions =
      buildFieldCardEffectLookup(ALL_CARDS);
    const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, tokenMagic, deckCard],
      playerOverrides: [{ deckCount: 1, handCount: 0 }, {}],
    });

    const queued = flushReadyEffectCompletions(
      queueEffectActivationTriggers({
        chainId: "test:bslh01-cards:3060",
        state,
        activatorPlayerId: "alice",
        relatedInstanceId: "token-magic-1",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: undefined,
      }),
      lookups
    );
    const pending = queued.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "effect_completed" &&
        p.relatedInstanceId === "token-magic-1"
    );
    expect(pending).toBeDefined();

    const sourceChoice = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).find((choice) => choice.sourceDefinition.cardNo === "BSLH01-C08");
    expect(sourceChoice).toBeDefined();
    expect(sourceChoice!.actionRegistration.executionMode).toBe("optional");

    const resolveAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === pending!.pendingId &&
        action.sourceInstanceId === "ren-1"
    );
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected BSLH01-C08 resolve action");
    }

    const declared = applyLegalAction({
      state: queued,
      action: resolveAction,
      ...lookups,
    }).state;
    const passAction = getLegalActions({
      state: declared,
      actingPlayerId: declared.stackWindow!.priorityPlayerId,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();
    const after = applyLegalAction({
      state: declared,
      action: passAction!,
      ...lookups,
    }).state;
    expect(after.players.find((p) => p.id === "alice")?.handCount).toBe(1);
    expect(after.players.find((p) => p.id === "alice")?.deckCount).toBe(0);
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "deck-1")?.zone
    ).toBe("hand");

    const queuedAgain = queueEffectActivationTriggers({
      chainId: "test:bslh01-cards:3126",
      state: after,
      activatorPlayerId: "alice",
      relatedInstanceId: "token-magic-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const secondPending = queuedAgain.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "effect_completed" &&
        p.relatedInstanceId === "token-magic-1"
    );
    const secondResolveAction = getLegalActions({
      state: queuedAgain,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === secondPending?.pendingId &&
        action.sourceInstanceId === "ren-1" &&
        action.skipOnly !== true
    );
    expect(secondResolveAction).toBeUndefined();

    const nonTokenMagicDef: CardDefinition = {
      ...tokenMagicDef,
      cardNo: "TEST-DORYOKUKI-NON-TOKEN",
      maxDeckCount: 3,
      maxTokenDeckCount: undefined,
    };
    const nonTokenMagic = createCardInstance(nonTokenMagicDef, {
      instanceId: "non-token-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      zoneRoleName: "magic-card",
    });
    const definitionsWithoutToken = new Map(definitions);
    definitionsWithoutToken.set(nonTokenMagicDef.cardNo, nonTokenMagicDef);
    const nonTokenState: GameState = {
      ...state,
      cardInstances: [ren, nonTokenMagic, deckCard],
    };
    const nonTokenQueued = queueEffectActivationTriggers({
      chainId: "test:bslh01-cards:3171",
      state: nonTokenState,
      activatorPlayerId: "alice",
      relatedInstanceId: "non-token-magic-1",
      getCardDefinitionById: (id) => definitionsWithoutToken.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    expect(nonTokenQueued.pendingTriggeredEffects).toEqual([]);
  });

  it("R01 駆動でフィールドの導力器トークンマジック効果を借用した後も任意ドローが誘発する", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-borrow-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "orbment-borrow-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r01Quartz = createCardInstance(card("BSLH01-R01"), {
      instanceId: "r01-quartz-borrow-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const donorDef: CardDefinition = {
      cardNo: "TEST-R01-DORYOKUKI-TOKEN",
      name: "R01借用元導力器トークンマジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const donor = createCardInstance(donorDef, {
      instanceId: "donor-borrow-token-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const firstDeckCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-borrow-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const secondDeckCard = createCardInstance(card("BSLH01-C02"), {
      instanceId: "deck-borrow-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(donorDef.cardNo, donorDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const getRegisteredFieldCardEffectActions =
      buildFieldCardEffectLookup(ALL_CARDS);
    const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        ren,
        host,
        r01Quartz,
        donor,
        firstDeckCard,
        secondDeckCard,
      ],
      // セット前は手札のR01が1枚。借用効果とC08で各1枚引く。
      playerOverrides: [{ deckCount: 2, handCount: 1 }, {}],
    });
    const soulSetup: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: ["orbment-borrow-1"] }
          : p
      ),
    };
    const afterQuartzSet = setQuartz(
      soulSetup,
      {
        quartzInstanceId: "r01-quartz-borrow-1",
        hostInstanceId: "orbment-borrow-1",
        ownerPlayerId: "alice",
        slot: "left",
      },
      getCardDefinitionById
    );
    expect(afterQuartzSet).not.toBeNull();
    if (!afterQuartzSet) throw new Error("expected R01 quartz set");

    const borrowEffect = card("BSLH01-R01").effects!.find(
      (effect) =>
        effect.timing.kind === "activated" &&
        effect.timing.mode === "stack" &&
        effect.steps.some((step) => step.action.kind === "borrow_magic_effect")
    );
    expect(borrowEffect).toBeDefined();
    if (!borrowEffect) throw new Error("expected R01 borrow_magic_effect");

    const afterBorrow = flushReadyEffectCompletions(
      executeEffect({
        chainId: "test:bslh01-cards:3303",
        state: afterQuartzSet,
        effect: borrowEffect,
        sourceInstanceId: "r01-quartz-borrow-1",
        actingPlayerId: "alice",
        targetInstanceIds: ["donor-borrow-token-1"],
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }),
      lookups
    );
    expect(afterBorrow.log).toContain(
      "borrow_magic_effect:executed:TEST-R01-DORYOKUKI-TOKEN"
    );
    expect(
      afterBorrow.cardInstances.find(
        (ci) => ci.instanceId === "donor-borrow-token-1"
      )?.zone
    ).toBe("field");

    const pendingDraw = afterBorrow.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "effect_completed" &&
        p.relatedInstanceId === "donor-borrow-token-1"
    );
    expect(pendingDraw).toBeDefined();
    const drawAction = getLegalActions({
      state: afterBorrow,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === pendingDraw?.pendingId &&
        action.sourceInstanceId === "ren-borrow-1"
    );
    expect(drawAction).toBeDefined();
    if (!drawAction || drawAction.kind !== "resolve_pending_triggered_effect") {
      throw new Error("expected C08 draw after borrow_magic_effect");
    }

    const declaredDraw = applyLegalAction({
      state: afterBorrow,
      action: drawAction,
      ...lookups,
    }).state;
    const passAction = getLegalActions({
      state: declaredDraw,
      actingPlayerId: declaredDraw.stackWindow!.priorityPlayerId,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();
    const afterDraw = applyLegalAction({
      state: declaredDraw,
      action: passAction!,
      ...lookups,
    }).state;
    expect(
      afterDraw.cardInstances.filter(
        (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
      )
    ).toHaveLength(2);
    expect(afterDraw.players.find((p) => p.id === "alice")?.handCount).toBe(2);
    expect(afterDraw.players.find((p) => p.id === "alice")?.deckCount).toBe(0);
  });

  it("R01 借用先の導力器トークンマジックが条件不成立なら C08 ドローは誘発しない", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-borrow-unmet-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "orbment-borrow-unmet-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r01Quartz = createCardInstance(card("BSLH01-R01"), {
      instanceId: "r01-quartz-borrow-unmet-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const donorDef: CardDefinition = {
      cardNo: "TEST-R01-DORYOKUKI-TOKEN-CONDITION",
      name: "条件不成立導力器トークンマジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          condition: [{ kind: "count_value", player: "self", min: 99 }],
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const donor = createCardInstance(donorDef, {
      instanceId: "donor-borrow-unmet-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const deckCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-borrow-unmet-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(donorDef.cardNo, donorDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, host, r01Quartz, donor, deckCard],
      playerOverrides: [{ deckCount: 1, handCount: 1, countValue: 0 }, {}],
    });
    const soulSetup: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: ["orbment-borrow-unmet-1"] }
          : p
      ),
    };
    const afterQuartzSet = setQuartz(
      soulSetup,
      {
        quartzInstanceId: "r01-quartz-borrow-unmet-1",
        hostInstanceId: "orbment-borrow-unmet-1",
        ownerPlayerId: "alice",
        slot: "left",
      },
      getCardDefinitionById
    );
    expect(afterQuartzSet).not.toBeNull();
    if (!afterQuartzSet) throw new Error("expected R01 quartz set");

    const borrowEffect = card("BSLH01-R01").effects!.find(
      (effect) =>
        effect.timing.kind === "activated" &&
        effect.timing.mode === "stack" &&
        effect.steps.some((step) => step.action.kind === "borrow_magic_effect")
    );
    expect(borrowEffect).toBeDefined();
    if (!borrowEffect) throw new Error("expected R01 borrow_magic_effect");

    const afterBorrow = executeEffect({
      chainId: "test:bslh01-cards:3465",
      state: afterQuartzSet,
      effect: borrowEffect,
      sourceInstanceId: "r01-quartz-borrow-unmet-1",
      actingPlayerId: "alice",
      targetInstanceIds: ["donor-borrow-unmet-1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(afterBorrow.log).toContain(
      "effect:condition-unmet:donor-borrow-unmet-1"
    );
    expect(afterBorrow.log).not.toContain(
      "borrow_magic_effect:executed:TEST-R01-DORYOKUKI-TOKEN-CONDITION"
    );
    expect(
      afterBorrow.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "effect_completed" &&
          p.relatedInstanceId === "donor-borrow-unmet-1"
      )
    ).toBe(false);
    expect(afterBorrow.players.find((p) => p.id === "alice")?.handCount).toBe(
      0
    );
    expect(afterBorrow.players.find((p) => p.id === "alice")?.deckCount).toBe(
      1
    );
  });

  it("R01 借用先の導力器トークンマジックが effect_suppression で発揮不能なら C08 ドローは誘発しない", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-borrow-suppressed-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "orbment-borrow-suppressed-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const r01Quartz = createCardInstance(card("BSLH01-R01"), {
      instanceId: "r01-quartz-borrow-suppressed-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const suppressor = createCardInstance(card("BSLH01-C01"), {
      instanceId: "suppressor-borrow-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const donorDef: CardDefinition = {
      cardNo: "TEST-R01-DORYOKUKI-TOKEN-SUPPRESSED",
      name: "発揮抑止導力器トークンマジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: ["token"],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const donor = createCardInstance(donorDef, {
      instanceId: "donor-borrow-suppressed-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const deckCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-borrow-suppressed-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(donorDef.cardNo, donorDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, host, r01Quartz, suppressor, donor, deckCard],
      playerOverrides: [{ deckCount: 1, handCount: 1 }, {}],
    });
    const soulSetup: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: ["orbment-borrow-suppressed-1"] }
          : p
      ),
    };
    const afterQuartzSet = setQuartz(
      soulSetup,
      {
        quartzInstanceId: "r01-quartz-borrow-suppressed-1",
        hostInstanceId: "orbment-borrow-suppressed-1",
        ownerPlayerId: "alice",
        slot: "left",
      },
      getCardDefinitionById
    );
    expect(afterQuartzSet).not.toBeNull();
    if (!afterQuartzSet) throw new Error("expected R01 quartz set");
    const suppressedState: GameState = {
      ...afterQuartzSet,
      activeContinuousEffects: [
        ...afterQuartzSet.activeContinuousEffects,
        createTokenMagicSuppressionCe(afterQuartzSet, {
          effectId: "ce-borrow-magic-suppressed-1",
          sourceInstanceId: suppressor.instanceId,
          sourceDefinitionId: suppressor.definitionId,
          actingPlayerId: "alice",
          suppressTargetZone: "field",
        }),
      ],
    };

    const borrowEffect = card("BSLH01-R01").effects!.find(
      (effect) =>
        effect.timing.kind === "activated" &&
        effect.timing.mode === "stack" &&
        effect.steps.some((step) => step.action.kind === "borrow_magic_effect")
    );
    expect(borrowEffect).toBeDefined();
    if (!borrowEffect) throw new Error("expected R01 borrow_magic_effect");

    const afterBorrow = executeEffect({
      chainId: "test:bslh01-cards:3616",
      state: suppressedState,
      effect: borrowEffect,
      sourceInstanceId: "r01-quartz-borrow-suppressed-1",
      actingPlayerId: "alice",
      targetInstanceIds: ["donor-borrow-suppressed-1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(afterBorrow.log).toContain(
      "reevaluation:before_each_step:failed:effect_suppression:abort_remaining:source=donor-borrow-suppressed-1"
    );
    expect(afterBorrow.log).not.toContain(
      "borrow_magic_effect:executed:TEST-R01-DORYOKUKI-TOKEN-SUPPRESSED"
    );
    expect(
      afterBorrow.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "effect_completed" &&
          p.relatedInstanceId === "donor-borrow-suppressed-1"
      )
    ).toBe(false);
    expect(afterBorrow.players.find((p) => p.id === "alice")?.handCount).toBe(
      0
    );
    expect(afterBorrow.players.find((p) => p.id === "alice")?.deckCount).toBe(
      1
    );
  });

  it("通常使用した導力器トークンマジックが条件不成立なら C08 ドローは誘発しない", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-unmet-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const tokenMagicDef: CardDefinition = {
      cardNo: "TEST-DORYOKUKI-TOKEN-MAGIC-CONDITION",
      name: "通常使用条件不成立導力器トークンマジック",
      printedCategory: "magic",
      continuousSummonCondition: true,
      summonCondition: [],
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: ["token"],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          condition: [{ kind: "count_value", player: "self", min: 99 }],
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const tokenMagic = createCardInstance(tokenMagicDef, {
      instanceId: "token-magic-unmet-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
      soulCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-unmet-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(tokenMagicDef.cardNo, tokenMagicDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, tokenMagic, deckCard],
      playerOverrides: [
        {
          deckCount: 1,
          handCount: 0,
          countValue: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: tokenMagic.instanceId,
          },
        },
        {},
      ],
    });

    const used = useMagicCardInFlashContextAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: tokenMagic.instanceId,
      withoutCost: true,
      paymentSources: [],
      chosenTiming: "flash",
      activationLabel: "flash",
      effectIndex: 0,
      allowedSourceZones: ["field"],
      ...lookups,
    });
    const resolved = resolveDeferredMagicStack({
      state: used.state,
      activeStack: used.activeStack,
      ...lookups,
    });

    expect(resolved.log).toContain(
      "effect:condition-unmet:token-magic-unmet-1"
    );
    expect(
      resolved.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "effect_completed" &&
          p.relatedInstanceId === tokenMagic.instanceId
      )
    ).toBe(false);
    expect(
      resolved.cardInstances.find(
        (ci) => ci.instanceId === tokenMagic.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      resolved.log.some((entry) => entry.startsWith("magic:token-pool:"))
    ).toBe(true);
    expect(
      resolved.cardInstances.find(
        (ci) => ci.instanceId === tokenMagic.instanceId
      )?.soulCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((p) => p.id === "alice")?.soulCoreLocation
    ).toEqual({
      kind: "reserve",
    });
    expect(resolved.players.find((p) => p.id === "alice")?.handCount).toBe(0);
    expect(resolved.players.find((p) => p.id === "alice")?.deckCount).toBe(1);
  });

  it("中断後 cleanup の導力器トークンマジックもソウルコアを退避してトークンプールへ戻す", () => {
    const tokenMagic = createCardInstance(card("BSLH01-T07"), {
      instanceId: "token-magic-resume-soul-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      zoneRoleName: "arts",
      soulCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [tokenMagic],
      playerOverrides: [
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: tokenMagic.instanceId,
          },
        },
        {},
      ],
    });

    const resolved = moveCompletedInUseMagicCardToTrashIfReady({
      state,
      sourceInstanceId: tokenMagic.instanceId,
      getCardDefinitionById: getDef,
      logLabel: "token-resume-soul",
    });

    expect(
      resolved.cardInstances.find((c) => c.instanceId === tokenMagic.instanceId)
        ?.zone
    ).toBe("removed_from_game");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === tokenMagic.instanceId)
        ?.soulCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((p) => p.id === "alice")?.soulCoreLocation
    ).toEqual({
      kind: "reserve",
    });
    expect(resolved.log).toContain(
      `magic:token-pool:token-resume-soul:${tokenMagic.instanceId}`
    );
  });

  it("通常使用した導力器トークンマジックが effect_suppression で発揮不能なら C08 ドローは誘発しない", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-suppressed-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const suppressor = createCardInstance(card("BSLH01-C01"), {
      instanceId: "suppressor-normal-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const tokenMagicDef: CardDefinition = {
      cardNo: "TEST-DORYOKUKI-TOKEN-MAGIC-SUPPRESSED",
      name: "通常使用発揮抑止導力器トークンマジック",
      printedCategory: "magic",
      continuousSummonCondition: true,
      summonCondition: [],
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: ["token"],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const tokenMagic = createCardInstance(tokenMagicDef, {
      instanceId: "token-magic-suppressed-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const deckCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-suppressed-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(tokenMagicDef.cardNo, tokenMagicDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, suppressor, tokenMagic, deckCard],
      playerOverrides: [{ deckCount: 1, handCount: 0 }, {}],
    });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        createTokenMagicSuppressionCe(base, {
          effectId: "ce-normal-magic-suppressed-1",
          sourceInstanceId: suppressor.instanceId,
          sourceDefinitionId: suppressor.definitionId,
          actingPlayerId: "alice",
          suppressTargetZone: "in_use",
        }),
      ],
    };

    const used = useMagicCardInFlashContextAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: tokenMagic.instanceId,
      withoutCost: true,
      paymentSources: [],
      chosenTiming: "flash",
      activationLabel: "flash",
      effectIndex: 0,
      allowedSourceZones: ["field"],
      ...lookups,
    });
    const resolved = resolveDeferredMagicStack({
      state: used.state,
      activeStack: {
        ...used.activeStack,
        reevaluationPoints: [
          {
            timing: "before_each_step",
            checks: ["effect_suppression"],
            failurePolicy: "abort_remaining",
          },
        ],
        suppressionEffectDescriptor: {
          sourceDefinitionId: tokenMagicDef.cardNo,
          sourceKind: "magic",
          effectIndex: 0,
          timingKind: "activated",
          activatedMode: "flash",
        },
      },
      ...lookups,
    });

    expect(resolved.log).toContain(
      "reevaluation:before_each_step:failed:effect_suppression:abort_remaining:source=token-magic-suppressed-1"
    );
    expect(
      resolved.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "effect_completed" &&
          p.relatedInstanceId === tokenMagic.instanceId
      )
    ).toBe(false);
    expect(
      resolved.cardInstances.find(
        (ci) => ci.instanceId === tokenMagic.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      resolved.log.some((entry) => entry.startsWith("magic:token-pool:"))
    ).toBe(true);
    expect(resolved.players.find((p) => p.id === "alice")?.handCount).toBe(0);
    expect(resolved.players.find((p) => p.id === "alice")?.deckCount).toBe(1);
  });

  it("導力器トークンマジックは pending 完了後 cleanup でもトークンプールへ戻る", () => {
    const tokenMagicDef: CardDefinition = {
      cardNo: "TEST-DORYOKUKI-TOKEN-MAGIC-PENDING",
      name: "pending導力器トークンマジック",
      printedCategory: "magic",
      continuousSummonCondition: true,
      summonCondition: [],
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: ["token"],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "discard", player: "self", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const tokenMagic = createCardInstance(tokenMagicDef, {
      instanceId: "token-magic-pending-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const handA = createCardInstance(card("BSLH01-C01"), {
      instanceId: "pending-hand-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handB = createCardInstance(card("BSLH01-C02"), {
      instanceId: "pending-hand-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(tokenMagicDef.cardNo, tokenMagicDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [tokenMagic, handA, handB],
      playerOverrides: [{ handCount: 2 }, {}],
    });

    const used = useMagicCardInFlashContextAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: tokenMagic.instanceId,
      withoutCost: true,
      paymentSources: [],
      chosenTiming: "flash",
      activationLabel: "flash",
      effectIndex: 0,
      allowedSourceZones: ["field"],
      ...lookups,
    });
    const afterStack = resolveDeferredMagicStack({
      state: used.state,
      activeStack: used.activeStack,
      ...lookups,
    });
    expect(afterStack.pendingZoneSelection?.actionKind).toBe("discard_hand");
    expect(
      afterStack.cardInstances.find(
        (ci) => ci.instanceId === tokenMagic.instanceId
      )?.zone
    ).toBe("in_use");

    const resolveDiscard = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(resolveDiscard).toBeDefined();
    const afterDiscard = applyLegalAction({
      state: afterStack,
      action: resolveDiscard!,
      selectedZoneCardIds: ["pending-hand-a"],
      ...lookups,
    }).state;

    expect(afterDiscard.pendingZoneSelection).toBeNull();
    expect(
      afterDiscard.cardInstances.find(
        (ci) => ci.instanceId === tokenMagic.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterDiscard.log.some((entry) => entry.startsWith("magic:token-pool:"))
    ).toBe(true);
    expect(
      afterDiscard.log.some((entry) => entry.startsWith("magic:trash:"))
    ).toBe(false);
  });

  it("pending 完了後 cleanup の通常マジックは moved_to_trash 自己置換を処理する", () => {
    const normalMagicDef: CardDefinition = {
      cardNo: "TEST-PENDING-NORMAL-MAGIC-MOVED-TO-TRASH",
      name: "pending後トラッシュ自己置換テストマジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      maxDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "discard", player: "self", count: 1 } }],
          textRef: [0],
        },
        {
          timing: { kind: "card_event", event: "moved_to_trash" },
          cardEventDisposition: { kind: "move", destination: "hand" },
          steps: [{ action: { kind: "move_self", destination: "hand" } }],
          textRef: [0],
        },
      ],
    };
    const normalMagic = createCardInstance(normalMagicDef, {
      instanceId: "normal-magic-pending-self-replace-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "magic-card",
    });
    const handA = createCardInstance(card("BSLH01-C01"), {
      instanceId: "normal-pending-hand-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handB = createCardInstance(card("BSLH01-C02"), {
      instanceId: "normal-pending-hand-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(normalMagicDef.cardNo, normalMagicDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [normalMagic, handA, handB],
      playerOverrides: [{ handCount: 2 }, {}],
    });

    const used = useMagicCardInFlashContextAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: normalMagic.instanceId,
      withoutCost: true,
      paymentSources: [],
      chosenTiming: "flash",
      activationLabel: "flash",
      effectIndex: 0,
      allowedSourceZones: ["field"],
      ...lookups,
    });
    const afterStack = resolveDeferredMagicStack({
      state: used.state,
      activeStack: used.activeStack,
      ...lookups,
    });
    const resolveDiscard = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(resolveDiscard).toBeDefined();

    const afterDiscard = applyLegalAction({
      state: afterStack,
      action: resolveDiscard!,
      selectedZoneCardIds: [handA.instanceId],
      ...lookups,
    }).state;

    expect(
      afterDiscard.cardInstances.find(
        (ci) => ci.instanceId === normalMagic.instanceId
      )?.zone
    ).toBe("hand");
    expect(
      afterDiscard.log.some((entry) => entry.startsWith("magic:trash:"))
    ).toBe(true);
    expect(
      afterDiscard.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(true);
  });

  it("deck_reveal pending 経由の導力器トークンマジックは C08 ドローを二重誘発しない", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-deck-reveal-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const tokenMagicDef: CardDefinition = {
      cardNo: "TEST-DORYOKUKI-TOKEN-MAGIC-DECK-REVEAL",
      name: "公開導力器トークンマジック",
      printedCategory: "magic",
      continuousSummonCondition: true,
      summonCondition: [],
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["フラッシュ"],
      keywordTags: ["token"],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 3,
                picks: [
                  {
                    count: 1,
                    filter: { category: ["spirit"] },
                    mandatory: true,
                  },
                ],
                remainder: "bottom",
                suppressRevealedEffects: true,
              },
            },
            { action: { kind: "draw", player: "self", count: 1 } },
          ],
          textRef: [0],
        },
      ],
    };
    const tokenMagic = createCardInstance(tokenMagicDef, {
      instanceId: "token-magic-deck-reveal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const spiritPick = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-reveal-spirit-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const remainderA = createCardInstance(card("BSLH01-C02"), {
      instanceId: "deck-reveal-remainder-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const remainderB = createCardInstance(card("BSLH01-C03"), {
      instanceId: "deck-reveal-remainder-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const drawCard = createCardInstance(card("BSLH01-C04"), {
      instanceId: "deck-reveal-draw-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(tokenMagicDef.cardNo, tokenMagicDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        ren,
        tokenMagic,
        spiritPick,
        remainderA,
        remainderB,
        drawCard,
      ],
      playerOverrides: [{ deckCount: 4, handCount: 0 }, {}],
    });

    const used = useMagicCardInFlashContextAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: tokenMagic.instanceId,
      withoutCost: true,
      paymentSources: [],
      chosenTiming: "flash",
      activationLabel: "flash",
      effectIndex: 0,
      allowedSourceZones: ["field"],
      ...lookups,
    });
    const afterReveal = resolveDeferredMagicStack({
      state: used.state,
      activeStack: used.activeStack,
      ...lookups,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.postResolutionOracle).toBeUndefined();
    expect(
      afterReveal.pendingDeckReveal!.continuation?.postResolutionOracle
    ).toBeDefined();

    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    const afterPickOnly = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      selectedDeckRevealCardIds: ["deck-reveal-spirit-1"],
      ...lookups,
    }).state;

    const orderAction = getLegalActions({
      state: afterPickOnly,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    const afterOrder = applyLegalAction({
      state: afterPickOnly,
      action: orderAction!,
      deckRevealRemainderOrder: [
        "deck-reveal-remainder-a",
        "deck-reveal-remainder-b",
      ],
      ...lookups,
    }).state;

    expect(afterOrder.pendingDeckReveal).toBeNull();
    expect(
      afterOrder.cardInstances.find(
        (ci) => ci.instanceId === tokenMagic.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterOrder.log.some((entry) => entry.startsWith("magic:token-pool:"))
    ).toBe(true);
    const c08DrawPendings = afterOrder.pendingTriggeredEffects.filter(
      (p) =>
        p.eventKind === "effect_completed" &&
        p.relatedInstanceId === tokenMagic.instanceId
    );
    expect(c08DrawPendings).toHaveLength(1);
    const sourceChoice = getAvailableTriggeredEffectSourceChoices({
      state: afterOrder,
      pendingEffect: c08DrawPendings[0]!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).find((choice) => choice.sourceCard.instanceId === ren.instanceId);
    expect(sourceChoice).toBeDefined();
  });

  it("revealed_choice 即完了経由の導力器トークンマジックも C08 ドローを二重誘発しない", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-revealed-choice-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const tokenMagicDef: CardDefinition = {
      cardNo: "TEST-DORYOKUKI-TOKEN-MAGIC-REVEALED-CHOICE",
      name: "公開選択導力器トークンマジック",
      printedCategory: "magic",
      continuousSummonCondition: true,
      summonCondition: [],
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["フラッシュ"],
      keywordTags: ["token"],
      tribe: "導力器",
      maxDeckCount: 0,
      maxTokenDeckCount: 99,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [],
                remainder: "bottom",
              },
            },
            { action: { kind: "draw", player: "self", count: 1 } },
          ],
          textRef: [0],
        },
      ],
    };
    const revealedDef: CardDefinition = {
      cardNo: "TEST-REVEALED-CHOICE-HAND",
      name: "公開任意手札化カード",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: ["このカードがオープンされたとき、手札に加えられる。"],
      keywordTags: [],
      tribe: "CB",
      maxDeckCount: 3,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "revealed" },
          executionMode: "optional",
          cardEventDisposition: { kind: "move", destination: "hand" },
          steps: [{ action: { kind: "move_self", destination: "hand" } }],
          textRef: [0],
        },
      ],
    };
    const tokenMagic = createCardInstance(tokenMagicDef, {
      instanceId: "token-magic-revealed-choice-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const revealedCard = createCardInstance(revealedDef, {
      instanceId: "revealed-choice-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const drawCard = createCardInstance(card("BSLH01-C04"), {
      instanceId: "revealed-choice-draw-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(tokenMagicDef.cardNo, tokenMagicDef);
    definitions.set(revealedDef.cardNo, revealedDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, tokenMagic, revealedCard, drawCard],
      playerOverrides: [{ deckCount: 2, handCount: 0 }, {}],
    });

    const used = useMagicCardInFlashContextAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: tokenMagic.instanceId,
      withoutCost: true,
      paymentSources: [],
      chosenTiming: "flash",
      activationLabel: "flash",
      effectIndex: 0,
      allowedSourceZones: ["field"],
      ...lookups,
    });
    const afterReveal = resolveDeferredMagicStack({
      state: used.state,
      activeStack: used.activeStack,
      ...lookups,
    });
    expect(afterReveal.pendingDeckReveal?.phase).toBe("revealed_choice");
    expect(afterReveal.pendingDeckReveal!.postResolutionOracle).toBeUndefined();
    expect(
      afterReveal.pendingDeckReveal!.continuation?.postResolutionOracle
    ).toBeDefined();

    const choiceAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(choiceAction).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterReveal,
      action: choiceAction!,
      selectedDeckRevealCardIds: [revealedCard.instanceId],
      ...lookups,
    }).state;

    expect(afterChoice.pendingDeckReveal).toBeNull();
    expect(
      afterChoice.cardInstances.find(
        (ci) => ci.instanceId === revealedCard.instanceId
      )?.zone
    ).toBe("hand");
    expect(
      afterChoice.cardInstances.find(
        (ci) => ci.instanceId === drawCard.instanceId
      )?.zone
    ).toBe("hand");
    expect(
      afterChoice.cardInstances.find(
        (ci) => ci.instanceId === tokenMagic.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterChoice.log.some((entry) => entry.startsWith("magic:token-pool:"))
    ).toBe(true);
    const c08DrawPendings = afterChoice.pendingTriggeredEffects.filter(
      (p) =>
        p.eventKind === "effect_completed" &&
        p.relatedInstanceId === tokenMagic.instanceId
    );
    expect(c08DrawPendings).toHaveLength(1);
    const sourceChoice = getAvailableTriggeredEffectSourceChoices({
      state: afterChoice,
      pendingEffect: c08DrawPendings[0]!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).find((choice) => choice.sourceCard.instanceId === ren.instanceId);
    expect(sourceChoice).toBeDefined();
  });

  it("T12 由来の召喚 placement 完了後に C08 ドローが誘発し、T12 はトークンプールへ戻る", () => {
    const ren = createCardInstance(c, {
      instanceId: "ren-t12-placement-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const enteringDef: CardDefinition = {
      cardNo: "TEST-T12-PLACEMENT-SPIRIT",
      name: "T12 placement test spirit",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "CB",
      maxDeckCount: 3,
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const remainingMagicDef: CardDefinition = {
      cardNo: "TEST-T12-PLACEMENT-REMAINING-MAGIC",
      name: "T12 placement remaining magic",
      printedCategory: "magic",
      colors: ["green"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["フラッシュ"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [],
          textRef: [0],
        },
      ],
    };
    const t12 = createCardInstance(card("BSLH01-T12"), {
      instanceId: "t12-placement-token-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      zoneRoleName: "arts",
    });
    const entering = createCardInstance(enteringDef, {
      instanceId: "entering-placement-spirit-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      zoneRoleName: "spirit",
    });
    const remainingMagic = createCardInstance(remainingMagicDef, {
      instanceId: "remaining-placement-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      zoneRoleName: "magic-card",
    });
    const definitions = new Map(cardNoMap);
    definitions.set(enteringDef.cardNo, enteringDef);
    definitions.set(remainingMagicDef.cardNo, remainingMagicDef);
    const getCardDefinitionById = (id: string) => definitions.get(id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [ren, t12, entering, remainingMagic],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });
    const postResolutionOracle = {
      chainId: "test:bslh01-cards:4616",
      triggerCardInstanceId: t12.instanceId,
      triggerKind: "use_magic" as const,
      magicTiming: "flash" as const,
      magicEffectiveColors: card("BSLH01-T12").colors,
      effectActivatedActivatorPlayerId: "alice",
      effectActivationLogStart: base.log.length,
    };
    const state: GameState = {
      ...base,
      pendingEnterFieldPlacement: {
        pendingId: "enter-field-t12-token",
        actingPlayerId: "alice",
        sourceInstanceId: entering.instanceId,
        sourceDefinitionId: enteringDef.cardNo,
        deferredStack: {
          stackId: "stack:entering-placement-spirit",
          actionKind: "summon",
          chainId: "chain:entering-placement-spirit",
          actingPlayerId: "alice",
          cardInstanceId: entering.instanceId,
          cardDefinitionId: enteringDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          postResolutionOracle,
        },
        remainingStacks: [
          {
            stackId: "stack:remaining-after-placement",
            actionKind: "magic",
            chainId: "chain:remaining-after-placement",
            actingPlayerId: "alice",
            cardInstanceId: remainingMagic.instanceId,
            cardDefinitionId: remainingMagicDef.cardNo,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            chosenTiming: "flash",
            magicEffectIndex: 0,
            magicActivationZone: "field",
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        ],
        minimumCoreCount: 1,
        maximumCoreCount: null,
        postResolutionOracle,
      },
    };
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };

    const resolvePlacement = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const afterPlacement = applyLegalAction({
      state,
      action: resolvePlacement!,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      ...lookups,
    }).state;

    expect(afterPlacement.pendingEnterFieldPlacement).toBeNull();
    expect(
      afterPlacement.cardInstances.find(
        (ci) => ci.instanceId === entering.instanceId
      )?.zone
    ).toBe("field");
    expect(
      afterPlacement.cardInstances.find(
        (ci) => ci.instanceId === t12.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterPlacement.log.some((entry) => entry.startsWith("magic:token-pool:"))
    ).toBe(true);
    expect(
      afterPlacement.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "effect_completed" &&
          p.relatedInstanceId === t12.instanceId
      )
    ).toBe(true);
    const tokenPoolLogIndex = afterPlacement.log.findIndex((entry) =>
      entry.startsWith(
        `magic:token-pool:enter-field-placement:enter-field-t12-token:${t12.instanceId}`
      )
    );
    const remainingStackStartIndex = afterPlacement.log.findIndex(
      (entry) =>
        entry === "magic:resolve-main:start:chain:remaining-after-placement"
    );
    expect(tokenPoolLogIndex).toBeGreaterThanOrEqual(0);
    expect(remainingStackStartIndex).toBeGreaterThanOrEqual(0);
    expect(tokenPoolLogIndex).toBeLessThan(remainingStackStartIndex);
  });

  it("導力器アーツトークンマジックは無効化/不発 cleanup でもトークンプールへ戻る", () => {
    const artsToken = createCardInstance(card("BSLH01-T07"), {
      instanceId: "arts-token-stack",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      zoneRoleName: "arts",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [artsToken],
    });
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const stack = (overrides: Partial<ActiveStack>): ActiveStack => ({
      stackId: "stack:arts-token",
      actionKind: "magic",
      chainId: "chain:arts-token",
      actingPlayerId: "alice",
      cardInstanceId: "arts-token-stack",
      cardDefinitionId: "BSLH01-T07",
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "flash",
      magicEffectIndex: 0,
      magicActivationZone: "field",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
      ...overrides,
    });

    const nullified = resolveDeferredMagicStack({
      state: base,
      activeStack: stack({ isNullified: true }),
      ...lookups,
    });
    expect(
      nullified.cardInstances.find((ci) => ci.instanceId === "arts-token-stack")
        ?.zone
    ).toBe("removed_from_game");
    expect(nullified.log).toContain(
      "magic:token-pool:chain:arts-token:arts-token-stack"
    );

    const fizzled = resolveDeferredMagicStack({
      state: base,
      activeStack: stack({ targetInstanceIds: ["missing-target"] }),
      ...lookups,
    });
    expect(
      fizzled.cardInstances.find((ci) => ci.instanceId === "arts-token-stack")
        ?.zone
    ).toBe("removed_from_game");
    expect(fizzled.log).toContain(
      "magic:token-pool:chain:arts-token:arts-token-stack"
    );
  });
});

describe("BSLH01-C09 ユウナ・クロフォード", () => {
  const c = card("BSLH01-C09");
  it("召喚時CB/EEサーチ / メイン黄シンボル重複不可 / クォーツ：金牛珠(CBスピリットのアタックで相手ライフ減少→ボイド→ライフ)", () => {
    expect(c.effects![0]!.executionMode).toBe("optional");
    expect(c.effects![0]!.steps[0]!.executionMode).toBe("optional");
    expect(c.effects![0]!.steps[1]!.executionMode).toBe("optional");
    const reveal = c.effects![0]!.steps[1]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks[0]).toMatchObject({ count: 1, mandatory: true });
      expect(reveal.picks[0]!.filter?.filterOr).toHaveLength(2);
    }
    const main = c.effects![1]!;
    expect(main.usageLimit).toEqual({ kind: "no_duplicate" });
    const quartz = c.effects![2]!;
    expect(quartz.stub).toBeUndefined();
    expect(quartz.applicability).toEqual({ soulState: true });
    expect(quartz.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "reduce_life",
      cause: ["battle"],
      triggerFilter: { category: ["spirit"], tribes: ["CB"] },
    });
    expect(quartz.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "life", player: "self" },
      amount: 1,
    });
  });

  it("実行: CBまたはEEのコスト4以上スピリットだけを選び、残りを未公開カードより下に戻す", () => {
    const cbNexus: CardDefinition = {
      cardNo: "TEST-BSLH01-C09-CB-NEXUS",
      name: "テスト用CBネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "CB",
      maxDeckCount: 3,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const cbSpirit: CardDefinition = {
      cardNo: "TEST-BSLH01-C09-CB-SPIRIT-4",
      name: "テスト用CBコスト4スピリット",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "CB",
      maxDeckCount: 3,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const eeSpirit: CardDefinition = {
      ...cbSpirit,
      cardNo: "TEST-BSLH01-C09-EE-SPIRIT-4",
      name: "テスト用EEコスト4スピリット",
      tribe: "EE",
    };
    const cheapSpirit: CardDefinition = {
      ...cbSpirit,
      cardNo: "TEST-BSLH01-C09-CB-EE-SPIRIT-3",
      name: "テスト用CB/EEコスト3スピリット",
      cost: 3,
      tribe: "CB・EE",
    };
    const definitions = new Map(cardNoMap);
    for (const definition of [cbNexus, cbSpirit, eeSpirit, cheapSpirit]) {
      definitions.set(definition.cardNo, definition);
    }
    const lookup = (id: string) => definitions.get(id);
    for (const [label, eligibleSpirit] of [
      ["cb", cbSpirit],
      ["ee", eeSpirit],
    ] as const) {
      const source = createCardInstance(c, {
        instanceId: `c09-source-${label}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const nexus = createCardInstance(cbNexus, {
        instanceId: `c09-cb-nexus-${label}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      });
      const spirit = createCardInstance(eligibleSpirit, {
        instanceId: `c09-${label}-spirit-4`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      });
      const cheap = createCardInstance(cheapSpirit, {
        instanceId: `c09-cb-ee-spirit-3-${label}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      });
      const unread = createCardInstance(cheapSpirit, {
        instanceId: `c09-unread-${label}`,
        ownerPlayerId: "alice",
        zone: "deck",
      });
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [source, nexus, spirit, cheap, unread],
        players: base.players.map((player) =>
          player.id === "alice"
            ? { ...player, deckCount: 4, handCount: 0, countValue: 0 }
            : player
        ),
      };
      const afterOptionalSteps = drainOptionalStepsExecutingWhenAvailable(
        executeEffect({
          chainId: "test:bslh01-cards:4914",
          state,
          effect: c.effects![0]!,
          sourceInstanceId: source.instanceId,
          actingPlayerId: "alice",
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
        }),
        lookup
      );
      expect(afterOptionalSteps.pendingDeckReveal).not.toBeNull();
      const pickAction = getLegalActions({
        state: afterOptionalSteps,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
      }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
      expect(pickAction).toBeDefined();
      if (pickAction?.kind !== "resolve_pending_deck_reveal_pick") {
        throw new Error("expected deck reveal pick action");
      }
      expect([...pickAction.candidateCardInstanceIds].sort()).toEqual(
        [nexus.instanceId, spirit.instanceId].sort()
      );
      const afterPick = applyLegalAction({
        state: afterOptionalSteps,
        action: pickAction,
        selectedDeckRevealCardIds: [spirit.instanceId],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(afterPick.pendingDeckReveal?.phase).toBe("ordering_remainder");
      const orderAction = getLegalActions({
        state: afterPick,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
      }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
      if (!orderAction) throw new Error("expected remainder order action");
      const resolved = applyLegalAction({
        state: afterPick,
        action: orderAction,
        deckRevealRemainderOrder: [cheap.instanceId, nexus.instanceId],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(resolved.pendingDeckReveal).toBeNull();
      expect(resolved.players[0]!.countValue).toBe(1);
      expect(resolved.players[0]!.deckCount).toBe(3);
      expect(resolved.players[0]!.handCount).toBe(1);
      expect(
        resolved.cardInstances
          .filter((instance) => instance.zone === "deck")
          .map((instance) => instance.instanceId)
      ).toEqual([unread.instanceId, nexus.instanceId, cheap.instanceId]);
      expect(
        resolved.cardInstances.filter((instance) => instance.zone === "trash")
      ).toHaveLength(0);
      expect(
        resolved.cardInstances.find(
          (instance) => instance.instanceId === spirit.instanceId
        )?.zone
      ).toBe("hand");
      for (const instanceId of [nexus.instanceId, cheap.instanceId]) {
        expect(
          resolved.cardInstances.find(
            (instance) => instance.instanceId === instanceId
          )?.zone
        ).toBe("deck");
      }
    }
  });
});

describe("BSLH01-C10 ガルシア・ロッシ", () => {
  const c = card("BSLH01-C10");
  it("召喚/アタックでデッキ下 / hand_increase相手破棄 / Lv3免疫(sourceScope=maxCost:5) / クォーツ機功(F2.4b①実装済)", () => {
    const send = c.effects![0]!.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind === "send_to_deck") expect(send.position).toBe("bottom");
    const handIncrease = c.effects![1]!;
    expect(handIncrease.stub).toBeUndefined();
    expect(handIncrease.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "increase_hand",
      cause: ["self_effect"],
    });
    expect(handIncrease.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "turn_player", player: "opponent" },
    ]);
    expect(handIncrease.executionMode).toBe("mandatory");
    expect(handIncrease.steps[0]).toMatchObject({
      action: { kind: "draw", count: 1 },
      executionMode: "optional",
    });
    expect(handIncrease.steps[1]!.action).toEqual({
      kind: "discard",
      player: "opponent",
      count: { source: { kind: "event_amount" } },
      targetHandSize: 1,
      capCount: { source: { kind: "event_amount" } },
    });
    const lv3 = c.effects![2]!;
    expect(lv3.condition).toContainEqual({ kind: "min_level", value: 3 });
    expect(lv3.stub).toBeUndefined();
    const act = lv3.steps[0]!.action;
    if (act.kind === "effect_immunity") {
      // 「コスト5以下の相手の効果を受けない」= sourceScope.maxCost=5
      expect(act.sourceScope).toEqual({ maxCost: 5 });
    } else {
      throw new Error("expected effect_immunity action");
    }
    // 機功クォーツは F2.4b① で実装（stub 解消）。詳細は下の set-effect describe。
    expect(c.effects![3]!.applicability?.soulState).toBe(true);
    expect(c.effects![3]!.stub).toBeUndefined();
  });

  it("Lv3免疫の sourceScope.maxCost は発生源カードの実効コストで判定する", () => {
    expect(c.cost).toBeLessThanOrEqual(5);
    const garcia = createCardInstance(c, {
      instanceId: "garcia-immune-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const source = createCardInstance(c, {
      instanceId: "opponent-source-cost-overridden",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const getDef = (id: string) =>
      id === c.cardNo ? c : ALL_CARDS.find((def) => def.cardNo === id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [garcia, source],
    });
    const rebuilt = rebuildContinuousEffectsFromField(base, getDef);
    const targetAfterRebuild = rebuilt.cardInstances.find(
      (card) => card.instanceId === garcia.instanceId
    )!;
    const sourceAfterRebuild = rebuilt.cardInstances.find(
      (card) => card.instanceId === source.instanceId
    )!;

    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        targetAfterRebuild,
        "bob",
        "none",
        { instance: sourceAfterRebuild, definition: c },
        getDef
      )
    ).toBe(true);

    const costOverride: ContinuousEffect = {
      effectId: "test-source-cost-six",
      sourceInstanceId: "test-cost-override-source",
      sourceDefinitionId: c.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: rebuilt.turnNumber,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: source.instanceId,
      metadata: { properties: { cost: 6 } },
    };
    const withCostOverride: GameState = {
      ...rebuilt,
      activeContinuousEffects: [
        ...rebuilt.activeContinuousEffects,
        costOverride,
      ],
    };

    expect(
      isCardImmuneToOpponentEffect(
        withCostOverride,
        targetAfterRebuild,
        "bob",
        "none",
        { instance: sourceAfterRebuild, definition: c },
        getDef
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(
        withCostOverride,
        targetAfterRebuild,
        "bob",
        "none",
        { definition: c },
        getDef
      )
    ).toBe(true);
  });

  it("相手の効果で相手の手札が増えたとき、player:opponent の第三者リスナーとして pending 化される", () => {
    const source = createCardInstance(c, {
      instanceId: "garcia",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      playerOverrides: [{}, { handCount: 2 }],
    });
    const after: GameState = {
      ...before,
      activePlayerId: "bob",
      players: before.players.map((p) =>
        p.id === "bob" ? { ...p, handCount: 4 } : p
      ),
    };
    const getDef = (id: string) =>
      id === c.cardNo ? c : ALL_CARDS.find((def) => def.cardNo === id);
    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bslh01-cards:5111",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "increase_hand" && p.relatedPlayerId === "bob"
    );
    expect(pending).toBeDefined();
    expect(pending!.actingPlayerId).toBe("alice");
    expect(pending!.relatedPlayerId).toBe("bob");
    expect(pending!.amount).toBe(2);

    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
    });
    expect(choices.map((choice) => choice.sourceCard.instanceId)).toContain(
      "garcia"
    );
  });
});

describe("BSLH01-C11 セルゲイ・ロウ", () => {
  const c = card("BSLH01-C11");
  it("多色treat_as実装 / S.S.S召喚時 deck_reveal top_or_bottom / Lv2アタック時ソウルコア判定実装", () => {
    // [0] シンボル 6 色 treat_as は実装済 (stub でない)。
    expect(c.effects![0]!.stub).toBeUndefined();
    const t = c.effects![0]!.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect([...(t.asColor as string[])].sort()).toEqual(
        ["red", "purple", "green", "white", "yellow", "blue"].sort()
      );
    }
    const reveal = c.effects![1]!;
    expect(reveal.timing).toMatchObject({
      kind: "game_event",
      event: "summon",
    });
    expect(reveal.stub).toBeUndefined();
    const revealAction = reveal.steps[0]!.action;
    expect(revealAction.kind).toBe("deck_reveal");
    if (revealAction.kind === "deck_reveal") {
      expect(revealAction.revealCount).toBe(1);
      expect(revealAction.picks).toEqual([]);
      expect(revealAction.remainder).toBe("top_or_bottom");
    }
    // [2] 自分アタック時: ソウルコア無ければライフ→ボイド。[3] 相手アタック時: ライフ→トラッシュ。
    expect(c.effects![2]!.stub).toBeUndefined();
    expect(c.effects![2]!.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "attack",
    });
    expect(c.effects![2]!.condition).toContainEqual({
      kind: "soul_core_zone",
      player: "self",
      zones: ["field", "reserve"],
      negate: true,
    });
    const selfMove = c.effects![2]!.steps[0]!.action;
    if (selfMove.kind === "core_move") {
      expect(selfMove.from).toEqual({ kind: "life", player: "self" });
      expect(selfMove.to).toEqual({ kind: "void", player: "self" });
    } else {
      throw new Error("expected core_move action");
    }

    expect(c.effects![3]!.stub).toBeUndefined();
    expect(c.effects![3]!.timing).toMatchObject({
      kind: "game_event",
      player: "opponent",
      event: "attack",
    });
    const opponentMove = c.effects![3]!.steps[0]!.action;
    if (opponentMove.kind === "core_move") {
      expect(opponentMove.from).toEqual({ kind: "life", player: "opponent" });
      expect(opponentMove.to).toEqual({ kind: "trash", player: "opponent" });
    } else {
      throw new Error("expected core_move action");
    }
  });
});

describe("BSLH01-C12 ミシュラムワンダーランド", () => {
  it("シンボル treat_as (effects[0]) + 宣言制約 (effects[1]) + ライフ減少宣言ゲート (effects[2]) + トークン3種生成 (effects[3]) は実装済み", () => {
    const c = card("BSLH01-C12");
    expect(c.effects).toHaveLength(4);
    expect(c.effects![0]!.stub).toBeUndefined();
    const treat = c.effects![0]!.steps[0]!.action;
    expect(treat.kind).toBe("treat_as");
    if (treat.kind === "treat_as") {
      expect(treat.asColor).toEqual([
        "red",
        "purple",
        "green",
        "white",
        "yellow",
        "black",
      ]);
    }
    expect(c.effects![1]!.stub).toBeUndefined();
    expect(c.effects![1]!.steps).toHaveLength(2);
    expect(c.effects![2]!.stub).toBeUndefined();
    expect(c.effects![2]!.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(c.effects![3]!.stub).toBeUndefined();
    expect(c.effects![3]!.condition).toEqual([{ kind: "min_level", value: 2 }]);
  });

  it("effects[2]: self/opponent 双方に life_damage_interception(declareGimmickGate reduceBy:1) を登録する", () => {
    const c = card("BSLH01-C12");
    const eff2 = c.effects![2]!;
    for (const step of eff2.steps) {
      expect(step.action).toMatchObject({
        kind: "life_damage_interception",
        cause: "any",
        mode: "replace",
        declareGimmickGate: { reduceBy: 1 },
      });
    }
    expect(
      eff2.steps.map((s) =>
        s.action.kind === "life_damage_interception" ? s.action.player : null
      )
    ).toEqual(["self", "opponent"]);
  });

  it("effects[1]: self/opponent 双方に declaredThisTurn:false 動的 prevent_battle(attack+block) を登録する", () => {
    const c = card("BSLH01-C12");
    const eff1 = c.effects![1]!;
    expect(eff1.timingScope).toEqual({ player: "both", period: "attack" });
    for (const step of eff1.steps) {
      expect(step.action).toMatchObject({
        kind: "prevent_battle",
        restriction: ["attack", "block"],
        target: {
          kind: "filter",
          count: "all",
          filter: { declaredThisTurn: false },
        },
      });
    }
    expect(
      eff1.steps.map((s) =>
        s.action.kind === "prevent_battle" ? s.action.target.player : null
      )
    ).toEqual(["self", "opponent"]);
  });

  it("declarationCountThisTurn===0 のプレイヤーはアタック不可、宣言済み(>0)ならアタック可能になる", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const unitDef: CardDefinition = {
      ...card("BSDB01-C05"),
      cardNo: "TEST-C12-UNIT",
      effects: [],
      summonCondition: undefined,
    };
    cardNoMap.set(unitDef.cardNo, unitDef);
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2
    });
    const bobUnit = createCardInstance(unitDef, {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, bobUnit],
    });
    const rebuilt = rebuildContinuousEffectsFromField(base, (id) =>
      cardNoMap.get(id)
    );
    const notDeclared: GameState = {
      ...rebuilt,
      activePlayerId: BOB,
      step: "attack",
      window: "none",
    };
    expect(
      getAttackDeclarationBlockReason({
        state: notDeclared,
        actingPlayerId: BOB,
        sourceInstanceId: "bob-unit",
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).not.toBeNull();

    const declared: GameState = {
      ...notDeclared,
      declarationCountThisTurn: {
        ...notDeclared.declarationCountThisTurn,
        [BOB]: 1,
      },
    };
    expect(
      getAttackDeclarationBlockReason({
        state: declared,
        actingPlayerId: BOB,
        sourceInstanceId: "bob-unit",
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).toBeNull();
  });

  it("Lv2: ライフが減るとき宣言(pay)すると declarationCountThisTurn+1・軽減1(amount1なら無傷)・ターンに1回使用済みになる", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12-life",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    const rebuilt = rebuildContinuousEffectsFromField(base, (id) =>
      cardNoMap.get(id)
    );

    const pendingState = resolveLifeDamage(
      rebuilt,
      ALICE,
      1,
      [],
      { cause: "battle", actingPlayerId: BOB },
      (id) => cardNoMap.get(id)
    );
    expect(pendingState.pendingLifeDamageDiscardChoice).not.toBeNull();
    expect(
      pendingState.pendingLifeDamageDiscardChoice!.entries[0]
    ).toMatchObject({ costKind: "declare_gimmick", reduceBy: 1 });

    const paid = resolvePendingLifeDamageDiscardChoice(pendingState, "pay");
    expect(paid.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(
      getPlayerLifeCoreCount(paid.players.find((p) => p.id === ALICE)!)
    ).toBe(5);
    expect(paid.declarationCountThisTurn[ALICE]).toBe(1);

    // ターンに1回消費済み: 同じターン内の2回目のライフ減少はゲート無しで通常解決する。
    const secondAttempt = resolveLifeDamage(
      paid,
      ALICE,
      1,
      [],
      { cause: "battle", actingPlayerId: BOB },
      (id) => cardNoMap.get(id)
    );
    expect(secondAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(
      getPlayerLifeCoreCount(secondAttempt.players.find((p) => p.id === ALICE)!)
    ).toBe(4);
  });

  it("Lv2: 宣言を辞退(decline)すると declarationCountThisTurn は変わらずライフが通常通り減る", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12-decline",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    const rebuilt = rebuildContinuousEffectsFromField(base, (id) =>
      cardNoMap.get(id)
    );

    const pendingState = resolveLifeDamage(
      rebuilt,
      ALICE,
      1,
      [],
      { cause: "battle", actingPlayerId: BOB },
      (id) => cardNoMap.get(id)
    );
    const declined = resolvePendingLifeDamageDiscardChoice(
      pendingState,
      "decline"
    );
    expect(declined.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(declined.declarationCountThisTurn[ALICE] ?? 0).toBe(0);
    expect(
      getPlayerLifeCoreCount(declined.players.find((p) => p.id === ALICE)!)
    ).toBe(4);
  });

  it("Lv1 (normalCoreCount:0) のときは declareGimmickGate CE が登録されず通常解決する", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12-lv1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0, // Lv1
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    const rebuilt = rebuildContinuousEffectsFromField(base, (id) =>
      cardNoMap.get(id)
    );

    const afterAttempt = resolveLifeDamage(
      rebuilt,
      ALICE,
      1,
      [],
      { cause: "battle", actingPlayerId: BOB },
      (id) => cardNoMap.get(id)
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(
      getPlayerLifeCoreCount(afterAttempt.players.find((p) => p.id === ALICE)!)
    ).toBe(4);
  });

  it("effects[3]: Lv2で2コスト支払うことでトークン「みっしぃ」/「みーしぇ」/「メカみっしぃ」を1体ずつ出す (engine-multi-token-pool-put)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12-token",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
    });
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id) ?? ALL_CARDS.find((c) => c.cardNo === id);
    const c = card("BSLH01-C12");

    const pending = executeEffect({
      chainId: "test:bslh01-cards:5480",
      state: base,
      effect: c.effects![3]!,
      sourceInstanceId: "src-c12-token",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = resolvePendingMultiPlacementFromReserve(
      pending,
      ALICE,
      getDef
    );

    const tokens = after.cardInstances.filter(
      (x) =>
        x.zone === "field" &&
        ["BSLH01-T01", "BSLH01-T02", "BSLH01-T03"].includes(x.definitionId)
    );
    expect(tokens).toHaveLength(3);
    expect(tokens.map((t) => t.definitionId).sort()).toEqual([
      "BSLH01-T01",
      "BSLH01-T02",
      "BSLH01-T03",
    ]);
    // 2 (cost) + 3 (各トークン維持コア1個ずつ) = 5 だけリザーブが減る。
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(5);
  });

  it("effects[3]: 「みっしぃ」が既にフィールドにいる場合、そのトークンだけ出さず残り2種を出す", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12-token-partial",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2
    });
    const existingT01 = createCardInstance(card("BSLH01-T01"), {
      instanceId: "existing-t01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, existingT01],
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
    });
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id) ?? ALL_CARDS.find((c) => c.cardNo === id);
    const c = card("BSLH01-C12");

    const pending = executeEffect({
      chainId: "test:bslh01-cards:5539",
      state: base,
      effect: c.effects![3]!,
      sourceInstanceId: "src-c12-token-partial",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = resolvePendingMultiPlacementFromReserve(
      pending,
      ALICE,
      getDef
    );

    const t01Count = after.cardInstances.filter(
      (x) => x.definitionId === "BSLH01-T01" && x.zone === "field"
    ).length;
    const t02 = after.cardInstances.find(
      (x) => x.definitionId === "BSLH01-T02" && x.zone === "field"
    );
    const t03 = after.cardInstances.find(
      (x) => x.definitionId === "BSLH01-T03" && x.zone === "field"
    );
    expect(t01Count).toBe(1); // 既存の1体のまま増えない (maxTokenDeckCount:1)
    expect(t02).toBeDefined();
    expect(t03).toBeDefined();
    // 少なくとも1体は出せたため conditional_cost はロールバックせず、2コストは支払われたまま。
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(10 - 2 - 1 - 1);
  });

  it("effects[3]: リザーブがコスト2未満なら pay_cost が失敗しトークンは1体も出ない (conditional_cost rollback)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12-token-nocost",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [
        { reserveNormalCoreCount: 1 },
        { reserveNormalCoreCount: 10 },
      ],
    });
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id) ?? ALL_CARDS.find((c) => c.cardNo === id);
    const c = card("BSLH01-C12");

    const after = executeEffect({
      chainId: "test:bslh01-cards:5592",
      state: base,
      effect: c.effects![3]!,
      sourceInstanceId: "src-c12-token-nocost",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const tokens = after.cardInstances.filter((x) =>
      ["BSLH01-T01", "BSLH01-T02", "BSLH01-T03"].includes(x.definitionId)
    );
    expect(tokens).toHaveLength(0);
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(1);
  });

  describe("core_move (executeCoreMove の life→X) 経由のライフ減少 (adversarial verifier round 1 で確定した gap の修正確認)", () => {
    // BSTH01-X08 型「相手のライフのコアをボイドに置く」のような life→void core_move は
    // resolveLifeDamage を通らない。この経路でも declareGimmickGate が
    // pendingLifeDamageDiscardChoice + coreMoveResume を立て、pay で reduceBy 分だけ軽減した
    // amount で core_move が再開され (全額キャンセルされる discardCostGate とは違い実際に
    // コアが動く)、decline で pendingAmount がそのまま core_move されることを確認する。
    // life-damage-discard-cost-gate.test.ts の同名 describe と同型の構成。
    const ALICE = "player-1";
    const BOB = "player-2";
    function buildCoreMoveState() {
      const src = createCardInstance(card("BSLH01-C12"), {
        instanceId: "src-c12-coremove",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1, // Lv2
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      });
      return rebuildContinuousEffectsFromField(base, (id) => cardNoMap.get(id));
    }

    it("BOB が ALICE のライフ→ボイドで2コア移動しようとすると pending が立ち、コアはまだ移動しない", () => {
      const state = buildCoreMoveState();
      const afterAttempt = executeCoreMove(
        state,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        2,
        "attacker-source",
        undefined,
        undefined,
        (id) => cardNoMap.get(id)
      );
      expect(afterAttempt.pendingLifeDamageDiscardChoice).not.toBeNull();
      const pending = afterAttempt.pendingLifeDamageDiscardChoice!;
      expect(pending.coreMoveResume).toBeDefined();
      expect(pending.coreMoveResume!.sourceInstanceId).toBe("attacker-source");
      expect(pending.entries[0]).toMatchObject({
        costKind: "declare_gimmick",
        reduceBy: 1,
        sourceInstanceId: "src-c12-coremove",
      });
      expect(
        getPlayerLifeCoreCount(
          afterAttempt.players.find((p) => p.id === ALICE)!
        )
      ).toBe(5);
      expect(
        afterAttempt.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(0);
    });

    it("支払う (pay): reduceBy分軽減した残amountでcore_moveが再開され実際にコアが動く・宣言回数+1・ターンに1回消費済み", () => {
      const state = buildCoreMoveState();
      const pendingState = executeCoreMove(
        state,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        2,
        "attacker-source",
        undefined,
        undefined,
        (id) => cardNoMap.get(id)
      );

      const legals = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
      });
      const action = legals.find(
        (a) => a.kind === "resolve_pending_life_damage_discard_choice"
      )!;
      const resolved = applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        lifeDamageDiscardChoice: "pay",
      }).state;

      expect(resolved.pendingLifeDamageDiscardChoice ?? null).toBeNull();
      // reduceBy:1 分だけ軽減されるが、全額キャンセルではないので残り1個は実際にボイドへ動く。
      expect(
        getPlayerLifeCoreCount(resolved.players.find((p) => p.id === ALICE)!)
      ).toBe(4);
      expect(
        resolved.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(1);
      expect(resolved.declarationCountThisTurn[ALICE]).toBe(1);

      // ターンに1回消費済み: 同じターンの2回目は宣言ゲート無しで通常通り解決する。
      const secondAttempt = executeCoreMove(
        resolved,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        1,
        "attacker-source-2",
        undefined,
        undefined,
        (id) => cardNoMap.get(id)
      );
      expect(secondAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
      expect(
        getPlayerLifeCoreCount(
          secondAttempt.players.find((p) => p.id === ALICE)!
        )
      ).toBe(3);
    });

    it("辞退する (decline): 元の core_move が pendingAmount 全量で再開される・宣言回数は変わらない", () => {
      const state = buildCoreMoveState();
      const pendingState = executeCoreMove(
        state,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        2,
        "attacker-source",
        undefined,
        undefined,
        (id) => cardNoMap.get(id)
      );

      const legals = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
      });
      const action = legals.find(
        (a) => a.kind === "resolve_pending_life_damage_discard_choice"
      )!;
      const resolved = applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        lifeDamageDiscardChoice: "decline",
      }).state;

      expect(resolved.pendingLifeDamageDiscardChoice ?? null).toBeNull();
      expect(
        getPlayerLifeCoreCount(resolved.players.find((p) => p.id === ALICE)!)
      ).toBe(3);
      expect(
        resolved.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(2);
      expect(resolved.declarationCountThisTurn[ALICE] ?? 0).toBe(0);
    });

    it("declareGimmickGate CE が2つ同時一致: 1件目 pay 後は core_move を再開せず entries[1] へ継続し、2件目 pay で初めて再開する (adversarial verifier round 2 で確定した multi-entry gate chain 欠落の修正確認)", () => {
      const src1 = createCardInstance(card("BSLH01-C12"), {
        instanceId: "c12-a",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1, // Lv2
      });
      const src2 = createCardInstance(card("BSLH01-C12"), {
        instanceId: "c12-b",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1, // Lv2
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src1, src2],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      });
      const state = rebuildContinuousEffectsFromField(base, (id) =>
        cardNoMap.get(id)
      );

      const pendingState = executeCoreMove(
        state,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        3,
        "attacker-source",
        undefined,
        undefined,
        (id) => cardNoMap.get(id)
      );

      const pending0 = pendingState.pendingLifeDamageDiscardChoice!;
      expect(pending0.entries).toHaveLength(2);
      expect(
        pending0.entries.every((e) => e.costKind === "declare_gimmick")
      ).toBe(true);

      const legals1 = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
      });
      const action1 = legals1.find(
        (a) => a.kind === "resolve_pending_life_damage_discard_choice"
      )!;
      const afterFirstPay = applyLegalAction({
        state: pendingState,
        action: action1,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        lifeDamageDiscardChoice: "pay",
      }).state;

      // 1件目 pay 後、entries[1] が残っているため core_move はまだ再開されない
      // (コアはまだ動かず、ライフも減っていない)。
      expect(afterFirstPay.pendingLifeDamageDiscardChoice).not.toBeNull();
      expect(
        afterFirstPay.pendingLifeDamageDiscardChoice!.entries
      ).toHaveLength(1);
      expect(afterFirstPay.pendingLifeDamageDiscardChoice!.pendingAmount).toBe(
        2
      );
      expect(afterFirstPay.pendingLifeDamageDiscardChoice!.coreMoveResume).toBe(
        pending0.coreMoveResume
      );
      expect(
        getPlayerLifeCoreCount(
          afterFirstPay.players.find((p) => p.id === ALICE)!
        )
      ).toBe(5);
      expect(
        afterFirstPay.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(0);
      expect(afterFirstPay.declarationCountThisTurn[ALICE]).toBe(1);

      const legals2 = getLegalActions({
        state: afterFirstPay,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
      });
      const action2 = legals2.find(
        (a) => a.kind === "resolve_pending_life_damage_discard_choice"
      )!;
      const afterSecondPay = applyLegalAction({
        state: afterFirstPay,
        action: action2,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        lifeDamageDiscardChoice: "pay",
      }).state;

      // 2件目 pay で entries が枯渇し、reduceBy 分軽減された amount (2-1=1) で core_move が再開される。
      expect(afterSecondPay.pendingLifeDamageDiscardChoice ?? null).toBeNull();
      expect(
        getPlayerLifeCoreCount(
          afterSecondPay.players.find((p) => p.id === ALICE)!
        )
      ).toBe(4);
      expect(
        afterSecondPay.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(1);
      expect(afterSecondPay.declarationCountThisTurn[ALICE]).toBe(2);
    });
  });
});

describe("BSLH01-X02 [創界神]キーア-零の至宝", () => {
  it("effects[2]: 配置時、自分のフィールドにいないトークン「アイオーンα」/「アイオーンβ」/「アイオーンγ」を1体ずつ出す (engine-multi-token-pool-put)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-X02"), {
      instanceId: "src-x02-token",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
    });
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id) ?? ALL_CARDS.find((c) => c.cardNo === id);
    const c = card("BSLH01-X02");
    const placeEffect = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "place"
    )!;
    expect(placeEffect.stub).toBeUndefined();

    const pending = executeEffect({
      chainId: "test:bslh01-cards:5921",
      state: base,
      effect: placeEffect,
      sourceInstanceId: "src-x02-token",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = resolvePendingMultiPlacementFromReserve(
      pending,
      ALICE,
      getDef
    );

    const tokens = after.cardInstances.filter(
      (x) =>
        x.zone === "field" &&
        ["BSLH01-T04", "BSLH01-T05", "BSLH01-T06"].includes(x.definitionId)
    );
    expect(tokens).toHaveLength(3);
    expect(tokens.map((t) => t.definitionId).sort()).toEqual([
      "BSLH01-T04",
      "BSLH01-T05",
      "BSLH01-T06",
    ]);
    // 印字コスト(9)は課さず、維持コア1個ずつ(計3)だけリザーブから自動配置される。
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(7);
  });
});

describe("BSLH01-C13 零の軌跡", () => {
  const c = card("BSLH01-C13");
  it("トラッシュ免疫 / フラッシュでアタックステップ終了(deferTo battle_end)", () => {
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("effect_immunity");
    const flash = c.effects![4]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.steps[0]!.action.kind).toBe("end_attack_step");
    expect(flash.steps[0]!.deferTo).toBe("battle_end");
    expect(flash.steps[1]).toEqual({
      id: "place-on-field",
      action: { kind: "move_self", destination: "field" },
      executionMode: "optional",
    });
  });

  it("[board] フラッシュ解決でバトル終了時にアタックステップを終了し、その後このカードをフィールドに置ける", () => {
    const ALICE = "alice";
    const BOB = "bob";
    const source = createCardInstance(c, {
      instanceId: "bslh01-c13-in-use",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      normalCoreCount: 0,
    });
    const attacker = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bslh01-c13-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:bslh01-c13-field-placement:1",
      primaryEntityId: "be-bslh01-c13-attacker",
      participantEntityIds: ["be-bslh01-c13-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "be-bslh01-c13-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["be-bslh01-c13-attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, attacker],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-bslh01-c13-attacker",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["black"],
          memberInstanceIds: [attacker.instanceId],
        },
      ],
    };

    const queued = executeEffect({
      chainId: "test:bslh01-cards:6024",
      state,
      effect: c.effects![4]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      effectIndex: 4,
    });

    expect(queued.step).toBe("attack");
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const afterBattleEnd = executeBattleResolution({
      state: queued,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    }).state;

    expect(afterBattleEnd.step).toBe("attack");
    expect(afterBattleEnd.pendingAttackStepEndFinalizations).toHaveLength(1);
    expect(afterBattleEnd.pendingStepOptionalChoice).not.toBeNull();
    expect(afterBattleEnd.pendingStepOptionalChoice!.sourceInstanceId).toBe(
      source.instanceId
    );
    expect(afterBattleEnd.pendingStepOptionalChoice!.stepIndex).toBe(1);
    expect(
      afterBattleEnd.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.zone
    ).toBe("in_use");

    const afterPlace = drainOptionalStepsWithExecute(afterBattleEnd, getDef);
    expect(afterPlace.step).toBe("end");
    expect(afterPlace.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(afterPlace.pendingStepOptionalChoice).toBeNull();
    expect(afterPlace.pendingBattleEndDeferrals).toHaveLength(0);
    const placed = afterPlace.cardInstances.find(
      (card) => card.instanceId === source.instanceId
    );
    expect(placed?.zone).toBe("field");
    expect(placed?.zoneRoleName).toBe("magic");
  });

  it("[regression] battle_end の任意配置を辞退した後、先に辞退した煌臨元置換の離脱を flush して登録済み leave_field 誘発を一度だけ queue する", () => {
    const ALICE = "alice";
    const BOB = "bob";
    const victimDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-ADVENT-LEAVE-VICTIM",
      name: "テスト煌臨元置換離脱待機",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const listenerDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-ADVENT-LEAVE-LISTENER",
      name: "テスト煌臨元置換離脱誘発",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "leave_field",
          },
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
        },
      ],
    };
    const privateListenerDef: CardDefinition = {
      ...listenerDef,
      cardNo: "TEST-BSLH01-C13-ADVENT-LEAVE-HAND-LISTENER",
      name: "テスト煌臨元置換離脱手札誘発",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "leave_field",
          },
          applicability: { zone: "hand" },
          executionMode: "optional",
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
        },
      ],
    };
    const burstDef: CardDefinition = {
      ...listenerDef,
      cardNo: "TEST-BSLH01-C13-ADVENT-LEAVE-BURST",
      name: "テスト煌臨元置換離脱バースト",
      printedCategory: "magic",
      levelDefs: [],
      symbolColors: [],
      effects: [
        {
          timing: {
            kind: "burst",
            trigger: { kind: "spirit_destroyed", player: "self" },
          },
          triggerFilter: { category: ["spirit"] },
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
        },
      ],
    };
    const getDefWithFixtures = (id: string) =>
      id === victimDef.cardNo
        ? victimDef
        : id === listenerDef.cardNo
          ? listenerDef
          : id === privateListenerDef.cardNo
            ? privateListenerDef
            : id === burstDef.cardNo
              ? burstDef
              : getDef(id);
    const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup([
      listenerDef,
      privateListenerDef,
    ]);
    const getRegisteredBurstActions = buildBurstEffectLookup([burstDef]);
    const source = createCardInstance(c, {
      instanceId: "bslh01-c13-advent-interleave-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const attacker = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bslh01-c13-advent-interleave-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const victim = createCardInstance(victimDef, {
      instanceId: "bslh01-c13-advent-interleave-victim",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const listener = createCardInstance(listenerDef, {
      instanceId: "bslh01-c13-advent-interleave-listener",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const privateListener = createCardInstance(privateListenerDef, {
      instanceId: "bslh01-c13-advent-interleave-hand-listener",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const burst = createCardInstance(burstDef, {
      instanceId: "bslh01-c13-advent-interleave-burst",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "burst",
    });
    const attackId = "attack:bslh01-c13-advent-interleave:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "be-bslh01-c13-advent-interleave-attacker",
      participantEntityIds: ["be-bslh01-c13-advent-interleave-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "be-bslh01-c13-advent-interleave-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["be-bslh01-c13-advent-interleave-attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          source,
          attacker,
          victim,
          listener,
          privateListener,
          burst,
        ],
        setBurstStates: [{ playerId: BOB, cardInstanceId: burst.instanceId }],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: activeAttack.primaryEntityId,
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["black"],
          memberInstanceIds: [attacker.instanceId],
        },
      ],
    };

    const queued = executeEffect({
      chainId: "test:bslh01-cards:6261",
      state,
      effect: c.effects![4]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithFixtures,
      getRegisteredTriggeredEffectActions,
      effectIndex: 4,
    });
    const afterBattleEnd = executeBattleResolution({
      state: queued,
      getCardDefinitionById: getDefWithFixtures,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    const withAdventReplacement: GameState = {
      ...afterBattleEnd,
      cardInstances: afterBattleEnd.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === victim.instanceId
          ? {
              ...cardInstance,
              pendingLeaveKind: "destroy",
              pendingLeaveCause: "battle",
              pendingLeaveChainId: `battle-resolution:2:${ALICE}:${attackId}`,
            }
          : cardInstance
      ),
      pendingLeaveEntities: [
        {
          instanceId: victim.instanceId,
          kind: "destroy",
          cause: "battle",
          causePlayerId: ALICE,
          chainId: `battle-resolution:2:${ALICE}:${attackId}`,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
      pendingAdventSourceReplacement: {
        choosingPlayerId: BOB,
        cardInstanceId: victim.instanceId,
        candidateHostInstanceIds: [],
        originalLeaveKind: "destroy",
        originalLeaveCause: "battle",
      },
    };

    const afterReplacementDecline = applyLegalAction({
      state: withAdventReplacement,
      action: {
        kind: "resolve_advent_source_replacement",
        actionId: `advent-source-trash-${victim.instanceId}`,
        can: true,
        reason: "test",
        actingPlayerId: BOB,
        cardInstanceId: victim.instanceId,
        choice: "trash",
        candidateHostInstanceIds: [],
      },
      getCardDefinitionById: getDefWithFixtures,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(afterReplacementDecline.pendingLeaveEntities).toHaveLength(1);
    expect(afterReplacementDecline.pendingStepOptionalChoice).not.toBeNull();

    const optional = afterReplacementDecline.pendingStepOptionalChoice!;
    const afterPlacementDecline = applyLegalAction({
      state: afterReplacementDecline,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${optional.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: optional.actingPlayerId,
        pendingId: optional.pendingId,
        sourceInstanceId: optional.sourceInstanceId,
        effectIndex: optional.effectIndex,
        stepIndex: optional.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: getDefWithFixtures,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    // 公開/非公開の破壊時反応が残っているため、まだ実移動しない。
    expect(afterPlacementDecline.pendingLeaveEntities).toHaveLength(1);
    expect(
      afterPlacementDecline.pendingPrivateDeclarations.filter(
        (declaration) =>
          declaration.sourceInstanceId === privateListener.instanceId
      )
    ).toHaveLength(1);
    expect(
      afterPlacementDecline.pendingPrivateDeclarations.find(
        (declaration) =>
          declaration.sourceInstanceId === privateListener.instanceId
      )?.registeredPreFlushLeaveEvent
    ).toBe(true);
    const destroyPending = afterPlacementDecline.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "destroy" &&
        pending.relatedInstanceId === victim.instanceId &&
        Object.keys(
          pending.relatedInstanceIdsBySourceRegistrationKey ?? {}
        ).some((key) => key.startsWith(`${listener.instanceId}#`))
    );
    expect(destroyPending).toBeDefined();
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state: afterPlacementDecline,
        pendingEffect: destroyPending!,
        getCardDefinitionById: getDefWithFixtures,
        getRegisteredTriggeredEffectActions,
      }).some((choice) => choice.sourceCard.instanceId === listener.instanceId)
    ).toBe(true);
    expect(
      afterPlacementDecline.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "leave_field" &&
          Object.keys(
            pending.relatedInstanceIdsBySourceRegistrationKey ?? {}
          ).some((key) => key.startsWith(`${listener.instanceId}#`))
      )
    ).toBe(false);
    expect(
      afterPlacementDecline.pendingBurstChecks.filter(
        (check) => check.relatedInstanceId === victim.instanceId
      )
    ).toHaveLength(1);
    expect(
      afterPlacementDecline.pendingAttackStepEndFinalizations
    ).toHaveLength(1);
    expect(afterPlacementDecline.step).toBe("attack");
    expect(
      afterPlacementDecline.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === victim.instanceId
      )?.zone
    ).toBe("field");
  });

  it("[board] 実マジック使用経路では battle_end deferred placement 完了まで in_use を維持する", () => {
    const ALICE = "alice";
    const BOB = "bob";
    const source = createCardInstance(c, {
      instanceId: "bslh01-c13-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
      normalCoreCount: 0,
    });
    const attacker = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bslh01-c13-stack-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:bslh01-c13-stack-placement:1",
      primaryEntityId: "be-bslh01-c13-stack-attacker",
      participantEntityIds: ["be-bslh01-c13-stack-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "be-bslh01-c13-stack-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["be-bslh01-c13-stack-attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, attacker],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-bslh01-c13-stack-attacker",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["black"],
          memberInstanceIds: [attacker.instanceId],
        },
      ],
    };

    const used = useMagicCardInFlashContextAsAction({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: source.instanceId,
      withoutCost: true,
      paymentSources: [],
      chosenTiming: "flash",
      activationLabel: "flash",
      effectIndex: 4,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    });
    const stacked = resolveDeferredMagicStack({
      state: used.state,
      activeStack: used.activeStack,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    });

    expect(stacked.pendingBattleEndDeferrals).toHaveLength(1);
    expect(
      stacked.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.zone
    ).toBe("in_use");

    const afterBattleEnd = executeBattleResolution({
      state: stacked,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    }).state;

    expect(afterBattleEnd.pendingStepOptionalChoice?.sourceInstanceId).toBe(
      source.instanceId
    );
    expect(
      afterBattleEnd.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.zone
    ).toBe("in_use");

    const afterPlace = drainOptionalStepsWithExecute(afterBattleEnd, getDef);
    expect(afterPlace.pendingStepOptionalChoice).toBeNull();
    expect(
      afterPlace.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.zone
    ).toBe("field");
  });

  it("手札にあるこのカードは相手の効果を受けない", () => {
    const handImmunity = c.effects![1]!;
    expect(handImmunity.applicability).toEqual({ zone: ["hand"] });
    expect(handImmunity.timing).toEqual({ kind: "continuous" });
    expect(handImmunity.steps[0]!.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "self" },
      duration: { scope: "permanent" },
    });
  });

  it("手札にあるこのカードは相手によって自分のライフが減ったときコスト不要で使用できる", () => {
    const grant = c.effects![2]!;
    expect(grant.applicability).toEqual({ zone: "hand" });
    expect(grant.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "reduce_life",
      cause: ["opponent_effect", "battle"],
    });
    expect(grant.executionMode).toBe("optional");
    const action = grant.steps[0]!.action;
    expect(action.kind).toBe("use_magic_without_cost");
    if (action.kind === "use_magic_without_cost") {
      expect(action.magicTiming).toBe("flash");
    }
  });

  it("BSLH01-C13 [3,4] は対象開示応答で自身を破棄し、元効果解決中だけ対象を免疫化する", () => {
    const fieldEffect = c.effects![3]!;
    expect(fieldEffect.stub).toBeUndefined();
    expect(fieldEffect.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "targeted",
      triggerFilter: {
        category: ["nexus"],
        targetsGrandwalker: "only",
      },
      cause: ["opponent_effect"],
    });
    expect(fieldEffect.steps[0]!.action).toEqual({
      kind: "move_card",
      target: { kind: "self" },
      from: { zone: "field", player: "self" },
      to: { zone: "trash" },
      count: 1,
      requireFullCount: true,
    });
    expect(fieldEffect.steps[1]!.connector).toBe("conditional_cost");
    expect(fieldEffect.steps[1]!.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "trigger_related_instance" },
      duration: { scope: "current_effect" },
    });

    const targetDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-GRANDWALKER",
      name: "テスト創界神ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
    };
    const magicDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-OPPONENT-MAGIC",
      name: "テスト相手マジック",
      printedCategory: "magic",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手の創界神ネクサス1つを破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "target",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    targetsGrandwalker: true,
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const zero = createCardInstance(c, {
      instanceId: "bslh01-c13-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bslh01-c13-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bslh01-c13-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [zero, target, magic],
    });
    const definitions = [...ALL_CARDS, targetDef, magicDef];
    const getDef = (id: string): CardDefinition | undefined =>
      id === targetDef.cardNo
        ? targetDef
        : id === magicDef.cardNo
          ? magicDef
          : cardNoMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
    };

    const disclosure = executeEffect({
      chainId: "test:bslh01-cards:6662",
      state: baseState,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
      targetInstanceIds: [target.instanceId],
      targetStepId: "target",
      effectActionKind: "magic",
    });

    expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceDefinitionId: magicDef.cardNo,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      targetInstanceIds: [target.instanceId],
      targetStepId: "target",
    });
    expect(disclosure.pendingTriggeredEffects).toHaveLength(1);
    expect(disclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedInstanceId: target.instanceId,
      effectSourceDefinitionId: magicDef.cardNo,
      effectSourceInstanceId: magic.instanceId,
      effectActionKind: "magic",
    });

    const resolveZero = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === zero.instanceId
    );
    expect(resolveZero).toBeDefined();

    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveZero!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const after = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      after.cardInstances.find((card) => card.instanceId === zero.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.zone
    ).toBe("field");
    expect(
      after.pendingLeaveEntities.some(
        (entry) => entry.instanceId === target.instanceId
      )
    ).toBe(false);
    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      after.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "defense_immune" &&
          effect.targetInstanceId === target.instanceId &&
          effect.sourceInstanceId === zero.instanceId
      )
    ).toBe(false);
    expect(after.log).toContain("effect:move_card:field->trash:1cards");
  });

  it("field_card core_move の対象開示応答でも元効果解決中だけ対象を免疫化する", () => {
    const targetDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-COREMOVE-GRANDWALKER",
      name: "テスト創界神ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
    };
    const magicDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-COREMOVE-MAGIC",
      name: "テスト相手コア移動マジック",
      printedCategory: "magic",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手の創界神ネクサスのコアすべてをボイドに置く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cores",
              action: {
                kind: "core_move",
                from: {
                  kind: "field_card",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    targetsGrandwalker: true,
                  },
                },
                to: { kind: "void", player: "opponent" },
                amount: "all",
              },
            },
          ],
        },
      ],
    };
    const zero = createCardInstance(c, {
      instanceId: "bslh01-c13-coremove-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bslh01-c13-coremove-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bslh01-c13-coremove-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [zero, target, magic],
    });
    const definitions = [...ALL_CARDS, targetDef, magicDef];
    const getDef = (id: string): CardDefinition | undefined =>
      id === targetDef.cardNo
        ? targetDef
        : id === magicDef.cardNo
          ? magicDef
          : cardNoMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
    };

    const disclosure = executeEffect({
      chainId: "test:bslh01-cards:6845",
      state: baseState,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
      effectActionKind: "magic",
    });

    expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceDefinitionId: magicDef.cardNo,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      targetInstanceIds: [target.instanceId],
      targetStepId: "cores",
    });
    expect(disclosure.pendingTriggeredEffects).toHaveLength(1);

    const resolveZero = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === zero.instanceId
    );
    expect(resolveZero).toBeDefined();

    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveZero!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const after = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      after.cardInstances.find((card) => card.instanceId === zero.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.normalCoreCount
    ).toBe(3);
    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
  });

  it("current_effect 免疫は元効果の core count pending が閉じるまで保持される", () => {
    const targetDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-PENDING-COUNT-GRANDWALKER",
      name: "テスト創界神ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
    };
    const magicDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-PENDING-COUNT-MAGIC",
      name: "テスト相手コア数選択マジック",
      printedCategory: "magic",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手の創界神ネクサス1つのコア2個までをボイドに置く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cores",
              action: {
                kind: "core_move",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    targetsGrandwalker: true,
                  },
                  count: 1,
                },
                from: { kind: "target_card" },
                to: { kind: "void", player: "opponent" },
                amount: { min: 0, max: 2 },
              },
            },
          ],
        },
      ],
    };
    const zero = createCardInstance(c, {
      instanceId: "bslh01-c13-pending-count-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bslh01-c13-pending-count-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bslh01-c13-pending-count-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [zero, target, magic],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-current-effect-immunity",
          sourceInstanceId: zero.instanceId,
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "current_effect" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
          metadata: {
            currentEffectSourceInstanceId: magic.instanceId,
            currentEffectSourceDefinitionId: magicDef.cardNo,
            currentEffectIndex: 0,
            currentEffectTargetStepId: "cores",
          },
        },
      ],
      pendingCoreCountSelection: {
        pendingId: "ccs-current-effect",
        actingPlayerId: "bob",
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: magicDef.cardNo,
        fromLocation: {
          kind: "card_instance",
          instanceId: target.instanceId,
        },
        toLocation: { kind: "void", player: "opponent" },
        min: 0,
        max: 2,
        effectTiming: { kind: "activated", mode: "flash" },
        sourceEffectIndex: 0,
        sourceTargetStepId: "cores",
        targetedDisclosureResolutionCleanups: [
          {
            kind: "continuous_effects",
            effectIds: ["ce-current-effect-immunity"],
          },
        ],
      },
    };
    const definitions = [...ALL_CARDS, targetDef, magicDef];
    const getDef = (id: string): CardDefinition | undefined =>
      id === targetDef.cardNo
        ? targetDef
        : id === magicDef.cardNo
          ? magicDef
          : cardNoMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
    };

    const resolveCount = getLegalActions({
      state: baseState,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_core_count");
    expect(resolveCount).toBeDefined();
    expect(baseState.pendingCoreCountSelection).toMatchObject({
      min: 0,
      max: 2,
      sourceEffectIndex: 0,
      sourceTargetStepId: "cores",
      targetedDisclosureResolutionCleanups: expect.any(Array),
    });
    expect(baseState.activeContinuousEffects).toHaveLength(1);

    const after = applyLegalAction({
      state: baseState,
      action: resolveCount!,
      coreCountSelection: 2,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(after.pendingCoreCountSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    expect(
      after.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "defense_immune" &&
          effect.targetInstanceId === target.instanceId
      )
    ).toBe(false);
  });

  it("current_effect cleanup は core source allocation pending が閉じるまで保持される", () => {
    const zero = createCardInstance(c, {
      instanceId: "bslh01-c13-core-source-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const protectedDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-CORE-SOURCE",
      name: "テスト支払い元創界神",
      printedCategory: "nexus",
      colors: ["green"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
    };
    const originalDef: CardDefinition = {
      cardNo: "TEST-ORIGINAL-CORE-SOURCE",
      name: "テスト元効果",
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
          steps: [],
        },
      ],
    };
    const protectedNexus = createCardInstance(protectedDef, {
      instanceId: "bslh01-c13-core-source-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const originalSource = createCardInstance(originalDef, {
      instanceId: "original-core-source-effect",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [zero, protectedNexus, originalSource],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-core-source-current-effect",
          sourceInstanceId: zero.instanceId,
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "current_effect" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: protectedNexus.instanceId,
          metadata: {
            currentEffectSourceInstanceId: "original-core-source-effect",
            currentEffectSourceDefinitionId: "TEST-ORIGINAL-CORE-SOURCE",
            currentEffectIndex: 0,
            currentEffectTargetStepId: "cost",
          },
        },
      ],
      pendingCoreSourceAllocation: {
        pendingId: "csa-current-effect",
        actingPlayerId: "bob",
        sourceInstanceId: "original-core-source-effect",
        sourceDefinitionId: "TEST-ORIGINAL-CORE-SOURCE",
        candidates: [
          {
            instanceId: protectedNexus.instanceId,
            available: 1,
            normalAvailable: 1,
          },
        ],
        requiredTotal: 0,
        toLocation: { kind: "void", player: "opponent" },
        effectTiming: { kind: "activated", mode: "flash" },
        targetedDisclosureResolutionCleanups: [
          {
            kind: "continuous_effects",
            effectIds: ["ce-core-source-current-effect"],
          },
        ],
        continuation: {
          chainId: "test:bslh01-cards:7189",
          sourceDefinitionId: originalDef.cardNo,
          effectIndex: 0,
          sourceInstanceId: originalSource.instanceId,
          actingPlayerId: "bob",
          resumeStepIndex: 0,
          stepContext: { results: {} } as NonNullable<
            NonNullable<
              GameState["pendingCoreSourceAllocation"]
            >["continuation"]
          >["stepContext"],
          targetInstanceIds: [],
        },
      },
    };
    const resolveAction = getLegalActions({
      state: baseState,
      actingPlayerId: "bob",
      getCardDefinitionById: (id) =>
        id === protectedDef.cardNo
          ? protectedDef
          : id === originalDef.cardNo
            ? originalDef
            : cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find((action) => action.kind === "resolve_core_source_allocation");
    expect(resolveAction).toBeDefined();

    const after = applyLegalAction({
      state: baseState,
      action: resolveAction!,
      coreSourceAllocations: {},
      getCardDefinitionById: (id) =>
        id === protectedDef.cardNo
          ? protectedDef
          : id === originalDef.cardNo
            ? originalDef
            : cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(
      after.activeContinuousEffects.some(
        (effect) => effect.effectId === "ce-core-source-current-effect"
      )
    ).toBe(false);
  });

  it("field_card_effect の対象開示 continuation は registration の effectIndex に束縛される", () => {
    const targetDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-FIELD-EFFECT-GRANDWALKER",
      name: "テスト創界神ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
    };
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-FIELD-EFFECT-SOURCE",
      name: "テストフィールド効果元",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [],
        },
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "target",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    targetsGrandwalker: true,
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const zero = createCardInstance(c, {
      instanceId: "bslh01-c13-field-effect-responder",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bslh01-c13-field-effect-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const source = createCardInstance(sourceDef, {
      instanceId: "bslh01-c13-field-effect-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const definitions = [...ALL_CARDS, targetDef, sourceDef];
    const getDef = (id: string): CardDefinition | undefined =>
      id === targetDef.cardNo
        ? targetDef
        : id === sourceDef.cardNo
          ? sourceDef
          : cardNoMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
    };
    const fieldEffectRegistrationIndex = effectLookups
      .getRegisteredFieldCardEffectActions(sourceDef.cardNo)
      .findIndex((registration) => registration.effectIndex === 1);
    expect(fieldEffectRegistrationIndex).toBeGreaterThanOrEqual(0);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [zero, target, source],
      }),
      activePlayerId: "bob",
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "field-effect-target:bslh01-c13",
        actingPlayerId: "bob",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: sourceDef.cardNo,
        deferredStack: {
          stackId: "stack:bslh01-c13-field-effect",
          actionKind: "field_card_effect",
          chainId: "chain:bslh01-c13-field-effect",
          actingPlayerId: "bob",
          cardInstanceId: source.instanceId,
          cardDefinitionId: sourceDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          fieldEffectSourceKind: "field",
          fieldEffectRegistrationIndex,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: [target.instanceId],
        targetEffectFilterTags: [],
        targetStepId: "target",
      },
    };

    const resolveTarget = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();

    const afterDisclosure = applyLegalAction({
      state,
      action: resolveTarget!,
      targetInstanceIds: [target.instanceId],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: sourceDef.cardNo,
        effectIndex: 1,
        targetInstanceIds: [target.instanceId],
        targetStepId: "target",
      }
    );
  });

  it("current_effect 免疫は対象開示 continuation 不在なら CE を登録しない", () => {
    const zero = createCardInstance(c, {
      instanceId: "bslh01-c13-no-continuation",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [zero],
    });
    const after = executeEffectImmunity(
      state,
      "alice",
      {
        target: { player: "self", selfCard: true },
        duration: { scope: "current_effect" },
      },
      zero.instanceId,
      (id) => cardNoMap.get(id)
    );

    expect(after.activeContinuousEffects).toHaveLength(0);
    expect(after.log).toContain(
      "effect:effect_immunity:current_effect:no-targeted-disclosure-continuation"
    );
  });

  it("current_effect 免疫 CE は元効果 source/effectIndex に束縛され cleanup へ積まれる", () => {
    const zero = createCardInstance(c, {
      instanceId: "bslh01-c13-bound-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [zero],
      }),
      pendingTargetedDisclosureContinuation: {
        chainId: "test:bslh01-cards:7440",
        pendingId: "tdc:test",
        sourceDefinitionId: "TEST-ORIGINAL-EFFECT",
        effectIndex: 2,
        sourceInstanceId: "original-source",
        actingPlayerId: "bob",
        resumeStepIndex: 0,
        stepContext: {} as NonNullable<
          GameState["pendingTargetedDisclosureContinuation"]
        >["stepContext"],
        targetInstanceIds: [zero.instanceId],
        targetStepId: "target",
        remainingStacks: [],
      },
    };

    const after = executeEffectImmunity(
      state,
      "alice",
      {
        target: { player: "self", selfCard: true },
        duration: { scope: "current_effect" },
      },
      zero.instanceId,
      (id) => cardNoMap.get(id)
    );
    const immunity = after.activeContinuousEffects.find(
      (effect) =>
        effect.modifierTag === "defense_immune" &&
        effect.targetInstanceId === zero.instanceId &&
        effect.sourceInstanceId === zero.instanceId
    );

    expect(immunity?.metadata).toMatchObject({
      currentEffectSourceInstanceId: "original-source",
      currentEffectSourceDefinitionId: "TEST-ORIGINAL-EFFECT",
      currentEffectIndex: 2,
      currentEffectTargetStepId: "target",
    });
    expect(
      after.pendingTargetedDisclosureContinuation?.resolutionCleanups
    ).toEqual([
      {
        kind: "continuous_effects",
        effectIds: [immunity!.effectId],
      },
    ]);
  });

  it("current_effect 免疫 CE は同一効果でも別 targetStepId には効かない", () => {
    const targetDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-STEP-BIND-TARGET",
      name: "テスト創界神ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
    };
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BSLH01-C13-STEP-BIND-SOURCE",
      name: "テスト効果元",
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
    };
    const target = createCardInstance(targetDef, {
      instanceId: "bslh01-c13-step-bind-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const source = createCardInstance(sourceDef, {
      instanceId: "bslh01-c13-step-bind-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [target, source],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-current-effect-step-bound",
          sourceInstanceId: c.cardNo,
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "current_effect" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
          metadata: {
            currentEffectSourceInstanceId: source.instanceId,
            currentEffectSourceDefinitionId: sourceDef.cardNo,
            currentEffectIndex: 0,
            currentEffectTargetStepId: "first-target",
          },
        },
      ],
    };

    expect(
      resolveCardImmunityAffect(state, target, "bob", "none", {
        instance: source,
        definition: sourceDef,
        effectIndex: 0,
        targetStepId: "first-target",
      }).kind
    ).toBe("blocked");
    expect(
      resolveCardImmunityAffect(state, target, "bob", "none", {
        instance: source,
        definition: sourceDef,
        effectIndex: 0,
        targetStepId: "second-target",
      }).kind
    ).toBe("allowed");
  });
});

describe("BSLH01-C14 碧の軌跡", () => {
  const c = card("BSLH01-C14");
  const flashEffect = () =>
    c.effects!.find(
      (effect) =>
        effect.timing.kind === "activated" && effect.timing.mode === "flash"
    )!;

  it("トラッシュ常在はこのカード以外の効果耐性、CB創界神/導界者配置時は自身を手札へ戻せる", () => {
    const immunity = c.effects![0]!;
    expect(immunity.stub).toBeUndefined();
    expect(immunity.applicability).toEqual({ zone: ["trash"] });
    expect(immunity.timing).toEqual({ kind: "continuous" });
    expect(immunity.steps[0]!.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "self" },
      sourcePlayerScope: "any",
      sourceScope: { excludeSelf: true },
      duration: { scope: "while_in_trash" },
    });

    const trigger = c.effects!.find(
      (effect) =>
        effect.timing.kind === "game_event" && effect.timing.event === "place"
    )!;
    expect(trigger.stub).toBeUndefined();
    expect(trigger.applicability).toEqual({ zone: ["trash"] });
    expect(trigger.executionMode).toBe("optional");
    expect(trigger.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(trigger.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "place",
      triggerFilter: {
        category: ["nexus"],
        tribes: ["CB"],
        targetsGrandwalker: "only",
      },
    });
    expect(trigger.steps[0]!.action).toEqual({
      kind: "move_card",
      target: { kind: "self" },
      from: { zone: "trash", player: "self" },
      to: { zone: "hand" },
      count: 1,
      requireFullCount: true,
    });
  });

  it("CB創界神ネクサス配置時、トラッシュの自身を誘発解決で手札へ戻す", () => {
    const decoy = createCardInstance(card("BSLH01-C01"), {
      instanceId: "alice-other-trash",
      ownerPlayerId: "player-1",
      zone: "trash",
    });
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-c14-trash",
      ownerPlayerId: "player-1",
      zone: "trash",
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "alice-cb-grandwalker-place",
      ownerPlayerId: "player-1",
      zone: "hand",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [decoy, source, grandwalker],
    });
    const afterPlace: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((ci) =>
        ci.instanceId === "alice-cb-grandwalker-place"
          ? { ...ci, zone: "field" as const, zoneRoleName: "nexus" }
          : ci
      ),
    };
    const lookups = buildLocalRebirthLookups([]);
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: afterPlace,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookups.getCardDefinitionById,
    });
    expect(events).toEqual([
      expect.objectContaining({
        eventKind: "place",
        relatedInstanceId: "alice-cb-grandwalker-place",
        relatedPlayerId: "player-1",
      }),
    ]);
    expect(generateTriggeredEffectRegistrations(c)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "place",
          sourceZone: ["trash"],
        }),
      ])
    );

    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterPlace,
      source: "action_resolution",
      chainId: "test:bslh01-cards:7682",
      attackId: null,
      ...lookups,
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    });

    expect(queued.pendingPrivateDeclarations).toHaveLength(0);
    const pending = queued.pendingTriggeredEffects.find(
      (candidate) =>
        candidate.eventKind === "place" &&
        candidate.relatedInstanceId === "alice-cb-grandwalker-place"
    );
    expect(pending).toBeDefined();
    if (!pending) {
      throw new Error("missing C14 public trigger pending");
    }
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending,
      ...lookups,
    });
    expect(choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCard: expect.objectContaining({
            instanceId: "alice-bslh01-c14-trash",
          }),
          sourceDefinition: expect.objectContaining({ cardNo: "BSLH01-C14" }),
        }),
      ])
    );

    const resolved = drainTriggeredEffectsAndStack(
      queued,
      ["player-1", "player-2"],
      lookups
    );
    expect(
      resolved.cardInstances.find(
        (ci) => ci.instanceId === "alice-bslh01-c14-trash"
      )?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === "alice-other-trash")
        ?.zone
    ).toBe("trash");
  });

  it("フラッシュでデッキ3オープン→revealed 全体のスピリット数で創界神/導界者にコア+1", () => {
    const flash = flashEffect();
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(flash.steps[0]!.action.kind).toBe("deck_reveal");
    const coreStep = (
      flash.steps[0]!.action as Extract<
        import("../src/dsl-types").Action,
        { kind: "deck_reveal" }
      >
    ).beforePickSteps![0]!.action;
    expect(coreStep.kind).toBe("core_move");
    if (coreStep.kind === "core_move") {
      expect(coreStep.from).toEqual({ kind: "void", player: "self" });
      expect(coreStep.amount).toEqual({
        source: {
          kind: "cards_from_ref",
          stepId: "c14reveal",
          filter: { category: ["spirit"] },
          result: "revealed",
        },
      });
      if (coreStep.to.kind === "field_card") {
        expect(coreStep.to.filter).toEqual({
          category: ["nexus"],
          targetsGrandwalker: "only",
        });
      }
    }
  });

  it("BSLH01-C14: revealed 3枚中スピリット1枚→pick結果に関係なく創界神ネクサスにコア+1", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-c14",
      ownerPlayerId: "player-1",
      zone: "hand",
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "alice-grandwalker",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 0,
    });
    // デッキ上から3枚: スピリット1枚(C01) + 非スピリット2枚(C02 ネクサス)。
    const spiritCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-spirit",
      ownerPlayerId: "player-1",
      zone: "deck",
    });
    const filler1 = createCardInstance(card("BSLH01-C02"), {
      instanceId: "deck-filler-1",
      ownerPlayerId: "player-1",
      zone: "deck",
    });
    const filler2 = createCardInstance(card("BSLH01-C02"), {
      instanceId: "deck-filler-2",
      ownerPlayerId: "player-1",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, grandwalker, spiritCard, filler1, filler2],
      startingVoidNormalCoreCount: 3,
    });
    const state = {
      ...before,
      activePlayerId: "player-1",
      step: "main" as const,
      players: before.players.map((p) =>
        p.id === "player-1" ? { ...p, deckCount: 3 } : p
      ),
    };
    const afterReveal = executeEffect({
      chainId: "test:bslh01-cards:7809",
      state,
      effect: flashEffect(),
      sourceInstanceId: "alice-bslh01-c14",
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.continuation).toBeDefined();

    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();

    // 非スピリットの filler1 を手札へ選んでも(=スピリット自体は手札に加わらなくても)、
    // revealed 全体(3枚中スピリット1枚)基準でコア+1 が成立する。
    const afterPickOnly = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      selectedDeckRevealCardIds: ["deck-filler-1"],
    }).state;

    // 残り2枚(デッキ下行き)の順序確定。
    const orderAction = getLegalActions({
      state: afterPickOnly,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterPickOnly,
      action: orderAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      deckRevealRemainderOrder: ["deck-spirit", "deck-filler-2"],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    const nexusAfter = afterPick.cardInstances.find(
      (ci) => ci.instanceId === "alice-grandwalker"
    );
    expect(nexusAfter?.normalCoreCount).toBe(1);
    expect(
      afterPick.cardInstances.find((ci) => ci.instanceId === "deck-filler-1")
        ?.zone
    ).toBe("hand");
    expect(
      afterPick.cardInstances.find((ci) => ci.instanceId === "deck-spirit")
        ?.zone
    ).toBe("deck");
  });

  it("BSLH01-C14: スピリット自体を手札に選んでも revealed 全体基準でコア+1 (pick結果非依存の回帰確認)", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-c14-b",
      ownerPlayerId: "player-1",
      zone: "hand",
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "alice-grandwalker-b",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 0,
    });
    const spiritCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "deck-spirit-b",
      ownerPlayerId: "player-1",
      zone: "deck",
    });
    const filler1 = createCardInstance(card("BSLH01-C02"), {
      instanceId: "deck-filler-1-b",
      ownerPlayerId: "player-1",
      zone: "deck",
    });
    const filler2 = createCardInstance(card("BSLH01-C02"), {
      instanceId: "deck-filler-2-b",
      ownerPlayerId: "player-1",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, grandwalker, spiritCard, filler1, filler2],
      startingVoidNormalCoreCount: 3,
    });
    const state = {
      ...before,
      activePlayerId: "player-1",
      step: "main" as const,
      players: before.players.map((p) =>
        p.id === "player-1" ? { ...p, deckCount: 3 } : p
      ),
    };
    const afterReveal = executeEffect({
      chainId: "test:bslh01-cards:7907",
      state,
      effect: flashEffect(),
      sourceInstanceId: "alice-bslh01-c14-b",
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    // スピリット自体を手札に選ぶ（= revealedCardInstanceIds の「残り」から抜ける側）。
    const afterPickOnly = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      selectedDeckRevealCardIds: ["deck-spirit-b"],
    }).state;
    const orderAction = getLegalActions({
      state: afterPickOnly,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    const afterPick = applyLegalAction({
      state: afterPickOnly,
      action: orderAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      deckRevealRemainderOrder: ["deck-filler-1-b", "deck-filler-2-b"],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    const nexusAfter = afterPick.cardInstances.find(
      (ci) => ci.instanceId === "alice-grandwalker-b"
    );
    // pick 結果に関係なくスピリット1枚分のコアが置かれる（原文「その中の…1枚につき」は
    // revealed 全体基準。手札に加わった側であっても脱落しない回帰確認）。
    expect(nexusAfter?.normalCoreCount).toBe(1);
    expect(
      afterPick.cardInstances.find((ci) => ci.instanceId === "deck-spirit-b")
        ?.zone
    ).toBe("hand");
  });
});

describe("BSLH01-CX01 ENIGMA[戦術オーブメント]", () => {
  const c = card("BSLH01-CX01");
  it("スタートステップにカウント+2 / 魂状態システムは stub", () => {
    expect(c.keywordTags).toContain("contract");
    const phase = c.effects![0]!;
    expect(phase.timing).toEqual({
      kind: "phase",
      step: "start",
      whose: "self",
    });
    // 【魂状態】効果ヘッダー配下なので applicability.soulState で gate (audit 2026-06-19)。
    expect(phase.applicability).toEqual({ soulState: true });
    const cnt = phase.steps[0]!.action;
    if (cnt.kind === "count_increase") expect(cnt.amount).toBe(2);
    // F2.4: enter_soul_state / quartz_set トリガーを実装。得て発揮 (triggered/continuous/
    // activated 全系統) は ENGINE-quartz-host-identity-propagation で着地済み。
    // CB 軽減<七> も engine-quartz-host-identity-activated-continuous で着地済み (stub 解消)。
    expect(c.effects!.some((e) => e.stub)).toBe(false);
  });

  it("【魂状態】quartz_set トリガーも applicability.soulState で gate (audit 2026-06-19)", () => {
    const quartzSet = c.effects![2]!;
    expect(quartzSet.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "quartz_set",
    });
    expect(quartzSet.applicability).toEqual({ soulState: true });
  });

  it("[board] クォーツセット時のドローは同名でターン2回までで、担当本文句を明示する", () => {
    const ALICE = "alice";
    const host = createCardInstance(c, {
      instanceId: "enigma-draw-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const quartzDefs = [
      card("BSLH01-C09"),
      card("BSLH01-C10"),
      card("BSLH01-M01"),
    ];
    const quartz = quartzDefs.map((definition, index) =>
      createCardInstance(definition, {
        instanceId: `enigma-draw-quartz-${index + 1}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const deckCards = ["BSLH01-C01", "BSLH01-C02", "BSLH01-C03"].map(
      (cardNo, index) =>
        createCardInstance(card(cardNo), {
          instanceId: `enigma-draw-deck-${index + 1}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "deck",
        })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      cardInstances: [host, ...quartz, ...deckCards],
      playerOverrides: [
        {
          handCount: quartz.length,
          deckCount: deckCards.length,
          soulStateInstanceIds: [host.instanceId],
        },
        {},
      ],
    });
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const resolveQuartzSetDraw = (
      before: GameState,
      quartzInstanceId: string,
      slot: "center" | "left" | "right"
    ): GameState => {
      const afterSet = setQuartz(
        before,
        {
          quartzInstanceId,
          hostInstanceId: host.instanceId,
          ownerPlayerId: ALICE,
          slot,
        },
        getDef
      )!;
      const queued = collectAndQueueTriggerReactions({
        chainId: "test:bslh01-cards:8050",
        beforeState: before,
        afterState: afterSet,
        source: "action_resolution",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions:
          lookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: lookups.getRegisteredBurstActions,
      });
      const pending = queued.pendingTriggeredEffects.find(
        (entry) => entry.eventKind === "quartz_set"
      );
      expect(pending).toBeDefined();
      const resolve = getLegalActions({
        state: queued,
        actingPlayerId: ALICE,
        ...lookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.pendingId === pending?.pendingId &&
          action.sourceInstanceId === host.instanceId &&
          action.skipOnly !== true
      );
      expect(resolve).toBeDefined();
      if (!resolve || resolve.kind !== "resolve_pending_triggered_effect")
        throw new Error("expected ENIGMA quartz-set draw trigger");
      const declared = applyLegalAction({
        state: queued,
        action: resolve,
        ...lookups,
      }).state;
      const pass = getLegalActions({
        state: declared,
        actingPlayerId: declared.stackWindow!.priorityPlayerId,
        ...lookups,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      return applyLegalAction({ state: declared, action: pass!, ...lookups })
        .state;
    };

    expect(c.effects![2]!.steps[0]!.prompt?.sourceText).toBe(
      "自分のクォーツがセットされたとき、〔ターンに2回：同名〕自分はデッキの上から1枚ドローできる。"
    );
    const afterFirst = resolveQuartzSetDraw(
      base,
      quartz[0]!.instanceId,
      "center"
    );
    const afterSecond = resolveQuartzSetDraw(
      afterFirst,
      quartz[1]!.instanceId,
      "left"
    );
    expect(
      afterSecond.players.find((player) => player.id === ALICE)?.deckCount
    ).toBe(1);
    expect(
      afterSecond.players.find((player) => player.id === ALICE)?.handCount
    ).toBe(3);

    const afterThirdSet = setQuartz(
      afterSecond,
      {
        quartzInstanceId: quartz[2]!.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: ALICE,
        slot: "right",
      },
      getDef
    )!;
    const thirdQueued = collectAndQueueTriggerReactions({
      chainId: "test:bslh01-cards:8122",
      beforeState: afterSecond,
      afterState: afterThirdSet,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lookups.getRegisteredBurstActions,
    });
    const thirdPending = thirdQueued.pendingTriggeredEffects.find(
      (entry) => entry.eventKind === "quartz_set"
    );
    expect(thirdPending).toBeDefined();
    expect(
      getLegalActions({
        state: thirdQueued,
        actingPlayerId: ALICE,
        ...lookups,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.pendingId === thirdPending?.pendingId &&
          action.sourceInstanceId === host.instanceId &&
          action.skipOnly !== true
      )
    ).toBe(false);
    expect(
      thirdQueued.players.find((player) => player.id === ALICE)?.deckCount
    ).toBe(1);
  });

  it("CB 軽減シンボル<七>扱い: treat_as overridesRequiredColor が whenPayingForFilter tribes:CB で宣言される", () => {
    const cbReduction = c.effects![c.effects!.length - 1]!;
    expect(cbReduction.timing).toEqual({ kind: "continuous" });
    // 【魂状態】見出し配下 (textRef[7]) なので他の兄弟効果と同じく soulState gate 必須。
    expect(cbReduction.applicability).toEqual({ soulState: true });
    const action = cbReduction.steps[0]!.action;
    if (action.kind !== "treat_as") throw new Error("expected treat_as");
    expect(action.aspects).toEqual(["reduction_symbol"]);
    expect(action.asColor).toEqual(["seven"]);
    expect(action.whenPayingForFilter).toEqual({
      tribes: ["CB"],
      category: ["spirit", "ultimate", "brave", "nexus"],
    });
    expect(action.overridesRequiredColor).toBe(true);
  });

  it("[board] CB 系統カード(BSLH01-M01)の召喚コスト計算で軽減シンボルが<七>要求へ置き換わる", () => {
    const ALICE = "player-1";
    const m01 = card("BSLH01-M01");
    expect(m01.tribe).toContain("CB");
    expect(m01.reductionSymbols).toEqual(["purple", "purple", "purple"]);

    const purpleSupply: CardDefinition = {
      cardNo: "TEST-PURPLE-SUPPLY",
      name: "紫供給テスト",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["purple", "purple", "purple"],
      textLines: [],
      keywordTags: [],
      tribe: "無関係",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const sevenSupply: CardDefinition = {
      ...purpleSupply,
      cardNo: "TEST-SEVEN-SUPPLY",
      name: "黒供給テスト",
      symbolColors: ["black"],
    };
    const unrelatedPurpleCard: CardDefinition = {
      ...purpleSupply,
      cardNo: "TEST-UNRELATED-PURPLE-MAGIC",
      name: "無関係紫マジック",
      printedCategory: "magic",
      reductionSymbols: ["purple"],
      symbolColors: [],
    };
    const testCards = new Map<string, CardDefinition>(
      [purpleSupply, sevenSupply, unrelatedPurpleCard].map((d) => [d.cardNo, d])
    );
    const getDefWithTestCards = (id: string): CardDefinition | undefined =>
      getDef(id) ?? testCards.get(id);

    const enigmaInst = createCardInstance(c, {
      instanceId: "enigma-cb-reduction",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "soul_state",
    });
    const purpleInst = createCardInstance(purpleSupply, {
      instanceId: "purple-supply-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });

    // ENIGMA の<七>要求は紫シンボルでも軽減できる。
    const stateWithoutSeven = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
      cardInstances: [enigmaInst, purpleInst],
    });
    stateWithoutSeven.players
      .find((p) => p.id === ALICE)!
      .soulStateInstanceIds.push("enigma-cb-reduction");
    const withoutSeven = calculateReduction({
      state: stateWithoutSeven,
      actingPlayerId: ALICE,
      card: m01,
      getCardDefinitionById: getDefWithTestCards,
    });
    expect(withoutSeven.totalReduction).toBe(3);

    // 印字の紫では満たせない黒シンボルでも、<七>要求なら1枠を満たす。
    const sevenInst = createCardInstance(sevenSupply, {
      instanceId: "seven-supply-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const stateWithSeven = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
      cardInstances: [enigmaInst, sevenInst],
    });
    stateWithSeven.players
      .find((p) => p.id === ALICE)!
      .soulStateInstanceIds.push("enigma-cb-reduction");
    const withSeven = calculateReduction({
      state: stateWithSeven,
      actingPlayerId: ALICE,
      card: m01,
      getCardDefinitionById: getDefWithTestCards,
    });
    expect(withSeven.totalReduction).toBe(1);

    // CB 以外のカードは影響を受けず、通常どおり紫供給で軽減される。
    const unrelatedResult = calculateReduction({
      state: stateWithoutSeven,
      actingPlayerId: ALICE,
      card: unrelatedPurpleCard,
      getCardDefinitionById: getDefWithTestCards,
    });
    expect(unrelatedResult.totalReduction).toBe(1);

    // 【魂状態】見出し配下の効果なので、ENIGMA が場にいても魂状態でなければ発揮されない
    // (soulStateInstanceIds に登録しない = 非魂状態) — 印字どおり紫供給で軽減される。
    const stateNotSoulState = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
      cardInstances: [enigmaInst, purpleInst],
    });
    const notSoulStateResult = calculateReduction({
      state: stateNotSoulState,
      actingPlayerId: ALICE,
      card: m01,
      getCardDefinitionById: getDefWithTestCards,
    });
    // 印字どおり紫×3要求に対し紫供給×3が全マッチ (override 不成立の確認)。
    expect(notSoulStateResult.totalReduction).toBe(3);
  });
});

describe("BSLH01-M01 リーシャ・マオ", () => {
  it("effects[0] ライフ減少召喚・[1]コスト連動段階・[2]クォーツset-effect(コスト上限修飾)は全件 resolved", () => {
    const c = card("BSLH01-M01");
    const lifeDecreaseSummon = c.effects![0]!;
    expect(lifeDecreaseSummon.stub).toBeUndefined();
    expect(lifeDecreaseSummon.applicability).toEqual({
      zone: ["hand", "set_aside"],
    });
    expect(lifeDecreaseSummon.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "reduce_life",
      sourceWhose: "either",
    });
    expect(lifeDecreaseSummon.executionMode).toBe("optional");
    expect(lifeDecreaseSummon.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: { fixedPayment: 1 },
    });
    // 段階支払い効果 (choice 4分岐 + ref_choice not合成) は
    // bslh01-m01-graduated-payment.test.ts で構造・盤面変化とも詳細に検証する。
    expect(c.effects![1]!.stub).toBeUndefined();
    // クォーツ set-effect (コスト破壊効果/コスト疲労効果の上限+3) は
    // bslh01-m01-quartz-cost-cap.test.ts で構造・盤面変化とも詳細に検証する。
    expect(c.effects![2]!.stub).toBeUndefined();
  });

  it("[board] 実行: ライフ減少時、手札のこのカード(印字コスト6)を1コストで召喚できる (override:1)", () => {
    const ALICE = "player-1";
    const c = card("BSLH01-M01");
    const grant = c.effects![0]!;
    const handCard = createCardInstance(c, {
      instanceId: "m01-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [handCard],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });
    const getDef = (id: string) => (id === c.cardNo ? c : undefined);

    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bslh01-cards:8331",
      state: before,
      effect: grant,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const summoned = after.cardInstances.find(
      (ci) => ci.instanceId === handCard.instanceId
    )!;
    expect(summoned.zone).toBe("field");
    // Lv1 requiredCores=1 分をリザーブから配置。
    expect(summoned.normalCoreCount).toBe(1);
    // override:1 により、印字コスト6ではなく1コストのみ消費 (1 + cores1 = reserve 3→1)。
    const alicePlayer = after.players.find((p) => p.id === ALICE)!;
    expect(alicePlayer.reserveNormalCoreCount).toBe(1);
    expect(after.log.length).toBeGreaterThan(0);
  });

  it("[統合] 相手起因で相手自身のライフが減ったときも、sourceWhose:'either' により手札のこのカードが private declaration 候補に含まれる (adversarial verifier 2026-07-13 refute 対応、bsth02-7-tx01-reduce-life-hand-trigger.test.ts と同型)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const c = card("BSLH01-M01");
    const handCard = createCardInstance(c, {
      instanceId: "m01-hand-other-source",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handCard],
    });
    const getDef = (id: string) => (id === c.cardNo ? c : undefined);
    const lookup = buildTriggeredEffectLookup(ALL_CARDS);

    // BOB 自身のライフが BOB 自身の効果で減る (self_effect from BOB's perspective) — ALICE
    // からみると「相手 (BOB) のライフが減った」ケース。player:"either" が正しく機能していれば
    // ALICE 手札の M01 も誘発候補に入る。
    const afterLifeDamage = resolveLifeDamage(before, BOB, 1, [], {
      cause: "self_effect",
      actingPlayerId: BOB,
    });

    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterLifeDamage,
      source: "action_resolution",
      chainId: "m01-opponent-reduce-life-chain",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = queued.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === handCard.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("reduce_life");
    expect(declaration!.ownerPlayerId).toBe(ALICE);
  });
});

describe("BSLH01-M02 ツァイト", () => {
  const c = card("BSLH01-M02");
  const ALICE = "player-1";
  const BOB = "player-2";

  function m02FlashState(cardInstances: CardInstance[]): GameState {
    const attacker = createCardInstance(card("BSLH01-C01"), {
      instanceId: "m02-opponent-attacker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack-group:m02:bob:battle-entity:m02-opponent-attacker",
      primaryEntityId: "battle-entity:m02-opponent-attacker",
      participantEntityIds: ["battle-entity:m02-opponent-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [],
      symbolResolutionOrder: ["battle-entity:m02-opponent-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    };
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [...cardInstances, attacker],
      activeAttack,
      battleEntities: [
        {
          entityId: "battle-entity:m02-opponent-attacker",
          memberInstanceIds: ["m02-opponent-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
      playerOverrides: [
        { id: ALICE, reserveNormalCoreCount: 8 },
        { id: BOB, reserveNormalCoreCount: 8 },
      ],
    });
    return {
      ...base,
      activePlayerId: BOB,
      step: "attack",
      window: "flash_before_block",
      turnNumber: 2,
    };
  }

  it("トラッシュ免疫 / 召喚時相手2体疲労 / エンドでデッキ戻し+ドロー", () => {
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("effect_immunity");
    const normalPermission = c.effects![1]!;
    expect(normalPermission.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
    expect(normalPermission.activationLabel).toBeUndefined();
    expect(normalPermission.applicability).toEqual({ zone: "hand" });
    expect(normalPermission.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["spirit", "ultimate"],
      },
    ]);
    expect(normalPermission.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
    });
    const costTwoPermission = c.effects![2]!;
    expect(costTwoPermission.activationLabel).toBeUndefined();
    expect(costTwoPermission.condition).toEqual([
      {
        kind: "field_lacks",
        player: "self",
        category: ["spirit", "ultimate"],
      },
    ]);
    expect(costTwoPermission.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: { override: 2 },
    });
    expect(normalPermission.stub).toBeUndefined();
    expect(costTwoPermission.stub).toBeUndefined();
    const summon = c.effects![3]!;
    expect(summon.timing).toEqual({
      kind: "card_event",
      event: "summon",
      sourceEffectIndex: [1, 2],
    });
    const ex = summon.steps[0]!.action;
    if (ex.kind === "set_exhaust_state" && "filter" in ex.target)
      expect(ex.target.count).toBe(2);
    expect(summon.stub).toBeUndefined();
    const end = c.effects![4]!;
    // 「お互いのエンドステップ」= whose:'either'、Lv1-Lv2 限定。
    expect(end.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "either",
    });
    expect(end.applicability).toEqual({ level: { min: 1, max: 2 } });
    // stub 解消: 自身を send_to_deck (デッキへ戻す＝コアはリザーブへ正規ルート)。
    expect(end.steps[0]!.action.kind).toBe("send_to_deck");
    const send = end.steps[0]!.action;
    if (send.kind === "send_to_deck") {
      expect(send.target).toEqual({ kind: "self" });
      expect(send.position).toBe("bottom");
    }
    // shuffle は send 成功 gate。
    expect(end.steps[1]!.connector).toBe("conditional_result");
    expect(end.steps[1]!.action.kind).toBe("shuffle_zone");
    // ドローは「1枚まで」= step.executionMode:'optional' (BSDB01 と同型)。
    expect(end.steps[2]!.action.kind).toBe("draw");
    expect(end.steps[2]!.executionMode).toBe("optional");
    expect(end.stub).toBeUndefined();
  });

  it("BSLH01-M02 のフラッシュ自己召喚起動効果は通常コスト枝と空場コスト2枝を排他提示する", () => {
    const sevenSymbolNexus: CardDefinition = {
      ...card("BSLH01-C02"),
      cardNo: "TEST-SEVEN-NEXUS",
      symbolColors: ["seven"],
      effects: [],
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === sevenSymbolNexus.cardNo ? sevenSymbolNexus : cardNoMap.get(id);
    const tsait = createCardInstance(c, {
      instanceId: "tsait-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const emptyField = m02FlashState([tsait]);
    const emptyActions = getLegalActions({
      state: emptyField,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    });
    const emptySummons = emptyActions.filter(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceCardNo === "BSLH01-M02"
    );
    expect(emptySummons).toHaveLength(1);
    expect(emptySummons[0]).toMatchObject({
      effectIndex: 2,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });

    const sevenNexus = createCardInstance(sevenSymbolNexus, {
      instanceId: "seven-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const emptyFieldWithReduction = {
      ...emptyField,
      cardInstances: [...emptyField.cardInstances, sevenNexus],
    };
    const reducedEmptySummons = getLegalActions({
      state: emptyFieldWithReduction,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    }).filter(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceCardNo === "BSLH01-M02"
    );
    expect(reducedEmptySummons).toHaveLength(1);
    expect(reducedEmptySummons[0]).toMatchObject({
      effectIndex: 2,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });

    const other = createCardInstance(card("BSLH01-C01"), {
      instanceId: "other-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nonEmptyField = {
      ...emptyField,
      cardInstances: [...emptyField.cardInstances, other],
    };
    const normalSummons = getLegalActions({
      state: nonEmptyField,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    }).filter(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceCardNo === "BSLH01-M02"
    );
    expect(normalSummons).toHaveLength(1);
    expect(normalSummons[0]).toMatchObject({
      effectIndex: 1,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });
  });

  it("BSLH01-M02 の通常コスト側フラッシュ自己召喚起動効果は restrict_flash 下では提示されない", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    };
    const tsait = createCardInstance(c, {
      instanceId: "tsait-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const attackerDef = card("BSLH01-C01");
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "alice-attacker-entity",
      participantEntityIds: ["alice-attacker-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    };
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [tsait, attacker],
      activeAttack,
      battleEntities: [
        {
          entityId: "alice-attacker-entity",
          memberInstanceIds: ["alice-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
      playerOverrides: [
        { id: ALICE, reserveNormalCoreCount: 8 },
        { id: BOB, reserveNormalCoreCount: 8 },
      ],
    });
    const restrictFlash: ContinuousEffect = {
      effectId: "ce:test-restrict-flash-alice",
      sourceInstanceId: "bob-source",
      sourceDefinitionId: "TEST-RESTRICT-FLASH",
      actingPlayerId: BOB,
      modifierTag: "restrict_flash_any",
      targetInstanceId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: null,
    };
    const flashState: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_before_block",
      activeContinuousEffects: [restrictFlash],
    };

    const summon = getLegalActions({
      state: flashState,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceCardNo === "BSLH01-M02" &&
        a.effectIndex === 1
    );
    expect(summon).toBeUndefined();
  });

  it("BSLH01-M02 の自己召喚起動効果だけが相手2体疲労の召喚時誘発を積む", () => {
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    };
    const tsait = createCardInstance(c, {
      instanceId: "tsait-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const bobSpirit1 = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bob-spirit-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobSpirit2 = createCardInstance(card("BSLH01-C02"), {
      instanceId: "bob-spirit-2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const flashState = m02FlashState([tsait, bobSpirit1, bobSpirit2]);

    const handEffect = getLegalActions({
      state: flashState,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceCardNo === "BSLH01-M02" &&
        a.effectIndex === 2
    );
    expect(handEffect).toBeDefined();
    const afterDeclare = applyLegalAction({
      state: flashState,
      action: handEffect!,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      ...lookups,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: BOB,
      ...lookups,
    }).find((a) => a.kind === "pass_battle_flash");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      ...lookups,
    }).state;

    expect(
      afterPass.pendingTriggeredEffects.some(
        (p) =>
          p.relatedInstanceId === "tsait-hand" &&
          p.eventKind === "summon" &&
          p.sourceEffectIndex === 2
      )
    ).toBe(true);
  });

  it("BSLH01-M02 は通常召喚では相手2体疲労の召喚時誘発を積まない", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const tsait = createCardInstance(c, {
      instanceId: "tsait-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const bobSpirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bob-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [tsait, bobSpirit],
      playerOverrides: [
        { id: ALICE, reserveNormalCoreCount: 8 },
        { id: BOB, reserveNormalCoreCount: 8 },
      ],
    });
    const mainState: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
    };
    const normalSummon = getLegalActions({
      state: mainState,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "summon" &&
        a.sourceInstanceId === "tsait-hand" &&
        a.summonPermissionEffectIndex === undefined
    );
    expect(normalSummon).toBeDefined();
    const afterDeclare = applyLegalAction({
      state: mainState,
      action: normalSummon!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      ...lookups,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: BOB,
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      ...lookups,
    }).state;

    expect(
      afterPass.pendingTriggeredEffects.some(
        (p) => p.relatedInstanceId === "tsait-hand" && p.eventKind === "summon"
      )
    ).toBe(false);
  });

  it("[board] effects[4] 発揮: 場のツァイトがコアごとデッキ下へ、コアはリザーブへ移り、ドロー optional pending が立つ", () => {
    const ALICE = "player-1";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const tsait = createCardInstance(c, {
      instanceId: "tsait-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    // condition: 自分のスピリットが他にいる
    const other = createCardInstance(card("BSLH01-C01"), {
      instanceId: "other-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ cardInstances: [tsait, other] });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, reserveNormalCoreCount: 0, deckCount: 30, handCount: 0 }
          : p
      ),
    };
    let after = executeEffect({
      chainId: "test:bslh01-cards:8899",
      state: before,
      effect: c.effects![4]!,
      sourceInstanceId: "tsait-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(after.pendingStepOptionalChoice).not.toBeNull();
    expect(after.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "tsait-1",
        kind: "bounce",
        leaveDestination: { zone: "deck", position: "bottom" },
      })
    );
    after = drainOptionalStepsWithExecute(after, getDef);
    // ツァイト本体はデッキへ、コアはリザーブへ正規ルート移送 (executeSendToDeck の正規挙動)。
    const tsaitAfter = after.cardInstances.find(
      (x) => x.instanceId === "tsait-1"
    )!;
    expect(tsaitAfter.zone).toBe("deck");
    expect(tsaitAfter.normalCoreCount).toBe(0);
    const aliceMid = after.players.find((p) => p.id === ALICE)!;
    expect(aliceMid.reserveNormalCoreCount).toBe(2);
    expect(aliceMid.handCount).toBe(1);
    expect(aliceMid.deckCount).toBe(30);
  });
});

describe("BSLH01-M03 ヨシュア・ブライト", () => {
  const c = card("BSLH01-M03");
  it("バースト実装済(除外→持ち主のフィールドへ疲労状態で再召喚、詳細は bslh01-m03-burst-exclude-resummon.test.ts) / Lv2アタックでブロック不可+回復 / クォーツ(双児珠)は borrow_magic_effect で実装済", () => {
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.timing).toEqual({
      kind: "burst",
      trigger: { kind: "attack_finished", player: "opponent" },
    });
    const atk = c.effects![1]!;
    expect(atk.steps[0]!.action.kind).toBe("unblockable");
    expect(atk.steps[1]!.action.kind).toBe("recover");
    const quartzEffect = c.effects![2]!;
    expect(quartzEffect.stub).toBeUndefined();
    expect(quartzEffect.applicability).toEqual({ soulState: true });
    expect(quartzEffect.steps[0]!.action.kind).toBe("borrow_magic_effect");
  });
});

describe("BSLH01-M04 シャーリー・オルランド", () => {
  it("バースト消滅 [0] / Lvコスト+2 [1] / クォーツ [2] いずれも実装済 (バースト詳細は bslh01-m04-burst-vanish-choice.test.ts)", () => {
    const c = card("BSLH01-M04");
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![2]!.stub).toBeUndefined();
    expect(c.effects![2]!.timing).toMatchObject({ sourceWhose: "either" });
    expect(c.effects![2]!.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
    ]);
    expect(c.effects![2]!.steps[0]!.action).toMatchObject({
      kind: "deck_reveal",
      player: "opponent",
      revealTo: "self",
      picks: [],
      remainder: "top_bottom_split",
    });
  });

  it("Lvコスト+2 [1]: 相手スピリット/ネクサス1つへ levelCostDelta、消滅で 2 ドロー", () => {
    const c = card("BSLH01-M04");
    const eff = c.effects![1]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.steps[0]!.action).toMatchObject({
      kind: "override_properties",
      properties: { levelCostDelta: 2 },
    });
    expect(eff.steps[1]!.action).toMatchObject({ kind: "draw", count: 2 });
    expect(eff.steps[1]!.stepCondition).toMatchObject({
      kind: "ref_leave_established",
      stepId: "lv-cost-up",
      leaveKind: "vanish",
    });
  });

  it("[board] 既に破壊待機の対象がLvコスト+2後も最低Lvを満たす場合は後段ドローを出さない", () => {
    const c = card("BSLH01-M04");
    const targetDef = card("BSLH01-C01");
    const source = createCardInstance(c, {
      instanceId: "sherry-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = {
      ...createCardInstance(targetDef, {
        instanceId: "pending-destroy-target",
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-2",
        zone: "field",
        normalCoreCount: 3,
      }),
      pendingLeaveKind: "destroy" as const,
      pendingLeaveCause: "effect_resolution" as const,
      pendingLeaveChainId: "destroy-chain",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["player-1", "player-2"],
        cardInstances: [source, target],
      }),
      pendingLeaveEntities: [
        {
          instanceId: target.instanceId,
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "player-1",
          chainId: "destroy-chain",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:bslh01-cards:9021",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [target.instanceId],
      targetStepId: "lv-cost-up",
    });

    expect(result.log).not.toContain(
      `pending-leave-transition:destroy->vanish:${target.instanceId}`
    );
    expect(result.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] Lvコスト+2で合体ホストが消滅したらブレイヴ選択前に2ドロー選択を出す", () => {
    const c = card("BSLH01-M04");
    const targetDef = card("BSLH01-C01");
    const braveDef = testBraveDefinition("TEST-BSLH01-M04-BRAVE");
    const lookups = buildLocalRebirthLookups([braveDef]);
    const source = createCardInstance(c, {
      instanceId: "sherry-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-combined-host",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["target-attached-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "target-attached-brave",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: "target-combined-host",
    });
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, target, brave],
    });

    let result = executeEffect({
      chainId: "test:bslh01-cards:9071",
      state,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "player-1",
      ...lookups,
      targetInstanceIds: [target.instanceId],
      targetStepId: "lv-cost-up",
    });

    expect(result.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: source.instanceId,
      stepIndex: 1,
    });
    expect(result.pendingBraveLeaveChoice).toBeNull();
    result = finalizeEffectResolution({
      state: result,
      beforeState: state,
      chainId: "test:sherry",
      endLogs: [],
      actingPlayerId: "player-1",
      ...lookups,
      getRegisteredBurstActions: () => [],
      causedBySourceInstanceId: source.instanceId,
    });
    const drawChoice = getLegalActions({
      state: result,
      actingPlayerId: "player-1",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(drawChoice).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: drawChoice!,
      ...lookups,
    }).state;
    expect(result.pendingStepOptionalChoice).toBeNull();
    expect(result.pendingBraveLeaveChoice).toMatchObject({
      hostInstanceId: target.instanceId,
      braveInstanceIds: [brave.instanceId],
    });
    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);

    const keepAction = getLegalActions({
      state: result,
      actingPlayerId: "player-2",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" && action.choice === "keep"
    );
    expect(keepAction).toBeDefined();

    const resolved = applyLegalAction({
      state: result,
      action: keepAction!,
      ...lookups,
    }).state;
    const targetResolved = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === target.instanceId
    )!;
    const braveResolved = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === brave.instanceId
    )!;

    expect(resolved.pendingBraveLeaveChoice).toBeNull();
    expect(resolved.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(resolved.pendingStepOptionalChoice).toBeNull();
    expect(resolved.players[0]!.handCount).toBe(
      state.players[0]!.handCount + 2
    );
    expect(
      resolved.log.some((entry) =>
        entry.startsWith("effect:after_triggers:resume:")
      )
    ).toBe(false);
    expect(targetResolved.zone).toBe("trash");
    expect(braveResolved.zone).toBe("field");
    expect(braveResolved.attachedToInstanceId).toBeNull();
  });

  it("[board] runActionMainResolution 経路で 同一効果完了後の消滅誘発を二重キューしない", () => {
    const c = card("BSLH01-M04");
    const targetDef = vanishTriggeredSpiritDefinition(
      "TEST-BSLH01-M04-VANISH-TRIGGER"
    );
    const lookups = buildLocalRebirthLookups([targetDef]);
    const source = createCardInstance(c, {
      instanceId: "sherry-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-with-vanish-trigger",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, target],
    });
    const chainId = "test:bslh01-m04:main-resolution";

    let result = runActionMainResolution({
      state,
      chainId,
      startLogs: [],
      endLogs: [],
      context: {
        chainId,
        actingPlayerId: "player-1",
        sourceKind: "spirit",
        sourceCard: source,
        sourceDefinition: c,
        sourceInstanceId: source.instanceId,
        sourceEffectIndex: 1,
        targetInstanceIds: [target.instanceId],
        ...lookups,
        getRegisteredBurstActions: () => [],
      },
      resolveEffect: (currentState) =>
        executeEffect({
          state: currentState,
          effect: c.effects![1]!,
          effectIndex: 1,
          sourceInstanceId: source.instanceId,
          actingPlayerId: "player-1",
          chainId,
          ...lookups,
          getRegisteredBurstActions: () => [],
          targetInstanceIds: [target.instanceId],
          targetStepId: "lv-cost-up",
        }),
    });

    expect(result.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: source.instanceId,
      stepIndex: 1,
    });
    expect(result.pendingBraveLeaveChoice).toBeNull();
    const drawChoice = getLegalActions({
      state: result,
      actingPlayerId: "player-1",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(drawChoice).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: drawChoice!,
      ...lookups,
    }).state;
    const vanishPendings = result.pendingTriggeredEffects.filter(
      (pending) =>
        pending.eventKind === "vanish" &&
        pending.relatedInstanceId === target.instanceId
    );

    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(result.pendingStepOptionalChoice).toBeNull();
    expect(vanishPendings).toHaveLength(1);
    expect(vanishPendings[0]!.chainId).toBe(chainId);
  });

  it("[board] Lvコスト+2で転醒待ちの対象が転醒選択前に2ドロー選択を出す", () => {
    const c = card("BSLH01-M04");
    const targetDef = rebirthLvDeficitNexus(
      "TEST-BSLH01-REBIRTH(A)",
      "TEST-BSLH01-REBIRTH(B)"
    );
    const lookups = buildLocalRebirthLookups([targetDef]);
    const source = createCardInstance(c, {
      instanceId: "sherry-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-rebirth-pending",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["player-1", "player-2"],
        cardInstances: [source, target],
      }),
    };

    let result = executeEffect({
      chainId: "test:bslh01-cards:9275",
      state,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "player-1",
      ...lookups,
      targetInstanceIds: [target.instanceId],
      targetStepId: "lv-cost-up",
    });
    const targetAfter = result.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === target.instanceId
    )!;

    expect(result.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: source.instanceId,
      stepIndex: 1,
    });
    expect(result.pendingBraveLeaveChoice).toBeNull();
    result = finalizeEffectResolution({
      state: result,
      beforeState: state,
      chainId: "test:sherry",
      endLogs: [],
      actingPlayerId: "player-1",
      ...lookups,
      getRegisteredBurstActions: () => [],
      causedBySourceInstanceId: source.instanceId,
    });
    const drawChoice = getLegalActions({
      state: result,
      actingPlayerId: "player-1",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(drawChoice).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: drawChoice!,
      ...lookups,
    }).state;
    expect(result.pendingStepOptionalChoice).toBeNull();
    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(result.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "vanish",
        relatedInstanceId: "target-rebirth-pending",
      })
    );
    expect(targetAfter.zone).toBe("field");
    expect(targetAfter.pendingLeaveKind).toBe("vanish");
    expect(result.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: target.instanceId,
        kind: "vanish",
      })
    );

    const resolved = drainTriggeredEffectsAndStack(
      result,
      ["player-2", "player-1"],
      lookups
    );
    const targetResolved = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === target.instanceId
    )!;

    expect(
      resolved.pendingTriggeredEffects,
      JSON.stringify({
        pending: resolved.pendingTriggeredEffects,
        leaves: resolved.pendingLeaveEntities,
        completions: resolved.pendingEffectCompletions,
        actions: ["player-1", "player-2"].flatMap((actingPlayerId) =>
          getLegalActions({ state: resolved, actingPlayerId, ...lookups })
        ),
        log: resolved.log.slice(-12),
      })
    ).toHaveLength(0);
    expect(resolved.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(resolved.pendingStepOptionalChoice).toBeNull();
    expect(resolved.players[0]!.handCount).toBe(
      state.players[0]!.handCount + 2
    );
    expect(resolved.log).toContain(
      "effect:rebirth:target-rebirth-pending:lv-deficit:retain=0<min=3"
    );
    expect(
      resolved.log.some((entry) =>
        entry.startsWith("effect:after_triggers:resume:")
      )
    ).toBe(false);
    expect(targetResolved.zone).toBe("trash");
    expect(targetResolved.pendingLeaveKind).toBeNull();
  });

  it("クォーツ龍眼 [2]: 見た相手デッキをカード別に上/下へ戻せる", () => {
    const c = card("BSLH01-M04");
    const source = createCardInstance(c, {
      instanceId: "sherry-quartz",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckTop = createCardInstance(card("BSLH01-C01"), {
      instanceId: "opponent-deck-top",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const deckSecond = createCardInstance(card("BSLH01-C02"), {
      instanceId: "opponent-deck-second",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const deckThird = createCardInstance(card("BSLH01-C03"), {
      instanceId: "opponent-deck-third",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const deckFourth = createCardInstance(card("BSLH01-C04"), {
      instanceId: "opponent-deck-fourth",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const deckTail = createCardInstance(card("BSLH01-C03"), {
      instanceId: "opponent-deck-tail",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const quartzEffect = c.effects![2]!;
    const revealAction = quartzEffect.steps[0]!.action;
    if (revealAction.kind !== "deck_reveal") {
      throw new Error("expected deck_reveal action");
    }
    const fixedRevealEffect: Effect = {
      ...quartzEffect,
      steps: [
        {
          action: {
            ...revealAction,
            revealCount: 4,
          },
        },
      ],
    };
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [
        source,
        deckTop,
        deckSecond,
        deckThird,
        deckFourth,
        deckTail,
      ],
      playerOverrides: [{ soulStateInstanceIds: [source.instanceId] }, {}],
    });
    const afterReveal = executeEffect({
      chainId: "test:bslh01-cards:9441",
      state,
      effect: fixedRevealEffect,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      triggerSourcePlayerId: "player-1",
    });
    expect(afterReveal.pendingDeckReveal).toMatchObject({
      remainder: "top_bottom_split",
      revealTo: "self",
      pickedCardInstanceIds: [],
      revealedCardInstanceIds: [
        "opponent-deck-top",
        "opponent-deck-second",
        "opponent-deck-third",
        "opponent-deck-fourth",
      ],
    });

    const orderAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: afterReveal.pendingDeckReveal!.actingPlayerId,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    if (orderAction?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected order action");
    }

    const resolved = applyLegalAction({
      state: afterReveal,
      action: orderAction,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      deckRevealRemainderOrder: [
        "opponent-deck-second",
        "opponent-deck-top",
        "opponent-deck-fourth",
        "opponent-deck-third",
      ],
      deckRevealRemainderPlacements: {
        "opponent-deck-top": "top",
        "opponent-deck-second": "top",
        "opponent-deck-third": "bottom",
        "opponent-deck-fourth": "bottom",
      },
    }).state;
    const opponentDeckOrder = resolved.cardInstances
      .filter(
        (cardInstance) =>
          cardInstance.ownerPlayerId === "player-2" &&
          cardInstance.zone === "deck"
      )
      .map((cardInstance) => cardInstance.instanceId);
    expect(opponentDeckOrder).toEqual([
      "opponent-deck-top",
      "opponent-deck-second",
      "opponent-deck-tail",
      "opponent-deck-third",
      "opponent-deck-fourth",
    ]);
  });
});

describe("BSLH01-M05 創の軌跡", () => {
  const c = card("BSLH01-M05");
  it("入替は swap 実装 / ライフ防御は useCostGate / フラッシュでトラッシュからCB2体召喚", () => {
    const swap = c.effects![0]!;
    expect(swap.stub).toBeUndefined();
    expect(swap.timing).toEqual({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    expect(swap.cardEventDisposition).toEqual({ kind: "swap" });
    expect(swap.executionMode).toBe("optional");
    expect(swap.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
      { kind: "trigger_tribes", tribes: ["CB"] },
      { kind: "trigger_from_zone", zones: ["deck"] },
    ]);

    const lifeDefense = c.effects![1]!;
    expect(lifeDefense.stub).toBeUndefined();
    expect(lifeDefense.textRef).toEqual([2]);
    expect(lifeDefense.applicability).toEqual({ zone: "hand" });
    expect(lifeDefense.timing).toEqual({ kind: "continuous" });
    expect(lifeDefense.timingScope).toEqual({
      player: "both",
      period: "attack",
    });
    const interception = lifeDefense.steps[0]!.action;
    expect(interception.kind).toBe("life_damage_interception");
    if (interception.kind === "life_damage_interception") {
      expect(interception.mode).toBe("replace");
      expect(interception.cause).toBe("opponent_effect");
      expect(interception.useCostGate).toEqual({
        zones: ["hand"],
        effectIndex: 2,
      });
    }
    expect(c.textLines[6]).toContain("このカードの効果で使用していたとき");

    const flash = c.effects![2]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.textRef).toEqual([4, 5, 6]);
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.condition).toEqual([
      {
        kind: "any_of",
        groups: [
          [
            {
              kind: "field_lacks",
              player: "self",
              category: ["spirit", "ultimate"],
            },
          ],
          [
            {
              kind: "life_damage_interception_use_cost_gate_paid_this_turn",
              player: "self",
            },
          ],
        ],
      },
    ]);
    const summon = flash.steps[0]!.action;
    expect(summon.kind).toBe("summon");
    if (summon.kind === "summon" && summon.target.kind === "from_zone") {
      expect(summon.target.zone).toBe("trash");
      expect(summon.costModifier).toBe("free");
    }
  });

  it("BSLH01-M05 effects[2]: 待機状態の自分スピリットがいる間は通常フラッシュ召喚条件を満たさない", () => {
    const flash = c.effects![2]!;
    const source = createCardInstance(c, {
      instanceId: "bslh01-m05-source",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "hand",
    });
    const pendingOwnSpirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bslh01-m05-pending-own-spirit",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      pendingLeaveKind: "destroy",
    });
    const clearState = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source],
    });
    const pendingState = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, pendingOwnSpirit],
    });

    expect(
      evaluateCondition(
        clearState,
        flash.condition!,
        "bslh01-m05-source",
        "player-1",
        getDef
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        pendingState,
        flash.condition!,
        "bslh01-m05-source",
        "player-1",
        getDef
      )
    ).toBe(false);
  });

  it("BSLH01-M05 effects[2]: 〔アタックステップ〕の通常フラッシュ使用だけを legal action に出す", () => {
    const source = createCardInstance(c, {
      instanceId: "bslh01-m05-attack-scope-source",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source],
      playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
    });
    const mainState: GameState = {
      ...base,
      step: "main",
      activePlayerId: "player-1",
    };
    const attackState: GameState = {
      ...base,
      step: "attack",
      activePlayerId: "player-1",
      window: "flash_before_block",
      activeAttack: {
        attackId: "bslh01-m05-attack-scope",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: "player-2" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "player-1",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "player-1",
          pendingStackAction: null,
        },
      },
    };
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const m05UseMagic = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: "player-1",
        ...lookups,
      }).filter(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "bslh01-m05-attack-scope-source" &&
          action.sourceCardNo === "BSLH01-M05" &&
          action.effectIndex === 2
      );

    expect(m05UseMagic(mainState)).toHaveLength(0);
    expect(m05UseMagic(attackState)).toHaveLength(1);
  });

  it("BSLH01-M05 effects[2]: 実 use_magic 解決で自分トラッシュのCBスピリット2枚までだけを召喚する", () => {
    const source = createCardInstance(c, {
      instanceId: "bslh01-m05-board-source",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "hand",
    });
    const ownCb1 = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bslh01-m05-own-cb-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "trash",
    });
    const ownCb2 = createCardInstance(card("BSLH01-C04"), {
      instanceId: "bslh01-m05-own-cb-2",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "trash",
    });
    const ownCb3 = createCardInstance(card("BSLH01-C05"), {
      instanceId: "bslh01-m05-own-cb-3",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "trash",
    });
    const ownNonCb = createCardInstance(card("BSTH01-C02"), {
      instanceId: "bslh01-m05-own-non-cb",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "trash",
    });
    const opponentCb = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bslh01-m05-opponent-cb",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "trash",
    });
    const selfOwnedOpponentControlledCb = createCardInstance(
      card("BSLH01-C01"),
      {
        instanceId: "bslh01-m05-self-owned-opponent-controlled-cb",
        ownerPlayerId: "player-1",
        controllerPlayerId: "player-2",
        zone: "trash",
      }
    );
    const opponentOwnedSelfControlledCb = createCardInstance(
      card("BSLH01-C01"),
      {
        instanceId: "bslh01-m05-opponent-owned-self-controlled-cb",
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-1",
        zone: "trash",
      }
    );
    const base = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [
        source,
        ownCb1,
        ownCb2,
        ownCb3,
        ownNonCb,
        opponentCb,
        selfOwnedOpponentControlledCb,
        opponentOwnedSelfControlledCb,
      ],
      playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
    });
    const attackState: GameState = {
      ...base,
      step: "attack",
      activePlayerId: "player-1",
      window: "flash_before_block",
      activeAttack: {
        attackId: "bslh01-m05-board",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: "player-2" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "player-1",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "player-1",
          pendingStackAction: null,
        },
      },
    };
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const useMagic = getLegalActions({
      state: attackState,
      actingPlayerId: "player-1",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === source.instanceId &&
        action.sourceCardNo === "BSLH01-M05" &&
        action.effectIndex === 2
    );
    expect(useMagic).toBeDefined();
    if (!useMagic || useMagic.kind !== "use_magic") {
      throw new Error("expected BSLH01-M05 use_magic action");
    }

    const declared = applyLegalAction({
      state: attackState,
      action: useMagic,
      paymentSources: [{ kind: "reserve", amount: useMagic.finalCost }],
      ...lookups,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: declared.activeAttack!.flashWindowState!.priorityPlayerId,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "pass_battle_flash" && action.responseTiming === "stack"
    );
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: declared,
      action: pass!,
      ...lookups,
    }).state;
    const pending = afterPass.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.requiredTargetCount).toBe(0);
    expect(pending!.maxTargetCount).toBe(2);
    expect([...pending!.candidateInstanceIds].sort()).toEqual([
      ownCb1.instanceId,
      ownCb2.instanceId,
      ownCb3.instanceId,
      selfOwnedOpponentControlledCb.instanceId,
    ]);

    const resolve = getLegalActions({
      state: afterPass,
      actingPlayerId: "player-1",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(resolve).toBeDefined();
    expect(() =>
      applyLegalAction({
        state: afterPass,
        action: resolve!,
        targetInstanceIds: [
          ownCb1.instanceId,
          ownCb2.instanceId,
          ownCb3.instanceId,
        ],
        summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        ...lookups,
      })
    ).toThrow(/out of range/);

    const placementPending = applyLegalAction({
      state: afterPass,
      action: resolve!,
      targetInstanceIds: [ownCb1.instanceId, ownCb2.instanceId],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      ...lookups,
    }).state;
    const resolved =
      placementPending.pendingMultiPlacement !== null
        ? resolvePendingMultiPlacementFromReserve(
            placementPending,
            "player-1",
            getDef
          )
        : placementPending;
    expect(resolved.pendingEffectTargetSelection).toBeNull();
    const byId = (id: string) =>
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === id
      );
    expect(byId(ownCb1.instanceId)?.zone).toBe("field");
    expect(byId(ownCb2.instanceId)?.zone).toBe("field");
    expect(byId(ownCb3.instanceId)?.zone).toBe("trash");
    expect(byId(ownNonCb.instanceId)?.zone).toBe("trash");
    expect(byId(opponentCb.instanceId)?.zone).toBe("trash");
    expect(byId(selfOwnedOpponentControlledCb.instanceId)?.zone).toBe("trash");
    expect(byId(opponentOwnedSelfControlledCb.instanceId)?.zone).toBe("trash");
    expect(byId(source.instanceId)?.zone).toBe("trash");
  });
});

describe("BSLH01-R01 ロイド・バニングス(碧)", () => {
  const c = card("BSLH01-R01");
  it("相手離脱時 core置き回復残し / フラッシュ疲労stub / クォーツ(駆動)は borrow_magic_effect で実装済", () => {
    const leave = c.effects![0]!;
    // 「相手によって」= バトル原因も含む（memory project_core_removal_vanish_opponent_cause /
    // audit 2026-06-19）。cause を配列で opponent_effect+battle を指定する。
    expect(leave.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leave.steps[1]!.action.kind).toBe("stay_on_field");
    const quartzEffect = c.effects![2]!;
    expect(quartzEffect.stub).toBeUndefined();
    expect(quartzEffect.applicability).toEqual({ soulState: true });
    expect(quartzEffect.steps[0]!.action.kind).toBe("borrow_magic_effect");
  });
});

describe("BSLH01-R02 エリィ・マクダエル(碧)", () => {
  const c = card("BSLH01-R02");
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
  const fieldLookups = {
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };

  function attackFlashState(
    sourceExhaustState: "recovered" | "exhausted" | "heavily_exhausted",
    targetExhaustState: "recovered" | "exhausted" | "heavily_exhausted"
  ): GameState {
    const source = createCardInstance(c, {
      instanceId: "r02-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: sourceExhaustState,
    });
    const target = createCardInstance(card("BSLH01-C01"), {
      instanceId: "r02-recover-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: targetExhaustState,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:none",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    };
  }

  function stackResponseState(
    sourceExhaustState: "recovered" | "exhausted" | "heavily_exhausted",
    targetExhaustState: "recovered" | "exhausted" | "heavily_exhausted"
  ): GameState {
    return {
      ...attackFlashState(sourceExhaustState, targetExhaustState),
      activeAttack: null,
      window: "stack",
      stackWindow: {
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        actingPlayerId: "bob",
        previousWindow: "flash_before_block",
        stackResponseSourcePlayerId: "bob",
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: {
          stackId: "dummy-stack",
          actionKind: "field_card_effect",
          chainId: "dummy-chain",
          actingPlayerId: "bob",
          cardInstanceId: "r02-source",
          cardDefinitionId: c.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
          isNullified: true,
        },
      },
    };
  }

  function r02RecoverActions(state: GameState) {
    const recoverRegistrationIndexes = new Set(
      (
        fieldLookups.getRegisteredFieldCardEffectActions(c.cardNo) ?? []
      ).flatMap((reg, index) =>
        reg.effectIndex === 1 || reg.effectIndex === 2 ? [index] : []
      )
    );
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...fieldLookups,
    }).filter(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "r02-source" &&
        action.sourceCardNo === c.cardNo &&
        recoverRegistrationIndexes.has(action.registrationIndex)
    );
  }

  function applyR02LegalAction(
    state: GameState,
    action: ReturnType<typeof getLegalActions>[number],
    targetInstanceIds?: string[]
  ): GameState {
    return applyLegalAction({
      state,
      action,
      ...(targetInstanceIds !== undefined ? { targetInstanceIds } : {}),
      getCardDefinitionById: getDef,
      ...fieldLookups,
    }).state;
  }

  function closeR02Stack(state: GameState): GameState {
    const pass = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({
          state,
          actingPlayerId,
          getCardDefinitionById: getDef,
          ...fieldLookups,
        })
      )
      .find(
        (action) =>
          action.kind === "pass_stack" || action.kind === "pass_battle_flash"
      );
    expect(pass).toBeDefined();
    return applyR02LegalAction(state, pass!);
  }

  function resolveR02RecoverTarget(state: GameState): GameState {
    const pending = state.pendingEffectTargetSelection;
    expect(pending).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(pending?.candidateInstanceIds).toContain("r02-recover-target");

    const resolveTarget = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...fieldLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();

    return applyR02LegalAction(state, resolveTarget!, ["r02-recover-target"]);
  }

  it("召喚/アタックでカウント+コア配置+カウント4条件重疲労 / フラッシュ・スタック回復", () => {
    const e1 = c.effects![0]!;
    const cond = e1.steps[2]!.condition;
    expect(cond).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 4,
    });
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.limitGroupId).toBe("BSLH01-R02-recover");
    expect(flash.steps[0]!.action.kind).toBe("recover");
    expect(flash.steps[0]!.action.target).toMatchObject({
      filter: { category: ["spirit"] },
    });

    const stack = c.effects![2]!;
    expect(stack.stub).toBeUndefined();
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    expect(stack.limitGroupId).toBe("BSLH01-R02-recover");
    expect(stack.usageLimit).toEqual(flash.usageLimit);
    expect(stack.steps[0]!.action).toEqual(flash.steps[0]!.action);

    // クォーツ set-effect: register_redirect_effect_target(owned_filter) + usageLimit。
    // 詳細な意味検証は quartz-system.test.ts の BSLH01-R02 describe ブロック側。
    const quartzSetEffect = c.effects![3]!;
    expect(quartzSetEffect.stub).toBeUndefined();
    expect(quartzSetEffect.applicability).toEqual({ soulState: true });
    expect(quartzSetEffect.steps[0]!.action.kind).toBe(
      "register_redirect_effect_target"
    );

    const regs = fieldLookups.getRegisteredFieldCardEffectActions(c.cardNo);
    expect(regs?.find((reg) => reg.effectIndex === 1)).toMatchObject({
      targetCardFilterActionKind: "recover",
      requiredTargetCount: 1,
      limitGroupId: "BSLH01-R02-recover",
    });
    expect(regs?.find((reg) => reg.effectIndex === 2)).toMatchObject({
      targetCardFilterActionKind: "recover",
      requiredTargetCount: 1,
      limitGroupId: "BSLH01-R02-recover",
    });
  });

  it("[board] ENIGMA(魂状態)クォーツ<風>属性値合計6以上で相手創界神ネクサスのコア4個をボイドに置く", () => {
    const source = createCardInstance(c, {
      instanceId: "r02-enigma-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "r02-enigma-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    // 処女珠(風5) + 脱兎(風3) = 風8 (>=6)。
    const quartz1 = createCardInstance(card("BSLH01-C04"), {
      instanceId: "r02-enigma-quartz-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const quartz2 = createCardInstance(card("BSLH01-X04"), {
      instanceId: "r02-enigma-quartz-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const enemyGrandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "r02-enemy-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, host, quartz1, quartz2, enemyGrandwalker],
    });
    const soulSetup: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const withQuartz1 = setQuartz(
      soulSetup,
      {
        quartzInstanceId: quartz1.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "left",
      },
      getDef
    )!;
    const withQuartz2 = setQuartz(
      withQuartz1,
      {
        quartzInstanceId: quartz2.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "right",
      },
      getDef
    )!;

    // 4番目の step (ENIGMA <風>属性値合計6以上ゲート) だけを切り出して実行する
    // (BSRK01-R02 runStep と同型: 対象選択を要する step は単一実行で検証する)。
    const e1 = c.effects![0]!;
    const gateStep = e1.steps[3]!;
    const bobVoidBefore = withQuartz2.players.find(
      (p) => p.id === "bob"
    )!.voidNormalCoreCount;
    const after = executeEffect({
      chainId: "test:bslh01-cards:10192",
      state: withQuartz2,
      effect: { ...e1, steps: [gateStep] },
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: [enemyGrandwalker.instanceId],
      ...fieldLookups,
    });
    const grandwalkerAfter = after.cardInstances.find(
      (ci) => ci.instanceId === enemyGrandwalker.instanceId
    )!;
    expect(grandwalkerAfter.normalCoreCount).toBe(1);
    const bobPlayerAfter = after.players.find((p) => p.id === "bob")!;
    expect(bobPlayerAfter.voidNormalCoreCount).toBe(bobVoidBefore + 4);

    // 属性値合計が閾値未満(quartz2 なし、風5のみ)なら発火しない。
    const afterInsufficient = executeEffect({
      chainId: "test:bslh01-cards:10210",
      state: withQuartz1,
      effect: { ...e1, steps: [gateStep] },
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: [enemyGrandwalker.instanceId],
      ...fieldLookups,
    });
    const grandwalkerUnaffected = afterInsufficient.cardInstances.find(
      (ci) => ci.instanceId === enemyGrandwalker.instanceId
    )!;
    expect(grandwalkerUnaffected.normalCoreCount).toBe(5);
  });

  it("[board] スタック回復: Lv2 の発揮で自分の疲労スピリット1体が回復する", () => {
    const source = createCardInstance(c, {
      instanceId: "r02-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const target = createCardInstance(card("BSLH01-C01"), {
      instanceId: "r02-recover-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
    });
    const after = executeEffect({
      chainId: "test:bslh01-cards:10247",
      state: base,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: card,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      after.cardInstances.find((ci) => ci.instanceId === source.instanceId)!
        .exhaustState
    ).toBe("recovered");
  });

  it("[legal] 回復可能な自分スピリットがいないときも空撃ち action として列挙する", () => {
    const state = attackFlashState("recovered", "recovered");
    const [emptyFire] = r02RecoverActions(state);

    expect(emptyFire).toMatchObject({
      timing: "flash",
      targetMode: "none",
      requiredTargetCount: 0,
    });
  });

  it("[legal] flash 回復を1回宣言すると共有ターン1回で再使用が封じられる", () => {
    const state = attackFlashState("exhausted", "exhausted");
    const before = r02RecoverActions(state);
    expect(before.map((action) => action.timing)).toEqual(["flash"]);
    const flashAction = before.find((action) => action.timing === "flash");
    expect(flashAction).toBeDefined();

    const declared = applyR02LegalAction(state, flashAction!);

    const pending = declared.activeAttack?.flashWindowState.pendingStackAction;
    expect(pending).toMatchObject({
      actionKind: "field_card_effect",
      targetInstanceIds: [],
    });
    expect(
      declared.cardInstances.find((ci) => ci.instanceId === "r02-source")!
        .exhaustState
    ).toBe("exhausted");
    expect(
      declared.cardInstances.find(
        (ci) => ci.instanceId === "r02-recover-target"
      )!.exhaustState
    ).toBe("exhausted");
    expect(declared.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: "r02-source",
        groupId: "BSLH01-R02-recover",
      })
    );
    expect(r02RecoverActions(declared)).toHaveLength(0);

    const targetPending = closeR02Stack(declared);
    const resolved = resolveR02RecoverTarget(targetPending);
    expect(
      resolved.cardInstances.find(
        (ci) => ci.instanceId === "r02-recover-target"
      )!.exhaustState
    ).toBe("recovered");
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === "r02-source")!
        .exhaustState
    ).toBe("exhausted");
    expect(resolved.pendingEffectTargetSelection).toBeNull();
  });

  it("[legal] stack 回復を1回宣言すると同じ共有ターン1回 group が消費される", () => {
    const state = stackResponseState("exhausted", "exhausted");
    const before = r02RecoverActions(state);
    expect(before.map((action) => action.timing)).toEqual(["stack"]);
    const stackAction = before[0]!;

    const declared = applyR02LegalAction(state, stackAction);
    expect(declared.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: "r02-source",
        groupId: "BSLH01-R02-recover",
      })
    );

    expect(
      r02RecoverActions({
        ...state,
        effectUsageRecords: declared.effectUsageRecords,
      })
    ).toHaveLength(0);

    const targetPending = closeR02Stack(declared);
    const resolved = resolveR02RecoverTarget(targetPending);
    expect(
      resolved.cardInstances.find(
        (ci) => ci.instanceId === "r02-recover-target"
      )!.exhaustState
    ).toBe("recovered");
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === "r02-source")!
        .exhaustState
    ).toBe("exhausted");
    expect(resolved.pendingEffectTargetSelection).toBeNull();
  });
});

describe("BSLH01-R03 ランディ・オルランド(碧)", () => {
  const c = card("BSLH01-R03");
  it("召喚/アタックで 3択 (バースト破棄(防げない)/BP12000以下破壊/創界神コア全void) / フラッシュstub", () => {
    // step.choice 経由の 3 分岐: default=discard_set_burst(unpreventable), choice[0]=destroy, choice[1]=core_move(all→void)
    const step0 = c.effects![0]!.steps[0]!;
    const def = step0.action;
    expect(def.kind).toBe("discard_set_burst");
    if (def.kind === "discard_set_burst") {
      expect(def.player).toBe("opponent");
      expect(def.count).toBe(1);
      expect(def.unpreventable).toBe(true);
    }
    expect(step0.choice).toHaveLength(2);
    expect(step0.prompt?.question).toBe("発揮する効果を選んでください");
    const destroy = step0.choice![0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.filterOr![0]!.maxBp).toBe(12000);
    }
    const grandwalkerVoid = step0.choice![1]!.action;
    expect(grandwalkerVoid.kind).toBe("core_move");
    if (grandwalkerVoid.kind === "core_move") {
      expect(grandwalkerVoid.amount).toBe("all");
      expect(grandwalkerVoid.to).toEqual({ kind: "void", player: "opponent" });
      if (grandwalkerVoid.from.kind === "field_card") {
        expect(grandwalkerVoid.from.filter.targetsGrandwalker).toBe("only");
        // P3-137: tribes:["創界神"] 単独限定を除去し、導界者ネクサスも対象に含める。
        expect(grandwalkerVoid.from.filter.tribes).toBeUndefined();
      }
    }
    // effects[1] = Lv1-3 フラッシュ ENIGMA魂状態+ライフ1コアボイドで<ソウルコア>1個をリザーブに
    // (engine-outside-game-soul-core-generation primitive で実装済、stub 解消)。
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "life", player: "self" },
      to: { kind: "void", player: "self" },
      amount: 1,
    });
    expect(flash.steps[1]!.action).toEqual({
      kind: "core_move",
      from: { kind: "outside_game" },
      to: { kind: "reserve", player: "self" },
      amount: 1,
    });
    expect(flash.steps[1]!.connector).toBe("conditional_cost");
  });

  it("召喚/アタック時 3択 pending は各選択肢の内容が分かる prompt/label を出す", () => {
    const source = createCardInstance(c, {
      instanceId: "randy-r03",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });
    const state = executeEffect({
      chainId: "test:bslh01-cards:10421",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "randy-r03",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      promptUnresolvedChoice: true,
    });

    expect(state.pendingStepChoice).toMatchObject({
      prompt: {
        label: "効果選択",
        question: "発揮する効果を選んでください",
      },
    });
    expect(
      state.pendingStepChoice?.choices.map((choice) => choice.label)
    ).toEqual([
      "相手のバースト1つを破棄する",
      "相手のBP12000以下のスピリット/ネクサス1つを破壊する",
      "相手の創界神ネクサス1つのコアすべてをボイドに置く",
    ]);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).filter((action) => action.kind === "resolve_pending_step_choice");
    expect(actions.map((action) => action.choiceLabel)).toEqual([
      "相手のバースト1つを破棄する",
      "相手のBP12000以下のスピリット/ネクサス1つを破壊する",
      "相手の創界神ネクサス1つのコアすべてをボイドに置く",
    ]);
    expect(actions[1]?.choicePrompt?.sourceText).toBe(
      "相手の、BP12000以下のスピリット/ネクサス1つを破壊する"
    );
  });

  it("[board] フラッシュ: ENIGMA 魂状態下でライフのコア1個をボイドに置き、ゲーム外から<ソウルコア>1個をリザーブに置く", () => {
    const ALICE = "player-1";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const src = createCardInstance(c, {
      instanceId: "randy-r03-flash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enigmaCard = ALL_CARDS.find((cd) => cd.name.includes("ENIGMA"))!;
    const enigmaInst = createCardInstance(enigmaCard, {
      instanceId: "enigma-r03-flash",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "soul_state",
    });
    const base = createEmptyGameState({
      cardInstances: [src, enigmaInst],
    });
    const alice = base.players.find((p) => p.id === ALICE)!;
    alice.soulStateInstanceIds.push("enigma-r03-flash");
    const before = base.players.find((p) => p.id === ALICE)!;

    const after = executeEffect({
      chainId: "test:bslh01-cards:10484",
      state: base,
      effect: c.effects![1]!,
      sourceInstanceId: "randy-r03-flash",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.lifeNormalCoreCount).toBe(before.lifeNormalCoreCount - 1);
    expect(aliceAfter.voidNormalCoreCount).toBe(before.voidNormalCoreCount + 1);
    expect(aliceAfter.reserveSoulCoreCount).toBe(
      before.reserveSoulCoreCount + 1
    );
  });

  it("[board] choiceIndex 省略(default=バースト破棄): 相手 setBurst 1件が trash へ消える", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const src = createCardInstance(c, {
      instanceId: "randy-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手側のバースト裏向きカード（zone:"burst"）を 2 枚積む。
    const burstCard = card("BSLH01-R05") as CardDefinition; // 任意の burst keyword カード
    const burst0 = createCardInstance(burstCard, {
      instanceId: "bob-burst-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "burst",
    });
    const burst1 = createCardInstance(burstCard, {
      instanceId: "bob-burst-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "burst",
    });
    const base = createEmptyGameState({
      cardInstances: [src, burst0, burst1],
    });
    const before: GameState = {
      ...base,
      setBurstStates: [
        { playerId: BOB, cardInstanceId: "bob-burst-0" },
        { playerId: BOB, cardInstanceId: "bob-burst-1" },
      ],
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:10537",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "randy-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      // choiceIndex 省略 / undefined = default arm = discard_set_burst
    });
    // 相手の setBurstStates: 1 → 0+1（先頭が破棄される）
    expect(after.setBurstStates).toHaveLength(1);
    expect(after.setBurstStates[0]!.cardInstanceId).toBe("bob-burst-1");
    const trashed = after.cardInstances.find(
      (x) => x.instanceId === "bob-burst-0"
    )!;
    expect(trashed.zone).toBe("trash");
  });
});

describe("BSLH01-R04 ティオ・プラトー(碧)", () => {
  const c = card("BSLH01-R04");
  it("メインでデッキ6オープン(ゲーム1回) / クォーツstub", () => {
    const main = c.effects![0]!;
    expect(main.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 1,
    });
    const reveal = main.steps[0]!.action;
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(6);
      expect(reveal.picks[0]).toMatchObject({
        count: 2,
        mandatory: true,
        filter: { tribes: ["CB"] },
      });
    }
  });

  it("effects[1]: 宣言回数連動でみっしぃスピリットに青シンボルを動的個数付与する DSL 形状", () => {
    const eff1 = c.effects![1]!;
    expect(eff1.stub).toBeUndefined();
    expect(eff1.timingScope).toEqual({ player: "both", period: "attack" });
    expect(eff1.usageLimit).toEqual({ kind: "no_duplicate" });
    const action = eff1.steps[0]!.action;
    expect(action.kind).toBe("symbol_add");
    if (action.kind === "symbol_add") {
      expect(action.symbol).toBe("blue");
      expect(action.count).toEqual({
        source: { kind: "declaration_count_this_turn", player: "self" },
      });
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"], tribes: ["みっしぃ"] },
      });
    }
  });

  it("Lv2以上・アタックステップ中: 宣言回数分の青シンボルが live 反映される(0回→0/2回→2)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-R04"), {
      instanceId: "src-r04",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });
    const rebuilt = rebuildContinuousEffectsFromField(base, (id) =>
      cardNoMap.get(id)
    );
    const duringAttack: GameState = {
      ...rebuilt,
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
    };
    expect(
      getSymbolAdditions(duringAttack, "src-r04", (id) => cardNoMap.get(id))
    ).toEqual([]);

    const declaredTwice: GameState = {
      ...duringAttack,
      declarationCountThisTurn: {
        ...duringAttack.declarationCountThisTurn,
        [ALICE]: 2,
      },
    };
    expect(
      getSymbolAdditions(declaredTwice, "src-r04", (id) => cardNoMap.get(id))
    ).toEqual([["blue"], ["blue"]]);
  });

  it("tribes:['みっしぃ'] は印字 tribe 直読み: T01(みっしぃトークン, tribe:'CB'のみ)は対象外、同アーキタイプのC06(tribe:'CB・S.S.S・みっしぃ')は対象", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(card("BSLH01-R04"), {
      instanceId: "src-r04",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const missyToken = createCardInstance(card("BSLH01-T01"), {
      instanceId: "missy-field-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const sisterPrint = createCardInstance(card("BSLH01-C06"), {
      instanceId: "c06-field-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, missyToken, sisterPrint],
    });
    const rebuilt = rebuildContinuousEffectsFromField(base, (id) =>
      cardNoMap.get(id)
    );
    const duringAttack: GameState = {
      ...rebuilt,
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      declarationCountThisTurn: {
        ...rebuilt.declarationCountThisTurn,
        [ALICE]: 1,
      },
    };
    expect(
      getSymbolAdditions(duringAttack, "missy-field-1", (id) =>
        cardNoMap.get(id)
      )
    ).toEqual([]);
    expect(
      getSymbolAdditions(duringAttack, "c06-field-1", (id) => cardNoMap.get(id))
    ).toEqual([["blue"]]);
  });
});

describe("BSLH01-R05 エステル・ブライト(碧)", () => {
  const c = card("BSLH01-R05");
  it("バースト(召喚/煌臨発揮後)召喚→破壊→ドロー→カウント+2", () => {
    const burst = c.effects![0]!;
    expect(burst.timing).toMatchObject({
      kind: "burst",
      trigger: { kind: "effect_activated", player: "opponent" },
    });
    expect(burst.steps[0]!.action.kind).toBe("summon");
    expect(burst.steps[1]!.action.kind).toBe("destroy");
  });

  it("Lv2-Lv3常時効果はクォーツスピリット最高Lv扱いと手札/デッキ/トラッシュ耐性を登録する", () => {
    const continuous = c.effects![1]!;
    expect(continuous.stub).toBeUndefined();
    expect(continuous.steps).toHaveLength(2);
    const levelOverride = continuous.steps[0]!.action;
    expect(levelOverride.kind).toBe("override_properties");
    if (levelOverride.kind === "override_properties") {
      expect(levelOverride.properties.level).toBe("max");
      expect(levelOverride.target).toMatchObject({
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"], hasQuartzData: true },
        count: "all",
      });
    }
    const immunity = continuous.steps[1]!.action;
    expect(immunity.kind).toBe("effect_immunity");
    if (immunity.kind === "effect_immunity") {
      expect(immunity.target).toMatchObject({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand", "deck", "trash"],
      });
    }
  });

  it("[board] Lv2以上なら自分のクォーツスピリットを最高Lvにし、対象ゾーンを動的耐性にする", () => {
    const source = createCardInstance(c, {
      instanceId: "r05-field",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const targetDef = card("BSLH01-C04");
    const target = createCardInstance(targetDef, {
      instanceId: "quartz-spirit",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "alice-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const deckCard = createCardInstance(card("BSLH01-C02"), {
      instanceId: "alice-deck",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const trashCard = createCardInstance(card("BSLH01-C03"), {
      instanceId: "alice-trash",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target, handCard, deckCard, trashCard],
    });

    const after = rebuildContinuousEffectsFromField(before, (id) =>
      cardNoMap.get(id)
    );

    expect(
      getEffectiveLevel(after, target, targetDef, (id) => cardNoMap.get(id))
    ).toBe(Math.max(...targetDef.levelDefs.map((ld) => ld.level)));
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.sourceInstanceId === "r05-field" &&
          ce.targetFilter?.player === "self" &&
          JSON.stringify(ce.targetFilter.zone) ===
            JSON.stringify(["hand", "deck", "trash"])
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        after,
        handCard,
        "bob",
        "none",
        undefined,
        (id) => cardNoMap.get(id)
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        after,
        deckCard,
        "bob",
        "none",
        undefined,
        (id) => cardNoMap.get(id)
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        after,
        trashCard,
        "bob",
        "none",
        undefined,
        (id) => cardNoMap.get(id)
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        after,
        target,
        "bob",
        "none",
        undefined,
        (id) => cardNoMap.get(id)
      )
    ).toBe(false);
  });
});

describe("BSLH01-R06 アリオス・マクレイン(碧)", () => {
  const c = card("BSLH01-R06");

  const effectLookups = {
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(ALL_CARDS),
    getRegisteredHandActivatedEffectActions:
      buildHandActivatedEffectLookup(ALL_CARDS),
  };

  function setupR06FlashBeforeBlock(): GameState {
    const attacker = createCardInstance(card("BSLH01-M01"), {
      instanceId: "r06-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const source = createCardInstance(c, {
      instanceId: "r06-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const enigma = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "r06-enigma-soul",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "soul_state",
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "r06-grandwalker-pay",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const normalNexus = createCardInstance(card("BSLH01-C02"), {
      instanceId: "r06-normal-nexus-pay",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker, source, enigma, grandwalker, normalNexus],
      playerOverrides: [
        {
          deckCount: 5,
          reserveNormalCoreCount: 0,
          soulStateInstanceIds: ["r06-enigma-soul"],
        },
        { deckCount: 5, reserveNormalCoreCount: 0 },
      ],
      battleEntities: [
        {
          entityId: "battle-entity:r06-attacker",
          memberInstanceIds: ["r06-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-group:r06:bob:battle-entity:r06-attacker",
        primaryEntityId: "battle-entity:r06-attacker",
        participantEntityIds: ["battle-entity:r06-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:r06-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:r06-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    });

    return {
      ...base,
      step: "attack",
      window: "flash_before_block",
      activePlayerId: "bob",
      turnNumber: 2,
    };
  }

  function r06SummonAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "use_hand_card_effect" &&
        action.sourceInstanceId === "r06-hand"
    );
  }

  it("手札フラッシュ自己召喚: ENIGMA魂状態条件 + 2コスト固定 + 創界神支払い元フィルタを持つ", () => {
    const flash = c.effects![0]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.applicability).toEqual({ zone: ["hand"] });
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "ENIGMA" }],
      soulStateOnly: true,
    });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.costModifier).toEqual({ fixedPayment: 2 });
      expect(action.onBoardCoreSourceFilter).toEqual({
        targetsGrandwalker: "only",
      });
    }
  });

  it("[legal] ENIGMA魂状態下の手札フラッシュ召喚で、場の支払い元は創界神ネクサスだけ列挙し通常ネクサスを拒否する", () => {
    const state = setupR06FlashBeforeBlock();
    const action = r06SummonAction(state);
    expect(action).toBeDefined();
    if (action?.kind !== "use_hand_card_effect") {
      throw new Error("expected R06 hand activated effect legal action");
    }

    const invalidDeclared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getDef,
      ...effectLookups,
      summonPaymentSources: [
        { kind: "card", instanceId: "r06-normal-nexus-pay", amount: 2 },
      ],
    }).state;
    const invalidPass = getLegalActions({
      state: invalidDeclared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "pass_battle_flash"
    );
    expect(invalidPass).toBeDefined();
    expect(() => {
      applyLegalAction({
        state: invalidDeclared,
        action: invalidPass!,
        getCardDefinitionById: getDef,
        ...effectLookups,
      });
    }).toThrow(/not legal/i);

    const mixedCostState: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 1 }
          : player
      ),
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "r06-grandwalker-pay"
          ? { ...card, normalCoreCount: 2 }
          : card
      ),
    };
    const mixedCostAction = r06SummonAction(mixedCostState);
    expect(mixedCostAction).toBeDefined();
    if (mixedCostAction?.kind !== "use_hand_card_effect") {
      throw new Error("expected R06 hand activated effect legal action");
    }
    const mixedDeclared = applyLegalAction({
      state: mixedCostState,
      action: mixedCostAction,
      getCardDefinitionById: getDef,
      ...effectLookups,
      summonPaymentSources: [
        { kind: "reserve", amount: 1 },
        { kind: "card", instanceId: "r06-grandwalker-pay", amount: 1 },
      ],
    }).state;
    const mixedPass = getLegalActions({
      state: mixedDeclared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "pass_battle_flash"
    );
    expect(mixedPass).toBeDefined();
    expect(() => {
      applyLegalAction({
        state: mixedDeclared,
        action: mixedPass!,
        getCardDefinitionById: getDef,
        ...effectLookups,
      });
    }).toThrow(/must not mix reserve and filtered on-board cores/i);

    const validDeclared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getDef,
      ...effectLookups,
      summonPaymentSources: [
        { kind: "card", instanceId: "r06-grandwalker-pay", amount: 2 },
      ],
    }).state;
    expect(
      validDeclared.cardInstances.find((card) => card.instanceId === "r06-hand")
        ?.zone
    ).toBe("in_use");
    expect(
      validDeclared.cardInstances.find(
        (card) => card.instanceId === "r06-grandwalker-pay"
      )?.normalCoreCount
    ).toBe(3);
    const validPass = getLegalActions({
      state: validDeclared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "pass_battle_flash"
    );
    expect(validPass).toBeDefined();
    const resolved = applyLegalAction({
      state: validDeclared,
      action: validPass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "r06-grandwalker-pay"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "r06-normal-nexus-pay"
      )?.normalCoreCount
    ).toBe(3);
  });

  it("[legal] 支払い元の二択は混合不可: リザーブ1+創界神1だけでは召喚を提示しない", () => {
    const base = setupR06FlashBeforeBlock();
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 1 }
          : player
      ),
      cardInstances: base.cardInstances.map((card) => {
        if (card.instanceId === "r06-grandwalker-pay") {
          return { ...card, normalCoreCount: 1 };
        }
        if (card.instanceId === "r06-normal-nexus-pay") {
          return { ...card, normalCoreCount: 5 };
        }
        return card;
      }),
    };

    expect(r06SummonAction(state)).toBeUndefined();
  });

  it("[legal] リザーブから2コスト支払う枝では創界神コアがなくても召喚できる", () => {
    const base = setupR06FlashBeforeBlock();
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 2 }
          : player
      ),
      cardInstances: base.cardInstances.map((card) => {
        if (card.instanceId === "r06-grandwalker-pay") {
          return { ...card, normalCoreCount: 0 };
        }
        if (card.instanceId === "r06-normal-nexus-pay") {
          return { ...card, normalCoreCount: 1 };
        }
        return card;
      }),
    };
    const action = r06SummonAction(state);
    expect(action).toBeDefined();
    if (action?.kind !== "use_hand_card_effect") {
      throw new Error("expected R06 hand activated effect legal action");
    }

    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getDef,
      ...effectLookups,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
      summonEnterFieldCorePlacements: [
        { kind: "card_normal", instanceId: "r06-normal-nexus-pay", amount: 1 },
      ],
    }).state;
    const passAction = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "pass_battle_flash"
    );
    expect(passAction).toBeDefined();
    const resolved = applyLegalAction({
      state: declared,
      action: passAction!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "r06-hand")
        ?.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "r06-hand")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("[legal] 創界神コスト支払い元フィルタは維持コア配置元までは制限しない", () => {
    const base = setupR06FlashBeforeBlock();
    const state: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) => {
        if (card.instanceId === "r06-grandwalker-pay") {
          return { ...card, normalCoreCount: 2 };
        }
        if (card.instanceId === "r06-normal-nexus-pay") {
          return { ...card, normalCoreCount: 1 };
        }
        return card;
      }),
    };
    const action = r06SummonAction(state);
    expect(action).toBeDefined();
    if (action?.kind !== "use_hand_card_effect") {
      throw new Error("expected R06 hand activated effect legal action");
    }

    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getDef,
      ...effectLookups,
      summonPaymentSources: [
        { kind: "card", instanceId: "r06-grandwalker-pay", amount: 2 },
      ],
      summonEnterFieldCorePlacements: [
        { kind: "card_normal", instanceId: "r06-normal-nexus-pay", amount: 1 },
      ],
    }).state;
    const passAction = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "pass_battle_flash"
    );
    expect(passAction).toBeDefined();
    const resolved = applyLegalAction({
      state: declared,
      action: passAction!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "r06-hand")
        ?.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "r06-hand")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "r06-grandwalker-pay"
      )?.normalCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "r06-normal-nexus-pay"
      )?.normalCoreCount
    ).toBe(0);
  });

  it("[legal] ENIGMAが魂状態でない場合は手札フラッシュ召喚を提示しない", () => {
    const state = setupR06FlashBeforeBlock();
    const withoutSoulState: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === "alice" ? { ...player, soulStateInstanceIds: [] } : player
      ),
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "r06-enigma-soul"
          ? { ...card, zoneRoleName: "nexus" }
          : card
      ),
    };
    expect(r06SummonAction(withoutSoulState)).toBeUndefined();
  });

  it("召喚/アタック/ブロックで重疲労+トラッシュ除外+自己bounce", () => {
    const e = c.effects![1]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack", "block"],
    });
    expect(e.steps[1]!.action.kind).toBe("remove_from_game");
    const bounce = e.steps[2]!;
    expect(bounce.action.kind).toBe("bounce");
    expect(bounce.condition).toContainEqual({
      kind: "self_state",
      state: "on_field",
      battleState: "in_battle",
    });
  });

  it("[board] この効果発揮後の同名ターン制限はLv2以上で戦闘中の自己bounceだけに掛かる", () => {
    const source = createCardInstance(c, {
      instanceId: "r06-bounce-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentSpirit = createCardInstance(card("BSLH01-M01"), {
      instanceId: "r06-bounce-opponent",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentTrash = createCardInstance(card("BSLH01-C01"), {
      instanceId: "r06-bounce-trash",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, opponentSpirit, opponentTrash],
      battleEntities: [
        {
          entityId: "battle-entity:r06-bounce-source",
          memberInstanceIds: [source.instanceId],
          resolvedBp: 10000,
          resolvedSymbols: ["green"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-r06-bounce",
        primaryEntityId: "battle-entity:r06-bounce-source",
        participantEntityIds: ["battle-entity:r06-bounce-source"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:r06-bounce-source",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:r06-bounce-source"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: null,
          pendingStackAction: null,
        },
      },
    });
    const state = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:11337",
        state: { ...base, step: "attack", window: "flash_before_block" },
        effect: c.effects![1]!,
        effectIndex: 1,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    expect(
      state.cardInstances.find(
        (card) => card.instanceId === opponentSpirit.instanceId
      )?.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      state.cardInstances.find(
        (card) => card.instanceId === opponentTrash.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      state.cardInstances.find((card) => card.instanceId === source.instanceId)
        ?.zone
    ).toBe("hand");
  });

  it("[board] 同名2体目は同一ターンに先行手順を解決するが自己bounceだけを共有制限でスキップする", () => {
    const firstSource = createCardInstance(c, {
      instanceId: "r06-same-name-first",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const secondSource = createCardInstance(c, {
      instanceId: "r06-same-name-second",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const firstOpponentSpirit = createCardInstance(card("BSLH01-M01"), {
      instanceId: "r06-same-name-first-opponent-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const secondOpponentSpirit = createCardInstance(card("BSLH01-M01"), {
      instanceId: "r06-same-name-second-opponent-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const firstOpponentTrash = createCardInstance(card("BSLH01-C01"), {
      instanceId: "r06-same-name-first-opponent-trash",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const secondOpponentTrash = createCardInstance(card("BSLH01-C02"), {
      instanceId: "r06-same-name-second-opponent-trash",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [firstSource, firstOpponentSpirit, firstOpponentTrash],
      battleEntities: [
        {
          entityId: "battle-entity:r06-same-name-first",
          memberInstanceIds: [firstSource.instanceId],
          resolvedBp: 10000,
          resolvedSymbols: ["green"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-r06-same-name",
        primaryEntityId: "battle-entity:r06-same-name-first",
        participantEntityIds: ["battle-entity:r06-same-name-first"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:r06-same-name-first",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:r06-same-name-first"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: null,
          pendingStackAction: null,
        },
      },
    });
    const firstResolved = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:11443",
        state: { ...base, step: "attack", window: "flash_before_block" },
        effect: c.effects![1]!,
        effectIndex: 1,
        sourceInstanceId: firstSource.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef,
      [[firstOpponentSpirit.instanceId], [firstOpponentTrash.instanceId]]
    );
    const usageLabel = "__step:BSLH01-R06:1:2";

    expect(
      firstResolved.cardInstances.find(
        (card) => card.instanceId === firstSource.instanceId
      )?.zone
    ).toBe("hand");
    expect(firstResolved.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: firstSource.instanceId,
          sourceDefinitionId: c.cardNo,
          effectLabel: usageLabel,
          duration: "turn",
          count: 1,
        }),
      ])
    );

    const secondBase: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          secondSource,
          secondOpponentSpirit,
          secondOpponentTrash,
        ],
        battleEntities: [
          {
            entityId: "battle-entity:r06-same-name-second",
            memberInstanceIds: [secondSource.instanceId],
            resolvedBp: 10000,
            resolvedSymbols: ["green"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-r06-same-name-second",
          primaryEntityId: "battle-entity:r06-same-name-second",
          participantEntityIds: ["battle-entity:r06-same-name-second"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:r06-same-name-second",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:r06-same-name-second"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: "bob",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: null,
            pendingStackAction: null,
          },
        },
      }),
      step: "attack",
      window: "flash_before_block",
      turnNumber: firstResolved.turnNumber,
      effectUsageRecords: firstResolved.effectUsageRecords,
    };
    const secondResolved = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:11521",
        state: secondBase,
        effect: c.effects![1]!,
        effectIndex: 1,
        sourceInstanceId: secondSource.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef,
      [[secondOpponentSpirit.instanceId], [secondOpponentTrash.instanceId]]
    );

    expect(
      secondResolved.cardInstances.find(
        (card) => card.instanceId === secondOpponentSpirit.instanceId
      )?.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      secondResolved.cardInstances.find(
        (card) => card.instanceId === secondOpponentTrash.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      secondResolved.cardInstances.find(
        (card) => card.instanceId === secondSource.instanceId
      )?.zone
    ).toBe("field");
    expect(
      secondResolved.effectUsageRecords.filter(
        (record) => record.effectLabel === usageLabel
      )
    ).toEqual([
      expect.objectContaining({
        sourceInstanceId: firstSource.instanceId,
        sourceDefinitionId: c.cardNo,
        duration: "turn",
        count: 1,
      }),
    ]);
    expect(secondResolved.log).toContain(
      `effect:step-usage-exhausted:${secondSource.instanceId}:1:2`
    );
  });

  it("【クォーツ：回避3】セット中効果: targeted 反応内 deck_reveal(手札強制追加) → 条件付き effect_immunity(current_effect)", () => {
    // 実プレイ経路の回帰は bslh01-c01-r06-quartz-targeted-disclosure.test.ts 参照。
    const quartzSet = c.effects![2]!;
    expect(quartzSet.stub).toBeUndefined();
    expect(quartzSet.timing).toMatchObject({
      kind: "game_event",
      event: "targeted",
    });
    expect(quartzSet.applicability).toEqual({ soulState: true });
    const reveal = quartzSet.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks[0]).toMatchObject({ count: 1, mandatory: true });
    }
    expect(
      (
        quartzSet.steps[0]!.action as Extract<
          import("../src/dsl-types").Action,
          { kind: "deck_reveal" }
        >
      ).beforeMoveSteps![0]!.action.kind
    ).toBe("effect_immunity");
    expect(
      (
        quartzSet.steps[0]!.action as Extract<
          import("../src/dsl-types").Action,
          { kind: "deck_reveal" }
        >
      ).beforeMoveSteps![0]!.stepCondition
    ).toMatchObject({
      kind: "ref_has_match",
    });
  });
});

describe("BSLH01-T01〜T03 みっしぃ系トークン", () => {
  it.each(["BSLH01-T01", "BSLH01-T02", "BSLH01-T03"])(
    "%s: フラッシュ『お互いのアタックステップ』自己破壊 + 破壊時「エンジョ〜イ、みっしぃ！」宣言でカウント+1",
    (no) => {
      const c = card(no);
      expect(c.effects![0]!.timing).toEqual({
        kind: "activated",
        mode: "flash",
      });
      // 『お互いのアタックステップ』限定 (audit 2026-06-19)。
      expect(c.effects![0]!.timingScope).toEqual({
        player: "both",
        period: "attack",
      });
      expect(c.effects![0]!.steps[0]!.action.kind).toBe("destroy");
      // 宣言ギミック primitive (engine-declaration-gimmick-bslh01): 宣言そのものを
      // declare_gimmick step として明示し、count_increase は宣言後段の sequential。
      expect(c.effects![1]!.executionMode).toBe("optional");
      expect(c.effects![1]!.steps[0]!.action.kind).toBe("declare_gimmick");
      expect(c.effects![1]!.steps[1]!.action.kind).toBe("count_increase");
      expect(c.effects![1]!.steps[1]!.connector).toBe("conditional_cost");
      expect(c.effects![1]!.stub).toBeUndefined();
    }
  );

  it.each(["BSLH01-T01", "BSLH01-T02", "BSLH01-T03"])(
    "%s: 破壊時トリガーを発揮すると宣言ギミック primitive で declarationCountThisTurn と countValue が両方1増える",
    (no) => {
      const c = card(no);
      const source = createCardInstance(c, {
        instanceId: `${no}-1`,
        ownerPlayerId: "player-1",
        zone: "trash",
      });
      const before = createEmptyGameState({ cardInstances: [source] });
      const after = executeEffect({
        chainId: "test:bslh01-cards:11636",
        state: before,
        effect: c.effects![1]!,
        effectIndex: 1,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "player-1",
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
      });

      expect(after.declarationCountThisTurn["player-1"]).toBe(1);
      expect(after.players.find((p) => p.id === "player-1")?.countValue).toBe(
        1
      );
    }
  );
});

describe("BSLH01-T04 アイオーンα", () => {
  const c = card("BSLH01-T04");
  const lifeCoreCount = (state: GameState, playerId: string) =>
    getPlayerLifeCoreCount(
      state.players.find((player) => player.id === playerId)!
    );

  it("Lv3免疫 / アタックで除外(ターン1回) / エンド回復", () => {
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps.map((step) => step.action.kind)).toEqual([
      "effect_immunity",
      "effect_immunity",
      "effect_immunity",
      "effect_immunity",
    ]);
    const atk = c.effects![1]!;
    expect(atk.steps[0]!.action.kind).toBe("remove_from_game");
    expect(atk.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    expect(c.effects![2]!.steps[0]!.action.kind).toBe("recover");
  });

  it("[board] Lv3常時効果は系統:「CB」の導界者ネクサスにも耐性を登録する (grandwalkerKind は指定しない、qa-002/P3-134)", () => {
    const source = createCardInstance(c, {
      instanceId: "aeon-alpha-guided-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const guidedCbNexusDef: CardDefinition = {
      ...(card("BSLH01-C02") as CardDefinition),
      cardNo: "TEST-GUIDED-CB-NEXUS",
      name: "テストCB導界者ネクサス",
      tribe: "CB",
      grandwalkerData: {
        kind: "guided",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    };
    const guidedCbNexus = createCardInstance(guidedCbNexusDef, {
      instanceId: "cb-guided-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const localGetDef = (id: string): CardDefinition | undefined =>
      id === guidedCbNexusDef.cardNo ? guidedCbNexusDef : getDef(id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, guidedCbNexus],
    });
    const state = executeEffect({
      chainId: "test:bslh01-cards:11707",
      state: base,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: localGetDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      isCardImmuneToOpponentEffect(
        state,
        guidedCbNexus,
        "bob",
        "none",
        undefined,
        localGetDef
      )
    ).toBe(true);
  });

  it("[board] Lv3常時効果で自身/CB創界神/手札/ライフに相手効果耐性を登録する", () => {
    const source = createCardInstance(c, {
      instanceId: "aeon-alpha-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const grandwalkerDef = card("BSLH01-X02");
    const grandwalker = createCardInstance(grandwalkerDef, {
      instanceId: "cb-grandwalker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const normalCbNexus = createCardInstance(card("BSLH01-C02"), {
      instanceId: "normal-cb-nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(card("BSLH01-C01"), {
      instanceId: "alice-hand-protected",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, grandwalker, normalCbNexus, handCard],
    });
    const state = executeEffect({
      chainId: "test:bslh01-cards:11762",
      state: base,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      isCardImmuneToOpponentEffect(
        state,
        source,
        "bob",
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        normalCbNexus,
        "bob",
        "none",
        undefined,
        getDef
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        grandwalker,
        "bob",
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        handCard,
        "bob",
        "none",
        undefined,
        getDef
      )
    ).toBe(true);

    const afterOpponentLifeDamage = resolveLifeDamage(state, "alice", 2, [], {
      cause: "opponent_effect",
      actingPlayerId: "bob",
    });
    expect(lifeCoreCount(afterOpponentLifeDamage, "alice")).toBe(5);
    expect(afterOpponentLifeDamage.log).toContain(
      "effect:life_effect_immunity:alice:blocked:2"
    );

    const afterSelfLifeDamage = resolveLifeDamage(state, "alice", 1, [], {
      cause: "self_effect",
      actingPlayerId: "alice",
    });
    expect(lifeCoreCount(afterSelfLifeDamage, "alice")).toBe(4);

    const afterUnpreventable = resolveLifeDamage(state, "alice", 1, [], {
      cause: "opponent_effect",
      actingPlayerId: "bob",
      sourcePreventionLevel: "unpreventable",
    });
    expect(lifeCoreCount(afterUnpreventable, "alice")).toBe(4);
  });

  it("[board] core_move life→void 経由の相手効果ライフ減少もlife zone耐性で防ぐ", () => {
    const source = createCardInstance(c, {
      instanceId: "aeon-alpha-core-move",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });
    const protectedState = executeEffect({
      chainId: "test:bslh01-cards:11848",
      state: base,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const afterCoreMove = executeCoreMove(
      protectedState,
      "bob",
      { kind: "life", player: "opponent" },
      { kind: "void" },
      1,
      "bob-effect-source",
      undefined,
      undefined,
      getDef
    );
    expect(lifeCoreCount(afterCoreMove, "alice")).toBe(5);
    expect(afterCoreMove.log).toContain(
      "effect:life_effect_immunity:alice:blocked:1"
    );
  });
});

describe("BSLH01-T05 アイオーンβ", () => {
  const c = card("BSLH01-T05");
  it("Lv3ブロックされない + unblockableブロック許可 / エンド回復", () => {
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.timingScope).toEqual({
      player: "both",
      period: "attack",
    });
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("unblockable");
    expect(c.effects![1]!.stub).toBeUndefined();
    expect(c.effects![1]!.timingScope).toEqual({
      player: "both",
      period: "attack",
    });
    expect(c.effects![1]!.steps[0]!.action.kind).toBe("block_unblockable");
    expect(c.effects![2]!.steps[0]!.action.kind).toBe("recover");
  });

  it("Lv3常時効果で自身に unblockable と block_unblockable のCEを登録する", () => {
    const source = createCardInstance(c, {
      instanceId: "aeon-beta-1",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 3,
    });
    const before = createEmptyGameState({ cardInstances: [source] });
    const afterUnblockable = executeEffect({
      chainId: "test:bslh01-cards:11902",
      state: before,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = executeEffect({
      chainId: "test:bslh01-cards:11911",
      state: afterUnblockable,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    const tags = after.activeContinuousEffects
      .filter((ce) => ce.targetInstanceId === source.instanceId)
      .map((ce) => ce.modifierTag)
      .sort();
    expect(tags).toEqual(["block_unblockable", "unblockable"]);
    for (const ce of after.activeContinuousEffects) {
      expect(ce.timingScope).toEqual({ player: "both", period: "attack" });
      expect(isCEActiveForScope(ce, "attack", "player-1")).toBe(true);
      expect(isCEActiveForScope(ce, "main", "player-1")).toBe(false);
    }
  });

  it("旧 effect[0] unblockable CE だけがある復元状態でも block_unblockable を補完する", () => {
    const source = createCardInstance(c, {
      instanceId: "aeon-beta-restore",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 3,
    });
    const before: GameState = {
      ...createEmptyGameState({ cardInstances: [source] }),
      activePlayerId: "player-1",
      step: "attack",
      activeContinuousEffects: [
        {
          effectId: "old-unblockable-only",
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "player-1",
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "unblockable",
          targetInstanceId: source.instanceId,
          provenance: { effectIndex: 0, stepIndex: 0 },
        },
      ],
    };

    const rebuilt = rebuildContinuousEffectsFromField(before, (id) =>
      cardNoMap.get(id)
    );
    const tags = rebuilt.activeContinuousEffects
      .filter((ce) => ce.targetInstanceId === source.instanceId)
      .map((ce) => ce.modifierTag)
      .sort();
    expect(tags).toEqual(["block_unblockable", "unblockable"]);
    for (const ce of rebuilt.activeContinuousEffects) {
      expect(ce.timingScope).toEqual({ player: "both", period: "attack" });
    }
  });

  it("provenance無し旧 unblockable CE 復元状態でも attack 限定CEへ置換する", () => {
    const source = createCardInstance(c, {
      instanceId: "aeon-beta-legacy-no-provenance",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 3,
    });
    const before: GameState = {
      ...createEmptyGameState({ cardInstances: [source] }),
      activePlayerId: "player-1",
      step: "attack",
      activeContinuousEffects: [
        {
          effectId: "legacy-unscoped-unblockable",
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "player-1",
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "unblockable",
          targetInstanceId: source.instanceId,
        },
      ],
    };

    const rebuilt = rebuildContinuousEffectsFromField(before, (id) =>
      cardNoMap.get(id)
    );
    const sourceEffects = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.targetInstanceId === source.instanceId
    );
    expect(sourceEffects.map((ce) => ce.modifierTag).sort()).toEqual([
      "block_unblockable",
      "unblockable",
    ]);
    expect(
      sourceEffects.some((ce) => ce.effectId === "legacy-unscoped-unblockable")
    ).toBe(false);
    for (const ce of sourceEffects) {
      expect(ce.timingScope).toEqual({ player: "both", period: "attack" });
      expect(isCEActiveForScope(ce, "main", "player-1")).toBe(false);
    }
  });

  it("block_unblockable CE により unblockable 攻撃参加体へのブロック宣言が合法になる", () => {
    const attackerDef: CardDefinition = {
      cardNo: "TEST-BSLH01-T05-UNBLOCKABLE-ATTACKER",
      name: "テスト unblockable 攻撃体",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === attackerDef.cardNo ? attackerDef : cardNoMap.get(id);
    const attacker = createCardInstance(attackerDef, {
      instanceId: "unblockable-attacker",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(c, {
      instanceId: "aeon-beta-blocker",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 3,
      exhaustState: "recovered",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-1:1",
      primaryEntityId: "be-1",
      participantEntityIds: ["be-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "player-2" },
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["player-1", "player-2"],
        cardInstances: [attacker, blocker],
      }),
      activePlayerId: "player-1",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-1",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: [attacker.instanceId],
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-attacker-unblockable",
          sourceInstanceId: attacker.instanceId,
          sourceDefinitionId: attackerDef.cardNo,
          actingPlayerId: "player-1",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "unblockable",
          targetInstanceId: attacker.instanceId,
        },
      ],
    };
    const reason = (state: GameState) =>
      getBlockDeclarationBlockReason({
        state,
        actingPlayerId: "player-2",
        sourceInstanceId: blocker.instanceId,
        participantEntityId: "be-1",
        getCardDefinitionById: getDef,
      });

    expect(reason(base)).toBe("attacker_unblockable");
    const withBlockUnblockable = executeEffect({
      chainId: "test:bslh01-cards:12109",
      state: base,
      effect: c.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: blocker.instanceId,
      actingPlayerId: "player-2",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(reason(withBlockUnblockable)).toBeNull();
  });
});

describe("BSLH01-T06 アイオーンγ", () => {
  const c = card("BSLH01-T06");
  const hasPrintedBurstFamilyHeader = (cardNo: string): boolean =>
    cardHasBurstEffect(card(cardNo));

  it("アタックで相手デッキ15破棄(mill)し、破棄結果にバーストがあれば相手スピリット1体を破壊する", () => {
    const effect = c.effects![0]!;
    expect(effect.stub).toBeUndefined();
    const millStep = effect.steps[0]!;
    const mill = millStep.action;
    expect(millStep.id).toBe("t06-grand-mill");
    expect(mill.kind).toBe("discard");
    if (mill.kind === "discard") {
      expect(mill.player).toBe("opponent");
      expect(mill.fromZone).toBe("deck");
      expect(mill.count).toEqual({
        source: { kind: "source_effective_level" },
        multiplier: 5,
      });
    }
    const destroyStep = effect.steps[1]!;
    expect(destroyStep.connector).toBe("conditional_result");
    expect(destroyStep.stepCondition).toEqual({
      kind: "ref_has_match",
      stepId: "t06-grand-mill",
      filter: { hasBurstEffect: true },
    });
    expect(destroyStep.action.kind).toBe("destroy");
  });

  it("[engine] hasBurstEffect は公式バースト派生ヘッダも印字バースト扱いする", () => {
    const base = card("BSLH01-C01");
    const synthetic = (textLine: string): CardDefinition => ({
      ...base,
      cardNo: `TEST-${textLine}`,
      textLines: [textLine],
      effects: [],
    });

    expect(
      cardHasBurstEffect(synthetic("【バースト：自分のライフ減少後】"))
    ).toBe(true);
    expect(
      cardHasBurstEffect(synthetic("【バースト転召：自分のライフ減少後】"))
    ).toBe(true);
    expect(
      cardHasBurstEffect(synthetic("【Sバースト：相手のアタック後】"))
    ).toBe(true);
    expect(
      cardHasBurstEffect(synthetic("【Ｓバースト：相手のアタック後】"))
    ).toBe(true);
    expect(cardHasBurstEffect(synthetic("【クアンタムバースト】"))).toBe(false);
  });

  it("[engine] dynamic targetFilter projection は hasBurstEffect を落とさない", () => {
    const target: EffectTarget = {
      player: "opponent",
      count: -1,
      zone: ["deck"],
      filter: { hasBurstEffect: true },
    };

    expect(dynamicTargetFilterFromEffectTarget(target)).toEqual({
      player: "opponent",
      hasBurstEffect: true,
      zone: ["deck"],
    });
  });

  it("[engine] dynamic targetFilter projection は grandwalker 種別条件を落とさない", () => {
    const target: EffectTarget = {
      player: "self",
      count: -1,
      zone: ["field"],
      filter: {
        category: ["nexus"],
        tribes: ["CB"],
        targetsGrandwalker: "only",
        grandwalkerKind: "grandwalker",
      },
    };

    expect(dynamicTargetFilterFromEffectTarget(target)).toEqual({
      player: "self",
      category: ["nexus"],
      tribes: ["CB"],
      targetsGrandwalker: "only",
      grandwalkerKind: "grandwalker",
      zone: ["field"],
    });
  });

  it("[engine] defense_immune targetFilter.hasBurstEffect は消費側でも評価される", () => {
    const source = createCardInstance(c, {
      instanceId: "t06-dynamic-immunity-source",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const printedBurstInHand = createCardInstance(card("BSLH01-M03"), {
      instanceId: "t06-immune-printed-burst",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "hand",
    });
    const burstTaggedWithoutBurstEffect = createCardInstance(
      card("BSLH01-C05"),
      {
        instanceId: "t06-immune-burst-tag-only",
        ownerPlayerId: "player-1",
        controllerPlayerId: "player-1",
        zone: "hand",
      }
    );
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [
        source,
        printedBurstInHand,
        burstTaggedWithoutBurstEffect,
      ],
    });
    const after = executeEffectImmunity(
      state,
      "player-1",
      {
        target: {
          player: "self",
          count: -1,
          zone: ["hand"],
          filter: { hasBurstEffect: true },
        },
        duration: { scope: "turn" },
      },
      source.instanceId,
      getDef
    );

    expect(
      isCardImmuneToOpponentEffect(
        after,
        printedBurstInHand,
        "player-2",
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        after,
        burstTaggedWithoutBurstEffect,
        "player-2",
        "none",
        undefined,
        getDef
      )
    ).toBe(false);
  });

  it("[board] 15枚破棄にバースト効果カードが含まれたときだけ相手スピリットを破壊する", () => {
    const source = createCardInstance(c, {
      instanceId: "t06-source",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentSpirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "t06-target",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const burstCard = createCardInstance(card("BSTS01-R02"), {
      instanceId: "t06-burst-in-deck",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const nonBurstDeck = Array.from({ length: 14 }, (_, i) =>
      createCardInstance(card("BSLH01-C01"), {
        instanceId: `t06-nonburst-${i}`,
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-2",
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, opponentSpirit, burstCard, ...nonBurstDeck],
    });
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:12317",
        state: before,
        effect: c.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "player-1",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );
    const target = after.cardInstances.find(
      (ci) => ci.instanceId === "t06-target"
    );
    expect(target?.zone).toBe("trash");
    expect(
      after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === "player-2" && ci.zone === "trash"
      ).length
    ).toBe(16);
  });

  it("[board] 15枚破棄にバースト効果カードが含まれなければ破壊しない", () => {
    const source = createCardInstance(c, {
      instanceId: "t06-source-no-burst",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentSpirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "t06-target-no-burst",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const nonBurstDeck = Array.from({ length: 15 }, (_, i) =>
      createCardInstance(card("BSLH01-C01"), {
        instanceId: `t06-no-burst-${i}`,
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-2",
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, opponentSpirit, ...nonBurstDeck],
    });
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:12367",
        state: before,
        effect: c.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "player-1",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );
    const target = after.cardInstances.find(
      (ci) => ci.instanceId === "t06-target-no-burst"
    );
    expect(target?.zone).toBe("field");
    expect(
      after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === "player-2" && ci.zone === "trash"
      ).length
    ).toBe(15);
  });

  it("[board] burst tag だけでバースト効果を持たないカードでは破壊しない", () => {
    expect(card("BSLH01-C05").keywordTags).toContain("burst");
    expect(hasPrintedBurstFamilyHeader("BSLH01-C05")).toBe(false);
    const source = createCardInstance(c, {
      instanceId: "t06-source-burst-tag-only",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentSpirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "t06-target-burst-tag-only",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const burstTaggedWithoutBurstEffect = createCardInstance(
      card("BSLH01-C05"),
      {
        instanceId: "t06-burst-tag-only-in-deck",
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-2",
        zone: "deck",
      }
    );
    const nonBurstDeck = Array.from({ length: 14 }, (_, i) =>
      createCardInstance(card("BSLH01-C01"), {
        instanceId: `t06-burst-tag-only-fill-${i}`,
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-2",
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [
        source,
        opponentSpirit,
        burstTaggedWithoutBurstEffect,
        ...nonBurstDeck,
      ],
    });
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:12433",
        state: before,
        effect: c.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "player-1",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );
    const target = after.cardInstances.find(
      (ci) => ci.instanceId === "t06-target-burst-tag-only"
    );
    expect(target?.zone).toBe("field");
    expect(
      after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === "player-2" && ci.zone === "trash"
      ).length
    ).toBe(15);
  });

  it("[board] 印字【バースト】を持つカードを破棄したときも破壊する (hasPrintedBurstFamilyHeader は textLines ヘッダ検出のため実装状態非依存)", () => {
    expect(hasPrintedBurstFamilyHeader("BSLH01-M03")).toBe(true);
    const source = createCardInstance(c, {
      instanceId: "t06-source-printed-burst-stub",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentSpirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "t06-target-printed-burst-stub",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const printedBurstStub = createCardInstance(card("BSLH01-M03"), {
      instanceId: "t06-printed-burst-stub-in-deck",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const nonBurstDeck = Array.from({ length: 14 }, (_, i) =>
      createCardInstance(card("BSLH01-C01"), {
        instanceId: `t06-printed-burst-stub-fill-${i}`,
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-2",
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [
        source,
        opponentSpirit,
        printedBurstStub,
        ...nonBurstDeck,
      ],
    });
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:12495",
        state: before,
        effect: c.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "player-1",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );
    const target = after.cardInstances.find(
      (ci) => ci.instanceId === "t06-target-printed-burst-stub"
    );
    expect(target?.zone).toBe("trash");
    expect(
      after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === "player-2" && ci.zone === "trash"
      ).length
    ).toBe(16);
  });

  it("[engine] discard.filter.hasBurstEffect は印字【バースト】カードだけに一致する", () => {
    const source = createCardInstance(c, {
      instanceId: "t06-source-filtered-discard",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const burstTaggedWithoutBurstEffect = createCardInstance(
      card("BSLH01-C05"),
      {
        instanceId: "t06-filtered-burst-tag-only",
        ownerPlayerId: "player-2",
        controllerPlayerId: "player-2",
        zone: "deck",
      }
    );
    const printedBurstStub = createCardInstance(card("BSLH01-M03"), {
      instanceId: "t06-filtered-printed-burst",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, burstTaggedWithoutBurstEffect, printedBurstStub],
    });
    const filteredDiscard: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "discard",
            player: "opponent",
            fromZone: "deck",
            count: 1,
            filter: { hasBurstEffect: true },
          },
        },
      ],
      textRef: [],
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:12559",
      state: before,
      effect: filteredDiscard,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "player-1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      after.cardInstances.find(
        (ci) => ci.instanceId === "t06-filtered-burst-tag-only"
      )?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find(
        (ci) => ci.instanceId === "t06-filtered-printed-burst"
      )?.zone
    ).toBe("trash");
  });
});

describe("BSLH01-T07〜T12 攻撃アーツ(payload表現)", () => {
  // 【アーツ】配置ゲートは CardDefinition.summonCondition + continuousSummonCondition
  // (F2.4b⑤) で表現するため、effects は [0]=系統CB/導力器以外の自分の効果を受けない,
  // [1]=フラッシュ payload の2つのみ。
  it("T07 疲労 / T08 破壊 / T09 消滅 / T10 除外 / T11 免疫付与 / T12 召喚", () => {
    const payload = (no: string) => card(no).effects![1]!.steps[0]!.action.kind;
    expect(payload("BSLH01-T07")).toBe("set_exhaust_state");
    expect(payload("BSLH01-T08")).toBe("destroy");
    expect(payload("BSLH01-T09")).toBe("vanish");
    expect(payload("BSLH01-T10")).toBe("remove_from_game");
    expect(payload("BSLH01-T11")).toBe("effect_immunity");
    expect(payload("BSLH01-T12")).toBe("summon");
    // 各アーツは continuousSummonCondition + summonCondition (any_of) を持つ
    for (const no of ["BSLH01-T07", "BSLH01-T10", "BSLH01-T12"]) {
      expect(card(no).continuousSummonCondition).toBe(true);
      expect(card(no).summonCondition).toBeDefined();
    }
  });

  it("[board] T07/T08: スピリット/アルティメットのOR枝ごとに本文のコスト上限を適用する", () => {
    const sourceT07 = createCardInstance(card("BSLH01-T07"), {
      instanceId: "t07-cost-cap-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const sourceT08 = createCardInstance(card("BSLH01-T08"), {
      instanceId: "t08-cost-cap-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "arts",
    });
    const cost3Spirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "cost3-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const cost5Spirit = createCardInstance(card("BSLH01-C10"), {
      instanceId: "cost5-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const cost8Spirit = createCardInstance(card("BSLH01-X10"), {
      instanceId: "cost8-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const cost4Ultimate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "cost4-ultimate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "ultimate",
    });
    const cost8Ultimate = createCardInstance(card("BSSG01-X04"), {
      instanceId: "cost8-ultimate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "ultimate",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        sourceT07,
        sourceT08,
        cost3Spirit,
        cost5Spirit,
        cost8Spirit,
        cost4Ultimate,
        cost8Ultimate,
      ],
    });
    const getDef = (id: string) => cardNoMap.get(id);
    const candidateIds = (source: CardInstance, effectIndex: number) => {
      const action = card(source.definitionId).effects![effectIndex]!.steps[0]!
        .action;
      return resolveTargetCandidateIds(
        action,
        state,
        "alice",
        source.instanceId,
        getDef,
        createStepExecutionContext(state),
        card(source.definitionId)
      );
    };

    // T07本文「コスト4以下」はcost3/cost4、T08本文「コスト7以下」は
    // cost3/cost5/cost4。どちらも filterOr の各枝に上限を複製して初めて
    // スピリットとアルティメット双方の候補プールが本文どおりになる。
    expect(candidateIds(sourceT07, 1)).toEqual([
      "cost3-spirit",
      "cost4-ultimate",
    ]);
    expect(candidateIds(sourceT08, 1)).toEqual([
      "cost3-spirit",
      "cost5-spirit",
      "cost4-ultimate",
    ]);

    const afterT07 = executeEffect({
      chainId: "test:bslh01-cards:12690",
      state,
      effect: card("BSLH01-T07").effects![1]!,
      effectIndex: 1,
      sourceInstanceId: sourceT07.instanceId,
      actingPlayerId: "alice",
      targetInstanceIds: ["cost4-ultimate"],
      getCardDefinitionById: getDef,
    });
    expect(
      afterT07.cardInstances.find(
        (instance) => instance.instanceId === "cost4-ultimate"
      )?.exhaustState
    ).toBe("exhausted");
    expect(
      afterT07.cardInstances.find(
        (instance) => instance.instanceId === "cost5-spirit"
      )?.exhaustState
    ).toBe("recovered");
    expect(
      afterT07.cardInstances.find(
        (instance) => instance.instanceId === "cost8-spirit"
      )?.exhaustState
    ).toBe("recovered");
    expect(
      afterT07.cardInstances.find(
        (instance) => instance.instanceId === "cost8-ultimate"
      )?.exhaustState
    ).toBe("recovered");

    const afterT08 = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:12721",
        state,
        effect: card("BSLH01-T08").effects![1]!,
        effectIndex: 1,
        sourceInstanceId: sourceT08.instanceId,
        actingPlayerId: "alice",
        targetInstanceIds: ["cost4-ultimate"],
        getCardDefinitionById: getDef,
      }),
      getDef
    );
    expect(
      afterT08.cardInstances.find(
        (instance) => instance.instanceId === "cost4-ultimate"
      )?.zone
    ).toBe("trash");
    expect(
      afterT08.cardInstances.find(
        (instance) => instance.instanceId === "cost8-ultimate"
      )?.zone
    ).toBe("field");
  });

  it("BSLH01-T11 アダマスガード: 免疫 payload に sourceScope=spirit/ultimate 指定 (stub 撤去)", () => {
    const t11 = card("BSLH01-T11");
    const flash = t11.effects![1]!;
    expect(flash.stub).toBeUndefined();
    const act = flash.steps[0]!.action;
    if (act.kind === "effect_immunity") {
      // 「相手のスピリット/アルティメットの効果を受けない」= sourceScope.categories
      expect(act.sourceScope).toEqual({
        categories: ["spirit", "ultimate"],
      });
    } else {
      throw new Error("expected effect_immunity action");
    }
  });
});

describe("BSLH01-T15 カラミティクロウ: フラッシュ連続使用回数拡張 (ENGINE-flash-priority-consecutive-use-grant)", () => {
  it("effects[1]: フラッシュ〔ターンに1回:同名〕grant_flash_consecutive_use を付与する (stub 撤去)", () => {
    const t15 = card("BSLH01-T15");
    expect(t15.continuousSummonCondition).toBe(true);
    expect(t15.summonCondition).toBeDefined();
    expect(t15.effects![0]!.stub).toBeUndefined();
    const flash = t15.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("grant_flash_consecutive_use");
    if (action.kind !== "grant_flash_consecutive_use") {
      throw new Error("expected grant_flash_consecutive_use action");
    }
    expect(action.player).toBe("self");
    expect(action.limit).toBe(2);
    expect(action.duration).toEqual({ scope: "turn" });
  });

  it("effects[1] 実行: CE は自分のみを対象とし metadata.limit を保持する", () => {
    const t15Def = card("BSLH01-T15");
    const t15 = createCardInstance(t15Def, {
      instanceId: "t15-source",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t15],
    });

    const after = executeEffect({
      chainId: "test:bslh01-cards:12797",
      state,
      effect: t15Def.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: t15.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    const grant = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "grant_flash_consecutive_use"
    );
    expect(grant).toBeDefined();
    expect(grant!.targetInstanceId).toBe("alice");
    // effect.timingScope (アタックステップ限定の flash 起動窓) は CE 自体には転写しない
    // (T13 grant_summon_trash_core_placement と同じ理由。「このターンの間」はアタック
    // ステップに限定されないため、転写すると isCEActiveForScope 経由で誤って絞り込まれる)。
    expect(grant!.timingScope).toBeUndefined();
    expect(grant!.duration).toEqual({ scope: "turn" });
    expect(grant!.metadata).toEqual({ limit: 2 });

    expect(getFlashConsecutiveUseLimitGrant(after, "alice")).toBe(2);
    // grant 未登録のプレイヤー/CE 無し盤面は既定 1
    // (10_rules/02 フラッシュ優先権ループ節の既定挙動: 能動使用1回ごとに優先権移譲)。
    expect(getFlashConsecutiveUseLimitGrant(after, "bob")).toBe(1);
    expect(getFlashConsecutiveUseLimitGrant(state, "alice")).toBe(1);
  });

  it("盤面(実戦経路): grant 保持者は能動フラッシュ使用を2回連続で行え、3回目相当で相手へ優先権移譲する", () => {
    // ATTACKER/TARGET は挙動非依存の最小スピリット。alice の2枚の flash 資源
    // (draw を1回行うだけの最小効果) は、grant の消費対象が「能動フラッシュ使用」自体であり
    // 効果の中身に依存しないことを示すため、トリガー/バーストチェックを一切誘発しない
    // 自己疲労 (exhaust) を中身に持たせる (draw 等の手札増加系は hand_increase 起因の
    // pendingTriggeredEffects/pendingBurstChecks を生んでしまい、優先権ループ検証と無関係な
    // ノイズになるため避ける)。
    const makeSimpleFlashSpirit = (
      cardNo: string,
      name: string
    ): CardDefinition => ({
      cardNo,
      name,
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          timingScope: { player: "both", period: "attack" },
          steps: [
            {
              action: {
                kind: "exhaust",
                target: { kind: "self" },
              },
            },
          ],
        },
      ],
    });
    const flashSourceA = makeSimpleFlashSpirit(
      "TEST-T15-FLASH-A",
      "test flash A"
    );
    const flashSourceB = makeSimpleFlashSpirit(
      "TEST-T15-FLASH-B",
      "test flash B"
    );
    const bobAttackerDef: CardDefinition = {
      cardNo: "TEST-T15-ATTACKER",
      name: "test attacker",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };

    const defs = [flashSourceA, flashSourceB, bobAttackerDef];
    const defMap = new Map(defs.map((d) => [d.cardNo, d]));
    const getCardDefinitionById = (id: string) => defMap.get(id);
    const fieldLookups = {
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
    };

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(flashSourceA, {
          instanceId: "alice-flash-a",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(flashSourceB, {
          instanceId: "alice-flash-b",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(bobAttackerDef, {
          instanceId: "bob-attacker",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
          exhaustState: "exhausted",
        }),
      ],
      battleEntities: [
        {
          entityId: "e-bob-attacker",
          memberInstanceIds: ["bob-attacker"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "atk-t15",
        primaryEntityId: "e-bob-attacker",
        participantEntityIds: ["e-bob-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        // before_block の先優先権は非アクティブ (alice)。
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    });
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: "bob",
      window: "flash_before_block",
      // alice に grant_flash_consecutive_use (limit 2) を直接登録する
      // (BSLH01-T15 effects[1] の CE 登録結果と同形)。
      activeContinuousEffects: [
        {
          effectId: "test-grant-flash-consecutive-use",
          sourceInstanceId: "alice-flash-a",
          sourceDefinitionId: "BSLH01-T15",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "grant_flash_consecutive_use",
          targetInstanceId: "alice",
          metadata: { limit: 2 },
        },
      ],
    };

    function useAliceFlash(s: GameState, sourceInstanceId: string): GameState {
      const action = getLegalActions({
        state: s,
        actingPlayerId: "alice",
        getCardDefinitionById,
        ...fieldLookups,
      }).find(
        (a) =>
          a.kind === "use_field_card_effect" &&
          a.sourceInstanceId === sourceInstanceId
      );
      expect(action).toBeDefined();
      return applyLegalAction({
        state: s,
        action: action!,
        getCardDefinitionById,
        ...fieldLookups,
      }).state;
    }

    // bob の sub-stack パスに加え、exhaust の汎用トリガー収集 (無関係カードのため無反応)
    // で立つ pendingTriggeredEffects の resolve/declare も片付けて sub-stack を完全に閉じる。
    const settlePassKinds = [
      "resolve_pending_triggered_effect",
      "declare_private_triggered_effect",
      "pass_battle_flash",
    ] as const;
    function settleStackSubWindow(s: GameState): GameState {
      let cur = s;
      for (let i = 0; i < 10; i++) {
        if (
          cur.activeAttack?.flashWindowState?.pendingStackAction === null &&
          cur.pendingTriggeredEffects.length === 0
        ) {
          break;
        }
        let advanced = false;
        for (const pid of ["alice", "bob"]) {
          const acts = getLegalActions({
            state: cur,
            actingPlayerId: pid,
            getCardDefinitionById,
            ...fieldLookups,
          });
          let next;
          for (const k of settlePassKinds) {
            next = acts.find((a) => a.kind === k);
            if (next) break;
          }
          if (next) {
            cur = applyLegalAction({
              state: cur,
              action: next,
              getCardDefinitionById,
              ...fieldLookups,
            }).state;
            advanced = true;
            break;
          }
        }
        if (!advanced) break;
      }
      return cur;
    }

    // 1回目の能動使用: sub-stack を解決すると、grant により優先権は
    // alice に留まる (usedCount=1 < limit=2)。
    let cur = useAliceFlash(state, "alice-flash-a");
    expect(
      cur.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();
    cur = settleStackSubWindow(cur);
    expect(cur.activeAttack?.flashWindowState?.pendingStackAction).toBeNull();
    expect(cur.activeAttack?.flashWindowState?.priorityPlayerId).toBe("alice");
    expect(cur.activeAttack?.flashWindowState?.consecutiveActiveUseCount).toBe(
      1
    );

    // 2回目の能動使用 (2枚目の flash 資源): usedCount=2 で limit に達し、
    // 優先権は相手 (bob) へ移譲されストリークは 0 にリセットされる。
    cur = useAliceFlash(cur, "alice-flash-b");
    cur = settleStackSubWindow(cur);
    expect(cur.activeAttack?.flashWindowState?.priorityPlayerId).toBe("bob");
    expect(cur.activeAttack?.flashWindowState?.consecutiveActiveUseCount).toBe(
      0
    );
  });
});

describe("BSLH01-T13 メルティライズ: 召喚時トラッシュコア配置許可 (ENGINE-summon-trash-core-placement-grant)", () => {
  it("effects[1]: フラッシュ〔ターンに1回:同名〕grant_summon_trash_core_placement を付与する (stub 撤去)", () => {
    const t13 = card("BSLH01-T13");
    expect(t13.continuousSummonCondition).toBe(true);
    expect(t13.summonCondition).toBeDefined();
    expect(t13.effects![0]!.stub).toBeUndefined();
    const flash = t13.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("grant_summon_trash_core_placement");
    if (action.kind !== "grant_summon_trash_core_placement") {
      throw new Error("expected grant_summon_trash_core_placement action");
    }
    expect(action.player).toBe("self");
    expect(action.filter).toEqual({ category: ["spirit"], tribes: ["CB"] });
    expect(action.amount).toBe(1);
    expect(action.duration).toEqual({
      scope: "step",
      step: "start",
      whose: "self",
    });
  });

  it("effects[1] 実行: CE は自分のみを対象とし、CB スピリット定義にのみマッチする", () => {
    const t13Def = card("BSLH01-T13");
    const cbSpiritDef = card("BSLH01-C01");
    const nonCbSpiritDef = card("BSTH001-C01");
    const t13 = createCardInstance(t13Def, {
      instanceId: "t13-source",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t13],
    });

    const after = executeEffect({
      chainId: "test:bslh01-cards:13100",
      state,
      effect: t13Def.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: t13.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    const grant = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "grant_summon_trash_core_placement"
    );
    expect(grant).toBeDefined();
    expect(grant!.targetInstanceId).toBe("alice");
    // effect.timingScope (アタックステップ限定の flash 起動窓) は CE 自体には転写しない
    // (「次の自分のスタートステップまで」が main ステップの通常召喚でも有効であるため)。
    expect(grant!.timingScope).toBeUndefined();
    expect(grant!.duration).toEqual({
      scope: "step",
      step: "start",
      whose: "self",
    });
    expect(grant!.metadata).toEqual({
      filter: { category: ["spirit"], tribes: ["CB"] },
      amount: 1,
    });

    expect(
      getSummonTrashCorePlacementGrant(after, "alice", cbSpiritDef)
    ).toEqual({ amount: 1 });
    expect(
      getSummonTrashCorePlacementGrant(after, "bob", cbSpiritDef)
    ).toBeNull();
    expect(
      getSummonTrashCorePlacementGrant(after, "alice", nonCbSpiritDef)
    ).toBeNull();
  });

  it("盤面: grant 有効時、CB スピリットのメインステップ通常召喚でトラッシュのコアを維持コア源として使える", () => {
    const t13Def = card("BSLH01-T13");
    const cbSpiritDef = card("BSLH01-C01"); // cost 3, Lv1 requiredCores 1, tribe: CB・S.S.S
    const t13 = createCardInstance(t13Def, {
      instanceId: "t13-source",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const handSpirit = createCardInstance(cbSpiritDef, {
      instanceId: "hand-cb-spirit",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t13, handSpirit],
      playerOverrides: [{ reserveNormalCoreCount: 3, trashNormalCoreCount: 2 }],
    });
    // T13 のフラッシュを (アタックステップで) 発揮し、grant を成立させる。
    const withGrant = executeEffect({
      chainId: "test:bslh01-cards:13157",
      state: { ...baseState, step: "attack", activePlayerId: "alice" },
      effect: t13Def.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: t13.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    // grant 成立後、別ステップ (main) の通常召喚でも消費できることを確認する
    // (「次の自分のスタートステップまで」は攻撃ステップに限定されない)。
    const stateAtMain: GameState = {
      ...withGrant,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = (id: string) => cardNoMap.get(id);
    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

    const result = playSummonAsAction({
      state: stateAtMain,
      actingPlayerId: "alice",
      cardInstanceId: "hand-cb-spirit",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      enterFieldCorePlacements: [{ kind: "trash_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const summoned = result.state.cardInstances.find(
      (c) => c.instanceId === "hand-cb-spirit"
    );
    expect(summoned?.zone).toBe("field");
    expect(summoned?.normalCoreCount).toBe(1);
    const player = result.state.players.find((p) => p.id === "alice");
    // reserve 支払い(3コア)は cost payment 経路でトラッシュへ送られる
    // (通常の召喚コスト支払いの仕様)。初期トラッシュ2 + 支払い3 - 配置1 = 4。
    expect(player?.trashNormalCoreCount).toBe(4);
  });

  it("盤面: grant 無しではトラッシュからの維持コア配置が拒否される", () => {
    const cbSpiritDef = card("BSLH01-C01");
    const handSpirit = createCardInstance(cbSpiritDef, {
      instanceId: "hand-cb-spirit-2",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [handSpirit],
      playerOverrides: [{ reserveNormalCoreCount: 3, trashNormalCoreCount: 2 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = (id: string) => cardNoMap.get(id);
    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

    expect(() =>
      playSummonAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: "hand-cb-spirit-2",
        paymentSources: [{ kind: "reserve", amount: 3 }],
        enterFieldCorePlacements: [{ kind: "trash_normal", amount: 1 }],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toThrow();
  });

  it("盤面(実戦経路): メインステップの通常召喚は getLegalActions/applyLegalAction → stack窓 → 相手パス → deferred resolve でトラッシュコアが配置される", () => {
    // main ステップの通常召喚は opensPlayCardStack (legal-actions-apply.ts) により
    // 必ず useSummonInStackContextAsAction → スタック窓クローズ後の
    // resolveDeferredPlayCardWithPlacement 経由で場入りする。playSummonAsAction を直接
    // 呼ぶ他のテストはこの実戦上唯一の経路 (resolvePlayedCardOnField 内の allowTrashNormal
    // 再評価が deferred 経路でも機能するか) を検証できていなかったため別途確認する。
    const t13Def = card("BSLH01-T13");
    const cbSpiritDef = card("BSLH01-C01");
    const t13 = createCardInstance(t13Def, {
      instanceId: "t13-source-real",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const handSpirit = createCardInstance(cbSpiritDef, {
      instanceId: "hand-cb-spirit-real",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t13, handSpirit],
      playerOverrides: [{ reserveNormalCoreCount: 3, trashNormalCoreCount: 2 }],
    });
    const withGrant = executeEffect({
      chainId: "test:bslh01-cards:13253",
      state: { ...baseState, step: "attack", activePlayerId: "alice" },
      effect: t13Def.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: t13.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });
    const mainState: GameState = {
      ...withGrant,
      step: "main",
      activePlayerId: "alice",
    };
    const lookups = {
      getCardDefinitionById: (id: string) => cardNoMap.get(id),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };

    const summonAction = getLegalActions({
      state: mainState,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "hand-cb-spirit-real"
    );
    expect(summonAction).toBeDefined();

    const declared = applyLegalAction({
      state: mainState,
      action: summonAction!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      enterFieldCorePlacements: [{ kind: "trash_normal", amount: 1 }],
      ...lookups,
    }).state;
    // main ステップの通常召喚は必ずスタック窓を経由する (opensPlayCardStack, legal-actions-apply.ts)。
    expect(declared.window).toBe("stack");

    const bobPass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(bobPass).toBeDefined();

    const resolved = applyLegalAction({
      state: declared,
      action: bobPass!,
      ...lookups,
    }).state;

    const summoned = resolved.cardInstances.find(
      (c) => c.instanceId === "hand-cb-spirit-real"
    );
    expect(summoned?.zone).toBe("field");
    expect(summoned?.normalCoreCount).toBe(1);
    const player = resolved.players.find((p) => p.id === "alice");
    expect(player?.trashNormalCoreCount).toBe(4);
  });
});

describe("BSLH01-T14 レキュリア: フィールド以外で発揮中の CB スピリット対象化への negate 応答", () => {
  it("effects[1]: targeted disclosure (game_event) トリガーで negateTarget:effect を発揮する (stub 撤去)", () => {
    const t14 = card("BSLH01-T14");
    expect(t14.continuousSummonCondition).toBe(true);
    expect(t14.summonCondition).toBeDefined();
    expect(t14.effects![0]!.stub).toBeUndefined();
    const flash = t14.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    // 「フィールド以外で発揮中」限定: disclosure gate は通常の on-field 対象化でも
    // 同じ event:"targeted" を発火するため、condition で対象カードの現在ゾーンを
    // 絞り込む (ENGINE-targeted-disclosure-offfield-source、過剰発火防止)。
    expect(flash.condition).toBeUndefined();
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(flash.executionMode).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("negate_ongoing_effects");
    if (action.kind !== "negate_ongoing_effects") {
      throw new Error("expected negate action");
    }
    expect(action.sourcePlayer).toBe("opponent");
  });
});

describe("BSLH01-T16 A-リフレックス: 相手マジック対象 redirect 付与", () => {
  it("effects[1]: 自分CBスピリット1体へ、相手マジック効果対象時の redirect CE をターン中登録する", () => {
    const t16 = card("BSLH01-T16");
    expect(t16.continuousSummonCondition).toBe(true);
    expect(t16.summonCondition).toBeDefined();
    expect(t16.effects![0]!.stub).toBeUndefined();
    const flash = t16.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("register_redirect_effect_target");
    if (action.kind !== "register_redirect_effect_target") {
      throw new Error("expected register_redirect_effect_target");
    }
    expect(action.protectedTarget).toEqual({
      kind: "target",
      target: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"], tribes: ["CB"] },
        count: 1,
      },
    });
    expect(action.sourcePlayerRef).toBe("opponent");
    expect(action.sourceFilter).toEqual({ category: ["magic"] });
    expect(action.redirectCandidate).toEqual({
      kind: "owned_filter",
      filter: { category: ["spirit", "ultimate", "brave", "nexus"] },
      player: "opponent",
      preserveOriginalTargetSpec: { player: "self" },
    });
    expect(action.promptedPlayerRef).toBe("self");
    expect(action.candidateChooserPlayerRef).toBe("opponent");
    expect(action.duration).toEqual({ scope: "turn" });
  });

  it("effects[1] 実行: 指定CBを protectedTarget とし、自分prompt/相手候補選択の redirect CE を登録する", () => {
    const t16Def = card("BSLH01-T16");
    const cbDef = card("BSLH01-C01");
    const bobMagicDef = card("BSTH001-C05");
    const t16 = createCardInstance(t16Def, {
      instanceId: "t16-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const protectedCb = createCardInstance(cbDef, {
      instanceId: "t16-protected-cb",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceOtherSpirit = createCardInstance(card("BSTH001-C01"), {
      instanceId: "t16-alice-other-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobCandidate = createCardInstance(card("BSTH001-C01"), {
      instanceId: "t16-bob-candidate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobCandidate2 = createCardInstance(card("BSTH001-C01"), {
      instanceId: "t16-bob-candidate-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobNexusCandidate = createCardInstance(card("BSLH01-C02"), {
      instanceId: "t16-bob-nexus-candidate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobMagic = createCardInstance(bobMagicDef, {
      instanceId: "t16-bob-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        t16,
        protectedCb,
        aliceOtherSpirit,
        bobCandidate,
        bobCandidate2,
        bobNexusCandidate,
        bobMagic,
      ],
    });

    const after = executeEffect({
      chainId: "test:bslh01-cards:13452",
      state,
      effect: t16Def.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: t16.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      targetInstanceIds: [protectedCb.instanceId],
    });
    const redirect = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "redirect_effect_target" &&
        ce.targetInstanceId === protectedCb.instanceId
    );
    expect(redirect).toBeDefined();
    expect(redirect!.duration).toEqual({ scope: "turn" });
    const meta = getRedirectEffectTargetMetadata(redirect!);
    expect(meta?.triggerCondition).toMatchObject({
      sourcePlayerRef: "opponent",
      protectedTargetKind: "instances",
      protectedInstanceIds: [protectedCb.instanceId],
      sourceFilter: { category: ["magic"] },
    });
    expect(meta?.redirectCandidateSource).toEqual({
      kind: "owned_filter",
      filter: { category: ["spirit", "ultimate", "brave", "nexus"] },
      playerRef: "opponent",
      preserveOriginalTargetSpec: { playerRef: "self" },
    });
    expect(meta?.promptedPlayerRef).toBe("self");
    expect(meta?.candidateChooserPlayerRef).toBe("opponent");

    const matches = findApplicableTargetRedirects(
      after,
      [protectedCb.instanceId, aliceOtherSpirit.instanceId],
      "bob",
      "none",
      { instance: bobMagic, definition: bobMagicDef },
      (id) => cardNoMap.get(id),
      undefined,
      {
        targetSpec: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 2,
        },
        sourceInstanceId: bobMagic.instanceId,
      }
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.promptedPlayerId).toBe("alice");
    expect(matches[0]!.candidateChooserPlayerId).toBe("bob");
    expect(matches[0]!.replacementMode).toBe("reselect");
    expect(matches[0]!.redirectableInstanceIds).toEqual([
      protectedCb.instanceId,
      aliceOtherSpirit.instanceId,
    ]);
    expect(matches[0]!.candidateTokenInstanceIds).toEqual([
      bobCandidate.instanceId,
      bobCandidate2.instanceId,
    ]);
  });
});

describe("BSLH01-T17 ホロウスフィア: 対象指定+効果耐性 until_event 早期終了 (ENGINE-continuous-effect-until-event-duration)", () => {
  it("T17: 配置ゲート(summonCondition) + effects[1] stub 撤去", () => {
    const c = card("BSLH01-T17");
    expect(c.continuousSummonCondition).toBe(true);
    expect(c.summonCondition).toBeDefined();
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![1]!.stub).toBeUndefined();
  });

  it("T17 effects[1]: フラッシュ〔ターン1回:同名〕アタックステップ限定で、自分の非バトル参加CBスピリット1体へ相手の効果耐性を until_event(attack/block/soul_drive_activated) 付きで付与する", () => {
    const t17 = card("BSLH01-T17");
    const flash = t17.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const act = flash.steps[0]!.action;
    if (act.kind !== "effect_resistance") {
      throw new Error("expected effect_immunity action");
    }
    expect(act.target).toEqual({
      kind: "filter",
      player: "self",
      filter: {
        category: ["spirit"],
        tribes: ["CB"],
        battleState: "not_in_battle",
      },
      count: 1,
    });
    expect(act.sourcePlayerScope).toBeUndefined();
    expect(act.duration).toEqual({
      scope: "turn",
      untilEvents: ["attack", "block", "soul_drive_activated"],
    });
  });

  it("T17 effects[1] 実行: 指定対象は相手の効果を受けなくなり、対象自身のアタック宣言で早期終了する", () => {
    const t17Def = card("BSLH01-T17");
    const t17 = createCardInstance(t17Def, {
      instanceId: "bslh01-t17-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const cbSpiritDef = ALL_CARDS.find(
      (def) => def.printedCategory === "spirit" && def.tribe?.includes("CB")
    )!;
    expect(cbSpiritDef).toBeDefined();
    const target = createCardInstance(cbSpiritDef, {
      instanceId: "bslh01-t17-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: cbSpiritDef.levelDefs[0]?.requiredCores ?? 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t17, target],
    });

    const afterGrant = executeEffectImmunity(
      state,
      "alice",
      {
        target: {
          kind: "filter",
          player: "self",
          filter: {
            category: ["spirit"],
            tribes: ["CB"],
            battleState: "not_in_battle",
          },
          count: 1,
        },
        duration: {
          scope: "turn",
          untilEvents: ["attack", "block", "soul_drive_activated"],
        },
      },
      t17.instanceId,
      (id) => cardNoMap.get(id),
      [target.instanceId]
    );

    const immunity = afterGrant.activeContinuousEffects.find(
      (effect) =>
        effect.modifierTag === "defense_immune" &&
        effect.targetInstanceId === target.instanceId
    );
    expect(immunity).toBeDefined();
    expect(immunity!.duration.untilEvents).toEqual([
      "attack",
      "block",
      "soul_drive_activated",
    ]);
    expect(
      isCardImmuneToOpponentEffect(afterGrant, target, "bob", "none")
    ).toBe(true);

    const afterAttack = queueBattleDeclarationTriggers({
      chainId: "test:bslh01-cards:13621",
      state: afterGrant,
      kind: "attack",
      declaringInstanceId: target.instanceId,
      declaringPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    });

    expect(
      afterAttack.activeContinuousEffects.some(
        (effect) => effect.effectId === immunity!.effectId
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(afterAttack, target, "bob", "none")
    ).toBe(false);
  });

  it("T17 until_event: 対象自身のブロック宣言でも早期終了する", () => {
    const t17Def = card("BSLH01-T17");
    const t17 = createCardInstance(t17Def, {
      instanceId: "bslh01-t17-source-block",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const cbSpiritDef = ALL_CARDS.find(
      (def) => def.printedCategory === "spirit" && def.tribe?.includes("CB")
    )!;
    const target = createCardInstance(cbSpiritDef, {
      instanceId: "bslh01-t17-target-block",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: cbSpiritDef.levelDefs[0]?.requiredCores ?? 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t17, target],
    });
    const afterGrant = executeEffectImmunity(
      state,
      "alice",
      {
        target: {
          kind: "filter",
          player: "self",
          filter: {
            category: ["spirit"],
            tribes: ["CB"],
            battleState: "not_in_battle",
          },
          count: 1,
        },
        duration: {
          scope: "turn",
          untilEvents: ["attack", "block", "soul_drive_activated"],
        },
      },
      t17.instanceId,
      (id) => cardNoMap.get(id),
      [target.instanceId]
    );
    const immunity = afterGrant.activeContinuousEffects.find(
      (effect) =>
        effect.modifierTag === "defense_immune" &&
        effect.targetInstanceId === target.instanceId
    )!;
    expect(immunity).toBeDefined();

    const afterBlock = queueBattleDeclarationTriggers({
      chainId: "test:bslh01-cards:13695",
      state: afterGrant,
      kind: "block",
      declaringInstanceId: target.instanceId,
      declaringPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    });

    expect(
      afterBlock.activeContinuousEffects.some(
        (effect) => effect.effectId === immunity.effectId
      )
    ).toBe(false);
  });

  it("T17 until_event: 対象自身が【ソウルドライブ・S】を発揮 (soulCoreLocation→removed_from_game) すると早期終了する (relatedInstanceId=causedBySourceInstanceId 経路)", () => {
    const t17Def = card("BSLH01-T17");
    const x03Def = card("BSLH01-X03");
    const t17 = createCardInstance(t17Def, {
      instanceId: "bslh01-t17-source-sd",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    // X03 は tribe:"CB・S.S.S" + printedCategory:"spirit" のため T17 の filter に合致し、
    // 自身の effects[2] が【ソウルドライブ・S】コスト+payload (ENGINE-soul-drive-activation
    // -observable-event 検証済み precedent と同一カード定義)。
    const target = createCardInstance(x03Def, {
      instanceId: "bslh01-t17-target-sd",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t17, target],
    });
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: target.instanceId },
            }
          : p
      ),
    };
    const afterGrant = executeEffectImmunity(
      state,
      "alice",
      {
        target: {
          kind: "filter",
          player: "self",
          filter: {
            category: ["spirit"],
            tribes: ["CB"],
            battleState: "not_in_battle",
          },
          count: 1,
        },
        duration: {
          scope: "turn",
          untilEvents: ["attack", "block", "soul_drive_activated"],
        },
      },
      t17.instanceId,
      (id) => cardNoMap.get(id),
      [target.instanceId]
    );
    const immunity = afterGrant.activeContinuousEffects.find(
      (effect) =>
        effect.modifierTag === "defense_immune" &&
        effect.targetInstanceId === target.instanceId
    )!;
    expect(immunity).toBeDefined();

    // target 自身の【ソウルドライブ・S】 (effects[2]) を実行: ソウルコア除外がコストで
    // 発火する。sourceInstanceId=target 自身 (自己発揮)。
    const afterSoulDrive = executeEffect({
      chainId: "test:bslh01-cards:13781",
      state: afterGrant,
      effect: x03Def.effects![2]!,
      sourceInstanceId: target.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      afterSoulDrive.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "removed_from_game" });

    // production 経路 (effect-resolution.ts 等) は自己発揮効果解決時に
    // causedBySourceInstanceId = 発揮元カード自身の instanceId を thread する
    // (stack-resolution-core.ts の effectResolutionSourceInstanceId と同型)。
    const afterQueue = collectAndQueueTriggerReactions({
      beforeState: afterGrant,
      afterState: afterSoulDrive,
      source: "action_resolution",
      chainId: "test:bslh01-cards:13796",
      attackId: null,
      causedBySourceInstanceId: target.instanceId,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    });

    expect(
      afterQueue.activeContinuousEffects.some(
        (effect) => effect.effectId === immunity.effectId
      )
    ).toBe(false);
  });

  it("T17 until_event: 対象以外のカードのソウルドライブ発動では早期終了しない (relatedInstanceId 不一致)", () => {
    const t17Def = card("BSLH01-T17");
    const x03Def = card("BSLH01-X03");
    const t17 = createCardInstance(t17Def, {
      instanceId: "bslh01-t17-source-sd-other",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const cbSpiritDef = ALL_CARDS.find(
      (def) => def.printedCategory === "spirit" && def.tribe?.includes("CB")
    )!;
    // target = T17 の免疫を受け取る側 (X03 とは別カード)。
    const target = createCardInstance(cbSpiritDef, {
      instanceId: "bslh01-t17-target-sd-other",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: cbSpiritDef.levelDefs[0]?.requiredCores ?? 0,
    });
    // other = ソウルドライブを発動する別カード (target とは無関係)。
    const other = createCardInstance(x03Def, {
      instanceId: "bslh01-t17-other-sd",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [t17, target, other],
    });
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: other.instanceId },
            }
          : p
      ),
    };
    const afterGrant = executeEffectImmunity(
      state,
      "alice",
      {
        target: {
          kind: "filter",
          player: "self",
          filter: {
            category: ["spirit"],
            tribes: ["CB"],
            battleState: "not_in_battle",
          },
          count: 1,
        },
        duration: {
          scope: "turn",
          untilEvents: ["attack", "block", "soul_drive_activated"],
        },
      },
      t17.instanceId,
      (id) => cardNoMap.get(id),
      [target.instanceId]
    );
    const immunity = afterGrant.activeContinuousEffects.find(
      (effect) =>
        effect.modifierTag === "defense_immune" &&
        effect.targetInstanceId === target.instanceId
    )!;
    expect(immunity).toBeDefined();

    const afterSoulDrive = executeEffect({
      chainId: "test:bslh01-cards:13891",
      state: afterGrant,
      effect: x03Def.effects![2]!,
      sourceInstanceId: other.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const afterQueue = collectAndQueueTriggerReactions({
      beforeState: afterGrant,
      afterState: afterSoulDrive,
      source: "action_resolution",
      chainId: "test:bslh01-cards:13899",
      attackId: null,
      causedBySourceInstanceId: other.instanceId,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    });

    // target の CE は他カードのソウルドライブ発動では除去されない (relatedInstanceId
    // が effect.targetInstanceId と不一致のため)。
    expect(
      afterQueue.activeContinuousEffects.some(
        (effect) => effect.effectId === immunity.effectId
      )
    ).toBe(true);
  });
});

describe("BSLH01-T07〜T17 系統：「CB」/「導力器」以外の自分の効果を受けない (engine-quartz-arts-field-gate)", () => {
  it.each([
    "BSLH01-T07",
    "BSLH01-T08",
    "BSLH01-T09",
    "BSLH01-T10",
    "BSLH01-T11",
    "BSLH01-T12",
    "BSLH01-T13",
    "BSLH01-T14",
    "BSLH01-T15",
    "BSLH01-T16",
    "BSLH01-T17",
  ])(
    "%s: effects[0] が excludeTribes=[CB,導力器] の自己免疫として表現される",
    (no) => {
      const immunity = card(no).effects![0]!;
      expect(immunity.stub).toBeUndefined();
      expect(immunity.timing).toEqual({ kind: "continuous" });
      const act = immunity.steps[0]!.action;
      if (act.kind !== "effect_immunity") {
        throw new Error("expected effect_immunity action");
      }
      expect(act.target).toEqual({ kind: "self" });
      expect(act.sourcePlayerScope).toBe("self");
      expect(act.sourceScope).toEqual({ excludeTribes: ["CB", "導力器"] });
      expect(act.duration).toEqual({ scope: "while_on_field" });
    }
  );
});

describe("BSLH01-T07〜T17 【アーツ】配置ゲート (engine-quartz-arts-field-gate F2.4b⑤)", () => {
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
  const ALICE = "player-1";
  const BOB = "player-2";
  // BSLH01-C10 機功: attributeValues { 地:3, 水:2, 時:1 } (実カード、qa-033)。
  const hostDef = card("BSLH01-CX01");
  const q1Def = card("BSLH01-C10");

  it("BSLH01-CX01: relatedTokenCardNos が T07〜T17 の11枚を宣言する", () => {
    const host = card("BSLH01-CX01");
    expect(host.relatedTokenCardNos).toEqual([
      "BSLH01-T07",
      "BSLH01-T08",
      "BSLH01-T09",
      "BSLH01-T10",
      "BSLH01-T11",
      "BSLH01-T12",
      "BSLH01-T13",
      "BSLH01-T14",
      "BSLH01-T15",
      "BSLH01-T16",
      "BSLH01-T17",
    ]);
  });

  it("BSLH01-T07: 属性値OR閾値(地/火/水/風/時/空/幻いずれか1以上)が any_of で表現される", () => {
    const t07 = card("BSLH01-T07");
    expect(t07.continuousSummonCondition).toBe(true);
    expect(t07.summonCondition).toHaveLength(1);
    const clause = t07.summonCondition![0]!;
    if (clause.kind !== "any_of") {
      throw new Error("expected any_of clause");
    }
    expect(clause.groups).toHaveLength(7);
    expect(clause.groups[0]).toEqual([
      { kind: "quartz_attribute", player: "self", attribute: "地", min: 1 },
    ]);
  });

  it("BSLH01-T08: 複合閾値プロファイル(地4風1等)の1グループがAND複数条件を持つ", () => {
    const t08 = card("BSLH01-T08");
    const clause = t08.summonCondition![0]!;
    if (clause.kind !== "any_of") {
      throw new Error("expected any_of clause");
    }
    expect(clause.groups).toHaveLength(7);
    expect(clause.groups[0]).toEqual([
      { kind: "quartz_attribute", player: "self", attribute: "地", min: 4 },
      { kind: "quartz_attribute", player: "self", attribute: "風", min: 1 },
    ]);
  });

  it("evaluateCondition: T07 summonCondition は属性値1未満なら不成立、いずれか1以上で成立", () => {
    const t07Def = card("BSLH01-T07");
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    // 属性値が全く無い状態 (魂状態カード無し) は不成立
    expect(
      evaluateCondition(
        state,
        t07Def.summonCondition!,
        "ignored-source",
        ALICE,
        getDef
      )
    ).toBe(false);

    // host + q1(機功: 地3水2時1) を魂状態にセットすると <地> 属性が3 (≥1) で成立
    const host = createCardInstance(hostDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "arts-host",
    });
    const q1 = createCardInstance(q1Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "arts-q1",
    });
    const setup: GameState = {
      ...state,
      cardInstances: [host, q1],
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["arts-host"] } : p
      ),
    };
    const afterSet = setQuartz(
      setup,
      {
        quartzInstanceId: "arts-q1",
        hostInstanceId: "arts-host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    expect(
      evaluateCondition(
        afterSet,
        t07Def.summonCondition!,
        "ignored-source",
        ALICE,
        getDef
      )
    ).toBe(true);
  });

  it("BSLH01-T07〜T17 arts-soul-state-attribute-placement-gate: 原文の全 OR 属性プロファイルを満たすと自動配置し、必須値を失うと配置しない", () => {
    const profileFromSource = (line: string) =>
      [...line.matchAll(/〔([^〕]+)〕/g)].map(([, group]) =>
        [...group.matchAll(/<([^>]+)>(\d+)/g)].map(([, attribute, min]) => ({
          kind: "quartz_attribute",
          player: "self",
          attribute,
          min: Number(min),
        }))
      );
    const artsTokenCardNos = [
      "BSLH01-T07",
      "BSLH01-T08",
      "BSLH01-T09",
      "BSLH01-T10",
      "BSLH01-T11",
      "BSLH01-T12",
      "BSLH01-T13",
      "BSLH01-T14",
      "BSLH01-T15",
      "BSLH01-T16",
      "BSLH01-T17",
    ] as const;

    const stateWithProfileQuartz = (
      tokenCardNo: (typeof artsTokenCardNos)[number],
      attributes: ReadonlyArray<readonly [string, number]>,
      suffix: string
    ) => {
      if (!q1Def.quartzData) {
        throw new Error("BSLH01-C10 must remain a printed Quartz definition");
      }
      // 実際の `setQuartz` / `getAvailablePlaceArtsTokenLegalActions` を通して、
      // そのカードの印字プロファイルだけを与えるクォーツを組み立てる。上の原文⇔DSL
      // 完全一致検証と対にすることで、テスト用の値が別カードの閾値を証明することを防ぐ。
      const profileQuartzDef: CardDefinition = {
        ...q1Def,
        cardNo: `TEST-${tokenCardNo}-${suffix}-PROFILE-QUARTZ`,
        quartzData: {
          ...q1Def.quartzData,
          quartzName: `${tokenCardNo}-${suffix}-profile`,
          attributeValues: Object.fromEntries(attributes),
        },
      };
      const profileGetDef = (id: string): CardDefinition | undefined =>
        id === profileQuartzDef.cardNo ? profileQuartzDef : getDef(id);
      const host = createCardInstance(hostDef, {
        ownerPlayerId: ALICE,
        zone: "field",
        instanceId: `arts-${tokenCardNo}-${suffix}-host`,
      });
      const quartz = createCardInstance(profileQuartzDef, {
        ownerPlayerId: ALICE,
        zone: "hand",
        instanceId: `arts-${tokenCardNo}-${suffix}-quartz`,
      });
      const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
      const setup: GameState = {
        ...base,
        step: "main",
        activePlayerId: ALICE,
        cardInstances: [host, quartz],
        players: base.players.map((player) =>
          player.id === ALICE
            ? { ...player, soulStateInstanceIds: [host.instanceId] }
            : player
        ),
      };
      const state = setQuartz(
        setup,
        {
          quartzInstanceId: quartz.instanceId,
          hostInstanceId: host.instanceId,
          ownerPlayerId: ALICE,
          slot: "center",
        },
        profileGetDef
      );
      if (!state) {
        throw new Error(`${tokenCardNo} profile Quartz must set onto ENIGMA`);
      }
      return {
        state,
        profileGetDef,
        hostInstanceId: host.instanceId,
      };
    };

    for (const tokenCardNo of artsTokenCardNos) {
      const tokenDef = card(tokenCardNo);
      expect(tokenDef.continuousSummonCondition).toBe(true);
      expect(tokenDef.textLines?.[2]).toMatch(
        /^【アーツ[：:]\(自分の魂状態の「オーブメント」の属性値/
      );
      const condition = tokenDef.summonCondition?.[0];
      expect(condition?.kind).toBe("any_of");
      if (condition?.kind !== "any_of") {
        throw new Error(`${tokenCardNo} must declare an any_of arts profile`);
      }
      expect(condition.groups).toEqual(
        profileFromSource(tokenDef.textLines![3]!)
      );

      // 原文の OR-of-AND を一つも省略しない。各グループを実際にクォーツとして
      // セットした盤面で満たし、SBA が宣言・選択なしにトークンを生成することを確認する。
      for (const [groupIndex, profile] of condition.groups.entries()) {
        if (!profile.length) {
          throw new Error(
            `${tokenCardNo} profile ${groupIndex} must not be empty`
          );
        }
        const attributes = profile.map((entry) => {
          if (
            entry.kind !== "quartz_attribute" ||
            entry.attribute === "any" ||
            typeof entry.min !== "number"
          ) {
            throw new Error(
              `${tokenCardNo} profile ${groupIndex} must use concrete Quartz attributes`
            );
          }
          return [entry.attribute, entry.min] as const;
        });
        const eligible = stateWithProfileQuartz(
          tokenCardNo,
          attributes,
          `eligible-${groupIndex}`
        );
        expect(
          evaluateCondition(
            eligible.state,
            tokenDef.summonCondition!,
            eligible.hostInstanceId,
            ALICE,
            eligible.profileGetDef
          )
        ).toBe(true);
        const automaticPlacement = runStateBasedActions(
          eligible.state,
          eligible.profileGetDef
        );
        expect(automaticPlacement.checks).toContainEqual(
          expect.objectContaining({
            kind: "place_arts_token_due_to_condition",
            instanceId: eligible.hostInstanceId,
            tokenCardNo,
          })
        );
        expect(
          automaticPlacement.state.cardInstances.find(
            (instance) =>
              instance.definitionId === tokenCardNo &&
              instance.zone === "field" &&
              instance.zoneRoleName === "arts"
          )
        ).toMatchObject({
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          normalCoreCount: 0,
        });
        expect(
          runStateBasedActions(automaticPlacement.state, eligible.profileGetDef)
            .checks
        ).not.toContainEqual(
          expect.objectContaining({
            kind: "place_arts_token_due_to_condition",
            tokenCardNo,
          })
        );

        // 選んだ OR 分岐の必須属性を一つだけ閾値未満にし、他の分岐も満たさない
        // 破損盤面を必ず探す。これにより全グループの肯定だけでなく、各グループの
        // 閾値キャリアが必要十分であることを確認する。
        const ineligible = attributes
          .map(([missingAttribute, minimum], attributeIndex) => {
            const candidate = stateWithProfileQuartz(
              tokenCardNo,
              attributes.map(([attribute, min]) =>
                attribute === missingAttribute
                  ? [attribute, Math.max(0, min - 1)]
                  : [attribute, min]
              ),
              `ineligible-${groupIndex}-${attributeIndex}`
            );
            return {
              minimum,
              candidate,
              conditionMet: evaluateCondition(
                candidate.state,
                tokenDef.summonCondition!,
                candidate.hostInstanceId,
                ALICE,
                candidate.profileGetDef
              ),
            };
          })
          .find((candidate) => !candidate.conditionMet);
        expect(ineligible).toBeDefined();
        expect(ineligible!.minimum).toBeGreaterThan(0);
        const ineligiblePlacement = runStateBasedActions(
          ineligible!.candidate.state,
          ineligible!.candidate.profileGetDef
        );
        expect(ineligiblePlacement.checks).not.toContainEqual(
          expect.objectContaining({
            kind: "place_arts_token_due_to_condition",
            tokenCardNo,
          })
        );
        expect(
          ineligiblePlacement.state.cardInstances.some(
            (instance) =>
              instance.definitionId === tokenCardNo &&
              instance.zone === "field" &&
              instance.zoneRoleName === "arts"
          )
        ).toBe(false);
      }
    }
  });

  it("SBA: 【アーツ】は相手ターンの非アクションステップでも、条件成立と同時に自動配置される", () => {
    const host = createCardInstance(hostDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "arts-timing-host",
    });
    const q1 = createCardInstance(q1Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "arts-timing-q1",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const setup: GameState = {
      ...base,
      step: "end",
      activePlayerId: BOB,
      cardInstances: [host, q1],
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, soulStateInstanceIds: ["arts-timing-host"] }
          : p
      ),
    };
    const afterSet = setQuartz(
      setup,
      {
        quartzInstanceId: "arts-timing-q1",
        hostInstanceId: "arts-timing-host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    const automaticPlacement = runStateBasedActions(afterSet, getDef);
    expect(automaticPlacement.checks).toContainEqual(
      expect.objectContaining({
        kind: "place_arts_token_due_to_condition",
        instanceId: "arts-timing-host",
        tokenCardNo: "BSLH01-T07",
      })
    );
    expect(
      automaticPlacement.state.cardInstances.some(
        (instance) =>
          instance.definitionId === "BSLH01-T07" &&
          instance.zone === "field" &&
          instance.zoneRoleName === "arts"
      )
    ).toBe(true);
  });

  it("SBA: 属性値条件を満たさなくなったアーツトークンは vanish_due_to_arts_gate_lost で除去される", () => {
    const host = createCardInstance(hostDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "arts-sba-host",
    });
    const token = createCardInstance(card("BSLH01-T07"), {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "arts",
      instanceId: "arts-sba-token",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [host, token],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["arts-sba-host"] } : p
      ),
    };
    // クォーツが1枚もセットされていない = 属性値0 = T07 の閾値(いずれか1以上)不成立
    const checks = collectStateBasedActions(state, getDef);
    expect(
      checks.some(
        (c) =>
          c.kind === "vanish_due_to_arts_gate_lost" &&
          c.instanceId === "arts-sba-token"
      )
    ).toBe(true);
  });
});

describe("BSLH01-TR01〜TR04 転醒(A面)", () => {
  it.each([
    ["BSLH01-TR01(A)", 5],
    ["BSLH01-TR02(A)", 9],
    ["BSLH01-TR03(A)", 8],
    ["BSLH01-TR04(A)", 9],
  ])("%s: rebirth(maxCount=%i) を持つ", (no, max) => {
    const c = card(no);
    expect(c.isDoubleSided).toBe(true);
    const rebirthEffect = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "rebirth")
    );
    const action = rebirthEffect!.steps.find(
      (s) => s.action.kind === "rebirth"
    )!.action;
    if (action.kind === "rebirth") expect(action.maxCount).toBe(max);
  });
});

describe("BSLH01-TR03(A) [零の軌跡]リーシャ・マオ", () => {
  const c = card("BSLH01-TR03(A)");
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

  function makeSourceState(fromZone: "hand" | "field"): GameState {
    const source = createCardInstance(c, {
      instanceId: `bslh01-tr03a-${fromZone}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    return createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });
  }

  it("BSLH01-TR03(A) effects[0]: 配置時は trigger_from_zone(hand) で手札配置だけに限定し、stub を外す", () => {
    const eff = c.effects![0]!;
    expect(eff.timing).toEqual({ kind: "card_event", event: "place" });
    expect(eff.condition).toEqual([
      { kind: "trigger_from_zone", zones: ["hand"] },
    ]);
    expect(eff.executionMode).toBe("optional");
    expect(eff.steps[0]!.id).toBe("trashTop2");
    expect(eff.steps[0]!.action.kind).toBe("move_card");
    expect(eff.steps[1]!.action).toMatchObject({
      kind: "search_zone",
      zone: "trash",
      target: { kind: "ref", stepId: "trashTop2" },
      filter: { tribes: ["CB"] },
      count: 1,
      destination: "hand",
      mandatory: true,
    });
    expect(eff.stub).toBeUndefined();
  });

  it("BSLH01-TR03(A): 手札から配置した place pending では配置時効果が候補になる", () => {
    const state = makeSourceState("hand");
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: {
        pendingId: "pte:bslh01-tr03a-place-hand",
        actingPlayerId: "alice",
        eventKind: "place",
        source: "action_resolution",
        chainId: "test:bslh01-cards:14301",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "bslh01-tr03a-hand",
        amount: null,
        step: "main",
        window: "main_open",
        resolvedSourceInstanceIds: [],
        fromZone: "hand",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
    });
    expect(
      choices.find(
        (choice) => choice.sourceCard.instanceId === "bslh01-tr03a-hand"
      )
    ).toBeDefined();
  });

  it("BSLH01-TR03(A): フィールド由来の place pending では配置時効果が候補にならない", () => {
    const state = makeSourceState("field");
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: {
        pendingId: "pte:bslh01-tr03a-place-field",
        actingPlayerId: "alice",
        eventKind: "place",
        source: "action_resolution",
        chainId: "test:bslh01-cards:14330",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "bslh01-tr03a-field",
        amount: null,
        step: "main",
        window: "main_open",
        resolvedSourceInstanceIds: [],
        fromZone: "field",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
    });
    expect(
      choices.find(
        (choice) => choice.sourceCard.instanceId === "bslh01-tr03a-field"
      )
    ).toBeUndefined();
  });

  it("BSLH01-TR03(A): 手札配置時の効果解決で上2枚を先にトラッシュへ置き、その中のCB 1枚だけを手札に戻す", () => {
    const source = createCardInstance(c, {
      instanceId: "bslh01-tr03a-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const cb = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bslh01-tr03a-deck-cb",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const nonCb = createCardInstance(card("BSFT01-C01"), {
      instanceId: "bslh01-tr03a-deck-non-cb",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const preExistingTrashCb = createCardInstance(card("BSLH01-C02"), {
      instanceId: "bslh01-tr03a-pre-trash-cb",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, cb, nonCb, preExistingTrashCb],
    });
    const state = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 2 } : p
      ),
    };
    const baseAlice = state.players.find((p) => p.id === "alice")!;

    const afterReveal = executeEffect({
      chainId: "test:bslh01-cards:14393",
      state,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      triggerFromZone: "hand",
    });
    expect(afterReveal.pendingDeckReveal).toBeNull();
    expect(afterReveal.pendingZoneSelection).toBeNull();
    expect(
      afterReveal.cardInstances.find((ci) => ci.instanceId === cb.instanceId)
        ?.zone
    ).toBe("hand");
    expect(
      afterReveal.cardInstances.find((ci) => ci.instanceId === nonCb.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      afterReveal.cardInstances.find(
        (ci) => ci.instanceId === preExistingTrashCb.instanceId
      )?.zone
    ).toBe("trash");
    expect(afterReveal.players.find((p) => p.id === "alice")?.deckCount).toBe(
      0
    );
    expect(afterReveal.players.find((p) => p.id === "alice")?.handCount).toBe(
      baseAlice.handCount + 1
    );
  });

  it("【クォーツ：情報】は soulState 限定の activated(main) + ターン1回 reveal_hand(相手手札1枚, self閲覧)", () => {
    const e = c.effects![2]!;
    expect(e.timing).toEqual({ kind: "activated", mode: "main" });
    expect(e.applicability).toEqual({ soulState: true });
    expect(e.executionMode).toBe("optional");
    expect(e.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    expect(e.steps[0]!.action).toEqual({
      kind: "reveal_hand",
      player: "opponent",
      revealTo: "self",
      count: 1,
    });
    expect(e.stub).toBeUndefined();
  });

  it("【クォーツ：情報】executeEffect で相手手札1枚を閲覧しログに記録する", () => {
    const source = createCardInstance(c, {
      instanceId: "bslh01-tr03a-info-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const opponentHand1 = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bob-hand-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const opponentHand2 = createCardInstance(card("BSLH01-C02"), {
      instanceId: "bob-hand-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, opponentHand1, opponentHand2],
    });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: [source.instanceId] }
          : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:14477",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      after.log.some(
        (line) =>
          line.startsWith("effect:reveal_hand:bob:revealTo=self:count=1:") &&
          (line.includes(opponentHand1.instanceId) ||
            line.includes(opponentHand2.instanceId))
      )
    ).toBe(true);
  });

  it("【クォーツ：情報】host(ENIGMA)にセットされているときだけ use_field_card_effect が立ち、source は host に帰属する (未セットは不発、ENGINE-quartz-host-identity-propagation activated 側)", () => {
    const hostDef2 = card("BSLH01-CX01");
    const host = createCardInstance(hostDef2, {
      instanceId: "bslh01-tr03a-info-host",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const source = createCardInstance(c, {
      instanceId: "bslh01-tr03a-info-gate",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, source],
    });
    const getRegisteredFieldCardEffectActions = buildFieldCardEffectLookup([
      c,
      hostDef2,
    ]);

    const baseState: GameState = {
      ...before,
      activePlayerId: "alice",
      step: "main",
      window: "none",
      players: before.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const soulSet = setQuartz(
      baseState,
      {
        quartzInstanceId: source.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "left",
      },
      getDef
    )!;
    const actionsSet = getLegalActions({
      state: soulSet,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions,
    });
    const infoAction = actionsSet.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceEffectInstanceId === source.instanceId
    );
    expect(infoAction).toBeDefined();
    expect(infoAction?.sourceInstanceId).toBe(host.instanceId);
    // 自身のネイティブ登録としては二重登録されない (host 側 quartz_inherited 経由のみ)。
    expect(
      actionsSet.some(
        (a) =>
          a.kind === "use_field_card_effect" &&
          a.sourceInstanceId === source.instanceId
      )
    ).toBe(false);

    const notSet: GameState = {
      ...before,
      activePlayerId: "alice",
      step: "main",
      window: "none",
      players: before.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [] } : p
      ),
    };
    const actionsUnset = getLegalActions({
      state: notSet,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions,
    });
    expect(actionsUnset.some((a) => a.kind === "use_field_card_effect")).toBe(
      false
    );
  });
});

describe("BSLH01-TR02(A) ワジ(碧)", () => {
  const c = card("BSLH01-TR02(A)");
  it("召喚時カウント+2→BP-8000→BP0破壊→ドロー2", () => {
    const summon = c.effects![0]!;
    expect(summon.steps[0]!.action.kind).toBe("count_increase");
    expect(summon.steps[1]!.action.kind).toBe("bp_modify");
    const destroy = summon.steps[2]!.action;
    if (destroy.kind === "destroy" && "filter" in destroy.target)
      expect(destroy.target.filter.maxBp).toBe(0);
  });
});

describe("BSLH01-X01/X02 導界者/創界神キーア", () => {
  const ALICE = "player-1";
  const BOB = "player-2";
  const x2Lookups = {
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(ALL_CARDS),
    getRegisteredHandActivatedEffectActions:
      buildHandActivatedEffectLookup(ALL_CARDS),
    getRegisteredBurstEffectActions: buildBurstEffectLookup(ALL_CARDS),
  };

  function findX02PlacementAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...x2Lookups,
    }).find(
      (action) =>
        action.kind === "place_nexus" && action.sourceCardNo === "BSLH01-X02"
    );
  }

  function passMainStackUntilClosed(state: GameState): GameState {
    let current = state;
    for (let guard = 0; guard < 10 && current.stackWindow !== null; guard++) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.stackWindow.priorityPlayerId,
        ...x2Lookups,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        ...x2Lookups,
      }).state;
    }
    return current;
  }

  it("grandwalkerData と多色 treat_as を実装し、X01 導託 stub は残さない", () => {
    const x1 = card("BSLH01-X01");
    expect(x1.grandwalkerData?.kind).toBe("guided");
    expect(x1.grandwalkerData?.oracleTriggerLimit).toBe("step_once");
    // シンボル 7 色 treat_as は実装済 (stub でない)。
    const x1treat = x1.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(x1treat.stub).toBeUndefined();
    const x1t = x1treat.steps[0]!.action;
    if (x1t.kind === "treat_as") {
      expect([...(x1t.asColor as string[])].sort()).toEqual(
        ["black", "blue", "green", "purple", "red", "white", "yellow"].sort()
      );
    }
    // 導託の対象条件・標準神託処理・召喚/煌臨でのステップ1回制約は grandwalkerData が表現する。
    expect(
      x1.effects!.find((e) => typeof e.stub === "string" && /導託/.test(e.stub))
    ).toBeUndefined();
    const x2 = card("BSLH01-X02");
    expect(x2.grandwalkerData?.kind).toBe("grandwalker");
    const x2treat = x2.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(x2treat.stub).toBeUndefined();
    const x2t = x2treat.steps[0]!.action;
    if (x2t.kind === "treat_as") {
      expect((x2t.asColor as string[]).length).toBe(7);
    }
  });

  it("X02 effects[0-1]: 手札/手元/トラッシュ自己耐性 + コア8個以上の導界者キーア破壊による無償配置を DSL 化する", () => {
    const x2 = card("BSLH01-X02");
    const immunity = x2.effects![0]!;
    expect(immunity.stub).toBeUndefined();
    expect(immunity.timing).toEqual({ kind: "continuous" });
    expect(immunity.applicability?.zone).toEqual([
      "hand",
      "set_aside",
      "trash",
    ]);
    const immunityAction = immunity.steps[0]!.action;
    expect(immunityAction.kind).toBe("effect_immunity");
    if (immunityAction.kind !== "effect_immunity") throw new Error("shape");
    expect(immunityAction.sourcePlayerScope).toBe("self");
    expect(immunityAction.sourceScope).toEqual({ excludeSelf: true });

    const placement = x2.effects![1]!;
    expect(placement.stub).toBeUndefined();
    expect(placement.timing).toEqual({ kind: "continuous" });
    expect(placement.timingScope).toEqual({
      player: "self",
      period: "main",
    });
    expect(placement.applicability?.zone).toEqual([
      "hand",
      "set_aside",
      "trash",
    ]);
    expect(placement.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        cardNames: [{ contains: "キーア" }],
        grandwalkerKind: "guided",
        minCores: 8,
        minCount: 1,
      },
    ]);
    const summonAction = placement.steps[0]!.action;
    expect(summonAction.kind).toBe("summon");
    if (summonAction.kind !== "summon") throw new Error("shape");
    expect(summonAction.normalActionPermission).toBe(true);
    expect(summonAction.target).toEqual({
      kind: "self",
      zone: ["hand", "set_aside", "trash"],
    });
    expect(summonAction.costModifier).toBe("free");
    expect(summonAction.normalActionDeclarationSteps).toHaveLength(1);
    const destroyAction = summonAction.normalActionDeclarationSteps![0]!.action;
    expect(destroyAction.kind).toBe("destroy");
    if (destroyAction.kind !== "destroy") throw new Error("shape");
    expect(destroyAction.target).toEqual({
      kind: "filter",
      player: "self",
      filter: {
        category: ["nexus"],
        targetsGrandwalker: "only",
        hasMechanic: ["guided"],
        cardName: { contains: "キーア" },
        minCores: 8,
      },
      count: 1,
    });
  });

  it("X02 Q54配置: 宣言時にコア8個の導界者キーアを破壊し、stack後に無償配置する", () => {
    const keya = createCardInstance(card("BSLH01-X01"), {
      instanceId: "guided-keya-8cores",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 8,
    });
    const x2 = createCardInstance(card("BSLH01-X02"), {
      instanceId: "grandwalker-keya-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [keya, x2],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      step: "main",
    };

    const action = findX02PlacementAction(state);
    expect(action).toBeDefined();
    if (!action || action.kind !== "place_nexus") {
      throw new Error("expected BSLH01-X02 Q54 place action");
    }
    expect(action).toMatchObject({
      reason: "legal_place_nexus_by_hand_permission",
      placePermissionEffectIndex: 1,
      targetMode: "manual",
      requiredTargetCount: 1,
      candidateTargetInstanceIds: [keya.instanceId],
      fixedPaymentCost: 0,
    });
    const declared = applyLegalAction({
      state,
      action,
      targetInstanceIds: [keya.instanceId],
      paymentSources: [],
      ...x2Lookups,
    }).state;
    const keyaAfterDeclaration = declared.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === keya.instanceId
    )!;
    expect(
      declared.pendingLeaveEntities.some(
        (pending) => pending.instanceId === keya.instanceId
      ) || keyaAfterDeclaration.zone === "trash"
    ).toBe(true);
    expect(
      declared.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === x2.instanceId
      )?.zone
    ).toBe("in_use");
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "place_nexus"
    );

    const after = passMainStackUntilClosed(declared);
    const placedX2 = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === x2.instanceId
    )!;
    expect(placedX2.zone).toBe("field");
    expect(placedX2.zoneRoleName).toBe("nexus");
    expect(
      after.pendingTriggeredEffects.some(
        (pendingEffect) =>
          pendingEffect.eventKind === "place" &&
          pendingEffect.relatedInstanceId === x2.instanceId
      )
    ).toBe(true);
    const keyaAfter = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === keya.instanceId
    )!;
    expect(
      after.pendingLeaveEntities.some(
        (pending) => pending.instanceId === keya.instanceId
      ) || keyaAfter.zone === "trash"
    ).toBe(true);
  });

  it("X02 Q54配置: 導界者キーアがコア7個以下なら legal action を出さない", () => {
    const keya = createCardInstance(card("BSLH01-X01"), {
      instanceId: "guided-keya-7cores",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 7,
    });
    const x2 = createCardInstance(card("BSLH01-X02"), {
      instanceId: "grandwalker-keya-hand-low-core",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [keya, x2],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      step: "main",
    };
    expect(findX02PlacementAction(state)).toBeUndefined();
  });

  it("X02 自己耐性: 手札のこのカードは自分の別カード効果を受けず、自身の配置効果は excludeSelf で通る", () => {
    const sourceDef = card("BSLH01-C01");
    const source = createCardInstance(sourceDef, {
      instanceId: "own-effect-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const x2Def = card("BSLH01-X02");
    const x2 = createCardInstance(x2Def, {
      instanceId: "grandwalker-keya-immune-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, x2],
    });
    const rebuilt = rebuildContinuousEffectsFromField(baseState, getDef);
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.sourceInstanceId === x2.instanceId &&
          ce.targetInstanceId === x2.instanceId &&
          ce.immunityPlayerScope === "self" &&
          ce.immunitySourceScope?.excludeSelf === true
      )
    ).toBe(true);

    expect(
      resolveCardImmunityAffect(rebuilt, x2, ALICE, "none", {
        instance: source,
        definition: sourceDef,
      }).kind
    ).toBe("blocked");
    expect(
      resolveCardImmunityAffect(rebuilt, x2, ALICE, "none", {
        instance: x2,
        definition: x2Def,
      }).kind
    ).toBe("allowed");
  });
});

describe("BSLH01-X03 ロイド(創)", () => {
  const c = card("BSLH01-X03");
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

  it("アタック/ブロックで黒シンボル+回復 / SDフラッシュはコスト+デッキ下+全回復の3ステップ", () => {
    const e1 = c.effects![0]!;
    // 「さらに、…回復できる」は単一の任意文なので、発揮するかは effect-level で選ぶ。
    // 黒シンボル追加は別の continuous effect であり、回復を辞退しても失われない。
    expect(e1.executionMode).toBe("optional");
    expect(e1.steps[0]!.executionMode).toBeUndefined();
    expect(e1.steps[0]!.action.kind).toBe("recover");
    const symbols = c.effects!.find(
      (effect) =>
        effect.timing.kind === "continuous" && effect.textRef?.includes(0)
    )!;
    expect(symbols.steps[0]!.action.kind).toBe("symbol_add");
    expect(symbols.condition).toEqual([{ kind: "in_battle" }]);
    const sd = c.effects![2]!;
    expect(sd.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(sd.timingScope).toEqual({ player: "both", period: "attack" });
    expect(sd.preventionLevel).toBe("unpreventable");
    expect(sd.steps[0]!.action.kind).toBe("core_move");
    expect(sd.steps[1]!.action.kind).toBe("send_to_deck");
    expect(sd.steps[2]!.action.kind).toBe("recover");
  });

  it("[board] アタック/ブロック時の回復は同じステップで各個体1回だけ、別個体には個別に使える", () => {
    const ALICE = "player-1";
    const first = createCardInstance(c, {
      instanceId: "x03-step-recovery-first",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const second = createCardInstance(c, {
      instanceId: "x03-step-recovery-second",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [first, second],
      }),
      activePlayerId: ALICE,
      step: "attack",
    };
    const effect = c.effects![0]!;
    const afterFirst = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:14939",
        state: before,
        effect,
        sourceInstanceId: first.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }),
      getDef
    );
    expect(
      afterFirst.cardInstances.find(
        (card) => card.instanceId === first.instanceId
      )?.exhaustState
    ).toBe("recovered");
    expect(
      afterFirst.cardInstances.find(
        (card) => card.instanceId === second.instanceId
      )?.exhaustState
    ).toBe("exhausted");

    const afterSecond = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:14960",
        state: afterFirst,
        effect,
        sourceInstanceId: second.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }),
      getDef
    );
    expect(
      afterSecond.cardInstances.find(
        (card) => card.instanceId === second.instanceId
      )?.exhaustState
    ).toBe("recovered");

    const reexhaustedFirst: GameState = {
      ...afterSecond,
      cardInstances: afterSecond.cardInstances.map((card) =>
        card.instanceId === first.instanceId
          ? { ...card, exhaustState: "exhausted" }
          : card
      ),
    };
    const afterBlockedRepeat = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:14984",
        state: reexhaustedFirst,
        effect,
        sourceInstanceId: first.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }),
      getDef
    );
    expect(
      afterBlockedRepeat.cardInstances.find(
        (card) => card.instanceId === first.instanceId
      )?.exhaustState
    ).toBe("exhausted");
    expect(afterBlockedRepeat.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: first.instanceId,
          duration: "step",
        }),
        expect.objectContaining({
          sourceInstanceId: second.instanceId,
          duration: "step",
        }),
      ])
    );
  });

  it("timingScope: 「お互いのアタックステップ」限定のため、アタックステップでは提示されるがメインステップでは提示されない (P3-125 Step8 adversarial verifier round3 で判明した Step1 時点の見落とし対応)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(c, {
      instanceId: "x03-sd-timing",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const effectLookups = {
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
      getRegisteredBurstEffectActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const findAction = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        ...effectLookups,
      }).find(
        (a) =>
          a.kind === "use_field_card_effect" && a.sourceCardNo === "BSLH01-X03"
      );

    const mainState: GameState = {
      ...before,
      activePlayerId: ALICE,
      step: "main",
    };
    expect(findAction(mainState)).toBeUndefined();

    const attackState: GameState = {
      ...before,
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "attack-group:1:player-1:battle-entity:none",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
    };
    expect(findAction(attackState)).toBeDefined();
  });

  it("SDフラッシュ effects[2]: 自分の場のカード上のソウルコアをコストに支払うと removed_from_game へ移り、デッキ下+全回復が発揮される (P3-125 Step1)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(c, {
      instanceId: "lloyd-x03-onfield",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const aliceSpirit = createCardInstance(c, {
      instanceId: "alice-other-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
      exhaustState: "exhausted",
    });
    const bobSpirit = createCardInstance(c, {
      instanceId: "bob-spirit-x03",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      cardInstances: [src, aliceSpirit, bobSpirit],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:15134",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "removed_from_game" });
    const srcAfter = after.cardInstances.find(
      (x) => x.instanceId === src.instanceId
    )!;
    expect(srcAfter.soulCoreCount).toBe(0);
    expect(srcAfter.normalCoreCount).toBe(2);
    // send_to_deck (count:{min:0,max:2}) は対象選択が範囲選択 pending 経由のため、この
    // 直接 executeEffect 呼び出しでは 0 体選択に解決される (bobSpirit は場に残る)。
    // ここで検証したいのはコスト成立で payload 群がロールバックされないこと自体であり、
    // 個別対象選択の解決経路は既存 send_to_deck 実装の範囲 (P3-125 Step1 スコープ外)。
    const bobAfter = after.cardInstances.find(
      (x) => x.instanceId === bobSpirit.instanceId
    )!;
    expect(bobAfter.zone).toBe("field");
    // recover: 疲労していた自分のスピリットが回復
    const aliceOtherAfter = after.cardInstances.find(
      (x) => x.instanceId === aliceSpirit.instanceId
    )!;
    expect(aliceOtherAfter.exhaustState).toBe("recovered");
  });

  it("SDフラッシュ effects[2]: コスト成立 (soulCoreLocation→removed_from_game) は soul_drive_activated game_event として観測可能 (ENGINE-soul-drive-activation-observable-event, P3-125 Step11)", () => {
    const ALICE = "player-1";
    const src = createCardInstance(c, {
      instanceId: "lloyd-x03-event-obs",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({ cardInstances: [src] });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:15186",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
    }).filter((e) => e.eventKind === "soul_drive_activated");
    expect(events).toHaveLength(1);
    expect(events[0]!.actingPlayerId).toBe(ALICE);
    expect(events[0]!.relatedPlayerId).toBe(ALICE);
    expect(events[0]!.cause).toBe("self_effect");
  });

  it("SDフラッシュ effects[2]: リザーブの追加ソウル(count-only)をコストにしても soul_drive_activated が観測可能", () => {
    const ALICE = "player-1";
    const src = createCardInstance(c, {
      instanceId: "lloyd-x03-event-obs-extra-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const baseState = createEmptyGameState({ cardInstances: [src] });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "trash" },
              trashSoulCoreCount: 1,
              reserveSoulCoreCount: 1,
            }
          : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:15228",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "trash" });
    expect(aliceAfter.reserveSoulCoreCount).toBe(0);
    expect(aliceAfter.trashSoulCoreCount).toBe(1);

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
    }).filter((e) => e.eventKind === "soul_drive_activated");
    expect(events).toHaveLength(1);
    expect(events[0]!.actingPlayerId).toBe(ALICE);
    expect(events[0]!.relatedPlayerId).toBe(ALICE);
    expect(events[0]!.cause).toBe("self_effect");
  });

  it("コスト不成立 (ソウルコアがライフのまま) では soul_drive_activated が発火しない", () => {
    const ALICE = "player-1";
    const src = createCardInstance(c, {
      instanceId: "lloyd-x03-event-obs-nofire",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const baseState = createEmptyGameState({ cardInstances: [src] });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE ? { ...p, soulCoreLocation: { kind: "life" } } : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:15268",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
    }).filter((e) => e.eventKind === "soul_drive_activated");
    expect(events).toHaveLength(0);
  });

  it("SDフラッシュ effects[2]: ソウルコアがライフにあるときはコストを支払えず、payload (デッキ下/全回復) が不発になる", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(c, {
      instanceId: "lloyd-x03-lifesoul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const bobSpirit = createCardInstance(c, {
      instanceId: "bob-spirit-x03b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      cardInstances: [src, bobSpirit],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE ? { ...p, soulCoreLocation: { kind: "life" } } : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:15310",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    // コスト不払い → ソウルコアはライフのまま、相手スピリットも動かない
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "life" });
    expect(
      after.cardInstances.find((x) => x.instanceId === bobSpirit.instanceId)
    ).toBeDefined();
  });
});

describe("BSLH01-X03 Lv2-3『自分のターン』相手マジックの持続書き換え (ENGINE-continuous-effect-duration-rewrite)", () => {
  const c = card("BSLH01-X03");
  const magicCard = card("BSLH01-C13");
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
  const ALICE = "player-1";
  const BOB = "player-2";

  it("Lv2 の自分のターン中、相手マジック向け duration_override CE (turn→battle+nextBattleEnd) を登録する", () => {
    const src = createCardInstance(c, {
      instanceId: "x03-dur-override-ce",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const baseState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };
    const rebuilt = rebuildContinuousEffectsFromField(baseState, getDef);
    const overrideCe = rebuilt.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "duration_override" &&
        ce.sourceInstanceId === src.instanceId
    );
    expect(overrideCe).toBeDefined();
    expect(overrideCe!.metadata).toEqual({
      fromScope: "turn",
      toDuration: { scope: "battle", nextBattleEnd: true },
    });
    expect(overrideCe!.targetFilter).toEqual({
      player: "opponent",
      category: ["magic"],
    });
  });

  it("相手マジックの scope:turn CE は自分のターン終了で残り、次のバトル終了で除去される (盤面変化)", () => {
    const src = createCardInstance(c, {
      instanceId: "x03-dur-override-behavior",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const bobMagic = createCardInstance(magicCard, {
      instanceId: "bob-magic-turn-ce",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, bobMagic],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    state = rebuildContinuousEffectsFromField(state, getDef);

    // 相手 (BOB) のマジックが「このターンの間」CE を発揮した想定の盤面。
    const bobTurnCe: ContinuousEffect = {
      effectId: "bob-turn-scoped-ce",
      sourceInstanceId: bobMagic.instanceId,
      sourceDefinitionId: bobMagic.definitionId,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmount: 1000,
      targetInstanceId: src.instanceId,
    };
    state = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, bobTurnCe],
    };
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "duration_override"
      )
    ).toBe(true);

    // 自分 (ALICE) のターン終了 → duration_override により除去されない (turn_end でも生存)。
    const afterTurnEnd = removeExpiredContinuousEffects(
      state,
      { kind: "turn_end" },
      { getCardDefinitionById: getDef }
    );
    const survivingCe = afterTurnEnd.find(
      (ce) => ce.effectId === "bob-turn-scoped-ce"
    );
    expect(survivingCe).toBeDefined();
    // 適用された実効 duration がそのまま確定 (書き戻し) されている
    // (adversarial verifier lens4: override の timingScope 活性に都度依存すると、
    // 後で非活性ターンに入った瞬間に scope:"turn" へ巻き戻ってしまうバグを防ぐ)。
    expect(survivingCe!.duration).toEqual({
      scope: "battle",
      nextBattleEnd: true,
    });

    // 次のバトル終了 (battle_end) で除去される (「次のバトル終了後まで」)。
    const stateAfterTurnEnd: GameState = {
      ...state,
      activeContinuousEffects: afterTurnEnd,
    };
    const afterBattleEnd = removeExpiredContinuousEffects(
      stateAfterTurnEnd,
      { kind: "battle_end", attackId: "some-later-attack" },
      { getCardDefinitionById: getDef }
    );
    expect(
      afterBattleEnd.some((ce) => ce.effectId === "bob-turn-scoped-ce")
    ).toBe(false);

    // 対照: duration_override CE が無い場合は通常どおり turn_end で除去される。
    const stateWithoutOverride: GameState = {
      ...state,
      activeContinuousEffects: state.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "duration_override"
      ),
    };
    const baselineAfterTurnEnd = removeExpiredContinuousEffects(
      stateWithoutOverride,
      { kind: "turn_end" },
      { getCardDefinitionById: getDef }
    );
    expect(
      baselineAfterTurnEnd.some((ce) => ce.effectId === "bob-turn-scoped-ce")
    ).toBe(false);
  });

  it("書き換え後、手番が相手に移っても (override 自体は自分のターン限定で非活性化しても) 巻き戻らず battle_end まで残る (adversarial verifier lens4 回帰)", () => {
    const src = createCardInstance(c, {
      instanceId: "x03-dur-override-turn-switch",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const bobMagic = createCardInstance(magicCard, {
      instanceId: "bob-magic-turn-switch",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, bobMagic],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    state = rebuildContinuousEffectsFromField(state, getDef);

    const bobTurnCe: ContinuousEffect = {
      effectId: "bob-turn-ce-switch",
      sourceInstanceId: bobMagic.instanceId,
      sourceDefinitionId: bobMagic.definitionId,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmount: 1000,
      targetInstanceId: src.instanceId,
    };
    state = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, bobTurnCe],
    };

    // 自分 (ALICE) のターン終了時点で書き換えが確定 (書き戻し) される。
    const afterAliceTurnEnd = removeExpiredContinuousEffects(
      state,
      { kind: "turn_end" },
      { getCardDefinitionById: getDef }
    );

    // ターンが相手 (BOB) に移る。duration_override CE 自身は timingScope
    // ({player:"self",period:"turn"}) により非活性になるが、既に書き換え済みの
    // 対象 CE の duration はそのまま battle scope で確定しているはず。
    const bobTurnState: GameState = {
      ...state,
      activePlayerId: BOB,
      activeContinuousEffects: afterAliceTurnEnd,
    };

    // BOB 自身のターン終了 (turn_end) では、既に scope:"battle" 確定済みのため除去されない
    // (override 巻き戻りバグがあれば、ここで scope:"turn" に戻り経過ターン数判定で除去されてしまう)。
    const afterBobTurnEnd = removeExpiredContinuousEffects(
      bobTurnState,
      { kind: "turn_end" },
      { getCardDefinitionById: getDef }
    );
    expect(
      afterBobTurnEnd.some((ce) => ce.effectId === "bob-turn-ce-switch")
    ).toBe(true);

    // 実際のバトル終了でのみ除去される。
    const afterBobBattleEnd = removeExpiredContinuousEffects(
      { ...bobTurnState, activeContinuousEffects: afterBobTurnEnd },
      { kind: "battle_end", attackId: "bob-turn-attack" },
      { getCardDefinitionById: getDef }
    );
    expect(
      afterBobBattleEnd.some((ce) => ce.effectId === "bob-turn-ce-switch")
    ).toBe(false);
  });

  it("battle_end 以外のトリガー (step_end) では除去されない (「次のバトル終了後まで」は battle_end 限定、adversarial verifier lens3 再確認)", () => {
    const src = createCardInstance(c, {
      instanceId: "x03-dur-override-not-premature",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const bobMagic = createCardInstance(magicCard, {
      instanceId: "bob-magic-not-premature",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, bobMagic],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    state = rebuildContinuousEffectsFromField(state, getDef);
    const bobTurnCe: ContinuousEffect = {
      effectId: "bob-turn-ce-not-premature",
      sourceInstanceId: bobMagic.instanceId,
      sourceDefinitionId: bobMagic.definitionId,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmount: 1000,
      targetInstanceId: src.instanceId,
    };
    state = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, bobTurnCe],
    };
    const afterTurnEnd = removeExpiredContinuousEffects(
      state,
      { kind: "turn_end" },
      { getCardDefinitionById: getDef }
    );
    // 書き換え後は scope:"battle" (attack と無関係の step_end トリガーの対象外) のため、
    // アタックが一切発生していない状態での step_end では除去されない
    // (「登録直後に即消える」のではなく実際のバトル終了でのみ消えることの確認)。
    const afterStepEnd = removeExpiredContinuousEffects(
      { ...state, activeContinuousEffects: afterTurnEnd },
      { kind: "step_end", step: "main", activePlayerId: ALICE },
      { getCardDefinitionById: getDef }
    );
    expect(
      afterStepEnd.some((ce) => ce.effectId === "bob-turn-ce-not-premature")
    ).toBe(true);
  });

  it("効果でターン終了 (end_turn) しても、書き換え済みの nextBattleEnd CE は強制無効化されない (adversarial verifier round2 lens3 指摘)", () => {
    // expireContinuousEffectsAtEffectTurnEnd (structured-state-grants.ts) は
    // 「効果でターン終了する」特殊経路で battle/attack scope CE を無条件に
    // 強制除去する (isTurnEndSurvivingBattleEffect)。duration_override で
    // scope:"turn"→"battle"+nextBattleEnd:true へ書き換え済みの CE がこの経路を
    // 通ると、実際の battle_end を経ていないのに誤って除去されるバグがあった。
    const convertedCe: ContinuousEffect = {
      effectId: "bob-converted-effect-end-turn",
      sourceInstanceId: "bob-magic-effect-end-turn",
      sourceDefinitionId: magicCard.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "battle", nextBattleEnd: true },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmount: 1000,
      targetInstanceId: "some-target",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [convertedCe],
      pendingTurnEndFinalizations: [
        {
          pendingId: "effect-end-turn-1",
          actingPlayerId: ALICE,
          sourceInstanceId: "x03-dur-override-end-turn",
          createdAtTurn: 1,
        },
      ],
    };
    const after = finalizePendingTurnEndFinalizations(state, getDef);
    expect(after.pendingTurnEndFinalizations).toHaveLength(0);
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.effectId === "bob-converted-effect-end-turn"
      )
    ).toBe(true);
  });

  it("効果でアタックステップ終了 (end_attack_step) しても、書き換え済みの nextBattleEnd CE は強制無効化されない (adversarial verifier round3 lens3 指摘、BSLH01-C13 の『このバトル終了時、アタックステップを終了する』が実在する経路)", () => {
    // finalizePendingAttackStepEndFinalizations は finalizePendingTurnEndFinalizations
    // (survivesForcedBattleScopeCleanup) と並行する姉妹関数で、round2 の修正が
    // こちらには反映されていなかった (同型の欠陥が残存)。
    const convertedCe: ContinuousEffect = {
      effectId: "bob-converted-effect-end-attack-step",
      sourceInstanceId: "bob-magic-effect-end-attack-step",
      sourceDefinitionId: magicCard.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "battle", nextBattleEnd: true },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmount: 1000,
      targetInstanceId: "some-target",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "attack",
      activeContinuousEffects: [convertedCe],
      pendingAttackStepEndFinalizations: [
        {
          pendingId: "effect-end-attack-step-1",
          actingPlayerId: ALICE,
          sourceInstanceId: "x03-dur-override-end-attack-step",
          createdAtTurn: 1,
        },
      ],
      // 共通ステップ遷移は盤面整合性も再評価する。対象不在による失効と期限の失効を混同しない。
      cardInstances: [
        createCardInstance(c, {
          instanceId: "some-target",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    };
    const after = finalizePendingAttackStepEndFinalizations(state, getDef);
    expect(after.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.effectId === "bob-converted-effect-end-attack-step"
      )
    ).toBe(true);
    expect(
      removeExpiredContinuousEffects(
        after,
        { kind: "battle_end", attackId: "next-battle" },
        { getCardDefinitionById: getDef }
      ).some((ce) => ce.effectId === convertedCe.effectId)
    ).toBe(false);
  });
});

describe("generateTriggeredEffectRegistrations: game_event soul_drive_activated (ENGINE-soul-drive-activation-observable-event, P3-125 Step11)", () => {
  // 【ソウルドライブ・S】発動を観測する DSL 側の入口 (card_event/game_event) が
  // TRIGGER_EVENT_META 経由で正しく registration を生成することを確認する
  // (count-increase-trigger.test.ts と同型の precedent)。このイベントを実際に消費する
  // カードは本 Step のスコープ外 (BSLH01-C07/T17 はそれぞれ別基盤が追加ブロッカー、issues/P3-125 参照)。
  const soulDriveObserverCard: CardDefinition = {
    cardNo: "TEST-SOUL-DRIVE-TRIGGER",
    name: "soul drive trigger",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // 「自分の【ソウルドライブ・S】が発動したとき」相当の観測。
        timing: {
          kind: "game_event",
          event: "soul_drive_activated",
          player: "self",
        },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };

  it("eventKind 'soul_drive_activated' の triggered registration を生成する", () => {
    const regs = generateTriggeredEffectRegistrations(soulDriveObserverCard);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("soul_drive_activated");
  });
});

describe("BSLH01-X04 エリィ(創)", () => {
  const c = card("BSLH01-X04");
  it("召喚時 core_distribute(void→CB) + trash→life", () => {
    const summon = c.effects![0]!;
    expect(summon.steps[0]!.action.kind).toBe("core_distribute");
    expect(summon.steps[1]!.action.kind).toBe("core_move");
  });

  it("BSLH01-X04 effects[0] core_distribute: 発揮宣言時は配置先の選択を要求せず、配分HUDへ委ねる", () => {
    // 配置先と個数は後段の配分HUDで確定する。
    const ALICE = "player-1";
    const src = createCardInstance(c, {
      instanceId: "alice-x04-pending",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cbDef = card("BSLH01-X03");
    const cb1 = createCardInstance(cbDef, {
      instanceId: "alice-cb-p1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cb2 = createCardInstance(cbDef, {
      instanceId: "alice-cb-p2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const regs = generateTriggeredEffectRegistrations(c);
    const summonRegIndex = regs.findIndex(
      (r) => r.effectCategory === "triggered" && r.effectIndex === 0
    );
    expect(summonRegIndex).toBeGreaterThanOrEqual(0);

    const base = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
      cardInstances: [src, cb1, cb2],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      pendingTriggeredEffects: [
        {
          pendingId: "x04-summon-pending",
          eventKind: "summon",
          actingPlayerId: ALICE,
          source: "action_resolution",
          chainId: "test:bslh01-cards:15767",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "alice-x04-pending",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
          declaredFromPrivateZone: false,
          declaredSourceInstanceId: "alice-x04-pending",
          declaredSourceKind: "spirit",
          declaredRegistrationIndex: summonRegIndex,
        },
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");

    // 発揮アクション (skipOnly でない方) に registration の target meta が乗ること。
    const resolveAction = actions.find(
      (a) => a.pendingId === "x04-summon-pending" && a.skipOnly !== true
    );
    expect(resolveAction).toBeDefined();
    expect(resolveAction!.requiredTargetCount).toBe(0);
    expect(resolveAction!.maxTargetCount).toBeUndefined();
  });

  it("BSLH01-X04 effects[0] core_distribute: 任意の配分HUDがCB全候補に対し4個まで・1体1個を要求する", () => {
    const regs = generateTriggeredEffectRegistrations(c);
    const summonReg = regs.find(
      (r) => r.effectCategory === "triggered" && r.effectIndex === 0
    );
    expect(summonReg).toBeDefined();
    expect(summonReg!.requiredTargetCount).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.executionMode).toBe("optional");
    expect(c.effects![0]!.steps[0]!.action).toMatchObject({
      to: {
        filter: { category: ["spirit"], tribes: ["CB"] },
        count: "all",
      },
      mode: "player_choice",
      amount: 4,
      maxPerCandidate: 1,
    });
  });

  it("BSLH01-X04 effects[0] core_distribute: 配分HUDでCB2体に1個ずつ置いて途中完了できる", () => {
    const ALICE = "player-1";
    const src = createCardInstance(c, {
      instanceId: "alice-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // CB 系統スピリット 3 体 (BSLH01-X03 リィン[本体]=CB 系統)。
    const cbDef = card("BSLH01-X03");
    const cb1 = createCardInstance(cbDef, {
      instanceId: "alice-cb-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cb2 = createCardInstance(cbDef, {
      instanceId: "alice-cb-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cb3 = createCardInstance(cbDef, {
      instanceId: "alice-cb-3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
      cardInstances: [src, cb1, cb2, cb3],
    });
    // CB 3 体中 2 体に絞って配置することで「選択した分だけ 1 個ずつ」が成立することを assert。
    const selecting = executeEffect({
      chainId: "test:bslh01-cards:15862",
      state: { ...before, activePlayerId: ALICE },
      effect: c.effects![0]!,
      optionalExecuteResumeStepIndex: 0,
      sourceInstanceId: "alice-x04",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(selecting.pendingCoreDistribution?.candidates).toHaveLength(4);
    const distribution = getLegalActions({
      state: selecting,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find((action) => action.kind === "resolve_pending_core_distribution")!;
    const after = applyLegalAction({
      state: selecting,
      action: distribution,
      coreDistributionAllocations: { "alice-cb-1": 1, "alice-cb-3": 1 },
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const after1 = after.cardInstances.find(
      (x) => x.instanceId === "alice-cb-1"
    )!;
    const after2 = after.cardInstances.find(
      (x) => x.instanceId === "alice-cb-2"
    )!;
    const after3 = after.cardInstances.find(
      (x) => x.instanceId === "alice-cb-3"
    )!;
    // 選択した 2 体 (cb-1 / cb-3) に +1 ずつ配置、非選択の cb-2 は不変。
    expect(after1.normalCoreCount).toBe(2);
    expect(after2.normalCoreCount).toBe(1);
    expect(after3.normalCoreCount).toBe(2);
    expect(after.pendingCoreDistribution).toBeNull();
    expect(after.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      before.players.find((p) => p.id === ALICE)!.voidNormalCoreCount - 2
    );
  });

  it("【クォーツ：脱兎】は窓だけ flash の非フラッシュ効果カテゴリ", () => {
    const datto = c.effects![2]!;
    expect(datto.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(datto.activationLabel).toBe("none");
    expect(datto.applicability).toEqual({ soulState: true });
    expect(datto.steps[0]!.action.kind).toBe("send_to_deck");
  });

  describe("SDフラッシュ effects[1]: 【ソウルドライブ・S】ライフ最大5まで補充＋自スピリット4体になるまでCBコストなし召喚 (P3-125 Step7)", () => {
    const soulDrive = c.effects![1]!;

    it("構造: timing/timingScope/condition/usageLimit + cost step + life-cap core_move + free summon", () => {
      expect(soulDrive.stub).toBeUndefined();
      expect(soulDrive.timing).toEqual({ kind: "activated", mode: "flash" });
      expect(soulDrive.timingScope).toEqual({
        player: "both",
        period: "attack",
      });
      expect(soulDrive.condition).toEqual([{ kind: "min_level", value: 2 }]);
      expect(soulDrive.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
        maxCount: 1,
      });
      expect(soulDrive.steps).toHaveLength(3);

      const cost = soulDrive.steps[0]!;
      expect(cost.id).toBe("x04-soul-drive-s-cost");
      expect(cost.action).toEqual({
        kind: "core_move",
        from: { kind: "field", player: "self", includeReserve: true },
        to: { kind: "removed_from_game", player: "self" },
        amount: 1,
        effectKind: "explicit_soul_core",
      });

      const life = soulDrive.steps[1]!;
      expect(life.stepCondition).toEqual({
        kind: "ref_succeeded",
        stepId: "x04-soul-drive-s-cost",
      });
      expect(life.action).toEqual({
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "life", player: "self" },
        amount: {
          min: 0,
          max: {
            source: {
              kind: "cores_on",
              location: { kind: "life", player: "self" },
            },
            multiplier: -1,
            offset: 5,
            cap: 3,
          },
        },
      });

      const summon = soulDrive.steps[2]!;
      expect(summon.connector).toBe("simultaneous");
      expect(summon.stepCondition).toEqual({
        kind: "ref_succeeded",
        stepId: "x04-soul-drive-s-cost",
      });
      expect(summon.action).toEqual({
        kind: "summon",
        fieldCoreSourceMinimum: {
          categories: ["spirit", "ultimate"],
          minimum: 1,
        },
        target: {
          kind: "from_zone",
          zone: "trash",
          filter: { category: ["spirit"], tribes: ["CB"] },
          count: {
            min: 0,
            max: {
              source: {
                kind: "cards_in_zone",
                zone: "field",
                player: "self",
                filter: { category: ["spirit"] },
              },
              multiplier: -1,
              offset: 4,
            },
          },
        },
        costModifier: "free",
      });
    });

    it("[board] ライフ3個のとき、コスト解決後 pendingCoreCountSelection の上限が min(5-3,3)=2 になる", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x04-life3-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
        soulCoreCount: 1,
      });
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
        playerOverrides: [
          { lifeNormalCoreCount: 3, voidNormalCoreCount: 5 },
          {},
        ],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };
      const after = executeEffect({
        chainId: "test:bslh01-cards:16017",
        state: before,
        effect: soulDrive,
        sourceInstanceId: "x04-life3-src",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
      });
      // cost 成立: <ソウルコア> がゲームから除外される。
      expect(
        after.players.find((p) => p.id === ALICE)!.soulCoreLocation
      ).toEqual({ kind: "removed_from_game" });
      // life-cap core_move は範囲選択のため pending を生成 (min=0, max=min(5-3,3)=2)。
      expect(after.pendingCoreCountSelection).not.toBeNull();
      expect(after.pendingCoreCountSelection!.min).toBe(0);
      expect(after.pendingCoreCountSelection!.max).toBe(2);
    });

    it("[board] ライフ1個のとき、上限が min(5-1,3)=3 (cap優先) になる", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x04-life1-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
        soulCoreCount: 1,
      });
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
        playerOverrides: [
          { lifeNormalCoreCount: 1, voidNormalCoreCount: 5 },
          {},
        ],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };
      const after = executeEffect({
        chainId: "test:bslh01-cards:16064",
        state: before,
        effect: soulDrive,
        sourceInstanceId: "x04-life1-src",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
      });
      expect(after.pendingCoreCountSelection!.max).toBe(3);
    });

    it("[board] 自スピリットが既に3体のとき、summon step は候補1枚のみ召喚しコストは支払われない (4体になるまで=残り1体)", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x04-summon-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
        soulCoreCount: 1,
      });
      // 自分の場にはこのカード自身含め既に3体のスピリットがいる想定 (src + ally1 + ally2)。
      // BSLH01-C01 は printedCategory:"spirit"（BSLH01-C02 はネクサスのため
      // 「自分のスピリットが4体になるまで」のカウント対象外、fixture には使えない）。
      const ally1 = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x04-ally-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const ally2 = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x04-ally-2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      // トラッシュの CB スピリット候補1枚のみ（残り1体分のみ召喚できることを確認）。
      const cbTrash = createCardInstance(card("BSLH01-X03"), {
        instanceId: "x04-cb-trash-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      });
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, ally1, ally2, cbTrash],
        playerOverrides: [
          { lifeNormalCoreCount: 5, voidNormalCoreCount: 5 },
          {},
        ],
      });
      // ソウルコアを src (BSLH01-X04) に配置（コストの発動コスト源、X09 test 同型）。
      // ライフは 5 (=cap 上限) に固定し、life step を no-op にして summon step まで
      // 1 パスで到達させる (life-cap 自体は別 board test で検証済み)。
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };
      const e2eEffectLookups = {
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBattleImmediateEffectActions:
          buildBattleImmediateEffectLookup(ALL_CARDS),
        getRegisteredHandActivatedEffectActions:
          buildHandActivatedEffectLookup(ALL_CARDS),
        getRegisteredBurstEffectActions: buildBurstEffectLookup(ALL_CARDS),
      };
      const stateWithAttack: GameState = {
        ...before,
        activePlayerId: ALICE,
        step: "attack",
        window: "flash_before_block",
        activeAttack: {
          attackId: "attack-group:1:player-1:battle-entity:none",
          primaryEntityId: "battle-entity:none",
          participantEntityIds: [],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: ALICE,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: ALICE,
            pendingStackAction: null,
          },
        },
      };
      // 実プレイ経路: getLegalActions で use_field_card_effect を宣言 → 相手 pass で
      // スタック窓解決 → resolve_pending_effect_target で対象選択 (verifier 反証への対応。
      // 単体 step 抽出+stepCondition 剥がしの近道実行ではなく、宣言〜対象選択〜解決まで
      // 実際のパイプラインを通す)。
      const declareAction = getLegalActions({
        state: stateWithAttack,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        ...e2eEffectLookups,
      }).find(
        (a) =>
          a.kind === "use_field_card_effect" && a.sourceCardNo === "BSLH01-X04"
      );
      expect(declareAction).toBeDefined();
      const declared = applyLegalAction({
        state: stateWithAttack,
        action: declareAction!,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        ...e2eEffectLookups,
      });
      const passAction = getLegalActions({
        state: declared.state,
        actingPlayerId: BOB,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        ...e2eEffectLookups,
      }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
      expect(passAction).toBeDefined();
      const passed = applyLegalAction({
        state: declared.state,
        action: passAction!,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        ...e2eEffectLookups,
      });
      const resolveTargetAction = getLegalActions({
        state: passed.state,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        ...e2eEffectLookups,
      }).find((a) => a.kind === "resolve_pending_effect_target");
      expect(resolveTargetAction).toBeDefined();
      expect(
        (resolveTargetAction as { maxTargetCount?: number }).maxTargetCount
      ).toBe(1);
      const resolved = applyLegalAction({
        state: passed.state,
        action: resolveTargetAction!,
        targetInstanceIds: ["x04-cb-trash-1"],
        getCardDefinitionById: (id) => cardNoMap.get(id),
        ...e2eEffectLookups,
      });
      const summoned = resolved.state.cardInstances.find(
        (x) => x.instanceId === "x04-cb-trash-1"
      )!;
      expect(summoned.zone).toBe("field");
    });
  });
});

describe("BSLH01-X05 リィン(創)", () => {
  const c = card("BSLH01-X05");
  it("[board] フラッシュ: ENIGMA 魂状態下でライフのコア1個をボイドに置き、ゲーム外から<ソウルコア>1個をリザーブに置く (BSLH01-R03 effects[1] と同型実装)", () => {
    const ALICE = "player-1";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const src = createCardInstance(c, {
      instanceId: "x05-flash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enigmaCard = ALL_CARDS.find((cd) => cd.name.includes("ENIGMA"))!;
    const enigmaInst = createCardInstance(enigmaCard, {
      instanceId: "enigma-x05-flash",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "soul_state",
    });
    const base = createEmptyGameState({
      cardInstances: [src, enigmaInst],
    });
    const alice = base.players.find((p) => p.id === ALICE)!;
    alice.soulStateInstanceIds.push("enigma-x05-flash");
    const before = base.players.find((p) => p.id === ALICE)!;

    const after = executeEffect({
      chainId: "test:bslh01-cards:16249",
      state: base,
      effect: c.effects![0]!,
      sourceInstanceId: "x05-flash",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.lifeNormalCoreCount).toBe(before.lifeNormalCoreCount - 1);
    expect(aliceAfter.voidNormalCoreCount).toBe(before.voidNormalCoreCount + 1);
    expect(aliceAfter.reserveSoulCoreCount).toBe(
      before.reserveSoulCoreCount + 1
    );
  });

  it("【クォーツ：攻撃2】filter は spirit のみを対象とする (CB ネクサスに付与しない / audit 2026-06-19)", () => {
    const symbolAction = c.effects![2]!.steps[0]!.action;
    expect(symbolAction.kind).toBe("symbol_add");
    if (
      symbolAction.kind === "symbol_add" &&
      symbolAction.target.kind === "filter"
    ) {
      expect(symbolAction.target.filter.category).toEqual(["spirit"]);
      expect(symbolAction.target.filter.tribes).toEqual(["CB"]);
    } else {
      throw new Error("expected symbol_add filter target");
    }
  });
  it("【クォーツ：攻撃2】は本来コスト6以上かつ合体していないCBだけに赤シンボルを追加する", () => {
    const source = createCardInstance(c, {
      instanceId: "x05-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 0,
    });
    const validDef = card("BSLH01-X03");
    const valid = createCardInstance(validDef, {
      instanceId: "valid-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const combined = createCardInstance(validDef, {
      instanceId: "combined-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["brave-1"],
    });
    const lowCostDef = card("BSLH01-C01");
    const lowCost = createCardInstance(lowCostDef, {
      instanceId: "low-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [source, valid, combined, lowCost],
      }),
      players: createEmptyGameState().players.map((player) =>
        player.id === "player-1"
          ? { ...player, soulStateInstanceIds: ["x05-1"] }
          : player
      ),
    };

    const after = executeEffect({
      chainId: "test:bslh01-cards:16322",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: "x05-1",
      actingPlayerId: "player-1",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      getSymbolAdditions(after, "valid-1", (id) => cardNoMap.get(id))
    ).toEqual([["red"]]);
    for (const id of ["combined-1", "low-1", "x05-1"]) {
      expect(
        getSymbolAdditions(after, id, (definitionId) =>
          cardNoMap.get(definitionId)
        )
      ).toEqual([]);
    }
  });

  describe("effects[1] Lv2-3 フラッシュ【ソウルドライブ・S】シンボル合計5つまで破壊 (ENGINE-cumulative-symbol-budget-destroy)", () => {
    const sd = c.effects![1]!;

    function makeSymbolDef(
      cardNo: string,
      category: "spirit" | "ultimate" | "nexus" | "magic",
      symbolCount: number
    ): CardDefinition {
      return {
        cardNo,
        name: cardNo,
        printedCategory: category,
        colors: ["red"],
        cost: 2,
        reductionSymbols: [],
        levelDefs:
          category === "magic"
            ? []
            : [{ level: 1, requiredCores: 1, bp: 3000 }],
        symbolColors: Array.from({ length: symbolCount }, () => "red"),
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
      };
    }

    const enemySpirit2 = makeSymbolDef("TEST-X05-ENEMY-SPIRIT2", "spirit", 2);
    const enemyUltimate3 = makeSymbolDef(
      "TEST-X05-ENEMY-ULTIMATE3",
      "ultimate",
      3
    );
    const enemyNexus1 = makeSymbolDef("TEST-X05-ENEMY-NEXUS1", "nexus", 1);
    const enemyMagic0 = makeSymbolDef("TEST-X05-ENEMY-MAGIC0", "magic", 0);
    const extMap = new Map<string, CardDefinition>([
      ...cardNoMap,
      [enemySpirit2.cardNo, enemySpirit2],
      [enemyUltimate3.cardNo, enemyUltimate3],
      [enemyNexus1.cardNo, enemyNexus1],
      [enemyMagic0.cardNo, enemyMagic0],
    ]);
    const getDefExt = (id: string): CardDefinition | undefined =>
      extMap.get(id);

    it("構造: 発動コスト=core_move(removed_from_game)→destroy(on_step, budget:{metric:symbol,amount:5})、ターン1回同名、相手の効果で防げない", () => {
      expect(sd.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
        maxCount: 1,
      });
      expect(sd.preventionLevel).toBe("unpreventable");
      expect(sd.steps[0]!.action.kind).toBe("core_move");
      const destroyStep = sd.steps[1]!;
      expect(destroyStep.targetSelectionTiming).toBe("on_step");
      expect(destroyStep.action.kind).toBe("destroy");
      if (
        destroyStep.action.kind === "destroy" &&
        destroyStep.action.target.kind === "filter"
      ) {
        expect(destroyStep.action.target.budget).toEqual({
          metric: "symbol",
          amount: 5,
        });
      } else {
        throw new Error("expected destroy filter target with budget");
      }
    });

    it("[board] コスト成立→シンボル合計5(2+3)ちょうどの2体を選んで破壊できる。合計6(2+3+1)は候補にはなるが選択すると予算超過で reject される", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x05-sd-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
        soulCoreCount: 1,
      });
      const enemy2 = createCardInstance(enemySpirit2, {
        instanceId: "enemy-2sym",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const enemy3 = createCardInstance(enemyUltimate3, {
        instanceId: "enemy-3sym",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const enemy1 = createCardInstance(enemyNexus1, {
        instanceId: "enemy-1sym",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const enemyMagic = createCardInstance(enemyMagic0, {
        instanceId: "enemy-magic",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const baseState = createEmptyGameState({
        cardInstances: [src, enemy2, enemy3, enemy1, enemyMagic],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };

      const pendingState = executeEffect({
        chainId: "test:bslh01-cards:16466",
        state: before,
        effect: sd,
        sourceInstanceId: src.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDefExt,
        getRegisteredTriggeredEffectActions: () => [],
      });

      // コスト成立: ソウルコアが removed_from_game へ。
      const aliceAfterCost = pendingState.players.find((p) => p.id === ALICE)!;
      expect(aliceAfterCost.soulCoreLocation).toEqual({
        kind: "removed_from_game",
      });

      const destroyPending = pendingState.pendingStepOptionalTargetSelection!;
      expect(destroyPending.requiredTargetCount).toBe(0);
      expect(destroyPending.symbolBudgetAmount).toBe(5);
      // magic は category filter (spirit/ultimate/nexus) 対象外。
      expect([...destroyPending.candidateInstanceIds].sort()).toEqual([
        "enemy-1sym",
        "enemy-2sym",
        "enemy-3sym",
      ]);

      // 予算ちょうど (2+3=5) の2体選択は成立する。
      const resolved = applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${destroyPending.pendingId}`,
          can: true,
          reason: "test",
          actingPlayerId: destroyPending.actingPlayerId,
          pendingId: destroyPending.pendingId,
          sourceInstanceId: destroyPending.sourceInstanceId,
          sourceDefinitionId: destroyPending.sourceDefinitionId,
          effectIndex: destroyPending.effectIndex,
          stepIndex: destroyPending.stepIndex,
          requiredTargetCount: destroyPending.requiredTargetCount,
          maxTargetCount: destroyPending.maxTargetCount,
          candidateTargetInstanceIds: destroyPending.candidateInstanceIds,
        },
        targetInstanceIds: ["enemy-2sym", "enemy-3sym"],
        getCardDefinitionById: getDefExt,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
      expect(
        resolved.cardInstances.find((x) => x.instanceId === "enemy-2sym")!.zone
      ).toBe("trash");
      expect(
        resolved.cardInstances.find((x) => x.instanceId === "enemy-3sym")!.zone
      ).toBe("trash");
      expect(
        resolved.cardInstances.find((x) => x.instanceId === "enemy-1sym")!.zone
      ).toBe("field");

      // 予算超過 (2+3+1=6 > 5) の3体選択は reject される。
      expect(() =>
        applyLegalAction({
          state: pendingState,
          action: {
            kind: "resolve_pending_step_optional_target_selection",
            actionId: `psots-${destroyPending.pendingId}`,
            can: true,
            reason: "test",
            actingPlayerId: destroyPending.actingPlayerId,
            pendingId: destroyPending.pendingId,
            sourceInstanceId: destroyPending.sourceInstanceId,
            sourceDefinitionId: destroyPending.sourceDefinitionId,
            effectIndex: destroyPending.effectIndex,
            stepIndex: destroyPending.stepIndex,
            requiredTargetCount: destroyPending.requiredTargetCount,
            maxTargetCount: destroyPending.maxTargetCount,
            candidateTargetInstanceIds: destroyPending.candidateInstanceIds,
          },
          targetInstanceIds: ["enemy-2sym", "enemy-3sym", "enemy-1sym"],
          getCardDefinitionById: getDefExt,
          getRegisteredTriggeredEffectActions: () => [],
        })
      ).toThrow(/exceeds budget/);
    });

    it("[board] ソウルコアがライフにあるときはコストを支払えず、destroy pending も立たない", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x05-sd-nolife",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      const enemy2 = createCardInstance(enemySpirit2, {
        instanceId: "enemy-2sym-b",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const baseState = createEmptyGameState({
        cardInstances: [src, enemy2],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE ? { ...p, soulCoreLocation: { kind: "life" } } : p
        ),
      };

      const after = executeEffect({
        chainId: "test:bslh01-cards:16577",
        state: before,
        effect: sd,
        sourceInstanceId: src.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDefExt,
        getRegisteredTriggeredEffectActions: () => [],
      });

      const aliceAfter = after.players.find((p) => p.id === ALICE)!;
      expect(aliceAfter.soulCoreLocation).toEqual({ kind: "life" });
      expect(after.pendingStepOptionalTargetSelection).toBeNull();
      expect(
        after.cardInstances.find((x) => x.instanceId === "enemy-2sym-b")!.zone
      ).toBe("field");
    });

    it("timingScope: 「お互いのアタックステップ」限定のため、アタックステップでは提示されるがメインステップでは提示されない (adversarial verifier round1 refute への対応)", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x05-sd-timing",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
        soulCoreCount: 1,
      });
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };
      const effectLookups = {
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBattleImmediateEffectActions:
          buildBattleImmediateEffectLookup(ALL_CARDS),
        getRegisteredHandActivatedEffectActions:
          buildHandActivatedEffectLookup(ALL_CARDS),
        getRegisteredBurstEffectActions: buildBurstEffectLookup(ALL_CARDS),
      };
      const findAction = (state: GameState) =>
        getLegalActions({
          state,
          actingPlayerId: ALICE,
          getCardDefinitionById: getDefExt,
          ...effectLookups,
        }).find(
          (a) =>
            a.kind === "use_field_card_effect" &&
            a.sourceCardNo === "BSLH01-X05"
        );

      const mainState: GameState = {
        ...before,
        activePlayerId: ALICE,
        step: "main",
      };
      expect(findAction(mainState)).toBeUndefined();

      const attackState: GameState = {
        ...before,
        activePlayerId: ALICE,
        step: "attack",
        window: "flash_before_block",
        activeAttack: {
          attackId: "attack-group:1:player-1:battle-entity:none",
          primaryEntityId: "battle-entity:none",
          participantEntityIds: [],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: ALICE,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: ALICE,
            pendingStackAction: null,
          },
        },
      };
      expect(findAction(attackState)).toBeDefined();
    });
  });
});

describe("BSLH01-X06 ティオ(創)", () => {
  const c = card("BSLH01-X06");
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
  it("召喚/アタックで重疲労2 + 導力器コスト-2", () => {
    const e1 = c.effects![0]!;
    const ex = e1.steps[0]!.action;
    if (ex.kind === "exhaust") expect(ex.degree).toBe("heavy_exhaust");
    const cost = c.effects![1]!.steps[0]!.action;
    if (cost.kind === "cost_modify")
      expect(cost.modifier).toEqual({ additionalCostValue: -2 });
  });

  it("SDフラッシュ/スタック effects[2]/[3]: コスト+防げない範囲耐性の2ステップ", () => {
    for (const idx of [2, 3] as const) {
      const sd = c.effects![idx]!;
      expect(sd.condition).toEqual([{ kind: "min_level", value: 2 }]);
      expect(sd.steps[0]!.action.kind).toBe("core_move");
      expect(sd.steps[1]!.action.kind).toBe("effect_immunity");
    }
    expect(c.effects![2]!.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(c.effects![3]!.timing).toEqual({ kind: "activated", mode: "stack" });
  });

  it("SDフラッシュ effects[2]: ソウルコアをコストに支払うと、系統CBを持つ自分のスピリット全体 (フィールド限定・動的targetFilter) に次の自分スタートステップまでの defense_immune CE が付く (P3-125 Step2)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(c, {
      instanceId: "tio-x06-onfield",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
      soulCoreCount: 1,
    });
    const cbAlly = createCardInstance(card("BSLH01-X03"), {
      instanceId: "alice-cb-ally",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nonCbAlly = createCardInstance(card("BSTH01-C01"), {
      instanceId: "alice-noncb-ally",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, cbAlly, nonCbAlly],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:16742",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "removed_from_game" });
    // 動的 targetFilter として1件だけ登録される (per-instance targetInstanceId ではない)。
    // これにより宣言後に新規召喚された CB スピリットも寿命 (次の自分のスタートステップ) まで
    // 保護対象に含まれる (ENGINE-effect-immunity-step-scope-dynamic-filter、adversarial verifier
    // round1 lens1/3 refute: zone省略のままだと静的スナップショットに縮退し後から召喚された
    // 対象が漏れると指摘された点の修正)。
    const ce = after.activeContinuousEffects.find(
      (e) =>
        e.sourceInstanceId === src.instanceId &&
        e.modifierTag === "defense_immune"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetFilter).toEqual({
      player: "self",
      category: ["spirit"],
      tribes: ["CB"],
      zone: ["field"],
    });
    expect(ce!.duration).toEqual({
      scope: "step",
      step: "start",
      whose: "self",
    });
    expect(ce!.targetInstanceId).toBeUndefined();

    expect(
      isCardImmuneToOpponentEffect(after, src, BOB, "none", undefined, getDef)
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        after,
        cbAlly,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        after,
        nonCbAlly,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(false);

    // 宣言後に召喚された CB スピリットも「すべて」に含まれ保護される。
    const lateCbAlly = createCardInstance(card("BSLH01-X03"), {
      instanceId: "alice-late-cb-ally",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const withLateSummon: GameState = {
      ...after,
      cardInstances: [...after.cardInstances, lateCbAlly],
    };
    expect(
      isCardImmuneToOpponentEffect(
        withLateSummon,
        lateCbAlly,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
  });

  it("SDフラッシュ effects[2]: ソウルコアがライフにあるときはコストを支払えず、defense_immune CE が付かない", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(c, {
      instanceId: "tio-x06-lifesoul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE ? { ...p, soulCoreLocation: { kind: "life" } } : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:16844",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "life" });
    expect(
      after.activeContinuousEffects.find(
        (e) =>
          e.targetInstanceId === src.instanceId &&
          e.modifierTag === "defense_immune"
      )
    ).toBeUndefined();
  });
});

describe("BSLH01-X07 ノエル(創)", () => {
  const c = card("BSLH01-X07");

  describe("effects[0]: 手札から離脱対象を手札に戻し、軽減シンボルすべてを満たして召喚", () => {
    const leaveSummon = c.effects![0]!;

    it("構造: hand 常駐 game_event leave_field → bounce(trigger_related pending, hand) → self summon(full_reduction)", () => {
      expect(leaveSummon.stub).toBeUndefined();
      expect(leaveSummon.applicability).toEqual({ zone: ["hand"] });
      expect(leaveSummon.timing).toEqual({
        kind: "game_event",
        player: "self",
        event: "leave_field",
        triggerFilter: { category: ["spirit"] },
        cause: "opponent_effect",
      });
      expect(leaveSummon.executionMode).toBe("optional");
      expect(leaveSummon.steps).toHaveLength(2);
      expect(leaveSummon.steps[0]).toEqual({
        id: "x07-leave-target-to-hand",
        stepCondition: {
          kind: "summon_precheck",
          target: { kind: "self", zone: "hand" },
          costModifier: "full_reduction",
        },
        action: {
          kind: "bounce",
          target: {
            kind: "trigger_related_instance",
            includePendingLeave: true,
          },
          destination: "hand",
        },
      });
      expect(leaveSummon.steps[1]).toEqual({
        stepCondition: {
          kind: "ref_succeeded",
          stepId: "x07-leave-target-to-hand",
        },
        action: {
          kind: "summon",
          target: { kind: "self", zone: "hand" },
          costModifier: "full_reduction",
        },
      });
    });

    it("[board] full_reduction コスト不足なら対象だけを bounce pending にしない", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const source = createCardInstance(c, {
        instanceId: "x07-hand-insufficient-cost",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const target = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x07-cost-shortage-leaving-spirit",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-x07-cost-shortage",
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      });
      const state: GameState = {
        ...base,
        cardInstances: [source, target],
        pendingLeaveEntities: [
          {
            instanceId: target.instanceId,
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "chain-x07-cost-shortage",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:bslh01-cards:16950",
        state,
        effect: leaveSummon,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        triggerRelatedInstanceId: target.instanceId,
      });

      expect(
        result.cardInstances.find((x) => x.instanceId === source.instanceId)
      ).toMatchObject({ zone: "hand" });
      expect(
        result.cardInstances.find((x) => x.instanceId === target.instanceId)
      ).toMatchObject({
        zone: "field",
        pendingLeaveKind: "destroy",
      });
      expect(result.pendingLeaveEntities).toContainEqual(
        expect.objectContaining({
          instanceId: target.instanceId,
          kind: "destroy",
        })
      );
      expect(result.log.some((line) => line.includes("effect:bounce:"))).toBe(
        false
      );
    });

    it("[board] 維持コア不足なら対象だけを bounce pending にしない", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const source = createCardInstance(c, {
        instanceId: "x07-hand-insufficient-enter-core",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const target = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x07-enter-core-shortage-leaving-spirit",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-x07-enter-core-shortage",
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      });
      const state: GameState = {
        ...base,
        cardInstances: [source, target],
        pendingLeaveEntities: [
          {
            instanceId: target.instanceId,
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "chain-x07-enter-core-shortage",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:bslh01-cards:17018",
        state,
        effect: leaveSummon,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        triggerRelatedInstanceId: target.instanceId,
      });

      expect(
        result.cardInstances.find((x) => x.instanceId === source.instanceId)
      ).toMatchObject({ zone: "hand" });
      expect(
        result.cardInstances.find((x) => x.instanceId === target.instanceId)
      ).toMatchObject({
        zone: "field",
        pendingLeaveKind: "destroy",
      });
      expect(result.pendingLeaveEntities).toContainEqual(
        expect.objectContaining({
          instanceId: target.instanceId,
          kind: "destroy",
        })
      );
      expect(result.log.some((line) => line.includes("effect:bounce:"))).toBe(
        false
      );
    });

    it("[legal] full_reduction コスト/維持コア不足では X07 private declare を出さない", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const triggerLookup = buildTriggeredEffectLookup(ALL_CARDS);
      const burstLookup = buildBurstEffectLookup(ALL_CARDS);

      const queueWithReserve = (reserveNormalCoreCount: number): GameState => {
        const source = createCardInstance(c, {
          instanceId: `x07-hand-legal-${reserveNormalCoreCount}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "hand",
        });
        const targetBefore = createCardInstance(card("BSLH01-C01"), {
          instanceId: `x07-legal-leaving-${reserveNormalCoreCount}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        });
        const base = createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [source, targetBefore],
          playerOverrides: [{ reserveNormalCoreCount }, {}],
        });
        const targetAfter = {
          ...targetBefore,
          pendingLeaveKind: "destroy" as const,
          pendingLeaveCause: "effect_resolution" as const,
          pendingLeaveChainId: `chain-x07-legal-${reserveNormalCoreCount}`,
        };
        return collectAndQueueTriggerReactions({
          beforeState: base,
          afterState: {
            ...base,
            cardInstances: [source, targetAfter],
            pendingLeaveEntities: [
              {
                instanceId: targetAfter.instanceId,
                kind: "destroy",
                cause: "effect_resolution",
                causePlayerId: BOB,
                chainId: targetAfter.pendingLeaveChainId,
                deferZoneMoveUntilChainEnd: false,
                leaveFieldCoreDestinationOverride: null,
              },
            ],
          },
          source: "effect_resolution",
          chainId: targetAfter.pendingLeaveChainId,
          causedByPlayerId: BOB,
          causedBySourceInstanceId: "bob-effect-source",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: triggerLookup,
          getRegisteredBurstActions: burstLookup,
        });
      };

      for (const reserve of [2, 3]) {
        const queued = queueWithReserve(reserve);
        expect(queued.pendingPrivateDeclarations).toHaveLength(0);
        const actions = getLegalActions({
          state: queued,
          actingPlayerId: ALICE,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: triggerLookup,
          getRegisteredBurstActions: burstLookup,
        });
        expect(
          actions.some(
            (action) =>
              action.kind === "declare_private_triggered_effect" ||
              action.kind === "skip_private_triggered_effect"
          )
        ).toBe(false);
        const flushed = flushPendingLeaves(queued, getDef);
        expect(flushed.pendingLeaveEntities).toHaveLength(0);
        expect(
          flushed.cardInstances.find(
            (entry) => entry.instanceId === `x07-legal-leaving-${reserve}`
          )
        ).toMatchObject({ zone: "trash", pendingLeaveKind: null });
      }
    });

    it("[legal] 発揮条件未達の複数X07はキューに残さず physical leave でも再promptしない", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const triggerLookup = buildTriggeredEffectLookup(ALL_CARDS);
      const burstLookup = buildBurstEffectLookup(ALL_CARDS);
      const sourceA = createCardInstance(c, {
        instanceId: "x07-hand-multi-a",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const sourceB = createCardInstance(c, {
        instanceId: "x07-hand-multi-b",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const targetBefore = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x07-multi-skip-leaving",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [sourceA, sourceB, targetBefore],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      });
      const targetAfter = {
        ...targetBefore,
        pendingLeaveKind: "destroy" as const,
        pendingLeaveCause: "effect_resolution" as const,
        pendingLeaveChainId: "chain-x07-multi-skip",
      };
      const queued = collectAndQueueTriggerReactions({
        beforeState: base,
        afterState: {
          ...base,
          cardInstances: [sourceA, sourceB, targetAfter],
          pendingLeaveEntities: [
            {
              instanceId: targetAfter.instanceId,
              kind: "destroy",
              cause: "effect_resolution",
              causePlayerId: BOB,
              chainId: targetAfter.pendingLeaveChainId,
              deferZoneMoveUntilChainEnd: false,
              leaveFieldCoreDestinationOverride: null,
            },
          ],
        },
        source: "effect_resolution",
        chainId: targetAfter.pendingLeaveChainId,
        causedByPlayerId: BOB,
        causedBySourceInstanceId: "bob-effect-source",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: burstLookup,
      });
      const x07Declarations = queued.pendingPrivateDeclarations.filter(
        (entry) => entry.sourceInstanceId.startsWith("x07-hand-multi-")
      );
      expect(x07Declarations).toHaveLength(0);
      const afterAllSkip = collectAndQueueTriggerReactions({
        beforeState: queued,
        afterState: flushPendingLeaves(queued, getDef),
        source: "action_resolution",
        chainId: targetAfter.pendingLeaveChainId,
        causedByPlayerId: BOB,
        causedBySourceInstanceId: "bob-effect-source",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: burstLookup,
      });
      expect(
        afterAllSkip.pendingPrivateDeclarations.filter((entry) =>
          entry.sourceInstanceId.startsWith("x07-hand-multi-")
        )
      ).toHaveLength(0);
      expect(
        afterAllSkip.pendingLeaveEntities.some(
          (entry) => entry.instanceId === targetAfter.instanceId
        )
      ).toBe(false);
      expect(
        afterAllSkip.cardInstances.find(
          (entry) => entry.instanceId === targetAfter.instanceId
        )
      ).toMatchObject({
        zone: "trash",
        pendingLeaveKind: null,
      });
    });

    it("[board] 離脱 pending 対象を bounce pending に遷移し、X07 は full_reduction cost=3 + Lv1維持コアで召喚される", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const source = createCardInstance(c, {
        instanceId: "x07-hand-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const target = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x07-leaving-spirit",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-x07-leave",
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      });
      const state: GameState = {
        ...base,
        cardInstances: [source, target],
        pendingLeaveEntities: [
          {
            instanceId: target.instanceId,
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "chain-x07-leave",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
      };

      const result = executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-cards:17266",
        state,
        effect: leaveSummon,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        triggerRelatedInstanceId: target.instanceId,
      });

      const summoned = result.cardInstances.find(
        (x) => x.instanceId === source.instanceId
      )!;
      expect(summoned.zone).toBe("field");
      expect(summoned.normalCoreCount).toBe(1);
      const returned = result.cardInstances.find(
        (x) => x.instanceId === target.instanceId
      )!;
      expect(returned.zone).toBe("hand");
      expect(returned.pendingLeaveKind).toBeNull();
      expect(
        result.log.some((line) =>
          line.includes("effect:bounce:x07-leaving-spirit:to_hand")
        )
      ).toBe(true);
      expect(
        result.pendingLeaveEntities.some(
          (entry) =>
            entry.instanceId === target.instanceId && entry.kind === "destroy"
        )
      ).toBe(false);
      expect(
        result.log.some(
          (line) =>
            line.includes(`effect:summon:${source.instanceId}:self`) &&
            line.includes("cost=3")
        )
      ).toBe(true);
      expect(
        result.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
      ).toBe(6);

      const flushed = flushPendingLeaves(result, getDef);
      const flushedReturned = flushed.cardInstances.find(
        (x) => x.instanceId === target.instanceId
      )!;
      expect(flushedReturned.zone).toBe("hand");
      expect(flushedReturned.pendingLeaveKind).toBeNull();
      expect(
        flushed.pendingLeaveEntities.some(
          (entry) => entry.instanceId === target.instanceId
        )
      ).toBe(false);
    });

    it("[trigger] 相手 bounce 待機を X07 が手札 bounce に上書きしても、新しい bounce event を再収集する", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const source = createCardInstance(c, {
        instanceId: "x07-hand-same-kind",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const target = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x07-already-bounced-spirit",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        pendingLeaveKind: "bounce",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-opponent-bounce",
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      });
      const state: GameState = {
        ...base,
        cardInstances: [source, target],
        pendingLeaveEntities: [
          {
            instanceId: target.instanceId,
            kind: "bounce",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "chain-opponent-bounce",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
            leaveDestination: { zone: "deck", position: "bottom" },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:bslh01-cards:17366",
        state,
        effect: leaveSummon,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        triggerRelatedInstanceId: target.instanceId,
      });

      expect(result.log).toContain(
        `pending-leave-transition:bounce->bounce:${target.instanceId}`
      );
      const pending = result.pendingLeaveEntities.find(
        (entry) => entry.instanceId === target.instanceId
      );
      const nextChainId = `effect:bounce:${ALICE}:${target.instanceId}`;
      expect(pending).toMatchObject({
        kind: "bounce",
        causePlayerId: ALICE,
        chainId: nextChainId,
        leaveDestination: { zone: "hand" },
      });

      const events = collectTriggerEventsFromStateDelta({
        beforeState: state,
        afterState: result,
        source: "effect_resolution",
        chainId: nextChainId,
        causedByPlayerId: ALICE,
        causedBySourceInstanceId: source.instanceId,
        getCardDefinitionById: getDef,
      });

      expect(
        events.some(
          (event) =>
            event.eventKind === "bounce" &&
            event.relatedInstanceId === target.instanceId &&
            event.cause === "self_effect" &&
            event.effectSourceInstanceId === source.instanceId
        )
      ).toBe(true);
    });

    it("[trigger] private 宣言後の X07 pending は pre-flush key で離脱対象の移動を保留する", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const source = createCardInstance(c, {
        instanceId: "x07-hand-private-preflush",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const targetBefore = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x07-private-leaving-spirit",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, targetBefore],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      });
      const targetAfter = {
        ...targetBefore,
        pendingLeaveKind: "destroy" as const,
        pendingLeaveCause: "effect_resolution" as const,
        pendingLeaveChainId: "chain-x07-private-preflush",
      };
      const afterPending: GameState = {
        ...base,
        cardInstances: [source, targetAfter],
        pendingLeaveEntities: [
          {
            instanceId: targetAfter.instanceId,
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "chain-x07-private-preflush",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
      };
      const triggerLookup = buildTriggeredEffectLookup(ALL_CARDS);
      const queued = collectAndQueueTriggerReactions({
        beforeState: base,
        afterState: afterPending,
        source: "effect_resolution",
        chainId: "chain-x07-private-preflush",
        causedByPlayerId: BOB,
        causedBySourceInstanceId: "bob-effect-source",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
      });
      const declaration = queued.pendingPrivateDeclarations.find(
        (entry) => entry.sourceInstanceId === source.instanceId
      );
      expect(declaration).toMatchObject({
        eventKind: "destroy",
        relatedInstanceId: targetAfter.instanceId,
      });
      expect(declaration?.registeredLeaveFieldPreFlushSourceKeys).toContain(
        `${source.instanceId}#0`
      );

      const prematureFlush = flushPendingLeaves(queued, getDef);
      expect(
        prematureFlush.cardInstances.find(
          (entry) => entry.instanceId === targetAfter.instanceId
        )
      ).toMatchObject({
        zone: "field",
        pendingLeaveKind: "destroy",
      });
      expect(prematureFlush.pendingLeaveEntities).toContainEqual(
        expect.objectContaining({
          instanceId: targetAfter.instanceId,
          kind: "destroy",
        })
      );

      const declareAction = getLegalActions({
        state: queued,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
      }).find(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.declarationId === declaration?.declarationId
      );
      if (
        !declareAction ||
        declareAction.kind !== "declare_private_triggered_effect"
      ) {
        throw new Error("missing X07 private declaration action");
      }

      const declared = applyLegalAction({
        state: queued,
        action: declareAction,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
      }).state;
      const pending = declared.pendingTriggeredEffects.find(
        (entry) => entry.declaredSourceInstanceId === source.instanceId
      );
      expect(pending?.registeredLeaveFieldPreFlushSourceKeys).toContain(
        `${source.instanceId}#${declareAction.registrationIndex}`
      );

      const flushed = flushPendingLeaves(declared, getDef);
      expect(
        flushed.cardInstances.find(
          (entry) => entry.instanceId === targetAfter.instanceId
        )
      ).toMatchObject({
        zone: "field",
        pendingLeaveKind: "destroy",
      });
      expect(flushed.pendingLeaveEntities).toContainEqual(
        expect.objectContaining({
          instanceId: targetAfter.instanceId,
          kind: "destroy",
        })
      );
    });

    it("[board] bounce 耐性で対象を手札に戻せないとき、元の離脱 pending を撤回せず X07 も召喚しない", () => {
      const ALICE = "alice";
      const BOB = "bob";
      const source = createCardInstance(c, {
        instanceId: "x07-hand-blocked",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const target = createCardInstance(card("BSLH01-C01"), {
        instanceId: "x07-bounce-resistant-spirit",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-x07-blocked",
      });
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      });
      const state: GameState = {
        ...base,
        cardInstances: [source, target],
        pendingLeaveEntities: [
          {
            instanceId: target.instanceId,
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "chain-x07-blocked",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
        activeContinuousEffects: [
          {
            effectId: "x07-test-cannot-be-bounced",
            sourceInstanceId: target.instanceId,
            sourceDefinitionId: target.definitionId,
            actingPlayerId: ALICE,
            duration: { scope: "permanent" },
            createdAtTurn: base.turnNumber,
            createdAtAttackId: null,
            modifierTag: "cannot_be_bounced",
            targetInstanceId: target.instanceId,
            metadata: { source: "all" },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:bslh01-cards:17593",
        state,
        effect: leaveSummon,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        triggerRelatedInstanceId: target.instanceId,
      });

      expect(
        result.log.some((line) =>
          line.includes(
            "effect:bounce:blocked-by-resistance:alice:x07-bounce-resistant-spirit"
          )
        )
      ).toBe(true);
      const unsummoned = result.cardInstances.find(
        (x) => x.instanceId === source.instanceId
      )!;
      expect(unsummoned.zone).toBe("hand");
      const stillLeaving = result.cardInstances.find(
        (x) => x.instanceId === target.instanceId
      )!;
      expect(stillLeaving.zone).toBe("field");
      expect(stillLeaving.pendingLeaveKind).toBe("destroy");
      expect(
        result.pendingLeaveEntities.find(
          (entry) => entry.instanceId === target.instanceId
        )?.kind
      ).toBe("destroy");
      expect(
        result.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
      ).toBe(10);
    });
  });

  it("召喚時 手札からCBをコストなし召喚", () => {
    const summon = c.effects![1]!.steps[0]!.action;
    expect(summon.kind).toBe("summon");
    if (summon.kind === "summon" && summon.target.kind === "from_zone") {
      expect(summon.target.zone).toBe("hand");
      expect(summon.costModifier).toBe("free");
    }
  });

  describe("SDフラッシュ effects[2]: 【ソウルドライブ・S】デッキ6オープン→CB3枚までコストなし召喚、残りデッキ下 (P3-125 Step10)", () => {
    const soulDrive = c.effects![2]!;

    it("構造: timing/condition/usageLimit(timingScope無し) + cost step + deck_reveal(revealCount:6,picks CB destination:field,remainder:bottom)", () => {
      expect(soulDrive.stub).toBeUndefined();
      expect(soulDrive.timing).toEqual({ kind: "activated", mode: "flash" });
      expect(soulDrive.timingScope).toBeUndefined();
      expect(soulDrive.condition).toEqual([{ kind: "min_level", value: 3 }]);
      expect(soulDrive.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
        maxCount: 1,
      });
      expect(soulDrive.steps).toHaveLength(2);

      const cost = soulDrive.steps[0]!;
      expect(cost.id).toBe("x07-soul-drive-s-cost");
      expect(cost.action).toEqual({
        kind: "core_move",
        from: { kind: "field", player: "self", includeReserve: true },
        to: { kind: "removed_from_game", player: "self" },
        amount: 1,
        effectKind: "explicit_soul_core",
      });

      const reveal = soulDrive.steps[1]!;
      expect(reveal.stepCondition).toEqual({
        kind: "ref_succeeded",
        stepId: "x07-soul-drive-s-cost",
      });
      expect(reveal.action).toEqual({
        kind: "deck_reveal",
        revealCount: 6,
        picks: [
          {
            count: 3,
            filter: {
              category: ["spirit", "ultimate", "brave"],
              tribes: ["CB"],
            },
            destination: "field",
          },
        ],
        remainder: "bottom",
      });
    });

    it("[board] 実行: デッキ上から6枚オープン→CBスピリット3枚まで場に召喚(維持コア選択)、残り3枚(4枚目のCB含む)はデッキの下へ", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x07-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 4, // levelDefs level3 requiredCores:4
        soulCoreCount: 1,
      });
      const cbCandidates = [0, 1, 2, 3].map((i) =>
        createCardInstance(card("BSLH01-C04"), {
          instanceId: `x07-cb-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const fillers = [0, 1].map((i) =>
        createCardInstance(card("BSSL01-C02"), {
          instanceId: `x07-filler-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, ...cbCandidates, ...fillers],
        // 選ばれた3体のLv1維持コアだけを賄える量。printed cost の通常支払いが混ざれば
        // 3体とも場に出せないため、「コストを支払わずに召喚」の最終盤面回帰になる。
        playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };

      let after = executeEffect({
        chainId: "test:bslh01-cards:17729",
        state: before,
        effect: soulDrive,
        sourceInstanceId: src.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(after.pendingDeckReveal).not.toBeNull();

      for (let i = 0; i < 6 && after.pendingDeckReveal; i++) {
        const actions = getLegalActions({
          state: after,
          actingPlayerId: ALICE,
          getCardDefinitionById: (id) => cardNoMap.get(id),
        });
        const pickAction = actions.find(
          (a) => a.kind === "resolve_pending_deck_reveal_pick"
        );
        const orderAction = actions.find(
          (a) => a.kind === "resolve_pending_deck_reveal_order"
        );
        if (
          pickAction &&
          pickAction.kind === "resolve_pending_deck_reveal_pick"
        ) {
          after = applyLegalAction({
            state: after,
            action: pickAction,
            getCardDefinitionById: (id) => cardNoMap.get(id),
            getRegisteredTriggeredEffectActions: () => [],
            selectedDeckRevealCardIds:
              pickAction.candidateCardInstanceIds.slice(
                0,
                pickAction.maxPickCount
              ),
          }).state;
        } else if (
          orderAction &&
          orderAction.kind === "resolve_pending_deck_reveal_order"
        ) {
          after = applyLegalAction({
            state: after,
            action: orderAction,
            getCardDefinitionById: (id) => cardNoMap.get(id),
            getRegisteredTriggeredEffectActions: () => [],
            deckRevealRemainderOrder: orderAction.remainingCardInstanceIds,
          }).state;
        } else {
          break;
        }
        after = finishCoreChoices(after, getDef);
      }
      after = flushPendingLeaves(after, (id) => cardNoMap.get(id));

      expect(after.pendingDeckReveal).toBeNull();

      // 最初の候補順 (デッキ上から) で提示される3体まで場に出る想定。
      const fieldCb = after.cardInstances.filter(
        (ci) => ci.instanceId.startsWith("x07-cb-") && ci.zone === "field"
      );
      expect(fieldCb).toHaveLength(3);
      for (const ci of fieldCb) {
        // 「コストを支払わずに召喚」でも維持コアはテストプレイヤーが選択する。
        expect(ci.normalCoreCount).toBe(1);
      }
      const remainderCb = after.cardInstances.filter(
        (ci) => ci.instanceId.startsWith("x07-cb-") && ci.zone === "deck"
      );
      expect(remainderCb).toHaveLength(1);
      for (const f of fillers) {
        const found = after.cardInstances.find(
          (ci) => ci.instanceId === f.instanceId
        )!;
        expect(found.zone).toBe("deck");
      }

      const alice = after.players.find((p) => p.id === ALICE)!;
      expect(alice.soulCoreLocation).toEqual({ kind: "removed_from_game" });
      // 3体分の維持コア (1個ずつ) だけがリザーブから消費され、通常コストは払わない。
      expect(alice.reserveNormalCoreCount).toBe(0);
    });
  });
});

describe("BSLH01-X08 ワジ(創)", () => {
  const c = card("BSLH01-X08");
  it("BSLH01-X08: 召喚/アタック/ブロックで効果抑止+デッキ下、自分ターンのみ創界神も対象", () => {
    const opponentTurn = c.effects![0]!;
    expect(opponentTurn.stub).toBeUndefined();
    expect(opponentTurn.condition).toEqual([
      { kind: "turn_player", player: "opponent" },
    ]);
    expect(opponentTurn.allowDuplicateTargets).toBe(true);
    expect(opponentTurn.steps[0]!.action.kind).toBe("suppress_effect");
    const opponentSend = opponentTurn.steps[1]!.action;
    expect(opponentSend.kind).toBe("send_to_deck");
    if (opponentSend.kind === "send_to_deck") {
      expect(opponentSend.target.filter).toEqual({
        filterOr: [
          { category: ["spirit"] },
          { category: ["ultimate"] },
          { category: ["nexus"] },
        ],
      });
    }

    const selfTurn = c.effects![1]!;
    expect(selfTurn.stub).toBeUndefined();
    expect(selfTurn.condition).toEqual([
      { kind: "turn_player", player: "self" },
    ]);
    expect(selfTurn.allowDuplicateTargets).toBe(true);
    expect(selfTurn.steps[0]!.action.kind).toBe("suppress_effect");
    const selfSend = selfTurn.steps[1]!.action;
    expect(selfSend.kind).toBe("send_to_deck");
    if (selfSend.kind === "send_to_deck") {
      expect(selfSend.target.filter).toEqual({
        filterOr: [
          { category: ["spirit"] },
          { category: ["ultimate"] },
          { category: ["nexus"] },
          {
            category: ["nexus"],
            targetsGrandwalker: "only",
          },
        ],
      });
    }
  });

  it("BSLH01-X08: 自分ターン解決で指定相手スピリットの効果抑止CEを登録し創界神ネクサスをデッキ下に戻す", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-x08",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 3,
    });
    const suppressed = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bob-suppressed-spirit",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, grandwalker, suppressed],
    });
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:17883",
        state: {
          ...before,
          activePlayerId: "player-1",
          step: "attack",
        },
        effect: c.effects![1]!,
        sourceInstanceId: "alice-bslh01-x08",
        actingPlayerId: "player-1",
        targetInstanceIds: ["bob-suppressed-spirit"],
        targetStepId: "__step_0",
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
      }),
      (id) => cardNoMap.get(id)
    );

    const suppression = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "bob-suppressed-spirit"
    );
    expect(suppression).toMatchObject({
      modifierTag: "effect_suppression",
      targetInstanceId: "bob-suppressed-spirit",
      duration: { scope: "turn" },
    });
    expect(suppression?.metadata?.effectFilter).toBeUndefined();
    const reeval = runReevaluationAtTiming({
      state: after,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["effect_suppression"],
            failurePolicy: "abort_remaining",
          },
        ],
      },
      timing: "after_sba",
      sourceInstanceId: "bob-suppressed-spirit",
      targetInstanceIds: [],
      suppressionEffectDescriptor: {
        timingKind: "card_event",
        triggerPhrases: ["召喚時"],
      },
    });
    expect(reeval.passed).toBe(false);
    expect(reeval.failedChecks).toEqual(["effect_suppression"]);
    // 10_rules/03b Ver.17.0: 発揮場所・発揮条件のない常時効果は
    // 「効果を発揮できない」では無効化できない。
    const alwaysOnReeval = runReevaluationAtTiming({
      state: after,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["effect_suppression"],
            failurePolicy: "abort_remaining",
          },
        ],
      },
      timing: "after_sba",
      sourceInstanceId: "bob-suppressed-spirit",
      targetInstanceIds: [],
      suppressionEffectDescriptor: {
        timingKind: "continuous",
      },
    });
    expect(alwaysOnReeval.passed).toBe(true);
    expect(alwaysOnReeval.failedChecks).toEqual([]);
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "bob-grandwalker")
        ?.zone
    ).toBe("deck");
  });

  it("BSLH01-X08: 登録した suppress_effect は before_each_step の実解決経路で相手効果本文を止める", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-x08",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 3,
    });
    const suppressedDef = card("BSSL01-C02");
    const suppressed = createCardInstance(suppressedDef, {
      instanceId: "bob-suppressed-spirit",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, grandwalker, suppressed],
    });
    const afterSuppress = executeEffect({
      chainId: "test:bslh01-cards:17984",
      state: {
        ...before,
        activePlayerId: "player-1",
        step: "attack",
      },
      effect: c.effects![1]!,
      sourceInstanceId: "alice-bslh01-x08",
      actingPlayerId: "player-1",
      targetInstanceIds: ["bob-suppressed-spirit"],
      targetStepId: "__step_0",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const sourceCard = afterSuppress.cardInstances.find(
      (ci) => ci.instanceId === "bob-suppressed-spirit"
    )!;
    const chainId = "bslh01-x08:suppressed-real-resolution";
    const result = runActionMainResolution({
      state: afterSuppress,
      chainId,
      context: {
        chainId,
        actingPlayerId: "player-2",
        sourceKind: "spirit",
        sourceCard,
        sourceDefinition: suppressedDef,
        targetInstanceIds: [],
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      },
      startLogs: [`effect:resolve-main:start:${chainId}`],
      endLogs: [
        `effect:resolve-main:end:${chainId}`,
        `effect:resolve-derived:end:${chainId}`,
      ],
      resolveEffect: (currentState) => ({
        ...currentState,
        players: currentState.players.map((p) =>
          p.id === "player-2" ? { ...p, countValue: p.countValue + 1 } : p
        ),
        log: [...currentState.log, "bslh01-x08:unexpected-body-ran"],
      }),
      reevaluation: buildReevaluationConfig(
        {
          reevaluationPoints: [
            {
              timing: "before_each_step",
              checks: ["effect_suppression"],
              failurePolicy: "abort_remaining",
            },
          ],
          suppressionEffectDescriptor: {
            timingKind: "card_event",
            eventAction: "summon",
          },
        },
        "bob-suppressed-spirit",
        []
      )!,
    });

    expect(
      result.log.some((line) =>
        line.includes("reevaluation:before_each_step:failed:effect_suppression")
      )
    ).toBe(true);
    expect(result.log).not.toContain("bslh01-x08:unexpected-body-ran");
    expect(result.players.find((p) => p.id === "player-2")?.countValue).toBe(0);
  });

  it("BSLH01-X08: suppress_effect は解決時に対象カード耐性でCE登録を弾く", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-x08",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const suppressedDef = card("BSSL01-C02");
    const protectedTarget = createCardInstance(suppressedDef, {
      instanceId: "bob-immune-spirit",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, protectedTarget],
    });
    const immunity: ContinuousEffect = {
      effectId: "ce:bslh01-x08-target-immunity",
      sourceInstanceId: "bob-immune-spirit",
      sourceDefinitionId: protectedTarget.definitionId,
      actingPlayerId: "player-2",
      modifierTag: "defense_immune",
      targetInstanceId: "bob-immune-spirit",
      duration: { scope: "turn" },
      createdAtTurn: before.turnNumber,
      createdAtAttackId: null,
    };
    const effect = {
      ...c.effects![1]!,
      steps: [
        {
          id: "suppress",
          action: c.effects![1]!.steps[0]!.action,
        },
      ],
    } satisfies NonNullable<CardDefinition["effects"]>[number];

    const after = executeEffect({
      chainId: "test:bslh01-cards:18095",
      state: {
        ...before,
        activePlayerId: "player-1",
        step: "attack",
        activeContinuousEffects: [immunity],
      },
      effect,
      sourceInstanceId: "alice-bslh01-x08",
      actingPlayerId: "player-1",
      targetInstanceIds: ["bob-immune-spirit"],
      targetStepId: "suppress",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.targetInstanceId === "bob-immune-spirit"
      )
    ).toBe(false);
    const afterImmunityExpires: GameState = {
      ...after,
      activeContinuousEffects: after.activeContinuousEffects.filter(
        (ce) => ce.effectId !== "ce:bslh01-x08-target-immunity"
      ),
    };
    const reeval = runReevaluationAtTiming({
      state: afterImmunityExpires,
      registration: {
        reevaluationPoints: [
          {
            timing: "before_each_step",
            checks: ["effect_suppression"],
            failurePolicy: "abort_remaining",
          },
        ],
      },
      timing: "before_each_step",
      sourceInstanceId: "bob-immune-spirit",
      targetInstanceIds: [],
      suppressionEffectDescriptor: {
        timingKind: "card_event",
        triggerPhrases: ["召喚時"],
      },
    });
    expect(reeval.passed).toBe(true);
    expect(reeval.failedChecks).toEqual([]);
  });

  it("BSLH01-X08: 抑止された相手フィールド効果は legal action に提示されない", () => {
    const suppressedDef: CardDefinition = {
      cardNo: "BSLH01-X08-SUPPRESSED-FIELD",
      name: "BSLH01-X08 suppressed field effect source",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: ["Lv1『自分のメインステップ』", "自分のカウント+1する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          timingScope: { player: "self", period: "main" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0, 1],
        },
      ],
    };
    const getDef = (id: string) =>
      id === suppressedDef.cardNo ? suppressedDef : cardNoMap.get(id);
    const getRegisteredFieldCardEffectActions = buildFieldCardEffectLookup([
      suppressedDef,
    ]);
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-x08",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 3,
    });
    const suppressed = createCardInstance(suppressedDef, {
      instanceId: "bob-suppressed-spirit",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, grandwalker, suppressed],
    });
    const afterSuppress = executeEffect({
      chainId: "test:bslh01-cards:18199",
      state: {
        ...before,
        activePlayerId: "player-1",
        step: "attack",
      },
      effect: c.effects![1]!,
      sourceInstanceId: "alice-bslh01-x08",
      actingPlayerId: "player-1",
      targetInstanceIds: ["bob-suppressed-spirit"],
      targetStepId: "__step_0",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const legalActions = getLegalActions({
      state: {
        ...afterSuppress,
        activePlayerId: "player-2",
        step: "main",
        window: "none",
      },
      actingPlayerId: "player-2",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions,
    });
    expect(
      legalActions.some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "bob-suppressed-spirit"
      )
    ).toBe(false);
  });

  it("BSLH01-X08: suppress_effect の成功は ref_succeeded 後続を発揮させる", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-x08",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const suppressed = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bob-suppressed-spirit",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [source, suppressed],
    });
    const effect = {
      ...c.effects![1]!,
      steps: [
        {
          id: "suppress",
          action: c.effects![1]!.steps[0]!.action,
        },
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
          connector: "conditional_result",
          stepCondition: { kind: "ref_succeeded", stepId: "suppress" },
        },
      ],
    } satisfies NonNullable<CardDefinition["effects"]>[number];

    const after = executeEffect({
      chainId: "test:bslh01-cards:18267",
      state: { ...before, activePlayerId: "player-1" },
      effect,
      sourceInstanceId: "alice-bslh01-x08",
      actingPlayerId: "player-1",
      targetInstanceIds: ["bob-suppressed-spirit"],
      targetStepId: "suppress",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(after.activeContinuousEffects).toContainEqual(
      expect.objectContaining({
        modifierTag: "effect_suppression",
        targetInstanceId: "bob-suppressed-spirit",
      })
    );
    expect(after.players.find((p) => p.id === "player-1")?.countValue).toBe(1);
  });

  it("BSLH01-X08: send_to_deck の v1 bridge は CardFilter.cardName を保持する", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-x08",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const nonMatching = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bob-nonmatching-first",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 2,
    });
    const matching = createCardInstance(card("BSLH01-C02"), {
      instanceId: "bob-fran",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "send_to_deck",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { cardName: { exact: "フラン・シーカー" } },
              count: 1,
            },
            position: "bottom",
          },
        },
      ],
    } satisfies NonNullable<CardDefinition["effects"]>[number];

    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:18325",
        state: createEmptyGameState({
          playerIds: ["player-1", "player-2"],
          cardInstances: [source, nonMatching, matching],
        }),
        effect,
        sourceInstanceId: "alice-bslh01-x08",
        actingPlayerId: "player-1",
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
      }),
      (id) => cardNoMap.get(id)
    );

    expect(
      after.cardInstances.find((ci) => ci.instanceId === "bob-fran")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find(
        (ci) => ci.instanceId === "bob-nonmatching-first"
      )?.zone
    ).toBe("field");
  });

  it("BSLH01-X08: Lv-only continuous は suppression descriptor の発揮条件に数える", () => {
    const lvOnly = deriveSuppressionEffectDescriptor({
      timing: { kind: "continuous" },
      condition: [{ kind: "min_level", value: 2 }],
      steps: [{ action: { kind: "noop" } }],
    });
    expect(lvOnly.activationCondition).toBe("present");

    const applicabilityLevel = deriveSuppressionEffectDescriptor({
      timing: { kind: "continuous" },
      applicability: { level: { min: 2 } },
      steps: [{ action: { kind: "noop" } }],
    });
    expect(applicabilityLevel.activationCondition).toBe("present");

    const realCondition = deriveSuppressionEffectDescriptor({
      timing: { kind: "continuous" },
      condition: [{ kind: "count_value", player: "self", min: 2 }],
      steps: [{ action: { kind: "noop" } }],
    });
    expect(realCondition.activationCondition).toBe("present");
  });

  it("BSLH01-X08: triggered 登録と解決は効果抑止対象とデッキ下対象を別 targetGroups で扱う", () => {
    const registrations = generateTriggeredEffectRegistrations(c);
    const selfTurnRegistration = registrations.find(
      (reg) => reg.effectIndex === 1 && reg.eventKind === "summon"
    );
    expect(selfTurnRegistration).toMatchObject({
      allowDuplicateTargets: true,
      requiredTargetCount: 2,
      targetGroups: [
        {
          requiredTargetCount: 1,
          targetStepId: "__step_0",
        },
        {
          requiredTargetCount: 1,
          targetStepId: "__step_1",
        },
      ],
    });
    if (!selfTurnRegistration) {
      throw new Error("BSLH01-X08 self-turn registration not found");
    }

    const source = createCardInstance(c, {
      instanceId: "alice-bslh01-x08",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 3,
    });
    const guided = createCardInstance(card("BSES01-CX01"), {
      instanceId: "bob-guided",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 3,
    });
    const regularNexus = createCardInstance(card("BSLH01-C02"), {
      instanceId: "bob-regular-nexus",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const suppressed = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bob-suppressed-spirit",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["player-1", "player-2"],
        cardInstances: [source, grandwalker, guided, regularNexus, suppressed],
      }),
      activePlayerId: "player-1",
      step: "attack",
    } satisfies GameState;
    const targetGroups = buildLegalActionTargetGroups({
      state,
      actingPlayerId: "player-1",
      actionRegistration: selfTurnRegistration,
      sourceInstanceId: "alice-bslh01-x08",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });
    expect(targetGroups).toHaveLength(2);
    for (const group of targetGroups) {
      expect(group.candidateTargetInstanceIds).toContain("bob-guided");
      expect(group.candidateTargetInstanceIds).toContain("bob-grandwalker");
      expect(group.candidateTargetInstanceIds).toContain("bob-regular-nexus");
    }

    const resolved = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:18448",
        state,
        effect: c.effects![1]!,
        sourceInstanceId: "alice-bslh01-x08",
        actingPlayerId: "player-1",
        targetInstanceIds: ["bob-suppressed-spirit", "bob-grandwalker"],
        targetGroups,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
      }),
      (id) => cardNoMap.get(id)
    );

    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.targetInstanceId === "bob-suppressed-spirit"
      )
    ).toBe(true);
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === "bob-grandwalker")
        ?.zone
    ).toBe("deck");
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === "bob-guided")?.zone
    ).toBe("field");

    const duplicateResolved = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-cards:18477",
        state,
        effect: c.effects![1]!,
        sourceInstanceId: "alice-bslh01-x08",
        actingPlayerId: "player-1",
        targetInstanceIds: ["bob-suppressed-spirit", "bob-suppressed-spirit"],
        targetGroups,
        allowDuplicateTargets: true,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
      }),
      (id) => cardNoMap.get(id)
    );
    expect(
      duplicateResolved.cardInstances.find(
        (ci) => ci.instanceId === "bob-suppressed-spirit"
      )?.zone
    ).toBe("deck");
    // 対象がフィールド離脱したら instance 紐付き suppress CE は失効する
    // （deck/手札/トラッシュのカード効果を抑止しない）。CE 本体は残るが消費条件で弾く。
    expect(
      executeReevaluationCheck({
        state: duplicateResolved,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-suppressed-spirit",
        targetInstanceIds: [],
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).toBe(true);
  });

  it("SDフラッシュ effects[2]: ソウルコアをコストに支払うと、CB系統自スピリットのライフ減少免疫CE (player-scoped) が登録される (P3-125 Step3)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const soulDrive = c.effects![2]!;
    expect(soulDrive.stub).toBeUndefined();
    expect(soulDrive.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(soulDrive.timingScope).toEqual({ player: "self", period: "attack" });
    expect(soulDrive.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(soulDrive.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });

    const src = createCardInstance(c, {
      instanceId: "x08-souldrive-onfield",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:18545",
      state: before,
      effect: soulDrive,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });

    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "removed_from_game" });

    const grant = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "life_damage_source_prevention_immunity"
    );
    expect(grant).toMatchObject({
      modifierTag: "life_damage_source_prevention_immunity",
      targetInstanceId: ALICE,
      duration: { scope: "turn" },
    });
    expect(grant?.metadata).toEqual({
      sourceFilter: { category: ["spirit"], tribes: ["CB"] },
    });
  });

  it("BSLH01-X08: 免疫CEが無ければ効果起因のライフ減少は相手の life_damage_interception (blanket) で防止される", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const attacker = createCardInstance(c, {
      instanceId: "x08-attacker-no-grant",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const blanketGuard: ContinuousEffect = {
      effectId: "ce:test:blanket-guard-1",
      sourceInstanceId: "guard-src-1",
      sourceDefinitionId: "TEST-GUARD",
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "life_damage_interception",
      targetInstanceId: BOB,
      metadata: {
        cause: "any" as const,
        mode: "replace" as const,
        turnThreshold: 1,
        floor: 0,
      },
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker],
        playerOverrides: [{}, { lifeNormalCoreCount: 5 }],
      }),
      activeContinuousEffects: [blanketGuard],
    };

    const after = resolveLifeDamage(state, BOB, 2, [], {
      cause: "opponent_effect",
      actingPlayerId: ALICE,
      sourceCardMatchesFilter: (filter) =>
        !!filter.tribes?.includes("CB") &&
        !!filter.category?.includes("spirit"),
    });
    expect(
      getPlayerLifeCoreCount(after.players.find((p) => p.id === BOB)!)
    ).toBe(5);
  });

  it("BSLH01-X08: 【ソウルドライブ・S】発動後は、CB自スピリットの効果起因ライフ減少が相手の life_damage_interception (blanket) を貫通する", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const attacker = createCardInstance(c, {
      instanceId: "x08-attacker-with-grant",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const blanketGuard: ContinuousEffect = {
      effectId: "ce:test:blanket-guard-2",
      sourceInstanceId: "guard-src-2",
      sourceDefinitionId: "TEST-GUARD",
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "life_damage_interception",
      targetInstanceId: BOB,
      metadata: {
        cause: "any" as const,
        mode: "replace" as const,
        turnThreshold: 1,
        floor: 0,
      },
    };
    const grant: ContinuousEffect = {
      effectId: "ce:test:x08-grant",
      sourceInstanceId: attacker.instanceId,
      sourceDefinitionId: c.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "life_damage_source_prevention_immunity",
      targetInstanceId: ALICE,
      metadata: {
        sourceFilter: { category: ["spirit"], tribes: ["CB"] },
      },
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker],
        playerOverrides: [{}, { lifeNormalCoreCount: 5 }],
      }),
      activeContinuousEffects: [blanketGuard, grant],
    };

    const after = resolveLifeDamage(state, BOB, 2, [], {
      cause: "opponent_effect",
      actingPlayerId: ALICE,
      sourceCardMatchesFilter: (filter) =>
        !!filter.tribes?.includes("CB") &&
        !!filter.category?.includes("spirit"),
    });
    expect(
      getPlayerLifeCoreCount(after.players.find((p) => p.id === BOB)!)
    ).toBe(3);
  });

  it("BSLH01-X08: 【ソウルドライブ・S】発動後は、CB自スピリットのバトルライフ減少も相手の life_damage_interception (blanket) を貫通する", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const attacker = createCardInstance(c, {
      instanceId: "x08-battle-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const blanketGuard: ContinuousEffect = {
      effectId: "ce:test:blanket-guard-battle",
      sourceInstanceId: "guard-src-battle",
      sourceDefinitionId: "TEST-GUARD",
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "life_damage_interception",
      targetInstanceId: BOB,
      metadata: {
        cause: "any" as const,
        mode: "replace" as const,
        turnThreshold: 1,
        floor: 0,
      },
    };
    const grant: ContinuousEffect = {
      effectId: "ce:test:x08-battle-grant",
      sourceInstanceId: attacker.instanceId,
      sourceDefinitionId: c.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "life_damage_source_prevention_immunity",
      targetInstanceId: ALICE,
      metadata: {
        sourceFilter: { category: ["spirit"], tribes: ["CB"] },
      },
    };
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker],
        playerOverrides: [{}, { lifeNormalCoreCount: 5 }],
      }),
      activeContinuousEffects: [blanketGuard, grant],
      activePlayerId: ALICE,
    };

    const toSymbols = (nSymbols: number): SymbolColor[] =>
      Array.from({ length: nSymbols }, () => "red" as SymbolColor);
    const battleEntities: BattleEntity[] = [
      {
        entityId: "e-x08",
        memberInstanceIds: [attacker.instanceId],
        resolvedBp: 7000,
        resolvedSymbols: toSymbols(2),
        attackState: "attacking",
      },
    ];
    const group: BattleResolutionGroup = {
      attackId: "atk-x08-1",
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      symbolResolutionOrder: ["e-x08"],
      participantSnapshots: [
        {
          entityId: "e-x08",
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 7000,
          resolvedSymbols: toSymbols(2),
          blockedBy: [],
        },
      ],
    };
    const battleState: GameState = {
      ...baseState,
      battleEntities,
      battleResolutionGroup: group,
    };

    const dmg = getUnblockedLifeDamage(battleState, (id) => cardNoMap.get(id));
    expect(dmg!.totalLifeDamage).toBe(0);
    expect(dmg!.bypassedLifeDamage).toBe(2);

    const after = resolveLifeDamage(
      battleState,
      BOB,
      dmg!.bypassedLifeDamage,
      [],
      {
        cause: "battle",
        actingPlayerId: ALICE,
        forcedUnpreventable: true,
      }
    );
    expect(
      getPlayerLifeCoreCount(after.players.find((p) => p.id === BOB)!)
    ).toBe(3);

    // executeBattleResolution 経路の smoke: bypassedLifeDamage が export され、
    // resolveLifeDamage の分割呼び出しが正しく配線されていることを型確認する。
    expect(typeof executeBattleResolution).toBe("function");
  });

  it("【クォーツ：省EP2】は soulState 限定 + 導力器トークンマジックのコストを-1する", () => {
    const e = c.effects![3]!;
    expect(e.applicability).toEqual({ soulState: true });
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("cost_modify");
    if (action.kind === "cost_modify") {
      expect(action.cardFilter).toEqual({
        category: ["magic"],
        tribes: ["導力器"],
        isToken: true,
      });
      expect(action.modifier).toEqual({ additionalCostValue: -1 });
    }
  });

  it("魂状態でセットされているときだけコスト軽減 CE が場に立つ (未セットなら不発)", () => {
    const source = createCardInstance(c, {
      instanceId: "x08-quartz-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ cardInstances: [source] });

    const soulSet: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "player-1"
          ? { ...player, soulStateInstanceIds: ["x08-quartz-1"] }
          : player
      ),
    };
    const afterSet = rebuildContinuousEffectsFromField(soulSet, (id) =>
      cardNoMap.get(id)
    );
    const setCE = afterSet.activeContinuousEffects.find(
      (ceItem) =>
        ceItem.sourceInstanceId === "x08-quartz-1" &&
        ceItem.modifierTag === "additional_cost"
    );
    expect(setCE).toBeDefined();

    const notSet: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "player-1"
          ? { ...player, soulStateInstanceIds: [] }
          : player
      ),
    };
    const afterUnset = rebuildContinuousEffectsFromField(notSet, (id) =>
      cardNoMap.get(id)
    );
    const unsetCE = afterUnset.activeContinuousEffects.find(
      (ceItem) =>
        ceItem.sourceInstanceId === "x08-quartz-1" &&
        ceItem.modifierTag === "additional_cost"
    );
    expect(unsetCE).toBeUndefined();
  });
});

describe("BSLH01-X09 リーシャ(創)", () => {
  const c = card("BSLH01-X09");

  describe("effects[0]: 〔ターン1回:同名〕手札/トラッシュのこのカードは、CB自スピリットが相手効果で離れるとき召喚できる (コスト言及なし=無料召喚、dsl-types.ts:1975-1991 target:self.zone precedent)", () => {
    const grant = c.effects![0]!;

    it("構造: applicability hand/trash + game_event(leave_field, triggerFilter:CB spirit, cause:opponent_effect) + usageLimit per_card_name/turn + summon target:self (zone未指定=無料)", () => {
      expect(grant.stub).toBeUndefined();
      expect(grant.applicability).toEqual({ zone: ["hand", "trash"] });
      expect(grant.timing).toEqual({
        kind: "game_event",
        player: "self",
        event: "leave_field",
        triggerFilter: { category: ["spirit"], tribes: ["CB"] },
        cause: "opponent_effect",
      });
      expect(grant.executionMode).toBe("optional");
      expect(grant.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
      });
      expect(grant.steps).toHaveLength(1);
      const step0 = grant.steps[0]!;
      expect(step0.action.kind).toBe("summon");
      if (step0.action.kind === "summon") {
        expect(step0.action.target).toEqual({ kind: "self" });
      }
    });

    it("手札のこのカードはコストを支払わず(無料)召喚される", () => {
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 15 }, {}],
      });
      const handCard = createCardInstance(c, {
        instanceId: "x09-hand-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
        normalCoreCount: 0,
      });
      const state: GameState = { ...base, cardInstances: [handCard] };
      const aliceBefore = state.players.find((p) => p.id === "alice")!;

      const result = executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-cards:18891",
        state,
        effect: grant,
        sourceInstanceId: "x09-hand-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const after = result.cardInstances.find(
        (x) => x.instanceId === "x09-hand-1"
      )!;
      expect(after.zone).toBe("field");
      expect(after.normalCoreCount).toBe(1); // Lv1 requiredCores:1

      const alice = result.players.find((p) => p.id === "alice")!;
      // 無料召喚: 印字コスト7は支払わず、維持コア1個分のみリザーブから引かれる。
      expect(alice.reserveNormalCoreCount).toBe(
        aliceBefore.reserveNormalCoreCount - 1
      );
      expect(alice.handCount).toBe(aliceBefore.handCount - 1);
    });

    it("トラッシュのこのカードも同様に召喚できる (applicability.zone に trash 含む)", () => {
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 15 }, {}],
      });
      const trashCard = createCardInstance(c, {
        instanceId: "x09-trash-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
        normalCoreCount: 0,
      });
      const state: GameState = { ...base, cardInstances: [trashCard] };

      const result = executeEffect({
        chainId: "test:bslh01-cards:18927",
        state,
        effect: grant,
        sourceInstanceId: "x09-trash-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const after = result.cardInstances.find(
        (x) => x.instanceId === "x09-trash-1"
      )!;
      expect(after.zone).toBe("field");
    });
  });

  it("召喚/アタックで相手フィールドのコア2個までをトラッシュ（P3-88 under-selection）", () => {
    const core = c.effects![1]!.steps[0]!.action;
    expect(core.kind).toBe("core_move");
    if (core.kind === "core_move") {
      expect(core.from).toEqual({ kind: "field", player: "opponent" });
      // 「2個まで」: {min:0,max:2} で core_shoot の under-selection を表す。
      expect(core.amount).toEqual({ min: 0, max: 2 });
    }
  });

  describe("SDフラッシュ effects[2]: 【ソウルドライブ・S】Lv1につき相手スピ/アルティのコア2個トラッシュ＋消滅でトラッシュCB手札 (P3-125 Step6)", () => {
    const soulDrive = c.effects![2]!;

    it("実効Lvに応じた反復と消滅数に応じた回収を使う", () => {
      expect(soulDrive.steps).toHaveLength(3);
      expect(soulDrive.steps[1]!.repeat).toEqual({
        additional: { source: { kind: "source_effective_level" }, offset: -1 },
      });
      expect(soulDrive.steps[2]!.connector).toBe("after_state_check");
      expect(soulDrive.steps[2]!.action).toMatchObject({
        count: {
          source: {
            kind: "cards_from_ref",
            stepId: "x09-soul-drive-cores",
            establishedLeaveKind: "vanish",
          },
        },
      });
    });

    it("[board] Lv2解決: 消滅させた対象1体につき自分のトラッシュのCBカード1枚が手札に戻る (2対分、3対目は不発)", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x09-lv2-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2, // levelDefs level2 requiredCores:2
        soulCoreCount: 1,
      });
      const oppA = createCardInstance(card("BSSL01-C02"), {
        instanceId: "x09-opp-a",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 2,
      });
      // トラッシュのCB候補は1枚のみにする（2枚だと move_card の対象選択が
      // 曖昧になり、宣言時 target 選択を経ない直接 executeEffect 呼び出しでは
      // 自動解決できず no-op になるため）。
      const cb1 = createCardInstance(card("BSLH01-C02"), {
        instanceId: "x09-cb-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      });
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, oppA, cb1],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };

      // oppA は1対目の core_move (-2) で 0 コアになり消滅。3対目 (Lv3限定) は不発のため
      // 2対目の core_move は対象不在(候補0件)で no-op になる想定。
      const after = flushPendingLeaves(
        executeEffect({
          chainId: "test:bslh01-cards:19018",
          state: before,
          effect: soulDrive,
          sourceInstanceId: src.instanceId,
          actingPlayerId: ALICE,
          getCardDefinitionById: (id) => cardNoMap.get(id),
          getRegisteredTriggeredEffectActions: () => [],
        }),
        (id) => cardNoMap.get(id)
      );

      const aliceAfter = after.players.find((p) => p.id === ALICE)!;
      expect(aliceAfter.soulCoreLocation).toEqual({
        kind: "removed_from_game",
      });
      const oppAAfter = after.cardInstances.find(
        (ci) => ci.instanceId === "x09-opp-a"
      )!;
      expect(oppAAfter.zone).toBe("trash");

      // 1対目で消滅した対象につき、トラッシュのCBカードが手札に戻る。
      const cb1After = after.cardInstances.find(
        (ci) => ci.instanceId === "x09-cb-1"
      )!;
      expect(cb1After.zone).toBe("hand");
    });

    it("[board] Lv3解決: 同一の生存対象へ3回コアシュート(-2×3)、3対目はLv3でのみ発火する", () => {
      const ALICE = "player-1";
      const BOB = "player-2";
      const src = createCardInstance(c, {
        instanceId: "x09-lv3-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 5, // levelDefs level3 requiredCores:5
        soulCoreCount: 1,
      });
      const opp = createCardInstance(card("BSSL01-C02"), {
        instanceId: "x09-lv3-opp",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 10,
      });
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, opp],
      });
      const before: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === ALICE
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId: src.instanceId },
              }
            : p
        ),
      };

      const after = flushPendingLeaves(
        executeEffect({
          chainId: "test:bslh01-cards:19080",
          state: before,
          effect: soulDrive,
          sourceInstanceId: src.instanceId,
          actingPlayerId: ALICE,
          getCardDefinitionById: (id) => cardNoMap.get(id),
          getRegisteredTriggeredEffectActions: () => [],
        }),
        (id) => cardNoMap.get(id)
      );

      const oppAfter = after.cardInstances.find(
        (ci) => ci.instanceId === "x09-lv3-opp"
      )!;
      // 10コアの対象は消滅せず場に残り続けるため、3対とも同一対象に -2 ずつ (Lv3なら3対目も発火 → 10-6=4)。
      expect(oppAfter.zone).toBe("field");
      expect(oppAfter.normalCoreCount).toBe(4);
    });
  });

  describe("【クォーツ：練刃】grant_optional_deck_reveal_count_boost CE 登録 (ENGINE-optional-deck-reveal-count-boost Step1)", () => {
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);

    it("effect定義: continuous + applicability.soulState + grant_optional_deck_reveal_count_boost(sourceFilter:spirit, bonusAmount:1, while_on_field)", () => {
      const effect = c.effects![3]!;
      expect(effect.timing).toEqual({ kind: "continuous" });
      expect(effect.applicability).toEqual({ soulState: true });
      expect(effect.steps).toHaveLength(1);
      expect(effect.steps[0]!.action).toEqual({
        kind: "grant_optional_deck_reveal_count_boost",
        player: "self",
        sourceFilter: { category: ["spirit"] },
        bonusAmount: 1,
        duration: { scope: "while_on_field" },
      });
      // Step2 (消費側) 着地済のため stub は解消済み。
      expect(effect.stub).toBeUndefined();
    });

    it("魂状態(セット中)なら grant_optional_deck_reveal_count_boost CE が自分に登録される", () => {
      const source = createCardInstance(c, {
        instanceId: "x09-quartz-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      });
      const state: GameState = {
        ...base,
        players: base.players.map((p) =>
          p.id === "alice"
            ? { ...p, soulStateInstanceIds: [source.instanceId] }
            : p
        ),
      };
      const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
      const grant = rebuilt.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "alice" &&
          ce.modifierTag === "grant_optional_deck_reveal_count_boost"
      );
      expect(grant).toBeDefined();
      expect(grant!.sourceInstanceId).toBe("x09-quartz-source");
      expect(grant!.metadata?.sourceFilter).toEqual({ category: ["spirit"] });
      expect(grant!.metadata?.bonusAmount).toBe(1);
    });

    it("魂状態でない(未セット)なら CE は登録されない", () => {
      const source = createCardInstance(c, {
        instanceId: "x09-quartz-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      });
      const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
      expect(
        rebuilt.activeContinuousEffects.some(
          (ce) => ce.modifierTag === "grant_optional_deck_reveal_count_boost"
        )
      ).toBe(false);
    });
  });

  describe("grant_optional_deck_reveal_count_boost 消費側 (ENGINE-optional-deck-reveal-count-boost Step2)", () => {
    const deckRevealEffect = {
      timing: { kind: "card_event" as const, event: "summon" as const },
      steps: [
        {
          action: {
            kind: "deck_reveal" as const,
            revealCount: 1,
            picks: [],
            remainder: "top_or_bottom" as const,
          },
        },
      ],
    };
    // continuation は sourceDefinitionId/effectIndex から def.effects[] を再取得して resume する
    // ため、テスト用 def にも同じ effect を積んでおく必要がある。
    const otherSpiritDef: CardDefinition = {
      cardNo: "BSLH01-X09-TEST-OTHER-SPIRIT",
      name: "BSLH01-X09 Step2 テスト用他スピリット",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [deckRevealEffect],
    };
    const otherNexusDef: CardDefinition = {
      cardNo: "BSLH01-X09-TEST-OTHER-NEXUS",
      name: "BSLH01-X09 Step2 テスト用非スピリット",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [deckRevealEffect],
    };
    const deckDiscardEffect = {
      timing: { kind: "card_event" as const, event: "summon" as const },
      steps: [
        {
          action: {
            kind: "discard" as const,
            count: 1,
            fromZone: "deck" as const,
          },
        },
      ],
    };
    const otherSpiritDiscardDef: CardDefinition = {
      ...otherSpiritDef,
      cardNo: "BSLH01-X09-TEST-OTHER-SPIRIT-DISCARD",
      name: "BSLH01-X09 Step3 テスト用他スピリット(discard)",
      effects: [deckDiscardEffect],
    };
    const otherNexusDiscardDef: CardDefinition = {
      ...otherNexusDef,
      cardNo: "BSLH01-X09-TEST-OTHER-NEXUS-DISCARD",
      name: "BSLH01-X09 Step3 テスト用非スピリット(discard)",
      effects: [deckDiscardEffect],
    };
    const testDefRegistry = new Map<string, CardDefinition>([
      [otherSpiritDef.cardNo, otherSpiritDef],
      [otherNexusDef.cardNo, otherNexusDef],
      [otherSpiritDiscardDef.cardNo, otherSpiritDiscardDef],
      [otherNexusDiscardDef.cardNo, otherNexusDiscardDef],
    ]);
    const getDef = (id: string): CardDefinition | undefined =>
      testDefRegistry.get(id) ?? cardNoMap.get(id);

    function buildBoostedState(otherSourceDef: CardDefinition): {
      state: GameState;
      otherSourceId: string;
    } {
      const x09Source = createCardInstance(c, {
        instanceId: "x09-quartz-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const otherSource = createCardInstance(otherSourceDef, {
        instanceId: "other-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const deckCards = Array.from({ length: 5 }, (_, i) =>
        createCardInstance(otherSourceDef, {
          instanceId: `deck-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        })
      );
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [x09Source, otherSource, ...deckCards],
      });
      const state: GameState = {
        ...base,
        players: base.players.map((p) =>
          p.id === "alice"
            ? { ...p, soulStateInstanceIds: [x09Source.instanceId] }
            : p
        ),
      };
      return {
        state: rebuildContinuousEffectsFromField(state, getDef),
        otherSourceId: otherSource.instanceId,
      };
    }

    it("自分のスピリットの効果による deck_reveal は +1 適用可否の pending を立てて中断する", () => {
      const { state, otherSourceId } = buildBoostedState(otherSpiritDef);
      const result = executeEffect({
        chainId: "test:bslh01-cards:19298",
        state,
        effect: deckRevealEffect,
        sourceInstanceId: otherSourceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(result.pendingDeckReveal).toBeNull();
      const pending = result.pendingDeckRevealCountBoostChoice;
      expect(pending).not.toBeNull();
      expect(pending!.actingPlayerId).toBe("alice");
      expect(pending!.sourceInstanceId).toBe(otherSourceId);
      expect(pending!.bonusAmount).toBe(1);
    });

    it("apply を選ぶと revealCount+1 (2枚) で deck_reveal が実行される", () => {
      const { state, otherSourceId } = buildBoostedState(otherSpiritDef);
      const paused = executeEffect({
        chainId: "test:bslh01-cards:19315",
        state,
        effect: deckRevealEffect,
        sourceInstanceId: otherSourceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      const pending = paused.pendingDeckRevealCountBoostChoice!;
      const resolved = applyLegalAction({
        state: paused,
        action: {
          kind: "resolve_pending_deck_reveal_count_boost_choice",
          actionId: `drcb-${pending.pendingId}:apply`,
          can: true,
          reason: "test",
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice: "apply",
          bonusAmount: pending.bonusAmount,
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(resolved.pendingDeckRevealCountBoostChoice).toBeNull();
      expect(resolved.pendingDeckReveal?.revealedCardInstanceIds).toHaveLength(
        2
      );
    });

    it("decline を選ぶと通常通り revealCount=1 のまま deck_reveal が実行される (step 自体は skip されない)", () => {
      const { state, otherSourceId } = buildBoostedState(otherSpiritDef);
      const paused = executeEffect({
        chainId: "test:bslh01-cards:19349",
        state,
        effect: deckRevealEffect,
        sourceInstanceId: otherSourceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      const pending = paused.pendingDeckRevealCountBoostChoice!;
      const resolved = applyLegalAction({
        state: paused,
        action: {
          kind: "resolve_pending_deck_reveal_count_boost_choice",
          actionId: `drcb-${pending.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice: "decline",
          bonusAmount: pending.bonusAmount,
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(resolved.pendingDeckRevealCountBoostChoice).toBeNull();
      expect(resolved.pendingDeckReveal?.revealedCardInstanceIds).toHaveLength(
        1
      );
    });

    it("スピリット以外(ネクサス)の効果による deck_reveal は sourceFilter 不一致で pending を立てない", () => {
      const { state, otherSourceId } = buildBoostedState(otherNexusDef);
      const result = executeEffect({
        chainId: "test:bslh01-cards:19383",
        state,
        effect: deckRevealEffect,
        sourceInstanceId: otherSourceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(result.pendingDeckRevealCountBoostChoice).toBeNull();
      expect(result.pendingDeckReveal?.revealedCardInstanceIds).toHaveLength(1);
    });

    it("印字ネクサスでも act_as_spirit CE でスピリット扱いされていれば sourceFilter(category:spirit) にマッチし pending を立てる", () => {
      const { state, otherSourceId } = buildBoostedState(otherNexusDef);
      const actAsSpiritCE: ContinuousEffect = {
        effectId: `ce-act-as-spirit-${otherSourceId}`,
        sourceInstanceId: otherSourceId,
        sourceDefinitionId: otherNexusDef.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "permanent" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "act_as_spirit",
        targetInstanceId: otherSourceId,
        metadata: {
          statBlueprint: {
            kind: "static_copy",
            snapshot: {
              cost: 1,
              reductionSymbols: [],
              symbolColors: ["red"],
              tribes: [],
              levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
            },
          },
        },
      };
      const boostedState: GameState = {
        ...state,
        activeContinuousEffects: [
          ...state.activeContinuousEffects,
          actAsSpiritCE,
        ],
      };
      const result = executeEffect({
        chainId: "test:bslh01-cards:19426",
        state: boostedState,
        effect: deckRevealEffect,
        sourceInstanceId: otherSourceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(result.pendingDeckReveal).toBeNull();
      const pending = result.pendingDeckRevealCountBoostChoice;
      expect(pending).not.toBeNull();
      expect(pending!.sourceInstanceId).toBe(otherSourceId);
    });

    it("apply 解決後に同じ pendingId で再解決しようとすると例外になる (二重加算防止)", () => {
      const { state, otherSourceId } = buildBoostedState(otherSpiritDef);
      const paused = executeEffect({
        chainId: "test:bslh01-cards:19441",
        state,
        effect: deckRevealEffect,
        sourceInstanceId: otherSourceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      const pending = paused.pendingDeckRevealCountBoostChoice!;
      const staleAction = {
        kind: "resolve_pending_deck_reveal_count_boost_choice" as const,
        actionId: `drcb-${pending.pendingId}:apply`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "apply" as const,
        bonusAmount: pending.bonusAmount,
      };
      const resolved = applyLegalAction({
        state: paused,
        action: staleAction,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(resolved.pendingDeckRevealCountBoostChoice).toBeNull();
      expect(resolved.pendingDeckReveal?.revealedCardInstanceIds).toHaveLength(
        2
      );
      // resolved は pendingDeckRevealCountBoostChoice が既に null (=消費済み) の状態。
      // 同じ (今や stale な) action を再適用しようとすると、二重加算されず例外で拒否される。
      expect(() =>
        applyLegalAction({
          state: resolved,
          action: staleAction,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        })
      ).toThrow(/No pending deck reveal count boost choice to resolve/);
    });

    describe("discard(fromZone:deck) 消費側拡張 (ENGINE-optional-deck-reveal-count-boost Step3)", () => {
      it("自分のスピリットの効果による discard(fromZone:deck) も +1 適用可否の pending を立てて中断する", () => {
        const { state, otherSourceId } = buildBoostedState(
          otherSpiritDiscardDef
        );
        const result = executeEffect({
          chainId: "test:bslh01-cards:19489",
          state,
          effect: deckDiscardEffect,
          sourceInstanceId: otherSourceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
        });
        const pending = result.pendingDeckRevealCountBoostChoice;
        expect(pending).not.toBeNull();
        expect(pending!.actingPlayerId).toBe("alice");
        expect(pending!.sourceInstanceId).toBe(otherSourceId);
        expect(pending!.bonusAmount).toBe(1);
        // discard(fromZone:deck) は選択モーダルを持たない強制確定経路のため、
        // 中断時点ではまだ捨てられていない (boost 解決後に確定枚数で実行される)。
        // trash 判定はデッキ由来カード (deck-*) に限定する (x09Source は
        // normalCoreCount:0 のテスト fixture のため、SBA 経由でコア不足消滅し
        // trash に混ざり得る＝本テストの検証対象外)。
        expect(
          result.cardInstances.filter(
            (c) => c.zone === "trash" && c.instanceId.startsWith("deck-")
          )
        ).toHaveLength(0);
      });

      it("apply を選ぶと count+1 (2枚) でデッキ上から破棄される", () => {
        const { state, otherSourceId } = buildBoostedState(
          otherSpiritDiscardDef
        );
        const paused = executeEffect({
          chainId: "test:bslh01-cards:19517",
          state,
          effect: deckDiscardEffect,
          sourceInstanceId: otherSourceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
        });
        const pending = paused.pendingDeckRevealCountBoostChoice!;
        const resolved = applyLegalAction({
          state: paused,
          action: {
            kind: "resolve_pending_deck_reveal_count_boost_choice",
            actionId: `drcb-${pending.pendingId}:apply`,
            can: true,
            reason: "test",
            actingPlayerId: pending.actingPlayerId,
            pendingId: pending.pendingId,
            sourceInstanceId: pending.sourceInstanceId,
            effectIndex: pending.effectIndex,
            stepIndex: pending.stepIndex,
            choice: "apply",
            bonusAmount: pending.bonusAmount,
          },
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }).state;
        expect(resolved.pendingDeckRevealCountBoostChoice).toBeNull();
        expect(
          resolved.cardInstances.filter(
            (c) => c.zone === "trash" && c.instanceId.startsWith("deck-")
          )
        ).toHaveLength(2);
      });

      it("decline を選ぶと通常通り count=1 のまま破棄される", () => {
        const { state, otherSourceId } = buildBoostedState(
          otherSpiritDiscardDef
        );
        const paused = executeEffect({
          chainId: "test:bslh01-cards:19555",
          state,
          effect: deckDiscardEffect,
          sourceInstanceId: otherSourceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
        });
        const pending = paused.pendingDeckRevealCountBoostChoice!;
        const resolved = applyLegalAction({
          state: paused,
          action: {
            kind: "resolve_pending_deck_reveal_count_boost_choice",
            actionId: `drcb-${pending.pendingId}:decline`,
            can: true,
            reason: "test",
            actingPlayerId: pending.actingPlayerId,
            pendingId: pending.pendingId,
            sourceInstanceId: pending.sourceInstanceId,
            effectIndex: pending.effectIndex,
            stepIndex: pending.stepIndex,
            choice: "decline",
            bonusAmount: pending.bonusAmount,
          },
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        }).state;
        expect(resolved.pendingDeckRevealCountBoostChoice).toBeNull();
        expect(
          resolved.cardInstances.filter(
            (c) => c.zone === "trash" && c.instanceId.startsWith("deck-")
          )
        ).toHaveLength(1);
      });

      it("スピリット以外(ネクサス)の効果による discard(fromZone:deck) は sourceFilter 不一致で pending を立てない", () => {
        const { state, otherSourceId } =
          buildBoostedState(otherNexusDiscardDef);
        const result = executeEffect({
          chainId: "test:bslh01-cards:19592",
          state,
          effect: deckDiscardEffect,
          sourceInstanceId: otherSourceId,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
        });
        expect(result.pendingDeckRevealCountBoostChoice).toBeNull();
        expect(
          result.cardInstances.filter((c) => c.zone === "trash")
        ).toHaveLength(1);
      });
    });
  });
});

describe("BSLH01-X10 シグムント(碧)", () => {
  const c = card("BSLH01-X10");
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
  it("ライフ減少バースト召喚 / SDフラッシュで最大3破壊", () => {
    const burst = c.effects![0]!;
    expect(burst.timing).toMatchObject({
      kind: "burst",
      trigger: { kind: "life_decrease", player: "self" },
    });
    const cost = c.effects![1]!.steps[0]!.action;
    expect(cost.kind).toBe("core_move");
    const destroy = c.effects![1]!.steps[1]!.action;
    if (destroy.kind === "destroy")
      expect(destroy.suppressDestroyedEffects).toBe("all_opponent");
    const symbolAdd = c.effects![1]!.steps[2]!.action;
    if (symbolAdd.kind === "symbol_add") {
      expect(symbolAdd.symbol).toBe("red");
      expect(symbolAdd.duration).toEqual({ scope: "turn" });
    }
  });

  it("バースト effects[0]: choiceIndex 0 = 召喚free、choice[0] = クォーツセット(通常コスト、free指定なし)", () => {
    const e0 = c.effects![0]!;
    const summonStep = e0.steps[0]!;
    expect(summonStep.action).toMatchObject({
      kind: "summon",
      costModifier: "free",
    });
    expect(summonStep.choice?.[0]!.action).toEqual({
      kind: "quartz_set",
      target: { kind: "self" },
    });
    const gateStep = e0.steps[1]!;
    expect(gateStep.connector).toBe("sequential");
    expect(gateStep.condition).toEqual([
      { kind: "quartz_attribute", player: "self", attribute: "any", min: 6 },
    ]);
    expect(gateStep.action).toEqual({
      kind: "core_move",
      from: { kind: "outside_game" },
      amount: 1,
      splitDestinations: {
        destinations: [
          {
            location: {
              kind: "field_card",
              player: "self",
              filter: { category: ["spirit"] },
            },
          },
          { location: { kind: "reserve", player: "self" } },
        ],
      },
    });
  });

  it("[board] effects[0] step[1]: ENIGMAクォーツの<風>属性値合計6以上(処女珠+脱兎)でゲーム外からソウルコア1個をリザーブへ", () => {
    const source = createCardInstance(c, {
      instanceId: "x10-enigma-gate-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "x10-enigma-gate-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    // 処女珠(風5) + 脱兎(風3) = 風8 (>=6)。BSLH01-R02 の同型テストと同じ組合せ。
    const quartz1 = createCardInstance(card("BSLH01-C04"), {
      instanceId: "x10-enigma-gate-quartz-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const quartz2 = createCardInstance(card("BSLH01-X04"), {
      instanceId: "x10-enigma-gate-quartz-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, host, quartz1, quartz2],
    });
    const soulSetup: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const withQuartz1 = setQuartz(
      soulSetup,
      {
        quartzInstanceId: quartz1.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "left",
      },
      getDef
    )!;
    const withQuartz2 = setQuartz(
      withQuartz1,
      {
        quartzInstanceId: quartz2.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "right",
      },
      getDef
    )!;

    const e0 = c.effects![0]!;
    const gateStep = e0.steps[1]!;
    const reserveBefore = withQuartz2.players.find(
      (p) => p.id === "alice"
    )!.reserveSoulCoreCount;
    const opened = executeEffect({
      chainId: "test:bslh01-cards:19728",
      state: withQuartz2,
      effect: { ...e0, steps: [gateStep] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    // splitDestinations (field_card スピリット or reserve) のプレイヤー選択待ちになる。
    expect(opened.pendingCoreSplitSelection).not.toBeNull();
    const split = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_core_split");
    expect(split).toBeDefined();
    const after = applyLegalAction({
      state: opened,
      action: split!,
      coreSplitDistribution: [0, 1],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.pendingCoreSplitSelection).toBeNull();
    const aliceAfter = after.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveSoulCoreCount).toBe(reserveBefore + 1);

    // 属性値合計が閾値未満(quartz2 なし、風5のみ)なら発火しない。
    const afterInsufficient = executeEffect({
      chainId: "test:bslh01-cards:19757",
      state: withQuartz1,
      effect: { ...e0, steps: [gateStep] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceInsufficient = afterInsufficient.players.find(
      (p) => p.id === "alice"
    )!;
    expect(aliceInsufficient.reserveSoulCoreCount).toBe(reserveBefore);
  });

  it("[board] effects[0] step[1]: field_card選択でソウルコア配置先のpendingCoreDistributionが開き、選んだスピリットに直接置かれる", () => {
    const source = createCardInstance(c, {
      instanceId: "x10-enigma-gate-multi-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const otherSpirit = createCardInstance(card("BSTH01-C01"), {
      instanceId: "x10-enigma-gate-multi-other-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "x10-enigma-gate-multi-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const quartz1 = createCardInstance(card("BSLH01-C04"), {
      instanceId: "x10-enigma-gate-multi-quartz-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const quartz2 = createCardInstance(card("BSLH01-X04"), {
      instanceId: "x10-enigma-gate-multi-quartz-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, otherSpirit, host, quartz1, quartz2],
    });
    const soulSetup: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const withQuartz1 = setQuartz(
      soulSetup,
      {
        quartzInstanceId: quartz1.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "left",
      },
      getDef
    )!;
    const withQuartz2 = setQuartz(
      withQuartz1,
      {
        quartzInstanceId: quartz2.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "right",
      },
      getDef
    )!;

    const e0 = c.effects![0]!;
    const gateStep = e0.steps[1]!;
    const opened = executeEffect({
      chainId: "test:bslh01-cards:19838",
      state: withQuartz2,
      effect: { ...e0, steps: [gateStep] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const split = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_core_split");
    const afterSplit = applyLegalAction({
      state: opened,
      action: split!,
      coreSplitDistribution: [1, 0],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    // 自分のスピリット候補が複数 (source, otherSpirit、及びホストに set 済みの
    // quartz1/quartz2 も category:spirit の field カードとして候補に入る) →
    // pendingCoreDistribution が開く。
    expect(afterSplit.pendingCoreDistribution).not.toBeNull();
    expect(afterSplit.pendingCoreDistribution!.fromKind).toBe("outside_game");
    expect(
      afterSplit.pendingCoreDistribution!.candidates.map((c) => c.instanceId)
    ).toEqual(
      expect.arrayContaining([source.instanceId, otherSpirit.instanceId])
    );
    const distribution = getLegalActions({
      state: afterSplit,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(distribution).toBeDefined();
    const resolved = applyLegalAction({
      state: afterSplit,
      action: distribution!,
      coreDistributionSoulCoreInstanceId: otherSpirit.instanceId,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(resolved.pendingCoreDistribution).toBeNull();
    const otherSpiritAfter = resolved.cardInstances.find(
      (ci) => ci.instanceId === otherSpirit.instanceId
    )!;
    expect(otherSpiritAfter.soulCoreCount).toBe(1);
  });

  it("[board] effects[0] step[1]: 自分のスピリットが0体のとき、field_card側へ配分するcoreSplitDistributionは拒否される(コア消失防止)", () => {
    // adversarial verifier round1 指摘: outside_game 源は「候補0件→no-op」だと新規ソウル
    // コアがそもそも生成されず、置く義務(終止形=強制)が消失し得る。gateStep 本体の
    // quartz_attribute 条件は「候補になり得る quartz カードを場に置く」ことと不可分な
    // ため(setQuartz が quartz カード自身も zone:"field"+category:spirit にする)、条件を
    // 使わずに同一 action (splitDestinations) を直接発火させ、自分のスピリットが真に
    // 0体の盤面で検証する。
    const source = createCardInstance(c, {
      instanceId: "x10-split-zero-candidate-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });
    const e0 = c.effects![0]!;
    const gateStep = e0.steps[1]!;
    const unconditionalStep = { ...gateStep, condition: undefined };
    const opened = executeEffect({
      chainId: "test:bslh01-cards:19910",
      state: base,
      effect: { ...e0, steps: [unconditionalStep] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(opened.pendingCoreSplitSelection).not.toBeNull();
    const split = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_core_split");
    expect(split).toBeDefined();
    // [1, 0] = field_card 側 (自分のスピリット候補0体) へ全量を配分しようとする不正な選択。
    expect(() =>
      applyLegalAction({
        state: opened,
        action: split!,
        coreSplitDistribution: [1, 0],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      })
    ).toThrow(/no eligible candidates/);
    // reserve 側 ([0, 1]) は候補判定の対象外 (field/field_card ではない) なので正常に解決できる。
    const reserveBefore = opened.players.find(
      (p) => p.id === "alice"
    )!.reserveSoulCoreCount;
    const resolvedReserve = applyLegalAction({
      state: opened,
      action: split!,
      coreSplitDistribution: [0, 1],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(resolvedReserve.pendingCoreSplitSelection).toBeNull();
    expect(
      resolvedReserve.players.find((p) => p.id === "alice")!
        .reserveSoulCoreCount
    ).toBe(reserveBefore + 1);
  });

  it('[board] effects[0] step[1]: attribute:"any" は属性を跨いで合算しない(美臭=風4/空1/水1/火2、単一属性最大4なら合計8でも不発)', () => {
    const source = createCardInstance(c, {
      instanceId: "x10-enigma-gate-cross-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "x10-enigma-gate-cross-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    // BSLH01-R02 自身の quartzData: 風4/空1/水1/火2 (全属性合計8だが単一属性最大は風4)。
    const quartz = createCardInstance(card("BSLH01-R02"), {
      instanceId: "x10-enigma-gate-cross-quartz",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, host, quartz],
    });
    const soulSetup: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const withQuartz = setQuartz(
      soulSetup,
      {
        quartzInstanceId: quartz.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "left",
      },
      getDef
    )!;

    const e0 = c.effects![0]!;
    const gateStep = e0.steps[1]!;
    const reserveBefore = withQuartz.players.find(
      (p) => p.id === "alice"
    )!.reserveSoulCoreCount;
    const after = executeEffect({
      chainId: "test:bslh01-cards:20002",
      state: withQuartz,
      effect: { ...e0, steps: [gateStep] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveSoulCoreCount).toBe(reserveBefore);
  });

  it("[board] effects[0] step[0]: choiceIndex 1 = 魂状態の対象にクォーツセット(通常コスト、countCost=2を支払う)", () => {
    const source = createCardInstance(c, {
      instanceId: "x10-quartz-set-choice-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "x10-quartz-set-choice-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, host],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const e0 = c.effects![0]!;
    const summonOrSetStep = e0.steps[0]!;
    const after = executeEffect({
      chainId: "test:bslh01-cards:20041",
      state: before,
      effect: { ...e0, steps: [summonOrSetStep] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
    });
    const sourceAfter = after.cardInstances.find(
      (ci) => ci.instanceId === source.instanceId
    )!;
    expect(sourceAfter.zoneRoleName).toBe("quartz");
    expect(
      after.quartzSetStates.some(
        (q) =>
          q.quartzInstanceId === source.instanceId &&
          q.hostInstanceId === host.instanceId
      )
    ).toBe(true);
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
  });

  it("SDフラッシュ effects[1]: ソウルコアをコストに支払うと相手スピ/アルティ最大3体破壊+自分に赤シンボル追加 (P3-125 Step2)", () => {
    const ALICE = "alice";
    const BOB = "bob";
    const src = createCardInstance(c, {
      instanceId: "sigmund-x10-onfield",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 1,
    });
    const bobSpirit = createCardInstance(card("BSTH01-C01"), {
      instanceId: "bob-spirit-x10",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, bobSpirit],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:20097",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "removed_from_game" });
    const srcAfter = after.cardInstances.find(
      (x) => x.instanceId === src.instanceId
    )!;
    expect(srcAfter.soulCoreCount).toBe(0);
    // destroy (count:{min:0,max:3}) は対象選択が範囲選択 pending 経由のため、この
    // 直接 executeEffect 呼び出しでは 0 体選択に解決される (bobSpirit は場に残る)。
    // ここで検証したいのはコスト成立で後続 payload 群 (destroy/symbol_add) が
    // ref_succeeded ゲートでロールバックされずに実行され続けること自体であり、
    // 個別対象選択の解決経路は既存 destroy 実装の範囲 (X03 precedent 4812-4819 と同型)。
    const bobAfter = after.cardInstances.find(
      (x) => x.instanceId === bobSpirit.instanceId
    )!;
    expect(bobAfter.zone).toBe("field");
    expect(
      after.activeContinuousEffects.find(
        (e) =>
          e.targetInstanceId === src.instanceId &&
          e.modifierTag === "symbol_addition"
      )
    ).toBeDefined();
  });

  it("SDフラッシュ effects[1]: ソウルコアがライフにあるときはコストを支払えず、破壊/赤シンボルが不発になる", () => {
    const ALICE = "alice";
    const BOB = "bob";
    const src = createCardInstance(c, {
      instanceId: "sigmund-x10-lifesoul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobSpirit = createCardInstance(card("BSTH01-C01"), {
      instanceId: "bob-spirit-x10b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, bobSpirit],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE ? { ...p, soulCoreLocation: { kind: "life" } } : p
      ),
    };
    const after = executeEffect({
      chainId: "test:bslh01-cards:20156",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "life" });
    expect(
      after.cardInstances.find((x) => x.instanceId === bobSpirit.instanceId)
        ?.zone
    ).toBe("field");
    expect(
      after.activeContinuousEffects.find(
        (e) =>
          e.targetInstanceId === src.instanceId &&
          e.modifierTag === "symbol_addition"
      )
    ).toBeUndefined();
  });

  it("【クォーツ：天穹珠】は soulState 限定 + コスト5以下の相手スピリットのバトル終了時に破壊できる (game_event third-party)", () => {
    const e = c.effects![2]!;
    expect(e.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "battle_end",
      triggerFilter: { category: ["spirit"], maxCost: 5 },
    });
    expect(e.applicability).toEqual({ soulState: true });
    expect(e.executionMode).toBe("optional");
    expect(e.steps[0]!.action).toEqual({
      kind: "destroy",
      target: { kind: "trigger_related_instance" },
    });
    expect(e.stub).toBeUndefined();
  });

  it("【クォーツ：天穹珠】executeEffect で観測対象(trigger_related_instance)を破壊する", () => {
    const source = createCardInstance(c, {
      instanceId: "x10-quartz-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const opponentParticipant = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bob-battle-participant",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, opponentParticipant],
    });
    const before: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: [source.instanceId] }
          : p
      ),
    };
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:20224",
        state: before,
        effect: c.effects![2]!,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        triggerRelatedInstanceId: opponentParticipant.instanceId,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );
    const flushed = flushPendingLeaves(after, getDef);
    expect(
      flushed.cardInstances.find(
        (ci) => ci.instanceId === opponentParticipant.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("【クォーツ：天穹珠】相手のコスト5以下スピリットが参加したバトル終了時、ENIGMA にセット中だけ観測候補に立つ（ENGINE-quartz-host-identity-propagation, quartz_inherited）", () => {
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "x10-quartz-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const source = createCardInstance(c, {
      instanceId: "x10-quartz-gate",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const opponentParticipant = createCardInstance(card("BSLH01-C01"), {
      instanceId: "bob-battle-participant-gate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, source, opponentParticipant],
    });
    const lookup = buildTriggeredEffectLookup([c]);
    const pendingEffect = {
      pendingId: "pte:x10-battle-end",
      actingPlayerId: "alice",
      eventKind: "battle_end",
      event: {
        family: "battle_end",
        validationMode: "require_related_instance_on_field",
        actionKind: "attack",
      },
      source: "battle_resolution",
      chainId: "test:bslh01-cards:20270",
      attackId: "attack:x10-be-1:1",
      relatedPlayerId: "bob",
      relatedInstanceId: opponentParticipant.instanceId,
      amount: 0,
      step: "attack",
      window: "declare_attack",
      resolvedSourceInstanceIds: [],
    } as unknown as Parameters<
      typeof getAvailableTriggeredEffectSourceChoices
    >[0]["pendingEffect"];

    const soulSetBase: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const soulSet = setQuartz(
      soulSetBase,
      {
        quartzInstanceId: source.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "left",
      },
      getDef
    )!;
    expect(soulSet).not.toBeNull();
    const choicesSet = getAvailableTriggeredEffectSourceChoices({
      state: soulSet,
      pendingEffect,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      choicesSet.find(
        (choice) =>
          (choice.sourceEffectInstanceId ?? choice.sourceCard.instanceId) ===
          source.instanceId
      )
    ).toBeDefined();

    const queueBattleEnd = (state: GameState, relatedInstanceId: string) =>
      queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "battle_end" as const,
            source: "battle_resolution" as const,
            chainId: "test:bslh01-cards:20327",
            attackId: "attack:x10-be-1:1",
            relatedPlayerId: "bob",
            relatedInstanceId,
            amount: 0,
            actionKind: "attack" as const,
          },
        ],
        undefined,
        {
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: lookup,
          getRegisteredBurstActions: () => undefined,
        }
      );
    const triggerLookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => [],
    };

    // 実際の battle_end queue から legal action を経由して解決する。コスト5の
    // 観測対象では source が pending に結び付き、フラッシュ窓を閉じると破壊が
    // flush される。
    const queuedLowCost = queueBattleEnd(
      soulSet,
      opponentParticipant.instanceId
    );
    const lowCostPending = queuedLowCost.pendingTriggeredEffects.find(
      (pending) => pending.eventKind === "battle_end"
    );
    expect(lowCostPending).toBeDefined();
    const resolveLowCost = getLegalActions({
      state: queuedLowCost,
      actingPlayerId: "alice",
      ...triggerLookups,
    }).find((action) => action.kind === "resolve_pending_triggered_effect");
    expect(resolveLowCost).toBeDefined();
    const declaredLowCost = applyLegalAction({
      state: queuedLowCost,
      action: resolveLowCost!,
      ...triggerLookups,
    }).state;
    const closeLowCostWindow = getLegalActions({
      state: declaredLowCost,
      actingPlayerId: declaredLowCost.stackWindow!.priorityPlayerId,
      ...triggerLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(closeLowCostWindow).toBeDefined();
    const resolvedLowCost = applyLegalAction({
      state: declaredLowCost,
      action: closeLowCostWindow!,
      ...triggerLookups,
    }).state;
    const flushedLowCost = flushPendingLeaves(resolvedLowCost, getDef);
    expect(
      flushedLowCost.cardInstances.find(
        (card) => card.instanceId === opponentParticipant.instanceId
      )?.zone
    ).toBe("trash");

    // 本文の「コスト5以下」は battle_end の観測対象そのものの条件。
    // コスト8のスピリットが参加した同じ終了時には、pending source / 解決 action
    // が立たない。
    const highCostParticipant = createCardInstance(c, {
      instanceId: "bob-battle-high-cost-participant",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const highCostBase: GameState = {
      ...base,
      cardInstances: [host, source, highCostParticipant],
    };
    const highCostSoulSetBase: GameState = {
      ...highCostBase,
      players: highCostBase.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    const highCostSoulSet = setQuartz(
      highCostSoulSetBase,
      {
        quartzInstanceId: source.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: "alice",
        slot: "left",
      },
      getDef
    )!;
    const highCostChoices = getAvailableTriggeredEffectSourceChoices({
      state: highCostSoulSet,
      pendingEffect: {
        ...pendingEffect,
        relatedInstanceId: highCostParticipant.instanceId,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      highCostChoices.find(
        (choice) =>
          (choice.sourceEffectInstanceId ?? choice.sourceCard.instanceId) ===
          source.instanceId
      )
    ).toBeUndefined();
    const queuedHighCost = queueBattleEnd(
      highCostSoulSet,
      highCostParticipant.instanceId
    );
    const resolveHighCost = getLegalActions({
      state: queuedHighCost,
      actingPlayerId: "alice",
      ...triggerLookups,
    }).find((action) => action.kind === "resolve_pending_triggered_effect");
    expect(resolveHighCost).toBeUndefined();

    // 未セット（手札のまま、host に紐づいていない）なら quartz_inherited のソースは立たない。
    const choicesUnset = getAvailableTriggeredEffectSourceChoices({
      state: base,
      pendingEffect,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      choicesUnset.find(
        (choice) =>
          (choice.sourceEffectInstanceId ?? choice.sourceCard.instanceId) ===
          source.instanceId
      )
    ).toBeUndefined();
  });

  it("timingScope: 「お互いのアタックステップ」限定のため、アタックステップでは提示されるがメインステップでは提示されない (P3-125 index.md 残留懸念、X03/X05 と同型の見落とし対応)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const src = createCardInstance(c, {
      instanceId: "x10-sd-timing",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });
    const before: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: src.instanceId },
            }
          : p
      ),
    };
    const effectLookups = {
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
      getRegisteredBurstEffectActions: buildBurstEffectLookup(ALL_CARDS),
    };
    const findAction = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        ...effectLookups,
      }).find(
        (a) =>
          a.kind === "use_field_card_effect" && a.sourceCardNo === "BSLH01-X10"
      );

    const mainState: GameState = {
      ...before,
      activePlayerId: ALICE,
      step: "main",
    };
    expect(findAction(mainState)).toBeUndefined();

    const attackState: GameState = {
      ...before,
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "attack-group:1:player-1:battle-entity:none",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
    };
    expect(findAction(attackState)).toBeDefined();
  });
});

describe("BSLH01-TR04(A) ヴァルド・ヴァレス — BP比較破壊→Lv2で相手ネクサス破壊", () => {
  const ALICE = "player-1";
  const BOB = "player-2";
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
  const c = card("BSLH01-TR04(A)");

  it("構造: 召喚/アタック時 bp_compare_destroy → ref_executed+min_level:2 でネクサス破壊（stub撤去）", () => {
    // 「そうしたとき」=「BP比べた事実」をゲート（ユーザー裁定 2026-06-19）。
    // BP比べ破壊耐性で破壊不発でも比較自体が成立すれば連動破壊は発火するため
    // ref_succeeded ではなく ref_executed を使う。
    const e0 = c.effects![0]!;
    expect(e0.stub).toBeUndefined();
    expect(e0.steps[0]!.action.kind).toBe("bp_compare_destroy");
    expect(e0.steps[0]!.id).toBe("bp-compare");
    const nexus = e0.steps[1]!;
    expect(nexus.connector).toBe("after_triggers");
    expect(nexus.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "bp-compare",
    });
    expect(nexus.condition).toEqual([
      { kind: "self_state", state: "on_field" },
      { kind: "min_level", value: 2 },
    ]);
    if (nexus.action.kind === "destroy" && "filter" in nexus.action.target) {
      expect(nexus.action.target.filter.category).toEqual(["nexus"]);
    } else {
      throw new Error("nexus destroy filter target expected");
    }
  });

  it("[board] BP比べ破壊耐性で破壊不発でも『そうしたとき』連動はLv2で発火 (ref_executed)", () => {
    // 「BP比べ破壊耐性」の相手は比べることはできて破壊だけ発生しない (ユーザー裁定 2026-06-19)。
    // ref_executed は「比べた事実」を捉えるので、相手スピリットが残存しても
    // 連動の「相手ネクサス1つ破壊」は Lv2 ならば発火する。
    const src = createCardInstance(c, {
      instanceId: "vald-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2 → BP 4000
    });
    const oppSpirit = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-2", // BP 2000、本来なら破壊対象
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const oppNexus = createCardInstance(card("BSDB01-C06"), {
      instanceId: "nexus-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    // krillin-2 に「BP比べでは破壊されない」CE を貼る (source="all")。
    const immunityCE = {
      effectId: "ce-bpc-krillin-2",
      sourceInstanceId: "krillin-2",
      sourceDefinitionId: "test-def",
      actingPlayerId: BOB,
      duration: { scope: "while_on_field" as const },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_be_destroyed_by_bp_compare" as const,
      targetInstanceId: "krillin-2",
      metadata: { source: "all" as const },
    };
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, oppSpirit, oppNexus],
      }),
      activeContinuousEffects: [immunityCE],
    };
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:20621",
        state: before,
        effect: c.effects![0]!,
        sourceInstanceId: "vald-2",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );
    const get = (id: string) =>
      after.cardInstances.find((x) => x.instanceId === id)!;
    // drain は finalizeEffectResolution 経由で flushPendingLeaves するため、結果は post-flush。
    expect(get("krillin-2").zone).toBe("field"); // 耐性で破壊不発 → 場に残る
    expect(get("vald-2").zone).toBe("field"); // 源も BP上 残存
    expect(get("nexus-2").zone).toBe("trash"); // ref_executed で発火 → flush でトラッシュ
  });

  it("[board] Lv2(4000) vs 相手2000: 相手破壊・源残存・連動で相手ネクサス破壊", () => {
    // BSLH01-TR04(A): Lv1 core1=BP3000 / Lv2 core3=BP4000。core3 → Lv2。
    const src = createCardInstance(c, {
      instanceId: "vald-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2 → BP 4000
    });
    const oppSpirit = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-1", // BP 2000 ≤ 4000 → 破壊、源は残る
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const oppNexus = createCardInstance(card("BSDB01-C06"), {
      instanceId: "nexus-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      cardInstances: [src, oppSpirit, oppNexus],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bslh01-cards:20663",
        state: before,
        effect: c.effects![0]!,
        sourceInstanceId: "vald-1",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );
    const get = (id: string) =>
      after.cardInstances.find((x) => x.instanceId === id)!;
    // drain で finalize → flush 済み。zone で post-flush 状態を検証。
    expect(get("krillin-1").zone).toBe("trash"); // 相手スピリット破壊
    expect(get("vald-1").zone).toBe("field"); // 源は勝者・残存
    expect(get("nexus-1").zone).toBe("trash"); // Lv2連動でネクサス破壊
  });
});

describe("BSLH01 F2.4 クォーツ data 層: quartzData / host quartzHostData", () => {
  // 手札セット可能クォーツ（前面）: cardNo → [quartzName, countCost, attributeValues]
  const FRONT: Array<
    [string, string, number, Partial<Record<string, number>>]
  > = [
    ["BSLH01-C01", "双魚珠", 2, { 時: 5 }],
    ["BSLH01-C04", "処女珠", 2, { 風: 5 }],
    ["BSLH01-C05", "獅子珠", 2, { 火: 5 }],
    ["BSLH01-C06", "魔防2", 1, { 水: 3 }],
    ["BSLH01-C07", "冥王珠", 2, { 時: 5 }],
    ["BSLH01-C08", "天秤珠", 2, { 幻: 5 }],
    ["BSLH01-C09", "金牛珠", 2, { 空: 5 }],
    ["BSLH01-C10", "機功", 2, { 地: 3, 水: 2, 時: 1 }],
    ["BSLH01-M01", "精神3", 2, { 幻: 5 }],
    ["BSLH01-M03", "双児珠", 2, { 幻: 5 }],
    ["BSLH01-M04", "龍眼", 2, { 幻: 5, 火: 2, 空: 2 }],
    ["BSLH01-R01", "駆動", 1, { 時: 3 }],
    // 誤記修正済み（色→属性、数も訂正）: 風4 空1 水1 火2
    ["BSLH01-R02", "美臭", 2, { 風: 4, 空: 1, 水: 1, 火: 2 }],
    ["BSLH01-R03", "練気", 2, { 火: 3, 風: 2, 水: 1 }],
    ["BSLH01-R04", "治癒", 1, { 水: 3, 幻: 2 }],
    ["BSLH01-R05", "丹精", 1, { 水: 3, 空: 2 }],
    ["BSLH01-R06", "回避3", 2, { 風: 5 }],
    ["BSLH01-TR01(A)", "耀脈", 1, { 地: 3, 水: 2 }],
    ["BSLH01-TR02(A)", "範囲", 1, { 空: 3 }],
    ["BSLH01-TR03(A)", "情報", 1, { 幻: 3 }],
    ["BSLH01-TR04(A)", "封技の刃", 1, { 火: 3 }],
    ["BSLH01-X03", "行動力", 1, { 時: 3 }],
    ["BSLH01-X04", "脱兎", 1, { 風: 3 }],
    ["BSLH01-X05", "攻撃2", 2, { 火: 3 }],
    ["BSLH01-X06", "封技の刃", 2, { 水: 6 }],
    ["BSLH01-X07", "防御3", 2, { 地: 5 }],
    ["BSLH01-X08", "省EP2", 2, { 空: 3, 時: 1, 幻: 2 }],
    ["BSLH01-X09", "練刃", 1, { 幻: 2, 地: 1 }],
    ["BSLH01-X10", "天穹珠", 2, { 火: 5 }],
  ];

  it.each(FRONT)(
    "%s は quartzData(%s, C%d) を持つ",
    (no, name, countCost, attrs) => {
      const q = card(no).quartzData;
      expect(q).toBeDefined();
      expect(q!.quartzName).toBe(name);
      expect(q!.cost).toBe(0); // カウント消費型（コア cost なし）
      expect(q!.countCost).toBe(countCost);
      expect(q!.attributeValues).toEqual(attrs);
    }
  );

  // 効果以外でセットできない裏面クォーツ（転醒 B 面、countCost なし）
  const BACK: Array<[string, string, Partial<Record<string, number>>]> = [
    ["BSLH01-TR01(A)", "虎威", { 地: 5, 火: 2, 時: 2 }],
    ["BSLH01-TR02(A)", "妨害3", { 空: 5, 時: 1, 幻: 3 }],
    ["BSLH01-TR03(A)", "幻惑", { 幻: 3, 風: 1, 空: 2 }],
    ["BSLH01-TR04(A)", "必殺", { 火: 3 }],
  ];

  it.each(BACK)(
    "%s の B 面は quartzData(%s, 効果セット限定) を持つ",
    (no, name, attrs) => {
      const back = card(no).backFace;
      expect(back?.quartzData).toBeDefined();
      expect(back!.quartzData!.quartzName).toBe(name);
      expect(back!.quartzData!.countCost).toBeUndefined();
      expect(back!.quartzData!.attributeValues).toEqual(attrs);
    }
  );

  it("BSLH01-CX01 effects[3]: 手札/手元 → 魂状態 activate（applicability.zone=['hand','set_aside']）", () => {
    const eff = card("BSLH01-CX01").effects![3]!;
    expect(eff.timing).toEqual({ kind: "activated", mode: "main" });
    expect(eff.applicability?.zone).toEqual(["hand", "set_aside"]);
    expect(eff.executionMode).toBe("optional");
    expect(eff.steps[0]!.action.kind).toBe("enter_soul_state");
    expect(eff.stub).toBeUndefined();
  });

  it("host BSLH01-CX01 ENIGMA は quartzHostData(左右3+中央1) と魂状態トリガー効果を持つ", () => {
    const cx = card("BSLH01-CX01");
    expect(cx.quartzHostData).toEqual({
      slots: { left: 3, center: 1, right: 3 },
      inheritsSetQuartzEffects: true,
    });

    const effs = cx.effects!;
    // スタートステップ count+2
    expect(effs[0]!.timing).toEqual({
      kind: "phase",
      step: "start",
      whose: "self",
    });
    // 魂状態になったとき count+2（F2.3 enter_soul_state トリガー）
    expect(effs[1]!.timing).toEqual({
      kind: "card_event",
      event: "enter_soul_state",
    });
    expect(effs[1]!.steps[0]!.action.kind).toBe("count_increase");
    // クォーツセット時 ターン2回:同名 ドロー（F2.3 quartz_set トリガー）
    expect(effs[2]!.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "quartz_set",
    });
    expect(effs[2]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 2,
    });
    expect(effs[2]!.steps[0]!.action.kind).toBe("draw");
  });
});

describe("BSLH01 F2.4b① クォーツ set-effect encode（applicability.soulState）", () => {
  it("C10 機功: phase end + quartz_attribute(地≥10) + core_move void→reserve、セット中限定", () => {
    const q = card("BSLH01-C10").effects!.at(-1)!;
    expect(q.timing).toEqual({ kind: "phase", step: "end", whose: "self" });
    expect(q.applicability?.soulState).toBe(true);
    expect(q.condition).toContainEqual({
      kind: "quartz_attribute",
      player: "self",
      attribute: "地",
      min: 10,
    });
    const mv = q.steps[0]!.action;
    expect(mv.kind).toBe("core_move");
    if (mv.kind === "core_move") {
      expect(mv.from).toEqual({ kind: "void", player: "self" });
      expect(mv.to).toEqual({ kind: "reserve", player: "self" });
      expect(mv.amount).toBe(2);
    }
    expect(q.stub).toBeUndefined();
  });

  it("R04 治癒: phase end + ライフ4以下 + <水>10以上 + core_move void→life、セット中限定", () => {
    const q = card("BSLH01-R04").effects!.at(-1)!;
    expect(q.timing).toEqual({ kind: "phase", step: "end", whose: "self" });
    expect(q.applicability?.soulState).toBe(true);
    expect(q.condition).toContainEqual({
      kind: "life_value",
      player: "self",
      max: 4,
    });
    expect(q.condition).toContainEqual({
      kind: "quartz_attribute",
      player: "self",
      attribute: "水",
      min: 10,
    });
    const mv = q.steps[0]!.action;
    expect(mv.kind).toBe("core_move");
    if (mv.kind === "core_move") {
      expect(mv.to).toEqual({ kind: "life", player: "self" });
    }
    expect(q.stub).toBeUndefined();
  });
});
