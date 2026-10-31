/**
 * oracle-system.ts — 神託/導託サブシステム
 *
 * 創界神/導界者ネクサスの神託トリガー判定・コア+1・配置時デッキ→トラッシュを管理する。
 *
 * 神託トリガー: 対応系統カードの召喚/煌臨/配置/使用時、ボイドから創界神にコア+1（任意）。
 * 配置時神託: 創界神を配置したとき同名がなければデッキ上3枚をトラッシュに置き、マッチ分コア+1。
 *
 * 注意: カードテキストに「オープン」と明記されていない場合、デッキ→トラッシュ移動は
 * オープンを介さない直接移動として扱う（相手のトラッシュ保護効果等の判定に影響）。
 */

import { replaceCardInstances } from "../zone/card-instance-state";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  GrandwalkerData,
  OracleCondition,
  OracleTriggerKind,
  ActiveStack,
  PendingTriggeredEffect,
  TriggeredMechanic,
} from "../model";
import {
  cardDefinitionHasMechanic,
  createMechanicPendingTriggeredEffect,
  isGrandwalkerOrGuidedNexus,
} from "../model";
import { getCardById } from "../card/card-lookup";
import {
  matchesCardName,
  matchesTribes,
  matchesCardFilterByDef,
} from "../card/card-filter";
import { getEffectiveLevel } from "../battle/battle-shared";
import {
  moveNormalCores,
  getNormalCoreCountAtLocation,
} from "../core/core-system";
import { executeMoveCardPrimitive } from "../effect/native-move-core-handlers";
import { processMovedToTrashEffects } from "../effect/structured-trash-ops";
import { executeReturnFromTrash } from "../effect/structured-zone-ops";
import {
  canUseEffectByUsageLimit,
  getCombinedUnitCostFilterCandidates,
  getEffectiveColors,
  getEffectiveTribes,
  recordEffectUsageIfLimited,
} from "../legal/legal-actions-shared";
import { getEffectiveCategory } from "./act-as-spirit";
import { hasOracleUltimateOptIn } from "./oracle-ultimate-opt-in";
import { resolveCardImmunityAffect } from "../effect/effect-affect-adapter";
import { canActivateNexusMechanicEffect } from "./nexus-mechanic-suppression";

let oraclePendingSequence = 0;

/** 途中選択・維持コア配置・最終確定で同じ解決区間を再収集しても、各導託は1回。 */
function hasQueuedOracleForResolution(
  state: GameState,
  chainId: string,
  kind: "oracle" | "placement_oracle",
  grandwalkerInstanceId: string
): boolean {
  return [
    ...state.pendingTriggeredEffects,
    ...state.pendingDeferredTriggeredEffects,
  ].some(
    (pending) =>
      pending.chainId === chainId &&
      pending.mechanic?.kind === kind &&
      pending.mechanic.grandwalkerInstanceId === grandwalkerInstanceId
  );
}

const PLACEMENT_ORACLE_EFFECT_LABEL = "placement_oracle";
const PLACEMENT_ORACLE_USAGE_LIMIT = {
  kind: "per_card_name",
  duration: "turn",
} as const;

/** 公式エターナルQ23202: 効果を抑止された創界神は神託も発揮できない。 */
export function canActivateOracleEffect(
  state: GameState,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  return canActivateNexusMechanicEffect(
    state,
    sourceInstanceId,
    "oracle",
    getCardDefinitionById
  );
}

function getPlacementOracleOptions(data: GrandwalkerData): {
  sameNameGate: boolean;
  usageLimit?: typeof PLACEMENT_ORACLE_USAGE_LIMIT;
} {
  const placementOracle =
    data.placementOracle && typeof data.placementOracle === "object"
      ? data.placementOracle
      : undefined;
  return {
    sameNameGate: placementOracle?.sameNameGate !== false,
    ...(placementOracle?.turnLimit === "per_card_name"
      ? { usageLimit: PLACEMENT_ORACLE_USAGE_LIMIT }
      : {}),
  };
}

function isStepOnceOracleMechanicReserved(
  mechanic: TriggeredMechanic | undefined,
  grandwalkerInstanceId: string
): boolean {
  return (
    mechanic?.kind === "oracle" &&
    mechanic.grandwalkerInstanceId === grandwalkerInstanceId &&
    (mechanic.triggerKind === "summon" || mechanic.triggerKind === "advent")
  );
}

function activeStackHasReservedStepOnceOracle(
  activeStack: ActiveStack | null | undefined,
  grandwalkerInstanceId: string
): boolean {
  let current = activeStack;
  while (current) {
    if (
      isStepOnceOracleMechanicReserved(
        current.triggeredPendingSnapshot?.mechanic,
        grandwalkerInstanceId
      )
    ) {
      return true;
    }
    current = current.previousPendingStackAction;
  }
  return false;
}

function hasReservedStepOnceOraclePending(
  state: GameState,
  grandwalkerInstanceId: string
): boolean {
  return (
    state.pendingTriggeredEffects.some((pending) =>
      isStepOnceOracleMechanicReserved(pending.mechanic, grandwalkerInstanceId)
    ) ||
    activeStackHasReservedStepOnceOracle(
      state.stackWindow?.pendingStackAction,
      grandwalkerInstanceId
    ) ||
    (state.pendingStackCascade?.remainingStacks.some((stack) =>
      activeStackHasReservedStepOnceOracle(stack, grandwalkerInstanceId)
    ) ??
      false)
  );
}

function isPlacementOracleMechanicReserved(
  state: GameState,
  mechanic: TriggeredMechanic | undefined,
  sourceDefinitionId: string,
  playerId: string
): boolean {
  if (mechanic?.kind !== "placement_oracle") return false;
  const reserved = getCardById(state, mechanic.grandwalkerInstanceId);
  return (
    reserved?.definitionId === sourceDefinitionId &&
    reserved.controllerPlayerId === playerId
  );
}

function activeStackHasReservedPlacementOracle(
  state: GameState,
  activeStack: ActiveStack | null | undefined,
  sourceDefinitionId: string,
  playerId: string
): boolean {
  let current = activeStack;
  while (current) {
    if (
      isPlacementOracleMechanicReserved(
        state,
        current.triggeredPendingSnapshot?.mechanic,
        sourceDefinitionId,
        playerId
      )
    ) {
      return true;
    }
    current = current.previousPendingStackAction;
  }
  return false;
}

function hasReservedPlacementOraclePending(
  state: GameState,
  sourceDefinitionId: string,
  playerId: string
): boolean {
  return (
    state.pendingTriggeredEffects.some((pending) =>
      isPlacementOracleMechanicReserved(
        state,
        pending.mechanic,
        sourceDefinitionId,
        playerId
      )
    ) ||
    activeStackHasReservedPlacementOracle(
      state,
      state.stackWindow?.pendingStackAction,
      sourceDefinitionId,
      playerId
    ) ||
    (state.pendingStackCascade?.remainingStacks.some((stack) =>
      activeStackHasReservedPlacementOracle(
        state,
        stack,
        sourceDefinitionId,
        playerId
      )
    ) ??
      false)
  );
}

// ---------------------------------------------------------------------------
// Oracle condition matching
// ---------------------------------------------------------------------------

/**
 * category・色・系統・コストの実効値コンテキスト。
 * 系統付与のグローバルCEも共通getterで評価するため、実行経路は定義lookupを渡す。
 * 呼び出し元が実際の CardInstance/state を持つ場合のみ渡す。省略時は印字値にフォールバックする
 * (単体テストでの CardDefinition-only 呼び出しとの後方互換)。
 */
interface OracleEffectiveContext {
  state: GameState;
  card: CardInstance;
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}

/**
 * カードが OracleCondition にマッチするか判定する。
 * tribes はOR結合（いずれか1つの系統を持てばマッチ）。
 */
export function matchesOracleCondition(
  cardDef: CardDefinition,
  condition: OracleCondition,
  effective?: OracleEffectiveContext
): boolean {
  if (condition.colors !== undefined || condition.colorCount !== undefined) {
    const filter = {
      ...(condition.colors ? { colors: condition.colors } : {}),
      ...(condition.colorCount ? { colorCount: condition.colorCount } : {}),
      targetsGrandwalker: true,
      targetsGrandstone: true,
    };
    if (
      !matchesCardFilterByDef(
        cardDef,
        filter,
        effective
          ? {
              state: effective.state,
              effectiveColors: getEffectiveColors(
                effective.state,
                effective.card,
                cardDef
              ),
            }
          : undefined
      )
    )
      return false;
  }
  // tribes チェック (省略時はスキップ)。tribesLogic "and" = 全系統必須 / 既定 OR。
  if (condition.tribes !== undefined) {
    if (
      !matchesTribes(
        cardDef.tribe,
        condition,
        effective
          ? getEffectiveTribes(
              effective.state,
              effective.card,
              cardDef,
              effective.getCardDefinitionById
            )
          : undefined
      )
    )
      return false;
  }

  // categories チェック（省略時は制限なし）
  if (condition.categories && condition.categories.length > 0) {
    const effectiveCategory = effective
      ? getEffectiveCategory(effective.state, effective.card, cardDef)
      : cardDef.printedCategory;
    const matchesEffectiveCategory =
      effectiveCategory !== undefined &&
      condition.categories.includes(effectiveCategory);
    // BSTH05.5-C20「アルティメットカード/アルティメットとして【導託】できる」opt-in。
    // グローバル実効 category は変更せず、この categories 判定でのみ "ultimate" にも一致させる。
    const matchesUltimateOptIn =
      !matchesEffectiveCategory &&
      effective !== undefined &&
      condition.categories.includes("ultimate") &&
      hasOracleUltimateOptIn(effective.state, effective.card.instanceId);
    if (!matchesEffectiveCategory && !matchesUltimateOptIn) return false;
  }

  // minCost チェック（省略時は制限なし）
  if (condition.minCost != null) {
    const costs = effective
      ? getCombinedUnitCostFilterCandidates(
          effective.state,
          effective.card,
          cardDef,
          effective.getCardDefinitionById
        )
      : [cardDef.cost];
    if (!costs.some((cost) => cost >= condition.minCost!)) return false;
  }

  // hasMechanic チェック（OR: いずれか1つに該当すればマッチ。省略時は制限なし）
  if (condition.hasMechanic && condition.hasMechanic.length > 0) {
    const matched = condition.hasMechanic.some((m) =>
      cardDefinitionHasMechanic(cardDef, m)
    );
    if (!matched) return false;
  }

  return true;
}

/**
 * カードが GrandwalkerData の oracleConditions（OR結合）にマッチするか判定する。
 */
export function matchesAnyOracleCondition(
  cardDef: CardDefinition,
  grandwalkerData: GrandwalkerData,
  effective?: OracleEffectiveContext
): boolean {
  return grandwalkerData.oracleConditions.some((cond) =>
    matchesOracleCondition(cardDef, cond, effective)
  );
}

// ---------------------------------------------------------------------------
// Oracle trigger detection & queueing
// ---------------------------------------------------------------------------

interface OracleTriggerContext {
  magicTiming?: "main" | "flash" | "stack";
}

function matchedOracleMechanics(
  cardDef: CardDefinition,
  condition: OracleCondition
): Set<NonNullable<OracleCondition["hasMechanic"]>[number]> {
  const matched = new Set<
    NonNullable<OracleCondition["hasMechanic"]>[number]
  >();
  for (const mechanic of condition.hasMechanic ?? []) {
    if (cardDefinitionHasMechanic(cardDef, mechanic)) matched.add(mechanic);
  }
  return matched;
}

function matchesOracleConditionForTrigger(
  cardDef: CardDefinition,
  condition: OracleCondition,
  triggerKind: OracleTriggerKind,
  context: OracleTriggerContext | undefined,
  effective?: OracleEffectiveContext
): boolean {
  if (!matchesOracleCondition(cardDef, condition, effective)) return false;

  const matchedMechanics = matchedOracleMechanics(cardDef, condition);
  if (
    triggerKind === "use_magic" &&
    matchedMechanics.has("stack_effect") &&
    matchedMechanics.size === 1
  ) {
    // 10_rules/08c §創界神: 〔スタック効果＆マジック〕の使用時神託は
    // 「マジックカードのスタック効果を使用した」イベントでだけ成立する。
    return context?.magicTiming === "stack";
  }

  return true;
}

/**
 * `triggerKind` の発生で神託 pending を enqueue すべき対象創界神/導界者ネクサスの
 * instanceId 一覧を求める（副作用なし）。checkAndQueueOracleChoices の enqueue 判定と
 * wouldQueueOracleChoices の事前判定（副作用を起こさず「発火し得るか」だけ知りたい用途、
 * BSTH02-C01 effects[0]「導託していないとき」等）が共有する SSOT。
 * 対象条件一致・ボイドコア有無・ステップ1回制限の3判定を1箇所にまとめる。
 */
function collectOracleTriggerNexusIds(
  state: GameState,
  triggerCardInstanceId: string,
  triggerKind: OracleTriggerKind,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  context: OracleTriggerContext | undefined
): string[] {
  const triggerCard = getCardById(state, triggerCardInstanceId);
  if (!triggerCard) return [];

  const triggerDef = getCardDefinitionById(triggerCard.definitionId);
  if (!triggerDef) return [];

  const playerId = triggerCard.controllerPlayerId;
  const matchedIds: string[] = [];

  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== playerId) continue;
    // 自分自身（配置された創界神）は除外（配置時神託は別処理）
    if (card.instanceId === triggerCardInstanceId) continue;

    const def = getCardDefinitionById(card.definitionId);
    if (!def || !isGrandwalkerOrGuidedNexus(def)) continue;
    if (!def.grandwalkerData) continue;
    if (!canActivateOracleEffect(state, card.instanceId, getCardDefinitionById))
      continue;
    if (
      !Array.isArray(def.grandwalkerData.oracleTriggerKinds) ||
      !def.grandwalkerData.oracleTriggerKinds.includes(triggerKind)
    ) {
      continue;
    }

    if (
      !def.grandwalkerData.oracleConditions.some((condition) =>
        matchesOracleConditionForTrigger(
          triggerDef,
          condition,
          triggerKind,
          context,
          { state, card: triggerCard, getCardDefinitionById }
        )
      )
    ) {
      continue;
    }

    // ボイドにコアがあるか確認（0なら選択不要）
    const voidCores = getNormalCoreCountAtLocation(state, {
      kind: "void",
      playerId,
    });
    if (voidCores <= 0) continue;

    if (
      def.grandwalkerData.oracleTriggerLimit === "step_once" &&
      (triggerKind === "summon" || triggerKind === "advent")
    ) {
      const usageLimit = { kind: "per_instance", duration: "step" } as const;
      if (
        hasReservedStepOnceOraclePending(state, card.instanceId) ||
        !canUseEffectByUsageLimit({
          state,
          sourceInstanceId: card.instanceId,
          sourceDefinitionId: card.definitionId,
          getCardDefinitionById,
          playerId,
          effectLabel: "oracle:summon_advent",
          usageLimit,
        })
      ) {
        continue;
      }
    }

    matchedIds.push(card.instanceId);
  }

  return matchedIds;
}

export interface OracleTriggerBatchEntry {
  triggerCardInstanceId: string;
  triggerKind: OracleTriggerKind;
  context?: OracleTriggerContext;
}

/**
 * 召喚/煌臨/配置/使用後に呼ばれ、該当プレイヤーの創界神に対する神託選択をキューイングする。
 *
 * P3-92: 神託は誘発任意効果（08c:125「コア+1（任意）」）。専用キューではなく
 * 正規の誘発キュー pendingTriggeredEffects に mechanic 付きエントリとして積む。
 *
 * @param state - 現在のゲーム状態
 * @param triggerCardInstanceId - トリガーとなったカードの instanceId
 * @param triggerKind - トリガー種別
 * @param getCardDefinitionById - 定義引き関数
 * @returns 更新された GameState（pendingTriggeredEffects にエントリ追加）
 */
export function checkAndQueueOracleChoices(
  state: GameState,
  triggerCardInstanceId: string,
  triggerKind: OracleTriggerKind,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  chainId: string,
  context?: OracleTriggerContext
): GameState {
  return checkAndQueueOracleChoicesForTriggerBatch(
    state,
    [
      {
        triggerCardInstanceId,
        triggerKind,
        ...(context !== undefined ? { context } : {}),
      },
    ],
    getCardDefinitionById,
    chainId
  );
}

/**
 * 同じ効果解決境界で複数カードが同時に召喚/配置/使用されたときの神託/導託を、
 * 各創界神系ネクサス 1 回に集約して enqueue する。
 */
export function checkAndQueueOracleChoicesForTriggerBatch(
  state: GameState,
  triggers: readonly OracleTriggerBatchEntry[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  chainId: string
): GameState {
  const representativeTriggerByNexusId = new Map<
    string,
    OracleTriggerBatchEntry
  >();

  for (const trigger of triggers) {
    const matchedIds = collectOracleTriggerNexusIds(
      state,
      trigger.triggerCardInstanceId,
      trigger.triggerKind,
      getCardDefinitionById,
      trigger.context
    );
    for (const nexusId of matchedIds) {
      if (!representativeTriggerByNexusId.has(nexusId)) {
        representativeTriggerByNexusId.set(nexusId, trigger);
      }
    }
  }

  if (representativeTriggerByNexusId.size === 0) return state;

  const newChoices: PendingTriggeredEffect[] = Array.from(
    representativeTriggerByNexusId.entries()
  ).flatMap(([nexusId, trigger]) => {
    if (hasQueuedOracleForResolution(state, chainId, "oracle", nexusId))
      return [];
    const nexusCard = getCardById(state, nexusId);
    const triggerCard = getCardById(state, trigger.triggerCardInstanceId);
    const actingPlayerId =
      nexusCard?.controllerPlayerId ?? triggerCard?.controllerPlayerId;
    if (!actingPlayerId) return [];
    return [
      createMechanicPendingTriggeredEffect({
        state,
        pendingId: `oracle-${nexusId}-${trigger.triggerCardInstanceId}-${oraclePendingSequence++}`,
        chainId,
        actingPlayerId,
        relatedInstanceId: nexusId,
        mechanic: {
          kind: "oracle",
          grandwalkerInstanceId: nexusId,
          triggerCardInstanceId: trigger.triggerCardInstanceId,
          triggerKind: trigger.triggerKind,
        },
      }),
    ];
  });

  if (newChoices.length === 0) return state;

  return {
    ...state,
    pendingTriggeredEffects: [...state.pendingTriggeredEffects, ...newChoices],
  };
}

/**
 * `triggerKind` の発生で、いずれかの自分の創界神/導界者ネクサスに神託が
 * enqueue され得るかを副作用なしで判定する（`ConditionClause.oracle_would_trigger` の SSOT）。
 * checkAndQueueOracleChoices と同一の対象条件・ボイドコア有無・ステップ1回制限判定を
 * 共有する（`collectOracleTriggerNexusIds`）。
 */
export function wouldQueueOracleChoices(
  state: GameState,
  triggerCardInstanceId: string,
  triggerKind: OracleTriggerKind,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  context?: OracleTriggerContext
): boolean {
  return (
    collectOracleTriggerNexusIds(
      state,
      triggerCardInstanceId,
      triggerKind,
      getCardDefinitionById,
      context
    ).length > 0
  );
}

// ---------------------------------------------------------------------------
// Oracle choice resolution
// ---------------------------------------------------------------------------

/**
 * 神託 mechanic を解決する（コア+1 を受け入れるか辞退するか）。
 * pending のキュー除去は呼び出し側（legal-actions-apply の mechanic 分岐）が行う。
 */
export function resolveOracleMechanic(
  state: GameState,
  mechanic: Extract<TriggeredMechanic, { kind: "oracle" }>,
  actingPlayerId: string,
  accept: boolean,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  const gw = getCardById(state, mechanic.grandwalkerInstanceId);
  const gwDef = gw ? getCardDefinitionById(gw.definitionId) : undefined;
  if (
    !canActivateOracleEffect(
      state,
      mechanic.grandwalkerInstanceId,
      getCardDefinitionById
    )
  )
    return state;
  const effectiveAccept =
    accept || gwDef?.grandwalkerData?.oracleExecutionMode === "mandatory";

  if (!effectiveAccept) {
    return {
      ...state,
      log: [...state.log, `[Oracle] ${actingPlayerId} は神託コア+1 を辞退`],
    };
  }

  // 対象の創界神がまだフィールドにあるか確認
  if (!gw || gw.zone !== "field") {
    return {
      ...state,
      log: [
        ...state.log,
        `[Oracle] 創界神がフィールドにないため神託コア+1 を実行できない`,
      ],
    };
  }

  let currentState = state;
  let usageLimit: { kind: "per_instance"; duration: "step" } | undefined;
  if (
    gwDef?.grandwalkerData?.oracleTriggerLimit === "step_once" &&
    (mechanic.triggerKind === "summon" || mechanic.triggerKind === "advent")
  ) {
    usageLimit = { kind: "per_instance", duration: "step" };
    if (
      !canUseEffectByUsageLimit({
        state: currentState,
        sourceInstanceId: gw.instanceId,
        sourceDefinitionId: gw.definitionId,
        getCardDefinitionById,
        playerId: actingPlayerId,
        effectLabel: "oracle:summon_advent",
        usageLimit,
      })
    ) {
      return {
        ...currentState,
        log: [
          ...currentState.log,
          `[Oracle] ステップに1回の神託はすでに発揮済み`,
        ],
      };
    }
  }

  // ボイドにコアがあるか再確認
  const voidCores = getNormalCoreCountAtLocation(currentState, {
    kind: "void",
    playerId: actingPlayerId,
  });
  if (voidCores <= 0) {
    return {
      ...currentState,
      log: [
        ...currentState.log,
        `[Oracle] ボイドにコアがないため神託コア+1 を実行できない`,
      ],
    };
  }

  currentState = recordEffectUsageIfLimited({
    state: currentState,
    sourceInstanceId: gw.instanceId,
    sourceDefinitionId: gw.definitionId,
    playerId: actingPlayerId,
    effectLabel: "oracle:summon_advent",
    usageLimit,
  });

  // ボイド → 創界神にコア+1
  const newState = moveNormalCores(
    currentState,
    { kind: "void", playerId: actingPlayerId },
    { kind: "card", instanceId: mechanic.grandwalkerInstanceId },
    1
  );

  return {
    ...newState,
    log: [
      ...newState.log,
      `[Oracle] ${actingPlayerId} の創界神ネクサスにボイドからコア+1`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Placement Oracle (配置時神託)
// ---------------------------------------------------------------------------

/**
 * 創界神/導界者ネクサス配置時に、配置時神託を**誘発任意効果としてキューに積む**。
 *
 * 配置時神託は「デッキ上 N 枚をトラッシュに置ける」（08c:125・可能形＝任意）であり、
 * 発揮宣言は「常時以外の効果発揮」(02:186) なのでスタック窓を開く必要がある。よって
 * 専用同期処理ではなく mechanic 付き誘発エントリ (`placement_oracle`) として
 * pendingTriggeredEffects に乗せ、`resolve_pending_triggered_effect` の発揮する/しないで解決する。
 *
 * 発火条件（同名不在・デッキ ≥1 枚）を満たさなければキューしない。
 * 実際のデッキ→トラッシュ（マッチ判定）は窓クローズ後の解決時 (`resolvePlacementOracleMechanic`)。
 *
 * @returns 更新された GameState（pendingTriggeredEffects にエントリ追加、または条件未達で素通り）
 */
export function checkAndQueuePlacementOracle(
  state: GameState,
  grandwalkerInstanceId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  chainId: string
): GameState {
  if (
    hasQueuedOracleForResolution(
      state,
      chainId,
      "placement_oracle",
      grandwalkerInstanceId
    )
  )
    return state;
  const gw = getCardById(state, grandwalkerInstanceId);
  if (!gw || gw.zone !== "field") return state;
  if (
    !canActivateOracleEffect(
      state,
      grandwalkerInstanceId,
      getCardDefinitionById
    )
  )
    return state;

  const gwDef = getCardDefinitionById(gw.definitionId);
  if (!gwDef || !gwDef.grandwalkerData) return state;

  // placementOracle が明示的に false なら配置時神託を行わない
  if (gwDef.grandwalkerData.placementOracle === false) return state;

  const playerId = gw.controllerPlayerId;

  const placementOracleOptions = getPlacementOracleOptions(
    gwDef.grandwalkerData
  );
  if (placementOracleOptions.sameNameGate) {
    // 旧標準の配置時神託は「同じカード名の…がなければ」で発火する。
    const hasSameNameOnField = state.cardInstances.some(
      (c) =>
        c.instanceId !== grandwalkerInstanceId &&
        c.zone === "field" &&
        c.controllerPlayerId === playerId &&
        c.definitionId === gw.definitionId
    );
    if (hasSameNameOnField) return state;
  }

  // デッキに 1 枚以上なければトラッシュに置けない＝発火しない
  const hasDeckCard = state.cardInstances.some(
    (c) => c.zone === "deck" && c.ownerPlayerId === playerId
  );
  if (!hasDeckCard) return state;

  if (placementOracleOptions.usageLimit) {
    if (
      hasReservedPlacementOraclePending(state, gw.definitionId, playerId) ||
      !canUseEffectByUsageLimit({
        state,
        sourceInstanceId: gw.instanceId,
        sourceDefinitionId: gw.definitionId,
        getCardDefinitionById,
        playerId,
        effectLabel: PLACEMENT_ORACLE_EFFECT_LABEL,
        usageLimit: placementOracleOptions.usageLimit,
      })
    ) {
      return state;
    }
  }

  return {
    ...state,
    pendingTriggeredEffects: [
      ...state.pendingTriggeredEffects,
      createMechanicPendingTriggeredEffect({
        state,
        pendingId: `placement-oracle-${grandwalkerInstanceId}-${oraclePendingSequence++}`,
        chainId,
        actingPlayerId: playerId,
        relatedInstanceId: grandwalkerInstanceId,
        mechanic: {
          kind: "placement_oracle",
          grandwalkerInstanceId,
        },
      }),
    ],
  };
}

function hasBlueMagicStackDomain(definition: CardDefinition): boolean {
  return (
    definition.grandwalkerData?.kind === "grandwalker" &&
    definition.grandwalkerData.domainHooks?.includes(
      "blue_magic_stack_domain"
    ) === true
  );
}

function hasLevel2DomainOnline(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  // 【導域】Lv2 hooks use the effective-level SSOT, matching Lv condition evaluation.
  return getEffectiveLevel(state, card, definition, getCardDefinitionById) >= 2;
}

export function checkAndQueueMagicStackDomain(
  state: GameState,
  magicInstanceId: string,
  magicTiming: "main" | "flash" | "stack",
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  chainId: string,
  options: {
    magicEffectiveColors?: readonly import("../model").CardColor[] | undefined;
  } = {}
): GameState {
  if (magicTiming !== "stack") return state;
  const triggerCard = getCardById(state, magicInstanceId);
  if (!triggerCard) return state;
  const triggerDef = getCardDefinitionById(triggerCard.definitionId);
  const triggerColors =
    options.magicEffectiveColors ??
    getEffectiveColors(state, triggerCard, triggerDef);
  if (
    !triggerDef ||
    triggerDef.printedCategory !== "magic" ||
    !triggerColors.includes("blue") ||
    !cardDefinitionHasMechanic(triggerDef, "stack_effect")
  ) {
    return state;
  }

  const playerId = triggerCard.controllerPlayerId;
  const newChoices: PendingTriggeredEffect[] = [];
  for (const card of state.cardInstances) {
    if (card.zone !== "field" || card.controllerPlayerId !== playerId) {
      continue;
    }
    const def = getCardDefinitionById(card.definitionId);
    if (!def || !hasBlueMagicStackDomain(def)) continue;
    if (
      !canActivateNexusMechanicEffect(
        state,
        card.instanceId,
        "magic_stack_domain",
        getCardDefinitionById
      )
    )
      continue;
    if (!hasLevel2DomainOnline(state, card, def, getCardDefinitionById)) {
      continue;
    }
    newChoices.push(
      createMechanicPendingTriggeredEffect({
        state,
        pendingId: `magic-stack-domain-${card.instanceId}-${magicInstanceId}-${oraclePendingSequence++}`,
        chainId,
        actingPlayerId: playerId,
        relatedInstanceId: card.instanceId,
        mechanic: {
          kind: "magic_stack_domain",
          grandwalkerInstanceId: card.instanceId,
          triggerCardInstanceId: magicInstanceId,
        },
      })
    );
  }

  if (newChoices.length === 0) return state;
  return {
    ...state,
    pendingTriggeredEffects: [...state.pendingTriggeredEffects, ...newChoices],
  };
}

export function resolveMagicStackDomainMechanic(
  state: GameState,
  mechanic: Extract<TriggeredMechanic, { kind: "magic_stack_domain" }>,
  actingPlayerId: string,
  accept: boolean,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  if (!accept) {
    return {
      ...state,
      log: [
        ...state.log,
        `[Oracle] ${actingPlayerId} は青マジックのスタック効果発揮時導域を発揮しない`,
      ],
    };
  }

  const gw = getCardById(state, mechanic.grandwalkerInstanceId);
  if (!gw || gw.zone !== "field") return state;
  if (
    !canActivateNexusMechanicEffect(
      state,
      gw.instanceId,
      "magic_stack_domain",
      getCardDefinitionById
    )
  )
    return state;
  const opponentId = state.players.find((p) => p.id !== actingPlayerId)?.id;
  let newState = opponentId
    ? moveDeckTopCardsToTrash(
        state,
        actingPlayerId,
        4,
        mechanic.grandwalkerInstanceId,
        getCardDefinitionById
      )
    : state;

  const voidCores = getNormalCoreCountAtLocation(newState, {
    kind: "void",
    playerId: actingPlayerId,
  });
  if (voidCores > 0) {
    newState = moveNormalCores(
      newState,
      { kind: "void", playerId: actingPlayerId },
      { kind: "card", instanceId: mechanic.grandwalkerInstanceId },
      1
    );
    newState = {
      ...newState,
      log: [...newState.log, "[Oracle] 導域: ボイドから創界神にコア+1"],
    };
  }
  return newState;
}

/**
 * 配置時神託 mechanic の解決（発揮宣言→スタック窓クローズ後）。
 * デッキ上 N 枚をトラッシュに置き（＝効果文・ブラインド）、マッチ分のコアを創界神に
 * **強制**配置する（「対象カード1枚につきコア+1する」＝任意ではない）。
 * pending のキュー除去は呼び出し側（legal-actions-apply の mechanic 分岐）が行う。
 */
export function resolvePlacementOracleMechanic(
  state: GameState,
  mechanic: Extract<TriggeredMechanic, { kind: "placement_oracle" }>,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  const gw = getCardById(state, mechanic.grandwalkerInstanceId);
  if (!gw || gw.zone !== "field") return state;
  if (
    !canActivateOracleEffect(
      state,
      mechanic.grandwalkerInstanceId,
      getCardDefinitionById
    )
  )
    return state;

  const gwDef = getCardDefinitionById(gw.definitionId);
  if (!gwDef || !gwDef.grandwalkerData) return state;

  const playerId = gw.controllerPlayerId;

  // デッキ上からN枚を取得（cardInstances 配列内の deck カード順 = デッキ順、先頭がトップ）
  const revealCount =
    (gwDef.grandwalkerData.placementOracle &&
      typeof gwDef.grandwalkerData.placementOracle === "object" &&
      gwDef.grandwalkerData.placementOracle.revealCount) ||
    3;

  const topCards: CardInstance[] = [];
  for (const c of state.cardInstances) {
    if (c.zone === "deck" && c.ownerPlayerId === playerId) {
      topCards.push(c);
      if (topCards.length >= revealCount) break;
    }
  }

  if (topCards.length === 0) return state;

  const placementOracleOptions = getPlacementOracleOptions(
    gwDef.grandwalkerData
  );
  if (placementOracleOptions.usageLimit) {
    if (
      !canUseEffectByUsageLimit({
        state,
        sourceInstanceId: gw.instanceId,
        sourceDefinitionId: gw.definitionId,
        getCardDefinitionById,
        playerId,
        effectLabel: PLACEMENT_ORACLE_EFFECT_LABEL,
        usageLimit: placementOracleOptions.usageLimit,
      })
    ) {
      return {
        ...state,
        log: [
          ...state.log,
          "[Oracle] 配置時神託はターンに1回:同名のため発揮済み",
        ],
      };
    }
  }

  const selectedIds = topCards.map((c) => c.instanceId);

  const stateAfterUsage = recordEffectUsageIfLimited({
    state,
    sourceInstanceId: gw.instanceId,
    sourceDefinitionId: gw.definitionId,
    playerId,
    effectLabel: PLACEMENT_ORACLE_EFFECT_LABEL,
    usageLimit: placementOracleOptions.usageLimit,
  });

  // デッキ N 枚をトラッシュへ（効果文・直接移動）
  let newState = moveSelectedCardsToTrash(
    stateAfterUsage,
    selectedIds,
    playerId,
    gw.instanceId,
    getCardDefinitionById,
    "[Oracle] 配置時神託: デッキ上"
  );

  // 配置時神託は「オープン」ではなくデッキ→トラッシュへの直接移動だが、
  // moved_to_trash の card_event は通常の move_card と同様に発火する。
  // 実際にトラッシュへ移動できたカードだけを共通処理へ渡し、発生源である
  // 創界神/導界者ネクサスの実効特性を trigger condition の判定に使う。
  const movedToTrashIds = selectedIds.filter(
    (instanceId) =>
      newState.cardInstances.find((card) => card.instanceId === instanceId)
        ?.zone === "trash"
  );
  // 本文の「その中の対象カード」は実際にデッキからトラッシュへ置かれたカードだけを
  // 指す。デッキへの効果免疫等で移動が拒否されたカードを移動前に数えると、
  // コアだけ増える不正な結果になる。
  const matchCount = movedToTrashIds.filter((instanceId) => {
    const card = newState.cardInstances.find(
      (candidate) => candidate.instanceId === instanceId
    );
    if (!card) return false;
    const def = getCardDefinitionById(card.definitionId);
    return (
      def !== undefined &&
      matchesAnyOracleCondition(def, gwDef.grandwalkerData!, {
        state: newState,
        card,
        getCardDefinitionById,
      })
    );
  }).length;
  const sourceCategory = getEffectiveCategory(stateAfterUsage, gw, gwDef);
  newState = processMovedToTrashEffects(
    newState,
    movedToTrashIds,
    getCardDefinitionById,
    {
      sourceColors: getEffectiveColors(stateAfterUsage, gw, gwDef),
      sourceTribes: getEffectiveTribes(
        stateAfterUsage,
        gw,
        gwDef,
        getCardDefinitionById
      ),
      sourceCardName: gwDef.name,
      ...(sourceCategory ? { sourceCategory } : {}),
      sourcePlayerId: playerId,
      fromZone: "deck",
    }
  );

  // 配置時神託でトラッシュに置いたカードのうち、指定カード名一致は即手札へ
  // (BSAZ02-X04/X05【導域】「トラッシュに置かれた『アルドノアドライブ』を手札に加える」型)。
  // cardName は「X」部分一致規約 ([[project_card_name_reference_matching]]) に従い
  // matchesCardName 経由で照合する。moveSelectedCardsToTrash はデッキへの
  // effect immunity で block されると state をそのまま返す (zone は "deck" のまま) ため、
  // newState 側で実際に zone:"trash" へ移動できたカードだけを対象にする
  // (verifier round3 指摘: gate block を無視した無条件 hand 送りのバイパス防止)。
  const returnToHand = gwDef.grandwalkerData.placementOracleReturnToHand;
  if (returnToHand) {
    const returnIds = topCards
      .filter((card) => {
        const def = getCardDefinitionById(card.definitionId);
        if (!def || !matchesCardName(def.name, returnToHand.cardName))
          return false;
        const afterTrashMove = newState.cardInstances.find(
          (c) => c.instanceId === card.instanceId
        );
        return afterTrashMove?.zone === "trash";
      })
      .map((card) => card.instanceId);
    if (returnIds.length > 0) {
      // 神託でトラッシュへ入る移動とは別の処理。ここではすでにトラッシュに
      // あるため、共通の回収プリミティブで耐性・手札増加制限を判定する。
      newState = executeReturnFromTrash(
        newState,
        playerId,
        {
          kind: "return_from_trash",
          filter: {},
          count: returnIds.length,
          destination: "hand",
        },
        getCardDefinitionById,
        gw.instanceId,
        undefined,
        playerId,
        returnIds,
        "none",
        { instance: gw, definition: gwDef }
      );
    }
  }

  // マッチ分のコアをボイド→創界神に置く（強制。「コア+1する」は終止形＝任意ではない。
  // 旧テキスト「コア+1を置ける」は誤記で、コア配置は発揮内の必須ステップ。
  // BSTH02.7-CX01 等の正テキスト = 「対象カード1枚につき、このネクサスにコア+1する」）。
  if (matchCount > 0) {
    const voidCores = getNormalCoreCountAtLocation(newState, {
      kind: "void",
      playerId,
    });
    const coresToAdd = Math.min(matchCount, voidCores);
    if (coresToAdd > 0) {
      newState = moveNormalCores(
        newState,
        { kind: "void", playerId },
        { kind: "card", instanceId: mechanic.grandwalkerInstanceId },
        coresToAdd
      );
      newState = {
        ...newState,
        log: [
          ...newState.log,
          `[Oracle] 配置時神託: ボイドから創界神にコア+${coresToAdd}`,
        ],
      };
    }
  }

  return newState;
}

function moveSelectedCardsToTrash(
  state: GameState,
  selectedCardInstanceIds: readonly string[],
  choosingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  logPrefix = "[Oracle] デッキ上"
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const selectedCards = state.cardInstances.filter(
    (card) =>
      selectedCardInstanceIds.includes(card.instanceId) &&
      card.ownerPlayerId === choosingPlayerId &&
      card.zone === "deck"
  );
  // 配置時導託の「デッキの上からN枚」は先に位置付き窓を固定済み。
  // 効果を受けるのはデッキのカード。移動先のトラッシュ耐性は先取りしない
  // （03c2、2026-09-18 ユーザー裁定）。後続の参照にも耐性を適用しない。
  const movableCards = selectedCards.filter(
    (card) =>
      resolveCardImmunityAffect(
        state,
        card,
        choosingPlayerId,
        "none",
        {
          ...(sourceCard ? { instance: sourceCard } : {}),
          ...(sourceDefinition ? { definition: sourceDefinition } : {}),
        },
        getCardDefinitionById,
        undefined,
        "oracle"
      ).kind === "allowed"
  );
  if (movableCards.length === 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `${logPrefix}トラッシュ配置はデッキのカードの効果耐性により実行されなかった`,
      ],
    };
  }
  const skippedCount = selectedCards.length - movableCards.length;
  const movedIds = new Set(movableCards.map((card) => card.instanceId));
  const movedCount = movedIds.size;
  if (movedCount === 0) return state;
  const updatedCards = state.cardInstances.map((card) => {
    if (movedIds.has(card.instanceId)) {
      return { ...card, zone: "trash" as const };
    }
    return card;
  });

  return replaceCardInstances(
    {
      ...state,
      players: state.players.map((p) =>
        p.id === choosingPlayerId ? { ...p } : p
      ),
      log: [
        ...state.log,
        `${logPrefix}${movedCount}枚をトラッシュに置いた${
          skippedCount > 0 ? `（効果耐性で${skippedCount}枚を除外）` : ""
        }`,
      ],
    },
    updatedCards
  );
}

function moveDeckTopCardsToTrash(
  state: GameState,
  actingPlayerId: string,
  count: number,
  sourceInstanceId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  return executeMoveCardPrimitive({
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    action: {
      kind: "move_card",
      from: { zone: "deck", player: "opponent", position: "top" },
      to: { zone: "trash" },
      count,
      // 【導域】BSTH10.5-X01 の原文「相手のデッキを上から4枚破棄」。
      // 配置時神託等の「トラッシュに置く」と区別して、破棄耐性/書換えを適用する。
      deckDiscard: true,
    },
  });
}
