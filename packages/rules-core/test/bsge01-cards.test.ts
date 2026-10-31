import { chooseRuleBraveCores } from "./helpers/rule-brave-choice-driver";
/**
 * BSGE01 (ゴッドイーター) カードの effects 検証テスト。
 * 神喰 / GE / 契約合体 / ミラージュ / リンクエイド / バレットエディット 中心。
 * ミラージュ set-effect・バレットエディット・神喰カウント保護タグは基盤未実装のため stub。
 * 契約合体（P3-111 S1-S5）・リンクエイド（P3-111 S6）は実装済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeCoreMove,
  executeEffect,
  getEffectiveBp,
  getEffectiveSymbols,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  runStateBasedActions,
} from "../src";
import {
  executeBattleResolution,
  getUnblockedLifeDamage,
} from "../src/battle/battle-actions";
import {
  areLegalActionTargetGroupsSatisfiable,
  assertLegalActionTargetGroupsSatisfied,
  buildLegalActionTargetGroups,
  matchesEffectTargetFilter,
} from "../src/legal/legal-actions-shared";
import {
  getAvailableMagicPaymentSources,
  resolveDeferredMagicStack,
} from "../src/mechanics/magic-system";
import {
  flushPendingLeaves,
  resolveSoulStateReplacement,
} from "../src/state-based-actions";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import { executeExhaust } from "../src/effect/structured-state-grants";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { getPaidPreventionImmunityCost } from "../src/effect/effect-resistance-check";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { deserializeStepContext } from "../src/step-execution-context";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import {
  getApplicableAdditionalCostDelta,
  matchesCardFilter,
} from "../src/card/card-filter";
import type {
  ActiveStack,
  ActiveAttack,
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

/**
 * P3-112: contract_combine/link_aid の発揮宣言は今やスタック窓を開く（apply 即時解決ではない）。
 * responder のパスで窓を閉じ、deferred 解決（コスト支払い＋場入り/state-change）まで進める。
 * phase-f-grandwalker.test.ts 等の passStackUntilClosed と同型（このファイル専用ローカル複製）。
 */
function passStackUntilClosed(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  let current = state;
  let guard = 0;
  while (
    (current.stackWindow ||
      current.activeAttack?.flashWindowState.pendingStackAction) &&
    guard++ < 10
  ) {
    const responderId =
      current.stackWindow?.priorityPlayerId ??
      current.activeAttack?.flashWindowState.priorityPlayerId;
    if (!responderId) {
      throw new Error("stack responder not found");
    }
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      ...extraOptions,
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find(
      (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
    );
    if (!pass) {
      throw new Error(
        `pass_stack/pass_battle_flash for ${responderId} not found`
      );
    }
    current = (
      applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById,
        ...extraOptions,
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }
  return current;
}

function resolvePendingEffectTarget(
  state: GameState,
  targetInstanceIds: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const pending = state.pendingEffectTargetSelection;
  expect(pending).not.toBeNull();
  const actions = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const resolveAction = actions.find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_effect_target" }> =>
      a.kind === "resolve_pending_effect_target"
  );
  expect(resolveAction).toBeDefined();
  for (const id of targetInstanceIds) {
    expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
  }
  return (
    applyLegalAction({
      state,
      action: resolveAction!,
      targetInstanceIds,
      getCardDefinitionById,
      ...extraOptions,
    } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
  ).state;
}

/**
 * optional な on_step target は、実行を中断してこの pending で都度選択する。
 * C08 の反復はここを反復して、各巡の候補を現在の盤面から再計算する。
 */
function resolvePendingStepOptionalTarget(
  state: GameState,
  targetInstanceIds: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const pending = state.pendingStepOptionalTargetSelection;
  expect(pending).not.toBeNull();
  const actions = getLegalActions({
    state,
    actingPlayerId: pending!.choosingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const resolveAction = actions.find(
    (
      action
    ): action is Extract<
      LegalAction,
      { kind: "resolve_pending_step_optional_target_selection" }
    > => action.kind === "resolve_pending_step_optional_target_selection"
  );
  expect(resolveAction).toBeDefined();
  for (const id of targetInstanceIds) {
    expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
  }
  return (
    applyLegalAction({
      state,
      action: resolveAction!,
      targetInstanceIds,
      getCardDefinitionById,
      ...extraOptions,
    } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
  ).state;
}

function resolvePendingStepChoice(
  state: GameState,
  choiceIndex: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const pending = state.pendingStepChoice;
  expect(pending).not.toBeNull();
  const action = getLegalActions({
    state,
    actingPlayerId: pending!.choosingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]).find(
    (
      candidate
    ): candidate is Extract<
      LegalAction,
      { kind: "resolve_pending_step_choice" }
    > =>
      candidate.kind === "resolve_pending_step_choice" &&
      candidate.choiceIndex === choiceIndex
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    ...extraOptions,
  } as Parameters<typeof applyLegalAction>[0]).state;
}

function resolvePendingAsIfSoulCoreChoice(
  state: GameState,
  choiceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const pending = state.pendingAsIfSoulCoreChoice;
  expect(pending).not.toBeNull();
  const actions = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const resolveAction = actions.find(
    (
      a
    ): a is Extract<
      LegalAction,
      { kind: "resolve_pending_as_if_soul_core_choice" }
    > =>
      a.kind === "resolve_pending_as_if_soul_core_choice" &&
      a.choiceId === choiceId
  );
  expect(resolveAction).toBeDefined();
  return (
    applyLegalAction({
      state,
      action: resolveAction!,
      getCardDefinitionById,
      ...extraOptions,
    } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
  ).state;
}

function passStackAndResolveTarget(
  state: GameState,
  targetInstanceIds: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  return resolvePendingEffectTarget(
    passStackUntilClosed(state, getCardDefinitionById, extraOptions),
    targetInstanceIds,
    getCardDefinitionById,
    extraOptions
  );
}

const BSGE_NEGATE_TEST_DECK_CARD: CardDefinition = {
  cardNo: "BSGE01-NEGATE-TEST-DECK",
  name: "BSGE01 negate test deck",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
};

const BSGE_TEST_SPIRIT: CardDefinition = {
  cardNo: "BSGE01-TEST-SPIRIT",
  name: "BSGE01 test spirit",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

/**
 * C08 の対象開示中断後に同じ反復回数で再開できることを確認する responder。
 * 対象化への応答自体は count を増やすだけで、元の BP- 効果を無効化しない。
 */
const BSGE_TARGETED_RESPONSE_SPIRIT: CardDefinition = {
  ...BSGE_TEST_SPIRIT,
  cardNo: "BSGE01-TARGETED-RESPONSE-SPIRIT",
  name: "BSGE01 targeted response spirit",
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: "targeted",
        requireTriggerSelf: true,
        triggerFilter: { category: ["spirit"] },
        cause: ["opponent_effect"],
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};

const BSGE_COUNT_COST_TEST: CardDefinition = {
  cardNo: "BSGE01-COUNT-COST-TEST",
  name: "BSGE01 count cost test",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      executionMode: "optional",
      steps: [
        { action: { kind: "count_decrease", player: "self", amount: 2 } },
        {
          action: {
            kind: "exhaust",
            target: {
              kind: "filter",
              player: "opponent",
              filter: {
                filterOr: [
                  { category: ["spirit"] },
                  { category: ["ultimate"] },
                ],
              },
              count: { min: 0, max: 2 },
            },
            degree: "heavy_exhaust",
          },
          connector: "conditional_cost",
        },
      ],
    },
  ],
};

const BSGE_TRIGGERED_GROUP_TEST: CardDefinition = {
  cardNo: "BSGE01-TRIGGERED-GROUP-TEST",
  name: "BSGE01 triggered group test",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: "all",
          },
        },
        {
          action: { kind: "noop" },
          choice: [
            {
              action: {
                kind: "move_card",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "trash",
                  filter: { category: ["brave"] },
                  count: 1,
                },
                from: {
                  zone: "trash",
                  player: "self",
                  filter: { category: ["brave"] },
                },
                to: { zone: "hand" },
                count: 1,
              },
            },
          ],
          connector: "simultaneous",
        },
      ],
    },
  ],
};

const BSGE_C17_TARGET_SUMMON_DRAW: CardDefinition = {
  cardNo: "BSGE01-C17-TARGET-SUMMON-DRAW",
  name: "BSGE01 C17 target summon draw",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: ["召喚時、自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
};

const BSGE_C17_NO_TEXT_ATTACKER: CardDefinition = {
  cardNo: "BSGE01-C17-NO-TEXT-ATTACKER",
  name: "BSGE01 C17 no text attacker",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green", "green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const BSGE_C17_EFFECT_DAMAGE_SOURCE: CardDefinition = {
  cardNo: "BSGE01-C17-EFFECT-DAMAGE-SOURCE",
  name: "BSGE01 C17 effect damage source",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: ["メイン 相手のライフのコア2個をリザーブに置く。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "life_damage", player: "opponent", amount: 2 } },
      ],
      textRef: [0],
    },
  ],
};

const BSGE_C17_EFFECT_CORE_MOVE_SOURCE: CardDefinition = {
  cardNo: "BSGE01-C17-EFFECT-CORE-MOVE-SOURCE",
  name: "BSGE01 C17 effect core move source",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: ["メイン 相手のライフのコア2個を相手のリザーブに置く。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "life", player: "opponent" },
            to: { kind: "reserve", player: "opponent" },
            amount: 2,
          },
        },
      ],
      textRef: [0],
    },
  ],
};

function withBattleResolutionGroup(
  state: GameState,
  attackers: { entityId: string; leaderId: string; symbols: number }[],
  targetPlayerId: string
): GameState {
  const battleEntities: BattleEntity[] = attackers.map((attacker) => ({
    entityId: attacker.entityId,
    memberInstanceIds: [attacker.leaderId],
    resolvedBp: 5000,
    resolvedSymbols: Array.from({ length: attacker.symbols }, () => "green"),
    attackState: "attacking",
  }));
  const battleResolutionGroup: BattleResolutionGroup = {
    attackId: "bsge01-c17-attack",
    groupMode: "single",
    target: { kind: "player", playerId: targetPlayerId },
    symbolResolutionOrder: attackers.map((attacker) => attacker.entityId),
    participantSnapshots: attackers.map((attacker) => ({
      entityId: attacker.entityId,
      memberInstanceIds: [attacker.leaderId],
      resolvedBp: 5000,
      resolvedSymbols: Array.from({ length: attacker.symbols }, () => "green"),
      blockedBy: [],
    })),
  };
  return { ...state, battleEntities, battleResolutionGroup };
}

function withActiveAttackToPlayer(
  state: GameState,
  attackers: { entityId: string; leaderId: string; symbols: number }[],
  targetPlayerId: string
): GameState {
  const battleEntities: BattleEntity[] = attackers.map((attacker) => ({
    entityId: attacker.entityId,
    memberInstanceIds: [attacker.leaderId],
    resolvedBp: 5000,
    resolvedSymbols: Array.from({ length: attacker.symbols }, () => "green"),
    attackState: "attacking",
  }));
  const activeAttack: ActiveAttack = {
    attackId: "bsge01-c17-active-attack",
    primaryEntityId: attackers[0]?.entityId ?? "missing-attacker",
    participantEntityIds: attackers.map((attacker) => attacker.entityId),
    groupMode: attackers.length > 1 ? "simultaneous" : "single",
    target: { kind: "player", playerId: targetPlayerId },
    blockAssignments: attackers.map((attacker) => ({
      participantEntityId: attacker.entityId,
      blockedByEntityIds: [],
    })),
    symbolResolutionOrder: attackers.map((attacker) => attacker.entityId),
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: true,
    flashWindowState: null,
  };
  return {
    ...state,
    activeAttack,
    battleEntities,
    battleResolutionGroup: null,
  };
}

const BSGE_MAGIC_GROUP_TEST: CardDefinition = {
  cardNo: "BSGE01-MAGIC-GROUP-TEST",
  name: "BSGE01 magic group test",
  printedCategory: "magic",
  colors: ["green"],
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
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: "all",
          },
        },
        {
          action: { kind: "noop" },
          choice: [
            {
              action: {
                kind: "move_card",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "trash",
                  filter: { category: ["brave"] },
                  count: 1,
                },
                from: {
                  zone: "trash",
                  player: "self",
                  filter: { category: ["brave"] },
                },
                to: { zone: "hand" },
                count: 1,
              },
            },
          ],
          connector: "simultaneous",
        },
      ],
    },
  ],
};

const BSGE_MAGIC_TRASH_TARGET_TEST: CardDefinition = {
  cardNo: "BSGE01-MAGIC-TRASH-TARGET-TEST",
  name: "BSGE01 magic trash target test",
  printedCategory: "magic",
  colors: ["green"],
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
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            target: {
              kind: "filter",
              player: "self",
              zone: "trash",
              filter: { category: ["brave"] },
              count: 1,
            },
            from: {
              zone: "trash",
              player: "self",
              filter: { category: ["brave"] },
            },
            to: { zone: "hand" },
            count: 1,
          },
        },
      ],
    },
  ],
};

const BSGE_FIELD_GROUP_TEST: CardDefinition = {
  cardNo: "BSGE01-FIELD-GROUP-TEST",
  name: "BSGE01 field group test",
  printedCategory: "nexus",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: "all",
          },
        },
        {
          action: { kind: "noop" },
          choice: [
            {
              action: {
                kind: "move_card",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "trash",
                  filter: { category: ["brave"] },
                  count: 1,
                },
                from: {
                  zone: "trash",
                  player: "self",
                  filter: { category: ["brave"] },
                },
                to: { zone: "hand" },
                count: 1,
              },
            },
          ],
          connector: "simultaneous",
        },
      ],
    },
  ],
};

const BSGE_HAND_GROUP_TEST: CardDefinition = {
  cardNo: "BSGE01-HAND-GROUP-TEST",
  name: "BSGE01 hand group test",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: ["accelerator"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      applicability: { zone: "hand" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: "all",
          },
        },
        {
          action: { kind: "noop" },
          choice: [
            {
              action: {
                kind: "move_card",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "trash",
                  filter: { category: ["brave"] },
                  count: 1,
                },
                from: {
                  zone: "trash",
                  player: "self",
                  filter: { category: ["brave"] },
                },
                to: { zone: "hand" },
                count: 1,
              },
            },
          ],
          connector: "simultaneous",
        },
      ],
    },
  ],
};

const BSGE_BURST_VARIABLE_GROUP_TEST: CardDefinition = {
  cardNo: "BSGE01-BURST-VARIABLE-GROUP-TEST",
  name: "BSGE01 burst variable group test",
  printedCategory: "magic",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: ["burst", "can_set_as_burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: { kind: "life_decrease", player: "self" },
      },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: "all",
          },
        },
        {
          action: { kind: "noop" },
          choice: [
            {
              action: {
                kind: "move_card",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "trash",
                  filter: { category: ["brave"] },
                  count: { min: 0, max: 1 },
                },
                from: {
                  zone: "trash",
                  player: "self",
                  filter: { category: ["brave"] },
                },
                to: { zone: "hand" },
                count: 1,
              },
            },
          ],
          connector: "simultaneous",
        },
      ],
    },
  ],
};

const BSGE_BURST_MULTI_REGISTRATION_TEST: CardDefinition = {
  cardNo: "BSGE01-BURST-MULTI-REGISTRATION-TEST",
  name: "BSGE01 burst multi registration test",
  printedCategory: "magic",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: ["burst", "can_set_as_burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: { kind: "life_decrease", player: "self" },
      },
      ignoresOpponentCannotActivateBurst: true,
      steps: [
        {
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
    {
      timing: {
        kind: "burst",
        trigger: { kind: "life_decrease", player: "self" },
      },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["nexus"] },
              count: 1,
            },
          },
        },
      ],
    },
  ],
};

function burstCannotActivateSuppressor(): ContinuousEffect {
  return {
    effectId: "multi-burst-cannot-activate",
    sourceInstanceId: "bob-suppressor",
    sourceDefinitionId: "BSGE01-BURST-SUPPRESSOR-TEST",
    actingPlayerId: "bob",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "negate_opponent_burst",
    metadata: { burstSuppressKind: "cannot_activate" },
  };
}

const BSGE_BURST_ALL_PRUNED_TEST: CardDefinition = {
  cardNo: "BSGE01-BURST-ALL-PRUNED-TEST",
  name: "BSGE01 burst all pruned test",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: ["burst", "can_set_as_burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: {
          kind: "effect_activated",
          player: "opponent",
          activatedTimings: ["summon"],
        },
      },
      steps: [
        {
          condition: [{ kind: "combined" }],
          action: { kind: "draw", player: "self", count: 1 },
          choice: [
            {
              action: { kind: "draw", player: "self", count: 2 },
            },
          ],
        },
      ],
    },
  ],
};

const BSGE_WHITE_FLASH_MAGIC: CardDefinition = {
  cardNo: "BSGE01-NEGATE-WHITE-FLASH",
  name: "BSGE01 negate white flash",
  printedCategory: "magic",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["white"],
  textLines: ["フラッシュ：自分はデッキから1枚ドローする。"],
  keywordTags: [],
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

const BSGE_BLUE_FLASH_MAGIC: CardDefinition = {
  ...BSGE_WHITE_FLASH_MAGIC,
  cardNo: "BSGE01-NEGATE-BLUE-FLASH",
  name: "BSGE01 negate blue flash",
  colors: ["blue"],
  symbolColors: ["blue"],
};

const BSGE_WHITE_MAIN_MAGIC: CardDefinition = {
  ...BSGE_WHITE_FLASH_MAGIC,
  cardNo: "BSGE01-NEGATE-WHITE-MAIN",
  name: "BSGE01 negate white main",
  textLines: ["メイン：自分はデッキから1枚ドローする。"],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0],
    },
  ],
};

const BSGE_NEGATE_TEST_DEFINITIONS = [
  ...ALL_CARDS,
  BSGE_NEGATE_TEST_DECK_CARD,
  BSGE_TEST_SPIRIT,
  BSGE_TARGETED_RESPONSE_SPIRIT,
  BSGE_COUNT_COST_TEST,
  BSGE_TRIGGERED_GROUP_TEST,
  BSGE_C17_TARGET_SUMMON_DRAW,
  BSGE_C17_NO_TEXT_ATTACKER,
  BSGE_C17_EFFECT_DAMAGE_SOURCE,
  BSGE_C17_EFFECT_CORE_MOVE_SOURCE,
  BSGE_MAGIC_GROUP_TEST,
  BSGE_MAGIC_TRASH_TARGET_TEST,
  BSGE_FIELD_GROUP_TEST,
  BSGE_HAND_GROUP_TEST,
  BSGE_BURST_ALL_PRUNED_TEST,
  BSGE_BURST_VARIABLE_GROUP_TEST,
  BSGE_BURST_MULTI_REGISTRATION_TEST,
  BSGE_WHITE_FLASH_MAGIC,
  BSGE_BLUE_FLASH_MAGIC,
  BSGE_WHITE_MAIN_MAGIC,
];

function getBSGEDefinition(id: string): CardDefinition | undefined {
  return BSGE_NEGATE_TEST_DEFINITIONS.find(
    (definition) => definition.cardNo === id
  );
}

const getBSGEBurstActions = buildBurstEffectLookup(
  BSGE_NEGATE_TEST_DEFINITIONS
);

function buildBSGENegateStackState(options: {
  sourceCardNo: "BSGE01-C14" | "BSGE01-C15";
  targetDefinition: CardDefinition;
  targetTiming: "main" | "flash";
  activePlayerId?: "alice" | "bob";
  step?: GameState["step"];
  sourceZone?: "hand" | "in_use";
  withNestedSource?: boolean;
}): GameState {
  const sourceDefinition = card(options.sourceCardNo);
  const source = createCardInstance(sourceDefinition, {
    instanceId: "alice-negate-magic",
    ownerPlayerId: "alice",
    zone: options.sourceZone ?? "in_use",
  });
  const target = createCardInstance(options.targetDefinition, {
    instanceId: "bob-target-magic",
    ownerPlayerId: "bob",
    zone: "in_use",
  });
  const deckCard = createCardInstance(BSGE_NEGATE_TEST_DECK_CARD, {
    instanceId: "bob-deck-card",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  const targetStack: ActiveStack = {
    stackId: "stack:bob-target-magic",
    actionKind: "magic",
    chainId: "chain:bob-target-magic",
    actingPlayerId: "bob",
    cardInstanceId: target.instanceId,
    cardDefinitionId: options.targetDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: 0,
    totalReduction: 0,
    chosenTiming: options.targetTiming,
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const sourceStack: ActiveStack = {
    stackId: "stack:alice-negate-magic",
    actionKind: "magic",
    chainId: "chain:alice-negate-magic",
    actingPlayerId: "alice",
    cardInstanceId: source.instanceId,
    cardDefinitionId: sourceDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: 0,
    totalReduction: 0,
    chosenTiming: "stack",
    magicEffectIndex: 1,
    previousResponseSourcePlayerId: "bob",
    previousPendingStackAction: targetStack,
  };

  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target, deckCard],
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
    }),
    activePlayerId: options.activePlayerId ?? "alice",
    step: options.step ?? "attack",
    window: "stack",
    stackWindow: {
      priorityPlayerId: options.withNestedSource ? "bob" : "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "alice",
      subStackEverOpened: options.withNestedSource ?? false,
      burstWindowKind: null,
      pendingStackAction: options.withNestedSource ? sourceStack : targetStack,
    },
  };
}

function resolveBSGENestedNegate(options: {
  sourceCardNo: "BSGE01-C14" | "BSGE01-C15";
  targetDefinition: CardDefinition;
  targetTiming: "main" | "flash";
}): GameState {
  return applyLegalAction({
    state: buildBSGENegateStackState({
      ...options,
      withNestedSource: true,
    }),
    action: {
      kind: "pass_stack",
      actionId: "pass-stack",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
    },
    getCardDefinitionById: getBSGEDefinition,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
      BSGE_NEGATE_TEST_DEFINITIONS
    ),
    getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).state;
}

function getBSGENegateLegalActions(options: {
  sourceCardNo: "BSGE01-C14" | "BSGE01-C15";
  targetDefinition: CardDefinition;
  targetTiming: "main" | "flash";
  activePlayerId?: "alice" | "bob";
  step?: GameState["step"];
}) {
  return getLegalActions({
    state: buildBSGENegateStackState({
      ...options,
      sourceZone: "hand",
      withNestedSource: false,
    }),
    actingPlayerId: "alice",
    getCardDefinitionById: getBSGEDefinition,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
      BSGE_NEGATE_TEST_DEFINITIONS
    ),
    getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  });
}

function hasBSGENegateMagicAction(actions: ReturnType<typeof getLegalActions>) {
  return actions.some(
    (action) =>
      action.kind === "use_magic" &&
      action.sourceInstanceId === "alice-negate-magic" &&
      action.timing === "stack" &&
      action.effectIndex === 1
  );
}

describe("BSGE01-C01 ティアーストーン", () => {
  const c = card("BSGE01-C01");
  const magicLookup = buildMagicLookup([c]);
  const noTriggeredLookup = () => undefined;
  const noBurstLookup = () => undefined;
  it("ミラージュ【セット中】神喰カウント増減ドロー実装済み / メインでドロー2 or 契約カード回収(choice)", () => {
    expect(c.mirageData).toEqual({ cost: 2, reduction: ["red"] });
    expect(c.effects![0]!.stub).toBeUndefined();
    const main = c.effects![1]!;
    expect(main.condition).toContainEqual({
      kind: "field_lacks",
      player: "self",
      grandwalkerKind: "any",
    });
    expect(main.steps[0]!.action.kind).toBe("draw");
    expect(main.steps[0]!.choice![0]!.action.kind).toBe("search_zone");
  });

  // ENGINE-step-optional-zone-pick-pending-selection-NARROW (2026-06-21):
  // 契約カードがトラッシュに複数あるとき、search_zone はプレイヤー選択を
  // 求める pendingZoneSelection を発行する（旧 move_card 経路は engine 自動
  // 選択で 1 枚を返してプレイヤーに選ばせない問題があった）。
  it("trash に契約カードが2枚あるとき choice[0] は pendingZoneSelection を発行する", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-tearstone",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const contract1 = createCardInstance(card("BSGE01-CX01"), {
      instanceId: "alice-contract-1",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const contract2 = createCardInstance(card("BSGE01-CX02"), {
      instanceId: "alice-contract-2",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, contract1, contract2],
    });

    const after = executeEffect({
      chainId: "test:bsge01-cards:1260",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      // choiceIndex: 1 = choice[0] (search_zone), choiceIndex: 0 = default action (draw).
      choiceIndex: 1,
    });

    expect(after.pendingZoneSelection).not.toBeNull();
    expect(after.pendingZoneSelection!.actionKind).toBe("return_from_trash");
    expect(after.pendingZoneSelection!.actingPlayerId).toBe("alice");
    expect(after.pendingZoneSelection!.destination).toBe("hand");
    expect(after.pendingZoneSelection!.maxCount).toBe(1);
    expect(after.pendingZoneSelection!.candidateCardInstanceIds.sort()).toEqual(
      ["alice-contract-1", "alice-contract-2"].sort()
    );
    // 原文「契約カード1枚を手札に戻す」= 終止形=強制。canSkip:false を伝搬し、
    // 空選択 (0 枚) で確定できないことを assert。
    expect(after.pendingZoneSelection!.canSkip).toBe(false);

    // resolve-path: 空選択 (skip) は throw、有効選択 1 枚は alice の手札へ移動する。
    expect(() =>
      applyLegalAction({
        state: after,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: [],
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).toThrow(/cannot be skipped/);

    const resolved = applyLegalAction({
      state: after,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["alice-contract-1"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(
      resolved.cardInstances.find((x) => x.instanceId === "alice-contract-1")
        ?.zone
    ).toBe("hand");
    // 選ばれなかったカードはトラッシュに据え置く。
    expect(
      resolved.cardInstances.find((x) => x.instanceId === "alice-contract-2")
        ?.zone
    ).toBe("trash");
  });

  it("メイン使用は1回だけ宣言し、スタック窓後にドロー/契約回収を選ぶ", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-tearstone-main",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const contract = createCardInstance(card("BSGE01-CX01"), {
      instanceId: "alice-contract-main",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, contract],
        startingDeckCount: 10,
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "default",
    };
    const commonOptions = {
      getCardDefinitionById: (id: string) => cardNoMap.get(id),
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const declarations = getLegalActions({
      state: before,
      actingPlayerId: "alice",
      ...commonOptions,
    }).filter(
      (action): action is Extract<LegalAction, { kind: "use_magic" }> =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === source.instanceId &&
        action.timing === "main"
    );
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.choiceIndex).toBeUndefined();
    expect(declarations[0]).toMatchObject({
      deferredChoiceIndexes: [0, 1],
      targetMode: "none",
      requiredTargetCount: 0,
    });

    const declared = applyLegalAction({
      state: before,
      action: declarations[0]!,
      paymentSources: [{ kind: "reserve", amount: declarations[0]!.finalCost }],
      ...commonOptions,
    }).state;
    expect(declared.pendingStepChoice).toBeNull();
    expect(declared.stackWindow?.pendingStackAction).toMatchObject({
      actionKind: "magic",
      deferredChoiceIndexes: [0, 1],
    });

    const afterStack = passStackUntilClosed(
      declared,
      commonOptions.getCardDefinitionById,
      commonOptions
    );
    expect(afterStack.stackWindow).toBeNull();
    expect(afterStack.pendingStepChoice?.choices).toEqual([
      expect.objectContaining({ choiceIndex: 0 }),
      expect.objectContaining({ choiceIndex: 1 }),
    ]);

    const choiceAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...commonOptions,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_step_choice" }
      > =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(choiceAction).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterStack,
      action: choiceAction!,
      ...commonOptions,
    }).state;
    expect(afterChoice.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      candidateInstanceIds: [contract.instanceId],
      deferredStack: expect.objectContaining({ magicChoiceIndex: 1 }),
    });
    const resolved = resolvePendingEffectTarget(
      afterChoice,
      [contract.instanceId],
      commonOptions.getCardDefinitionById,
      commonOptions
    );
    expect(
      resolved.cardInstances.find(
        (instance) => instance.instanceId === contract.instanceId
      )?.zone
    ).toBe("hand");
  });
});

describe("BSGE01-C02 剛属性バックラー真", () => {
  const c = card("BSGE01-C02");
  it("フラッシュで重疲労 or GE回復(choice)", () => {
    const flash = c.effects![1]!;
    expect(flash.steps[0]!.action.kind).toBe("exhaust");
    expect(flash.steps[0]!.choice![0]!.action.kind).toBe("recover");
  });
});

describe("BSGE01-C03 ディソレイト", () => {
  const c = card("BSGE01-C03");
  it("BSGE01-C03 のリンクエイド書き換えは grant_link_aid_cost_override で実装済み・無 stub (bsge01-c03-linkaid-rewrite)", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.textRef).toEqual([4, 5]);
    expect(flash.stub).toBeUndefined();
    expect(flash.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "空木 レンカ" }],
        includeSoulState: true,
      },
    ]);
    expect(flash.steps[0]!.action).toEqual({
      kind: "grant_link_aid_cost_override",
      player: "self",
      duration: { scope: "turn" },
    });
  });
});

describe("BSGE01-C04 剛属性バックラー堅", () => {
  const c = card("BSGE01-C04");
  it("フラッシュでドロー3→破棄2", () => {
    const flash = c.effects![2]!;
    expect(flash.steps[0]!.action.kind).toBe("draw");
    expect(flash.steps[1]!.action.kind).toBe("discard");
  });
});

describe("BSGE01-C05〜C08 契約合体ブレイヴ", () => {
  const findSpiritStateEventCombineEffect = (c: CardDefinition) => {
    const effect = c.effects!.find(
      (e) =>
        e.textRef?.includes(3) &&
        e.steps.some((s) => s.action.kind === "brave_combine_effect")
    );
    if (!effect) {
      throw new Error(`${c.cardNo} spirit-state event combine effect missing`);
    }
    return effect;
  };

  it.each([
    ["BSGE01-C05", { player: "self", period: "turn" }, ["red", "purple"]],
    ["BSGE01-C06", { player: "both", period: "attack" }, ["blue", "green"]],
    ["BSGE01-C07", { player: "self", period: "turn" }, ["blue", "green"]],
    [
      "BSGE01-C08",
      { player: "both", period: "attack" },
      ["red", "purple", "yellow"],
    ],
  ] as const)(
    "%s: contractCombineData 配線（合体条件 GE&系統名にOを含まない＋合体先色）+ 残 stub + 合体中カウント効果",
    (no, timingScope, colors) => {
      const c = card(no);
      expect(c.contractCombineData).toEqual({
        braveCondition: {
          tribes: ["GE"],
          colors,
          excludeTribeSubstring: ["O"],
        },
        timingScope,
      });
      expect(c.allowMainStepBraveCombine).toBeUndefined();
      // P3-111 S5: スピリット状態パッシブは ruleStrength effect_resistance(exhaust)+prevent_battle で
      // 実装済み（stub なし）。「合体できる」は通常合体を消さず、追加タイミングだけを
      // 末尾の game_event 効果で event 主語へ固定する。
      const spiritStateEffect = c.effects![0]!;
      expect(spiritStateEffect.stub).toBeUndefined();
      expect(spiritStateEffect.timing.kind).toBe("continuous");
      expect(spiritStateEffect.applicability?.combined).toBe(false);
      const resistance = spiritStateEffect.steps[0]!.action;
      expect(resistance.kind).toBe("effect_resistance");
      if (resistance.kind === "effect_resistance") {
        expect(resistance.resistsOutcome).toBe("exhaust");
        expect(resistance.source).toBe("all");
        expect(resistance.ruleStrength).toBe(true);
      }
      const battleBan = spiritStateEffect.steps[1]!.action;
      expect(battleBan.kind).toBe("prevent_battle");
      if (battleBan.kind === "prevent_battle") {
        expect(battleBan.restriction).toEqual(["attack", "block"]);
        expect(battleBan.ruleStrength).toBe(true);
      }
      const combatEffect = c.effects!.find((e) =>
        e.condition?.some((cl) => cl.kind === "combined")
      );
      expect(combatEffect).toBeDefined();
      const eventCombine = findSpiritStateEventCombineEffect(c);
      expect(eventCombine.timing).toEqual({
        kind: "game_event",
        player: "self",
        event: ["summon", "soul_state_to_spirit_state"],
        triggerFilter: { category: ["spirit"] },
        exactEventKind: true,
      });
      expect(eventCombine.applicability?.combined).toBe(false);
      expect(eventCombine.executionMode).toBe("optional");
      expect(eventCombine.steps[0]!.action).toEqual({
        kind: "brave_combine_effect",
        target: { kind: "trigger_related_instance" },
      });
    }
  );

  it.each(["BSGE01-C05", "BSGE01-C06", "BSGE01-C07", "BSGE01-C08"])(
    "%s: スピリット状態 (未合体) のブレイヴは、通常 main brave_combine として出る",
    (no) => {
      const braveDef = card(no);
      const hostDef: CardDefinition = {
        cardNo: "TEST-C05C08-HOST",
        name: "TEST-C05C08-HOST",
        printedCategory: "spirit",
        colors: braveDef.contractCombineData!.braveCondition.colors!,
        cost: 3,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
        symbolColors: braveDef.contractCombineData!.braveCondition.colors!,
        textLines: [],
        keywordTags: [],
        tribe: "GE",
        sourceUrls: [],
        sourceConfidence: "C",
      };
      const lookup = (id: string) =>
        cardNoMap.get(id) ?? (id === hostDef.cardNo ? hostDef : undefined);
      const brave = createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      });
      const host = createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      });
      const state: GameState = {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "main",
        cardInstances: [brave, host],
      };
      const combine = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      }).find(
        (a): a is Extract<LegalAction, { kind: "brave_combine" }> =>
          a.kind === "brave_combine" &&
          a.braveInstanceId === "brave-1" &&
          a.targetInstanceId === "host-1"
      );
      expect(combine).toBeDefined();

      const combined = applyLegalAction({
        state,
        action: combine!,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(
        combined.cardInstances.find((c) => c.instanceId === "brave-1")
          ?.attachedToInstanceId
      ).toBe("host-1");
      expect(
        combined.cardInstances.find((c) => c.instanceId === "host-1")
          ?.attachedChildrenIds
      ).toContain("brave-1");
    }
  );

  it("BSGE01-C05: 召喚/スピリット状態化イベントの主語スピリットだけへ合体する", () => {
    const braveDef = card("BSGE01-C05");
    const hostDef: CardDefinition = {
      cardNo: "TEST-C05-EVENT-HOST",
      name: "TEST-C05-EVENT-HOST",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "GE",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const lookup = (id: string) =>
      cardNoMap.get(id) ?? (id === hostDef.cardNo ? hostDef : undefined);
    const brave = createCardInstance(braveDef, {
      instanceId: "event-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
    });
    const oldHost = createCardInstance(hostDef, {
      instanceId: "old-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const triggerHost = createCardInstance(hostDef, {
      instanceId: "trigger-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [brave, oldHost, triggerHost],
      }),
      activePlayerId: "alice",
      step: "main",
    };

    const after = executeEffect({
      chainId: "test:bsge01-cards:1659",
      state,
      sourceInstanceId: brave.instanceId,
      effect: findSpiritStateEventCombineEffect(braveDef),
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      triggerRelatedInstanceId: triggerHost.instanceId,
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === brave.instanceId)
        ?.attachedToInstanceId
    ).toBe(triggerHost.instanceId);
    expect(
      after.cardInstances.find((c) => c.instanceId === oldHost.instanceId)
        ?.attachedChildrenIds
    ).not.toContain(brave.instanceId);
  });

  it("BSGE01-C05: soul_state_to_spirit_state で textRef[3] 合体誘発が pending に積まれる", () => {
    const braveDef = card("BSGE01-C05");
    const hostDef: CardDefinition = {
      cardNo: "TEST-C05-LINK-AID-HOST",
      name: "TEST-C05-LINK-AID-HOST",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "GE",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const lookup = (id: string) =>
      cardNoMap.get(id) ?? (id === hostDef.cardNo ? hostDef : undefined);
    const brave = createCardInstance(braveDef, {
      instanceId: "listener-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
    });
    const eventCombineIndex = braveDef.effects!.indexOf(
      findSpiritStateEventCombineEffect(braveDef)
    );
    const host = createCardInstance(hostDef, {
      instanceId: "soul-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave, host],
      playerOverrides: [{ soulStateInstanceIds: [host.instanceId] }, {}],
    }) as GameState;
    const after = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave, host],
      playerOverrides: [{ soulStateInstanceIds: [] }, {}],
    }) as GameState;

    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "link-aid-chain",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        braveDef,
      ]),
      getRegisteredBurstActions: () => [],
      causedByPlayerId: "alice",
    });

    const pending = queued.pendingTriggeredEffects.find(
      (effect) =>
        effect.eventKind === "soul_state_to_spirit_state" &&
        effect.relatedInstanceId === host.instanceId
    );
    expect(pending).toMatchObject({
      eventKind: "soul_state_to_spirit_state",
      relatedInstanceId: host.instanceId,
    });
    expect(pending?.relatedInstanceIdsBySourceRegistrationKey).toEqual({
      [`${brave.instanceId}#${eventCombineIndex}`]: [host.instanceId],
    });
  });
});

describe("BSGE01-C05 契約合体アクション実行（P3-111 S2）", () => {
  const braveDef = card("BSGE01-C05");

  function makeHostSpirit(
    cardNo: string,
    tribe: string,
    colors: CardDefinition["colors"] = ["red"]
  ): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      colors,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: colors,
      textLines: [],
      keywordTags: [],
      tribe,
      sourceUrls: [],
      sourceConfidence: "C",
    };
  }

  function lookupFor(defs: CardDefinition[]) {
    const map = new Map(defs.map((d) => [d.cardNo, d]));
    return (id: string) => map.get(id);
  }

  function contractCombineActions(options: {
    hostTribe: string;
    activePlayerId?: "alice" | "bob";
    hasSoulCore?: boolean;
    restrictHandFlash?: boolean;
  }) {
    const hostDef = makeHostSpirit("TEST-CC-HOST", options.hostTribe);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [
        options.hasSoulCore === false
          ? {}
          : { soulCoreLocation: { kind: "reserve" } },
      ],
    });
    const restrictHandFlash: ContinuousEffect = {
      effectId: "ce:restrict-flash-hand:test",
      sourceInstanceId: "restrict-source",
      sourceDefinitionId: "TEST-RESTRICT",
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "restrict_flash_hand",
      targetInstanceId: "alice",
      metadata: { restrictedZones: ["hand"] },
    };
    const actions = getLegalActions({
      state: {
        ...state,
        step: "main",
        activePlayerId: options.activePlayerId ?? "alice",
        ...(options.restrictHandFlash
          ? {
              activeContinuousEffects: [
                ...state.activeContinuousEffects,
                restrictHandFlash,
              ],
            }
          : {}),
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookupFor([braveDef, hostDef]),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    return actions.filter((a) => a.kind === "contract_combine");
  }

  it("合体条件 (GE、Oを含まない) を満たすホスト + 自分のターン + ソウルコアありで起動できる", () => {
    const actions = contractCombineActions({ hostTribe: "GE" });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      braveInstanceId: "brave-1",
      candidateTargetInstanceIds: ["host-1"],
    });
  });

  it("系統名に「O」を含むホストは合体条件を満たさない (excludeTribeSubstring)", () => {
    // tribes:["GE"] の完全一致自体は満たした上で excludeTribeSubstring 単独の不成立を
    // 検証する。単一トークン "GEO" だと tribes 完全一致自体が先に false になり、
    // excludeTribeSubstring を経由せず偽陽性で緑になる (adversarial verifier round2 refute)。
    expect(contractCombineActions({ hostTribe: "GE・GEO" })).toHaveLength(0);
  });

  it("GE を持たないホストは合体条件を満たさない", () => {
    expect(contractCombineActions({ hostTribe: "神喰" })).toHaveLength(0);
  });

  it("timingScope『自分のターン』外 (相手のターン) では起動できない", () => {
    expect(
      contractCombineActions({ hostTribe: "GE", activePlayerId: "bob" })
    ).toHaveLength(0);
  });

  it("ソウルコアが無ければ起動できない", () => {
    expect(
      contractCombineActions({ hostTribe: "GE", hasSoulCore: false })
    ).toHaveLength(0);
  });

  it("restrict_flash (手札) CE 下では契約合体（フラッシュ起動効果）を起動できない", () => {
    expect(
      contractCombineActions({ hostTribe: "GE", restrictHandFlash: true })
    ).toHaveLength(0);
  });

  it("合体条件の色判定は実効色 (treat_as_color) を見る。印字色のみでは満たさない host も対象になる (adversarial verifier round3 refute)", () => {
    // getAvailableContractCombineLegalActions が定義専用の matchesBraveCondition (印字値の
    // みを見る) ではなく matchesBraveConditionForCard (実効値 SSOT。brave_combine 側と同一)
    // を経由することを固定する。host は印字色「黄」のみ (C05 の braveCondition.colors=
    // ["red","purple"] を印字では満たさない) だが、treat_as_color CE で赤として扱われる。
    const hostDef = makeHostSpirit("TEST-CC-HOST-EFFCOLOR", "GE", ["yellow"]);
    const treatAsRedCe: ContinuousEffect = {
      effectId: "ce-treat-as-red-host",
      sourceInstanceId: "host-effcolor-1",
      sourceDefinitionId: hostDef.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "treat_as_color",
      targetInstanceId: "host-effcolor-1",
      modifierSymbol: ["red"],
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-effcolor-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-effcolor-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const actions = getLegalActions({
      state: {
        ...state,
        step: "main",
        activePlayerId: "alice",
        activeContinuousEffects: [
          ...state.activeContinuousEffects,
          treatAsRedCe,
        ],
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookupFor([braveDef, hostDef]),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const cc = actions.filter((a) => a.kind === "contract_combine");
    expect(cc).toHaveLength(1);
    expect(cc[0]).toMatchObject({
      braveInstanceId: "brave-effcolor-1",
      candidateTargetInstanceIds: ["host-effcolor-1"],
    });
  });

  it("BSGE01-C06『お互いのアタックステップ』はバトルフラッシュ窓 (activeAttack.flashWindowState) 中でも起動できる", () => {
    const bothAttackBraveDef = card("BSGE01-C06");
    const hostDef = makeHostSpirit("TEST-CC-HOST-FLASH", "GE", ["blue"]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(bothAttackBraveDef, {
          instanceId: "brave-flash-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-flash-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
      activeAttack: {
        attackId: "test-attack",
        primaryEntityId: "be-test",
        participantEntityIds: ["be-test"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
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
    });
    const actions = getLegalActions({
      state: {
        ...state,
        step: "attack",
        window: "flash_before_block",
        activePlayerId: "bob",
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookupFor([bothAttackBraveDef, hostDef]),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const cc = actions.filter((a) => a.kind === "contract_combine");
    expect(cc).toHaveLength(1);
    expect(cc[0]).toMatchObject({
      braveInstanceId: "brave-flash-1",
      candidateTargetInstanceIds: ["host-flash-1"],
    });
  });

  it("before_block フラッシュが閉じたブロック宣言待ちでは契約合体を列挙しない", () => {
    const bothAttackBraveDef = card("BSGE01-C08");
    const hostDef = card("BSGE01-R01");
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(bothAttackBraveDef, {
          instanceId: "brave-after-flash-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-after-flash-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
      activeAttack: {
        attackId: "test-attack-after-flash",
        primaryEntityId: "be-test-after-flash",
        participantEntityIds: ["be-test-after-flash"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [
          {
            participantEntityId: "be-test-after-flash",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["be-test-after-flash"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    });

    const actions = getLegalActions({
      state: {
        ...state,
        step: "attack",
        window: "declare_attack",
        activePlayerId: "bob",
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookupFor([bothAttackBraveDef, hostDef]),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });

    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      0
    );
    expect(actions.some((a) => a.kind === "decline_block")).toBe(true);
  });

  it("適用: 手札のブレイヴが合体状態で場に出て、ソウルコアがトラッシュへ、旧ブレイヴは破棄される", () => {
    const hostDef = makeHostSpirit("TEST-CC-HOST", "GE");
    const oldBraveDef: CardDefinition = {
      cardNo: "TEST-OLD-BRAVE",
      name: "old brave",
      printedCategory: "brave",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedChildrenIds: ["old-brave-1"],
        }),
        createCardInstance(oldBraveDef, {
          instanceId: "old-brave-1",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "brave",
          attachedToInstanceId: "host-1",
          cores: 2,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const lookup = lookupFor([braveDef, hostDef, oldBraveDef]);
    const result = applyLegalAction({
      state: { ...state, step: "main", activePlayerId: "alice" },
      action: {
        kind: "contract_combine",
        actionId: "test:contract-combine",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        braveInstanceId: "brave-1",
        braveCardNo: braveDef.cardNo,
        candidateTargetInstanceIds: ["host-1"],
        targetMode: "manual",
        requiredTargetCount: 1,
        targetInstanceId: "host-1",
        targetCardNo: hostDef.cardNo,
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    // P3-112: 発揮宣言はスタック窓を開くのみ。相手のパスで窓を閉じ deferred 解決へ進める。
    const newState = passStackAndResolveTarget(
      result.state,
      ["host-1"],
      lookup,
      {
        getRegisteredTriggeredEffectActions: () => undefined,
      }
    );
    const brave = newState.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(brave.zone).toBe("field");
    expect(brave.zoneRoleName).toBe("brave");
    expect(brave.attachedToInstanceId).toBe("host-1");
    expect(
      newState.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .filter((result) => result.instanceId === "brave-1")
    ).toEqual([
      expect.objectContaining({ actionLabel: "contract_combine", to: "field" }),
    ]);

    const host = newState.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.attachedChildrenIds).toEqual(["brave-1"]);

    const oldBrave = newState.cardInstances.find(
      (c) => c.instanceId === "old-brave-1"
    )!;
    expect(oldBrave.zone).toBe("trash");
    expect(oldBrave.attachedToInstanceId).toBeNull();
    // 破棄されたブレイヴのコアはリザーブへ (resolveCardLeavesFieldCores、共通プリミティブ)。
    expect(oldBrave.normalCoreCount).toBe(0);

    const alice = newState.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("不発: 窓中に合体先ホストが場を離れたら、パス後もソウルコア未消費・ブレイヴは手札のまま (P3-112 fizzle)", () => {
    const hostDef = makeHostSpirit("TEST-CC-HOST-FIZZLE", "GE");
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-fizzle-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-fizzle-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const lookup = lookupFor([braveDef, hostDef]);
    const declared = applyLegalAction({
      state: { ...state, step: "main", activePlayerId: "alice" },
      action: {
        kind: "contract_combine",
        actionId: "test:contract-combine-fizzle",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        braveInstanceId: "brave-fizzle-1",
        braveCardNo: braveDef.cardNo,
        candidateTargetInstanceIds: ["host-fizzle-1"],
        targetMode: "manual",
        requiredTargetCount: 1,
        targetInstanceId: "host-fizzle-1",
        targetCardNo: hostDef.cardNo,
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    expect(declared.stackWindow).not.toBeNull();

    // 窓中に合体先ホストが場を離れる (相手効果でトラッシュへ、を模擬)。
    const hostLeftField: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "host-fizzle-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const passAction = getLegalActions({
      state: hostLeftField,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();
    const resolved = applyLegalAction({
      state: hostLeftField,
      action: passAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    // 不発: ブレイヴは手札のまま、ソウルコアは消費されない。
    const brave = resolved.cardInstances.find(
      (c) => c.instanceId === "brave-fizzle-1"
    )!;
    expect(brave.zone).toBe("hand");
    expect(brave.attachedToInstanceId).toBeNull();
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(resolved.log.some((l) => l.includes("[ContractCombine]"))).toBe(
      true
    );
  });

  it("誘発配線: 契約合体で場入りしたブレイヴの『召喚/契約合体時』は契約合体時として pendingTriggeredEffects へ積まれる", () => {
    // contract_combine は手札→field+attach。召喚ではないため summon は出さず、
    // brave_combined cause:"contract_combine" で『契約合体時』側を拾う。
    const hostDef = makeHostSpirit("TEST-CC-HOST-TRIG", "GE");
    const contractCombineBraveDef: CardDefinition = {
      cardNo: "TEST-CC-CONTRACT-BRAVE",
      name: "契約合体時ブレイヴ",
      printedCategory: "brave",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
      textLines: [
        "『このブレイヴの召喚/契約合体時』",
        "ボイドからコア1個をリザーブに置く。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      contractCombineData: {
        braveCondition: {
          tribes: ["GE"],
          colors: ["red", "purple"],
          excludeTribeSubstring: ["O"],
        },
        timingScope: { player: "self", period: "turn" },
      },
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "reserve", player: "self" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(contractCombineBraveDef, {
          instanceId: "brave-trig-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-trig-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const lookup = lookupFor([contractCombineBraveDef, hostDef]);
    const result = applyLegalAction({
      state: { ...state, step: "main", activePlayerId: "alice" },
      action: {
        kind: "contract_combine",
        actionId: "test:cc-trigger",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        braveInstanceId: "brave-trig-1",
        braveCardNo: contractCombineBraveDef.cardNo,
        candidateTargetInstanceIds: ["host-trig-1"],
        targetMode: "manual",
        requiredTargetCount: 1,
        targetInstanceId: "host-trig-1",
        targetCardNo: hostDef.cardNo,
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        contractCombineBraveDef,
        hostDef,
      ]),
    });
    const newState = passStackAndResolveTarget(
      result.state,
      ["host-trig-1"],
      lookup,
      {
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          contractCombineBraveDef,
          hostDef,
        ]),
      }
    );
    // 配線欠落なら 0 件 (dead)。差分検出で契約合体時誘発が積まれることを固定する。
    const pendings = newState.pendingTriggeredEffects.filter(
      (p) => p.relatedInstanceId === "brave-trig-1"
    );
    expect(pendings.length).toBeGreaterThan(0);
    expect(pendings.some((p) => p.eventKind === "summon")).toBe(false);
    expect(
      pendings.some(
        (p) =>
          p.eventKind === "brave_combined" && p.cause === "contract_combine"
      )
    ).toBe(true);
  });

  it("誘発配線: 契約合体で破棄された旧ブレイヴの『破壊されたとき』誘発が pendingTriggeredEffects へ積まれる", () => {
    // 残留懸念 (P3-111 S2): 旧ブレイヴの破棄が raw moveCardZone だと pendingLeaveEntities が
    // 生成されず「破壊された/離れたとき」誘発が dead になる。queuePendingLeave→flush 経由に
    // したことで destroy イベントが検出されることを固定する。
    const hostDef = makeHostSpirit("TEST-CC-HOST-OLDTRIG", "GE");
    const oldBraveDef: CardDefinition = {
      cardNo: "TEST-OLD-BRAVE-TRIG",
      name: "old brave with destroy trigger",
      printedCategory: "brave",
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
          timing: { kind: "card_event", event: "destroy" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "reserve", player: "self" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-oldtrig-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-oldtrig-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedChildrenIds: ["old-brave-trig-1"],
        }),
        createCardInstance(oldBraveDef, {
          instanceId: "old-brave-trig-1",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "brave",
          attachedToInstanceId: "host-oldtrig-1",
          cores: 1,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const lookup = lookupFor([braveDef, hostDef, oldBraveDef]);
    const result = applyLegalAction({
      state: { ...state, step: "main", activePlayerId: "alice" },
      action: {
        kind: "contract_combine",
        actionId: "test:cc-old-brave-trigger",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        braveInstanceId: "brave-oldtrig-1",
        braveCardNo: braveDef.cardNo,
        candidateTargetInstanceIds: ["host-oldtrig-1"],
        targetMode: "manual",
        requiredTargetCount: 1,
        targetInstanceId: "host-oldtrig-1",
        targetCardNo: hostDef.cardNo,
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        braveDef,
        hostDef,
        oldBraveDef,
      ]),
    });
    const newState = passStackAndResolveTarget(
      result.state,
      ["host-oldtrig-1"],
      lookup,
      {
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          braveDef,
          hostDef,
          oldBraveDef,
        ]),
      }
    );

    const oldBrave = newState.cardInstances.find(
      (c) => c.instanceId === "old-brave-trig-1"
    )!;
    expect(oldBrave.zone).toBe("field");
    expect(oldBrave.pendingLeaveKind).toBe("destroy");

    // 配線欠落なら 0 件 (dead)。pendingLeave 経由の差分検出で破壊時誘発が積まれることを固定する。
    const pendings = newState.pendingTriggeredEffects.filter(
      (p) => p.relatedInstanceId === "old-brave-trig-1"
    );
    expect(pendings.length).toBeGreaterThan(0);
    expect(pendings.some((p) => p.eventKind === "destroy")).toBe(true);
  });

  it("合体条件 (top-level braveCondition) 喪失で contract_combine 済みブレイヴが SBA により強制分離される（10_rules/05:30）", () => {
    // 【合体条件：GE＆系統名に「O」を含まない】([8]) は【契約合体：GE＆赤/紫】ヘッダー([0])とは
    // 別の、継続的にチェックされる標準の合体条件キーワード。host の系統が「O」を含むよう
    // 変化したら、既存 SSOT (state-based-actions.ts の brave_forced_separation) が
    // top-level CardDefinition.braveCondition を見て即分離するはず。
    // tribes:["GE"] の完全一致自体は満たした上で excludeTribeSubstring 単独の不成立を検証する
    // (単一トークン "GEO" だと tribes 完全一致が先に false になり偽陽性で緑になる。
    // adversarial verifier round2 refute)。
    const hostDef = makeHostSpirit("TEST-CC-HOST-CONDLOST", "GE・GEO");
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "host-condlost-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedChildrenIds: ["brave-condlost-1"],
        }),
        createCardInstance(braveDef, {
          instanceId: "brave-condlost-1",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "brave",
          attachedToInstanceId: "host-condlost-1",
          // 追加コアを置かない選択後も、分離状態を維持できる。
          cores: 1,
        }),
      ],
    });
    const result = runStateBasedActions(state, lookupFor([braveDef, hostDef]));
    result.state = chooseRuleBraveCores(
      result.state,
      lookupFor([braveDef, hostDef]),
      "brave-condlost-1"
    );

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_forced_separation" &&
          check.instanceId === "brave-condlost-1"
      )
    ).toBe(true);
    const brave = result.state.cardInstances.find(
      (c) => c.instanceId === "brave-condlost-1"
    )!;
    expect(brave.attachedToInstanceId).toBeNull();
    const host = result.state.cardInstances.find(
      (c) => c.instanceId === "host-condlost-1"
    )!;
    expect(host.attachedChildrenIds).toEqual([]);
  });

  it("合体条件を満たす host (GE のみ、Oを含まない) では contract_combine 済みブレイヴは分離されない", () => {
    const hostDef = makeHostSpirit("TEST-CC-HOST-CONDOK", "GE");
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "host-condok-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedChildrenIds: ["brave-condok-1"],
        }),
        createCardInstance(braveDef, {
          instanceId: "brave-condok-1",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "brave",
          attachedToInstanceId: "host-condok-1",
        }),
      ],
    });
    const result = runStateBasedActions(state, lookupFor([braveDef, hostDef]));

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_forced_separation" &&
          check.instanceId === "brave-condok-1"
      )
    ).toBe(false);
    expect(
      result.state.cardInstances.find((c) => c.instanceId === "brave-condok-1")!
        .attachedToInstanceId
    ).toBe("host-condok-1");
  });
});

describe("BSGE01-C05 バリアシオンナイフ", () => {
  const c = card("BSGE01-C05");

  it("BSGE01-C05 の召喚/契約合体時『破棄することで3枚ドロー』は任意効果にする (契約合体側は登録生成で brave_combined へ展開)", () => {
    const summon = c.effects![1]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.executionMode).toBe("optional");
    expect(summon.steps[0]!.action).toEqual({
      kind: "discard",
      count: 1,
      player: "self",
    });
    expect(summon.steps[1]!.connector).toBe("conditional_cost");
    expect(summon.steps[1]!.action).toEqual({ kind: "draw", count: 3 });
  });
});

describe("BSGE01-C07 イーヴィルワン — 提示契約カード色分岐", () => {
  const c = card("BSGE01-C07");
  const nonGreenEffect = c.effects![1]!;
  const greenEffect = c.effects![2]!;

  it("提示契約色が緑以外: デッキ3ドロー→手札1破棄(optional) / 緑: ボイド2→リザーブ(強制) の2 effect に分離", () => {
    expect(nonGreenEffect.timing).toEqual({
      kind: "card_event",
      event: "summon",
    });
    expect(nonGreenEffect.condition).toEqual([
      {
        kind: "presented_contract_color",
        player: "self",
        color: "green",
        negate: true,
      },
    ]);
    expect(nonGreenEffect.executionMode).toBe("optional");
    expect(nonGreenEffect.steps[0]!.action).toEqual({
      kind: "draw",
      count: 3,
    });
    expect(nonGreenEffect.steps[1]!.action).toEqual({
      kind: "discard",
      count: 1,
      player: "self",
    });
    expect(nonGreenEffect.stub).toBeUndefined();

    expect(greenEffect.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(greenEffect.condition).toEqual([
      { kind: "presented_contract_color", player: "self", color: "green" },
    ]);
    expect(greenEffect.executionMode).toBeUndefined();
    expect(greenEffect.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "reserve", player: "self" },
      amount: 2,
    });
    expect(greenEffect.stub).toBeUndefined();
  });

  it("[board] 提示契約色が緑: ボイド2個をリザーブに置く", () => {
    const source = createCardInstance(c, {
      instanceId: "evil-one-green",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      playerOverrides: [
        {
          contractCardNo: "BSGE01-CX02", // 霊代 アキ = green
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 4,
        },
      ],
    });
    const after = executeEffect({
      chainId: "test:bsge01-cards:2622",
      state: before,
      effect: greenEffect,
      sourceInstanceId: "evil-one-green",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.voidNormalCoreCount).toBe(2);
  });

  it("[board] 提示契約色が緑以外なら緑分岐 effect は condition 不成立で no-op", () => {
    const source = createCardInstance(c, {
      instanceId: "evil-one-red",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      playerOverrides: [
        {
          contractCardNo: "BSGE01-CX01", // 神薙 ユウ = red
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 4,
        },
      ],
    });
    const after = executeEffect({
      chainId: "test:bsge01-cards:2652",
      state: before,
      effect: greenEffect,
      sourceInstanceId: "evil-one-red",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(4);
    expect(after.log).toContain("effect:condition-unmet:evil-one-red");
  });

  it("[board] 提示契約色が緑以外(negate:true 分岐): デッキ3ドロー実行→手札破棄の選択待ちが開く", () => {
    const source = createCardInstance(c, {
      instanceId: "evil-one-nongreen",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const hand1 = createCardInstance(card("BSGE01-C01"), {
      instanceId: "hand-nongreen-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const deckCards = [
      "deck-nongreen-1",
      "deck-nongreen-2",
      "deck-nongreen-3",
    ].map((instanceId) =>
      createCardInstance(card("BSGE01-C01"), {
        instanceId,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, hand1, ...deckCards],
      playerOverrides: [
        {
          contractCardNo: "BSGE01-CX01", // 神薙 ユウ = red (緑以外)
          handCount: 1,
          deckCount: 3,
        },
      ],
    });
    const after = executeEffect({
      chainId: "test:bsge01-cards:2699",
      state: before,
      effect: nonGreenEffect,
      sourceInstanceId: "evil-one-nongreen",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    // negate:true (緑以外) 分岐が成立 → draw 3 が実行され、手札4枚(既存1+ドロー3)から
    // 1枚破棄の選択待ちが開く (破棄候補 > count のため pendingZoneSelection)。
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.deckCount).toBe(0);
    expect(after.pendingZoneSelection?.actionKind).toBe("discard_hand");
    expect(after.pendingZoneSelection?.maxCount).toBe(1);
    expect(after.pendingZoneSelection?.candidateCardInstanceIds).toHaveLength(
      4
    );
  });

  it("[board] 契約カード未提示(contractCardNo=null): 緑以外分岐として扱われ実行される / 緑分岐は不成立", () => {
    const sourceA = createCardInstance(c, {
      instanceId: "evil-one-noncontract-a",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [sourceA],
      playerOverrides: [
        {
          contractCardNo: null,
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 4,
        },
      ],
    });
    const greenAttempt = executeEffect({
      chainId: "test:bsge01-cards:2735",
      state: before,
      effect: greenEffect,
      sourceInstanceId: "evil-one-noncontract-a",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const aliceAfterGreenAttempt = greenAttempt.players.find(
      (p) => p.id === "alice"
    )!;
    expect(aliceAfterGreenAttempt.reserveNormalCoreCount).toBe(0);
    expect(aliceAfterGreenAttempt.voidNormalCoreCount).toBe(4);
    expect(greenAttempt.log).toContain(
      "effect:condition-unmet:evil-one-noncontract-a"
    );

    const nonGreenAttempt = executeEffect({
      chainId: "test:bsge01-cards:2752",
      state: before,
      effect: nonGreenEffect,
      sourceInstanceId: "evil-one-noncontract-a",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(nonGreenAttempt.log).not.toContain(
      "effect:condition-unmet:evil-one-noncontract-a"
    );
  });
});

describe("BSGE01-C06 ステラスウォーム — 合体中契約合体/アタック時", () => {
  const c = card("BSGE01-C06");
  const combineEffects = c.effects!.filter((e) =>
    e.condition?.some((cl) => cl.kind === "combined")
  );
  // P3-111 S3: 「契約合体時」と「アタック時」は cause:["contract_combine"] の有無で
  // 区別する別 effect に分離済み (旧 event:['brave_combined','attack'] 単一 effect の近似から昇格)。
  const contractCombineEffect = combineEffects.find(
    (e) => e.timing.kind === "card_event" && e.timing.event === "brave_combined"
  )!;
  const attackEffect = combineEffects.find(
    (e) => e.timing.kind === "card_event" && e.timing.event === "attack"
  )!;

  it("trigger は brave_combined(cause:契約合体限定) と attack の2 effect に分離", () => {
    expect(combineEffects).toHaveLength(2);
    expect(contractCombineEffect.timing).toEqual({
      kind: "card_event",
      event: "brave_combined",
      cause: ["contract_combine"],
    });
    expect(attackEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
  });

  it.each([
    ["契約合体時", () => contractCombineEffect],
    ["アタック時", () => attackEffect],
  ])(
    "%s effect は『ことで』構文で任意 (executionMode='optional')",
    (_, get) => {
      expect(get().executionMode).toBe("optional");
    }
  );

  it.each([
    ["契約合体時", () => contractCombineEffect],
    ["アタック時", () => attackEffect],
  ])(
    "%s step0: コスト count_decrease(2) (conditional_cost gate の支払い側)",
    (_, get) => {
      const combat = get();
      expect(combat.steps[0]!.action).toEqual({
        kind: "count_decrease",
        player: "self",
        amount: 2,
      });
      expect(combat.steps[0]!.connector).toBeUndefined();
    }
  );

  it.each([
    ["契約合体時", () => contractCombineEffect],
    ["アタック時", () => attackEffect],
  ])(
    "%s step1: 相手スピリット/アルティメット 0..2 体 heavy_exhaust (conditional_cost 連結)",
    (_, get) => {
      const step = get().steps[1]!;
      expect(step.connector).toBe("conditional_cost");
      const action = step.action as {
        kind: string;
        target: {
          kind: string;
          player: string;
          filter: { category: string[] };
          count: { min: number; max: number };
        };
        degree?: string;
      };
      expect(action.kind).toBe("exhaust");
      expect(action.degree).toBe("heavy_exhaust");
      expect(action.target.player).toBe("opponent");
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.count).toEqual({ min: 0, max: 2 });
    }
  );

  it.each([
    ["契約合体時", () => contractCombineEffect],
    ["アタック時", () => attackEffect],
  ])(
    "%s step2: 疲労状態相手1体を send_to_deck(bottom) optional (その後)",
    (_, get) => {
      const step = get().steps[2]!;
      expect(step.executionMode).toBe("optional");
      expect(step.connector).toBe("sequential");
      const action = step.action as {
        kind: string;
        target: {
          player: string;
          filter: { category: string[]; exhaustState: string };
          count: number;
        };
        position?: string;
      };
      expect(action.kind).toBe("send_to_deck");
      expect(action.position).toBe("bottom");
      expect(action.target.player).toBe("opponent");
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.filter.exhaustState).toBe("exhausted");
      expect(action.target.count).toBe(1);
    }
  );
});

describe("count_decrease conditional cost gate", () => {
  function getCountCostBattleImmediateActions(countValue: number) {
    const lookup = buildBattleImmediateEffectLookup([
      BSGE_COUNT_COST_TEST,
      BSGE_TEST_SPIRIT,
    ]);
    const registrations = lookup(BSGE_COUNT_COST_TEST.cardNo) ?? [];
    const registrationIndex = registrations.findIndex(
      (reg) => reg.timing === "attack"
    );
    const attackReg = registrations[registrationIndex];
    expect(attackReg).toBeDefined();

    const source = createCardInstance(BSGE_COUNT_COST_TEST, {
      instanceId: "alice-count-cost",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const target = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
        playerOverrides: [{ countValue }, { countValue: 0 }],
        battleImmediateEffects: [
          {
            promptId: "bi-bsge01-count-cost",
            attackId: "attack-bsge01-count-cost",
            timing: "attack" as const,
            sourceKind: attackReg!.sourceKind,
            sourceInstanceId: source.instanceId,
            sourceDefinitionId: BSGE_COUNT_COST_TEST.cardNo,
            sourceCardNo: BSGE_COUNT_COST_TEST.cardNo,
            actingPlayerId: "alice",
            participantEntityId: "battle-entity:alice-count-cost",
            registrationIndex,
          },
        ],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "declare_attack" as const,
      turnNumber: 2,
    };

    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: lookup,
    }).filter(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceCardNo === BSGE_COUNT_COST_TEST.cardNo
    );
  }

  it("battle immediate registration に count_decrease cost を伝搬する", () => {
    const lookup = buildBattleImmediateEffectLookup([BSGE_COUNT_COST_TEST]);
    const attackReg = lookup(BSGE_COUNT_COST_TEST.cardNo)?.find(
      (reg) => reg.timing === "attack"
    );
    expect(attackReg).toBeDefined();
    expect(attackReg!.requiredTargetCount).toBe(0);
    expect(attackReg!.maxTargetCount).toBe(2);
    expect(attackReg!.requiredCountCostAmount).toBe(2);
    expect(attackReg!.requiredCountCostPlayer).toBe("self");
  });

  it("カウント不足なら通常発揮 action を列挙しない", () => {
    const actions = getCountCostBattleImmediateActions(1);
    expect(actions.filter((action) => !action.skipOnly)).toEqual([]);
  });

  it("カウント2以上なら count cost 付きで列挙する", () => {
    const actions = getCountCostBattleImmediateActions(2);
    const action = actions.find((candidate) => !candidate.skipOnly);
    expect(action).toMatchObject({
      requiredCountCostAmount: 2,
      requiredCountCostPlayer: "self",
      requiredTargetCount: 0,
      maxTargetCount: 2,
      candidateTargetInstanceIds: ["bob-target"],
    });
  });
});

describe("BSGE01-C08 モウスィブロウ", () => {
  const c = card("BSGE01-C08");
  // effects[0]=継続 stub, [1]=brave_combined(cause:契約合体限定, P3-111 S3), [2]=attack。
  const contractCombineEffect = c.effects![1]!;
  const effect = c.effects![2]!;

  it("brave_combined effect は cause:['contract_combine'] 限定・attack effect と同一 steps 構造", () => {
    expect(contractCombineEffect.timing).toEqual({
      kind: "card_event",
      event: "brave_combined",
      cause: ["contract_combine"],
    });
    expect(contractCombineEffect.condition).toEqual([{ kind: "combined" }]);
    expect(contractCombineEffect.executionMode).toBe("optional");
    expect(contractCombineEffect.steps).toEqual(effect.steps);
  });

  it("[flash priority] 契約合体後のC08誘発解決では直前のフラッシュ本体優先権へ戻る", () => {
    const {
      afterCombine,
      afterTriggerStack,
      handBrave,
      attacker,
      secondaryTarget,
      untouchedTarget,
      lookup,
      triggeredLookup,
    } = setupC08ContractCombineTrigger(3);

    expect(afterCombine.activeAttack?.flashWindowState).toMatchObject({
      priorityPlayerId: "alice",
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
    });
    expect(
      afterCombine.pendingTriggeredEffects.some(
        (pending) =>
          pending.relatedInstanceId === handBrave.instanceId &&
          pending.eventKind === "brave_combined" &&
          pending.cause === "contract_combine"
      )
    ).toBe(true);

    const repeatChoice = getLegalActions({
      state: afterTriggerStack,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "resolve_pending_effect_optional_repeat_choice" &&
        action.choiceIndex === 1
    );
    expect(repeatChoice).toBeDefined();

    const afterRepeatChoice = applyLegalAction({
      state: afterTriggerStack,
      action: repeatChoice!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const countAction = getLegalActions({
      state: afterRepeatChoice,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) => action.kind === "resolve_pending_effect_optional_repeat_count"
    );
    expect(countAction).toBeDefined();

    const afterCount = applyLegalAction({
      state: afterRepeatChoice,
      action: countAction!,
      countDecreaseSelection: 2,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(afterCount.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });

    const targetAction = getLegalActions({
      state: afterCount,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    const afterBase = applyLegalAction({
      state: afterCount,
      action: targetAction!,
      targetInstanceIds: [attacker.instanceId],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(afterBase.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    const afterFirstRepeat = resolvePendingStepOptionalTarget(
      afterBase,
      [attacker.instanceId],
      lookup,
      { getRegisteredTriggeredEffectActions: triggeredLookup }
    );
    expect(afterFirstRepeat.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    const afterTarget = resolvePendingStepOptionalTarget(
      afterFirstRepeat,
      [secondaryTarget.instanceId],
      lookup,
      { getRegisteredTriggeredEffectActions: triggeredLookup }
    );

    expect(afterTarget.activeAttack?.flashWindowState).toMatchObject({
      priorityPlayerId: "alice",
      stackResponseSourcePlayerId: "alice",
      consecutivePassCount: 0,
      pendingStackAction: null,
    });
    expect(afterTarget.window).toBe("flash_before_block");
    expect(
      afterTarget.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === attacker.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      afterTarget.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === secondaryTarget.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      afterTarget.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === untouchedTarget.instanceId
      )?.zone
    ).toBe("field");
    expect(
      afterTarget.players.find((player) => player.id === "bob")?.countValue
    ).toBe(0);
    expect(
      afterTarget.log.filter((line) =>
        line.startsWith("effect:repeat-activation:")
      )
    ).toHaveLength(2);
  });

  it.each([
    { initialCount: 1, additionalCount: 0 },
    { initialCount: 2, additionalCount: 1 },
    { initialCount: 3, additionalCount: 2 },
  ])(
    "契約合体誘発は追加N=$additionalCountで基礎1巡+追加N巡を最終盤面まで解決する",
    ({ initialCount, additionalCount }) => {
      const {
        afterTriggerStack,
        attacker,
        secondaryTarget,
        untouchedTarget,
        lookup,
        triggeredLookup,
      } = setupC08ContractCombineTrigger(initialCount);
      let afterCount = afterTriggerStack;

      if (additionalCount === 0) {
        expect(afterCount.pendingEffectOptionalRepeatChoice).toBeNull();
      } else {
        const repeatChoice = getLegalActions({
          state: afterCount,
          actingPlayerId: "bob",
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          getRegisteredFieldCardEffectActions: () => undefined,
        }).find(
          (action) =>
            action.kind === "resolve_pending_effect_optional_repeat_choice" &&
            action.choiceIndex === 1
        );
        expect(repeatChoice).toBeDefined();

        const afterRepeatChoice = applyLegalAction({
          state: afterCount,
          action: repeatChoice!,
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        }).state;
        const countAction = getLegalActions({
          state: afterRepeatChoice,
          actingPlayerId: "bob",
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          getRegisteredFieldCardEffectActions: () => undefined,
        }).find(
          (action) =>
            action.kind === "resolve_pending_effect_optional_repeat_count"
        );
        expect(countAction).toBeDefined();
        afterCount = applyLegalAction({
          state: afterRepeatChoice,
          action: countAction!,
          countDecreaseSelection: additionalCount,
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        }).state;
      }

      expect(afterCount.pendingEffectTargetSelection).toMatchObject({
        requiredTargetCount: 1,
        maxTargetCount: 1,
      });
      const targetAction = getLegalActions({
        state: afterCount,
        actingPlayerId: "bob",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      }).find((action) => action.kind === "resolve_pending_effect_target");
      expect(targetAction).toBeDefined();

      let afterTarget = applyLegalAction({
        state: afterCount,
        action: targetAction!,
        targetInstanceIds: [attacker.instanceId],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state;

      for (let repeatIndex = 0; repeatIndex < additionalCount; repeatIndex++) {
        expect(afterTarget.pendingStepOptionalTargetSelection).toMatchObject({
          requiredTargetCount: 1,
          maxTargetCount: 1,
        });
        afterTarget = resolvePendingStepOptionalTarget(
          afterTarget,
          [attacker.instanceId],
          lookup,
          { getRegisteredTriggeredEffectActions: triggeredLookup }
        );
      }

      expect(
        afterTarget.players.find((player) => player.id === "bob")?.countValue
      ).toBe(0);
      expect(
        afterTarget.log.filter((line) =>
          line.startsWith("effect:repeat-activation:")
        )
      ).toHaveLength(additionalCount);
      expect(
        afterTarget.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === attacker.instanceId
        )?.zone
      ).toBe("trash");
      for (const target of [secondaryTarget, untouchedTarget]) {
        expect(
          afterTarget.cardInstances.find(
            (cardInstance) => cardInstance.instanceId === target.instanceId
          )?.zone
        ).toBe("field");
      }
    }
  );

  function setupC08ContractCombineTrigger(countValue: number) {
    const hostDef = card("BSGE01-R01");
    const attackerDef = BSGE_TEST_SPIRIT;
    const handBrave = createCardInstance(c, {
      instanceId: "bob-c08-hand",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const host = createCardInstance(hostDef, {
      instanceId: "bob-r01-host",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker-c08",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const secondaryTarget = createCardInstance(attackerDef, {
      instanceId: "alice-c08-secondary-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const untouchedTarget = createCardInstance(attackerDef, {
      instanceId: "alice-c08-untouched-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const definitions = [c, hostDef, attackerDef];
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const lookup = (id: string) =>
      definitions.find((definition) => definition.cardNo === id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          handBrave,
          host,
          attacker,
          secondaryTarget,
          untouchedTarget,
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 5 },
          {
            reserveNormalCoreCount: 5,
            soulCoreLocation: { kind: "reserve" },
            countValue,
            handCount: 1,
          },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-attacker-c08",
            memberInstanceIds: [attacker.instanceId],
            resolvedBp: 1000,
            resolvedSymbols: ["green"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack:c08-flash-priority",
          primaryEntityId: "battle-entity:alice-attacker-c08",
          participantEntityIds: ["battle-entity:alice-attacker-c08"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-attacker-c08",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-attacker-c08"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: "bob",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: "bob",
            pendingStackAction: null,
          },
        },
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_before_block",
      turnNumber: 2,
    };
    const combineAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "contract_combine" &&
        action.braveInstanceId === handBrave.instanceId &&
        action.candidateTargetInstanceIds.includes(host.instanceId)
    );
    expect(combineAction).toBeDefined();
    const declaredCombine = applyLegalAction({
      state,
      action: combineAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const afterCombine = passStackAndResolveTarget(
      declaredCombine,
      [host.instanceId],
      lookup,
      { getRegisteredTriggeredEffectActions: triggeredLookup }
    );
    const triggerAction = getLegalActions({
      state: afterCombine,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === host.instanceId &&
        action.sourceEffectInstanceId === handBrave.instanceId &&
        action.skipOnly !== true
    );
    expect(triggerAction).toBeDefined();
    const declaredTrigger = applyLegalAction({
      state: afterCombine,
      action: triggerAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const afterTriggerStack = passStackUntilClosed(declaredTrigger, lookup, {
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    return {
      afterCombine,
      afterTriggerStack,
      handBrave,
      host,
      attacker,
      secondaryTarget,
      untouchedTarget,
      lookup,
      triggeredLookup,
    };
  }

  function makeC08BattleState(
    countValue: number,
    firstEnemyDefinition: CardDefinition = card("BSDB01-C04"),
    additionalEnemyDefinitions: readonly CardDefinition[] = []
  ): GameState {
    // C08 の【合体条件：GE＆系統名に「O」を含まない】を満たす host を置く。
    // 対象化応答の解決中にも SBA が走るため、非 GE の C01 を使うと本題と無関係に
    // 強制分離して中断後の C08 を不発化してしまう。
    const host = createCardInstance(card("BSGE01-CX01"), {
      instanceId: "alice-c08-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["alice-c08-brave"],
    });
    const brave = createCardInstance(c, {
      instanceId: "alice-c08-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "alice-c08-host",
    });
    const enemyDef = card("BSDB01-C04");
    const enemies = ["bob-c08-a", "bob-c08-b", "bob-c08-c"].map(
      (instanceId, index) =>
        createCardInstance(
          index === 0
            ? firstEnemyDefinition
            : (additionalEnemyDefinitions[index - 1] ?? enemyDef),
          {
            instanceId,
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }
        )
    );
    const lookup = buildBattleImmediateEffectLookup([c]);
    const attackReg = lookup(c.cardNo)!.find((reg) => reg.timing === "attack")!;

    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, ...enemies],
        playerOverrides: [{ countValue }, { countValue: 0 }],
        battleImmediateEffects: [
          {
            promptId: "bi-bsge01-c08",
            attackId: "attack-bsge01-c08",
            timing: "attack",
            sourceKind: attackReg.sourceKind,
            sourceInstanceId: brave.instanceId,
            sourceDefinitionId: c.cardNo,
            sourceCardNo: c.cardNo,
            actingPlayerId: "alice",
            participantEntityId: "battle-entity:alice-c08-host",
            registrationIndex: 0,
          },
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      turnNumber: 2,
    };
  }

  const c08BattleLookup = buildBattleImmediateEffectLookup([c]);

  function makeC08BattleStateWithR04(countValue: number): GameState {
    const hostDef = card("BSGE01-CX01");
    const r04Def = card("BSGE01-R04");
    const enemyDef = card("BSDB01-C04");
    const host = createCardInstance(hostDef, {
      instanceId: "alice-c08-r04-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["alice-c08-r04-brave"],
    });
    host.underCards = [
      {
        cardInstanceId: "alice-c08-r04-under",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const brave = createCardInstance(c, {
      instanceId: "alice-c08-r04-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: host.instanceId,
    });
    const r04 = createCardInstance(r04Def, {
      instanceId: "alice-c08-r04-under",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: host.instanceId,
    });
    const enemies = ["bob-c08-r04-a", "bob-c08-r04-b", "bob-c08-r04-c"].map(
      (instanceId) =>
        createCardInstance(enemyDef, {
          instanceId,
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        })
    );
    const state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [host, brave, r04, ...enemies],
          playerOverrides: [{ countValue }, { countValue: 0 }],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "declare_attack",
        turnNumber: 2,
      },
      getBSGEDefinition
    );
    const hostAfter = state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === host.instanceId
    )!;

    return queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-bsge01-c08-r04",
      participantEntityId: `battle-entity:${host.instanceId}`,
      actingPlayerId: "alice",
      sourceCard: hostAfter,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    });
  }

  function getC08BattleActions(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceCardNo === "BSGE01-C08"
    );
  }

  function closeC08StackWindow(state: GameState): GameState {
    return passStackUntilClosed(state, getBSGEDefinition, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    });
  }

  it("スピリット状態パッシブは実装済み（stub なし）、アタック時側の optional repeat を表現する", () => {
    expect(c.effects![0]!.textRef).toEqual([3]);
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.applicability?.combined).toBe(false);
    expect(effect.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(effect.condition).toEqual([{ kind: "combined" }]);
    expect(effect.executionMode).toBe("optional");
    expect(effect.textRef).toEqual([6, 7]);
    expect(effect.steps[0]!.action).toEqual({
      kind: "count_decrease",
      player: "self",
      amount: { source: { kind: "selected_targets", stepId: "bp0" } },
    });
    expect(effect.steps[1]).toMatchObject({
      id: "bp0",
      connector: "conditional_cost",
      repeat: {
        additional: {
          source: { kind: "count_value", player: "self" },
          offset: -1,
        },
        executionAdditional: {
          source: { kind: "selected_targets", stepId: "bp0" },
          offset: -1,
        },
        optional: true,
      },
    });
    expect(effect.steps[2]!.action).toEqual({
      kind: "destroy",
      target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
    });
  });

  it("battle immediate 登録は基礎1巡分だけを持ち、追加発揮の対象は各巡で選ぶ", () => {
    const lookup = buildBattleImmediateEffectLookup([c]);
    const attackRegs = lookup("BSGE01-C08")?.filter(
      (reg) => reg.timing === "attack"
    );
    expect(attackRegs).toHaveLength(1);
    const reg = attackRegs![0]!;
    expect(reg).toMatchObject({
      requiredTargetCount: 1,
      requiredCountCostAmount: 1,
      requiredCountCostPlayer: "self",
    });
    const choices = reg.choices!;
    expect(choices[0]).toMatchObject({
      label: "追加発揮しない",
      requiredTargetCount: 1,
      requiredCountCostAmount: 1,
      requiredCountCostPlayer: "self",
    });
    expect(choices[1]).toMatchObject({
      label: "追加発揮する",
      requiredTargetCount: 1,
      requiredCountCostAmount: 1,
      requiredCountCostPlayer: "self",
    });
  });

  it("宣言時 legal action は発揮/不発だけを扱い、追加発揮 repeat はスタック後に送る", () => {
    const actions = getC08BattleActions(makeC08BattleState(2));

    const fireAction = actions.find((action) => action.skipOnly !== true);
    expect(fireAction?.choiceIndex).toBeUndefined();
    expect(fireAction).toMatchObject({
      requiredTargetCount: 1,
      requiredCountCostAmount: 1,
      requiredCountCostPlayer: "self",
    });
    expect(fireAction?.candidateTargetInstanceIds).toEqual([
      "bob-c08-a",
      "bob-c08-b",
      "bob-c08-c",
    ]);
    const declineAction = actions.find((action) => action.skipOnly === true);
    expect(declineAction).toMatchObject({
      skipOnly: true,
      targetMode: "none",
      requiredTargetCount: 0,
      executionMode: "optional",
    });
  });

  it("R04 があっても宣言時は C08 の発揮/不発 1ペアだけで、stack 後に R04 支払い choice、次に C08 追加発揮 choice を出す", () => {
    const state = makeC08BattleStateWithR04(4);
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "paid_prevention_immunity_offer" &&
          ce.targetInstanceId === "alice-c08-r04-host"
      )
    ).toBe(true);

    const actions = getC08BattleActions(state);
    expect(actions).toHaveLength(2);
    expect(actions.filter((action) => action.skipOnly !== true)).toHaveLength(
      1
    );
    expect(actions.filter((action) => action.skipOnly === true)).toHaveLength(
      1
    );
    const fireAction = actions.find((action) => action.skipOnly !== true)!;
    expect(fireAction.choiceIndex).toBeUndefined();

    const declared = applyLegalAction({
      state,
      action: fireAction,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    const afterStack = closeC08StackWindow(declared);
    expect(afterStack.pendingStepChoice).toMatchObject({
      sourceDefinitionId: "BSGE01-R04",
      paidEffectModifierChoice: {
        kind: "paid_prevention_immunity",
        sourceInstanceId: "alice-c08-r04-under",
        sourceDefinitionId: "BSGE01-R04",
        cost: { resource: "count", amount: 1 },
      },
    });
    expect(afterStack.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toBeNull();

    const r04Choices = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).filter((action) => action.kind === "resolve_pending_step_choice");
    expect(r04Choices.map((action) => action.choiceLabel)).toEqual([
      "支払わない",
      "支払う",
    ]);

    const afterR04Decline = resolvePendingStepChoice(
      afterStack,
      0,
      getBSGEDefinition,
      {
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredBattleImmediateEffectActions: c08BattleLookup,
      }
    );
    expect(afterR04Decline.pendingStepChoice).toBeNull();
    expect(afterR04Decline.pendingEffectTargetSelection).toBeNull();
    expect(afterR04Decline.pendingEffectOptionalRepeatChoice).toMatchObject({
      actingPlayerId: "alice",
      sourceDefinitionId: "BSGE01-CX01",
      effectSourceInstanceId: "alice-c08-r04-brave",
      effectSourceDefinitionId: "BSGE01-C08",
      effectIndex: 2,
      repeatStepIndex: 1,
      baseTargetCount: 1,
    });
  });

  it("追加発揮はスタック後に数を選び、各巡の現在の候補から対象を選び直す", () => {
    const state = makeC08BattleState(3);
    const action = getC08BattleActions(state).find(
      (candidate) => candidate.skipOnly !== true
    );

    expect(action).toBeDefined();
    const declared = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    expect(declared.stackWindow).not.toBeNull();
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "battle_immediate_effect"
    );
    expect(declared.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(declared.pendingEffectTargetSelection).toBeNull();
    expect(declared.players[0]!.countValue).toBe(3);

    const afterStack = closeC08StackWindow(declared);
    expect(afterStack.stackWindow).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toBeNull();
    expect(afterStack.pendingEffectOptionalRepeatChoice).toMatchObject({
      actingPlayerId: "alice",
      sourceDefinitionId: "BSGE01-C08",
      effectIndex: 2,
      repeatStepIndex: 1,
      baseTargetCount: 1,
      maxAdditionalCount: 2,
    });
    expect(afterStack.players[0]!.countValue).toBe(3);

    const repeatChoices = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).filter(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_optional_repeat_choice"
    );
    expect(repeatChoices.map((candidate) => candidate.choiceLabel)).toEqual([
      "追加発揮しない",
      "追加発揮する",
    ]);
    expect(
      repeatChoices.some((candidate) => candidate.choiceLabel === "発揮しない")
    ).toBe(false);

    const afterRepeatChoice = applyLegalAction({
      state: afterStack,
      action: repeatChoices.find((candidate) => candidate.choiceIndex === 1)!,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    expect(afterRepeatChoice.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(
      afterRepeatChoice.pendingEffectOptionalRepeatCountSelection
    ).toMatchObject({
      actingPlayerId: "alice",
      sourceDefinitionId: "BSGE01-C08",
      min: 1,
      max: 2,
      baseTargetCount: 1,
    });
    expect(afterRepeatChoice.players[0]!.countValue).toBe(3);

    const countAction = getLegalActions({
      state: afterRepeatChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_optional_repeat_count"
    );
    expect(countAction).toMatchObject({
      min: 1,
      max: 2,
    });

    const afterCount = applyLegalAction({
      state: afterRepeatChoice,
      action: countAction!,
      countDecreaseSelection: 2,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    expect(afterCount.pendingEffectOptionalRepeatCountSelection).toBeNull();
    expect(afterCount.pendingEffectTargetSelection).toMatchObject({
      actingPlayerId: "alice",
      sourceDefinitionId: "BSGE01-C08",
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(afterCount.players[0]!.countValue).toBe(3);

    const targetAction = getLegalActions({
      state: afterCount,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    expect(targetAction).toMatchObject({
      requiredTargetCount: 1,
      candidateTargetInstanceIds: ["bob-c08-a", "bob-c08-b", "bob-c08-c"],
    });
    const afterBase = applyLegalAction({
      state: afterCount,
      action: targetAction!,
      targetInstanceIds: ["bob-c08-a"],
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    expect(afterBase.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateInstanceIds: ["bob-c08-a", "bob-c08-b", "bob-c08-c"],
    });

    const afterFirstRepeat = resolvePendingStepOptionalTarget(
      afterBase,
      ["bob-c08-a"],
      getBSGEDefinition,
      {
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredBattleImmediateEffectActions: c08BattleLookup,
      }
    );
    // 1巡目後の step 結果を保持したまま、2巡目用の pending/candidate を改めて構築する。
    expect(afterFirstRepeat.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateInstanceIds: ["bob-c08-a", "bob-c08-b", "bob-c08-c"],
    });
    const applied = resolvePendingStepOptionalTarget(
      afterFirstRepeat,
      ["bob-c08-b"],
      getBSGEDefinition,
      {
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredBattleImmediateEffectActions: c08BattleLookup,
      }
    );
    expect(
      applied.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);
    expect(
      applied.log.filter((line) => line.startsWith("effect:repeat-activation:"))
    ).toHaveLength(2);
    for (const id of ["bob-c08-a", "bob-c08-b"]) {
      const target = applied.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === id
      );
      expect(target?.zone).toBe("trash");
      expect(target?.pendingLeaveKind).toBeNull();
    }
    expect(
      applied.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-c08-c"
      )?.zone
    ).toBe("field");
  });

  it("C08 は基礎対象の対象化応答後も、選択済みの追加2巡を保持して解決する", () => {
    const triggeredLookup = buildTriggeredEffectLookup(
      BSGE_NEGATE_TEST_DEFINITIONS
    );
    const effectOptions = {
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    };
    const state = makeC08BattleState(3, BSGE_TARGETED_RESPONSE_SPIRIT, [
      BSGE_TARGETED_RESPONSE_SPIRIT,
      BSGE_TARGETED_RESPONSE_SPIRIT,
    ]);
    const declared = applyLegalAction({
      state,
      action: getC08BattleActions(state).find(
        (candidate) => candidate.skipOnly !== true
      )!,
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    const afterStack = passStackUntilClosed(
      declared,
      getBSGEDefinition,
      effectOptions
    );
    const repeatChoice = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_optional_repeat_choice" &&
        candidate.choiceIndex === 1
    )!;
    const afterRepeatChoice = applyLegalAction({
      state: afterStack,
      action: repeatChoice,
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    const countAction = getLegalActions({
      state: afterRepeatChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_optional_repeat_count"
    )!;
    const afterCount = applyLegalAction({
      state: afterRepeatChoice,
      action: countAction,
      countDecreaseSelection: 2,
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    const targetAction = getLegalActions({
      state: afterCount,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target")!;
    const disclosure = applyLegalAction({
      state: afterCount,
      action: targetAction,
      targetInstanceIds: ["bob-c08-a"],
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    expect(
      disclosure.pendingTargetedDisclosureContinuation?.stepContext
        .selectedTargetCountOverrides,
      JSON.stringify(disclosure.pendingTargetedDisclosureContinuation)
    ).toEqual({ bp0: 3 });

    const response = getLegalActions({
      state: disclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "bob-c08-a"
    )!;
    const afterResponseDeclared = applyLegalAction({
      state: disclosure,
      action: response,
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    const afterResponse = passStackUntilClosed(
      afterResponseDeclared,
      getBSGEDefinition,
      effectOptions
    );
    expect(afterResponse.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterResponse.players[0]?.countValue).toBe(0);
    expect(afterResponse.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateInstanceIds: ["bob-c08-a", "bob-c08-b", "bob-c08-c"],
    });
    expect(
      afterResponse.pendingStepOptionalTargetSelection?.continuation.stepIndex
    ).toBe(1);
    expect(afterResponse.pendingStepOptionalTargetSelection?.targetStepId).toBe(
      "bp0"
    );
    expect(
      afterResponse.pendingStepOptionalTargetSelection?.continuation
        .repeatResume?.bpBecameZeroCardInstanceIds
    ).toEqual(["bob-c08-a"]);

    const afterFirstRepeatDisclosure = resolvePendingStepOptionalTarget(
      afterResponse,
      ["bob-c08-b"],
      getBSGEDefinition,
      effectOptions
    );
    expect(
      afterFirstRepeatDisclosure.pendingTargetedDisclosureContinuation
        ?.targetInstanceIds
    ).toEqual(["bob-c08-b"]);
    const firstRepeatResponse = getLegalActions({
      state: afterFirstRepeatDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "bob-c08-b"
    )!;
    const afterFirstRepeat = passStackUntilClosed(
      applyLegalAction({
        state: afterFirstRepeatDisclosure,
        action: firstRepeatResponse,
        getCardDefinitionById: getBSGEDefinition,
        ...effectOptions,
      }).state,
      getBSGEDefinition,
      effectOptions
    );
    expect(afterFirstRepeat.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(
      afterFirstRepeat.pendingStepOptionalTargetSelection?.continuation
        .repeatResume?.bpBecameZeroCardInstanceIds
    ).toEqual(["bob-c08-a", "bob-c08-b"]);
    const afterFinalRepeatDisclosure = resolvePendingStepOptionalTarget(
      afterFirstRepeat,
      ["bob-c08-c"],
      getBSGEDefinition,
      effectOptions
    );
    expect(
      afterFinalRepeatDisclosure.pendingTargetedDisclosureContinuation
        ?.targetInstanceIds
    ).toEqual(["bob-c08-c"]);
    const finalRepeatResponse = getLegalActions({
      state: afterFinalRepeatDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "bob-c08-c"
    )!;
    const afterFinalRepeat = passStackUntilClosed(
      applyLegalAction({
        state: afterFinalRepeatDisclosure,
        action: finalRepeatResponse,
        getCardDefinitionById: getBSGEDefinition,
        ...effectOptions,
      }).state,
      getBSGEDefinition,
      effectOptions
    );
    expect(
      afterFinalRepeat.pendingTargetedDisclosureContinuation?.stepContext
        .results.bp0?.bpBecameZeroCardInstanceIds
    ).toEqual(["bob-c08-a", "bob-c08-b", "bob-c08-c"]);
    expect(
      afterFinalRepeat.pendingTargetedDisclosureContinuation?.targetStepId
    ).toBe("__step_2");
    const finalContinuation =
      afterFinalRepeat.pendingTargetedDisclosureContinuation!;
    const finalStepContext = deserializeStepContext(
      finalContinuation.stepContext,
      afterFinalRepeat
    );
    expect(
      resolveTargetSpec({
        state: afterFinalRepeat,
        targetSpec: card("BSGE01-C08").effects![1]!.steps[2]!.action.target!,
        actingPlayerId: "alice",
        sourceInstanceId: "alice-c08",
        getCardDefinitionById: getBSGEDefinition,
        stepContext: finalStepContext,
      }).map((target) => target.instanceId)
    ).toEqual(["bob-c08-a", "bob-c08-b", "bob-c08-c"]);
    expect(
      afterFinalRepeat.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["bob-c08-a", "bob-c08-b", "bob-c08-c"]);
    // 追加2巡の action が B/C のそれぞれの対象化応答後に再開され、BP0 全体破壊の
    // 別の対象化窓まで到達する。全体破壊にも responder がいるため、この時点では
    // まだその後段を解決しない。
    expect(
      afterFinalRepeat.log.filter((line) =>
        line.startsWith("effect:repeat-activation:")
      )
    ).toHaveLength(2);
    expect(afterFinalRepeat.players[0]?.countValue).toBe(0);
    for (const id of ["bob-c08-a", "bob-c08-b", "bob-c08-c"]) {
      expect(
        afterFinalRepeat.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === id
        )?.zone
      ).toBe("field");
    }
  });

  it("追加発揮1回は基礎解決の後で別対象を再選択して2巡目を解決する", () => {
    const triggeredLookup = buildTriggeredEffectLookup(
      BSGE_NEGATE_TEST_DEFINITIONS
    );
    const effectOptions = {
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    };
    const state = makeC08BattleState(2, card("BSDB01-C04"), [
      BSGE_TARGETED_RESPONSE_SPIRIT,
    ]);
    const declared = applyLegalAction({
      state,
      action: getC08BattleActions(state).find(
        (candidate) => candidate.skipOnly !== true
      )!,
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    const afterStack = closeC08StackWindow(declared);
    const repeatChoice = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_optional_repeat_choice" &&
        candidate.choiceIndex === 1
    )!;
    const afterRepeatChoice = applyLegalAction({
      state: afterStack,
      action: repeatChoice,
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    const countAction = getLegalActions({
      state: afterRepeatChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_optional_repeat_count"
    )!;
    const afterCount = applyLegalAction({
      state: afterRepeatChoice,
      action: countAction,
      countDecreaseSelection: 1,
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    expect(afterCount.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    const targetAction = getLegalActions({
      state: afterCount,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target")!;
    const afterBase = applyLegalAction({
      state: afterCount,
      action: targetAction,
      targetInstanceIds: ["bob-c08-a"],
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).state;
    expect(afterBase.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateInstanceIds: ["bob-c08-a", "bob-c08-b", "bob-c08-c"],
    });
    const additionalRepeatDisclosure = resolvePendingStepOptionalTarget(
      afterBase,
      ["bob-c08-b"],
      getBSGEDefinition,
      effectOptions
    );
    expect(
      additionalRepeatDisclosure.pendingTargetedDisclosureContinuation
        ?.targetInstanceIds
    ).toEqual(["bob-c08-b"]);
    expect(
      additionalRepeatDisclosure.log.filter((line) =>
        line.startsWith("effect:repeat-activation:")
      )
    ).toHaveLength(0);
    const additionalRepeatResponse = getLegalActions({
      state: additionalRepeatDisclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      ...effectOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "bob-c08-b"
    )!;
    const applied = passStackUntilClosed(
      applyLegalAction({
        state: additionalRepeatDisclosure,
        action: additionalRepeatResponse,
        getCardDefinitionById: getBSGEDefinition,
        ...effectOptions,
      }).state,
      getBSGEDefinition,
      effectOptions
    );

    expect(
      applied.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);
    expect(
      applied.log.filter((line) => line.startsWith("effect:repeat-activation:"))
    ).toHaveLength(1);
    expect(
      applied.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["bob-c08-a", "bob-c08-b"]);
    expect(
      applied.pendingTargetedDisclosureContinuation?.stepContext.results.bp0
        ?.bpBecameZeroCardInstanceIds
    ).toEqual(["bob-c08-a", "bob-c08-b"]);
    for (const id of ["bob-c08-a", "bob-c08-b"]) {
      expect(
        applied.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === id
        )?.zone
      ).toBe("field");
    }
    expect(
      applied.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-c08-c"
      )?.zone
    ).toBe("field");
  });

  it("count 不足時は追加発揮 pending を出さず、基礎コスト不足では発揮側を列挙しない", () => {
    const oneCountActions = getC08BattleActions(makeC08BattleState(1));

    expect(oneCountActions).toHaveLength(2);
    const baseAction = oneCountActions.find(
      (action) => action.skipOnly !== true
    );
    expect(baseAction?.choiceIndex).toBeUndefined();
    expect(baseAction).toMatchObject({
      requiredTargetCount: 1,
      requiredCountCostAmount: 1,
      requiredCountCostPlayer: "self",
    });
    const declineAction = oneCountActions.find(
      (action) => action.skipOnly === true
    );
    expect(declineAction).toMatchObject({
      skipOnly: true,
      targetMode: "none",
      requiredTargetCount: 0,
      executionMode: "optional",
    });

    const declared = applyLegalAction({
      state: makeC08BattleState(1),
      action: baseAction!,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    const afterStack = closeC08StackWindow(declared);
    expect(afterStack.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(afterStack.players[0]!.countValue).toBe(1);

    const targetAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    const applied = applyLegalAction({
      state: afterStack,
      action: targetAction!,
      targetInstanceIds: ["bob-c08-a"],
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    expect(applied.pendingEffectTargetSelection).toBeNull();
    expect(applied.players[0]!.countValue).toBe(0);
    expect(
      applied.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-c08-a"
      )?.zone
    ).toBe("trash");
    for (const id of ["bob-c08-b", "bob-c08-c"]) {
      expect(
        applied.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === id
        )?.zone
      ).toBe("field");
    }

    const declined = applyLegalAction({
      state: makeC08BattleState(1),
      action: declineAction!,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: c08BattleLookup,
    }).state;
    expect(declined.battleImmediateEffects).toEqual([]);
    expect(declined.players[0]!.countValue).toBe(1);
    expect(
      declined.cardInstances.filter((card) => card.pendingLeaveKind)
    ).toEqual([]);

    const zeroCountActions = getC08BattleActions(makeC08BattleState(0));

    expect(
      zeroCountActions.filter((action) => action.skipOnly !== true)
    ).toEqual([]);
    expect(zeroCountActions).toHaveLength(1);
    expect(zeroCountActions[0]).toMatchObject({
      skipOnly: true,
      targetMode: "none",
      requiredTargetCount: 0,
    });
  });
});

describe("BSGE01-C09〜C13 神喰ネクサス", () => {
  it.each([
    "BSGE01-C09",
    "BSGE01-C10",
    "BSGE01-C11",
    "BSGE01-C12",
    "BSGE01-C13",
  ])("%s: 配置時カウント+2", (no) => {
    const c = card(no);
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    );
    const cnt = place!.steps[0]!.action;
    expect(cnt.kind).toBe("count_increase");
    if (cnt.kind === "count_increase") expect(cnt.amount).toBe(2);
  });

  it("BSGE01-C13 は提示契約カード色を1つの動的 symbol_add で表す", () => {
    const c = card("BSGE01-C13");
    const symbolEffects = c.effects!.filter(
      (effect) => effect.steps[0]?.action.kind === "symbol_add"
    );
    expect(symbolEffects).toHaveLength(1);
    const effect = symbolEffects[0]!;
    expect(effect.stub).toBeUndefined();
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("symbol_add");
    if (action.kind === "symbol_add") {
      expect(action.symbol).toBeUndefined();
      expect(action.symbolSource).toEqual({
        kind: "presented_contract_colors",
        player: "self",
      });
    }
  });

  it("BSGE01-C13 は提示契約カード色の1シンボルを得て、未提示では得ない", () => {
    const c = card("BSGE01-C13");
    const c13 = createCardInstance(c, {
      instanceId: "c13-green",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const greenState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [c13],
      playerOverrides: [{ contractCardNo: "BSGE01-CX02" }, {}],
    });
    const greenRebuilt = rebuildContinuousEffectsFromField(greenState, (id) =>
      cardNoMap.get(id)
    );
    const greenInstance = greenRebuilt.cardInstances.find(
      (card) => card.instanceId === "c13-green"
    )!;
    const symbolCes = greenRebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.targetInstanceId === "c13-green"
    );
    expect(symbolCes).toHaveLength(1);
    expect(symbolCes[0]!.modifierSymbolSource).toEqual({
      kind: "presented_contract_colors",
      playerId: "alice",
    });
    expect(
      getEffectiveSymbols(greenRebuilt, greenInstance, c, (id) =>
        cardNoMap.get(id)
      )
    ).toEqual(["green"]);

    const multiState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [c13],
      playerOverrides: [{ contractCardNo: "BSDB01-CX01" }, {}],
    });
    const multiRebuilt = rebuildContinuousEffectsFromField(multiState, (id) =>
      cardNoMap.get(id)
    );
    const multiInstance = multiRebuilt.cardInstances.find(
      (card) => card.instanceId === "c13-green"
    )!;
    const multiCes = multiRebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.targetInstanceId === "c13-green"
    );
    expect(multiCes).toHaveLength(1);
    expect(
      getEffectiveSymbols(multiRebuilt, multiInstance, c, (id) =>
        cardNoMap.get(id)
      )
    ).toEqual(["red", "blue"]);

    const noContractState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [c13],
      playerOverrides: [{ contractCardNo: null }, {}],
    });
    const noContractRebuilt = rebuildContinuousEffectsFromField(
      noContractState,
      (id) => cardNoMap.get(id)
    );
    const noContractInstance = noContractRebuilt.cardInstances.find(
      (card) => card.instanceId === "c13-green"
    )!;
    expect(
      getEffectiveSymbols(noContractRebuilt, noContractInstance, c, (id) =>
        cardNoMap.get(id)
      )
    ).toEqual([]);
  });

  it("BSGE01-C13 は対象開示時、相手がカウント-4を払わなければ元効果を受けない", () => {
    const c = card("BSGE01-C13");
    const protect = c.effects!.find(
      (effect) =>
        effect.timing.kind === "game_event" &&
        (effect.timing as { event?: unknown }).event === "targeted"
    )!;
    expect(protect).toBeDefined();
    expect(protect.stub).toBeUndefined();
    expect(protect.timing).toMatchObject({
      requireTriggerSelf: true,
    });
    expect(protect.steps[0]).toMatchObject({
      id: "opponent-count-payment",
      executionMode: "optional",
      chooser: "opponent",
      action: {
        kind: "count_decrease",
        player: "opponent",
        amount: 4,
      },
    });
    expect(protect.steps[1]).toMatchObject({
      connector: "unless_previous_succeeded",
      action: {
        kind: "effect_immunity",
        target: { kind: "trigger_related_instance" },
        duration: { scope: "current_effect" },
      },
    });

    const destroyDef: CardDefinition = {
      cardNo: "TEST-BSGE01-C13-DESTROY",
      name: "TEST BSGE01 C13 destroy",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のネクサス1つを破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    cardName: { exact: "フェンリル極東支部" },
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const nexus = createCardInstance(c, {
      instanceId: "bsge01-c13-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(destroyDef, {
      instanceId: "bsge01-c13-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const definitions = [...ALL_CARDS, destroyDef];
    const getDef = (id: string): CardDefinition | undefined =>
      definitions.find((def) => def.cardNo === id);
    const noLookup = () => [];
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, magic],
      playerOverrides: [{}, { countValue: 4 }],
    });

    const disclosure = executeEffect({
      chainId: "test:bsge01-cards:4584",
      state: baseState,
      effect: destroyDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      targetInstanceIds: [nexus.instanceId],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });
    expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceDefinitionId: destroyDef.cardNo,
      sourceInstanceId: magic.instanceId,
      targetInstanceIds: [nexus.instanceId],
      targetStepId: "destroy",
    });
    expect(disclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedInstanceId: nexus.instanceId,
      effectSourceDefinitionId: destroyDef.cardNo,
    });

    const resolveProtection = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === nexus.instanceId
    );
    expect(resolveProtection).toBeDefined();

    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveProtection!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    expect(afterPass.pendingStepOptionalChoice).toMatchObject({
      choosingPlayerId: "bob",
      sourceInstanceId: nexus.instanceId,
      stepIndex: 0,
      prompt: {
        label: "自分のカウントを4減らす",
        question: "自分のカウントを4減らしますか？",
      },
    });

    const declinePayment = getLegalActions({
      state: afterPass,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(declinePayment).toBeDefined();
    const afterDecline = applyLegalAction({
      state: afterPass,
      action: declinePayment!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    expect(
      afterDecline.players.find((player) => player.id === "bob")?.countValue
    ).toBe(4);
    expect(afterDecline.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterDecline.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === nexus.instanceId
      )?.zone
    ).toBe("field");
    expect(
      afterDecline.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === nexus.instanceId
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      afterDecline.log.some(
        (entry) =>
          entry ===
          `effect:effect_immunity:registered:${nexus.instanceId}:current_effect`
      )
    ).toBe(true);
    expect(
      afterDecline.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "defense_immune" &&
          effect.targetInstanceId === nexus.instanceId
      )
    ).toBe(false);
    expect(afterDecline.log).not.toContain(
      `effect:destroy:bob:${nexus.instanceId}`
    );
  });

  it("BSGE01-C13 はカウントが4未満なら部分支払いを実行できず、支払わない扱いで元効果を受けない", () => {
    const c = card("BSGE01-C13");
    const destroyDef: CardDefinition = {
      cardNo: "TEST-BSGE01-C13-DESTROY-SHORT",
      name: "TEST BSGE01 C13 destroy short",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のネクサス1つを破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    cardName: { exact: "フェンリル極東支部" },
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const nexus = createCardInstance(c, {
      instanceId: "bsge01-c13-short-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(destroyDef, {
      instanceId: "bsge01-c13-short-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const definitions = [...ALL_CARDS, destroyDef];
    const getDef = (id: string): CardDefinition | undefined =>
      definitions.find((def) => def.cardNo === id);
    const noLookup = () => [];
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const disclosure = executeEffect({
      chainId: "test:bsge01-cards:4766",
      state: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, magic],
        playerOverrides: [{}, { countValue: 3 }],
      }),
      effect: destroyDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      targetInstanceIds: [nexus.instanceId],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });
    const resolveProtection = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === nexus.instanceId
    )!;
    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveProtection,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find((action) => action.kind === "pass_stack")!;
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    expect(afterPass.pendingStepOptionalChoice).toMatchObject({
      choosingPlayerId: "bob",
      canExecute: false,
    });

    const optionalActions = getLegalActions({
      state: afterPass,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    });
    expect(
      optionalActions.find(
        (action) =>
          action.kind === "resolve_pending_step_optional_choice" &&
          action.choice === "execute"
      )
    ).toBeUndefined();
    const declinePayment = optionalActions.find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(declinePayment).toBeDefined();

    const afterDecline = applyLegalAction({
      state: afterPass,
      action: declinePayment!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    expect(
      afterDecline.players.find((player) => player.id === "bob")?.countValue
    ).toBe(3);
    expect(
      afterDecline.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === nexus.instanceId
      )?.zone
    ).toBe("field");
    expect(
      afterDecline.log.some(
        (entry) =>
          entry ===
          `effect:effect_immunity:registered:${nexus.instanceId}:current_effect`
      )
    ).toBe(true);
    expect(
      afterDecline.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "defense_immune" &&
          effect.targetInstanceId === nexus.instanceId
      )
    ).toBe(false);
    expect(afterDecline.log).not.toContain(
      `effect:destroy:bob:${nexus.instanceId}`
    );
  });

  it("BSGE01-C13 は対象になっていない同名別インスタンスでは対象開示に反応しない", () => {
    const c = card("BSGE01-C13");
    const destroyDef: CardDefinition = {
      cardNo: "TEST-BSGE01-C13-DESTROY-SAME-NAME",
      name: "TEST BSGE01 C13 destroy same name",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のネクサス1つを破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    cardName: { exact: "フェンリル極東支部" },
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const targetNexus = createCardInstance(c, {
      instanceId: "bsge01-c13-target-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bystanderNexus = createCardInstance(c, {
      instanceId: "bsge01-c13-bystander-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(destroyDef, {
      instanceId: "bsge01-c13-same-name-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const definitions = [...ALL_CARDS, destroyDef];
    const getDef = (id: string): CardDefinition | undefined =>
      definitions.find((def) => def.cardNo === id);
    const noLookup = () => [];
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const disclosure = executeEffect({
      chainId: "test:bsge01-cards:4942",
      state: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [targetNexus, bystanderNexus, magic],
        playerOverrides: [{}, { countValue: 4 }],
      }),
      effect: destroyDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      targetInstanceIds: [targetNexus.instanceId],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });
    const resolveActions = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).filter((action) => action.kind === "resolve_pending_triggered_effect");

    expect(
      resolveActions.some(
        (action) => action.sourceInstanceId === targetNexus.instanceId
      )
    ).toBe(true);
    expect(
      resolveActions.some(
        (action) => action.sourceInstanceId === bystanderNexus.instanceId
      )
    ).toBe(false);
  });

  it("BSGE01-C13 は相手がカウント-4を払った場合、元効果を通す", () => {
    const c = card("BSGE01-C13");
    const destroyDef: CardDefinition = {
      cardNo: "TEST-BSGE01-C13-DESTROY-PAY",
      name: "TEST BSGE01 C13 destroy pay",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のネクサス1つを破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    cardName: { exact: "フェンリル極東支部" },
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const nexus = createCardInstance(c, {
      instanceId: "bsge01-c13-pay-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(destroyDef, {
      instanceId: "bsge01-c13-pay-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const definitions = [...ALL_CARDS, destroyDef];
    const getDef = (id: string): CardDefinition | undefined =>
      definitions.find((def) => def.cardNo === id);
    const noLookup = () => [];
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const disclosure = executeEffect({
      chainId: "test:bsge01-cards:5037",
      state: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, magic],
        playerOverrides: [{}, { countValue: 4 }],
      }),
      effect: destroyDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      targetInstanceIds: [nexus.instanceId],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });
    const resolveProtection = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === nexus.instanceId
    )!;
    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveProtection,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find((action) => action.kind === "pass_stack")!;
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    const executePayment = getLegalActions({
      state: afterPass,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    )!;
    const afterPay = applyLegalAction({
      state: afterPass,
      action: executePayment,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    expect(
      afterPay.players.find((player) => player.id === "bob")?.countValue
    ).toBe(0);
    expect(afterPay.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterPay.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === nexus.instanceId
      )?.zone
    ).toBe("trash");
    expect(afterPay.log).toContain(`effect:destroy:bob:${nexus.instanceId}`);
  });
});

describe("BSGE01-C14 ブレイク・ショット", () => {
  const c = card("BSGE01-C14");
  it("errata 2026-06-26: スタック効果は赤1色契約条件 (contracts_only_mono_color self/red) を持つ", () => {
    const stack = c.effects![1]!;
    expect(stack.condition).toContainEqual({
      kind: "contracts_only_mono_color",
      player: "self",
      color: "red",
    });
  });
  it("フラッシュ破壊 / スタックで相手の白マジック使用を無効化する", () => {
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("destroy");
    const stack = c.effects![1]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "self", period: "attack" });
    expect(stack.steps[0]!.action.kind).toBe("negate");
    expect(stack.stub).toBeUndefined();

    const resolved = resolveBSGENestedNegate({
      sourceCardNo: "BSGE01-C14",
      targetDefinition: BSGE_WHITE_FLASH_MAGIC,
      targetTiming: "flash",
    });

    expect(
      resolved.log.some(
        (line) =>
          line ===
          "effect:negate:pending-stack:use_magic:stack:bob-target-magic"
      )
    ).toBe(true);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "bob-target-magic"
      )?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-deck-card")
        ?.zone
    ).toBe("deck");
  });

  it("BSGE01-C14 は白以外には空撃ちできるが、自分アタックステップ外では使用できない", () => {
    expect(
      hasBSGENegateMagicAction(
        getBSGENegateLegalActions({
          sourceCardNo: "BSGE01-C14",
          targetDefinition: BSGE_WHITE_FLASH_MAGIC,
          targetTiming: "flash",
        })
      )
    ).toBe(true);
    expect(
      hasBSGENegateMagicAction(
        getBSGENegateLegalActions({
          sourceCardNo: "BSGE01-C14",
          targetDefinition: BSGE_BLUE_FLASH_MAGIC,
          targetTiming: "flash",
        })
      )
    ).toBe(true);
    const emptyFire = resolveBSGENestedNegate({
      sourceCardNo: "BSGE01-C14",
      targetDefinition: BSGE_BLUE_FLASH_MAGIC,
      targetTiming: "flash",
    });
    expect(
      emptyFire.cardInstances.find((c) => c.instanceId === "bob-deck-card")
        ?.zone
    ).toBe("hand");
    expect(emptyFire.pendingStackNegateRequests).toEqual([]);
    expect(
      hasBSGENegateMagicAction(
        getBSGENegateLegalActions({
          sourceCardNo: "BSGE01-C14",
          targetDefinition: BSGE_WHITE_FLASH_MAGIC,
          targetTiming: "flash",
          activePlayerId: "bob",
        })
      )
    ).toBe(false);
  });
});

describe("BSGE01-C15 龍虎の牙", () => {
  const c = card("BSGE01-C15");
  it("errata 2026-06-26: スタック効果は緑1色契約条件 (contracts_only_mono_color self/green) を持つ", () => {
    const stack = c.effects![1]!;
    expect(stack.condition).toContainEqual({
      kind: "contracts_only_mono_color",
      player: "self",
      color: "green",
    });
  });
  it("フラッシュで重疲労2", () => {
    const ex = c.effects![0]!.steps[0]!.action;
    if (ex.kind === "exhaust") expect(ex.degree).toBe("heavy_exhaust");
  });

  it("BSGE01-C15 は相手マジックのフラッシュ効果使用だけを無効化する", () => {
    const stack = c.effects![1]!;
    expect(stack.timingScope).toEqual({ player: "self", period: "attack" });
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("negate");
    if (action.kind === "negate") {
      expect(action.targetEffectTiming).toBe("flash");
    }
    expect(stack.stub).toBeUndefined();

    const flashResolved = resolveBSGENestedNegate({
      sourceCardNo: "BSGE01-C15",
      targetDefinition: BSGE_BLUE_FLASH_MAGIC,
      targetTiming: "flash",
    });
    expect(
      flashResolved.log.some(
        (line) =>
          line ===
          "effect:negate:pending-stack:use_magic:stack:bob-target-magic"
      )
    ).toBe(true);
    expect(
      flashResolved.cardInstances.find(
        (card) => card.instanceId === "bob-deck-card"
      )?.zone
    ).toBe("deck");

    const mainResolved = resolveBSGENestedNegate({
      sourceCardNo: "BSGE01-C15",
      targetDefinition: BSGE_WHITE_MAIN_MAGIC,
      targetTiming: "main",
    });
    expect(
      mainResolved.log.some((line) => line.startsWith("magic:nullified:"))
    ).toBe(false);
    expect(
      mainResolved.cardInstances.find(
        (card) => card.instanceId === "bob-deck-card"
      )?.zone
    ).toBe("hand");
  });

  it("BSGE01-C15 は対象外のメイン効果には空撃ちできるが、自分アタックステップ外では使用できない", () => {
    expect(
      hasBSGENegateMagicAction(
        getBSGENegateLegalActions({
          sourceCardNo: "BSGE01-C15",
          targetDefinition: BSGE_BLUE_FLASH_MAGIC,
          targetTiming: "flash",
        })
      )
    ).toBe(true);
    expect(
      hasBSGENegateMagicAction(
        getBSGENegateLegalActions({
          sourceCardNo: "BSGE01-C15",
          targetDefinition: BSGE_WHITE_MAIN_MAGIC,
          targetTiming: "main",
        })
      )
    ).toBe(true);
    expect(
      hasBSGENegateMagicAction(
        getBSGENegateLegalActions({
          sourceCardNo: "BSGE01-C15",
          targetDefinition: BSGE_BLUE_FLASH_MAGIC,
          targetTiming: "flash",
          activePlayerId: "bob",
        })
      )
    ).toBe(false);
    expect(
      hasBSGENegateMagicAction(
        getBSGENegateLegalActions({
          sourceCardNo: "BSGE01-C15",
          targetDefinition: BSGE_BLUE_FLASH_MAGIC,
          targetTiming: "flash",
          step: "main",
        })
      )
    ).toBe(false);
  });
});

describe("BSGE01-C16 魂の家", () => {
  const c = card("BSGE01-C16");
  it("手札免疫 / フラッシュ召喚候補にトラッシュと魂状態を統合", () => {
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("effect_immunity");
    const summonEffect = c.effects![1]!;
    expect(summonEffect.stub).toBeUndefined();
    const trashStep = summonEffect.steps[0]!;
    const trashAction = trashStep.action;
    if (
      trashAction.kind === "summon" &&
      trashAction.target.kind === "from_zone"
    ) {
      expect(trashAction.target.zone).toBe("trash");
      expect(trashAction.target.includeSoulState).toBe(true);
      expect(trashAction.target.filter?.colors).toEqual(["purple"]);
      expect(trashAction.target.filter?.maxCost).toBe(4);
      expect(trashAction.target.filter?.soulState).toBeUndefined();
      expect(trashAction.costModifier).toBe("free");
    } else {
      throw new Error("BSGE01-C16 effects[1] step0 must summon from trash");
    }
    expect(trashStep.choice).toBeUndefined();
  });

  it("[board] 魂状態の紫スピリットを召喚(soulState 除去 + コア配置)", () => {
    const getDef = (id: string) => cardNoMap.get(id);
    const source = createCardInstance(c, {
      instanceId: "tama-no-ie",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const soulSpirit = createCardInstance(card("BSGE01-CX03"), {
      instanceId: "renka-soul",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, soulSpirit],
      playerOverrides: [
        {
          reserveNormalCoreCount: 5,
          soulStateInstanceIds: ["renka-soul"],
        },
        {},
      ],
    });
    const after = executeEffect({
      chainId: "test:bsge01-cards:5353",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "tama-no-ie",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.soulStateInstanceIds).not.toContain("renka-soul");
    const summoned = after.cardInstances.find(
      (x) => x.instanceId === "renka-soul"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");
    // CX03 cost 2, costModifier free → コスト0 + reserve から 1 個配置 (requiredCores=1)
    expect(summoned.normalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(4);
    expect(after.log).toContain(
      "effect:summon:renka-soul:self:soul_state:cost=0:cores=1"
    );
  });

  it("[board] トラッシュにも魂状態にも候補が無ければ no-op", () => {
    const getDef = (id: string) => cardNoMap.get(id);
    const source = createCardInstance(c, {
      instanceId: "tama-no-ie-empty",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bsge01-cards:5390",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "tama-no-ie-empty",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(5);
    expect(after.cardInstances).toEqual(before.cardInstances);
  });

  it("スタック対象フィルタ: lv1RequiredCores!==1 の相手スピリットは除外される（filterOr 直下では黙って無視される罠の回帰防止）", () => {
    const stack = c.effects![2]!;
    const coreMoveAction = stack.steps[0]!.action;
    if (
      coreMoveAction.kind !== "core_move" ||
      coreMoveAction.target?.kind !== "filter"
    ) {
      throw new Error(
        "BSGE01-C16 effects[2] steps[0] must be a filter-targeted core_move"
      );
    }
    const filter = coreMoveAction.target.filter;
    expect(filter.filterOr).toBeUndefined();
    expect(filter.lv1RequiredCores).toBe(1);
    const lv1Cost1Def = card("BSGE01-CX03");
    const lv1Cost2Def = {
      ...lv1Cost1Def,
      levelDefs: [
        { ...lv1Cost1Def.levelDefs[0]!, requiredCores: 2 },
        ...lv1Cost1Def.levelDefs.slice(1),
      ],
    };
    const matchingInstance = createCardInstance(lv1Cost1Def, {
      instanceId: "filter-check-match",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const nonMatchingInstance = createCardInstance(lv1Cost2Def, {
      instanceId: "filter-check-nomatch",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    expect(matchesCardFilter(matchingInstance, lv1Cost1Def, filter)).toBe(true);
    expect(matchesCardFilter(nonMatchingInstance, lv1Cost2Def, filter)).toBe(
      false
    );
  });

  it("[board] スタック: 最低Lvコスト1の相手2体を、コアが1個になるようリザーブへ", () => {
    const getDef = (id: string) => cardNoMap.get(id);
    const stack = c.effects![2]!;
    expect(stack.stub).toBeUndefined();
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    const targetA = createCardInstance(card("BSGE01-CX03"), {
      instanceId: "lv1-cost1-a",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const targetB = createCardInstance(card("BSGE01-CX03"), {
      instanceId: "lv1-cost1-b",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const source = createCardInstance(c, {
      instanceId: "tama-no-ie-stack",
      ownerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [targetA, targetB, source],
        playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    const after = executeEffect({
      chainId: "test:bsge01-cards:5475",
      state: before,
      effect: stack,
      sourceInstanceId: "tama-no-ie-stack",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["lv1-cost1-a", "lv1-cost1-b"],
    });
    const afterA = after.cardInstances.find(
      (x) => x.instanceId === "lv1-cost1-a"
    )!;
    const afterB = after.cardInstances.find(
      (x) => x.instanceId === "lv1-cost1-b"
    )!;
    expect(afterA.normalCoreCount).toBe(1);
    expect(afterB.normalCoreCount).toBe(1);
    const bob = after.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(3);
  });
});

describe("BSGE01-C17 デッド・プルーフ", () => {
  const c = card("BSGE01-C17");

  function declineDiscardGatePending(state: GameState): GameState {
    expect(state.pendingLifeDamageDiscardChoice).not.toBeNull();
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
    });
    const action = actions.find(
      (candidate) =>
        candidate.kind === "resolve_pending_life_damage_discard_choice"
    );
    if (!action) {
      throw new Error("resolve_pending_life_damage_discard_choice not found");
    }
    return applyLegalAction({
      state,
      action,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      lifeDamageDiscardChoice: "decline",
    }).state;
  }

  it("フラッシュは効果記述を持つ相手スピリット/アルティメット由来ライフ減少を1にクランプするDSL", () => {
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action).toMatchObject({
        player: "self",
        cause: "opponent",
        mode: "turn_cap",
        cap: 1,
        attackerFilter: {
          category: ["spirit", "ultimate"],
          hasEffectText: true,
        },
        duration: { scope: "turn" },
      });
    }
  });

  it("[board] BSGE01-C17 フラッシュ: 効果記述あり2シンボルは1、効果記述なし2シンボルは通常通り通る", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-flash",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const effectTextAttacker = createCardInstance(BSGE_C17_TARGET_SUMMON_DRAW, {
      instanceId: "bob-effect-text-attacker",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const secondEffectTextAttacker = createCardInstance(
      BSGE_C17_TARGET_SUMMON_DRAW,
      {
        instanceId: "bob-effect-text-attacker-2",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }
    );
    const vanillaAttacker = createCardInstance(BSGE_C17_NO_TEXT_ATTACKER, {
      instanceId: "bob-no-text-attacker",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        source,
        effectTextAttacker,
        secondEffectTextAttacker,
        vanillaAttacker,
      ],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:5590",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "life_damage_interception"
      )
    ).toBe(true);

    const battleState = withBattleResolutionGroup(
      state,
      [
        {
          entityId: "effect-text-entity",
          leaderId: effectTextAttacker.instanceId,
          symbols: 2,
        },
        {
          entityId: "effect-text-entity-2",
          leaderId: secondEffectTextAttacker.instanceId,
          symbols: 2,
        },
        {
          entityId: "no-text-entity",
          leaderId: vanillaAttacker.instanceId,
          symbols: 2,
        },
      ],
      "alice"
    );
    const damage = getUnblockedLifeDamage(battleState, getBSGEDefinition);
    expect(damage?.totalLifeDamage).toBe(3);
    expect(damage?.turnCapConsumed).toBe(1);
  });

  it("[board] BSGE01-C17 フラッシュ: 重複するバトルライフ減少上限は一致bucketすべてに実ダメージを計上する", () => {
    const sourceA = createCardInstance(c, {
      instanceId: "alice-dead-proof-battle-overlap-a",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const sourceB = createCardInstance(c, {
      instanceId: "alice-dead-proof-battle-overlap-b",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const effectTextAttacker = createCardInstance(BSGE_C17_TARGET_SUMMON_DRAW, {
      instanceId: "bob-effect-text-overlap-attacker",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [sourceA, sourceB, effectTextAttacker],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    for (const sourceCard of [sourceA, sourceB]) {
      state = executeEffect({
        chainId: "test:bsge01-cards:5657",
        state,
        effect: c.effects![1]!,
        sourceInstanceId: sourceCard.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredTriggeredEffectActions: () => [],
      });
    }
    const capCEs = state.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "life_damage_interception" &&
        (ce.sourceInstanceId === sourceA.instanceId ||
          ce.sourceInstanceId === sourceB.instanceId)
    );
    expect(capCEs).toHaveLength(2);

    const resolved = executeBattleResolution({
      state: withActiveAttackToPlayer(
        state,
        [
          {
            entityId: "effect-text-overlap-entity",
            leaderId: effectTextAttacker.instanceId,
            symbols: 2,
          },
        ],
        "alice"
      ),
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredBurstActions: undefined,
    });

    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(4);
    for (const ce of capCEs) {
      expect(
        resolved.state.filteredLifeReductionCappedThisTurn?.[
          `alice:${ce.effectId}`
        ]
      ).toBe(1);
    }
  });

  it("[board] BSGE01-C17 フラッシュ: 効果記述あり相手スピリットの効果ライフ減少はターン合計1にクランプする", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-effect-damage",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const damageSource = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "bob-effect-damage-source",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, damageSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:5725",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:5733",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: damageSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:5741",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: damageSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(4);
    expect(state.log).toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
    expect(state.log).toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=1:blocked=2"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: 効果ライフ減少は一致発生源全体でターン合計1にクランプする", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-two-effect-sources",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const damageSourceA = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "bob-effect-damage-source-a",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const damageSourceB = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "bob-effect-damage-source-b",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, damageSourceA, damageSourceB],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:5787",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const c17LifeCapCE = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "life_damage_interception" &&
        ce.sourceInstanceId === source.instanceId
    )!;
    state = executeEffect({
      chainId: "test:bsge01-cards:5800",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: damageSourceA.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:5808",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: damageSourceB.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(4);
    expect(
      state.filteredLifeReductionCappedThisTurn?.[
        `alice:${c17LifeCapCE.effectId}`
      ]
    ).toBe(1);
    expect(state.log).toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=1:blocked=2"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: 重複する効果ライフ減少上限は実ダメージ0ならbucketを消費しない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-overlap-cap-one",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const capZeroSource = createCardInstance(c, {
      instanceId: "alice-dead-proof-overlap-cap-zero",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const damageSource = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "bob-effect-damage-overlap-source",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const capZeroEffect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "life_damage_interception",
            player: "self",
            cause: "opponent",
            mode: "turn_cap",
            cap: 0,
            attackerFilter: {
              category: ["spirit", "ultimate"],
              hasEffectText: true,
            },
            duration: { scope: "turn" },
          },
        },
      ],
      textRef: [0],
    } as const;
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, capZeroSource, damageSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:5875",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const c17LifeCapCE = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "life_damage_interception" &&
        ce.sourceInstanceId === source.instanceId
    )!;
    state = executeEffect({
      chainId: "test:bsge01-cards:5888",
      state,
      effect: capZeroEffect,
      sourceInstanceId: capZeroSource.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:5896",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: damageSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(5);
    expect(
      state.filteredLifeReductionCappedThisTurn?.[
        `alice:${c17LifeCapCE.effectId}`
      ] ?? 0
    ).toBe(0);
  });

  it("[board] BSGE01-C17 フラッシュ: 効果提供元が別 instance の life_damage でも効果記述フィルタを満たす", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-granted-effect",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const hostWithoutText = createCardInstance(BSGE_C17_NO_TEXT_ATTACKER, {
      instanceId: "bob-no-text-host",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const effectTextSource = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "bob-effect-text-source",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, hostWithoutText, effectTextSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:5941",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:5949",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: hostWithoutText.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      effectSourceInstanceId: effectTextSource.instanceId,
      effectSourceDefinitionId: effectTextSource.definitionId,
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(4);
    expect(state.log).toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: 自分が支配する効果記述ありスピリット由来なら相手が発揮してもクランプしない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-owned-source-filter",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const aliceControlledEffectSource = createCardInstance(
      BSGE_C17_EFFECT_DAMAGE_SOURCE,
      {
        instanceId: "alice-controlled-effect-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }
    );
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, aliceControlledEffectSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:5992",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:6000",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: aliceControlledEffectSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(state.log).not.toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: 相手支配の効果記述ありスピリット由来なら自分が発揮してもクランプする", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-opponent-controlled-source",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const bobControlledEffectSource = createCardInstance(
      BSGE_C17_EFFECT_DAMAGE_SOURCE,
      {
        instanceId: "bob-controlled-effect-source",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }
    );
    const selfDamageEffect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "life_damage", player: "self", amount: 2 } }],
      textRef: [0],
    } as const;
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, bobControlledEffectSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6046",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:6054",
      state,
      effect: selfDamageEffect,
      sourceInstanceId: bobControlledEffectSource.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(4);
    expect(state.log).toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: under-card 発生源の core_move は通常フィールド上の効果持ちスピリット扱いしない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-undercard-core-move",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const host = createCardInstance(BSGE_C17_NO_TEXT_ATTACKER, {
      instanceId: "bob-under-host-no-text",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const underSource = createCardInstance(BSGE_C17_EFFECT_CORE_MOVE_SOURCE, {
      instanceId: "bob-under-effect-core-move-source",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 0,
    });
    host.underCards = [
      {
        cardInstanceId: underSource.instanceId,
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, host, underSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6104",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:6112",
      state,
      effect: BSGE_C17_EFFECT_CORE_MOVE_SOURCE.effects![0]!,
      sourceInstanceId: underSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(state.log).not.toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: 手札の効果記述ありスピリット由来 life_damage は通常フィールドの1体として扱わない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-hand-source-filter",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const handDamageSource = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "bob-hand-effect-damage-source",
      ownerPlayerId: "bob",
      zone: "hand",
      cores: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, handDamageSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6150",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:6158",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: handDamageSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(state.log).not.toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: トラッシュの効果記述ありスピリット由来 core_move は通常フィールドの1体として扱わない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-trash-source-filter",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const trashCoreMoveSource = createCardInstance(
      BSGE_C17_EFFECT_CORE_MOVE_SOURCE,
      {
        instanceId: "bob-trash-effect-core-move-source",
        ownerPlayerId: "bob",
        zone: "trash",
        cores: 1,
      }
    );
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, trashCoreMoveSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6198",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeCoreMove(
      state,
      "bob",
      { kind: "life", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      2,
      trashCoreMoveSource.instanceId,
      undefined,
      undefined,
      getBSGEDefinition
    );

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(state.log).not.toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
  });

  it("[board] BSGE01-C17 フラッシュ: discardCostGate を辞退した life_damage はturn_cap bucketを消費する", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-discard-life-cap",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const damageSource = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "bob-effect-damage-discard-cap",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const discardGateCard = createCardInstance(card("BSTH02.7-C05"), {
      instanceId: "alice-discard-gate-life-cap",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, damageSource, discardGateCard],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6252",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const c17LifeCapCE = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "life_damage_interception" &&
        ce.sourceInstanceId === source.instanceId
    )!;
    state = executeEffect({
      chainId: "test:bsge01-cards:6265",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: damageSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(state.pendingLifeDamageDiscardChoice?.pendingAmount).toBe(1);
    expect(
      state.filteredLifeReductionCappedThisTurn?.[
        `alice:${c17LifeCapCE.effectId}`
      ] ?? 0
    ).toBe(0);

    state = declineDiscardGatePending(state);
    expect(
      state.players.find((p) => p.id === "alice")!.lifeNormalCoreCount
    ).toBe(4);
    expect(
      state.filteredLifeReductionCappedThisTurn?.[
        `alice:${c17LifeCapCE.effectId}`
      ]
    ).toBe(1);

    state = executeEffect({
      chainId: "test:bsge01-cards:6291",
      state,
      effect: BSGE_C17_EFFECT_DAMAGE_SOURCE.effects![0]!,
      sourceInstanceId: damageSource.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(state.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(
      state.players.find((p) => p.id === "alice")!.lifeNormalCoreCount
    ).toBe(4);
    expect(
      state.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === discardGateCard.instanceId
      )!.zone
    ).toBe("hand");
    expect(
      state.filteredLifeReductionCappedThisTurn?.[
        `alice:${c17LifeCapCE.effectId}`
      ]
    ).toBe(1);
  });

  it("[board] BSGE01-C17 フラッシュ: discardCostGate を辞退した core_move はturn_cap bucketを消費する", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-discard-core-cap",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const coreMoveSource = createCardInstance(
      BSGE_C17_EFFECT_CORE_MOVE_SOURCE,
      {
        instanceId: "bob-effect-core-move-discard-cap",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }
    );
    const discardGateCard = createCardInstance(card("BSTH02.7-C05"), {
      instanceId: "alice-discard-gate-core-cap",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, coreMoveSource, discardGateCard],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6345",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const c17LifeCapCE = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "life_damage_interception" &&
        ce.sourceInstanceId === source.instanceId
    )!;
    state = executeCoreMove(
      state,
      "bob",
      { kind: "life", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      2,
      coreMoveSource.instanceId,
      undefined,
      undefined,
      getBSGEDefinition
    );

    expect(state.pendingLifeDamageDiscardChoice?.pendingAmount).toBe(1);
    state = declineDiscardGatePending(state);
    expect(
      state.players.find((p) => p.id === "alice")!.lifeNormalCoreCount
    ).toBe(4);
    expect(
      state.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(1);
    expect(
      state.filteredLifeReductionCappedThisTurn?.[
        `alice:${c17LifeCapCE.effectId}`
      ]
    ).toBe(1);

    state = executeCoreMove(
      state,
      "bob",
      { kind: "life", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      2,
      coreMoveSource.instanceId,
      undefined,
      undefined,
      getBSGEDefinition
    );

    expect(state.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(
      state.players.find((p) => p.id === "alice")!.lifeNormalCoreCount
    ).toBe(4);
    expect(
      state.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(1);
    expect(
      state.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === discardGateCard.instanceId
      )!.zone
    ).toBe("hand");
    expect(
      state.filteredLifeReductionCappedThisTurn?.[
        `alice:${c17LifeCapCE.effectId}`
      ]
    ).toBe(1);
  });

  it("[board] BSGE01-C17 フラッシュ: 自分のスピリット効果で自分のライフが減る場合はクランプしない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-self-effect-source",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const damageSource = createCardInstance(BSGE_C17_EFFECT_DAMAGE_SOURCE, {
      instanceId: "alice-effect-damage-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, damageSource],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6436",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:6444",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "life_damage", player: "self", amount: 2 } }],
        textRef: [0],
      },
      sourceInstanceId: damageSource.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(3);
  });

  it("[board] BSGE01-C17 フラッシュ: バトルダメージが別CEで置換された場合はturn_capを消費しない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-replaced-battle",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const effectTextAttacker = createCardInstance(BSGE_C17_TARGET_SUMMON_DRAW, {
      instanceId: "bob-effect-text-replaced-attacker",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const replaceBattleDamageEffect: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "life_damage_interception",
            player: "self",
            cause: "any",
            mode: "replace",
            duration: { scope: "turn" },
          },
        },
      ],
      textRef: [0],
    };
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, effectTextAttacker],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = executeEffect({
      chainId: "test:bsge01-cards:6499",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = executeEffect({
      chainId: "test:bsge01-cards:6507",
      state,
      effect: replaceBattleDamageEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const resolved = executeBattleResolution({
      state: withActiveAttackToPlayer(
        state,
        [
          {
            entityId: "effect-text-replaced-entity",
            leaderId: effectTextAttacker.instanceId,
            symbols: 2,
          },
        ],
        "alice"
      ),
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredBurstActions: undefined,
    });

    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(5);
    expect(resolved.state.lifeReductionCappedThisTurn?.alice ?? 0).toBe(0);
  });

  it("スタック(ゲーム1回)は召喚/契約合体時効果を無効にし、その発生源を破壊するDSL", () => {
    const stack = c.effects![2]!;
    const targetEffectFilter =
      stack.steps[0]!.action.kind === "negate"
        ? stack.steps[0]!.action.targetEffectFilter
        : undefined;
    expect(stack.stub).toBeUndefined();
    expect(stack.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 1,
    });
    expect(stack.steps[0]!.action.kind).toBe("negate");
    expect(stack.steps[0]).toMatchObject({
      id: "negate-summon-or-contract-combine",
      action: {
        kind: "negate",
        negateTarget: "effect",
        targetController: "opponent",
        targetEffectFilter: {
          filterOr: [
            {
              sourceKinds: ["spirit"],
              timingKind: "card_event",
              eventAction: "summon",
              triggerPhrase: "召喚時",
            },
            {
              sourceKinds: ["spirit"],
              timingKind: "card_event",
              eventAction: "brave_combined",
              triggerPhrase: "契約合体時",
            },
          ],
        },
      },
    });
    expect(stack.steps[1]!.action.kind).toBe("destroy");
    expect(stack.steps[1]).toMatchObject({
      action: {
        kind: "destroy",
        target: {
          kind: "ref",
          stepId: "negate-summon-or-contract-combine",
        },
      },
      connector: "sequential",
    });
    const c05SummonRegistration = buildTriggeredEffectLookup([
      card("BSGE01-C05"),
    ])("BSGE01-C05")?.find(
      (registration) =>
        registration.eventKind === "summon" && registration.effectIndex === 1
    );
    expect(
      c05SummonRegistration?.suppressionEffectDescriptor?.triggerPhrases
    ).toEqual(expect.arrayContaining(["召喚時", "契約合体時"]));
    expect(
      matchesEffectTargetFilter(
        targetEffectFilter!,
        c05SummonRegistration?.suppressionEffectDescriptor
      )
    ).toBe(true);
    const c05ContractCombineRegistration = buildTriggeredEffectLookup([
      card("BSGE01-C05"),
    ])("BSGE01-C05")?.find(
      (registration) =>
        registration.eventKind === "brave_combined" &&
        registration.effectIndex === 1
    );
    expect(
      c05ContractCombineRegistration?.suppressionEffectDescriptor
        ?.triggerPhrases
    ).toEqual(expect.arrayContaining(["召喚時", "契約合体時"]));
    expect(
      matchesEffectTargetFilter(
        targetEffectFilter!,
        c05ContractCombineRegistration?.suppressionEffectDescriptor
      )
    ).toBe(true);
    const c06ContractCombineRegistration = buildTriggeredEffectLookup([
      card("BSGE01-C06"),
    ])("BSGE01-C06")?.find(
      (registration) =>
        registration.eventKind === "brave_combined" &&
        registration.effectIndex === 1
    );
    expect(
      c06ContractCombineRegistration?.suppressionEffectDescriptor
        ?.triggerPhrases
    ).toEqual(expect.arrayContaining(["契約合体時", "アタック時"]));
    expect(
      matchesEffectTargetFilter(
        targetEffectFilter!,
        c06ContractCombineRegistration?.suppressionEffectDescriptor
      )
    ).toBe(true);
  });

  it.each([
    ["召喚時", "summon"],
    ["契約合体時", "brave_combined"],
  ] as const)("無効にした%s効果の発生源だけをref破壊する", (_, eventAction) => {
    const triggerPhrase = eventAction === "summon" ? "召喚時" : "契約合体時";
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const target = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-summon-effect-source",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const bystander = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-bystander",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const targetStack: ActiveStack = {
      stackId: "stack:bob-summon-effect",
      actionKind: "triggered_effect",
      chainId: "chain:bob-summon-effect",
      actingPlayerId: "bob",
      cardInstanceId: target.instanceId,
      cardDefinitionId: BSGE_TEST_SPIRIT.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      triggeredSourceKind: "spirit",
      triggeredRegistrationIndex: 0,
      suppressionEffectDescriptor: {
        sourceDefinitionId: BSGE_TEST_SPIRIT.cardNo,
        sourceKind: "spirit",
        effectIndex: 0,
        timingKind: "card_event",
        eventAction,
        triggerPhrases: [triggerPhrase],
      },
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target, bystander],
    });

    const after = executeEffect({
      chainId: "test:bsge01-cards:6688",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      pendingStackNegateCandidate: targetStack,
    });

    expect(after.pendingStackNegateRequests).toHaveLength(1);
    expect(after.pendingStackNegateRequests[0]).toMatchObject({
      negateTarget: "effect",
      targetController: "opponent",
      targetEffectFilter: {
        filterOr: [
          {
            sourceKinds: ["spirit"],
            timingKind: "card_event",
            eventAction: "summon",
            triggerPhrase: "召喚時",
          },
          {
            sourceKinds: ["spirit"],
            timingKind: "card_event",
            eventAction: "brave_combined",
            triggerPhrase: "契約合体時",
          },
        ],
      },
    });
    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.pendingLeaveKind
    ).toBe("destroy");
    const bystanderAfter = after.cardInstances.find(
      (card) => card.instanceId === bystander.instanceId
    );
    expect(bystanderAfter?.zone).toBe("field");
    expect(bystanderAfter?.pendingLeaveKind).toBeNull();
  });

  it("契約合体時ラベルのないbrave_combined効果はref破壊対象にしない", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-dead-proof-normal-combine",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const target = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-normal-combine-effect-source",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const targetStack: ActiveStack = {
      stackId: "stack:bob-normal-combine-effect",
      actionKind: "triggered_effect",
      chainId: "chain:bob-normal-combine-effect",
      actingPlayerId: "bob",
      cardInstanceId: target.instanceId,
      cardDefinitionId: BSGE_TEST_SPIRIT.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      triggeredSourceKind: "spirit",
      triggeredRegistrationIndex: 0,
      suppressionEffectDescriptor: {
        sourceDefinitionId: BSGE_TEST_SPIRIT.cardNo,
        sourceKind: "spirit",
        effectIndex: 0,
        timingKind: "card_event",
        eventAction: "brave_combined",
        triggerPhrases: ["合体時"],
      },
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
    });

    const after = executeEffect({
      chainId: "test:bsge01-cards:6769",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      pendingStackNegateCandidate: targetStack,
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.pendingLeaveKind
    ).toBeNull();
  });

  it.each([
    ["召喚時", "summon"],
    ["契約合体時", "brave_combined"],
  ] as const)(
    "stack cascadeで%s効果を単発nullifyし、turn suppressionを残さない",
    (_, eventAction) => {
      const triggerPhrase = eventAction === "summon" ? "召喚時" : "契約合体時";
      const source = createCardInstance(c, {
        instanceId: "alice-dead-proof-stack",
        ownerPlayerId: "alice",
        zone: "in_use",
      });
      const target = createCardInstance(BSGE_C17_TARGET_SUMMON_DRAW, {
        instanceId: "bob-c17-target-source",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      });
      const deckCard = createCardInstance(BSGE_NEGATE_TEST_DECK_CARD, {
        instanceId: "bob-c17-deck-card",
        ownerPlayerId: "bob",
        zone: "deck",
      });
      const targetStack: ActiveStack = {
        stackId: "stack:bob-c17-target-effect",
        actionKind: "triggered_effect",
        chainId: "chain:bob-c17-target-effect",
        actingPlayerId: "bob",
        cardInstanceId: target.instanceId,
        cardDefinitionId: BSGE_C17_TARGET_SUMMON_DRAW.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        triggeredSourceKind: "spirit",
        triggeredRegistrationIndex: 0,
        triggeredPendingSnapshot: {
          pendingId: "pending:bob-c17-target-effect",
          eventKind: eventAction,
          actingPlayerId: "bob",
          source: "action_resolution",
          chainId: "chain:bob-c17-target-effect",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: target.instanceId,
          amount: null,
          step: "attack",
          window: "stack",
          resolvedSourceInstanceIds: [],
        },
        suppressionEffectDescriptor: {
          sourceDefinitionId: BSGE_C17_TARGET_SUMMON_DRAW.cardNo,
          sourceKind: "spirit",
          effectIndex: 0,
          timingKind: "card_event",
          eventAction,
          triggerPhrases: [triggerPhrase],
        },
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      };
      const deadProofStack: ActiveStack = {
        stackId: "stack:alice-dead-proof",
        actionKind: "magic",
        chainId: "chain:alice-dead-proof",
        actingPlayerId: "alice",
        cardInstanceId: source.instanceId,
        cardDefinitionId: c.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        reducedCost: 0,
        totalReduction: 0,
        chosenTiming: "stack",
        magicEffectIndex: 2,
        previousResponseSourcePlayerId: "bob",
        previousPendingStackAction: targetStack,
      };
      const baseState = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target, deckCard],
      });
      const state: GameState = {
        ...baseState,
        activePlayerId: "bob",
        step: "attack",
        window: "stack",
        stackWindow: {
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          actingPlayerId: "bob",
          previousWindow: "none",
          stackResponseSourcePlayerId: "alice",
          subStackEverOpened: true,
          burstWindowKind: null,
          pendingStackAction: deadProofStack,
        },
      };
      const definitions = BSGE_NEGATE_TEST_DEFINITIONS;
      const lookups = {
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredMagicActions: buildMagicLookup(definitions),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(definitions),
        getRegisteredBurstActions: buildBurstEffectLookup(definitions),
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(definitions),
      };

      const after = applyLegalAction({
        state,
        action: {
          kind: "pass_stack",
          actionId: "pass-c17-stack",
          can: true,
          reason: "test",
          actingPlayerId: "bob",
        },
        ...lookups,
      }).state;

      expect(after.log).toContain(
        "effect:negate:pending-stack:effect:stack:bob-c17-target-effect"
      );
      expect(after.log).not.toContain("effect:draw:bob:1");
      expect(
        after.cardInstances.find(
          (card) => card.instanceId === deckCard.instanceId
        )?.zone
      ).toBe("deck");
      expect(
        after.activeContinuousEffects.some(
          (ce) =>
            ce.sourceInstanceId === source.instanceId &&
            ce.modifierTag === "effect_suppression"
        )
      ).toBe(false);
    }
  );
});

describe("BSGE01-CX01〜CX04 契約スピリット", () => {
  it.each(["BSGE01-CX01", "BSGE01-CX02", "BSGE01-CX03", "BSGE01-CX04"])(
    "%s: contract + 契約合体(魂状態対象)/リンクエイド/バレットエディットは実装済み・無 stub",
    (no) => {
      const c = card(no);
      expect(c.keywordTags).toContain("contract");
      // effects[0]（魂状態への契約合体）は engine の汎用規則
      // (getAvailableContractCombineLegalActions の soulStateContractTargets +
      // buildChargeCoresPendingCoreDistribution, P3-111 S4/S5) で表現済みのため無 stub。
      expect(c.effects![0]!.stub).toBeUndefined();
      expect(c.effects![0]!.textRef).toEqual([0]);
      // effects[1]（リンクエイド）は linkAidData + getAvailableLinkAidLegalActions
      // (P3-111 S6) で表現済みのため無 stub。
      expect(c.effects![1]!.stub).toBeUndefined();
      expect(c.effects![1]!.textRef).toEqual([2, 3]);
      expect(c.linkAidData).toEqual({
        costSourceTribes: ["GE"],
        timingScope: { player: "both", period: "attack" },
      });
      // effects[2]（バレットエディット placement+draw）/ effects[3]（入替）は
      // bullet_edit/swap_bullet_edit DSL Action + use_field_card_effect 汎用経路
      // (P3-111 S7/S11、P3-116 SSOT是正) で表現済みのため無 stub。
      expect(c.effects![2]!.stub).toBeUndefined();
      expect(c.effects![2]!.textRef).toEqual([5, 6]);
      expect(c.effects![3]!.stub).toBeUndefined();
      expect(c.effects![3]!.textRef).toEqual([6]);
    }
  );
});

describe("BSGE01-CX01〜CX04 魂状態への契約合体（P3-111 S4/S5）", () => {
  const braveDef = card("BSGE01-C05"); // contractCombineData: tribes:GE, colors:red/purple

  function makeState(options: {
    hostCardNo: string;
    contractCardNo?: string | null;
    hostInSoulState?: boolean;
  }) {
    const hostDef = card(options.hostCardNo);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
      playerOverrides: [
        {
          soulCoreLocation: { kind: "reserve" },
          reserveNormalCoreCount: 4,
          contractCardNo:
            options.contractCardNo === undefined
              ? hostDef.cardNo
              : options.contractCardNo,
          soulStateInstanceIds:
            options.hostInSoulState === false ? [] : ["host-1"],
        },
      ],
    });
    const lookup = (id: string) =>
      id === braveDef.cardNo
        ? braveDef
        : id === hostDef.cardNo
          ? hostDef
          : undefined;
    return { state: { ...state, step: "main" as const }, hostDef, lookup };
  }

  it("魂状態の契約カード (CX01) は契約合体の対象になる", () => {
    const { state, lookup } = makeState({ hostCardNo: "BSGE01-CX01" });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const cc = actions.filter((a) => a.kind === "contract_combine");
    expect(cc).toHaveLength(1);
    expect(cc[0]).toMatchObject({
      braveInstanceId: "brave-1",
      candidateTargetInstanceIds: ["host-1"],
    });
  });

  it("魂状態でも自分の契約カードでなければ契約合体の対象にならない", () => {
    const { state, lookup } = makeState({
      hostCardNo: "BSGE01-CX01",
      contractCardNo: "BSGE01-CX02", // host は CX01 だが契約カードは CX02
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      0
    );
  });

  it.each(["recovered", "exhausted", "heavily_exhausted"] as const)(
    "%s の契約カードが魂状態を経て契約合体すると疲労を引き継がない",
    (exhaustState) => {
      const {
        state: base,
        hostDef,
        lookup,
      } = makeState({
        hostCardNo: "BSGE01-CX01",
        hostInSoulState: false,
      });
      const hostBefore = base.cardInstances.find(
        (c) => c.instanceId === "host-1"
      )!;
      hostBefore.exhaustState = exhaustState;
      hostBefore.exhaustedByUnpreventableEffect = exhaustState !== "recovered";
      hostBefore.normalCoreCount = 1;
      const state = resolveSoulStateReplacement(
        {
          ...base,
          pendingSoulStateReplacement: {
            choosingPlayerId: "alice",
            cardInstanceId: "host-1",
            originalLeaveKind: "destroy",
            originalLeaveCause: "effect_resolution",
          },
        },
        true,
        lookup
      );
      expect(state.players[0]!.soulStateInstanceIds).toContain("host-1");
      expect(
        state.cardInstances.find((c) => c.instanceId === "host-1")
      ).toMatchObject({
        normalCoreCount: 0,
        exhaustState: "recovered",
        exhaustedByUnpreventableEffect: false,
      });
      const result = applyLegalAction({
        state,
        action: {
          kind: "contract_combine",
          actionId: "test:contract-combine-soul",
          can: true,
          reason: "test",
          actingPlayerId: "alice",
          braveInstanceId: "brave-1",
          braveCardNo: braveDef.cardNo,
          candidateTargetInstanceIds: ["host-1"],
          targetMode: "manual",
          requiredTargetCount: 1,
          targetInstanceId: "host-1",
          targetCardNo: hostDef.cardNo,
        },
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => undefined,
      });

      const newState = passStackAndResolveTarget(
        result.state,
        ["host-1"],
        lookup,
        {
          getRegisteredTriggeredEffectActions: () => undefined,
        }
      );
      const alice = newState.players.find((p) => p.id === "alice")!;
      expect(alice.soulStateInstanceIds).not.toContain("host-1");

      expect(newState.pendingCoreDistribution).not.toBeNull();
      expect(newState.pendingCoreDistribution?.fromKind).toBe("any_movable");
      expect(newState.pendingCoreDistribution?.candidates).toEqual([
        { instanceId: "host-1", definitionId: hostDef.cardNo },
      ]);

      const brave = newState.cardInstances.find(
        (c) => c.instanceId === "brave-1"
      )!;
      expect(brave.attachedToInstanceId).toBe("host-1");
      expect(
        newState.cardInstances.find((c) => c.instanceId === "host-1")
      ).toMatchObject({
        exhaustState: "recovered",
        exhaustedByUnpreventableEffect: false,
      });
      expect(brave.exhaustState).toBe("recovered");
    }
  );
});

describe("BSGE01 リンクエイド（P3-111 S6、CX01〜CX04/R01〜R05）", () => {
  const soulDef = card("BSGE01-CX01"); // linkAidData: tribes:["GE"]
  const geSourceDef = card("BSGE01-R03"); // tribe 神喰・GE・1G, printedCategory:spirit
  const otherSourceDef = card("BSGE01-C05"); // tribe 神喰・神機・1G (GE を含まない、かつ brave)

  function makeState(options: {
    sourceCoreCount?: number;
    inSoulState?: boolean;
    reserveCores?: number;
  }) {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(soulDef, {
          instanceId: "soul-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(geSourceDef, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: options.sourceCoreCount ?? 1,
        }),
        // reserve_only 検証用の傍観者: フィールド上にコアを持つ別カード（GE 系統では
        // ないため link_aid のコスト源候補には出ない）があっても、
        // pendingCoreDistribution の配置先候補には含まれないことを確認する。
        createCardInstance(otherSourceDef, {
          instanceId: "bystander-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: options.reserveCores ?? 3,
          soulStateInstanceIds: options.inSoulState === false ? [] : ["soul-1"],
        },
      ],
    });
    const lookup = (id: string) =>
      id === soulDef.cardNo
        ? soulDef
        : id === geSourceDef.cardNo
          ? geSourceDef
          : id === otherSourceDef.cardNo
            ? otherSourceDef
            : undefined;
    return {
      state: {
        ...state,
        step: "attack" as const,
        window: "flash_before_block" as const,
        activePlayerId: "bob",
        activeAttack: {
          attackId: "link-aid-flash",
          primaryEntityId: "be-link-aid-attacker",
          participantEntityIds: ["be-link-aid-attacker"],
          groupMode: "single" as const,
          target: { kind: "player" as const, playerId: "alice" },
          blockAssignments: [
            {
              participantEntityId: "be-link-aid-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["be-link-aid-attacker"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block" as const,
            priorityPlayerId: "alice",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: "alice",
            pendingStackAction: null,
          },
        },
      },
      lookup,
    };
  }

  it("魂状態のカード + GE スピリット(コア1個以上)で link_aid が列挙される", () => {
    const { state, lookup } = makeState({});
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const la = actions.filter((a) => a.kind === "link_aid");
    expect(la).toHaveLength(1);
    expect(la[0]).toMatchObject({
      soulStateCardInstanceId: "soul-1",
    });
    expect("costSourceInstanceId" in la[0]!).toBe(false);
  });

  it("コスト源のコアが0個なら link_aid は列挙されない", () => {
    const { state, lookup } = makeState({ sourceCoreCount: 0 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "link_aid")).toHaveLength(0);
  });

  it("魂状態でなければ link_aid は列挙されない", () => {
    const { state, lookup } = makeState({ inSoulState: false });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "link_aid")).toHaveLength(0);
  });

  it("before_block フラッシュが閉じたブロック宣言待ちでは link_aid を列挙しない", () => {
    const { state, lookup } = makeState({});
    const actions = getLegalActions({
      state: {
        ...state,
        window: "declare_attack",
        activeAttack: state.activeAttack
          ? {
              ...state.activeAttack,
              flashBeforeBlockCompleted: true,
              flashWindowState: null,
            }
          : null,
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "link_aid")).toHaveLength(0);
    expect(actions.some((a) => a.kind === "decline_block")).toBe(true);
  });

  it("GE を含まない系統のスピリットはコスト源にならない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(soulDef, {
          instanceId: "soul-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(otherSourceDef, {
          instanceId: "other-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ soulStateInstanceIds: ["soul-1"] }],
    });
    const lookup = (id: string) =>
      id === soulDef.cardNo
        ? soulDef
        : id === otherSourceDef.cardNo
          ? otherSourceDef
          : undefined;
    const actions = getLegalActions({
      state: {
        ...makeState({}).state,
        cardInstances: state.cardInstances,
        players: state.players,
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "link_aid")).toHaveLength(0);
  });

  it("適用: コスト源のコア1個がボイドへ、魂状態を離れ、reserve_only の任意コア配置が開く（召喚扱いではない）", () => {
    const { state, lookup } = makeState({});
    const beforeVoid = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    const result = applyLegalAction({
      state,
      action: {
        kind: "link_aid",
        actionId: "test:link-aid",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        soulStateCardInstanceId: "soul-1",
        soulStateCardNo: soulDef.cardNo,
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    const declared = result.state;
    const declaredSource = declared.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    const declaredAlice = declared.players.find((p) => p.id === "alice")!;
    expect(declaredSource.normalCoreCount).toBe(1);
    expect(declaredAlice.voidNormalCoreCount).toBe(beforeVoid);
    expect(declaredAlice.soulStateInstanceIds).toContain("soul-1");
    expect(declared.pendingLinkAidCostSourceChoice).toBeNull();
    expect(
      declared.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({
      actionKind: "link_aid",
      cardInstanceId: "soul-1",
    });
    expect(
      (
        declared.activeAttack?.flashWindowState?.pendingStackAction as {
          linkAidCostSourceInstanceId?: string;
        } | null
      )?.linkAidCostSourceInstanceId
    ).toBeUndefined();

    const newState = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    const alice = newState.players.find((p) => p.id === "alice")!;
    // 魂状態を離れる（召喚扱いではない state-change）。
    expect(alice.soulStateInstanceIds).not.toContain("soul-1");
    // 召喚時効果は誘発しない（trigger キューは空のまま）。
    expect(newState.pendingTriggeredEffects).toHaveLength(0);

    // コスト源のコア1個がボイドへ（固定1、疲労ではない）。
    const source = newState.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    expect(source.normalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(beforeVoid + 1);
    expect(source.exhaustState).toBe("recovered");

    // reserve_only: フィールドにコアを持つ別カード (bystander-1) があっても、
    // 配置元候補には含まれない（field_and_reserve 既定との差分）。
    const bystander = newState.cardInstances.find(
      (c) => c.instanceId === "bystander-1"
    )!;
    expect(bystander.normalCoreCount).toBe(2);
    expect(newState.pendingCoreDistribution).not.toBeNull();
    expect(newState.pendingCoreDistribution?.fromKind).toBe("any_movable");
    expect(newState.pendingCoreDistribution?.allowedSources).toEqual([
      { kind: "reserve" },
    ]);
    expect(newState.pendingCoreDistribution?.candidates).toEqual([
      { instanceId: "soul-1", definitionId: soulDef.cardNo },
    ]);
  });

  it("不発: 窓中にコスト源スピリットが場を離れたら、パス後も魂状態のまま・コア未消費 (P3-112 fizzle)", () => {
    const { state, lookup } = makeState({});
    const beforeVoid = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    const declared = applyLegalAction({
      state,
      action: {
        kind: "link_aid",
        actionId: "test:link-aid-fizzle",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        soulStateCardInstanceId: "soul-1",
        soulStateCardNo: soulDef.cardNo,
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    expect(
      declared.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();

    // 窓中にコスト源スピリットが場を離れる (相手効果でトラッシュへ、を模擬)。
    const sourceLeftField: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "source-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const passAction = getLegalActions({
      state: sourceLeftField,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_battle_flash");
    expect(passAction).toBeDefined();
    const resolved = applyLegalAction({
      state: sourceLeftField,
      action: passAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    // 不発: 魂状態のまま、コア配置 pending も立たない。
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.soulStateInstanceIds).toContain("soul-1");
    expect(alice.voidNormalCoreCount).toBe(beforeVoid);
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(resolved.log.some((l) => l.includes("[LinkAid]"))).toBe(true);
  });
});

describe("BSGE01-C03「ディソレイト」フラッシュ: 空木レンカ存在時のリンクエイド書き換え (grant_link_aid_cost_override, bsge01-c03-linkaid-rewrite)", () => {
  const disolateDef = card("BSGE01-C03");
  const renkaDef = card("BSGE01-CX03"); // 空木 レンカ
  const soulDef = card("BSGE01-CX01"); // linkAidData: costSourceTribes:["GE"]
  const nonGeSourceDef = card("BSGE01-C05"); // tribe 神喰・神機・1G (GE を含まない)
  const flashEffect = disolateDef.effects![1]!;

  function makeState(options: {
    renkaOnField?: boolean;
    reserveCores?: number;
  }) {
    const disolate = createCardInstance(disolateDef, {
      instanceId: "disolate-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const soul = createCardInstance(soulDef, {
      instanceId: "soul-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const nonGeSource = createCardInstance(nonGeSourceDef, {
      instanceId: "non-ge-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const cardInstances = [disolate, soul, nonGeSource];
    if (options.renkaOnField !== false) {
      cardInstances.push(
        createCardInstance(renkaDef, {
          instanceId: "renka-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        })
      );
    }
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances,
      playerOverrides: [
        {
          reserveNormalCoreCount: options.reserveCores ?? 3,
          soulStateInstanceIds: ["soul-1"],
        },
      ],
    });
    const lookup = (id: string) => cardNoMap.get(id);
    return {
      state: {
        ...state,
        step: "attack" as const,
        window: "flash_before_block" as const,
        activePlayerId: "bob",
        activeAttack: {
          attackId: "link-aid-override-flash",
          primaryEntityId: "be-link-aid-override-attacker",
          participantEntityIds: ["be-link-aid-override-attacker"],
          groupMode: "single" as const,
          target: { kind: "player" as const, playerId: "alice" },
          blockAssignments: [
            {
              participantEntityId: "be-link-aid-override-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["be-link-aid-override-attacker"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block" as const,
            priorityPlayerId: "alice",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: "alice",
            pendingStackAction: null,
          },
        },
      },
      lookup,
    };
  }

  it("空木レンカがいなければ condition 不成立で no-op（CE 未登録）", () => {
    const { state, lookup } = makeState({ renkaOnField: false });
    const after = executeEffect({
      chainId: "test:bsge01-cards:7527",
      state,
      effect: flashEffect,
      sourceInstanceId: "disolate-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "grant_link_aid_cost_override"
      )
    ).toBe(false);
  });

  it("空木レンカ存在時、grant_link_aid_cost_override CE（player-scoped, duration turn）を自分に登録する", () => {
    const { state, lookup } = makeState({});
    const after = executeEffect({
      chainId: "test:bsge01-cards:7544",
      state,
      effect: flashEffect,
      sourceInstanceId: "disolate-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const ce = after.activeContinuousEffects.find(
      (c) => c.modifierTag === "grant_link_aid_cost_override"
    );
    expect(ce).toBeDefined();
    expect(ce?.targetInstanceId).toBe("alice");
    expect(ce?.duration).toEqual({ scope: "turn" });
  });

  it("CE 有効時: GE を含まない系統のフィールドカード、およびリザーブも窓後の link_aid コスト源候補になる（costSourceTribes 不問への拡張）", () => {
    const { state, lookup } = makeState({});
    const afterFlash = executeEffect({
      chainId: "test:bsge01-cards:7562",
      state,
      effect: flashEffect,
      sourceInstanceId: "disolate-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const actions = getLegalActions({
      state: afterFlash,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const linkAidActions = actions.filter((a) => a.kind === "link_aid");
    expect(linkAidActions).toHaveLength(1);
    const declared = applyLegalAction({
      state: afterFlash,
      action: linkAidActions[0]!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    const afterStack = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    const costSources =
      afterStack.pendingLinkAidCostSourceChoice?.candidates
        .map((candidate) => candidate.costSourceInstanceId)
        .sort() ?? [];
    // baseline (override 無し) では non-ge-source-1 は除外される (前段の
    // 「GE を含まない系統のスピリットはコスト源にならない」テストと対称)。
    expect(costSources).toEqual(
      ["non-ge-source-1", "reserve", "renka-1"].sort()
    );
    const pendingActions = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    })
      .filter(
        (
          a
        ): a is Extract<
          LegalAction,
          { kind: "resolve_pending_link_aid_cost_source_choice" }
        > => a.kind === "resolve_pending_link_aid_cost_source_choice"
      )
      .map((a) => a.costSourceInstanceId)
      .sort();
    expect(pendingActions).toEqual(costSources);
  });

  it("適用: リザーブをコスト源に link_aid → リザーブのコア1個がボイドへ、魂状態を離れ、field_and_reserve の任意コア配置が開く", () => {
    const { state, lookup } = makeState({});
    const afterFlash = executeEffect({
      chainId: "test:bsge01-cards:7619",
      state,
      effect: flashEffect,
      sourceInstanceId: "disolate-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const beforeReserve = afterFlash.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;
    const beforeVoid = afterFlash.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;

    const linkAidAction = getLegalActions({
      state: afterFlash,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((a) => a.kind === "link_aid");
    expect(linkAidAction).toBeDefined();

    const declared = applyLegalAction({
      state: afterFlash,
      action: linkAidAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const afterStack = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(afterStack.pendingLinkAidCostSourceChoice).not.toBeNull();
    expect(
      afterStack.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(beforeReserve);
    const reserveChoice = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (
        a
      ): a is Extract<
        LegalAction,
        { kind: "resolve_pending_link_aid_cost_source_choice" }
      > =>
        a.kind === "resolve_pending_link_aid_cost_source_choice" &&
        a.costSourceInstanceId === "reserve"
    );
    expect(reserveChoice).toBeDefined();
    const newState = applyLegalAction({
      state: afterStack,
      action: reserveChoice!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    const alice = newState.players.find((p) => p.id === "alice")!;
    // 魂状態を離れる。
    expect(alice.soulStateInstanceIds).not.toContain("soul-1");
    // 起動コスト: リザーブの通常コア1個がボイドへ（固定1）。
    expect(alice.reserveNormalCoreCount).toBe(beforeReserve - 1);
    expect(alice.voidNormalCoreCount).toBe(beforeVoid + 1);

    // field_and_reserve: 自分のフィールドカード (non-ge-source-1 / renka-1) も
    // charge のソース候補に含まれる (reserve_only の baseline との差分)。
    expect(newState.pendingCoreDistribution).not.toBeNull();
    expect(newState.pendingCoreDistribution?.fromKind).toBe("any_movable");
    const sourceKinds = newState.pendingCoreDistribution?.allowedSources?.map(
      (s) => s.kind
    );
    expect(sourceKinds).toContain("reserve");
    expect(sourceKinds).toContain("field");
  });
});

describe("BSGE01 バレットエディット（P3-111 S7、CX01〜CX04、P3-116 SSOT是正: bullet_edit DSL Action）", () => {
  const hostDef = card("BSGE01-CX01");
  // バレットエディット下トリガーを持たない無関係カードで検証する
  // (BSGE01-R03/R04/R05 は「バレットエディット下にあるとき」の固有能力を持つため、
  // 置いた瞬間に burst/CE 付与が誘発し再列挙アサーションを汚染してしまう)。
  const handDef = card("BSSL01-C02"); // 置く手札カードは任意（tribe 等不問）
  const fieldLookup = buildFieldCardEffectLookup([hostDef]);
  const lookup = (id: string) =>
    id === hostDef.cardNo
      ? hostDef
      : id === handDef.cardNo
        ? handDef
        : undefined;

  function makeState(options: {
    handCardCount?: number;
    step?: "main" | "attack";
    activePlayerId?: "alice" | "bob";
    noHost?: boolean;
    inSoulState?: boolean;
  }): GameState {
    const handCardCount = options.handCardCount ?? 2;
    const handCards = Array.from({ length: handCardCount }, (_, i) =>
      createCardInstance(handDef, {
        instanceId: `hand-${i + 1}`,
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const hostCard = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: options.inSoulState ? 0 : 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: options.noHost ? handCards : [hostCard, ...handCards],
      playerOverrides: [
        {
          handCount: handCardCount,
          soulStateInstanceIds: options.inSoulState ? ["host-1"] : [],
        },
      ],
    });
    return {
      ...state,
      step: options.step ?? ("main" as const),
      activePlayerId: options.activePlayerId ?? "alice",
    };
  }

  function findBulletEditAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.timing === "normal"
    );
  }

  it("自分のメインステップに host + 手札があれば、手札全てを候補にした1つの legal action が列挙される", () => {
    const state = makeState({ handCardCount: 2 });
    const action = findBulletEditAction(state);
    expect(action).toBeDefined();
    expect(action).toMatchObject({
      sourceInstanceId: "host-1",
      sourceCardNo: hostDef.cardNo,
      requiredTargetCount: 1,
    });
    expect(
      (
        action as { candidateTargetInstanceIds: string[] }
      ).candidateTargetInstanceIds
        .slice()
        .sort()
    ).toEqual(["hand-1", "hand-2"]);
  });

  it("手札が無ければ列挙されない", () => {
    const state = makeState({ handCardCount: 0 });
    expect(findBulletEditAction(state)).toBeUndefined();
  });

  it("原文「このカード/スピリット」通り、魂状態のホストからも列挙される", () => {
    const state = makeState({ handCardCount: 1, inSoulState: true });
    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.soulStateInstanceIds).toContain("host-1");
    const action = findBulletEditAction(state);
    expect(action).toBeDefined();
    expect(
      (action as { candidateTargetInstanceIds: string[] })
        .candidateTargetInstanceIds
    ).toEqual(["hand-1"]);
  });

  it("host が居ないと列挙されない", () => {
    const state = makeState({ handCardCount: 1, noHost: true });
    expect(findBulletEditAction(state)).toBeUndefined();
  });

  it("フラッシュ明記なしのため自分のメインステップ限定: アタックステップでは列挙されない", () => {
    const state = makeState({ step: "attack" });
    expect(findBulletEditAction(state)).toBeUndefined();
  });

  it("相手のメインステップでは列挙されない（自分のメインステップ限定）", () => {
    const state = makeState({ activePlayerId: "bob" });
    expect(findBulletEditAction(state)).toBeUndefined();
  });

  it("宣言でスタック窓を開く（P3-116: 02:190 常時以外の効果発揮）", () => {
    const state = makeState({ handCardCount: 2 });
    const declaration = findBulletEditAction(state)!;
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    expect(declared.stackWindow).not.toBeNull();
    // 対象は窓クローズ後の解決時に選ぶため、手札はまだ動いていない。
    const handCard = declared.cardInstances.find(
      (c) => c.instanceId === "hand-1"
    )!;
    expect(handCard.zone).toBe("hand");
  });

  function resolveThroughPassAndTarget(
    state: GameState,
    declaration: NonNullable<ReturnType<typeof findBulletEditAction>>,
    targetInstanceIds: string[]
  ): GameState {
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack")!;
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(targetSelection).toBeDefined();

    return applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
  }

  it("適用: 窓クローズ後、手札1枚が host の下(text_role roleTag=バレットエディット)へ、handCount-1、デッキ1ドロー", () => {
    const state = makeState({ handCardCount: 2 });
    const beforeAlice = state.players.find((p) => p.id === "alice")!;
    const declaration = findBulletEditAction(state)!;
    const newState = resolveThroughPassAndTarget(state, declaration, [
      "hand-1",
    ]);

    const host = newState.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "hand-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ]);
    const placed = newState.cardInstances.find(
      (c) => c.instanceId === "hand-1"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.attachedToInstanceId).toBe("host-1");
    expect(placed.faceDown).toBe(false);

    const alice = newState.players.find((p) => p.id === "alice")!;
    // 手札1枚が下へ (-1) → ドロー1 (+1) で手札枚数は差し引きゼロだが、
    // デッキは1枚減っている（executeDraw 経由）。
    expect(alice.handCount).toBe(beforeAlice.handCount - 1 + 1);
    expect(alice.deckCount).toBe(beforeAlice.deckCount - 1);
    expect(
      newState.log.some((l) => l.includes("effect:bullet_edit:hand-1"))
    ).toBe(true);
    expect(newState.log).toContain("effect:draw:alice:1");
  });

  it("適用直後: 下に置いたカードの継続効果が current state に反映される", () => {
    const underDef = card("BSGE01-R05");
    const localLookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === underDef.cardNo
          ? underDef
          : undefined;
    const localFieldLookup = buildFieldCardEffectLookup([hostDef]);
    const localTriggeredLookup = buildTriggeredEffectLookup([
      hostDef,
      underDef,
    ]);
    const hostCard = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const underHand = createCardInstance(underDef, {
      instanceId: "hand-r05",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [hostCard, underHand],
        playerOverrides: [{ handCount: 1 }],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const declaration = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: localLookup,
      getRegisteredFieldCardEffectActions: localFieldLookup,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.timing === "normal"
    )!;
    expect(declaration).toBeDefined();
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: localLookup,
      getRegisteredFieldCardEffectActions: localFieldLookup,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: localLookup,
      getRegisteredFieldCardEffectActions: localFieldLookup,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
    }).find((a) => a.kind === "pass_stack")!;
    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: localLookup,
      getRegisteredFieldCardEffectActions: localFieldLookup,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
    }).state;
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: localLookup,
      getRegisteredFieldCardEffectActions: localFieldLookup,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;

    const newState = applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds: ["hand-r05"],
      getCardDefinitionById: localLookup,
      getRegisteredFieldCardEffectActions: localFieldLookup,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
    }).state;

    const hostAfter = newState.cardInstances.find(
      (c) => c.instanceId === "host-1"
    )!;
    expect(
      newState.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "symbol_addition" &&
          ce.targetInstanceId === "host-1" &&
          ce.provenance?.effectSourceInstanceId === "hand-r05"
      )
    ).toBe(true);
    expect(
      getEffectiveSymbols(newState, hostAfter, hostDef, localLookup)
    ).toContain("yellow");
  });

  it("使用制限: 適用後は同じホストからの再度の bullet_edit が列挙されない（ゲーム中に1回）", () => {
    const state = makeState({ handCardCount: 2 });
    const declaration = findBulletEditAction(state)!;
    const newState = resolveThroughPassAndTarget(state, declaration, [
      "hand-1",
    ]);

    // hand-2 相当（ドローで補充された1枚）はまだ残っているが、使用制限で阻止される。
    expect(findBulletEditAction(newState)).toBeUndefined();
  });

  it("離脱時破棄: host がフィールドを離れるとき、バレットエディットアンダーカードはトラッシュへ破棄される", () => {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-host-1",
    });
    host.underCards = [
      {
        cardInstanceId: "bullet-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const bullet = createCardInstance(handDef, {
      instanceId: "bullet-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    bullet.attachedToInstanceId = "host-1";
    bullet.zoneRoleName = "bullet-edit";

    const state = createEmptyGameState({
      cardInstances: [host, bullet],
      playerIds: ["alice", "bob"],
    });
    state.pendingLeaveEntities = [
      {
        instanceId: "host-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "chain-host-1",
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      },
    ];

    const after = flushPendingLeaves(state, lookup);

    const after_bullet = after.cardInstances.find(
      (c) => c.instanceId === "bullet-1"
    )!;
    expect(after_bullet.zone).toBe("trash");
    expect(after_bullet.attachedToInstanceId).toBeNull();

    const afterHost = after.cardInstances.find(
      (c) => c.instanceId === "host-1"
    )!;
    expect(afterHost.underCards).toEqual([]);
  });
});

describe("BSGE01 バレットエディット入替（P3-111 S11、CX01〜CX04「フラッシュタイミングで手札1枚と入れ替えられ」、P3-116 SSOT是正: swap_bullet_edit DSL Action）", () => {
  const hostDef = card("BSGE01-CX01");
  // バレットエディット下トリガーを持たない無関係カードで検証する（上のブロックと同理由）。
  const underDef = card("BSSL01-C05"); // 既存下カード（tribe等不問）
  const handDef = card("BSSL01-C02"); // 入替先の手札カード
  const fieldLookup = buildFieldCardEffectLookup([hostDef]);
  const lookup = (id: string) =>
    id === hostDef.cardNo
      ? hostDef
      : id === underDef.cardNo
        ? underDef
        : id === handDef.cardNo
          ? handDef
          : undefined;

  function makeState(options: {
    hasUnderCard?: boolean;
    handCardCount?: number;
    step?: "main" | "attack";
    activePlayerId?: "alice" | "bob";
    battleFlashWindow?: boolean;
    underRoleTag?: string;
  }): GameState {
    const hasUnderCard = options.hasUnderCard ?? true;
    const handCardCount = options.handCardCount ?? 1;
    const handCards = Array.from({ length: handCardCount }, (_, i) =>
      createCardInstance(handDef, {
        instanceId: `hand-${i + 1}`,
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    if (hasUnderCard) {
      host.underCards = [
        {
          cardInstanceId: "under-1",
          role: "text_role",
          roleTag: options.underRoleTag ?? "バレットエディット",
        },
      ];
      under.attachedToInstanceId = "host-1";
      under.zoneRoleName = "bullet-edit";
    }
    const cardInstances = hasUnderCard
      ? [host, under, ...handCards]
      : [host, ...handCards];
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances,
      playerOverrides: [{ handCount: handCardCount }],
      ...(options.battleFlashWindow
        ? {
            activeAttack: {
              attackId: "test-attack",
              primaryEntityId: "be-test",
              participantEntityIds: ["be-test"],
              groupMode: "single",
              target: { kind: "player", playerId: "alice" },
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
          }
        : {}),
    });
    return {
      ...state,
      step: options.step ?? ("main" as const),
      activePlayerId: options.activePlayerId ?? "alice",
      ...(options.battleFlashWindow
        ? { window: "flash_before_block" as const }
        : {}),
    };
  }

  function findSwapBulletEditAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.timing === "flash"
    );
  }

  it("自分のメインステップ、下カードあり＋手札ありなら、手札全てを候補にした1つの legal action が列挙される", () => {
    const state = makeState({ handCardCount: 2 });
    const action = findSwapBulletEditAction(state);
    expect(action).toBeDefined();
    expect(
      (
        action as { candidateTargetInstanceIds: string[] }
      ).candidateTargetInstanceIds
        .slice()
        .sort()
    ).toEqual(["hand-1", "hand-2"]);
  });

  it("旧スナップショット互換: roleTag=装弾 の下カードでも入替 legal action が列挙される", () => {
    const state = makeState({ handCardCount: 1, underRoleTag: "装弾" });
    expect(findSwapBulletEditAction(state)).toBeDefined();
  });

  it("下カードが無ければ列挙されない（入替対象が無い）", () => {
    const state = makeState({ hasUnderCard: false });
    expect(findSwapBulletEditAction(state)).toBeUndefined();
  });

  it("手札が無ければ列挙されない", () => {
    const state = makeState({ handCardCount: 0 });
    expect(findSwapBulletEditAction(state)).toBeUndefined();
  });

  it("原文にスコープ指定が無いため、通常のフラッシュ機会が無い相手のメインステップでは列挙されない", () => {
    const state = makeState({ activePlayerId: "bob" });
    expect(findSwapBulletEditAction(state)).toBeUndefined();
  });

  it("バトルフラッシュ窓 (activeAttack.flashWindowState) 中でも列挙される（bullet_edit 本体はメイン限定だが入替はフラッシュ全般）", () => {
    const state = makeState({
      step: "attack",
      activePlayerId: "bob",
      battleFlashWindow: true,
    });
    expect(findSwapBulletEditAction(state)).toBeDefined();
  });

  it("適用: 下カードが手札へ戻り、指定手札がホストの下(text_role roleTag=バレットエディット)へ、手札枚数は差し引きゼロ・ドロー無し", () => {
    const state = makeState({ handCardCount: 1 });
    const beforeAlice = state.players.find((p) => p.id === "alice")!;
    const declaration = findSwapBulletEditAction(state)!;

    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack")!;
    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(targetSelection).toBeDefined();
    const newState = applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds: ["hand-1"],
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const host = newState.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "hand-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ]);

    const incoming = newState.cardInstances.find(
      (c) => c.instanceId === "hand-1"
    )!;
    expect(incoming.zone).toBe("field");
    expect(incoming.attachedToInstanceId).toBe("host-1");
    expect(incoming.faceDown).toBe(false);

    const outgoing = newState.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    expect(outgoing.zone).toBe("hand");
    expect(outgoing.attachedToInstanceId).toBeNull();
    expect(outgoing.faceDown).toBe(false);

    const alice = newState.players.find((p) => p.id === "alice")!;
    // 手札1枚が下へ (-1)、下カード1枚が手札へ (+1) で差し引きゼロ。ドローは発生しない
    // (bullet_edit 本体との違い)。
    expect(alice.handCount).toBe(beforeAlice.handCount);
    expect(alice.deckCount).toBe(beforeAlice.deckCount);
    expect(
      newState.log.some((l) =>
        l.includes("effect:swap_bullet_edit:under-1<->hand-1")
      )
    ).toBe(true);
  });

  it("使用制限なし: 入替を適用した直後でも、条件を満たせば再度 swap_bullet_edit が列挙される（ゲーム1回制限の bullet_edit 本体とは独立）", () => {
    const state = makeState({ handCardCount: 1 });
    const declaration = findSwapBulletEditAction(state)!;
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack")!;
    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    const resolvedTarget = applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds: ["hand-1"],
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    // under-1 がフィールドを離れたことで汎用バーストチェックが積まれる
    // (P3-116 是正で generic executeEffect 経路に乗ったため、旧 atomic executor には
    // 無かった正しい副作用)。バーストが1つも無いため no-source generic resolve で進める。
    const declineBurst = getLegalActions({
      state: resolvedTarget,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_burst_check")!;
    expect(declineBurst).toBeDefined();
    const newState = applyLegalAction({
      state: resolvedTarget,
      action: declineBurst,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    // 元々下にあった under-1 が今度は手札にいるので、再度の入替候補として使える。
    const action = findSwapBulletEditAction(newState);
    expect(action).toBeDefined();
    expect(
      (action as { candidateTargetInstanceIds: string[] })
        .candidateTargetInstanceIds
    ).toEqual(["under-1"]);
  });
});

describe("P3-116 bullet_edit/swap_bullet_edit ネイティブハンドラ (executeEffect 直接検証)", () => {
  const hostDef = card("BSGE01-CX01");
  const handDef = card("BSSL01-C02");
  const existingUnderDef = card("BSSL01-C05");
  const lookup = (id: string) =>
    id === hostDef.cardNo
      ? hostDef
      : id === handDef.cardNo
        ? handDef
        : id === existingUnderDef.cardNo
          ? existingUnderDef
          : undefined;

  function makeState(options: {
    hostOnField?: boolean;
    slotFull?: boolean;
    handInHand?: boolean;
    existingUnderRoleTag?: string;
  }): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: options.hostOnField === false ? "trash" : "field",
      normalCoreCount: 1,
    });
    const existingUnder = options.slotFull
      ? createCardInstance(existingUnderDef, {
          instanceId: "existing-under",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        })
      : undefined;
    if (existingUnder) {
      existingUnder.attachedToInstanceId = "host-1";
      existingUnder.zoneRoleName = "bullet-edit";
      host.underCards = [
        {
          cardInstanceId: "existing-under",
          role: "text_role",
          roleTag: options.existingUnderRoleTag ?? "バレットエディット",
        },
      ];
    }
    const hand = createCardInstance(handDef, {
      instanceId: "hand-1",
      ownerPlayerId: "alice",
      zone: options.handInHand === false ? "trash" : "hand",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: existingUnder
          ? [host, hand, existingUnder]
          : [host, hand],
      }),
      activePlayerId: "alice",
    };
  }

  it("bullet_edit: host がフィールドに無ければ no-op（ドロー付き後続 step も発火しない）", () => {
    const state = makeState({ hostOnField: false });
    const next = executeEffect({
      chainId: "test:bsge01-cards:8445",
      state,
      effect: hostDef.effects![2]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    expect(next.log.includes("effect:applicability-unmet:host-1")).toBe(true);
    expect(
      next.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
    ).toBe("hand");
    expect(next.log).not.toContain("effect:draw:alice:1");
  });

  it("bullet_edit: バレットエディットスロットが埋まっていれば no-op（そうしたとき、のドローも発火しない）", () => {
    const state = makeState({ slotFull: true });
    const next = executeEffect({
      chainId: "test:bsge01-cards:8467",
      state,
      effect: hostDef.effects![2]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "existing-under",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ]);
    expect(
      next.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
    ).toBe("hand");
    expect(next.log).not.toContain("effect:draw:alice:1");
  });

  it("bullet_edit: 対象が手札に無ければ no-op", () => {
    const state = makeState({ handInHand: false });
    const next = executeEffect({
      chainId: "test:bsge01-cards:8492",
      state,
      effect: hostDef.effects![2]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([]);
    expect(next.log).not.toContain("effect:draw:alice:1");
  });

  it("bullet_edit: 成功時は「そうしたとき」のドローが ref_succeeded 経由で発火する", () => {
    const state = makeState({});
    const next = executeEffect({
      chainId: "test:bsge01-cards:8508",
      state,
      effect: hostDef.effects![2]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "hand-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ]);
    expect(next.log).toContain("effect:draw:alice:1");
  });

  it("swap_bullet_edit: 既存の下カードが無ければ no-op", () => {
    const state = makeState({});
    const next = executeEffect({
      chainId: "test:bsge01-cards:8530",
      state,
      effect: hostDef.effects![3]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    expect(
      next.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
    ).toBe("hand");
  });

  it("swap_bullet_edit: 入替先が手札に無ければ no-op", () => {
    const state = makeState({ slotFull: true, handInHand: false });
    const next = executeEffect({
      chainId: "test:bsge01-cards:8546",
      state,
      effect: hostDef.effects![3]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "existing-under",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ]);
  });

  it("swap_bullet_edit: 成功時は下カードが手札へ、指定手札が下へ入れ替わる", () => {
    const state = makeState({ slotFull: true });
    const next = executeEffect({
      chainId: "test:bsge01-cards:8567",
      state,
      effect: hostDef.effects![3]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "hand-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ]);
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "existing-under"
    );
    expect(outgoing?.zone).toBe("hand");
    const incoming = next.cardInstances.find((c) => c.instanceId === "hand-1")!;
    expect(incoming.zone).toBe("field");
    expect(incoming.attachedToInstanceId).toBe("host-1");
  });

  it("swap_bullet_edit: 旧 roleTag=装弾 の既存下カードも入替元として扱い、新規 roleTag へ正規化する", () => {
    const state = makeState({
      slotFull: true,
      existingUnderRoleTag: "装弾",
    });
    const next = executeEffect({
      chainId: "test:bsge01-cards:8598",
      state,
      effect: hostDef.effects![3]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      targetInstanceIds: ["hand-1"],
      targetSelectionResolved: true,
    });
    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "hand-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ]);
    expect(
      next.cardInstances.find((c) => c.instanceId === "existing-under")?.zone
    ).toBe("hand");
  });
});

describe("BSGE01-C09〜C13 契約合体プロキシ起動（P3-111 S4）", () => {
  const braveDef = card("BSGE01-C05"); // contractCombineData: tribes:GE, colors:red/purple
  const targetDef = card("BSGE01-CX01"); // 神薙ユウ: tribe 神喰・GE・2G, colors:red → braveCondition 適合

  function makeState(options: {
    nexusCardNo: string;
    nexusCores: number;
    soulCoreAvailable?: boolean;
    targetCardNo?: string;
  }) {
    const nexusDef = card(options.nexusCardNo);
    const resolvedTargetDef =
      options.targetCardNo !== undefined
        ? card(options.targetCardNo)
        : targetDef;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(nexusDef, {
          instanceId: "nexus-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: options.nexusCores,
        }),
        createCardInstance(resolvedTargetDef, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [
        {
          soulCoreLocation: {
            kind: options.soulCoreAvailable === false ? "trash" : "reserve",
          },
          reserveNormalCoreCount: 4,
        },
      ],
    });
    const lookup = (id: string) =>
      id === braveDef.cardNo
        ? braveDef
        : id === nexusDef.cardNo
          ? nexusDef
          : id === resolvedTargetDef.cardNo
            ? resolvedTargetDef
            : undefined;
    return {
      state: { ...state, step: "main" as const },
      nexusDef,
      targetDef: resolvedTargetDef,
      lookup,
    };
  }

  it("Lv1 (未到達) ではプロキシ契約合体が列挙されない", () => {
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C09",
      nexusCores: 0,
      soulCoreAvailable: false,
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      0
    );
  });

  it("Lv2 到達済みなら、ソウルコアが無くても対象カード名一致で契約合体宣言が列挙される", () => {
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C09",
      nexusCores: 1,
      soulCoreAvailable: false,
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const cc = actions.filter((a) => a.kind === "contract_combine");
    expect(cc).toHaveLength(1);
    expect(cc[0]).toMatchObject({
      braveInstanceId: "brave-1",
      candidateTargetInstanceIds: ["target-1"],
    });
  });

  it("対象カード名が一致しない場合はプロキシ契約合体が列挙されない", () => {
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C09", // targetCardNames: [{contains: "神薙 ユウ"}]
      nexusCores: 1,
      soulCoreAvailable: false,
      targetCardNo: "BSGE01-CX03", // 空木 レンカ（braveCondition は満たすが名前不一致）
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      0
    );
  });

  it("対象カード名は部分一致（「X」記法、カード名：プレフィックスなし）: 変種名でも一致する", () => {
    // memory project_card_name_reference_matching: 「X」(カード名：無し) は部分一致。
    // 「[覚醒]神薙 ユウ」のような変種カード名も対象になるべき (CardNameMatch.contains)。
    const variantTargetDef: CardDefinition = {
      ...targetDef,
      cardNo: "BSGE01-CX01-VARIANT-TEST",
      name: "[覚醒]神薙 ユウ",
    };
    const nexusDef = card("BSGE01-C09");
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(nexusDef, {
          instanceId: "nexus-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(variantTargetDef, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [
        { soulCoreLocation: { kind: "trash" }, reserveNormalCoreCount: 4 },
      ],
    });
    const lookup = (id: string) =>
      id === braveDef.cardNo
        ? braveDef
        : id === nexusDef.cardNo
          ? nexusDef
          : id === variantTargetDef.cardNo
            ? variantTargetDef
            : undefined;
    const actions = getLegalActions({
      state: { ...state, step: "main" as const },
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      1
    );
  });

  it("restrict_flash (手札) CE 下ではプロキシ経由でも契約合体を起動できない (adversarial verifier round1 refute)", () => {
    // プロキシ起動元 (ネクサス) はフィールドだが、実際に発動されるのはブレイヴ自身の
    // フラッシュ【契約合体】キーワード（発動元は常に手札）。restrict_flash(hand) は
    // 自己完結型と同様プロキシ経由でも適用されるべき。
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C13", // 対象カード名制限なし
      nexusCores: 1,
      soulCoreAvailable: false,
    });
    const restrictHandFlash: ContinuousEffect = {
      effectId: "ce:restrict-flash-hand:proxy-test",
      sourceInstanceId: "restrict-source",
      sourceDefinitionId: "TEST-RESTRICT",
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "restrict_flash_hand",
      targetInstanceId: "alice",
      metadata: { restrictedZones: ["hand"] },
    };
    const actions = getLegalActions({
      state: {
        ...state,
        activeContinuousEffects: [
          ...state.activeContinuousEffects,
          restrictHandFlash,
        ],
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      0
    );
  });

  it("対象カード名フィルタは実効名 (override_properties.cardName CE 反映後) を見る (adversarial verifier round1 refute)", () => {
    // 印字名は「空木 レンカ」(C09 の targetCardNames=[{contains:"神薙 ユウ"}] とは不一致) だが、
    // override_properties.cardName CE で実効名が「神薙 ユウ」になっている場合は対象になるべき
    // (姉妹実装 matchesBraveConditionForCard の cardNames/cardNameContains 判定と同じ SSOT)。
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C09", // targetCardNames: [{contains: "神薙 ユウ"}]
      nexusCores: 1,
      soulCoreAvailable: false,
      targetCardNo: "BSGE01-CX03", // 空木 レンカ（印字名は不一致）
    });
    const nameOverrideCe: ContinuousEffect = {
      effectId: "ce:override-cardname:proxy-test",
      sourceInstanceId: "override-source",
      sourceDefinitionId: "TEST-OVERRIDE",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: "target-1",
      metadata: { properties: { cardName: "神薙 ユウ" } },
    };
    const actions = getLegalActions({
      state: {
        ...state,
        activeContinuousEffects: [
          ...state.activeContinuousEffects,
          nameOverrideCe,
        ],
      },
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      1
    );
  });

  it("BSGE01-C13 は対象カード名制限なしでプロキシ契約合体が列挙される", () => {
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C13",
      nexusCores: 1,
      soulCoreAvailable: false,
      // C09 なら対象外の名前 (空木 レンカ) でも C13 は制限なしなので対象になる
      targetCardNo: "BSGE01-CX03",
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      1
    );
  });

  it("通常コストとプロキシ擬制が両方ある場合、選択はスタック窓後・対象選択前に開く", () => {
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C13",
      nexusCores: 1,
      soulCoreAvailable: true,
    });
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (a): a is Extract<LegalAction, { kind: "contract_combine" }> =>
        a.kind === "contract_combine"
    );
    expect(action).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
    expect(declared.stackWindow).not.toBeNull();
    expect(declared.pendingAsIfSoulCoreChoice).toBeNull();
    expect(declared.pendingEffectTargetSelection).toBeNull();

    const afterStack = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(afterStack.stackWindow).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toBeNull();
    expect(afterStack.pendingAsIfSoulCoreChoice).toMatchObject({
      actionKind: "contract_combine",
      sourceInstanceId: "brave-1",
    });
    expect(
      afterStack.pendingAsIfSoulCoreChoice!.options.map(
        (option) => option.choiceId
      )
    ).toEqual(["normal", "proxy:nexus-1"]);

    const afterChoice = resolvePendingAsIfSoulCoreChoice(
      afterStack,
      "proxy:nexus-1",
      lookup,
      { getRegisteredTriggeredEffectActions: () => undefined }
    );
    expect(afterChoice.pendingAsIfSoulCoreChoice).toBeNull();
    expect(afterChoice.pendingEffectTargetSelection).not.toBeNull();

    const resolved = resolvePendingEffectTarget(
      afterChoice,
      ["target-1"],
      lookup,
      { getRegisteredTriggeredEffectActions: () => undefined }
    );
    expect(
      resolved.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "reserve" });
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "brave-1")
        ?.attachedToInstanceId
    ).toBe("target-1");
  });

  it("適用: 窓後プロキシ選択の契約合体はソウルコアを消費せず合体する", () => {
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C09",
      nexusCores: 1,
      soulCoreAvailable: false,
    });
    const beforeLoc = state.players.find(
      (p) => p.id === "alice"
    )!.soulCoreLocation;

    const result = applyLegalAction({
      state,
      action: {
        kind: "contract_combine",
        actionId: "test:contract-combine-proxy",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        braveInstanceId: "brave-1",
        braveCardNo: braveDef.cardNo,
        candidateTargetInstanceIds: ["target-1"],
        targetMode: "manual",
        requiredTargetCount: 1,
        targetInstanceId: "target-1",
        targetCardNo: targetDef.cardNo,
        costWaived: true,
        proxySourceInstanceId: "nexus-1",
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    const newState = passStackAndResolveTarget(
      result.state,
      ["target-1"],
      lookup,
      {
        getRegisteredTriggeredEffectActions: () => undefined,
      }
    );
    const alice = newState.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual(beforeLoc);

    const brave = newState.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(brave.attachedToInstanceId).toBe("target-1");
  });

  it("使用制限: 適用後は同ターン中、同名ネクサスからの再度のプロキシ契約合体が列挙されない", () => {
    const { state, lookup } = makeState({
      nexusCardNo: "BSGE01-C13",
      nexusCores: 1,
      soulCoreAvailable: false,
    });
    const result = applyLegalAction({
      state,
      action: {
        kind: "contract_combine",
        actionId: "test:contract-combine-proxy-1",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        braveInstanceId: "brave-1",
        braveCardNo: braveDef.cardNo,
        candidateTargetInstanceIds: ["target-1"],
        targetMode: "manual",
        requiredTargetCount: 1,
        targetInstanceId: "target-1",
        targetCardNo: targetDef.cardNo,
        costWaived: true,
        proxySourceInstanceId: "nexus-1",
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    // P3-112: 使用制限記録は deferred 解決 (窓クローズ後) で行われる。窓を閉じてから
    // 列挙する（開いたまま列挙すると stackWindow!==null による別ガードで偽陽性になる）。
    const newState = passStackAndResolveTarget(
      result.state,
      ["target-1"],
      lookup,
      {
        getRegisteredTriggeredEffectActions: () => undefined,
      }
    );
    const actions = getLegalActions({
      state: newState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "contract_combine")).toHaveLength(
      0
    );
  });
});

describe("BSGE01-M01 ヨハネス", () => {
  const c = card("BSGE01-M01");
  it("召喚/配置発揮後バーストで破壊→ドロー2", () => {
    const burst = c.effects![1]!;
    expect(burst.timing).toMatchObject({
      kind: "burst",
      trigger: {
        kind: "effect_activated",
        player: "opponent",
        activatedTimings: ["summon", "place"],
      },
    });
    expect(burst.steps[0]!.action.kind).toBe("destroy");
    expect(burst.steps[1]!.action.kind).toBe("draw");
  });

  it("トラッシュのこのカードはフラッシュタイミングでカウント-1して手札に戻る", () => {
    const recovery = c.effects![0]!;
    expect(recovery.applicability).toEqual({ zone: ["trash"] });
    expect(recovery.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(recovery.stub).toBeUndefined();
    expect(recovery.steps).toEqual([
      { action: { kind: "count_decrease", player: "self", amount: 1 } },
      {
        action: { kind: "move_self", destination: "hand" },
        connector: "conditional_cost",
      },
    ]);
  });

  it("[legal action] BSGE01-M01 はトラッシュからフラッシュタイミングでカウント-1し手札に戻せる", () => {
    const source = createCardInstance(c, {
      instanceId: "johannes-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const handLookup = buildHandActivatedEffectLookup([c]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
        playerOverrides: [{ countValue: 3 }, { countValue: 0 }],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "default",
    };

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === "johannes-trash"
    );
    expect(action).toBeDefined();
    if (!action) throw new Error("trash-zone hand activated action not found");

    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    const resolved = passStackUntilClosed(declared.state, getBSGEDefinition, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: handLookup,
    });

    const after = resolved.cardInstances.find(
      (card) => card.instanceId === "johannes-trash"
    )!;
    expect(after.zone).toBe("hand");
    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(2);
  });

  it("[legal action] BSGE01-M01 はカウント不足のとき use_hand_card_effect が列挙されない（engine-trash-zone-flash-activated-recovery adversarial verifier round1 lens2 refute の回帰）", () => {
    const source = createCardInstance(c, {
      instanceId: "johannes-trash-no-count",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const handLookup = buildHandActivatedEffectLookup([c]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
        playerOverrides: [{ countValue: 0 }, { countValue: 0 }],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "default",
    };

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === "johannes-trash-no-count"
    );
    expect(action).toBeUndefined();
  });

  it("target 必須 burst は候補不足時に no-source generic resolve へ落ちない", () => {
    const source = createCardInstance(c, {
      instanceId: "johannes-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "bob",
      step: "main",
      window: "main",
      setBurstStates: [{ playerId: "alice", cardInstanceId: "johannes-burst" }],
      pendingBurstChecks: [
        {
          checkId: "johannes-effect-activated",
          actingPlayerId: "alice",
          eventKind: "effect_activated",
          event: { family: "effect_activation", actionKind: "summon" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:9192",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: null,
          amount: null,
          step: "main",
          window: "main",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
    });
    const resolveActions = actions.filter(
      (action) => action.kind === "resolve_pending_burst_check"
    );

    expect(resolveActions).toHaveLength(1);
    expect(resolveActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "johannes-burst",
          sourceCardNo: "BSGE01-M01",
        }),
      ])
    );
    expect(
      resolveActions.some((action) => action.sourceInstanceId === undefined)
    ).toBe(false);
    expect(
      actions.filter((action) => action.kind === "decline_pending_burst_check")
    ).toHaveLength(1);
  });

  it("source-backed burst が全 variant 条件未達のとき no-source generic resolve へ落ちない", () => {
    const source = createCardInstance(BSGE_BURST_ALL_PRUNED_TEST, {
      instanceId: "all-pruned-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "bob",
      step: "main",
      window: "main",
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "all-pruned-burst" },
      ],
      pendingBurstChecks: [
        {
          checkId: "all-pruned-effect-activated",
          actingPlayerId: "alice",
          eventKind: "effect_activated",
          event: { family: "effect_activation", actionKind: "summon" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:9256",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: null,
          amount: null,
          step: "main",
          window: "main",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
    });

    expect(
      actions.filter((action) => action.kind === "resolve_pending_burst_check")
    ).toEqual([]);
    expect(actions).toEqual([
      expect.objectContaining({
        kind: "decline_pending_burst_check",
        checkId: "all-pruned-effect-activated",
      }),
    ]);
  });

  it("同一 sourceKind の複数 burst 登録は宣言した registrationIndex の対象メタで窓後選択する", () => {
    const source = createCardInstance(BSGE_BURST_MULTI_REGISTRATION_TEST, {
      instanceId: "multi-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const spirit = createCardInstance(card("BSSL01-C02"), {
      instanceId: "opponent-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(card("BSGE01-C09"), {
      instanceId: "opponent-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, spirit, nexus],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      setBurstStates: [{ playerId: "alice", cardInstanceId: "multi-burst" }],
      pendingBurstChecks: [
        {
          checkId: "multi-life-down",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          event: { family: "life", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:9323",
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

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_burst_check" &&
        candidate.sourceInstanceId === "multi-burst" &&
        candidate.registrationIndex === 1
    );
    expect(action).toBeDefined();

    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).state;

    while (state.window === "stack" && state.stackWindow !== null) {
      const actingPlayerId = state.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state,
        actingPlayerId,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).find((candidate) => candidate.kind === "pass_stack") ?? {
        kind: "pass_stack" as const,
        actionId: `pass:${actingPlayerId}`,
        can: true as const,
        reason: "test_close",
        actingPlayerId,
      };
      state = applyLegalAction({
        state,
        action: pass,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).state;
    }

    expect(state.pendingEffectTargetSelection).toMatchObject({
      actingPlayerId: "alice",
      requiredTargetCount: 1,
      candidateInstanceIds: ["opponent-nexus"],
    });
    const resolveTarget = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();

    const resolved = applyLegalAction({
      state,
      action: resolveTarget!,
      targetInstanceIds: ["opponent-nexus"],
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).state;

    const resolvedSpirit = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "opponent-spirit"
    );
    const resolvedNexus = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "opponent-nexus"
    );
    expect(resolvedSpirit?.zone).toBe("field");
    expect(resolvedSpirit?.pendingLeaveKind).toBeNull();
    expect(
      resolvedNexus?.zone === "trash" ||
        resolvedNexus?.pendingLeaveKind === "destroy"
    ).toBe(true);
  });

  it("cannot_activate は同一 sourceKind の複数 burst 登録を legal action 列挙から落とさない", () => {
    const source = createCardInstance(BSGE_BURST_MULTI_REGISTRATION_TEST, {
      instanceId: "multi-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const spirit = createCardInstance(card("BSSL01-C02"), {
      instanceId: "opponent-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(card("BSGE01-C09"), {
      instanceId: "opponent-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, spirit, nexus],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      setBurstStates: [{ playerId: "alice", cardInstanceId: "multi-burst" }],
      activeContinuousEffects: [burstCannotActivateSuppressor()],
      pendingBurstChecks: [
        {
          checkId: "multi-life-down",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          event: { family: "life", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:9484",
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

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).filter(
      (candidate) =>
        candidate.kind === "resolve_pending_burst_check" &&
        candidate.sourceInstanceId === "multi-burst"
    );

    expect(actions.some((candidate) => candidate.registrationIndex === 0)).toBe(
      true
    );
    expect(actions.some((candidate) => candidate.registrationIndex === 1)).toBe(
      true
    );
  });

  it("cannot_activate 抑制下の burst は必須対象 0 件でも候補に残り対象選択前に suppressed 解決する", () => {
    const source = createCardInstance(BSGE_BURST_MULTI_REGISTRATION_TEST, {
      instanceId: "multi-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      setBurstStates: [{ playerId: "alice", cardInstanceId: "multi-burst" }],
      activeContinuousEffects: [burstCannotActivateSuppressor()],
      pendingBurstChecks: [
        {
          checkId: "multi-life-down",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          event: { family: "life", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:9544",
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

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_burst_check" &&
        candidate.sourceInstanceId === "multi-burst" &&
        candidate.registrationIndex === 1
    );

    expect(action).toBeDefined();

    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).state;

    while (state.window === "stack" && state.stackWindow !== null) {
      const actingPlayerId = state.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state,
        actingPlayerId,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).find((candidate) => candidate.kind === "pass_stack") ?? {
        kind: "pass_stack" as const,
        actionId: `pass:${actingPlayerId}`,
        can: true as const,
        reason: "test_close",
        actingPlayerId,
      };
      state = applyLegalAction({
        state,
        action: pass,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).state;
    }

    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.log).toContain(
      "burst:effect-suppressed:multi-life-down:multi-burst"
    );
  });

  it("同一 sourceKind の複数 burst 登録は発揮できない無視も宣言 registration の effect だけを見る", () => {
    const source = createCardInstance(BSGE_BURST_MULTI_REGISTRATION_TEST, {
      instanceId: "multi-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const spirit = createCardInstance(card("BSSL01-C02"), {
      instanceId: "opponent-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(card("BSGE01-C09"), {
      instanceId: "opponent-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, spirit, nexus],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      setBurstStates: [{ playerId: "alice", cardInstanceId: "multi-burst" }],
      pendingBurstChecks: [
        {
          checkId: "multi-life-down",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          event: { family: "life", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:9666",
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

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_burst_check" &&
        candidate.sourceInstanceId === "multi-burst" &&
        candidate.registrationIndex === 1
    );
    expect(action).toBeDefined();

    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).state;

    state = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        burstCannotActivateSuppressor(),
      ],
    };

    while (state.window === "stack" && state.stackWindow !== null) {
      const actingPlayerId = state.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state,
        actingPlayerId,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).find((candidate) => candidate.kind === "pass_stack") ?? {
        kind: "pass_stack" as const,
        actionId: `pass:${actingPlayerId}`,
        can: true as const,
        reason: "test_close",
        actingPlayerId,
      };
      state = applyLegalAction({
        state,
        action: pass,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).state;
    }

    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.log).toContain(
      "burst:effect-suppressed:multi-life-down:multi-burst"
    );
    expect(
      state.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "opponent-spirit"
      )?.zone
    ).toBe("field");
    expect(
      state.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "opponent-nexus"
      )?.zone
    ).toBe("field");
  });
});

describe("BSGE01-M02 ペイラー榊", () => {
  const c = card("BSGE01-M02");
  it("召喚発揮後バーストでコスト4以下3体破壊→ボイド2回収", () => {
    const burst = c.effects![1]!;
    const destroy = burst.steps[0]!.action;
    if (destroy.kind === "destroy" && "filter" in destroy.target) {
      expect(destroy.target.filter.maxCost).toBe(4);
      expect(destroy.target.count).toBe(3);
    }
    expect(burst.steps[1]!.action.kind).toBe("core_move");
  });

  it("トラッシュのこのカードはフラッシュタイミングでカウント-1して手札に戻る", () => {
    const recovery = c.effects![0]!;
    expect(recovery.applicability).toEqual({ zone: ["trash"] });
    expect(recovery.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(recovery.stub).toBeUndefined();
    expect(recovery.steps).toEqual([
      { action: { kind: "count_decrease", player: "self", amount: 1 } },
      {
        action: { kind: "move_self", destination: "hand" },
        connector: "conditional_cost",
      },
    ]);
  });

  describe("【荒天：スプレッド】(P3-111, ENGINE-cost-modify-additional-cost-value-dynamic-amount Step3)", () => {
    const underDef = c;
    const hostDef = card("BSGE01-CX03"); // name: 空木 レンカ
    const nonMatchingHostDef = card("BSGE01-CX01"); // name: 神薙 ユウ
    const bobMagicDef: CardDefinition = {
      cardNo: "TEST-BOB-MAGIC",
      name: "test magic",
      printedCategory: "magic",
      colors: ["blue"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "",
    } as unknown as CardDefinition;

    function lookup(id: string): CardDefinition | undefined {
      if (id === hostDef.cardNo) return hostDef;
      if (id === nonMatchingHostDef.cardNo) return nonMatchingHostDef;
      if (id === underDef.cardNo) return underDef;
      if (id === bobMagicDef.cardNo) return bobMagicDef;
      return undefined;
    }

    const battleLookup = buildBattleImmediateEffectLookup([
      hostDef,
      nonMatchingHostDef,
      underDef,
    ]);

    const lookupOpts = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    it("shape: 発揮有無は effect-level optional、0指定は count_decrease amount:min0 で表現する", () => {
      const spread = c.effects![2]!;
      expect(spread.executionMode).toBe("optional");
      expect(spread.steps[0]!.executionMode).toBeUndefined();
      expect(spread.steps[0]!.action).toEqual({
        kind: "count_decrease",
        player: "self",
        amount: { min: 0 },
      });
      expect(spread.steps[1]!.connector).toBe("conditional_result");
    });

    function makeState(options: {
      hostDef: CardDefinition;
      countValue: number;
    }): GameState {
      const host = createCardInstance(options.hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      });
      host.underCards = [
        {
          cardInstanceId: "under-1",
          role: "text_role",
          roleTag: "バレットエディット",
        },
      ];
      const under = createCardInstance(underDef, {
        instanceId: "under-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
      });
      under.attachedToInstanceId = "host-1";
      const bobMagic = createCardInstance(bobMagicDef, {
        instanceId: "bob-magic-1",
        ownerPlayerId: "bob",
        zone: "hand",
      });
      return createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, under, bobMagic],
        playerOverrides: [{ countValue: options.countValue }, {}],
      });
    }

    function queueAttack(state: GameState): GameState {
      const host = state.cardInstances.find((x) => x.instanceId === "host-1")!;
      const hostDefinition = lookup(host.definitionId)!;
      return queueRegisteredBattleImmediateEffects({
        state,
        attackId: "attack-1",
        participantEntityId: "battle-entity:host-1",
        actingPlayerId: "alice",
        sourceCard: host,
        sourceDefinition: hostDefinition,
        timing: "attack",
        getCardDefinitionById: lookup,
        getRegisteredBattleImmediateEffectActions: battleLookup,
      });
    }

    function findDeclare(state: GameState) {
      return getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookupOpts,
      }).find(
        (action) =>
          action.kind === "resolve_battle_immediate_effect" &&
          action.sourceEffectInstanceId === "under-1" &&
          !action.skipOnly
      );
    }

    it("host が「空木 レンカ」以外だと自己名条件で発揮されない", () => {
      const queued = queueAttack(
        makeState({ hostDef: nonMatchingHostDef, countValue: 3 })
      );
      expect(findDeclare(queued)).toBeUndefined();
    });

    it("host が「空木 レンカ」のとき、カウントを2減らすと相手の手札/手元コストがこのターン+2、フィールドには影響しない", () => {
      const queued = queueAttack(makeState({ hostDef, countValue: 3 }));

      const declaration = findDeclare(queued);
      expect(declaration).toMatchObject({
        sourceInstanceId: "host-1",
        sourceEffectDefinitionId: "BSGE01-M02",
        sourceEffectInstanceId: "under-1",
      });

      const declared = applyLegalAction({
        state: queued,
        action: declaration!,
        ...lookupOpts,
      }).state;
      const optionalOpened = applyLegalAction({
        state: declared,
        action: {
          kind: "pass_stack",
          actionId: "pass:bob",
          can: true,
          reason: "test_close",
          actingPlayerId: "bob",
        },
        ...lookupOpts,
      }).state;
      expect(optionalOpened.pendingStepOptionalChoice).toBeNull();
      const opened = optionalOpened;

      expect(opened.pendingCountSelection).toMatchObject({
        min: 0,
        max: 3,
        actingPlayerId: "alice",
        targetPlayerId: "alice",
      });

      const selectAction = getLegalActions({
        state: opened,
        actingPlayerId: "alice",
        ...lookupOpts,
      }).find((a) => a.kind === "resolve_pending_count_decrease")!;
      expect(selectAction).toBeDefined();

      const resolved = applyLegalAction({
        state: opened,
        action: selectAction,
        countDecreaseSelection: 2,
        ...lookupOpts,
      }).state;

      expect(resolved.pendingCountSelection).toBeNull();
      expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(
        1
      );

      // 相手の手札/手元カードはこのターン+2 (zone スコープ)。フィールドには適用されない。
      expect(
        getApplicableAdditionalCostDelta(resolved, "bob", bobMagicDef, {
          cardZone: "hand",
        })
      ).toBe(2);
      expect(
        getApplicableAdditionalCostDelta(resolved, "bob", bobMagicDef, {
          cardZone: "set_aside",
        })
      ).toBe(2);
      expect(
        getApplicableAdditionalCostDelta(resolved, "bob", bobMagicDef, {
          cardZone: "field",
        })
      ).toBe(0);

      // 実際のマジック使用コスト計算にも反映される (3 → 5)。
      const paymentSources = getAvailableMagicPaymentSources({
        state: resolved,
        actingPlayerId: "bob",
        magicInstanceId: "bob-magic-1",
        getCardDefinitionById: lookup,
      });
      expect(paymentSources.reduction.finalCost).toBe(5);
    });

    it("0を選ぶと「そうしたとき」ゲートでコスト修正 CE は登録されない", () => {
      const queued = queueAttack(makeState({ hostDef, countValue: 3 }));
      const declaration = findDeclare(queued)!;
      const declared = applyLegalAction({
        state: queued,
        action: declaration,
        ...lookupOpts,
      }).state;
      const optionalOpened = applyLegalAction({
        state: declared,
        action: {
          kind: "pass_stack",
          actionId: "pass:bob",
          can: true,
          reason: "test_close",
          actingPlayerId: "bob",
        },
        ...lookupOpts,
      }).state;
      expect(optionalOpened.pendingStepOptionalChoice).toBeNull();
      const opened = optionalOpened;

      const selectAction = getLegalActions({
        state: opened,
        actingPlayerId: "alice",
        ...lookupOpts,
      }).find((a) => a.kind === "resolve_pending_count_decrease")!;

      const resolved = applyLegalAction({
        state: opened,
        action: selectAction,
        countDecreaseSelection: 0,
        ...lookupOpts,
      }).state;

      expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(
        3
      );
      expect(
        resolved.activeContinuousEffects.some(
          (ce) => ce.modifierTag === "additional_cost"
        )
      ).toBe(false);
    });
  });
});

describe("BSGE01-M03 雨宮ツバキ", () => {
  const c = card("BSGE01-M03");

  it("トラッシュのこのカードはフラッシュタイミングでカウント-1して手札に戻り、セット中攻撃発動はown_attack追加発動条件として表現", () => {
    const recovery = c.effects![0]!;
    expect(recovery.applicability).toEqual({ zone: ["trash"] });
    expect(recovery.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(recovery.stub).toBeUndefined();
    expect(recovery.steps).toEqual([
      { action: { kind: "count_decrease", player: "self", amount: 1 } },
      {
        action: { kind: "move_self", destination: "hand" },
        connector: "conditional_cost",
      },
    ]);

    // 裁定 2026-07-23 (needs-ruling.jsonl BSGE01-M03/M04): 「セットしているこのカードは、
    // 自分のスピリットがアタックしたときに発動できる」はミラージュ機構ではなく、下記
    // 【バースト】効果本体 (effects[2]) への own_attack 追加発動条件。steps は effects[2]
    // (life_decrease) と同一 (BSGE01_M03_BURST_STEPS を共有)。
    const ownAttackTrigger = c.effects![1]!;
    expect(ownAttackTrigger.textRef).toEqual([2]);
    expect(ownAttackTrigger.stub).toBeUndefined();
    expect(ownAttackTrigger.timing).toEqual({
      kind: "burst",
      trigger: { kind: "own_attack", player: "self" },
      triggerFilter: { category: ["spirit"] },
    });
    expect(ownAttackTrigger.steps).toEqual(c.effects![2]!.steps);
  });

  function buildM03PendingBurstState(
    options: { includeTrash?: boolean; includeFieldTargets?: boolean } = {}
  ): GameState {
    const includeTrash = options.includeTrash ?? true;
    const includeFieldTargets = options.includeFieldTargets ?? true;
    const source = createCardInstance(c, {
      instanceId: "tsubaki-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const target = createCardInstance(card("BSSL01-C02"), {
      instanceId: "target-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const bystander = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bystander-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const trashBrave = createCardInstance(card("BSSL01-C05"), {
      instanceId: "trash-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const secondTrashBrave = createCardInstance(card("BSSL01-C05"), {
      instanceId: "trash-brave-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const invalidSelfFieldSpirit = createCardInstance(card("BSSL01-C02"), {
      instanceId: "invalid-self-field-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const invalidOpponentTrashBrave = createCardInstance(card("BSSL01-C05"), {
      instanceId: "invalid-opponent-trash-brave",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        source,
        ...(includeFieldTargets ? [target, bystander] : []),
        ...(includeTrash ? [trashBrave, secondTrashBrave] : []),
        invalidSelfFieldSpirit,
        invalidOpponentTrashBrave,
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        { reserveNormalCoreCount: 4 },
      ],
    });
    return {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      setBurstStates: [{ playerId: "alice", cardInstanceId: "tsubaki-burst" }],
      pendingBurstChecks: [
        {
          checkId: "m03-life-down",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          event: { family: "life", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:10158",
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

  function getM03BurstActions(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).filter(
      (action) =>
        action.kind === "resolve_pending_burst_check" &&
        action.sourceInstanceId === "tsubaki-burst"
    );
  }

  function declareM03BurstAction(options: {
    state: GameState;
    action: ReturnType<typeof getM03BurstActions>[number];
    choiceIndex?: number;
  }): GameState {
    let current = applyLegalAction({
      state: options.state,
      action: options.action,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).state;

    while (current.window === "stack" && current.stackWindow !== null) {
      const actingPlayerId = current.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: current,
        actingPlayerId,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).find((candidate) => candidate.kind === "pass_stack") ?? {
        kind: "pass_stack" as const,
        actionId: `pass:${actingPlayerId}`,
        can: true as const,
        reason: "test_close",
        actingPlayerId,
      };
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).state;
    }

    if (
      current.pendingStepChoice !== null &&
      options.choiceIndex !== undefined
    ) {
      const choiceAction = getLegalActions({
        state: current,
        actingPlayerId: current.pendingStepChoice.choosingPlayerId,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).find(
        (candidate) =>
          candidate.kind === "resolve_pending_step_choice" &&
          candidate.choiceIndex === options.choiceIndex
      );
      expect(choiceAction).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: choiceAction!,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).state;
    }

    return current;
  }

  function applyM03BurstAction(options: {
    state: GameState;
    action: ReturnType<typeof getM03BurstActions>[number];
    choiceIndex: number;
    targetInstanceIds: string[];
  }): GameState {
    const declared = declareM03BurstAction({
      state: options.state,
      action: options.action,
      choiceIndex: options.choiceIndex,
    });
    if (declared.pendingEffectTargetSelection === null) {
      expect(options.targetInstanceIds).toHaveLength(0);
      return declared;
    }
    const resolveTarget = getLegalActions({
      state: declared,
      actingPlayerId: declared.pendingEffectTargetSelection.actingPlayerId,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();
    return applyLegalAction({
      state: declared,
      action: resolveTarget!,
      targetInstanceIds: options.targetInstanceIds,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    }).state;
  }

  it("ライフ減少バーストでコア全リザーブ＋トラッシュ回収", () => {
    const burst = c.effects![2]!;
    expect(burst.timing).toMatchObject({
      kind: "burst",
      trigger: { kind: "life_decrease", player: "self" },
    });
    const core = burst.steps[0]!.action;
    expect(core.kind).toBe("core_move");
    if (core.kind === "core_move") {
      expect(core.amount).toBe("all");
      expect(core.target).toMatchObject({ kind: "filter", count: 1 });
      expect(core.from).toEqual({ kind: "target_card" });
    }
    expect(burst.steps[1]!.action.kind).toBe("noop");
    expect(burst.steps[1]!.choice?.[0]?.action.kind).toBe("move_card");
  });

  describe("own_attack 追加発動条件（裁定 2026-07-23）", () => {
    function buildM03OwnAttackPendingState(): GameState {
      const source = createCardInstance(c, {
        instanceId: "tsubaki-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const attacker = createCardInstance(card("BSSL01-C02"), {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const target = createCardInstance(card("BSSL01-C02"), {
        instanceId: "target-spirit",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 3,
      });
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, attacker, target],
        playerOverrides: [
          { reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 4 },
        ],
      });
      return {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        window: "declare_attack",
        setBurstStates: [
          { playerId: "alice", cardInstanceId: "tsubaki-burst" },
        ],
        pendingBurstChecks: [
          {
            checkId: "m03-own-attack",
            actingPlayerId: "alice",
            eventKind: "own_attack",
            event: {
              family: "action_declared",
              actionKind: "attack",
              validationMode: "require_related_instance_on_field",
            },
            source: "action_resolution",
            chainId: "test:bsge01-cards:10385",
            attackId: "attack-1",
            relatedPlayerId: "alice",
            relatedInstanceId: "alice-attacker",
            amount: 1,
            step: "attack",
            window: "declare_attack",
            resolvedBurstCardInstanceIds: [],
          },
        ],
      };
    }

    it("[legal action] own_attack pendingBurstCheck は BSGE01-M03 の追加発動条件を提示する", () => {
      const actions = getM03BurstActions(buildM03OwnAttackPendingState());
      expect(actions.length).toBeGreaterThanOrEqual(1);
    });

    it("[legal action] アタッカーがアルティメットのとき own_attack pendingBurstCheck は BSGE01-M03 の追加発動条件を提示しない (triggerFilter.category:['spirit'])", () => {
      const source = createCardInstance(c, {
        instanceId: "tsubaki-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const attacker = createCardInstance(card("BSAZ02-C01"), {
        instanceId: "alice-ultimate-attacker",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, attacker],
          playerOverrides: [{}, {}],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "declare_attack",
        setBurstStates: [
          { playerId: "alice", cardInstanceId: "tsubaki-burst" },
        ],
        pendingBurstChecks: [
          {
            checkId: "m03-own-attack-ultimate",
            actingPlayerId: "alice",
            eventKind: "own_attack",
            event: {
              family: "action_declared",
              actionKind: "attack",
              validationMode: "require_related_instance_on_field",
            },
            source: "action_resolution",
            chainId: "test:bsge01-cards:10440",
            attackId: "attack-1",
            relatedPlayerId: "alice",
            relatedInstanceId: "alice-ultimate-attacker",
            amount: 1,
            step: "attack",
            window: "declare_attack",
            resolvedBurstCardInstanceIds: [],
          },
        ],
      };
      expect(getM03BurstActions(state)).toHaveLength(0);
    });

    it("[board] own_attack 経由で発動すると、選んだ相手1体の全コアがリザーブへ置かれる（life_decrease と同じ steps を共有）", () => {
      const state = buildM03OwnAttackPendingState();
      const action = getM03BurstActions(state)[0]!;
      const after = applyM03BurstAction({
        state,
        action,
        choiceIndex: 0,
        targetInstanceIds: ["target-spirit"],
      });

      expect(
        after.cardInstances.find((x) => x.instanceId === "target-spirit")
          ?.normalCoreCount
      ).toBe(0);
      expect(
        after.players.find((player) => player.id === "bob")!
          .reserveNormalCoreCount
      ).toBe(7);
    });

    it("アタッカーが場を離れていれば own_attack バーストは提示されない（アタック誘発効果解決中の不在チェック）", () => {
      const state = buildM03OwnAttackPendingState();
      const withoutAttacker: GameState = {
        ...state,
        cardInstances: state.cardInstances.map((instance) =>
          instance.instanceId === "alice-attacker"
            ? { ...instance, zone: "hand" as const }
            : instance
        ),
      };
      expect(getM03BurstActions(withoutAttacker)).toHaveLength(0);
    });

    it("宣言後・解決前にアタッカーが場を離れると own_attack バーストは発揮されない（ENGINE-burst-activation-resolution-time-revalidation）", () => {
      const state = buildM03OwnAttackPendingState();
      const action = getM03BurstActions(state)[0]!;
      const declared = applyLegalAction({
        state,
        action,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
        getRegisteredMagicActions: buildMagicLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).state;
      expect(declared.window).toBe("stack");

      // 宣言後・スタック窓解決前にアタッカーが場を離れる (例: 相手の除去効果)。
      const attackerLeft: GameState = {
        ...declared,
        cardInstances: declared.cardInstances.map((instance) =>
          instance.instanceId === "alice-attacker"
            ? { ...instance, zone: "trash" as const }
            : instance
        ),
      };

      let current = attackerLeft;
      while (current.window === "stack" && current.stackWindow !== null) {
        const actingPlayerId = current.stackWindow.priorityPlayerId;
        const pass = getLegalActions({
          state: current,
          actingPlayerId,
          getCardDefinitionById: getBSGEDefinition,
          getRegisteredBurstActions: getBSGEBurstActions,
          getRegisteredTriggeredEffectActions: () => undefined,
          getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
            BSGE_NEGATE_TEST_DEFINITIONS
          ),
          getRegisteredMagicActions: buildMagicLookup(
            BSGE_NEGATE_TEST_DEFINITIONS
          ),
        }).find((candidate) => candidate.kind === "pass_stack")!;
        current = applyLegalAction({
          state: current,
          action: pass,
          getCardDefinitionById: getBSGEDefinition,
          getRegisteredBurstActions: getBSGEBurstActions,
          getRegisteredTriggeredEffectActions: () => undefined,
          getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
            BSGE_NEGATE_TEST_DEFINITIONS
          ),
          getRegisteredMagicActions: buildMagicLookup(
            BSGE_NEGATE_TEST_DEFINITIONS
          ),
        }).state;
      }

      // 発揮できない: 対象選択窓が開かず、相手のコアは無傷のまま。
      expect(current.pendingEffectTargetSelection).toBeNull();
      expect(
        current.cardInstances.find((x) => x.instanceId === "target-spirit")
          ?.normalCoreCount
      ).toBe(3);
      expect(
        current.players.find((player) => player.id === "bob")!
          .reserveNormalCoreCount
      ).toBe(4);
    });
  });

  it("[board] BSGE01-M03 バーストは選んだ相手1体だけの全コアをリザーブに置き、任意回収はスキップできる", () => {
    const source = createCardInstance(c, {
      instanceId: "tsubaki",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSSL01-C02"), {
      instanceId: "target-spirit",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const bystander = createCardInstance(card("BSSL01-M03"), {
      instanceId: "bystander-spirit",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const trashBrave = createCardInstance(card("BSSL01-C05"), {
      instanceId: "trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target, bystander, trashBrave],
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        {
          reserveNormalCoreCount: 4,
          soulCoreLocation: {
            kind: "card",
            instanceId: "target-spirit",
          },
        },
      ],
    });

    const after = executeEffect({
      chainId: "test:bsge01-cards:10608",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      targetInstanceIds: [target.instanceId],
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 0,
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "target-spirit")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((x) => x.instanceId === "bystander-spirit")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      after.players.find((player) => player.id === "bob")!
        .reserveNormalCoreCount
    ).toBe(7);
    expect(after.players.find((player) => player.id === "bob")!).toMatchObject({
      soulCoreLocation: { kind: "reserve" },
    });
    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-brave")?.zone
    ).toBe("trash");
  });

  it("[board] BSGE01-M03 バーストは通常コア0個でも対象上のソウルコアをリザーブへ置く", () => {
    const source = createCardInstance(c, {
      instanceId: "tsubaki",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSSL01-C02"), {
      instanceId: "target-spirit",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        {
          reserveNormalCoreCount: 4,
          soulCoreLocation: {
            kind: "card",
            instanceId: "target-spirit",
          },
        },
      ],
    });

    const after = executeEffect({
      chainId: "test:bsge01-cards:10667",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      targetInstanceIds: [target.instanceId],
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 0,
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "target-spirit")
        ?.normalCoreCount
    ).toBe(0);
    expect(after.players.find((player) => player.id === "bob")!).toMatchObject({
      reserveNormalCoreCount: 4,
      soulCoreLocation: { kind: "reserve" },
    });
  });

  it("[board] BSGE01-M03 バーストの任意回収を選ぶと赤/紫ブレイヴを手札に戻す", () => {
    const source = createCardInstance(c, {
      instanceId: "tsubaki",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSSL01-C02"), {
      instanceId: "target-spirit",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const trashBrave = createCardInstance(card("BSSL01-C05"), {
      instanceId: "trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target, trashBrave],
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        { reserveNormalCoreCount: 4 },
      ],
    });

    const after = executeEffect({
      chainId: "test:bsge01-cards:10715",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      targetInstanceIds: [target.instanceId],
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-brave")?.zone
    ).toBe("hand");
  });

  it("[legal action] BSGE01-M03 バーストは1回だけ宣言し、窓後に回収する/しないを提示する", () => {
    const actions = getM03BurstActions(buildM03PendingBurstState());

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      deferredChoiceIndexes: [0, 1],
      requiredTargetCount: 0,
      targetMode: "none",
      candidateTargetInstanceIds: [],
    });
    expect(actions[0]!.choiceIndex).toBeUndefined();
    const afterStack = declareM03BurstAction({
      state: buildM03PendingBurstState(),
      action: actions[0]!,
    });
    expect(afterStack.pendingStepChoice?.choices).toEqual([
      expect.objectContaining({ choiceIndex: 0 }),
      expect.objectContaining({ choiceIndex: 1 }),
    ]);
  });

  it("[legal action] BSGE01-M03 バーストの grouped max は任意回収候補が無い場合も潰さない", () => {
    const actions = getM03BurstActions(buildM03PendingBurstState());
    const recoverAction = actions[0]!;

    expect(recoverAction.requiredTargetCount).toBe(0);
    expect(recoverAction.maxTargetCount).toBeUndefined();
    const declared = declareM03BurstAction({
      state: buildM03PendingBurstState(),
      action: recoverAction,
      choiceIndex: 1,
    });
    expect(declared.pendingEffectTargetSelection?.targetGroups).toEqual([
      {
        requiredTargetCount: 1,
        targetStepId: "__step_0",
        candidateTargetZones: ["field"],
        candidateTargetInstanceIds: ["target-spirit", "bystander-spirit"],
      },
      {
        requiredTargetCount: 1,
        targetStepId: "__step_1",
        candidateTargetZones: ["trash"],
        candidateTargetInstanceIds: ["trash-brave", "trash-brave-2"],
      },
    ]);
  });

  it("[legal action] BSGE01-M03 バーストの recovery choice は回収候補が無いと部分撃ちで提示される", () => {
    const state = buildM03PendingBurstState({ includeTrash: false });
    const actions = getM03BurstActions(state);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.deferredChoiceIndexes).toEqual([0, 1]);
    const recoverAction = actions[0]!;
    expect(recoverAction.requiredTargetCount).toBe(0);
    const declared = declareM03BurstAction({
      state,
      action: recoverAction,
      choiceIndex: 1,
    });
    expect(declared.pendingEffectTargetSelection?.targetGroups).toEqual([
      {
        requiredTargetCount: 1,
        targetStepId: "__step_0",
        candidateTargetZones: ["field"],
        candidateTargetInstanceIds: ["target-spirit", "bystander-spirit"],
      },
      {
        requiredTargetCount: 0,
        targetStepId: "__step_1",
        candidateTargetZones: ["trash"],
        candidateTargetInstanceIds: [],
      },
    ]);
    expect(declared.pendingEffectTargetSelection?.candidateInstanceIds).toEqual(
      expect.arrayContaining(["target-spirit", "bystander-spirit"])
    );

    const after = applyM03BurstAction({
      state,
      action: recoverAction,
      choiceIndex: 1,
      targetInstanceIds: ["target-spirit"],
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "target-spirit")
        ?.normalCoreCount
    ).toBe(0);
  });

  it("[legal action] BSGE01-M03 バーストは必須対象不足時も generic fallback へ落ちない", () => {
    const state = buildM03PendingBurstState({ includeFieldTargets: false });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: getBSGEBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: buildMagicLookup(BSGE_NEGATE_TEST_DEFINITIONS),
    });
    const resolveActions = actions.filter(
      (action) => action.kind === "resolve_pending_burst_check"
    );

    expect(resolveActions).toHaveLength(1);
    expect(resolveActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "tsubaki-burst",
          sourceCardNo: "BSGE01-M03",
        }),
      ])
    );
    expect(
      resolveActions.some((action) => action.sourceInstanceId === undefined)
    ).toBe(false);
    expect(
      actions.filter((action) => action.kind === "decline_pending_burst_check")
    ).toHaveLength(1);
  });

  it("[legal action] BSGE01-M03 バーストの default choice は回収せず選んだ1体だけコアを除く", () => {
    const state = buildM03PendingBurstState();
    const action = getM03BurstActions(state)[0];
    expect(action).toBeDefined();

    const after = applyM03BurstAction({
      state,
      action: action!,
      choiceIndex: 0,
      targetInstanceIds: ["target-spirit"],
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "target-spirit")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((x) => x.instanceId === "bystander-spirit")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      after.players.find((player) => player.id === "bob")!
        .reserveNormalCoreCount
    ).toBe(7);
    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-brave")?.zone
    ).toBe("trash");
  });

  it("[legal action] BSGE01-M03 バーストの recovery choice は選んだ相手1体と選んだ赤/紫ブレイヴを解決する", () => {
    const state = buildM03PendingBurstState();
    const action = getM03BurstActions(state)[0];
    expect(action).toBeDefined();

    const after = applyM03BurstAction({
      state,
      action: action!,
      choiceIndex: 1,
      targetInstanceIds: ["trash-brave-2", "bystander-spirit"],
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "target-spirit")
        ?.normalCoreCount
    ).toBe(3);
    expect(
      after.cardInstances.find((x) => x.instanceId === "bystander-spirit")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-brave")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-brave-2")?.zone
    ).toBe("hand");
  });

  it("[legal action] BSGE01-M03 バーストの recovery choice は役割不足を自動補完しない", () => {
    const state = buildM03PendingBurstState();
    const action = getM03BurstActions(state)[0];
    expect(action).toBeDefined();

    expect(() =>
      applyM03BurstAction({
        state,
        action: action!,
        choiceIndex: 1,
        targetInstanceIds: ["trash-brave", "trash-brave-2"],
      })
    ).toThrow(
      /target group|Sequential target selection is missing required target/
    );
    expect(() =>
      applyM03BurstAction({
        state,
        action: action!,
        choiceIndex: 1,
        targetInstanceIds: ["target-spirit", "bystander-spirit"],
      })
    ).toThrow(
      /target group|Sequential target selection is missing required target/
    );
  });

  it("[legal action] pending targetGroups は重なった候補を別 group に二重計上しない", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      pendingEffectTargetSelection: {
        pendingId: "pending-overlap",
        actingPlayerId: "alice",
        sourceInstanceId: "source",
        sourceDefinitionId: c.cardNo,
        deferredStack: {
          stackId: "stack-overlap",
          actionKind: "field_card_effect",
          chainId: "chain-overlap",
          actingPlayerId: "alice",
          cardInstanceId: "source",
          cardDefinitionId: c.cardNo,
          targetInstanceIds: [],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 2,
        maxTargetCount: 2,
        candidateInstanceIds: ["same-candidate", "other-candidate"],
        targetGroups: [
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate"],
          },
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate"],
          },
        ],
        targetEffectFilterTags: [],
      },
    };

    expect(() =>
      applyLegalAction({
        state,
        action: {
          kind: "resolve_pending_effect_target",
          actionId: "resolve-overlap",
          can: true,
          reason: "test",
          actingPlayerId: "alice",
          pendingId: "pending-overlap",
          sourceInstanceId: "source",
          sourceDefinitionId: c.cardNo,
          targetMode: "manual",
          requiredTargetCount: 2,
          maxTargetCount: 2,
          candidateTargetInstanceIds: ["same-candidate", "other-candidate"],
          targetGroups: [
            {
              requiredTargetCount: 1,
              candidateTargetInstanceIds: ["same-candidate"],
            },
            {
              requiredTargetCount: 1,
              candidateTargetInstanceIds: ["same-candidate"],
            },
          ],
          targetEffectFilterTags: [],
        },
        targetInstanceIds: ["same-candidate", "other-candidate"],
        getCardDefinitionById: getBSGEDefinition,
      })
    ).toThrow(/Effect target group count does not match/);
  });

  it("[legal action] targetGroups availability は重なった候補を二重計上しない", () => {
    expect(
      areLegalActionTargetGroupsSatisfiable(
        [
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate"],
          },
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate"],
          },
        ],
        false
      )
    ).toBe(false);

    expect(
      areLegalActionTargetGroupsSatisfiable(
        [
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate"],
          },
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate"],
          },
        ],
        true
      )
    ).toBe(true);

    expect(
      areLegalActionTargetGroupsSatisfiable(
        [
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate", "other-candidate"],
          },
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["same-candidate"],
          },
        ],
        false
      )
    ).toBe(true);
  });

  it("[legal action] targetGroups apply assert も backtracking で重なった候補を割り当てる", () => {
    const targetGroups = [
      {
        requiredTargetCount: 1,
        candidateTargetInstanceIds: ["same-candidate", "other-candidate"],
      },
      {
        requiredTargetCount: 1,
        candidateTargetInstanceIds: ["same-candidate"],
      },
    ];

    expect(() =>
      assertLegalActionTargetGroupsSatisfied({
        actionId: "BSGE01-M03-overlap-backtracking",
        targetInstanceIds: ["same-candidate", "other-candidate"],
        targetGroups,
        label: "Effect target group",
      })
    ).not.toThrow();
  });

  it("[engine] grouped target 割当も backtracking で重なった候補を step に配分する", () => {
    const source = createCardInstance(c, {
      instanceId: "tsubaki-overlap-source",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const same = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "same-candidate",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const other = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "other-candidate",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, same, other],
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        { reserveNormalCoreCount: 4 },
      ],
    });
    const overlapEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: "all",
          },
        },
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            amount: -1000,
            duration: { scope: "turn" },
          },
        },
      ],
    } satisfies NonNullable<CardDefinition["effects"]>[number];

    const after = executeEffect({
      chainId: "test:bsge01-cards:11144",
      state,
      effect: overlapEffect,
      sourceInstanceId: "tsubaki-overlap-source",
      actingPlayerId: "alice",
      targetInstanceIds: ["same-candidate", "other-candidate"],
      targetGroups: [
        {
          requiredTargetCount: 1,
          targetStepId: "__step_0",
          candidateTargetInstanceIds: ["same-candidate", "other-candidate"],
        },
        {
          requiredTargetCount: 1,
          targetStepId: "__step_1",
          candidateTargetInstanceIds: ["same-candidate"],
        },
      ],
      getCardDefinitionById: getBSGEDefinition,
    });

    const sameAfter = after.cardInstances.find(
      (card) => card.instanceId === "same-candidate"
    )!;
    const otherAfter = after.cardInstances.find(
      (card) => card.instanceId === "other-candidate"
    )!;
    expect(sameAfter.normalCoreCount).toBe(2);
    expect(otherAfter.normalCoreCount).toBe(0);
    expect(
      after.log.some((line) =>
        line.startsWith("effect:bp_modify:registered:same-candidate:-1000")
      )
    ).toBe(true);
  });

  it("[legal action] BSGE01-M03 grouped target は重複許可時も選択回数で group を満たす", () => {
    const targetGroups = [
      {
        requiredTargetCount: 1,
        candidateTargetInstanceIds: ["same-candidate"],
      },
      {
        requiredTargetCount: 1,
        candidateTargetInstanceIds: ["same-candidate"],
      },
    ];

    expect(() =>
      assertLegalActionTargetGroupsSatisfied({
        actionId: "BSGE01-M03-grouped-duplicate",
        targetInstanceIds: ["same-candidate"],
        targetGroups,
        allowDuplicateTargets: true,
        label: "Effect target group",
      })
    ).toThrow(/Effect target group count does not match/);

    expect(() =>
      assertLegalActionTargetGroupsSatisfied({
        actionId: "BSGE01-M03-grouped-duplicate",
        targetInstanceIds: ["same-candidate", "same-candidate"],
        targetGroups,
        allowDuplicateTargets: true,
        label: "Effect target group",
      })
    ).not.toThrow();
  });

  it("[legal action] targetGroups apply assert は余剰の不正 target を拒否する", () => {
    const targetGroups = [
      {
        requiredTargetCount: 1,
        candidateTargetInstanceIds: ["core-target"],
      },
      {
        requiredTargetCount: 0,
        maxTargetCount: 1,
        candidateTargetInstanceIds: ["bp-target"],
      },
    ];

    expect(() =>
      assertLegalActionTargetGroupsSatisfied({
        actionId: "BSGE01-M03-grouped-extra-invalid",
        targetInstanceIds: ["core-target", "outside-target"],
        targetGroups,
        label: "Effect target group",
      })
    ).toThrow(/Effect target group count does not match/);
  });

  it("[legal action] targetGroups の maxTargetCountDynamic を対象選択時に解決する", () => {
    const source = createCardInstance(c, {
      instanceId: "tsubaki-dynamic-group-source",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetA = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "dynamic-group-a",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetB = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "dynamic-group-b",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetC = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "dynamic-group-c",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, targetA, targetB, targetC],
    });

    const groups = buildLegalActionTargetGroups({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: source.instanceId,
      getCardDefinitionById: getBSGEDefinition,
      resolveCountBound: () => 3,
      actionRegistration: {
        requiredTargetCount: 1,
        maxTargetCount: 3,
        targetGroups: [
          {
            requiredTargetCount: 1,
            maxTargetCountDynamic: {
              source: { kind: "count_value", player: "self" },
            },
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "opponent",
            targetCardFilter: { category: ["spirit"] },
          },
        ],
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.requiredTargetCount).toBe(1);
    expect(groups[0]!.maxTargetCount).toBe(3);
  });

  it("[engine] BSGE01-M03 grouped target は同一ID複数回選択を順次stepで消費できる", () => {
    const source = createCardInstance(c, {
      instanceId: "tsubaki",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef = card("BSSL01-C02");
    const target = createCardInstance(targetDef, {
      instanceId: "same-candidate",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        { reserveNormalCoreCount: 4 },
      ],
    });
    const duplicateEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: "all",
          },
        },
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            amount: -1000,
            duration: { scope: "turn" },
          },
        },
      ],
      textRef: [4, 5],
    } satisfies NonNullable<CardDefinition["effects"]>[number];

    const after = executeEffect({
      chainId: "test:bsge01-cards:11350",
      state,
      effect: duplicateEffect,
      sourceInstanceId: "tsubaki",
      actingPlayerId: "alice",
      targetInstanceIds: ["same-candidate", "same-candidate"],
      sequentialTargetConsumption: true,
      getCardDefinitionById: getBSGEDefinition,
    });

    const targetAfter = after.cardInstances.find(
      (card) => card.instanceId === "same-candidate"
    )!;
    expect(targetAfter.normalCoreCount).toBe(0);
    expect(
      after.log.some((line) =>
        line.startsWith("effect:bp_modify:registered:same-candidate:-1000")
      )
    ).toBe(true);
  });

  it("[legal action] triggered choice targetGroups を pending triggered action へ伝搬する", () => {
    const source = createCardInstance(BSGE_TRIGGERED_GROUP_TEST, {
      instanceId: "triggered-group-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const fieldTarget = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-field-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 2,
    });
    const trashBrave = createCardInstance(card("BSGE01-C05"), {
      instanceId: "alice-trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const triggeredLookup = buildTriggeredEffectLookup([
      BSGE_TRIGGERED_GROUP_TEST,
      BSGE_TEST_SPIRIT,
      card("BSGE01-C05"),
    ]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, fieldTarget, trashBrave],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingTriggeredEffects: [
        {
          pendingId: "triggered-group-pending",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:bsge01-cards:11402",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: source.instanceId,
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === source.instanceId
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      deferredChoiceIndexes: [0, 1],
      requiredTargetCount: 0,
      targetMode: "none",
    });
    const commonOptions = {
      getRegisteredTriggeredEffectActions: triggeredLookup,
    };
    const declared = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: getBSGEDefinition,
      ...commonOptions,
    }).state;
    const afterStack = passStackUntilClosed(
      declared,
      getBSGEDefinition,
      commonOptions
    );
    const afterChoice = resolvePendingStepChoice(
      afterStack,
      1,
      getBSGEDefinition,
      commonOptions
    );
    expect(afterChoice.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 2,
      targetGroups: [
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["bob-field-target"],
        },
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["alice-trash-brave"],
        },
      ],
    });
    const resolved = resolvePendingEffectTarget(
      afterChoice,
      ["bob-field-target", "alice-trash-brave"],
      getBSGEDefinition,
      commonOptions
    );
    const fieldTargetAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "bob-field-target"
    )!;
    const trashBraveAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "alice-trash-brave"
    )!;

    expect(fieldTargetAfter.normalCoreCount).toBe(0);
    expect(trashBraveAfter.zone).toBe("hand");
  });

  it("[legal action] magic choice targetGroups を use_magic action へ伝搬する", () => {
    const source = createCardInstance(BSGE_MAGIC_GROUP_TEST, {
      instanceId: "magic-group-source",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const fieldTarget = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-magic-field-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 2,
    });
    const trashBrave = createCardInstance(card("BSGE01-C05"), {
      instanceId: "alice-magic-trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const magicLookup = buildMagicLookup([
      BSGE_MAGIC_GROUP_TEST,
      BSGE_TEST_SPIRIT,
      card("BSGE01-C05"),
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, fieldTarget, trashBrave],
        playerOverrides: [
          { reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 4 },
        ],
      }),
      activePlayerId: "alice",
      step: "main" as const,
      window: "default" as const,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: buildBurstEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(BSGE_NEGATE_TEST_DEFINITIONS),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: magicLookup,
    }).filter(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceCardNo === BSGE_MAGIC_GROUP_TEST.cardNo
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      deferredChoiceIndexes: [0, 1],
      requiredTargetCount: 0,
      targetMode: "none",
    });
    const commonOptions = {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: buildBurstEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
      getRegisteredMagicActions: magicLookup,
    };
    const declared = applyLegalAction({
      state,
      action: actions[0]!,
      paymentSources: [],
      getCardDefinitionById: getBSGEDefinition,
      ...commonOptions,
    }).state;
    const afterStack = passStackUntilClosed(
      declared,
      getBSGEDefinition,
      commonOptions
    );
    const afterChoice = resolvePendingStepChoice(
      afterStack,
      1,
      getBSGEDefinition,
      commonOptions
    );
    expect(afterChoice.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 2,
      targetGroups: [
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["bob-magic-field-target"],
        },
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["alice-magic-trash-brave"],
        },
      ],
    });
    const resolved = resolvePendingEffectTarget(
      afterChoice,
      ["bob-magic-field-target", "alice-magic-trash-brave"],
      getBSGEDefinition,
      commonOptions
    );
    const fieldTargetAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "bob-magic-field-target"
    )!;
    const trashBraveAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "alice-magic-trash-brave"
    )!;

    expect(fieldTargetAfter.normalCoreCount).toBe(0);
    expect(trashBraveAfter.zone).toBe("hand");
  });

  it("[legal action] BSGE01-M03 grouped magic は宣言後に field 対象が離れたら不発にする", () => {
    const source = createCardInstance(BSGE_MAGIC_GROUP_TEST, {
      instanceId: "magic-group-fizzle-source",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const fieldTarget = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-magic-fizzle-field-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 2,
    });
    const trashBrave = createCardInstance(card("BSGE01-C05"), {
      instanceId: "alice-magic-fizzle-trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, fieldTarget, trashBrave],
        playerOverrides: [
          { reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 4 },
        ],
      }),
      activePlayerId: "alice",
      step: "main" as const,
      window: "default" as const,
    };

    const declaredStack: ActiveStack = {
      stackId: "magic-group-fizzle-stack",
      actionKind: "magic",
      chainId: "stack:magic-group-fizzle-source",
      actingPlayerId: "alice",
      cardInstanceId: "magic-group-fizzle-source",
      cardDefinitionId: BSGE_MAGIC_GROUP_TEST.cardNo,
      targetInstanceIds: [
        "bob-magic-fizzle-field-target",
        "alice-magic-fizzle-trash-brave",
      ],
      targetEffectFilterTags: ["general"],
      targetGroups: [
        {
          requiredTargetCount: 1,
          targetStepId: "__step_0",
          candidateTargetZones: ["field"],
          candidateTargetInstanceIds: ["bob-magic-fizzle-field-target"],
        },
        {
          requiredTargetCount: 1,
          targetStepId: "__step_1",
          candidateTargetZones: ["trash"],
          candidateTargetInstanceIds: ["alice-magic-fizzle-trash-brave"],
        },
      ],
      reducedCost: 0,
      totalReduction: 0,
      chosenTiming: "main",
      magicChoiceIndex: 1,
      magicEffectIndex: 0,
    };
    const staleState = {
      ...state,
      cardInstances: state.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "bob-magic-fizzle-field-target"
          ? { ...cardInstance, zone: "trash" as const }
          : cardInstance
      ),
    };
    const resolved = resolveDeferredMagicStack({
      state: staleState,
      activeStack: declaredStack,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: buildBurstEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
    });

    const fieldTargetAfter = resolved.cardInstances.find(
      (cardInstance) =>
        cardInstance.instanceId === "bob-magic-fizzle-field-target"
    )!;
    const trashBraveAfter = resolved.cardInstances.find(
      (cardInstance) =>
        cardInstance.instanceId === "alice-magic-fizzle-trash-brave"
    )!;

    expect(resolved.log).toContain(
      "magic:effect-fizzled:stack:magic-group-fizzle-source:bob-magic-fizzle-field-target,alice-magic-fizzle-trash-brave"
    );
    expect(fieldTargetAfter.normalCoreCount).toBe(2);
    expect(trashBraveAfter.zone).toBe("trash");
  });

  it("[legal action] targetGroups なし magic は宣言時候補 zone で deferred 対象を再検証する", () => {
    const source = createCardInstance(BSGE_MAGIC_TRASH_TARGET_TEST, {
      instanceId: "magic-trash-target-source",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const trashBrave = createCardInstance(card("BSGE01-C05"), {
      instanceId: "alice-single-magic-trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, trashBrave],
        playerOverrides: [
          { reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 4 },
        ],
      }),
      activePlayerId: "alice",
      step: "main" as const,
      window: "default" as const,
    };
    const declaredStack: ActiveStack = {
      stackId: "magic-trash-target-stack",
      actionKind: "magic",
      chainId: "stack:magic-trash-target-source",
      actingPlayerId: "alice",
      cardInstanceId: "magic-trash-target-source",
      cardDefinitionId: BSGE_MAGIC_TRASH_TARGET_TEST.cardNo,
      targetInstanceIds: ["alice-single-magic-trash-brave"],
      candidateTargetZones: ["trash"],
      targetEffectFilterTags: ["general"],
      reducedCost: 0,
      totalReduction: 0,
      chosenTiming: "main",
      magicEffectIndex: 0,
    };

    const resolved = resolveDeferredMagicStack({
      state,
      activeStack: declaredStack,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: buildBurstEffectLookup(
        BSGE_NEGATE_TEST_DEFINITIONS
      ),
    });

    expect(resolved.log).not.toContain(
      "magic:effect-fizzled:stack:magic-trash-target-source:alice-single-magic-trash-brave"
    );
    expect(
      resolved.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "alice-single-magic-trash-brave"
      )?.zone
    ).toBe("hand");
  });

  it("[legal action] field choice targetGroups を field stack 解決へ伝搬する", () => {
    const source = createCardInstance(BSGE_FIELD_GROUP_TEST, {
      instanceId: "field-group-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const fieldTarget = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-field-effect-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 2,
    });
    const trashBrave = createCardInstance(card("BSGE01-C05"), {
      instanceId: "alice-field-trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const fieldLookup = buildFieldCardEffectLookup([
      BSGE_FIELD_GROUP_TEST,
      BSGE_TEST_SPIRIT,
      card("BSGE01-C05"),
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, fieldTarget, trashBrave],
      }),
      activePlayerId: "alice",
      step: "main" as const,
      window: "default" as const,
    };

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_field_card_effect" &&
        candidate.sourceCardNo === BSGE_FIELD_GROUP_TEST.cardNo
    );

    expect(action).toMatchObject({
      deferredChoiceIndexes: [0, 1],
      requiredTargetCount: 0,
      targetMode: "none",
    });
    if (!action) throw new Error("field grouped action not found");

    const commonOptions = {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: fieldLookup,
    };
    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getBSGEDefinition,
      ...commonOptions,
    }).state;
    const afterStack = passStackUntilClosed(
      declared,
      getBSGEDefinition,
      commonOptions
    );
    const afterChoice = resolvePendingStepChoice(
      afterStack,
      1,
      getBSGEDefinition,
      commonOptions
    );
    expect(afterChoice.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 2,
      targetGroups: [
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["bob-field-effect-target"],
        },
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["alice-field-trash-brave"],
        },
      ],
    });
    const resolved = resolvePendingEffectTarget(
      afterChoice,
      ["bob-field-effect-target", "alice-field-trash-brave"],
      getBSGEDefinition,
      commonOptions
    );
    const fieldTargetAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "bob-field-effect-target"
    )!;
    const trashBraveAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "alice-field-trash-brave"
    )!;

    expect(fieldTargetAfter.normalCoreCount).toBe(0);
    expect(trashBraveAfter.zone).toBe("hand");
  });

  it("[legal action] hand activated choice targetGroups を hand stack 解決へ伝搬する", () => {
    const source = createCardInstance(BSGE_HAND_GROUP_TEST, {
      instanceId: "hand-group-source",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const fieldTarget = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-hand-effect-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 2,
    });
    const trashBrave = createCardInstance(card("BSGE01-C05"), {
      instanceId: "alice-hand-trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const handLookup = buildHandActivatedEffectLookup([
      BSGE_HAND_GROUP_TEST,
      BSGE_TEST_SPIRIT,
      card("BSGE01-C05"),
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, fieldTarget, trashBrave],
        playerOverrides: [
          { reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 4 },
        ],
      }),
      activePlayerId: "alice",
      step: "main" as const,
      window: "default" as const,
    };

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
        BSGE_HAND_GROUP_TEST,
        BSGE_TEST_SPIRIT,
        card("BSGE01-C05"),
      ]),
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceCardNo === BSGE_HAND_GROUP_TEST.cardNo
    );

    expect(action).toMatchObject({
      deferredChoiceIndexes: [0, 1],
      requiredTargetCount: 0,
      targetMode: "none",
    });
    if (!action) throw new Error("hand grouped action not found");

    const commonOptions = {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
        BSGE_HAND_GROUP_TEST,
        BSGE_TEST_SPIRIT,
        card("BSGE01-C05"),
      ]),
      getRegisteredHandActivatedEffectActions: handLookup,
    };
    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getBSGEDefinition,
      ...commonOptions,
    }).state;
    const afterStack = passStackUntilClosed(
      declared,
      getBSGEDefinition,
      commonOptions
    );
    const afterChoice = resolvePendingStepChoice(
      afterStack,
      1,
      getBSGEDefinition,
      commonOptions
    );
    expect(afterChoice.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 2,
      targetGroups: [
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["bob-hand-effect-target"],
        },
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["alice-hand-trash-brave"],
        },
      ],
    });
    const resolved = resolvePendingEffectTarget(
      afterChoice,
      ["bob-hand-effect-target", "alice-hand-trash-brave"],
      getBSGEDefinition,
      commonOptions
    );
    const fieldTargetAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "bob-hand-effect-target"
    )!;
    const trashBraveAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "alice-hand-trash-brave"
    )!;

    expect(fieldTargetAfter.normalCoreCount).toBe(0);
    expect(trashBraveAfter.zone).toBe("hand");
  });

  it("[legal action] burst grouped target は required と max を分けて伝搬する", () => {
    const source = createCardInstance(BSGE_BURST_VARIABLE_GROUP_TEST, {
      instanceId: "burst-variable-source",
      ownerPlayerId: "alice",
      zone: "burst",
    });
    const fieldTarget = createCardInstance(BSGE_TEST_SPIRIT, {
      instanceId: "bob-burst-field-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 2,
    });
    const trashBrave = createCardInstance(card("BSGE01-C05"), {
      instanceId: "alice-burst-trash-brave",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const burstLookup = buildBurstEffectLookup([
      BSGE_BURST_VARIABLE_GROUP_TEST,
      BSGE_TEST_SPIRIT,
      card("BSGE01-C05"),
    ]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, fieldTarget, trashBrave],
        playerOverrides: [
          { reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 4 },
        ],
      }),
      activePlayerId: "bob",
      step: "main",
      window: "main",
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "burst-variable-source" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst-variable-life-down",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          event: { family: "life", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:bsge01-cards:12019",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main",
          window: "main",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredBurstActions: burstLookup,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_burst_check" &&
        candidate.sourceCardNo === BSGE_BURST_VARIABLE_GROUP_TEST.cardNo
    );

    if (!action) throw new Error("burst grouped action not found");
    expect(action).toMatchObject({
      deferredChoiceIndexes: [0, 1],
      targetMode: "none",
      requiredTargetCount: 0,
    });

    let declaredState = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: burstLookup,
    }).state;
    while (declaredState.window === "stack" && declaredState.stackWindow) {
      const actingPlayerId = declaredState.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: declaredState,
        actingPlayerId,
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: burstLookup,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).find((candidate) => candidate.kind === "pass_stack");
      declaredState = applyLegalAction({
        state: declaredState,
        action:
          pass ??
          ({
            kind: "pass_stack",
            actionId: `pass:${actingPlayerId}`,
            can: true,
            reason: "test_close",
            actingPlayerId,
          } as const),
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: burstLookup,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }).state;
    }
    declaredState = resolvePendingStepChoice(
      declaredState,
      1,
      getBSGEDefinition,
      {
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: burstLookup,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
          BSGE_NEGATE_TEST_DEFINITIONS
        ),
      }
    );
    expect(declaredState.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 2,
      targetGroups: [
        {
          requiredTargetCount: 1,
          candidateTargetInstanceIds: ["bob-burst-field-target"],
        },
        {
          requiredTargetCount: 0,
          maxTargetCount: 1,
          candidateTargetInstanceIds: ["alice-burst-trash-brave"],
        },
      ],
    });
  });
});

describe("BSGE01-M04 竹田ヒバリ", () => {
  const c = card("BSGE01-M04");
  it("BSGE01-M04 はトラッシュ起動フラッシュ回収を表現し、セット中攻撃発動はown_attack追加発動条件、バースト本体はenter_soul_stateトリガーとして表現する", () => {
    expect(c.effects).toHaveLength(4);
    expect(c.effects![0]!.applicability).toEqual({ zone: ["trash"] });
    expect(c.effects![0]!.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.textRef).toEqual([0]);
    expect(c.effects![0]!.steps).toEqual([
      { action: { kind: "count_decrease", player: "self", amount: 1 } },
      {
        action: { kind: "move_self", destination: "hand" },
        connector: "conditional_cost",
      },
    ]);

    // own_attack 追加発動条件 (裁定 2026-07-23): steps は effects[2] (enter_soul_state) と共有。
    const ownAttackTrigger = c.effects![1]!;
    expect(ownAttackTrigger.textRef).toEqual([1]);
    expect(ownAttackTrigger.stub).toBeUndefined();
    expect(ownAttackTrigger.timing).toEqual({
      kind: "burst",
      trigger: { kind: "own_attack", player: "self" },
      triggerFilter: { category: ["spirit"] },
    });
    expect(ownAttackTrigger.steps).toEqual(c.effects![2]!.steps);

    const burst = c.effects![2]!;
    expect(burst.textRef).toEqual([3, 4]);
    expect(burst.stub).toBeUndefined();
    expect(burst.timing).toEqual({
      kind: "burst",
      trigger: { kind: "enter_soul_state", player: "self" },
      triggerFilter: { category: ["spirit"], soulState: "include" },
    });
    expect(burst.steps[0]!.action).toEqual({
      kind: "exhaust",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {
          filterOr: [{ category: ["spirit"] }, { category: ["ultimate"] }],
        },
        count: 1,
      },
      degree: "heavy_exhaust",
    });
    const deckReveal = burst.steps[1]!.action;
    expect(deckReveal.kind).toBe("deck_reveal");
    if (deckReveal.kind === "deck_reveal") {
      expect(deckReveal.revealCount).toBe(5);
      expect(deckReveal.remainder).toBe("bottom");
      expect(deckReveal.picks).toEqual([
        {
          count: 1,
          filter: { colors: ["green", "blue"], hasMechanic: ["mirage"] },
          destination: "mirage_set",
          mandatory: true,
        },
        {
          count: 1,
          filter: { category: ["brave"], colors: ["green", "blue"] },
          destination: "hand",
          mandatory: true,
        },
      ]);
    }
  });

  it("[board] BSGE01-M04 バースト本体: 相手1体重疲労＋デッキ5枚オープンでミラージュ緑/青コストなしセット(既存ミラージュは手札へ)＋緑/青ブレイヴ1枚手札＋残りはデッキ下", () => {
    const source = createCardInstance(c, {
      instanceId: "hibari-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const target = createCardInstance(card("BSSL01-C02"), {
      instanceId: "target-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      exhaustState: "exhausted",
    });
    // 既存ミラージュ (置換されて手札へ戻る)。
    const existingMirage = createCardInstance(card("BSGE01-C04"), {
      instanceId: "existing-mirage",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "mirage",
    });
    // デッキ上から5枚: [0]ミラージュ緑(セット対象) [1]ブレイヴ緑(手札対象) [2..4]無関係フィラー。
    const deckMirageGreen = createCardInstance(card("BSGE01-C02"), {
      instanceId: "deck-mirage-green",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const deckBraveGreen = createCardInstance(card("BSGE01-C06"), {
      instanceId: "deck-brave-green",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const fillers = [0, 1, 2].map((i) =>
      createCardInstance(card("BSSL01-C02"), {
        instanceId: `deck-filler-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          source,
          target,
          existingMirage,
          deckMirageGreen,
          deckBraveGreen,
          ...fillers,
        ],
        playerOverrides: [{}, {}],
      }),
      mirageSetStates: [
        { playerId: "alice", cardInstanceId: "existing-mirage" },
      ],
    };

    const afterEffect = executeEffect({
      chainId: "test:bsge01-cards:12251",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      targetInstanceIds: [target.instanceId],
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      afterEffect.cardInstances.find((x) => x.instanceId === "target-spirit")
        ?.exhaustState
    ).toBe("heavily_exhausted");
    expect(afterEffect.pendingDeckReveal).not.toBeNull();

    let after = afterEffect;
    for (let i = 0; i < 10 && after.pendingDeckReveal; i++) {
      const actions = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredTriggeredEffectActions: () => [],
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
          getCardDefinitionById: getBSGEDefinition,
          getRegisteredTriggeredEffectActions: () => [],
          selectedDeckRevealCardIds: pickAction.candidateCardInstanceIds.slice(
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
          getCardDefinitionById: getBSGEDefinition,
          getRegisteredTriggeredEffectActions: () => [],
          deckRevealRemainderOrder: orderAction.remainingCardInstanceIds,
        }).state;
      } else {
        break;
      }
    }

    expect(after.pendingDeckReveal).toBeNull();

    // 新ミラージュ: デッキのミラージュ緑カードが mirage ゾーンへ、mirageSetStates 更新。
    const newMirageCard = after.cardInstances.find(
      (x) => x.instanceId === "deck-mirage-green"
    )!;
    expect(newMirageCard.zone).toBe("mirage");
    expect(
      after.mirageSetStates.find((s) => s.playerId === "alice")?.cardInstanceId
    ).toBe("deck-mirage-green");

    // 旧ミラージュは手札へ戻る。
    expect(
      after.cardInstances.find((x) => x.instanceId === "existing-mirage")?.zone
    ).toBe("hand");

    // ブレイヴ緑は手札へ。
    expect(
      after.cardInstances.find((x) => x.instanceId === "deck-brave-green")?.zone
    ).toBe("hand");

    // 残った3枚のフィラーはデッキに戻る(下)。
    for (const filler of fillers) {
      expect(
        after.cardInstances.find((x) => x.instanceId === filler.instanceId)
          ?.zone
      ).toBe("deck");
    }
  });

  describe("BSGE01-M04 own_attack / enter_soul_state 追加発動条件", () => {
    it("[trigger] enter_soul_state イベント (player.soulStateInstanceIds 差分) は BSGE01-M04 の pendingBurstCheck を積む", () => {
      const source = createCardInstance(c, {
        instanceId: "hibari-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const soulEligible = createCardInstance(card("BSSL01-C02"), {
        instanceId: "soul-eligible",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const before: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, soulEligible],
          playerOverrides: [{}, {}],
        }),
        setBurstStates: [{ playerId: "alice", cardInstanceId: "hibari-burst" }],
      };
      // 魂状態は zone ではなく player.soulStateInstanceIds への登録で表現される
      // (01_glossary-and-card-types.md 実装メモ)。ここでは diff 検出の入力として
      // 直接差分を作る (FieldExitReplacement soul_state 置換の結果と同じ形)。
      const after: GameState = {
        ...before,
        players: before.players.map((p) =>
          p.id === "alice"
            ? { ...p, soulStateInstanceIds: ["soul-eligible"] }
            : p
        ),
      };

      const withTriggers = collectAndQueueTriggerReactions({
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        chainId: "test-enter-soul-state",
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: getBSGEBurstActions,
        causedByPlayerId: "alice",
      });

      const check = withTriggers.pendingBurstChecks.find(
        (b) =>
          b.eventKind === "enter_soul_state" && b.actingPlayerId === "alice"
      );
      expect(check).toBeDefined();
      expect(check?.relatedInstanceId).toBe("soul-eligible");

      const actions = getLegalActions({
        state: withTriggers,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
      }).filter(
        (action) =>
          action.kind === "resolve_pending_burst_check" &&
          action.sourceInstanceId === "hibari-burst"
      );
      expect(actions.length).toBeGreaterThanOrEqual(1);
    });

    it("[legal action] own_attack pendingBurstCheck は BSGE01-M04 の追加発動条件を提示する", () => {
      const source = createCardInstance(c, {
        instanceId: "hibari-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const attacker = createCardInstance(card("BSSL01-C02"), {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, attacker],
          playerOverrides: [{}, {}],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "declare_attack",
        setBurstStates: [{ playerId: "alice", cardInstanceId: "hibari-burst" }],
        pendingBurstChecks: [
          {
            checkId: "m04-own-attack",
            actingPlayerId: "alice",
            eventKind: "own_attack",
            event: {
              family: "action_declared",
              actionKind: "attack",
              validationMode: "require_related_instance_on_field",
            },
            source: "action_resolution",
            chainId: "test:bsge01-cards:12432",
            attackId: "attack-1",
            relatedPlayerId: "alice",
            relatedInstanceId: "alice-attacker",
            amount: 1,
            step: "attack",
            window: "declare_attack",
            resolvedBurstCardInstanceIds: [],
          },
        ],
      };

      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
      }).filter(
        (action) =>
          action.kind === "resolve_pending_burst_check" &&
          action.sourceInstanceId === "hibari-burst"
      );
      expect(actions.length).toBeGreaterThanOrEqual(1);
    });

    it("[legal action] own_attack pendingBurstCheck はアタッカーがアルティメットのとき BSGE01-M04 の追加発動条件を提示しない (triggerFilter.category:['spirit'])", () => {
      const source = createCardInstance(c, {
        instanceId: "hibari-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const attacker = createCardInstance(card("BSAZ02-C01"), {
        instanceId: "alice-ultimate-attacker",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, attacker],
          playerOverrides: [{}, {}],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "declare_attack",
        setBurstStates: [{ playerId: "alice", cardInstanceId: "hibari-burst" }],
        pendingBurstChecks: [
          {
            checkId: "m04-own-attack-ultimate",
            actingPlayerId: "alice",
            eventKind: "own_attack",
            event: {
              family: "action_declared",
              actionKind: "attack",
              validationMode: "require_related_instance_on_field",
            },
            source: "action_resolution",
            chainId: "test:bsge01-cards:12493",
            attackId: "attack-1",
            relatedPlayerId: "alice",
            relatedInstanceId: "alice-ultimate-attacker",
            amount: 1,
            step: "attack",
            window: "declare_attack",
            resolvedBurstCardInstanceIds: [],
          },
        ],
      };

      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredBurstActions: getBSGEBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
      }).filter(
        (action) =>
          action.kind === "resolve_pending_burst_check" &&
          action.sourceInstanceId === "hibari-burst"
      );
      expect(actions).toHaveLength(0);
    });

    it("[trigger] 手札/手元から直接魂状態化した場合 (BSLH01-CX01 activate_soul_state 型、fromZone!=='field') は BSGE01-M04 の pendingBurstCheck を積まない", () => {
      const source = createCardInstance(c, {
        instanceId: "hibari-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const soulEligible = createCardInstance(card("BSSL01-C02"), {
        instanceId: "soul-eligible-from-hand",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      });
      const before: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, soulEligible],
          playerOverrides: [{}, {}],
        }),
        setBurstStates: [{ playerId: "alice", cardInstanceId: "hibari-burst" }],
      };
      // BSLH01-CX01 activate_soul_state と同型: hand→field へ zone が変わると同時に
      // soulStateInstanceIds へ登録される (executeEnterSoulState と同じ形の diff)。
      const after: GameState = {
        ...before,
        cardInstances: before.cardInstances.map((x) =>
          x.instanceId === "soul-eligible-from-hand"
            ? { ...x, zone: "field" as const }
            : x
        ),
        players: before.players.map((p) =>
          p.id === "alice"
            ? { ...p, soulStateInstanceIds: ["soul-eligible-from-hand"] }
            : p
        ),
      };

      const withTriggers = collectAndQueueTriggerReactions({
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        chainId: "test-enter-soul-state-from-hand",
        getCardDefinitionById: getBSGEDefinition,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: getBSGEBurstActions,
        causedByPlayerId: "alice",
      });

      const check = withTriggers.pendingBurstChecks.find(
        (b) =>
          b.eventKind === "enter_soul_state" && b.actingPlayerId === "alice"
      );
      expect(check).toBeUndefined();
    });
  });

  it("[legal action] BSGE01-M04 はトラッシュからフラッシュタイミングでカウント-1し手札に戻せる", () => {
    const source = createCardInstance(c, {
      instanceId: "hibari-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const handLookup = buildHandActivatedEffectLookup([c]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
        playerOverrides: [{ countValue: 3 }, { countValue: 0 }],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "default",
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    const action = actions.find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === "hibari-trash"
    );
    expect(action).toBeDefined();
    if (!action) throw new Error("trash-zone hand activated action not found");

    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    const resolved = passStackUntilClosed(declared.state, getBSGEDefinition, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: handLookup,
    });

    const after = resolved.cardInstances.find(
      (card) => card.instanceId === "hibari-trash"
    )!;
    expect(after.zone).toBe("hand");
    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(2);
  });

  // 【奇霊：ショット】(P3-111 S10): バレットエディット下、自分のターン中フラッシュ
  // 〔ターンに1回：同名〕カウント-2で相手創界神ネクサス全コアをボイドに。
  it("BSGE01-M04: 【奇霊：ショット】は activated(flash) + usageLimit per_card_name + core_move field_card 一括ドレインで表現", () => {
    const e = c.effects![3]!;
    expect(e.textRef).toEqual([6, 7]);
    expect(e.stub).toBeUndefined();
    expect(e.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(e.timingScope).toEqual({ player: "self", period: "turn" });
    expect(e.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(e.steps).toEqual([
      { action: { kind: "count_decrease", player: "self", amount: 2 } },
      {
        action: {
          kind: "core_move",
          from: {
            kind: "field_card",
            player: "opponent",
            filter: {
              category: ["nexus"],
              targetsGrandwalker: "only",
            },
          },
          to: { kind: "void", player: "opponent" },
          amount: "all",
        },
        connector: "conditional_cost",
      },
    ]);
  });
});

describe("BSGE01-R02〜R05 神喰GEスピリット", () => {
  function summonAttackCountEffect(no: string) {
    const c = card(no);
    const effect = c.effects!.find(
      (x) =>
        x.timing.kind === "card_event" &&
        Array.isArray((x.timing as { event: unknown }).event)
    );
    if (!effect) throw new Error(`summon/attack effect not found: ${no}`);
    return effect;
  }

  it.each(["BSGE01-R02", "BSGE01-R03", "BSGE01-R04", "BSGE01-R05"])(
    "%s: 召喚/アタックでカウント+1(ターン1回)",
    (no) => {
      const e = summonAttackCountEffect(no);
      expect(e!.usageLimit).toEqual({
        kind: "per_instance",
        duration: "turn",
        maxCount: 1,
      });
      const cnt = e!.steps[0]!.action;
      if (cnt.kind === "count_increase") expect(cnt.amount).toBe(1);
    }
  );

  it.each([
    ["BSGE01-R02", "draw"],
    ["BSGE01-R03", "core_move"],
    ["BSGE01-R04", "core_move"],
    ["BSGE01-R05", "draw"],
  ] as const)(
    "%s: カウント+1は effect-level mandatory、後続 %s だけ step optional",
    (no, optionalActionKind) => {
      const e = summonAttackCountEffect(no);
      expect(e.executionMode).toBe("mandatory");
      expect(e.steps[0]!.executionMode).toBeUndefined();
      expect(e.steps[0]!.action.kind).toBe("count_increase");
      expect(e.steps[1]!.executionMode).toBe("optional");
      expect(e.steps[1]!.action.kind).toBe(optionalActionKind);
    }
  );

  it("BSGE01-R03: usageLimit 未消費なら召喚時効果は mandatory で、コア置きだけ辞退できる", () => {
    const c = card("BSGE01-R03");
    const source = createCardInstance(c, {
      instanceId: "r03-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const triggeredLookup = buildTriggeredEffectLookup([c]);
    const lookupOpts = {
      getCardDefinitionById: getBSGEDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    };
    const pendingSummon = {
      pendingId: "pending:r03:summon",
      eventKind: "summon" as const,
      actingPlayerId: "alice",
      source: "action_resolution" as const,
      chainId: "test:bsge01-cards:12732",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: source.instanceId,
      amount: null,
      step: "main" as const,
      window: "default" as const,
      resolvedSourceInstanceIds: [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
        playerOverrides: [{ countValue: 0, voidNormalCoreCount: 10 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingTriggeredEffects: [pendingSummon],
    };

    const triggerActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === source.instanceId
    );
    expect(
      triggerActions.find((action) => action.skipOnly === true)
    ).toBeUndefined();
    const fire = triggerActions.find((action) => action.skipOnly !== true);
    expect(fire).toMatchObject({
      executionMode: "mandatory",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: "BSGE01-R03",
    });

    const declared = applyLegalAction({
      state,
      action: fire!,
      ...lookupOpts,
    }).state;
    const afterStack = passStackUntilClosed(
      declared,
      getBSGEDefinition,
      lookupOpts
    );
    const aliceAfterCount = afterStack.players.find((p) => p.id === "alice")!;
    const voidCoreCountBeforeOptional = aliceAfterCount.voidNormalCoreCount;
    const coreCountBeforeOptional = afterStack.cardInstances.find(
      (x) => x.instanceId === source.instanceId
    )!.normalCoreCount;
    expect(aliceAfterCount.countValue).toBe(1);
    expect(aliceAfterCount.protectedCounts).toEqual({ 神喰: 1 });
    expect(coreCountBeforeOptional).toBe(1);
    expect(afterStack.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: source.instanceId,
      stepIndex: 1,
      choosingPlayerId: "alice",
    });

    const decline = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(decline).toBeDefined();
    const afterDecline = applyLegalAction({
      state: afterStack,
      action: decline!,
      ...lookupOpts,
    }).state;

    const aliceAfterDecline = afterDecline.players.find(
      (p) => p.id === "alice"
    )!;
    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(aliceAfterDecline.countValue).toBe(1);
    expect(aliceAfterDecline.protectedCounts).toEqual({ 神喰: 1 });
    expect(aliceAfterDecline.voidNormalCoreCount).toBe(
      voidCoreCountBeforeOptional
    );
    expect(
      afterDecline.cardInstances.find((x) => x.instanceId === source.instanceId)
        ?.normalCoreCount
    ).toBe(coreCountBeforeOptional);
    expect(
      afterDecline.effectUsageRecords.some(
        (record) => record.sourceInstanceId === source.instanceId
      )
    ).toBe(true);

    const repeatedState: GameState = {
      ...afterDecline,
      pendingTriggeredEffects: [
        { ...pendingSummon, pendingId: "pending:r03:summon-repeat" },
      ],
    };
    const repeatActions = getLegalActions({
      state: repeatedState,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === source.instanceId
    );
    expect(repeatActions).toHaveLength(1);
    expect(repeatActions[0]).toMatchObject({
      skipOnly: true,
      sourceInstanceId: source.instanceId,
      sourceCardNo: "BSGE01-R03",
    });
  });
});

describe("BSGE01-R01〜R05 離脱→魂状態化 (soul_state 置換 CE)", () => {
  it.each([
    "BSGE01-R01",
    "BSGE01-R02",
    "BSGE01-R03",
    "BSGE01-R04",
    "BSGE01-R05",
  ])(
    "%s: effects[0] に soul_state 置換の effect_resistance を持ち stub でない",
    (no) => {
      const c = card(no);
      const e0 = c.effects![0]!;
      expect(e0.stub).toBeUndefined();
      const res = e0.steps.find((s) => s.action.kind === "effect_resistance");
      expect(res).toBeDefined();
      const action = res!.action;
      if (action.kind === "effect_resistance") {
        expect(action.resistsOutcome).toBe("leave_field");
        expect(action.source).toBe("opponent_effect");
        expect(action.replacement).toEqual({ kind: "soul_state" });
      }
    }
  );
});

describe("BSGE01-R05 藤木コウタ", () => {
  const c = card("BSGE01-R05");
  it("赤としても扱う treat_as", () => {
    const t = c.effects![0]!.steps[0]!.action;
    expect(t.kind).toBe("treat_as");
    if (t.kind === "treat_as") expect(t.asColor).toBe("red");
  });
  it("召喚/アタック時のドローは『デッキの下から』(position:bottom)", () => {
    const e = c.effects!.find(
      (x) =>
        x.timing.kind === "card_event" &&
        Array.isArray((x.timing as { event: unknown }).event)
    );
    const draw = e!.steps.find((s) => s.action.kind === "draw")!.action;
    expect(draw.kind).toBe("draw");
    if (draw.kind === "draw") expect(draw.position).toBe("bottom");
  });

  it("【神威：ノーマル】バレットエディット下にあるとき、host に黄シンボル1つ追加 (P3-111)", () => {
    const hostDef = card("BSGE01-CX01");
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const under = createCardInstance(c, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    under.attachedToInstanceId = "host-1";

    const lookup = (id: string) =>
      id === hostDef.cardNo ? hostDef : id === c.cardNo ? c : undefined;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, under],
    });

    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const hostAfter = rebuilt.cardInstances.find(
      (card) => card.instanceId === "host-1"
    )!;
    expect(getEffectiveSymbols(rebuilt, hostAfter, hostDef, lookup)).toContain(
      "yellow"
    );
  });

  it("BSGE01-C13 配置軽減: メインステップの合体 host は赤+ブレイヴ紫+バレットエディット付与黄で3軽減する", () => {
    const hostDef = card("BSGE01-CX01");
    const braveDef = card("BSGE01-C05");
    const nexusDef = card("BSGE01-C13");
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.attachedChildrenIds = ["brave-1"];
    host.underCards = [
      {
        cardInstanceId: "under-r05",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      attachedToInstanceId: host.instanceId,
    });
    const under = createCardInstance(c, {
      instanceId: "under-r05",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      attachedToInstanceId: host.instanceId,
    });
    const nexus = createCardInstance(nexusDef, {
      instanceId: "fenrir-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const lookup = (id: string) =>
      [hostDef, braveDef, c, nexusDef].find(
        (definition) => definition.cardNo === id
      );
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, under, nexus],
        battleEntities: [],
      }),
      lookup
    );

    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: nexusDef,
      sourceInstanceId: nexus.instanceId,
      getCardDefinitionById: lookup,
      useKind: "place_nexus",
    });

    expect(reduction.reductionBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: "red", applied: 1 }),
        expect.objectContaining({ color: "purple", applied: 1 }),
        expect.objectContaining({ color: "yellow", applied: 1 }),
      ])
    );
    expect(reduction.totalReduction).toBe(3);
    expect(reduction.finalCost).toBe(0);
  });

  it("旧スナップショット互換: roleTag=装弾 の下カードでも【神威：ノーマル】を host に適用する", () => {
    const hostDef = card("BSGE01-CX01");
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.underCards = [
      { cardInstanceId: "under-1", role: "text_role", roleTag: "装弾" },
    ];
    const under = createCardInstance(c, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    under.attachedToInstanceId = "host-1";

    const lookup = (id: string) =>
      id === hostDef.cardNo ? hostDef : id === c.cardNo ? c : undefined;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, under],
    });

    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const hostAfter = rebuilt.cardInstances.find(
      (card) => card.instanceId === "host-1"
    )!;
    expect(getEffectiveSymbols(rebuilt, hostAfter, hostDef, lookup)).toContain(
      "yellow"
    );
  });

  it("【呪縛：モルター】バレットエディット下にあるとき、host に paid_prevention_immunity_offer CE を付与 (ENGINE-bsge01-r04-paid-prevention-immunity)", () => {
    const hostDef = card("BSGE01-CX01");
    const under = card("BSGE01-R04");
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const underCard = createCardInstance(under, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    underCard.attachedToInstanceId = "host-1";

    const lookup = (id: string) =>
      id === hostDef.cardNo ? hostDef : id === under.cardNo ? under : undefined;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, underCard],
    });

    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    expect(getPaidPreventionImmunityCost(rebuilt, "host-1")).toEqual({
      resource: "count",
      amount: 1,
    });
    // 下カード自身の instanceId には付与されない（host にのみ効果が及ぶ）。
    expect(getPaidPreventionImmunityCost(rebuilt, "under-1")).toBeNull();
  });
});

// 【神楽：スラスター】(BSGE01-M01 effects[2], P3-111 S10): バレットエディット下 +
// host 名条件付き activated(flash) 起動効果の盤面検証。legal-actions-availability.ts の
// text_role under 起動効果ゲート (旧「星霊衣」roleTag ハードコード) 汎用化と、新規
// ConditionClause self_name (sourceInstanceId=host のカード自身の名前判定) の両方を経由する。
describe("BSGE01-M01 【神楽：スラスター】盤面検証 (P3-111 S10)", () => {
  const underDef = card("BSGE01-M01");
  const matchingHostDef = card("BSGE01-CX01"); // name: 神薙 ユウ
  const nonMatchingHostDef = card("BSGE01-CX03"); // name: 空木 レンカ
  const nexusDef = card("BSLH01-X02"); // grandwalkerData.kind:"grandwalker" ([創界神]キーア-零の至宝)
  const expanded = expandCardDefinitionsWithBackFaces([
    underDef,
    matchingHostDef,
    nonMatchingHostDef,
    nexusDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const fieldLookup = buildFieldCardEffectLookup(expanded);

  function makeState(options: {
    hostDef: CardDefinition;
    countValue: number;
  }): GameState {
    const host = createCardInstance(options.hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    under.attachedToInstanceId = "host-1";
    const nexus = createCardInstance(nexusDef, {
      instanceId: "nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, under, nexus],
        playerOverrides: [{ countValue: options.countValue }, {}],
      }),
      step: "attack",
      window: "flash_before_block",
      activePlayerId: "alice",
      activeAttack: {
        attackId: "test-attack",
        primaryEntityId: "be-test",
        participantEntityIds: ["be-test"],
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

  function findUseAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceEffectInstanceId === "under-1"
    );
  }

  it("host が「神薙 ユウ」でカウント2以上のとき legal action が列挙される", () => {
    const state = makeState({ hostDef: matchingHostDef, countValue: 2 });
    expect(findUseAction(state)).toBeDefined();
  });

  it("host が名前条件を満たさないとき legal action は列挙されない", () => {
    const state = makeState({ hostDef: nonMatchingHostDef, countValue: 2 });
    expect(findUseAction(state)).toBeUndefined();
  });

  function resolveThroughPass(
    state: GameState,
    declaration: NonNullable<ReturnType<typeof findUseAction>>
  ) {
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash")!;

    return applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;
  }

  it("自分のカウントが2未満のとき「ことで」コスト不足で宣言候補に出さない", () => {
    const state = makeState({ hostDef: matchingHostDef, countValue: 1 });
    expect(findUseAction(state)).toBeUndefined();
  });

  it("適用(宣言→相手パス→対象選択)すると相手の創界神ネクサスが破壊され、カウントが2減る", () => {
    const state = makeState({ hostDef: matchingHostDef, countValue: 2 });
    const declaration = findUseAction(state)!;
    const afterPass = resolveThroughPass(state, declaration);

    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(targetSelection).toBeDefined();

    const resolved = applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds: ["nexus-1"],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "nexus-1")?.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(0);
  });
});

// 【奇霊：ショット】(BSGE01-M03 effects[2], P3-111 S10): バレットエディット下、
// 自分のターン中フラッシュ〔ターンに1回：同名〕での創界神ネクサス全コアドレイン。
describe("BSGE01-M03 【奇霊：ショット】盤面検証 (P3-111 S10)", () => {
  const underDef = card("BSGE01-M03");
  const hostDef = card("BSGE01-CX01");
  const nexusDef = card("BSLH01-X02");
  const expanded = expandCardDefinitionsWithBackFaces([
    underDef,
    hostDef,
    nexusDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const fieldLookup = buildFieldCardEffectLookup(expanded);

  function makeState(countValue: number): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    under.attachedToInstanceId = "host-1";
    const nexusA = createCardInstance(nexusDef, {
      instanceId: "nexus-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const nexusB = createCardInstance(nexusDef, {
      instanceId: "nexus-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, under, nexusA, nexusB],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [{ countValue }, {}],
      }),
      step: "main",
      window: "none",
      activePlayerId: "alice",
    };
  }

  function findUseAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceEffectInstanceId === "under-1"
    );
  }

  it("自分のターン中カウント2以上のとき legal action が列挙される", () => {
    expect(findUseAction(makeState(2))).toBeDefined();
  });

  it("自分のカウントが2未満のとき「ことで」コスト不足で宣言候補に出さない", () => {
    expect(findUseAction(makeState(1))).toBeUndefined();
  });

  it("適用すると相手の創界神ネクサス全てのコアがボイドへ置かれ、同ターン中は再使用できない", () => {
    const state = makeState(2);
    const declaration = findUseAction(state)!;

    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack")!;

    const resolved = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const bobAfter = resolved.players.find((p) => p.id === "bob")!;
    expect(bobAfter.voidNormalCoreCount).toBe(5);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "nexus-a")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "nexus-b")
        ?.normalCoreCount
    ).toBe(0);
    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(0);

    expect(findUseAction(resolved)).toBeUndefined();
  });
});

describe("BSGE01-R03 橘サクヤ", () => {
  it("【雷鎚：ショット】バレットエディット下にあるとき、アタック時カウント-2で相手ライフのコア1個をトラッシュへ (P3-111)", () => {
    const hostDef = card("BSGE01-CX01");
    const underDef = card("BSGE01-R03");
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    under.attachedToInstanceId = "host-1";

    const lookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === underDef.cardNo
          ? underDef
          : undefined;
    const battleLookup = buildBattleImmediateEffectLookup([hostDef, underDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, under],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const lookupOpts = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });

    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectInstanceId === "under-1" &&
        !action.skipOnly
    );
    expect(declaration).toMatchObject({
      sourceInstanceId: "host-1",
      sourceEffectDefinitionId: "BSGE01-R03",
      sourceEffectInstanceId: "under-1",
    });

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      ...lookupOpts,
    }).state;
    const resolved = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: "bob",
      },
      ...lookupOpts,
    }).state;

    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(0);
    const bobAfter = resolved.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(4);
    expect(bobAfter.trashNormalCoreCount).toBe(1);
  });

  it("自分のカウントが2未満なら【雷鎚：ショット】のコアシュートは発揮されない (ことで構文のコスト不足)", () => {
    const hostDef = card("BSGE01-CX01");
    const underDef = card("BSGE01-R03");
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    under.attachedToInstanceId = "host-1";

    const lookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === underDef.cardNo
          ? underDef
          : undefined;
    const battleLookup = buildBattleImmediateEffectLookup([hostDef, underDef]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, under],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    const lookupOpts = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-2",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });

    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectInstanceId === "under-1" &&
        !action.skipOnly
    );
    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      ...lookupOpts,
    }).state;
    const resolved = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: "bob",
      },
      ...lookupOpts,
    }).state;

    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(1);
    const bobAfter = resolved.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(5);
    expect(bobAfter.trashNormalCoreCount).toBe(0);
  });
});

describe("BSGE01-R01 アリサ・イリーニチナ・アミエーラ", () => {
  function buildAliceR01HandFlashState(
    options: {
      reserveNormalCoreCount?: number;
      soulCoreLocation?: GameState["players"][number]["soulCoreLocation"];
      extraCardInstances?: GameState["cardInstances"];
    } = {}
  ) {
    const c = card("BSGE01-R01");
    const attackerDef = card("BSGE01-R02");
    const source = createCardInstance(c, {
      instanceId: "alice-r01-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const handLookup = buildHandActivatedEffectLookup([c, attackerDef]);
    const lookup = (id: string) => cardNoMap.get(id);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          source,
          attacker,
          ...(options.extraCardInstances ?? []),
        ],
        playerOverrides: [
          {
            deckCount: 5,
            reserveNormalCoreCount: options.reserveNormalCoreCount ?? 5,
            handCount: 1,
            ...(options.soulCoreLocation !== undefined
              ? { soulCoreLocation: options.soulCoreLocation }
              : {}),
          },
          { deckCount: 5, reserveNormalCoreCount: 5 },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-attacker",
            memberInstanceIds: ["alice-attacker"],
            resolvedBp: 3000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:r01",
          primaryEntityId: "battle-entity:alice-attacker",
          participantEntityIds: ["battle-entity:alice-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-attacker"],
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
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      turnNumber: 2,
    };

    return { c, handLookup, lookup, state };
  }

  function findAliceR01HandAction(
    state: GameState,
    lookup: (id: string) => CardDefinition | undefined,
    handLookup: ReturnType<typeof buildHandActivatedEffectLookup>
  ) {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "alice-r01-hand"
    );
    if (!action || action.kind !== "use_hand_card_effect") {
      throw new Error("BSGE01-R01 hand activated action not found");
    }
    return action;
  }

  it("フラッシュ『お互いのアタックステップ』の手札自己召喚は1コスト召喚後にコア1個と1ドローを行う", () => {
    const c = card("BSGE01-R01");
    const effect = c.effects![2]!;

    expect(effect.applicability).toEqual({ zone: "hand" });
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect.activationLabel).toBe("flash");
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toMatchObject([
      {
        id: "r01-self-summon",
        action: {
          kind: "summon",
          target: { kind: "self" },
          costModifier: { fixedPayment: 1 },
        },
      },
      {
        stepCondition: {
          kind: "ref_succeeded",
          stepId: "r01-self-summon",
        },
        action: {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          to: { kind: "this_card" },
          amount: 1,
        },
      },
      {
        stepCondition: {
          kind: "ref_succeeded",
          stepId: "r01-self-summon",
        },
        action: { kind: "draw", count: 1 },
      },
    ]);
  });

  it("[legal action] フラッシュ手札自己召喚は起動効果として宣言し、窓後に1コスト召喚+追加コア+ドローを解決する", () => {
    const c = card("BSGE01-R01");
    const attackerDef = card("BSGE01-R02");
    const source = createCardInstance(c, {
      instanceId: "alice-r01-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const handLookup = buildHandActivatedEffectLookup([c, attackerDef]);
    const lookup = (id: string) =>
      id === c.cardNo ? c : id === attackerDef.cardNo ? attackerDef : undefined;
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, attacker],
        playerOverrides: [
          { deckCount: 5, reserveNormalCoreCount: 5, handCount: 1 },
          { deckCount: 5, reserveNormalCoreCount: 5 },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-attacker",
            memberInstanceIds: ["alice-attacker"],
            resolvedBp: 3000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:r01",
          primaryEntityId: "battle-entity:alice-attacker",
          participantEntityIds: ["battle-entity:alice-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-attacker"],
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
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      turnNumber: 2,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    const action = actions.find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "alice-r01-hand"
    );
    expect(action).toBeDefined();
    expect(
      actions.some(
        (candidate) =>
          candidate.kind === "summon" &&
          candidate.sourceInstanceId === "alice-r01-hand"
      )
    ).toBe(false);
    if (!action || action.kind !== "use_hand_card_effect") {
      throw new Error("BSGE01-R01 hand activated action not found");
    }
    expect(action).toMatchObject({
      effectIndex: 2,
      chosenTiming: "flash",
      activationLabel: "flash",
      sourceActivationZone: "hand",
      targetMode: "none",
    });

    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;
    expect(
      declared.activeAttack?.flashWindowState.pendingStackAction
    ).toMatchObject({
      actionKind: "hand_card_effect",
      handActivatedEffectIndex: 2,
    });
    expect(
      declared.activeAttack?.flashWindowState.pendingStackAction
        ?.summonPaymentSources
    ).toBeUndefined();
    expect(
      declared.activeAttack?.flashWindowState.pendingStackAction
        ?.summonEnterFieldCorePlacements
    ).toBeUndefined();
    const declaredSource = declared.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-r01-hand"
    )!;
    const declaredAlice = declared.players.find(
      (player) => player.id === "alice"
    )!;
    expect(declaredSource.zone).toBe("in_use");
    expect(declaredAlice.reserveNormalCoreCount).toBe(5);
    expect(declaredAlice.deckCount).toBe(5);
    expect(declaredAlice.handCount).toBe(0);

    let afterStack = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    expect(afterStack.pendingEffectSummonCostPayment).toMatchObject({
      requiredCost: 1,
    });
    expect(
      afterStack.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(5);
    const paymentAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_summon_cost_payment"
    );
    expect(paymentAction?.can).toBe(true);
    afterStack = applyLegalAction({
      state: afterStack,
      action: paymentAction!,
      summonPaymentSources: [
        { kind: "reserve", amount: 1, includeSoulCore: false },
      ],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;
    const afterStackSource = afterStack.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-r01-hand"
    )!;
    const afterStackAlice = afterStack.players.find(
      (player) => player.id === "alice"
    )!;
    expect(afterStack.stackWindow).toBeNull();
    expect(
      afterStack.activeAttack?.flashWindowState.pendingStackAction
    ).toBeNull();
    expect(afterStackSource.zone).toBe("field");
    expect(afterStackSource.normalCoreCount).toBe(0);
    expect(afterStack.pendingMultiPlacement).toMatchObject({
      actingPlayerId: "alice",
      sourceInstanceId: "alice-r01-hand",
      targets: [
        {
          instanceId: "alice-r01-hand",
          minimumCoreCount: 1,
        },
      ],
    });
    expect(afterStackAlice.reserveNormalCoreCount).toBe(4);
    expect(afterStackAlice.deckCount).toBe(5);
    expect(afterStackAlice.handCount).toBe(0);

    const placementAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(placementAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterStack,
      action: placementAction!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "alice-r01-hand",
          placements: [{ kind: "reserve_normal", amount: 2 }],
        },
      ],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;

    const summoned = resolved.cardInstances.find(
      (card) => card.instanceId === "alice-r01-hand"
    )!;
    const alice = resolved.players.find((player) => player.id === "alice")!;
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(3);
    expect(getEffectiveBp(resolved, summoned, c, lookup)).toBe(7000);
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.deckCount).toBe(4);
    expect(alice.handCount).toBe(1);
    expect(
      resolved.log.some((line) =>
        line.startsWith(
          "effect:summon:alice-r01-hand:self:self:from=hand:cost=1:cores=0:interactive=true"
        )
      )
    ).toBe(true);
    expect(
      resolved.flashEffectActivationLog.some(
        (entry) =>
          entry.sourceInstanceId === "alice-r01-hand" &&
          entry.sourceDefinitionId === "BSGE01-R01" &&
          entry.effectIndex === 2
      )
    ).toBe(true);
  });

  it("[legal action] フラッシュ手札自己召喚の1コストはネクサス上のソウルコアから支払える", () => {
    const nexusDef = card("BSGE01-C13");
    const nexus = createCardInstance(nexusDef, {
      instanceId: "alice-nexus",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const { handLookup, lookup, state } = buildAliceR01HandFlashState({
      reserveNormalCoreCount: 0,
      soulCoreLocation: { kind: "card", instanceId: "alice-nexus" },
      extraCardInstances: [nexus],
    });
    const action = findAliceR01HandAction(state, lookup, handLookup);
    const summonPaymentSources = [
      {
        kind: "card" as const,
        instanceId: "alice-nexus",
        amount: 1,
        includeSoulCore: true,
      },
    ];

    const declared = applyLegalAction({
      state,
      action,
      summonPaymentSources,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;

    expect(
      declared.activeAttack?.flashWindowState.pendingStackAction
        ?.summonPaymentSources
    ).toEqual(summonPaymentSources);

    const afterStack = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    const afterStackAlice = afterStack.players.find(
      (player) => player.id === "alice"
    )!;
    const afterStackNexus = afterStack.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-nexus"
    )!;

    expect(afterStack.pendingMultiPlacement).toMatchObject({
      sourceInstanceId: "alice-r01-hand",
      targets: [{ instanceId: "alice-r01-hand", minimumCoreCount: 1 }],
    });
    expect(afterStackAlice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(afterStackAlice.trashSoulCoreCount).toBe(1);
    expect(afterStackNexus.soulCoreCount).toBe(0);
  });

  it("[legal action] フラッシュ手札自己召喚の1コストは窓後pendingでネクサス上のソウルコアから支払える", () => {
    const nexusDef = card("BSGE01-C13");
    const nexus = createCardInstance(nexusDef, {
      instanceId: "alice-nexus",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const { handLookup, lookup, state } = buildAliceR01HandFlashState({
      reserveNormalCoreCount: 0,
      soulCoreLocation: { kind: "card", instanceId: "alice-nexus" },
      extraCardInstances: [nexus],
    });
    const action = findAliceR01HandAction(state, lookup, handLookup);

    const declared = applyLegalAction({
      state,
      action,
      deferPayCostSourceSelection: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;
    expect(
      declared.activeAttack?.flashWindowState.pendingStackAction
        ?.summonPaymentSources
    ).toBeUndefined();
    expect(
      declared.activeAttack?.flashWindowState.pendingStackAction
        ?.deferPayCostSourceSelection
    ).toBe(true);

    const costPendingState = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    expect(costPendingState.pendingEffectSummonCostPayment).toMatchObject({
      actingPlayerId: "alice",
      sourceInstanceId: "alice-r01-hand",
      summonTargetInstanceId: "alice-r01-hand",
      requiredCost: 1,
      availableReserveCoreAmount: 0,
    });
    expect(
      costPendingState.pendingEffectSummonCostPayment
        ?.availableOnBoardCoreSources
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "alice-nexus",
          availableCoreAmount: 1,
          soulCoreAvailable: true,
        }),
      ])
    );
    expect(
      costPendingState.pendingEffectSummonCostPayment
        ?.availableSoulCoreOnlySources
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "alice-nexus",
          availableSoulCoreAmount: 1,
        }),
      ])
    );
    expect(
      costPendingState.players.find((player) => player.id === "alice")!
        .soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "alice-nexus" });

    const costAction = getLegalActions({
      state: costPendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_effect_summon_cost_payment"
    );
    expect(costAction).toBeDefined();

    const afterCost = applyLegalAction({
      state: costPendingState,
      action: costAction!,
      summonPaymentSources: [
        {
          kind: "card",
          instanceId: "alice-nexus",
          amount: 1,
          includeSoulCore: true,
        },
      ],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;

    const afterCostAlice = afterCost.players.find(
      (player) => player.id === "alice"
    )!;
    expect(afterCost.pendingEffectSummonCostPayment).toBeNull();
    expect(afterCost.pendingMultiPlacement).toMatchObject({
      sourceInstanceId: "alice-r01-hand",
      targets: [{ instanceId: "alice-r01-hand", minimumCoreCount: 1 }],
    });
    expect(afterCostAlice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(afterCostAlice.trashSoulCoreCount).toBe(1);
  });

  it("[legal action] フラッシュ手札自己召喚の窓後維持コア配置はネクサス上のソウルコアから行える", () => {
    const nexusDef = card("BSGE01-C13");
    const nexus = createCardInstance(nexusDef, {
      instanceId: "alice-nexus",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const { c, handLookup, lookup, state } = buildAliceR01HandFlashState({
      reserveNormalCoreCount: 1,
      soulCoreLocation: { kind: "card", instanceId: "alice-nexus" },
      extraCardInstances: [nexus],
    });
    const action = findAliceR01HandAction(state, lookup, handLookup);
    const declared = applyLegalAction({
      state,
      action,
      summonPaymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;
    const afterStack = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });

    expect(afterStack.pendingMultiPlacement).toMatchObject({
      sourceInstanceId: "alice-r01-hand",
      targets: [{ instanceId: "alice-r01-hand", minimumCoreCount: 1 }],
    });
    expect(
      afterStack.players.find((player) => player.id === "alice")!
        .soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "alice-nexus" });

    const placementAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(placementAction).toBeDefined();

    const resolved = applyLegalAction({
      state: afterStack,
      action: placementAction!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "alice-r01-hand",
          placements: [{ kind: "card_soul", instanceId: "alice-nexus" }],
        },
      ],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;

    const summoned = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-r01-hand"
    )!;
    const alice = resolved.players.find((player) => player.id === "alice")!;
    expect(resolved.pendingMultiPlacement).toBeNull();
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(1);
    expect(summoned.soulCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "alice-r01-hand",
    });
    expect(alice.deckCount).toBe(4);
    expect(alice.handCount).toBe(1);
    expect(getEffectiveBp(resolved, summoned, c, lookup)).toBe(5000);
  });

  it("[legal action] 非アクティブ側のフラッシュ手札自己召喚解決後はアクティブ側へ優先権が渡る", () => {
    const c = card("BSGE01-R01");
    const attackerDef = card("BSGE01-R02");
    const source = createCardInstance(c, {
      instanceId: "bob-r01-hand",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const handLookup = buildHandActivatedEffectLookup([c, attackerDef]);
    const lookup = (id: string) =>
      id === c.cardNo ? c : id === attackerDef.cardNo ? attackerDef : undefined;
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, attacker],
        playerOverrides: [
          { deckCount: 5, reserveNormalCoreCount: 5 },
          { deckCount: 5, reserveNormalCoreCount: 5, handCount: 1 },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-attacker",
            memberInstanceIds: ["alice-attacker"],
            resolvedBp: 3000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:r01-non-active",
          primaryEntityId: "battle-entity:alice-attacker",
          participantEntityIds: ["battle-entity:alice-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-attacker"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: "bob",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: "bob",
            pendingStackAction: null,
          },
        },
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      turnNumber: 2,
    };

    const action = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "bob-r01-hand"
    );

    expect(action).toBeDefined();
    if (!action || action.kind !== "use_hand_card_effect") {
      throw new Error("BSGE01-R01 bob hand activated action not found");
    }

    const declared = applyLegalAction({
      state,
      action,
      summonPaymentSources: [{ kind: "reserve", amount: 1 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;
    const resolved = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });

    expect(resolved.activeAttack?.flashWindowState).toMatchObject({
      priorityPlayerId: "alice",
      stackResponseSourcePlayerId: "alice",
      consecutivePassCount: 0,
      pendingStackAction: null,
    });
  });

  it("[legal action] 〔ターンに1回:同名〕のフラッシュ手札自己召喚は同名2枚目を同ターンに列挙しない", () => {
    const c = card("BSGE01-R01");
    const attackerDef = card("BSGE01-R02");
    const first = createCardInstance(c, {
      instanceId: "alice-r01-first",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const second = createCardInstance(c, {
      instanceId: "alice-r01-second",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const handLookup = buildHandActivatedEffectLookup([c, attackerDef]);
    const lookup = (id: string) =>
      id === c.cardNo ? c : id === attackerDef.cardNo ? attackerDef : undefined;
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [first, second, attacker],
        playerOverrides: [
          { deckCount: 5, reserveNormalCoreCount: 6, handCount: 2 },
          { deckCount: 5, reserveNormalCoreCount: 5 },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-attacker",
            memberInstanceIds: ["alice-attacker"],
            resolvedBp: 3000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:r01-usage",
          primaryEntityId: "battle-entity:alice-attacker",
          participantEntityIds: ["battle-entity:alice-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-attacker"],
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
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      turnNumber: 2,
    };

    const beforeActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    const firstAction = beforeActions.find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "alice-r01-first"
    );
    expect(firstAction).toBeDefined();
    expect(
      beforeActions.some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "alice-r01-second"
      )
    ).toBe(true);
    if (!firstAction || firstAction.kind !== "use_hand_card_effect") {
      throw new Error("first BSGE01-R01 hand activated action not found");
    }

    const declared = applyLegalAction({
      state,
      action: firstAction,
      summonPaymentSources: [{ kind: "reserve", amount: 1 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;
    const resolved = passStackUntilClosed(declared, lookup, {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });

    expect(
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "alice-r01-second"
      )?.zone
    ).toBe("hand");
    expect(
      resolved.activeAttack?.flashWindowState.pendingStackAction
    ).toBeNull();
    expect(resolved.activeAttack?.flashWindowState.kind).toBe("before_block");

    const afterActions = getLegalActions({
      state: resolved,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    expect(
      afterActions.some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "alice-r01-second"
      )
    ).toBe(false);
  });

  it("[legal action] フラッシュ手札自己召喚は restrict_flash 下と1コスト+維持コア不足で列挙されない", () => {
    const c = card("BSGE01-R01");
    const attackerDef = card("BSGE01-R02");
    const source = createCardInstance(c, {
      instanceId: "alice-r01-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const handLookup = buildHandActivatedEffectLookup([c, attackerDef]);
    const lookup = (id: string) =>
      id === c.cardNo ? c : id === attackerDef.cardNo ? attackerDef : undefined;
    const baseState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, attacker],
        playerOverrides: [
          { deckCount: 5, reserveNormalCoreCount: 5, handCount: 1 },
          { deckCount: 5, reserveNormalCoreCount: 5 },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-attacker",
            memberInstanceIds: ["alice-attacker"],
            resolvedBp: 3000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:r01",
          primaryEntityId: "battle-entity:alice-attacker",
          participantEntityIds: ["battle-entity:alice-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-attacker"],
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
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      turnNumber: 2,
    };
    const restrictFlash: ContinuousEffect = {
      effectId: "ce:r01-restrict-flash",
      sourceInstanceId: "bob-source",
      sourceDefinitionId: "TEST-RESTRICT-FLASH",
      actingPlayerId: "bob",
      modifierTag: "restrict_flash_hand",
      targetInstanceId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: baseState.turnNumber,
      createdAtAttackId: null,
    };
    const restrictedState = {
      ...baseState,
      activeContinuousEffects: [restrictFlash],
    };
    expect(
      getLegalActions({
        state: restrictedState,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredHandActivatedEffectActions: handLookup,
      }).some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "alice-r01-hand"
      )
    ).toBe(false);

    const lowCoreState = {
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 1 }
          : player
      ),
      cardInstances: baseState.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "alice-attacker"
          ? { ...cardInstance, normalCoreCount: 0 }
          : cardInstance
      ),
    };
    expect(
      getLegalActions({
        state: lowCoreState,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredHandActivatedEffectActions: handLookup,
      }).some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "alice-r01-hand"
      )
    ).toBe(false);
  });

  it("[legal action] fixedPayment のフラッシュ手札自己召喚は cost floor で支払い額を引き上げない", () => {
    const original = card("BSGE01-R01");
    const c: CardDefinition = {
      ...original,
      effects: [
        ...(original.effects ?? []),
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "cost_modify",
                target: { kind: "self" },
                modifier: { floor: 2 },
              },
            },
          ],
          textRef: [5],
        },
      ],
    };
    const attackerDef = card("BSGE01-R02");
    const source = createCardInstance(c, {
      instanceId: "alice-r01-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const handLookup = buildHandActivatedEffectLookup([c, attackerDef]);
    const lookup = (id: string) =>
      id === c.cardNo ? c : id === attackerDef.cardNo ? attackerDef : undefined;
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, attacker],
        playerOverrides: [
          { deckCount: 5, reserveNormalCoreCount: 1, handCount: 1 },
          { deckCount: 5, reserveNormalCoreCount: 5 },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-attacker",
            memberInstanceIds: ["alice-attacker"],
            resolvedBp: 3000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:r01-floor",
          primaryEntityId: "battle-entity:alice-attacker",
          participantEntityIds: ["battle-entity:alice-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-attacker"],
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
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      window: "flash_before_block" as const,
      turnNumber: 2,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    const action = actions.find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "alice-r01-hand"
    );
    expect(action).toBeDefined();

    const lowCoreState = {
      ...state,
      players: state.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 0 }
          : player
      ),
    };
    expect(
      getLegalActions({
        state: lowCoreState,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredHandActivatedEffectActions: handLookup,
      }).some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "alice-r01-hand"
      )
    ).toBe(false);
  });

  it("【火炎：Hレーザー】通常フィールド上のこのカード自身には BP+7000 しない", () => {
    const c = card("BSGE01-R01");
    const source = createCardInstance(c, {
      instanceId: "alice-r01-field",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
    });
    const lookup = (id: string) => (id === c.cardNo ? c : undefined);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });

    const baselineBp = getEffectiveBp(state, source, c, lookup);
    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const sourceAfter = rebuilt.cardInstances.find(
      (card) => card.instanceId === "alice-r01-field"
    )!;

    expect(baselineBp).toBe(5000);
    expect(getEffectiveBp(rebuilt, sourceAfter, c, lookup)).toBe(baselineBp);
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.sourceInstanceId === "alice-r01-field" &&
          ce.provenance?.effectIndex === 3
      )
    ).toBe(false);
  });

  it("【火炎：Hレーザー】バレットエディット下にあるとき、host だけを BP+7000 (P3-111)", () => {
    const c = card("BSGE01-R01");
    const hostDef = card("BSGE01-CX01");
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const under = createCardInstance(c, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    under.attachedToInstanceId = "host-1";
    const bystander = createCardInstance(hostDef, {
      instanceId: "host-2",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });

    const lookup = (id: string) =>
      id === hostDef.cardNo ? hostDef : id === c.cardNo ? c : undefined;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, bystander, under],
    });

    const baselineBp = getEffectiveBp(state, host, hostDef, lookup);
    const bystanderBaselineBp = getEffectiveBp(
      state,
      bystander,
      hostDef,
      lookup
    );
    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const hostAfter = rebuilt.cardInstances.find(
      (card) => card.instanceId === "host-1"
    )!;
    const bystanderAfter = rebuilt.cardInstances.find(
      (card) => card.instanceId === "host-2"
    )!;
    expect(getEffectiveBp(rebuilt, hostAfter, hostDef, lookup)).toBe(
      baselineBp + 7000
    );
    expect(getEffectiveBp(rebuilt, bystanderAfter, hostDef, lookup)).toBe(
      bystanderBaselineBp
    );
  });
});

describe("BSGE01-TR01/TX01〜TX04 契約合体ブレイヴ(A面)", () => {
  it.each([
    "BSGE01-TR01(A)",
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ])("%s: 双面 + 合体中アタックでカウント増加", (no) => {
    const c = card(no);
    expect(c.isDoubleSided).toBe(true);
    const combo = c.effects!.find((e) =>
      e.condition?.some((cl) => cl.kind === "combined")
    );
    expect(combo!.steps[0]!.action.kind).toBe("count_increase");
  });
});

describe("BSGE01-TR01(A)/TX01〜TX04(A) 契約合体ヘッダー変換（P3-111 S5）", () => {
  it.each([
    ["BSGE01-TR01(A)", undefined],
    ["BSGE01-TX01(A)", ["神薙 ユウ"]],
    ["BSGE01-TX02(A)", ["霊代 アキ"]],
    ["BSGE01-TX03(A)", ["空木 レンカ"]],
    ["BSGE01-TX04(A)", ["加賀美 リョウ"]],
  ] as const)(
    "%s: top-level braveCondition (GE&O/1非含有・合体条件の継続分離チェック用) + contractCombineData 配線",
    (no, cardNameContains) => {
      const c = card(no);
      expect(c.braveCondition).toEqual({
        tribes: ["GE"],
        excludeTribeSubstring: ["O", "1"],
      });
      expect(c.allowMainStepBraveCombine).toBeUndefined();
      if (cardNameContains) {
        expect(c.contractCombineData).toEqual({
          braveCondition: { cardNameContains },
          timingScope: { player: "self", period: "turn" },
        });
      } else {
        expect(c.contractCombineData).toEqual({
          braveCondition: {
            tribes: ["GE"],
            excludeTribeSubstring: ["O", "1"],
          },
          timingScope: { player: "both", period: "attack" },
        });
      }
    }
  );

  it.each([
    "BSGE01-TR01(A)",
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ])(
    "%s: スピリット状態パッシブ (ruleStrength effect_resistance(exhaust)+prevent_battle) 実装済み、stub なし",
    (no) => {
      const c = card(no);
      const spiritStateEffect = c.effects![0]!;
      expect(spiritStateEffect.timing.kind).toBe("continuous");
      expect(spiritStateEffect.applicability?.combined).toBe(false);
      const resistance = spiritStateEffect.steps[0]!.action;
      expect(resistance.kind).toBe("effect_resistance");
      if (resistance.kind === "effect_resistance") {
        expect(resistance.resistsOutcome).toBe("exhaust");
        expect(resistance.ruleStrength).toBe(true);
      }
      const battleBan = spiritStateEffect.steps[1]!.action;
      expect(battleBan.kind).toBe("prevent_battle");
      if (battleBan.kind === "prevent_battle") {
        expect(battleBan.ruleStrength).toBe(true);
      }
      expect(spiritStateEffect.stub).toBeUndefined();
      const eventCombine = c.effects!.find(
        (e) =>
          e.textRef?.includes(3) &&
          e.steps.some((s) => s.action.kind === "brave_combine_effect")
      );
      expect(eventCombine?.timing).toEqual({
        kind: "game_event",
        player: "self",
        event: ["summon", "soul_state_to_spirit_state"],
        triggerFilter: { category: ["spirit"] },
        exactEventKind: true,
      });
    }
  );

  it.each([
    "BSGE01-TR01(A)",
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ])(
    "%s: 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」は activated(flash) + applicability.combined:true + rebirth で表現",
    (no) => {
      const c = card(no);
      const flipEffect = c.effects!.find(
        (e) =>
          e.timing.kind === "activated" && e.applicability?.combined === true
      );
      expect(flipEffect).toBeDefined();
      expect(flipEffect!.timing).toEqual({ kind: "activated", mode: "flash" });
      expect(flipEffect!.steps).toHaveLength(1);
      const action = flipEffect!.steps[0]!.action;
      expect(action.kind).toBe("rebirth");
      if (action.kind === "rebirth") {
        expect(action.countBonusMode).toBe("none");
      }
      expect(flipEffect!.stub).toBeUndefined();
    }
  );

  it("BSGE01-TR01(A): 【合体中】契約合体/アタック時は brave_combined(cause限定) と attack の2 effect に分離", () => {
    const c = card("BSGE01-TR01(A)");
    const comboEffects = c.effects!.filter(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing.event === "brave_combined" || e.timing.event === "attack") &&
        e.condition?.some((cl) => cl.kind === "combined")
    );
    expect(comboEffects).toHaveLength(2);

    const contractCombine = comboEffects.find(
      (e) =>
        e.timing.kind === "card_event" && e.timing.event === "brave_combined"
    )!;
    const attack = comboEffects.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "attack"
    )!;
    expect(contractCombine.timing).toEqual({
      kind: "card_event",
      event: "brave_combined",
      cause: ["contract_combine"],
    });
    expect(attack.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(contractCombine.steps).toEqual(attack.steps);

    for (const combo of comboEffects) {
      expect(combo.steps[0]!.action).toEqual({
        kind: "count_increase",
        player: "self",
        amount: 2,
        protectedFromNonTribe: "神喰",
      });
      const flipStep = combo.steps[1]!;
      expect(flipStep.action.kind).toBe("rebirth");
      if (flipStep.action.kind === "rebirth") {
        expect(flipStep.action.countBonusMode).toBe("none");
      }
      expect(flipStep.executionMode).toBe("optional");
      expect(combo.stub).toBeUndefined();
    }
  });

  it.each([
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ])(
    "%s: 【合体中】アタック時のカウント増加には「ただちに裏返せる」の追加ステップは無い（原文に無い）",
    (no) => {
      const c = card(no);
      const combo = c.effects!.find(
        (e) =>
          e.timing.kind === "card_event" &&
          e.timing.event === "attack" &&
          e.condition?.some((cl) => cl.kind === "combined")
      );
      expect(combo).toBeDefined();
      expect(combo!.steps).toHaveLength(1);
      expect(combo!.steps[0]!.action.kind).toBe("count_increase");
    }
  );
});

describe("BSGE01-TR01(A) フラッシュタイミングの合体中裏返し (P3-111 S5、盤面検証)", () => {
  const braveDef = card("BSGE01-TR01(A)");
  // host は braveCondition (GE&O/1非含有) を満たす必要がある (CX01: tribe 神喰・GE・2G)。
  // C01 (tribe:神喰、GEを含まない) だと合体条件を満たさず、A→B裏返り直後に SBA の
  // brave_forced_separation→brave_backface_auto_revert (P3-111 残り) が連鎖して即座に
  // A 面へ戻ってしまい本テストの意図(裏返り後の状態確認)と食い違う。
  const hostDef = card("BSGE01-CX01");
  const suppressorDef = card("BSSA01-転醒X02(A)");
  const expanded = expandCardDefinitionsWithBackFaces([
    braveDef,
    hostDef,
    suppressorDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const fieldLookup = buildFieldCardEffectLookup(expanded);

  function makeCombinedState(
    options: { withBattleEntity?: boolean } = {}
  ): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "flip-host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["flip-brave-1"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "flip-brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "flip-host-1",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      step: "main",
      window: "none",
      activePlayerId: "alice",
    };
    if (!options.withBattleEntity) return state;
    return {
      ...state,
      battleEntities: [
        {
          entityId: "battle-entity:flip-host-1",
          memberInstanceIds: ["flip-host-1", "flip-brave-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
  }

  it("合体中は自身をフラッシュタイミングで裏返す legal action が列挙される", () => {
    const actions = getLegalActions({
      state: makeCombinedState(),
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    });
    const flipAction = actions.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "flip-host-1" &&
        a.sourceEffectInstanceId === "flip-brave-1" &&
        a.timing === "flash"
    );
    expect(flipAction).toBeDefined();
  });

  it("適用(宣言→相手パス)すると B 面へ裏返り、B面定型文が無いため count は増えない", () => {
    const state = makeCombinedState({ withBattleEntity: true });
    const flipAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "flip-host-1" &&
        a.sourceEffectInstanceId === "flip-brave-1"
    )!;

    const declared = applyLegalAction({
      state,
      action: flipAction,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    // フラッシュ効果の宣言はスタック窓を開くのみ。相手 (bob) がパスして初めて解決する
    // (project_stack_timing_close_rule と同型、MTG priority 往復ではなく即時クローズ)。
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find((a) => a.kind === "pass_stack")!;
    expect(pass).toBeDefined();

    const after = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const flipped = after.cardInstances.find(
      (c) => c.instanceId === "flip-brave-1"
    )!;
    expect(flipped.definitionId).toBe("BSGE01-TR01(B)");
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(0);
  });

  it("アタック時 count+2 後の任意裏返しを実行しても、rebirth 側の count は追加されない", () => {
    const state = makeCombinedState({ withBattleEntity: true });
    const battleLookup = buildBattleImmediateEffectLookup(expanded);
    const host = state.cardInstances.find(
      (c) => c.instanceId === "flip-host-1"
    )!;
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-tr01-count-mode",
      participantEntityId: "battle-entity:flip-host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });

    const declare = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceCardNo === "BSGE01-TR01(A)" &&
        a.sourceInstanceId === "flip-host-1" &&
        a.sourceEffectInstanceId === "flip-brave-1" &&
        !a.skipOnly
    );
    expect(declare).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: declare!,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find((a) => a.kind === "pass_stack")!;
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).state;
    expect(afterPass.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "flip-host-1",
      stepIndex: 1,
      continuation: {
        effectSourceInstanceId: "flip-brave-1",
        effectSourceDefinitionId: "BSGE01-TR01(A)",
      },
    });

    const executeFlip = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    expect(executeFlip).toBeDefined();

    const after = applyLegalAction({
      state: afterPass,
      action: executeFlip,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).state;

    const flipped = after.cardInstances.find(
      (c) => c.instanceId === "flip-brave-1"
    )!;
    expect(flipped.definitionId).toBe("BSGE01-TR01(B)");
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(2);
    const entity = after.battleEntities.find(
      (e) => e.entityId === "battle-entity:flip-host-1"
    )!;
    expect(entity.resolvedBp).toBe(10000);
    expect(entity.resolvedSymbols).toEqual(["red", "red"]);
  });

  it("host が turn effect_suppression 中なら合体中 TR01(A) のアタック時は pending に積まない", () => {
    const base = makeCombinedState({ withBattleEntity: true });
    const battleLookup = buildBattleImmediateEffectLookup(expanded);
    const host = base.cardInstances.find(
      (c) => c.instanceId === "flip-host-1"
    )!;
    const unsuppressed = queueRegisteredBattleImmediateEffects({
      state: base,
      chainId: "attack-tr01-suppressed",
      attackId: "attack-tr01-suppressed",
      participantEntityId: "battle-entity:flip-host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });
    expect(unsuppressed.battleImmediateEffects).toHaveLength(1);
    expect(unsuppressed.battleImmediateEffects[0]).toMatchObject({
      sourceInstanceId: host.instanceId,
      sourceEffectInstanceId: "flip-brave-1",
      sourceEffectDefinitionId: "BSGE01-TR01(A)",
      timing: "attack",
    });

    const suppressor = createCardInstance(suppressorDef, {
      instanceId: "bssa-suppressor-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const suppression: ContinuousEffect = {
      effectId: "test-bssa01-turn-suppress-host",
      sourceInstanceId: suppressor.instanceId,
      sourceDefinitionId: suppressorDef.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_suppression",
      forceLevel: "prohibition",
      targetInstanceId: host.instanceId,
    };
    const state: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, suppressor],
      activeContinuousEffects: [...base.activeContinuousEffects, suppression],
      log: [...base.log],
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      chainId: "attack-tr01-suppressed",
      attackId: "attack-tr01-suppressed",
      participantEntityId: "battle-entity:flip-host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });

    expect(queued.battleImmediateEffects).toHaveLength(0);
  });

  it("契約合体時 count+2 後の任意裏返しも提示され、コア0で実行すると lv-deficit 中断して rebirth 側の count は追加されない", () => {
    const handBrave = createCardInstance(braveDef, {
      instanceId: "contract-brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const host = createCardInstance(hostDef, {
      instanceId: "contract-host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const triggeredLookup = buildTriggeredEffectLookup(expanded);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, handBrave],
        playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
      }),
      step: "attack",
      activePlayerId: "bob",
    };

    const declaredCombine = applyLegalAction({
      state,
      action: {
        kind: "contract_combine",
        actionId: "test:tr01-contract-combine",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        braveInstanceId: handBrave.instanceId,
        braveCardNo: braveDef.cardNo,
        candidateTargetInstanceIds: [host.instanceId],
        targetMode: "manual",
        requiredTargetCount: 1,
        targetInstanceId: host.instanceId,
        targetCardNo: hostDef.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;

    const afterCombine = passStackAndResolveTarget(
      declaredCombine,
      [host.instanceId],
      getDef,
      {
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }
    );
    expect(
      afterCombine.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "brave_combined" &&
          p.relatedInstanceId === handBrave.instanceId &&
          p.cause === "contract_combine"
      )
    ).toBe(true);

    const resolveTrigger = getLegalActions({
      state: afterCombine,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === host.instanceId &&
        a.sourceEffectInstanceId === handBrave.instanceId &&
        a.eventKind === "brave_combined"
    );
    expect(resolveTrigger).toBeDefined();

    const declaredEffect = applyLegalAction({
      state: afterCombine,
      action: resolveTrigger!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).state;
    const afterEffect = passStackUntilClosed(declaredEffect, getDef, {
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    });
    expect(afterEffect.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: host.instanceId,
      stepIndex: 1,
      continuation: {
        effectSourceInstanceId: handBrave.instanceId,
        effectSourceDefinitionId: handBrave.definitionId,
      },
    });

    const executeFlip = getLegalActions({
      state: afterEffect,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(executeFlip).toBeDefined();

    const after = applyLegalAction({
      state: afterEffect,
      action: executeFlip!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).state;

    const flipped = after.cardInstances.find(
      (c) => c.instanceId === handBrave.instanceId
    )!;
    // 合体中ブレイヴは単体のコア不足消滅対象外。契約合体直後のコア0でも
    // 合体リンクを維持したまま裏返り、rebirth 側の count 処理は走らない。
    expect(flipped.definitionId).toBe("BSGE01-TR01(B)");
    expect(flipped.zone).toBe("field");
    expect(flipped.attachedToInstanceId).toBe(host.instanceId);
    expect(
      after.log.some((l) =>
        l.includes("effect:rebirth:contract-brave-1:lv-deficit")
      )
    ).toBe(false);
    expect(
      after.log.some((l) =>
        l.includes("pending-leave-flushed:vanish:contract-brave-1")
      )
    ).toBe(false);
    expect(
      after.log.some((l) =>
        l.includes("effect:rebirth:contract-brave-1:flip_to:BSGE01-TR01(B)")
      )
    ).toBe(true);
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(2);
    expect(alice.protectedCounts).toEqual({ 神喰: 2 });
  });

  it("合体していない (attachedToInstanceId が null) ときは裏返し legal action が出ない", () => {
    const state = makeCombinedState();
    const uncombinedState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "flip-brave-1"
          ? { ...c, attachedToInstanceId: null }
          : c.instanceId === "flip-host-1"
            ? { ...c, attachedChildrenIds: [] }
            : c
      ),
    };
    const actions = getLegalActions({
      state: uncombinedState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    });
    expect(
      actions.some(
        (a) =>
          a.kind === "use_field_card_effect" &&
          a.sourceInstanceId === "flip-host-1" &&
          a.sourceEffectInstanceId === "flip-brave-1"
      )
    ).toBe(false);
  });
});

describe("BSGE01-TX01 クレメンサー", () => {
  const c = card("BSGE01-TX01(A)");
  it("召喚/契約合体時 デッキ2ドロー (契約合体側は登録生成で brave_combined へ展開)", () => {
    const summon = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "summon"
    );
    expect(summon!.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon!.steps[0]!.action.kind).toBe("draw");
    const effectIndex = c.effects!.indexOf(summon!);
    const contractCombineRegistration = buildTriggeredEffectLookup([c])(
      "BSGE01-TX01(A)"
    )?.find(
      (registration) =>
        registration.eventKind === "brave_combined" &&
        registration.effectIndex === effectIndex
    );
    expect(contractCombineRegistration).toBeDefined();
    expect(
      contractCombineRegistration?.suppressionEffectDescriptor?.triggerPhrases
    ).toEqual(expect.arrayContaining(["召喚時", "契約合体時"]));
  });
});

describe("BSGE01-TR01(B)/TX01(B)/TX02(B) 裏面【合体中】効果 (P3-111 残り、backFace.effects 初着地)", () => {
  it.each(["BSGE01-TR01(A)", "BSGE01-TX01(A)", "BSGE01-TX02(A)"])(
    "%s(B): braveCondition (GE&O/1非含有) は (A) 面と同一",
    (no) => {
      const c = card(no).backFace!;
      expect(c.braveCondition).toEqual({
        tribes: ["GE"],
        excludeTribeSubstring: ["O", "1"],
      });
    }
  );

  it("BSGE01-TR01(B): フラッシュ表記なし=battle-immediate card_event(rebirth/attack)、ターン1回、cost count-2→本来のBP15000以下2体まで破壊", () => {
    const back = card("BSGE01-TR01(A)").backFace!;
    const combo = back.effects!.find((e) =>
      e.condition?.some((cl) => cl.kind === "combined")
    )!;
    expect(combo.timing).toEqual({
      kind: "card_event",
      event: ["rebirth", "attack"],
      effectSourceEvents: ["rebirth"],
    });
    expect(combo.executionMode).toBe("optional");
    expect(combo.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    expect(combo.steps[0]!.action).toEqual({
      kind: "count_decrease",
      player: "self",
      amount: 2,
    });
    const destroyStep = combo.steps[1]!;
    expect(destroyStep.connector).toBe("conditional_cost");
    const destroyAction = destroyStep.action as {
      kind: string;
      target: {
        filter: { category: string[]; maxBp: number; bpBasis?: string };
        count: { min: number; max: number };
      };
    };
    expect(destroyAction.kind).toBe("destroy");
    expect(destroyAction.target.filter).toEqual({
      category: ["spirit", "ultimate"],
      maxBp: 15000,
      bpBasis: "printed",
    });
    expect(destroyAction.target.count).toEqual({ min: 0, max: 2 });
  });

  it("BSGE01-TX01(B): フラッシュ表記あり=activated(flash)+timingScope(self/attack)、cost count-1→自身BP以下スピ/アルティ1体かネクサス1つ破壊", () => {
    const back = card("BSGE01-TX01(A)").backFace!;
    // e.timingScope で絞る: cluster bsge01-backface-header-line-audit の新規追加
    // (フラッシュ裏返し reverse_rebirth flip 効果、timingScope 無し) と区別するため。
    const combo = back.effects!.find(
      (e) => e.timing.kind === "activated" && e.timingScope !== undefined
    )!;
    expect(combo.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(combo.timingScope).toEqual({ player: "self", period: "attack" });
    expect(combo.applicability?.combined).toBe(true);
    expect(combo.steps[0]!.action).toEqual({
      kind: "count_decrease",
      player: "self",
      amount: 1,
    });
    const destroyAction = combo.steps[1]!.action as {
      kind: string;
      target: { filter: { filterOr: unknown[] }; count: number };
    };
    expect(destroyAction.kind).toBe("destroy");
    expect(destroyAction.target.filter.filterOr).toEqual([
      { category: ["spirit", "ultimate"], maxBpSource: "self_effective_bp" },
      { category: ["nexus"] },
    ]);
    expect(destroyAction.target.count).toBe(1);
  });

  it("BSGE01-TX02(B): フラッシュ表記あり=activated(flash)+timingScope(self/attack)、cost count-1→スピ/アルティ/ネクサス1つ重疲労→その後デッキ下送り optional", () => {
    const back = card("BSGE01-TX02(A)").backFace!;
    // e.timingScope で絞る: cluster bsge01-backface-header-line-audit の新規追加
    // (フラッシュ裏返し reverse_rebirth flip 効果、timingScope 無し) と区別するため。
    const combo = back.effects!.find(
      (e) => e.timing.kind === "activated" && e.timingScope !== undefined
    )!;
    expect(combo.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(combo.timingScope).toEqual({ player: "self", period: "attack" });
    expect(combo.applicability?.combined).toBe(true);
    const exhaustStep = combo.steps[1]!;
    expect(exhaustStep.connector).toBe("conditional_cost");
    const exhaustAction = exhaustStep.action as {
      kind: string;
      target: { filter: { category: string[] }; count: number };
      degree?: string;
    };
    expect(exhaustAction.kind).toBe("exhaust");
    expect(exhaustAction.degree).toBe("heavy_exhaust");
    expect(exhaustAction.target.filter.category).toEqual([
      "spirit",
      "ultimate",
      "nexus",
    ]);
    expect(exhaustAction.target.count).toBe(1);
    const sendStep = combo.steps[2]!;
    expect(sendStep.executionMode).toBe("optional");
    const sendAction = sendStep.action as {
      kind: string;
      target: { filter: { category: string[]; exhaustState: string } };
    };
    expect(sendAction.kind).toBe("send_to_deck");
    expect(sendAction.target.filter.exhaustState).toBe("exhausted");
  });
});

describe("BSGE01 裏面5面 textLines[0] ヘッダー行 (cluster bsge01-backface-header-line-audit)", () => {
  it.each([
    "BSGE01-TR01(A)",
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ])(
    "%s(B): B面先頭ヘッダーは ruleStrength の effect_resistance(exhaust)+prevent_battle と自動裏返しで実装済み",
    (no) => {
      const back = card(no).backFace!;
      expect(back.revertToFrontOnSeparation).toBe(true);
      const spiritStateEffect = back.effects![0]!;
      expect(spiritStateEffect.timing.kind).toBe("continuous");
      expect(spiritStateEffect.applicability?.combined).toBe(false);
      expect(spiritStateEffect.textRef).toEqual([0]);
      const resistance = spiritStateEffect.steps[0]!.action;
      expect(resistance.kind).toBe("effect_resistance");
      if (resistance.kind === "effect_resistance") {
        expect(resistance.resistsOutcome).toBe("exhaust");
        expect(resistance.ruleStrength).toBe(true);
      }
      const battleBan = spiritStateEffect.steps[1]!.action;
      expect(battleBan.kind).toBe("prevent_battle");
      if (battleBan.kind === "prevent_battle") {
        expect(battleBan.ruleStrength).toBe(true);
      }
      expect(spiritStateEffect.stub).toBeUndefined();
    }
  );

  it.each([
    "BSGE01-TR01(A)",
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ])(
    "%s(B): 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」は activated(flash) + applicability.combined:true + reverse_rebirth(mode:flip) で表現 (textRef:[0])",
    (no) => {
      const back = card(no).backFace!;
      const flipEffect = back.effects!.find(
        (e) => e.timing.kind === "activated" && e.timingScope === undefined
      );
      expect(flipEffect).toBeDefined();
      expect(flipEffect!.timing).toEqual({ kind: "activated", mode: "flash" });
      expect(flipEffect!.applicability?.combined).toBe(true);
      expect(flipEffect!.textRef).toEqual([0]);
      expect(flipEffect!.steps).toHaveLength(1);
      expect(flipEffect!.steps[0]!.action).toEqual({
        kind: "reverse_rebirth",
        mode: "flip",
      });
      expect(flipEffect!.stub).toBeUndefined();
    }
  );
});

describe("BSGE01-TR01(B) スピリット状態パッシブ盤面検証 (疲労耐性+アタック/ブロック不可、cluster bsge01-backface-header-line-audit)", () => {
  const braveDef = card("BSGE01-TR01(A)");
  const expanded = expandCardDefinitionsWithBackFaces([braveDef]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);

  function makeUncombinedBackFaceState(): GameState {
    const brave = createCardInstance(braveDef, {
      instanceId: "spirit-back-brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: null,
    });
    return rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          // 既に B 面へ裏返り済みの、合体していない (スピリット状態の) ブレイヴ。
          cardInstances: [{ ...brave, definitionId: "BSGE01-TR01(B)" }],
        }),
        step: "attack",
        window: "none",
        activePlayerId: "bob",
      },
      getDef
    );
  }

  it("疲労させようとしても cannot_be_exhausted 耐性で回復状態のまま (effect_resistance(exhaust) の実効果)", () => {
    const state = makeUncombinedBackFaceState();
    const blocked = executeExhaust(
      state,
      "bob",
      { selfCard: false, player: "opponent", count: -1 },
      getDef
    );
    expect(
      blocked.cardInstances.find((c) => c.instanceId === "spirit-back-brave-1")
        ?.exhaustState
    ).toBe("recovered");
    expect(blocked.log).toContain(
      "effect:exhaust:blocked-by-resistance:bob:spirit-back-brave-1"
    );
  });

  it("アタック宣言できない (prevent_battle の実効果、getAttackDeclarationBlockReason)", () => {
    const state = {
      ...makeUncombinedBackFaceState(),
      activePlayerId: "alice",
    };
    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "spirit-back-brave-1",
        getCardDefinitionById: getDef,
      })
    ).toBe("source_not_ready");
  });
});

describe("BSGE01-TR01(B) フラッシュタイミングの合体中裏返し (B→A、cluster bsge01-backface-header-line-audit、盤面検証)", () => {
  const braveDef = card("BSGE01-TR01(A)");
  // host は braveCondition (GE&O/1非含有) を満たす必要がある (CX01: tribe 神喰・GE・2G)。
  // C01 (tribe:神喰、GEを含まない) だと合体条件を満たさず、finalizeEffectResolution 経由の
  // SBA brave_forced_separation が host との合体リンクを強制解除してしまい、本テストが
  // 検証したい「合体中の裏返し」の前提が盤面上で維持されない (BSGE01-TR01(A) 版 precedent、
  // 本ファイル:10990 と同型)。
  const hostDef = card("BSGE01-CX01");
  const expanded = expandCardDefinitionsWithBackFaces([braveDef, hostDef]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const fieldLookup = buildFieldCardEffectLookup(expanded);

  function makeCombinedBackFaceState(): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "flip-back-host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["flip-back-brave-1"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "flip-back-brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "flip-back-host-1",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          host,
          // 既に B 面へ裏返り済みの状態 (definitionId のみ変化、originalDefinitionId は
          // A 面のまま。executeRebirth/executeReverseRebirth と同じ表現)。
          { ...brave, definitionId: "BSGE01-TR01(B)" },
        ],
      }),
      step: "main",
      window: "none",
      activePlayerId: "alice",
    };
  }

  it("合体中は B 面をフラッシュタイミングで A 面へ裏返す legal action が列挙される", () => {
    const actions = getLegalActions({
      state: makeCombinedBackFaceState(),
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    });
    const flipAction = actions.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "flip-back-host-1" &&
        a.sourceEffectInstanceId === "flip-back-brave-1" &&
        a.timing === "flash"
    );
    expect(flipAction).toBeDefined();
  });

  it("適用(宣言→相手パス)すると A 面へ裏返り、コア・instanceId・count は不変 (reverse_rebirth mode:flip)", () => {
    const state = makeCombinedBackFaceState();
    const flipAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "flip-back-host-1" &&
        a.sourceEffectInstanceId === "flip-back-brave-1"
    )!;

    const declared = applyLegalAction({
      state,
      action: flipAction,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find((a) => a.kind === "pass_stack")!;
    expect(pass).toBeDefined();

    const after = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const flipped = after.cardInstances.find(
      (c) => c.instanceId === "flip-back-brave-1"
    )!;
    expect(flipped.definitionId).toBe("BSGE01-TR01(A)");
    expect(flipped.normalCoreCount).toBe(1);
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(0);
  });
});

describe("BSGE01 裏面5面 自動裏返り「ただちに裏返す」(SBA、P3-111 残り、cluster bsge01-backface-auto-revert-on-separation)", () => {
  const braveDef = card("BSGE01-TR01(A)");
  const expanded = expandCardDefinitionsWithBackFaces([braveDef]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);

  function makeUnattachedBackFaceState(): GameState {
    const brave = createCardInstance(braveDef, {
      instanceId: "auto-revert-brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
      attachedToInstanceId: null,
    });
    return createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [{ ...brave, definitionId: "BSGE01-TR01(B)" }],
    });
  }

  it("B面ブレイヴが合体していない(スピリット状態単独)状態でSBAを走らせると自動的にA面へ裏返る。コア/instanceIdは不変", () => {
    const state = makeUnattachedBackFaceState();
    const result = runStateBasedActions(state, getDef);

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_backface_auto_revert" &&
          check.instanceId === "auto-revert-brave-1"
      )
    ).toBe(true);
    const flipped = result.state.cardInstances.find(
      (c) => c.instanceId === "auto-revert-brave-1"
    )!;
    expect(flipped.definitionId).toBe("BSGE01-TR01(A)");
    expect(flipped.normalCoreCount).toBe(1);
    expect(flipped.attachedToInstanceId).toBeNull();
    expect(flipped.instanceId).toBe("auto-revert-brave-1");
  });

  it("合体中(attachedToInstanceIdあり)のB面ブレイヴはSBAで裏返らない(フラッシュ専用の任意アクションと重複しない)", () => {
    const hostDef: CardDefinition = {
      cardNo: "TEST-AUTO-REVERT-HOST",
      name: "TEST-AUTO-REVERT-HOST",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "GE",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const combinedExpanded = expandCardDefinitionsWithBackFaces([
      braveDef,
      hostDef,
    ]);
    const combinedGetDef = (id: string) =>
      combinedExpanded.find((d) => d.cardNo === id);
    const host = createCardInstance(hostDef, {
      instanceId: "auto-revert-host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedChildrenIds: ["auto-revert-brave-2"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "auto-revert-brave-2",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: "auto-revert-host-1",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, { ...brave, definitionId: "BSGE01-TR01(B)" }],
    });

    const result = runStateBasedActions(state, combinedGetDef);

    expect(
      result.checks.some((check) => check.kind === "brave_backface_auto_revert")
    ).toBe(false);
    const stillCombined = result.state.cardInstances.find(
      (c) => c.instanceId === "auto-revert-brave-2"
    )!;
    expect(stillCombined.definitionId).toBe("BSGE01-TR01(B)");
    expect(stillCombined.attachedToInstanceId).toBe("auto-revert-host-1");
  });

  it("host が合体条件(GE&O/1非含有)を満たさないと、分離コア選択後にA面へ自動裏返りが連鎖する", () => {
    const hostDef: CardDefinition = {
      cardNo: "TEST-AUTO-REVERT-CONDLOST-HOST",
      name: "TEST-AUTO-REVERT-CONDLOST-HOST",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      // "GE" 完全一致は満たすが "O" を含むため excludeTribeSubstring:["O","1"] に抵触。
      tribe: "GE・GEO",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const combinedExpanded = expandCardDefinitionsWithBackFaces([
      braveDef,
      hostDef,
    ]);
    const combinedGetDef = (id: string) =>
      combinedExpanded.find((d) => d.cardNo === id);
    const host = createCardInstance(hostDef, {
      instanceId: "auto-revert-condlost-host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedChildrenIds: ["auto-revert-condlost-brave-1"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "auto-revert-condlost-brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: "auto-revert-condlost-host-1",
      // 追加コアを置かずに分離後のLv1を維持する。
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, { ...brave, definitionId: "BSGE01-TR01(B)" }],
    });

    const result = runStateBasedActions(state, combinedGetDef);
    result.state = chooseRuleBraveCores(
      result.state,
      combinedGetDef,
      "auto-revert-condlost-brave-1"
    );

    expect(
      result.checks.some((check) => check.kind === "brave_forced_separation")
    ).toBe(true);
    expect(result.state.pendingCoreDistribution).toBeNull();
    const flipped = result.state.cardInstances.find(
      (c) => c.instanceId === "auto-revert-condlost-brave-1"
    )!;
    expect(flipped.definitionId).toBe("BSGE01-TR01(A)");
    expect(flipped.attachedToInstanceId).toBeNull();
    expect(flipped.normalCoreCount).toBe(1);
    const host2 = result.state.cardInstances.find(
      (c) => c.instanceId === "auto-revert-condlost-host-1"
    )!;
    expect(host2.attachedChildrenIds).toEqual([]);
  });
});

describe("BSGE01-TR01(B) 盤面検証: 合体中battle-immediateで本来のBP15000以下2体まで破壊 (P3-111 残り)", () => {
  const frontDef = card("BSGE01-TR01(A)");
  // host は braveCondition (GE&O/1非含有) を満たす必要がある。CX01 (tribe:神喰・GE・2G)
  // は満たすが C01 (tribe:神喰、GEを含まない) は満たさず battle-immediate 解決経路の
  // recompute で強制分離される (adversarial verifier round1 で発見)。
  const hostDef = card("BSGE01-CX01");
  const lowBpTargetDef = card("BSGE01-R02"); // 印字 Lv1 BP 3000
  const expanded = expandCardDefinitionsWithBackFaces([
    frontDef,
    hostDef,
    lowBpTargetDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const backDef = getDef("BSGE01-TR01(B)")!;
  const battleLookup = buildBattleImmediateEffectLookup(expanded);
  const attackReg = battleLookup(backDef.cardNo)!.find(
    (reg) => reg.timing === "attack"
  )!;

  function makeState(countValue: number): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["brave-1"],
    });
    const brave = createCardInstance(backDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-1",
    });
    const targets = ["target-a", "target-b"].map((instanceId) =>
      createCardInstance(lowBpTargetDef, {
        instanceId,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, ...targets],
        playerOverrides: [{ countValue }, {}],
        battleImmediateEffects: [
          {
            promptId: "bi-bsge01-tr01b",
            attackId: "attack-bsge01-tr01b",
            timing: "attack",
            sourceKind: attackReg.sourceKind,
            sourceInstanceId: host.instanceId,
            sourceDefinitionId: hostDef.cardNo,
            sourceEffectInstanceId: brave.instanceId,
            sourceEffectDefinitionId: backDef.cardNo,
            sourceCardNo: backDef.cardNo,
            actingPlayerId: "alice",
            participantEntityId: "battle-entity:host-1",
            registrationIndex: 0,
          },
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      turnNumber: 2,
    };
  }

  const lookupOpts = {
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: battleLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
  };

  it("合体中はカウント2以上のとき resolve_battle_immediate_effect が列挙される", () => {
    const actions = getLegalActions({
      state: makeState(2),
      actingPlayerId: "alice",
      ...lookupOpts,
    });
    expect(
      actions.some(
        (a) =>
          a.kind === "resolve_battle_immediate_effect" &&
          a.sourceInstanceId === "host-1" &&
          a.sourceEffectInstanceId === "brave-1" &&
          !a.skipOnly
      )
    ).toBe(true);
  });

  it("宣言→対象2体選択→相手パスで両方破壊され、カウントが2減る", () => {
    const state = makeState(2);
    const declaration = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.sourceEffectInstanceId === "brave-1" &&
        !a.skipOnly
    )!;
    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declaration,
      targetInstanceIds: ["target-a", "target-b"],
      ...lookupOpts,
    }).state;
    const resolved = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close",
        actingPlayerId: "bob",
      },
      ...lookupOpts,
    }).state;

    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(0);
    for (const id of ["target-a", "target-b"]) {
      expect(
        resolved.cardInstances.find((c) => c.instanceId === id)?.zone
      ).toBe("trash");
    }
  });
});

describe("BSGE01-TX02(B) 盤面検証: 合体中フラッシュで重疲労→デッキ下送り (P3-111 残り)", () => {
  const frontDef = card("BSGE01-TX02(A)");
  // host は braveCondition (GE&O/1非含有) を満たす必要がある (TR01(B) 盤面検証の注記参照)。
  const hostDef = card("BSGE01-CX01");
  const targetDef = card("BSGE01-R02");
  const expanded = expandCardDefinitionsWithBackFaces([
    frontDef,
    hostDef,
    targetDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const backDef = getDef("BSGE01-TX02(B)")!;
  const fieldLookup = buildFieldCardEffectLookup(expanded);

  function makeState(): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["brave-1"],
    });
    const brave = createCardInstance(backDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-1",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, target],
        playerOverrides: [{ countValue: 1 }, {}],
      }),
      step: "attack",
      window: "flash_before_block",
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId: "host-1",
          memberInstanceIds: ["host-1", "brave-1"],
          attackState: "attacking",
          resolvedBp: 10000,
          resolvedSymbols: ["red"],
        },
      ],
      activeAttack: {
        attackId: "test-attack",
        primaryEntityId: "host-1",
        participantEntityIds: ["host-1"],
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

  function findUseAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.sourceEffectInstanceId === "brave-1" &&
        // cluster bsge01-backface-header-line-audit で追加された
        // reverse_rebirth(mode:flip) 裏返しアクション (対象無し) と区別する。
        a.registrationIndex ===
          fieldLookup(backDef.cardNo)?.findIndex((r) => r.effectIndex === 2)
    );
  }

  it("合体先がアタック中ならフラッシュで発揮する legal action が列挙される", () => {
    expect(findUseAction(makeState())).toBeDefined();
  });

  it("宣言→相手パス→対象選択で相手が重疲労し、任意のデッキ下送りを選ぶとデッキ下へ移動、カウントが1減る", () => {
    const state = makeState();
    const declaration = findUseAction(state)!;
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash")!;
    expect(pass).toBeDefined();

    let afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const costChoice = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    afterPass = applyLegalAction({
      state: afterPass,
      action: costChoice,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    // 後段で選ぶ対象が1体に確定しているため、その場で重疲労まで解決する。
    const afterExhaust = afterPass;

    expect(
      afterExhaust.cardInstances.find((c) => c.instanceId === "target-1")
        ?.exhaustState
    ).toBe("heavily_exhausted");
    expect(afterExhaust.players.find((p) => p.id === "alice")?.countValue).toBe(
      0
    );

    const afterExhaustActions = getLegalActions({
      state: afterExhaust,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    // 「その後」の send_to_deck は executionMode:"optional" の連続 step のため
    // resolve_pending_step_optional_choice (execute/decline) で提示される
    // (TR01(A) の rebirth step-optional と同型)。
    const executeChoice = afterExhaustActions.find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    expect(executeChoice).toBeDefined();

    // 唯一の疲労状態候補 (target-1 自身) しかいないため、execute 選択だけで
    // send_to_deck まで自動解決される (単一候補の target 選択省略)。
    const resolved = applyLegalAction({
      state: afterExhaust,
      action: executeChoice,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "target-1")?.zone
    ).toBe("deck");
  });
});

describe("BSGE01-TX01(B) 盤面検証: 合体中フラッシュでスピリット破壊 (P3-111 残り)", () => {
  const frontDef = card("BSGE01-TX01(A)");
  // host は braveCondition (GE&O/1非含有) を満たす必要がある (TR01(B) 盤面検証の注記参照)。
  const hostDef = card("BSGE01-CX01");
  const targetDef = card("BSGE01-R02");
  // filterOr の枝内 maxBpSource:"self_effective_bp" が正しく解決される回帰確認用。
  // 本来なら合体ユニットの実効 BP を超えるため対象外になるべき「本来のBP」が高い
  // 相手スピリット (adversarial verifier round3: filterOr 内 maxBpSource が黙って
  // 無視され全対象マッチしてしまう silent bug を発見)。
  const highBpTargetDef: CardDefinition = {
    ...card("BSGE01-R02"),
    cardNo: "TEST-BSGE01-HIGHBP",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 30000 }],
  };
  const expanded = expandCardDefinitionsWithBackFaces([
    frontDef,
    hostDef,
    targetDef,
    highBpTargetDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const backDef = getDef("BSGE01-TX01(B)")!;
  const fieldLookup = buildFieldCardEffectLookup(expanded);

  function makeState(): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["brave-1"],
    });
    const brave = createCardInstance(backDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-1",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const highBpTarget = createCardInstance(highBpTargetDef, {
      instanceId: "high-bp-target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, target, highBpTarget],
        playerOverrides: [{ countValue: 1 }, {}],
      }),
      step: "attack",
      window: "flash_before_block",
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId: "host-1",
          memberInstanceIds: ["host-1", "brave-1"],
          attackState: "attacking",
          resolvedBp: 10000,
          resolvedSymbols: ["red"],
        },
      ],
      activeAttack: {
        attackId: "test-attack",
        primaryEntityId: "host-1",
        participantEntityIds: ["host-1"],
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

  function findUseAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.sourceEffectInstanceId === "brave-1" &&
        // cluster bsge01-backface-header-line-audit で追加された
        // reverse_rebirth(mode:flip) 裏返しアクション (対象無し) と区別する。
        a.requiredTargetCount > 0
    );
  }

  it("合体先がアタック中ならフラッシュで発揮する legal action が列挙される", () => {
    expect(findUseAction(makeState())).toBeDefined();
  });

  it("宣言→相手パス→対象選択で相手スピリットが破壊され、カウントが1減る", () => {
    const state = makeState();
    const declaration = findUseAction(state)!;
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash")!;
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(targetSelection).toBeDefined();

    const resolved = applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "target-1")?.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(0);
  });

  it("対象選択候補は filterOr 内 maxBpSource:self_effective_bp を再帰的に解決し、実効BP超過の相手は除外する (adversarial verifier round3 回帰)", () => {
    const state = makeState();
    const declaration = findUseAction(state)!;
    const declared = applyLegalAction({
      state,
      action: declaration,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash")!;

    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(targetSelection).toBeDefined();

    const candidateIds = (
      targetSelection as { candidateTargetInstanceIds?: string[] }
    ).candidateTargetInstanceIds;
    expect(candidateIds).toContain("target-1");
    expect(candidateIds).not.toContain("high-bp-target-1");
  });
});

describe("BSGE01-TX03(B)/TX04(B) 裏面【合体中】連続スケーリング可変コスト効果 (cluster bsge01-tx03-tx04-backface-scaling-cost)", () => {
  it.each(["BSGE01-TX03(A)", "BSGE01-TX04(A)"])(
    "%s(B): braveCondition (GE&O/1非含有) は (A) 面と同一",
    (no) => {
      const c = card(no).backFace!;
      expect(c.braveCondition).toEqual({
        tribes: ["GE"],
        excludeTribeSubstring: ["O", "1"],
      });
    }
  );

  it("BSGE01-TX03(B): cost count_decrease(amount:{min:1})→core_move(単一対象コアシュート、amount=step_numeric_amount(cd)) で総減少量=移動コア数の1:1スケーリング", () => {
    const back = card("BSGE01-TX03(A)").backFace!;
    // e.timingScope で絞る: cluster bsge01-backface-header-line-audit の新規追加
    // (フラッシュ裏返し reverse_rebirth flip 効果、timingScope 無し) と区別するため。
    const combo = back.effects!.find(
      (e) => e.timing.kind === "activated" && e.timingScope !== undefined
    )!;
    expect(combo.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(combo.timingScope).toEqual({ player: "both", period: "attack" });
    expect(combo.applicability?.combined).toBe(true);
    const cdStep = combo.steps[0]!;
    expect(cdStep.id).toBe("cd");
    expect(cdStep.action).toEqual({
      kind: "count_decrease",
      player: "self",
      amount: { min: 1 },
    });
    const coreMoveStep = combo.steps[1]!;
    expect(coreMoveStep.connector).toBe("conditional_cost");
    const coreMoveAction = coreMoveStep.action as {
      kind: string;
      target: { filter: { category: string[] }; count: number };
      from: { kind: string };
      to: { kind: string; player: string };
      amount: { source: { kind: string; stepId: string } };
    };
    expect(coreMoveAction.kind).toBe("core_move");
    expect(coreMoveAction.target.filter.category).toEqual([
      "spirit",
      "ultimate",
    ]);
    expect(coreMoveAction.target.count).toBe(1);
    expect(coreMoveAction.from).toEqual({ kind: "target_card" });
    expect(coreMoveAction.to).toEqual({ kind: "reserve", player: "opponent" });
    expect(coreMoveAction.amount).toEqual({
      source: { kind: "step_numeric_amount", stepId: "cd" },
    });
  });

  it("BSGE01-TX04(B): 支払うカウントを先に選び、その数で破壊上限を変更する", () => {
    const combo = card("BSGE01-TX04(A)").backFace!.effects!.find(
      (e) => e.timing.kind === "activated" && e.timingScope !== undefined
    )!;
    expect(combo.applicability?.combined).toBe(true);
    expect(combo.steps[0]).toMatchObject({
      id: "cd",
      action: { kind: "count_decrease", amount: { min: 1 } },
    });
    expect(combo.steps[1].action).toMatchObject({
      kind: "effect_param_modify",
      addLimitAmount: {
        source: { kind: "step_numeric_amount", stepId: "cd" },
        multiplier: 2,
        offset: -2,
      },
    });
    expect(combo.steps[2]).toMatchObject({
      targetSelectionTiming: "on_step",
      action: {
        kind: "destroy",
        target: { filter: { maxCost: 6, costBasis: "printed" } },
      },
    });
  });
});

describe("BSGE01-TX03(B) 盤面検証: 合体中フラッシュで追加コア移動が連続スケーリングする (cluster bsge01-tx03-tx04-backface-scaling-cost)", () => {
  const frontDef = card("BSGE01-TX03(A)");
  // host は braveCondition (GE&O/1非含有) を満たす必要がある (TR01(B) 盤面検証の注記参照)。
  const hostDef = card("BSGE01-CX01");
  const targetDef = card("BSGE01-R02");
  const expanded = expandCardDefinitionsWithBackFaces([
    frontDef,
    hostDef,
    targetDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const backDef = getDef("BSGE01-TX03(B)")!;
  const fieldLookup = buildFieldCardEffectLookup(expanded);
  const lookupOpts = {
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: fieldLookup,
    getRegisteredTriggeredEffectActions: () => undefined,
  };

  function makeState(options: {
    countValue: number;
    targetCoreCount: number;
  }): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["brave-1"],
    });
    const brave = createCardInstance(backDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-1",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: options.targetCoreCount,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, target],
        playerOverrides: [{ countValue: options.countValue }, {}],
      }),
      step: "attack",
      window: "flash_before_block",
      activePlayerId: "alice",
      activeAttack: {
        attackId: "test-attack",
        primaryEntityId: "host-1",
        participantEntityIds: ["host-1"],
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

  function findUseAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.sourceEffectInstanceId === "brave-1" &&
        // cluster bsge01-backface-header-line-audit で追加された
        // reverse_rebirth(mode:flip) 裏返しアクション (対象無し) と区別する。
        a.requiredTargetCount > 0
    );
  }

  // engine 構造: use_field_card_effect の対象選択は count_decrease 等コスト step の実行前に
  // 確定する (declare→pass→resolve_pending_effect_target→(以降のstepが実行される)。
  // TX01(B)/TX02(B) の盤面検証と同じ順序 (先に対象、後でコストの pending が続く)。
  function declareAndSelectTarget(
    state: GameState,
    targetInstanceId: string
  ): GameState {
    const declaration = findUseAction(state)!;
    const declared = applyLegalAction({
      state,
      action: declaration,
      ...lookupOpts,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...lookupOpts,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash")!;
    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      ...lookupOpts,
    }).state;
    const targetSelection = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    return applyLegalAction({
      state: afterPass,
      action: targetSelection,
      targetInstanceIds: [targetInstanceId],
      ...lookupOpts,
    }).state;
  }

  it("最低支払い (総減少1) では相手のコアが1個だけリザーブに置かれ、カウントが1減る", () => {
    const afterTarget = declareAndSelectTarget(
      makeState({ countValue: 3, targetCoreCount: 4 }),
      "target-1"
    );

    const countSelect = getLegalActions({
      state: afterTarget,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find((a) => a.kind === "resolve_pending_count_decrease")!;
    expect(countSelect).toBeDefined();

    const resolved = applyLegalAction({
      state: afterTarget,
      action: countSelect,
      countDecreaseSelection: 1,
      ...lookupOpts,
    }).state;

    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(2);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "target-1")
        ?.normalCoreCount
    ).toBe(3);
    expect(
      resolved.players.find((p) => p.id === "bob")?.reserveNormalCoreCount
    ).toBeGreaterThanOrEqual(1);
  });

  it("追加で2カウント多く支払う (総減少3) と移動コア数も3個へスケーリングする", () => {
    const afterTarget = declareAndSelectTarget(
      makeState({ countValue: 4, targetCoreCount: 4 }),
      "target-1"
    );

    const countSelect = getLegalActions({
      state: afterTarget,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find((a) => a.kind === "resolve_pending_count_decrease")!;

    const resolved = applyLegalAction({
      state: afterTarget,
      action: countSelect,
      countDecreaseSelection: 3,
      ...lookupOpts,
    }).state;

    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(1);
    // 総減少3 → 移動コア3個 (1:1)。target-1 の初期コア4個から3個減って1個残る。
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "target-1")
        ?.normalCoreCount
    ).toBe(1);
  });
});

describe("BSGE01-TX04(B) 盤面検証: 合体中フラッシュでカウントを選んで支払ってから対象を選ぶ (cluster bsge01-tx03-tx04-backface-scaling-cost)", () => {
  const frontDef = card("BSGE01-TX04(A)");
  // host は braveCondition (GE&O/1非含有) を満たす必要がある (TR01(B) 盤面検証の注記参照)。
  const hostDef = card("BSGE01-CX01");
  const lowCostTargetDef = { ...card("BSGE01-R02"), effects: [] }; // 印字コスト2 (基礎閾値6以下、最低支払い1で破壊可能)
  // 印字コスト8の合成対象。基礎閾値6を超えるため追加支払い(ceil((8-4)/2)=2)が必要。
  const highCostTargetDef: CardDefinition = {
    ...lowCostTargetDef,
    cardNo: "TEST-BSGE01-HIGHCOST",
    cost: 8,
  };
  const expanded = expandCardDefinitionsWithBackFaces([
    frontDef,
    hostDef,
    lowCostTargetDef,
    highCostTargetDef,
  ]);
  const getDef = (id: string) => expanded.find((d) => d.cardNo === id);
  const backDef = getDef("BSGE01-TX04(B)")!;
  const fieldLookup = buildFieldCardEffectLookup(expanded);
  const lookupOpts = {
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: fieldLookup,
    getRegisteredTriggeredEffectActions: () => undefined,
  };

  function makeState(countValue: number): GameState {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["brave-1"],
    });
    const brave = createCardInstance(backDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-1",
    });
    const lowCostTarget = createCardInstance(lowCostTargetDef, {
      instanceId: "low-cost-target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const highCostTarget = createCardInstance(highCostTargetDef, {
      instanceId: "high-cost-target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          host,
          brave,
          lowCostTarget,
          { ...lowCostTarget, instanceId: "low-cost-target-2" },
          highCostTarget,
        ],
        playerOverrides: [{ countValue }, {}],
      }),
      step: "attack",
      window: "flash_before_block",
      activePlayerId: "alice",
      activeAttack: {
        attackId: "test-attack",
        primaryEntityId: "host-1",
        participantEntityIds: ["host-1"],
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

  function findUseAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host-1" &&
        a.sourceEffectInstanceId === "brave-1" &&
        // cluster bsge01-backface-header-line-audit で追加された
        // reverse_rebirth(mode:flip) 裏返しアクション (対象無し) と区別する。
        a.registrationIndex === 1
    );
  }

  function declareAndPass(state: GameState, selectedCount = 1): GameState {
    const declaration = findUseAction(state)!;
    expect(
      declaration,
      JSON.stringify(
        getLegalActions({ state, actingPlayerId: "alice", ...lookupOpts })
      )
    ).toBeDefined();
    const declared = applyLegalAction({
      state,
      action: declaration,
      ...lookupOpts,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...lookupOpts,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash")!;
    const afterStack = applyLegalAction({
      state: declared,
      action: pass,
      ...lookupOpts,
    }).state;
    const countAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find((a) => a.kind === "resolve_pending_count_decrease");
    if (!countAction) return afterStack;
    expect(
      afterStack.cardInstances.find(
        (c) => c.instanceId === "high-cost-target-1"
      )?.zone
    ).toBe("field");
    return applyLegalAction({
      state: afterStack,
      action: countAction!,
      countDecreaseSelection: selectedCount,
      ...lookupOpts,
    }).state;
  }

  it("countValue=0 のとき mandatory base cost (count_decrease amount:1) を払えないため宣言候補に出さない", () => {
    expect(findUseAction(makeState(0))).toBeUndefined();
  });

  it("1カウントを支払った後はコスト6以下だけが対象候補になる", () => {
    const opened = declareAndPass(makeState(1));
    const targetSelection = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    expect(targetSelection).toBeDefined();
    const candidateIds = (
      targetSelection as { candidateTargetInstanceIds?: string[] }
    ).candidateTargetInstanceIds;
    expect(candidateIds).toContain("low-cost-target-1");
    expect(candidateIds).not.toContain("high-cost-target-1");
  });

  it("印字コスト2 (基礎閾値6以下) の対象を選ぶと最低支払い1だけで破壊され、カウントが1減る", () => {
    const opened = declareAndPass(makeState(3));
    const targetSelection = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    expect(
      targetSelection,
      JSON.stringify({
        actions: getLegalActions({
          state: opened,
          actingPlayerId: "alice",
          ...lookupOpts,
        }),
        log: opened.log.slice(-18),
        counts: opened.players[0]?.countValue,
      })
    ).toBeDefined();

    const resolved = applyLegalAction({
      state: opened,
      action: targetSelection,
      targetInstanceIds: ["low-cost-target-1"],
      ...lookupOpts,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "low-cost-target-1")
        ?.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(2);
  });

  it("先に2カウントを支払うとコスト8の対象を選んで破壊できる", () => {
    const opened = declareAndPass(makeState(3), 2);
    const targetSelection = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    const candidateIds = (
      targetSelection as { candidateTargetInstanceIds?: string[] }
    ).candidateTargetInstanceIds;
    expect(candidateIds).toContain("high-cost-target-1");

    const resolved = applyLegalAction({
      state: opened,
      action: targetSelection,
      targetInstanceIds: ["high-cost-target-1"],
      ...lookupOpts,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "high-cost-target-1")
        ?.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });
  it("小さいコストの対象にも必要最小額を超えるカウントを支払える", () => {
    const opened = declareAndPass(makeState(4), 3);
    expect(opened.players[0]!.countValue).toBe(1);
    const targetAction = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    const after = applyLegalAction({
      state: opened,
      action: targetAction,
      targetInstanceIds: ["low-cost-target-1"],
      ...lookupOpts,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "low-cost-target-1")
        ?.zone
    ).toBe("trash");
    expect(after.players[0]!.countValue).toBe(1);
  });
});
