import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSDB01 (ドラゴンボールZ) コモン C01-C10 の effects 検証テスト（再実装版）。
 *
 * 旧変換が「基盤なし」と誤断定して過剰 stub していたものを実装済み基盤へ再配線:
 *   - 契約煌臨宣言 → CardDefinition.adventData（AdventData / executeAdvent, 11 L149 / 08a）
 *   - 契約煌臨誘発ドロー（C07）→ game_event:"advent" + triggerFilter
 *   - 魂状態/煌臨元を含む field_has ゲート（C08）→ field_has cardNames
 *   - トラッシュコア配置（C08）→ core_distribute
 *   - 最小コストセレクタ / OC中＆煌臨中 suppress（C04）→ min_cost selector / dynamic suppress_effect
 *
 * 真に未実装で残す stub（doc 引用済み）:
 *   - 動的 maxCost=カウント値破壊（C02）
 *   - デッキオープン由来の自カード入替/回収（C07/C10）
 *   - トラッシュ起動スタック+除外（C09）/ 行動制限（C09）
 *   - コスト閾値付き部分ライフ軽減（C10）
 *
 * 各カードに「いま本当に盤面が動く」テストを最低1件含める（executeEffect / executeAdvent）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import rawCards from "../../card-data/raw/cardData.js";
import rawPackCards from "../../card-data/raw/by-pack/BSDB01.js";
import {
  applyCardCostPayments,
  calculateReduction,
  buildBurstEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  executeBattleResolution,
  executeMatchingRetriggers,
  filterRestrictedTimings,
  getAvailableOnBoardCorePaymentSources,
  getCombinedUnitSymbols,
  collectGameStateInvariantIssues,
  isBurstEffectNullifiedByOpponent,
  isCardUseRestricted,
  joinActiveAttackAsAction,
  moveNormalCores,
  recomputeBattleEntityBp,
  rebuildContinuousEffectsFromField,
  resolveCardLeavesFieldCores,
  synthesizeBackFaceDefinition,
} from "../src/runtime";
import type { CardDefinition, GameState, LegalAction } from "../src/runtime";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getApplicableAdditionalCostDelta } from "../src/card/card-filter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { executeAdvent } from "../src/mechanics/advent-system";
import { useSetMirageAsAction } from "../src/mechanics/mirage-system";
import { adventSourceIdsOf } from "../src/model";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import {
  executeReevaluationCheck,
  recomputeContinuousEffects,
  removeExpiredContinuousEffects,
} from "../src/legal/legal-actions-shared";
import type {
  BattleEntity,
  BattleResolutionGroup,
  ContinuousEffect,
  SymbolColor,
} from "../src/model";
import {
  queueBattleEndTriggers,
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import {
  flushPendingLeaves,
  queuePendingLeave,
} from "../src/state-based-actions";
import {
  getPlayerLifeCoreCount,
  getPlayerReserveCoreCount,
} from "../src/core/core-system";
import { getUnblockedLifeDamage } from "../src/battle/battle-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

const ALICE = "player-1";
const BOB = "player-2";

/** Effect を ALICE のソースカード sourceId 上で実行する薄いラッパ。 */
function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  return executeEffect({
    chainId: "test:bsdb01-cards:104",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

function executeNextOptionalStep(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined = getDef
): GameState {
  const pending = state.pendingStepOptionalChoice;
  expect(pending).not.toBeNull();
  expect(pending!.canExecute).toBe(true);
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_step_optional_choice",
      actionId: `pso-${pending!.pendingId}:execute`,
      can: true,
      reason: "test",
      actingPlayerId: pending!.choosingPlayerId,
      pendingId: pending!.pendingId,
      sourceInstanceId: pending!.sourceInstanceId,
      effectIndex: pending!.effectIndex,
      stepIndex: pending!.stepIndex,
      choice: "execute",
    },
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    getRegisteredBurstActions,
  }).state;
}

function declineNextOptionalStep(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined = getDef
): GameState {
  const pending = state.pendingStepOptionalChoice;
  expect(pending).not.toBeNull();
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_step_optional_choice",
      actionId: `pso-${pending!.pendingId}:decline`,
      can: true,
      reason: "test",
      actingPlayerId: pending!.choosingPlayerId,
      pendingId: pending!.pendingId,
      sourceInstanceId: pending!.sourceInstanceId,
      effectIndex: pending!.effectIndex,
      stepIndex: pending!.stepIndex,
      choice: "decline",
    },
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    getRegisteredBurstActions,
  }).state;
}

function executeAllOptionalSteps(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined = getDef
): GameState {
  let current = state;
  for (let guard = 0; guard < 20; guard++) {
    if (current.pendingMultiPlacement !== null) {
      current = resolvePendingMinimumPlacements(current);
      continue;
    }
    if (current.pendingStepOptionalChoice === null) break;
    current = current.pendingStepOptionalChoice.canExecute
      ? executeNextOptionalStep(current, getCardDefinitionById)
      : declineNextOptionalStep(current, getCardDefinitionById);
  }
  return current;
}

function resolvePendingMinimumPlacements(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: state.pendingMultiPlacement!.actingPlayerId,
    getCardDefinitionById: getDef,
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  if (!action || action.kind !== "resolve_pending_multi_placement")
    return state;
  return applyLegalAction({
    state,
    action,
    multiPlacementAllocations: action.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements:
        target.minimumCoreCount > 0
          ? [
              {
                kind: "reserve_normal" as const,
                amount: target.minimumCoreCount,
              },
            ]
          : [],
    })),
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    getRegisteredBurstActions,
  }).state;
}

function resolvePendingStepOptionalTargetSelection(
  state: GameState,
  targetInstanceIds: string[]
): GameState {
  const pending = state.pendingStepOptionalTargetSelection;
  expect(pending).not.toBeNull();
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_step_optional_target_selection",
      actionId: `psots-${pending!.pendingId}:test`,
      can: true,
      reason: "test",
      actingPlayerId: pending!.actingPlayerId,
      pendingId: pending!.pendingId,
      sourceInstanceId: pending!.sourceInstanceId,
      sourceDefinitionId: pending!.sourceDefinitionId,
      effectIndex: pending!.effectIndex,
      stepIndex: pending!.stepIndex,
      requiredTargetCount: pending!.requiredTargetCount,
      maxTargetCount: pending!.maxTargetCount,
      candidateTargetInstanceIds: pending!.candidateInstanceIds,
    },
    targetInstanceIds,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    getRegisteredBurstActions,
  }).state;
}

function defenseImmuneCE(
  targetInstanceId: string,
  overrides: Partial<ContinuousEffect> = {}
): ContinuousEffect {
  return {
    effectId: `test-defense-immune-${targetInstanceId}`,
    sourceInstanceId: "bob-effect-source",
    sourceDefinitionId: "BSDB01-C07",
    actingPlayerId: BOB,
    duration: { scope: "battle" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
    ...overrides,
  };
}

function symbolAdditionCE(
  targetInstanceId: string,
  symbol: SymbolColor
): ContinuousEffect {
  return {
    effectId: `ce-extra-symbol-${targetInstanceId}`,
    sourceInstanceId: "external-symbol-source",
    sourceDefinitionId: "TEST-SYMBOL-SOURCE",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "symbol_addition",
    modifierSymbol: [symbol],
    targetInstanceId,
  };
}

function aliceCount(state: GameState): number {
  return state.players.find((p) => p.id === ALICE)!.countValue;
}

function aliceLifeCoreCount(state: GameState): number {
  return getPlayerLifeCoreCount(state.players.find((p) => p.id === ALICE)!);
}

function withLifeDamageBattle(
  state: GameState,
  attackers: { entityId: string; leaderId: string; symbols: number }[]
): GameState {
  const toSymbols = (count: number): SymbolColor[] =>
    Array.from({ length: count }, () => "red" as SymbolColor);
  const battleEntities: BattleEntity[] = attackers.map((attacker) => ({
    entityId: attacker.entityId,
    memberInstanceIds: [attacker.leaderId],
    resolvedBp: 5000,
    resolvedSymbols: toSymbols(attacker.symbols),
    attackState: "attacking",
  }));
  const battleResolutionGroup: BattleResolutionGroup = {
    attackId: "bsdb01-c10-attack",
    groupMode: "single",
    target: { kind: "player", playerId: ALICE },
    symbolResolutionOrder: attackers.map((attacker) => attacker.entityId),
    participantSnapshots: attackers.map((attacker) => ({
      entityId: attacker.entityId,
      memberInstanceIds: [attacker.leaderId],
      resolvedBp: 5000,
      resolvedSymbols: toSymbols(attacker.symbols),
      blockedBy: [],
    })),
  };
  return { ...state, battleEntities, battleResolutionGroup };
}

// ════════════════════════════════════════════════════════════════
// C01 孫悟空 — 契約煌臨 / アタック時カウント+2 / BP破壊 / 超激突を配線
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C01 孫悟空", () => {
  const c = card("BSDB01-C01");

  it("契約煌臨は adventData で宣言（effects の stub ではない）", () => {
    expect(c.keywordTags).toContain("advent");
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventTiming).toBe("own_turn");
    expect(c.adventData!.soulCoreDest).toBe("trash");
    // 旧 effects[0] の「契約煌臨は基盤未対応」stub は撤去済み。
    const adventStub = c.effects!.find((e) => e.stub?.includes("契約煌臨宣言"));
    expect(adventStub).toBeUndefined();
  });

  it("アタック時: カウント+2（強制）→ 任意1ドロー（stub 撤去済み）", () => {
    const atk = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "attack" &&
        e.steps[0]?.action.kind === "count_increase"
    )!;
    expect(atk.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 2,
    });
    expect(atk.steps[1]!.action).toEqual({ kind: "draw", count: 1 });
    expect(atk.stub).toBeUndefined();
  });

  it("後続: ターン1回・このスピリットのBP以下の相手破壊（動的 maxBpSource）", () => {
    const destroy = c.effects![0]!.steps[2]!;
    expect(destroy.executionMode).toBe("optional");
    expect(destroy.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    const action = destroy.action;
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.maxBpSource).toBe("self_effective_bp");
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.count).toBe(1);
    } else {
      throw new Error("destroy filter target expected");
    }
  });

  it("[board] BP以下のみ破壊: 自身BP4000、相手2000は破壊・5000は残る", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv1 → BP 4000
    });
    const lowBp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-1", // クリリン Lv1 BP 2000 ≤ 4000 → 破壊
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const highBp = createCardInstance(card("BSDB01-R01"), {
      instanceId: "vegeta-1", // ベジータ Lv1 BP 5000 > 4000 → 残る
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const destroy = c.effects![0]!;
    const before = createEmptyGameState({
      cardInstances: [src, lowBp, highBp],
    });
    // destroy は queuePendingLeave で離脱予約する（pendingLeaveKind="destroy"）。
    // BP超過の vegeta は候補から外れるため、count=1 は krillin のみへ自動解決する。
    const after = executeAllOptionalSteps(runEffect(before, destroy, "goku-1"));
    const krillin = after.cardInstances.find(
      (x) => x.instanceId === "krillin-1"
    )!;
    const vegeta = after.cardInstances.find(
      (x) => x.instanceId === "vegeta-1"
    )!;
    expect(krillin.zone).toBe("trash"); // BP2000 ≤ 4000 → 破壊予約
    expect(vegeta.pendingLeaveKind).toBeNull(); // BP5000 > 4000 → 対象外
  });

  it("[board] adventData 経由で executeAdvent が手札カードをフィールドへ重ねる", () => {
    // 【契約煌臨：「孫悟空」】= 煌臨先 host も「孫悟空」名（AdventCondition.cardNames）。
    // 超サイヤ人 孫悟空（C03、名前に「孫悟空」を含む）を host にする。
    const target = createCardInstance(card("BSDB01-C03"), {
      instanceId: "target-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const adventCard = createCardInstance(c, {
      instanceId: "advent-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      cardInstances: [target, adventCard],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          countValue: 5,
        },
        {},
      ],
    });
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: c.adventData!,
      },
      getDef
    );
    const adv = result.cardInstances.find((x) => x.instanceId === "advent-1")!;
    expect(adv.zone).toBe("field");
    expect(adventSourceIdsOf(adv)).toEqual(["target-1"]);
  });

  it("[board] アタック時効果でカウントが実際に +2 される", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const atk = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "attack" &&
        e.steps.length > 0
    )!;
    const before = createEmptyGameState({ cardInstances: [src] });
    expect(aliceCount(before)).toBe(0);
    const after = runEffect(before, atk, "goku-1");
    expect(aliceCount(after)).toBe(2);
  });

  it("OC超激突は require_block_if_able で可能ならブロックを要求する", () => {
    const oc = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    expect(oc.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 2,
    });
    expect(oc.preventionLevel).toBe("unpreventable");
    expect(oc.stub).toBeUndefined();
    expect(oc.steps[0]!.action).toEqual({
      kind: "require_block_if_able",
      player: "self",
      blockerFilter: { category: ["spirit", "ultimate"] },
      duration: { scope: "battle" },
    });
  });

  it("[board] BSDB01-C01 OC超激突: 相手のブロック禁止/unblockable/装甲効果では防げず decline_block できず block が残る", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-oc",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const blocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-blocker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobPreventBlock: ContinuousEffect = {
      effectId: "bob-prevent-block-krillin",
      sourceInstanceId: "bob-effect-source",
      sourceDefinitionId: "test-bob-effect-source",
      actingPlayerId: BOB,
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: "attack-goku-oc",
      modifierTag: "prevent_battle_block",
      targetInstanceId: "krillin-blocker",
    };
    const bobUnblockable: ContinuousEffect = {
      effectId: "bob-unblockable-goku",
      sourceInstanceId: "bob-effect-source",
      sourceDefinitionId: "test-bob-effect-source",
      actingPlayerId: BOB,
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: "attack-goku-oc",
      modifierTag: "unblockable",
      targetInstanceId: "goku-oc",
    };
    const bobDefenseImmune = defenseImmuneCE("krillin-blocker", {
      effectId: "bob-defense-immune-krillin",
      createdAtAttackId: "attack-goku-oc",
    });
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, blocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activeContinuousEffects: [
        bobPreventBlock,
        bobUnblockable,
        bobDefenseImmune,
      ],
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-oc",
        primaryEntityId: "battle-goku-oc",
        participantEntityIds: ["battle-goku-oc"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-oc",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-goku-oc"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-oc",
          memberInstanceIds: ["goku-oc"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
    const after = recomputeContinuousEffects(
      runEffect(before, superClash, "goku-oc")
    );
    expect(
      after.activeContinuousEffects.find(
        (ce) => ce.modifierTag === "require_block_if_able"
      )?.metadata?.preventionLevel
    ).toBe("unpreventable");

    const actions = getLegalActions({
      state: after,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(actions.some((a) => a.kind === "decline_block")).toBe(false);
    expect(
      actions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "krillin-blocker"
      )
    ).toBe(true);
  });

  it("[board] require_block_if_able: 防げる版は装甲持ちだけの盤面なら decline_block できる", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-preventable-armor",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const blocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-armored",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const preventableRequireBlock: ContinuousEffect = {
      effectId: "preventable-require-block",
      sourceInstanceId: "goku-preventable-armor",
      sourceDefinitionId: c.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: "attack-goku-preventable-armor",
      modifierTag: "require_block_if_able",
      targetInstanceId: ALICE,
      metadata: {
        blockerFilter: { category: ["spirit", "ultimate"] },
      },
    };
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, blocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activeContinuousEffects: [
        preventableRequireBlock,
        defenseImmuneCE("krillin-armored", {
          effectId: "bob-defense-immune-krillin-armored",
          createdAtAttackId: "attack-goku-preventable-armor",
        }),
      ],
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-preventable-armor",
        primaryEntityId: "battle-goku-preventable-armor",
        participantEntityIds: ["battle-goku-preventable-armor"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-preventable-armor",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-goku-preventable-armor"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-preventable-armor",
          memberInstanceIds: ["goku-preventable-armor"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const actions = getLegalActions({
      state: before,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(actions.some((a) => a.kind === "decline_block")).toBe(true);
    expect(
      actions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "krillin-armored"
      )
    ).toBe(true);
  });

  it("[board] require_block_if_able: 防げる版は非装甲がいれば decline 不可だが装甲持ちも通常ブロックできる", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-preventable-mixed",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const armoredBlocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-mixed-armored",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const vulnerableBlocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-mixed-vulnerable",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const preventableRequireBlock: ContinuousEffect = {
      effectId: "preventable-require-block-mixed",
      sourceInstanceId: "goku-preventable-mixed",
      sourceDefinitionId: c.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: "attack-goku-preventable-mixed",
      modifierTag: "require_block_if_able",
      targetInstanceId: ALICE,
      metadata: {
        blockerFilter: { category: ["spirit", "ultimate"] },
      },
    };
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, armoredBlocker, vulnerableBlocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activeContinuousEffects: [
        preventableRequireBlock,
        defenseImmuneCE("krillin-mixed-armored", {
          effectId: "bob-defense-immune-krillin-mixed-armored",
          createdAtAttackId: "attack-goku-preventable-mixed",
        }),
      ],
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-preventable-mixed",
        primaryEntityId: "battle-goku-preventable-mixed",
        participantEntityIds: ["battle-goku-preventable-mixed"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-preventable-mixed",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-goku-preventable-mixed"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-preventable-mixed",
          memberInstanceIds: ["goku-preventable-mixed"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const actions = getLegalActions({
      state: before,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(actions.some((a) => a.kind === "decline_block")).toBe(false);
    expect(
      actions.some(
        (a) =>
          a.kind === "block" && a.sourceInstanceId === "krillin-mixed-armored"
      )
    ).toBe(true);
    expect(
      actions.some(
        (a) =>
          a.kind === "block" &&
          a.sourceInstanceId === "krillin-mixed-vulnerable"
      )
    ).toBe(true);
  });

  it("[board] require_block_if_able: preventionLevelCondition は解決時成立時だけ装甲を貫通する", () => {
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const conditionalRequireBlock: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      ...superClash,
      preventionLevel: "unpreventable",
      preventionLevelCondition: [
        { kind: "count_value", player: "self", min: 7 },
      ],
    };
    const makeState = (countValue: number): GameState => {
      const src = createCardInstance(c, {
        instanceId: `goku-conditional-${countValue}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      const blocker = createCardInstance(card("BSDB01-C05"), {
        instanceId: `krillin-conditional-${countValue}`,
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      return {
        ...createEmptyGameState({
          cardInstances: [src, blocker],
          playerOverrides: [{ countValue }, {}],
        }),
        activeContinuousEffects: [
          defenseImmuneCE(`krillin-conditional-${countValue}`, {
            effectId: `bob-defense-immune-conditional-${countValue}`,
            createdAtAttackId: `attack-goku-conditional-${countValue}`,
          }),
        ],
        activePlayerId: ALICE,
        step: "attack",
        window: "declare_block",
        activeAttack: {
          attackId: `attack-goku-conditional-${countValue}`,
          primaryEntityId: `battle-goku-conditional-${countValue}`,
          participantEntityIds: [`battle-goku-conditional-${countValue}`],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [
            {
              participantEntityId: `battle-goku-conditional-${countValue}`,
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: [`battle-goku-conditional-${countValue}`],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: `battle-goku-conditional-${countValue}`,
            memberInstanceIds: [`goku-conditional-${countValue}`],
            resolvedBp: 7000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      };
    };
    const actionsAtCount6 = getLegalActions({
      state: runEffect(
        makeState(6),
        conditionalRequireBlock,
        "goku-conditional-6"
      ),
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(actionsAtCount6.some((a) => a.kind === "decline_block")).toBe(true);

    const actionsAtCount7 = getLegalActions({
      state: runEffect(
        makeState(7),
        conditionalRequireBlock,
        "goku-conditional-7"
      ),
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(actionsAtCount7.some((a) => a.kind === "decline_block")).toBe(false);
  });

  it("[board] BSDB01-C01 OC超激突: require_block_if_able の blockerFilter は防御側候補に適用される", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-oc-filter",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const blueBlocker = createCardInstance(card("BSDB01-C02"), {
      instanceId: "vegeta-blue",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const redBlocker = createCardInstance(c, {
      instanceId: "goku-red-blocker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const redBlockerOnlyVariant: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      ...superClash,
      steps: [
        {
          action: {
            kind: "require_block_if_able",
            player: "self",
            blockerFilter: { colors: ["red"] },
            duration: { scope: "battle" },
          },
        },
      ],
    };
    const base: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, blueBlocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-oc-filter",
        primaryEntityId: "battle-goku-oc-filter",
        participantEntityIds: ["battle-goku-oc-filter"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-oc-filter",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-goku-oc-filter"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-oc-filter",
          memberInstanceIds: ["goku-oc-filter"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const withoutRedBlocker = runEffect(
      base,
      redBlockerOnlyVariant,
      "goku-oc-filter"
    );
    const blueOnlyActions = getLegalActions({
      state: withoutRedBlocker,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(
      blueOnlyActions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "vegeta-blue"
      )
    ).toBe(true);
    expect(blueOnlyActions.some((a) => a.kind === "decline_block")).toBe(true);

    const withRedBlocker = runEffect(
      {
        ...base,
        cardInstances: [...base.cardInstances, redBlocker],
      },
      redBlockerOnlyVariant,
      "goku-oc-filter"
    );
    const redCandidateActions = getLegalActions({
      state: withRedBlocker,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(
      redCandidateActions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "goku-red-blocker"
      )
    ).toBe(true);
    expect(redCandidateActions.some((a) => a.kind === "decline_block")).toBe(
      false
    );
  });

  it("[board] BSDB01-C01 OC超激突: spirit/ultimate 候補がいる間は brave で義務を消化できない", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-oc-brave-filter",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const braveDef: CardDefinition = {
      cardNo: "TEST-BSDB01-C01-BLOCKER-BRAVE",
      name: "テストブロッカーブレイヴ",
      printedCategory: "brave",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["合法ブロック可能なブレイヴ"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "low",
    };
    const braveBlocker = createCardInstance(braveDef, {
      instanceId: "brave-blocker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const spiritBlocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "spirit-blocker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const getDefWithBrave = (id: string): CardDefinition | undefined =>
      id === braveDef.cardNo ? braveDef : getDef(id);
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, braveBlocker, spiritBlocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-oc-brave-filter",
        primaryEntityId: "battle-goku-oc-brave-filter",
        participantEntityIds: ["battle-goku-oc-brave-filter"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-oc-brave-filter",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-goku-oc-brave-filter"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-oc-brave-filter",
          memberInstanceIds: ["goku-oc-brave-filter"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
    const after = runEffect(before, superClash, "goku-oc-brave-filter");

    const actions = getLegalActions({
      state: after,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithBrave,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(
      actions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "spirit-blocker"
      )
    ).toBe(true);
    expect(
      actions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "brave-blocker"
      )
    ).toBe(false);
  });

  it("[board] BSDB01-C01 OC超激突: 相手由来 battle_cost_gate_block では防げない", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-oc-cost-gate",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const blocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-cost-gated",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobCostGate: ContinuousEffect = {
      effectId: "bob-battle-cost-gate-block",
      sourceInstanceId: "bob-effect-source",
      sourceDefinitionId: "test-bob-effect-source",
      actingPlayerId: BOB,
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: "attack-goku-oc-cost-gate",
      modifierTag: "battle_cost_gate_block",
      targetFilter: {
        player: "self",
        category: ["spirit", "ultimate"],
      },
      metadata: { costAmount: 2 },
    };
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, blocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activeContinuousEffects: [bobCostGate],
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-oc-cost-gate",
        primaryEntityId: "battle-goku-oc-cost-gate",
        participantEntityIds: ["battle-goku-oc-cost-gate"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-oc-cost-gate",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-goku-oc-cost-gate"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-oc-cost-gate",
          memberInstanceIds: ["goku-oc-cost-gate"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
    const after = runEffect(before, superClash, "goku-oc-cost-gate");

    const actions = getLegalActions({
      state: after,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(actions.some((a) => a.kind === "decline_block")).toBe(false);
    const blockAction = actions.find(
      (a) => a.kind === "block" && a.sourceInstanceId === "krillin-cost-gated"
    );
    expect(blockAction).toBeDefined();

    const declared = applyLegalAction({
      state: after,
      action: blockAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find((a) => a.kind === "pass_pre_declaration_stack");
    expect(pass).toBeDefined();

    const confirmed = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(
      confirmed.cardInstances.find(
        (card) => card.instanceId === "krillin-cost-gated"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      confirmed.log.some((entry) =>
        entry.startsWith("block:cost-gate-paid:krillin-cost-gated")
      )
    ).toBe(false);
    expect(
      confirmed.activeAttack?.blockAssignments.some((assignment) =>
        assignment.blockedByEntityIds.some((entityId) =>
          entityId.includes("krillin-cost-gated")
        )
      )
    ).toBe(true);
  });

  it("[board] BSDB01-C01 OC超激突: 同時アタックでも発揮元の孫悟空を先にブロックさせる", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-oc-simultaneous",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const otherAttacker = createCardInstance(card("BSDB01-C02"), {
      instanceId: "vegeta-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const blocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-blocker-simultaneous",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, otherAttacker, blocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-oc-simultaneous",
        primaryEntityId: "battle-goku-oc-simultaneous",
        participantEntityIds: [
          "battle-goku-oc-simultaneous",
          "battle-vegeta-attacker",
        ],
        groupMode: "simultaneous",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-oc-simultaneous",
            blockedByEntityIds: [],
          },
          {
            participantEntityId: "battle-vegeta-attacker",
            blockedByEntityIds: [],
          },
        ],
        blockerCapacity: 2,
        symbolResolutionOrder: [
          "battle-goku-oc-simultaneous",
          "battle-vegeta-attacker",
        ],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-oc-simultaneous",
          memberInstanceIds: ["goku-oc-simultaneous"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "battle-vegeta-attacker",
          memberInstanceIds: ["vegeta-attacker"],
          resolvedBp: 5000,
          resolvedSymbols: ["blue"],
          attackState: "attacking",
        },
      ],
    };
    const after = runEffect(before, superClash, "goku-oc-simultaneous");

    const actions = getLegalActions({
      state: after,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(
      actions.some(
        (a) =>
          a.kind === "block" &&
          a.sourceInstanceId === "krillin-blocker-simultaneous" &&
          a.participantEntityId === "battle-goku-oc-simultaneous"
      )
    ).toBe(true);
    expect(
      actions.some(
        (a) =>
          a.kind === "block" &&
          a.sourceInstanceId === "krillin-blocker-simultaneous" &&
          a.participantEntityId === "battle-vegeta-attacker"
      )
    ).toBe(false);
  });

  it("[board] BSDB01-C01 OC超激突: require_block_if_able CE登録成功が ref_succeeded 後続へ伝播する", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-oc-success",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const action = superClash.steps[0]!.action;
    const variant: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        { id: "require", action },
        {
          stepCondition: { kind: "ref_succeeded", stepId: "require" },
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const after = runEffect(
      createEmptyGameState({
        cardInstances: [src],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      variant,
      "goku-oc-success"
    );

    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "require_block_if_able"
      )
    ).toBe(true);
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(3);
  });

  it("[board] BSDB01-C01 OC超激突: 可能なブロッカーがいなければ decline_block できる", () => {
    const src = createCardInstance(c, {
      instanceId: "goku-oc",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const exhaustedBlocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin-exhausted",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const superClash = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "require_block_if_able"
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, exhaustedBlocker],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_block",
      activeAttack: {
        attackId: "attack-goku-oc",
        primaryEntityId: "battle-goku-oc",
        participantEntityIds: ["battle-goku-oc"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-goku-oc",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-goku-oc"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-goku-oc",
          memberInstanceIds: ["goku-oc"],
          resolvedBp: 7000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
    const after = runEffect(before, superClash, "goku-oc");

    const actions = getLegalActions({
      state: after,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(actions.some((a) => a.kind === "block")).toBe(false);
    expect(actions.some((a) => a.kind === "decline_block")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// C02 ベジータ — adventData / 煌臨アタック時カウント+1 / ターン1回ドロー破棄 / 動的コスト破壊は stub
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C02 ベジータ", () => {
  const c = card("BSDB01-C02");

  it("契約煌臨は adventData", () => {
    expect(c.adventData?.adventTiming).toBe("own_turn");
    expect(
      c.effects!.find((e) => e.stub?.includes("契約煌臨宣言"))
    ).toBeUndefined();
  });

  it("煌臨/アタック時カウント+1 と ターン1回 2ドロー→1破棄は同じ効果", () => {
    const count = c.effects!.find(
      (e) =>
        e.steps[0]?.action.kind === "count_increase" &&
        (e.steps[0]!.action as { amount: number }).amount === 1
    )!;
    expect(count.timing).toEqual({
      kind: "card_event",
      event: ["advent", "attack"],
    });
    expect(count.steps[1]!.action).toEqual({ kind: "draw", count: 2 });
    expect(count.steps[1]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(count.steps[2]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: 1,
    });
  });

  it("[board] 煌臨/アタック時効果でカウント +1", () => {
    const src = createCardInstance(c, {
      instanceId: "vegeta-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const count = c.effects!.find(
      (e) =>
        e.steps[0]?.action.kind === "count_increase" &&
        (e.steps[0]!.action as { amount: number }).amount === 1
    )!;
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src] }),
      count,
      "vegeta-1"
    );
    expect(aliceCount(after)).toBe(1);
  });

  it("OC 動的コスト閾値破壊が maxCostSource:self_count で配線 (stub 解消)", () => {
    const oc = c.effects![1]!;
    expect(oc.stub).toBeUndefined();
    expect(oc.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 2,
    });
    const destroy = oc.steps[0]!.action as {
      kind: string;
      target: { filter: { maxCostSource?: string } };
    };
    expect(destroy.kind).toBe("destroy");
    expect(destroy.target.filter.maxCostSource).toBe("self_count");
    // 「破壊できなかったとき」= destroy 非成功時に count+1。
    expect(oc.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "oc-destroy",
      not: true,
    });
    expect(oc.steps[1]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
  });

  it("[board] OC: 自分のカウント以下のコストの相手スピのみ破壊 (count4 → cost3破壊・cost5残存)", () => {
    const src = createCardInstance(c, {
      instanceId: "vegeta-oc",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const lowCost = createCardInstance(card("BSDB01-C05"), {
      instanceId: "oc-low", // コスト3 ≤ 4 → 破壊
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const highCost = createCardInstance(card("BSDB01-C03"), {
      instanceId: "oc-high", // コスト5 > 4 → 残る
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, lowCost, highCost],
      playerOverrides: [{ countValue: 4 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "vegeta-oc");
    const low = after.cardInstances.find((x) => x.instanceId === "oc-low")!;
    const high = after.cardInstances.find((x) => x.instanceId === "oc-high")!;
    expect(low.pendingLeaveKind).toBe("destroy"); // コスト3 ≤ 4 → 破壊予約
    expect(high.pendingLeaveKind).toBeNull(); // コスト5 > 4 → 対象外
    // 破壊対象が居て成功 → count+1 は発火しない。
    expect(aliceCount(after)).toBe(4);
  });

  it("[board] OC: 破壊できなかったとき自分のカウント+1 (count2 → cost3相手は対象外で count 2→3)", () => {
    const src = createCardInstance(c, {
      instanceId: "vegeta-oc2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const tooExpensive = createCardInstance(card("BSDB01-C05"), {
      instanceId: "oc-none", // コスト3 > 2 → 破壊不可
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, tooExpensive],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "vegeta-oc2");
    const none = after.cardInstances.find((x) => x.instanceId === "oc-none")!;
    expect(none.pendingLeaveKind).toBeNull(); // コスト3 > 2 → 破壊されない
    expect(aliceCount(after)).toBe(3); // 破壊できず → カウント+1
  });
});

// ════════════════════════════════════════════════════════════════
// C03 超サイヤ人 孫悟空 — adventData / カウント+1 / 相手ネクサス2破壊+2ドロー / バトル終了前段
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C03 超サイヤ人 孫悟空", () => {
  const c = card("BSDB01-C03");

  it("契約煌臨は adventData（お互いのアタックステップ）", () => {
    expect(c.adventData?.adventTiming).toBe("both_attack_step");
  });

  it("[board] ターン1回: 相手ネクサス2体を実際に破壊する", () => {
    const src = createCardInstance(c, {
      instanceId: "goku3-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手のネクサス2つ（C06 カメハウスを流用）。
    const nx1 = createCardInstance(card("BSDB01-C06"), {
      instanceId: "nx-1",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const nx2 = createCardInstance(card("BSDB01-C06"), {
      instanceId: "nx-2",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const destroyEffect = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "destroy")
    )!;
    const before = createEmptyGameState({
      cardInstances: [src, nx1, nx2],
      playerOverrides: [{}, { deckCount: 40 }],
    });
    const after = executeAllOptionalSteps(
      runEffect(before, destroyEffect, "goku3-1")
    );
    // destroy は queuePendingLeave で離脱予約する（zone→trash は flushPendingLeaves で後段）。
    // 即時の盤面変化は pendingLeaveKind="destroy" マーカー + pendingLeaveEntities。
    const nxAfter = after.cardInstances.filter(
      (x) => x.instanceId === "nx-1" || x.instanceId === "nx-2"
    );
    for (const n of nxAfter) {
      expect(n.zone).toBe("trash");
    }
    const queued = after.pendingLeaveEntities.filter(
      (e) => e.instanceId === "nx-1" || e.instanceId === "nx-2"
    );
    expect(queued).toHaveLength(0);
    expect(queued.every((e) => e.kind === "destroy")).toBe(true);
  });

  it("OC: ただちにバトル終了後、このターン相手アタッカーを破壊できる retrigger を登録する", () => {
    const oc = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "end_single_battle")
    )!;
    expect(oc.executionMode).toBe("optional");
    expect(oc.stub).toBeUndefined();
    expect(oc.condition).toContainEqual({
      kind: "step_phase",
      step: "attack",
      whose: "opponent",
    });
    expect(oc.steps[0]).toEqual({
      id: "end-battle",
      action: { kind: "end_single_battle" },
    });
    const delayed = oc.steps[1]!;
    expect(delayed.id).toBe("destroy-next-attacker");
    expect(delayed.connector).toBe("conditional_result");
    expect(delayed.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "end-battle",
    });
    expect(delayed.executionMode).toBeUndefined();
    expect(delayed.retrigger).toEqual({
      event: "attack",
      triggerPlayer: "opponent",
      triggerFilter: {
        category: ["spirit", "ultimate"],
        maxBp: 20000,
        battleState: "attacking",
      },
      duration: { scope: "turn" },
      fireExecutionMode: "optional",
      autoResolveOptional: false,
    });
    expect(delayed.action).toEqual({
      kind: "destroy",
      target: { kind: "trigger_related_instance" },
    });
  });

  it("[board] engine-single-battle-end: OC発揮で進行中のバトルがBP比較/ライフダメージ無しで即終了する", () => {
    const src = createCardInstance(c, {
      instanceId: "goku3-oc",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const opponentAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const oc = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "end_single_battle")
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, opponentAttacker],
        playerOverrides: [{ countValue: 7 }, {}],
        activeAttack: {
          attackId: "attack-opp-1",
          primaryEntityId: "battle-opp-attacker",
          participantEntityIds: ["battle-opp-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [
            {
              participantEntityId: "battle-opp-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-opp-attacker"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "battle-opp-attacker",
            memberInstanceIds: ["opp-attacker"],
            // 通常解決なら BP 比較 + ライフダメージが確実に発生する値だが、
            // end_single_battle はそれらを丸ごとスキップすることを検証する。
            resolvedBp: 9999999,
            resolvedSymbols: ["red", "red", "red"],
            attackState: "attacking",
          },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
    };
    const aliceLifeBefore = aliceLifeCoreCount(before);

    const after = runEffect(before, oc, "goku3-oc");

    expect(after.activeAttack).toBeNull();
    expect(after.battleResolutionGroup).toBeNull();
    expect(after.battlesEndedThisTurn).toBe(1);
    // BP比較/ライフダメージ分岐がスキップされ、ライフは変化していない。
    expect(aliceLifeCoreCount(after)).toBe(aliceLifeBefore);
    expect(
      after.log.some((l) => l.startsWith("battle:end-single-battle:"))
    ).toBe(true);
    // battle_end 誘発以降 (battleEntities reset) は通常のバトル解決と同じ経路を通る:
    // 生存カード (今回は破壊されていない opp-attacker) は attackState:"idle" へ戻る。
    const resetEntity = after.battleEntities.find(
      (e) => e.entityId === "battle-opp-attacker"
    );
    expect(resetEntity?.attackState).toBe("idle");
    const retrigger = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "retrigger"
    );
    expect(retrigger).toMatchObject({
      retriggerEvent: "attack",
      retriggerPlayer: "opponent",
      sourceDefinitionId: "BSDB01-C03",
    });
  });

  it("[board] OC後段 retrigger: 次の相手 BP20000以下アタッカーに任意破壊 choice を開く", () => {
    const src = createCardInstance(c, {
      instanceId: "goku3-oc-retrigger",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const oldAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "old-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const nextAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "next-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const otherAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "other-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const oc = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "end_single_battle")
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, oldAttacker, nextAttacker, otherAttacker],
        playerOverrides: [{ countValue: 7 }, {}],
        activeAttack: {
          attackId: "attack-opp-old",
          primaryEntityId: "battle-old-attacker",
          participantEntityIds: ["battle-old-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [
            {
              participantEntityId: "battle-old-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-old-attacker"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "battle-old-attacker",
            memberInstanceIds: ["old-attacker"],
            resolvedBp: 5000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
    };

    const afterRegister = runEffect(before, oc, "goku3-oc-retrigger");
    const nextAttackState: GameState = {
      ...afterRegister,
      players: afterRegister.players.map((player) =>
        player.id === ALICE ? { ...player, countValue: 0 } : player
      ),
      activeAttack: {
        attackId: "attack-opp-next",
        primaryEntityId: "battle-next-attacker",
        participantEntityIds: ["battle-next-attacker", "battle-other-attacker"],
        groupMode: "simultaneous",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [
          {
            participantEntityId: "battle-next-attacker",
            blockedByEntityIds: [],
          },
          {
            participantEntityId: "battle-other-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: [
          "battle-next-attacker",
          "battle-other-attacker",
        ],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-next-attacker",
          memberInstanceIds: ["next-attacker"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "battle-other-attacker",
          memberInstanceIds: ["other-attacker"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const afterRetrigger = executeMatchingRetriggers({
      state: nextAttackState,
      event: "attack",
      triggerCard: nextAttacker,
      triggerCardDefinition: card("BSDB01-C05"),
      getCardDefinitionById: getDef,
    });

    expect(afterRetrigger.log.some((l) => l.includes("retrigger:fire"))).toBe(
      true
    );
    expect(afterRetrigger.pendingStepOptionalChoice).not.toBeNull();
    expect(
      afterRetrigger.pendingLeaveEntities.some(
        (e) => e.instanceId === "next-attacker" && e.kind === "destroy"
      )
    ).toBe(false);

    const pending = afterRetrigger.pendingStepOptionalChoice!;
    const afterDecline = applyLegalAction({
      state: afterRetrigger,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.choosingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(
      afterDecline.pendingLeaveEntities.some(
        (e) => e.instanceId === "next-attacker" && e.kind === "destroy"
      )
    ).toBe(false);

    const afterRetriggerExecute = executeMatchingRetriggers({
      state: nextAttackState,
      event: "attack",
      triggerCard: nextAttacker,
      triggerCardDefinition: card("BSDB01-C05"),
      getCardDefinitionById: getDef,
    });
    const executePending = afterRetriggerExecute.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: afterRetriggerExecute,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${executePending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: executePending.choosingPlayerId,
        pendingId: executePending.pendingId,
        sourceInstanceId: executePending.sourceInstanceId,
        effectIndex: executePending.effectIndex,
        stepIndex: executePending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(
      afterExecute.cardInstances.find(
        (inst) => inst.instanceId === "next-attacker"
      )?.zone
    ).toBe("trash");
    expect(
      afterExecute.cardInstances.find(
        (inst) => inst.instanceId === "other-attacker"
      )?.zone
    ).toBe("field");
  });

  it("[board] OC後段 retrigger: 相手の途中合流アタックでも任意破壊 choice を開く", () => {
    const src = createCardInstance(c, {
      instanceId: "goku3-oc-join-retrigger",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const oldAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "old-attacker-join",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const primaryAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "primary-attacker-join",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const joinAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "join-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const oc = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "end_single_battle")
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, oldAttacker, primaryAttacker, joinAttacker],
        playerOverrides: [{ countValue: 7 }, {}],
        activeAttack: {
          attackId: "attack-opp-old-join",
          primaryEntityId: "battle-old-attacker-join",
          participantEntityIds: ["battle-old-attacker-join"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [
            {
              participantEntityId: "battle-old-attacker-join",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-old-attacker-join"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "battle-old-attacker-join",
            memberInstanceIds: ["old-attacker-join"],
            resolvedBp: 5000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
    };
    const afterRegister = runEffect(before, oc, "goku3-oc-join-retrigger");
    const joinState: GameState = {
      ...afterRegister,
      activeAttack: {
        attackId: "attack-opp-join",
        primaryEntityId: "battle-primary-attacker-join",
        participantEntityIds: ["battle-primary-attacker-join"],
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [
          {
            participantEntityId: "battle-primary-attacker-join",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-primary-attacker-join"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-primary-attacker-join",
          memberInstanceIds: ["primary-attacker-join"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activePlayerId: BOB,
      step: "attack",
    };

    const joined = joinActiveAttackAsAction({
      state: joinState,
      actingPlayerId: BOB,
      sourceInstanceId: "join-attacker",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(joined.log.some((l) => l.includes("retrigger:fire"))).toBe(true);
    expect(joined.pendingStepOptionalChoice).not.toBeNull();

    const pending = joined.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: joined,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.choosingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(
      afterExecute.cardInstances.find(
        (inst) => inst.instanceId === "join-attacker"
      )?.zone
    ).toBe("trash");
  });

  it("[board] OC後段 retrigger: 同時アタック宣言の追加参加体では発火しない", () => {
    const src = createCardInstance(c, {
      instanceId: "goku3-oc-simultaneous-retrigger",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const oldAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "old-attacker-simultaneous",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const primaryAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "primary-attacker-simultaneous",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const joinedAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "joined-attacker-simultaneous",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const oc = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "end_single_battle")
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, oldAttacker, primaryAttacker, joinedAttacker],
        playerOverrides: [{ countValue: 7 }, {}],
        activeAttack: {
          attackId: "attack-opp-old-simultaneous",
          primaryEntityId: "battle-old-attacker-simultaneous",
          participantEntityIds: ["battle-old-attacker-simultaneous"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [
            {
              participantEntityId: "battle-old-attacker-simultaneous",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-old-attacker-simultaneous"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "battle-old-attacker-simultaneous",
            memberInstanceIds: ["old-attacker-simultaneous"],
            resolvedBp: 5000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
    };
    const afterRegister = runEffect(
      before,
      oc,
      "goku3-oc-simultaneous-retrigger"
    );
    const simultaneousState: GameState = {
      ...afterRegister,
      activeAttack: {
        attackId: "attack-opp-simultaneous",
        primaryEntityId: "battle-primary-attacker-simultaneous",
        participantEntityIds: ["battle-primary-attacker-simultaneous"],
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [
          {
            participantEntityId: "battle-primary-attacker-simultaneous",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-primary-attacker-simultaneous"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-primary-attacker-simultaneous",
          memberInstanceIds: ["primary-attacker-simultaneous"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activePlayerId: BOB,
      step: "attack",
    };

    const joined = joinActiveAttackAsAction({
      state: simultaneousState,
      actingPlayerId: BOB,
      sourceInstanceId: "joined-attacker-simultaneous",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      joinMode: "simultaneous_declaration",
      simultaneousGroupId: "simul-bsdb01-c03",
      attackExhaustCostAlreadyPaid: true,
    }).state;

    expect(joined.log.some((l) => l.includes("retrigger:fire"))).toBe(false);
    expect(joined.pendingStepOptionalChoice).toBeNull();
    expect(
      joined.cardInstances.find(
        (inst) => inst.instanceId === "joined-attacker-simultaneous"
      )?.zone
    ).toBe("field");
  });

  it("[board] OC後段 retrigger: BP20000超の相手アタッカーでは発火しない", () => {
    const highBpDef: CardDefinition = {
      ...card("BSDB01-C05"),
      cardNo: "TEST-HIGH-BP-ATTACKER",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 25000 }],
    };
    const src = createCardInstance(c, {
      instanceId: "goku3-oc-high-bp",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const oldAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "old-attacker-high-bp",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const highAttacker = createCardInstance(highBpDef, {
      instanceId: "high-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const oc = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "end_single_battle")
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, oldAttacker, highAttacker],
        playerOverrides: [{ countValue: 7 }, {}],
        activeAttack: {
          attackId: "attack-opp-old-high-bp",
          primaryEntityId: "battle-old-attacker-high-bp",
          participantEntityIds: ["battle-old-attacker-high-bp"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [
            {
              participantEntityId: "battle-old-attacker-high-bp",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-old-attacker-high-bp"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "battle-old-attacker-high-bp",
            memberInstanceIds: ["old-attacker-high-bp"],
            resolvedBp: 5000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
    };
    const afterRegister = runEffect(before, oc, "goku3-oc-high-bp");
    const nextAttackState: GameState = {
      ...afterRegister,
      activeAttack: {
        attackId: "attack-opp-high-bp",
        primaryEntityId: "battle-high-attacker",
        participantEntityIds: ["battle-high-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [
          {
            participantEntityId: "battle-high-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-high-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-high-attacker",
          memberInstanceIds: ["high-attacker"],
          resolvedBp: 25000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const afterRetrigger = executeMatchingRetriggers({
      state: nextAttackState,
      event: "attack",
      triggerCard: highAttacker,
      triggerCardDefinition: highBpDef,
      getCardDefinitionById: getDef,
    });

    expect(afterRetrigger.log.some((l) => l.includes("retrigger:fire"))).toBe(
      false
    );
    expect(afterRetrigger.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] OC後段 retrigger: 合体ブレイヴ込みBPが20000超なら発火しない", () => {
    const braveDef: CardDefinition = {
      cardNo: "TEST-BSDB01-C03-BP-PLUS-BRAVE",
      name: "テストBP+ブレイヴ",
      printedCategory: "brave",
      colors: ["red"],
      cost: 4,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: ["合体条件：スピリット", "【合体中】BP+16000"],
      keywordTags: [],
      combinedBoost: 16000,
      sourceUrls: [],
      sourceConfidence: "low",
    };
    const src = createCardInstance(c, {
      instanceId: "goku3-oc-combined-bp",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const oldAttacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "old-attacker-combined-bp",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const host = {
      ...createCardInstance(card("BSDB01-C05"), {
        instanceId: "combined-host",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["combined-brave"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "combined-brave",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 0,
      }),
      attachedToInstanceId: "combined-host",
    };
    const getDefWithBrave = (id: string): CardDefinition | undefined =>
      id === braveDef.cardNo ? braveDef : getDef(id);
    const oc = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "end_single_battle")
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, oldAttacker, host, brave],
        playerOverrides: [{ countValue: 7 }, {}],
        activeAttack: {
          attackId: "attack-opp-old-combined-bp",
          primaryEntityId: "battle-old-attacker-combined-bp",
          participantEntityIds: ["battle-old-attacker-combined-bp"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [
            {
              participantEntityId: "battle-old-attacker-combined-bp",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-old-attacker-combined-bp"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "battle-old-attacker-combined-bp",
            memberInstanceIds: ["old-attacker-combined-bp"],
            resolvedBp: 5000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
    };
    const afterRegister = runEffect(before, oc, "goku3-oc-combined-bp");
    const nextAttackState: GameState = {
      ...afterRegister,
      activeAttack: {
        attackId: "attack-opp-combined-bp",
        primaryEntityId: "battle-combined-host",
        participantEntityIds: ["battle-combined-host"],
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [
          {
            participantEntityId: "battle-combined-host",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-combined-host"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-combined-host",
          memberInstanceIds: ["combined-host", "combined-brave"],
          resolvedBp: 21000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const afterRetrigger = executeMatchingRetriggers({
      state: nextAttackState,
      event: "attack",
      triggerCard: host,
      triggerCardDefinition: card("BSDB01-C05"),
      getCardDefinitionById: getDefWithBrave,
    });

    expect(afterRetrigger.log.some((l) => l.includes("retrigger:fire"))).toBe(
      false
    );
    expect(afterRetrigger.pendingStepOptionalChoice).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// C04 超サイヤ人 ベジータ — adventData / カウント+2 / 最小コスト / OC suppress
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C04 超サイヤ人 ベジータ", () => {
  const c = card("BSDB01-C04");

  it("契約煌臨は adventData", () => {
    expect(c.adventData?.adventTiming).toBe("both_attack_step");
  });

  it("最小コストセレクタ破壊が extremal cost/lowest で配線 (stub撤去) / カウント+2 は配線", () => {
    const destroy = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "destroy"
    )!;
    expect(destroy.stub).toBeUndefined();
    const action = destroy.steps[0]!.action;
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.extremal).toEqual({
        metric: "cost",
        mode: "lowest",
      });
      expect(action.target.filter.category).toEqual(["spirit"]);
      expect(action.target.count).toBe(1);
    } else {
      throw new Error("destroy filter target expected");
    }
    const count = c.effects![0]!.steps[1]!;
    expect(count.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
  });

  it("[board] 最もコストの低い相手スピリット 1 体のみ破壊・他は残る", () => {
    const src = createCardInstance(c, {
      instanceId: "vegeta2-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手フィールドにコスト 3 / 4 / 5 のスピリットを並べる。
    const cost3 = createCardInstance(card("BSDB01-C05"), {
      instanceId: "cost3", // クリリン cost3
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cost4 = createCardInstance(card("BSDB01-C01"), {
      instanceId: "cost4", // 孫悟空 cost4
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cost5 = createCardInstance(card("BSDB01-C03"), {
      instanceId: "cost5", // 超サイヤ人 孫悟空 cost5
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const destroy = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "destroy"
    )!;
    const before = createEmptyGameState({
      cardInstances: [src, cost3, cost4, cost5],
    });
    const after = executeAllOptionalSteps(
      runEffect(before, destroy, "vegeta2-1")
    );
    const byId = (id: string) =>
      after.cardInstances.find((x) => x.instanceId === id)!;
    expect(byId("cost3").zone).toBe("trash"); // 最低コスト → 破壊
    expect(byId("cost4").pendingLeaveKind).toBeNull(); // 対象外
    expect(byId("cost5").pendingLeaveKind).toBeNull(); // 対象外
  });

  it("[board] 煌臨/ブロック時カウント+2 が実際に動く", () => {
    const src = createCardInstance(c, {
      instanceId: "vegeta2-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const count = c.effects![0]!;
    const after = executeAllOptionalSteps(
      runEffect(
        createEmptyGameState({ cardInstances: [src] }),
        count,
        "vegeta2-1"
      )
    );
    expect(aliceCount(after)).toBe(2);
  });

  it("BSDB01-C04 OC中＆煌臨中 suppress は self_state.advented + dynamic suppress_effect で配線", () => {
    const oc = c.effects!.find(
      (e) =>
        e.textRef?.includes(7) && e.steps[0]?.action.kind === "suppress_effect"
    )!;
    expect(oc.stub).toBeUndefined();
    expect(oc.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(oc.timingScope).toEqual({ player: "opponent", period: "turn" });
    expect(oc.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 5,
    });
    expect(oc.condition).toContainEqual({
      kind: "self_state",
      state: "advented",
    });
    expect(oc.preventionLevel).toBe("unpreventable");
    const action = oc.steps[0]!.action;
    expect(action.kind).toBe("suppress_effect");
    if (action.kind === "suppress_effect") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: "all",
      });
      expect(action.targetAffectGate).toBe("blocked_by_source_immunity");
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("[board] BSDB01-C04 OC中＆煌臨中 suppress は Lv1-Lv2 未達では登録されない", () => {
    const source = {
      ...createCardInstance(c, {
        instanceId: "bsdb01-c04-lv0",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      }),
      underCards: [
        {
          cardInstanceId: "bsdb01-c04-lv0-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const adventSource = createCardInstance(card("BSDB01-C02"), {
      instanceId: "bsdb01-c04-lv0-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const bobTurn: GameState = {
      ...createEmptyGameState({
        cardInstances: [source, adventSource],
        playerOverrides: [{ countValue: 5 }, {}],
      }),
      activePlayerId: BOB,
      step: "main",
    };
    const rebuilt = rebuildContinuousEffectsFromField(bobTurn, getDef);
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === source.instanceId &&
          ce.modifierTag === "effect_suppression"
      )
    ).toBe(false);
  });

  it("[board] BSDB01-C04 の防げない OC suppress は通常の効果抑止下でも登録・維持される", () => {
    const source = {
      ...createCardInstance(c, {
        instanceId: "bsdb01-c04-unpreventable-suppress",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "bsdb01-c04-unpreventable-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const adventSource = createCardInstance(card("BSDB01-C02"), {
      instanceId: "bsdb01-c04-unpreventable-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const bobSuppressSource = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-plain-suppress-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const plainSuppression: ContinuousEffect = {
      effectId: "plain-suppress-bsdb01-c04",
      sourceInstanceId: bobSuppressSource.instanceId,
      sourceDefinitionId: bobSuppressSource.definitionId,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_suppression",
      targetInstanceId: source.instanceId,
    };
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [source, adventSource, bobSuppressSource],
        playerOverrides: [{ countValue: 5 }, {}],
      }),
      activePlayerId: BOB,
      step: "main",
      activeContinuousEffects: [plainSuppression],
    };

    const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
    const c04Suppression = rebuilt.activeContinuousEffects.find(
      (ce) =>
        ce.sourceInstanceId === source.instanceId &&
        ce.modifierTag === "effect_suppression"
    );
    expect(c04Suppression?.metadata?.preventionLevel).toBe("unpreventable");
    expect(c04Suppression?.metadata?.suppressTargetFilter).toEqual({
      category: ["spirit"],
    });

    const rebuiltAgain = rebuildContinuousEffectsFromField(rebuilt, getDef);
    expect(
      rebuiltAgain.activeContinuousEffects.some(
        (ce) =>
          ce.effectId === c04Suppression?.effectId &&
          ce.sourceInstanceId === source.instanceId &&
          ce.modifierTag === "effect_suppression"
      )
    ).toBe(true);
  });

  it("[board] BSDB01-C04 は相手ターン中、効果を受けない相手スピリットの効果も防げない suppress で発揮させない", () => {
    const oc = c.effects!.find(
      (e) =>
        e.textRef?.includes(7) && e.steps[0]?.action.kind === "suppress_effect"
    )!;
    const source = {
      ...createCardInstance(c, {
        instanceId: "bsdb01-c04-oc",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "bsdb01-c04-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const adventSource = createCardInstance(card("BSDB01-C02"), {
      instanceId: "bsdb01-c04-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const suppressedSpirit = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-suppressed-spirit",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const normalSpirit = createCardInstance(card("BSDB01-C01"), {
      instanceId: "bob-normal-spirit",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const soulStateSpirit = createCardInstance(card("BSDB01-C01"), {
      instanceId: "bob-soul-state-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const adventHost = {
      ...createCardInstance(card("BSDB01-C01"), {
        instanceId: "bob-advent-host",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "bob-advent-source-spirit",
          role: "advent_source" as const,
        },
      ],
    };
    const adventSourceSpirit = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-advent-source-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      cardInstances: [
        source,
        adventSource,
        suppressedSpirit,
        normalSpirit,
        soulStateSpirit,
        adventHost,
        adventSourceSpirit,
      ],
      playerOverrides: [
        { countValue: 5 },
        { soulStateInstanceIds: [soulStateSpirit.instanceId] },
      ],
    });
    const bobTurn: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      activeContinuousEffects: [
        defenseImmuneCE("bob-suppressed-spirit", {
          effectId: "bob-spirit-immune-to-bsdb01-c04",
          sourceInstanceId: "bob-suppressed-spirit",
          sourceDefinitionId: "BSDB01-C05",
          actingPlayerId: BOB,
        }),
        defenseImmuneCE(soulStateSpirit.instanceId, {
          effectId: "bob-soul-state-immune-to-bsdb01-c04",
          sourceInstanceId: soulStateSpirit.instanceId,
          sourceDefinitionId: soulStateSpirit.definitionId,
          actingPlayerId: BOB,
        }),
        defenseImmuneCE(adventSourceSpirit.instanceId, {
          effectId: "bob-advent-source-immune-to-bsdb01-c04",
          sourceInstanceId: adventSourceSpirit.instanceId,
          sourceDefinitionId: adventSourceSpirit.definitionId,
          actingPlayerId: BOB,
        }),
      ],
    };
    const after = runEffect(bobTurn, oc, "bsdb01-c04-oc");
    const suppression = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "effect_suppression"
    );
    expect(suppression?.metadata?.suppressTargetFilter).toEqual({
      category: ["spirit"],
    });
    expect(suppression?.metadata?.targetAffectGate).toBe(
      "blocked_by_source_immunity"
    );
    expect(suppression?.metadata?.preventionLevel).toBe("unpreventable");
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-suppressed-spirit",
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: "BSDB01-C05",
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-suppressed-spirit",
        targetInstanceIds: [],
        sourcePreventionLevel: "unpreventable",
        suppressionEffectDescriptor: {
          sourceDefinitionId: "BSDB01-C05",
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
    const plainSuppressState: GameState = {
      ...after,
      activeContinuousEffects: after.activeContinuousEffects.map((ce) =>
        ce.effectId === suppression?.effectId
          ? {
              ...ce,
              metadata: {
                ...ce.metadata,
                preventionLevel: "none" as const,
              },
            }
          : ce
      ),
    };
    expect(
      executeReevaluationCheck({
        state: plainSuppressState,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-suppressed-spirit",
        targetInstanceIds: [],
        sourcePreventionLevel: "unpreventable",
        suppressionEffectDescriptor: {
          sourceDefinitionId: "BSDB01-C05",
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-normal-spirit",
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: "BSDB01-C01",
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "attack",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: soulStateSpirit.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: soulStateSpirit.definitionId,
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: adventSourceSpirit.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: adventSourceSpirit.definitionId,
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(true);
  });

  it("[board] BSDB01-C04 suppress は provenance 付き immunity CE を自己消去せず対象判定を保つ", () => {
    const oc = c.effects!.find(
      (e) =>
        e.textRef?.includes(7) && e.steps[0]?.action.kind === "suppress_effect"
    )!;
    const immuneSpiritDef: CardDefinition = {
      cardNo: "TEST-BSDB01-C04-IMMUNE-SPIRIT",
      name: "test BSDB01-C04 immune spirit",
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
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { zone: "field" },
          steps: [
            {
              action: {
                kind: "effect_immunity",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    };
    const localDefs = new Map<string, CardDefinition>(
      [...ALL_CARDS, immuneSpiritDef].map((definition) => [
        definition.cardNo,
        definition,
      ])
    );
    const localGetDef = (id: string): CardDefinition | undefined =>
      localDefs.get(id);
    const source = {
      ...createCardInstance(c, {
        instanceId: "bsdb01-c04-oc",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "bsdb01-c04-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const adventSource = createCardInstance(card("BSDB01-C02"), {
      instanceId: "bsdb01-c04-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const immuneSpirit = createCardInstance(immuneSpiritDef, {
      instanceId: "bob-provenance-immune-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [source, adventSource, immuneSpirit],
      playerOverrides: [{ countValue: 5 }, {}],
    });
    const bobTurn: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
    };
    const withImmunity = rebuildContinuousEffectsFromField(
      bobTurn,
      localGetDef
    );
    expect(
      withImmunity.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.sourceInstanceId === immuneSpirit.instanceId &&
          ce.provenance?.effectIndex === 0
      )
    ).toBe(true);

    const withSuppression = executeEffect({
      chainId: "test:bsdb01-cards:2972",
      state: withImmunity,
      effect: oc,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: localGetDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      withSuppression,
      localGetDef
    );
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.sourceInstanceId === immuneSpirit.instanceId &&
          ce.provenance?.effectIndex === 0
      )
    ).toBe(true);
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.metadata?.targetAffectGate === "blocked_by_source_immunity"
      )
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state: rebuilt,
        checkKind: "effect_suppression",
        sourceInstanceId: immuneSpirit.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: immuneSpiritDef.cardNo,
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById: localGetDef,
      })
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// C05 クリリン — 既に完全配線（召喚時カウント+1→デッキ3オープン / 常時シンボル青）
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C05 クリリン", () => {
  const c = card("BSDB01-C05");

  it("印字軽減は赤・青各1で、出典情報を維持する", () => {
    expect(
      rawCards.find((definition) => definition.cardNumber === c.cardNo)
        ?.reduction
    ).toEqual(["赤", "青"]);
    expect(
      rawPackCards.find((definition) => definition.cardNumber === c.cardNo)
        ?.reduction
    ).toEqual(["赤", "青"]);
    expect(c.reductionSymbols).toEqual(["red", "blue"]);
    expect(c.sourceConfidence).toBe("C");
    expect(c.sourceUrls).toEqual([]);
  });

  it.each([
    { symbols: ["blue"], reduction: 1, payment: 2 },
    { symbols: ["red", "blue"], reduction: 2, payment: 1 },
  ] satisfies {
    symbols: SymbolColor[];
    reduction: number;
    payment: number;
  }[])(
    "[board] 軽減供給 $symbols で軽減$reduction・支払い$payment",
    ({ symbols, reduction, payment }) => {
      // 供給側は効果のない単色シンボル各1個。要求側は実カード定義をそのまま使う。
      const sources: CardDefinition[] = symbols.map((symbol, index) => ({
        ...c,
        cardNo: `TEST-KRILLIN-SYMBOL-${index}`,
        effects: [],
        symbolColors: [symbol],
      }));
      const state = createEmptyGameState({
        cardInstances: sources.map((definition, index) =>
          createCardInstance(definition, {
            instanceId: `krillin-reduction-source-${index}`,
            ownerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      });
      const result = calculateReduction({
        state,
        actingPlayerId: ALICE,
        card: c,
        getCardDefinitionById: (id) =>
          sources.find((definition) => definition.cardNo === id) ?? getDef(id),
      });

      expect(result.totalReduction).toBe(reduction);
      expect(result.reducedCost).toBe(payment);
      expect(result.finalCost).toBe(payment);
    }
  );

  it("召喚時カウント+1→デッキ3オープン(サイヤ人or赤ネクサス) / 常時シンボル青、stub なし", () => {
    expect(c.effects!.every((e) => e.stub === undefined)).toBe(true);
    const summon = c.effects![0]!;
    expect(summon.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(summon.steps[1]!.action.kind).toBe("deck_reveal");
    expect(c.effects![1]!.steps[0]!.action).toEqual({
      kind: "treat_as",
      aspects: ["symbol"],
      asColor: "blue",
    });
  });

  it("[board] 召喚時効果でカウント +1", () => {
    const src = createCardInstance(c, {
      instanceId: "krillin-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src] }),
      c.effects![0]!,
      "krillin-1"
    );
    expect(aliceCount(after)).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// C06 カメハウス — treat_as / 名指し軽減充足召喚 / 手札耐性
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C06 カメハウス", () => {
  const c = card("BSDB01-C06");

  it("シンボル/軽減青 treat_as / 配置時の契約孫悟空召喚 / 手札耐性(zone免疫)を配線", () => {
    expect(c.effects![0]!.steps[0]!.action).toEqual({
      kind: "treat_as",
      appliesToCard: true,
      aspects: ["symbol", "reduction_symbol"],
      asColor: "blue",
    });
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    expect(place.stub).toBeUndefined();
    expect(place.steps).toHaveLength(3);
    const summon = place.steps[0]!.action;
    expect(summon.kind).toBe("summon");
    if (summon.kind === "summon" && summon.target.kind === "from_zone") {
      expect(summon.target.zone).toBe("hand");
      expect(summon.target.filter).toMatchObject({
        category: ["spirit"],
        cardName: { contains: "孫悟空" },
        requiredKeywordTags: ["contract"],
      });
      expect(summon.costModifier).toBe("full_reduction");
    }
    expect(place.steps[1]!.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "孫悟空" }],
      includeSoulState: true,
    });
    expect(place.steps[1]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(place.steps[2]!.action).toEqual({ kind: "draw", count: 1 });
    expect(place.steps[2]!.choice?.[0]?.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "孫悟空" }],
      includeSoulState: true,
    });
    expect(place.steps[2]!.choice?.[0]?.action).toEqual({
      kind: "search_zone",
      zone: "trash",
      player: "self",
      filter: { cardName: { contains: "かめはめ波" } },
      count: 1,
      mandatory: true,
      destination: "hand",
    });

    const lv2 = c.effects![2]!;
    expect(lv2.stub).toBeUndefined();
    expect(lv2.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "hand_count", player: "self", max: 7 },
    ]);
    const action = lv2.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand"],
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("Lv2 + 手札7枚以下: 自分の手札は相手起因効果に免疫成立", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 7 }, {}],
    });
    const self = createCardInstance(c, {
      instanceId: "kamehouse-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2 (requiredCores:2)
    });
    const handCard = createCardInstance(c, {
      instanceId: "alice-hand-1",
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
      chainId: "test:bsdb01-cards:3158",
      state,
      effect: lv2,
      sourceInstanceId: "kamehouse-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const hand = next.cardInstances.find(
      (ci) => ci.instanceId === "alice-hand-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(next, hand, "bob", "none", undefined, getDef)
    ).toBe(true);
  });

  it("[board] BSDB01-C06 配置時: 契約孫悟空を軽減全充足召喚し、カウント+1後に1ドロー", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    const source = createCardInstance(c, {
      instanceId: "kamehouse-place",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const contractGoku = createCardInstance(card("BSDB01-CX01"), {
      instanceId: "contract-goku-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [source, contractGoku],
      playerOverrides: [
        { handCount: 1, deckCount: 1, reserveNormalCoreCount: 1 },
        {},
      ],
    });

    const afterPending = executeEffect({
      chainId: "test:bsdb01-cards:3199",
      state: before,
      effect: place,
      effectIndex: 1,
      sourceInstanceId: "kamehouse-place",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 0,
    });
    const after = executeAllOptionalSteps(afterPending);

    const summoned = after.cardInstances.find(
      (ci) => ci.instanceId === "contract-goku-hand"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");
    expect(summoned.normalCoreCount).toBe(1);
    expect(aliceCount(after)).toBe(1);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(0);
    expect(after.log).toContain("effect:draw:player-1:1");
  });

  it("[board] BSDB01-C06 配置時: 契約煌臨だけの孫悟空は契約スピリットカード召喚候補にしない", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    const source = createCardInstance(c, {
      instanceId: "kamehouse-place-advent-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const adventOnlyGoku = createCardInstance(card("BSDB01-C03"), {
      instanceId: "advent-only-goku-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [source, adventOnlyGoku],
      playerOverrides: [
        { handCount: 1, deckCount: 1, reserveNormalCoreCount: 1 },
        {},
      ],
    });

    const afterPending = executeEffect({
      chainId: "test:bsdb01-cards:3251",
      state: before,
      effect: place,
      effectIndex: 1,
      sourceInstanceId: "kamehouse-place-advent-only",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 0,
    });
    expect(afterPending.pendingStepOptionalChoice).not.toBeNull();
    expect(afterPending.pendingStepOptionalChoice!.canExecute).toBe(false);
    const after = executeAllOptionalSteps(
      declineNextOptionalStep(afterPending)
    );

    expect(
      after.cardInstances.find(
        (ci) => ci.instanceId === "advent-only-goku-hand"
      )?.zone
    ).toBe("hand");
    expect(aliceCount(after)).toBe(0);
    expect(after.log).not.toContain("effect:draw:player-1:1");
  });

  it("[board] BSDB01-C06 配置時: 維持コアを置けないなら契約孫悟空召喚は実行不可", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    const source = createCardInstance(c, {
      instanceId: "kamehouse-place-no-core",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const contractGoku = createCardInstance(card("BSDB01-CX01"), {
      instanceId: "contract-goku-no-core",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [source, contractGoku],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 0 }, {}],
    });

    const afterPending = executeEffect({
      chainId: "test:bsdb01-cards:3299",
      state: before,
      effect: place,
      effectIndex: 1,
      sourceInstanceId: "kamehouse-place-no-core",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 0,
    });
    expect(afterPending.pendingStepOptionalChoice).not.toBeNull();
    expect(afterPending.pendingStepOptionalChoice!.canExecute).toBe(false);
    const after = executeAllOptionalSteps(
      declineNextOptionalStep(afterPending)
    );

    expect(
      after.cardInstances.find(
        (ci) => ci.instanceId === "contract-goku-no-core"
      )?.zone
    ).toBe("hand");
    expect(aliceCount(after)).toBe(0);
  });

  it("[board] BSDB01-C06 配置時 choiceIndex 1: 1ドローの代わりに「かめはめ波」を回収", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    const source = createCardInstance(c, {
      instanceId: "kamehouse-place-recover",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const contractGoku = createCardInstance(card("BSDB01-CX01"), {
      instanceId: "contract-goku-hand-recover",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const kamehameha = createCardInstance(card("BSDB01-C09"), {
      instanceId: "kamehameha-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const before = createEmptyGameState({
      cardInstances: [source, contractGoku, kamehameha],
      playerOverrides: [
        { handCount: 1, deckCount: 1, reserveNormalCoreCount: 1 },
        {},
      ],
    });

    const afterPending = executeEffect({
      chainId: "test:bsdb01-cards:3355",
      state: before,
      effect: place,
      effectIndex: 1,
      sourceInstanceId: "kamehouse-place-recover",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 1,
    });
    const after = executeAllOptionalSteps(afterPending);

    expect(aliceCount(after)).toBe(1);
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "kamehameha-trash")
        ?.zone
    ).toBe("hand");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(1);
    expect(after.log).not.toContain("effect:draw:player-1:1");
  });

  it("[board] BSDB01-C06 配置時 choiceIndex 1: 回収対象が無ければ「かめはめ波」回収は実行不可", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    const source = createCardInstance(c, {
      instanceId: "kamehouse-place-recover-missing",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const contractGoku = createCardInstance(card("BSDB01-CX01"), {
      instanceId: "contract-goku-hand-recover-missing",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [source, contractGoku],
      playerOverrides: [
        { handCount: 1, deckCount: 1, reserveNormalCoreCount: 1 },
        {},
      ],
    });

    const afterSummonPending = executeEffect({
      chainId: "test:bsdb01-cards:3404",
      state: before,
      effect: place,
      effectIndex: 1,
      sourceInstanceId: "kamehouse-place-recover-missing",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 1,
    });
    const afterSummon = resolvePendingMinimumPlacements(
      executeNextOptionalStep(afterSummonPending)
    );
    const afterCount = executeNextOptionalStep(afterSummon);
    expect(afterCount.pendingStepOptionalChoice).not.toBeNull();
    expect(afterCount.pendingStepOptionalChoice!.canExecute).toBe(false);
    const after = declineNextOptionalStep(afterCount);

    expect(aliceCount(after)).toBe(1);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(0);
    expect(alice.deckCount).toBe(1);
    expect(after.log).not.toContain("effect:draw:player-1:1");
  });

  it("[board] BSDB01-C06 配置時 choiceIndex 1: 孫悟空不在なら「かめはめ波」を回収しない", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    const source = createCardInstance(c, {
      instanceId: "kamehouse-place-no-goku",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const kamehameha = createCardInstance(card("BSDB01-C09"), {
      instanceId: "kamehameha-trash-no-goku",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const before = createEmptyGameState({
      cardInstances: [source, kamehameha],
      playerOverrides: [{ deckCount: 1, reserveNormalCoreCount: 1 }, {}],
    });

    const afterPending = executeEffect({
      chainId: "test:bsdb01-cards:3452",
      state: before,
      effect: place,
      effectIndex: 1,
      sourceInstanceId: "kamehouse-place-no-goku",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 1,
    });
    expect(afterPending.pendingStepOptionalChoice).not.toBeNull();
    expect(afterPending.pendingStepOptionalChoice!.canExecute).toBe(false);
    const after = executeAllOptionalSteps(
      declineNextOptionalStep(afterPending)
    );

    expect(aliceCount(after)).toBe(0);
    expect(
      after.cardInstances.find(
        (ci) => ci.instanceId === "kamehameha-trash-no-goku"
      )?.zone
    ).toBe("trash");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.deckCount).toBe(1);
    expect(after.log).not.toContain("effect:draw:player-1:1");
  });
});

// ════════════════════════════════════════════════════════════════
// C07 カプセルコーポレーション — 契約煌臨誘発ドロー / サイヤ人アタック中バースト抑止を配線
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C07 カプセルコーポレーション", () => {
  const c = card("BSDB01-C07");

  it("treat_as 赤 / 契約煌臨誘発ドロー(game_event:advent)を count_value で2分岐配線", () => {
    // treat_as 赤は stub なしで配線。
    const treat = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();

    // 孫悟空/ベジータの advent を観測する game_event 効果が2つ（カウント4以下/5以上）。
    const adventTriggers = c.effects!.filter(
      (e) =>
        e.timing.kind === "game_event" &&
        (e.timing as { event: unknown }).event === "advent"
    );
    expect(adventTriggers).toHaveLength(2);
    for (const t of adventTriggers) {
      const tf = (t.timing as { triggerFilter?: { cardName?: unknown } })
        .triggerFilter;
      expect(tf?.cardName).toEqual([
        { contains: "孫悟空" },
        { contains: "ベジータ" },
      ]);
      // errata 2026-04-27: 〔重複不可〕→〔ターンに1回：同名〕。limitGroupId は per_card_name 共有ラベルとして維持。
      expect(t.limitGroupId).toBe("BSDB01-C07-advent-draw");
      expect(t.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
        maxCount: 1,
      });
      expect(t.steps[1]!.action).toEqual({
        kind: "discard",
        player: "self",
        count: 1,
      });
    }
    // カウント5以上の枝は2ドロー。
    const hi = adventTriggers.find((t) =>
      t.condition?.some(
        (cl) => cl.kind === "count_value" && (cl as { min?: number }).min === 5
      )
    )!;
    expect(hi.steps[0]!.action).toEqual({ kind: "draw", count: 2 });
    const lo = adventTriggers.find((t) =>
      t.condition?.some(
        (cl) => cl.kind === "count_value" && (cl as { max?: number }).max === 4
      )
    )!;
    expect(lo.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
  });

  it("オープン入替は swap disposition で実装 / バースト抑止は opponent_burst negate", () => {
    // [0] 地球人/サイヤ人効果でオープンされたら手札1枚と入れ替え（swap 型 disposition）。
    const swap = c.effects!.find(
      (e) => e.cardEventDisposition?.kind === "swap"
    )!;
    expect(swap).toBeDefined();
    expect(swap.stub).toBeUndefined();
    expect(swap.condition).toContainEqual({
      kind: "trigger_tribes",
      tribes: ["地球人", "サイヤ人"],
    });
    const burstLock = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "negate"
    )!;
    expect(burstLock.stub).toBeUndefined();
    expect(burstLock.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      category: ["spirit"],
      tribes: ["サイヤ人"],
      battleState: "attacking",
    });
    expect(burstLock.steps[0]!.action).toEqual({
      kind: "negate",
      negateTarget: "opponent_burst",
      burstSuppressKind: "cannot_activate",
      duration: { scope: "while_on_field" },
    });
  });

  it("[board] サイヤ人スピリットがアタック中だけ相手バースト効果を抑止する", () => {
    const source = createCardInstance(c, {
      instanceId: "capsule-corp",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const saiyanAttacker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "saiyan-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nonSaiyanAttacker = createCardInstance(card("BSDB01-C06"), {
      instanceId: "earthling-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobBurst = createCardInstance(card("BSDB01-R04"), {
      instanceId: "bob-burst",
      ownerPlayerId: BOB,
      zone: "burst",
    });
    const burstLock = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "negate"
    )!;
    const base = createEmptyGameState({
      cardInstances: [source, saiyanAttacker, nonSaiyanAttacker, bobBurst],
    });
    const withAttacker = (
      instanceId: string,
      resolvedBp: number
    ): GameState => ({
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      battleEntities: [
        {
          entityId: `battle-${instanceId}`,
          memberInstanceIds: [instanceId],
          resolvedBp,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    });

    const saiyanState = runEffect(
      withAttacker("saiyan-attacker", 4000),
      burstLock,
      "capsule-corp"
    );
    expect(
      isBurstEffectNullifiedByOpponent(saiyanState, "bob-burst", BOB)
    ).toBe(true);

    const nonSaiyanState = runEffect(
      withAttacker("earthling-attacker", 0),
      burstLock,
      "capsule-corp"
    );
    expect(
      isBurstEffectNullifiedByOpponent(nonSaiyanState, "bob-burst", BOB)
    ).toBe(false);
  });

  it("[board] サイヤ人スピリットのアタック終了後にバースト抑止CEを失効させる", () => {
    const source = createCardInstance(c, {
      instanceId: "capsule-corp",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const saiyanAttacker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "saiyan-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobBurst = createCardInstance(card("BSDB01-R04"), {
      instanceId: "bob-burst",
      ownerPlayerId: BOB,
      zone: "burst",
    });
    const burstLock = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "negate"
    )!;
    const attackingState = runEffect(
      {
        ...createEmptyGameState({
          cardInstances: [source, saiyanAttacker, bobBurst],
        }),
        activePlayerId: ALICE,
        step: "attack",
        activeAttack: {
          attackId: "attack-saiyan-1",
          primaryEntityId: "battle-saiyan-attacker",
          participantEntityIds: ["battle-saiyan-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [
            {
              participantEntityId: "battle-saiyan-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-saiyan-attacker"],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "battle-saiyan-attacker",
            memberInstanceIds: ["saiyan-attacker"],
            resolvedBp: 4000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
      },
      burstLock,
      "capsule-corp"
    );
    expect(
      isBurstEffectNullifiedByOpponent(attackingState, "bob-burst", BOB)
    ).toBe(true);

    const resolved = executeBattleResolution({
      state: attackingState,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    }).state;

    expect(isBurstEffectNullifiedByOpponent(resolved, "bob-burst", BOB)).toBe(
      false
    );
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "capsule-corp" &&
          ce.modifierTag === "cannot_activate_opponent_burst"
      )
    ).toBe(false);
  });

  it("[board] field_has category は実効スピリット状態のサイヤ人ブレイヴを数える", () => {
    const source = createCardInstance(c, {
      instanceId: "capsule-corp",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const saiyanBraveDef: CardDefinition = {
      cardNo: "TEST-SAIYAN-BRAVE",
      name: "テストサイヤ人ブレイヴ",
      printedCategory: "brave",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["スピリット状態のブレイヴ"],
      keywordTags: [],
      tribe: "サイヤ人",
      sourceUrls: [],
      sourceConfidence: "low",
    };
    const saiyanBrave = createCardInstance(saiyanBraveDef, {
      instanceId: "saiyan-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobBurst = createCardInstance(card("BSDB01-R04"), {
      instanceId: "bob-burst",
      ownerPlayerId: BOB,
      zone: "burst",
    });
    const getDefWithBrave = (id: string): CardDefinition | undefined =>
      id === saiyanBraveDef.cardNo ? saiyanBraveDef : getDef(id);
    const burstLock = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "negate"
    )!;
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [source, saiyanBrave, bobBurst],
      }),
      activePlayerId: ALICE,
      step: "attack",
      activeContinuousEffects: [
        {
          effectId: "ce-act-as-spirit-saiyan-brave",
          sourceInstanceId: "saiyan-brave",
          sourceDefinitionId: saiyanBraveDef.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "act_as_spirit",
          targetInstanceId: "saiyan-brave",
          metadata: {},
        },
      ],
      battleEntities: [
        {
          entityId: "battle-saiyan-brave",
          memberInstanceIds: ["saiyan-brave"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:bsdb01-cards:3783",
      state: before,
      effect: burstLock,
      sourceInstanceId: "capsule-corp",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBrave,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(isBurstEffectNullifiedByOpponent(after, "bob-burst", BOB)).toBe(
      true
    );
  });

  it("[legal action] サイヤ人アタック確定直後にCEを再評価し相手attack_afterバーストを抑止する", () => {
    const source = createCardInstance(c, {
      instanceId: "capsule-corp",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const saiyanAttacker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "saiyan-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const bobBurst = createCardInstance(card("BSTH003-X02"), {
      instanceId: "bob-attack-after-burst",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "burst",
    });
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, saiyanAttacker, bobBurst],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      setBurstStates: [
        { playerId: BOB, cardInstanceId: "bob-attack-after-burst" },
      ],
    };

    const attack = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    }).find(
      (action) =>
        action.kind === "attack" &&
        action.sourceInstanceId === "saiyan-attacker"
    );
    expect(attack).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: attack!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    }).state;

    const pass = getLegalActions({
      state: current,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "pass_pre_declaration_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    }).state;

    expect(
      current.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "capsule-corp" &&
          ce.modifierTag === "negate_opponent_burst"
      )
    ).toBe(true);
    expect(
      isBurstEffectNullifiedByOpponent(current, "bob-attack-after-burst", BOB)
    ).toBe(true);

    const bobActions = getLegalActions({
      state: current,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    });
    const bobBurstAction = bobActions.find(
      (action) =>
        action.kind === "resolve_pending_burst_check" &&
        action.sourceInstanceId === "bob-attack-after-burst"
    );
    expect(bobBurstAction).toBeDefined();

    current = applyLegalAction({
      state: current,
      action: bobBurstAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    }).state;

    while (current.window === "stack" && current.stackWindow !== null) {
      const actingPlayerId = current.stackWindow.priorityPlayerId;
      const passStack = getLegalActions({
        state: current,
        actingPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: noTriggerLookup,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredBurstActions,
      }).find((action) => action.kind === "pass_stack") ?? {
        kind: "pass_stack" as const,
        actionId: `pass:${actingPlayerId}`,
        can: true as const,
        reason: "test_close",
        actingPlayerId,
      };
      current = applyLegalAction({
        state: current,
        action: passStack,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredBurstActions,
      }).state;
    }

    expect(current.pendingEffectTargetSelection).toBeNull();
    expect(
      current.log.some(
        (entry) =>
          entry.startsWith("burst:effect-suppressed:") &&
          entry.includes("bob-attack-after-burst")
      )
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// C08 界王神界 — 配置時 field_has ゲート + カウント+2 + ドロー破棄 / Lv2 トラッシュコア配置
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C08 界王神界", () => {
  const c = card("BSDB01-C08");

  it("配置時: field_has(孫悟空＆ベジータ) ゲート + カウント+2 + 2ドロー→1破棄 を配線", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    expect(place.stub).toBeUndefined();
    expect(place.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ exact: "孫悟空＆ベジータ" }],
      includeSoulState: true,
      includeAdventSource: true,
    });
    expect(place.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 2,
    });
    expect(place.steps[1]!.action).toEqual({ kind: "draw", count: 2 });
    expect(place.steps[2]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: 1,
    });
  });

  it("[board] 孫悟空＆ベジータが場にいるとカウント+2、いないと発揮されない", () => {
    const place = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "place"
    )!;
    const nexus = createCardInstance(c, {
      instanceId: "kaio-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });

    // (a) ゲート不成立: 契約スピリット不在 → カウント据え置き。
    const without = runEffect(
      createEmptyGameState({ cardInstances: [nexus] }),
      place,
      "kaio-1"
    );
    expect(aliceCount(without)).toBe(0);

    // (b) ゲート成立: 孫悟空＆ベジータ(CX01) が場にいる → カウント+2。
    const contract = createCardInstance(card("BSDB01-CX01"), {
      instanceId: "gv-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus2 = createCardInstance(c, {
      instanceId: "kaio-2",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const withContract = runEffect(
      createEmptyGameState({ cardInstances: [nexus2, contract] }),
      place,
      "kaio-2"
    );
    expect(aliceCount(executeAllOptionalSteps(withContract))).toBe(2);
  });

  it("Lv2 メイン終了時: トラッシュコア4個まで配置し、1個以上なら後段CEを登録する", () => {
    const lv2 = c.effects!.find(
      (e) => e.timing.kind === "phase" && e.timing.subPhase === "end"
    )!;
    expect(lv2.stub).toBeUndefined();
    expect(lv2.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(lv2.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(lv2.steps).toHaveLength(4);
    const distribute = lv2.steps[0]!.action;
    expect(distribute.kind).toBe("core_distribute");
    if (distribute.kind !== "core_distribute")
      throw new Error("expected core_distribute");
    expect(distribute.from).toEqual({ kind: "trash", player: "self" });
    expect(distribute.amount).toBe(4);
    expect(distribute.effectKind).toBe("normal_only");
    expect(distribute.mode).toBe("player_choice");
    expect(distribute.minTotal).toBeUndefined();
    expect(distribute.to.kind).toBe("filter");
    if (distribute.to.kind === "filter") {
      expect(distribute.to.filter.filterOr).toEqual([
        { category: ["nexus"], colors: ["red"] },
        { category: ["nexus"], colors: ["blue"] },
        { cardName: [{ contains: "孫悟空" }] },
        { cardName: [{ contains: "ベジータ" }] },
      ]);
    }
    expect(lv2.steps[1]!.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "place-trash-cores",
      result: "numeric_amount",
      min: 1,
    });
    expect(lv2.steps[1]!.action).toMatchObject({
      kind: "effect_immunity",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {},
        count: "all",
        zone: "trash",
      },
      sourcePlayerScope: "self",
      duration: { scope: "turn" },
    });
    expect(lv2.steps[2]!.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "place-trash-cores",
      result: "numeric_amount",
      min: 1,
    });
    expect(lv2.steps[2]!.action).toMatchObject({
      kind: "suppress_effect",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {},
        count: "all",
        zone: "trash",
      },
      duration: { scope: "turn" },
    });
    expect(lv2.steps[3]!.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "place-trash-cores",
      result: "numeric_amount",
      min: 1,
    });
    expect(lv2.steps[3]!.action).toMatchObject({
      kind: "restrict_use",
      player: "opponent",
      filter: { zone: ["trash"] },
      targetScope: "card",
      duration: { scope: "turn" },
    });
  });

  it("[board] BSDB01-C08 Lv2: 0個配置なら後段CEなし、1個以上配置なら相手トラッシュカードを保護/使用制限", () => {
    const lv2 = c.effects!.find(
      (e) => e.timing.kind === "phase" && e.timing.subPhase === "end"
    )!;
    const source = createCardInstance(c, {
      instanceId: "kaio-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobTrashMagic = createCardInstance(card("BSDB01-C09"), {
      instanceId: "bob-trash-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const aliceTrashMagic = createCardInstance(card("BSDB01-C09"), {
      instanceId: "alice-trash-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const bobHandMagic = createCardInstance(card("BSDB01-C09"), {
      instanceId: "bob-hand-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const bobTrashMirage = createCardInstance(card("BSDB01-R04"), {
      instanceId: "bob-trash-mirage",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const before = createEmptyGameState({
      cardInstances: [
        source,
        bobTrashMagic,
        aliceTrashMagic,
        bobHandMagic,
        bobTrashMirage,
      ],
      playerOverrides: [
        { trashNormalCoreCount: 4 },
        { reserveNormalCoreCount: 3, trashNormalCoreCount: 0 },
      ],
    });
    const pending = runEffect(before, lv2, "kaio-lv2");
    expect(pending.pendingCoreDistribution).not.toBeNull();
    expect(pending.pendingCoreDistribution?.fromKind).toBe("trash");
    expect(pending.pendingCoreDistribution?.minTotal).toBeUndefined();
    expect(pending.pendingCoreDistribution?.candidates).toEqual([
      { instanceId: "kaio-lv2", definitionId: "BSDB01-C08" },
    ]);

    const zeroAction = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(zeroAction).toBeDefined();
    const zeroResolved = applyLegalAction({
      state: pending,
      action: zeroAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      coreDistributionAllocations: {},
    }).state;
    expect(zeroResolved.pendingCoreDistribution).toBeNull();
    expect(
      zeroResolved.cardInstances.find((ci) => ci.instanceId === "kaio-lv2")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      zeroResolved.players.find((p) => p.id === ALICE)?.trashNormalCoreCount
    ).toBe(4);
    expect(
      zeroResolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" ||
          ce.modifierTag === "effect_suppression" ||
          ce.modifierTag === "restrict_use"
      )
    ).toBe(false);

    const soulOnlyBefore = {
      ...before,
      players: before.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              trashNormalCoreCount: 0,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
    };
    const soulOnly = runEffect(soulOnlyBefore, lv2, "kaio-lv2");
    expect(soulOnly.pendingCoreDistribution).toBeNull();
    expect(
      soulOnly.players.find((p) => p.id === ALICE)?.soulCoreLocation
    ).toEqual({ kind: "trash" });
    expect(
      soulOnly.cardInstances.find((ci) => ci.instanceId === "kaio-lv2")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      soulOnly.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" ||
          ce.modifierTag === "effect_suppression" ||
          ce.modifierTag === "restrict_use"
      )
    ).toBe(false);

    const pendingAgain = runEffect(before, lv2, "kaio-lv2");
    const placeAction = getLegalActions({
      state: pendingAgain,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(placeAction).toBeDefined();
    const placed = applyLegalAction({
      state: pendingAgain,
      action: placeAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      coreDistributionAllocations: { "kaio-lv2": 2 },
    }).state;

    expect(placed.pendingCoreDistribution).toBeNull();
    expect(
      placed.cardInstances.find((ci) => ci.instanceId === "kaio-lv2")
        ?.normalCoreCount
    ).toBe(3);
    expect(
      placed.players.find((p) => p.id === ALICE)?.trashNormalCoreCount
    ).toBe(2);
    const immunity = placed.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immunity?.targetInstanceId).toBeUndefined();
    expect(immunity?.targetFilter).toEqual({
      player: "opponent",
      zone: ["trash"],
    });
    expect(immunity?.duration).toEqual({ scope: "turn" });
    const suppression = placed.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "effect_suppression"
    );
    expect(suppression?.targetInstanceId).toBeUndefined();
    expect(suppression?.metadata?.suppressTargetPlayer).toBe("opponent");
    expect(suppression?.metadata?.suppressTargetFilter).toEqual({});
    expect(suppression?.metadata?.suppressTargetZone).toEqual(["trash"]);
    expect(suppression?.duration).toEqual({ scope: "turn" });
    const restrictUse = placed.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictUse?.targetInstanceId).toBeUndefined();
    expect(restrictUse?.targetFilter).toEqual({
      player: "opponent",
      zone: ["trash"],
    });
    expect(restrictUse?.metadata?.targetScope).toBe("card");
    const bobTrashAfter = placed.cardInstances.find(
      (ci) => ci.instanceId === "bob-trash-magic"
    )!;
    const aliceTrashAfter = placed.cardInstances.find(
      (ci) => ci.instanceId === "alice-trash-magic"
    )!;
    const bobHandAfter = placed.cardInstances.find(
      (ci) => ci.instanceId === "bob-hand-magic"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        placed,
        bobTrashAfter,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        placed,
        bobTrashAfter,
        ALICE,
        "none",
        undefined,
        getDef
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(
        placed,
        bobHandAfter,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(false);
    expect(
      isCardUseRestricted(
        placed,
        BOB,
        bobTrashAfter,
        card("BSDB01-C09"),
        getDef,
        "magic"
      )
    ).toBe(true);
    const immuneTrashUseState: GameState = {
      ...placed,
      activeContinuousEffects: [
        ...placed.activeContinuousEffects,
        defenseImmuneCE("bob-trash-magic"),
      ],
    };
    expect(
      isCardUseRestricted(
        immuneTrashUseState,
        BOB,
        bobTrashAfter,
        card("BSDB01-C09"),
        getDef,
        "magic"
      )
    ).toBe(false);
    expect(
      isCardUseRestricted(
        placed,
        BOB,
        placed.cardInstances.find(
          (ci) => ci.instanceId === "bob-trash-mirage"
        )!,
        card("BSDB01-R04"),
        getDef,
        "set_mirage"
      )
    ).toBe(true);
    expect(
      isCardUseRestricted(
        placed,
        ALICE,
        aliceTrashAfter,
        card("BSDB01-C09"),
        getDef,
        "magic"
      )
    ).toBe(false);
    expect(
      executeReevaluationCheck({
        state: placed,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-trash-magic",
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: "BSDB01-C09",
          sourceKind: "magic",
          effectIndex: 0,
          timingKind: "card_event",
          eventAction: "moved_to_trash",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
    const globalTrashImmunityState: GameState = {
      ...placed,
      activeContinuousEffects: [
        ...placed.activeContinuousEffects,
        {
          effectId: "bob-global-trash-immune",
          sourceInstanceId: "bob-trash-guardian",
          sourceDefinitionId: "BSDB01-C09",
          actingPlayerId: BOB,
          duration: { scope: "turn" },
          createdAtTurn: placed.turnNumber,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetFilter: { player: "self", zone: ["trash"] },
        },
      ],
    };
    expect(
      executeReevaluationCheck({
        state: globalTrashImmunityState,
        checkKind: "effect_suppression",
        sourceInstanceId: "bob-trash-magic",
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: "BSDB01-C09",
          sourceKind: "magic",
          effectIndex: 0,
          timingKind: "card_event",
          eventAction: "moved_to_trash",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state: placed,
        checkKind: "effect_suppression",
        sourceInstanceId: "alice-trash-magic",
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceDefinitionId: "BSDB01-C09",
          sourceKind: "magic",
          effectIndex: 0,
          timingKind: "card_event",
          eventAction: "moved_to_trash",
        },
        getCardDefinitionById: getDef,
      })
    ).toBe(true);
    const bobMain = { ...placed, activePlayerId: BOB, step: "main" as const };
    const bobSetMirageActions = getLegalActions({
      state: bobMain,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).filter((a) => a.kind === "set_mirage");
    expect(
      bobSetMirageActions.some((a) => a.sourceInstanceId === "bob-trash-mirage")
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// C09 かめはめ波 / C10 仙豆
// ════════════════════════════════════════════════════════════════

describe("BSDB01-C09 かめはめ波", () => {
  const c = card("BSDB01-C09");
  it("トラッシュ起動許可(コスト2上書き+使用後除外) / BP比較破壊 / 行動制限スタックいずれも実装済み・stub 無し (bsdb01-c09-trash-stack-use.test.ts 参照)", () => {
    expect(c.effects).toHaveLength(4);
    const stillStub = c.effects!.filter((e) => e.stub !== undefined);
    expect(stillStub).toHaveLength(0);
  });

  it("[2,3] フラッシュ: 「孫悟空」comparer + 相手1体 bp_compare_destroy / choice でマジック破棄", () => {
    const flash = c.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    expect(flash.stub).toBeUndefined();
    expect(flash.steps).toHaveLength(1);
    const step = flash.steps[0]!;
    expect(step.action.kind).toBe("bp_compare_destroy");
    expect(step.choice).toHaveLength(1);
    expect(step.choice![0]!.action.kind).toBe("move_card");
  });
});

describe("BSDB01-C10 仙豆", () => {
  const c = card("BSDB01-C10");
  const magicLookup = buildMagicLookup([c]);

  it("[0] 地球人効果でのオープン自己回収 / [2,3] 回復コスト付き部分ライフ軽減を実装", () => {
    expect(c.effects).toHaveLength(2);
    const recover = c.effects![0]!;
    expect(recover.timing).toEqual({
      kind: "card_event",
      event: ["revealed"],
    });
    expect(recover.condition).toContainEqual({
      kind: "trigger_tribes",
      tribes: ["地球人"],
    });
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.stub).toBeUndefined();
    expect(flash.steps).toHaveLength(2);
    expect(flash.steps[0]!.action.kind).toBe("recover");
    const action = flash.steps[1]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.cap).toBe(1);
      expect(action.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
        minCost: 5,
      });
    }
    expect(flash.steps[1]!.connector).toBe("conditional_cost");
  });

  it("[board] [2,3] 回復したときだけコスト5以上の相手アタックのライフ減少を1に制限する", () => {
    const magic = createCardInstance(c, {
      instanceId: "senzu-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const ally = createCardInstance(card("BSDB01-C01"), {
      instanceId: "ally-exhausted",
      ownerPlayerId: ALICE,
      zone: "field",
      exhaustState: "exhausted",
      normalCoreCount: 1,
    });
    const cost5Attacker = createCardInstance(card("BSDB01-C03"), {
      instanceId: "cost5-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cost4Attacker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "cost4-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    let state = createEmptyGameState({
      cardInstances: [magic, ally, cost5Attacker, cost4Attacker],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = runEffect(state, c.effects![1]!, "senzu-1");

    expect(
      state.cardInstances.find((card) => card.instanceId === "ally-exhausted")
        ?.exhaustState
    ).toBe("recovered");
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "life_damage_interception" &&
          ce.targetInstanceId === ALICE
      )
    ).toBe(true);

    const cappedBattle = withLifeDamageBattle(state, [
      { entityId: "cost5-entity", leaderId: "cost5-attacker", symbols: 3 },
    ]);
    expect(getUnblockedLifeDamage(cappedBattle, getDef)?.totalLifeDamage).toBe(
      1
    );

    const uncappedBattle = withLifeDamageBattle(state, [
      { entityId: "cost4-entity", leaderId: "cost4-attacker", symbols: 3 },
    ]);
    expect(
      getUnblockedLifeDamage(uncappedBattle, getDef)?.totalLifeDamage
    ).toBe(3);
  });

  it("[legal action] 先頭候補が回復状態でも後続に疲労スピリットがいれば回復 conditional_cost を列挙する", () => {
    const magic = createCardInstance(c, {
      instanceId: "senzu-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const recoveredAlly = createCardInstance(card("BSDB01-C01"), {
      instanceId: "ally-recovered-first",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: "recovered",
      normalCoreCount: 1,
    });
    const exhaustedAlly = createCardInstance(card("BSDB01-C01"), {
      instanceId: "ally-exhausted-second",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: "exhausted",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [magic, recoveredAlly, exhaustedAlly],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "default",
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "senzu-hand"
      )
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// CX01 孫悟空＆ベジータ — 真バディ契約 base（被煌臨側）。被煌臨の宣言は配線済みだが
// 真バディ固有(右左1体ずつ/任意コア配置/複数体煌臨) + 契約煌臨元ゲート未対応で empty。
// ════════════════════════════════════════════════════════════════

describe("BSDB01-CX01 孫悟空＆ベジータ", () => {
  const c = card("BSDB01-CX01");

  it("adventData なし（被煌臨 base: 自分は煌臨せず）。hostDualAdventGrant + effects[0]/[1] は in_advent_source ゲート付きで配線済", () => {
    expect(c.adventData).toBeUndefined();
    expect(c.keywordTags).toContain("contract");
    expect(c.keywordTags).toContain("soul_state");
    // [0,1]【真バディ】= hostDualAdventGrant (host 側同時2体煌臨許可、effects[] には現れない)。
    expect(c.hostDualAdventGrant).toBeDefined();
    expect(c.hostDualAdventGrant?.slots).toEqual([
      { cardNames: [{ contains: "孫悟空" }] },
      { cardNames: [{ contains: "ベジータ" }] },
    ]);
    expect(c.effects).toHaveLength(2);
    // [0] 破壊効果カウント+1 (配線済) / [1] サイヤ人離脱コア配置+回復 (配線済)。
    // 「自分が破壊効果を発揮したとき」= player:opponent (相手カードが破壊された) +
    //   cause:["opponent_effect"] (離脱カード=相手自身の視点で「相手以外=自分」の効果由来、
    //   2人対戦の消去法で自分の効果と同値。deriveTriggerEventCauseFromPendingLeave は
    //   離脱カードのコントローラ基準で判定するため cause:"self_effect" は逆に「相手が
    //   相手自身のカードを自壊させた」を指し取り違え、adversarial verifier 2026-07-12 指摘)。
    expect(c.effects![0]!.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "effect_steps_resolved",
      actionKinds: ["destroy"],
    });
    expect(c.effects![0]!.condition).toEqual([
      { kind: "self_state", state: "in_advent_source" },
    ]);
    // ENGINE-trigger-per-effect-activation-dedup: 同一破壊効果による複数 destroy emit を
    // chainId 単位 dedup する usageLimit。
    expect(c.effects![0]!.usageLimit).toBeUndefined();
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps).toEqual([
      { action: { kind: "count_increase", player: "self", amount: 1 } },
    ]);
    // 「自分の系統:「サイヤ人」によって相手のカードがフィールドを離れるとき」=
    //   player:opponent + event:leave_field + triggerSourceFilter.tribesRequired。
    expect(c.effects![1]!.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "leave_field",
      triggerSourceFilter: { tribesRequired: ["サイヤ人"] },
      cause: ["opponent_effect", "battle", "opponent_bp_compare"],
      sourceWhose: "either",
    });
    expect(c.effects![1]!.condition).toEqual([
      { kind: "self_state", state: "in_advent_source" },
    ]);
    expect(c.effects![1]!.stub).toBeUndefined();
  });

  it("[board] 煌臨元でないとき in_advent_source 不成立で count_increase が発火しない (gate)", () => {
    // CX01 が field 単独配置 (他カードの煌臨元ではない) → in_advent_source=false → カウント不変。
    const src = createCardInstance(c, {
      instanceId: "gv-not-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "gv-not-advent-source");
    expect(aliceCount(after)).toBe(0);
  });

  it("[board] 煌臨元として他カード下にある間は in_advent_source=true で count_increase が発火する", () => {
    // host (BSDB01-C01 で代用: spirit 任意) の underCards に CX01 を role='advent_source' で挿入。
    const cx01 = createCardInstance(c, {
      instanceId: "cx01-as-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const host = {
      ...createCardInstance(card("BSDB01-C01"), {
        instanceId: "host-spirit",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "cx01-as-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const before = createEmptyGameState({
      cardInstances: [host, cx01],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "cx01-as-advent-source");
    expect(aliceCount(after)).toBe(1);
  });

  // 「自分の系統:「サイヤ人」によって相手のカードがフィールドを離れるとき」の
  // triggerSourceFilter 絞り込み: 離脱を引き起こした効果の発生源カードの系統で
  // CX01 の応答可否が変わることを、実際の PendingLeaveEntity → CollectedTriggerEvent →
  // PendingTriggeredEffect の生成パイプラインを通して検証する。
  function buildAdventSourceBoard(sourceCardNo: string) {
    const cx01 = createCardInstance(c, {
      instanceId: "cx01-leave-source-filter",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const host = {
      ...createCardInstance(card("BSDB01-C01"), {
        instanceId: "host-spirit-leave",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "cx01-leave-source-filter",
          role: "advent_source" as const,
        },
      ],
    };
    const destroySource = createCardInstance(card(sourceCardNo), {
      instanceId: "leave-source-filter-destroyer",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSDB01-C05"), {
      instanceId: "leave-source-filter-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [host, cx01, destroySource, target],
    });
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: "leave-source-filter-target",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:leave-source-filter",
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: "leave-source-filter-destroyer",
    });
    const after = collectAndQueueTriggerReactions({
      chainId: "test:bsdb01-cards:4755",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    const destroyPending = after.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "destroy" &&
        pending.relatedInstanceId === "leave-source-filter-target"
    );
    // triggerSourceFilter に一致するリスナーが皆無なとき、queueReactionsInternal は
    // 解決不能な空 pending を残さないため pendingTriggeredEffects 自体を積まない
    // (「どのカードも応答しない」= CX01 も応答候補に含まれない、と同値)。
    if (!destroyPending) return [];
    expect(destroyPending.effectSourceInstanceId).toBe(
      "leave-source-filter-destroyer"
    );
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: after,
      pendingEffect: destroyPending,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
    });
    // effects[0] (「自分が破壊効果を発揮したとき」count_increase) は tribe 非依存でも
    // 同じ destroy pendingEffect にマッチするため、effects[1] (triggerSourceFilter 対象)
    // の registration だけに絞って応答可否を見る。
    return choices
      .filter((choice) => choice.actionRegistration.effectIndex === 1)
      .map((choice) => choice.sourceCard.instanceId);
  }

  it("[board] 系統:「サイヤ人」の効果によるフィールド離脱では CX01 が応答候補になる", () => {
    const sourceIds = buildAdventSourceBoard("BSDB01-C01");
    expect(sourceIds).toContain("cx01-leave-source-filter");
  });

  it("[board] 系統:「地球人」の効果によるフィールド離脱では CX01 は応答候補にならない (triggerSourceFilter で除外)", () => {
    const sourceIds = buildAdventSourceBoard("BSDB01-C05");
    expect(sourceIds).not.toContain("cx01-leave-source-filter");
  });

  it("[board] 相手自身のサイヤ人カードで相手が自分のカードを自壊させたとき CX01 は応答候補にならない (cause:opponent_effect で除外)", () => {
    // BOB 自身のサイヤ人カード(BSDB01-C01)の効果で BOB 自身のカードが破壊される自壊シナリオ。
    // deriveTriggerEventCauseFromPendingLeave は離脱カード(target, BOB所有)のコントローラ基準で
    // cause を導出するため、causePlayerId=BOB(自壊)なら cause="self_effect" となり、
    // 「自分(ALICE)の効果によって」を表す cause:["opponent_effect"] には一致しない
    // (adversarial verifier 2026-07-12 指摘の「自分の」欠落バグの再発防止テスト)。
    const cx01 = createCardInstance(c, {
      instanceId: "cx01-self-inflicted-guard",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const host = {
      ...createCardInstance(card("BSDB01-C01"), {
        instanceId: "host-spirit-self-inflicted",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "cx01-self-inflicted-guard",
          role: "advent_source" as const,
        },
      ],
    };
    const bobSaiyanSource = createCardInstance(card("BSDB01-C01"), {
      instanceId: "bob-saiyan-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobTarget = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-self-inflicted-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [host, cx01, bobSaiyanSource, bobTarget],
    });
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: "bob-self-inflicted-target",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:self-inflicted",
      causePlayerId: BOB,
      causedByEffectSourceInstanceId: "bob-saiyan-source",
    });
    const after = collectAndQueueTriggerReactions({
      chainId: "test:bsdb01-cards:4852",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    const destroyPending = after.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "destroy" &&
        pending.relatedInstanceId === "bob-self-inflicted-target"
    );
    if (!destroyPending) return;
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: after,
      pendingEffect: destroyPending,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
    });
    const cx01Choices = choices.filter(
      (choice) => choice.sourceCard.instanceId === "cx01-self-inflicted-guard"
    );
    expect(cx01Choices).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════
// M01 超サイヤ人2 孫悟空 -天使- — 煌臨時 effect_immunity / OC 破壊耐性 / OC battle_end form4
// ════════════════════════════════════════════════════════════════

describe("BSDB01-M01 超サイヤ人2 孫悟空 -天使-", () => {
  const c = card("BSDB01-M01");

  it("契約煌臨 adventData(both_attack_step) / 煌臨時 effect_immunity + 疲労ブロック許可 / OC 破壊耐性 / OC battle_end form4", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.soulCoreDest).toBe("trash");
    const advent = c.effects![0]!;
    expect(advent.timing).toEqual({ kind: "card_event", event: "advent" });
    expect(advent.steps[0]!.action.kind).toBe("effect_immunity");
    // 「疲労状態でブロックできる」を allow_block_while_exhausted で配線（旧 stub 撤去）。
    expect(advent.steps[1]!.action.kind).toBe("allow_block_while_exhausted");
    expect(advent.stub).toBeUndefined();

    const oc = c.effects![1]!;
    expect(oc.timing.kind).toBe("continuous");
    expect(oc.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 5,
    });
    expect(oc.timingScope).toEqual({ player: "both", period: "attack" });
    const res = oc.steps[0]!.action;
    expect(res.kind).toBe("effect_resistance");
    if (res.kind === "effect_resistance") {
      expect(res.resistsOutcome).toBe("destroy");
      expect(res.source).toBe("opponent");
    }

    const be = c.effects![2]!;
    expect(be.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "battle_end",
      requireRelatedInstanceOnField: false,
    });
    expect(be.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 5,
    });
    expect(be.timingScope).toEqual({ player: "both", period: "attack" });
    expect(be.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(be.stub).toBeUndefined();
  });

  it("[board] 契約煌臨: executeAdvent で手札カードが煌臨先に重なりソウルコアが trash へ", () => {
    // host は「孫悟空」を含む名前が必要 (AdventCondition.cardNames:[{contains:"孫悟空"}])。
    const target = createCardInstance(card("BSDB01-C01"), {
      instanceId: "m01-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const adventCard = createCardInstance(c, {
      instanceId: "m01-advent",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      cardInstances: [target, adventCard],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          countValue: 5,
        },
        {},
      ],
    });
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "m01-advent",
        targetInstanceId: "m01-host",
        adventData: c.adventData!,
        isContractAdvent: true,
      },
      getDef
    );
    const adv = result.cardInstances.find(
      (x) => x.instanceId === "m01-advent"
    )!;
    expect(adv.zone).toBe("field");
    expect(adventSourceIdsOf(adv)).toEqual(["m01-host"]);
    // 契約煌臨はソウルコアを trash へ。
    expect(
      result.players.find((p) => p.id === ALICE)!.soulCoreLocation
    ).toEqual({ kind: "trash" });
  });

  it("[board] OC battle_end form4: ブロック成立 2 参加者でも BSDB01-M01 は 1 回だけカウント+1", () => {
    const observer = createCardInstance(c, {
      instanceId: "m01-observer",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const attacker = createCardInstance(card("BSDB01-C02"), {
      instanceId: "m01-attacker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const blocker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "m01-blocker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [observer, attacker, blocker],
      playerOverrides: [{ countValue: 5 }, {}],
    });
    const queued = queueBattleEndTriggers({
      state: {
        ...base,
        activePlayerId: BOB,
        step: "attack",
      },
      participantInstanceIds: ["m01-attacker", "m01-blocker"],
      blockSideInstanceIds: ["m01-blocker"],
      attackId: "attack:bsdb01-m01-form4",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    const m01Pendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "battle_end" && p.actingPlayerId === ALICE
    );
    expect(m01Pendings).toHaveLength(1);

    const actions = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const resolve = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === m01Pendings[0]!.pendingId &&
        a.sourceInstanceId === "m01-observer"
    );
    expect(resolve).toBeDefined();
    let after = (
      applyLegalAction({
        state: queued,
        action: resolve!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }) as { state: GameState }
    ).state;
    let guard = 0;
    while (after.stackWindow && guard++ < 10) {
      const passActions = getLegalActions({
        state: after,
        actingPlayerId: after.stackWindow.priorityPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      } as unknown as Parameters<typeof getLegalActions>[0]);
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      after = (
        applyLegalAction({
          state: after,
          action: pass!,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions,
        }) as { state: GameState }
      ).state;
    }
    expect(aliceCount(after)).toBe(6);
  });
});

// ════════════════════════════════════════════════════════════════
// M02 ピッコロ — stack source 抑止 / 手札割込対象開示対応 / 離脱時手札回収+コア配置二択。
// ════════════════════════════════════════════════════════════════

describe("BSDB01-M02 ピッコロ", () => {
  const c = card("BSDB01-M02");

  it("BSDB01-M02 [0] は相手のスタックタイミング元にならない CE を登録する", () => {
    expect(c.effects).toHaveLength(3);
    const sourceSuppress = c.effects![0]!;
    expect(sourceSuppress.stub).toBeUndefined();
    expect(sourceSuppress.timing.kind).toBe("continuous");
    expect(sourceSuppress.applicability).toEqual({
      zone: ["hand", "in_use", "field"],
    });
    expect(sourceSuppress.steps).toEqual([
      {
        action: {
          kind: "suppress_stack_source",
          target: "self",
          player: "opponent",
          duration: { scope: "while_on_field" },
        },
      },
    ]);
  });

  it("BSDB01-M02 [0] は手札でも CE の適用ゾーンを保持し、再計算後に invariant と整合する", () => {
    const source = createCardInstance(c, {
      instanceId: "bsdb01-m02-hand-stack-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const initial = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    });

    const rebuilt = rebuildContinuousEffectsFromField(initial, getDef);
    const sourceCe = rebuilt.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "suppress_stack_source"
    );
    expect(sourceCe?.metadata).toMatchObject({
      sourceApplicabilityZone: ["hand", "in_use", "field"],
    });

    const recomputed = recomputeContinuousEffects(rebuilt);
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "suppress_stack_source"
      )
    ).toHaveLength(1);
    expect(
      collectGameStateInvariantIssues(recomputed, {
        getCardDefinitionById: getDef,
      }).filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("BSDB01-M02 [2] は手札割込召喚後に対象付け替え / stack 抑止を choice で提示する", () => {
    expect(c.effects).toHaveLength(3);
    expect(c.effects![1]!.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "targeted",
      triggerFilter: {
        cardName: [{ contains: "孫悟空" }, { contains: "ベジータ" }],
      },
      cause: ["opponent_effect"],
    });
    expect(c.effects![1]!.applicability).toEqual({ zone: "hand" });
    expect(c.effects![1]!.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
    expect(c.effects![1]!.steps[0]!.label).toBe("対象付け替え");
    expect(c.effects![1]!.steps[0]!.choice?.[0]).toMatchObject({
      label: "スタック抑止",
      triggerEffectTiming: "stack",
      condition: [{ kind: "step_phase", step: "attack", whose: "either" }],
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
    });
    expect(c.effects![1]!.steps[1]!.action).toEqual({
      kind: "redirect_target",
      from: { kind: "trigger_related_instance" },
      to: { kind: "self" },
      mode: "all_current_effect_targets",
    });
    expect(c.effects![1]!.steps[1]!.stepCondition).toEqual({
      kind: "all",
      conditions: [
        {
          kind: "ref_choice",
          stepId: "piccolo-targeted-branch-summon",
          choiceIndex: 0,
        },
        {
          kind: "ref_succeeded",
          stepId: "piccolo-targeted-branch-summon",
        },
      ],
    });
    expect(c.effects![1]!.steps[2]!.stepCondition).toEqual({
      kind: "all",
      conditions: [
        {
          kind: "ref_choice",
          stepId: "piccolo-targeted-branch-summon",
          choiceIndex: 1,
        },
        {
          kind: "ref_succeeded",
          stepId: "piccolo-targeted-branch-summon",
        },
      ],
    });
    expect(c.effects![1]!.steps[2]!.action).toEqual({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "battle", nextBattleEnd: true, untilTurnEnd: true },
      targetScope: "effect_source",
      effectFilter: { activatedMode: ["stack"] },
    });
    expect(c.effects![1]!.limitGroupId).toBe("BSDB01-M02-targeted-branch");
    expect(c.effects![1]!.stub).toBeUndefined();
  });

  it("BSDB01-M02 [2] は非スピリットの『ベジータ』カードが対象になっても開示誘発する", () => {
    const piccolo = c;
    const vegetaNexus: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-VEGETA-NEXUS",
      name: "ベジータの宇宙船",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["blue"],
      textLines: ["テスト用ネクサス。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const magic: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-NEXUS-TARGET-MAGIC",
      name: "Nexus Target Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
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
    const definitions = [piccolo, vegetaNexus, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(piccolo, {
            instanceId: "bsdb01-m02-hand",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "hand",
          }),
          createCardInstance(vegetaNexus, {
            instanceId: "bsdb01-m02-vegeta-nexus",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(magic, {
            instanceId: "bsdb01-m02-nexus-magic",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "in_use",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsdb01-m02-nexus",
        actingPlayerId: ALICE,
        sourceInstanceId: "bsdb01-m02-nexus-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bsdb01-m02-nexus",
          actionKind: "magic",
          chainId: "chain:bsdb01-m02-nexus",
          actingPlayerId: ALICE,
          cardInstanceId: "bsdb01-m02-nexus-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        targetStepId: "piccolo-targeted-nexus-step",
        candidateInstanceIds: ["bsdb01-m02-vegeta-nexus"],
        targetEffectFilterTags: [],
      },
    };

    const chooseNexus = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseNexus).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseNexus!,
      targetInstanceIds: ["bsdb01-m02-vegeta-nexus"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterDisclosure.pendingPrivateDeclarations).toHaveLength(1);
    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        targetStepId: "piccolo-targeted-nexus-step",
        deferredStackResolution: {
          deferredStack: {
            targetStepId: "piccolo-targeted-nexus-step",
          },
        },
      }
    );
    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterPrivateDeclared.pendingTriggeredEffects[0]).toMatchObject({
      declaredSourceInstanceId: "bsdb01-m02-hand",
      relatedInstanceId: "bsdb01-m02-vegeta-nexus",
      eventKind: "targeted",
    });
  });

  it("BSDB01-M02 [2] は自分の効果で自分の孫悟空が対象になるときは開示誘発しない", () => {
    const piccolo = c;
    const goku = card("BSDB01-C01");
    const magic: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-SELF-TARGET-MAGIC",
      name: "Self Target Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["自分のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const definitions = [piccolo, goku, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(piccolo, {
            instanceId: "bsdb01-m02-hand",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "hand",
          }),
          createCardInstance(goku, {
            instanceId: "bsdb01-c01-goku",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(magic, {
            instanceId: "bsdb01-m02-self-magic",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "in_use",
          }),
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsdb01-m02-self",
        actingPlayerId: BOB,
        sourceInstanceId: "bsdb01-m02-self-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bsdb01-m02-self",
          actionKind: "magic",
          chainId: "chain:bsdb01-m02-self",
          actingPlayerId: BOB,
          cardInstanceId: "bsdb01-m02-self-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["bsdb01-c01-goku"],
        targetEffectFilterTags: [],
      },
    };

    const chooseGoku = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseGoku).toBeDefined();
    const afterSelection = applyLegalAction({
      state,
      action: chooseGoku!,
      targetInstanceIds: ["bsdb01-c01-goku"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterSelection.pendingPrivateDeclarations).toHaveLength(0);
    expect(afterSelection.pendingTriggeredEffects).toHaveLength(0);
    expect(afterSelection.pendingTargetedDisclosureContinuation).toBeNull();
  });

  it("BSDB01-M02 [2] の二択分岐は同じターン1回グループを共有する", () => {
    const piccolo = c;
    const goku = card("BSDB01-C01");
    const magic: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-STACK-TARGET-MAGIC",
      name: "Stack Target Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
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
      ],
    };
    const definitions = [piccolo, goku, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(piccolo, {
            instanceId: "bsdb01-m02-hand",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "hand",
          }),
          createCardInstance(goku, {
            instanceId: "bsdb01-c01-goku",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(magic, {
            instanceId: "bsdb01-m02-stack-magic",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "in_use",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      effectUsageRecords: [
        {
          sourceInstanceId: "previous-bsdb01-m02-hand",
          sourceDefinitionId: "BSDB01-M02",
          playerId: BOB,
          effectLabel: "effect:1",
          turnNumber: 1,
          step: "attack",
          duration: "turn",
          count: 1,
          groupId: "BSDB01-M02-targeted-branch",
        },
      ],
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsdb01-m02-stack",
        actingPlayerId: ALICE,
        sourceInstanceId: "bsdb01-m02-stack-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bsdb01-m02-stack",
          actionKind: "magic",
          chainId: "chain:bsdb01-m02-stack",
          actingPlayerId: ALICE,
          cardInstanceId: "bsdb01-m02-stack-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "stack",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["bsdb01-c01-goku"],
        targetEffectFilterTags: [],
      },
    };

    const chooseGoku = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseGoku).toBeDefined();
    const afterSelection = applyLegalAction({
      state,
      action: chooseGoku!,
      targetInstanceIds: ["bsdb01-c01-goku"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterSelection.pendingPrivateDeclarations).toHaveLength(0);
    expect(afterSelection.pendingTriggeredEffects).toHaveLength(0);
    expect(afterSelection.pendingTargetedDisclosureContinuation).toBeNull();
  });

  it("BSDB01-M02 [2] は stack 対象化時に対象付け替え / stack 抑止を同一 pending の choice として提示する", () => {
    const piccolo = c;
    const goku = card("BSDB01-C01");
    const magic: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-STACK-CHOICE-MAGIC",
      name: "Stack Choice Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
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
      ],
    };
    const definitions = [piccolo, goku, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(piccolo, {
            instanceId: "bsdb01-m02-hand",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "hand",
          }),
          createCardInstance(goku, {
            instanceId: "bsdb01-c01-goku",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(magic, {
            instanceId: "bsdb01-m02-stack-choice-magic",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "in_use",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsdb01-m02-stack-choice",
        actingPlayerId: ALICE,
        sourceInstanceId: "bsdb01-m02-stack-choice-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bsdb01-m02-stack-choice",
          actionKind: "magic",
          chainId: "chain:bsdb01-m02-stack-choice",
          actingPlayerId: ALICE,
          cardInstanceId: "bsdb01-m02-stack-choice-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "stack",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["bsdb01-c01-goku"],
        targetEffectFilterTags: [],
      },
    };

    const chooseGoku = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseGoku).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseGoku!,
      targetInstanceIds: ["bsdb01-c01-goku"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterDisclosure.pendingPrivateDeclarations).toHaveLength(1);
    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterPrivateDeclared.pendingTriggeredEffects[0]).toMatchObject({
      effectActivationTiming: "stack",
    });
    const choices = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).filter(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bsdb01-m02-hand"
    );
    expect(choices).toHaveLength(1);
    expect(choices[0]?.choiceIndex).toBeUndefined();
    expect(choices[0]?.deferredChoiceIndexes).toEqual([0, 1]);
  });

  it("BSDB01-M02 [2] は対象開示後に孫悟空からピッコロへ元マジック対象を付け替える", () => {
    const piccolo = c;
    const goku = card("BSDB01-C01");
    const magic: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-TARGET-MAGIC",
      name: "Target Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
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
      ],
    };
    const definitions = [piccolo, goku, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const piccoloHand = createCardInstance(piccolo, {
      instanceId: "bsdb01-m02-hand",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const gokuField = createCardInstance(goku, {
      instanceId: "bsdb01-c01-goku",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const magicInUse = createCardInstance(magic, {
      instanceId: "bsdb01-m02-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [piccoloHand, gokuField, magicInUse],
        playerOverrides: [{}, { reserveNormalCoreCount: 6 }],
      }),
      activePlayerId: ALICE,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsdb01-m02",
        actingPlayerId: ALICE,
        sourceInstanceId: "bsdb01-m02-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bsdb01-m02",
          actionKind: "magic",
          chainId: "chain:bsdb01-m02",
          actingPlayerId: ALICE,
          cardInstanceId: "bsdb01-m02-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["bsdb01-c01-goku"],
        targetEffectFilterTags: [],
      },
    };

    const chooseGoku = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseGoku).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseGoku!,
      targetInstanceIds: ["bsdb01-c01-goku"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        targetInstanceIds: ["bsdb01-c01-goku"],
      }
    );
    expect(afterDisclosure.pendingPrivateDeclarations).toHaveLength(1);

    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    const resolvePiccolo = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bsdb01-m02-hand"
    );
    expect(resolvePiccolo).toBeDefined();
    const afterPiccoloDeclared = applyLegalAction({
      state: afterPrivateDeclared,
      action: resolvePiccolo!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    const passStack = getLegalActions({
      state: afterPiccoloDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterPiccoloDeclared,
      action: passStack!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const redirectChoice = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 0
    );
    expect(redirectChoice).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterStackPassed,
      action: redirectChoice!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const afterResolved = finishCoreChoices(afterChoice, lookup, effectLookups);

    expect(afterResolved.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterResolved.players.find((player) => player.id === BOB)
        ?.reserveNormalCoreCount
    ).toBe(6);
    expect(
      afterResolved.cardInstances.find(
        (entry) => entry.instanceId === "bsdb01-c01-goku"
      )?.zone
    ).toBe("field");
    const piccoloAfter = afterResolved.cardInstances.find(
      (entry) => entry.instanceId === "bsdb01-m02-hand"
    );
    expect(
      piccoloAfter?.zone === "trash" ||
        afterResolved.pendingLeaveEntities.some(
          (entry) => entry.instanceId === "bsdb01-m02-hand"
        )
    ).toBe(true);
    expect(
      afterResolved.log.some((entry) =>
        entry.includes(
          "effect:redirect_target:targeted-disclosure:bsdb01-c01-goku->bsdb01-m02-hand"
        )
      )
    ).toBe(true);
  });

  it("BSDB01-M02 [2] の stack 抑止分岐は元マジック対象を付け替えない", () => {
    const piccolo = c;
    const goku = card("BSDB01-C01");
    const magic: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-STACK-RESTRICT-MAGIC",
      name: "Stack Restrict Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
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
      ],
    };
    const definitions = [piccolo, goku, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(piccolo, {
            instanceId: "bsdb01-m02-hand",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "hand",
          }),
          createCardInstance(goku, {
            instanceId: "bsdb01-c01-goku",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(magic, {
            instanceId: "bsdb01-m02-stack-restrict-magic",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "in_use",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsdb01-m02-stack-restrict",
        actingPlayerId: ALICE,
        sourceInstanceId: "bsdb01-m02-stack-restrict-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bsdb01-m02-stack-restrict",
          actionKind: "magic",
          chainId: "chain:bsdb01-m02-stack-restrict",
          actingPlayerId: ALICE,
          cardInstanceId: "bsdb01-m02-stack-restrict-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "stack",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["bsdb01-c01-goku"],
        targetEffectFilterTags: [],
      },
    };

    const chooseGoku = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseGoku).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseGoku!,
      targetInstanceIds: ["bsdb01-c01-goku"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const restrictChoice = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bsdb01-m02-hand" &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(1)
    );
    expect(restrictChoice).toBeDefined();
    const afterPiccoloDeclared = applyLegalAction({
      state: afterPrivateDeclared,
      action: restrictChoice!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const passStack = getLegalActions({
      state: afterPiccoloDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterPiccoloDeclared,
      action: passStack!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const chooseRestrict = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(chooseRestrict).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterStackPassed,
      action: chooseRestrict!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const afterResolved = finishCoreChoices(afterChoice, lookup, effectLookups);

    expect(afterResolved.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterResolved.log.some((entry) =>
        entry.includes("effect:redirect_target:targeted-disclosure")
      )
    ).toBe(false);
    expect(
      afterResolved.log.some((entry) => entry.includes("restrict_stack"))
    ).toBe(true);
    const restrictEffect = afterResolved.activeContinuousEffects.find(
      (effect) => effect.modifierTag === "restrict_stack"
    );
    expect(restrictEffect?.duration).toEqual({
      scope: "battle",
      nextBattleEnd: true,
      untilTurnEnd: true,
    });
    expect(
      removeExpiredContinuousEffects(
        { ...afterResolved, activeContinuousEffects: [restrictEffect!] },
        { kind: "turn_end" }
      )
    ).toHaveLength(0);
    expect(
      filterRestrictedTimings(
        ["stack"],
        afterResolved,
        ALICE,
        undefined,
        lookup,
        undefined,
        "in_use",
        "bsdb01-m02-stack-restrict-magic",
        { timingKind: "activated", activatedMode: "stack" }
      )
    ).toEqual([]);
  });

  it("BSDB01-M02 [2] の stack 抑止分岐は発揮元カードの相手効果耐性で回避される", () => {
    const piccolo = c;
    const goku = card("BSDB01-C01");
    const magic: CardDefinition = {
      cardNo: "TEST-BSDB01-M02-STACK-IMMUNE-MAGIC",
      name: "Stack Immune Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
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
      ],
    };
    const definitions = [piccolo, goku, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(piccolo, {
            instanceId: "bsdb01-m02-hand",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "hand",
          }),
          createCardInstance(goku, {
            instanceId: "bsdb01-c01-goku",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(magic, {
            instanceId: "bsdb01-m02-stack-immune-magic",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "in_use",
          }),
          createCardInstance(magic, {
            instanceId: "bsdb01-m02-immune-stack-source",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      activeContinuousEffects: [
        {
          effectId: "ce:stack-source-immune",
          sourceInstanceId: "bsdb01-m02-immune-stack-source",
          sourceDefinitionId: magic.cardNo,
          actingPlayerId: ALICE,
          modifierTag: "defense_immune",
          targetInstanceId: "bsdb01-m02-immune-stack-source",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
        },
      ],
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsdb01-m02-stack-immune",
        actingPlayerId: ALICE,
        sourceInstanceId: "bsdb01-m02-stack-immune-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bsdb01-m02-stack-immune",
          actionKind: "magic",
          chainId: "chain:bsdb01-m02-stack-immune",
          actingPlayerId: ALICE,
          cardInstanceId: "bsdb01-m02-stack-immune-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "stack",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["bsdb01-c01-goku"],
        targetEffectFilterTags: [],
      },
    };

    const chooseGoku = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseGoku).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseGoku!,
      targetInstanceIds: ["bsdb01-c01-goku"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const restrictChoice = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bsdb01-m02-hand" &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(1)
    );
    expect(restrictChoice).toBeDefined();
    const afterPiccoloDeclared = applyLegalAction({
      state: afterPrivateDeclared,
      action: restrictChoice!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const passStack = getLegalActions({
      state: afterPiccoloDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterPiccoloDeclared,
      action: passStack!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const chooseRestrict = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(chooseRestrict).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterStackPassed,
      action: chooseRestrict!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    const afterResolved = finishCoreChoices(afterChoice, lookup, effectLookups);

    expect(
      afterResolved.log.some((entry) =>
        entry.includes("effect:restrict_stack:registered")
      )
    ).toBe(true);
    expect(
      filterRestrictedTimings(
        ["stack"],
        afterResolved,
        ALICE,
        undefined,
        lookup,
        undefined,
        "field",
        "bsdb01-m02-immune-stack-source",
        { timingKind: "activated", activatedMode: "stack" }
      )
    ).toEqual(["stack"]);
  });

  it("BSDB01-M02 [5,6,7] は離脱→手札回収→コア配置二択の steps を持つ", () => {
    expect(c.effects).toHaveLength(3);
    const e = c.effects![2]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: "opponent_effect",
    });
    expect(e.applicability).toEqual({ level: { min: 2 } });
    expect(e.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 2,
    });
    expect(e.executionMode).toBe("optional");
    expect(e.stub).toBeUndefined();
    expect(e.steps[0]!.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
    });
    expect(e.steps[1]!.action).toEqual({
      kind: "move_self",
      destination: "hand",
    });
    expect(e.steps[2]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "life", player: "self" },
      amount: 1,
    });
    expect(e.steps[2]!.choice?.[0]).toEqual({
      label: "ソウルコア回収",
      action: {
        kind: "core_move",
        from: { kind: "trash", player: "self" },
        to: { kind: "reserve", player: "self" },
        amount: 1,
        effectKind: "explicit_soul_core",
      },
    });
  });

  function setupLeaveState(opts: {
    level2Cores: number;
    voidCores: number;
    trashNormalCores: number;
    soulInTrash: boolean;
  }): GameState {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 0,
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: opts.voidCores,
          trashNormalCoreCount: opts.trashNormalCores,
          ...(opts.soulInTrash ? { soulCoreLocation: { kind: "trash" } } : {}),
        },
        {},
      ],
    });
    const self = createCardInstance(c, {
      instanceId: "piccolo-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: opts.level2Cores,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-m02-leave",
    });
    return {
      ...base,
      cardInstances: [self],
      pendingLeaveEntities: [
        {
          instanceId: "piccolo-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-m02-leave",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
  }

  it("BSDB01-M02 [5,6,7] 既定 (choiceIndex 0): 離脱撤回→手札へ戻り、ボイド→ライフ1個", () => {
    const state = setupLeaveState({
      level2Cores: 2,
      voidCores: 3,
      trashNormalCores: 0,
      soulInTrash: false,
    });
    const pending = executeEffect({
      chainId: "test:bsdb01-cards:6540",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "piccolo-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id: string) =>
        ALL_CARDS.find((cd) => cd.cardNo === id),
    });
    const result = flushPendingLeaves(pending, (id) =>
      ALL_CARDS.find((cd) => cd.cardNo === id)
    );
    const inst = result.cardInstances.find(
      (x) => x.instanceId === "piccolo-1"
    )!;
    expect(inst.zone).toBe("hand");
    expect(inst.pendingLeaveKind).toBeNull();
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "piccolo-1")
    ).toBeUndefined();
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(2);
  });

  it("BSDB01-M02 [5,6,7] choiceIndex 1: トラッシュのソウルコアをリザーブへ（通常コアには触れない）", () => {
    const state = setupLeaveState({
      level2Cores: 2,
      voidCores: 3,
      trashNormalCores: 2,
      soulInTrash: true,
    });
    const pending = executeEffect({
      chainId: "test:bsdb01-cards:6568",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "piccolo-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id: string) =>
        ALL_CARDS.find((cd) => cd.cardNo === id),
      choiceIndex: 1,
    });
    const result = flushPendingLeaves(pending, (id) =>
      ALL_CARDS.find((cd) => cd.cardNo === id)
    );
    const inst = result.cardInstances.find(
      (x) => x.instanceId === "piccolo-1"
    )!;
    expect(inst.zone).toBe("hand");
    const alice = result.players.find((p) => p.id === "alice")!;
    // ソウルコアのみ移動。通常のトラッシュコア (2個) は残る。
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(alice.trashNormalCoreCount).toBe(2);
    expect(alice.reserveNormalCoreCount).toBe(2); // 離場した本体のコアもリザーブへ返る。
    expect(inst.normalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(3);
    expect(alice.lifeNormalCoreCount).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// R01 超サイヤ人2 孫悟空 — 煌臨/アタック時ベジータ効果駆動契約煌臨 / OC ネクサス+創界神2つまで破壊
// ════════════════════════════════════════════════════════════════

describe("BSDB01-R01 超サイヤ人2 孫悟空", () => {
  const c = card("BSDB01-R01");

  it("契約煌臨 adventData(own_turn) / 煌臨/アタック時ベジータ効果駆動契約煌臨(advent step) / OC ネクサス+創界神2つまで破壊", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("own_turn");
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps.map((s) => s.action.kind)).toEqual([
      "advent",
      "draw",
    ]);
    expect(c.effects![0]!.executionMode).toBe("optional");
    expect(c.effects![0]!.steps[0]!.executionMode).toBeUndefined();
    expect(c.effects![0]!.steps[1]!.executionMode).toBe("optional");
    expect(c.effects![0]!.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "advent-vegeta",
    });
    const oc = c.effects![1]!;
    expect(oc.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 5,
    });
    const destroy = oc.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.category).toEqual(["nexus"]);
      expect(destroy.target.filter.targetsGrandwalker).toBe(true);
      expect(destroy.target.count).toEqual({ min: 0, max: 2 });
    }
  });

  it("[board] OC 破壊 step（fixed count=2 変種）で相手ネクサス2つが破壊予約される", () => {
    // カード本体は count {min,max}=「2つまで」(非対話 executeEffect は min=0 に解決)。
    // 破壊機構そのものの盤面変化検証は、BSTH01-X08 board test 同様に fixed count 変種で行う。
    const src = createCardInstance(c, {
      instanceId: "goku-r01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const nx1 = createCardInstance(card("BSDB01-C06"), {
      instanceId: "nx-r01-1",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const nx2 = createCardInstance(card("BSDB01-C06"), {
      instanceId: "nx-r01-2",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const ocDestroy = c.effects![1]!.steps[0]!.action;
    if (
      ocDestroy.kind !== "destroy" ||
      typeof ocDestroy.target !== "object" ||
      !("filter" in ocDestroy.target)
    )
      throw new Error("expected destroy filter action");
    const fixedVariant: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { ...ocDestroy.target, count: 2 },
          },
        },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, nx1, nx2] }),
      fixedVariant,
      "goku-r01"
    );
    const destroyed = after.cardInstances.filter(
      (x) => x.ownerPlayerId === BOB && x.pendingLeaveKind === "destroy"
    );
    expect(destroyed).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════
// R02 超サイヤ人2 ベジータ — 煌臨/アタック時 3ドロー→2破棄→効果駆動契約煌臨 / OC コスト破壊
// ════════════════════════════════════════════════════════════════

describe("BSDB01-R02 超サイヤ人2 ベジータ", () => {
  const c = card("BSDB01-R02");

  it("契約煌臨 adventData(own_turn) / ドロー3→破棄2→トラッシュ孫悟空を効果駆動契約煌臨(advent step) / OC コスト破壊は maxCostSource で配線", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("own_turn");
    const e = c.effects![0]!;
    expect(e.steps[0]!.action).toEqual({ kind: "draw", count: 3 });
    expect(e.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: 2,
    });
    expect(e.steps[2]!.action.kind).toBe("advent");
    expect(e.stub).toBeUndefined();
    // [7,8] OC『アタック時』このスピリットのコスト以下の相手スピ1体破壊 = 動的 maxCostSource。
    const destroy = c.effects![1]!;
    expect(destroy.stub).toBeUndefined();
    const action = destroy.steps[0]!.action;
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.maxCostSource).toBe("self_effective_cost");
      expect(action.target.filter.category).toEqual(["spirit"]);
      expect(action.target.count).toBe(1);
    } else {
      throw new Error("destroy filter target expected");
    }
  });

  it("[board] OC コスト以下のみ破壊: 自身コスト7、相手コスト5は破壊・コスト8は残る", () => {
    const src = createCardInstance(c, {
      instanceId: "vegeta-oc",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const lowCost = createCardInstance(card("BSDB01-C03"), {
      instanceId: "low-1", // コスト5 ≤ 7 → 破壊
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const highCost = createCardInstance(card("BSDB01-M01"), {
      instanceId: "high-1", // コスト8 > 7 → 残る
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, lowCost, highCost],
      playerOverrides: [{ countValue: 5 }, {}], // OC条件 count_value self min:5
    });
    const after = runEffect(before, c.effects![1]!, "vegeta-oc");
    const low = after.cardInstances.find((x) => x.instanceId === "low-1")!;
    const high = after.cardInstances.find((x) => x.instanceId === "high-1")!;
    expect(low.pendingLeaveKind).toBe("destroy"); // コスト5 ≤ 7 → 破壊予約
    expect(high.pendingLeaveKind).toBeNull(); // コスト8 > 7 → 対象外
  });

  it("[board] additional_cost CE 反映: 自身に『コスト9 としても扱う』CE が掛かるとコスト8 も破壊対象", () => {
    // ENGINE-self-effective-cost-additional-cost: self_effective_cost 閾値は印字 def.cost
    // (=7) と additional_cost CE の最大値で算出する。CE 9 が掛かれば 9 以下が対象 = コスト8 も破壊。
    const src = createCardInstance(c, {
      instanceId: "vegeta-oc-extra",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const highCost = createCardInstance(card("BSDB01-M01"), {
      instanceId: "high-with-ce", // コスト8 ≤ 9 → 破壊 (印字 7 のままなら対象外)
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [src, highCost],
      playerOverrides: [{ countValue: 5 }, {}],
    });
    const before: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        {
          effectId: "self-additional-cost-9",
          modifierTag: "additional_cost",
          modifierAmount: 9,
          targetInstanceId: "vegeta-oc-extra",
          sourceInstanceId: "vegeta-oc-extra",
          sourceDefinitionId: c.cardNo,
          provenance: { kind: "card_effect", effectIndex: 0 },
          duration: { scope: "permanent" },
        } as unknown as GameState["activeContinuousEffects"][number],
      ],
    };
    const after = runEffect(before, c.effects![1]!, "vegeta-oc-extra");
    const high = after.cardInstances.find(
      (x) => x.instanceId === "high-with-ce"
    )!;
    expect(high.pendingLeaveKind).toBe("destroy");
  });

  it("[board] 煌臨/アタック時: デッキ上3枚がドローされ手札へ移る", () => {
    // 後段の discard(2) は手札3枚から2枚を「選んで」捨てるため pending hand selection を生成し、
    // 非対話 executeEffect では自動解決されない。盤面変化としては前段の確定ドロー(手札+3)を検証する。
    const src = createCardInstance(c, {
      instanceId: "vegeta-r02",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const deck = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(card("BSDB01-C05"), {
        instanceId: `deck-r02-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const after = runEffect(
      createEmptyGameState({
        cardInstances: [src, ...deck],
        playerOverrides: [{ deckCount: 6 }, {}],
      }),
      c.effects![0]!,
      "vegeta-r02"
    );
    const drawn = executeNextOptionalStep(after);
    const deckLeft = drawn.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "deck"
    );
    expect(deckLeft).toHaveLength(3); // 6 - 3 ドロー
    const handOrAfterDraw = drawn.cardInstances.filter(
      (x) =>
        x.ownerPlayerId === ALICE && (x.zone === "hand" || x.zone === "trash")
    );
    expect(handOrAfterDraw.length).toBe(3); // 3 枚がデッキを離れた
  });
});

// ════════════════════════════════════════════════════════════════
// R04 超元気玉 — ミラージュ通常セット + フラッシュ自セット。
// ════════════════════════════════════════════════════════════════

describe("BSDB01-R04 超元気玉", () => {
  const c = card("BSDB01-R04");

  it("mirageData はコスト1・トラッシュセット許可 / フラッシュはドロー後に自セット", () => {
    expect(c.mirageData).toEqual({
      cost: 1,
      reduction: [],
      canSetFromTrash: true,
    });
    const flash = c.effects![0]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
    expect(flash.steps[1]!.action).toEqual({
      kind: "set_self_as_mirage",
      onlyIfNoMirage: true,
    });
    expect(flash.stub).toBeUndefined();
  });

  it("[board] フラッシュで1枚ドローし、自分のミラージュがなければ自身をセットする", () => {
    const source = createCardInstance(c, {
      instanceId: "r04-source",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deck = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSDB01-C05"), {
        instanceId: `deck-r04-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const after = runEffect(
      createEmptyGameState({
        cardInstances: [source, ...deck],
        playerOverrides: [{ handCount: 1, deckCount: 4 }, {}],
      }),
      c.effects![0]!,
      "r04-source"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "r04-source")?.zone
    ).toBe("mirage");
    expect(after.mirageSetStates).toEqual([
      { playerId: ALICE, cardInstanceId: "r04-source" },
    ]);
    const hand = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "hand"
    );
    expect(hand).toHaveLength(1);
    expect(after.players.find((p) => p.id === ALICE)?.handCount).toBe(1);
    expect(after.mirageSetPlayerIdsThisTurn).toEqual([]);
  });

  it("[board] トラッシュからコスト1を支払ってセットし、ミラージュへ移す", () => {
    const source = createCardInstance(c, {
      instanceId: "r04-trash-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const before = {
      ...createEmptyGameState({
        cardInstances: [source],
        playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };

    const { state: after } = useSetMirageAsAction({
      state: before,
      actingPlayerId: ALICE,
      sourceInstanceId: source.instanceId,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions,
    });

    expect(
      after.cardInstances.find(
        (entry) => entry.instanceId === source.instanceId
      )?.zone
    ).toBe("mirage");
    expect(after.mirageSetStates).toEqual([
      { playerId: ALICE, cardInstanceId: source.instanceId },
    ]);
    expect(after.players.find((player) => player.id === ALICE)).toMatchObject({
      reserveNormalCoreCount: 0,
      trashNormalCoreCount: 1,
    });
  });

  it("[board] 既に自分のミラージュがある場合は自セットしない", () => {
    const source = createCardInstance(c, {
      instanceId: "r04-source",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const existingMirage = createCardInstance(card("BSTS01-C06"), {
      instanceId: "existing-mirage",
      ownerPlayerId: ALICE,
      zone: "mirage",
    });
    const deck = createCardInstance(card("BSDB01-C05"), {
      instanceId: "deck-r04",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const after = runEffect(
      createEmptyGameState({
        cardInstances: [source, existingMirage, deck],
        mirageSetStates: [
          { playerId: ALICE, cardInstanceId: "existing-mirage" },
        ],
        playerOverrides: [{ handCount: 1, deckCount: 1 }, {}],
      }),
      c.effects![0]!,
      "r04-source"
    );

    expect(
      after.cardInstances.find((x) => x.instanceId === "r04-source")?.zone
    ).toBe("hand");
    expect(after.mirageSetStates).toEqual([
      { playerId: ALICE, cardInstanceId: "existing-mirage" },
    ]);
    expect(after.players.find((p) => p.id === ALICE)?.handCount).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// TX01(A)/(B) — 両面。アタック代替フリップ = attackAlternativeFlip 宣言 / 自己コスト破壊は maxCostSource で配線 / OC unblockable+immunity / B面継続・離脱誘発。
// ════════════════════════════════════════════════════════════════

describe("BSDB01-TX01(A) 超サイヤ人3 孫悟空＆超サイヤ人2 ベジータ-天使-", () => {
  const c = card("BSDB01-TX01(A)");

  it("両面 / 契約煌臨 adventData(own_turn) / アタック代替フリップは attackAlternativeFlip 宣言・自己コスト破壊は maxCostSource で配線 / OC unblockable+immunity", () => {
    expect(c.isDoubleSided).toBe(true);
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("own_turn");
    expect(c.attackAlternativeFlip).toEqual({ countIncreaseAmount: 3 });
    // [6,7]『煌臨/アタック時』コスト以下2体まで破壊 = 動的 maxCostSource + count{min:0,max:2}。
    const destroy = c.effects![0]!;
    expect(destroy.stub).toBeUndefined();
    const action = destroy.steps[0]!.action;
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.maxCostSource).toBe("self_effective_cost");
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.count).toEqual({ min: 0, max: 2 });
    } else {
      throw new Error("destroy filter target expected");
    }
    const oc = c.effects![1]!;
    expect(oc.timing).toEqual({ kind: "continuous" });
    expect(oc.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "count_value", player: "self", min: 10 },
      {
        kind: "self_state",
        reference: "self",
        battleState: "attacking",
        state: "on_field",
      },
    ]);
    expect(oc.steps[0]!.action.kind).toBe("unblockable");
    expect(oc.steps[1]!.action.kind).toBe("effect_immunity");
    // シンボル固定 = override_properties + duration:{scope:"attack"}（ENGINE-attack-scope-ce-expiry fix 後に表現可能、stub 解消）。
    expect(oc.stub).toBeUndefined();
    expect(oc.steps[2]!.action.kind).toBe("override_properties");
    const symbolAction = oc.steps[2]!.action as Extract<
      (typeof oc.steps)[2]["action"],
      { kind: "override_properties" }
    >;
    expect(symbolAction.properties.symbols).toEqual([
      "red",
      "red",
      "blue",
      "blue",
    ]);
    expect(symbolAction.properties.symbolCountFixed).toBe(true);
    expect(symbolAction.duration).toEqual({ scope: "while_on_field" });
  });

  it("backFace(B) は本文4行を継続3件と離脱誘発へ完全変換する", () => {
    const back = c.backFace;
    expect(back?.cardNo).toBe("BSDB01-TX01(B)");
    expect(back?.effects).toHaveLength(2);

    const continuous = back!.effects![0]!;
    expect(continuous.timing).toEqual({ kind: "continuous" });
    expect(continuous.condition).toEqual([{ kind: "min_level", value: 1 }]);
    expect(continuous.steps.map((step) => step.action.kind)).toEqual([
      "prevent_battle",
      "prevent_normal_core_move",
      "block_unblockable",
    ]);
    expect(continuous.textRef).toEqual([0, 1]);

    const leaveReward = back!.effects![1]!;
    expect(leaveReward.timing).toMatchObject({
      kind: "game_event",
      player: "opponent",
      event: "leave_field",
      triggerFilter: { category: ["spirit", "ultimate", "nexus"] },
      cause: ["opponent_effect", "battle", "opponent_bp_compare"],
      sourceWhose: "either",
    });
    expect(leaveReward.condition).toEqual([
      { kind: "min_level", value: 1 },
      { kind: "count_value", player: "self", min: 14 },
    ]);
    expect(leaveReward.steps[0]!.action.kind).toBe("recover");
    expect(leaveReward.steps[0]!.choice?.[0]).toMatchObject({
      prompt: {
        sourceText:
          "〔ステップに1回:同名〕自分はデッキの上から2枚ドローできる。",
      },
      action: { kind: "draw", player: "self", count: 2 },
      usageLimit: { kind: "per_card_name", duration: "step" },
    });
    expect(leaveReward.steps[1]).toMatchObject({
      executionMode: "optional",
      condition: [{ kind: "field_card_count", player: "opponent", max: 0 }],
      action: { kind: "reverse_rebirth", mode: "flip" },
    });
  });

  it("[board] B面は通常コアを支払いに使えず、ソウルコアは場から支払え、離脱時のコア退避は行う", () => {
    const back = synthesizeBackFaceDefinition(c, c.backFace!);
    const getBackDef = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getDef(id);
    const source = createCardInstance(back, {
      instanceId: "tx01-back-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [source],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          trashNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: source.instanceId },
        },
        {},
      ],
    });
    const rebuilt = rebuildContinuousEffectsFromField(before, getBackDef);
    expect(
      rebuilt.activeContinuousEffects.map((effect) => effect.modifierTag)
    ).toEqual(
      expect.arrayContaining([
        "prevent_battle_attack",
        "prevent_normal_core_move",
        "block_unblockable",
      ])
    );

    const normalMove = moveNormalCores(
      rebuilt,
      { kind: "card", instanceId: source.instanceId },
      { kind: "reserve", playerId: ALICE },
      1,
      getBackDef
    );
    expect(
      normalMove.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.normalCoreCount
    ).toBe(2);
    expect(
      normalMove.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(0);

    expect(
      getAvailableOnBoardCorePaymentSources(rebuilt, ALICE, getBackDef)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: source.instanceId,
          availableCoreAmount: 1,
          soulCoreAvailable: true,
        }),
      ])
    );
    expect(() =>
      applyCardCostPayments({
        state: rebuilt,
        actingPlayerId: ALICE,
        chainId: "tx01-back-normal-core-payment",
        paymentSources: [
          {
            kind: "card",
            instanceId: source.instanceId,
            amount: 2,
            includeSoulCore: true,
          },
        ],
        getCardDefinitionById: getBackDef,
      })
    ).toThrow("Not enough movable cores");

    const paid = applyCardCostPayments({
      state: rebuilt,
      actingPlayerId: ALICE,
      chainId: "tx01-back-soul-core-payment",
      paymentSources: [
        {
          kind: "card",
          instanceId: source.instanceId,
          amount: 1,
          includeSoulCore: true,
        },
      ],
      getCardDefinitionById: getBackDef,
    });
    expect(
      paid.cardInstances.find((card) => card.instanceId === source.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    expect(
      paid.players.find((player) => player.id === ALICE)?.soulCoreLocation
    ).toEqual({
      kind: "trash",
    });

    const leftField = resolveCardLeavesFieldCores(
      rebuilt,
      source.instanceId,
      null,
      getBackDef
    );
    expect(
      leftField.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.normalCoreCount
    ).toBe(0);
    expect(
      leftField.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(2);
  });

  it("[board] B面は自身でアタックできない一方、ブロックされない相手をブロックできる", () => {
    const back = synthesizeBackFaceDefinition(c, c.backFace!);
    const getBackDef = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getDef(id);
    // B面の definitionId を持ちつつ、逆転醒先は印字 A 面のまま保持する実盤面状態。
    const source = {
      ...createCardInstance(c, {
        instanceId: "tx01-back-battle-guard",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      definitionId: back.cardNo,
    };
    const attacker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "tx01-back-unblockable-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ cardInstances: [source, attacker] });
    const rebuilt = rebuildContinuousEffectsFromField(base, getBackDef);

    const ownAttackActions = getLegalActions({
      state: { ...rebuilt, activePlayerId: ALICE, step: "attack" },
      actingPlayerId: ALICE,
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(
      ownAttackActions.some(
        (action) =>
          action.kind === "attack" &&
          action.sourceInstanceId === source.instanceId
      )
    ).toBe(false);

    const blockState: GameState = {
      ...rebuilt,
      activePlayerId: BOB,
      step: "attack",
      window: "declare_block",
      activeContinuousEffects: [
        ...rebuilt.activeContinuousEffects,
        {
          effectId: "tx01-back-unblockable-opponent",
          sourceInstanceId: attacker.instanceId,
          sourceDefinitionId: attacker.definitionId,
          actingPlayerId: BOB,
          duration: { scope: "battle" },
          createdAtTurn: rebuilt.turnNumber,
          createdAtAttackId: "attack-tx01-back-unblockable",
          modifierTag: "unblockable",
          targetInstanceId: attacker.instanceId,
        },
      ],
      activeAttack: {
        attackId: "attack-tx01-back-unblockable",
        primaryEntityId: "battle-tx01-back-unblockable",
        participantEntityIds: ["battle-tx01-back-unblockable"],
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [
          {
            participantEntityId: "battle-tx01-back-unblockable",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-tx01-back-unblockable"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-tx01-back-unblockable",
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
    const blockActions = getLegalActions({
      state: blockState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(
      blockActions.some(
        (action) =>
          action.kind === "block" &&
          action.sourceInstanceId === source.instanceId
      )
    ).toBe(true);
  });

  it("[board] B面の相手 field 離脱誘発は count14 と自分原因を要求し、回復/ドロー選択と空 field 時の任意反転を解決する", () => {
    const back = synthesizeBackFaceDefinition(c, c.backFace!);
    const getBackDef = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getDef(id);
    const getBackTriggeredEffectActions = buildTriggeredEffectLookup([back]);
    expect(
      getBackTriggeredEffectActions(back.cardNo)?.[0]?.choices?.[1]?.usageLimit
    ).toEqual({ kind: "per_card_name", duration: "step" });
    const reward = back.effects![1]!;

    const collectSourceChoices = (
      countValue: number,
      causePlayerId: string
    ) => {
      const source = {
        ...createCardInstance(c, {
          instanceId: `tx01-back-trigger-${countValue}-${causePlayerId}`,
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        definitionId: back.cardNo,
      };
      const effectSource = createCardInstance(card("BSDB01-C01"), {
        instanceId: `tx01-back-trigger-source-${countValue}-${causePlayerId}`,
        ownerPlayerId: causePlayerId,
        controllerPlayerId: causePlayerId,
        zone: "field",
        normalCoreCount: 1,
      });
      const target = createCardInstance(card("BSDB01-C05"), {
        instanceId: `tx01-back-trigger-target-${countValue}-${causePlayerId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        cardInstances: [source, effectSource, target],
        playerOverrides: [{ countValue }, {}],
      });
      const afterLeave = queuePendingLeave({
        state: before,
        instanceId: target.instanceId,
        kind: "destroy",
        cause: "effect_resolution",
        chainId: `chain:tx01-back-trigger:${countValue}:${causePlayerId}`,
        causePlayerId,
        causedByEffectSourceInstanceId: effectSource.instanceId,
      });
      // destroy の予約だけでは `leave_field` はまだ発火しない。実離脱を flush した
      // 境界でのみ、この本文の「相手のフィールドを離れたとき」を観測する。
      const flushed = flushPendingLeaves(afterLeave, getBackDef);
      const queued = collectAndQueueTriggerReactions({
        chainId: "test:bsdb01-cards:7331",
        beforeState: afterLeave,
        afterState: flushed,
        source: "action_resolution",
        causedByPlayerId: causePlayerId,
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
        getRegisteredBurstActions,
      });
      const leavePending = queued.pendingTriggeredEffects.find(
        (pending) =>
          pending.eventKind === "leave_field" &&
          pending.relatedInstanceId === target.instanceId
      );
      if (!leavePending) return [];
      return getAvailableTriggeredEffectSourceChoices({
        state: queued,
        pendingEffect: leavePending,
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
      }).filter(
        (choice) =>
          choice.sourceCard.instanceId === source.instanceId &&
          choice.actionRegistration.effectIndex === 1
      );
    };

    expect(collectSourceChoices(13, ALICE)).toHaveLength(0);
    expect(collectSourceChoices(14, BOB)).toHaveLength(0);
    expect(collectSourceChoices(14, ALICE)).toHaveLength(1);

    const recoverSource = {
      ...createCardInstance(c, {
        instanceId: "tx01-back-recover-and-flip",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      definitionId: back.cardNo,
    };
    const recoverBefore = createEmptyGameState({
      cardInstances: [recoverSource],
      playerOverrides: [{ countValue: 14 }, {}],
    });
    const afterRecover = executeAllOptionalSteps(
      executeEffect({
        chainId: "test:bsdb01-cards:7377",
        state: recoverBefore,
        effect: reward,
        effectIndex: 1,
        sourceInstanceId: recoverSource.instanceId,
        actingPlayerId: ALICE,
        choiceIndex: 0,
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }),
      getBackDef
    );
    const flipped = afterRecover.cardInstances.find(
      (card) => card.instanceId === recoverSource.instanceId
    )!;
    expect(flipped.exhaustState).toBe("recovered");
    expect(flipped.definitionId).toBe(c.cardNo);
    expect(aliceCount(afterRecover)).toBe(14);

    const declineSource = {
      ...createCardInstance(c, {
        instanceId: "tx01-back-decline-flip",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      definitionId: back.cardNo,
    };
    const declined = declineNextOptionalStep(
      executeEffect({
        chainId: "test:bsdb01-cards:7407",
        state: createEmptyGameState({
          cardInstances: [declineSource],
          playerOverrides: [{ countValue: 14 }, {}],
        }),
        effect: reward,
        effectIndex: 1,
        sourceInstanceId: declineSource.instanceId,
        actingPlayerId: ALICE,
        choiceIndex: 0,
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }),
      getBackDef
    );
    expect(
      declined.cardInstances.find(
        (card) => card.instanceId === declineSource.instanceId
      )?.definitionId
    ).toBe(back.cardNo);

    const drawSource = {
      ...createCardInstance(c, {
        instanceId: "tx01-back-draw-no-flip",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      definitionId: back.cardNo,
    };
    const remainingOpponent = createCardInstance(card("BSDB01-C05"), {
      instanceId: "tx01-back-remaining-opponent",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const drawBefore = createEmptyGameState({
      cardInstances: [drawSource, remainingOpponent],
      playerOverrides: [{ countValue: 14, handCount: 0, deckCount: 2 }, {}],
    });
    const afterDraw = executeEffect({
      chainId: "test:bsdb01-cards:7447",
      state: drawBefore,
      effect: reward,
      effectIndex: 1,
      sourceInstanceId: drawSource.instanceId,
      actingPlayerId: ALICE,
      choiceIndex: 1,
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      afterDraw.players.find((player) => player.id === ALICE)?.handCount
    ).toBe(2);
    expect(
      afterDraw.cardInstances.find(
        (card) => card.instanceId === drawSource.instanceId
      )?.definitionId
    ).toBe(back.cardNo);
    // 回復枝には制限を付けず、ドロー枝だけが step ごとの同名制限を持つ。
    expect(reward.usageLimit).toBeUndefined();
    expect(reward.steps[0]!.usageLimit).toBeUndefined();
    expect(reward.steps[0]!.choice?.[0]?.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "step",
    });
  });

  it("[board] B面は回復後に誘発した効果を解決してから空 field の任意反転を判定する", () => {
    const back = synthesizeBackFaceDefinition(c, c.backFace!);
    const recoverObserver: CardDefinition = {
      cardNo: "TEST-BSDB01-TX01-RECOVER-OBSERVER",
      name: "回復時の相手フィールド復帰",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "either",
            event: "recover",
            sourceWhose: "either",
          },
          applicability: { zone: "field" },
          steps: [{ action: { kind: "move_self", destination: "trash" } }],
        },
      ],
    };
    const getBackDef = (id: string): CardDefinition | undefined =>
      id === back.cardNo
        ? back
        : id === recoverObserver.cardNo
          ? recoverObserver
          : getDef(id);
    const getLocalTriggeredEffectActions = buildTriggeredEffectLookup([
      back,
      recoverObserver,
    ]);
    const source = {
      ...createCardInstance(c, {
        instanceId: "tx01-back-after-triggers-source",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      definitionId: back.cardNo,
    };
    const observer = createCardInstance(recoverObserver, {
      instanceId: "tx01-back-after-triggers-observer",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    let current = executeEffect({
      chainId: "test:bsdb01-cards:7529",
      state: {
        ...createEmptyGameState({
          cardInstances: [source, observer],
          playerOverrides: [{ countValue: 14 }, {}],
        }),
        activePlayerId: ALICE,
        step: "main",
        turnNumber: 2,
      },
      effect: back.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      choiceIndex: 0,
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions: getLocalTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    const localLegalActionLookups = {
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions: getLocalTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: () => [],
    };

    expect(current.pendingAfterTriggersContinuations).toHaveLength(1);
    expect(
      current.pendingTriggeredEffects.some(
        (pending) => pending.eventKind === "recover"
      )
    ).toBe(true);

    for (let guard = 0; guard < 10; guard++) {
      if (current.stackWindow !== null) {
        const pass = getLegalActions({
          state: current,
          actingPlayerId: current.stackWindow.priorityPlayerId,
          ...localLegalActionLookups,
        }).find((action) => action.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pass!,
          ...localLegalActionLookups,
        }).state;
        continue;
      }
      const resolveObserver = getLegalActions({
        state: current,
        actingPlayerId: BOB,
        ...localLegalActionLookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === observer.instanceId
      );
      if (!resolveObserver) break;
      current = applyLegalAction({
        state: current,
        action: resolveObserver,
        ...localLegalActionLookups,
      }).state;
    }

    expect(current.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(current.pendingStepOptionalChoice).not.toBeNull();
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === observer.instanceId
      )?.zone
    ).toBe("trash");
    current = executeNextOptionalStep(current, getBackDef);
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.definitionId
    ).toBe(c.cardNo);
    expect(
      current.log.some((entry) =>
        entry.startsWith("effect:after_triggers:resume:")
      )
    ).toBe(true);
  });

  it("[board] B面の同一ステップ2回目の離脱誘発ではドロー枝だけが封鎖され、回復枝は残る", () => {
    const back = synthesizeBackFaceDefinition(c, c.backFace!);
    const getBackDef = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getDef(id);
    const getBackTriggeredEffectActions = buildTriggeredEffectLookup([back]);
    const source = {
      ...createCardInstance(c, {
        instanceId: "tx01-back-choice-limit-source",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      definitionId: back.cardNo,
    };
    const effectSource = createCardInstance(card("BSDB01-C01"), {
      instanceId: "tx01-back-choice-limit-effect-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const firstTarget = createCardInstance(card("BSDB01-C05"), {
      instanceId: "tx01-back-choice-limit-first-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const secondTarget = createCardInstance(card("BSDB01-C05"), {
      instanceId: "tx01-back-choice-limit-second-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    // ドローの成功は実際に deck から hand へ移ったカードで確認する。deckCount だけを
    // 増減させる簡略盤面では StepResult が成功として記録されず、後続条件の不成立時に
    // 正当な usageLimit 払戻しとの区別ができない。
    const deckCards = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(card("BSDB01-C05"), {
        instanceId: `tx01-back-choice-limit-deck-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const queueLeaveTrigger = (state: GameState, targetInstanceId: string) => {
      const afterLeave = queuePendingLeave({
        state,
        instanceId: targetInstanceId,
        kind: "destroy",
        cause: "effect_resolution",
        chainId: `chain:tx01-back-choice-limit:${targetInstanceId}`,
        causePlayerId: ALICE,
        causedByEffectSourceInstanceId: effectSource.instanceId,
      });
      const flushed = flushPendingLeaves(afterLeave, getBackDef);
      return collectAndQueueTriggerReactions({
        chainId: "test:bsdb01-cards:7671",
        beforeState: afterLeave,
        afterState: flushed,
        source: "action_resolution",
        causedByPlayerId: ALICE,
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
        getRegisteredBurstActions,
      });
    };
    const getLeaveResolveAction = (state: GameState) => {
      const localLegalActionLookups = {
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions: () => [],
      };
      const action = getLegalActions({
        state,
        actingPlayerId: ALICE,
        ...localLegalActionLookups,
      }).find(
        (candidate) =>
          candidate.kind === "resolve_pending_triggered_effect" &&
          candidate.sourceInstanceId === source.instanceId &&
          candidate.skipOnly !== true
      );
      expect(action).toBeDefined();
      return action!;
    };

    const initial: GameState = {
      ...createEmptyGameState({
        cardInstances: [
          source,
          effectSource,
          firstTarget,
          secondTarget,
          ...deckCards,
        ],
        playerOverrides: [{ countValue: 14, handCount: 0, deckCount: 4 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
      turnNumber: 2,
    };
    const firstQueued = queueLeaveTrigger(initial, firstTarget.instanceId);
    const firstResolve = getLeaveResolveAction(firstQueued);
    expect(firstResolve.kind).toBe("resolve_pending_triggered_effect");
    expect(
      firstResolve.kind === "resolve_pending_triggered_effect"
        ? firstResolve.deferredChoiceIndexes
        : undefined
    ).toEqual([0, 1]);

    let current = applyLegalAction({
      state: firstQueued,
      action: firstResolve,
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: () => [],
    }).state;
    while (current.stackWindow !== null) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.stackWindow.priorityPlayerId,
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getBackDef,
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions: () => [],
      }).state;
    }
    const drawChoice = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(drawChoice).toBeDefined();
    expect(
      current.pendingStepChoice?.deferredStack?.triggeredSourceCardNo
    ).toBe(back.cardNo);
    expect(
      current.pendingStepChoice?.deferredStack?.triggeredRegistrationIndex
    ).toBe(0);
    current = applyLegalAction({
      state: current,
      action: drawChoice!,
      getCardDefinitionById: getBackDef,
      getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: () => [],
    }).state;
    expect(
      current.players.find((player) => player.id === ALICE)?.handCount
    ).toBe(2);
    expect(current.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: source.instanceId,
          effectLabel: "effect:1:choice:1",
          duration: "step",
        }),
      ])
    );
    expect(current.pendingStepOptionalChoice).toBeNull();

    const secondQueued = queueLeaveTrigger(current, secondTarget.instanceId);
    const secondResolve = getLeaveResolveAction(secondQueued);
    expect(secondResolve.kind).toBe("resolve_pending_triggered_effect");
    expect(
      secondResolve.kind === "resolve_pending_triggered_effect"
        ? secondResolve.deferredChoiceIndexes
        : undefined
    ).toEqual([0]);
  });

  it("[board] カウント10以上のアタック中、自身に unblockable CE が登録される", () => {
    const src = createCardInstance(c, {
      instanceId: "tx01-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2 到達 (requiredCores Lv2=3) で min_level:2 を満たす
    });
    // Lv2・カウント10以上の条件を満たす盤面（OC中見出しには属さない）。
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ countValue: 12 }, {}],
    });
    const after = runEffect(
      {
        ...before,
        step: "attack",
        activePlayerId: ALICE,
        battleEntities: [
          {
            entityId: "tx-attacker",
            memberInstanceIds: ["tx01-1"],
            resolvedBp: 15000,
            resolvedSymbols: ["red", "blue"],
            attackState: "attacking",
          },
        ],
      },
      c.effects![1]!,
      "tx01-1"
    );
    expect(after.activeContinuousEffects.length).toBeGreaterThan(
      before.activeContinuousEffects.length
    );
    expect(after.activeContinuousEffects.map((e) => e.modifierTag)).toContain(
      "unblockable"
    );
  });

  it("[board] OC シンボル赤2青2固定は追加シンボルと合体ブレイヴを抑止し、攻撃終了で失効する", () => {
    const braveDef = card("BSGE01-C05");
    const src = createCardInstance(c, {
      instanceId: "tx01-symbol-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
      attachedChildrenIds: ["tx01-symbol-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "tx01-symbol-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "tx01-symbol-1",
    });
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, brave],
        playerOverrides: [{ countValue: 12 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
      activeAttack: {
        attackId: "attack-tx01-symbol-1",
        primaryEntityId: "be-tx01-symbol",
        participantEntityIds: ["be-tx01-symbol"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "be-tx01-symbol",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["be-tx01-symbol"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-tx01-symbol",
          memberInstanceIds: ["tx01-symbol-1", "tx01-symbol-brave"],
          resolvedBp: 15000,
          resolvedSymbols: ["red", "blue", "purple"],
          attackState: "attacking",
        },
      ],
    };
    const afterOverride = runEffect(before, c.effects![1]!, "tx01-symbol-1");
    const withExternalSymbols = recomputeBattleEntityBp(
      {
        ...afterOverride,
        activeContinuousEffects: [
          ...afterOverride.activeContinuousEffects,
          symbolAdditionCE("tx01-symbol-1", "green"),
        ],
      },
      getDef
    );
    const fixedHost = withExternalSymbols.cardInstances.find(
      (ci) => ci.instanceId === "tx01-symbol-1"
    )!;
    expect(
      getCombinedUnitSymbols(withExternalSymbols, fixedHost, c, getDef)
    ).toEqual(["red", "red", "blue", "blue"]);
    expect(
      withExternalSymbols.battleEntities.find(
        (be) => be.entityId === "be-tx01-symbol"
      )?.resolvedSymbols
    ).toEqual(["red", "red", "blue", "blue"]);
    const bobLifeBefore = getPlayerLifeCoreCount(
      withExternalSymbols.players.find((p) => p.id === BOB)!
    );

    const resolved = executeBattleResolution({
      state: withExternalSymbols,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(
      getPlayerLifeCoreCount(resolved.state.players.find((p) => p.id === BOB)!)
    ).toBe(bobLifeBefore - 4);
    expect(
      resolved.state.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "tx01-symbol-1" &&
          ce.modifierTag === "override_properties"
      )
    ).toBeUndefined();
  });

  it("[board] アタック宣言の代わりに flip_instead_of_attack を選ぶと裏返り、カウント+3、疲労もバトルも発生しない", () => {
    const back = synthesizeBackFaceDefinition(c, c.backFace!);
    const getDefWithBack = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getDef(id);
    const getBackTriggeredEffectActions = buildTriggeredEffectLookup([
      ...ALL_CARDS,
      back,
    ]);
    const src = createCardInstance(c, {
      instanceId: "tx01-flip-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv1 (requiredCores=1)、B面 Lv1 requiredCores=1 も満たす
    });
    const before: GameState = {
      ...createEmptyGameState({ cardInstances: [src] }),
      turnNumber: 2,
      step: "attack",
    };

    const flipAction = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find(
      (a) =>
        a.kind === "flip_instead_of_attack" &&
        a.sourceInstanceId === src.instanceId
    );
    expect(flipAction).toBeDefined();

    // 通常のアタック宣言も並行して legal のはず (代替として排他選択できる形)。
    const attackAction = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find(
      (a) => a.kind === "attack" && a.sourceInstanceId === src.instanceId
    );
    expect(attackAction).toBeDefined();

    let after = applyLegalAction({
      state: before,
      action: flipAction!,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    // declare_manifest 同様スタック窓を開くだけなので、相手 (BOB) のパスで窓を閉じ
    // deferred 解決 (resolveDeferredFlipInsteadOfAttackStack) まで進める。
    let guard = 0;
    while (after.stackWindow && guard++ < 10) {
      const passActions = getLegalActions({
        state: after,
        actingPlayerId: after.stackWindow.priorityPlayerId,
        getCardDefinitionById: getDefWithBack,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
        getRegisteredBurstActions,
      } as unknown as Parameters<typeof getLegalActions>[0]);
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      after = applyLegalAction({
        state: after,
        action: pass!,
        getCardDefinitionById: getDefWithBack,
        getRegisteredTriggeredEffectActions: getBackTriggeredEffectActions,
        getRegisteredBurstActions,
      }).state;
    }

    const flipped = after.cardInstances.find(
      (ci) => ci.instanceId === "tx01-flip-1"
    )!;
    expect(flipped.definitionId).toBe("BSDB01-TX01(B)");
    // 裁定確定(2026-08-01): 疲労しないし、バトルも発生しない。
    expect(flipped.exhaustState).toBe("recovered");
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(3);
    expect(after.activeAttack).toBeNull();
    expect(after.battleEntities).toEqual([]);
    // B 面の常時効果は面反転の同じ state 遷移で登録される。次の action 境界まで
    // 未登録にすると、effect-debug が missing_continuous_effect として検出する。
    expect(
      after.activeContinuousEffects
        .filter((ce) => ce.sourceInstanceId === src.instanceId)
        .map((ce) => ce.modifierTag)
        .sort()
    ).toEqual([
      "block_unblockable",
      "prevent_battle_attack",
      "prevent_normal_core_move",
    ]);
    expect(
      collectGameStateInvariantIssues(after, {
        getCardDefinitionById: getDefWithBack,
      })
    ).toEqual([]);
  });

  it("先攻1ターン目は flip_instead_of_attack も legal にならない (attack と同じガード)", () => {
    const src = createCardInstance(c, {
      instanceId: "tx01-flip-turn1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = {
      ...createEmptyGameState({ cardInstances: [src] }),
      turnNumber: 1,
      step: "attack",
    };
    const actions = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(
      actions.find(
        (a) =>
          a.kind === "flip_instead_of_attack" &&
          a.sourceInstanceId === "tx01-flip-turn1"
      )
    ).toBeUndefined();
    expect(
      actions.find(
        (a) => a.kind === "attack" && a.sourceInstanceId === "tx01-flip-turn1"
      )
    ).toBeUndefined();
  });

  it("[board] 宣言スタック窓の間に対象が疲労 (legality-changed) したら flip_instead_of_attack は不発でキャンセルされる", () => {
    const src = createCardInstance(c, {
      instanceId: "tx01-flip-cancel",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = {
      ...createEmptyGameState({ cardInstances: [src] }),
      turnNumber: 2,
      step: "attack",
    };

    const flipAction = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find(
      (a) =>
        a.kind === "flip_instead_of_attack" &&
        a.sourceInstanceId === src.instanceId
    );
    expect(flipAction).toBeDefined();

    let after = applyLegalAction({
      state: before,
      action: flipAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(after.stackWindow).not.toBeNull();

    // 窓の間に相手が対象を疲労させた想定 (何らかのスタック効果の帰結を模擬)。
    // confirmAttackDeclarationAsAction の legality-changed 再チェックと同型の
    // ガードが flip 側にも働くことを確認する回帰テスト。
    after = {
      ...after,
      cardInstances: after.cardInstances.map((ci) =>
        ci.instanceId === "tx01-flip-cancel"
          ? { ...ci, exhaustState: "exhausted" as const }
          : ci
      ),
    };

    let guard = 0;
    while (after.stackWindow && guard++ < 10) {
      const passActions = getLegalActions({
        state: after,
        actingPlayerId: after.stackWindow.priorityPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      } as unknown as Parameters<typeof getLegalActions>[0]);
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      after = applyLegalAction({
        state: after,
        action: pass!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }).state;
    }

    const unflipped = after.cardInstances.find(
      (ci) => ci.instanceId === "tx01-flip-cancel"
    )!;
    expect(unflipped.definitionId).toBe("BSDB01-TX01(A)");
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(0);
    expect(
      after.log.some((l) =>
        l.startsWith(
          "flip_instead_of_attack:cancelled:tx01-flip-cancel:legality-changed:"
        )
      )
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// X01 超サイヤ人3 孫悟空 — 自ターン孫悟空破壊耐性 / BP per-count / 煌臨中BP予算破壊
// ════════════════════════════════════════════════════════════════

describe("BSDB01-X01 超サイヤ人3 孫悟空", () => {
  const c = card("BSDB01-X01");

  it("契約煌臨 adventData(own_turn) / カウント比例 BP+1000 / 自ターン孫悟空破壊耐性 / 煌臨中BP予算破壊", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("own_turn");
    // effects[0] = カウント1につき孫悟空すべて BP+1000（DynamicCount 比例継続）
    const bp = c.effects![0]!;
    expect(bp.timing.kind).toBe("continuous");
    expect(bp.stub).toBeUndefined();
    const bpAction = bp.steps[0]!.action;
    expect(bpAction.kind).toBe("bp_modify");
    if (bpAction.kind === "bp_modify") {
      expect(bpAction.target.count).toBe("all");
      expect(typeof bpAction.amount).toBe("object");
      if (typeof bpAction.amount === "object") {
        expect(bpAction.amount.source).toEqual({
          kind: "count_value",
          player: "self",
        });
        expect(bpAction.amount.multiplier).toBe(1000);
      }
    }
    // effects[1] = 自ターン中 孫悟空すべて 破壊耐性
    const res = c.effects![1]!.steps[0]!.action;
    expect(c.effects![1]!.timingScope).toEqual({
      player: "self",
      period: "turn",
    });
    expect(res.kind).toBe("effect_resistance");
    if (res.kind === "effect_resistance") {
      expect(res.resistsOutcome).toBe("destroy");
      if (typeof res.target === "object" && "filter" in res.target) {
        expect(res.target.filter.cardName).toEqual([{ contains: "孫悟空" }]);
        expect(res.target.count).toBe("all");
      }
    }
    // effects[2] = 【煌臨中】BP合計(このスピリットのBP)まで破壊→条件付きライフコア移動
    const adventAttack = c.effects![2]!;
    expect(adventAttack.stub).toBeUndefined();
    expect(adventAttack.condition).toEqual([
      { kind: "self_state", state: "advented" },
      { kind: "field_has", player: "opponent", minCount: 1 },
    ]);
    const destroy = adventAttack.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.count).toEqual({ min: 0 });
      expect(destroy.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(destroy.target.budget).toEqual({
        metric: "bp",
        amount: { source: { kind: "source_effective_bp" } },
      });
    }
    expect(adventAttack.steps[1]).toMatchObject({
      connector: "after_state_check",
      stepCondition: {
        kind: "ref_count",
        stepId: "bp-budget-destroy",
        min: 1,
      },
      condition: [
        { kind: "count_value", player: "self", min: 9 },
        { kind: "min_level", value: 2 },
        { kind: "self_state", state: "on_field" },
        { kind: "self_bp", min: 40000 },
      ],
      usageLimit: { kind: "per_instance", duration: "turn" },
      executionMode: "optional",
    });
  });

  it("[board] 継続効果でカウント比例 BP CE + 破壊耐性 CE が登録される", () => {
    const src = createCardInstance(c, {
      instanceId: "x01-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const before = createEmptyGameState({ cardInstances: [src] });
    // BP per-count CE
    const afterBp = runEffect(before, c.effects![0]!, "x01-1");
    const bpCe = afterBp.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCe).toBeDefined();
    expect(bpCe!.modifierAmountDynamic).toBeDefined();
    // 破壊耐性 CE
    const afterRes = runEffect(before, c.effects![1]!, "x01-1");
    expect(afterRes.activeContinuousEffects.length).toBeGreaterThan(
      before.activeContinuousEffects.length
    );
  });

  it("[board] 煌臨中アタック時、自身の実効BPを予算にして任意破壊し、破壊後のライフ移動はターンに1回だけ行う", () => {
    const src = {
      ...createCardInstance(c, {
        instanceId: "x01-budget",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      }),
      underCards: [
        {
          cardInstanceId: "x01-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const adventSource = createCardInstance(card("BSDB01-C01"), {
      instanceId: "x01-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemyA = createCardInstance(card("BSDB01-C02"), {
      instanceId: "x01-enemy-a",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyB = createCardInstance(card("BSDB01-X02"), {
      instanceId: "x01-enemy-b",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const enemyC = createCardInstance(card("BSDB01-C05"), {
      instanceId: "x01-enemy-c",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, adventSource, enemyA, enemyB, enemyC],
      playerOverrides: [{ countValue: 23 }, {}],
    });
    before.step = "attack";
    before.activePlayerId = ALICE;

    const withBpCe = runEffect(before, c.effects![0]!, "x01-budget");
    const afterAttack = runEffect(withBpCe, c.effects![2]!, "x01-budget");
    const destroyPending = afterAttack.pendingStepOptionalTargetSelection!;
    expect(destroyPending.bpBudgetAmount).toBe(57000);
    expect(destroyPending.requiredTargetCount).toBe(0);
    expect(destroyPending.candidateInstanceIds).toEqual([
      "x01-enemy-a",
      "x01-enemy-b",
      "x01-enemy-c",
    ]);

    const afterDestroy = resolvePendingStepOptionalTargetSelection(
      afterAttack,
      ["x01-enemy-a", "x01-enemy-b"]
    );
    expect(
      afterDestroy.cardInstances.find(
        (card) => card.instanceId === "x01-enemy-a"
      )?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      afterDestroy.cardInstances.find(
        (card) => card.instanceId === "x01-enemy-b"
      )?.pendingLeaveKind
    ).toBe("destroy");
    expect(
      afterDestroy.cardInstances.find(
        (card) => card.instanceId === "x01-enemy-c"
      )?.zone
    ).toBe("field");

    const bobBefore = afterDestroy.players.find((p) => p.id === BOB)!;
    const bobLifeBefore = getPlayerLifeCoreCount(bobBefore);
    const bobReserveBefore = getPlayerReserveCoreCount(bobBefore);
    const afterLife = executeNextOptionalStep(afterDestroy);
    const bobAfter = afterLife.players.find((p) => p.id === BOB)!;
    expect(getPlayerLifeCoreCount(bobAfter)).toBe(bobLifeBefore - 1);
    // ライフ1個に加え、この時点で初めて破壊対象2体の残存3コアを戻す。
    expect(getPlayerReserveCoreCount(bobAfter)).toBe(bobReserveBefore + 4);
    expect(
      afterLife.effectUsageRecords.filter(
        (record) =>
          record.sourceInstanceId === "x01-budget" && record.duration === "turn"
      )
    ).toHaveLength(1);

    // 「1体以上破壊したとき、ターンに1回」は破壊全体ではなく後段の
    // ライフ→リザーブ移動だけを制限する。同一ターンの次のアタックでも残った
    // 対象は破壊できるが、ライフコアは追加で移動しない。
    const afterSecondAttack = runEffect(
      afterLife,
      c.effects![2]!,
      "x01-budget"
    );
    const afterSecondDestroy = resolvePendingStepOptionalTargetSelection(
      afterSecondAttack,
      ["x01-enemy-c"]
    );
    const bobAfterSecondDestroy = afterSecondDestroy.players.find(
      (p) => p.id === BOB
    )!;
    expect(
      afterSecondDestroy.cardInstances.find(
        (card) => card.instanceId === "x01-enemy-c"
      )?.zone
    ).toBe("trash");
    expect(afterSecondDestroy.pendingStepOptionalChoice).toBeNull();
    expect(getPlayerLifeCoreCount(bobAfterSecondDestroy)).toBe(
      getPlayerLifeCoreCount(bobAfter)
    );
    expect(getPlayerReserveCoreCount(bobAfterSecondDestroy)).toBe(
      // 破壊された enemyC の通常コアだけがリザーブへ戻る。ライフからの追加移動はない。
      getPlayerReserveCoreCount(bobAfter) + 1
    );
    expect(
      afterSecondDestroy.effectUsageRecords.filter(
        (record) =>
          record.sourceInstanceId === "x01-budget" && record.duration === "turn"
      )
    ).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════
// X02 超サイヤ人2 ベジータ -天使- — 本来コスト8以下2体破壊 / 防げない / OC 煌臨中マジック税
// ════════════════════════════════════════════════════════════════

describe("BSDB01-X02 超サイヤ人2 ベジータ -天使-", () => {
  const c = card("BSDB01-X02");

  it("契約煌臨 adventData(both_attack_step) / 本来コスト8以下2体破壊 (カウント7以上で防げない) / OC 煌臨中マジック税", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    const e = c.effects![0]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: ["advent", "attack"],
    });
    const destroy = e.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(destroy.target.filter.maxCost).toBe(8);
      expect(destroy.target.count).toEqual({ min: 0, max: 2 });
    }
    // 条件付き防止不可: カウント7以上で unpreventable（stub 解消済み）。
    expect(e.stub).toBeUndefined();
    expect(e.preventionLevel).toBe("unpreventable");
    expect(e.preventionLevelCondition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
    ]);
    const tax = c.effects![1]!;
    expect(tax.stub).toBeUndefined();
    expect(tax.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(tax.timingScope).toEqual({ player: "self", period: "attack" });
    expect(tax.condition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
      { kind: "self_state", state: "advented" },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "孫悟空" }],
        minCount: 1,
      },
    ]);
    const action = tax.steps[0]!.action;
    expect(action.kind).toBe("cost_modify");
    if (action.kind === "cost_modify") {
      expect(action.player).toBe("opponent");
      expect(action.cardFilter).toEqual({
        category: ["magic"],
        usingEffectMode: ["main", "flash"],
      });
      expect(action.modifier).toEqual({
        additionalCostValue: {
          source: { kind: "count_value", player: "self" },
          divisor: 7,
          groupMultiplier: 3,
        },
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("[board] 本来コスト8以下の相手スピリットが破壊予約される (fixed count=1 変種)", () => {
    // カード本体は「2体まで」= count {min,max} (非対話で min=0 解決)。破壊機構＋maxCost フィルタの
    // 盤面変化検証は fixed count 変種で行う (BSTH01-X08 board test と同方針)。
    const src = createCardInstance(c, {
      instanceId: "vegeta-x02",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    // BSDB01-C05 クリリン: 本来コスト3 ≤ 8。
    const enemy = createCardInstance(card("BSDB01-C05"), {
      instanceId: "enemy-x02",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const destroyAction = c.effects![0]!.steps[0]!.action;
    if (
      destroyAction.kind !== "destroy" ||
      typeof destroyAction.target !== "object" ||
      !("filter" in destroyAction.target)
    )
      throw new Error("expected destroy filter action");
    const fixedVariant: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { ...destroyAction.target, count: 1 },
          },
        },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemy] }),
      fixedVariant,
      "vegeta-x02"
    );
    const enemyAfter = after.cardInstances.find(
      (x) => x.instanceId === "enemy-x02"
    )!;
    expect(enemyAfter.pendingLeaveKind).toBe("destroy");
  });

  it("[board] OC中＆煌臨中かつ孫悟空がいる間、相手の手札マジック main/flash 使用にカウント7につき+3する", () => {
    const src = {
      ...createCardInstance(c, {
        instanceId: "vegeta-x02-tax",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      underCards: [
        {
          cardInstanceId: "vegeta-x02-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const adventSource = createCardInstance(card("BSDB01-C02"), {
      instanceId: "vegeta-x02-advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const goku = createCardInstance(card("BSDB01-C01"), {
      instanceId: "goku-for-x02-tax",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(card("BSDB01-R03"), {
      instanceId: "bob-magic-for-x02-tax",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [src, adventSource, goku, magic],
      playerOverrides: [{ countValue: 14 }, {}],
    });
    before.step = "attack";
    before.activePlayerId = ALICE;

    const after = runEffect(before, c.effects![1]!, "vegeta-x02-tax");
    const ce = after.activeContinuousEffects.find(
      (x) => x.modifierTag === "additional_cost"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetFilter).toMatchObject({
      player: "opponent",
      category: ["magic"],
      usingEffectMode: ["main", "flash"],
    });
    expect(ce!.modifierAmountDynamic).toEqual({
      source: { kind: "count_value", player: "self" },
      divisor: 7,
      groupMultiplier: 3,
    });
    expect(
      getApplicableAdditionalCostDelta(after, BOB, card("BSDB01-R03"), {
        card: magic,
        cardZone: "hand",
        cardEffectMode: "flash",
        getCardDefinitionById: getDef,
      })
    ).toBe(6);
    expect(
      getApplicableAdditionalCostDelta(after, BOB, card("BSDB01-R03"), {
        card: { ...magic, zone: "trash" },
        cardZone: "trash",
        cardEffectMode: "flash",
        getCardDefinitionById: getDef,
      })
    ).toBe(6);
    expect(
      getApplicableAdditionalCostDelta(after, BOB, card("BSDB01-R03"), {
        card: magic,
        cardZone: "hand",
        cardEffectMode: "stack",
        getCardDefinitionById: getDef,
      })
    ).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// R03 ファイナルフラッシュ — [0]継続コスト固定+トラッシュ使用許可 / [2,3]フラッシュ grant_effect
// ════════════════════════════════════════════════════════════════

describe("BSDB01-R03 ファイナルフラッシュ", () => {
  const c = card("BSDB01-R03");

  it("[2,3] フラッシュ grant_effect: 自分の『ベジータ』すべてにバトル終了時誘発を付与（ターン1回:同名）", () => {
    const grant = c.effects![1]!;
    expect(grant.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(grant.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const step = grant.steps[0]!;
    // 〔ターンに1回:同名〕は外側マジックの発揮制限だけ。引用符内の付与誘発は
    // 各ベジータに独立して付与されるため、本文scopeを nested Effect へ明示する。
    expect(step.prompt?.sourceText).toBe(
      "『このスピリットのアタック時』バトル終了時、自分のカウント9以上で、相手のフィールドに魂状態以外のカードがあれば、相手のライフのコア2個をトラッシュに置く。"
    );
    expect(c.effects![2]!.steps[0]!.prompt?.sourceText).toBe(
      step.prompt?.sourceText
    );
    const action = step.action;
    expect(action.kind).toBe("grant_effect");
    if (action.kind === "grant_effect") {
      // 対象: 自分の「ベジータ」(部分一致) すべて。
      if (action.target.kind === "filter") {
        expect(action.target.player).toBe("self");
        expect(action.target.count).toBe("all");
        expect(action.target.filter.cardName).toEqual([
          { contains: "ベジータ" },
        ]);
      } else {
        throw new Error("expected filter target");
      }
      // 付与は「このターンの間」= duration turn（即時型持続）。
      expect(action.duration).toEqual({ scope: "turn" });
      // 付与する誘発: battle_end + in_battle:attacking（収集時ゲート）+ count_value/field_has（解決時）。
      const g = action.grantedEffect;
      expect(g.timing).toEqual({ kind: "card_event", event: "battle_end" });
      expect(g.condition).toEqual([
        { kind: "in_battle", state: "attacking" },
        { kind: "count_value", player: "self", min: 9 },
        { kind: "field_has", player: "opponent", minCount: 1 },
      ]);
      const move = g.steps[0]!.action;
      expect(move.kind).toBe("core_move");
      if (move.kind === "core_move") {
        expect(move.from).toEqual({ kind: "life", player: "opponent" });
        expect(move.to).toEqual({ kind: "trash", player: "opponent" });
        expect(move.amount).toBe(2);
      }
    }
  });

  it("[0] 継続コスト固定（ベジータ攻撃中はコスト3上書き）が手札/トラッシュ両ゾーンに効く（engine-magic-trash-use-permission）", () => {
    expect(c.effects).toHaveLength(3);
    const costFix = c.effects![0]!;
    expect(costFix.stub).toBeUndefined();
    expect(costFix.timing).toEqual({ kind: "continuous" });
    expect(costFix.applicability).toEqual({ zone: ["hand", "trash"] });
    expect(costFix.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ベジータ" }],
        battleState: "attacking",
      },
    ]);
    const action = costFix.steps[0]!.action;
    expect(action.kind).toBe("cost_modify");
    if (action.kind === "cost_modify") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.modifier).toEqual({ override: 3 });
    }
  });

  it("[0]+[2,3] トラッシュ使用 variant は applicability.zone:trash + 同条件を持ち、通常 variant とは別 registration になる", () => {
    const trashVariant = c.effects![2]!;
    expect(trashVariant.stub).toBeUndefined();
    expect(trashVariant.applicability).toEqual({ zone: ["trash"] });
    expect(trashVariant.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ベジータ" }],
        battleState: "attacking",
      },
    ]);
    expect(trashVariant.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(trashVariant.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(trashVariant.steps[0]!.action.kind).toBe("grant_effect");
    // 手札/手元 variant (index 1) は applicability 未指定 = 既定ゾーンのまま。
    expect(c.effects![1]!.applicability).toBeUndefined();
  });

  it("[legal action] トラッシュ使用 variant は use_magic のみに登録され、use_hand_card_effect には二重登録されない（engine-trash-zone-flash-activated-recovery の hand-activated zone 一般化との衝突ガード、adversarial verifier 2026-07-13 refute）", () => {
    const magicLookup = buildMagicLookup([c]);
    const handLookup = buildHandActivatedEffectLookup([c]);
    expect(handLookup(c.cardNo) ?? []).toEqual([]);
    expect(
      (magicLookup(c.cardNo) ?? []).some(
        (r) => r.timing === "flash" && r.applicability?.zone !== undefined
      )
    ).toBe(true);

    const source = createCardInstance(c, {
      instanceId: "ff-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "default",
    };

    // 条件 (field_has「ベジータ」battleState:attacking) は満たさないため use_magic 自体は
    // 出ないが、二重登録ガードの本旨は use_hand_card_effect が registration レベルで
    // 一切生成されないこと（条件評価より前の zone gate で完全排除される）。
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredHandActivatedEffectActions: handLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) => "sourceInstanceId" in a && a.sourceInstanceId === "ff-trash"
    );

    expect(actions.some((a) => a.kind === "use_hand_card_effect")).toBe(false);
  });

  it("[board] grant 後、ベジータのバトル終了時にカウント9以上・相手フィールドに非魂カードあれば相手ライフ2コアがトラッシュへ", () => {
    const grant = c.effects![1]!;
    const source = createCardInstance(c, {
      // マジック R03 自身は使用中扱いだが、ソースとして field 上に置いて簡略化。
      instanceId: "ff-1",
      ownerPlayerId: ALICE,
      zone: "in_use",
      normalCoreCount: 0,
    });
    const vegeta = createCardInstance(card("BSDB01-C02"), {
      instanceId: "vegeta-r03",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手フィールドに非魂状態のカード（field_has minCount:1 を満たす）。
    const enemy = createCardInstance(card("BSDB01-C05"), {
      instanceId: "enemy-r03",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [source, vegeta, enemy],
    });
    const attacking: BattleEntity = {
      entityId: "battle-vegeta-r03",
      memberInstanceIds: ["vegeta-r03"],
      resolvedBp: 5000,
      resolvedSymbols: ["red"],
      attackState: "attacking",
    };
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      battleEntities: [attacking],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 9 } : p
      ),
    };
    // grant を実行 → ベジータに granted_effect CE が付く。
    const granted = runEffect(state, grant, "ff-1");
    expect(
      granted.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === "vegeta-r03"
      )
    ).toBe(true);
    // ベジータのバトル終了 → 検出時（reset 前 in_battle=true）に pending を積む。
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      granted,
      [
        {
          chainId: "test:bsdb01-cards:8780",
          eventKind: "battle_end",
          relatedInstanceId: "vegeta-r03",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    const pending = queued.pendingTriggeredEffects.filter(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    expect(pending).toHaveLength(1);
    // バトル reset 後でも scope は除外され、value 条件を満たすので適用される。
    const afterReset: GameState = { ...queued, battleEntities: [] };
    const actions = getLegalActions({
      state: afterReset,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const resolve = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending[0]!.pendingId
    );
    expect(resolve).toBeDefined();
    let current = (
      applyLegalAction({
        state: afterReset,
        action: resolve!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;
    // スタック窓があれば双方 pass で閉じる。
    let guard = 0;
    while (current.stackWindow && guard++ < 10) {
      const responderId = current.stackWindow.priorityPlayerId;
      const passActions = getLegalActions({
        state: current,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      } as unknown as Parameters<typeof getLegalActions>[0]);
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = (
        applyLegalAction({
          state: current,
          action: pass!,
          getCardDefinitionById: getDef,
        }) as { state: GameState }
      ).state;
    }
    const bob = current.players.find((p) => p.id === BOB)!;
    // 相手ライフ 5 → 3（2 コアがトラッシュへ）。
    expect(bob.lifeNormalCoreCount).toBe(3);
  });

  it("[mandatory] 付与誘発の legal action は executionMode=mandatory（強制付与はスキップ不可）", () => {
    // grantedEffect.executionMode='mandatory' を CE.metadata に格納したまま誘発を queue したとき、
    // legal-actions-availability が executionMode='mandatory' を出すこと（=GUI 上「解決」のみ
    // 表示、apply 側 skipOptional が無効）を確認する。audit BSDB01-R03 (2026-06-22) の回帰ガード。
    const grant = c.effects![1]!;
    const source = createCardInstance(c, {
      instanceId: "ff-mand",
      ownerPlayerId: ALICE,
      zone: "in_use",
      normalCoreCount: 0,
    });
    const vegeta = createCardInstance(card("BSDB01-C02"), {
      instanceId: "vegeta-mand",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(card("BSDB01-C05"), {
      instanceId: "enemy-mand",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [source, vegeta, enemy],
    });
    const attacking: BattleEntity = {
      entityId: "battle-vegeta-mand",
      memberInstanceIds: ["vegeta-mand"],
      resolvedBp: 5000,
      resolvedSymbols: ["red"],
      attackState: "attacking",
    };
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      battleEntities: [attacking],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 9 } : p
      ),
    };
    const granted = runEffect(state, grant, "ff-mand");
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      granted,
      [
        {
          chainId: "test:bsdb01-cards:8883",
          eventKind: "battle_end",
          relatedInstanceId: "vegeta-mand",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    const afterReset: GameState = { ...queued, battleEntities: [] };
    const actions = getLegalActions({
      state: afterReset,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const resolve = actions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    ) as { executionMode?: string } | undefined;
    expect(resolve).toBeDefined();
    expect(resolve!.executionMode).toBe("mandatory");
    // 強制付与は skipOptionalEffect=true でも skip されず、最終盤面で相手ライフが減ること。
    // apply 側 (legal-actions-apply.ts §11404) は executionMode==='optional' のときだけ
    // skipOptional を許可するため、ここでは強制解決されるはず。
    let resolved = (
      applyLegalAction({
        state: afterReset,
        action: resolve!,
        getCardDefinitionById: getDef,
        skipOptionalEffect: true,
      } as unknown as Parameters<typeof applyLegalAction>[0]) as {
        state: GameState;
        skipped?: boolean;
      }
    ).state;
    // スタック窓があれば双方 pass で閉じる。
    let guard = 0;
    while (resolved.stackWindow && guard++ < 10) {
      const responderId = resolved.stackWindow.priorityPlayerId;
      const passActions = getLegalActions({
        state: resolved,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      } as unknown as Parameters<typeof getLegalActions>[0]);
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      resolved = (
        applyLegalAction({
          state: resolved,
          action: pass!,
          getCardDefinitionById: getDef,
        }) as { state: GameState }
      ).state;
    }
    const bob = resolved.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(3);
  });
});
