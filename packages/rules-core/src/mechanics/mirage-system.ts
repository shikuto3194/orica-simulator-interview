import {
  buildNormalHandPlayPaidCoreDelta,
  captureNormalHandPlayDeclarationRollbackDelta,
  rollbackNormalHandPlayAfterStack,
} from "../play/play-card-resolution";
/**
 * ミラージュ（Mirage）システム
 *
 * メインステップにターン1回、ミラージュコストを支払ってバーストエリア（ミラージュ枠）に
 * 表向きでセットし、【セット中】効果を永続発揮する。
 * 既存ミラージュがある場合は入れ替え（旧カードは手札に戻る。手札増加扱いではない）。
 * 手札からのみセット可能（手元からは不可）。
 */
import { replaceCardInstances } from "../zone/card-instance-state";
import { getCardById } from "../card/card-lookup";
import { isInHandForOwnEffect } from "../effect/card-access-rules";
import { moveCardZone } from "../core/core-system";
import { calculateAccelChangeReduction } from "./accel-change-system";
import {
  applyCardCostPayments,
  assertMatchingPaymentAmount,
  getAvailableCardCostPaymentSources,
  getTotalPaymentAmount,
  type AvailableCardCostPaymentSourcesResult,
  type CardCostPaymentSource,
} from "../core/payment-system";
import { getDefaultZoneRoleName } from "../factories";
import {
  collectAndQueueTriggerReactions,
  collectCostPaymentVanishTriggers,
  type BurstActionRegistrationLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../effect/trigger-system";
import { queuePreFlushGrantedEffectsAndFlushPendingLeaves } from "../zone/pending-leave-flush";
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  GameState,
  MirageData,
  MirageSetState,
  Zone,
} from "../model";

// ─── ヘルパー ───

function getCardInstanceOrThrow(
  state: GameState,
  instanceId: string,
  detail: string
): CardInstance {
  const card = getCardById(state, instanceId);
  if (!card) throw new Error(`${detail}: ${instanceId}`);
  return card;
}

function getCardDefinitionOrThrow(
  definitionId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition {
  const def = getCardDefinitionById(definitionId);
  if (!def) throw new Error(`Unknown card definition: ${definitionId}`);
  return def;
}

// ─── バリデーション ───

export type MirageSetBlockReason =
  | "not_main_step"
  | "not_active_player"
  | "already_set_mirage_this_turn"
  | "source_card_not_found"
  | "source_not_controlled_by_acting_player"
  | "source_not_in_hand"
  | "source_already_set"
  | "source_card_has_no_mirage";

/** 旧セーブのプレイヤー単位使用済みは、ターン境界まで全同名に対して使用済みを維持する。 */
function hasUsedMirageSetCountExemption(
  state: GameState,
  playerId: string,
  cardNo: string
): boolean {
  return state.mirageSetCountExemptionsUsed.some(
    (entry) =>
      entry.playerId === playerId &&
      (entry.cardNo === cardNo || entry.cardNo === "*")
  );
}

/**
 * ミラージュセットがブロックされる理由を返す。ブロックされない場合は null。
 */
export function getMirageSetBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): MirageSetBlockReason | null {
  if (options.state.step !== "main") {
    return "not_main_step";
  }

  if (options.state.activePlayerId !== options.actingPlayerId) {
    return "not_active_player";
  }

  const sourceCard = getCardById(options.state, options.sourceInstanceId);

  if (!sourceCard) {
    return "source_card_not_found";
  }

  if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );

  if (!sourceDefinition || !sourceDefinition.mirageData) {
    return "source_card_has_no_mirage";
  }

  if (
    options.state.mirageSetStates.some(
      (entry) => entry.cardInstanceId === sourceCard.instanceId
    )
  ) {
    return "source_already_set";
  }

  // メインステップでのセットはターン1回制限（効果によるセットはこの制限に含まない）。
  // ENGINE-mirage-set-count-exemption: 手札にある exemptSetCountLimits カードは、
  // 同名の行動数免除を未使用ならこの制限を免除される。セット枠の0枚扱いとは独立する。
  if (
    options.state.mirageSetPlayerIdsThisTurn.includes(options.actingPlayerId) &&
    !(
      sourceDefinition.mirageData.exemptSetCountLimits &&
      isInHandForOwnEffect(
        options.state,
        sourceCard,
        options.actingPlayerId,
        options.getCardDefinitionById
      ) &&
      !hasUsedMirageSetCountExemption(
        options.state,
        options.actingPlayerId,
        sourceDefinition.cardNo
      )
    )
  ) {
    return "already_set_mirage_this_turn";
  }

  // 通常は手札からのみ（手元 set_aside からは不可）。カード個別テキストがある場合だけトラッシュを許可。
  if (
    !isInHandForOwnEffect(
      options.state,
      sourceCard,
      options.actingPlayerId,
      options.getCardDefinitionById
    ) &&
    !(
      sourceCard.zone === "trash" && sourceDefinition.mirageData.canSetFromTrash
    )
  ) {
    return "source_not_in_hand";
  }

  return null;
}

/**
 * 指定プレイヤーの現在のミラージュセット状態を取得（最初の1件、後方互換用）。
 * ENGINE-mirage-set-count-exemption 以降、プレイヤーは複数のミラージュを
 * セットしうる（[[getPlayerMirageSetStates]] 参照）。
 */
export function getPlayerMirageSetState(
  state: GameState,
  playerId: string
): MirageSetState | null {
  return state.mirageSetStates.find((s) => s.playerId === playerId) ?? null;
}

/**
 * 指定プレイヤーの現在のミラージュセット状態をすべて取得。
 * 枠を数えるカードは最大1枚。exemptSetCountLimits の各個体は常に0枠。
 */
export function getPlayerMirageSetStates(
  state: GameState,
  playerId: string
): MirageSetState[] {
  return state.mirageSetStates.filter((s) => s.playerId === playerId);
}

// ─── コスト計算 ───

/**
 * ミラージュセットに必要なコスト支払いソースを取得。
 */
export function getAvailableMiragePaymentSources(options: {
  state: GameState;
  actingPlayerId: string;
  mirageData: MirageData;
  sourceInstanceId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): AvailableCardCostPaymentSourcesResult {
  const virtualCard = {
    cost: options.mirageData.cost,
    reductionSymbols: [...options.mirageData.reduction],
  } as CardDefinition;
  return getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: virtualCard,
    ...(options.sourceInstanceId !== undefined
      ? { sourceInstanceId: options.sourceInstanceId }
      : {}),
    // legal action の支払い見積りも実行時と同じカード使用種別で評価する。
    // 種別限定の軽減/軽減上限 CE を fail-open で取りこぼさないために必須。
    useKind: "set_mirage",
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

// ─── セット実行 ───

export interface SetMirageActionResult {
  state: GameState;
  sourceInstanceId: string;
  /**
   * ENGINE-mirage-set-count-exemption: 入れ替えにより手札へ戻ったミラージュカード。
   * 通常セットは0〜1件で、追加時は空配列。効果セットは効果が指定する交換に従う。
   */
  replacedMirageInstanceIds: string[];
  /**
   * ENGINE-mirage-set-card-event-trigger: この useSetMirageAsAction 呼び出し内部で
   * コスト支払い vanish 検出 (collectCostPaymentVanishTriggers) に使った chainId。
   * 呼び出し元が mirage_set 誘発を別途 collectAndQueueTriggerReactions で検出する際、
   * 同じ chainId を渡さないと dedup identity (chainId 込み) が一致せず、コスト支払いで
   * 生じた leave_field 系誘発が二重にキューされる (isChainDedupeEvent 対象イベント)。
   */
  chainId: string;
}

export interface UseSetMirageAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  paymentSources: readonly CardCostPaymentSource[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
  /**
   * 解決済みの交換対象（0件=追加、1件=その個体と交換）。未指定時は追加または唯一の必須交換。
   */
  replacedMirageInstanceIds?: readonly string[];
}
export interface UseEffectSetMirageAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  paymentSources: readonly CardCostPaymentSource[];
  effectAuthorizedSourceZones: readonly Zone[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
  /** 効果解決中に選択した追加（空配列）または交換先1枚。 */
  replacedMirageInstanceIds?: readonly string[];
}

export function canEffectSetMirage(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  effectAuthorizedSourceZones: readonly Zone[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  if (!sourceCard || sourceCard.controllerPlayerId !== options.actingPlayerId) {
    return false;
  }
  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );
  return (
    sourceDefinition?.mirageData !== undefined &&
    options.effectAuthorizedSourceZones.includes(sourceCard.zone) &&
    !options.state.mirageSetStates.some(
      (entry) => entry.cardInstanceId === sourceCard.instanceId
    )
  );
}

/**
 * ENGINE-mirage-set-count-exemption: 新規セットの合法な追加/個別交換候補。
 * （BSTH002-C01「セットしている/手札にあるこのカードは、自分のセット可能枚数に数えない」）。
 * 追加または既存1枚との個別交換。行動数免除の使用済み状態にかかわらず、
 * 交換後の有効枠が1以下となる候補だけを返す。
 */
export function getMirageReplacementChoices(options: {
  state: GameState;
  actingPlayerId: string;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): string[][] {
  const existingMirages = getPlayerMirageSetStates(
    options.state,
    options.actingPlayerId
  );
  const countsSlot = (entry: MirageSetState) => {
    const card = getCardById(options.state, entry.cardInstanceId);
    if (
      !card ||
      card.zone !== "mirage" ||
      card.controllerPlayerId !== options.actingPlayerId
    )
      return 1;
    const def = options.getCardDefinitionById(card.definitionId);
    return def?.mirageData?.exemptSetCountLimits === true ? 0 : 1;
  };
  const sourceSlots = options.sourceDefinition.mirageData?.exemptSetCountLimits
    ? 0
    : 1;
  const candidates: string[][] = [
    [],
    ...existingMirages
      .filter((entry) => {
        const card = getCardById(options.state, entry.cardInstanceId);
        return (
          card?.zone === "mirage" &&
          card.controllerPlayerId === options.actingPlayerId
        );
      })
      .map((entry) => [entry.cardInstanceId]),
  ];
  return candidates.filter(
    (choice) =>
      sourceSlots +
        existingMirages
          .filter((entry) => !choice.includes(entry.cardInstanceId))
          .reduce((count, entry) => count + countsSlot(entry), 0) <=
      1
  );
}

/** すべてのwriterで、選択済みの追加/交換を同じ現在盤面に対して検証する。 */
export function resolveMirageReplacementSelection(options: {
  state: GameState;
  actingPlayerId: string;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  replacedMirageInstanceIds?: readonly string[];
}): string[] {
  if (!options.sourceDefinition.mirageData)
    throw new Error("Source card has no mirage data");
  const choices = getMirageReplacementChoices(options);
  const selected =
    options.replacedMirageInstanceIds ??
    (choices.length === 1 ? choices[0] : undefined);
  if (
    !selected ||
    !choices.some(
      (choice) =>
        choice.length === selected.length &&
        choice.every((id, i) => id === selected[i])
    )
  )
    throw new Error("Invalid mirage replacement selection");
  return [...selected];
}

export function getMirageReplacementChoiceLabel(
  state: GameState,
  playerId: string,
  choice: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string {
  if (choice.length === 0) return "追加";
  const id = choice[0]!;
  const card = getCardById(state, id);
  const name = card
    ? getCardDefinitionById(card.definitionId)?.name
    : undefined;
  const index = getPlayerMirageSetStates(state, playerId).findIndex(
    (s) => s.cardInstanceId === id
  );
  return `${name ?? "ミラージュ"}（セット${index + 1}）と入れ替え`;
}

/**
 * 複数枚の効果セットも順に計画する。盤面・支払い・誘発はまだ変更しない。
 * 未選択の複数候補で止め、既存のchoice UIに渡す。前段選択は仮盤面だけへ適用する。
 */
export function planMirageSetReplacements(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceIds: readonly string[];
  replacementsByInstanceId?: Readonly<Record<string, readonly string[]>>;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): {
  replacementsByInstanceId: Record<string, string[]>;
  unresolved?: {
    sourceInstanceId: string;
    choices: string[][];
    state: GameState;
  };
} {
  if (
    new Set(options.sourceInstanceIds).size !== options.sourceInstanceIds.length
  )
    throw new Error("Duplicate effect mirage sources");
  let preview = options.state;
  const replacementsByInstanceId: Record<string, string[]> = {};
  for (const id of options.sourceInstanceIds) {
    const source = getCardInstanceOrThrow(
      preview,
      id,
      "Unknown effect mirage source card"
    );
    if (source.controllerPlayerId !== options.actingPlayerId)
      throw new Error("Effect mirage source is not controlled");
    const def = getCardDefinitionOrThrow(
      source.definitionId,
      options.getCardDefinitionById
    );
    if (!def.mirageData)
      throw new Error("Effect mirage source has no mirage data");
    if (preview.mirageSetStates.some((s) => s.cardInstanceId === id)) {
      if (options.replacementsByInstanceId?.[id]?.length)
        throw new Error("Cannot replace mirages with an already set source");
      replacementsByInstanceId[id] = [];
      continue;
    }
    const choices = getMirageReplacementChoices({
      ...options,
      state: preview,
      sourceDefinition: def,
    });
    const selected =
      options.replacementsByInstanceId?.[id] ??
      (choices.length === 1 ? choices[0] : undefined);
    if (selected === undefined && choices.length > 1)
      return {
        replacementsByInstanceId,
        unresolved: { sourceInstanceId: id, choices, state: preview },
      };
    const replacement = resolveMirageReplacementSelection({
      ...options,
      state: preview,
      sourceDefinition: def,
      ...(selected !== undefined
        ? { replacedMirageInstanceIds: selected }
        : {}),
    });
    replacementsByInstanceId[id] = replacement;
    preview = replaceCardInstances(
      {
        ...preview,
        mirageSetStates: [
          ...preview.mirageSetStates.filter(
            (s) => !replacement.includes(s.cardInstanceId)
          ),
          { playerId: options.actingPlayerId, cardInstanceId: id },
        ],
      },
      preview.cardInstances.map((card) =>
        card.instanceId === id
          ? { ...card, zone: "mirage" as const }
          : replacement.includes(card.instanceId)
            ? { ...card, zone: "hand" as const }
            : card
      )
    );
  }
  return { replacementsByInstanceId };
}

export function getMirageHandReturnNoIncreaseInfo(
  state: GameState,
  returnedMirageInstanceIds: readonly string[]
): { countsByOwner: Map<string, number>; logs: string[] } {
  const countsByOwner = new Map<string, number>();
  const logs: string[] = [];
  for (const instanceId of returnedMirageInstanceIds) {
    const card = getCardById(state, instanceId);
    if (!card) continue;
    countsByOwner.set(
      card.ownerPlayerId,
      (countsByOwner.get(card.ownerPlayerId) ?? 0) + 1
    );
    logs.push(
      `mirage:hand-return-no-increase:${card.ownerPlayerId}:${instanceId}`
    );
  }
  return { countsByOwner, logs };
}

function flushMirageChainPendingLeavesAndCollectReactions(options: {
  state: GameState;
  chainId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const scopedPendingLeaves = options.state.pendingLeaveEntities.filter(
    (pendingLeave) => pendingLeave.chainId === options.chainId
  );
  if (scopedPendingLeaves.length === 0) return options.state;

  const otherPendingLeaves = options.state.pendingLeaveEntities.filter(
    (pendingLeave) => pendingLeave.chainId !== options.chainId
  );
  const scopedState: GameState = {
    ...options.state,
    pendingLeaveEntities: scopedPendingLeaves,
  };
  const scopedAfterFlush = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
    state: scopedState,
    chainId: options.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (scopedAfterFlush === scopedState) return options.state;

  const afterFlush: GameState = {
    ...scopedAfterFlush,
    pendingLeaveEntities: [
      ...otherPendingLeaves,
      ...scopedAfterFlush.pendingLeaveEntities,
    ],
  };
  return collectAndQueueTriggerReactions({
    beforeState: options.state,
    afterState: afterFlush,
    source: "action_resolution",
    chainId: options.chainId,
    causedByPlayerId: options.actingPlayerId,
    causedBySourceInstanceId: options.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

interface PreparedSetMirageDeclaration {
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  reduction: ReturnType<typeof calculateAccelChangeReduction>;
  replacedMirageInstanceIds: string[];
  keepBothMirages: boolean;
  exemptionConsumed: boolean;
  chainId: string;
}

function prepareSetMirageDeclaration(
  options: UseSetMirageAsActionOptions
): PreparedSetMirageDeclaration {
  const blockReason = getMirageSetBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Cannot set mirage: ${blockReason}: sourceInstanceId=${options.sourceInstanceId}`
    );
  }

  const sourceCard = getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown mirage source card"
  );
  const sourceDefinition = getCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  const mirageData = sourceDefinition.mirageData!;

  const reduction = calculateAccelChangeReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cost: mirageData.cost,
    reductionSymbols: mirageData.reduction,
    useKind: "set_mirage",
    sourceInstanceId: sourceCard.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });

  assertMatchingPaymentAmount(reduction, options.paymentSources);

  const existingMirages = getPlayerMirageSetStates(
    options.state,
    options.actingPlayerId
  );
  const choices = getMirageReplacementChoices({ ...options, sourceDefinition });
  const selected =
    options.replacedMirageInstanceIds ??
    choices.find((choice) => choice.length === 0) ??
    (choices.length === 1 ? choices[0] : undefined);
  if (
    !selected ||
    !choices.some(
      (choice) =>
        choice.length === selected.length &&
        choice.every((id, index) => id === selected[index])
    )
  ) {
    throw new Error("Invalid mirage replacement selection");
  }
  const replacedMirageInstanceIds = [...selected];
  const keepBothMirages = selected.length === 0 && existingMirages.length > 0;
  const exemptionConsumed =
    isInHandForOwnEffect(
      options.state,
      sourceCard,
      options.actingPlayerId,
      options.getCardDefinitionById
    ) &&
    mirageData.exemptSetCountLimits === true &&
    !hasUsedMirageSetCountExemption(
      options.state,
      options.actingPlayerId,
      sourceDefinition.cardNo
    );
  const chainId = `mirage:${options.state.turnNumber}:${options.actingPlayerId}:${sourceCard.instanceId}`;

  return {
    sourceCard,
    sourceDefinition,
    reduction,
    replacedMirageInstanceIds,
    keepBothMirages,
    exemptionConsumed,
    chainId,
  };
}

function paySetMirageDeclarationCost(
  options: UseSetMirageAsActionOptions,
  prepared: PreparedSetMirageDeclaration
): GameState {
  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `mirage:declare:${prepared.chainId}:${prepared.sourceCard.instanceId}:${prepared.sourceDefinition.cardNo}`,
      `mirage:reduction:${prepared.chainId}:${prepared.reduction.reducedCost}:${prepared.reduction.totalReduction}`,
    ],
  };

  const beforePaymentState = currentState;
  currentState = applyCardCostPayments({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId: prepared.chainId,
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  currentState = collectCostPaymentVanishTriggers({
    beforeState: beforePaymentState,
    afterState: currentState,
    chainId: prepared.chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return {
    ...currentState,
    log: [
      ...currentState.log,
      `mirage:cost-paid:${prepared.chainId}:${options.actingPlayerId}:${getTotalPaymentAmount(options.paymentSources)}`,
    ],
  };
}

export function useEffectSetMirageAsAction(
  options: UseEffectSetMirageAsActionOptions
): SetMirageActionResult {
  if (!canEffectSetMirage(options)) {
    throw new Error(
      "Cannot effect-set mirage: source is not controlled, has no mirage data, or is outside the authorized zone"
    );
  }
  const sourceCard = getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown effect mirage source card"
  );
  const sourceDefinition = getCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  const reduction = calculateAccelChangeReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cost: sourceDefinition.mirageData!.cost,
    reductionSymbols: sourceDefinition.mirageData!.reduction,
    useKind: "set_mirage",
    sourceInstanceId: sourceCard.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  assertMatchingPaymentAmount(reduction, options.paymentSources);
  const replacedMirageInstanceIds = resolveMirageReplacementSelection({
    ...options,
    sourceDefinition,
  });
  const chainId =
    "mirage:effect:" +
    options.state.turnNumber +
    ":" +
    options.actingPlayerId +
    ":" +
    sourceCard.instanceId;
  const paidState = paySetMirageDeclarationCost(options, {
    sourceCard,
    sourceDefinition,
    reduction,
    replacedMirageInstanceIds,
    keepBothMirages: false,
    exemptionConsumed: false,
    chainId,
  });
  const state = resolveSetMiragePlacement({
    state: paidState,
    actingPlayerId: options.actingPlayerId,
    sourceInstanceId: sourceCard.instanceId,
    replacedMirageInstanceIds,
    keepBothMirages: false,
    exemptionConsumed: false,
    countsAsMirageSetAction: false,
    chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return {
    state,
    sourceInstanceId: sourceCard.instanceId,
    replacedMirageInstanceIds,
    chainId,
  };
}

function resolveSetMiragePlacement(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  replacedMirageInstanceIds: readonly string[];
  keepBothMirages: boolean;
  exemptionConsumed: boolean;
  chainId: string;
  countsAsMirageSetAction: boolean;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  if (!sourceCard) {
    return {
      ...options.state,
      log: [
        ...options.state.log,
        `mirage:effect-fizzled:${options.chainId}:source-missing`,
      ],
    };
  }
  const sourceDefinition = getCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  const replacedMirageInstanceIdSet = new Set(
    options.replacedMirageInstanceIds
  );
  const handReturnNoIncrease = getMirageHandReturnNoIncreaseInfo(
    options.state,
    options.replacedMirageInstanceIds
  );
  const wasAlreadySetThisTurn =
    options.state.mirageSetPlayerIdsThisTurn.includes(options.actingPlayerId);

  let currentState = moveCardZone(
    options.state,
    options.sourceInstanceId,
    "mirage",
    getDefaultZoneRoleName(sourceDefinition, "mirage")
  );
  for (const id of options.replacedMirageInstanceIds) {
    const card = getCardById(currentState, id);
    if (!card) continue;
    const def = options.getCardDefinitionById(card.definitionId);
    currentState = moveCardZone(
      currentState,
      id,
      "hand",
      def ? getDefaultZoneRoleName(def, "hand") : "spirit-card"
    );
  }

  currentState = {
    ...currentState,
    mirageSetStates: [
      ...currentState.mirageSetStates.filter(
        (s) =>
          s.playerId !== options.actingPlayerId ||
          !replacedMirageInstanceIdSet.has(s.cardInstanceId)
      ),
      {
        playerId: options.actingPlayerId,
        cardInstanceId: options.sourceInstanceId,
      },
    ],
    mirageSetPlayerIdsThisTurn:
      options.countsAsMirageSetAction &&
      !options.exemptionConsumed &&
      !wasAlreadySetThisTurn
        ? [...currentState.mirageSetPlayerIdsThisTurn, options.actingPlayerId]
        : currentState.mirageSetPlayerIdsThisTurn,
    mirageSetCountExemptionsUsed:
      options.countsAsMirageSetAction && options.exemptionConsumed
        ? [
            ...currentState.mirageSetCountExemptionsUsed.filter(
              (entry) =>
                entry.playerId !== options.actingPlayerId ||
                entry.cardNo !== sourceDefinition.cardNo
            ),
            {
              playerId: options.actingPlayerId,
              cardNo: sourceDefinition.cardNo,
            },
          ]
        : currentState.mirageSetCountExemptionsUsed,
    log: [
      ...currentState.log,
      ...handReturnNoIncrease.logs,
      ...options.replacedMirageInstanceIds.map(
        (id) =>
          `mirage:replace:${options.actingPlayerId}:${id}->${options.sourceInstanceId}`
      ),
      ...(options.keepBothMirages
        ? [
            `mirage:keep-both:${options.actingPlayerId}:${options.sourceInstanceId}`,
          ]
        : []),
      ...(options.exemptionConsumed
        ? [
            `mirage:exemption-used:${options.actingPlayerId}:${sourceDefinition.cardNo}`,
          ]
        : []),
      `mirage:set:${options.actingPlayerId}:${options.sourceInstanceId}:${sourceDefinition.cardNo}`,
    ],
  };

  return flushMirageChainPendingLeavesAndCollectReactions({
    state: currentState,
    chainId: options.chainId,
    actingPlayerId: options.actingPlayerId,
    sourceInstanceId: sourceCard.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

export interface SetMirageInStackContextResult extends SetMirageActionResult {
  activeStack: ActiveStack;
}

export function useSetMirageInStackContextAsAction(
  options: UseSetMirageAsActionOptions
): SetMirageInStackContextResult {
  const prepared = prepareSetMirageDeclaration(options);
  const stateAfterCost = paySetMirageDeclarationCost(options, prepared);
  const activeStack: ActiveStack = {
    stackId: `stack:${prepared.chainId}`,
    actionKind: "set_mirage",
    chainId: prepared.chainId,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: prepared.sourceCard.instanceId,
    cardDefinitionId: prepared.sourceCard.definitionId,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: prepared.reduction.reducedCost,
    totalReduction: prepared.reduction.totalReduction,
    satisfiedReductionSymbolCount:
      prepared.reduction.satisfiedReductionSymbolCount,
    requiredReductionSymbolCount:
      prepared.reduction.requiredReductionSymbolCount,
    finalCost: prepared.reduction.finalCost,
    costForFilter:
      prepared.reduction.effectiveCost ?? prepared.reduction.printedCost,
    sourceActivationZone:
      prepared.sourceCard.zone === "trash" ? "trash" : "hand",
    ...(prepared.sourceCard.zone === "deck"
      ? { sourcePhysicalZone: "deck" as const }
      : {}),
    mirageReplacedInstanceIds: prepared.replacedMirageInstanceIds,
    mirageKeepExistingMirages: prepared.keepBothMirages,
    mirageSetCountExemptionConsumed: prepared.exemptionConsumed,
    normalHandPlayRollback: {
      ...buildNormalHandPlayPaidCoreDelta({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        paymentSources: options.paymentSources,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
      ...captureNormalHandPlayDeclarationRollbackDelta({
        beforeState: options.state,
        afterState: stateAfterCost,
      }),
      // ミラージュは宣言時にin_useへ動かさない。応答による元カードの移動を復元しない。
      sourceCards: [],
    },
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  return {
    state: stateAfterCost,
    activeStack,
    sourceInstanceId: options.sourceInstanceId,
    replacedMirageInstanceIds: prepared.replacedMirageInstanceIds,
    chainId: prepared.chainId,
  };
}

export function resolveDeferredSetMirageStack(options: {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const { activeStack } = options;
  if (activeStack.isNullified) {
    return {
      ...options.state,
      log: [
        ...options.state.log,
        `mirage:nullified:${activeStack.chainId}:${activeStack.cardInstanceId}`,
      ],
    };
  }

  const sourceCard = getCardById(options.state, activeStack.cardInstanceId);
  if (
    !sourceCard ||
    !(activeStack.sourceActivationZone === "hand"
      ? isInHandForOwnEffect(
          options.state,
          sourceCard,
          activeStack.actingPlayerId,
          options.getCardDefinitionById
        )
      : sourceCard.zone === activeStack.sourceActivationZone) ||
    sourceCard.pendingLeaveKind !== null
  ) {
    return {
      ...options.state,
      log: [
        ...options.state.log,
        `mirage:effect-fizzled:${activeStack.chainId}:source-unavailable`,
      ],
    };
  }

  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );
  const selected = activeStack.mirageReplacedInstanceIds ?? [];
  // 03f: 応答側の移動完了後に再検査する。離れた交換先を別ゾーンから引き戻さず、
  // 新しいカードへ勝手に交換先を変えない。残る通常枠が1以下のときだけ部分解決する。
  const currentReplacementIds = selected.filter((id) => {
    const card = getCardById(options.state, id);
    return (
      card?.zone === "mirage" &&
      card.controllerPlayerId === activeStack.actingPlayerId &&
      options.state.mirageSetStates.some(
        (entry) =>
          entry.playerId === activeStack.actingPlayerId &&
          entry.cardInstanceId === id
      )
    );
  });
  const choices = sourceDefinition?.mirageData
    ? getMirageReplacementChoices({
        state: options.state,
        actingPlayerId: activeStack.actingPlayerId,
        sourceDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    : [];
  if (
    selected.length > 1 ||
    !choices.some(
      (choice) =>
        choice.length === currentReplacementIds.length &&
        choice.every((id, index) => id === currentReplacementIds[index])
    )
  ) {
    const rolledBack = rollbackNormalHandPlayAfterStack(options);
    return {
      ...rolledBack,
      log: [
        ...rolledBack.log,
        `mirage:declaration-illegal:${activeStack.chainId}:replacement-capacity`,
      ],
    };
  }
  const beforeMirageState = options.state;
  const afterMirageState = resolveSetMiragePlacement({
    state: beforeMirageState,
    actingPlayerId: activeStack.actingPlayerId,
    sourceInstanceId: activeStack.cardInstanceId,
    replacedMirageInstanceIds: currentReplacementIds,
    keepBothMirages: activeStack.mirageKeepExistingMirages === true,
    exemptionConsumed: activeStack.mirageSetCountExemptionConsumed === true,
    countsAsMirageSetAction: true,
    chainId: activeStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  return collectAndQueueTriggerReactions({
    beforeState: beforeMirageState,
    afterState: afterMirageState,
    source: "action_resolution",
    chainId: activeStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: activeStack.actingPlayerId,
    causedBySourceInstanceId: activeStack.cardInstanceId,
  });
}

/**
 * ミラージュセットを実行する。
 *
 * 1. バリデーション
 * 2. コスト支払い（リザーブ → トラッシュ）
 * 3. 既存ミラージュの入れ替え（旧カードは手札に戻る、手札増加扱いではない）
 * 4. カードを手札/トラッシュ → ミラージュゾーンへ移動
 * 5. ミラージュセット状態を登録
 * 6. ターン内セット済みフラグを記録
 */
export function useSetMirageAsAction(
  options: UseSetMirageAsActionOptions
): SetMirageActionResult {
  const declared = useSetMirageInStackContextAsAction(options);
  const currentState = resolveDeferredSetMirageStack({
    state: declared.state,
    activeStack: declared.activeStack,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return {
    state: currentState,
    sourceInstanceId: options.sourceInstanceId,
    replacedMirageInstanceIds: declared.replacedMirageInstanceIds,
    chainId: declared.chainId,
  };
}

// ─── ミラージュ除去（効果による破棄時） ───

/**
 * ミラージュカードがゾーンを離れたとき、mirageSetStates からも除去する。
 * フィールド離脱系の共通パイプラインから呼ばれる。
 */
export function removeMirageSetState(
  state: GameState,
  cardInstanceId: string
): GameState {
  const mirageState = state.mirageSetStates.find(
    (s) => s.cardInstanceId === cardInstanceId
  );
  if (!mirageState) return state;

  return {
    ...state,
    mirageSetStates: state.mirageSetStates.filter(
      (s) => s.cardInstanceId !== cardInstanceId
    ),
    log: [
      ...state.log,
      `mirage:removed:${mirageState.playerId}:${cardInstanceId}`,
    ],
  };
}

// ─── ミラージュ無償セット（効果由来） ───

/**
 * コストを支払わずにミラージュとしてセットする（BSGE01-M04「デッキを上から5枚オープン。
 * その中のミラージュ効果を持つ緑/青のカードをコストを支払わずにセットし」）。
 * useSetMirageAsAction からコスト支払い/手札限定/メインステップ限定/ターン1回制限を除いた
 * bookkeeping のみの版。呼び出し側で対象カードの zone を既に "mirage" へ更新済みであることを
 * 前提とする（deck_reveal の pick destination 割り当てと同じ classification パスを再利用するため、
 * ここでは既存ミラージュの手札復帰と mirageSetStates の更新のみ行う）。
 * 既存ミラージュが手札に戻る際は handCount を実手札枚数に合わせる。
 * 「手札増加扱いではない」分は mirage:hand-return-no-increase ログで
 * hand_increase トリガーから除外する。
 */
export function applyFreeMirageSetBookkeeping(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  replacedMirageInstanceIds?: readonly string[]
): GameState {
  const allExistingMirages = getPlayerMirageSetStates(state, actingPlayerId);
  const alreadySet = allExistingMirages.some(
    (s) => s.cardInstanceId === sourceInstanceId
  );
  if (alreadySet) return state;
  const sourceCard = getCardInstanceOrThrow(
    state,
    sourceInstanceId,
    "Unknown free mirage source card"
  );
  if (
    sourceCard.controllerPlayerId !== actingPlayerId ||
    sourceCard.zone !== "mirage"
  )
    throw new Error("Free mirage source is not controlled or not in mirage");
  const sourceDefinition = getCardDefinitionOrThrow(
    sourceCard.definitionId,
    getCardDefinitionById
  );
  const replacement = resolveMirageReplacementSelection({
    state,
    actingPlayerId,
    sourceDefinition,
    getCardDefinitionById,
    ...(replacedMirageInstanceIds !== undefined
      ? { replacedMirageInstanceIds }
      : {}),
  });
  const replacedSet = new Set(replacement);
  const handReturnNoIncrease = getMirageHandReturnNoIncreaseInfo(
    state,
    replacement
  );

  const currentState: GameState = replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) => {
      if (!replacedSet.has(c.instanceId)) return c;
      const replacedDef = getCardDefinitionById(c.definitionId);
      return {
        ...c,
        zone: "hand" as const,
        zoneRoleName: replacedDef
          ? getDefaultZoneRoleName(replacedDef, "hand")
          : "spirit-card",
      };
    })
  );

  const sourceDef = getCardDefinitionById(
    getCardInstanceOrThrow(
      state,
      sourceInstanceId,
      "Unknown free mirage source card"
    ).definitionId
  );

  return {
    ...currentState,
    mirageSetStates: [
      ...currentState.mirageSetStates.filter(
        (s) =>
          s.playerId !== actingPlayerId || !replacedSet.has(s.cardInstanceId)
      ),
      ...(alreadySet
        ? []
        : [{ playerId: actingPlayerId, cardInstanceId: sourceInstanceId }]),
    ],
    log: [
      ...currentState.log,
      ...handReturnNoIncrease.logs,
      ...replacement.map(
        (id) => `mirage:replace:${actingPlayerId}:${id}->${sourceInstanceId}`
      ),
      `mirage:set:${actingPlayerId}:${sourceInstanceId}:${sourceDef?.cardNo ?? sourceInstanceId}:free`,
    ],
  };
}
