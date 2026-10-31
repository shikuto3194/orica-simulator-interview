import { requireCardZone } from "../model";
import { getCardUseSourceZone } from "../card/card-lookup";
import {
  recordBraveFieldEntry,
  recordSemanticTriggerEvent,
} from "../effect/semantic-trigger-events";
import { replaceCardInstances } from "../zone/card-instance-state";
import { countEnterFieldCoreSources } from "../zone/enter-field-core-sources";
import { getCardById } from "../card/card-lookup";
import { hasCannotCombineRestriction } from "../mechanics/act-as-spirit";
import {
  calculateReduction,
  type AdditionalCostModifier,
  type ReductionResult,
} from "../core/cost-system";
import {
  applyEnterFieldCorePlacements,
  assertEnterFieldCorePlacementsAllowed,
  getPlacedCoreCount,
  type EnterFieldCorePlacement,
} from "../zone/enter-field-placement-execution";
import {
  getEnterFieldCorePlacementPolicy,
  type EnterFieldCorePlacementPolicy,
} from "../zone/enter-field-placement-policy";
import {
  runActionMainResolution,
  type EffectActionContext,
  type HandWrittenEffectResolver,
  type HandWrittenEffectResolverLookup,
} from "../effect/effect-resolution";
import { recomputeAndRebuildContinuousEffects } from "../effect/continuous-effect-rebuild";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import { getDefaultZoneRoleName } from "../factories";
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  EffectPreventionLevel,
  EffectUsageRecord,
  GameState,
  LifeCoreKind,
} from "../model";
import {
  shrinkProtectedCounts,
  stripAdventSourceUnderCardReference,
  withCount,
} from "../model";
import {
  applyCardCostPayments,
  assertMatchingPaymentAmount,
  assertPaymentSourcesAreAvailable,
  assertReserveOrOnBoardExclusivePaymentSources,
  getAvailableCardCostPaymentSources,
  type CardCostPaymentSource,
} from "../core/payment-system";
import {
  isSoulCoreOn,
  moveCardZone,
  moveNormalCores,
  moveSoulCore,
  updateCard,
} from "../core/core-system";
import {
  collectCostPaymentVanishTriggers,
  queueAfterCostPaidTriggers,
} from "../effect/trigger-system";
import {
  getPreventionBlockReason,
  getSummonTrashCorePlacementGrant,
  getTenshoTargetCandidates,
  getValidBraveCombineHosts,
} from "../legal/legal-actions-shared";
import { moveBraveCombineCoresToHost } from "../legal/brave-combine-state-helpers";
import {
  getEffectFilterBlockReason,
  runStateBasedActions,
  type EffectFilterTag,
} from "../state-based-actions";
import { expandWithSoulStateInheritingKeyBraves } from "../mechanics/magic-compatible-soul-state";
import {
  getPlayCardDefinitionOrThrow,
  getPlayCardInstanceOrThrow,
} from "./play-card-validation";

export interface PlayHandCardActionResult {
  state: GameState;
  chainId: string;
  reduction: ReductionResult;
}

export interface PlayCardWithoutPayingCostActionResult {
  state: GameState;
  chainId: string;
}

export interface PlayHandCardInStackContextResult {
  state: GameState;
  activeStack: ActiveStack;
  reduction: ReductionResult;
}

export interface PlayHandCardWithPlacementOptions {
  state: GameState;
  actingPlayerId: string;
  card: CardInstance;
  definition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: queueAfterCostPaidTriggers の listener 解決に使用 (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  actionKind: "summon" | "place_nexus";
  enterFieldCorePlacementPolicy: EnterFieldCorePlacementPolicy;
  targetInstanceIds?: readonly string[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  paymentSources: readonly CardCostPaymentSource[];
  fixedPaymentCost?: number;
  baseCostOverride?: number;
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter;
  /**
   * 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』(pendingSummonCostExcludeChoice)
   * 解決後に確定する追加コスト軽減。symbol 軽減 (totalReduction) とは独立に finalCost へ
   * 加算される (baseCostOverride と異なり printed cost 自体は書き換えない)。
   */
  additionalCostModifiers?: readonly AdditionalCostModifier[];
  /** summon/place permission 由来の play-card action で、原因効果 index を保持する。 */
  sourceEffectIndex?: number;
  enterFieldCorePlacements?: readonly EnterFieldCorePlacement[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  /**
   * 直接合体召喚専用: 場入りと同時にこのホストへ合体させる。
   * SBA (コア欠損消滅) が場入り解決中に走る前に attach させることで、
   * Lv1 未満のブレイヴがスピリット状態として消滅するのを防ぐ。
   */
  combineHostInstanceId?: string;
}

function assertFilteredOnBoardPaymentSourcesAllowed(
  options: PlayHandCardWithPlacementOptions
): void {
  if (options.onBoardCoreSourceFilter === undefined) return;
  const available = getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: options.definition,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId: options.card.instanceId,
    onBoardCoreSourceFilter: options.onBoardCoreSourceFilter,
    ...(options.baseCostOverride !== undefined
      ? { baseCostOverride: options.baseCostOverride }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
  });
  assertPaymentSourcesAreAvailable({
    paymentSources: options.paymentSources,
    availableReserveCoreAmount: available.reserveSource.availableCoreAmount,
    availableOnBoardCoreSources: available.onBoardCoreSources,
  });
  assertReserveOrOnBoardExclusivePaymentSources(options.paymentSources);
}

/**
 * コスト支払い後に転召対象を選べ、かつ対象の通常コアを全て転召で失った後でも
 * 維持コアを配置できるかを、実際に選択された支払い元で判定する。
 *
 * 召喚宣言時の候補列挙は「安全な支払い方が少なくとも一つある」ことを調べるだけで、
 * 支払い入力そのものはここまで届く。対象上のソウルコアを支払いに使うと、宣言時には
 * 残っていたソウルコアを維持コア配置へ二重計上できてしまうため、支払い後の状態を
 * 先にプレビューしてから受理する。
 */
export function canCompleteTenshoSummonAfterCostPayment(options: {
  state: GameState;
  actingPlayerId: string;
  definition: CardDefinition;
  paymentSources: readonly CardCostPaymentSource[];
  minimumEnterFieldCoreCount: number;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter;
  allowedTrashNormalCoreCount?: number;
}): boolean {
  const tensho = options.definition.tenshoSummon;
  if (
    !tensho ||
    options.minimumEnterFieldCoreCount <= 0 ||
    tensho.destination === "reserve"
  ) {
    return true;
  }

  const afterCostPayment = applyCardCostPayments({
    state: { ...options.state, log: [...options.state.log] },
    actingPlayerId: options.actingPlayerId,
    chainId: "tensho-payment-preview",
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
  });
  const player = afterCostPayment.players.find(
    (candidate) => candidate.id === options.actingPlayerId
  );
  if (!player) return false;

  return getTenshoTargetCandidates(
    afterCostPayment,
    options.actingPlayerId,
    tensho,
    options.getCardDefinitionById
  ).some((targetInstanceId) => {
    let placementCapacity = countEnterFieldCoreSources({
      state: afterCostPayment,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      excludedNormalFieldSourceIds: new Set([targetInstanceId]),
      trashNormalCapacity: options.allowedTrashNormalCoreCount ?? 0,
    });

    if (
      tensho.destination === "trash" &&
      options.allowedTrashNormalCoreCount !== undefined
    ) {
      const target = afterCostPayment.cardInstances.find(
        (card) => card.instanceId === targetInstanceId
      );
      placementCapacity += Math.min(
        target?.normalCoreCount ?? 0,
        Math.max(
          0,
          options.allowedTrashNormalCoreCount - player.trashNormalCoreCount
        )
      );
    }
    return placementCapacity >= options.minimumEnterFieldCoreCount;
  });
}

/**
 * 通常の手札召喚/配置について、選択済みのコスト支払い後にも維持コアを
 * 置けるかをプレビューする。
 *
 * 支払いによる移動先の違い・個別のコア移動制限を反映した実残数を使う。
 * 03f: 待機状態になったカードも、残存コアがあれば供給元に含める。
 */
export function canCompleteHandPlayAfterCostPayment(options: {
  state: GameState;
  actingPlayerId: string;
  card: CardInstance;
  definition: CardDefinition;
  paymentSources: readonly CardCostPaymentSource[];
  minimumEnterFieldCoreCount: number;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter;
  allowedTrashNormalCoreCount?: number;
}): boolean {
  const minimumCoreCount =
    options.definition.printedCategory === "brave"
      ? getEnterFieldCorePlacementPolicy(options).minimumCoreCount
      : options.minimumEnterFieldCoreCount;
  if (minimumCoreCount <= 0) return true;

  const afterCostPayment = applyCardCostPayments({
    state: { ...options.state, log: [...options.state.log] },
    actingPlayerId: options.actingPlayerId,
    chainId: "hand-play-payment-preview",
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
  });
  const player = afterCostPayment.players.find(
    (candidate) => candidate.id === options.actingPlayerId
  );
  if (!player) return false;

  // 合体先も支払い後の盤面で調べる。支払いで待機に入ったカードとは合体できない。
  if (
    options.definition.printedCategory === "brave" &&
    getValidBraveCombineHosts(
      afterCostPayment,
      options.definition,
      options.actingPlayerId,
      options.getCardDefinitionById,
      options.card.instanceId
    ).length > 0
  ) {
    return true;
  }

  return (
    countEnterFieldCoreSources({
      state: afterCostPayment,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      excludedFieldSourceIds: new Set([options.card.instanceId]),
      trashNormalCapacity: options.allowedTrashNormalCoreCount ?? 0,
    }) >= minimumCoreCount
  );
}

/**
 * payment-system が実際に移動する通常/ソウルコア内訳を、宣言時の state から
 * そのまま記録する。includeSoulCore が省略されても通常コア不足分でソウルコアを
 * 自動使用するため、入力値だけを rollback に保存してはならない。
 */
export function buildNormalHandPlayPaidCoreDelta(options: {
  state: GameState;
  actingPlayerId: string;
  paymentSources: readonly CardCostPaymentSource[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  onBoardCoreSourceFilter?: import("../dsl-types").CardFilter;
}): NonNullable<ActiveStack["normalHandPlayRollback"]> {
  let simulatedState = options.state;

  return {
    paidCores: options.paymentSources.map((paymentSource) => {
      const beforePlayer = simulatedState.players.find(
        (player) => player.id === options.actingPlayerId
      );
      const afterPayment = applyCardCostPayments({
        state: simulatedState,
        actingPlayerId: options.actingPlayerId,
        chainId: "hand-play-rollback-payment-preview",
        paymentSources: [paymentSource],
        getCardDefinitionById: options.getCardDefinitionById,
        ...(options.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
          : {}),
      });
      const afterPlayer = afterPayment.players.find(
        (player) => player.id === options.actingPlayerId
      );
      const beforePaymentCard =
        paymentSource.kind === "card"
          ? simulatedState.cardInstances.find(
              (card) => card.instanceId === paymentSource.instanceId
            )
          : undefined;
      const afterPaymentCard =
        paymentSource.kind === "card"
          ? afterPayment.cardInstances.find(
              (card) => card.instanceId === paymentSource.instanceId
            )
          : undefined;
      const normalCoreCount =
        paymentSource.kind === "reserve"
          ? Math.max(
              0,
              (beforePlayer?.reserveNormalCoreCount ?? 0) -
                (afterPlayer?.reserveNormalCoreCount ?? 0)
            )
          : Math.max(
              0,
              (beforePaymentCard?.normalCoreCount ?? 0) -
                (afterPaymentCard?.normalCoreCount ?? 0)
            );
      const soulCoreCount =
        paymentSource.kind === "reserve"
          ? Math.max(
              0,
              (beforePlayer?.reserveSoulCoreCount ?? 0) -
                (afterPlayer?.reserveSoulCoreCount ?? 0)
            )
          : Math.max(
              0,
              (beforePaymentCard?.soulCoreCount ?? 0) -
                (afterPaymentCard?.soulCoreCount ?? 0)
            );
      const normalDestination =
        (afterPlayer?.voidNormalCoreCount ?? 0) >
        (beforePlayer?.voidNormalCoreCount ?? 0)
          ? "void"
          : "trash";
      const soulDestination =
        (afterPlayer?.trashSoulCoreCount ?? 0) >
        (beforePlayer?.trashSoulCoreCount ?? 0)
          ? "trash"
          : null;
      simulatedState = afterPayment;

      return paymentSource.kind === "reserve"
        ? {
            kind: "reserve" as const,
            normalCoreCount,
            soulCoreCount,
            normalDestination,
            soulDestination,
          }
        : {
            kind: "card" as const,
            instanceId: paymentSource.instanceId,
            normalCoreCount,
            soulCoreCount,
            normalDestination,
            soulDestination,
          };
    }),
  };
}

type NormalHandPlayRollback = NonNullable<
  ActiveStack["normalHandPlayRollback"]
>;

function captureNormalPlaySource(
  options: PlayHandCardWithPlacementOptions
): Pick<
  NormalHandPlayRollback,
  "sourceZone" | "sourceCards" | "sourceUnderCards" | "sourceSoulStateEntries"
> {
  const wasSoulState = options.state.players.some((p) =>
    p.soulStateInstanceIds.includes(options.card.instanceId)
  );
  const sourceIds = new Set(
    wasSoulState
      ? expandWithSoulStateInheritingKeyBraves(
          options.state,
          [options.card.instanceId],
          options.getCardDefinitionById
        )
      : [options.card.instanceId]
  );
  return {
    sourceZone: options.card.zone,
    sourceCards: options.state.cardInstances
      .filter((c) => sourceIds.has(c.instanceId))
      .map((c) => ({
        instanceId: c.instanceId,
        zone: c.zone,
        zoneRoleName: c.zoneRoleName,
        zoneEnteredAtTurn: c.zoneEnteredAtTurn,
        ...(c.soulStateGeneration !== undefined
          ? { soulStateGeneration: c.soulStateGeneration }
          : {}),
        ...(c.fieldInstanceGeneration !== undefined
          ? { fieldInstanceGeneration: c.fieldInstanceGeneration }
          : {}),
      })),
    sourceUnderCards: options.state.cardInstances.flatMap((host) =>
      (host.underCards ?? []).flatMap((entry, index) =>
        entry.role === "advent_source" && sourceIds.has(entry.cardInstanceId)
          ? [{ hostInstanceId: host.instanceId, entry, index }]
          : []
      )
    ),
    sourceSoulStateEntries: options.state.players.flatMap((player) =>
      player.soulStateInstanceIds
        .filter((id) => sourceIds.has(id))
        .map((instanceId) => ({ playerId: player.id, instanceId }))
    ),
  };
}

/** 宣言による所属変更だけを戻す。応答で動いたホストやカードは復活させない。 */
function restoreNormalPlaySource(
  state: GameState,
  stack: ActiveStack,
  rollback: NormalHandPlayRollback,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  let currentState = state;
  const sources = rollback.sourceCards ?? [
    {
      instanceId: stack.cardInstanceId,
      zone: rollback.sourceZone ?? "hand",
    },
  ];
  const restoredIds = new Set<string>();
  for (const source of sources) {
    const card = getCardById(currentState, source.instanceId);
    if (card?.zone !== "in_use") continue;
    const underEntries =
      rollback.sourceUnderCards?.filter(
        (e) => e.entry.cardInstanceId === source.instanceId
      ) ?? [];
    const survivingEntries = underEntries.filter(
      (e) => getCardById(currentState, e.hostInstanceId)?.zone === "field"
    );
    const movedHost =
      underEntries.length > 0 && survivingEntries.length === 0
        ? getCardById(currentState, underEntries[0]!.hostInstanceId)
        : undefined;
    // 煌臨元はホストの離脱先へ随伴する。ホストへの参照を復元して場へ戻してはいけない。
    const followsMovedHost =
      underEntries.length > 0 && survivingEntries.length === 0;
    const zone = followsMovedHost ? (movedHost?.zone ?? "trash") : source.zone;
    const definition = getCardDefinitionById(card.definitionId);
    const role =
      followsMovedHost && definition
        ? getDefaultZoneRoleName(definition, zone)
        : "zoneRoleName" in source
          ? source.zoneRoleName
          : undefined;
    currentState = moveCardZone(
      currentState,
      source.instanceId,
      requireCardZone(zone),
      role
    );
    if ("zoneEnteredAtTurn" in source && !followsMovedHost) {
      currentState = updateCard(currentState, source.instanceId, (c) => ({
        ...c,
        zoneEnteredAtTurn: source.zoneEnteredAtTurn,
        ...("soulStateGeneration" in source ||
        c.soulStateGeneration !== undefined
          ? {
              soulStateGeneration:
                ("soulStateGeneration" in source
                  ? source.soulStateGeneration
                  : undefined) ?? 0,
            }
          : {}),
        ...("fieldInstanceGeneration" in source ||
        c.fieldInstanceGeneration !== undefined
          ? {
              fieldInstanceGeneration:
                ("fieldInstanceGeneration" in source
                  ? source.fieldInstanceGeneration
                  : undefined) ?? 0,
            }
          : {}),
      }));
    }
    if (zone === "deck") {
      currentState = {
        ...currentState,
        players: currentState.players.map((p) =>
          p.id === card.ownerPlayerId ? { ...p } : p
        ),
      };
      if (movedHost) {
        const cards = currentState.cardInstances.filter(
          (c) => c.instanceId !== source.instanceId
        );
        cards.splice(
          cards.findIndex((c) => c.instanceId === movedHost.instanceId),
          0,
          getCardById(currentState, source.instanceId)!
        );
        currentState = replaceCardInstances({ ...currentState }, cards);
      }
    }
    for (const entry of survivingEntries) {
      currentState = updateCard(currentState, entry.hostInstanceId, (host) => {
        const underCards = [...(host.underCards ?? [])];
        if (!underCards.some((e) => e.cardInstanceId === source.instanceId)) {
          underCards.splice(
            Math.min(entry.index, underCards.length),
            0,
            entry.entry
          );
        }
        return { ...host, underCards };
      });
    }
    restoredIds.add(source.instanceId);
  }
  return {
    ...currentState,
    players: currentState.players.map((player) => {
      const restoredSoulIds = (rollback.sourceSoulStateEntries ?? [])
        .filter(
          (e) =>
            e.playerId === player.id &&
            restoredIds.has(e.instanceId) &&
            getCardById(currentState, e.instanceId)?.zone === "field"
        )
        .map((e) => e.instanceId);
      return restoredSoulIds.length === 0
        ? player
        : {
            ...player,
            soulStateInstanceIds: [
              ...new Set([...player.soulStateInstanceIds, ...restoredSoulIds]),
            ],
          };
    }),
  };
}

function declarationEffectRecordKey(record: EffectUsageRecord): string {
  return [
    record.sourceInstanceId,
    record.sourceDefinitionId,
    record.playerId ?? "",
    record.effectLabel,
    record.turnNumber,
    record.step,
    record.duration,
    record.attackId ?? "",
    record.groupId ?? "",
    record.relatedInstanceId ?? "",
    record.triggerEventScopeKey ?? "",
    record.triggerActivationKey ?? "",
    record.sourceFieldInstanceGeneration ?? 0,
    record.sourceSoulStateGeneration ?? 0,
  ].join("\u0001");
}

function captureEffectRecordDeltas(
  beforeRecords: readonly EffectUsageRecord[],
  afterRecords: readonly EffectUsageRecord[]
): EffectUsageRecord[] {
  const beforeCounts = new Map(
    beforeRecords.map((record) => [
      declarationEffectRecordKey(record),
      record.count,
    ])
  );
  return afterRecords.flatMap((record) => {
    const delta =
      record.count -
      (beforeCounts.get(declarationEffectRecordKey(record)) ?? 0);
    return delta > 0 ? [{ ...record, count: delta }] : [];
  });
}

function subtractEffectRecordDeltas(
  records: readonly EffectUsageRecord[],
  deltas: readonly EffectUsageRecord[]
): EffectUsageRecord[] {
  const remainingAmounts = new Map<string, number>();
  for (const delta of deltas) {
    const key = declarationEffectRecordKey(delta);
    remainingAmounts.set(key, (remainingAmounts.get(key) ?? 0) + delta.count);
  }
  return records.flatMap((record) => {
    const key = declarationEffectRecordKey(record);
    const amount = remainingAmounts.get(key) ?? 0;
    if (amount === 0) return [record];
    remainingAmounts.set(key, Math.max(0, amount - record.count));
    return record.count > amount
      ? [{ ...record, count: record.count - amount }]
      : [];
  });
}

/**
 * 通常手札プレイの宣言が追加した状態だけを、通常手札プレイの
 * rollback 用に保持する。ここで snapshot 全体を保存するとスタック応答の結果まで
 * 消してしまうため、キュー ID・回数・カウントの差分だけを採る。
 */
export function captureNormalHandPlayDeclarationRollbackDelta(options: {
  beforeState: GameState;
  afterState: GameState;
  excludedCardInstanceIds?: readonly string[];
}): Pick<
  NormalHandPlayRollback,
  | "declarationTriggeredEffectPendingIds"
  | "declarationPrivateDeclarationIds"
  | "declarationOccurrenceDeltas"
  | "declarationUsageDeltas"
  | "declarationCountDeltas"
  | "declarationExcludedCardDeltas"
> {
  const beforePendingIds = new Set(
    options.beforeState.pendingTriggeredEffects.map(
      (pendingEffect) => pendingEffect.pendingId
    )
  );
  const pendingIds = options.afterState.pendingTriggeredEffects
    .filter((pendingEffect) => !beforePendingIds.has(pendingEffect.pendingId))
    .map((pendingEffect) => pendingEffect.pendingId);
  const beforePrivateDeclarationIds = new Set(
    options.beforeState.pendingPrivateDeclarations.map(
      (declaration) => declaration.declarationId
    )
  );
  const privateDeclarationIds = options.afterState.pendingPrivateDeclarations
    .filter(
      (declaration) =>
        !beforePrivateDeclarationIds.has(declaration.declarationId)
    )
    .map((declaration) => declaration.declarationId);

  const occurrenceDeltas = captureEffectRecordDeltas(
    options.beforeState.effectOccurrenceRecords,
    options.afterState.effectOccurrenceRecords
  );
  const usageDeltas = captureEffectRecordDeltas(
    options.beforeState.effectUsageRecords,
    options.afterState.effectUsageRecords
  );
  const countDeltas = options.afterState.players.flatMap((player) => {
    const before = options.beforeState.players.find((p) => p.id === player.id);
    const amount =
      player.countValue - (before?.countValue ?? player.countValue);
    const tribes = new Set([
      ...Object.keys(before?.protectedCounts ?? {}),
      ...Object.keys(player.protectedCounts ?? {}),
    ]);
    const protectedCountDeltas = [...tribes].flatMap((tribe) => {
      const delta =
        (player.protectedCounts?.[tribe] ?? 0) -
        (before?.protectedCounts?.[tribe] ?? 0);
      return delta === 0 ? [] : [{ tribe, amount: delta }];
    });
    return amount === 0 && protectedCountDeltas.length === 0
      ? []
      : [
          {
            playerId: player.id,
            amount,
            ...(protectedCountDeltas.length > 0
              ? { protectedCountDeltas }
              : {}),
          },
        ];
  });

  const excludedCardDeltas = (options.excludedCardInstanceIds ?? []).flatMap(
    (id) => {
      const before = getCardById(options.beforeState, id);
      const after = getCardById(options.afterState, id);
      return before &&
        after &&
        before.zone !== "removed_from_game" &&
        after.zone === "removed_from_game"
        ? [{ before, after }]
        : [];
    }
  );

  return {
    ...(pendingIds.length > 0
      ? { declarationTriggeredEffectPendingIds: pendingIds }
      : {}),
    ...(privateDeclarationIds.length > 0
      ? { declarationPrivateDeclarationIds: privateDeclarationIds }
      : {}),
    ...(occurrenceDeltas.length > 0
      ? { declarationOccurrenceDeltas: occurrenceDeltas }
      : {}),
    ...(usageDeltas.length > 0 ? { declarationUsageDeltas: usageDeltas } : {}),
    ...(countDeltas.length > 0 ? { declarationCountDeltas: countDeltas } : {}),
    ...(excludedCardDeltas.length > 0
      ? { declarationExcludedCardDeltas: excludedCardDeltas }
      : {}),
  };
}

/** 除外型の召喚コストも宣言取消の対象。応答が別ゾーンへ動かしたカードは戻さない。 */
function refundNormalPlayExcludedCards(
  state: GameState,
  rollback: NormalHandPlayRollback
): GameState {
  let currentState = state;
  const restoredIds = new Set<string>();
  for (const { before, after } of rollback.declarationExcludedCardDeltas ??
    []) {
    const card = getCardById(currentState, before.instanceId);
    if (card?.zone !== after.zone) continue;
    currentState = moveCardZone(
      currentState,
      card.instanceId,
      requireCardZone(before.zone)
    );
    currentState = updateCard(currentState, card.instanceId, (current) => {
      const restored = { ...current };
      // 値が応答で変更済みなら保持する。コアは数量保存、合体参照は相互整合を別途処理する。
      const separateKeys = new Set<keyof CardInstance>([
        "zone",
        "normalCoreCount",
        "soulCoreCount",
        "attachedToInstanceId",
        "attachedChildrenIds",
        "imaginRightCombinedWith",
      ]);
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ] as (keyof CardInstance)[])) {
        if (
          separateKeys.has(key) ||
          JSON.stringify(before[key]) === JSON.stringify(after[key]) ||
          JSON.stringify(card[key]) !== JSON.stringify(after[key])
        )
          continue;
        if (key in before) Object.assign(restored, { [key]: before[key] });
        else Reflect.deleteProperty(restored, key);
      }
      return restored;
    });
    const player = currentState.players.find(
      (p) => p.id === before.ownerPlayerId
    );
    const normalRefund = Math.min(
      Math.max(0, before.normalCoreCount - after.normalCoreCount),
      player?.reserveNormalCoreCount ?? 0
    );
    if (normalRefund > 0)
      currentState = moveNormalCores(
        currentState,
        { kind: "reserve", playerId: before.ownerPlayerId },
        { kind: "card", instanceId: card.instanceId },
        normalRefund
      );
    const soulRefund = Math.min(
      Math.max(0, before.soulCoreCount - after.soulCoreCount),
      player?.reserveSoulCoreCount ?? 0
    );
    if (soulRefund > 0)
      currentState = moveSoulCore(
        currentState,
        before.ownerPlayerId,
        { kind: "reserve", playerId: before.ownerPlayerId },
        { kind: "card", instanceId: card.instanceId },
        soulRefund
      );
    restoredIds.add(card.instanceId);
  }
  for (const { before } of rollback.declarationExcludedCardDeltas ?? []) {
    if (!restoredIds.has(before.instanceId)) continue;
    const host = before.attachedToInstanceId
      ? getCardById(currentState, before.attachedToInstanceId)
      : undefined;
    if (host?.zone === "field") {
      currentState = updateCard(currentState, before.instanceId, (c) => ({
        ...c,
        attachedToInstanceId: host.instanceId,
      }));
      currentState = updateCard(currentState, host.instanceId, (c) => ({
        ...c,
        attachedChildrenIds: [
          ...new Set([...c.attachedChildrenIds, before.instanceId]),
        ],
      }));
    }
  }
  return currentState;
}

/**
 * スタック窓中の変化で通常の手札プレイを完了できなくなったとき、
 * 現在の state に対して宣言そのものの差分だけを戻す。
 *
 * 03b の「手札やコアを宣言前の状態に戻す」は、相手のスタック応答で
 * 既に解決済みの効果・誘発・盤面変更まで取り消すものではない。そのため
 * ActiveStack に保存した支払い入力を逆方向に適用し、GameState snapshot を
 * 丸ごと復元しない。
 */
export function rollbackNormalHandPlayAfterStack(options: {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  const rollback = options.activeStack.normalHandPlayRollback;
  if (rollback === undefined) return options.state;

  const playerId = options.activeStack.actingPlayerId;
  let currentState = options.state;

  for (const paymentSource of rollback.paidCores) {
    const paymentDestination = paymentSource.normalDestination;
    const destinationPlayer = currentState.players.find(
      (player) => player.id === playerId
    );
    const availableNormalCoreCount =
      paymentDestination === "trash"
        ? (destinationPlayer?.trashNormalCoreCount ?? 0)
        : (destinationPlayer?.voidNormalCoreCount ?? 0);
    const refundNormalCoreAmount = Math.min(
      paymentSource.normalCoreCount,
      availableNormalCoreCount
    );
    const cardPaymentSource =
      paymentSource.kind === "card"
        ? currentState.cardInstances.find(
            (card) => card.instanceId === paymentSource.instanceId
          )
        : undefined;
    const refundDestination =
      cardPaymentSource?.zone === "field"
        ? { kind: "card" as const, instanceId: cardPaymentSource.instanceId }
        : { kind: "reserve" as const, playerId };

    if (refundNormalCoreAmount > 0) {
      currentState = moveNormalCores(
        currentState,
        { kind: paymentDestination, playerId },
        refundDestination,
        refundNormalCoreAmount
      );
    }

    // void にはソウルコアを保持しないため、この経路の soul refund は存在しない。
    const destinationAfterNormalRefund = currentState.players.find(
      (player) => player.id === playerId
    );
    if (
      paymentSource.soulCoreCount > 0 &&
      paymentSource.soulDestination === "trash" &&
      (destinationAfterNormalRefund?.trashSoulCoreCount ?? 0) > 0
    ) {
      currentState = moveSoulCore(
        currentState,
        playerId,
        { kind: paymentSource.soulDestination, playerId },
        refundDestination,
        Math.min(
          paymentSource.soulCoreCount,
          destinationAfterNormalRefund?.trashSoulCoreCount ?? 0
        )
      );
    }
  }

  const paymentCardIds = new Set(
    rollback.paidCores
      .filter(
        (
          paymentSource
        ): paymentSource is Extract<
          (typeof rollback.paidCores)[number],
          { kind: "card" }
        > => paymentSource.kind === "card"
      )
      .map((paymentSource) => paymentSource.instanceId)
  );
  const cancelledPendingIds = new Set(
    rollback.declarationTriggeredEffectPendingIds ?? []
  );
  const cancelledPrivateDeclarationIds = new Set(
    rollback.declarationPrivateDeclarationIds ?? []
  );
  if (
    cancelledPendingIds.size > 0 ||
    cancelledPrivateDeclarationIds.size > 0 ||
    (rollback.declarationOccurrenceDeltas?.length ?? 0) > 0 ||
    (rollback.declarationUsageDeltas?.length ?? 0) > 0 ||
    (rollback.declarationCountDeltas?.length ?? 0) > 0
  ) {
    currentState = {
      ...currentState,
      players: currentState.players.map((player) => {
        const delta = rollback.declarationCountDeltas?.find(
          (d) => d.playerId === player.id
        );
        if (delta === undefined) return player;
        const protectedCounts = { ...player.protectedCounts };
        for (const protectedDelta of delta.protectedCountDeltas ?? []) {
          protectedCounts[protectedDelta.tribe] = Math.max(
            0,
            (protectedCounts[protectedDelta.tribe] ?? 0) - protectedDelta.amount
          );
        }
        const countValue = Math.max(0, player.countValue - delta.amount);
        return withCount(
          player,
          countValue,
          shrinkProtectedCounts(protectedCounts, countValue)
        );
      }),
      effectUsageRecords: subtractEffectRecordDeltas(
        currentState.effectUsageRecords,
        rollback.declarationUsageDeltas ?? []
      ),
      // Payment / after-cost reactions are declaration-local.  They disappear
      // with the declaration, while response reactions stay queued.
      pendingTriggeredEffects: currentState.pendingTriggeredEffects.filter(
        (pendingEffect) => !cancelledPendingIds.has(pendingEffect.pendingId)
      ),
      pendingDeferredTriggeredEffects:
        currentState.pendingDeferredTriggeredEffects.filter(
          (pendingEffect) => !cancelledPendingIds.has(pendingEffect.pendingId)
        ),
      pendingPrivateDeclarations:
        currentState.pendingPrivateDeclarations.filter(
          (declaration) =>
            !cancelledPrivateDeclarationIds.has(declaration.declarationId) &&
            !cancelledPendingIds.has(declaration.pendingId)
        ),
      effectOccurrenceRecords: subtractEffectRecordDeltas(
        currentState.effectOccurrenceRecords,
        rollback.declarationOccurrenceDeltas ?? []
      ),
      log: currentState.log.filter(
        (entry) =>
          !Array.from(cancelledPendingIds).some((pendingId) =>
            entry.startsWith(`trigger:queued:${pendingId}:`)
          ) &&
          !Array.from(cancelledPrivateDeclarationIds).some((declarationId) =>
            entry.startsWith(
              `trigger:private-declaration:queued:${declarationId}:`
            )
          )
      ),
    };
  }
  currentState = {
    ...currentState,
    pendingLeaveEntities: currentState.pendingLeaveEntities.filter(
      (pendingLeave) =>
        !(
          paymentCardIds.has(pendingLeave.instanceId) &&
          pendingLeave.cause === "cost_payment" &&
          pendingLeave.chainId === options.activeStack.chainId
        )
    ),
  };
  for (const paymentCardId of paymentCardIds) {
    const card = currentState.cardInstances.find(
      (candidate) => candidate.instanceId === paymentCardId
    );
    if (
      card?.pendingLeaveCause === "cost_payment" &&
      card.pendingLeaveChainId === options.activeStack.chainId
    ) {
      currentState = updateCard(currentState, paymentCardId, (candidate) => ({
        ...candidate,
        pendingLeaveKind: null,
        pendingLeaveCause: null,
        pendingLeaveChainId: null,
        deferZoneMoveUntilChainEnd: false,
      }));
    }
  }

  currentState = refundNormalPlayExcludedCards(currentState, rollback);
  currentState = restoreNormalPlaySource(
    currentState,
    options.activeStack,
    rollback,
    options.getCardDefinitionById
  );
  const usageLogIndex =
    options.activeStack.actionKind === "set_mirage"
      ? -1
      : currentState.flashCardUsageLog.findLastIndex(
          (entry) =>
            entry.playerId === playerId &&
            entry.cardInstanceId === options.activeStack.cardInstanceId &&
            entry.cardDefinitionId === options.activeStack.cardDefinitionId &&
            entry.mode === "play" &&
            entry.completion === "declared"
        );
  if (usageLogIndex >= 0) {
    currentState = {
      ...currentState,
      flashCardUsageLog: currentState.flashCardUsageLog.filter(
        (_, index) => index !== usageLogIndex
      ),
    };
  }

  // 取り消した支払いの待機マーカーは残さない。応答後の実コア/Lv条件で再判定する。
  currentState = runStateBasedActions(
    currentState,
    options.getCardDefinitionById
  ).state;

  return {
    ...currentState,
    log: [
      ...currentState.log,
      `${options.activeStack.actionKind}:rollback:${options.activeStack.chainId}:post-stack-declaration-illegal`,
    ],
  };
}

export interface PlayCardWithoutPayingCostWithPlacementOptions {
  state: GameState;
  actingPlayerId: string;
  card: CardInstance;
  definition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: queueAfterCostPaidTriggers の listener 解決に使用 (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  actionKind: "summon" | "place_nexus";
  enterFieldCorePlacementPolicy: EnterFieldCorePlacementPolicy;
  targetInstanceIds?: readonly string[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  enterFieldCorePlacements: readonly EnterFieldCorePlacement[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  chainId?: string;
  /** 効果解決由来の without-cost 場入りを trigger cause 付きで観測するための source label。 */
  effectFieldEntrySource?: "burst_follow_up";
}

function createPlayChainId(
  state: GameState,
  actingPlayerId: string,
  actionKind: "summon" | "place_nexus",
  instanceId: string
): string {
  return `play:${state.turnNumber}:${actingPlayerId}:${state.step}:${actionKind}:${instanceId}`;
}

function applyFixedPaymentCostOverride(
  reduction: ReductionResult,
  fixedPaymentCost: number | undefined
): ReductionResult {
  if (fixedPaymentCost === undefined) {
    return reduction;
  }
  if (!Number.isInteger(fixedPaymentCost) || fixedPaymentCost < 0) {
    throw new Error(`Invalid fixed payment cost: ${fixedPaymentCost}`);
  }

  return {
    ...reduction,
    effectiveCost: fixedPaymentCost,
    totalReduction: Math.max(0, reduction.printedCost - fixedPaymentCost),
    satisfiedReductionSymbolCount: 0,
    reducedCost: fixedPaymentCost,
    additionalCost: 0,
    finalCost: fixedPaymentCost,
    additionalCostModifiers: [],
  };
}

function pushPlayCardUsageLog(
  state: GameState,
  actingPlayerId: string,
  card: CardInstance,
  definition: CardDefinition,
  actionKind: "summon" | "place_nexus",
  chainId: string
): GameState {
  return {
    ...state,
    flashCardUsageLog: [
      ...state.flashCardUsageLog,
      {
        playerId: actingPlayerId,
        cardInstanceId: card.instanceId,
        cardDefinitionId: definition.cardNo,
        turnNumber: state.turnNumber,
        step: state.step,
        attackId: state.activeAttack?.attackId ?? null,
        mode: "play",
        completion: "declared",
        chainId,
      },
    ],
    log: [
      ...state.log,
      `${actionKind}:card_used:${actingPlayerId}:${card.instanceId}:${definition.cardNo}`,
    ],
  };
}

function markPlayCardUsageLogCompleted(
  state: GameState,
  actingPlayerId: string,
  card: CardInstance,
  definition: CardDefinition
): GameState {
  const index = state.flashCardUsageLog.findLastIndex(
    (entry) =>
      entry.playerId === actingPlayerId &&
      entry.cardInstanceId === card.instanceId &&
      entry.cardDefinitionId === definition.cardNo &&
      entry.mode === "play"
  );
  if (index < 0) return state;
  return {
    ...state,
    flashCardUsageLog: state.flashCardUsageLog.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, completion: "resolving" } : entry
    ),
  };
}

function assertTargetIsAllowed(
  state: GameState,
  targetInstanceId: string,
  effectFilterTags: readonly EffectFilterTag[],
  sourcePreventionLevel: EffectPreventionLevel = "none"
): void {
  const targetCard = getPlayCardInstanceOrThrow(
    state,
    targetInstanceId,
    "Unknown target card"
  );
  const blockReason = getEffectFilterBlockReason(targetCard, effectFilterTags);

  if (blockReason !== null) {
    throw new Error(
      `Target card cannot receive this effect: target=${targetInstanceId} reason=${blockReason}`
    );
  }

  const preventionReason = getPreventionBlockReason(
    state,
    targetInstanceId,
    sourcePreventionLevel
  );
  if (preventionReason !== null) {
    throw new Error(
      `Target card cannot receive this effect: target=${targetInstanceId} reason=${preventionReason}`
    );
  }
}

function moveCardToField(
  state: GameState,
  instanceId: string,
  definition: CardDefinition,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  combineHostInstanceId?: string
): GameState {
  // 呼び出し元 (resolvePlayedCardOnField) は事前に moveCardToInUse で in_use に移動
  // しているか、もしくは trash/deck 等の非 hand origin。 hand origin の handCount
  // 減算は moveCardToInUse 側で済んでいる前提。
  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((cardInstance) => {
      if (cardInstance.instanceId === instanceId) {
        return {
          ...cardInstance,
          zone: "field" as const,
          zoneRoleName: getDefaultZoneRoleName(definition, "field"),
          // 直接合体召喚: 場入りと同時に合体させる (SBA 消滅回避)。
          ...(combineHostInstanceId
            ? { attachedToInstanceId: combineHostInstanceId }
            : {}),
        };
      }
      if (
        cardInstance.attachedToInstanceId === instanceId &&
        cardInstance.zone === "in_use"
      ) {
        const childDefinition = getCardDefinitionById(
          cardInstance.definitionId
        );
        return {
          ...cardInstance,
          zone: "field" as const,
          zoneRoleName: childDefinition
            ? getDefaultZoneRoleName(childDefinition, "field")
            : cardInstance.zoneRoleName,
        };
      }
      // 合体先ホストへブレイヴを子として登録。
      if (
        combineHostInstanceId &&
        cardInstance.instanceId === combineHostInstanceId
      ) {
        return {
          ...cardInstance,
          attachedChildrenIds: [
            ...cardInstance.attachedChildrenIds,
            instanceId,
          ],
        };
      }
      return cardInstance;
    })
  );
}

function moveCardToInUse(
  state: GameState,
  instanceId: string,
  actionKind: "summon" | "place_nexus",
  chainId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  const wasSoulState = state.players.some((player) =>
    player.soulStateInstanceIds.includes(instanceId)
  );
  const inUseInstanceIds = new Set(
    wasSoulState
      ? expandWithSoulStateInheritingKeyBraves(
          state,
          [instanceId],
          getCardDefinitionById
        )
      : [instanceId]
  );

  state.log.push(`${actionKind}:in-use:${chainId}:${instanceId}`);
  for (const id of inUseInstanceIds) {
    state = moveCardZone(state, id, "in_use", undefined);
  }
  return replaceCardInstances(
    {
      ...state,
      players: state.players.map((player) => {
        return wasSoulState
          ? {
              ...player,
              soulStateInstanceIds: player.soulStateInstanceIds.filter(
                (soulStateInstanceId) =>
                  !inUseInstanceIds.has(soulStateInstanceId)
              ),
            }
          : player;
      }),
    },
    stripAdventSourceUnderCardReference(state.cardInstances, instanceId)
  );
}

export function moveFailedPlayCardGroupToTrash(options: {
  state: GameState;
  instanceId: string;
  chainId: string;
  reason: "nullified" | "enter_field_core_shortage";
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  const trashInstanceIds = new Set(
    expandWithSoulStateInheritingKeyBraves(
      options.state,
      [options.instanceId],
      options.getCardDefinitionById
    )
  );

  let currentState = options.state;
  for (const instanceId of trashInstanceIds) {
    currentState = moveCardZone(currentState, instanceId, "trash");
  }
  return replaceCardInstances(
    {
      ...currentState,
      log: [
        ...currentState.log,
        options.reason === "nullified"
          ? `effect:nullified:${options.chainId}:${options.instanceId}`
          : `play-card:not-established:${options.chainId}:${options.instanceId}:${options.reason}`,
      ],
    },
    currentState.cardInstances.map((card) => {
      if (trashInstanceIds.has(card.instanceId)) {
        return {
          ...card,
          attachedToInstanceId: null,
          attachedChildrenIds: [],
        };
      }
      if (
        card.attachedChildrenIds.some((childId) =>
          trashInstanceIds.has(childId)
        )
      ) {
        return {
          ...card,
          attachedChildrenIds: card.attachedChildrenIds.filter(
            (childId) => !trashInstanceIds.has(childId)
          ),
        };
      }
      return card;
    })
  );
}

function resolvePlayedCardOnField(options: {
  state: GameState;
  chainId: string;
  actingPlayerId: string;
  card: CardInstance;
  definition: CardDefinition;
  actionKind: "summon" | "place_nexus";
  enterFieldCorePlacements: readonly EnterFieldCorePlacement[];
  targetInstanceIds?: readonly string[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: card_event:summon 等の trigger queue に forward。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  /** 直接合体召喚: 場入りと同時に合体させるホスト。 */
  combineHostInstanceId?: string;
  /** 効果解決由来の without-cost 場入りを trigger cause 付きで観測するための source label。 */
  effectFieldEntrySource?: "burst_follow_up";
  /** summon/place permission 由来の play-card action で、原因効果 index を保持する。 */
  sourceEffectIndex?: number;
}): GameState {
  const stateBeforeFieldEntry = options.state; // フィールド移動前（trigger 検出用）
  // BSLH01-T13 grant_summon_trash_core_placement CE 消費: amount 上限は declare 時点で
  // assertEnterFieldCorePlacementsAllowed (enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount)
  // が既に検証済みだが、実際に置く瞬間 (ここ) でも独立に grant の有無を再確認する。
  // stack 窓での negate 等により declare 後に CE が失われるケースを取りこぼさないため。
  const allowTrashNormal =
    options.actionKind === "summon" &&
    getSummonTrashCorePlacementGrant(
      options.state,
      options.actingPlayerId,
      options.definition
    ) !== null;
  let currentState = moveCardToField(
    options.state,
    options.card.instanceId,
    options.definition,
    options.getCardDefinitionById,
    options.combineHostInstanceId
  );

  currentState = applyEnterFieldCorePlacements({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    destinationInstanceId: options.card.instanceId,
    placements: options.enterFieldCorePlacements,
    getCardDefinitionById: options.getCardDefinitionById,
    allowTrashNormal,
  });
  currentState = recordBraveFieldEntry(
    currentState,
    options.definition,
    options.card.instanceId,
    options.actionKind === "summon" ? "summon" : "place",
    getCardUseSourceZone(options.card)
  );
  if (options.combineHostInstanceId) {
    currentState = recordSemanticTriggerEvent(currentState, {
      eventKind: "brave_combined",
      relatedInstanceId: options.card.instanceId,
      triggerRelatedCombinedHostInstanceId: options.combineHostInstanceId,
    });
  }
  if (options.effectFieldEntrySource) {
    currentState =
      options.actionKind === "summon"
        ? {
            ...currentState,
            log: [
              ...currentState.log,
              `effect:summon:${options.card.instanceId}:self:${options.effectFieldEntrySource}`,
            ],
          }
        : {
            ...currentState,
            log: [
              ...currentState.log,
              `effect:field_place:${options.effectFieldEntrySource}:${options.actingPlayerId}:${options.card.instanceId}`,
            ],
          };
  }
  const targetEffectFilterTags = options.targetEffectFilterTags ?? ["general"];

  for (const targetInstanceId of options.targetInstanceIds ?? []) {
    assertTargetIsAllowed(
      currentState,
      targetInstanceId,
      targetEffectFilterTags
    );
  }

  const sourceCard = getPlayCardInstanceOrThrow(
    currentState,
    options.card.instanceId,
    "Unknown played card after entering the field"
  );
  const effectActionContext = getPlayEffectActionContext({
    chainId: options.chainId,
    actingPlayerId: options.actingPlayerId,
    // 召喚カテゴリ由来の sourceKind。ブレイヴはスピリット状態として "spirit" 扱い
    // (公式: ブレイヴ召喚はスピリット召喚ではないが、スピリット状態のブレイヴは
    //  独立スピリットのように自身の効果を発揮する)。アルティメットは "ultimate"。
    sourceKind:
      options.actionKind === "place_nexus"
        ? "nexus"
        : options.definition.printedCategory === "ultimate"
          ? "ultimate"
          : "spirit",
    sourceCard,
    sourceDefinition: options.definition,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.effectFieldEntrySource
      ? { effectFieldEntrySource: options.effectFieldEntrySource }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
  });

  return runActionMainResolution({
    state: currentState,
    chainId: options.chainId,
    context: effectActionContext,
    triggerBeforeState: stateBeforeFieldEntry, // フィールド移動前 state（trigger 検出用）
    startLogs: [
      `${options.actionKind}:enter-field:${options.chainId}:${options.card.instanceId}:${getPlacedCoreCount(
        options.enterFieldCorePlacements
      )}`,
      `${options.actionKind}:targets:${options.chainId}:${(options.targetInstanceIds ?? []).join(",")}`,
      `${options.actionKind}:resolve-main:start:${options.chainId}`,
    ],
    endLogs: [
      `${options.actionKind}:resolve-main:end:${options.chainId}`,
      `${options.actionKind}:resolve-derived:end:${options.chainId}`,
    ],
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

function getPlayEffectActionContext(options: {
  chainId: string;
  actingPlayerId: string;
  sourceKind: "spirit" | "ultimate" | "nexus";
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: action_resolution 経路の trigger queue に forward。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  targetInstanceIds?: readonly string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  effectFieldEntrySource?: "burst_follow_up";
  sourceEffectIndex?: number;
}): EffectActionContext {
  return {
    chainId: options.chainId,
    resolutionKind: "play_card_action",
    actingPlayerId: options.actingPlayerId,
    sourceKind: options.sourceKind,
    sourceCard: options.sourceCard,
    sourceDefinition: options.sourceDefinition,
    targetInstanceIds: [...(options.targetInstanceIds ?? [])],
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.effectFieldEntrySource
      ? { effectFieldEntrySource: options.effectFieldEntrySource }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
  };
}

export function playHandCardWithPlacement(
  options: PlayHandCardWithPlacementOptions
): PlayHandCardActionResult {
  const chainId = createPlayChainId(
    options.state,
    options.actingPlayerId,
    options.actionKind,
    options.card.instanceId
  );
  const reduction = applyFixedPaymentCostOverride(
    calculateReduction({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      card: options.definition,
      getCardDefinitionById: options.getCardDefinitionById,
      sourceInstanceId: options.card.instanceId,
      useKind: options.actionKind,
      ...(options.baseCostOverride !== undefined
        ? { baseCostOverride: options.baseCostOverride }
        : {}),
      ...(options.additionalCostModifiers !== undefined
        ? { additionalCostModifiers: options.additionalCostModifiers }
        : {}),
    }),
    options.fixedPaymentCost
  );

  assertMatchingPaymentAmount(reduction, options.paymentSources);
  assertFilteredOnBoardPaymentSourcesAllowed(options);
  if (
    options.definition.tenshoSummon === undefined &&
    !canCompleteHandPlayAfterCostPayment({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      card: options.card,
      definition: options.definition,
      paymentSources: options.paymentSources,
      minimumEnterFieldCoreCount:
        options.enterFieldCorePlacementPolicy.minimumCoreCount,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
        : {}),
      ...(options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount !==
      undefined
        ? {
            allowedTrashNormalCoreCount:
              options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount,
          }
        : {}),
    })
  ) {
    throw new Error(
      "Hand play payment leaves no legal enter-field core placement"
    );
  }
  if (
    options.actionKind === "summon" &&
    !canCompleteTenshoSummonAfterCostPayment({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      definition: options.definition,
      paymentSources: options.paymentSources,
      minimumEnterFieldCoreCount:
        options.enterFieldCorePlacementPolicy.minimumCoreCount,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
        : {}),
      ...(options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount !==
      undefined
        ? {
            allowedTrashNormalCoreCount:
              options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount,
          }
        : {}),
    })
  ) {
    throw new Error(
      "Tensho summon payment leaves no legal enter-field core placement"
    );
  }
  const enterFieldCorePlacements = options.enterFieldCorePlacements ?? [];

  assertEnterFieldCorePlacementsAllowed(
    options.enterFieldCorePlacementPolicy,
    enterFieldCorePlacements
  );

  if (
    getPlacedCoreCount(enterFieldCorePlacements) <
    options.enterFieldCorePlacementPolicy.minimumCoreCount
  ) {
    throw new Error(
      `Not enough enter-field cores selected: required=${options.enterFieldCorePlacementPolicy.minimumCoreCount} selected=${getPlacedCoreCount(
        enterFieldCorePlacements
      )}`
    );
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `${options.actionKind}:declare:${chainId}:${options.card.instanceId}:${options.definition.cardNo}`,
      `${options.actionKind}:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  // P3-39 follow-up: hand/set_aside → in_use を支払い前に行うことで、
  // after_cost_paid trigger 時点で source card が in_use zone にあることを保証する。
  // DSL 自動登録 after_cost_paid の既定 sourceZone は ["field", "in_use"] のため、
  // hand のままだと sourceChoices=0 で誘発が捨てられる (旧挙動: raw push fallback で
  // 隠れていたが strict 経路では失われる)。 マジック使用と同パターンに統一。
  currentState = moveCardToInUse(
    currentState,
    options.card.instanceId,
    options.actionKind,
    chainId,
    options.getCardDefinitionById
  );

  // P3-108: コスト支払いによるコア不足消滅は runActionMainResolution の差分窓より前に発生し、
  // かつチェーン終端で flush されるため、後段の finalize では「消滅したとき/離れたとき」誘発を
  // 取りこぼす。支払い直後（消滅待機中・flush 前）にここで離脱誘発を収集する。
  const stateBeforeCostPayment = currentState;
  currentState = applyCardCostPayments({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
  });
  currentState = collectCostPaymentVanishTriggers({
    beforeState: stateBeforeCostPayment,
    afterState: currentState,
    chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  currentState = {
    ...currentState,
    log: [...currentState.log, `${options.actionKind}:cost-paid:${chainId}`],
  };
  currentState = pushPlayCardUsageLog(
    currentState,
    options.actingPlayerId,
    options.card,
    options.definition,
    options.actionKind,
    chainId
  );
  currentState = queueAfterCostPaidTriggers({
    chainId: chainId,
    state: currentState,
    sourceInstanceId: options.card.instanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  currentState = resolvePlayedCardOnField({
    state: currentState,
    chainId,
    actingPlayerId: options.actingPlayerId,
    card: options.card,
    definition: options.definition,
    actionKind: options.actionKind,
    enterFieldCorePlacements,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
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
    ...(options.combineHostInstanceId
      ? {
          combineHostInstanceId: options.combineHostInstanceId,
        }
      : {}),
  });
  currentState = markPlayCardUsageLogCompleted(
    currentState,
    options.actingPlayerId,
    options.card,
    options.definition
  );

  return {
    state: currentState,
    chainId,
    reduction,
  };
}

export function playHandCardWithPlacementInStackContext(
  options: PlayHandCardWithPlacementOptions
): PlayHandCardInStackContextResult {
  const chainId = createPlayChainId(
    options.state,
    options.actingPlayerId,
    options.actionKind,
    options.card.instanceId
  );
  const reduction = applyFixedPaymentCostOverride(
    calculateReduction({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      card: options.definition,
      getCardDefinitionById: options.getCardDefinitionById,
      sourceInstanceId: options.card.instanceId,
      useKind: options.actionKind,
      ...(options.baseCostOverride !== undefined
        ? { baseCostOverride: options.baseCostOverride }
        : {}),
      ...(options.additionalCostModifiers !== undefined
        ? { additionalCostModifiers: options.additionalCostModifiers }
        : {}),
    }),
    options.fixedPaymentCost
  );

  assertMatchingPaymentAmount(reduction, options.paymentSources);
  assertFilteredOnBoardPaymentSourcesAllowed(options);
  if (
    options.definition.tenshoSummon === undefined &&
    !canCompleteHandPlayAfterCostPayment({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      card: options.card,
      definition: options.definition,
      paymentSources: options.paymentSources,
      minimumEnterFieldCoreCount:
        options.enterFieldCorePlacementPolicy.minimumCoreCount,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
        : {}),
      ...(options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount !==
      undefined
        ? {
            allowedTrashNormalCoreCount:
              options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount,
          }
        : {}),
    })
  ) {
    throw new Error(
      "Hand play payment leaves no legal enter-field core placement"
    );
  }
  if (
    options.actionKind === "summon" &&
    !canCompleteTenshoSummonAfterCostPayment({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      definition: options.definition,
      paymentSources: options.paymentSources,
      minimumEnterFieldCoreCount:
        options.enterFieldCorePlacementPolicy.minimumCoreCount,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
        : {}),
      ...(options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount !==
      undefined
        ? {
            allowedTrashNormalCoreCount:
              options.enterFieldCorePlacementPolicy.allowedTrashNormalCoreCount,
          }
        : {}),
    })
  ) {
    throw new Error(
      "Tensho summon payment leaves no legal enter-field core placement"
    );
  }
  if (options.enterFieldCorePlacements !== undefined) {
    assertEnterFieldCorePlacementsAllowed(
      options.enterFieldCorePlacementPolicy,
      options.enterFieldCorePlacements
    );

    if (
      getPlacedCoreCount(options.enterFieldCorePlacements) <
      options.enterFieldCorePlacementPolicy.minimumCoreCount
    ) {
      throw new Error(
        `Not enough enter-field cores selected: required=${options.enterFieldCorePlacementPolicy.minimumCoreCount} selected=${getPlacedCoreCount(
          options.enterFieldCorePlacements
        )}`
      );
    }
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `${options.actionKind}:declare:${chainId}:${options.card.instanceId}:${options.definition.cardNo}`,
      `${options.actionKind}:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  currentState = moveCardToInUse(
    currentState,
    options.card.instanceId,
    options.actionKind,
    chainId,
    options.getCardDefinitionById
  );

  // P3-108: フラッシュ文脈召喚でもコスト支払い消滅の「消滅したとき」誘発を支払い直後に収集する。
  const stateBeforeCostPayment = currentState;
  currentState = applyCardCostPayments({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
  });
  currentState = collectCostPaymentVanishTriggers({
    beforeState: stateBeforeCostPayment,
    afterState: currentState,
    chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  currentState = {
    ...currentState,
    log: [...currentState.log, `${options.actionKind}:cost-paid:${chainId}`],
  };
  currentState = pushPlayCardUsageLog(
    currentState,
    options.actingPlayerId,
    options.card,
    options.definition,
    options.actionKind,
    chainId
  );
  currentState = queueAfterCostPaidTriggers({
    chainId: chainId,
    state: currentState,
    sourceInstanceId: options.card.instanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return {
    state: currentState,
    activeStack: {
      stackId: `stack:${chainId}`,
      actionKind: options.actionKind,
      chainId,
      actingPlayerId: options.actingPlayerId,
      cardInstanceId: options.card.instanceId,
      cardDefinitionId: options.card.definitionId,
      normalHandPlayRollback: {
        ...captureNormalPlaySource(options),
        ...buildNormalHandPlayPaidCoreDelta({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          paymentSources: options.paymentSources,
          getCardDefinitionById: options.getCardDefinitionById,
          ...(options.onBoardCoreSourceFilter !== undefined
            ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
            : {}),
        }),
      },
      ...(options.sourceEffectIndex !== undefined
        ? {
            // 03f: 宣言内で支払った対価による条件変化は、応答による違法化ではない。
            // Condition は AND の節配列。支払い後も成立する節を汎用評価で再検査する。
            playDeclarationRecheckCondition: (
              options.definition.effects?.[options.sourceEffectIndex]
                ?.condition ?? []
            ).filter((clause) =>
              evaluateCondition(
                currentState,
                [clause],
                options.card.instanceId,
                options.actingPlayerId,
                options.getCardDefinitionById
              )
            ),
          }
        : {}),
      targetInstanceIds: [...(options.targetInstanceIds ?? [])],
      ...(options.chosenLifeCoreKind !== undefined
        ? {
            chosenLifeCoreKind: options.chosenLifeCoreKind,
          }
        : {}),
      targetEffectFilterTags: options.targetEffectFilterTags ?? ["general"],
      reducedCost: reduction.reducedCost,
      totalReduction: reduction.totalReduction,
      costForFilter: reduction.effectiveCost ?? reduction.printedCost,
      ...(options.enterFieldCorePlacements !== undefined
        ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
        : {}),
      ...(options.combineHostInstanceId !== undefined
        ? { combineHostInstanceId: options.combineHostInstanceId }
        : {}),
      ...(options.sourceEffectIndex !== undefined
        ? { sourceEffectIndex: options.sourceEffectIndex }
        : {}),
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    },
    reduction,
  };
}

export function playCardWithoutPayingCostWithPlacement(
  options: PlayCardWithoutPayingCostWithPlacementOptions
): PlayCardWithoutPayingCostActionResult {
  const chainId =
    options.chainId ??
    createPlayChainId(
      options.state,
      options.actingPlayerId,
      options.actionKind,
      options.card.instanceId
    );

  assertEnterFieldCorePlacementsAllowed(
    options.enterFieldCorePlacementPolicy,
    options.enterFieldCorePlacements
  );

  if (
    getPlacedCoreCount(options.enterFieldCorePlacements) <
    options.enterFieldCorePlacementPolicy.minimumCoreCount
  ) {
    throw new Error(
      `Not enough enter-field cores selected: required=${options.enterFieldCorePlacementPolicy.minimumCoreCount} selected=${getPlacedCoreCount(
        options.enterFieldCorePlacements
      )}`
    );
  }

  let stateBeforeResolve: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `${options.actionKind}:declare:${chainId}:${options.card.instanceId}:${options.definition.cardNo}`,
      `${options.actionKind}:without-cost:${chainId}`,
    ],
  };

  // P3-39 follow-up: hand/set_aside origin の場合は in_use 経由に統一する。
  // 通常召喚 (cost-payment) と挙動を揃え、source-zone-filtered な triggered effect の
  // 検出条件を一致させる。 trash / deck / field origin (蘇生・回収再召喚等) は
  // 既存挙動 (直接 field 移動) を維持する。
  const currentCard = getCardById(stateBeforeResolve, options.card.instanceId);
  if (currentCard?.zone === "hand" || currentCard?.zone === "set_aside") {
    stateBeforeResolve = moveCardToInUse(
      stateBeforeResolve,
      options.card.instanceId,
      options.actionKind,
      chainId,
      options.getCardDefinitionById
    );
  }

  const currentState = resolvePlayedCardOnField({
    state: stateBeforeResolve,
    chainId,
    actingPlayerId: options.actingPlayerId,
    card: options.card,
    definition: options.definition,
    actionKind: options.actionKind,
    enterFieldCorePlacements: options.enterFieldCorePlacements,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
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
    ...(options.effectFieldEntrySource
      ? { effectFieldEntrySource: options.effectFieldEntrySource }
      : {}),
  });

  return {
    state: currentState,
    chainId,
  };
}

function rebuildContinuousAndApplyStateBasedActions(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let current = state;
  let previousSignature: string | null = null;

  for (let pass = 0; pass < state.cardInstances.length + 2; pass++) {
    const rebuilt = recomputeAndRebuildContinuousEffects(
      current,
      getCardDefinitionById
    );
    const afterSba = runStateBasedActions(rebuilt, getCardDefinitionById).state;
    const next = recomputeAndRebuildContinuousEffects(
      afterSba,
      getCardDefinitionById
    );
    const signature = JSON.stringify({
      cards: next.cardInstances.map((card) => ({
        id: card.instanceId,
        zone: card.zone,
        attachedTo: card.attachedToInstanceId,
        children: card.attachedChildrenIds,
        normalCores: card.normalCoreCount,
        pendingLeaveKind: card.pendingLeaveKind,
        exhaustState: card.exhaustState,
      })),
      activeContinuousEffects: next.activeContinuousEffects.map((ce) => ({
        id: ce.effectId,
        tag: ce.modifierTag,
        source: ce.sourceInstanceId,
        target: ce.targetInstanceId,
        metadata: ce.metadata,
      })),
      pendingLeaveEntities: next.pendingLeaveEntities.map((entry) => ({
        id: entry.instanceId,
        kind: entry.kind,
        chainId: entry.chainId,
      })),
    });
    if (signature === previousSignature) {
      return next;
    }
    previousSignature = signature;
    current = next;
  }

  return current;
}

export function resolveDeferredPlayCardWithPlacement(options: {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: deferred 解決の trigger queue に forward (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}): GameState {
  const actionKind = options.activeStack.actionKind;

  if (actionKind !== "summon" && actionKind !== "place_nexus") {
    throw new Error(
      `Deferred play-card stack requires summon/place actionKind: ${actionKind}`
    );
  }

  const card = getPlayCardInstanceOrThrow(
    options.state,
    options.activeStack.cardInstanceId,
    "Deferred play-card source card not found"
  );
  const definition = getPlayCardDefinitionOrThrow(
    options.activeStack.cardDefinitionId,
    options.getCardDefinitionById
  );

  if (options.activeStack.isNullified) {
    return moveFailedPlayCardGroupToTrash({
      state: options.state,
      instanceId: options.activeStack.cardInstanceId,
      chainId: options.activeStack.chainId,
      reason: "nullified",
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  // 強制合体を含め、古い/注入された pending でも合体不可の incoming を attach しない。
  // 通常候補関数のホスト適格性を、カード本文による強制合体へ上乗せしない。
  // pending 側の定義が差し替わっていても、実際に場へ移す実体の印字制約を保持する。
  const combineHostInstanceId = options.activeStack.combineHostInstanceId;
  if (
    combineHostInstanceId !== undefined &&
    (hasCannotCombineRestriction(options.state, card.instanceId, definition) ||
      (card.definitionId !== options.activeStack.cardDefinitionId &&
        hasCannotCombineRestriction(
          options.state,
          card.instanceId,
          getPlayCardDefinitionOrThrow(
            card.definitionId,
            options.getCardDefinitionById
          )
        )))
  ) {
    throw new Error(
      `Deferred play-card: cannot combine incoming brave ${card.instanceId}`
    );
  }

  let resolvedState = resolvePlayedCardOnField({
    state: options.state,
    chainId: options.activeStack.chainId,
    actingPlayerId: options.activeStack.actingPlayerId,
    card,
    definition,
    actionKind,
    enterFieldCorePlacements:
      options.activeStack.enterFieldCorePlacements ?? [],
    targetInstanceIds: options.activeStack.targetInstanceIds,
    targetEffectFilterTags: options.activeStack
      .targetEffectFilterTags as EffectFilterTag[],
    ...(options.activeStack.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.activeStack.chosenLifeCoreKind,
        }
      : {}),
    ...(options.activeStack.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.activeStack.sourceEffectIndex }
      : {}),
    ...(combineHostInstanceId !== undefined ? { combineHostInstanceId } : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
  });
  resolvedState = markPlayCardUsageLogCompleted(
    resolvedState,
    options.activeStack.actingPlayerId,
    card,
    definition
  );

  if (combineHostInstanceId === undefined) {
    // スピリット状態 (合体しない) で場入り済み。
    return resolvedState;
  }

  // 合体成立: ブレイヴ上に置かれたコアを合体先ホストへ移動する
  // (`05_brave-and-attack-special-cases.md`: 「ブレイヴ上のコアは合体先に移動する」)。
  // attach 自体は resolvePlayedCardOnField の moveCardToField で完了済み。
  const braveId = options.activeStack.cardInstanceId;
  const braveCard = getCardById(resolvedState, braveId);
  const hostCard = getCardById(resolvedState, combineHostInstanceId);
  const braveCores = braveCard?.normalCoreCount ?? 0;
  const braveSoul = braveCard ? isSoulCoreOn(resolvedState, braveId) : false;
  const combinedExhausted =
    braveCard?.exhaustState !== undefined &&
    braveCard.exhaustState !== "recovered"
      ? true
      : hostCard?.exhaustState !== undefined &&
        hostCard.exhaustState !== "recovered";
  const afterCoreTransfer = moveBraveCombineCoresToHost(
    resolvedState,
    options.activeStack.actingPlayerId,
    braveId,
    combineHostInstanceId,
    options.getCardDefinitionById
  );
  if (afterCoreTransfer === null) {
    resolvedState = updateCard(resolvedState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: null,
    }));
    resolvedState = updateCard(resolvedState, combineHostInstanceId, (c) => ({
      ...c,
      attachedChildrenIds: c.attachedChildrenIds.filter((id) => id !== braveId),
    }));
    return {
      ...resolvedState,
      log: [
        ...resolvedState.log,
        `brave:combine-summon:blocked-core-transfer:${resolvedState.turnNumber}:${options.activeStack.actingPlayerId}:${braveId}:${combineHostInstanceId}:cores:${braveCores}${braveSoul ? "+soul" : ""}`,
      ],
    };
  }
  resolvedState = afterCoreTransfer;
  if (combinedExhausted) {
    resolvedState = updateCard(resolvedState, combineHostInstanceId, (c) => ({
      ...c,
      exhaustState: "exhausted",
    }));
  }
  resolvedState = {
    ...resolvedState,
    log: [
      ...resolvedState.log,
      `brave:combine-summon:${resolvedState.turnNumber}:${options.activeStack.actingPlayerId}:${braveId}:${combineHostInstanceId}:cores:${braveCores}${braveSoul ? "+soul" : ""}`,
    ],
  };
  return rebuildContinuousAndApplyStateBasedActions(
    resolvedState,
    options.getCardDefinitionById
  );
}
