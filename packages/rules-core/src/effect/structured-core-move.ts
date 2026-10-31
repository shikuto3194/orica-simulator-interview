import { getCoreMoveDestinationReplacement } from "./core-move-destination-replacement";
import { getCoreShootSoulSourceId } from "./structured-core-shoot";
import { satisfiesCoreSourceGroupMinimums } from "../model";
import { coreContainerId } from "../core/core-draft";
// Core-move クラスタ (P2-12, LAST): structured-effect-interpreter.ts から抽出。
// コア移動 (executeCoreMove) と補助・ボーナスコア移動・単純コンテナ化。

import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import {
  getAdditionalCosts,
  matchesCardFilter,
  matchesCardReferenceFilter,
  matchesTribes,
} from "../card/card-filter";
import { getCardById } from "../card/card-lookup";
import { getCEsForTarget } from "../card/ce-lookup";
import {
  applyDeclareGimmickForLifeDamageGate,
  consumePendingLifeDamageTurnCapBuckets,
  applyLifeDamageInterception,
  generateSoulCoreOutsideGame,
  getPlayerLifeCoreCount,
  getNormalCoreCountAtLocation,
  isNormalCoreMovePrevented,
  getTotalCoresOnCardById,
  type LifeDamageContext,
  markDeclareGimmickGateUsedThisTurn,
  moveCardZone,
  moveNormalCores,
  moveSoulCore,
  updateNormalCoreCountAtLocation,
  withSoulCoreLocation,
} from "../core/core-system";
import {
  getCardDefinitionForEffectiveFieldCard,
  getCombinedUnitCostFilterOptions,
  getEffectSourceTribePreventionBypass,
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import {
  getEffectiveCategory,
  getEffectiveTribe,
} from "../mechanics/act-as-spirit";
import type { CardFilter } from "../dsl-types";
import type {
  CardDefinition,
  CardInstance,
  EffectCoreLocation,
  GameState,
  LifeCoreMoveEffectKind,
  NormalCoreContainer,
  PendingLifeDamageDiscardChoice,
  PlayerState,
  PlayerScopedSoulCoreLocation,
  SoulCoreContainer,
} from "../model";
import {
  collectUnderCardScopeIds,
  hasEnterFieldOnlyCorePlacementRestriction,
  hasForcedCoreVoidRedirect,
  immuneProtectedCount,
} from "../model";
import {
  resolveCardImmunityAffect,
  resolveCorePlacementFromVoidAffect,
  resolveCorePlacementToLifeAffect,
} from "./effect-affect-adapter";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
import {
  getCoreMinimumProtectedByResistance,
  isSoulCoreImmuneToSpecifiedEffect,
} from "./effect-resistance-check";
import {
  analyzeCoreShootCandidates,
  genericSoulDestination,
  getFieldCoreSourceTakeableCount,
  resolveFieldCoreSourceMinRemaining,
  resolveCoreShootCardDestinationId,
} from "./structured-core-shoot";
import { resolveLocationPlayer } from "./structured-effect-interpreter";
import {
  nextCoreSourceAllocationId,
  nextLifeCoreSelectionId,
  nextPendingSelectionId,
} from "./structured-effect-sequences";
import {
  computeCoreMoveAmountBonus,
  computeLifeReductionAmountBonus,
  shrinkProtectedCounts,
  withCount,
} from "./structured-modifiers";
import type { TargetLockBypassProfile } from "./target-affect-gate";

/** P3-88: field コアシュートの移動先 (reserve/trash/void/life) に通常コアを加算する。 */
export function addNormalCoresToZone<
  P extends {
    reserveNormalCoreCount: number;
    trashNormalCoreCount: number;
    lifeNormalCoreCount: number;
    voidNormalCoreCount: number;
  },
>(p: P, toKind: string, n: number): P {
  switch (toKind) {
    case "trash":
      return { ...p, trashNormalCoreCount: p.trashNormalCoreCount + n };
    case "life":
      return { ...p, lifeNormalCoreCount: p.lifeNormalCoreCount + n };
    case "void":
      return { ...p, voidNormalCoreCount: p.voidNormalCoreCount + n };
    default:
      return { ...p, reserveNormalCoreCount: p.reserveNormalCoreCount + n };
  }
}

/** field コアシュートでソウルコアを移動先 toKind に置くときの soulCoreLocation。
 * coreShootSoulDestinationAllowed と同一の SSOT (genericSoulDestination) に委譲する。
 * 10_rules/06 §41-42 §54 §71: ボイド以外の generic 可は ライフ/リザーブ/トラッシュ。
 * field / field_card / card_instance (= 特定カード上に置く) は `destinationCardInstanceId`
 * (resolveCoreShootCardDestinationId で単一候補に解決済みのカード) が渡されたときのみ
 * `{kind:"card", instanceId}` を返す。未解決なら null (呼び出し側は soul 移動をスキップ)。
 * [[project_soul_core_movement_generic]] と整合 (2026-06-23 SSOT 化 / 2026-07-02 card 拡張)。
 */
export function soulCoreLocationForZone(
  toKind: string,
  destinationCardInstanceId?: string
): import("../model").PlayerScopedSoulCoreLocation | null {
  return genericSoulDestination(toKind, destinationCardInstanceId);
}

function getCoreMoveSoulDestination(
  to: EffectCoreLocation,
  toContainer: NormalCoreContainer
): PlayerScopedSoulCoreLocation | null {
  if (toContainer.kind === "card") {
    return { kind: "card", instanceId: toContainer.instanceId };
  }
  return soulCoreLocationForZone(to.kind);
}

function getSoulDestinationOwnerId(
  state: GameState,
  toContainer: NormalCoreContainer
): string | undefined {
  if (toContainer.kind === "card") {
    return getCardById(state, toContainer.instanceId)?.ownerPlayerId;
  }
  if (toContainer.kind === "void") return undefined;
  return toContainer.playerId;
}

/**
 * core_move from:life の auto-pick 簡略実装。10_rules/06 §41-42・§54・§121-124:
 * generic な「ライフのコア」はソウルコアを含む (場/リザーブ/トラッシュへ可、ボイド不可)。
 * 持ち主が通常/ソウルを選ぶのが本来だが、本関数は normal-first・soul-fallback の auto-pick
 * を返す (player-choice pending は次段、ENGINE-core-move-from-life-soul-inclusion 縮小実装)。
 * - normalTaken = min(adjustedAmount, lifeNormalCoreCount)
 * - soulTaken = soul on life ? min(1, adjustedAmount - normalTaken) : 0
 */
export function partitionLifeMoveWithSoul(
  player:
    | {
        lifeNormalCoreCount: number;
        soulCoreLocation?: { kind: string } | null | undefined;
      }
    | undefined,
  adjustedAmount: number
): { normalTaken: number; soulTaken: number } {
  if (!player || adjustedAmount <= 0) return { normalTaken: 0, soulTaken: 0 };
  const normalTaken = Math.min(adjustedAmount, player.lifeNormalCoreCount);
  const remaining = adjustedAmount - normalTaken;
  // soulCoreLocation (primary ポインタ) 判定を維持する: 呼び出し元は最終的に
  // withSoulCoreLocation を1回だけ呼んで「primary が life→destination へ移動した」と
  // 記録する単一ユニット移動のため、primary 以外 (追加ソウル) がここにヒットすると
  // withSoulCoreLocation がポインタを不正に付け替え、primary の実際の所在 (card 等) を
  // 孤児化させる (adversarial verifier round2 で判明、count ベース化は corruption を招くため
  // 不採用。追加ソウルは moveSoulCore 経由の汎用移動でのみ安全に扱える)。
  const soulOnLife = player.soulCoreLocation?.kind === "life";
  const soulTaken = soulOnLife && remaining > 0 ? 1 : 0;
  return { normalTaken, soulTaken };
}

/**
 * トラッシュ源のコア移動をソウルコア込みで分配する (`partitionLifeMoveWithSoul` のトラッシュ版)。
 * `effectKind` (DSL.CoreMoveAction.effectKind) で選択方針を切り替える:
 * - "explicit_soul_core": カード文が《ソウルコア》を明示するとき専用。通常コアには触れず、
 *   トラッシュのソウルコアのみを対象にする (無ければ 0 個で不発)。BSDB01-M02 [5,6,7]。
 * - "normal_only": ソウルコアを無視し通常コアのみ対象にする。
 * - "generic"/省略: 10_rules/06 §41-42 の通常コア優先・不足分ソウル自動補完 (auto-pick)。
 *   通常/ソウルの真の選択肢があるときは呼び出し元 handler が
 *   pendingLifeCoreSelection を開き、持ち主に partition を選ばせる。
 */
export function partitionTrashMoveWithSoul(
  player:
    | {
        trashNormalCoreCount: number;
        soulCoreLocation?: { kind: string } | null | undefined;
      }
    | undefined,
  amount: number,
  effectKind: LifeCoreMoveEffectKind = "generic"
): { normalTaken: number; soulTaken: number } {
  if (!player || amount <= 0) return { normalTaken: 0, soulTaken: 0 };
  // soulCoreLocation (primary ポインタ) 判定を維持する理由は partitionLifeMoveWithSoul
  // 同型 (adversarial verifier round2、count ベース化は withSoulCoreLocation 経由の
  // ポインタ付け替え corruption を招く)。
  const soulInTrash = player.soulCoreLocation?.kind === "trash";
  if (effectKind === "explicit_soul_core") {
    return { normalTaken: 0, soulTaken: soulInTrash ? Math.min(1, amount) : 0 };
  }
  if (effectKind === "normal_only") {
    return {
      normalTaken: Math.min(amount, player.trashNormalCoreCount),
      soulTaken: 0,
    };
  }
  const normalTaken = Math.min(amount, player.trashNormalCoreCount);
  const remaining = amount - normalTaken;
  const soulTaken = soulInTrash && remaining > 0 ? 1 : 0;
  return { normalTaken, soulTaken };
}

/**
 * `executeCoreMove` の共有セットアップ (P2-13 executeCoreMove 分解)。
 * 元関数の前段で導出する派生値 (fromPlayerId / toPlayerId / immunity 引数等) と
 * 生 params を束ねる。各ゾーンペア handler は本 ctx から必要な値を分割代入で取り出す。
 * optional param は `T | undefined` (非 optional) にして exactOptionalPropertyTypes 下でも
 * undefined をそのまま束ねられるようにする。`current` は life 系 handler が interception 後の
 * state を返すために参照するが、fall-through する handler は state を変異させないため、
 * ctx 構築時点 (= setup 直後) の値を全 handler が共有してよい (元の各 if ブロックと等価)。
 */
interface CoreMoveContext {
  current: GameState;
  actingPlayerId: string;
  from: EffectCoreLocation;
  to: EffectCoreLocation;
  amount: number;
  sourceInstanceId: string;
  coreShootDistribution: Record<string, number> | undefined;
  coreShootSoulCoreInstanceId: string | undefined;
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  effectTiming: import("../model").EffectTiming | undefined;
  coreDistributionAllocations: Record<string, number> | undefined;
  coreDistributionSoulCoreInstanceId: string | undefined;
  coreDistributionSoulCoreAllocations: Record<string, number> | undefined;
  sourcePreventionLevel: import("../model").EffectPreventionLevel;
  coreShootMinTotal: number | undefined;
  coreSourceAllocations: Record<string, number> | undefined;
  coreSourceSoulCoreInstanceId: string | undefined;
  allowPendingCoreSourceAllocation: boolean | undefined;
  amountBonusOverride: number | undefined;
  allowPendingLifeCoreSelection: boolean | undefined;
  lifeCorePartitionOverride:
    | { normalChosen: number; soulChosen: number }
    | undefined;
  skipLifeDamageInterception: boolean | undefined;
  sourceEffectIndex: number | undefined;
  sourceTargetLockBypass: TargetLockBypassProfile | undefined;
  sourceTargetStepId: string | undefined;
  sourcePreventionBypass: TargetLockBypassProfile | undefined;
  effectSourceInstanceId: string | undefined;
  effectSourceDefinitionId: string | undefined;
  effectKind: LifeCoreMoveEffectKind | undefined;
  coreMoveDestinationTargetIds: readonly string[] | undefined;
  battleEndDeferralAttackId: string | undefined;
  requireFullCount: boolean | undefined;
  // --- setup で導出する派生値 ---
  fromPlayerId: string;
  toPlayerId: string;
  coreMoveDiscardResumeContext: import("../model").CoreMoveDiscardResumeContext;
  coreSourceImmunityArg: {
    instance?: CardInstance;
    definition?: CardDefinition;
    effectIndex?: number;
    targetStepId?: string;
  };
  coreSourceEffectIndex: number | undefined;
  coreSourceTargetStepId: string | undefined;
}

function openCoreOwnerPartitionSelection(options: {
  current: GameState;
  ctx: CoreMoveContext;
  logEntry: string;
  normalAvailable: number;
  soulAvailable: number;
  totalAmount: number;
  defaultEffectTimingMode?: "main" | "flash" | "stack";
}): GameState {
  const { current, ctx } = options;
  const sourceCard = current.cardInstances.find(
    (c) => c.instanceId === ctx.sourceInstanceId
  );
  return {
    ...current,
    log: [...current.log, options.logEntry],
    pendingLifeCoreSelection: {
      pendingId: nextLifeCoreSelectionId(),
      actingPlayerId: ctx.fromPlayerId,
      effectSourcePlayerId: ctx.actingPlayerId,
      sourceInstanceId: ctx.sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      fromLocation: ctx.from,
      toLocation: ctx.to,
      normalAvailable: options.normalAvailable,
      soulAvailable: options.soulAvailable,
      totalAmount: options.totalAmount,
      effectTiming: ctx.effectTiming ?? {
        kind: "activated",
        mode: options.defaultEffectTimingMode ?? "flash",
      },
      ...(ctx.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: ctx.sourcePreventionLevel }
        : {}),
      ...(ctx.coreSourceEffectIndex !== undefined
        ? { sourceEffectIndex: ctx.coreSourceEffectIndex }
        : {}),
      ...(ctx.coreSourceTargetStepId !== undefined
        ? { sourceTargetStepId: ctx.coreSourceTargetStepId }
        : {}),
      ...(ctx.sourceTargetLockBypass !== undefined
        ? { sourceTargetLockBypass: ctx.sourceTargetLockBypass }
        : {}),
      ...(ctx.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: ctx.sourcePreventionBypass }
        : {}),
      ...(ctx.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: ctx.effectSourceInstanceId }
        : {}),
      ...(ctx.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: ctx.effectSourceDefinitionId }
        : {}),
      ...(ctx.coreMoveDestinationTargetIds !== undefined
        ? {
            coreMoveDestinationTargetIds: [...ctx.coreMoveDestinationTargetIds],
          }
        : {}),
    },
  };
}

function isExplicitSoulCoreMoveBlockedByImmunity(
  ctx: CoreMoveContext,
  soulCoreOwnerId: string,
  soulCard?: CardInstance
): boolean {
  return isSoulCoreImmuneToSpecifiedEffect(
    ctx.current,
    soulCoreOwnerId,
    ctx.actingPlayerId,
    ctx.sourcePreventionLevel,
    {
      soulCard,
      getCardDefinitionById: ctx.getCardDefinitionById,
    }
  );
}

type ExplicitSoulCoreSource = {
  ownerId: string;
  container: SoulCoreContainer;
  soulCard?: CardInstance;
  availableCount?: number;
};

function getPlayerSoulCoreCountForKind(
  player: PlayerState | undefined,
  kind: "reserve" | "trash" | "life"
): number {
  if (!player) return 0;
  if (kind === "reserve") return player.reserveSoulCoreCount;
  if (kind === "trash") return player.trashSoulCoreCount;
  return player.lifeSoulCoreCount;
}

function getCoreDistributionSoulCoreCountForZone(options: {
  player: PlayerState | undefined;
  kind: "reserve" | "trash" | "life";
  amount: number;
  effectKind: LifeCoreMoveEffectKind | undefined;
}): number {
  if (!options.player || options.effectKind === "normal_only") return 0;
  const isAllMode = !Number.isFinite(options.amount);
  if (!isAllMode && options.amount <= 0) return 0;
  const available = getPlayerSoulCoreCountForKind(options.player, options.kind);
  const legacyPointerAvailable =
    options.player.soulCoreLocation?.kind === options.kind ? 1 : 0;
  const effectiveAvailable = available > 0 ? available : legacyPointerAvailable;
  if (effectiveAvailable <= 0) return 0;
  return isAllMode ? effectiveAvailable : 1;
}

function normalizeCoreDistributionSoulCoreAllocations(options: {
  soulCoreAllocations: Record<string, number> | undefined;
  soulCoreInstanceId: string | undefined;
  totalSoulCores: number;
}): Record<string, number> {
  if (options.soulCoreAllocations !== undefined) {
    return { ...options.soulCoreAllocations };
  }
  if (options.soulCoreInstanceId === undefined || options.totalSoulCores <= 0) {
    return {};
  }
  return { [options.soulCoreInstanceId]: options.totalSoulCores };
}

function sumCoreDistributionSoulCoreAllocations(
  soulCoreAllocations: Record<string, number>
): number {
  let total = 0;
  for (const amount of Object.values(soulCoreAllocations)) {
    if (amount > 0) total += amount;
  }
  return total;
}

function assertCompleteCoreDistributionForAllMode(options: {
  isAllMode: boolean;
  sourceLabel: "reserve" | "trash" | "life";
  normalTotal: number;
  normalSelected: number;
  totalSoulCores: number;
  selectedSoulCores: number;
}): void {
  if (!options.isAllMode) return;
  const effectivePlaced = options.normalSelected + options.selectedSoulCores;
  if (effectivePlaced < options.normalTotal) {
    throw new Error(
      `Core distribution total ${effectivePlaced} is below minimum ${options.normalTotal}`
    );
  }
  if (
    options.totalSoulCores > 0 &&
    options.normalSelected < options.normalTotal
  ) {
    throw new Error(
      `Core distribution normal total ${options.normalSelected} is below required all-normal total ${options.normalTotal}`
    );
  }
  if (
    options.totalSoulCores > 0 &&
    options.selectedSoulCores < options.totalSoulCores
  ) {
    throw new Error(
      `Soul core in ${options.sourceLabel} must be placed (card text requires placing all cores)`
    );
  }
}

function primaryTracksExplicitSoulCoreSource(
  player: PlayerState | undefined,
  container: SoulCoreContainer
): boolean {
  const location = player?.soulCoreLocation;
  if (!location) return false;
  switch (container.kind) {
    case "card":
      return (
        location.kind === "card" && location.instanceId === container.instanceId
      );
    case "reserve":
    case "trash":
    case "life":
      return location.kind === container.kind;
    case "removed_from_game":
      return location.kind === "removed_from_game";
    case "void":
      return false;
  }
}

function getExplicitSoulCoreContainerCount(
  state: GameState,
  ownerId: string,
  container: SoulCoreContainer
): number {
  switch (container.kind) {
    case "card":
      return (
        state.cardInstances.find((c) => c.instanceId === container.instanceId)
          ?.soulCoreCount ?? 0
      );
    case "reserve":
    case "trash":
    case "life":
      return getPlayerSoulCoreCountForKind(
        state.players.find((p) => p.id === ownerId),
        container.kind
      );
    case "removed_from_game":
      return state.players.find((p) => p.id === ownerId)?.soulCoreLocation
        ?.kind === "removed_from_game"
        ? 1
        : 0;
    case "void":
      return 0;
  }
}

function explicitSoulCoreSourceCardPassesGates(
  ctx: CoreMoveContext,
  card: CardInstance,
  filter: CardFilter | undefined,
  expectedControllerPlayerId: string | undefined
): boolean {
  const {
    current,
    actingPlayerId,
    sourceInstanceId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    coreSourceImmunityArg,
    getCardDefinitionById,
  } = ctx;
  if (
    expectedControllerPlayerId !== undefined &&
    card.controllerPlayerId !== expectedControllerPlayerId
  ) {
    return false;
  }
  if (card.zone !== "field") return false;
  const definition = getCardDefinitionById?.(card.definitionId);
  if (!definition) return false;
  // 候補判定は他のコア移動元経路と同じ SSOT (getFieldCoreSourceTakeableCount)。
  // 明示ソウルコア指定なので soul は「載っており、かつ動かせる」1個として数える
  // (旧実装の `getTotalCoresOnCardById - 1 >= 保護下限` と同値)。
  return (
    getFieldCoreSourceTakeableCount(current, card, actingPlayerId, {
      soulCoresOnCard: card.soulCoreCount,
      soulCoresMovable: card.soulCoreCount,
      sourcePreventionLevel,
      ...(coreSourceImmunityArg ? { effectSource: coreSourceImmunityArg } : {}),
      getCardDefinitionById,
      ...(sourcePreventionBypass ? { sourcePreventionBypass } : {}),
      filter,
      sourceInstanceId,
      sourceTargetLockBypass,
    }) >= 1
  );
}

function findExplicitSoulCoreSourcesOnCard(
  current: GameState,
  instanceId: string
): ExplicitSoulCoreSource[] {
  const soulCard = current.cardInstances.find(
    (c) => c.instanceId === instanceId
  );
  if (!soulCard) return [];
  const primaryOwners = current.players.filter(
    (p) =>
      p.soulCoreLocation?.kind === "card" &&
      p.soulCoreLocation.instanceId === instanceId
  );
  const sources: ExplicitSoulCoreSource[] = primaryOwners.map((owner) => ({
    ownerId: owner.id,
    container: { kind: "card", instanceId },
    soulCard,
    availableCount: 1,
  }));
  const countOnlyAvailable = Math.max(
    0,
    soulCard.soulCoreCount - primaryOwners.length
  );
  if (countOnlyAvailable > 0) {
    sources.push({
      ownerId: soulCard.controllerPlayerId,
      container: { kind: "card", instanceId },
      soulCard,
      availableCount: countOnlyAvailable,
    });
  }
  return sources;
}

function findExplicitSoulCoreCardSources(
  ctx: CoreMoveContext,
  instanceId: string,
  filter: CardFilter | undefined,
  expectedControllerPlayerId: string | undefined
): ExplicitSoulCoreSource[] {
  return findExplicitSoulCoreSourcesOnCard(ctx.current, instanceId).filter(
    (source) => {
      if (
        expectedControllerPlayerId !== undefined &&
        source.ownerId !== expectedControllerPlayerId
      ) {
        return false;
      }
      return (
        source.soulCard !== undefined &&
        explicitSoulCoreSourceCardPassesGates(
          ctx,
          source.soulCard,
          filter,
          expectedControllerPlayerId
        )
      );
    }
  );
}

function findExplicitSoulCoreFieldSources(
  ctx: CoreMoveContext,
  filter: CardFilter | undefined,
  expectedControllerPlayerId: string
): ExplicitSoulCoreSource[] {
  const primaryLocation = ctx.current.players.find(
    (p) => p.id === expectedControllerPlayerId
  )?.soulCoreLocation;
  const primaryCard =
    primaryLocation?.kind === "card"
      ? ctx.current.cardInstances.find(
          (c) => c.instanceId === primaryLocation.instanceId
        )
      : undefined;
  const candidates = [
    ...(primaryCard ? [primaryCard] : []),
    ...ctx.current.cardInstances.filter(
      (card) => card.instanceId !== primaryCard?.instanceId
    ),
  ];

  const sources: ExplicitSoulCoreSource[] = [];
  for (const card of candidates) {
    sources.push(
      ...findExplicitSoulCoreCardSources(
        ctx,
        card.instanceId,
        filter,
        expectedControllerPlayerId
      )
    );
  }

  return sources;
}

function resolveExplicitSoulCoreSources(
  ctx: CoreMoveContext
): ExplicitSoulCoreSource[] {
  const { current, from, fromPlayerId, sourceInstanceId } = ctx;
  if (from.kind === "union") {
    const sources = from.sources.flatMap((source) =>
      resolveExplicitSoulCoreSources({
        ...ctx,
        from: source,
        fromPlayerId: resolveLocationPlayer(
          ctx.actingPlayerId,
          source,
          current
        ),
      })
    );
    // Overlapping source scopes must not pay the same physical cores twice.
    return [
      ...new Map(
        sources.map((source) => [
          `${source.ownerId}:${coreContainerId(source.container as NormalCoreContainer)}`,
          source,
        ])
      ).values(),
    ];
  }
  const player = current.players.find((p) => p.id === fromPlayerId);
  if (!player || ctx.amount <= 0) return [];

  if (
    from.kind === "reserve" &&
    (player.reserveSoulCoreCount > 0 ||
      primaryTracksExplicitSoulCoreSource(player, {
        kind: "reserve",
        playerId: fromPlayerId,
      }))
  ) {
    return [
      {
        ownerId: fromPlayerId,
        container: { kind: "reserve", playerId: fromPlayerId },
      },
    ];
  }
  if (
    from.kind === "trash" &&
    (player.trashSoulCoreCount > 0 ||
      primaryTracksExplicitSoulCoreSource(player, {
        kind: "trash",
        playerId: fromPlayerId,
      }))
  ) {
    return [
      {
        ownerId: fromPlayerId,
        container: { kind: "trash", playerId: fromPlayerId },
      },
    ];
  }
  if (
    from.kind === "life" &&
    (player.lifeSoulCoreCount > 0 ||
      primaryTracksExplicitSoulCoreSource(player, {
        kind: "life",
        playerId: fromPlayerId,
      }))
  ) {
    return [
      {
        ownerId: fromPlayerId,
        container: { kind: "life", playerId: fromPlayerId },
      },
    ];
  }

  if (from.kind === "field") {
    const fieldSources = findExplicitSoulCoreFieldSources(
      ctx,
      from.filter,
      fromPlayerId
    );
    const reserveSources: ExplicitSoulCoreSource[] = [];

    if (
      from.includeReserve === true &&
      (player.reserveSoulCoreCount > 0 ||
        primaryTracksExplicitSoulCoreSource(player, {
          kind: "reserve",
          playerId: fromPlayerId,
        }))
    ) {
      reserveSources.push({
        ownerId: fromPlayerId,
        container: { kind: "reserve", playerId: fromPlayerId },
      });
    }
    return [...fieldSources, ...reserveSources];
  }

  if (from.kind === "field_card") {
    return findExplicitSoulCoreFieldSources(ctx, from.filter, fromPlayerId);
  }

  if (from.kind === "this_card") {
    return findExplicitSoulCoreCardSources(
      ctx,
      sourceInstanceId,
      undefined,
      undefined
    );
  }
  if (from.kind === "card_instance") {
    return findExplicitSoulCoreCardSources(
      ctx,
      from.instanceId,
      undefined,
      undefined
    );
  }
  return [];
}

function resolveExplicitSoulCoreDestination(
  ctx: CoreMoveContext,
  soulCoreOwnerId: string
): SoulCoreContainer | null {
  const {
    current,
    to,
    toPlayerId,
    actingPlayerId,
    sourceInstanceId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    getCardDefinitionById,
  } = ctx;
  switch (to.kind) {
    case "union":
      return null;
    case "reserve":
      return toPlayerId === soulCoreOwnerId
        ? { kind: "reserve", playerId: soulCoreOwnerId }
        : null;
    case "trash":
      return toPlayerId === soulCoreOwnerId
        ? { kind: "trash", playerId: soulCoreOwnerId }
        : null;
    case "life":
      return toPlayerId === soulCoreOwnerId
        ? { kind: "life", playerId: soulCoreOwnerId }
        : null;
    case "removed_from_game":
      return { kind: "removed_from_game" };
    case "this_card": {
      const destination = current.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      return destination?.controllerPlayerId === soulCoreOwnerId
        ? { kind: "card", instanceId: sourceInstanceId }
        : null;
    }
    case "card_instance": {
      const destination = current.cardInstances.find(
        (c) => c.instanceId === to.instanceId
      );
      return destination?.controllerPlayerId === soulCoreOwnerId
        ? { kind: "card", instanceId: to.instanceId }
        : null;
    }
    case "field":
    case "field_card": {
      const destinationCardInstanceId = resolveCoreShootCardDestinationId(
        current,
        to,
        toPlayerId,
        actingPlayerId,
        sourceInstanceId,
        sourcePreventionLevel,
        sourceTargetLockBypass,
        getCardDefinitionById
      );
      const destination =
        destinationCardInstanceId !== undefined
          ? current.cardInstances.find(
              (c) => c.instanceId === destinationCardInstanceId
            )
          : undefined;
      return destination?.controllerPlayerId === soulCoreOwnerId
        ? { kind: "card", instanceId: destination.instanceId }
        : null;
    }
    case "target_card":
    case "void":
    case "outside_game":
    case "count_area":
      return null;
  }
}

function toPlayerScopedSoulCoreLocation(
  container: SoulCoreContainer
): PlayerScopedSoulCoreLocation | null {
  switch (container.kind) {
    case "card":
      return { kind: "card", instanceId: container.instanceId };
    case "reserve":
      return { kind: "reserve" };
    case "trash":
      return { kind: "trash" };
    case "life":
      return { kind: "life" };
    case "removed_from_game":
      return { kind: "removed_from_game" };
    case "void":
      return null;
  }
}

function toSoulCoreContainerFromPlayerScoped(
  location: PlayerScopedSoulCoreLocation,
  playerId: string
): SoulCoreContainer {
  switch (location.kind) {
    case "card":
      return { kind: "card", instanceId: location.instanceId };
    case "reserve":
      return { kind: "reserve", playerId };
    case "trash":
      return { kind: "trash", playerId };
    case "life":
      return { kind: "life", playerId };
    case "removed_from_game":
      return { kind: "removed_from_game" };
  }
}

function getExplicitSoulCoreSourceAvailable(
  state: GameState,
  source: ExplicitSoulCoreSource
): number {
  const player = state.players.find((p) => p.id === source.ownerId);
  const sourceCount = getExplicitSoulCoreContainerCount(
    state,
    source.ownerId,
    source.container
  );
  const currentAvailable =
    sourceCount > 0
      ? sourceCount
      : primaryTracksExplicitSoulCoreSource(player, source.container)
        ? 1
        : 0;
  return Math.min(source.availableCount ?? currentAvailable, currentAvailable);
}

function getExplicitSoulCoreSourceMoveLimit(
  ctx: CoreMoveContext,
  state: GameState,
  source: ExplicitSoulCoreSource
): number {
  const available = getExplicitSoulCoreSourceAvailable(state, source);
  const container = source.container;
  if (available <= 0 || container.kind !== "card") return available;
  const card = state.cardInstances.find(
    (c) => c.instanceId === container.instanceId
  );
  if (!card) return 0;
  const protectedMinimum = getCoreMinimumProtectedByResistance(
    state,
    card,
    ctx.actingPlayerId,
    ctx.getCardDefinitionById,
    ctx.sourcePreventionLevel,
    ctx.sourcePreventionBypass
  );
  const movableTotal = Math.max(
    0,
    getTotalCoresOnCardById(state, card.instanceId) - protectedMinimum
  );
  return Math.min(available, movableTotal);
}

/** 1個の移動元だけが異なる効果を、物理コアの候補選択へ統合する。 */
function handleUnionCoreSource(ctx: CoreMoveContext): GameState | null {
  if (ctx.from.kind !== "union") return null;
  // A whole soul-core pool has no source choice; share the explicit-soul mover.
  if (ctx.effectKind === "explicit_soul_core" && ctx.amount === Infinity)
    return null;
  if (ctx.amount <= 0) return ctx.current;
  if (ctx.amount !== 1)
    throw new Error("core_move source union requires amount: 1");
  const destination = toSimpleNormalCoreContainer(
    ctx.to,
    ctx.actingPlayerId,
    ctx.current,
    ctx.sourceInstanceId,
    true
  );
  if (!destination)
    throw new Error("core_move source union requires a resolved destination");
  type Candidate =
    import("../model").PendingCoreSourceAllocation["candidates"][number] & {
      container: NormalCoreContainer;
      from: EffectCoreLocation;
      ownerId: string;
    };
  const candidates = new Map<string, Candidate>();
  const visit = (from: EffectCoreLocation): void => {
    if (from.kind === "union") {
      from.sources.forEach(visit);
      return;
    }
    const ownerId = resolveLocationPlayer(
      ctx.actingPlayerId,
      from,
      ctx.current
    );
    const sourceCtx = { ...ctx, from, fromPlayerId: ownerId };
    if (from.kind === "field" || from.kind === "field_card") {
      for (const card of ctx.current.cardInstances) {
        if (
          card.controllerPlayerId !== ownerId ||
          card.zone !== "field" ||
          card.pendingLeaveKind
        )
          continue;
        add({ kind: "card", instanceId: card.instanceId }, sourceCtx, card);
      }
      if (from.kind === "field" && from.includeReserve)
        visit({ kind: "reserve", player: from.player });
      return;
    }
    const container = toSimpleNormalCoreContainer(
      from,
      ctx.actingPlayerId,
      ctx.current,
      ctx.sourceInstanceId,
      true
    );
    if (!container)
      throw new Error(`unsupported core union source: ${from.kind}`);
    add(
      container,
      sourceCtx,
      container.kind === "card"
        ? getCardById(ctx.current, container.instanceId)
        : undefined
    );
  };
  const add = (
    container: NormalCoreContainer,
    sourceCtx: CoreMoveContext,
    card?: CardInstance
  ): void => {
    const id = coreContainerId(container);
    if (id === coreContainerId(destination)) return;
    const from = sourceCtx.from;
    const ownerId = card?.controllerPlayerId ?? sourceCtx.fromPlayerId;
    if (
      ctx.to.kind === "life" &&
      resolveCorePlacementToLifeAffect(
        ctx.current,
        ctx.toPlayerId,
        ctx.getCardDefinitionById,
        ctx.sourcePreventionLevel,
        ctx.sourcePreventionBypass,
        from.kind,
        ctx.coreSourceImmunityArg
      ).kind !== "allowed"
    )
      return;
    if (
      from.kind === "void" &&
      resolveCorePlacementFromVoidAffect(
        ctx.current,
        ctx.actingPlayerId,
        ownerId,
        ctx.getCardDefinitionById,
        ctx.sourcePreventionLevel,
        ctx.sourcePreventionBypass,
        ctx.effectTiming,
        ctx.coreSourceImmunityArg
      ).kind !== "allowed"
    )
      return;
    // ソウルの所在・フィルタ・明示指定耐性は既存の解決器を共有する。
    const soulSource =
      ctx.effectKind !== "normal_only" &&
      resolveExplicitSoulCoreSources(sourceCtx).find(
        (s) => coreContainerId(s.container as NormalCoreContainer) === id
      );
    const soulDestination =
      soulSource &&
      resolveExplicitSoulCoreDestination(sourceCtx, soulSource.ownerId);
    let hasSoulCore =
      !!soulSource &&
      !!soulDestination &&
      soulDestination.kind !== "void" &&
      (ctx.effectKind === "explicit_soul_core" ||
        genericSoulDestination(
          ctx.to.kind,
          destination.kind === "card" ? destination.instanceId : undefined
        ) !== null) &&
      (ctx.effectKind !== "explicit_soul_core" ||
        !isExplicitSoulCoreMoveBlockedByImmunity(
          sourceCtx,
          soulSource.ownerId,
          card
        ));
    let normalAvailable =
      ctx.effectKind === "explicit_soul_core"
        ? 0
        : getNormalCoreCountAtLocation(ctx.current, container);
    let available = normalAvailable + (hasSoulCore ? 1 : 0);
    if (card) {
      if (isNormalCoreMovePrevented(ctx.current, card.instanceId))
        normalAvailable = 0;
      const filter =
        from.kind === "field" || from.kind === "field_card"
          ? (from.filter ?? {})
          : {};
      const takeable = getFieldCoreSourceTakeableCount(
        ctx.current,
        card,
        ctx.actingPlayerId,
        {
          minRemaining:
            from.kind === "field"
              ? resolveFieldCoreSourceMinRemaining(
                  ctx.current,
                  card,
                  from,
                  ctx.getCardDefinitionById
                )
              : 0,
          soulCoresOnCard: card.soulCoreCount,
          soulCoresMovable: hasSoulCore ? 1 : 0,
          sourcePreventionLevel: ctx.sourcePreventionLevel,
          effectSource: ctx.coreSourceImmunityArg,
          getCardDefinitionById: ctx.getCardDefinitionById,
          ...(ctx.sourcePreventionBypass
            ? { sourcePreventionBypass: ctx.sourcePreventionBypass }
            : {}),
          sourceTargetLockBypass: ctx.sourceTargetLockBypass,
          sourceInstanceId: ctx.sourceInstanceId,
          filter,
        }
      );
      normalAvailable = Math.min(normalAvailable, takeable);
      hasSoulCore = hasSoulCore && takeable > 0;
      available = Math.min(takeable, normalAvailable + (hasSoulCore ? 1 : 0));
    }
    if (available <= 0) return;
    const candidate = {
      instanceId: id,
      container,
      ownerId,
      from:
        container.kind === "card"
          ? { kind: "card_instance" as const, instanceId: container.instanceId }
          : from,
      available,
      normalAvailable,
      hasSoulCore,
    };
    const prior = candidates.get(id);
    if (!prior || prior.available < available) candidates.set(id, candidate);
  };
  ctx.from.sources.forEach(visit);
  const pool = [...candidates.values()];
  if (pool.length === 0) {
    if (ctx.coreSourceAllocations !== undefined)
      throw new Error("core union sources are no longer available");
    return ctx.current;
  }
  let selected: Candidate | undefined;
  let soul = false;
  if (ctx.coreSourceAllocations !== undefined) {
    let total = 0;
    for (const [id, amount] of Object.entries(ctx.coreSourceAllocations)) {
      const candidate = candidates.get(id);
      if (
        !candidate ||
        !Number.isInteger(amount) ||
        amount < 0 ||
        amount > (candidate.normalAvailable ?? 0)
      )
        throw new Error("invalid core union allocation");
      if (amount > 0) selected = candidate;
      total += amount;
    }
    if (ctx.coreSourceSoulCoreInstanceId !== undefined) {
      const candidate = candidates.get(ctx.coreSourceSoulCoreInstanceId);
      if (!candidate?.hasSoulCore)
        throw new Error("invalid core union soul source");
      selected = candidate;
      soul = true;
      total += 1;
    }
    if (total !== 1 || !selected)
      throw new Error("core union allocation must total 1");
  } else if (
    pool.length > 1 ||
    (pool[0]!.normalAvailable! > 0 && pool[0]!.hasSoulCore)
  ) {
    if (!ctx.allowPendingCoreSourceAllocation)
      throw new Error(
        "ambiguous core union requires a source selection continuation"
      );
    return {
      ...ctx.current,
      pendingCoreSourceAllocation: {
        purpose: "core_move",
        pendingId: nextCoreSourceAllocationId(),
        actingPlayerId: ctx.actingPlayerId,
        sourceInstanceId: ctx.sourceInstanceId,
        sourceDefinitionId:
          getCardById(ctx.current, ctx.sourceInstanceId)?.definitionId ??
          "dsl-unknown",
        candidates: pool.map(
          ({ from: _from, ownerId: _ownerId, ...candidate }) => candidate
        ),
        requiredTotal: 1,
        toLocation: ctx.to,
        effectTiming: ctx.effectTiming ?? { kind: "activated", mode: "flash" },
        ...(ctx.coreSourceEffectIndex !== undefined
          ? { sourceEffectIndex: ctx.coreSourceEffectIndex }
          : {}),
        ...(ctx.coreSourceTargetStepId !== undefined
          ? { sourceTargetStepId: ctx.coreSourceTargetStepId }
          : {}),
        ...(ctx.sourceTargetLockBypass
          ? { sourceTargetLockBypass: ctx.sourceTargetLockBypass }
          : {}),
        ...(ctx.sourcePreventionBypass
          ? { sourcePreventionBypass: ctx.sourcePreventionBypass }
          : {}),
      },
    };
  } else {
    selected = pool[0]!;
    soul = selected.normalAvailable === 0;
  }
  // 物理コア決定後は、所有側・置換・耐性・ライフ増減を従来の移動処理で解決する。
  const to =
    ctx.to.kind === "void"
      ? {
          kind: "void" as const,
          player:
            selected.ownerId === ctx.actingPlayerId
              ? ("self" as const)
              : ("opponent" as const),
        }
      : ctx.to;
  return executeCoreMove(
    ctx.current,
    ctx.actingPlayerId,
    selected.from,
    to,
    1,
    ctx.sourceInstanceId,
    undefined,
    undefined,
    ctx.getCardDefinitionById,
    ctx.effectTiming,
    undefined,
    undefined,
    undefined,
    ctx.sourcePreventionLevel,
    undefined,
    undefined,
    undefined,
    true,
    ctx.amountBonusOverride,
    true,
    soul ? { normalChosen: 0, soulChosen: 1 } : undefined,
    ctx.skipLifeDamageInterception,
    ctx.sourceEffectIndex,
    ctx.sourceTargetLockBypass,
    ctx.sourceTargetStepId,
    false,
    soul ? ctx.effectKind : "normal_only",
    ctx.sourcePreventionBypass,
    ctx.effectSourceInstanceId,
    ctx.effectSourceDefinitionId,
    undefined,
    ctx.battleEndDeferralAttackId,
    ctx.coreMoveDestinationTargetIds,
    ctx.requireFullCount
  );
}

function handleExplicitSoulCoreMove(ctx: CoreMoveContext): GameState | null {
  if (ctx.effectKind !== "explicit_soul_core") return null;
  if (ctx.from.kind === "outside_game") return null;

  const sources = resolveExplicitSoulCoreSources(ctx);
  if (sources.length === 0) {
    ctx.current.log.push(
      `effect:core_move:explicit_soul_core:${ctx.from.kind}->${ctx.to.kind}:${ctx.fromPlayerId}:0:no-soul-core`
    );
    return ctx.current;
  }

  let current = ctx.current;
  let remaining = ctx.amount;
  let movedTotal = 0;
  const movedOwners = new Set<string>();
  const countOnlySoulDriveActivatedOwners = new Set<string>();

  for (const source of sources) {
    if (remaining <= 0) break;

    const destination = resolveExplicitSoulCoreDestination(ctx, source.ownerId);
    if (!destination || destination.kind === "void") {
      current.log.push(
        `effect:core_move:explicit_soul_core:${ctx.from.kind}->${ctx.to.kind}:${source.ownerId}:0:no-destination`
      );
      continue;
    }

    if (
      isExplicitSoulCoreMoveBlockedByImmunity(
        { ...ctx, current },
        source.ownerId,
        source.soulCard
      )
    ) {
      current.log.push(
        `effect:core_move:explicit_soul_core:${ctx.from.kind}->${ctx.to.kind}:${source.ownerId}:blocked-by-soul-core-immunity`
      );
      continue;
    }

    const playerScopedDestination = toPlayerScopedSoulCoreLocation(destination);
    if (!playerScopedDestination) {
      current.log.push(
        `effect:core_move:explicit_soul_core:${ctx.from.kind}->${ctx.to.kind}:${source.ownerId}:0:no-destination`
      );
      continue;
    }

    const available = getExplicitSoulCoreSourceMoveLimit(
      { ...ctx, current },
      current,
      source
    );
    if (available <= 0) continue;
    let moveAmount = Math.min(remaining, available);

    if (source.container.kind === "life" && !ctx.skipLifeDamageInterception) {
      const cause =
        ctx.actingPlayerId !== source.ownerId
          ? "opponent_effect"
          : "self_effect";
      const interception = applyLifeDamageInterception(
        current,
        source.ownerId,
        moveAmount,
        createCoreMoveLifeDamageContext(
          { ...ctx, current },
          cause as "opponent_effect" | "self_effect"
        ),
        ctx.getCardDefinitionById
      );
      current = interception.state;
      if (interception.replaced) continue;
      if (interception.pendingDiscardChoice) {
        return {
          ...current,
          pendingLifeDamageDiscardChoice: {
            pendingId: `ldc-cm-${current.log.length}-${source.ownerId}`,
            decidingPlayerId: source.ownerId,
            actingPlayerId: ctx.actingPlayerId,
            cause: cause as "opponent_effect" | "self_effect",
            pendingAmount: interception.adjustedAmount,
            entries: interception.pendingDiscardChoice.entries,
            ...(interception.pendingDiscardChoice.turnCapConsumption
              ? {
                  turnCapConsumption:
                    interception.pendingDiscardChoice.turnCapConsumption,
                }
              : {}),
            coreMoveResume: ctx.coreMoveDiscardResumeContext,
            ...(ctx.coreMoveDiscardResumeContext.battleEndDeferralAttackId !==
            undefined
              ? {
                  battleEndDeferralAttackId:
                    ctx.coreMoveDiscardResumeContext.battleEndDeferralAttackId,
                }
              : {}),
          },
        };
      }
      moveAmount = Math.min(interception.adjustedAmount, available, remaining);
      if (moveAmount <= 0) continue;
    }

    const sourcePlayer = current.players.find((p) => p.id === source.ownerId);
    const primaryTracksSource = primaryTracksExplicitSoulCoreSource(
      sourcePlayer,
      source.container
    );
    current = moveSoulCore(
      current,
      source.ownerId,
      source.container,
      destination,
      moveAmount,
      ctx.getCardDefinitionById
    );
    if (destination.kind === "removed_from_game" && !primaryTracksSource) {
      countOnlySoulDriveActivatedOwners.add(source.ownerId);
    }
    remaining -= moveAmount;
    movedTotal += moveAmount;
    movedOwners.add(source.ownerId);
  }

  for (const ownerId of countOnlySoulDriveActivatedOwners) {
    current.log.push(`effect:core_move:soul_drive_activated:${ownerId}`);
  }

  const ownerSuffix =
    movedOwners.size === 1 ? [...movedOwners][0] : ctx.fromPlayerId;
  current.log.push(
    `effect:core_move:explicit_soul_core:${ctx.from.kind}->${ctx.to.kind}:${ownerSuffix}:${movedTotal}`
  );
  return current;
}

function createLifeDamageSourceFilterMatcher(
  ctx: CoreMoveContext
): ((filter: CardFilter, protectedPlayerId: string) => boolean) | undefined {
  if (!ctx.getCardDefinitionById) return undefined;
  const sourceIdentity = resolveAffectSourceIdentity({
    state: ctx.current,
    sourceInstanceId: ctx.sourceInstanceId,
    ...(ctx.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: ctx.effectSourceInstanceId }
      : {}),
    ...(ctx.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: ctx.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById: ctx.getCardDefinitionById,
  });
  const sourceCard = sourceIdentity.instance;
  if (!sourceCard) return undefined;
  if (sourceCard.zone !== "field") return undefined;
  const sourceDefinition = sourceIdentity.definition;
  if (!sourceDefinition) return undefined;

  return (filter: CardFilter, protectedPlayerId: string) => {
    if (sourceCard.controllerPlayerId === protectedPlayerId) return false;
    // ライフ保護の条件は発生源の参照であり、発生源カードへの作用ではない。
    return matchesCardReferenceFilter(sourceCard, sourceDefinition, filter, {
      state: ctx.current,
      underCardIds: collectUnderCardScopeIds(ctx.current),
      effectiveColors: getEffectiveColors(
        ctx.current,
        sourceCard,
        sourceDefinition
      ),
      effectiveTribes: getEffectiveTribes(
        ctx.current,
        sourceCard,
        sourceDefinition,
        ctx.getCardDefinitionById
      ),
      additionalCosts: getAdditionalCosts(ctx.current, sourceCard.instanceId),
      ...(sourceCard.zone === "field"
        ? {
            effectiveBp: getCombinedUnitBp(
              ctx.current,
              sourceCard,
              sourceDefinition,
              ctx.getCardDefinitionById
            ),
            effectiveLevel: getEffectiveLevel(
              ctx.current,
              sourceCard,
              sourceDefinition,
              ctx.getCardDefinitionById
            ),
            coreCount: getTotalCoresOnCardById(
              ctx.current,
              sourceCard.instanceId
            ),
            effectiveSymbolCount: getCombinedUnitSymbolCount(
              ctx.current,
              sourceCard,
              sourceDefinition,
              ctx.getCardDefinitionById
            ),
          }
        : {}),
    });
  };
}

/**
 * `to.kind` が field/field_card のときの配置先候補カード一覧を解決する。
 * `applyPendingCoreSplitAction` (pending-action-handlers.ts) が splitDestinations の
 * player 配分検証時 (候補0件の field/field_card destination への正配分を拒否するため) にも
 * 再利用する — 同じ候補判別ロジックを2箇所に持たないための export (SSOT)。
 */
export function collectFieldCardDestinationCandidates(options: {
  state: GameState;
  to: EffectCoreLocation;
  toPlayerId: string;
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  coreMoveDestinationTargetIds: readonly string[] | undefined;
}): CardInstance[] {
  const destFilter =
    options.to.kind === "field_card" ? options.to.filter : undefined;
  const underCardIds = collectUnderCardScopeIds(options.state);
  const canReceiveNonEnterFieldCorePlacement = (
    card: CardInstance
  ): boolean => {
    if (
      underCardIds.adventSource.has(card.instanceId) ||
      underCardIds.textRole.has(card.instanceId)
    )
      return false;
    const def = options.getCardDefinitionById?.(card.definitionId);
    return !def || !hasEnterFieldOnlyCorePlacementRestriction(def);
  };

  if (
    options.to.kind === "field_card" &&
    options.coreMoveDestinationTargetIds !== undefined
  ) {
    const targetIdSet = new Set(options.coreMoveDestinationTargetIds);
    return options.state.cardInstances.filter(
      (card) =>
        targetIdSet.has(card.instanceId) &&
        card.controllerPlayerId === options.toPlayerId &&
        card.zone === "field" &&
        card.pendingLeaveKind === null &&
        canReceiveNonEnterFieldCorePlacement(card)
    );
  }

  return options.state.cardInstances.filter((card) => {
    if (card.controllerPlayerId !== options.toPlayerId) return false;
    if (card.zone !== "field") return false;
    if (card.pendingLeaveKind !== null) return false;
    if (!canReceiveNonEnterFieldCorePlacement(card)) return false;
    if (destFilter) {
      const def = options.getCardDefinitionById
        ? getCardDefinitionForEffectiveFieldCard(
            card,
            options.getCardDefinitionById,
            { state: options.state, filter: destFilter }
          )
        : undefined;
      if (!def) return false;
      if (
        !matchesCardFilter(card, def, destFilter, {
          state: options.state,
          fieldCategoryContext: true,
          ...(options.getCardDefinitionById
            ? { getCardDefinitionById: options.getCardDefinitionById }
            : {}),
          effectiveColors: getEffectiveColors(options.state, card, def),
          effectiveBp:
            card.zone === "field"
              ? getCombinedUnitBp(
                  options.state,
                  card,
                  def,
                  options.getCardDefinitionById
                )
              : undefined,
          effectiveLevel:
            card.zone === "field"
              ? getEffectiveLevel(
                  options.state,
                  card,
                  def,
                  options.getCardDefinitionById
                )
              : undefined,
          coreCount:
            card.zone === "field"
              ? getTotalCoresOnCardById(options.state, card.instanceId)
              : undefined,
          ...getCombinedUnitCostFilterOptions(
            options.state,
            card,
            def,
            options.getCardDefinitionById
          ),
          effectiveSymbolCount:
            card.zone === "field"
              ? getCombinedUnitSymbolCount(
                  options.state,
                  card,
                  def,
                  options.getCardDefinitionById
                )
              : undefined,
          effectiveTribes: getEffectiveTribe(
            options.state,
            card,
            def,
            options.getCardDefinitionById
          )
            .split("・")
            .filter(Boolean),
        })
      ) {
        return false;
      }
    }
    return true;
  });
}

function getLifeCoreCountForPlayer(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  return player ? getPlayerLifeCoreCount(player) : 0;
}

function createCoreMoveLifeDamageContext(
  ctx: CoreMoveContext,
  cause: "opponent_effect" | "self_effect"
): LifeDamageContext {
  const sourceCardMatchesFilter = createLifeDamageSourceFilterMatcher(ctx);
  return {
    cause,
    actingPlayerId: ctx.actingPlayerId,
    sourcePreventionLevel: ctx.sourcePreventionLevel,
    ...(ctx.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: ctx.battleEndDeferralAttackId }
      : {}),
    ...(sourceCardMatchesFilter ? { sourceCardMatchesFilter } : {}),
  };
}

export function executeCoreMove(
  state: GameState,
  actingPlayerId: string,
  from: EffectCoreLocation,
  to: EffectCoreLocation,
  amount: number,
  sourceInstanceId: string,
  coreShootDistribution?: Record<string, number>,
  coreShootSoulCoreInstanceId?: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  effectTiming?: import("../model").EffectTiming,
  coreDistributionAllocations?: Record<string, number>,
  coreDistributionSoulCoreInstanceId?: string,
  coreDistributionSoulCoreAllocations?: Record<string, number>,
  sourcePreventionLevel: import("../model").EffectPreventionLevel = "none",
  /** P3-88: field 源「コアN個まで」の最低取得数。amount 未満で under-selection。 */
  coreShootMinTotal?: number,
  /**
   * field_card ソースのコスト支払い配分 (instanceId → 取るコア数)。
   * `resolve_core_source_allocation` の再実行時に供給される。
   * 検証 (候補内 / available 以下 / 合計 == 必要数) に失敗した場合は throw する。
   */
  coreSourceAllocations?: Record<string, number>,
  coreSourceSoulCoreInstanceId?: string,
  /**
   * 配分が一意でない field_card ソースで `pendingCoreSourceAllocation` を立ててよい
   * 文脈かどうか。effect-interpreter のメインループ経由 (= continuation を注入できる)
   * でのみ true。false の文脈 (pending 解決内の直接呼び出し等) では従来どおり
   * 「コアが多いカードから」の決定的 greedy にフォールバックする (テスト/AI 後方互換)。
   */
  allowPendingCoreSourceAllocation?: boolean,
  /**
   * BSTH001-転醒R02(A) 「コア除去効果で移動するコアの数を+N」継続効果の bonus 上書き。
   * - `undefined` (省略): 通常通り `computeCoreMoveAmountBonus` で自動計算し、相手カード源の
   *   コアシュート (card_instance / field) に上乗せする。
   * - 数値 (通常 0): `computeCoreMoveAmountBonus` の自動加算を抑止し、与えられた値を bonus
   *   として使う。`pendingCoreCountSelection` の解決 (`applyPendingCoreCountAction`) など
   *   pending 生成側で既に bonus を反映済の文脈で 0 を渡し、二重加算を防ぐ。
   */
  amountBonusOverride?: number,
  /**
   * ENGINE-core-move-from-life-owner-soul-choice: ライフ→任意先で通常+ソウル混在の
   * 持ち主選択 `pendingLifeCoreSelection` を立ててよい文脈かどうか。effect-interpreter の
   * メインループ経由 (= continuation を注入できる) でのみ true。false の文脈
   * (pending 解決内の直接呼び出し / 旧テスト経路) では従来どおり `partitionLifeMoveWithSoul`
   * の normal-first auto-pick へフォールバックする。
   */
  allowPendingLifeCoreSelection?: boolean,
  /**
   * `applyPendingLifeCoreSelectionAction` 解決時の partition 上書き
   * (通常 N + ソウル M = totalAmount)。指定時は auto-pick / pending 生成を共にバイパス。
   * resume 文脈でのみ供給される。
   */
  lifeCorePartitionOverride?: { normalChosen: number; soulChosen: number },
  /**
   * resume 文脈 (`lifeCorePartitionOverride` 経由) でのみ true。pending 生成時に
   * `applyLifeDamageInterception` の副作用 (turn_cap カウンタ更新等) が既に state へ
   * 反映済のため、resume 時の二重適用を防ぐ。`pending.totalAmount` は interception 後の
   * adjustedAmount で記録されているので、resume はそのまま `amount` を使えばよい。
   */
  skipLifeDamageInterception?: boolean,
  sourceEffectIndex?: number,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourceTargetStepId?: string,
  /**
   * `resolvePendingLifeGainReplacementChoiceForCoreMove` の decline resume 経由でのみ true。
   * `life_gain_replacement` CE 照合 (pendingLifeGainReplacementChoice 生成) を1回スキップし、
   * 元の to:life 増加をそのまま完了させる (discardCostGate の skipLifeDamageInterception と同型)。
   */
  skipLifeGainReplacementChoice?: boolean,
  /**
   * DSL.CoreMoveAction.effectKind の受け渡し。ソウルコアが絡む source (life/trash) で
   * 選択方針を切り替える (`partitionLifeMoveWithSoul` は life 側で従来どおり自動判定、
   * `partitionTrashMoveWithSoul` がトラッシュ側で参照する)。省略時 "generic"。
   */
  effectKind?: LifeCoreMoveEffectKind,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  /**
   * `core_move_destination_replacement` CE 照合を1回スキップする (強制置換の再帰呼び出し
   * 自身が無限ループしないためのガード。skipLifeGainReplacementChoice と同型)。
   */
  skipCoreMoveDestinationReplacementCheck?: boolean,
  /**
   * battle_end deferred 効果の解決中に生成された core_shoot pending を、
   * battle scope CE finalization の blocker として追跡するための attackId。
   */
  battleEndDeferralAttackId?: string,
  /**
   * core_move.target で解決済みの field_card 配置先候補。
   * 複数候補の pendingCoreDistribution 生成時に to.filter 再列挙で候補を広げない。
   */
  coreMoveDestinationTargetIds?: readonly string[],
  /** 固定数の支払いを行う経路で、通常効果の部分実行と区別する。 */
  requireFullCount?: boolean
): GameState {
  // orchestrator: setup 後に ctx を束ね、ゾーンペア handler を順に試す。各 handler は
  // 非該当なら null を返し次段へ素通りする。current は本体では再代入しない
  // (life interception 等の再代入は各 handler 内の局所 current)。
  const current = state;

  // 配置制限と耐性は同じ発揮元を参照する。移動先やCE登録元ではない。
  const coreSourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId,
    ...(effectSourceInstanceId !== undefined ? { effectSourceInstanceId } : {}),
    ...(effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });

  const fromPlayerId = resolveLocationPlayer(actingPlayerId, from, state);
  const toPlayerId = resolveLocationPlayer(actingPlayerId, to, state);
  const effectiveSourcePreventionBypass =
    sourcePreventionBypass ??
    (getCardDefinitionById !== undefined
      ? getEffectSourceTribePreventionBypass(
          current,
          effectSourceInstanceId ?? sourceInstanceId,
          actingPlayerId,
          getCardDefinitionById
        )
      : undefined);

  // 「このスピリットの効果で移動する相手のコアすべてはトラッシュに置かれる」/
  // 「相手のライフから移動するコアすべてをボイドに置く」(core_move_destination_replacement
  // CE)。life_gain_replacement と異なり任意選択ではなく強制置換のため、pending を作らず
  // `to` を上書きして1回だけ再帰的に executeCoreMove を呼び直す。
  if (!skipCoreMoveDestinationReplacementCheck && from.kind !== "union") {
    const replacement = getCoreMoveDestinationReplacement(
      current,
      sourceInstanceId,
      fromPlayerId,
      from.kind,
      to.kind
    );
    if (replacement) {
      const replacedTo = {
        kind: replacement.toZone,
        player: fromPlayerId === actingPlayerId ? "self" : "opponent",
      } as EffectCoreLocation;
      return executeCoreMove(
        {
          ...current,
          log: [
            ...current.log,
            `effect:core_move:destination_replaced:${from.kind}->${replacement.toZone}:${fromPlayerId}`,
          ],
        },
        actingPlayerId,
        from,
        replacedTo,
        amount,
        sourceInstanceId,
        coreShootDistribution,
        coreShootSoulCoreInstanceId,
        getCardDefinitionById,
        effectTiming,
        coreDistributionAllocations,
        coreDistributionSoulCoreInstanceId,
        coreDistributionSoulCoreAllocations,
        sourcePreventionLevel,
        coreShootMinTotal,
        coreSourceAllocations,
        coreSourceSoulCoreInstanceId,
        allowPendingCoreSourceAllocation,
        amountBonusOverride,
        allowPendingLifeCoreSelection,
        lifeCorePartitionOverride,
        skipLifeDamageInterception,
        sourceEffectIndex,
        sourceTargetLockBypass,
        sourceTargetStepId,
        skipLifeGainReplacementChoice,
        effectKind,
        sourcePreventionBypass,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        /*skipCoreMoveDestinationReplacementCheck=*/ true,
        battleEndDeferralAttackId
      );
    }
  }

  // 「ライフにコアを置けない」制限 (restrict_core_placement_life CE)。移動先がライフゾーンで、
  // その所有者が制限対象なら発動者(actingPlayerId)を問わず全面ブロックする
  // (BSTH02.7-C01 effects[2] choice[0])。
  if (
    to.kind === "life" &&
    resolveCorePlacementToLifeAffect(
      current,
      toPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      effectiveSourcePreventionBypass,
      from.kind,
      coreSourceIdentity
    ).kind !== "allowed"
  ) {
    current.log.push(
      `effect:core_move:${from.kind}->life:blocked-by-restrict_core_placement_life:${toPlayerId}`
    );
    return current;
  }

  // 「相手の効果でボイドからコアを増やせない」制限 (restrict_core_placement_void CE)。
  // 移動元がボイドで、発動者がそのボイドの所有者自身 (=「自分の効果で」) のときのみ
  // ブロックする (BSSL01-C02 effects[0]。ENGINE-void-core-decrease-trigger)。
  if (
    from.kind === "void" &&
    resolveCorePlacementFromVoidAffect(
      current,
      actingPlayerId,
      fromPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      effectiveSourcePreventionBypass,
      effectTiming,
      coreSourceIdentity
    ).kind !== "allowed"
  ) {
    current.log.push(
      `effect:core_move:void->${to.kind}:blocked-by-restrict_core_placement_void:${fromPlayerId}`
    );
    return current;
  }

  // 「このスピリットによって減る相手のライフの数を+N」メタ修飾 (core_move_amount_modifier
  // scope: self_card_opponent_life_reduction, BSSA01-転醒X01(B))。from=相手ライフ源のときのみ
  // 照合する (10_rules/06 line120: ライフ↔リザーブは「コア除去効果」と別扱いのため、
  // card_instance/field 経路の computeCoreMoveAmountBonus とは独立に加算する)。
  // 選択の再開では確定済み個数を使い、amountBonusOverride=0 で再加算を抑止する。
  // 上の restrict_core_placement_life/void ブロック判定より後に置く (adversarial verifier
  // 指摘: ブロック確定前にログを出すと、移動が全面ブロックされるケースでも
  // "applied" ログが誤って残る。既存の card_instance/field 経路の同種ログもブロック
  // 判定確定後に配置されている)。
  let lifeReductionAmountBonus = 0;
  if (
    from.kind === "life" &&
    fromPlayerId !== actingPlayerId &&
    amount > 0 &&
    !skipLifeDamageInterception
  ) {
    lifeReductionAmountBonus =
      amountBonusOverride ??
      computeLifeReductionAmountBonus(
        current,
        actingPlayerId,
        sourceInstanceId,
        effectSourceInstanceId
      );
    if (lifeReductionAmountBonus > 0) {
      current.log.push(
        `effect:core_move_amount_modifier:applied:${actingPlayerId}:+${lifeReductionAmountBonus}:base=${amount}:life_reduction`
      );
    }
  }

  // discardCostGate pending (life→X 経路) の resume 記述。`pendingLifeCoreSelection`
  // resume パターンと同型: 元呼び出しの引数一式を保持し、辞退時に skipLifeDamageInterception
  // 付きで executeCoreMove を再呼び出しする (applyPendingLifeDamageDiscardChoiceAction)。
  const coreMoveDiscardResumeContext: import("../model").CoreMoveDiscardResumeContext =
    {
      ...(lifeCorePartitionOverride ? { lifeCorePartitionOverride } : {}),
      actingPlayerId,
      fromLocation: from,
      toLocation: to,
      sourceInstanceId,
      ...(coreShootDistribution ? { coreShootDistribution } : {}),
      ...(coreShootSoulCoreInstanceId ? { coreShootSoulCoreInstanceId } : {}),
      ...(effectTiming ? { effectTiming } : {}),
      ...(coreDistributionAllocations ? { coreDistributionAllocations } : {}),
      ...(coreDistributionSoulCoreAllocations
        ? { coreDistributionSoulCoreAllocations }
        : {}),
      ...(coreDistributionSoulCoreInstanceId
        ? { coreDistributionSoulCoreInstanceId }
        : {}),
      sourcePreventionLevel,
      ...(coreShootMinTotal !== undefined ? { coreShootMinTotal } : {}),
      ...(coreSourceAllocations ? { coreSourceAllocations } : {}),
      ...(coreSourceSoulCoreInstanceId ? { coreSourceSoulCoreInstanceId } : {}),
      ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
      ...(sourceTargetLockBypass ? { sourceTargetLockBypass } : {}),
      ...(sourceTargetStepId ? { sourceTargetStepId } : {}),
      ...(effectiveSourcePreventionBypass
        ? { sourcePreventionBypass: effectiveSourcePreventionBypass }
        : {}),
      ...(effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId }
        : {}),
      ...(effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId }
        : {}),
      ...(effectKind !== undefined ? { effectKind } : {}),
      ...(coreMoveDestinationTargetIds !== undefined
        ? {
            coreMoveDestinationTargetIds: [...coreMoveDestinationTargetIds],
          }
        : {}),
      ...(battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId }
        : {}),
    };

  // 「[プレイヤー]のライフは増やせない」型の完全禁止 (life_gain_prevention CE,
  // BSTH002-R02【セット中】)。life_gain_replacement と異なり actingPlayerId を問わず
  // (自分の効果でも相手の効果でも)、移動先がこの CE の対象プレイヤーのライフなら
  // 無条件でこの core_move を no-op 化する。プレイヤーの選択を挟まない。
  if (to.kind === "life") {
    const preventionCE = getLifeGainPreventionCE(current, toPlayerId);
    if (preventionCE) {
      return {
        ...current,
        log: [
          ...current.log,
          `effect:life_gain_prevention:blocked:${toPlayerId}:amount=${amount}`,
        ],
      };
    }
  }

  // 発生源スコープ付き「相手の効果を受けない」(immunitySourceScope) 照合用の発生源カード定義。
  // 「相手のスピリットの効果を受けない」等は、コアシュートの発生源カードがスコープに
  // 一致するときだけ免疫を成立させるため、card immunity gate へ渡す。
  const coreSourceCard = coreSourceIdentity.instance;
  const coreSourceDefinition: CardDefinition | undefined =
    coreSourceIdentity.definition;
  const coreSourceEffectIndex =
    sourceEffectIndex ??
    (state.pendingTargetedDisclosureContinuation?.sourceInstanceId ===
    sourceInstanceId
      ? state.pendingTargetedDisclosureContinuation.effectIndex
      : undefined);
  const coreSourceTargetStepId =
    sourceTargetStepId ??
    (state.pendingTargetedDisclosureContinuation?.sourceInstanceId ===
    sourceInstanceId
      ? state.pendingTargetedDisclosureContinuation.targetStepId
      : undefined);
  const coreSourceImmunityArg: {
    instance?: CardInstance;
    definition?: CardDefinition;
    effectIndex?: number;
    targetStepId?: string;
  } = {
    ...(coreSourceCard ? { instance: coreSourceCard } : {}),
    ...(coreSourceDefinition ? { definition: coreSourceDefinition } : {}),
    ...(coreSourceEffectIndex !== undefined
      ? { effectIndex: coreSourceEffectIndex }
      : {}),
    ...(coreSourceTargetStepId !== undefined
      ? { targetStepId: coreSourceTargetStepId }
      : {}),
  };

  const ctx: CoreMoveContext = {
    current,
    actingPlayerId,
    from,
    to,
    amount: amount + lifeReductionAmountBonus,
    sourceInstanceId,
    coreShootDistribution,
    coreShootSoulCoreInstanceId,
    getCardDefinitionById,
    effectTiming,
    coreDistributionAllocations,
    coreDistributionSoulCoreInstanceId,
    coreDistributionSoulCoreAllocations,
    sourcePreventionLevel,
    coreShootMinTotal,
    coreSourceAllocations,
    coreSourceSoulCoreInstanceId,
    allowPendingCoreSourceAllocation,
    amountBonusOverride,
    allowPendingLifeCoreSelection,
    lifeCorePartitionOverride,
    skipLifeDamageInterception,
    sourceEffectIndex,
    sourceTargetLockBypass,
    sourceTargetStepId,
    sourcePreventionBypass: effectiveSourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
    effectKind,
    coreMoveDestinationTargetIds,
    battleEndDeferralAttackId,
    requireFullCount,
    fromPlayerId,
    toPlayerId,
    coreMoveDiscardResumeContext,
    coreSourceImmunityArg,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
  };

  const unionResult = handleUnionCoreSource(ctx);
  if (unionResult) return unionResult;

  // 「自分の効果で自分のライフが増えるとき、増やす代わりに[代替アクション]できる」
  // (life_gain_replacement CE, BSTH02.7-X03 effects[3])。移動先が自分自身のライフ
  // (toPlayerId===actingPlayerId, = 自分の効果で自分のライフが増える) のときだけ照合する。
  // 任意選択のため pending を立て、辞退時は skipLifeGainReplacementChoice 付きで
  // このまま executeCoreMove を再呼び出しして通常通り増やす。
  if (
    to.kind === "life" &&
    toPlayerId === actingPlayerId &&
    !skipLifeGainReplacementChoice
  ) {
    const replacementCE = getLifeGainReplacementCE(current, toPlayerId);
    if (replacementCE) {
      return createPendingLifeGainReplacementChoice(
        current,
        toPlayerId,
        replacementCE.sourceInstanceId,
        amount,
        {
          coreMoveResume: coreMoveDiscardResumeContext,
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        }
      );
    }
  }

  // 単一対象コアシュート: 解決済みの特定カード1体を源に、任意ゾーン/カードへコアを移す
  // （card_instance → reserve/void/trash/life/card）。汎用 moveNormalCores に委譲する。
  {
    const r = handleExplicitSoulCoreMove(ctx);
    if (r) return r;
  }

  {
    const r = handleCardInstanceSource(ctx);
    if (r) return r;
  }

  {
    const r = handleOutsideGameToSoulDestination(ctx);
    if (r) return r;
  }

  {
    const r = handleOutsideGameToFieldCardDestination(ctx);
    if (r) return r;
  }

  {
    const r = handleCountAreaSource(ctx);
    if (r) return r;
  }

  {
    const r = handleVoidToReserve(ctx);
    if (r) return r;
  }

  {
    const r = handleVoidToTrash(ctx);
    if (r) return r;
  }

  {
    const r = handleReserveToReserveCross(ctx);
    if (r) return r;
  }

  {
    const r = handleFieldCoreShoot(ctx);
    if (r) return r;
  }

  {
    const r = handleFieldOrReserveExplicitSoulToRemovedFromGame(ctx);
    if (r) return r;
  }

  {
    const r = handleFieldOrReserveExplicitSoulToThisCard(ctx);
    if (r) return r;
  }

  {
    const r = handleVoidToThisCard(ctx);
    if (r) return r;
  }

  // ライフ→このカード（相手のライフコア1個をこのスピリットに置く 等）
  // BSTH02-X02 effects[0] 同型。void→this_card / reserve→this_card の dual。
  // ライフ減少を伴うので applyLifeDamageInterception を通す。
  // ソウルコア: 既存 field_card→this_card 経路 (L3424-3433) と同じ SSOT ガードで、
  // destinationCardOwnerId (=this_card の ownerPlayerId) === fromPlayerId (same-player)
  // のときのみ partitionLifeMoveWithSoul の normal-first・soul-fallback auto-pick と
  // pendingLifeCoreSelection (持ち主選択、life→reserve/trash と同型) を適用する。
  // cross-player (typical な「相手ライフ→自カード」) は soul ownership 移転が未モデル化
  // のため引き続き normal-only (ENGINE-core-move-soul-cross-player-destination option b)。
  // ENGINE-core-move-from-life-to-this_card-soul-cross-player 解消。
  {
    const r = handleLifeExplicitSoulToThisCard(ctx);
    if (r) return r;
  }

  {
    const r = handleLifeToThisCard(ctx);
    if (r) return r;
  }

  // ライフ→リザーブ（相手ライフのコアをリザーブに置く）
  {
    const r = handleLifeToReserve(ctx);
    if (r) return r;
  }

  {
    const r = handleVoidToLife(ctx);
    if (r) return r;
  }

  {
    const r = handleVoidToFieldOrFieldCard(ctx);
    if (r) return r;
  }

  {
    const r = handleTrashToFieldOrFieldCard(ctx);
    if (r) return r;
  }

  // ライフ→フィールド（相手ライフのコアを自分のフィールドカードに置く）
  // to.kind === "field_card" の場合は filter で配置候補を絞り込む。
  // トラッシュ→フィールドと同型 (ENGINE-core-move-from-life-to-field-card) に、
  // 持ち主選択 (BS35 Q22728) を life→trash/reserve と同じパターンで併せ持つ。
  {
    const r = handleLifeToFieldOrFieldCard(ctx);
    if (r) return r;
  }

  {
    const r = handleReserveToFieldOrFieldCard(ctx);
    if (r) return r;
  }

  // ライフ→トラッシュ（相手ライフのコアをトラッシュに置く）
  {
    const r = handleLifeToTrash(ctx);
    if (r) return r;
  }

  // ライフ→ボイド（相手ライフのコアをボイドに置く）
  // BSTH01-X08「神槍『スピア・ザ・グングニル』」等。ライフ→トラッシュと同型で、
  // 移動先のみ void。ライフ減少なのでライフダメージインターセプションを通す。
  {
    const r = handleLifeToVoid(ctx);
    if (r) return r;
  }

  {
    const r = handleThisCardToVoid(ctx);
    if (r) return r;
  }

  {
    const r = handleThisCardToReserve(ctx);
    if (r) return r;
  }

  {
    const r = handleReserveToVoid(ctx);
    if (r) return r;
  }

  {
    const r = handleTrashToVoid(ctx);
    if (r) return r;
  }

  {
    const r = handleTrashToLife(ctx);
    if (r) return r;
  }

  {
    const r = handleTrashToReserve(ctx);
    if (r) return r;
  }

  {
    const r = handleTrashToThisCard(ctx);
    if (r) return r;
  }

  {
    const r = handleReserveToThisCard(ctx);
    if (r) return r;
  }

  {
    const r = handleFieldCardSource(ctx);
    if (r) return r;
  }

  // 汎用フォールバック: moveNormalCores プリミティブで container-to-container を処理。
  // 上の明示ブランチにマッチしない簡単なパスを扱う。field は GUI 選択が必要なため除外。
  // from=life はライフダメージインターセプションが必要なため除外（明示ブランチで対応）。
  const fromContainer = toSimpleNormalCoreContainer(
    from,
    actingPlayerId,
    current,
    sourceInstanceId,
    /*allowLife=*/ false
  );
  const toContainer = toSimpleNormalCoreContainer(
    to,
    actingPlayerId,
    current,
    sourceInstanceId,
    /*allowLife=*/ true
  );
  if (fromContainer && toContainer) {
    const fromAvailable = getNormalCoreCountAtLocation(current, fromContainer);
    const actualAmount = Math.min(amount, fromAvailable);
    if (actualAmount <= 0) {
      current.log.push(
        `effect:core_move:${from.kind}->${to.kind}:0:no-source-cores`
      );
      return current;
    }
    const moved = moveNormalCores(
      current,
      fromContainer,
      toContainer,
      actualAmount,
      getCardDefinitionById
    );
    return {
      ...moved,
      log: [
        ...moved.log,
        `effect:core_move:${from.kind}:${fromPlayerId}->${to.kind}:${toPlayerId}:${actualAmount}`,
      ],
    };
  }

  // その他: ログのみ
  current.log.push(
    `effect:core_move:${from.kind}->${to.kind}:${amount}:partial-impl`
  );
  return current;
}

// ===========================================================================
// executeCoreMove のゾーンペア handler 群 (P2-13 分解)。
// 各 handler は自身のガードを先頭で検査し、非該当なら null を返して次段へ素通りする
// (元の各 `if (from.kind===X && to.kind===Y) {…return}` ブロックと 1:1 等価)。
// 値は ctx 経由で素通しするため振る舞いは不変。
// ===========================================================================

/**
 * outside_game→reserve/trash/life: ゲーム外から新規ソウルコアを生成し置く
 * (「ゲーム外から<ソウルコア>1個を自分のリザーブに置ける」BSLH01-C05/R03 等)。
 * `generateSoulCoreOutsideGame` (core-system.ts) に委譲する。
 */
function handleOutsideGameToSoulDestination(
  ctx: CoreMoveContext
): GameState | null {
  const { from, to } = ctx;
  if (from.kind !== "outside_game") return null;
  if (to.kind !== "reserve" && to.kind !== "trash" && to.kind !== "life") {
    return null;
  }
  const { current, toPlayerId, amount } = ctx;
  current.log.push(
    `effect:core_move:outside_game->${to.kind}:${toPlayerId}:${amount}`
  );
  return generateSoulCoreOutsideGame(
    current,
    toPlayerId,
    { kind: to.kind, playerId: toPlayerId },
    amount,
    ctx.getCardDefinitionById
  );
}

/**
 * outside_game→field/field_card: ゲーム外から新規ソウルコアを生成し、
 * 自分のフィールドカード (候補フィルタ一致) へ直接置く
 * (BSLH01-X10「ゲーム外から<ソウルコア>1個を自分のスピリット/リザーブに置く」の
 * スピリット側選択肢)。reserve/trash/life と異なり既存コアの移動元が無いため、
 * 候補1枚なら `generateSoulCoreOutsideGame` で直接生成、複数枚なら
 * pendingCoreDistribution (`fromKind:"outside_game"`) でプレイヤーに配置先を選ばせる
 * (trash/void→field_card の分配 pending と同型、ソースが「生成」である点のみ異なる)。
 */
function handleOutsideGameToFieldCardDestination(
  ctx: CoreMoveContext
): GameState | null {
  const {
    from,
    to,
    current,
    actingPlayerId,
    toPlayerId,
    amount,
    getCardDefinitionById,
    coreDistributionSoulCoreInstanceId,
    coreDistributionSoulCoreAllocations,
    sourceInstanceId,
    effectTiming,
  } = ctx;
  if (from.kind !== "outside_game") return null;
  if (to.kind !== "field" && to.kind !== "field_card") return null;

  const fieldCards = collectFieldCardDestinationCandidates({
    state: current,
    to,
    toPlayerId,
    getCardDefinitionById,
    coreMoveDestinationTargetIds: ctx.coreMoveDestinationTargetIds,
  });
  if (fieldCards.length === 0) {
    current.log.push(
      `effect:core_move:outside_game->field:${toPlayerId}:0:no-targets`
    );
    return current;
  }

  // GUI/プレイヤーが配置先を渡してきた場合は適用
  if (
    coreDistributionSoulCoreInstanceId !== undefined ||
    coreDistributionSoulCoreAllocations !== undefined
  ) {
    const soulAllocs = normalizeCoreDistributionSoulCoreAllocations({
      soulCoreAllocations: coreDistributionSoulCoreAllocations,
      soulCoreInstanceId: coreDistributionSoulCoreInstanceId,
      totalSoulCores: amount,
    });
    let result = current;
    for (const [targetInstanceId, soulAmount] of Object.entries(soulAllocs)) {
      if (soulAmount <= 0) continue;
      const targetExists = fieldCards.some(
        (c) => c.instanceId === targetInstanceId
      );
      if (!targetExists) {
        throw new Error(
          `Soul core target ${targetInstanceId} is not a candidate`
        );
      }
      result.log.push(
        `effect:core_move:outside_game->field:${targetInstanceId}:${soulAmount}:player-selected`
      );
      result = generateSoulCoreOutsideGame(
        result,
        toPlayerId,
        { kind: "card", instanceId: targetInstanceId },
        soulAmount,
        getCardDefinitionById
      );
    }
    return result;
  }

  // 候補が複数 → pending 状態でプレイヤー選択を要求
  if (fieldCards.length > 1) {
    const sourceCard = current.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    );
    current.log.push(
      `effect:core_move:outside_game->field:${toPlayerId}:pending:${fieldCards.length}targets`
    );
    const priorStateSnapshot = current;
    return {
      ...current,
      pendingCoreDistribution: {
        pendingId: nextPendingSelectionId("cd"),
        actingPlayerId,
        sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
        sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
        candidates: fieldCards.map((c) => ({
          instanceId: c.instanceId,
          definitionId: c.definitionId,
        })),
        totalNormalCores: 0,
        hasSoulCore: true,
        totalSoulCores: amount,
        fromKind: "outside_game",
        fromPlayerId: toPlayerId,
        toPlayerId,
        effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
        priorStateSnapshot,
      },
    };
  }

  // 自動 fallback: フィールドカード 1 枚のみ
  const target = fieldCards[0]!;
  const moved = generateSoulCoreOutsideGame(
    current,
    toPlayerId,
    { kind: "card", instanceId: target.instanceId },
    amount,
    getCardDefinitionById
  );
  return {
    ...moved,
    log: [
      ...moved.log,
      `effect:core_move:outside_game->field:${toPlayerId}:${amount}:single-target`,
    ],
  };
}

/**
 * カウントエリア→任意の通常コアコンテナ (BSKB01-C04 の唯一の使用例)。
 * PlayerState.countValue を実質的なコア数として扱い、availableCores=countValue。
 * 10_rules/08a §カウントエリア「カウントに関する効果以外でコアを移動・使用・参照
 * できない」の明示例外として、この kind を使う効果 (BSKB01-C04) だけが countValue を
 * 移動可能なコア源として扱う。
 *
 * `to` が `card_instance` (BSKB01-T01 等の召喚直後トークン) のとき、
 * `moveNormalCores` の enter-field-only 配置制限
 * (`hasEnterFieldOnlyCorePlacementRestriction`) は意図的にバイパスする — この経路は
 * `getNormalCoreCountAtLocation`/`updateNormalCoreCountAtLocation` を直接使い
 * `moveNormalCores` 自体を経由しないため、あの choke point (`isEnterFieldOnlyPlacementBlocked`)
 * を通らない。count_area 源はこの効果でのみ発生し、直前の召喚 step が生成した
 * インスタンスへ充てるための「entering field」placement と同義のため、
 * structured-summon.ts の enter-field 自動配置 (getCardDefinitionById を渡さない) と
 * 同じ exemption パターンを踏襲する。
 */
function handleCountAreaSource(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (from.kind !== "count_area") return null;
  const {
    current,
    actingPlayerId,
    sourceInstanceId,
    fromPlayerId,
    amount,
    getCardDefinitionById,
  } = ctx;
  const logPrefix = `effect:core_move:count_area->${to.kind}:${fromPlayerId}`;
  const toContainer = toSimpleNormalCoreContainer(
    to,
    actingPlayerId,
    current,
    sourceInstanceId,
    /*allowLife=*/ true
  );
  if (!toContainer) {
    current.log.push(`${logPrefix}:unsupported-destination`);
    return current;
  }
  const fromPlayer = current.players.find((p) => p.id === fromPlayerId);
  // 神喰カウント保護 (BSGE01 等)「追加したカウントは自分の系統：「X」を持たない効果で
  // 数えられず、その効果を受けない」の床値。executeCountDecrease と同じ SSOT を通す
  // (immuneProtectedCount / shrinkProtectedCounts)。発生源カード/定義は setup 済みの
  // coreSourceImmunityArg (effectSourceInstanceId ?? sourceInstanceId 解決済み) を再利用する。
  const sourceTribes = getEffectiveTribes(
    current,
    ctx.coreSourceImmunityArg.instance,
    ctx.coreSourceImmunityArg.definition,
    getCardDefinitionById
  );
  const immune = immuneProtectedCount(
    fromPlayer?.protectedCounts,
    sourceTribes
  );
  const available = Math.max(0, (fromPlayer?.countValue ?? 0) - immune);
  const actualAmount = Math.min(amount, available);
  if (actualAmount <= 0) {
    current.log.push(`${logPrefix}:0:no-source-cores`);
    return current;
  }
  const newCountValue = (fromPlayer?.countValue ?? 0) - actualAmount;
  const newProtectedCounts = shrinkProtectedCounts(
    fromPlayer?.protectedCounts,
    newCountValue,
    sourceTribes
  );
  const decrementedState: GameState = {
    ...current,
    players: current.players.map((p) =>
      p.id === fromPlayerId
        ? withCount(p, newCountValue, newProtectedCounts)
        : p
    ),
  };
  const toAmount = getNormalCoreCountAtLocation(decrementedState, toContainer);
  const placed = updateNormalCoreCountAtLocation(
    decrementedState,
    toContainer,
    toAmount + actualAmount
  );
  return {
    ...placed,
    log: [...placed.log, `${logPrefix}:${actualAmount}`],
  };
}

/** void→reserve: ボイドの通常コアをリザーブへ。 */
function handleVoidToReserve(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "void" && to.kind === "reserve")) return null;
  const { current, fromPlayerId, toPlayerId, amount } = ctx;
  const actingPlayer = current.players.find((p) => p.id === fromPlayerId)!;
  const available = Math.min(amount, actingPlayer.voidNormalCoreCount);
  const logEntry = `effect:core_move:void->reserve:${toPlayerId}:${available}`;
  if (available <= 0) {
    return {
      ...current,
      log: [...current.log, logEntry],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "void", playerId: fromPlayerId },
    { kind: "reserve", playerId: toPlayerId },
    available
  );
  return {
    ...moved,
    log: [...moved.log, logEntry],
  };
}

/**
 * 単一対象コアシュート (card_instance 源 → 任意ゾーン/カード)。汎用 moveNormalCores 委譲。
 * immunity gate・コア除去 bonus・resistance 最低残数・soul 同行 (all mode) を含む。
 */
function handleCardInstanceSource(ctx: CoreMoveContext): GameState | null {
  const { from } = ctx;
  if (from.kind !== "card_instance") return null;
  const {
    to,
    actingPlayerId,
    current,
    sourceInstanceId,
    sourcePreventionLevel,
    sourcePreventionBypass,
    coreSourceImmunityArg,
    getCardDefinitionById,
    amount,
    amountBonusOverride,
    allowPendingLifeCoreSelection,
    lifeCorePartitionOverride,
    effectTiming,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
    sourceTargetLockBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
    toPlayerId,
  } = ctx;
  const fromContainer = toSimpleNormalCoreContainer(
    from,
    actingPlayerId,
    current,
    sourceInstanceId,
    /*allowLife=*/ true
  );
  const toContainer = toSimpleNormalCoreContainer(
    to,
    actingPlayerId,
    current,
    sourceInstanceId,
    /*allowLife=*/ true
  );
  if (fromContainer === null || toContainer === null) {
    current.log.push(`effect:core_move:card_instance->${to.kind}:partial-impl`);
    return current;
  }
  const sourceCard = current.cardInstances.find(
    (c) => c.instanceId === from.instanceId
  );
  if (
    sourceCard &&
    resolveCardImmunityAffect(
      current,
      sourceCard,
      actingPlayerId,
      sourcePreventionLevel,
      coreSourceImmunityArg,
      getCardDefinitionById,
      sourcePreventionBypass
    ).kind !== "allowed"
  ) {
    current.log.push(
      `effect:core_move:card_instance:${from.instanceId}->${to.kind}:blocked-by-immunity`
    );
    return current;
  }
  // コア除去効果メタ修飾 (BSTH001-転醒R02(A) effect[1] 他): from=相手カード源
  // (effect-driven removal from opponent card) のみが「コア除去効果」スコープ。
  // sourceCard.ownerPlayerId !== actingPlayerId のとき bonus を加算する。
  // amountBonusOverride 指定時は自動計算をスキップし与えられた値を使う（pending 生成
  // 側で既に bonus 反映済の文脈で 0 を渡し二重加算を防ぐ）。
  let effectiveAmount = amount;
  if (sourceCard && sourceCard.ownerPlayerId !== actingPlayerId) {
    const bonus =
      amountBonusOverride !== undefined
        ? amountBonusOverride
        : computeCoreMoveAmountBonus(
            current,
            actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            effectSourceInstanceId
          );
    if (bonus > 0) {
      effectiveAmount = amount + bonus;
      current.log.push(
        `effect:core_move_amount_modifier:applied:${actingPlayerId}:+${bonus}:base=${amount}`
      );
    }
  }
  const soulDest = getCoreMoveSoulDestination(to, toContainer);
  const soulOwnerId = sourceCard?.ownerPlayerId;
  const soulOwner = soulOwnerId
    ? current.players.find((p) => p.id === soulOwnerId)
    : undefined;
  const soulDestinationOwnerId = getSoulDestinationOwnerId(
    current,
    toContainer
  );
  const soulOnSource =
    sourceCard !== undefined &&
    (sourceCard.soulCoreCount > 0 ||
      (soulOwner?.soulCoreLocation?.kind === "card" &&
        soulOwner.soulCoreLocation.instanceId === from.instanceId));
  const sourceAndDestinationSameCard =
    toContainer.kind === "card" && toContainer.instanceId === from.instanceId;
  // 10_rules/06 §41: generic な「コア」は soul も含む。ただし soulCoreLocation は
  // 所有者スコープなので、cross-player destination と void は除外する。
  const soulCanMove =
    ctx.effectKind !== "normal_only" &&
    sourceCard !== undefined &&
    soulOwnerId !== undefined &&
    soulOnSource &&
    soulDest !== null &&
    soulOwnerId === soulDestinationOwnerId &&
    !sourceAndDestinationSameCard;
  const protectedMinRemaining = sourceCard
    ? getCoreMinimumProtectedByResistance(
        current,
        sourceCard,
        actingPlayerId,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    : 0;
  const totalCoresOnSource =
    (sourceCard?.normalCoreCount ?? 0) + (soulOnSource ? 1 : 0);
  const maxMovableTotal = Math.max(
    0,
    totalCoresOnSource - protectedMinRemaining
  );
  const normalTakeable = Math.min(
    sourceCard?.normalCoreCount ?? 0,
    maxMovableTotal
  );
  const soulTakeable = soulCanMove && maxMovableTotal >= 1 ? 1 : 0;
  const candidateTotal =
    (sourceCard?.normalCoreCount ?? 0) + (soulTakeable > 0 ? 1 : 0);
  const requestedAmount = Number.isFinite(effectiveAmount)
    ? effectiveAmount
    : candidateTotal;
  const moveTotal = Math.min(requestedAmount, candidateTotal, maxMovableTotal);
  if (moveTotal <= 0) {
    current.log.push(
      `effect:core_move:card_instance:${from.instanceId}->${to.kind}:0:no-cores`
    );
    return current;
  }

  if (
    Number.isFinite(effectiveAmount) &&
    !lifeCorePartitionOverride &&
    allowPendingLifeCoreSelection &&
    soulTakeable >= 1 &&
    normalTakeable >= moveTotal &&
    soulOwnerId !== undefined
  ) {
    const effectSourceCard = current.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    );
    current.log.push(
      `effect:core_move:card_instance:${from.instanceId}->${to.kind}:pending:owner-choice:normal=${normalTakeable}/soul=${soulTakeable}/amount=${moveTotal}`
    );
    return {
      ...current,
      pendingLifeCoreSelection: {
        pendingId: nextLifeCoreSelectionId(),
        actingPlayerId: soulOwnerId,
        effectSourcePlayerId: actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: effectSourceCard?.definitionId ?? "dsl-unknown",
        fromLocation: from,
        toLocation: to,
        normalAvailable: normalTakeable,
        soulAvailable: soulTakeable,
        totalAmount: moveTotal,
        effectTiming: effectTiming ?? { kind: "activated", mode: "flash" },
        ...(sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel }
          : {}),
        ...(coreSourceEffectIndex !== undefined
          ? { sourceEffectIndex: coreSourceEffectIndex }
          : {}),
        ...(coreSourceTargetStepId !== undefined
          ? { sourceTargetStepId: coreSourceTargetStepId }
          : {}),
        ...(sourceTargetLockBypass !== undefined
          ? { sourceTargetLockBypass }
          : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        ...(effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId }
          : {}),
        ...(effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId }
          : {}),
      },
    };
  }

  const partition = lifeCorePartitionOverride
    ? {
        normalTaken: lifeCorePartitionOverride.normalChosen,
        soulTaken: lifeCorePartitionOverride.soulChosen,
      }
    : (() => {
        const normalTaken = Math.min(moveTotal, normalTakeable);
        const remaining = moveTotal - normalTaken;
        return {
          normalTaken,
          soulTaken: soulTakeable > 0 && remaining > 0 ? 1 : 0,
        };
      })();
  if (
    partition.normalTaken > normalTakeable ||
    partition.soulTaken > soulTakeable
  ) {
    current.log.push(
      `effect:core_move:card_instance:${from.instanceId}->${to.kind}:insufficient:0`
    );
    return current;
  }
  const available = partition.normalTaken + partition.soulTaken;
  current.log.push(
    `effect:core_move:card_instance:${from.instanceId}->${to.kind}:${toPlayerId}:${available}${
      partition.soulTaken > 0 ? ":soul=1" : ""
    }`
  );
  const normalMoved =
    partition.normalTaken > 0
      ? moveNormalCores(
          current,
          fromContainer,
          toContainer,
          partition.normalTaken,
          getCardDefinitionById
        )
      : current;
  if (partition.soulTaken <= 0) {
    return normalMoved;
  }
  if (soulOwnerId === undefined || soulDest === null) {
    return normalMoved;
  }
  const soulMoved = moveSoulCore(
    normalMoved,
    soulOwnerId,
    { kind: "card", instanceId: from.instanceId },
    toSoulCoreContainerFromPlayerScoped(soulDest, soulOwnerId),
    partition.soulTaken,
    getCardDefinitionById
  );
  if (soulMoved === normalMoved) {
    return normalMoved;
  }
  return {
    ...soulMoved,
    log: [
      ...soulMoved.log,
      `effect:core_move:soul_core:${from.instanceId}->${to.kind}:${soulOwnerId}`,
    ],
  };
}

/** void→trash: ボイドの通常コアをトラッシュへ。 */
function handleVoidToTrash(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "void" && to.kind === "trash")) return null;
  const { current, fromPlayerId, toPlayerId, amount } = ctx;
  const actingPlayer = current.players.find((p) => p.id === fromPlayerId)!;
  const available = Math.min(amount, actingPlayer.voidNormalCoreCount);
  const logEntry = `effect:core_move:void->trash:${toPlayerId}:${available}`;
  if (available <= 0) {
    return {
      ...current,
      log: [...current.log, logEntry],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "void", playerId: fromPlayerId },
    { kind: "trash", playerId: toPlayerId },
    available
  );
  return {
    ...moved,
    log: [...moved.log, logEntry],
  };
}

/** reserve→reserve（相手のリザーブへ移す cross-player 経路のみ）。 */
function handleReserveToReserveCross(ctx: CoreMoveContext): GameState | null {
  const { from, to, fromPlayerId, toPlayerId } = ctx;
  if (
    !(
      from.kind === "reserve" &&
      to.kind === "reserve" &&
      fromPlayerId !== toPlayerId
    )
  )
    return null;
  const { current, amount } = ctx;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const available = Math.min(amount, player?.reserveNormalCoreCount ?? 0);
  const logEntry = `effect:core_move:reserve:${fromPlayerId}->reserve:${toPlayerId}:${available}`;
  if (available <= 0) {
    return {
      ...current,
      log: [...current.log, logEntry],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "reserve", playerId: fromPlayerId },
    { kind: "reserve", playerId: toPlayerId },
    available
  );
  return {
    ...moved,
    log: [...moved.log, logEntry],
  };
}

/** void→this_card: ボイドの通常コアをこのカードへ。 */
function handleVoidToThisCard(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "void" && to.kind === "this_card")) return null;
  const {
    current,
    fromPlayerId,
    amount,
    sourceInstanceId,
    getCardDefinitionById,
  } = ctx;
  const actingPlayer = current.players.find((p) => p.id === fromPlayerId)!;
  const available = Math.min(amount, actingPlayer.voidNormalCoreCount);
  if (available <= 0) {
    return {
      ...current,
      log: [
        ...current.log,
        `effect:core_move:void->this_card:${sourceInstanceId}:0`,
      ],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "void", playerId: fromPlayerId },
    { kind: "card", instanceId: sourceInstanceId },
    available,
    getCardDefinitionById
  );
  return {
    ...moved,
    log: [
      ...moved.log,
      `effect:core_move:void->this_card:${sourceInstanceId}:${available}`,
    ],
  };
}

/** void→life: ボイドの通常コアを自分のライフへ。 */
function handleVoidToLife(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "void" && to.kind === "life")) return null;
  const { current, fromPlayerId, toPlayerId, amount } = ctx;
  const actingPlayer = current.players.find((p) => p.id === fromPlayerId)!;
  const available = Math.min(amount, actingPlayer.voidNormalCoreCount);
  const logEntry = `effect:core_move:void->life:${toPlayerId}:${available}`;
  if (available <= 0) {
    return {
      ...current,
      log: [...current.log, logEntry],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "void", playerId: fromPlayerId },
    { kind: "life", playerId: toPlayerId },
    available
  );
  return {
    ...moved,
    log: [...moved.log, logEntry],
  };
}

/** this_card→void: このカードの通常コアをボイドへ (amount:all 対応)。 */
function handleThisCardToVoid(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "this_card" && to.kind === "void")) return null;
  const {
    current,
    sourceInstanceId,
    amount,
    toPlayerId,
    getCardDefinitionById,
  } = ctx;
  const card = current.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!card) {
    current.log.push(`effect:core_move:this_card->void:0:no-source`);
    return current;
  }
  if (
    ctx.requireFullCount &&
    amount !== Infinity &&
    card.normalCoreCount < amount
  ) {
    current.log.push(
      `effect:core_move:this_card:${sourceInstanceId}->void:${toPlayerId}:insufficient:${card.normalCoreCount}/${amount}`
    );
    return current;
  }
  const available = Math.min(amount, Math.max(0, card.normalCoreCount));
  if (available <= 0) {
    return {
      ...current,
      log: [
        ...current.log,
        `effect:core_move:this_card:${sourceInstanceId}->void:${toPlayerId}:0`,
      ],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "card", instanceId: sourceInstanceId },
    { kind: "void", playerId: toPlayerId },
    available,
    getCardDefinitionById
  );
  return {
    ...moved,
    log: [
      ...moved.log,
      `effect:core_move:this_card:${sourceInstanceId}->void:${toPlayerId}:${available}`,
    ],
  };
}

/**
 * this_card→reserve: このカードの通常コアをリザーブへ (amount:all 対応)。
 * engine-core-move-this-card-to-reserve (BSAZ02-C06): 「このカードをトラッシュに置く」
 * (move_self) の前段で、フィールド離脱時のコア返却 (state-based-actions のフィールド
 * 離脱時と同じ「場のカードのコアはリザーブへ戻る」規則) を明示 step として表現する用途。
 * this_card→void (L968) と同型、書き込み先のみ toPlayerId の reserveNormalCoreCount。
 */
function handleThisCardToReserve(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "this_card" && to.kind === "reserve")) return null;
  const {
    current,
    sourceInstanceId,
    amount,
    toPlayerId,
    getCardDefinitionById,
  } = ctx;
  const card = current.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!card) {
    current.log.push(`effect:core_move:this_card->reserve:0:no-source`);
    return current;
  }
  if (
    ctx.requireFullCount &&
    amount !== Infinity &&
    card.normalCoreCount < amount
  ) {
    current.log.push(
      `effect:core_move:this_card:${sourceInstanceId}->reserve:${toPlayerId}:insufficient:${card.normalCoreCount}/${amount}`
    );
    return current;
  }
  const available = Math.min(amount, Math.max(0, card.normalCoreCount));
  if (available <= 0) {
    return {
      ...current,
      log: [
        ...current.log,
        `effect:core_move:this_card:${sourceInstanceId}->reserve:${toPlayerId}:0`,
      ],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "card", instanceId: sourceInstanceId },
    { kind: "reserve", playerId: toPlayerId },
    available,
    getCardDefinitionById
  );
  return {
    ...moved,
    log: [
      ...moved.log,
      `effect:core_move:this_card:${sourceInstanceId}->reserve:${toPlayerId}:${available}`,
    ],
  };
}

/** reserve→void: リザーブの通常コアをボイドへ。 */
function handleReserveToVoid(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "reserve" && to.kind === "void")) return null;
  const { current, fromPlayerId, toPlayerId, amount } = ctx;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const available = Math.min(amount, player?.reserveNormalCoreCount ?? 0);
  const logEntry = `effect:core_move:reserve:${fromPlayerId}->void:${toPlayerId}:${available}`;
  if (available <= 0) {
    return {
      ...current,
      log: [...current.log, logEntry],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "reserve", playerId: fromPlayerId },
    { kind: "void", playerId: toPlayerId },
    available
  );
  return {
    ...moved,
    log: [...moved.log, logEntry],
  };
}

/** trash→void: トラッシュの通常コアをボイドへ。 */
function handleTrashToVoid(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "trash" && to.kind === "void")) return null;
  const { current, fromPlayerId, toPlayerId, amount, requireFullCount } = ctx;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const available = Math.min(amount, player?.trashNormalCoreCount ?? 0);
  const logEntry = `effect:core_move:trash:${fromPlayerId}->void:${toPlayerId}:${available}`;
  if (available <= 0 || (requireFullCount === true && available < amount)) {
    return {
      ...current,
      log: [...current.log, logEntry],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "trash", playerId: fromPlayerId },
    { kind: "void", playerId: toPlayerId },
    available
  );
  return {
    ...moved,
    log: [...moved.log, logEntry],
  };
}

/** trash→life: トラッシュの generic コアをライフへ置く。 */
function handleTrashToLife(ctx: CoreMoveContext): GameState | null {
  const { from, to, effectKind } = ctx;
  if (!(from.kind === "trash" && to.kind === "life")) return null;
  const {
    current,
    fromPlayerId,
    toPlayerId,
    actingPlayerId,
    amount,
    sourceInstanceId,
    lifeCorePartitionOverride,
    allowPendingLifeCoreSelection,
    effectTiming,
    sourcePreventionLevel,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
  } = ctx;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const primaryTracksTrash = primaryTracksExplicitSoulCoreSource(player, {
    kind: "trash",
    playerId: fromPlayerId,
  });
  const soulCanMove =
    fromPlayerId === toPlayerId &&
    effectKind !== "normal_only" &&
    (player?.trashSoulCoreCount ?? 0) > 0;
  const normalAvail = player?.trashNormalCoreCount ?? 0;
  const soulAvail = soulCanMove ? (player?.trashSoulCoreCount ?? 0) : 0;

  if (
    Number.isFinite(amount) &&
    !lifeCorePartitionOverride &&
    allowPendingLifeCoreSelection &&
    effectKind !== "normal_only" &&
    effectKind !== "explicit_soul_core" &&
    soulAvail >= 1 &&
    normalAvail >= amount &&
    amount >= 1
  ) {
    const sourceCard = current.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    );
    current.log.push(
      `effect:core_move:trash:${fromPlayerId}->life:pending:owner-choice:normal=${normalAvail}/soul=${soulAvail}/amount=${amount}`
    );
    return {
      ...current,
      pendingLifeCoreSelection: {
        pendingId: nextLifeCoreSelectionId(),
        actingPlayerId: fromPlayerId,
        effectSourcePlayerId: actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
        fromLocation: from,
        toLocation: to,
        normalAvailable: normalAvail,
        soulAvailable: soulAvail,
        totalAmount: amount,
        effectTiming: effectTiming ?? { kind: "activated", mode: "flash" },
        ...(sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel }
          : {}),
        ...(coreSourceEffectIndex !== undefined
          ? { sourceEffectIndex: coreSourceEffectIndex }
          : {}),
        ...(coreSourceTargetStepId !== undefined
          ? { sourceTargetStepId: coreSourceTargetStepId }
          : {}),
        ...(sourceTargetLockBypass !== undefined
          ? { sourceTargetLockBypass }
          : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        ...(effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId }
          : {}),
        ...(effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId }
          : {}),
      },
    };
  }

  const partitionPlayer =
    player && soulCanMove
      ? primaryTracksTrash
        ? player
        : { ...player, soulCoreLocation: { kind: "trash" as const } }
      : player
        ? { ...player, soulCoreLocation: null }
        : undefined;
  const partition = lifeCorePartitionOverride
    ? {
        normalTaken: lifeCorePartitionOverride.normalChosen,
        soulTaken: lifeCorePartitionOverride.soulChosen,
      }
    : partitionTrashMoveWithSoul(partitionPlayer, amount, effectKind);
  if (partition.normalTaken > normalAvail || partition.soulTaken > soulAvail) {
    current.log.push(
      `effect:core_move:trash:${fromPlayerId}->life:${toPlayerId}:insufficient:0`
    );
    return current;
  }

  const available = partition.normalTaken + partition.soulTaken;
  if (available === 0) {
    current.log.push(
      `effect:core_move:trash:${fromPlayerId}->life:${toPlayerId}:0:no-cores`
    );
    return current;
  }

  current.log.push(
    `effect:core_move:trash:${fromPlayerId}->life:${toPlayerId}:${available}${partition.soulTaken > 0 ? ":soul=1" : ""}`
  );
  const result: GameState = {
    ...current,
    players: current.players.map((p) => {
      const isFrom = p.id === fromPlayerId;
      const isTo = p.id === toPlayerId;
      if (!isFrom && !isTo) return p;
      const next = { ...p };
      if (isFrom) {
        next.trashNormalCoreCount =
          p.trashNormalCoreCount - partition.normalTaken;
      }
      if (isTo) {
        const baseLife = isFrom
          ? next.lifeNormalCoreCount
          : p.lifeNormalCoreCount;
        next.lifeNormalCoreCount = baseLife + partition.normalTaken;
      }
      return next;
    }),
  };
  if (partition.soulTaken <= 0) return result;
  return primaryTracksTrash
    ? withSoulCoreLocation(result, fromPlayerId, { kind: "life" })
    : moveSoulCore(
        result,
        fromPlayerId,
        { kind: "trash", playerId: fromPlayerId },
        { kind: "life", playerId: toPlayerId },
        partition.soulTaken
      );
}

/** trash→reserve: トラッシュの generic/normal/explicit soul core をリザーブへ移動する。 */
function handleTrashToReserve(ctx: CoreMoveContext): GameState | null {
  const { from, to, effectKind } = ctx;
  if (!(from.kind === "trash" && to.kind === "reserve")) return null;
  if (effectKind === "normal_only") return null;
  const {
    current,
    fromPlayerId,
    toPlayerId,
    amount,
    lifeCorePartitionOverride,
    allowPendingLifeCoreSelection,
  } = ctx;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const allowSoulCoreMove = fromPlayerId === toPlayerId;
  if (
    effectKind === "explicit_soul_core" &&
    player?.soulCoreLocation?.kind === "trash" &&
    isExplicitSoulCoreMoveBlockedByImmunity(ctx, fromPlayerId)
  ) {
    current.log.push(
      `effect:core_move:trash:${fromPlayerId}->reserve:${toPlayerId}:blocked-by-soul-core-immunity`
    );
    return current;
  }

  if (
    effectKind !== "explicit_soul_core" &&
    allowSoulCoreMove &&
    !lifeCorePartitionOverride &&
    allowPendingLifeCoreSelection &&
    player
  ) {
    const normalAvail = player.trashNormalCoreCount;
    const soulAvail = player.soulCoreLocation?.kind === "trash" ? 1 : 0;
    if (amount >= 1 && soulAvail >= 1 && normalAvail >= amount) {
      return openCoreOwnerPartitionSelection({
        current,
        ctx,
        logEntry: `effect:core_move:trash:${fromPlayerId}->reserve:pending:owner-choice:normal=${normalAvail}/soul=${soulAvail}/amount=${amount}`,
        normalAvailable: normalAvail,
        soulAvailable: soulAvail,
        totalAmount: amount,
      });
    }
  }

  const partition = lifeCorePartitionOverride
    ? {
        normalTaken: lifeCorePartitionOverride.normalChosen,
        soulTaken: lifeCorePartitionOverride.soulChosen,
      }
    : allowSoulCoreMove || effectKind === "explicit_soul_core"
      ? partitionTrashMoveWithSoul(player, amount, effectKind)
      : {
          normalTaken: Math.min(amount, player?.trashNormalCoreCount ?? 0),
          soulTaken: 0,
        };
  const available = partition.normalTaken + partition.soulTaken;
  if (available === 0) {
    current.log.push(
      `effect:core_move:trash:${fromPlayerId}->reserve:${toPlayerId}:0:no-cores`
    );
    return current;
  }
  const soulDest: import("../model").PlayerScopedSoulCoreLocation | null =
    partition.soulTaken > 0 ? { kind: "reserve" } : null;
  current.log.push(
    `effect:core_move:trash:${fromPlayerId}->reserve:${toPlayerId}:${available}${partition.soulTaken > 0 ? ":soul=1" : ""}`
  );
  const result = {
    ...current,
    players: current.players.map((p) => {
      const isFrom = p.id === fromPlayerId;
      const isTo = p.id === toPlayerId;
      if (!isFrom && !isTo) return p;
      const next = { ...p };
      if (isFrom) {
        next.trashNormalCoreCount =
          p.trashNormalCoreCount - partition.normalTaken;
      }
      if (isTo) {
        const baseReserve = isFrom
          ? next.reserveNormalCoreCount
          : p.reserveNormalCoreCount;
        next.reserveNormalCoreCount = baseReserve + partition.normalTaken;
      }
      return next;
    }),
  };
  return soulDest
    ? withSoulCoreLocation(result, fromPlayerId, soulDest)
    : result;
}

/** trash→this_card: トラッシュの generic/normal/explicit soul core をこのカードへ移動する。 */
function handleTrashToThisCard(ctx: CoreMoveContext): GameState | null {
  const { from, to, effectKind } = ctx;
  if (!(from.kind === "trash" && to.kind === "this_card")) return null;
  if (effectKind === "normal_only") return null;
  const {
    current,
    fromPlayerId,
    amount,
    sourceInstanceId,
    lifeCorePartitionOverride,
    allowPendingLifeCoreSelection,
    getCardDefinitionById,
  } = ctx;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const destination = current.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const allowSoulCoreMove = destination?.ownerPlayerId === fromPlayerId;
  if (
    effectKind === "explicit_soul_core" &&
    player?.soulCoreLocation?.kind === "trash" &&
    isExplicitSoulCoreMoveBlockedByImmunity(ctx, fromPlayerId)
  ) {
    current.log.push(
      `effect:core_move:trash:${fromPlayerId}->this_card:${sourceInstanceId}:blocked-by-soul-core-immunity`
    );
    return current;
  }

  if (
    effectKind !== "explicit_soul_core" &&
    allowSoulCoreMove &&
    !lifeCorePartitionOverride &&
    allowPendingLifeCoreSelection &&
    player
  ) {
    const normalAvail = player.trashNormalCoreCount;
    const soulAvail = player.soulCoreLocation?.kind === "trash" ? 1 : 0;
    if (amount >= 1 && soulAvail >= 1 && normalAvail >= amount) {
      return openCoreOwnerPartitionSelection({
        current,
        ctx,
        logEntry: `effect:core_move:trash:${fromPlayerId}->this_card:pending:owner-choice:normal=${normalAvail}/soul=${soulAvail}/amount=${amount}`,
        normalAvailable: normalAvail,
        soulAvailable: soulAvail,
        totalAmount: amount,
      });
    }
  }

  const partition = lifeCorePartitionOverride
    ? {
        normalTaken: lifeCorePartitionOverride.normalChosen,
        soulTaken: lifeCorePartitionOverride.soulChosen,
      }
    : allowSoulCoreMove || effectKind === "explicit_soul_core"
      ? partitionTrashMoveWithSoul(player, amount, effectKind)
      : {
          normalTaken: Math.min(amount, player?.trashNormalCoreCount ?? 0),
          soulTaken: 0,
        };
  const available = partition.normalTaken + partition.soulTaken;
  if (available === 0) {
    current.log.push(
      `effect:core_move:trash:${fromPlayerId}->this_card:${sourceInstanceId}:0:no-cores`
    );
    return current;
  }
  current.log.push(
    `effect:core_move:trash:${fromPlayerId}->this_card:${sourceInstanceId}:${available}${partition.soulTaken > 0 ? ":soul=1" : ""}`
  );
  let result: GameState = current;
  if (partition.normalTaken > 0) {
    result = moveNormalCores(
      result,
      { kind: "trash", playerId: fromPlayerId },
      { kind: "card", instanceId: sourceInstanceId },
      partition.normalTaken,
      getCardDefinitionById
    );
  }
  return partition.soulTaken > 0
    ? moveSoulCore(
        result,
        fromPlayerId,
        { kind: "trash", playerId: fromPlayerId },
        { kind: "card", instanceId: sourceInstanceId },
        partition.soulTaken,
        getCardDefinitionById
      )
    : result;
}

/** reserve→this_card: リザーブの通常コアをこのカードへ。 */
function handleReserveToThisCard(ctx: CoreMoveContext): GameState | null {
  const { from, to } = ctx;
  if (!(from.kind === "reserve" && to.kind === "this_card")) return null;
  const {
    current,
    fromPlayerId,
    amount,
    sourceInstanceId,
    getCardDefinitionById,
  } = ctx;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const available = Math.min(amount, player?.reserveNormalCoreCount ?? 0);
  if (available <= 0) {
    return {
      ...current,
      log: [
        ...current.log,
        `effect:core_move:reserve:${fromPlayerId}->this_card:${sourceInstanceId}:0`,
      ],
    };
  }
  const moved = moveNormalCores(
    current,
    { kind: "reserve", playerId: fromPlayerId },
    { kind: "card", instanceId: sourceInstanceId },
    available,
    getCardDefinitionById
  );
  return {
    ...moved,
    log: [
      ...moved.log,
      `effect:core_move:reserve:${fromPlayerId}->this_card:${sourceInstanceId}:${available}`,
    ],
  };
}

function coreShootNormalDestination(
  toKind: EffectCoreLocation["kind"],
  toPlayerId: string,
  cardDestinationId: string | undefined
): NormalCoreContainer {
  if (cardDestinationId !== undefined) {
    return { kind: "card", instanceId: cardDestinationId };
  }
  switch (toKind) {
    case "reserve":
    case "trash":
    case "life":
    case "void":
      return { kind: toKind, playerId: toPlayerId };
    default:
      throw new Error(`core_move field destination is not resolved: ${toKind}`);
  }
}

function sumForcedCoreVoidRedirectTakes(
  current: GameState,
  takes: Map<string, number>,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  if (!getCardDefinitionById) return 0;
  let total = 0;
  for (const [instanceId, take] of takes) {
    const card = current.cardInstances.find((c) => c.instanceId === instanceId);
    const def = card ? getCardDefinitionById(card.definitionId) : undefined;
    if (def && hasForcedCoreVoidRedirect(def)) total += take;
  }
  return total;
}

/**
 * フィールド源コアシュート (field → reserve/trash/void/life または field/field_card/
 * card_instance 上)。coreShootCardDestinationId 解決・player 選択分配・pending 生成・
 * auto fallback (soul 同行 / reserve 補完) を含む。非該当は null で fall-through。
 */
function handleFieldCoreShoot(ctx: CoreMoveContext): GameState | null {
  const {
    from,
    to,
    current,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    amountBonusOverride,
    sourceInstanceId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    effectSourceInstanceId,
    getCardDefinitionById,
    coreShootMinTotal,
    coreShootDistribution,
    coreShootSoulCoreInstanceId,
    coreSourceImmunityArg,
    coreSourceEffectIndex,
    effectTiming,
    battleEndDeferralAttackId,
  } = ctx;
  // フィールド→リザーブ/トラッシュ/ボイド/ライフ、または特定フィールドカード上
  // （coreshoot 行き先の card 拡張。field/field_card は候補がちょうど1枚のときのみ
  // auto-resolve、card_instance は解決済みをそのまま使う。0枚/複数枚は resolveCoreShoot
  // CardDestinationId が undefined を返し既存の partial-impl fallback に委ねる。
  // ENGINE-coreshoot-soul-destination-include-field-card）。
  const coreShootCardDestinationId =
    from.kind === "field" &&
    (to.kind === "field" ||
      to.kind === "field_card" ||
      to.kind === "card_instance")
      ? resolveCoreShootCardDestinationId(
          current,
          to,
          toPlayerId,
          actingPlayerId,
          sourceInstanceId,
          sourcePreventionLevel,
          sourceTargetLockBypass,
          getCardDefinitionById
        )
      : undefined;
  if (
    from.kind === "field" &&
    (to.kind === "reserve" ||
      to.kind === "trash" ||
      to.kind === "void" ||
      to.kind === "life" ||
      coreShootCardDestinationId !== undefined)
  ) {
    // コア除去効果メタ修飾 (BSTH001-転醒R02(A) effect[1] 他): from=相手フィールド源
    // のコアシュート (field-source) にも bonus を上乗せする。受益判定は from-player が
    // 相手 (= actingPlayerId と不一致) のとき。amountBonusOverride で抑止可。
    let effectiveAmount = amount;
    let effectiveMinTotal = coreShootMinTotal;
    if (fromPlayerId !== actingPlayerId) {
      const bonus =
        amountBonusOverride !== undefined
          ? amountBonusOverride
          : computeCoreMoveAmountBonus(
              current,
              actingPlayerId,
              sourceInstanceId,
              getCardDefinitionById,
              effectSourceInstanceId
            );
      if (bonus > 0) {
        effectiveAmount = amount + bonus;
        if (effectiveMinTotal !== undefined) {
          effectiveMinTotal = effectiveMinTotal + bonus;
        }
        current.log.push(
          `effect:core_move_amount_modifier:applied:${actingPlayerId}:+${bonus}:base=${amount}:field`
        );
      }
    }
    const pending = analyzeCoreShootCandidates(
      current,
      actingPlayerId,
      from,
      to,
      effectiveAmount,
      sourcePreventionLevel,
      effectiveMinTotal,
      getCardDefinitionById,
      coreSourceImmunityArg,
      sourceInstanceId,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      amount
    );
    if (
      coreShootDistribution &&
      Object.keys(coreShootDistribution).length > 0
    ) {
      if (pending?.sourceGroupMinimums) {
        const total =
          Object.values(coreShootDistribution).reduce((sum, n) => sum + n, 0) +
          (coreShootSoulCoreInstanceId ? 1 : 0);
        if (
          total !== pending.totalAmount ||
          !satisfiesCoreSourceGroupMinimums(
            pending.sourceGroupMinimums,
            coreShootDistribution,
            coreShootSoulCoreInstanceId
          )
        ) {
          throw new Error(
            "Core shoot distribution must preserve each source zone amount"
          );
        }
      }
      // プレイヤーが選択した分配を使用（1回の map で全カード更新）。
      // destination カード自身の分配エントリは除外する (analyzeCoreShootCandidates の
      // fieldCards / auto-resolve fallback の fieldCards・soulCardOnField と同じ
      // 自己参照 no-op 防止。verifier 2026-07-02 round 4 lens 3 指摘: distMap だけ
      // この除外が非対称に欠けていた。SSOT: 除外は distMap 構築時点の1箇所に集約する)。
      const distMap = new Map(
        Object.entries(coreShootDistribution).filter(
          ([instanceId, v]) =>
            v > 0 && instanceId !== coreShootCardDestinationId
        )
      );
      // 直接配分（旧GUI/呼び出し側）でも、候補生成と同じ作用対象判定を通す。
      // pending を経由しない指定が創界神系・対象ロック・免疫を迂回してはならない。
      const fromPlayer = current.players.find((p) => p.id === fromPlayerId);
      const soulSourceId = getCoreShootSoulSourceId(fromPlayer);
      const selectedSoulId =
        coreShootSoulCoreInstanceId === soulSourceId &&
        fromPlayerId === toPlayerId &&
        soulCoreLocationForZone(to.kind, coreShootCardDestinationId)
          ? coreShootSoulCoreInstanceId
          : undefined;
      const selectedSources = new Map(distMap);
      if (selectedSoulId) {
        selectedSources.set(
          selectedSoulId,
          (selectedSources.get(selectedSoulId) ?? 0) + 1
        );
      }
      for (const [instanceId, take] of selectedSources) {
        const card = getCardById(current, instanceId);
        const available = card
          ? getFieldCoreSourceTakeableCount(current, card, actingPlayerId, {
              minRemaining: resolveFieldCoreSourceMinRemaining(
                current,
                card,
                from,
                getCardDefinitionById
              ),
              soulCoresOnCard: instanceId === soulSourceId ? 1 : 0,
              soulCoresMovable: instanceId === selectedSoulId ? 1 : 0,
              sourcePreventionLevel,
              ...(coreSourceImmunityArg
                ? { effectSource: coreSourceImmunityArg }
                : {}),
              getCardDefinitionById,
              ...(sourcePreventionBypass ? { sourcePreventionBypass } : {}),
              filter: from.filter,
              sourceInstanceId,
              sourceTargetLockBypass,
            })
          : 0;
        if (
          !card ||
          card.controllerPlayerId !== fromPlayerId ||
          !Number.isInteger(take) ||
          (distMap.get(instanceId) ?? 0) > card.normalCoreCount ||
          take > available
        ) {
          throw new Error(
            `Core shoot target ${instanceId} is not a valid candidate for ${take} cores`
          );
        }
      }
      let movedTotal = 0;
      for (const v of distMap.values()) movedTotal += v;
      const distRedirectedTotal = sumForcedCoreVoidRedirectTakes(
        current,
        distMap,
        getCardDefinitionById
      );
      // ソウルコア移動（プレイヤーが選択した場合）。移動先 toKind に従う（void は不可）。
      // toKind が field/field_card/card_instance のときは coreShootCardDestinationId
      // (単一候補に解決済みのカード) が渡らない限り soulDest は null になる。
      const logs = [
        `effect:core_move:field:${fromPlayerId}->${to.kind}:${toPlayerId}:${movedTotal}:player-selected`,
      ];
      if (distRedirectedTotal > 0) {
        logs.push(
          `effect:core_move:field:forced_void_redirect:${fromPlayerId}:${distRedirectedTotal}`
        );
      }
      const soulDest = soulCoreLocationForZone(
        to.kind,
        coreShootCardDestinationId
      );
      // cross-player destination では soul ownership 移転が未モデル化のため
      // soul を transfer しない (ENGINE-core-move-soul-cross-player-destination option b)。
      let soulMovedFromPlayerId: string | null = null;
      let soulMovedFromInstanceId: string | null = null;
      if (
        coreShootSoulCoreInstanceId &&
        soulDest &&
        fromPlayerId === toPlayerId
      ) {
        const fromPlayer = current.players.find((p) => p.id === fromPlayerId);
        if (
          getCoreShootSoulSourceId(fromPlayer) === coreShootSoulCoreInstanceId
        ) {
          // ソウルコアは所有者 (fromPlayer) のもの。リザーブ/トラッシュ等は所有者
          // スコープなので、必ず fromPlayer の soulCoreLocation を更新する。
          soulMovedFromPlayerId = fromPlayerId;
          soulMovedFromInstanceId = coreShootSoulCoreInstanceId;
          logs.push(
            `effect:core_move:soul_core:${coreShootSoulCoreInstanceId}->${to.kind}:${fromPlayerId}`
          );
        }
      }
      const normalDestination = coreShootNormalDestination(
        to.kind,
        toPlayerId,
        coreShootCardDestinationId
      );
      let result = current;
      for (const [instanceId, take] of distMap) {
        result = moveNormalCores(
          result,
          { kind: "card", instanceId },
          normalDestination,
          take,
          getCardDefinitionById
        );
      }
      result = { ...result, log: [...result.log, ...logs] };
      return soulMovedFromPlayerId && soulMovedFromInstanceId && soulDest
        ? moveSoulCore(
            result,
            soulMovedFromPlayerId,
            { kind: "card", instanceId: soulMovedFromInstanceId },
            toSoulCoreContainerFromPlayerScoped(
              soulDest,
              soulMovedFromPlayerId
            ),
            1,
            getCardDefinitionById
          )
        : result;
    }
    // GUI 選択が必要か判定
    if (pending) {
      // 選択が必要 → pending ステートを設定して中断
      const sourceCard = current.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      current.log.push(
        `effect:core_move:field:${fromPlayerId}->${to.kind}:${toPlayerId}:pending:${pending.candidates.length}candidates`
      );
      return {
        ...current,
        pendingCoreShootSelection: {
          pendingId: nextPendingSelectionId("cs"),
          actingPlayerId,
          sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          ...(coreSourceEffectIndex !== undefined
            ? { sourceEffectIndex: coreSourceEffectIndex }
            : {}),
          candidates: pending.candidates,
          ...(pending.sourceGroupMinimums
            ? { sourceGroupMinimums: pending.sourceGroupMinimums }
            : {}),
          totalAmount: pending.totalAmount,
          ...(pending.minTotal !== undefined
            ? { minTotal: pending.minTotal }
            : {}),
          toKind: pending.toKind,
          toPlayerId: pending.toPlayerId,
          ...(pending.toCardInstanceId !== undefined
            ? { toCardInstanceId: pending.toCardInstanceId }
            : {}),
          fromPlayerId,
          remainingActions: [],
          effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        },
      };
    }

    // 自動選択 fallback（AI/テスト用・候補が1つ以下・コア合計が amount 以下）— 1回の map で全カード更新
    // analyzeCoreShootCandidates と同じく from.filter / minRemainingPerCandidate を尊重する。
    const autoFilter = from.filter;
    const autoFromPlayer = current.players.find((p) => p.id === fromPlayerId);
    const autoSoulCardId =
      autoFromPlayer?.soulCoreLocation?.kind === "card"
        ? autoFromPlayer.soulCoreLocation.instanceId
        : undefined;
    const autoSoulDest = soulCoreLocationForZone(
      to.kind,
      coreShootCardDestinationId
    );
    // 「残さねばならないコア数」の下限 (soul 取得可否判定に使う)。floor 自体の SSOT は
    // getCoreMinimumProtectedByResistance で、ここは効果側 minRemaining との合成のみ。
    const effectiveAutoMinRemaining = (c: CardInstance) =>
      Math.max(
        resolveFieldCoreSourceMinRemaining(
          current,
          c,
          from,
          getCardDefinitionById
        ),
        getCoreMinimumProtectedByResistance(
          current,
          c,
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          sourcePreventionBypass
        )
      );
    // 候補判定は analyzeCoreShootCandidates と同じ SSOT
    // (getFieldCoreSourceTakeableCount) を通す。独立コア管理 / 対象ロック / 免疫 /
    // CardFilter / コア最低残存数耐性 が一括で効き、除外カードは 0 を返す。
    const autoTakeableCoreCount = (c: CardInstance) =>
      getFieldCoreSourceTakeableCount(current, c, actingPlayerId, {
        minRemaining: resolveFieldCoreSourceMinRemaining(
          current,
          c,
          from,
          getCardDefinitionById
        ),
        soulCoresOnCard: c.instanceId === autoSoulCardId ? 1 : 0,
        soulCoresMovable: c.instanceId === autoSoulCardId ? 1 : 0,
        sourcePreventionLevel,
        ...(coreSourceImmunityArg
          ? { effectSource: coreSourceImmunityArg }
          : {}),
        getCardDefinitionById,
        ...(sourcePreventionBypass ? { sourcePreventionBypass } : {}),
        filter: autoFilter,
        sourceInstanceId,
        sourceTargetLockBypass,
      });
    const canAutoTakeFromCard = (c: CardInstance) =>
      Math.min(c.normalCoreCount, autoTakeableCoreCount(c)) > 0 ||
      (c.instanceId === autoSoulCardId &&
        autoSoulDest !== null &&
        fromPlayerId === toPlayerId &&
        autoTakeableCoreCount(c) > 0);
    const soulCardOnField =
      autoSoulCardId !== undefined &&
      // destination カード自身が soul を保持している場合は候補から除外 (通常コアの
      // fieldCards と同じ自己参照 no-op 防止。verifier 2026-07-02 round 3 lens 3 指摘:
      // 除外しないと soulCoreLocation の自己代入が remaining を消費しつつ ":+soul" と
      // 誤ログし、他の実在する source (reserve 等) からの取得機会を沈黙裡に取りこぼす)。
      autoSoulCardId !== coreShootCardDestinationId &&
      current.cardInstances.some(
        (c) =>
          c.instanceId === autoSoulCardId &&
          c.controllerPlayerId === fromPlayerId &&
          c.zone === "field" &&
          // 免疫 / CardFilter / 対象ロック / 独立コア管理は
          // autoTakeableCoreCount (SSOT) が内包する。
          autoTakeableCoreCount(c) > 0
      );
    const fieldCards = current.cardInstances.filter(
      (c) =>
        c.controllerPlayerId === fromPlayerId &&
        c.zone === "field" &&
        // destination カード自身は通常コアの source 候補から除外 (analyzeCoreShootCandidates
        // と同じ自己参照 no-op 防止。verifier 2026-07-02 round 2 lens 3 指摘)。
        c.instanceId !== coreShootCardDestinationId &&
        // 残数下限・免疫・CardFilter・対象ロック・独立コア管理を通って取れるコアが
        // 残るカードのみ（BSTH04-転醒R02(B) 他）。SSOT: autoTakeableCoreCount。
        canAutoTakeFromCard(c)
    );
    const coreTakes = new Map<string, number>();
    let remaining = effectiveAmount;
    let movedTotal = 0;
    for (const card of fieldCards) {
      if (remaining <= 0) break;
      // 残数下限を超えて取らない（コアを minRemaining 個残す）。
      const take = Math.min(
        remaining,
        card.normalCoreCount,
        autoTakeableCoreCount(card)
      );
      if (take <= 0) continue;
      coreTakes.set(card.instanceId, take);
      remaining -= take;
      movedTotal += take;
    }
    // 通常コアで足りない分は、移動先に置けるソウルコアを1個掴む（void は不可）。
    // 残数下限がある場合、ソウルコア奪取後もソウルカードに minRemaining 個以上残る必要がある
    // （soul-only カードを 0 個にしない）。minRemaining=0 の通常ケースでは無制約。
    const soulCard =
      autoSoulCardId !== undefined
        ? current.cardInstances.find((c) => c.instanceId === autoSoulCardId)
        : undefined;
    const soulCardRemainingAfter = soulCard
      ? soulCard.normalCoreCount -
        (coreTakes.get(soulCard.instanceId) ?? 0) +
        1 - // 未取得のソウルコア1個分
        1 // これから取るソウルコア
      : 0;
    // cross-player destination では soul ownership 移転が未モデル化のため soul を transfer しない
    // (ENGINE-core-move-soul-cross-player-destination option b)。
    const takeSoul =
      remaining > 0 &&
      soulCardOnField &&
      autoSoulDest !== null &&
      fromPlayerId === toPlayerId &&
      soulCard !== undefined &&
      soulCardRemainingAfter >= effectiveAutoMinRemaining(soulCard);
    if (takeSoul) remaining -= 1;
    // フィールド/リザーブ横断（BSTH001-X01）: 通常コア+soul で足りない分はリザーブの
    // 通常コアから補う（reserve→to の移動）。autoFromPlayer のリザーブ通常コア上限。
    const reserveTaken =
      from.includeReserve === true && remaining > 0
        ? Math.min(remaining, autoFromPlayer?.reserveNormalCoreCount ?? 0)
        : 0;
    if (reserveTaken > 0) {
      // remaining はここ以降参照されないため減算しない（no-useless-assignment）。
      movedTotal += reserveTaken;
    }
    const redirectedTotal = sumForcedCoreVoidRedirectTakes(
      current,
      coreTakes,
      getCardDefinitionById
    );
    const normalDestination = coreShootNormalDestination(
      to.kind,
      toPlayerId,
      coreShootCardDestinationId
    );
    let result = current;
    for (const [instanceId, take] of coreTakes) {
      result = moveNormalCores(
        result,
        { kind: "card", instanceId },
        normalDestination,
        take,
        getCardDefinitionById
      );
    }
    if (reserveTaken > 0) {
      result = moveNormalCores(
        result,
        { kind: "reserve", playerId: fromPlayerId },
        normalDestination,
        reserveTaken,
        getCardDefinitionById
      );
    }
    result = {
      ...result,
      log: [
        ...result.log,
        `effect:core_move:field:${fromPlayerId}->${to.kind}:${toPlayerId}:${movedTotal}${takeSoul ? ":+soul" : ""}${reserveTaken > 0 ? `:+reserve${reserveTaken}` : ""}`,
        ...(redirectedTotal > 0
          ? [
              `effect:core_move:field:forced_void_redirect:${fromPlayerId}:${redirectedTotal}`,
            ]
          : []),
      ],
    };
    return takeSoul && autoSoulDest && autoSoulCardId !== undefined
      ? moveSoulCore(
          result,
          fromPlayerId,
          { kind: "card", instanceId: autoSoulCardId },
          toSoulCoreContainerFromPlayerScoped(autoSoulDest, fromPlayerId),
          1,
          getCardDefinitionById
        )
      : result;
  }
  return null;
}

/**
 * field(includeReserve)→removed_from_game: 自分のフィールド/リザーブの<ソウルコア>1個を
 * 除外する (【ソウルドライブ・S】発動コスト、P3-125 Step1)。soul core は player 単一
 * ポインタ (player.soulCoreLocation) のため候補選択は不要 — 現在の所在が自分の場のカード
 * 上 (zone:"field") またはリザーブのときのみ支払い可能。それ以外 (life/trash/未配置) は
 * state 不変で返し、`didNonCardActionChangeState`("core_move") の soulCoreLocation.kind
 * 不変判定が succeeded=false を導き、conditional_cost ロールバックを正しく発火させる
 * (native-effect-front-helpers.ts)。
 */
function handleFieldOrReserveExplicitSoulToRemovedFromGame(
  ctx: CoreMoveContext
): GameState | null {
  const { from, to, effectKind, current, fromPlayerId } = ctx;
  if (from.kind !== "field" || to.kind !== "removed_from_game") return null;
  if (effectKind !== "explicit_soul_core") return null;
  const player = current.players.find((p) => p.id === fromPlayerId);
  const soulLoc = player?.soulCoreLocation;
  if (!soulLoc) return current;
  const soulCard =
    soulLoc.kind === "card"
      ? current.cardInstances.find((c) => c.instanceId === soulLoc.instanceId)
      : undefined;
  const soulOnField =
    soulCard !== undefined &&
    soulCard.controllerPlayerId === fromPlayerId &&
    soulCard.zone === "field";
  const soulInReserve =
    from.includeReserve === true && soulLoc.kind === "reserve";
  if (!soulOnField && !soulInReserve) return current;
  if (
    isExplicitSoulCoreMoveBlockedByImmunity(
      ctx,
      fromPlayerId,
      soulOnField ? soulCard : undefined
    )
  ) {
    current.log.push(
      `effect:core_move:field-or-reserve-soul:${fromPlayerId}->removed_from_game:blocked-by-soul-core-immunity`
    );
    return current;
  }
  const next = moveSoulCore(
    current,
    fromPlayerId,
    soulOnField
      ? { kind: "card", instanceId: soulCard!.instanceId }
      : { kind: "reserve", playerId: fromPlayerId },
    { kind: "removed_from_game" }
  );
  next.log.push(
    `effect:core_move:field-or-reserve-soul:${fromPlayerId}->removed_from_game`
  );
  return next;
}

/**
 * field(includeReserve)→this_card: 自分のフィールド/リザーブの<ソウルコア>1個を
 * このカードへ置く。BSTH03-転醒X01(A) の転醒コスト用で、通常コアは動かさない。
 */
function handleFieldOrReserveExplicitSoulToThisCard(
  ctx: CoreMoveContext
): GameState | null {
  const {
    from,
    to,
    effectKind,
    current,
    actingPlayerId,
    fromPlayerId,
    sourceInstanceId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    coreSourceImmunityArg,
    getCardDefinitionById,
  } = ctx;
  if (from.kind !== "field" || to.kind !== "this_card") return null;
  if (effectKind !== "explicit_soul_core") return null;

  const destination = current.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!destination || destination.controllerPlayerId !== fromPlayerId) {
    return current;
  }

  const player = current.players.find((p) => p.id === fromPlayerId);
  const soulLoc = player?.soulCoreLocation;
  if (!soulLoc) {
    current.log.push(
      `effect:core_move:field-or-reserve-soul:${fromPlayerId}->this_card:${sourceInstanceId}:0:no-cores`
    );
    return current;
  }

  const soulCard =
    soulLoc.kind === "card"
      ? current.cardInstances.find((c) => c.instanceId === soulLoc.instanceId)
      : undefined;
  const soulCardDefinition = soulCard
    ? getCardDefinitionById?.(soulCard.definitionId)
    : undefined;
  // 候補判定は他のコア移動元経路と同じ SSOT (getFieldCoreSourceTakeableCount)。
  // ソウルコア1個を取るので「total - 1 >= 保護下限」= takeable >= 1 と同値。
  const soulCardPassesSourceGates =
    soulCard !== undefined &&
    soulCardDefinition !== undefined &&
    getFieldCoreSourceTakeableCount(current, soulCard, actingPlayerId, {
      soulCoresOnCard: soulCard.soulCoreCount,
      soulCoresMovable: soulCard.soulCoreCount,
      sourcePreventionLevel,
      ...(coreSourceImmunityArg ? { effectSource: coreSourceImmunityArg } : {}),
      getCardDefinitionById,
      ...(sourcePreventionBypass ? { sourcePreventionBypass } : {}),
      filter: from.filter,
      sourceInstanceId,
      sourceTargetLockBypass,
    }) >= 1;
  const soulOnField =
    soulCardPassesSourceGates &&
    soulCard.controllerPlayerId === fromPlayerId &&
    soulCard.zone === "field" &&
    soulCard.instanceId !== sourceInstanceId;
  const soulInReserve =
    from.includeReserve === true && soulLoc.kind === "reserve";

  if (!soulOnField && !soulInReserve) {
    current.log.push(
      `effect:core_move:field-or-reserve-soul:${fromPlayerId}->this_card:${sourceInstanceId}:0:no-cores`
    );
    return current;
  }
  if (
    isExplicitSoulCoreMoveBlockedByImmunity(
      ctx,
      fromPlayerId,
      soulOnField ? soulCard : undefined
    )
  ) {
    current.log.push(
      `effect:core_move:field-or-reserve-soul:${fromPlayerId}->this_card:${sourceInstanceId}:blocked-by-soul-core-immunity`
    );
    return current;
  }

  const next = moveSoulCore(
    current,
    fromPlayerId,
    soulOnField
      ? { kind: "card", instanceId: soulCard!.instanceId }
      : { kind: "reserve", playerId: fromPlayerId },
    { kind: "card", instanceId: sourceInstanceId },
    1,
    getCardDefinitionById
  );
  next.log.push(
    `effect:core_move:field-or-reserve-soul:${fromPlayerId}->this_card:${sourceInstanceId}:1`
  );
  return next;
}

/**
 * life→this_card: 《ソウルコア》明示時のみ、ライフ上のソウルコアだけをこのカードへ置く。
 * 通常のライフ減少処理とは異なり、通常コア移動や life damage interception は発生させない。
 */
function handleLifeExplicitSoulToThisCard(
  ctx: CoreMoveContext
): GameState | null {
  const { from, to, effectKind, current, fromPlayerId, sourceInstanceId } = ctx;
  if (!(from.kind === "life" && to.kind === "this_card")) return null;
  if (effectKind !== "explicit_soul_core") return null;

  const destination = current.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const player = current.players.find((p) => p.id === fromPlayerId);
  if (
    !destination ||
    destination.ownerPlayerId !== fromPlayerId ||
    player?.soulCoreLocation?.kind !== "life"
  ) {
    current.log.push(
      `effect:core_move:life-soul:${fromPlayerId}->this_card:${sourceInstanceId}:0:no-cores`
    );
    return current;
  }
  if (isExplicitSoulCoreMoveBlockedByImmunity(ctx, fromPlayerId)) {
    current.log.push(
      `effect:core_move:life-soul:${fromPlayerId}->this_card:${sourceInstanceId}:blocked-by-soul-core-immunity`
    );
    return current;
  }

  const next = moveSoulCore(
    current,
    fromPlayerId,
    { kind: "life", playerId: fromPlayerId },
    { kind: "card", instanceId: sourceInstanceId },
    1,
    ctx.getCardDefinitionById
  );
  next.log.push(
    `effect:core_move:life-soul:${fromPlayerId}->this_card:${sourceInstanceId}:1`
  );
  return next;
}

/** life→this_card: ライフのコアをこのカードへ (interception/owner-choice pending/partition)。 */
function handleLifeToThisCard(ctx: CoreMoveContext): GameState | null {
  let current = ctx.current;
  const {
    from,
    to,
    actingPlayerId,
    fromPlayerId,
    amount,
    skipLifeDamageInterception,
    getCardDefinitionById,
    coreMoveDiscardResumeContext,
    sourceInstanceId,
    lifeCorePartitionOverride,
    allowPendingLifeCoreSelection,
    effectTiming,
    sourcePreventionLevel,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
  } = ctx;
  if (from.kind === "life" && to.kind === "this_card") {
    const cause =
      actingPlayerId !== fromPlayerId ? "opponent_effect" : "self_effect";
    let adjustedAmount: number;
    if (skipLifeDamageInterception) {
      adjustedAmount = amount;
    } else {
      const interception = applyLifeDamageInterception(
        current,
        fromPlayerId,
        amount,
        createCoreMoveLifeDamageContext(
          ctx,
          cause as "opponent_effect" | "self_effect"
        ),
        getCardDefinitionById
      );
      current = interception.state;
      if (interception.replaced) return current;
      if (interception.pendingDiscardChoice) {
        return {
          ...current,
          pendingLifeDamageDiscardChoice: {
            pendingId: `ldc-cm-${current.log.length}-${fromPlayerId}`,
            decidingPlayerId: fromPlayerId,
            actingPlayerId,
            cause: cause as "opponent_effect" | "self_effect",
            pendingAmount: interception.adjustedAmount,
            entries: interception.pendingDiscardChoice.entries,
            ...(interception.pendingDiscardChoice.turnCapConsumption
              ? {
                  turnCapConsumption:
                    interception.pendingDiscardChoice.turnCapConsumption,
                }
              : {}),
            coreMoveResume: coreMoveDiscardResumeContext,
            ...(coreMoveDiscardResumeContext.battleEndDeferralAttackId !==
            undefined
              ? {
                  battleEndDeferralAttackId:
                    coreMoveDiscardResumeContext.battleEndDeferralAttackId,
                }
              : {}),
          },
        };
      }
      adjustedAmount = interception.adjustedAmount;
    }
    const player = current.players.find((p) => p.id === fromPlayerId);
    const destinationCardOwnerId = current.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    )?.ownerPlayerId;
    const allowSoulCoreMove = destinationCardOwnerId === fromPlayerId;

    if (
      allowSoulCoreMove &&
      !lifeCorePartitionOverride &&
      allowPendingLifeCoreSelection &&
      player
    ) {
      const normalAvail = player.lifeNormalCoreCount;
      // primary ポインタ判定を維持する (adversarial verifier round2: count ベース化は
      // withSoulCoreLocation 経由の corruption を招くため不採用、partitionLifeMoveWithSoul
      // 参照)。
      const soulAvail = player.soulCoreLocation?.kind === "life" ? 1 : 0;
      if (
        adjustedAmount >= 1 &&
        soulAvail >= 1 &&
        normalAvail >= adjustedAmount
      ) {
        const sourceCard = current.cardInstances.find(
          (c) => c.instanceId === sourceInstanceId
        );
        current.log.push(
          `effect:core_move:life:${fromPlayerId}->this_card:pending:owner-choice:normal=${normalAvail}/soul=${soulAvail}/amount=${adjustedAmount}`
        );
        return {
          ...current,
          pendingLifeCoreSelection: {
            pendingId: nextLifeCoreSelectionId(),
            actingPlayerId: fromPlayerId,
            effectSourcePlayerId: actingPlayerId,
            sourceInstanceId,
            sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
            fromLocation: from,
            toLocation: to,
            normalAvailable: normalAvail,
            soulAvailable: soulAvail,
            totalAmount: adjustedAmount,
            effectTiming: effectTiming ?? { kind: "activated", mode: "flash" },
            ...(sourcePreventionLevel !== undefined
              ? { sourcePreventionLevel }
              : {}),
            ...(coreSourceEffectIndex !== undefined
              ? { sourceEffectIndex: coreSourceEffectIndex }
              : {}),
            ...(coreSourceTargetStepId !== undefined
              ? { sourceTargetStepId: coreSourceTargetStepId }
              : {}),
            ...(sourceTargetLockBypass !== undefined
              ? { sourceTargetLockBypass }
              : {}),
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
            ...(effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId }
              : {}),
            ...(effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId }
              : {}),
          },
        };
      }
    }

    const partition = lifeCorePartitionOverride
      ? {
          normalTaken: lifeCorePartitionOverride.normalChosen,
          soulTaken: lifeCorePartitionOverride.soulChosen,
        }
      : allowSoulCoreMove
        ? partitionLifeMoveWithSoul(player, adjustedAmount)
        : {
            normalTaken: Math.min(
              adjustedAmount,
              player?.lifeNormalCoreCount ?? 0
            ),
            soulTaken: 0,
          };
    const available = partition.normalTaken + partition.soulTaken;
    if (available <= 0) {
      current.log.push(
        `effect:core_move:life->this_card:${fromPlayerId}->${sourceInstanceId}:insufficient:0`
      );
      return current;
    }
    current.log.push(
      `effect:core_move:life:${fromPlayerId}->this_card:${sourceInstanceId}:${available}${partition.soulTaken > 0 ? ":soul=1" : ""}`
    );
    let result = current;
    if (partition.normalTaken > 0) {
      result = moveNormalCores(
        result,
        { kind: "life", playerId: fromPlayerId },
        { kind: "card", instanceId: sourceInstanceId },
        partition.normalTaken,
        getCardDefinitionById
      );
    }
    return partition.soulTaken > 0
      ? moveSoulCore(
          result,
          fromPlayerId,
          { kind: "life", playerId: fromPlayerId },
          { kind: "card", instanceId: sourceInstanceId },
          partition.soulTaken,
          getCardDefinitionById
        )
      : result;
  }
  return null;
}

/** life→reserve: ライフのコアをリザーブへ (interception/owner-choice pending/soul-fallback)。 */
function handleLifeToReserve(ctx: CoreMoveContext): GameState | null {
  let current = ctx.current;
  const {
    from,
    to,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    skipLifeDamageInterception,
    getCardDefinitionById,
    coreMoveDiscardResumeContext,
    sourceInstanceId,
    lifeCorePartitionOverride,
    allowPendingLifeCoreSelection,
    effectTiming,
    sourcePreventionLevel,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
  } = ctx;
  if (from.kind === "life" && to.kind === "reserve") {
    let adjustedAmount: number;
    if (skipLifeDamageInterception) {
      // resume: 既に pending 生成時に interception を適用済 (totalAmount = adjusted)
      adjustedAmount = amount;
    } else {
      // ライフダメージインターセプション（core_move 経由のライフ減少にも適用）
      const cause =
        actingPlayerId !== fromPlayerId ? "opponent_effect" : "self_effect";
      const interception = applyLifeDamageInterception(
        current,
        fromPlayerId,
        amount,
        createCoreMoveLifeDamageContext(
          ctx,
          cause as "opponent_effect" | "self_effect"
        ),
        getCardDefinitionById
      );
      current = interception.state;
      if (interception.replaced) return current;
      if (interception.pendingDiscardChoice) {
        return {
          ...current,
          pendingLifeDamageDiscardChoice: {
            pendingId: `ldc-cm-${current.log.length}-${fromPlayerId}`,
            decidingPlayerId: fromPlayerId,
            actingPlayerId,
            cause: cause as "opponent_effect" | "self_effect",
            pendingAmount: interception.adjustedAmount,
            entries: interception.pendingDiscardChoice.entries,
            ...(interception.pendingDiscardChoice.turnCapConsumption
              ? {
                  turnCapConsumption:
                    interception.pendingDiscardChoice.turnCapConsumption,
                }
              : {}),
            coreMoveResume: coreMoveDiscardResumeContext,
            ...(coreMoveDiscardResumeContext.battleEndDeferralAttackId !==
            undefined
              ? {
                  battleEndDeferralAttackId:
                    coreMoveDiscardResumeContext.battleEndDeferralAttackId,
                }
              : {}),
          },
        };
      }
      adjustedAmount = interception.adjustedAmount;
    }

    const player = current.players.find((p) => p.id === fromPlayerId);
    // ENGINE-core-move-from-life-owner-soul-choice: 通常 / ソウル混在で真の選択肢が
    // ある (normalAvail >= amount かつ soulAvail >= 1 かつ amount >= 1) ときは
    // ライフ持ち主に partition を選ばせる pending を立てて halt。BS35 Q22728「通常コアと
    // ソウルコアの選択は持ち主」。継続再呼び出しは `applyPendingLifeCoreSelectionAction`。
    if (!lifeCorePartitionOverride && allowPendingLifeCoreSelection && player) {
      const normalAvail = player.lifeNormalCoreCount;
      // primary ポインタ判定を維持する (adversarial verifier round2: count ベース化は
      // withSoulCoreLocation 経由の corruption を招くため不採用、partitionLifeMoveWithSoul
      // 参照)。
      const soulAvail = player.soulCoreLocation?.kind === "life" ? 1 : 0;
      if (
        adjustedAmount >= 1 &&
        soulAvail >= 1 &&
        normalAvail >= adjustedAmount
      ) {
        const sourceCard = current.cardInstances.find(
          (c) => c.instanceId === sourceInstanceId
        );
        current.log.push(
          `effect:core_move:life:${fromPlayerId}->reserve:pending:owner-choice:normal=${normalAvail}/soul=${soulAvail}/amount=${adjustedAmount}`
        );
        return {
          ...current,
          pendingLifeCoreSelection: {
            pendingId: nextLifeCoreSelectionId(),
            actingPlayerId: fromPlayerId,
            effectSourcePlayerId: actingPlayerId,
            sourceInstanceId,
            sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
            fromLocation: from,
            toLocation: to,
            normalAvailable: normalAvail,
            soulAvailable: soulAvail,
            totalAmount: adjustedAmount,
            effectTiming: effectTiming ?? { kind: "activated", mode: "flash" },
            ...(sourcePreventionLevel !== undefined
              ? { sourcePreventionLevel }
              : {}),
            ...(coreSourceEffectIndex !== undefined
              ? { sourceEffectIndex: coreSourceEffectIndex }
              : {}),
            ...(coreSourceTargetStepId !== undefined
              ? { sourceTargetStepId: coreSourceTargetStepId }
              : {}),
            ...(sourceTargetLockBypass !== undefined
              ? { sourceTargetLockBypass }
              : {}),
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
            ...(effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId }
              : {}),
            ...(effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId }
              : {}),
          },
        };
      }
    }

    // 10_rules/06 §41-42: generic な「コア」はソウルコアを含む。ライフが soul のみ
    // (lifeNormalCoreCount=0 + soulCoreLocation.kind=="life") のとき、normal-first auto-pick
    // で fallback してソウルコアを移動先へ運ぶ。soulCoreLocation を {kind:"reserve"} に更新。
    // ENGINE-core-move-from-life-soul-inclusion の auto-pick 簡略実装 (player-choice は次段)。
    const partition = lifeCorePartitionOverride
      ? {
          normalTaken: lifeCorePartitionOverride.normalChosen,
          soulTaken: lifeCorePartitionOverride.soulChosen,
        }
      : partitionLifeMoveWithSoul(player, adjustedAmount);
    const available = partition.normalTaken + partition.soulTaken;
    const soulDest: import("../model").PlayerScopedSoulCoreLocation | null =
      partition.soulTaken > 0
        ? to.kind === "reserve"
          ? { kind: "reserve" }
          : null
        : null;
    current.log.push(
      `effect:core_move:life:${fromPlayerId}->reserve:${toPlayerId}:${available}${partition.soulTaken > 0 ? ":soul=1" : ""}`
    );
    const result = {
      ...current,
      players: current.players.map((p) => {
        const isFrom = p.id === fromPlayerId;
        const isTo = p.id === toPlayerId;
        if (!isFrom && !isTo) return p;
        const next = { ...p };
        if (isFrom) {
          next.lifeNormalCoreCount =
            p.lifeNormalCoreCount - partition.normalTaken;
        }
        if (isTo) {
          // ソウルコアは soulCoreLocation で別管理 (10_rules/06 §32 「通常コアとは別種」)。
          // 通常コアのみ reserveNormalCoreCount に加算。soul は soulCoreLocation 更新のみ。
          const baseReserve = isFrom
            ? next.reserveNormalCoreCount
            : p.reserveNormalCoreCount;
          next.reserveNormalCoreCount = baseReserve + partition.normalTaken;
        }
        return next;
      }),
    };
    return soulDest
      ? withSoulCoreLocation(result, fromPlayerId, soulDest)
      : result;
  }
  return null;
}

function moveNormalCoreDistributionToFieldCards(
  state: GameState,
  from: NormalCoreContainer,
  allocations: ReadonlyMap<string, number>,
  candidates: readonly CardInstance[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  let next = state;
  for (const [instanceId, give] of allocations) {
    if (give <= 0) continue;
    const targetExists = candidates.some((c) => c.instanceId === instanceId);
    if (!targetExists) {
      throw new Error(
        `Core distribution target ${instanceId} is not a candidate`
      );
    }
    next = moveNormalCores(
      next,
      from,
      { kind: "card", instanceId },
      give,
      getCardDefinitionById
    );
  }
  return next;
}

/** life→field/field_card: ライフのコアをフィールドカードへ (interception/分配 pending/soul 配置)。 */
function handleLifeToFieldOrFieldCard(ctx: CoreMoveContext): GameState | null {
  let current = ctx.current;
  const {
    from,
    to,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    skipLifeDamageInterception,
    getCardDefinitionById,
    coreMoveDiscardResumeContext,
    sourceInstanceId,
    lifeCorePartitionOverride,
    allowPendingLifeCoreSelection,
    effectTiming,
    sourcePreventionLevel,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
    coreDistributionAllocations,
    coreDistributionSoulCoreInstanceId,
    coreDistributionSoulCoreAllocations,
  } = ctx;
  if (
    from.kind === "life" &&
    (to.kind === "field" || to.kind === "field_card")
  ) {
    const isAllMode = !Number.isFinite(amount);
    let adjustedAmount: number;
    if (skipLifeDamageInterception) {
      adjustedAmount = amount;
    } else {
      const cause =
        actingPlayerId !== fromPlayerId ? "opponent_effect" : "self_effect";
      const interception = applyLifeDamageInterception(
        current,
        fromPlayerId,
        amount,
        createCoreMoveLifeDamageContext(
          ctx,
          cause as "opponent_effect" | "self_effect"
        ),
        getCardDefinitionById
      );
      current = interception.state;
      if (interception.replaced) return current;
      if (interception.pendingDiscardChoice) {
        return {
          ...current,
          pendingLifeDamageDiscardChoice: {
            pendingId: `ldc-cm-${current.log.length}-${fromPlayerId}`,
            decidingPlayerId: fromPlayerId,
            actingPlayerId,
            cause: cause as "opponent_effect" | "self_effect",
            pendingAmount: interception.adjustedAmount,
            entries: interception.pendingDiscardChoice.entries,
            ...(interception.pendingDiscardChoice.turnCapConsumption
              ? {
                  turnCapConsumption:
                    interception.pendingDiscardChoice.turnCapConsumption,
                }
              : {}),
            coreMoveResume: coreMoveDiscardResumeContext,
            ...(coreMoveDiscardResumeContext.battleEndDeferralAttackId !==
            undefined
              ? {
                  battleEndDeferralAttackId:
                    coreMoveDiscardResumeContext.battleEndDeferralAttackId,
                }
              : {}),
          },
        };
      }
      adjustedAmount = interception.adjustedAmount;
    }

    const player = current.players.find((p) => p.id === fromPlayerId);
    // ENGINE-core-move-from-life-owner-soul-choice: 通常/ソウル混在で真の選択肢が
    // あるときはライフ持ち主に partition を選ばせる pending を立てて halt
    // (life→trash/reserve と同じ BS35 Q22728 パターン)。
    if (!lifeCorePartitionOverride && allowPendingLifeCoreSelection && player) {
      const normalAvail = player.lifeNormalCoreCount;
      // primary ポインタ判定を維持する (adversarial verifier round2: count ベース化は
      // withSoulCoreLocation 経由の corruption を招くため不採用、partitionLifeMoveWithSoul
      // 参照)。
      const soulAvail = player.soulCoreLocation?.kind === "life" ? 1 : 0;
      if (
        adjustedAmount >= 1 &&
        soulAvail >= 1 &&
        normalAvail >= adjustedAmount
      ) {
        const sourceCard = current.cardInstances.find(
          (c) => c.instanceId === sourceInstanceId
        );
        current.log.push(
          `effect:core_move:life:${fromPlayerId}->field:pending:owner-choice:normal=${normalAvail}/soul=${soulAvail}/amount=${adjustedAmount}`
        );
        return {
          ...current,
          pendingLifeCoreSelection: {
            pendingId: nextLifeCoreSelectionId(),
            actingPlayerId: fromPlayerId,
            effectSourcePlayerId: actingPlayerId,
            sourceInstanceId,
            sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
            fromLocation: from,
            toLocation: to,
            normalAvailable: normalAvail,
            soulAvailable: soulAvail,
            totalAmount: adjustedAmount,
            effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
            ...(sourcePreventionLevel !== undefined
              ? { sourcePreventionLevel }
              : {}),
            ...(coreSourceEffectIndex !== undefined
              ? { sourceEffectIndex: coreSourceEffectIndex }
              : {}),
            ...(coreSourceTargetStepId !== undefined
              ? { sourceTargetStepId: coreSourceTargetStepId }
              : {}),
            ...(sourceTargetLockBypass !== undefined
              ? { sourceTargetLockBypass }
              : {}),
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
            ...(effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId }
              : {}),
            ...(effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId }
              : {}),
            ...(ctx.coreMoveDestinationTargetIds !== undefined
              ? {
                  coreMoveDestinationTargetIds: [
                    ...ctx.coreMoveDestinationTargetIds,
                  ],
                }
              : {}),
          },
        };
      }
    }

    // 10_rules/06 §41-42: generic 「ライフのコア」はソウルコアを含む。通常コアで
    // 足りない分だけソウルコアを補う normal-first・soul-fallback auto-pick
    // (life→trash/reserve と同じ partitionLifeMoveWithSoul)。
    const partition = lifeCorePartitionOverride
      ? {
          normalTaken: lifeCorePartitionOverride.normalChosen,
          soulTaken: lifeCorePartitionOverride.soulChosen,
        }
      : partitionLifeMoveWithSoul(player, adjustedAmount);
    const lifeNormalCores = partition.normalTaken;
    // cross-player destination では soul ownership 移転が未モデル化のため対象外
    // (ENGINE-core-move-soul-cross-player-destination option b。
    // analyzeCoreShootCandidates と同じ候補側除外パターン。選ばれなかった soul は
    // ライフに残る)。
    const lifeSoulCoreCount =
      fromPlayerId === toPlayerId
        ? isAllMode
          ? getCoreDistributionSoulCoreCountForZone({
              player,
              kind: "life",
              amount: adjustedAmount,
              effectKind: ctx.effectKind,
            })
          : partition.soulTaken
        : 0;
    const lifeHasSoulCore = lifeSoulCoreCount > 0;
    const fieldCards = collectFieldCardDestinationCandidates({
      state: current,
      to,
      toPlayerId,
      getCardDefinitionById,
      coreMoveDestinationTargetIds: ctx.coreMoveDestinationTargetIds,
    });
    if (
      fieldCards.length === 0 ||
      (lifeNormalCores === 0 && !lifeHasSoulCore)
    ) {
      current.log.push(
        `effect:core_move:life->field:${fromPlayerId}:0:no-targets`
      );
      return current;
    }

    // GUI/プレイヤーが配分を渡してきた場合は適用
    if (
      coreDistributionAllocations !== undefined ||
      coreDistributionSoulCoreInstanceId !== undefined ||
      coreDistributionSoulCoreAllocations !== undefined
    ) {
      const allocs = coreDistributionAllocations ?? {};
      const allocMap = new Map(Object.entries(allocs).filter(([, v]) => v > 0));
      let movedTotal = 0;
      for (const v of allocMap.values()) movedTotal += v;
      const soulAllocs = normalizeCoreDistributionSoulCoreAllocations({
        soulCoreAllocations: coreDistributionSoulCoreAllocations,
        soulCoreInstanceId: coreDistributionSoulCoreInstanceId,
        totalSoulCores: lifeSoulCoreCount,
      });
      const selectedSoulCoreCount =
        sumCoreDistributionSoulCoreAllocations(soulAllocs);
      const effectiveMovedTotal = movedTotal + selectedSoulCoreCount;
      if (movedTotal > lifeNormalCores) {
        throw new Error(
          `Core distribution total ${movedTotal} exceeds available ${lifeNormalCores}`
        );
      }
      if (selectedSoulCoreCount > lifeSoulCoreCount) {
        throw new Error(
          `Core distribution soul total ${selectedSoulCoreCount} exceeds available ${lifeSoulCoreCount}`
        );
      }
      if (!isAllMode && effectiveMovedTotal > adjustedAmount) {
        throw new Error(
          `Core distribution total ${effectiveMovedTotal} exceeds maximum ${adjustedAmount}`
        );
      }
      assertCompleteCoreDistributionForAllMode({
        isAllMode,
        sourceLabel: "life",
        normalTotal: lifeNormalCores,
        normalSelected: movedTotal,
        totalSoulCores: lifeSoulCoreCount,
        selectedSoulCores: selectedSoulCoreCount,
      });
      const logs: string[] = [];
      logs.push(
        movedTotal > 0
          ? `effect:core_move:life:${fromPlayerId}->field:${toPlayerId}:${movedTotal}:player-selected`
          : `effect:core_move:life->field:${fromPlayerId}:0:player-selected-empty`
      );
      // ソウルコア配置（プレイヤー指定）。cross-player destination では soul ownership
      // 移転が未モデル化のため対象外 (ENGINE-core-move-soul-cross-player-destination
      // option b と同じ guard)。
      if (selectedSoulCoreCount > 0 && fromPlayerId !== toPlayerId) {
        throw new Error(
          "Core distribution soul-core source is not allowed for cross-player destination"
        );
      }
      for (const [targetInstanceId, soulAmount] of Object.entries(soulAllocs)) {
        if (soulAmount <= 0) continue;
        const targetExists = fieldCards.some(
          (c) => c.instanceId === targetInstanceId
        );
        if (!targetExists) {
          throw new Error(
            `Soul core target ${targetInstanceId} is not a candidate`
          );
        }
        logs.push(
          `effect:core_move:soul_core:${fromPlayerId}:life->field:${targetInstanceId}:${soulAmount}`
        );
      }
      let result = moveNormalCoreDistributionToFieldCards(
        current,
        { kind: "life", playerId: fromPlayerId },
        allocMap,
        fieldCards,
        getCardDefinitionById
      );
      result = { ...result, log: [...result.log, ...logs] };
      if (selectedSoulCoreCount > 0) {
        for (const [targetInstanceId, soulAmount] of Object.entries(
          soulAllocs
        )) {
          if (soulAmount <= 0) continue;
          result = moveSoulCore(
            result,
            fromPlayerId,
            { kind: "life", playerId: fromPlayerId },
            { kind: "card", instanceId: targetInstanceId },
            soulAmount,
            getCardDefinitionById
          );
        }
      }
      return result;
    }

    // 候補が複数 or ソウルコアがある場合 → pending 状態でプレイヤー選択を要求
    if (fieldCards.length > 1 || lifeHasSoulCore) {
      const sourceCard = current.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      current.log.push(
        `effect:core_move:life:${fromPlayerId}->field:${toPlayerId}:pending:${fieldCards.length}targets:soulCore=${lifeHasSoulCore}`
      );
      const priorStateSnapshot = current;
      return {
        ...current,
        pendingCoreDistribution: {
          pendingId: nextPendingSelectionId("cd"),
          actingPlayerId,
          sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          candidates: fieldCards.map((c) => ({
            instanceId: c.instanceId,
            definitionId: c.definitionId,
          })),
          totalNormalCores: lifeNormalCores,
          hasSoulCore: lifeHasSoulCore,
          ...(lifeHasSoulCore ? { totalSoulCores: lifeSoulCoreCount } : {}),
          fromKind: "life",
          ...(isAllMode && lifeNormalCores > 0
            ? { minTotal: lifeNormalCores }
            : {}),
          ...(isAllMode && lifeHasSoulCore ? { mustPlaceSoulCore: true } : {}),
          fromPlayerId,
          toPlayerId,
          effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
          priorStateSnapshot,
        },
      };
    }

    // 自動 fallback: フィールドカード1枚のみ・ソウルコア無し
    const target = fieldCards[0]!;
    const movedTotal = lifeNormalCores;
    const moved = moveNormalCores(
      current,
      { kind: "life", playerId: fromPlayerId },
      { kind: "card", instanceId: target.instanceId },
      movedTotal,
      getCardDefinitionById
    );
    return {
      ...moved,
      log: [
        ...moved.log,
        `effect:core_move:life:${fromPlayerId}->field:${toPlayerId}:${movedTotal}:single-target`,
      ],
    };
  }
  return null;
}

/** life→trash: ライフのコアをトラッシュへ (interception/owner-choice pending/soul-fallback)。 */
function handleLifeToTrash(ctx: CoreMoveContext): GameState | null {
  let current = ctx.current;
  const {
    from,
    to,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    skipLifeDamageInterception,
    getCardDefinitionById,
    coreMoveDiscardResumeContext,
    sourceInstanceId,
    lifeCorePartitionOverride,
    allowPendingLifeCoreSelection,
    effectTiming,
    sourcePreventionLevel,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
  } = ctx;
  if (from.kind === "life" && to.kind === "trash") {
    let adjustedAmount: number;
    if (skipLifeDamageInterception) {
      adjustedAmount = amount;
    } else {
      // ライフダメージインターセプション
      const cause =
        actingPlayerId !== fromPlayerId ? "opponent_effect" : "self_effect";
      const interception = applyLifeDamageInterception(
        current,
        fromPlayerId,
        amount,
        createCoreMoveLifeDamageContext(
          ctx,
          cause as "opponent_effect" | "self_effect"
        ),
        getCardDefinitionById
      );
      current = interception.state;
      if (interception.replaced) return current;
      if (interception.pendingDiscardChoice) {
        return {
          ...current,
          pendingLifeDamageDiscardChoice: {
            pendingId: `ldc-cm-${current.log.length}-${fromPlayerId}`,
            decidingPlayerId: fromPlayerId,
            actingPlayerId,
            cause: cause as "opponent_effect" | "self_effect",
            pendingAmount: interception.adjustedAmount,
            entries: interception.pendingDiscardChoice.entries,
            ...(interception.pendingDiscardChoice.turnCapConsumption
              ? {
                  turnCapConsumption:
                    interception.pendingDiscardChoice.turnCapConsumption,
                }
              : {}),
            coreMoveResume: coreMoveDiscardResumeContext,
            ...(coreMoveDiscardResumeContext.battleEndDeferralAttackId !==
            undefined
              ? {
                  battleEndDeferralAttackId:
                    coreMoveDiscardResumeContext.battleEndDeferralAttackId,
                }
              : {}),
          },
        };
      }
      adjustedAmount = interception.adjustedAmount;
    }

    const player = current.players.find((p) => p.id === fromPlayerId);
    // ENGINE-core-move-from-life-owner-soul-choice: 混在選択肢があれば pending+halt。
    if (!lifeCorePartitionOverride && allowPendingLifeCoreSelection && player) {
      const normalAvail = player.lifeNormalCoreCount;
      // primary ポインタ判定を維持する (adversarial verifier round2: count ベース化は
      // withSoulCoreLocation 経由の corruption を招くため不採用、partitionLifeMoveWithSoul
      // 参照)。
      const soulAvail = player.soulCoreLocation?.kind === "life" ? 1 : 0;
      if (
        adjustedAmount >= 1 &&
        soulAvail >= 1 &&
        normalAvail >= adjustedAmount
      ) {
        const sourceCard = current.cardInstances.find(
          (c) => c.instanceId === sourceInstanceId
        );
        current.log.push(
          `effect:core_move:life:${fromPlayerId}->trash:pending:owner-choice:normal=${normalAvail}/soul=${soulAvail}/amount=${adjustedAmount}`
        );
        return {
          ...current,
          pendingLifeCoreSelection: {
            pendingId: nextLifeCoreSelectionId(),
            actingPlayerId: fromPlayerId,
            effectSourcePlayerId: actingPlayerId,
            sourceInstanceId,
            sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
            fromLocation: from,
            toLocation: to,
            normalAvailable: normalAvail,
            soulAvailable: soulAvail,
            totalAmount: adjustedAmount,
            effectTiming: effectTiming ?? { kind: "activated", mode: "flash" },
            ...(sourcePreventionLevel !== undefined
              ? { sourcePreventionLevel }
              : {}),
            ...(coreSourceEffectIndex !== undefined
              ? { sourceEffectIndex: coreSourceEffectIndex }
              : {}),
            ...(coreSourceTargetStepId !== undefined
              ? { sourceTargetStepId: coreSourceTargetStepId }
              : {}),
            ...(sourceTargetLockBypass !== undefined
              ? { sourceTargetLockBypass }
              : {}),
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
            ...(effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId }
              : {}),
            ...(effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId }
              : {}),
          },
        };
      }
    }

    // 10_rules/06 §41-42: generic 「ライフのコア」はソウルコアを含む。
    // ENGINE-core-move-from-life-soul-inclusion の auto-pick (normal-first/soul-fallback)。
    const partition = lifeCorePartitionOverride
      ? {
          normalTaken: lifeCorePartitionOverride.normalChosen,
          soulTaken: lifeCorePartitionOverride.soulChosen,
        }
      : partitionLifeMoveWithSoul(player, adjustedAmount);
    const available = partition.normalTaken + partition.soulTaken;
    const soulDest: import("../model").PlayerScopedSoulCoreLocation | null =
      partition.soulTaken > 0 ? { kind: "trash" } : null;
    current.log.push(
      `effect:core_move:life:${fromPlayerId}->trash:${toPlayerId}:${available}${partition.soulTaken > 0 ? ":soul=1" : ""}`
    );
    const result = {
      ...current,
      players: current.players.map((p) => {
        // 同一プレイヤー (BSTH01-C12 等の「自分のライフ→自分のトラッシュ」) では
        // life 減算と trash 加算を 1 度の map で同時適用する必要がある。
        const isFrom = p.id === fromPlayerId;
        const isTo = p.id === toPlayerId;
        if (!isFrom && !isTo) return p;
        const next = { ...p };
        if (isFrom) {
          next.lifeNormalCoreCount =
            p.lifeNormalCoreCount - partition.normalTaken;
        }
        if (isTo) {
          // ソウルコアは soulCoreLocation 別管理。通常コアのみ trashNormalCoreCount に加算。
          next.trashNormalCoreCount =
            (isFrom ? next.trashNormalCoreCount : p.trashNormalCoreCount) +
            partition.normalTaken;
        }
        return next;
      }),
    };
    return soulDest
      ? withSoulCoreLocation(result, fromPlayerId, soulDest)
      : result;
  }
  return null;
}

/** life→void: ライフのコアをボイドへ (interception のみ・partition 無し)。 */
function handleLifeToVoid(ctx: CoreMoveContext): GameState | null {
  let current = ctx.current;
  const {
    from,
    to,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    skipLifeDamageInterception,
    getCardDefinitionById,
    coreMoveDiscardResumeContext,
  } = ctx;
  if (from.kind === "life" && to.kind === "void") {
    const cause =
      actingPlayerId !== fromPlayerId ? "opponent_effect" : "self_effect";
    let adjustedAmount: number;
    if (skipLifeDamageInterception) {
      adjustedAmount = amount;
    } else {
      const interception = applyLifeDamageInterception(
        current,
        fromPlayerId,
        amount,
        createCoreMoveLifeDamageContext(
          ctx,
          cause as "opponent_effect" | "self_effect"
        ),
        getCardDefinitionById
      );
      current = interception.state;
      if (interception.replaced) return current;
      if (interception.pendingDiscardChoice) {
        return {
          ...current,
          pendingLifeDamageDiscardChoice: {
            pendingId: `ldc-cm-${current.log.length}-${fromPlayerId}`,
            decidingPlayerId: fromPlayerId,
            actingPlayerId,
            cause: cause as "opponent_effect" | "self_effect",
            pendingAmount: interception.adjustedAmount,
            entries: interception.pendingDiscardChoice.entries,
            ...(interception.pendingDiscardChoice.turnCapConsumption
              ? {
                  turnCapConsumption:
                    interception.pendingDiscardChoice.turnCapConsumption,
                }
              : {}),
            coreMoveResume: coreMoveDiscardResumeContext,
            ...(coreMoveDiscardResumeContext.battleEndDeferralAttackId !==
            undefined
              ? {
                  battleEndDeferralAttackId:
                    coreMoveDiscardResumeContext.battleEndDeferralAttackId,
                }
              : {}),
          },
        };
      }
      adjustedAmount = interception.adjustedAmount;
    }

    const player = current.players.find((p) => p.id === fromPlayerId);
    const available = Math.min(
      adjustedAmount,
      player?.lifeNormalCoreCount ?? 0
    );
    const logEntry = `effect:core_move:life:${fromPlayerId}->void:${toPlayerId}:${available}`;
    if (available <= 0) {
      return {
        ...current,
        log: [...current.log, logEntry],
      };
    }
    const moved = moveNormalCores(
      current,
      { kind: "life", playerId: fromPlayerId },
      { kind: "void", playerId: toPlayerId },
      available
    );
    return {
      ...moved,
      log: [...moved.log, logEntry],
    };
  }
  return null;
}

/** void→field/field_card: ボイドの通常コアをフィールドカードへ (soul 無し・分配 pending)。 */
function handleVoidToFieldOrFieldCard(ctx: CoreMoveContext): GameState | null {
  const {
    from,
    to,
    current,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    getCardDefinitionById,
    coreDistributionAllocations,
    sourceInstanceId,
    effectTiming,
  } = ctx;
  // ボイド→フィールド（ボイドのコアを自分のフィールドカードに置く）
  // to.kind === "field_card" の場合は filter で配置候補を絞り込む（「自分のスピリットへ」等）。
  // トラッシュ→フィールドと同型だが、ボイドにソウルコアは存在しないため soul core 配分は無い。
  if (
    from.kind === "void" &&
    (to.kind === "field" || to.kind === "field_card")
  ) {
    const player = current.players.find((p) => p.id === fromPlayerId);
    const voidNormalCores = Math.min(amount, player?.voidNormalCoreCount ?? 0);
    const fieldCards = collectFieldCardDestinationCandidates({
      state: current,
      to,
      toPlayerId,
      getCardDefinitionById,
      coreMoveDestinationTargetIds: ctx.coreMoveDestinationTargetIds,
    });
    if (fieldCards.length === 0 || voidNormalCores === 0) {
      current.log.push(
        `effect:core_move:void->field:${fromPlayerId}:0:no-targets`
      );
      return current;
    }

    // GUI/プレイヤーが配分を渡してきた場合は適用
    if (coreDistributionAllocations !== undefined) {
      const allocMap = new Map(
        Object.entries(coreDistributionAllocations).filter(([, v]) => v > 0)
      );
      let movedTotal = 0;
      for (const v of allocMap.values()) movedTotal += v;
      if (movedTotal > voidNormalCores) {
        throw new Error(
          `Core distribution total ${movedTotal} exceeds available ${voidNormalCores}`
        );
      }
      const result = moveNormalCoreDistributionToFieldCards(
        current,
        { kind: "void", playerId: fromPlayerId },
        allocMap,
        fieldCards,
        getCardDefinitionById
      );
      const log =
        movedTotal > 0
          ? `effect:core_move:void:${fromPlayerId}->field:${toPlayerId}:${movedTotal}:player-selected`
          : `effect:core_move:void->field:${fromPlayerId}:0:player-selected-empty`;
      return {
        ...result,
        log: [...result.log, log],
      };
    }

    // 候補が複数 → pending 状態でプレイヤー選択を要求（ソウルコアは無いので常に通常コアのみ）
    if (fieldCards.length > 1) {
      const sourceCard = current.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      current.log.push(
        `effect:core_move:void:${fromPlayerId}->field:${toPlayerId}:pending:${fieldCards.length}targets`
      );
      const priorStateSnapshot = current;
      return {
        ...current,
        pendingCoreDistribution: {
          pendingId: nextPendingSelectionId("cd"),
          actingPlayerId,
          sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          candidates: fieldCards.map((c) => ({
            instanceId: c.instanceId,
            definitionId: c.definitionId,
          })),
          totalNormalCores: voidNormalCores,
          hasSoulCore: false,
          fromKind: "void",
          fromPlayerId,
          toPlayerId,
          effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
          priorStateSnapshot,
        },
      };
    }

    // 自動 fallback: フィールドカード 1 枚のみ
    const target = fieldCards[0]!;
    const moved = moveNormalCores(
      current,
      { kind: "void", playerId: fromPlayerId },
      { kind: "card", instanceId: target.instanceId },
      voidNormalCores,
      getCardDefinitionById
    );
    return {
      ...moved,
      log: [
        ...moved.log,
        `effect:core_move:void:${fromPlayerId}->field:${toPlayerId}:${voidNormalCores}:single-target`,
      ],
    };
  }
  return null;
}

/** trash→field/field_card: トラッシュの通常/ソウルコアをフィールドカードへ (分配 pending)。 */
function handleTrashToFieldOrFieldCard(ctx: CoreMoveContext): GameState | null {
  const {
    from,
    to,
    current,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    getCardDefinitionById,
    coreDistributionAllocations,
    coreDistributionSoulCoreInstanceId,
    coreDistributionSoulCoreAllocations,
    sourceInstanceId,
    effectTiming,
  } = ctx;
  // トラッシュ→フィールド（トラッシュのコアを自分のフィールドカードに置く）
  // to.kind === "field_card" の場合は filter で配置候補を絞り込む。
  if (
    from.kind === "trash" &&
    (to.kind === "field" || to.kind === "field_card")
  ) {
    const player = current.players.find((p) => p.id === fromPlayerId);
    // amount === Infinity は DSL の `amount: "all"` 由来 (effect-interpreter で Infinity 化済み)。
    // 「コアすべて」のルール解釈に従い、部分配分とソウルコア残しを engine 側で禁止する。
    const isAllMode = !Number.isFinite(amount);
    const effectKind = ctx.effectKind ?? "generic";
    const trashNormalCores = Math.min(
      amount,
      player?.trashNormalCoreCount ?? 0
    );
    const trashSoulCoreCount = getCoreDistributionSoulCoreCountForZone({
      player,
      kind: "trash",
      amount,
      effectKind,
    });
    const trashHasSoulCore = trashSoulCoreCount > 0;
    const fieldCards = collectFieldCardDestinationCandidates({
      state: current,
      to,
      toPlayerId,
      getCardDefinitionById,
      coreMoveDestinationTargetIds: ctx.coreMoveDestinationTargetIds,
    });
    if (
      fieldCards.length === 0 ||
      (trashNormalCores === 0 && !trashHasSoulCore)
    ) {
      current.log.push(
        `effect:core_move:trash->field:${fromPlayerId}:0:no-targets`
      );
      return current;
    }

    // GUI/プレイヤーが配分を渡してきた場合は適用
    if (
      coreDistributionAllocations !== undefined ||
      coreDistributionSoulCoreInstanceId !== undefined ||
      coreDistributionSoulCoreAllocations !== undefined
    ) {
      const allocs = coreDistributionAllocations ?? {};
      const allocMap = new Map(Object.entries(allocs).filter(([, v]) => v > 0));
      let movedTotal = 0;
      for (const v of allocMap.values()) movedTotal += v;
      const soulAllocs = normalizeCoreDistributionSoulCoreAllocations({
        soulCoreAllocations: coreDistributionSoulCoreAllocations,
        soulCoreInstanceId: coreDistributionSoulCoreInstanceId,
        totalSoulCores: trashSoulCoreCount,
      });
      const selectedSoulCoreCount =
        sumCoreDistributionSoulCoreAllocations(soulAllocs);
      const hasSelectedSoulCore = selectedSoulCoreCount > 0;
      const effectiveMovedTotal = movedTotal + selectedSoulCoreCount;
      if (movedTotal > trashNormalCores) {
        throw new Error(
          `Core distribution total ${movedTotal} exceeds available ${trashNormalCores}`
        );
      }
      if (hasSelectedSoulCore && !trashHasSoulCore) {
        throw new Error("No soul core in trash to distribute");
      }
      if (selectedSoulCoreCount > trashSoulCoreCount) {
        throw new Error(
          `Core distribution soul total ${selectedSoulCoreCount} exceeds available ${trashSoulCoreCount}`
        );
      }
      if (!isAllMode && effectiveMovedTotal > amount) {
        throw new Error(
          `Core distribution total ${effectiveMovedTotal} exceeds maximum ${amount}`
        );
      }
      assertCompleteCoreDistributionForAllMode({
        isAllMode,
        sourceLabel: "trash",
        normalTotal: trashNormalCores,
        normalSelected: movedTotal,
        totalSoulCores: trashSoulCoreCount,
        selectedSoulCores: selectedSoulCoreCount,
      });
      const logs: string[] = [];
      if (movedTotal > 0) {
        logs.push(
          `effect:core_move:trash:${fromPlayerId}->field:${toPlayerId}:${movedTotal}:player-selected`
        );
      } else {
        logs.push(
          `effect:core_move:trash->field:${fromPlayerId}:0:player-selected-empty`
        );
      }
      // ソウルコア配置（プレイヤー指定）
      for (const [targetInstanceId, soulAmount] of Object.entries(soulAllocs)) {
        if (soulAmount <= 0) continue;
        const targetExists = fieldCards.some(
          (c) => c.instanceId === targetInstanceId
        );
        if (!targetExists) {
          throw new Error(
            `Soul core target ${targetInstanceId} is not a candidate`
          );
        }
        logs.push(
          `effect:core_move:soul_core:${fromPlayerId}:trash->field:${targetInstanceId}:${soulAmount}`
        );
      }
      let result = moveNormalCoreDistributionToFieldCards(
        current,
        { kind: "trash", playerId: fromPlayerId },
        allocMap,
        fieldCards,
        getCardDefinitionById
      );
      result = { ...result, log: [...result.log, ...logs] };
      for (const [targetInstanceId, soulAmount] of Object.entries(soulAllocs)) {
        if (soulAmount <= 0) continue;
        result = moveSoulCore(
          result,
          fromPlayerId,
          { kind: "trash", playerId: fromPlayerId },
          { kind: "card", instanceId: targetInstanceId },
          soulAmount,
          getCardDefinitionById
        );
      }
      return result;
    }

    // 候補が複数 or ソウルコアがある場合 → pending 状態でプレイヤー選択を要求
    if (fieldCards.length > 1 || trashHasSoulCore) {
      const sourceCard = current.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      current.log.push(
        `effect:core_move:trash:${fromPlayerId}->field:${toPlayerId}:pending:${fieldCards.length}targets:soulCore=${trashHasSoulCore}:all=${isAllMode}`
      );
      // P3-48 follow-up: cancel/abort 用 snapshot — pending 追加前の state をそのまま参照保持。
      const priorStateSnapshot = current;
      return {
        ...current,
        pendingCoreDistribution: {
          pendingId: nextPendingSelectionId("cd"),
          actingPlayerId,
          sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          candidates: fieldCards.map((c) => ({
            instanceId: c.instanceId,
            definitionId: c.definitionId,
          })),
          totalNormalCores: trashNormalCores,
          hasSoulCore: trashHasSoulCore,
          ...(trashHasSoulCore ? { totalSoulCores: trashSoulCoreCount } : {}),
          fromKind: "trash",
          // BSTH01-M01 等「コアすべて」: 通常コア全数 + ソウルコア(あれば) を必ず配置する。
          ...(isAllMode && trashNormalCores > 0
            ? { minTotal: trashNormalCores }
            : {}),
          ...(!isAllMode && trashHasSoulCore ? { maxTotal: amount } : {}),
          ...(isAllMode && trashHasSoulCore ? { mustPlaceSoulCore: true } : {}),
          fromPlayerId,
          toPlayerId,
          effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
          priorStateSnapshot,
        },
      };
    }

    // 自動 fallback: フィールドカード 1 枚のみ・ソウルコア無し
    const target = fieldCards[0]!;
    const movedTotal = trashNormalCores;
    const moved = moveNormalCores(
      current,
      { kind: "trash", playerId: fromPlayerId },
      { kind: "card", instanceId: target.instanceId },
      movedTotal,
      getCardDefinitionById
    );
    return {
      ...moved,
      log: [
        ...moved.log,
        `effect:core_move:trash:${fromPlayerId}->field:${toPlayerId}:${movedTotal}:single-target`,
      ],
    };
  }
  return null;
}

/** reserve→field/field_card: リザーブの通常/ソウルコアをフィールドカードへ (分配 pending)。 */
function handleReserveToFieldOrFieldCard(
  ctx: CoreMoveContext
): GameState | null {
  const {
    from,
    to,
    current,
    actingPlayerId,
    fromPlayerId,
    toPlayerId,
    amount,
    getCardDefinitionById,
    coreDistributionAllocations,
    coreDistributionSoulCoreInstanceId,
    coreDistributionSoulCoreAllocations,
    sourceInstanceId,
    effectTiming,
  } = ctx;
  if (
    from.kind === "reserve" &&
    (to.kind === "field" || to.kind === "field_card")
  ) {
    const player = current.players.find((p) => p.id === fromPlayerId);
    const isAllMode = !Number.isFinite(amount);
    const reserveNormalCores = Math.min(
      amount,
      player?.reserveNormalCoreCount ?? 0
    );
    const reserveSoulCoreCount = getCoreDistributionSoulCoreCountForZone({
      player,
      kind: "reserve",
      amount,
      effectKind: ctx.effectKind,
    });
    const reserveHasSoulCore = reserveSoulCoreCount > 0;
    const fieldCards = collectFieldCardDestinationCandidates({
      state: current,
      to,
      toPlayerId,
      getCardDefinitionById,
      coreMoveDestinationTargetIds: ctx.coreMoveDestinationTargetIds,
    });
    if (
      fieldCards.length === 0 ||
      (reserveNormalCores === 0 && !reserveHasSoulCore)
    ) {
      current.log.push(
        `effect:core_move:reserve->field:${fromPlayerId}:0:no-targets`
      );
      return current;
    }

    if (
      coreDistributionAllocations !== undefined ||
      coreDistributionSoulCoreInstanceId !== undefined ||
      coreDistributionSoulCoreAllocations !== undefined
    ) {
      const allocs = coreDistributionAllocations ?? {};
      const allocMap = new Map(Object.entries(allocs).filter(([, v]) => v > 0));
      let movedTotal = 0;
      for (const v of allocMap.values()) movedTotal += v;
      const soulAllocs = normalizeCoreDistributionSoulCoreAllocations({
        soulCoreAllocations: coreDistributionSoulCoreAllocations,
        soulCoreInstanceId: coreDistributionSoulCoreInstanceId,
        totalSoulCores: reserveSoulCoreCount,
      });
      const selectedSoulCoreCount =
        sumCoreDistributionSoulCoreAllocations(soulAllocs);
      const hasSelectedSoulCore = selectedSoulCoreCount > 0;
      const effectiveMovedTotal = movedTotal + selectedSoulCoreCount;
      if (movedTotal > reserveNormalCores) {
        throw new Error(
          `Core distribution total ${movedTotal} exceeds available ${reserveNormalCores}`
        );
      }
      if (hasSelectedSoulCore && !reserveHasSoulCore) {
        throw new Error("No soul core in reserve to distribute");
      }
      if (selectedSoulCoreCount > reserveSoulCoreCount) {
        throw new Error(
          `Core distribution soul total ${selectedSoulCoreCount} exceeds available ${reserveSoulCoreCount}`
        );
      }
      if (!isAllMode && effectiveMovedTotal > amount) {
        throw new Error(
          `Core distribution total ${effectiveMovedTotal} exceeds maximum ${amount}`
        );
      }
      assertCompleteCoreDistributionForAllMode({
        isAllMode,
        sourceLabel: "reserve",
        normalTotal: reserveNormalCores,
        normalSelected: movedTotal,
        totalSoulCores: reserveSoulCoreCount,
        selectedSoulCores: selectedSoulCoreCount,
      });
      const logs: string[] = [];
      logs.push(
        movedTotal > 0
          ? `effect:core_move:reserve:${fromPlayerId}->field:${toPlayerId}:${movedTotal}:player-selected`
          : `effect:core_move:reserve->field:${fromPlayerId}:0:player-selected-empty`
      );
      for (const [targetInstanceId, soulAmount] of Object.entries(soulAllocs)) {
        if (soulAmount <= 0) continue;
        const targetExists = fieldCards.some(
          (c) => c.instanceId === targetInstanceId
        );
        if (!targetExists) {
          throw new Error(
            `Soul core target ${targetInstanceId} is not a candidate`
          );
        }
        logs.push(
          `effect:core_move:soul_core:${fromPlayerId}:reserve->field:${targetInstanceId}:${soulAmount}`
        );
      }
      let result = moveNormalCoreDistributionToFieldCards(
        current,
        { kind: "reserve", playerId: fromPlayerId },
        allocMap,
        fieldCards,
        getCardDefinitionById
      );
      result = { ...result, log: [...result.log, ...logs] };
      for (const [targetInstanceId, soulAmount] of Object.entries(soulAllocs)) {
        if (soulAmount <= 0) continue;
        result = moveSoulCore(
          result,
          fromPlayerId,
          { kind: "reserve", playerId: fromPlayerId },
          { kind: "card", instanceId: targetInstanceId },
          soulAmount,
          getCardDefinitionById
        );
      }
      return result;
    }

    if (fieldCards.length > 1 || reserveHasSoulCore) {
      const sourceCard = current.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      current.log.push(
        `effect:core_move:reserve:${fromPlayerId}->field:${toPlayerId}:pending:${fieldCards.length}targets:soulCore=${reserveHasSoulCore}:all=${isAllMode}`
      );
      const priorStateSnapshot = current;
      return {
        ...current,
        pendingCoreDistribution: {
          pendingId: nextPendingSelectionId("cd"),
          actingPlayerId,
          sourceInstanceId,
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          candidates: fieldCards.map((c) => ({
            instanceId: c.instanceId,
            definitionId: c.definitionId,
          })),
          totalNormalCores: reserveNormalCores,
          hasSoulCore: reserveHasSoulCore,
          ...(reserveHasSoulCore
            ? { totalSoulCores: reserveSoulCoreCount }
            : {}),
          fromKind: "reserve",
          ...(isAllMode && reserveNormalCores > 0
            ? { minTotal: reserveNormalCores }
            : {}),
          ...(!isAllMode && reserveHasSoulCore ? { maxTotal: amount } : {}),
          ...(isAllMode && reserveHasSoulCore
            ? { mustPlaceSoulCore: true }
            : {}),
          fromPlayerId,
          toPlayerId,
          effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
          priorStateSnapshot,
        },
      };
    }

    const target = fieldCards[0]!;
    const movedTotal = reserveNormalCores;
    const moved = moveNormalCores(
      current,
      { kind: "reserve", playerId: fromPlayerId },
      { kind: "card", instanceId: target.instanceId },
      movedTotal,
      getCardDefinitionById
    );
    return {
      ...moved,
      log: [
        ...moved.log,
        `effect:core_move:reserve:${fromPlayerId}->field:${toPlayerId}:${movedTotal}:single-target`,
      ],
    };
  }
  return null;
}

/** field_card 源: フィルタ指定カード群→単純コンテナ/カード (コスト支払い・allocation pending・greedy)。 */
function handleFieldCardSource(ctx: CoreMoveContext): GameState | null {
  const {
    from,
    to,
    current,
    actingPlayerId,
    fromPlayerId,
    amount,
    sourceInstanceId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    sourcePreventionBypass,
    getCardDefinitionById,
    coreSourceAllocations,
    coreSourceSoulCoreInstanceId,
    allowPendingCoreSourceAllocation,
    effectTiming,
    coreSourceEffectIndex,
    coreSourceTargetStepId,
    coreSourceImmunityArg,
  } = ctx;
  // P3-14 D-6: フィルタ指定フィールドカード→単純コンテナ。
  // 「系統:「アシハラ」を持つ自分の緑の創界神ネクサスのコア3個をボイドに置く(ことで)」型の
  // コスト支払い元 (BSTH05-C11/C12、BSES01/BSTH003 同型) と、導界者ネクサスから
  // このカードへ置く型を扱う。
  // - ボイド等への支払いは通常コア限定。カードへ置く本文効果は generic「コア」なので
  //   ソウルコアを含める。通常コアとソウルコアのどちらを動かすかが意味を持つ場合は
  //   pending を立て、通常コア配分とソウルコア元を別入力で受け取る。
  // - 指定数が対価なら全額必要。通常効果は可動コア合計まで実行する。
  //   (succeeded=false → conditional_cost ロールバックが発火する)。
  // - 配分が一意でない (候補2枚以上かつ余剰あり) 場合は `pendingCoreSourceAllocation` を
  //   立てて中断し、プレイヤーが配分を選ぶ (転醒/Lv 閾値の維持を選ぶ余地があるため)。
  //   解決後は `coreSourceAllocations` 供給でコストステップが再実行される。
  //   pending を立てられない文脈 (allowPendingCoreSourceAllocation=false) のみ
  //   「コアが多いカードから」の決定的 greedy にフォールバックする。
  if (
    from.kind === "field_card" &&
    (to.kind === "void" ||
      to.kind === "reserve" ||
      to.kind === "trash" ||
      to.kind === "life" ||
      to.kind === "this_card" ||
      to.kind === "card_instance")
  ) {
    // 移動先カード (this_card / card_instance) の owner を解決。
    // cross-player (fromPlayerId !== destinationCardOwnerId) では soul ownership
    // 移転が未モデル化のため soul 移動を抑止する
    // (ENGINE-core-move-soul-cross-player-destination option b)。
    const destinationCardInstanceId =
      to.kind === "this_card"
        ? sourceInstanceId
        : to.kind === "card_instance"
          ? to.instanceId
          : undefined;
    const destinationCardOwnerId =
      destinationCardInstanceId !== undefined
        ? (current.cardInstances.find(
            (c) => c.instanceId === destinationCardInstanceId
          )?.ownerPlayerId ?? undefined)
        : undefined;
    const allowSoulCoreMove =
      (to.kind === "this_card" || to.kind === "card_instance") &&
      destinationCardOwnerId !== undefined &&
      destinationCardOwnerId === fromPlayerId;
    const hasSoulCoreOn = (state: GameState, instanceId: string): boolean =>
      state.players.some(
        (player) =>
          player.id === fromPlayerId &&
          player.soulCoreLocation?.kind === "card" &&
          player.soulCoreLocation.instanceId === instanceId
      );
    // 候補判定は analyzeCoreShootCandidates / 自動 fallback と同じ SSOT
    // (getFieldCoreSourceTakeableCount)。独立コア管理 / 対象ロック / 免疫 /
    // CardFilter / コア最低残存数耐性 が一括で効き、除外カードは 0 を返す。
    const availableOnCandidate = (
      state: GameState,
      candidate: CardInstance
    ): number => {
      const hasSoul = hasSoulCoreOn(state, candidate.instanceId);
      return getFieldCoreSourceTakeableCount(state, candidate, actingPlayerId, {
        soulCoresOnCard: hasSoul ? 1 : 0,
        soulCoresMovable: allowSoulCoreMove && hasSoul ? 1 : 0,
        sourcePreventionLevel,
        ...(coreSourceImmunityArg
          ? { effectSource: coreSourceImmunityArg }
          : {}),
        getCardDefinitionById,
        ...(sourcePreventionBypass ? { sourcePreventionBypass } : {}),
        filter: from.filter,
        sourceInstanceId,
        sourceTargetLockBypass,
      });
    };
    const moveSelectedCores = (
      state: GameState,
      candidate: CardInstance,
      destination:
        | { kind: "card"; instanceId: string }
        | {
            kind: "reserve" | "trash" | "life" | "void";
            playerId: string;
          },
      normalToMove: number,
      moveSoul: boolean
    ): GameState => {
      let next = state;
      if (normalToMove > 0) {
        if (normalToMove > candidate.normalCoreCount) {
          throw new Error(
            `core_move field_card: ${candidate.instanceId} の通常コア配分 ${normalToMove} が保有数 ${candidate.normalCoreCount} を超過`
          );
        }
        next = moveNormalCores(
          next,
          { kind: "card", instanceId: candidate.instanceId },
          destination,
          normalToMove,
          getCardDefinitionById
        );
      }
      if (moveSoul) {
        if (!allowSoulCoreMove || !hasSoulCoreOn(next, candidate.instanceId)) {
          throw new Error(
            `core_move field_card: ${candidate.instanceId} のソウルコア配分が不正`
          );
        }
        next = moveSoulCore(
          next,
          fromPlayerId,
          { kind: "card", instanceId: candidate.instanceId },
          destination,
          1,
          getCardDefinitionById
        );
      }
      return next;
    };
    const moveAvailableCoresGreedy = (
      state: GameState,
      candidate: CardInstance,
      destination:
        | { kind: "card"; instanceId: string }
        | {
            kind: "reserve" | "trash" | "life" | "void";
            playerId: string;
          },
      amountToMove: number
    ): GameState => {
      const normalTake = Math.min(amountToMove, candidate.normalCoreCount);
      const moveSoul = amountToMove - normalTake === 1;
      return moveSelectedCores(
        state,
        candidate,
        destination,
        normalTake,
        moveSoul
      );
    };
    // CardFilter / 対象ロック / 免疫 / 独立コア管理 / コア最低残存数耐性は
    // availableOnCandidate (= getFieldCoreSourceTakeableCount, SSOT) が内包する。
    const movableCandidates = current.cardInstances.filter(
      (c) =>
        c.controllerPlayerId === fromPlayerId &&
        c.zone === "field" &&
        c.pendingLeaveKind === null &&
        availableOnCandidate(current, c) > 0
    );
    const total = movableCandidates.reduce(
      (sum, c) => sum + availableOnCandidate(current, c),
      0
    );
    const bonus =
      fromPlayerId !== actingPlayerId && amount > 0 && Number.isFinite(amount)
        ? (ctx.amountBonusOverride ??
          computeCoreMoveAmountBonus(
            current,
            actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            ctx.effectSourceInstanceId
          ))
        : 0;
    const required = Number.isFinite(amount)
      ? ctx.requireFullCount
        ? amount + bonus
        : Math.min(total, amount + bonus)
      : total;
    if (required <= 0 || total < required) {
      current.log.push(
        `effect:core_move:field_card->${to.kind}:${fromPlayerId}:insufficient:${total}/${required}`
      );
      return current;
    }
    const toContainer = toSimpleNormalCoreContainer(
      to,
      actingPlayerId,
      current,
      sourceInstanceId,
      /*allowLife=*/ true
    );
    if (toContainer === null) {
      current.log.push(
        `effect:core_move:field_card->${to.kind}:${amount}:partial-impl`
      );
      return current;
    }
    // 配分指定供給時 (resolve_core_source_allocation の再実行): 検証して指定どおり移動。
    // 違反は throw (greedy へのフォールバックはしない)。
    if (coreSourceAllocations !== undefined) {
      const candidateById = new Map(
        movableCandidates.map((c) => [c.instanceId, c])
      );
      let allocTotal = 0;
      for (const [id, take] of Object.entries(coreSourceAllocations)) {
        if (!Number.isInteger(take) || take < 0) {
          throw new Error(
            `core_move field_card: 配分 ${take} (${id}) は 0 以上の整数が必要`
          );
        }
        const candidate = candidateById.get(id);
        if (candidate === undefined) {
          throw new Error(`core_move field_card: ${id} は支払い元候補ではない`);
        }
        if (take > candidate.normalCoreCount) {
          throw new Error(
            `core_move field_card: ${id} の通常コア配分 ${take} が保有通常コア ${candidate.normalCoreCount} を超過`
          );
        }
        const plannedTake =
          take + (coreSourceSoulCoreInstanceId === id ? 1 : 0);
        if (plannedTake > availableOnCandidate(current, candidate)) {
          throw new Error(
            `core_move field_card: ${id} の配分 ${plannedTake} が移動可能数を超過`
          );
        }
        allocTotal += take;
      }
      if (coreSourceSoulCoreInstanceId !== undefined) {
        const candidate = candidateById.get(coreSourceSoulCoreInstanceId);
        if (candidate === undefined) {
          throw new Error(
            `core_move field_card: ${coreSourceSoulCoreInstanceId} はソウルコア支払い元候補ではない`
          );
        }
        if (
          !allowSoulCoreMove ||
          !hasSoulCoreOn(current, coreSourceSoulCoreInstanceId)
        ) {
          throw new Error(
            `core_move field_card: ${coreSourceSoulCoreInstanceId} に移動可能なソウルコアがない`
          );
        }
        allocTotal += 1;
      }
      if (allocTotal !== required) {
        throw new Error(
          `core_move field_card: 配分合計 ${allocTotal} が必要数 ${required} と不一致`
        );
      }
      let next = current;
      for (const [id, take] of Object.entries(coreSourceAllocations)) {
        const candidate = candidateById.get(id);
        if (!candidate) continue;
        next = moveSelectedCores(
          next,
          candidate,
          toContainer,
          take,
          coreSourceSoulCoreInstanceId === id
        );
      }
      if (
        coreSourceSoulCoreInstanceId !== undefined &&
        coreSourceAllocations[coreSourceSoulCoreInstanceId] === undefined
      ) {
        const candidate = candidateById.get(coreSourceSoulCoreInstanceId);
        if (candidate) {
          next = moveSelectedCores(next, candidate, toContainer, 0, true);
        }
      }
      return {
        ...next,
        log: [
          ...next.log,
          `effect:core_move:field_card->${to.kind}:${fromPlayerId}:${required}:player-selected`,
        ],
      };
    }

    const hasSoulChoice =
      allowSoulCoreMove &&
      total > required &&
      movableCandidates.some(
        (candidate) =>
          candidate.normalCoreCount > 0 &&
          hasSoulCoreOn(current, candidate.instanceId)
      );
    const ambiguous =
      (movableCandidates.length > 1 && total > required) || hasSoulChoice;

    // 配分が一意でない場合は state を変更せず pending を立てて中断する
    // (continuation は effect-interpreter のメインループが注入する)。
    if (ambiguous && allowPendingCoreSourceAllocation) {
      const sourceCard = current.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      current.log.push(
        `effect:core_source_allocation:pending:${fromPlayerId}:${required}/${total}:${movableCandidates.length}candidates`
      );
      return {
        ...current,
        pendingCoreSourceAllocation: {
          pendingId: nextCoreSourceAllocationId(),
          actingPlayerId,
          sourceInstanceId,
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          candidates: movableCandidates.map((c) => ({
            instanceId: c.instanceId,
            available: availableOnCandidate(current, c),
            ...(allowSoulCoreMove && hasSoulCoreOn(current, c.instanceId)
              ? { normalAvailable: c.normalCoreCount, hasSoulCore: true }
              : {}),
          })),
          requiredTotal: required,
          toLocation: to,
          effectTiming: effectTiming ?? { kind: "activated", mode: "flash" },
          ...(coreSourceEffectIndex !== undefined
            ? { sourceEffectIndex: coreSourceEffectIndex }
            : {}),
          ...(coreSourceTargetStepId !== undefined
            ? { sourceTargetStepId: coreSourceTargetStepId }
            : {}),
          ...(sourceTargetLockBypass !== undefined
            ? { sourceTargetLockBypass }
            : {}),
        },
      };
    }

    // 一意 (候補1枚 / 合計==必要数で全取り)、または pending 不可文脈の greedy フォールバック。
    const sorted = [...movableCandidates].sort(
      (a, b) =>
        availableOnCandidate(current, b) - availableOnCandidate(current, a)
    );
    let next = current;
    let remaining = required;
    for (const candidate of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, availableOnCandidate(next, candidate));
      next = moveAvailableCoresGreedy(next, candidate, toContainer, take);
      remaining -= take;
    }
    return {
      ...next,
      log: [
        ...next.log,
        `effect:core_move:field_card->${to.kind}:${fromPlayerId}:${required}${
          ambiguous ? ":auto-distribution" : ""
        }`,
      ],
    };
  }
  return null;
}

/** 指定プレイヤーに有効な `life_gain_replacement` CE を1件返す (無ければ undefined)。 */
/**
 * 指定プレイヤーに有効な `life_gain_replacement` CE を1件返す (無ければ undefined)。
 * `executeCoreMove` の to:life 経路・`executeLifeFill` の両方から共有される
 * 「自分の効果で自分のライフが増える」検出の単一照会点。
 */
export function getLifeGainReplacementCE(
  state: GameState,
  targetPlayerId: string
): { sourceInstanceId: string } | undefined {
  for (const ce of getCEsForTarget(state, targetPlayerId)) {
    if (ce.modifierTag === "life_gain_replacement") {
      return { sourceInstanceId: ce.sourceInstanceId };
    }
  }
  return undefined;
}

/**
 * 指定プレイヤーに有効な `life_gain_prevention` CE を1件返す (無ければ undefined)。
 * `executeCoreMove` の to:life 経路・`executeLifeFill` の両方から共有される
 * 「[プレイヤー]のライフは増やせない」検出の単一照会点。
 */
export function getLifeGainPreventionCE(
  state: GameState,
  targetPlayerId: string
): { sourceInstanceId: string } | undefined {
  for (const ce of getCEsForTarget(state, targetPlayerId)) {
    if (ce.modifierTag === "life_gain_prevention") {
      return { sourceInstanceId: ce.sourceInstanceId };
    }
  }
  return undefined;
}

/**
 * `life_gain_replacement` CE 一致時の任意選択待ちを生成する
 * (`resolve_life_gain_replacement_choice` で replace/decline を解決)。
 * resume は core_move 経路 (`coreMoveResume`) / life_fill 経路 (`lifeFillResume`) の
 * どちらか一方を渡す。
 */
export function createPendingLifeGainReplacementChoice(
  state: GameState,
  decidingPlayerId: string,
  sourceInstanceId: string,
  amount: number,
  resume: Pick<
    import("../model").PendingLifeGainReplacementChoice,
    "coreMoveResume" | "lifeFillResume" | "battleEndDeferralAttackId"
  >
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  return {
    ...state,
    pendingLifeGainReplacementChoice: {
      pendingId: nextPendingSelectionId("life-gain-replacement"),
      decidingPlayerId,
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      amount,
      ...resume,
    },
    log: [
      ...state.log,
      `effect:life_gain_replacement:pending:${decidingPlayerId}:source=${sourceInstanceId}`,
    ],
  };
}

/**
 * `pendingLifeGainReplacementChoice` の `replace` 選択を解決する (BSTH02.7-X03 effects[3])。
 * 元の増加を完全にキャンセルし、代わりに相手のライフのコア1個をトラッシュに置く
 * (相手ライフ→トラッシュの core_move を1回実行する)。resume の起源 (core_move/life_fill)
 * に関わらず共通。
 */
export function applyLifeGainReplacementReplace(
  state: GameState,
  pending: import("../model").PendingLifeGainReplacementChoice,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const cleared: GameState = {
    ...state,
    pendingLifeGainReplacementChoice: null,
  };
  const opponentId = cleared.players.find(
    (p) => p.id !== pending.decidingPlayerId
  )?.id;
  if (!opponentId) return cleared;
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.coreMoveResume?.battleEndDeferralAttackId ??
    pending.lifeFillResume?.battleEndDeferralAttackId;
  return executeCoreMove(
    {
      ...cleared,
      log: [
        ...cleared.log,
        `effect:life_gain_replacement:replace:${pending.decidingPlayerId}:opponent-life-core-to-trash`,
      ],
    },
    pending.decidingPlayerId,
    { kind: "life", player: "opponent" },
    { kind: "trash", player: "opponent" },
    1,
    pending.sourceInstanceId,
    undefined,
    undefined,
    getCardDefinitionById,
    /*effectTiming=*/ undefined,
    /*coreDistributionAllocations=*/ undefined,
    /*coreDistributionSoulCoreInstanceId=*/ undefined,
    /*coreDistributionSoulCoreAllocations=*/ undefined,
    /*sourcePreventionLevel=*/ "none",
    /*coreShootMinTotal=*/ undefined,
    /*coreSourceAllocations=*/ undefined,
    /*coreSourceSoulCoreInstanceId=*/ undefined,
    /*allowPendingCoreSourceAllocation=*/ undefined,
    /*amountBonusOverride=*/ undefined,
    /*allowPendingLifeCoreSelection=*/ true,
    /*lifeCorePartitionOverride=*/ undefined,
    /*skipLifeDamageInterception=*/ undefined,
    /*sourceEffectIndex=*/ undefined,
    /*sourceTargetLockBypass=*/ undefined,
    /*sourceTargetStepId=*/ undefined,
    /*skipLifeGainReplacementChoice=*/ undefined,
    /*effectKind=*/ undefined,
    /*sourcePreventionBypass=*/ undefined,
    /*effectSourceInstanceId=*/ undefined,
    /*effectSourceDefinitionId=*/ undefined,
    /*skipCoreMoveDestinationReplacementCheck=*/ undefined,
    battleEndAttackId
  );
}

/**
 * `pendingLifeGainReplacementChoice` を解決する (`coreMoveResume` 経路、
 * BSTH02.7-X03 effects[3] 等)。
 *
 * - `replace`: `applyLifeGainReplacementReplace` に委譲。
 * - `decline`: 置換せず、`coreMoveResume` の記述で `executeCoreMove` を
 *   `skipLifeGainReplacementChoice:true` で再呼び出しし、元の増加を完了させる
 *   (`resolvePendingLifeDamageDiscardChoiceForCoreMove` と同型の resume)。
 */
export function resolvePendingLifeGainReplacementChoiceForCoreMove(
  state: GameState,
  choice: "replace" | "decline",
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingLifeGainReplacementChoice;
  if (!pending || !pending.coreMoveResume) return state;
  const resume = pending.coreMoveResume;

  if (choice === "replace") {
    return applyLifeGainReplacementReplace(
      state,
      pending,
      getCardDefinitionById
    );
  }

  const cleared: GameState = {
    ...state,
    pendingLifeGainReplacementChoice: null,
  };
  const afterDecline: GameState = {
    ...cleared,
    log: [
      ...cleared.log,
      `effect:life_gain_replacement:decline:${pending.decidingPlayerId}:resume-core_move`,
    ],
  };

  return executeCoreMove(
    afterDecline,
    resume.actingPlayerId,
    resume.fromLocation,
    resume.toLocation,
    pending.amount,
    resume.sourceInstanceId,
    resume.coreShootDistribution,
    resume.coreShootSoulCoreInstanceId,
    getCardDefinitionById,
    resume.effectTiming,
    resume.coreDistributionAllocations,
    resume.coreDistributionSoulCoreInstanceId,
    resume.coreDistributionSoulCoreAllocations,
    resume.sourcePreventionLevel ?? "none",
    resume.coreShootMinTotal,
    resume.coreSourceAllocations,
    resume.coreSourceSoulCoreInstanceId,
    /*allowPendingCoreSourceAllocation=*/ false,
    /*amountBonusOverride=*/ 0,
    /*allowPendingLifeCoreSelection=*/ true,
    /*lifeCorePartitionOverride=*/ resume.lifeCorePartitionOverride,
    /*skipLifeDamageInterception=*/ false,
    resume.sourceEffectIndex,
    resume.sourceTargetLockBypass,
    resume.sourceTargetStepId,
    /*skipLifeGainReplacementChoice=*/ true,
    resume.effectKind,
    resume.sourcePreventionBypass,
    resume.effectSourceInstanceId,
    resume.effectSourceDefinitionId,
    /*skipCoreMoveDestinationReplacementCheck=*/ undefined,
    resume.battleEndDeferralAttackId ?? pending.battleEndDeferralAttackId,
    resume.coreMoveDestinationTargetIds
  );
}

/** `resolvePendingLifeDamageDiscardChoiceForCoreMove` の decline / declareGimmickGate pay 共有: `amount` で `coreMoveResume` を再開する。 */
function resumeCoreMoveWithAmount(
  state: GameState,
  pending: PendingLifeDamageDiscardChoice,
  resume: NonNullable<PendingLifeDamageDiscardChoice["coreMoveResume"]>,
  amount: number,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (amount <= 0) return state;
  const beforeLife = getLifeCoreCountForPlayer(state, pending.decidingPlayerId);
  const resumedState = executeCoreMove(
    state,
    resume.actingPlayerId,
    resume.fromLocation,
    resume.toLocation,
    amount,
    resume.sourceInstanceId,
    resume.coreShootDistribution,
    resume.coreShootSoulCoreInstanceId,
    getCardDefinitionById,
    resume.effectTiming,
    resume.coreDistributionAllocations,
    resume.coreDistributionSoulCoreInstanceId,
    resume.coreDistributionSoulCoreAllocations,
    resume.sourcePreventionLevel ?? "none",
    resume.coreShootMinTotal,
    resume.coreSourceAllocations,
    resume.coreSourceSoulCoreInstanceId,
    /*allowPendingCoreSourceAllocation=*/ false,
    /*amountBonusOverride=*/ 0,
    /*allowPendingLifeCoreSelection=*/ true,
    /*lifeCorePartitionOverride=*/ resume.lifeCorePartitionOverride,
    /*skipLifeDamageInterception=*/ true,
    resume.sourceEffectIndex,
    resume.sourceTargetLockBypass,
    resume.sourceTargetStepId,
    /*skipLifeGainReplacementChoice=*/ undefined,
    resume.effectKind,
    resume.sourcePreventionBypass,
    resume.effectSourceInstanceId,
    resume.effectSourceDefinitionId,
    /*skipCoreMoveDestinationReplacementCheck=*/ undefined,
    resume.battleEndDeferralAttackId ?? pending.battleEndDeferralAttackId,
    resume.coreMoveDestinationTargetIds
  );
  if (resumedState.pendingLifeCoreSelection)
    return {
      ...resumedState,
      pendingLifeCoreSelection: {
        ...resumedState.pendingLifeCoreSelection,
        lifeDamageInterception: pending,
      },
    };
  const afterLife = getLifeCoreCountForPlayer(
    resumedState,
    pending.decidingPlayerId
  );
  return consumePendingLifeDamageTurnCapBuckets(
    resumedState,
    pending,
    Math.max(0, beforeLife - afterLife)
  );
}

/**
 * `executeCoreMove` の life→X 経路で生成された discardCostGate / useCostGate /
 * declareGimmickGate pending (`pending.coreMoveResume` あり) を解決する。
 *
 * - `pay` (costKind:"discard"): entry.sourceInstanceId を手札/手元からトラッシュへ破棄し、
 *   core_move 自体を完全にキャンセルする（ダメージ 0 = コア移動も発生しない）。
 * - `pay` (costKind:"use"): entry.sourceInstanceId を手札からトラッシュへ移動し
 *   `lifeDamageInterceptionUseCostGateUsedThisTurn` に記録した上で core_move 自体を
 *   完全にキャンセルする（discard と同じ全額防止だが、破棄ではなく使用）。
 * - `pay` (costKind:"declare_gimmick"): 宣言ギミックを消費し、`reduceBy` 分だけ軽減した
 *   amount で core_move を再開する（全額キャンセルではない）。残り entries があれば
 *   `resolvePendingLifeDamageDiscardChoice` (直接ダメージ版) と同型に軽減後の amount で
 *   継続し、core_move はまだ再開しない。
 * - `decline`: 破棄/宣言せず、`coreMoveResume` の記述で `executeCoreMove` を
 *   `skipLifeDamageInterception:true` + `amount:pending.pendingAmount` で再呼び出しし、
 *   元の core_move を完了させる（`applyPendingLifeCoreSelectionAction` と同型の resume）。
 *   残り entries があれば同様に core_move を再開せず次の entry へ継続する。
 */
export function resolvePendingLifeDamageDiscardChoiceForCoreMove(
  state: GameState,
  choice: "pay" | "decline",
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingLifeDamageDiscardChoice;
  if (!pending || !pending.coreMoveResume) return state;
  const entry = pending.entries[0];
  if (!entry) {
    return { ...state, pendingLifeDamageDiscardChoice: null };
  }
  const resume = pending.coreMoveResume;

  if (choice === "pay") {
    if (entry.costKind === "declare_gimmick") {
      let afterState = applyDeclareGimmickForLifeDamageGate(
        state,
        pending.decidingPlayerId
      );
      afterState = markDeclareGimmickGateUsedThisTurn(
        afterState,
        pending.decidingPlayerId,
        entry.ceEffectId
      );
      const reducedAmount = Math.max(0, pending.pendingAmount - entry.reduceBy);
      afterState = {
        ...afterState,
        log: [
          ...afterState.log,
          `effect:life_damage_interception:declare-gimmick-gate:pay:${pending.decidingPlayerId}:reduceBy=${entry.reduceBy}:remaining=${reducedAmount}:resume-core_move`,
        ],
      };

      const remaining = pending.entries.slice(1);
      if (remaining.length > 0) {
        return {
          ...afterState,
          pendingLifeDamageDiscardChoice: {
            ...pending,
            pendingAmount: reducedAmount,
            entries: remaining,
          },
        };
      }
      return resumeCoreMoveWithAmount(
        { ...afterState, pendingLifeDamageDiscardChoice: null },
        pending,
        resume,
        reducedAmount,
        getCardDefinitionById
      );
    }

    if (entry.costKind === "use") {
      throw new Error(
        "useCostGate must be resolved through applyPendingLifeDamageDiscardChoiceAction"
      );
    }

    let afterState = moveCardZone(state, entry.sourceInstanceId, "trash");
    afterState = {
      ...afterState,
      log: [
        ...afterState.log,
        `effect:life_damage_interception:discard-cost-gate:pay:${pending.decidingPlayerId}:discard=${entry.sourceInstanceId}:core_move-cancelled`,
      ],
      pendingLifeDamageDiscardChoice: null,
    };
    return afterState;
  }

  const afterDecline: GameState = {
    ...state,
    log: [
      ...state.log,
      `effect:life_damage_interception:discard-cost-gate:decline:${pending.decidingPlayerId}:entry=${entry.sourceInstanceId}:resume-core_move`,
    ],
  };

  const remainingOnDecline = pending.entries.slice(1);
  if (remainingOnDecline.length > 0) {
    return {
      ...afterDecline,
      pendingLifeDamageDiscardChoice: {
        ...pending,
        entries: remainingOnDecline,
      },
    };
  }

  return resumeCoreMoveWithAmount(
    { ...afterDecline, pendingLifeDamageDiscardChoice: null },
    pending,
    resume,
    pending.pendingAmount,
    getCardDefinitionById
  );
}

/**
 * EffectCoreLocation を moveNormalCores 用の NormalCoreContainer に変換する。
 * field / target_card / field_card は GUI 選択や対象フィルタが必要なため null を返す。
 * allowLife=false のとき life も null を返す（from=life はライフダメージインターセプションが必要）。
 */
export function toSimpleNormalCoreContainer(
  location: EffectCoreLocation,
  actingPlayerId: string,
  state: GameState,
  sourceInstanceId: string,
  allowLife: boolean
): import("../model").NormalCoreContainer | null {
  const playerId = resolveLocationPlayer(actingPlayerId, location, state);
  switch (location.kind) {
    case "void":
      return { kind: "void", playerId };
    case "reserve":
      return { kind: "reserve", playerId };
    case "trash":
      return { kind: "trash", playerId };
    case "life":
      return allowLife ? { kind: "life", playerId } : null;
    case "this_card":
      return { kind: "card", instanceId: sourceInstanceId };
    case "card_instance":
      // 単一対象コアシュート: 解決済みの特定カード（選択した相手1体等）のコア源。
      return { kind: "card", instanceId: location.instanceId };
    case "field":
    case "union":
    case "target_card":
    case "field_card":
    case "outside_game":
    case "removed_from_game":
    case "count_area":
      // count_area は NormalCoreContainer 化できない (実体が player.countValue で
      // 通常コアコンテナと異なる)。専用 handler (handleCountAreaSource) が
      // fromLoc.kind==="count_area" を直接処理し、この汎用ヘルパーへは到達しない。
      return null;
  }
}

/**
 * core_move ボーナスステップを実行する。
 * CoreLocation を解決して moveNormalCores で移動する。
 */
export function executeBonusCoreMove(
  state: GameState,
  playerId: string,
  action: import("../dsl-types").DSL.CoreMoveAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const amount = typeof action.amount === "number" ? action.amount : 1;

  // from 解決
  const from = resolveBonusCoreLocation(state, action.from, playerId);
  if (!from) return state;

  // to 解決（bonus core move では splitDestinations 未対応 — to のみ）
  if (!action.to) return state;
  const to = resolveBonusCoreLocation(
    state,
    action.to,
    playerId,
    getCardDefinitionById
  );
  if (!to) return state;

  // 移動元にコアがあるか確認
  const fromAmount = getNormalCoreCountAtLocation(state, from);
  if (action.requireFullCount && fromAmount < amount) return state;
  const movedAmount = Math.min(amount, fromAmount);
  if (movedAmount <= 0) return state;

  const newState = moveNormalCores(
    state,
    from,
    to,
    movedAmount,
    getCardDefinitionById
  );

  // ログ
  const toCard =
    to.kind === "card" ? getCardById(newState, to.instanceId) : undefined;
  const toDef = toCard ? getCardDefinitionById(toCard.definitionId) : undefined;
  const toName =
    toDef?.name ?? (to.kind === "card" ? to.instanceId : "reserve");
  newState.log.push(
    `moved_to_trash:bonus_core:${playerId}:${from.kind}->${toName}:${movedAmount}`
  );

  return newState;
}

/** CoreLocation → NormalCoreContainer 変換 */
export function resolveBonusCoreLocation(
  state: GameState,
  loc: import("../dsl-types").CoreLocation,
  playerId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): import("../model").NormalCoreContainer | undefined {
  if (loc.kind === "union")
    throw new Error("core source union requires source selection");
  const resolvedPlayer =
    loc.kind !== "this_card" &&
    loc.kind !== "target_card" &&
    loc.kind !== "card_instance" &&
    loc.kind !== "ref" &&
    loc.kind !== "any_movable_self" &&
    loc.kind !== "non_life_normal_self" &&
    loc.kind !== "field_and_reserve_self" &&
    loc.kind !== "field_reserve_and_trash_self" &&
    loc.kind !== "outside_game"
      ? loc.player === "self"
        ? playerId
        : (state.players.find((p) => p.id !== playerId)?.id ?? playerId)
      : playerId;
  switch (loc.kind) {
    case "void":
      return { kind: "void", playerId: resolvedPlayer };
    case "reserve":
      return { kind: "reserve", playerId: resolvedPlayer };
    case "card_instance":
      return { kind: "card", instanceId: loc.instanceId };
    case "field_card": {
      if (!getCardDefinitionById) return undefined;
      const target = state.cardInstances.find((c) => {
        if (c.ownerPlayerId !== resolvedPlayer || c.zone !== "field")
          return false;
        const d = getCardDefinitionById(c.definitionId);
        if (!d) return false;
        const f = (loc as { filter: import("../dsl-types").CardFilter }).filter;
        if (f.category) {
          const effectiveCategory = getEffectiveCategory(state, c, d);
          if (
            effectiveCategory === undefined ||
            !f.category.includes(effectiveCategory)
          )
            return false;
        }
        if (
          f.colors &&
          !f.colors.some((col: string) =>
            getEffectiveColors(state, c, d).includes(
              col as import("../model").CardColor
            )
          )
        )
          return false;
        // tribesLogic の and/or は SSOT `matchesTribes`（card-filter.ts）に委譲する
        // （BSTH03-C11/C12「蓬莱」+「導界者」両系統ネクサス指定。手書きの OR 判定を
        // 複製すると tribesLogic:"and" を落とすため、SSOT 一本に通す）。
        if (f.tribes && !matchesTribes(d.tribe, f)) return false;
        return true;
      });
      return target
        ? { kind: "card", instanceId: target.instanceId }
        : undefined;
    }
    default:
      return undefined;
  }
}
