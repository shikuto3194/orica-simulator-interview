import {
  discardUncommittedSemanticEntry,
  recordBraveFieldEntry,
} from "./semantic-trigger-events";
import { replaceCardInstances } from "../zone/card-instance-state";
import { queueEnterFieldCorePlacement } from "../zone/enter-field-placement-pending";
import {
  getEntryMinimumCoreCount,
  openEntryBraveCombineChoice,
} from "../zone/enter-field-brave-choice";
import { resolveEffectSummonPaymentChoice } from "./summon-payment-choice";
import { isCardInEffectZone } from "./card-access-rules";
import {
  resolveSummonActionCost,
  buildSummonActionCostModifier,
} from "./summon-cost";
import { chooseAutoCardCostPaymentSources } from "../core/auto-card-cost-payment";
import {
  applyAutoEnterFieldCores,
  countEnterFieldCoreSources,
} from "../zone/enter-field-core-sources";
// Summon クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// 召喚/自己召喚/他召喚/ソウル状態召喚の実行。

import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import {
  applyTokenPoolPreCostForcedCombineDeclarationSideEffect,
  type PreCostEffectLookups,
} from "../legal/token-pool-pre-cost-forced-combine";
import { getAdditionalCosts, matchesCardFilter } from "../card/card-filter";
import { getCardById } from "../card/card-lookup";
import { type AdditionalCostModifier } from "../core/cost-system";
import {
  getTotalCoresOnCardById,
  moveNormalCores,
  moveCardZone,
} from "../core/core-system";
import type { CardCostPaymentSource } from "../core/payment-system";
import {
  assertMatchingPaymentAmount,
  assertPaymentSourcesAreAvailable,
  assertReserveOrOnBoardExclusivePaymentSources,
  applyCardCostPayments,
  getAvailableCardCostPaymentSources,
  getTotalPaymentAmount,
} from "../core/payment-system";
import {
  canSummonUltimate,
  getEffectiveColors,
  isCardUseRestricted,
} from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  EffectEventScope,
  EffectActivationSourceZone,
  EffectTiming,
  GameState,
  PendingMultiPlacement,
  SummonAction,
  Zone,
} from "../model";
import {
  collectUnderCardScopeIds,
  stripAdventSourceUnderCardReference,
} from "../model";
import {
  createCardInstance,
  getDefaultZoneRoleName,
  getMinimumRequiredCoresFromDefinition,
} from "../factories";
import type { EnterFieldCorePlacement } from "../zone/enter-field-placement-execution";
import {
  applyEnterFieldCorePlacements,
  assertEnterFieldCorePlacementsAllowed,
  getPlacedCoreCount,
} from "../zone/enter-field-placement-execution";
import { getEnterFieldCorePlacementPolicy } from "../zone/enter-field-placement-policy";
import {
  getValidBraveCombineHosts,
  getAvailablePlacementCoreCount,
} from "../legal/legal-actions-availability";
import { executeBraveCombine } from "../legal/brave-combine-state-helpers";
import {
  createMagicCompatibleSoulStateCostDefinition,
  expandWithMagicCompatibleAttachedBraves,
} from "../mechanics/magic-compatible-soul-state";
import { evaluateCondition } from "./structured-condition-eval";
import { nextPendingSelectionId } from "./structured-effect-sequences";
import { resolveCountToNumber } from "./native-action-shared";
import {
  canAutoExecuteSummonFromZoneCandidateSequence,
  normalizeSummonFromZoneZone,
  resolveSummonFromZoneCandidates as resolveSummonFromZoneCandidatesShared,
} from "./summon-from-zone-candidates";
import { getSummonCostExcludeChoiceOption } from "../mechanics/summon-cost-exclude-choice";
import { getSummonCostCoreMoveChoiceOption } from "../mechanics/summon-cost-core-move-choice";

type PendingMultiPlacementTarget = PendingMultiPlacement["targets"][number];
type EnterFieldEventKind = NonNullable<
  PendingMultiPlacementTarget["enterFieldEventKind"]
>;

function getDefaultEnterFieldEventKindForDefinition(
  definition: CardDefinition
): EnterFieldEventKind {
  return definition.printedCategory === "nexus" ? "place" : "summon";
}

function getSummonActionEnterFieldEventKind(
  action: Pick<SummonAction, "enterFieldEventKind">,
  definition: CardDefinition
): EnterFieldEventKind {
  return (
    action.enterFieldEventKind ??
    getDefaultEnterFieldEventKindForDefinition(definition)
  );
}

function getEffectEnterFieldLogEntry(options: {
  eventKind: EnterFieldEventKind;
  actingPlayerId: string;
  instanceId: string;
  relation: "self" | "other";
  source: string;
  effectScope?: EffectEventScope | undefined;
}): string {
  const scopeSuffix =
    options.effectScope !== undefined ? `:scope=${options.effectScope}` : "";
  switch (options.eventKind) {
    case "place":
      return `effect:field_place:${options.source}:${options.actingPlayerId}:${options.instanceId}${scopeSuffix}`;
    case "put":
      return `effect:field_put:${options.source}:${options.actingPlayerId}:${options.instanceId}${scopeSuffix}`;
    case "summon":
      return `effect:summon:${options.instanceId}:${options.relation}:${options.source}${scopeSuffix}`;
  }
}

/**
 * 効果召喚したカードがブレイヴなら、合体先候補の解決時選択 pending を開く
 * (P3-100 鍵ブレイヴ)。候補が無ければ何もしない。
 */
function maybeOpenEffectSummonedBraveCombineChoice(
  state: GameState,
  triggerBeforeState: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  braveInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  battleEndDeferralAttackId?: string
): GameState {
  if (state.pendingBraveCombineChoice !== null) return state;
  const brave = getCardById(state, braveInstanceId);
  if (!brave || brave.zone !== "field") return state;
  if (brave.attachedToInstanceId !== null) return state;
  const braveDef = getCardDefinitionById(brave.definitionId);
  if (!braveDef || braveDef.printedCategory !== "brave") return state;
  const hosts = getValidBraveCombineHosts(
    state,
    braveDef,
    actingPlayerId,
    getCardDefinitionById,
    brave.instanceId
  );
  if (hosts.length === 0) return state;

  const spiritLv1 = getEnterFieldCorePlacementPolicy({
    card: brave,
    definition: braveDef,
  }).minimumCoreCount;
  const currentCores = getTotalCoresOnCardById(state, braveInstanceId);
  const spiritStateAffordable =
    currentCores >= spiritLv1 ||
    getAvailablePlacementCoreCount(
      state,
      actingPlayerId,
      getCardDefinitionById
    ) >=
      spiritLv1 - currentCores;
  const pendingId = nextPendingSelectionId("effect-brave-combine-choice");
  return {
    ...state,
    pendingBraveCombineChoice: {
      pendingId,
      actingPlayerId,
      braveInstanceId,
      braveDefinitionId: brave.definitionId,
      ...(battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId }
        : {}),
      effectSummon: {
        sourceInstanceId,
        sourceDefinitionId:
          getCardById(state, sourceInstanceId)?.definitionId ??
          brave.definitionId,
        triggerBeforeState,
      },
      hostCandidateInstanceIds: hosts.map((host) => host.instanceId),
      spiritStateAffordable,
    },
    log: [
      ...state.log,
      `brave:combine-choice:pending:${pendingId}:hosts=${hosts.length}:spirit=${spiritStateAffordable ? 1 : 0}:effect-summon`,
    ],
  };
}

function resolveCostModifierSummonCost(
  state: GameState,
  actingPlayerId: string,
  definition: CardDefinition,
  costModifier: import("../dsl-types").CostModifier | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  summonCause?: "effect" | "burst"
): number {
  return resolveSummonActionCost({
    state,
    actingPlayerId,
    definition,
    getCardDefinitionById,
    ...(sourceInstanceId !== undefined ? { sourceInstanceId } : {}),
    action: {
      kind: "summon",
      target: "self",
      ...(summonCause !== undefined ? { summonCause } : {}),
      ...buildSummonActionCostModifier(costModifier),
    },
  });
}

function assertSummonPaymentSourcesAvailable(
  state: GameState,
  actingPlayerId: string,
  definition: CardDefinition,
  paymentSources: readonly CardCostPaymentSource[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  excludedInstanceIds: ReadonlySet<string> = new Set(),
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter
): void {
  const available = getAvailableCardCostPaymentSources({
    state,
    actingPlayerId,
    card: definition,
    getCardDefinitionById,
    ...(sourceInstanceId !== undefined ? { sourceInstanceId } : {}),
    ...(onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter }
      : {}),
  });
  const onBoardCoreSources =
    excludedInstanceIds.size === 0
      ? available.onBoardCoreSources
      : available.onBoardCoreSources.filter(
          (source) => !excludedInstanceIds.has(source.instanceId)
        );
  assertPaymentSourcesAreAvailable({
    paymentSources,
    availableReserveCoreAmount: available.reserveSource.availableCoreAmount,
    availableOnBoardCoreSources: onBoardCoreSources,
  });
  if (onBoardCoreSourceFilter !== undefined) {
    assertReserveOrOnBoardExclusivePaymentSources(paymentSources);
  }
}

function getSelfSummonSourceZone(
  state: GameState,
  card: CardInstance,
  zone: SummonAction["zone"],
  activationZone: EffectActivationSourceZone | undefined
): Zone | EffectActivationSourceZone {
  const activationMatches =
    activationZone === "advent_source"
      ? collectUnderCardScopeIds(state).adventSource.has(card.instanceId)
      : activationZone === "soul_state"
        ? state.players.some((player) =>
            player.soulStateInstanceIds.includes(card.instanceId)
          )
        : card.zone === "in_use";
  return activationMatches &&
    activationZone !== undefined &&
    (zone === undefined ||
      matchesSummonSourceZoneRequirement(zone, activationZone))
    ? activationZone
    : card.zone;
}
function matchesSelfSummonSourceZone(
  state: GameState,
  card: CardInstance,
  zone: SummonAction["zone"],
  activationZone: EffectActivationSourceZone | undefined,
  lookup: (id: string) => CardDefinition | undefined
): boolean {
  if (zone === undefined) return true;
  return (
    matchesSummonSourceZoneRequirement(
      zone,
      getSelfSummonSourceZone(state, card, zone, activationZone)
    ) ||
    isCardInEffectZone(
      state,
      card,
      zone.split("_or_") as Zone[],
      card.controllerPlayerId,
      lookup
    )
  );
}

export function canExecuteSummonSelfNow(options: {
  state: GameState;
  sourceInstanceId: string;
  target?: {
    kind: "self";
    zone?: Zone | readonly Zone[];
    carryOverExistingCores?: boolean;
  };
  costModifier?: import("../dsl-types").CostModifier;
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter;
  ignoreSummonCondition?: boolean;
  summonCause?: "effect" | "burst";
  activationZone?: EffectActivationSourceZone;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const {
    state,
    sourceInstanceId,
    target,
    costModifier,
    onBoardCoreSourceFilter,
    ignoreSummonCondition,
    summonCause,
    getCardDefinitionById,
  } = options;
  const card = getCardById(state, sourceInstanceId);
  if (!card) return false;

  const zone =
    target?.zone !== undefined
      ? normalizeSummonFromZoneZone(target.zone)
      : undefined;
  if (
    zone !== undefined &&
    !matchesSelfSummonSourceZone(
      state,
      card,
      zone,
      options.activationZone,
      getCardDefinitionById
    )
  ) {
    return false;
  }

  const isAdventSourceOrigin = collectUnderCardScopeIds(state).adventSource.has(
    card.instanceId
  );
  if (card.zone === "field" && !isAdventSourceOrigin) return false;

  const def = getCardDefinitionById(card.definitionId);
  if (!def) return false;
  const summoningPlayerId = card.controllerPlayerId;
  if (
    ignoreSummonCondition !== true &&
    !canSummonUltimate(state, summoningPlayerId, def, getCardDefinitionById, {
      sourceInstanceId,
      evaluateCondition,
    })
  ) {
    return false;
  }

  const minCores = getMinimumRequiredCoresFromDefinition(def);
  const existingCoreCount = target?.carryOverExistingCores
    ? card.normalCoreCount
    : 0;
  const additionalCoresNeeded = Math.max(
    0,
    minCores -
      existingCoreCount -
      (target?.carryOverExistingCores ? card.soulCoreCount : 0)
  );
  const action: SummonAction = {
    kind: "summon",
    target: "self",
    ...(zone !== undefined ? { zone } : {}),
    ...(summonCause !== undefined ? { summonCause } : {}),
    ...(target?.carryOverExistingCores ? { carryOverExistingCores: true } : {}),
    ...(ignoreSummonCondition ? { ignoreSummonCondition: true } : {}),
    ...(onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter }
      : {}),
    ...buildSummonActionCostModifier(costModifier),
  };
  const costToPay =
    action.zone ||
    action.withoutCost ||
    action.fullReduction ||
    action.fixedPayment !== undefined ||
    action.overrideCost !== undefined
      ? resolveSummonActionCost({
          state,
          actingPlayerId: summoningPlayerId,
          definition: def,
          action,
          sourceInstanceId,
          getCardDefinitionById,
        })
      : 0;
  if (
    isCardUseRestricted(
      state,
      summoningPlayerId,
      card,
      def,
      getCardDefinitionById,
      def.printedCategory === "nexus" ? "place_nexus" : "summon",
      { byEffect: true, effectiveCost: costToPay }
    )
  )
    return false;
  const paymentSources = chooseAutoCardCostPaymentSources(
    state,
    summoningPlayerId,
    def,
    costToPay,
    getCardDefinitionById,
    sourceInstanceId,
    new Set([sourceInstanceId]),
    action.onBoardCoreSourceFilter
  );
  if (paymentSources === null) return false;

  const zoneRoleName =
    def.printedCategory === "spirit"
      ? "spirit"
      : def.printedCategory === "ultimate"
        ? "ultimate"
        : def.printedCategory === "nexus"
          ? "nexus"
          : def.printedCategory === "brave"
            ? "brave"
            : "spirit";
  const fieldState = moveCardZone(
    state,
    sourceInstanceId,
    "field",
    zoneRoleName
  );
  let candidateState: GameState = replaceCardInstances(
    {
      ...fieldState,
      log: [...state.log],
    },
    stripAdventSourceUnderCardReference(
      fieldState.cardInstances.map((c) =>
        c.instanceId === sourceInstanceId
          ? {
              ...c,
              zone: "field" as const,
              zoneRoleName,
              normalCoreCount: existingCoreCount,
              minimumRequiredCores: minCores,
              exhaustState: "recovered" as const,
            }
          : c
      ),
      sourceInstanceId
    )
  );
  if (costToPay > 0) {
    candidateState = applyCardCostPayments({
      state: candidateState,
      actingPlayerId: summoningPlayerId,
      chainId: `effect-summon-${sourceInstanceId}`,
      paymentSources,
      getCardDefinitionById,
      ...(action.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
        : {}),
    });
  }
  return (
    applyAutoEnterFieldCores({
      state: candidateState,
      actingPlayerId: summoningPlayerId,
      destinationInstanceId: sourceInstanceId,
      requiredCores: getEntryMinimumCoreCount(
        candidateState,
        {
          ...getEnterFieldCorePlacementPolicy({
            card: getCardById(candidateState, sourceInstanceId)!,
            definition: def,
          }),
          instanceId: sourceInstanceId,
          definitionId: def.cardNo,
          minimumCoreCount: additionalCoresNeeded,
          enterFieldEventKind: "summon",
        },
        getCardDefinitionById
      ),
      getCardDefinitionById,
    }) !== null
  );
}

function moveFailedEffectSummonCardToTrash(options: {
  state: GameState;
  actingPlayerId: string;
  instanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  logEntry: string;
}): GameState {
  return replaceCardInstances(
    {
      ...discardUncommittedSemanticEntry(options.state, options.instanceId),
      log: [...options.state.log, options.logEntry],
    },
    options.state.cardInstances.map((card) => {
      if (card.instanceId !== options.instanceId) return card;
      const def = options.getCardDefinitionById(card.definitionId);
      return {
        ...card,
        zone: "trash" as const,
        zoneRoleName: def
          ? getDefaultZoneRoleName(def, "trash")
          : card.zoneRoleName,
        normalCoreCount: 0,
        minimumRequiredCores: 0,
        attachedToInstanceId: null,
        attachedChildrenIds: [],
        underCards: [],
      };
    })
  );
}

export function executeSummon(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  action: SummonAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  summonPaymentSources?: readonly CardCostPaymentSource[],
  summonEnterFieldCorePlacements?: readonly EnterFieldCorePlacement[],
  preSelectedIds?: readonly string[],
  battleEndDeferralAttackId?: string,
  sourceEffectIndex?: number,
  activationZone?: EffectActivationSourceZone,
  allowPendingEffectSummonCostPayment?: boolean,
  effectTiming?: EffectTiming,
  additionalCostModifiers?: readonly AdditionalCostModifier[],
  preCostCombineHostInstanceId?: string,
  effectLookups: PreCostEffectLookups = {}
): GameState {
  if (action.target === "self") {
    return executeSummonSelf(
      state,
      chainId,
      actingPlayerId,
      action,
      sourceInstanceId,
      getCardDefinitionById,
      summonPaymentSources,
      summonEnterFieldCorePlacements,
      sourceEffectIndex,
      activationZone,
      allowPendingEffectSummonCostPayment,
      effectTiming,
      additionalCostModifiers,
      preCostCombineHostInstanceId,
      effectLookups
    );
  }
  return executeSummonOther(
    state,
    chainId,
    actingPlayerId,
    action,
    sourceInstanceId,
    getCardDefinitionById,
    summonPaymentSources,
    summonEnterFieldCorePlacements,
    preSelectedIds,
    battleEndDeferralAttackId,
    sourceEffectIndex,
    preCostCombineHostInstanceId,
    effectLookups
  );
}

function matchesSummonSourceZoneRequirement(
  requirement: NonNullable<SummonAction["zone"]>,
  zone: Zone | EffectActivationSourceZone
): boolean {
  return (
    requirement === zone ||
    requirement.split("_or_").some((candidate) => candidate === zone)
  );
}

function removeSoulStateReference(
  state: GameState,
  sourceInstanceId: string
): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.soulStateInstanceIds.includes(sourceInstanceId)
        ? {
            ...player,
            soulStateInstanceIds: player.soulStateInstanceIds.filter(
              (id) => id !== sourceInstanceId
            ),
          }
        : player
    ),
  };
}

/** target:"self" — 効果発動カード自身を召喚 */
export function executeSummonSelf(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  action: SummonAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  summonPaymentSources?: readonly CardCostPaymentSource[],
  summonEnterFieldCorePlacements?: readonly EnterFieldCorePlacement[],
  sourceEffectIndex?: number,
  activationZone?: EffectActivationSourceZone,
  _allowPendingEffectSummonCostPayment?: boolean,
  effectTiming?: EffectTiming,
  additionalCostModifiers?: readonly AdditionalCostModifier[],
  preCostCombineHostInstanceId?: string,
  effectLookups: PreCostEffectLookups = {}
): GameState {
  const card = getCardById(state, sourceInstanceId);
  if (!card) return state;
  const adventSourceIds = collectUnderCardScopeIds(state).adventSource;
  const isAdventSourceOrigin = adventSourceIds.has(card.instanceId);
  const isSoulStateOrigin = state.players.some((player) =>
    player.soulStateInstanceIds.includes(card.instanceId)
  );
  const sourceZoneForRequirement = getSelfSummonSourceZone(
    state,
    card,
    action.zone,
    activationZone
  );

  // engine-suppress-third-party-summon-observation (BSTH11-X02【現界】): 実際の場入りが
  // 起きたかどうかに関わらずマーカーを積んでおく (後段 diff 検出が state 変化と log の両方を
  // 見て実際に場入りしたインスタンスだけへ絞り込むため、失敗パスでの残留は無害)。
  if (action.suppressThirdPartySummonObservation) {
    state.log.push(`effect:summon-suppress-third-party:${sourceInstanceId}`);
  }

  // zone 制約があればチェック
  if (
    action.zone &&
    !matchesSelfSummonSourceZone(
      state,
      card,
      action.zone,
      activationZone,
      getCardDefinitionById
    )
  ) {
    state.log.push(`effect:summon:${sourceInstanceId}:not-in-${action.zone}`);
    return state;
  }

  // 既にフィールドにいる場合は何もしない。ただし煌臨元アンダーカード
  // (engine-advent-source-summon-permission、BSSL01-X03) は runtime Zone 上 "field" の
  // ままホストの下に重なっているだけで、独立した場のカードではないため除外しない
  // （召喚許可効果で場へ「召喚」しなおせる。ホスト側 underCards の参照は下段で剥がす）。
  if (card.zone === "field" && !isAdventSourceOrigin && !isSoulStateOrigin) {
    return state;
  }

  const def = getCardDefinitionById(card.definitionId);
  if (!def) return state;
  const enterFieldEventKind = getSummonActionEnterFieldEventKind(action, def);
  const effectScope = action.effectScope;
  const summoningPlayerId = card.controllerPlayerId;
  if (
    !action.ignoreSummonCondition &&
    !canSummonUltimate(state, summoningPlayerId, def, getCardDefinitionById, {
      sourceInstanceId,
      evaluateCondition,
    })
  ) {
    state.log.push(`effect:summon:${sourceInstanceId}:summon-condition-failed`);
    return state;
  }

  const minCores = getMinimumRequiredCoresFromDefinition(def);
  const player = state.players.find((p) => p.id === summoningPlayerId);
  if (!player) return state;

  const tokenPoolPreCostForcedCombine =
    preCostCombineHostInstanceId !== undefined
      ? { state, combineHostInstanceId: preCostCombineHostInstanceId }
      : def.printedCategory === "brave" && enterFieldEventKind === "summon"
        ? applyTokenPoolPreCostForcedCombineDeclarationSideEffect(
            state,
            summoningPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            { ...effectLookups, chainId }
          )
        : null;
  const stateBeforeCost = tokenPoolPreCostForcedCombine?.state ?? state;
  if (stateBeforeCost.pendingMultiPlacement && tokenPoolPreCostForcedCombine) {
    return {
      ...stateBeforeCost,
      pendingMultiPlacement: {
        ...stateBeforeCost.pendingMultiPlacement,
        resumeEffectSummon: {
          combineHostInstanceId:
            tokenPoolPreCostForcedCombine.combineHostInstanceId,
          ...(summonPaymentSources !== undefined
            ? { paymentSources: summonPaymentSources }
            : {}),
        },
      },
    };
  }

  // engine-summon-target-self-paid-cost (BSTH07.8-X01 界放：3): 召喚前にオフフィールドの
  // このカードへ既に置かれたコアを持ち越す opt-in。既定 (false/未指定) は従来どおり
  // 0リセット + minCores 満額配置 (existingCoreCount=0 → additionalCoresNeeded=minCores)。
  const existingCoreCount = action.carryOverExistingCores
    ? card.normalCoreCount
    : 0;
  const existingTotalCoreCount =
    existingCoreCount +
    (action.carryOverExistingCores ? card.soulCoreCount : 0);

  const canOpenEffectSummonAltCostChoice =
    summonPaymentSources === undefined &&
    summonEnterFieldCorePlacements === undefined &&
    additionalCostModifiers === undefined &&
    activationZone !== undefined &&
    action.zone !== undefined &&
    !action.withoutCost &&
    !action.fullReduction &&
    action.fixedPayment === undefined &&
    action.overrideCost === undefined;
  if (canOpenEffectSummonAltCostChoice) {
    const costExcludeOption = getSummonCostExcludeChoiceOption(
      stateBeforeCost,
      summoningPlayerId,
      card,
      def,
      getCardDefinitionById,
      undefined,
      sourceEffectIndex
    );
    const costCoreMoveOption =
      costExcludeOption === undefined
        ? getSummonCostCoreMoveChoiceOption(
            stateBeforeCost,
            summoningPlayerId,
            card,
            def,
            getCardDefinitionById
          )
        : undefined;
    if (
      costCoreMoveOption !== undefined &&
      costCoreMoveOption.minCount > 0 &&
      costCoreMoveOption.availableCoreCount < costCoreMoveOption.minCount
    ) {
      const logEntry = `effect:summon:${sourceInstanceId}:insufficient-cost-core-move:required=${costCoreMoveOption.minCount}:available=${costCoreMoveOption.availableCoreCount}`;
      if (activationZone !== undefined && card.zone === "in_use") {
        return moveFailedEffectSummonCardToTrash({
          state: stateBeforeCost,
          actingPlayerId: summoningPlayerId,
          instanceId: sourceInstanceId,
          getCardDefinitionById,
          logEntry,
        });
      }
      return {
        ...state,
        log: [...state.log, logEntry],
      };
    }
    if (costExcludeOption !== undefined) {
      return {
        ...stateBeforeCost,
        pendingSummonCostExcludeChoice: {
          pendingId: nextPendingSelectionId("scec"),
          actingPlayerId: summoningPlayerId,
          sourceInstanceId,
          sourceDefinitionId: card.definitionId,
          effectIndex: costExcludeOption.effectIndex,
          candidateCardInstanceIds: costExcludeOption.candidateCardInstanceIds,
          maxCount: costExcludeOption.maxCount,
          discountPerCard: costExcludeOption.discountPerCard,
          ...(costExcludeOption.fullCostPaid ? { fullCostPaid: true } : {}),
          sourceZone: costExcludeOption.sourceZone,
          minCount: costExcludeOption.minCount,
          ...(costExcludeOption.fullReduction ? { fullReduction: true } : {}),
          ...(action.onBoardCoreSourceFilter !== undefined
            ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
            : {}),
          effectSummonActivationZone: activationZone,
          effectSummonChainId: chainId,
          ...(sourceEffectIndex !== undefined
            ? { effectSummonSourceEffectIndex: sourceEffectIndex }
            : {}),
          effectSummonEffectTiming: effectTiming ?? {
            kind: "activated",
            mode: "main",
          },
        },
        log: [
          ...stateBeforeCost.log,
          `effect:summon-cost-exclude:pending:${sourceInstanceId}:max=${costExcludeOption.maxCount}`,
        ],
      };
    }
    if (costCoreMoveOption !== undefined) {
      return {
        ...stateBeforeCost,
        pendingSummonCostCoreMoveChoice: {
          pendingId: nextPendingSelectionId("sccmc"),
          actingPlayerId: summoningPlayerId,
          sourceInstanceId,
          sourceDefinitionId: card.definitionId,
          effectIndex: costCoreMoveOption.effectIndex,
          availableCoreCount: costCoreMoveOption.availableCoreCount,
          minCount: costCoreMoveOption.minCount,
          costOffset: costCoreMoveOption.costOffset,
          ...(costCoreMoveOption.grantsFreeSummon
            ? { grantsFreeSummon: true }
            : {}),
          fieldDestinationCandidateInstanceIds:
            costCoreMoveOption.fieldDestinationCandidateInstanceIds,
          ...(action.onBoardCoreSourceFilter !== undefined
            ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
            : {}),
          effectSummonActivationZone: activationZone,
          effectSummonChainId: chainId,
          ...(sourceEffectIndex !== undefined
            ? { effectSummonSourceEffectIndex: sourceEffectIndex }
            : {}),
          effectSummonEffectTiming: effectTiming ?? {
            kind: "activated",
            mode: "main",
          },
        },
        log: [
          ...stateBeforeCost.log,
          `effect:summon-cost-core-move:pending:${sourceInstanceId}:min=${costCoreMoveOption.minCount}:available=${costCoreMoveOption.availableCoreCount}`,
        ],
      };
    }
  }

  // コスト計算。zone 制約なし（旧 summon_self 相当）は従来互換でコストなし。
  // ただし advent_source / soul_state は runtime Zone 上 "field" のままなので、
  // activationZone が即時型の自己召喚元を示している場合は通常コスト計算へ入れる。
  const activationSourceRequiresCost =
    activationZone !== undefined && sourceZoneForRequirement !== card.zone;
  const costToPay =
    action.zone ||
    activationSourceRequiresCost ||
    action.withoutCost ||
    action.fullReduction ||
    action.fixedPayment !== undefined ||
    action.overrideCost !== undefined
      ? resolveSummonActionCost({
          state: stateBeforeCost,
          actingPlayerId: summoningPlayerId,
          definition: def,
          action,
          sourceInstanceId,
          ...(additionalCostModifiers !== undefined
            ? { additionalCostModifiers }
            : {}),
          getCardDefinitionById,
        })
      : 0;

  if (
    isCardUseRestricted(
      stateBeforeCost,
      summoningPlayerId,
      card,
      def,
      getCardDefinitionById,
      def.printedCategory === "nexus" ? "place_nexus" : "summon",
      { byEffect: true, effectiveCost: costToPay }
    )
  ) {
    stateBeforeCost.log.push(`effect:summon:${sourceInstanceId}:restricted`);
    return stateBeforeCost;
  }

  const paymentChoice = resolveEffectSummonPaymentChoice({
    state: stateBeforeCost,
    actingPlayerId: summoningPlayerId,
    sourceInstanceId,
    targetInstanceId: sourceInstanceId,
    definition: def,
    amount: costToPay,
    getCardDefinitionById,
    paymentSources: summonPaymentSources,
    excludedInstanceIds: new Set([sourceInstanceId]),
    onBoardCoreSourceFilter: action.onBoardCoreSourceFilter,
    summonCause: action.summonCause,
    additionalCostModifiers,
    effectTiming,
    sourceEffectIndex,
    preCostCombineHostInstanceId:
      tokenPoolPreCostForcedCombine?.combineHostInstanceId,
  });
  if (paymentChoice.kind === "pending") return paymentChoice.state;
  if (paymentChoice.kind === "unavailable") {
    const logEntry = `effect:summon:${sourceInstanceId}:insufficient-cost:required=${costToPay}`;
    if (activationZone !== undefined && card.zone === "in_use") {
      return moveFailedEffectSummonCardToTrash({
        state: stateBeforeCost,
        actingPlayerId: summoningPlayerId,
        instanceId: sourceInstanceId,
        getCardDefinitionById,
        logEntry,
      });
    }
    return { ...state, log: [...state.log, logEntry] };
  }
  const playerInputAutoPaymentSources = paymentChoice.paymentSources;
  {
    // 支払い金額一致チェック (paymentSources を渡したなら必ず total === costToPay)
    if (summonPaymentSources !== undefined) {
      const totalProvided = getTotalPaymentAmount(summonPaymentSources);
      if (totalProvided !== costToPay) {
        state.log.push(
          `effect:summon:${sourceInstanceId}:payment-mismatch:expected=${costToPay}:got=${totalProvided}`
        );
        return state;
      }
      assertSummonPaymentSourcesAvailable(
        stateBeforeCost,
        summoningPlayerId,
        def,
        summonPaymentSources,
        getCardDefinitionById,
        sourceInstanceId,
        new Set([sourceInstanceId]),
        action.onBoardCoreSourceFilter
      );
    }
    // placement policy 検証 (`天渡` 等のキーワード制約を効果召喚にも適用)。
    // P3-110: 維持コアが pre-supplied のときのみ最低数を検証する。未供給 (= 対話モードで
    // 窓後 deferred 配置) のときは後段で pendingMultiPlacement を生成するため、ここでは検証しない。
    const policy = getEnterFieldCorePlacementPolicy({
      card: { ...card, minimumRequiredCores: minCores },
      definition: def,
    });
    const placements = summonEnterFieldCorePlacements ?? [];
    assertEnterFieldCorePlacementsAllowed(policy, placements);
    // policy.minimumCoreCount は配置ルール (rule="optional"/"forbidden" なら常に下限0、
    // "required_minimum" のみ card.minimumRequiredCores) 由来の SSOT。carryOverExistingCores
    // による持ち越し分は、この下限からさらに差し引く (下限そのものを additionalCoresNeeded で
    // 置き換えると optional/forbidden ルールのカードで誤って非0下限を要求しうる)。
    const requiredMinimumAfterCarryOver = tokenPoolPreCostForcedCombine
      ? 0
      : Math.max(0, policy.minimumCoreCount - existingTotalCoreCount);
    if (
      summonEnterFieldCorePlacements !== undefined &&
      getPlacedCoreCount(placements) < requiredMinimumAfterCarryOver
    ) {
      throw new Error(
        `Not enough enter-field cores selected: required=${requiredMinimumAfterCarryOver} selected=${getPlacedCoreCount(placements)}`
      );
    }
  }

  const zoneRoleName =
    def.printedCategory === "spirit"
      ? "spirit"
      : def.printedCategory === "ultimate"
        ? "ultimate"
        : def.printedCategory === "nexus"
          ? "nexus"
          : def.printedCategory === "brave"
            ? "brave"
            : "spirit";

  {
    const placements = summonEnterFieldCorePlacements ?? [];
    const placedCount = getPlacedCoreCount(placements);
    const summonLogEntry = `${getEffectEnterFieldLogEntry({
      eventKind: enterFieldEventKind,
      actingPlayerId: summoningPlayerId,
      instanceId: sourceInstanceId,
      relation: "self",
      source: "self",
      effectScope,
    })}:from=${sourceZoneForRequirement}:cost=${costToPay}:cores=${placedCount}:interactive=true`;

    // 1. カードを field へ移動 (cores は carryOverExistingCores 未指定なら0初期化)
    const fieldState = moveCardZone(
      stateBeforeCost,
      sourceInstanceId,
      "field",
      zoneRoleName
    );
    let nextState: GameState = removeSoulStateReference(
      replaceCardInstances(
        {
          ...fieldState,
          log: [...stateBeforeCost.log, summonLogEntry],
        },
        stripAdventSourceUnderCardReference(
          fieldState.cardInstances.map((c) =>
            c.instanceId === sourceInstanceId
              ? {
                  ...c,
                  zone: "field" as const,
                  zoneRoleName,
                  normalCoreCount: existingCoreCount,
                  minimumRequiredCores: minCores,
                  exhaustState: "recovered" as const,
                }
              : c
          ),
          sourceInstanceId
        )
      ),
      sourceInstanceId
    );

    nextState = recordBraveFieldEntry(
      nextState,
      def,
      sourceInstanceId,
      enterFieldEventKind,
      card.zone
    );

    // 2. コスト支払い: applyCardCostPayments で reserve / フィールドカード混在ソースを処理
    const effectivePaymentSources =
      summonPaymentSources ?? playerInputAutoPaymentSources;
    if (
      costToPay > 0 &&
      effectivePaymentSources !== undefined &&
      effectivePaymentSources !== null
    ) {
      nextState = applyCardCostPayments({
        state: nextState,
        actingPlayerId: summoningPlayerId,
        chainId: chainId,
        paymentSources: effectivePaymentSources,
        getCardDefinitionById,
        ...(action.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
          : {}),
      });
    }

    // 3. フィールド進入時コア配置。
    // P3-110: 即時型効果召喚（咲夜 X05 等）は「宣言 → スタック → コスト → 維持コア」順。
    // 維持コアが未供給（= 対話モードで発揮応答窓クローズ後に配置）なら、複数体召喚と同じ
    // pendingMultiPlacement を生成して効果を中断する（continuation は executeEffect が注入し、
    // apply_pending_multi_placement で維持コア適用 → 後続ステップ再開）。play_card（常時型）の
    // 窓前コスト順序には影響しない（経路分離済）。pre-supplied 時は従来どおり inline 適用。
    if (summonEnterFieldCorePlacements === undefined) {
      const deferPolicy = getEnterFieldCorePlacementPolicy({
        card: { ...card, minimumRequiredCores: minCores },
        definition: def,
      });
      const maxCores =
        deferPolicy.maximumCoreCount === null
          ? Infinity
          : deferPolicy.maximumCoreCount;
      if (maxCores === 0) return nextState;
      if (tokenPoolPreCostForcedCombine)
        nextState = executeBraveCombine(
          nextState,
          summoningPlayerId,
          sourceInstanceId,
          tokenPoolPreCostForcedCombine.combineHostInstanceId,
          getCardDefinitionById
        );
      nextState = queueEnterFieldCorePlacement({
        state: nextState,
        beforeState: state,
        instanceId: sourceInstanceId,
        getCardDefinitionById,
        eventKind: enterFieldEventKind,
        ...(action.fieldCoreSourceMinimum !== undefined
          ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
          : {}),
      });
      if (!nextState.pendingMultiPlacement) return nextState;
      return {
        ...nextState,
        pendingMultiPlacement: {
          ...nextState.pendingMultiPlacement,
          canAbort: tokenPoolPreCostForcedCombine === null,
          ...(tokenPoolPreCostForcedCombine
            ? {
                resolvedBraveCombineInstanceIds: [sourceInstanceId],
              }
            : {}),
          ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
          targets: nextState.pendingMultiPlacement.targets.map((target) => ({
            ...target,
            ...(tokenPoolPreCostForcedCombine ? { minimumCoreCount: 0 } : {}),
            ...(effectScope !== undefined ? { effectScope } : {}),
          })),
        },
      };
    }
    if (placements.length > 0) {
      nextState = applyEnterFieldCorePlacements({
        ...(action.fieldCoreSourceMinimum !== undefined
          ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
          : {}),
        state: nextState,
        actingPlayerId: summoningPlayerId,
        destinationInstanceId: sourceInstanceId,
        placements,
        getCardDefinitionById,
      });
    }
    if (tokenPoolPreCostForcedCombine !== null) {
      const combined = executeBraveCombine(
        nextState,
        summoningPlayerId,
        sourceInstanceId,
        tokenPoolPreCostForcedCombine.combineHostInstanceId,
        getCardDefinitionById
      );
      nextState = {
        ...combined,
        log: [
          ...combined.log,
          `effect:summon:brave-forced-token-combine:${sourceInstanceId}:${tokenPoolPreCostForcedCombine.combineHostInstanceId}`,
        ],
      };
    }

    return nextState;
  }
}

/**
 * target:"ref" — 直前 step で選択/影響を受けたカードインスタンス群
 * (`getStepResult(stepCtx, stepId).affectedCardInstanceIds`) を、zone 探索や候補
 * フィルタを経由せずそのまま召喚する (engine-exclude-owner-resummon-exhausted、
 * BSLH01-M03「除外した対象を持ち主のフィールドに疲労状態でコストを支払わずに召喚する」)。
 * `action.toOwnerField` 指定時は各カードをその持ち主 (`ownerPlayerId`) のフィールドへ
 * 個別に召喚し、持ち主ごとの共通配置HUDを順に開く。維持コア不足時は他対象に影響させず、その対象のみ
 * `moveFailedEffectSummonCardToTrash` でトラッシュへ送る。
 */
export function executeRefSummon(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.SummonAction & {
    target: { kind: "ref"; stepId: string };
  },
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  affectedInstanceIds: readonly string[],
  sourceInstanceId = affectedInstanceIds[0] ?? "dsl-unknown"
): GameState {
  let nextState = state;
  const groups = new Map<string, PendingMultiPlacement["targets"]>();
  for (const instanceId of affectedInstanceIds) {
    const card = getCardById(nextState, instanceId);
    if (!card || card.zone === "field") continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;

    const summoningPlayerId = action.toOwnerField
      ? card.ownerPlayerId
      : actingPlayerId;

    if (
      isCardUseRestricted(
        nextState,
        summoningPlayerId,
        card,
        def,
        getCardDefinitionById,
        def.printedCategory === "nexus" ? "place_nexus" : "summon",
        { byEffect: true, effectiveCost: 0 }
      )
    ) {
      nextState = {
        ...nextState,
        log: [...nextState.log, `effect:summon:${instanceId}:ref:restricted`],
      };
      continue;
    }
    if (
      !canSummonUltimate(
        nextState,
        summoningPlayerId,
        def,
        getCardDefinitionById,
        {
          sourceInstanceId: instanceId,
          evaluateCondition,
        }
      )
    ) {
      nextState = {
        ...nextState,
        log: [
          ...nextState.log,
          `effect:summon:${instanceId}:ref:summon-condition-failed`,
        ],
      };
      continue;
    }

    const minCores = getMinimumRequiredCoresFromDefinition(def);
    const zoneRoleName = getDefaultZoneRoleName(def, "field");

    nextState = moveCardZone(nextState, instanceId, "field", zoneRoleName);
    nextState = replaceCardInstances(
      {
        ...nextState,
      },
      nextState.cardInstances.map((c) =>
        c.instanceId === instanceId
          ? {
              ...c,
              zone: "field" as const,
              zoneRoleName,
              controllerPlayerId: summoningPlayerId,
              normalCoreCount: 0,
              minimumRequiredCores: minCores,
              exhaustState: action.entersExhausted
                ? ("exhausted" as const)
                : ("recovered" as const),
              attachedToInstanceId: null,
              attachedChildrenIds: [],
            }
          : c
      )
    );

    nextState = recordBraveFieldEntry(
      nextState,
      def,
      instanceId,
      getSummonActionEnterFieldEventKind(action, def),
      card.zone
    );
    const policy = getEnterFieldCorePlacementPolicy({
      card: getCardById(nextState, instanceId)!,
      definition: def,
    });
    const targets = groups.get(summoningPlayerId) ?? [];
    const entryTarget: PendingMultiPlacementTarget = {
      instanceId,
      definitionId: card.definitionId,
      minimumCoreCount: policy.minimumCoreCount,
      maximumCoreCount: policy.maximumCoreCount,
      enterFieldEventKind: getSummonActionEnterFieldEventKind(action, def),
    };
    const required =
      targets.reduce(
        (sum, target) =>
          sum +
          getEntryMinimumCoreCount(nextState, target, getCardDefinitionById),
        0
      ) +
      getEntryMinimumCoreCount(nextState, entryTarget, getCardDefinitionById);
    const available = countEnterFieldCoreSources({
      state: nextState,
      actingPlayerId: summoningPlayerId,
      getCardDefinitionById,
      excludedFieldSourceIds: new Set(affectedInstanceIds),
      ...(action.fieldCoreSourceMinimum
        ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
        : {}),
    });
    if (available < required) {
      nextState = moveFailedEffectSummonCardToTrash({
        state: nextState,
        actingPlayerId: summoningPlayerId,
        instanceId,
        getCardDefinitionById,
        logEntry: `effect:summon:${instanceId}:ref:insufficient-enter-cores:required=${minCores}`,
      });
      continue;
    }
    if (policy.maximumCoreCount !== 0) {
      targets.push(entryTarget);
      groups.set(summoningPlayerId, targets);
    }
  }
  const placements = [...groups].map(([playerId, targets]) => ({
    actingPlayerId: playerId,
    targets,
  }));
  const first = placements.shift();
  if (!first) return nextState;
  return openEntryBraveCombineChoice(
    {
      ...nextState,
      pendingMultiPlacement: {
        pendingId: nextPendingSelectionId("mp"),
        ...first,
        effectActingPlayerId: actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId:
          getCardById(state, sourceInstanceId)?.definitionId ?? "dsl-unknown",
        ...(placements.length ? { remainingPlacements: placements } : {}),
        excludedFieldSourceIds: [...affectedInstanceIds],
        ...(action.fieldCoreSourceMinimum
          ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
          : {}),
        effectTiming: { kind: "activated", mode: "main" },
        priorStateSnapshot: state,
      },
    },
    getCardDefinitionById
  );
}

/**
 * `summon.zone`（"other" 召喚）の候補カード（zone一致 + includeAdventSource分 + filter）を
 * 解決する。`executeSummonOther` と `executeSplitSummonChoice`（ENGINE-sequential-slot-choice、
 * BSSL01-X01[5,6]）で共有する SSOT（同じ候補列挙・フィルタ判定を2箇所に持たない）。
 */
export function resolveSummonFromZoneCandidates(
  state: GameState,
  actingPlayerId: string,
  action: Pick<
    SummonAction,
    | "zone"
    | "filter"
    | "includeAdventSource"
    | "includeSoulState"
    | "fullReduction"
    | "restrictToInstanceIds"
  >,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardInstance[] {
  if (!action.zone) return [];
  return resolveSummonFromZoneCandidatesShared(
    state,
    actingPlayerId,
    {
      zone: action.zone,
      ...(action.filter ? { filter: action.filter } : {}),
      ...(action.includeAdventSource ? { includeAdventSource: true } : {}),
      ...(action.includeSoulState ? { includeSoulState: true } : {}),
      ...(action.fullReduction ? { fullReduction: true } : {}),
      ...(action.restrictToInstanceIds
        ? { restrictToInstanceIds: action.restrictToInstanceIds }
        : {}),
    },
    getCardDefinitionById
  );
}

function costModifierFromNativeSummonAction(
  action: SummonAction
): import("../dsl-types").CostModifier | undefined {
  if (action.withoutCost) return "free";
  if (action.fullReduction) return "full_reduction";
  if (action.overrideCost !== undefined)
    return { override: action.overrideCost };
  if (action.fixedPayment !== undefined)
    return { fixedPayment: action.fixedPayment };
  return undefined;
}

function canEffectSummonFromZoneCandidateNow(
  state: GameState,
  actingPlayerId: string,
  action: SummonAction,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const def = getCardDefinitionById(card.definitionId);
  if (!def) return false;
  if (action.ignoreSummonCondition === true) return true;
  return canSummonUltimate(state, actingPlayerId, def, getCardDefinitionById, {
    sourceInstanceId: card.instanceId,
    evaluateCondition,
  });
}

/** target:"other" — 別カードをゾーンから召喚 */
export function executeSummonOther(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  action: SummonAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  summonPaymentSources?: readonly CardCostPaymentSource[],
  summonEnterFieldCorePlacements?: readonly EnterFieldCorePlacement[],
  preSelectedIds?: readonly string[],
  battleEndDeferralAttackId?: string,
  sourceEffectIndex?: number,
  preCostCombineHostInstanceId?: string,
  effectLookups: PreCostEffectLookups = {}
): GameState {
  // count:"all" は resolveCountToNumber (native-action-registry.ts) で -1 センチネルに
  // 解決される。slice(0, -1) は末尾を落とすだけになるため、ここで無制限 (Infinity) に変換する
  // (BSSG01-C08 Lv2「...カードすべてを...召喚できる」、engine-advent-source-leave-summon で
  // from_zone summon に count:"all" を使う初の実例)。
  const count = action.count === -1 ? Infinity : (action.count ?? 1);

  const matching = resolveSummonFromZoneCandidates(
    state,
    actingPlayerId,
    action,
    getCardDefinitionById
  ).filter((card) =>
    canEffectSummonFromZoneCandidateNow(
      state,
      actingPlayerId,
      action,
      card,
      getCardDefinitionById
    )
  );
  const adventSourceIds = action.includeAdventSource
    ? collectUnderCardScopeIds(state).adventSource
    : new Set<string>();
  const stripIfAdventSource = (st: GameState, instanceId: string): GameState =>
    adventSourceIds.has(instanceId)
      ? replaceCardInstances(
          {
            ...st,
          },
          stripAdventSourceUnderCardReference(st.cardInstances, instanceId)
        )
      : st;

  const toSummon =
    preSelectedIds !== undefined && preSelectedIds.length > 0
      ? preSelectedIds
          .map((id) => matching.find((card) => card.instanceId === id))
          .filter((card): card is CardInstance => card !== undefined)
          .slice(0, count)
      : matching.slice(0, count);
  if (toSummon.length === 0) {
    state.log.push(`effect:summon:${action.zone}:no-targets`);
    return state;
  }

  if (
    toSummon.length === 1 &&
    getSummonActionEnterFieldEventKind(
      action,
      getCardDefinitionById(toSummon[0]!.definitionId)!
    ) === "summon"
  ) {
    const card = toSummon[0]!;
    const preCost = preCostCombineHostInstanceId
      ? { state, combineHostInstanceId: preCostCombineHostInstanceId }
      : applyTokenPoolPreCostForcedCombineDeclarationSideEffect(
          state,
          actingPlayerId,
          card.instanceId,
          getCardDefinitionById,
          { ...effectLookups, chainId }
        );
    if (preCost?.state.pendingMultiPlacement)
      return {
        ...preCost.state,
        pendingMultiPlacement: {
          ...preCost.state.pendingMultiPlacement,
          resumeEffectSummon: {
            combineHostInstanceId: preCost.combineHostInstanceId,
            ...(summonPaymentSources !== undefined
              ? { paymentSources: summonPaymentSources }
              : {}),
          },
        },
      };
    if (preCost)
      return executeSummonSelf(
        state,
        chainId,
        actingPlayerId,
        { ...action, target: "self" },
        card.instanceId,
        getCardDefinitionById,
        summonPaymentSources,
        summonEnterFieldCorePlacements,
        sourceEffectIndex,
        undefined,
        undefined,
        undefined,
        undefined,
        preCost.combineHostInstanceId,
        effectLookups
      );
  }

  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) return state;

  let nextState: GameState = state;

  // 単体の効果召喚/配置/「出す」はコスト支払い後に維持コア配置 pending へ入る。
  // 複数体同時の per-target 配置は下の useMultiPlayerInputs 経路で扱う。
  const useSinglePlayerInputs = toSummon.length === 1;

  // P3-49 placement_multi: 複数体同時召喚で paymentSources が渡された場合、または
  // コストなし効果召喚で維持コアが未指定の場合、コスト一括支払い + フィールド進入
  // (cores=0) の後、pendingMultiPlacement を生成して効果を中断する。
  // GUI が apply_pending_multi_placement で per-target 配置を渡した時点で再開される。
  const useMultiPlayerInputs = toSummon.length >= 2;

  if (
    useMultiPlayerInputs &&
    summonPaymentSources === undefined &&
    !canAutoExecuteSummonFromZoneCandidateSequence({
      state,
      actingPlayerId,
      action,
      candidates: toSummon,
      getCardDefinitionById,
    })
  ) {
    return {
      ...state,
      log: [...state.log, "effect:summon:multi:insufficient-shared-cores"],
    };
  }
  if (useMultiPlayerInputs) {
    // 1. 各カードのコスト合計
    let totalCost = 0;
    const perCardZoneRoleName = new Map<
      string,
      "spirit" | "ultimate" | "nexus" | "brave"
    >();
    const perCardMinCores = new Map<string, number>();
    for (const card of toSummon) {
      const def = getCardDefinitionById(card.definitionId);
      const minCores = def ? getMinimumRequiredCoresFromDefinition(def) : 0;
      const zoneRoleName: "spirit" | "ultimate" | "nexus" | "brave" =
        def?.printedCategory === "spirit"
          ? "spirit"
          : def?.printedCategory === "ultimate"
            ? "ultimate"
            : def?.printedCategory === "nexus"
              ? "nexus"
              : def?.printedCategory === "brave"
                ? "brave"
                : "spirit";
      perCardZoneRoleName.set(card.instanceId, zoneRoleName);
      perCardMinCores.set(card.instanceId, minCores);

      const costPerCard = def
        ? resolveSummonActionCost({
            state: nextState,
            actingPlayerId,
            definition: def,
            action,
            sourceInstanceId: card.instanceId,
            ...(action.perCardOverrideCost?.[card.instanceId] !== undefined
              ? { perCardOverride: action.perCardOverrideCost[card.instanceId] }
              : {}),
            getCardDefinitionById,
          })
        : 0;
      totalCost += costPerCard;
    }

    const paymentAvailabilityDefinition = toSummon
      .map((card) => getCardDefinitionById(card.definitionId))
      .find((def): def is CardDefinition => def !== undefined);
    if (paymentAvailabilityDefinition === undefined) {
      nextState.log.push(`effect:summon:multi:missing-definition`);
      return nextState;
    }
    const paymentChoice = resolveEffectSummonPaymentChoice({
      state: nextState,
      actingPlayerId,
      sourceInstanceId,
      targetInstanceId: toSummon[0]!.instanceId,
      definition: paymentAvailabilityDefinition,
      amount: totalCost,
      getCardDefinitionById,
      paymentSources: summonPaymentSources,
      excludedInstanceIds: new Set(toSummon.map((card) => card.instanceId)),
      onBoardCoreSourceFilter: action.onBoardCoreSourceFilter,
      summonCause: action.summonCause,
      sourceEffectIndex,
    });
    if (paymentChoice.kind === "pending") return paymentChoice.state;
    if (paymentChoice.kind === "unavailable")
      return {
        ...state,
        log: [
          ...state.log,
          `effect:summon:multi:insufficient-cost:required=${totalCost}`,
        ],
      };
    const effectiveSummonPaymentSources = paymentChoice.paymentSources;
    // 2. paymentSources 検証 (合計が totalCost と一致)
    const totalProvided = getTotalPaymentAmount(effectiveSummonPaymentSources);
    if (totalProvided !== totalCost) {
      nextState.log.push(
        `effect:summon:multi:payment-mismatch:expected=${totalCost}:got=${totalProvided}`
      );
      return nextState;
    }
    assertSummonPaymentSourcesAvailable(
      nextState,
      actingPlayerId,
      paymentAvailabilityDefinition,
      effectiveSummonPaymentSources,
      getCardDefinitionById,
      toSummon[0]?.instanceId,
      new Set(toSummon.map((card) => card.instanceId)),
      action.onBoardCoreSourceFilter
    );

    nextState.log.push(
      `effect:summon:multi:from=${action.zone}:count=${toSummon.length}:cost=${totalCost}:interactive=true`
    );

    // 3. 各カードを field へ cores=0 で移動 (handCount 減算含む)
    const summonedIds = new Set(toSummon.map((c) => c.instanceId));
    for (const id of summonedIds)
      nextState = moveCardZone(
        nextState,
        id,
        "field",
        perCardZoneRoleName.get(id)
      );
    nextState = replaceCardInstances(
      {
        ...nextState,
      },
      nextState.cardInstances.map((c) => {
        if (!summonedIds.has(c.instanceId)) return c;
        const zoneRoleName = perCardZoneRoleName.get(c.instanceId)!;
        const minCores = perCardMinCores.get(c.instanceId)!;
        return {
          ...c,
          zone: "field" as const,
          zoneRoleName,
          normalCoreCount: 0,
          minimumRequiredCores: minCores,
          exhaustState: "recovered" as const,
          attachedToInstanceId: null,
          attachedChildrenIds: [],
          oraclePlacementSuppressed: action.suppressPlacementOracle === true,
        };
      })
    );
    for (const id of summonedIds) {
      nextState = stripIfAdventSource(nextState, id);
    }

    for (const card of toSummon) {
      const definition = getCardDefinitionById(card.definitionId);
      if (definition)
        nextState = recordBraveFieldEntry(
          nextState,
          definition,
          card.instanceId,
          getSummonActionEnterFieldEventKind(action, definition),
          card.zone
        );
    }
    // 4. コスト支払い: 全 paymentSources を 1 度に消化
    if (totalCost > 0) {
      nextState = applyCardCostPayments({
        state: nextState,
        actingPlayerId,
        chainId: chainId,
        paymentSources: effectiveSummonPaymentSources,
        getCardDefinitionById,
        ...(action.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
          : {}),
      });
    }

    // 共通ポリシーで全対象の維持可能性を検査し、所有者の配置入力を待つ。
    // 不足分は失敗として処理し、解決不能な必須入力を作らない。
    for (const card of toSummon) {
      const definition = getCardDefinitionById(card.definitionId);
      if (!definition) continue;
      nextState = queueEnterFieldCorePlacement({
        state: nextState,
        beforeState: state,
        instanceId: card.instanceId,
        getCardDefinitionById,
        eventKind: getSummonActionEnterFieldEventKind(action, definition),
        ...(action.trashCoreKind === "generic"
          ? { trashCoreMax: action.trashCoreMax ?? 0 }
          : { trashNormalCoreMax: action.trashCoreMax ?? 0 }),
        ...(action.fieldCoreSourceMinimum !== undefined
          ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
          : {}),
      });
    }
    if (nextState.pendingMultiPlacement) {
      nextState = {
        ...nextState,
        pendingMultiPlacement: {
          ...nextState.pendingMultiPlacement,
          canAbort: true,
          ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
          targets: nextState.pendingMultiPlacement.targets.map((target) => ({
            ...target,
            ...(action.effectScope !== undefined
              ? { effectScope: action.effectScope }
              : {}),
          })),
        },
      };
    }
    return nextState;
  }

  const fullReductionExcludedTargetIds = new Set(
    toSummon.map((card) => card.instanceId)
  );

  const remainingTrashBudget = action.trashCoreMax ?? 0;
  for (const card of toSummon) {
    const isSoulStateCandidate = player.soulStateInstanceIds.includes(
      card.instanceId
    );
    if (isSoulStateCandidate) {
      nextState = executeSoulStateSummon(
        nextState,
        chainId,
        actingPlayerId,
        action.filter
          ? { ...action.filter, soulState: "include" }
          : action.filter,
        costModifierFromNativeSummonAction(action),
        sourceInstanceId,
        getCardDefinitionById,
        [card.instanceId],
        summonEnterFieldCorePlacements,
        state,
        summonPaymentSources,
        action.onBoardCoreSourceFilter,
        action.summonCause
      );
      if (nextState.pendingMultiPlacement !== null) return nextState;
      continue;
    }

    const def = getCardDefinitionById(card.definitionId);
    if (
      def &&
      !canEffectSummonFromZoneCandidateNow(
        nextState,
        actingPlayerId,
        action,
        card,
        getCardDefinitionById
      )
    ) {
      nextState = {
        ...nextState,
        log: [
          ...nextState.log,
          `effect:summon:${card.instanceId}:other:summon-condition-failed`,
        ],
      };
      continue;
    }
    const minCores = def ? getMinimumRequiredCoresFromDefinition(def) : 0;
    const zoneRoleName: "spirit" | "ultimate" | "nexus" | "brave" =
      def?.printedCategory === "spirit"
        ? "spirit"
        : def?.printedCategory === "ultimate"
          ? "ultimate"
          : def?.printedCategory === "nexus"
            ? "nexus"
            : def?.printedCategory === "brave"
              ? "brave"
              : "spirit";
    const cardEnterFieldEventKind = def
      ? getSummonActionEnterFieldEventKind(action, def)
      : "summon";
    const cardEffectScope = action.effectScope;

    // コスト計算
    const perCardOverride = action.perCardOverrideCost?.[card.instanceId];
    const costToPay = def
      ? resolveSummonActionCost({
          state: nextState,
          actingPlayerId,
          definition: def,
          action,
          sourceInstanceId: card.instanceId,
          ...(perCardOverride !== undefined ? { perCardOverride } : {}),
          getCardDefinitionById,
        })
      : 0;
    if (useSinglePlayerInputs && def) {
      const paymentChoice = resolveEffectSummonPaymentChoice({
        state: nextState,
        actingPlayerId,
        sourceInstanceId,
        targetInstanceId: card.instanceId,
        definition: def,
        amount: costToPay,
        getCardDefinitionById,
        paymentSources: summonPaymentSources,
        excludedInstanceIds: fullReductionExcludedTargetIds,
        onBoardCoreSourceFilter: action.onBoardCoreSourceFilter,
        summonCause: action.summonCause,
        sourceEffectIndex,
      });
      if (paymentChoice.kind === "pending") return paymentChoice.state;
      const playerInputAutoPaymentSources =
        paymentChoice.kind === "ready" ? paymentChoice.paymentSources : null;
      // 入力検証
      if (summonPaymentSources !== undefined) {
        const totalProvided = getTotalPaymentAmount(summonPaymentSources);
        if (totalProvided !== costToPay) {
          nextState.log.push(
            `effect:summon:${card.instanceId}:payment-mismatch:expected=${costToPay}:got=${totalProvided}`
          );
          continue;
        }
        assertSummonPaymentSourcesAvailable(
          nextState,
          actingPlayerId,
          def,
          summonPaymentSources,
          getCardDefinitionById,
          card.instanceId,
          fullReductionExcludedTargetIds,
          action.onBoardCoreSourceFilter
        );
      } else if (playerInputAutoPaymentSources === null) {
        nextState.log.push(
          `effect:summon:${card.instanceId}:insufficient-cost:required=${costToPay}`
        );
        continue;
      }
      const policy = getEnterFieldCorePlacementPolicy({
        card,
        definition: def,
      });
      const placements = summonEnterFieldCorePlacements;
      if (placements !== undefined) {
        assertEnterFieldCorePlacementsAllowed(policy, placements);
        if (getPlacedCoreCount(placements) < policy.minimumCoreCount) {
          throw new Error(
            `Not enough enter-field cores selected: required=${policy.minimumCoreCount} selected=${getPlacedCoreCount(placements)}`
          );
        }
      }

      nextState.log.push(
        `${getEffectEnterFieldLogEntry({
          eventKind: cardEnterFieldEventKind,
          actingPlayerId,
          instanceId: card.instanceId,
          relation: "other",
          source: "other",
          effectScope: cardEffectScope,
        })}:from=${card.zone}:cost=${costToPay}:cores=${placements === undefined ? 0 : getPlacedCoreCount(placements)}:interactive=true`
      );
      const triggerBeforeState = nextState;

      // 1. カード移動
      nextState = moveCardZone(
        nextState,
        card.instanceId,
        "field",
        zoneRoleName
      );
      nextState = replaceCardInstances(
        {
          ...nextState,
        },
        nextState.cardInstances.map((c) =>
          c.instanceId === card.instanceId
            ? {
                ...c,
                zone: "field" as const,
                zoneRoleName,
                normalCoreCount: 0,
                minimumRequiredCores: minCores,
                exhaustState: "recovered" as const,
                attachedToInstanceId: null,
                attachedChildrenIds: [],
                oraclePlacementSuppressed:
                  action.suppressPlacementOracle === true,
              }
            : c
        )
      );
      nextState = stripIfAdventSource(nextState, card.instanceId);

      nextState = recordBraveFieldEntry(
        nextState,
        def,
        card.instanceId,
        cardEnterFieldEventKind,
        card.zone
      );
      // 2. コスト支払い (applyCardCostPayments)
      const effectivePaymentSources =
        summonPaymentSources ?? playerInputAutoPaymentSources;
      if (
        costToPay > 0 &&
        effectivePaymentSources !== undefined &&
        effectivePaymentSources !== null
      ) {
        nextState = applyCardCostPayments({
          state: nextState,
          actingPlayerId,
          chainId: chainId,
          paymentSources: effectivePaymentSources,
          getCardDefinitionById,
          ...(action.onBoardCoreSourceFilter !== undefined
            ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
            : {}),
        });
      }

      // 3. フィールド進入時コア配置
      if (placements === undefined) {
        nextState = maybeOpenEffectSummonedBraveCombineChoice(
          nextState,
          triggerBeforeState,
          actingPlayerId,
          sourceInstanceId,
          card.instanceId,
          getCardDefinitionById,
          battleEndDeferralAttackId
        );
        if (nextState.pendingBraveCombineChoice !== null) {
          return nextState;
        }
        const postCombineCard = nextState.cardInstances.find(
          (c) => c.instanceId === card.instanceId
        );
        if (postCombineCard?.attachedToInstanceId != null) {
          continue;
        }
        const maxCores =
          policy.maximumCoreCount === null ? Infinity : policy.maximumCoreCount;
        if (maxCores === 0) {
          continue;
        }
        nextState = {
          ...nextState,
          pendingMultiPlacement: {
            ...(action.fieldCoreSourceMinimum !== undefined
              ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
              : {}),
            pendingId: nextPendingSelectionId("mp"),
            actingPlayerId,
            sourceInstanceId: card.instanceId,
            sourceDefinitionId: card.definitionId,
            targets: [
              {
                instanceId: card.instanceId,
                definitionId: card.definitionId,
                minimumCoreCount: policy.minimumCoreCount,
                maximumCoreCount: policy.maximumCoreCount,
                enterFieldEventKind: cardEnterFieldEventKind,
                ...(cardEffectScope !== undefined
                  ? { effectScope: cardEffectScope }
                  : {}),
              },
            ],
            ...(action.trashCoreMax !== undefined &&
            action.trashCoreMax > 0 &&
            action.trashCoreKind === "generic"
              ? { trashCoreMax: remainingTrashBudget }
              : {}),
            ...(action.trashCoreMax !== undefined &&
            action.trashCoreMax > 0 &&
            action.trashCoreKind !== "generic"
              ? { trashNormalCoreMax: action.trashCoreMax }
              : {}),
            effectTiming: { kind: "activated", mode: "main" },
            ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
            priorStateSnapshot: state,
          },
          log: [
            ...nextState.log,
            `${getEffectEnterFieldLogEntry({
              eventKind: cardEnterFieldEventKind,
              actingPlayerId,
              instanceId: card.instanceId,
              relation: "other",
              source: "pending-placement",
              effectScope: cardEffectScope,
            })}`,
          ],
        };
        return nextState;
      }

      if (placements.length > 0) {
        nextState = applyEnterFieldCorePlacements({
          ...(action.fieldCoreSourceMinimum !== undefined
            ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
            : {}),
          state: nextState,
          actingPlayerId,
          destinationInstanceId: card.instanceId,
          placements,
          getCardDefinitionById,
        });
      }
      nextState = maybeOpenEffectSummonedBraveCombineChoice(
        nextState,
        triggerBeforeState,
        actingPlayerId,
        sourceInstanceId,
        card.instanceId,
        getCardDefinitionById,
        battleEndDeferralAttackId
      );
      if (nextState.pendingBraveCombineChoice !== null) {
        return nextState;
      }
      continue;
    }
  }

  return nextState;
}

/**
 * 魂状態カード召喚 primitive。
 *
 * rule 08a:152「(魂状態のカードは)通常召喚不可。魂状態のカードを召喚する効果でのみ召喚可能」。
 * 魂状態カードはフィールドに据え置かれたまま `player.soulStateInstanceIds` に登録された
 * 状態 (zone="field" / normalCoreCount=0) のため、通常の `executeSummonOther`
 * (hand/set_aside/trash ゾーン探索) では対象にできない。本関数は専用経路として
 * 自分の魂状態カードのうち `filter.cardName` 一致カードを 1 体、通常のスピリットに昇格させる:
 *   - soulStateInstanceIds から除去
 *   - zoneRoleName / minimumRequiredCores 設定、exhaustState="recovered"
 *   - コスト支払い (reserve→trash) 後、levelDefs[0].requiredCores を reserve→カードへ配置
 *
 * costModifier="free" (コスト0召喚) のときは支払い 0。
 *
 * 召喚時イベント (card_event:summon) は instanceId 単位の effect:summon log と、
 * trigger-system 側の soulStateInstanceIds 差分で検出する。魂状態からの配置は
 * effect:field_place log で検出し、召喚イベントとは分離する。
 */
export function executeSoulStateSummon(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  filter: import("../dsl-types").CardFilter | undefined,
  costModifier: import("../dsl-types").CostModifier | undefined,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds?: readonly string[],
  summonEnterFieldCorePlacements?: readonly EnterFieldCorePlacement[],
  rollbackStateForPendingPlacement?: GameState,
  summonPaymentSources?: readonly CardCostPaymentSource[],
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter,
  summonCause?: "effect" | "burst"
): GameState {
  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) return state;

  const sourceDef = (() => {
    const src = getCardById(state, sourceInstanceId);
    return src ? getCardDefinitionById(src.definitionId) : undefined;
  })();

  const soulStateIds = new Set(player.soulStateInstanceIds);
  const selectedIds =
    resolvedTargetIds && resolvedTargetIds.length > 0
      ? new Set(resolvedTargetIds)
      : null;
  // 自分の魂状態カードのうち filter 一致を 1 体選ぶ。
  const candidates = state.cardInstances.filter((c) => {
    if (c.ownerPlayerId !== actingPlayerId) return false;
    if (c.zone !== "field") return false;
    if (c.attachedToInstanceId !== null) return false;
    if (!soulStateIds.has(c.instanceId)) return false;
    if (selectedIds && !selectedIds.has(c.instanceId)) return false;
    const def = getCardDefinitionById(c.definitionId);
    if (!def) return false;
    if (!filter) return true;
    return matchesCardFilter(c, def, filter, {
      state,
      ...(sourceDef ? { sourceDefinition: sourceDef } : {}),
      soulStateIds,
      underCardIds: collectUnderCardScopeIds(state),
      additionalCosts: getAdditionalCosts(state, c.instanceId),
      effectiveColors: getEffectiveColors(state, c, def),
      effectiveBp: getCombinedUnitBp(state, c, def, getCardDefinitionById),
      coreCount: getTotalCoresOnCardById(state, c.instanceId),
      effectiveLevel: getEffectiveLevel(state, c, def, getCardDefinitionById),
      effectiveSymbolCount: getCombinedUnitSymbolCount(
        state,
        c,
        def,
        getCardDefinitionById
      ),
    });
  });
  const candidate = candidates[0];

  if (!candidate) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:soul_state:${actingPlayerId}:no-targets`,
      ],
    };
  }

  const def = getCardDefinitionById(candidate.definitionId)!;
  const minCores = getMinimumRequiredCoresFromDefinition(def);
  const policy = getEnterFieldCorePlacementPolicy({
    card: { ...candidate, minimumRequiredCores: minCores },
    definition: def,
  });
  const zoneRoleName: "spirit" | "ultimate" | "nexus" | "brave" =
    def.printedCategory === "ultimate"
      ? "ultimate"
      : def.printedCategory === "nexus"
        ? "nexus"
        : def.printedCategory === "brave"
          ? "brave"
          : "spirit";

  const soulStateMagicCompatibleAttachedIds =
    expandWithMagicCompatibleAttachedBraves(
      state,
      [candidate.instanceId],
      getCardDefinitionById
    ).filter((id) => id !== candidate.instanceId);
  const soulStateCostDefinition = createMagicCompatibleSoulStateCostDefinition(
    state,
    def,
    soulStateMagicCompatibleAttachedIds,
    getCardDefinitionById
  );

  const costToPay = resolveCostModifierSummonCost(
    state,
    actingPlayerId,
    soulStateCostDefinition,
    costModifier,
    getCardDefinitionById,
    candidate.instanceId,
    summonCause
  );

  const paymentChoice = resolveEffectSummonPaymentChoice({
    state,
    actingPlayerId,
    sourceInstanceId,
    targetInstanceId: candidate.instanceId,
    definition: soulStateCostDefinition,
    amount: costToPay,
    getCardDefinitionById,
    paymentSources: summonPaymentSources,
    excludedInstanceIds: new Set([candidate.instanceId]),
    onBoardCoreSourceFilter,
    summonCause,
  });
  if (paymentChoice.kind === "pending") return paymentChoice.state;
  const autoPaymentSources =
    paymentChoice.kind === "ready" ? paymentChoice.paymentSources : null;

  if (summonPaymentSources !== undefined) {
    assertMatchingPaymentAmount(
      {
        printedCost: costToPay,
        reducedCost: costToPay,
        additionalCost: 0,
        totalReduction: 0,
        satisfiedReductionSymbolCount: 0,
        requiredReductionSymbolCount: 0,
        finalCost: costToPay,
        reductionBreakdown: [],
        fieldSymbolSources: [],
        additionalCostModifiers: [],
      },
      summonPaymentSources
    );
    assertSummonPaymentSourcesAvailable(
      state,
      actingPlayerId,
      soulStateCostDefinition,
      summonPaymentSources,
      getCardDefinitionById,
      candidate.instanceId,
      new Set([candidate.instanceId]),
      onBoardCoreSourceFilter
    );
  } else if (autoPaymentSources === null) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:soul_state:${actingPlayerId}:insufficient-cost:required=${costToPay}`,
      ],
    };
  }

  const placements = summonEnterFieldCorePlacements;
  const coresForCost = costToPay;
  const coresForField =
    placements === undefined ? 0 : getPlacedCoreCount(placements);
  if (placements === undefined && policy.minimumCoreCount > 0) {
    const effectivePaymentSources = summonPaymentSources ?? autoPaymentSources;
    const placementAvailabilityState =
      effectivePaymentSources !== undefined &&
      effectivePaymentSources !== null &&
      coresForCost > 0
        ? applyCardCostPayments({
            state,
            actingPlayerId,
            chainId: `summon:soul_state:${candidate.instanceId}:availability`,
            paymentSources: effectivePaymentSources,
            getCardDefinitionById,
            ...(onBoardCoreSourceFilter !== undefined
              ? { onBoardCoreSourceFilter }
              : {}),
          })
        : state;
    if (
      countEnterFieldCoreSources({
        state: placementAvailabilityState,
        actingPlayerId,
        getCardDefinitionById,
        excludedFieldSourceIds: new Set([candidate.instanceId]),
      }) <
      getEntryMinimumCoreCount(
        placementAvailabilityState,
        {
          instanceId: candidate.instanceId,
          definitionId: candidate.definitionId,
          minimumCoreCount: policy.minimumCoreCount,
          maximumCoreCount: policy.maximumCoreCount,
          enterFieldEventKind: "summon",
        },
        getCardDefinitionById
      )
    ) {
      return {
        ...state,
        log: [
          ...state.log,
          `effect:summon:soul_state:${actingPlayerId}:insufficient-enter-cores:required=${policy.minimumCoreCount}`,
        ],
      };
    }
  }

  try {
    if (placements !== undefined) {
      assertEnterFieldCorePlacementsAllowed(policy, placements);
      if (getPlacedCoreCount(placements) < policy.minimumCoreCount) {
        return {
          ...state,
          log: [
            ...state.log,
            `effect:summon:soul_state:${actingPlayerId}:insufficient-enter-cores:required=${policy.minimumCoreCount}:selected=${getPlacedCoreCount(placements)}`,
          ],
        };
      }
    }

    // 1. 魂状態 → 通常スピリット昇格 (soulStateInstanceIds から除去, ロール/必要コア設定)。
    const soulStateIdsToRemove = new Set([
      candidate.instanceId,
      ...soulStateMagicCompatibleAttachedIds,
    ]);

    let nextState: GameState = replaceCardInstances(
      {
        ...state,
        log: [
          ...state.log,
          `effect:summon:${candidate.instanceId}:self:soul_state:cost=${coresForCost}:cores=${coresForField}`,
        ],
        players: state.players.map((p) =>
          p.id === actingPlayerId
            ? {
                ...p,
                soulStateInstanceIds: p.soulStateInstanceIds.filter(
                  (id) => !soulStateIdsToRemove.has(id)
                ),
              }
            : p
        ),
      },
      state.cardInstances.map((c) =>
        c.instanceId === candidate.instanceId
          ? {
              ...c,
              zoneRoleName,
              normalCoreCount: 0,
              minimumRequiredCores: minCores,
              exhaustState: "recovered" as const,
            }
          : c
      )
    );

    nextState = recordBraveFieldEntry(
      nextState,
      def,
      candidate.instanceId,
      "summon",
      candidate.zone
    );
    // 2. コスト支払い: 通常召喚と同じ CardCostPaymentSource を優先し、
    // 未指定時も reserve / フィールド上カード混在の自動支払いへ落とす。
    if (coresForCost > 0) {
      const effectivePaymentSources =
        summonPaymentSources ?? autoPaymentSources;
      if (
        effectivePaymentSources !== undefined &&
        effectivePaymentSources !== null
      ) {
        nextState = applyCardCostPayments({
          state: nextState,
          actingPlayerId,
          chainId: chainId,
          paymentSources: effectivePaymentSources,
          getCardDefinitionById,
          ...(onBoardCoreSourceFilter !== undefined
            ? { onBoardCoreSourceFilter }
            : {}),
        });
      } else {
        nextState = moveNormalCores(
          nextState,
          { kind: "reserve", playerId: actingPlayerId },
          { kind: "trash", playerId: actingPlayerId },
          coresForCost
        );
      }
    }

    // 3. フィールド初期コア配置。未指定時は通常の効果召喚と同じ pendingMultiPlacement
    // で後段 GUI/AI に reserve/field/soul core の配置選択を渡す。
    if (placements === undefined) {
      const maxCores =
        policy.maximumCoreCount === null ? Infinity : policy.maximumCoreCount;
      if (maxCores === 0) {
        return nextState;
      }
      return queueEnterFieldCorePlacement({
        state: {
          ...nextState,
          log: [
            ...nextState.log,
            `effect:summon:${candidate.instanceId}:self:soul_state:pending-placement`,
          ],
        },
        beforeState: rollbackStateForPendingPlacement ?? state,
        instanceId: candidate.instanceId,
        getCardDefinitionById,
        eventKind: "summon",
      });
    }

    if (placements.length > 0) {
      nextState = applyEnterFieldCorePlacements({
        state: nextState,
        actingPlayerId,
        destinationInstanceId: candidate.instanceId,
        placements,
        getCardDefinitionById,
      });
    }

    return nextState;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:soul_state:${actingPlayerId}:placement-failed:${reason}`,
      ],
    };
  }
}

/**
 * トークン（別デッキ）からのスピリット出現 primitive (engine-token-summon-primitive)。
 *
 * `from_zone` (hand/set_aside/trash) はいずれも「既に GameState 上に実在する
 * CardInstance」を前提とした候補選定だが、トークンカードはデッキに入れられず
 * (`CardDefinition.maxTokenDeckCount` で表現)、召喚されるまで GameState 上に一切
 * 存在しない。本関数は発動元カードの `relatedTokenCardNos[0]` が指す
 * トークンカード定義から `createCardInstance` で新規 instance を直接生成し、
 * フィールドへ配置する（`executeSoulStateSummon` と同様、`from_zone` 探索から
 * 独立した専用実行経路）。
 *
 * 利用可能枚数は `maxTokenDeckCount` から、既にフィールドに出ている自分の同定義
 * カード枚数を差し引いた残数で頭打ちにする（トークンごとの発行上限）。
 *
 * フィールド進入時コア配置は、`voidCoreMaxPerCard` 指定時は
 * `pendingMultiPlacement` へ合流し、対象ごとの `voidNormalCoreMax` として
 * reserve/field/void のプレイヤー入力で解決する。`trashCoreMax` と
 * `voidCoreMaxPerCard` の同時指定は
 * DSL 未対応として fail-closed にする。
 */
/**
 * `from_token_pool` 召喚で実際に選べる最大数（`maxTokenDeckCount` からフィールド上の
 * 自分所有同定義カード枚数を差し引いた残数）を解決する。`executeTokenSummon` と
 * `executeSplitSummonChoice`（ENGINE-sequential-slot-choice、BSSL01-X01[5,6]）で共有する
 * SSOT。トークン定義が無ければ 0。
 */
export function getAvailableTokenSummonCount(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const tokenCardNo = sourceDef?.relatedTokenCardNos?.[0];
  const tokenDef = tokenCardNo ? getCardDefinitionById(tokenCardNo) : undefined;
  if (!tokenDef) return 0;
  return getAvailableTokenSummonCountForDef(state, actingPlayerId, tokenDef);
}

/**
 * 特定のトークン定義 1 件について、実際に出せる残数
 * (`maxTokenDeckCount` からフィールド上の自分所有同定義カード枚数を差し引いた残数)
 * を解決する。`getAvailableTokenSummonCount`（`relatedTokenCardNos[0]` 固定）と
 * `executeAllRelatedTokensSummon`（複数トークン定義を1体ずつ、engine-multi-token-pool-summon）
 * で共有する下位 SSOT。
 */
export function getAvailableTokenSummonCountForDef(
  state: GameState,
  actingPlayerId: string,
  tokenDef: CardDefinition
): number {
  const inPlayCount = state.cardInstances.filter(
    (c) =>
      c.definitionId === tokenDef.cardNo &&
      c.ownerPlayerId === actingPlayerId &&
      c.zone === "field"
  ).length;
  return Math.max(
    0,
    (tokenDef.maxTokenDeckCount ?? Number.POSITIVE_INFINITY) - inPlayCount
  );
}

/**
 * 複数トークン定義を1体ずつ出す primitive (engine-multi-token-pool-summon、
 * `SummonAction.target.kind==="from_token_pool"` の `allRelatedTokens:true` 経路)。
 *
 * 発動元カードの `relatedTokenCardNos` 全エントリを順に走査し、まだフィールドに
 * いない (`maxTokenDeckCount` 残数 > 0) 定義それぞれについて `createCardInstance`
 * で新規 instance を1体生成する ("〜1体ずつ[まで]を出す" 型、BSLH01-C12[3]/
 * BSLH01-X02[8])。「出す」はコストを支払わない配置のため印字コストは課さない
 * (courseModifier 相当を持たず常に無償) — 呼び出し元が別途コストを要求する場合は
 * `pay_cost` ステップを前段に置く (BSLH01-C12「2コスト支払うことで」)。
 *
 * フィールド進入時コアは共通の配置ポリシーを使い、対象をまとめて
 * pendingMultiPlacement に渡す。配置先・数量・通常／ソウルは所有者がHUDで選ぶ。
 *
 * 1体も出せなかった場合は state を一切変更せず (cardInstances 不変)、対象カードが
 * 増えないことをそのまま呼び出し元の `connector:"conditional_cost"` 判定
 * (「△△できないとき○○もできない」) に伝播させる。
 */
export function executeAllRelatedTokensSummon(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceEffectIndex?: number
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const tokenCardNos = sourceDef?.relatedTokenCardNos ?? [];
  if (tokenCardNos.length === 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:token:all:${actingPlayerId}:no-token-definitions`,
      ],
    };
  }

  let nextState: GameState = state;
  const targets: PendingMultiPlacementTarget[] = [];

  for (const tokenCardNo of tokenCardNos) {
    const tokenDef = getCardDefinitionById(tokenCardNo);
    if (!tokenDef) continue;
    const available = getAvailableTokenSummonCountForDef(
      nextState,
      actingPlayerId,
      tokenDef
    );
    if (available <= 0) {
      nextState = {
        ...nextState,
        log: [
          ...nextState.log,
          `effect:summon:token:all:${actingPlayerId}:${tokenDef.cardNo}:no-available-tokens`,
        ],
      };
      continue;
    }

    const minCores = getMinimumRequiredCoresFromDefinition(tokenDef);
    const zoneRoleName = getDefaultZoneRoleName(tokenDef, "field");
    const newInstance = createCardInstance(tokenDef, {
      ownerPlayerId: actingPlayerId,
      controllerPlayerId: actingPlayerId,
      zone: "field",
      zoneRoleName,
      normalCoreCount: 0,
      minimumRequiredCores: minCores,
      exhaustState: "recovered",
    });

    const policy = getEnterFieldCorePlacementPolicy({
      card: newInstance,
      definition: tokenDef,
    });
    if (
      countEnterFieldCoreSources({
        state: nextState,
        actingPlayerId,
        getCardDefinitionById,
        excludedFieldSourceIds: new Set(
          targets.map((target) => target.instanceId)
        ),
      }) <
      policy.minimumCoreCount +
        targets.reduce((sum, target) => sum + target.minimumCoreCount, 0)
    )
      continue;

    nextState = replaceCardInstances(
      {
        ...nextState,
        log: [
          ...nextState.log,
          `effect:field_put:token_all:${actingPlayerId}:${newInstance.instanceId}:cost=0:pending-placement`,
        ],
      },
      [...nextState.cardInstances, newInstance]
    );

    nextState = recordBraveFieldEntry(
      nextState,
      tokenDef,
      newInstance.instanceId,
      "put",
      "token_pool"
    );
    targets.push({
      instanceId: newInstance.instanceId,
      definitionId: newInstance.definitionId,
      minimumCoreCount: policy.minimumCoreCount,
      maximumCoreCount: policy.maximumCoreCount,
      enterFieldEventKind: "put",
    });
  }

  const totalMaxCores = targets.reduce(
    (sum, target) =>
      sum +
      (target.maximumCoreCount === null
        ? Number.POSITIVE_INFINITY
        : target.maximumCoreCount),
    0
  );
  if (targets.length > 0 && totalMaxCores !== 0) {
    return {
      ...nextState,
      pendingMultiPlacement: {
        pendingId: nextPendingSelectionId("mp"),
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: sourceDef?.cardNo ?? "token-put",
        targets,
        effectTiming: { kind: "activated", mode: "main" },
        ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
        priorStateSnapshot: state,
      },
      log: [
        ...nextState.log,
        `effect:field_put:token_all:${actingPlayerId}:pending-placement:targets=${targets.length}`,
      ],
    };
  }

  return nextState;
}

function canSatisfyPendingPlacementMinimums(options: {
  state: GameState;
  actingPlayerId: string;
  requiredCores: number;
  trashNormalCapacity: number;
  trashGenericCapacity: number;
  voidNormalCapacity: number;
  excludedFieldSourceIds?: ReadonlySet<string>;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const player = options.state.players.find(
    (p) => p.id === options.actingPlayerId
  );
  if (!player) return false;
  return countEnterFieldCoreSources(options) >= options.requiredCores;
}

function hasUnsupportedTokenEnterCoreSourceMix(
  trashCoreMax: number | undefined,
  voidCoreMaxPerCard: number | undefined
): boolean {
  return (trashCoreMax ?? 0) > 0 && (voidCoreMaxPerCard ?? 0) > 0;
}

export function executeTokenSummon(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  requestedCount: number,
  costModifier: import("../dsl-types").CostModifier | undefined,
  trashCoreMax: number | undefined,
  trashCoreKind: "normal" | "generic" | undefined,
  voidCoreMaxPerCard: number | undefined,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  /**
   * BSKB01-C04「カウントエリアのコア1個を置いて出せる。このとき、追加でコアを置けない」。
   * true のとき、下記デフォルト分岐 (trashCoreMax/voidCoreMaxPerCard 未指定時) の
   * リザーブからの維持コア自動充当を止め、新規トークンは normalCoreCount:0 で入る。
   * 要求コア数の充足は呼び出し元の後続 core_move(from:count_area) step に委ねる。
   */
  disableAutoReserveFieldCores?: boolean,
  sourceEffectIndex?: number,
  summonPaymentSources?: readonly CardCostPaymentSource[],
  tokenSource?: CardInstance
): GameState {
  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) return state;

  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const tokenCardNo =
    tokenSource?.definitionId ?? sourceDef?.relatedTokenCardNos?.[0];
  const tokenDef = tokenCardNo ? getCardDefinitionById(tokenCardNo) : undefined;
  if (!tokenDef) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:token:${actingPlayerId}:no-token-definition`,
      ],
    };
  }
  if (hasUnsupportedTokenEnterCoreSourceMix(trashCoreMax, voidCoreMaxPerCard)) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:token:${actingPlayerId}:${tokenDef.cardNo}:unsupported-core-source-combination:trash+void`,
      ],
    };
  }

  const availableCount = tokenSource
    ? Math.min(
        1,
        getAvailableTokenSummonCountForDef(state, actingPlayerId, tokenDef)
      )
    : getAvailableTokenSummonCount(
        state,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById
      );
  const actualCount = Math.min(requestedCount, availableCount);
  if (actualCount <= 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:token:${actingPlayerId}:${tokenDef.cardNo}:no-available-tokens`,
      ],
    };
  }

  const costPerToken = resolveCostModifierSummonCost(
    state,
    actingPlayerId,
    tokenDef,
    costModifier,
    getCardDefinitionById
  );
  const totalCost = costPerToken * actualCount;
  const paymentChoice = resolveEffectSummonPaymentChoice({
    state,
    actingPlayerId,
    sourceInstanceId,
    targetInstanceId: sourceInstanceId,
    definition: tokenDef,
    amount: totalCost,
    getCardDefinitionById,
    paymentSources: summonPaymentSources,
    sourceEffectIndex,
  });
  if (paymentChoice.kind === "pending") return paymentChoice.state;
  if (paymentChoice.kind === "unavailable")
    return {
      ...state,
      log: [
        ...state.log,
        `effect:summon:token:${actingPlayerId}:${tokenDef.cardNo}:insufficient-cost:required=${totalCost}`,
      ],
    };
  assertSummonPaymentSourcesAvailable(
    state,
    actingPlayerId,
    tokenDef,
    paymentChoice.paymentSources,
    getCardDefinitionById
  );
  if (getTotalPaymentAmount(paymentChoice.paymentSources) !== totalCost)
    throw new Error("Token summon payment does not match required cost");
  const costPaidInitialState =
    totalCost > 0
      ? applyCardCostPayments({
          state,
          actingPlayerId,
          chainId,
          paymentSources: paymentChoice.paymentSources,
          getCardDefinitionById,
        })
      : state;

  const minCoresPerToken = getMinimumRequiredCoresFromDefinition(tokenDef);
  const zoneRoleName = getDefaultZoneRoleName(tokenDef, "field");
  if ((trashCoreMax ?? 0) > 0 || (voidCoreMaxPerCard ?? 0) > 0) {
    if (
      !canSatisfyPendingPlacementMinimums({
        state: costPaidInitialState,
        actingPlayerId,
        requiredCores: minCoresPerToken * actualCount,
        trashNormalCapacity:
          trashCoreKind === "generic" ? 0 : (trashCoreMax ?? 0),
        trashGenericCapacity:
          trashCoreKind === "generic" ? (trashCoreMax ?? 0) : 0,
        voidNormalCapacity: (voidCoreMaxPerCard ?? 0) * actualCount,
        getCardDefinitionById,
      })
    ) {
      return {
        ...state,
        log: [
          ...state.log,
          `effect:summon:token:${actingPlayerId}:${tokenDef.cardNo}:insufficient-enter-cores:required=${minCoresPerToken * actualCount}`,
        ],
      };
    }
    let nextState: GameState = tokenSource
      ? moveCardZone(
          costPaidInitialState,
          tokenSource.instanceId,
          "field",
          zoneRoleName
        )
      : costPaidInitialState;
    const targets: Array<{
      instanceId: string;
      definitionId: string;
      minimumCoreCount: number;
      maximumCoreCount: number | null;
      enterFieldEventKind?: "put";
      voidNormalCoreMax?: number;
    }> = [];

    for (let i = 0; i < actualCount; i++) {
      const currentPlayer = nextState.players.find(
        (p) => p.id === actingPlayerId
      );
      if (!currentPlayer) break;
      const newInstance = createCardInstance(tokenDef, {
        ...(tokenSource ? { instanceId: tokenSource.instanceId } : {}),
        ownerPlayerId: actingPlayerId,
        controllerPlayerId: actingPlayerId,
        zone: "field",
        zoneRoleName,
        normalCoreCount: 0,
        minimumRequiredCores: minCoresPerToken,
        exhaustState: "recovered",
      });

      nextState = replaceCardInstances(
        {
          ...nextState,
          log: [
            ...nextState.log,
            `effect:field_put:token:${actingPlayerId}:${newInstance.instanceId}:cost=${costPerToken}:pending-placement`,
          ],
        },
        [
          ...nextState.cardInstances.filter(
            (card) => card.instanceId !== tokenSource?.instanceId
          ),
          newInstance,
        ]
      );

      const policy = getEnterFieldCorePlacementPolicy({
        card: newInstance,
        definition: tokenDef,
      });
      nextState = recordBraveFieldEntry(
        nextState,
        tokenDef,
        newInstance.instanceId,
        "put",
        "token_pool"
      );
      targets.push({
        instanceId: newInstance.instanceId,
        definitionId: newInstance.definitionId,
        minimumCoreCount: policy.minimumCoreCount,
        maximumCoreCount: policy.maximumCoreCount,
        enterFieldEventKind: "put",
        ...(voidCoreMaxPerCard !== undefined && voidCoreMaxPerCard > 0
          ? { voidNormalCoreMax: voidCoreMaxPerCard }
          : {}),
      });
    }

    const totalMaxCores = targets.reduce(
      (sum, target) =>
        sum +
        (target.maximumCoreCount === null
          ? Number.POSITIVE_INFINITY
          : target.maximumCoreCount),
      0
    );
    if (totalMaxCores === 0) return nextState;

    return {
      ...nextState,
      pendingMultiPlacement: {
        pendingId: nextPendingSelectionId("mp"),
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: sourceDef?.cardNo ?? "token-summon",
        targets,
        ...(trashCoreMax !== undefined &&
        trashCoreMax > 0 &&
        trashCoreKind === "generic"
          ? { trashCoreMax }
          : {}),
        ...(trashCoreMax !== undefined &&
        trashCoreMax > 0 &&
        trashCoreKind !== "generic"
          ? { trashNormalCoreMax: trashCoreMax }
          : {}),
        effectTiming: { kind: "activated", mode: "main" },
        ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
        priorStateSnapshot: state,
      },
      log: [
        ...nextState.log,
        `effect:field_put:token:${actingPlayerId}:pending-placement:targets=${targets.length}`,
      ],
    };
  }
  // trashCoreMax はこの summon 実行全体で共有する予算（「トラッシュのコアも1個まで
  // 置ける」= 召喚した各トークンの合計であって、1体あたりの上限ではない。BSSL01-C06）。
  if (costModifier === "full_reduction") {
    if (
      !canSatisfyPendingPlacementMinimums({
        state: costPaidInitialState,
        actingPlayerId,
        requiredCores: minCoresPerToken * actualCount,
        trashNormalCapacity:
          trashCoreKind === "generic" ? 0 : (trashCoreMax ?? 0),
        trashGenericCapacity:
          trashCoreKind === "generic" ? (trashCoreMax ?? 0) : 0,
        voidNormalCapacity: (voidCoreMaxPerCard ?? 0) * actualCount,
        getCardDefinitionById,
      })
    ) {
      return {
        ...state,
        log: [
          ...state.log,
          `effect:summon:token:${actingPlayerId}:${tokenDef.cardNo}:insufficient-enter-cores:required=${minCoresPerToken * actualCount}`,
        ],
      };
    }

    let nextState: GameState = tokenSource
      ? moveCardZone(
          costPaidInitialState,
          tokenSource.instanceId,
          "field",
          zoneRoleName
        )
      : costPaidInitialState;
    const targets: PendingMultiPlacementTarget[] = [];

    for (let i = 0; i < actualCount; i++) {
      const newInstance = createCardInstance(tokenDef, {
        ...(tokenSource ? { instanceId: tokenSource.instanceId } : {}),
        ownerPlayerId: actingPlayerId,
        controllerPlayerId: actingPlayerId,
        zone: "field",
        zoneRoleName,
        normalCoreCount: 0,
        minimumRequiredCores: minCoresPerToken,
        exhaustState: "recovered",
      });

      nextState = replaceCardInstances(
        {
          ...nextState,
          log: [
            ...nextState.log,
            `effect:field_put:token:${actingPlayerId}:${newInstance.instanceId}:cost=${costPerToken}:pending-placement`,
          ],
        },
        [
          ...nextState.cardInstances.filter(
            (card) => card.instanceId !== tokenSource?.instanceId
          ),
          newInstance,
        ]
      );
      const policy = getEnterFieldCorePlacementPolicy({
        card: newInstance,
        definition: tokenDef,
      });
      nextState = recordBraveFieldEntry(
        nextState,
        tokenDef,
        newInstance.instanceId,
        "put",
        "token_pool"
      );
      targets.push({
        instanceId: newInstance.instanceId,
        definitionId: newInstance.definitionId,
        minimumCoreCount: policy.minimumCoreCount,
        maximumCoreCount: policy.maximumCoreCount,
        enterFieldEventKind: "put",
      });
    }

    const totalMaxCores = targets.reduce(
      (sum, target) =>
        sum +
        (target.maximumCoreCount === null
          ? Number.POSITIVE_INFINITY
          : target.maximumCoreCount),
      0
    );
    if (totalMaxCores === 0) return nextState;
    return {
      ...nextState,
      pendingMultiPlacement: {
        pendingId: nextPendingSelectionId("mp"),
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: sourceDef?.cardNo ?? "token-put",
        targets,
        ...(trashCoreMax !== undefined &&
        trashCoreMax > 0 &&
        trashCoreKind === "generic"
          ? { trashCoreMax }
          : {}),
        ...(trashCoreMax !== undefined &&
        trashCoreMax > 0 &&
        trashCoreKind !== "generic"
          ? { trashNormalCoreMax: trashCoreMax }
          : {}),
        effectTiming: { kind: "activated", mode: "main" },
        ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
        priorStateSnapshot: state,
      },
      log: [
        ...nextState.log,
        `effect:field_put:token:${actingPlayerId}:pending-placement:targets=${targets.length}`,
      ],
    };
  }

  const remainingTrashBudget = trashCoreMax ?? 0;
  let nextState: GameState = tokenSource
    ? moveCardZone(
        costPaidInitialState,
        tokenSource.instanceId,
        "field",
        zoneRoleName
      )
    : costPaidInitialState;
  const defaultTargets: PendingMultiPlacementTarget[] = [];

  for (let i = 0; i < actualCount; i++) {
    const currentPlayer = nextState.players.find(
      (p) => p.id === actingPlayerId
    );
    if (!currentPlayer) break;
    const forCost = costPerToken;

    const newInstance = createCardInstance(tokenDef, {
      ...(tokenSource ? { instanceId: tokenSource.instanceId } : {}),
      ownerPlayerId: actingPlayerId,
      controllerPlayerId: actingPlayerId,
      zone: "field",
      zoneRoleName,
      normalCoreCount: 0,
      minimumRequiredCores: minCoresPerToken,
      exhaustState: "recovered",
    });

    const policy = getEnterFieldCorePlacementPolicy({
      card: newInstance,
      definition: tokenDef,
    });
    if (
      disableAutoReserveFieldCores !== true &&
      countEnterFieldCoreSources({
        state: nextState,
        actingPlayerId,
        getCardDefinitionById,
        excludedFieldSourceIds: new Set(
          defaultTargets.map((target) => target.instanceId)
        ),
      }) <
        policy.minimumCoreCount +
          defaultTargets.reduce(
            (sum, target) => sum + target.minimumCoreCount,
            0
          )
    )
      break;

    nextState = replaceCardInstances(
      {
        ...nextState,
        log: [
          ...nextState.log,
          `effect:field_put:token:${actingPlayerId}:${newInstance.instanceId}:cost=${forCost}:pending-placement`,
        ],
      },
      [
        ...nextState.cardInstances.filter(
          (card) => card.instanceId !== tokenSource?.instanceId
        ),
        newInstance,
      ]
    );

    nextState = recordBraveFieldEntry(
      nextState,
      tokenDef,
      newInstance.instanceId,
      "put",
      "token_pool"
    );
    if (disableAutoReserveFieldCores !== true) {
      defaultTargets.push({
        instanceId: newInstance.instanceId,
        definitionId: newInstance.definitionId,
        minimumCoreCount: policy.minimumCoreCount,
        maximumCoreCount: policy.maximumCoreCount,
        enterFieldEventKind: "put",
      });
    }
  }

  const totalDefaultMaxCores = defaultTargets.reduce(
    (sum, target) =>
      sum +
      (target.maximumCoreCount === null
        ? Number.POSITIVE_INFINITY
        : target.maximumCoreCount),
    0
  );
  if (defaultTargets.length > 0 && totalDefaultMaxCores !== 0) {
    return {
      ...nextState,
      pendingMultiPlacement: {
        pendingId: nextPendingSelectionId("mp"),
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: sourceDef?.cardNo ?? "token-put",
        targets: defaultTargets,
        ...(remainingTrashBudget > 0
          ? { trashNormalCoreMax: remainingTrashBudget }
          : {}),
        effectTiming: { kind: "activated", mode: "main" },
        ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
        priorStateSnapshot: state,
      },
      log: [
        ...nextState.log,
        `effect:field_put:token:${actingPlayerId}:pending-placement:targets=${defaultTargets.length}`,
      ],
    };
  }

  return nextState;
}

/**
 * DSL `SummonAction`（from_zone target）の `zone: Zone | Zone[]` を native の
 * flat zoneStr へ正規化する。`resolveSummonFromZoneCandidates` / `executeSummonOther` /
 * `executeSplitSummonChoice` で共有する SSOT。
 */
function normalizeSummonFromZoneZoneStr(
  zone: import("../model").Zone | readonly import("../model").Zone[]
): SummonAction["zone"] & string {
  return normalizeSummonFromZoneZone(zone) as SummonAction["zone"] & string;
}

/**
 * DSL `CardFilter` を native `SummonAction["filter"]`（同じく `CardFilter`）へ渡す。
 * `executeSplitSummonChoice` / `executeSplitSummonChoiceZoneBranch` で共有する SSOT
 * (native-action-registry.ts の summon from_zone v1Action 変換と同型)。
 *
 * かつて category/colors/tribes/maxCost の4フィールドだけを列挙コピーしていたが、
 * 候補列挙は `matchesCardFilter` (SSOT) に丸ごと流すため、列挙から漏れた
 * `tribesLogic` / `tribesRequired` 等が黙って落ちる構造だった。全フィールドを渡す。
 */
function pickSummonZoneFilterFields(
  filter: import("../dsl-types").CardFilter | undefined
): SummonAction["filter"] | undefined {
  if (!filter) return undefined;
  return { ...filter };
}

/**
 * `DSL.SplitFieldEntryChoiceAction["zoneAction"]` から native `SummonAction`（target:"other"）を
 * 構築する。`executeSplitSummonChoice`（候補列挙）と `executeSplitSummonChoiceZoneBranch`
 * （実召喚）で共有する SSOT。
 */
function buildSplitSummonZoneNativeAction(
  zoneAction: NonNullable<
    import("../dsl-types").DSL.SplitFieldEntryChoiceAction["zoneAction"]
  >,
  count: number,
  summonCause?: "effect" | "burst"
): SummonAction {
  const zoneTarget = zoneAction.target;
  const costMod = zoneAction.costModifier;
  const filter = pickSummonZoneFilterFields(zoneTarget.filter);
  return {
    kind: "summon",
    target: "other",
    ...(summonCause !== undefined ? { summonCause } : {}),
    zone: normalizeSummonFromZoneZoneStr(zoneTarget.zone),
    count,
    ...(filter ? { filter } : {}),
    ...(costMod === "free" ? { withoutCost: true } : {}),
    ...(typeof costMod === "object" && "override" in costMod
      ? { overrideCost: costMod.override }
      : {}),
    ...(typeof costMod === "object" && "fixedPayment" in costMod
      ? { fixedPayment: costMod.fixedPayment }
      : {}),
    ...(costMod === "full_reduction" ? { fullReduction: true } : {}),
    ...(zoneAction.trashCoreMax !== undefined
      ? { trashCoreMax: zoneAction.trashCoreMax }
      : {}),
    ...(zoneAction.trashCoreKind !== undefined
      ? { trashCoreKind: zoneAction.trashCoreKind }
      : {}),
    ...(zoneTarget.includeAdventSource ? { includeAdventSource: true } : {}),
  };
}

/**
 * `split_field_entry_choice` action: 合計 `totalCount` 体まで、トークンを出す(from_token_pool) か
 * ゾーンからの通常召喚(from_zone) かを対象ごとに独立して選べる分配 pending を生成する
 * (ENGINE-sequential-slot-choice、BSSL01-X01[5,6])。等価性の説明は
 * `DSL.SplitFieldEntryChoiceAction` の docstring 参照。解決 (apply) は
 * `applyPendingSplitSummonChoiceAction` (pending-action-handlers.ts) が担う。
 * ここでは pending の生成のみ（継続情報は effect-interpreter.ts が事後付与、
 * `PendingCoreSplitSelection` と同型パターン）。
 */
export function executeSplitSummonChoice(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.SplitFieldEntryChoiceAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: import("../step-execution-context").StepExecutionContext,
  effectTiming: EffectTiming,
  summonCause?: "effect" | "burst"
): GameState {
  const totalCount = resolveCountToNumber(
    action.totalCount,
    state,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
  if (totalCount <= 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:split_summon_choice:${sourceInstanceId}:zero-total`,
      ],
    };
  }
  if (
    hasUnsupportedTokenEnterCoreSourceMix(
      action.tokenAction.trashCoreMax,
      action.tokenAction.voidCoreMaxPerCard
    )
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:split_summon_choice:${sourceInstanceId}:unsupported-token-core-source-combination:trash+void`,
      ],
    };
  }

  const maxTokenCount = getAvailableTokenSummonCount(
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById
  );

  const zoneCandidates =
    action.zoneAction !== undefined
      ? (() => {
          const zoneTarget = action.zoneAction.target;
          const zoneStr = normalizeSummonFromZoneZoneStr(zoneTarget.zone);
          const zoneFilter = pickSummonZoneFilterFields(zoneTarget.filter);
          return resolveSummonFromZoneCandidates(
            state,
            actingPlayerId,
            {
              zone: zoneStr,
              ...(zoneFilter ? { filter: zoneFilter } : {}),
              ...(zoneTarget.includeAdventSource
                ? { includeAdventSource: true }
                : {}),
              ...(action.zoneAction.costModifier === "full_reduction"
                ? { fullReduction: true }
                : {}),
            },
            getCardDefinitionById
          );
        })()
      : [];

  if (maxTokenCount <= 0 && zoneCandidates.length === 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:split_summon_choice:${sourceInstanceId}:no-candidates`,
      ],
    };
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinitionId = sourceCard?.definitionId ?? "";

  return {
    ...state,
    pendingSplitSummonChoice: {
      pendingId: nextPendingSelectionId("split-summon"),
      chainId,
      actingPlayerId,
      sourceInstanceId,
      sourceDefinitionId,
      totalCount,
      tokenAction: action.tokenAction,
      maxTokenCount,
      zoneAction: action.zoneAction,
      zoneCandidateInstanceIds: zoneCandidates.map((c) => c.instanceId),
      ...(summonCause !== undefined ? { summonCause } : {}),
      effectTiming,
    },
    log: [
      ...state.log,
      `effect:split_summon_choice:${sourceInstanceId}:pending:total=${totalCount}:maxToken=${maxTokenCount}:zoneCandidates=${zoneCandidates.length}`,
    ],
  };
}

/**
 * `PendingSplitSummonChoice` 解決のトークン側実行。`applyPendingSplitSummonChoiceAction`
 * (pending-action-handlers.ts) から呼ぶ。`tokenCount<=0` なら no-op。
 */
export function executeSplitSummonChoiceTokenBranch(
  state: GameState,
  pending: import("../model").PendingSplitSummonChoice,
  tokenCount: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  if (tokenCount <= 0) return state;
  return executeTokenSummon(
    state,
    pending.chainId,
    pending.actingPlayerId,
    tokenCount,
    pending.tokenAction.costModifier,
    pending.tokenAction.trashCoreMax,
    pending.tokenAction.trashCoreKind,
    pending.tokenAction.voidCoreMaxPerCard,
    pending.sourceInstanceId,
    getCardDefinitionById
  );
}

/**
 * `PendingSplitSummonChoice` 解決のゾーン側実行。`applyPendingSplitSummonChoiceAction`
 * (pending-action-handlers.ts) から呼ぶ。`zoneCardInstanceIds` が空なら no-op。
 */
export function executeSplitSummonChoiceZoneBranch(
  state: GameState,
  pending: import("../model").PendingSplitSummonChoice,
  zoneCardInstanceIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  if (zoneCardInstanceIds.length === 0) return state;
  if (pending.zoneAction === undefined) {
    throw new Error(
      `split summon choice ${pending.pendingId} has no zoneAction`
    );
  }
  const v1Action = buildSplitSummonZoneNativeAction(
    pending.zoneAction,
    zoneCardInstanceIds.length,
    pending.summonCause
  );
  return executeSummonOther(
    state,
    pending.chainId,
    pending.actingPlayerId,
    v1Action,
    pending.sourceInstanceId,
    getCardDefinitionById,
    undefined,
    undefined,
    zoneCardInstanceIds,
    pending.battleEndDeferralAttackId
  );
}

function resolveSummonCostForDefinition(
  state: GameState,
  actingPlayerId: string,
  definition: CardDefinition,
  costModifier: import("../dsl-types").CostModifier | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  summonCause?: "effect" | "burst"
): number {
  return resolveCostModifierSummonCost(
    state,
    actingPlayerId,
    definition,
    costModifier,
    getCardDefinitionById,
    sourceInstanceId,
    summonCause
  );
}

/**
 * `split_field_entry_choice` の選択結果を field=cores0 で確定し、維持コア配置だけを
 * `pendingMultiPlacement` に委ねる。token と zone を同一 pending に載せることで、
 * BSSL01-X01[5,6] の「対象ごとに token/通常召喚を選んだ後、それぞれ維持コアを置く」
 * 経路を通常召喚の EnterFieldCorePlacement と同じ UI/API へ合流させる。
 */
export function executeSplitSummonChoiceBranchesWithPlacementPending(
  state: GameState,
  pending: import("../model").PendingSplitSummonChoice,
  tokenCount: number,
  zoneCardInstanceIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  summonPaymentSources?: readonly CardCostPaymentSource[]
): GameState {
  let currentState = state;
  if (
    hasUnsupportedTokenEnterCoreSourceMix(
      pending.tokenAction.trashCoreMax,
      pending.tokenAction.voidCoreMaxPerCard
    )
  ) {
    throw new Error(
      `Unsupported split summon token core source combination: trash+void (${pending.pendingId})`
    );
  }
  const summonedIds: Array<{
    instanceId: string;
    definitionId: string;
    enterFieldEventKind?: EnterFieldEventKind;
    voidNormalCoreMax?: number;
  }> = [];

  const player = currentState.players.find(
    (p) => p.id === pending.actingPlayerId
  );
  if (!player) return currentState;

  const sourceCard = getCardById(currentState, pending.sourceInstanceId);
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const tokenCardNo = sourceDef?.relatedTokenCardNos?.[0];
  const tokenDef = tokenCardNo ? getCardDefinitionById(tokenCardNo) : undefined;
  const actualTokenCount = tokenDef
    ? Math.min(
        tokenCount,
        getAvailableTokenSummonCount(
          currentState,
          pending.actingPlayerId,
          pending.sourceInstanceId,
          getCardDefinitionById
        )
      )
    : 0;
  const tokenCost = tokenDef
    ? resolveSummonCostForDefinition(
        currentState,
        pending.actingPlayerId,
        tokenDef,
        pending.tokenAction.costModifier,
        getCardDefinitionById,
        undefined
      )
    : 0;
  if (zoneCardInstanceIds.length > 0 && pending.zoneAction === undefined) {
    throw new Error(
      `split summon choice ${pending.pendingId} cannot resolve zone cards without zoneAction`
    );
  }
  const zoneCosts = zoneCardInstanceIds.map((id) => {
    const card = getCardById(currentState, id);
    const def = card ? getCardDefinitionById(card.definitionId) : undefined;
    return def
      ? resolveSummonCostForDefinition(
          currentState,
          pending.actingPlayerId,
          def,
          pending.zoneAction?.costModifier,
          getCardDefinitionById,
          id,
          pending.summonCause
        )
      : 0;
  });
  const selectedZoneIds = new Set(zoneCardInstanceIds);
  const totalCost =
    tokenCost * actualTokenCount +
    zoneCosts.reduce((sum, cost) => sum + cost, 0);
  const splitPaymentDefinition =
    tokenDef ??
    zoneCardInstanceIds
      .map((id) => getCardById(currentState, id))
      .map((card) =>
        card ? getCardDefinitionById(card.definitionId) : undefined
      )
      .find((def): def is CardDefinition => def !== undefined);
  const paymentChoice = splitPaymentDefinition
    ? resolveEffectSummonPaymentChoice({
        state: currentState,
        actingPlayerId: pending.actingPlayerId,
        sourceInstanceId: pending.sourceInstanceId,
        targetInstanceId: zoneCardInstanceIds[0] ?? pending.sourceInstanceId,
        definition: splitPaymentDefinition,
        amount: totalCost,
        getCardDefinitionById,
        paymentSources: summonPaymentSources,
        excludedInstanceIds: selectedZoneIds,
        summonCause: pending.summonCause,
      })
    : totalCost === 0
      ? { kind: "ready" as const, paymentSources: [] }
      : { kind: "unavailable" as const };
  if (paymentChoice.kind === "pending")
    return {
      ...paymentChoice.state,
      pendingEffectSummonCostPayment: {
        ...paymentChoice.state.pendingEffectSummonCostPayment!,
        splitSummonChoice: {
          pending,
          tokenCount,
          zoneCardInstanceIds: [...zoneCardInstanceIds],
        },
      },
    };
  if (paymentChoice.kind === "unavailable")
    throw new Error(
      `Not enough cores for split summon cost: required=${totalCost}`
    );
  if (getTotalPaymentAmount(paymentChoice.paymentSources) !== totalCost)
    throw new Error("Split summon payment does not match required cost");
  if (splitPaymentDefinition)
    assertSummonPaymentSourcesAvailable(
      currentState,
      pending.actingPlayerId,
      splitPaymentDefinition,
      paymentChoice.paymentSources,
      getCardDefinitionById,
      undefined,
      selectedZoneIds
    );
  const costPaidInitialState =
    totalCost > 0
      ? applyCardCostPayments({
          state: currentState,
          actingPlayerId: pending.actingPlayerId,
          chainId: pending.chainId,
          paymentSources: paymentChoice.paymentSources,
          getCardDefinitionById,
        })
      : currentState;

  const tokenMinimumCores =
    tokenDef !== undefined
      ? getMinimumRequiredCoresFromDefinition(tokenDef) * actualTokenCount
      : 0;
  const zoneMinimumCores = zoneCardInstanceIds.reduce((sum, id) => {
    const card = getCardById(currentState, id);
    const def = card ? getCardDefinitionById(card.definitionId) : undefined;
    return sum + (def ? getMinimumRequiredCoresFromDefinition(def) : 0);
  }, 0);
  if (
    !canSatisfyPendingPlacementMinimums({
      state: costPaidInitialState,
      actingPlayerId: pending.actingPlayerId,
      requiredCores: tokenMinimumCores + zoneMinimumCores,
      trashNormalCapacity:
        pending.tokenAction.trashCoreKind === "generic"
          ? 0
          : (pending.tokenAction.trashCoreMax ?? 0),
      trashGenericCapacity:
        pending.tokenAction.trashCoreKind === "generic"
          ? (pending.tokenAction.trashCoreMax ?? 0)
          : 0,
      voidNormalCapacity:
        (pending.tokenAction.voidCoreMaxPerCard ?? 0) * actualTokenCount,
      excludedFieldSourceIds: selectedZoneIds,
      getCardDefinitionById,
    })
  ) {
    throw new Error(
      `Not enough enter-field cores for split summon choice: required=${tokenMinimumCores + zoneMinimumCores}`
    );
  }

  currentState = costPaidInitialState;

  if (tokenDef) {
    const zoneRoleName = getDefaultZoneRoleName(tokenDef, "field");
    const minCores = getMinimumRequiredCoresFromDefinition(tokenDef);
    for (let i = 0; i < actualTokenCount; i++) {
      const newInstance = createCardInstance(tokenDef, {
        ownerPlayerId: pending.actingPlayerId,
        controllerPlayerId: pending.actingPlayerId,
        zone: "field",
        zoneRoleName,
        normalCoreCount: 0,
        minimumRequiredCores: minCores,
        exhaustState: "recovered",
      });
      currentState = replaceCardInstances(
        {
          ...currentState,
          log: [
            ...currentState.log,
            `effect:field_put:token:${pending.actingPlayerId}:${newInstance.instanceId}:cost=${tokenCost}:pending-placement`,
          ],
        },
        [...currentState.cardInstances, newInstance]
      );
      currentState = recordBraveFieldEntry(
        currentState,
        tokenDef,
        newInstance.instanceId,
        "put",
        "token_pool"
      );
      summonedIds.push({
        instanceId: newInstance.instanceId,
        definitionId: newInstance.definitionId,
        enterFieldEventKind: "put",
        ...(pending.tokenAction.voidCoreMaxPerCard !== undefined
          ? { voidNormalCoreMax: pending.tokenAction.voidCoreMaxPerCard }
          : {}),
      });
    }
  }

  for (const [index, id] of zoneCardInstanceIds.entries()) {
    const card = getCardById(currentState, id);
    const def = card ? getCardDefinitionById(card.definitionId) : undefined;
    if (!card || !def) continue;
    const zoneRoleName = getDefaultZoneRoleName(def, "field");
    const minCores = getMinimumRequiredCoresFromDefinition(def);
    currentState = moveCardZone(currentState, id, "field", zoneRoleName);
    currentState = replaceCardInstances(
      {
        ...currentState,
        log: [
          ...currentState.log,
          `effect:summon:${id}:other:from=${card.zone}:cost=${zoneCosts[index] ?? 0}:pending-placement`,
        ],
      },
      stripAdventSourceUnderCardReference(
        currentState.cardInstances.map((c) =>
          c.instanceId === id
            ? {
                ...c,
                zone: "field" as const,
                zoneRoleName,
                normalCoreCount: 0,
                minimumRequiredCores: minCores,
                exhaustState: "recovered" as const,
                attachedToInstanceId: null,
                attachedChildrenIds: [],
              }
            : c
        ),
        id
      )
    );

    currentState = recordBraveFieldEntry(
      currentState,
      def,
      id,
      getDefaultEnterFieldEventKindForDefinition(def),
      card.zone
    );
    summonedIds.push({
      instanceId: id,
      definitionId: def.cardNo,
      enterFieldEventKind: getDefaultEnterFieldEventKindForDefinition(def),
    });
  }

  if (summonedIds.length === 0) return currentState;
  const targets = summonedIds
    .map((summoned) => {
      const card = getCardById(currentState, summoned.instanceId);
      const def = card ? getCardDefinitionById(card.definitionId) : undefined;
      if (!card || !def) return null;
      const policy = getEnterFieldCorePlacementPolicy({
        card,
        definition: def,
      });
      return {
        instanceId: summoned.instanceId,
        definitionId: summoned.definitionId,
        minimumCoreCount: policy.minimumCoreCount,
        maximumCoreCount: policy.maximumCoreCount,
        ...(summoned.enterFieldEventKind !== undefined
          ? { enterFieldEventKind: summoned.enterFieldEventKind }
          : {}),
        ...(summoned.voidNormalCoreMax !== undefined
          ? { voidNormalCoreMax: summoned.voidNormalCoreMax }
          : {}),
      };
    })
    .filter((target): target is NonNullable<typeof target> => target !== null);
  const totalMaxCores = targets.reduce(
    (sum, target) =>
      sum +
      (target.maximumCoreCount === null
        ? Number.POSITIVE_INFINITY
        : target.maximumCoreCount),
    0
  );
  if (totalMaxCores === 0) return currentState;

  return {
    ...currentState,
    pendingMultiPlacement: {
      pendingId: nextPendingSelectionId("mp"),
      actingPlayerId: pending.actingPlayerId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      targets,
      ...(pending.battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId: pending.battleEndDeferralAttackId }
        : pending.continuation?.battleEndDeferralAttackId !== undefined
          ? {
              battleEndDeferralAttackId:
                pending.continuation.battleEndDeferralAttackId,
            }
          : {}),
      ...(pending.tokenAction.trashCoreMax !== undefined &&
      pending.tokenAction.trashCoreMax > 0 &&
      pending.tokenAction.trashCoreKind === "generic"
        ? { trashCoreMax: pending.tokenAction.trashCoreMax }
        : {}),
      ...(pending.tokenAction.trashCoreMax !== undefined &&
      pending.tokenAction.trashCoreMax > 0 &&
      pending.tokenAction.trashCoreKind !== "generic"
        ? { trashNormalCoreMax: pending.tokenAction.trashCoreMax }
        : {}),
      effectTiming: pending.effectTiming,
      ...(pending.continuation?.effectIndex !== undefined
        ? { sourceEffectIndex: pending.continuation.effectIndex }
        : {}),
      ...(pending.continuation ? { continuation: pending.continuation } : {}),
      priorStateSnapshot: state,
    },
    log: [
      ...currentState.log,
      `effect:split_summon_choice:${pending.pendingId}:pending-placement:targets=${targets.length}`,
    ],
  };
}
