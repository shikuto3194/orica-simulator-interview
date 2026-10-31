import type { EnterFieldCorePlacement } from "../zone/enter-field-placement-execution";
import {
  getEnterFieldCorePlacementPolicy,
  type EnterFieldCorePlacementPolicy,
} from "../zone/enter-field-placement-policy";
import type {
  HandWrittenEffectResolver,
  HandWrittenEffectResolverLookup,
} from "../effect/effect-resolution";
import type {
  CardCategory,
  CardDefinition,
  GameState,
  LifeCoreKind,
} from "../model";
import type { CardCostPaymentSource } from "../core/payment-system";
import type { EffectFilterTag } from "../state-based-actions";
import { getSummonTrashCorePlacementGrant } from "../legal/legal-actions-shared";
import {
  playHandCardWithPlacement,
  playHandCardWithPlacementInStackContext,
  resolveDeferredPlayCardWithPlacement,
  type PlayHandCardInStackContextResult,
  type PlayHandCardActionResult,
} from "./play-card-resolution";
import { getHandCardAndDefinition } from "./play-card-validation";
export {
  ENTER_FIELD_CORE_PLACEMENT_FORBIDDEN_TAG,
  ENTER_FIELD_CORE_PLACEMENT_MAX_TAG_PREFIX,
  ENTER_FIELD_CORE_PLACEMENT_MIN_TAG_PREFIX,
  ENTER_FIELD_CORE_PLACEMENT_RULE_TAG_PREFIX,
  getDefaultEnterFieldCorePlacementPolicy,
  getEnterFieldCorePlacementPolicy,
  getEnterFieldCorePlacementRule,
  getKeywordTagEnterFieldCorePlacementPolicyOverride,
  getMinimumEnterFieldCoreCount,
} from "../zone/enter-field-placement-policy";
export {
  applyEnterFieldCorePlacements,
  assertEnterFieldCorePlacementsAllowed,
  getPlacedCoreCount,
} from "../zone/enter-field-placement-execution";
export type {
  EnterFieldCorePlacementPolicy,
  EnterFieldCorePlacementRule,
} from "../zone/enter-field-placement-policy";
export type { EnterFieldCorePlacement } from "../zone/enter-field-placement-execution";
export type { PlayHandCardActionResult } from "./play-card-resolution";
export type { PlayHandCardInStackContextResult } from "./play-card-resolution";
export { playCardWithoutPayingCostWithPlacement } from "./play-card-resolution";
export type { PlayCardWithoutPayingCostActionResult } from "./play-card-resolution";

interface UseHandCardAsActionBaseOptions {
  state: GameState;
  actingPlayerId: string;
  cardInstanceId: string;
  targetInstanceIds?: readonly string[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  paymentSources: readonly CardCostPaymentSource[];
  fixedPaymentCost?: number;
  baseCostOverride?: number;
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter;
  /**
   * pendingSummonCostExcludeChoice 解決後に確定する追加コスト軽減。
   * symbol 軽減とは独立に finalCost へ加算される。
   */
  additionalCostModifiers?: readonly import("../core/cost-system").AdditionalCostModifier[];
  /** summon/place permission 由来の play-card action で、原因効果 index を保持する。 */
  sourceEffectIndex?: number;
  /**
   * main 以外のステップ（フラッシュ窓等）での使用を許可する。
   * 自己配置/召喚許可（「手札/手元にあるこのカードは召喚/配置できる」）由来の
   * 通常コスト・非 main プレイで使う。省略時は fixedPaymentCost の有無で従来通り判定。
   */
  allowNonMainStep?: boolean;
  enterFieldCorePlacements?: readonly EnterFieldCorePlacement[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: 下位の queueAfterCostPaidTriggers に forward (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  /**
   * P3-138 token-pool-pre-cost-forced-combine (BSES01-T01 型): 宣言時点で既に確定している
   * 強制合体ホスト instance id。指定時、`playSummonAsAction`/`useSummonInStackContextAsAction`
   * は `playHandCardWithPlacement`/`playHandCardWithPlacementInStackContext` の同名オプションへ
   * そのまま転送し、解決時の合体選択 pending (`pendingBraveCombineChoice`) を提示させない
   * (`stack-resolution-core.ts` の宣言時確定ホスト bypass 分岐が窓クローズ後に再検証する)。
   * summon 専用 (place_nexus には無関係)。
   */
  combineHostInstanceId?: string;
}

/**
 * 手札召喚アクションで許容するカテゴリ。
 * スピリット / アルティメット / ブレイヴ はすべて「召喚」として扱う
 * (`getHandCardLegalActionKind` の summon 判定と一致させる)。
 * ブレイヴはスピリット状態での召喚。直接合体は別経路。
 */
const SUMMONABLE_CATEGORIES: readonly CardCategory[] = [
  "spirit",
  "ultimate",
  "brave",
];

const noRegisteredBurstActions: import("../effect/trigger-system").BurstActionRegistrationLookup =
  () => [];

function getPlayCardBurstActionLookup(
  options: UseHandCardAsActionBaseOptions
): import("../effect/trigger-system").BurstActionRegistrationLookup {
  return options.getRegisteredBurstActions ?? noRegisteredBurstActions;
}

export type PlaySummonAsActionOptions = UseHandCardAsActionBaseOptions;

export type PlaceNexusAsActionOptions = UseHandCardAsActionBaseOptions;

export type UseSummonInStackContextAsActionOptions =
  UseHandCardAsActionBaseOptions;

export type UsePlaceNexusInStackContextAsActionOptions =
  UseHandCardAsActionBaseOptions;

/**
 * 手札スピリット/アルティメット召喚専用の EnterFieldCorePlacementPolicy 構築。
 * ネクサス配置 (`placeNexusAsAction` 等) には無関係の grant_summon_trash_core_placement CE
 * (BSLH01-T13) を合流させる。「召喚するとき」原文どおりスピリット/アルティメット召喚のみ対象。
 */
function getSummonEnterFieldCorePlacementPolicy(options: {
  state: GameState;
  actingPlayerId: string;
  card: Parameters<typeof getEnterFieldCorePlacementPolicy>[0]["card"];
  definition: CardDefinition;
}): EnterFieldCorePlacementPolicy {
  const basePolicy = getEnterFieldCorePlacementPolicy({
    card: options.card,
    definition: options.definition,
  });
  const trashGrant = getSummonTrashCorePlacementGrant(
    options.state,
    options.actingPlayerId,
    options.definition
  );
  return trashGrant
    ? { ...basePolicy, allowedTrashNormalCoreCount: trashGrant.amount }
    : basePolicy;
}

export function playSummonAsAction(
  options: PlaySummonAsActionOptions
): PlayHandCardActionResult {
  const { card, definition } = getHandCardAndDefinition({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: options.cardInstanceId,
    expectedCategories: SUMMONABLE_CATEGORIES,
    getCardDefinitionById: options.getCardDefinitionById,
    allowNonMainStep:
      options.allowNonMainStep ?? options.fixedPaymentCost !== undefined,
  });
  const enterFieldCorePlacementPolicy = getSummonEnterFieldCorePlacementPolicy({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card,
    definition,
  });

  return playHandCardWithPlacement({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card,
    definition,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: getPlayCardBurstActionLookup(options),
    actionKind: "summon",
    enterFieldCorePlacementPolicy,
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    paymentSources: options.paymentSources,
    ...(options.fixedPaymentCost !== undefined
      ? { fixedPaymentCost: options.fixedPaymentCost }
      : {}),
    ...(options.baseCostOverride !== undefined
      ? { baseCostOverride: options.baseCostOverride }
      : {}),
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
    ...(options.enterFieldCorePlacements !== undefined
      ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
    ...(options.combineHostInstanceId !== undefined
      ? { combineHostInstanceId: options.combineHostInstanceId }
      : {}),
  });
}

export function placeNexusAsAction(
  options: PlaceNexusAsActionOptions
): PlayHandCardActionResult {
  const { card, definition } = getHandCardAndDefinition({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: options.cardInstanceId,
    expectedCategories: ["nexus"],
    getCardDefinitionById: options.getCardDefinitionById,
    allowNonMainStep:
      options.allowNonMainStep ?? options.fixedPaymentCost !== undefined,
    // ネクサス自己配置許可 (sourceEffectIndex 指定) 由来のときのみ trash も許容する。
    // 上流の getAvailableHandSummonPermissionLegalActions が effect.applicability.zone で
    // 既にゲート済みのため、通常の手札配置経路 (sourceEffectIndex 無し) には影響しない。
    ...(options.sourceEffectIndex !== undefined
      ? { additionalAllowedZones: ["trash"] as const }
      : {}),
  });
  const enterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy({
    card,
    definition,
  });

  return playHandCardWithPlacement({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card,
    definition,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: getPlayCardBurstActionLookup(options),
    actionKind: "place_nexus",
    enterFieldCorePlacementPolicy,
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    paymentSources: options.paymentSources,
    ...(options.fixedPaymentCost !== undefined
      ? { fixedPaymentCost: options.fixedPaymentCost }
      : {}),
    ...(options.baseCostOverride !== undefined
      ? { baseCostOverride: options.baseCostOverride }
      : {}),
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
    ...(options.enterFieldCorePlacements !== undefined
      ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
  });
}

export function useSummonInStackContextAsAction(
  options: UseSummonInStackContextAsActionOptions
): PlayHandCardInStackContextResult {
  const { card, definition } = getHandCardAndDefinition({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: options.cardInstanceId,
    expectedCategories: SUMMONABLE_CATEGORIES,
    getCardDefinitionById: options.getCardDefinitionById,
    allowNonMainStep:
      options.allowNonMainStep ?? options.fixedPaymentCost !== undefined,
    // summon 許可 (sourceEffectIndex 指定) 由来のときのみ trash/advent_source も許容する
    // (engine-advent-source-summon-permission、BSSL01-X03)。上流の
    // getAvailableHandSummonPermissionLegalActions が effect.applicability.zone で
    // 既にゲート済みのため、通常の手札プレイ経路 (sourceEffectIndex 無し) には影響しない。
    ...(options.sourceEffectIndex !== undefined
      ? {
          additionalAllowedZones: ["trash"] as const,
          allowAdventSourceZone: true,
          allowSoulStateZone: true,
        }
      : {}),
  });
  const enterFieldCorePlacementPolicy = getSummonEnterFieldCorePlacementPolicy({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card,
    definition,
  });

  return playHandCardWithPlacementInStackContext({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card,
    definition,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: getPlayCardBurstActionLookup(options),
    actionKind: "summon",
    enterFieldCorePlacementPolicy,
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    paymentSources: options.paymentSources,
    ...(options.fixedPaymentCost !== undefined
      ? { fixedPaymentCost: options.fixedPaymentCost }
      : {}),
    ...(options.baseCostOverride !== undefined
      ? { baseCostOverride: options.baseCostOverride }
      : {}),
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
    ...(options.enterFieldCorePlacements !== undefined
      ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.combineHostInstanceId !== undefined
      ? { combineHostInstanceId: options.combineHostInstanceId }
      : {}),
  });
}

export function usePlaceNexusInStackContextAsAction(
  options: UsePlaceNexusInStackContextAsActionOptions
): PlayHandCardInStackContextResult {
  const { card, definition } = getHandCardAndDefinition({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: options.cardInstanceId,
    expectedCategories: ["nexus"],
    getCardDefinitionById: options.getCardDefinitionById,
    allowNonMainStep:
      options.allowNonMainStep ?? options.fixedPaymentCost !== undefined,
    // ネクサス自己配置許可 (sourceEffectIndex 指定) 由来のときのみ trash も許容する。
    // 上流の getAvailableHandSummonPermissionLegalActions が effect.applicability.zone で
    // 既にゲート済みのため、通常の手札配置経路 (sourceEffectIndex 無し) には影響しない。
    ...(options.sourceEffectIndex !== undefined
      ? { additionalAllowedZones: ["trash"] as const }
      : {}),
  });
  const enterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy({
    card,
    definition,
  });

  return playHandCardWithPlacementInStackContext({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card,
    definition,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: getPlayCardBurstActionLookup(options),
    actionKind: "place_nexus",
    enterFieldCorePlacementPolicy,
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    paymentSources: options.paymentSources,
    ...(options.fixedPaymentCost !== undefined
      ? { fixedPaymentCost: options.fixedPaymentCost }
      : {}),
    ...(options.baseCostOverride !== undefined
      ? { baseCostOverride: options.baseCostOverride }
      : {}),
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
    ...(options.enterFieldCorePlacements !== undefined
      ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
  });
}

export function resolveDeferredPlayCardStack(options: {
  state: GameState;
  activeStack: NonNullable<PlayHandCardInStackContextResult["activeStack"]>;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: deferred play-card stack 解決の trigger queue forward (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}): GameState {
  return resolveDeferredPlayCardWithPlacement(options);
}
