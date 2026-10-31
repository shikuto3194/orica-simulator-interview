import {
  drawCardsToHand,
  replaceCardInstances,
} from "../zone/card-instance-state";
import { isCardInEffectZone } from "./card-access-rules";
// Zone-ops クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// デッキ探索/トラッシュ回収/デッキ送り/バウンス/手札公開/覗き見/シャッフル/デッキオープン等のゾーン操作実行。

import { recordHandEntries } from "../zone/hand-increase";
import { requireCardZone } from "../model";
import {
  resolveZoneMoveHandGainCost,
  type HandGainCostExecutionOptions,
} from "./hand-gain-cost";
import { matchesCardFilter } from "../card/card-filter";
import { getCardById } from "../card/card-lookup";
import { isEffectFieldEntryRestricted } from "../card/put-card-on-field";
import { moveCardZone, moveDeckCardsToPosition } from "../core/core-system";
import { appendCardRevealDisclosure } from "../public-disclosure";
import {
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import {
  audienceForDeckVisibility,
  clearKnownDeckCardsForPlayer,
  rememberKnownDeckCardsByInstanceIds,
} from "../known-deck";
import {
  getEffectiveCategory,
  hasDiscardOnLeaveRestriction,
} from "../mechanics/act-as-spirit";
import { removeMirageSetState } from "../mechanics/mirage-system";
import { queuePendingLeave } from "../state-based-actions";
import type {
  BounceAction,
  CardColor,
  CardDefinition,
  CardInstance,
  DeckRevealAction,
  DiscardHandAction,
  EffectPreventionLevel,
  GameState,
  PeekDeckAction,
  PendingZoneSelection,
  ReturnFromTrashAction,
  RevealHandAction,
  SearchDeckAction,
  SendToDeckAction,
  ShuffleZoneAction,
  Zone,
} from "../model";
import { adventSourceIdsOf } from "../model";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";
import { recomputeAndRebuildContinuousEffectsForSources } from "./continuous-effect-rebuild";
import {
  isCardLeaveAffectBlockedByResistance,
  isCardZoneEntryAffectBlockedByResistance,
  resolveCardImmunityAffect,
  resolveCardImmunityAffectDecisions,
  appendImmunityProofDisclosures,
  resolveDeckDiscardContainerAffect,
  isDeckDiscardExcludeRedirectActive,
  resolveHandDiscardContainerAffect,
  type CardEffectSource,
} from "./effect-affect-adapter";
import type { TriggerContext } from "./structured-effect-interpreter";
import {
  buildRevealedChoicePending,
  cloneStateForPendingSnapshot,
  getSearchDeckFieldEntryLogEntry,
  isEffectSummonFieldEntry,
  placeCardFromZoneToField,
  resolveCardLeaveGate,
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import { nextPendingSelectionId } from "./structured-effect-sequences";
import {
  findRevealedEffect,
  processMovedToTrashEffects,
} from "./structured-trash-ops";
import type { TargetLockBypassProfile } from "./target-affect-gate";
import { resolveHandTrashSearchCandidates } from "./zone-search-candidates";
import { isHandGainPreventedByOwnEffect } from "./effect-resistance-check";

function isDeckOperationBlockedByImmunity(
  state: GameState,
  deckCards: readonly CardInstance[],
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  effectSource?: CardEffectSource,
  sourcePreventionBypass?: TargetLockBypassProfile
): boolean {
  if (deckCards.length === 0) return false;
  return deckCards.some(
    (card) =>
      resolveCardImmunityAffect(
        state,
        card,
        actingPlayerId,
        sourcePreventionLevel,
        effectSource,
        getCardDefinitionById,
        sourcePreventionBypass
      ).kind !== "allowed"
  );
}

export function executeDraw(
  state: GameState,
  actingPlayerId: string,
  count: number,
  position: "top" | "bottom" = "top",
  options?: {
    mirageSetSourceInstanceId?: string | undefined;
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
    /** 効果の発揮者。省略時は従来どおりドローする本人。 */
    effectControllerPlayerId?: string | undefined;
    effectSource?: CardEffectSource | undefined;
    sourcePreventionLevel?: EffectPreventionLevel | undefined;
    sourcePreventionBypass?: TargetLockBypassProfile | undefined;
  }
): GameState {
  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player || player.deckCount <= 0 || count <= 0) return state;
  if (
    isHandGainPreventedByOwnEffect(
      state,
      actingPlayerId,
      options?.effectControllerPlayerId ?? actingPlayerId
    )
  ) {
    state.log.push(
      `effect:draw:blocked-by-hand-gain-prevention:${actingPlayerId}`
    );
    return state;
  }
  if (!options?.getCardDefinitionById) {
    throw new Error(
      "executeDraw requires getCardDefinitionById to rebuild continuous effects after deck-to-hand movement"
    );
  }

  let blockedByImmunity = false;
  const {
    state: drawnState,
    drawnIds,
    amount: maxDraw,
  } = drawCardsToHand(state, actingPlayerId, count, position, (card) => {
    const blocked = isDeckOperationBlockedByImmunity(
      state,
      [card],
      options.effectControllerPlayerId ?? actingPlayerId,
      options.getCardDefinitionById!,
      options.sourcePreventionLevel ?? "none",
      options.effectSource,
      options.sourcePreventionBypass
    );
    blockedByImmunity ||= blocked;
    return !blocked;
  });
  if (blockedByImmunity) {
    state.log.push(`effect:draw:blocked-by-immunity:${actingPlayerId}`);
  }
  if (maxDraw === 0) return drawnState;

  for (let i = 0; i < maxDraw; i++) {
    state.log.push(`effect:draw:${actingPlayerId}:1`);
  }

  return recordHandEntries(
    state,
    recomputeAndRebuildContinuousEffectsForSources(
      {
        ...drawnState,
        pendingDrawEvents: [
          ...(state.pendingDrawEvents ?? []),
          { playerId: actingPlayerId, amount: maxDraw },
        ],
        mirageSetDrawLog:
          maxDraw > 0 && options.mirageSetSourceInstanceId
            ? [
                ...state.mirageSetDrawLog,
                {
                  playerId: actingPlayerId,
                  sourceInstanceId: options.mirageSetSourceInstanceId,
                  turnNumber: state.turnNumber,
                },
              ]
            : state.mirageSetDrawLog,
      },
      options.getCardDefinitionById,
      drawnIds
    )
  );
}

export function executeReturnFromTrash(
  state: GameState,
  actingPlayerId: string,
  action: ReturnFromTrashAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  effectTiming?: import("../model").EffectTiming,
  /**
   * 操作対象トラッシュ/戻し先デッキの所有プレイヤー。省略時 = actingPlayerId（従来挙動）。
   * 相手トラッシュ操作（SearchZoneAction.player:"opponent"）で actingPlayerId と異なる値が入る。
   */
  targetPlayerId: string = actingPlayerId,
  selectedTargetIds?: readonly string[],
  /**
   * 攻撃側効果の防止レベル (P3-43)。`"unpreventable"` のとき
   * 「相手の効果を受けない」(defense_immune) を貫通する。
   */
  sourcePreventionLevel: import("../model").EffectPreventionLevel = "none",
  /**
   * 発生源スコープ付き「相手の効果を受けない」照合用の発生源カード
   * (実効値照合のため instance も渡す)。
   * トラッシュ束縛 effect_immunity (`while_in_trash`, BSTH002-M01 等) を
   * 相手の return_from_trash で gate するために必要 (sourcePlayerScope:"any" の
   * BSTH04-R01 では自分の return_from_trash も gate される)。
   * needs-dsl: ENGINE-effect-immunity-return-from-trash-gate (2026-06-25 着地)。
   */
  effectSource?: { instance?: CardInstance; definition?: CardDefinition },
  sourcePreventionBypass?: TargetLockBypassProfile,
  handGainCostOptions: HandGainCostExecutionOptions = {}
): GameState {
  // BSRK01-X01 型の「自身の効果で手札を増やせない」は、候補を 0 件にするだけでは
  // effect interpreter が事前記録した action kind を回収できない。完全禁止を
  // machine-readable に記録し、Q29310 の「発揮していない」と同じ経路で扱う。
  if (
    action.destination === "hand" &&
    isHandGainPreventedByOwnEffect(state, targetPlayerId, actingPlayerId)
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:return_from_trash:blocked-by-hand-gain-prevention:${actingPlayerId}:${targetPlayerId}`,
      ],
    };
  }
  // 「(トラッシュにある) このカードは(一切の)効果を受けない」および
  // 「トラッシュにあるこのカードは手札/デッキに戻らない」の gate は
  // canExecuteOptionalStep と共有する候補 helper に集約する。
  let matching = resolveHandTrashSearchCandidates({
    state,
    actingPlayerId,
    zoneOwnerId: targetPlayerId,
    zones: ["trash"],
    ...(action.filter ? { filter: action.filter } : {}),
    getCardDefinitionById,
    sourcePreventionLevel,
    ...(effectSource !== undefined ? { effectSource } : {}),
    // CardFilter.cardName/excludeCardName の "self" 解決用 (effectSource.definition と
    // 同一の発生源カード定義を再利用、SSOT)。BSTH03-C03 accelData「カード名：「X」以外」型。
    ...(effectSource?.definition !== undefined
      ? { sourceDefinition: effectSource.definition }
      : {}),
    ...(sourcePreventionBypass !== undefined ? { sourcePreventionBypass } : {}),
    returnFromTrashDestination: action.destination,
  });
  if (selectedTargetIds !== undefined) {
    const selectedIdSet = new Set(selectedTargetIds);
    matching = matching.filter((card) => selectedIdSet.has(card.instanceId));
  }

  if (matching.length === 0) return state;

  // GUI 選択が必要:
  // - 「N枚まで」(optionalUpTo): 候補が1枚でもあれば 0..count を選ばせる
  // - 通常: 候補 > count かつ count > 0
  const needsSelection =
    action.count > 0 &&
    (action.destination === "hand_or_set_aside_choice"
      ? matching.length > 0
      : action.optionalUpTo === true
        ? matching.length > 0
        : matching.length > action.count);
  if (needsSelection) {
    const sourceCard = sourceInstanceId
      ? getCardById(state, sourceInstanceId)
      : undefined;
    state.log.push(
      `effect:return_from_trash:${actingPlayerId}:pending:${matching.length}candidates`
    );
    return {
      ...state,
      pendingZoneSelection: {
        pendingId: nextPendingSelectionId("zs"),
        actingPlayerId,
        effectActingPlayerId: actingPlayerId,
        sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
        sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
        actionKind: "return_from_trash",
        sourceZone: "trash",
        candidateCardInstanceIds: matching.map((c) => c.instanceId),
        maxCount:
          action.optionalUpTo === true
            ? Math.min(action.count, matching.length)
            : action.count,
        destination: action.destination as PendingZoneSelection["destination"],
        ...(action.destination === "deck" && action.destinationPosition
          ? { destinationPosition: action.destinationPosition }
          : {}),
        ...(targetPlayerId !== actingPlayerId ? { targetPlayerId } : {}),
        ...(sourcePreventionLevel !== "none" ? { sourcePreventionLevel } : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        remainingActions: [],
        effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
        priorStateSnapshot: cloneStateForPendingSnapshot(state),
        // optionalUpTo は常に skip 可 (「戻さない」= 0 枚を選べる)。
        ...(action.optionalUpTo === true
          ? { canSkip: true }
          : action.mandatory
            ? { canSkip: false }
            : {}),
      },
    };
  }

  // 自動選択
  const selected =
    action.count === -1 ? matching : matching.slice(0, action.count);
  const selectedIds = new Set(selected.map((c) => c.instanceId));
  if (action.destination === "hand_or_set_aside_choice") return state;

  const gate = resolveZoneMoveHandGainCost(
    state,
    {
      actingPlayerId,
      sourceInstanceId:
        sourceInstanceId ?? selected[0]?.instanceId ?? "dsl-unknown",
    },
    targetPlayerId,
    selected,
    action.destination,
    getCardDefinitionById,
    { ...handGainCostOptions, effectTiming }
  );
  if (!gate.canGain) return gate.state;
  state = gate.state;

  state.log.push(
    action.destination === "deck"
      ? `effect:return_from_trash:${actingPlayerId}:${selected.length}:deck:${action.destinationPosition ?? "unspecified"}`
      : `effect:return_from_trash:${actingPlayerId}:${selected.length}:${action.destination}`
  );

  // destination === "field": 共通配置プリミティブでフィールドへ配置 (配置時誘発は
  // 呼び出し側の差分検出が自動発火)。
  if (action.destination === "field") {
    let nextState = state;
    for (const c of selected) {
      nextState = placeCardFromZoneToField(
        nextState,
        c.instanceId,
        getCardDefinitionById
      );
      if (getCardById(nextState, c.instanceId)?.zone === "field") {
        nextState.log.push(
          `effect:field_place:return_from_trash:${actingPlayerId}:${c.instanceId}`
        );
      }
    }
    return nextState;
  }

  // destination === "deck": トラッシュ → デッキ（targetPlayerId のデッキ）。
  // デッキ順は cardInstances の配列順（先頭 = top / 末尾 = bottom）。
  // コアは send_to_deck と同様にリザーブへ。
  if (action.destination === "deck") {
    const coresToReserve = selected.reduce(
      (sum, c) => sum + c.normalCoreCount,
      0
    );
    const movedToDeckState: GameState = replaceCardInstances(
      {
        ...state,
        players: state.players.map((p) =>
          p.id === targetPlayerId
            ? {
                ...p,
                reserveNormalCoreCount:
                  p.reserveNormalCoreCount + coresToReserve,
              }
            : p
        ),
      },
      state.cardInstances.map((c) =>
        selectedIds.has(c.instanceId)
          ? applyFaceDownPolicyOnZoneChange(
              {
                ...c,
                zone: "deck" as const,
                normalCoreCount: 0,
                exhaustState: "recovered" as const,
                attachedToInstanceId: null,
                attachedChildrenIds: [],
                underCards: [],
              },
              "deck"
            )
          : c
      )
    );
    return moveDeckCardsToPosition(
      movedToDeckState,
      targetPlayerId,
      selected.map((card) => card.instanceId),
      action.destinationPosition ?? "bottom"
    );
  }

  // destination === "removed_from_game": トラッシュ → 除外（ゲーム外）。
  // ゾーン束縛 effect_immunity の解除や手札/デッキカウントの増減は不要。
  // BSTH08-XX01 effects[1] 【導技：4】の「トラッシュの幻想白/青1枚を除外」に対応。
  if (action.destination === "removed_from_game") {
    return replaceCardInstances(
      {
        ...state,
      },
      state.cardInstances.map((c) =>
        selectedIds.has(c.instanceId)
          ? applyFaceDownPolicyOnZoneChange(
              { ...c, zone: "removed_from_game" as const },
              "removed_from_game"
            )
          : c
      )
    );
  }

  if (action.destination === "set_aside") {
    let nextState = state;
    for (const c of selected) {
      nextState = moveCardZone(nextState, c.instanceId, "set_aside");
    }
    return recomputeAndRebuildContinuousEffectsForSources(
      nextState,
      getCardDefinitionById,
      selectedIds
    );
  }

  // destination === "hand": targetPlayerId の手札へ。
  return recomputeAndRebuildContinuousEffectsForSources(
    replaceCardInstances(
      {
        ...state,
        players: state.players.map((p) =>
          p.id === targetPlayerId ? { ...p } : p
        ),
      },
      state.cardInstances.map((c) =>
        selectedIds.has(c.instanceId) ? { ...c, zone: "hand" as const } : c
      )
    ),
    getCardDefinitionById,
    selectedIds
  );
}

export function executeSearchDeck(
  state: GameState,
  actingPlayerId: string,
  action: SearchDeckAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  effectTiming?: import("../model").EffectTiming,
  selectedTargetIds?: readonly string[],
  handGainCostOptions: HandGainCostExecutionOptions = {}
): GameState {
  const deckPlayerId = action.targetPlayerId ?? actingPlayerId;
  if (
    action.destination === "hand" &&
    isHandGainPreventedByOwnEffect(state, deckPlayerId, actingPlayerId)
  ) {
    state.log.push(
      `effect:search_deck:blocked-by-hand-gain-prevention:${actingPlayerId}:${deckPlayerId}`
    );
    return state;
  }
  const deckCards = state.cardInstances.filter(
    (c) => c.ownerPlayerId === deckPlayerId && c.zone === "deck"
  );

  let matching = deckCards.filter((c) => {
    const def = getCardDefinitionById(c.definitionId);
    if (
      action.destination === "field" &&
      (!def ||
        isEffectFieldEntryRestricted(state, c, def, getCardDefinitionById))
    )
      return false;
    if (!action.filter) return true;
    if (!def) return false;
    return matchesCardFilter(c, def, action.filter, {
      state,
      effectiveTribes: getEffectiveTribes(state, c, def, getCardDefinitionById),
    });
  });
  if (selectedTargetIds !== undefined) {
    const selectedIdSet = new Set(selectedTargetIds);
    matching = matching.filter((card) => selectedIdSet.has(card.instanceId));
  }

  if (matching.length === 0) return state;

  // GUI 選択が必要:
  // - 「N枚まで」(optionalUpTo): 候補が1枚でもあれば 0..count を選ばせる
  // - 通常: 候補 > count かつ count > 0
  const needsSelection =
    action.count > 0 &&
    (action.optionalUpTo === true
      ? matching.length > 0
      : matching.length > action.count);
  if (needsSelection) {
    const sourceCard = sourceInstanceId
      ? getCardById(state, sourceInstanceId)
      : undefined;
    const pendingDestination =
      action.destination === "top_of_deck" ||
      action.destination === "bottom_of_deck"
        ? "deck"
        : action.destination;
    state.log.push(
      `effect:search_deck:${actingPlayerId}:pending:${matching.length}candidates`
    );
    return {
      ...state,
      pendingZoneSelection: {
        pendingId: nextPendingSelectionId("zs"),
        actingPlayerId,
        effectActingPlayerId: actingPlayerId,
        sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
        sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
        actionKind: "search_deck",
        sourceZone: "deck",
        candidateCardInstanceIds: matching.map((c) => c.instanceId),
        maxCount:
          action.optionalUpTo === true
            ? Math.min(action.count, matching.length)
            : action.count,
        destination: pendingDestination as PendingZoneSelection["destination"],
        ...(action.destination === "top_of_deck"
          ? { destinationPosition: "top" as const }
          : action.destination === "bottom_of_deck"
            ? { destinationPosition: "bottom" as const }
            : {}),
        ...(deckPlayerId !== actingPlayerId
          ? { targetPlayerId: deckPlayerId }
          : {}),
        remainingActions: [],
        effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
        priorStateSnapshot: cloneStateForPendingSnapshot(state),
        // optionalUpTo は常に skip 可 (「加えない/戻さない」= 0 枚を選べる)。
        ...(action.optionalUpTo === true
          ? { canSkip: true }
          : action.mandatory
            ? { canSkip: false }
            : {}),
      },
    };
  }

  // 自動選択: 候補 <= count（全候補を選択）
  const selected =
    action.count === -1 ? matching : matching.slice(0, action.count);
  const selectedIds = new Set(selected.map((c) => c.instanceId));
  const destination = action.destination;
  if (destination === "hand") {
    const gate = resolveZoneMoveHandGainCost(
      state,
      {
        actingPlayerId,
        sourceInstanceId:
          sourceInstanceId ?? selected[0]?.instanceId ?? "dsl-unknown",
      },
      deckPlayerId,
      selected,
      destination,
      getCardDefinitionById,
      { ...handGainCostOptions, effectTiming }
    );
    if (!gate.canGain) return gate.state;
    state = gate.state;
  }
  const deckPosition =
    destination === "top_of_deck"
      ? ("top" as const)
      : destination === "bottom_of_deck"
        ? ("bottom" as const)
        : null;

  state.log.push(
    `effect:search_deck:${actingPlayerId}:${selected.length}:${destination}`
  );
  const nextState =
    destination === "field"
      ? selected.reduce((current, card) => {
          const placed = placeCardFromZoneToField(
            current,
            card.instanceId,
            getCardDefinitionById,
            isEffectSummonFieldEntry(getCardDefinitionById(card.definitionId))
              ? "summon"
              : "place"
          );
          if (getCardById(placed, card.instanceId)?.zone === "field") {
            placed.log.push(
              getSearchDeckFieldEntryLogEntry(
                actingPlayerId,
                card.instanceId,
                getCardDefinitionById(card.definitionId)
              )
            );
          }
          return placed;
        }, state)
      : deckPosition !== null
        ? moveDeckCardsToPosition(
            state,
            deckPlayerId,
            selected.map((card) => card.instanceId),
            deckPosition
          )
        : state;
  const resolvedState: GameState = replaceCardInstances(
    {
      ...nextState,
      players: nextState.players.map((p) =>
        p.id === deckPlayerId
          ? {
              ...p,
            }
          : p
      ),
    },
    nextState.cardInstances.map((c) =>
      selectedIds.has(c.instanceId)
        ? { ...c, zone: destination === "hand" ? ("hand" as const) : c.zone }
        : c
    )
  );
  return destination === "hand"
    ? recomputeAndRebuildContinuousEffectsForSources(
        resolvedState,
        getCardDefinitionById,
        selectedIds
      )
    : resolvedState;
}

export function executeBounce(
  state: GameState,
  actingPlayerId: string,
  action: BounceAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  pendingLeaveChainId?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const rawToBounce = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    undefined,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId
  );

  // P3-41: cannot_be_bounced / cannot_leave_field 効果耐性で阻止される対象を除外
  // P3-43: sourcePreventionLevel === "unpreventable" のとき耐性を貫通
  const bounceFilter = resolveCardLeaveGate(
    state,
    rawToBounce,
    "bounce",
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    false,
    "effect",
    sourcePreventionBypass
  );
  for (const card of bounceFilter.blocked) {
    state.log.push(
      `effect:bounce:blocked-by-resistance:${actingPlayerId}:${card.instanceId}`
    );
  }
  let toBounce = bounceFilter.allowed;

  // 移動先ゾーン: 省略時は手札。"set_aside" は「手元に置く」
  // （SBR バウンスの移動先差。10_rules/04_state-based-rules.md）。
  // 手元(set_aside)は handCount に含めない（アクセル等と同じオープンゾーン）。
  const destinationFor = (id: string): "hand" | "set_aside" =>
    action.destinationByCardId?.[id] ?? action.destination ?? "hand";

  // 「相手は、相手の効果で手札を増やせず」: 相手自身が発揮した非交換バウンスだけを
  // 止める。別プレイヤーの効果による手札戻しと手元への移動は対象外（Q12300/Q12301）。
  const handGainBlockedIds = new Set(
    toBounce
      .filter(
        (card) =>
          destinationFor(card.instanceId) === "hand" &&
          isHandGainPreventedByOwnEffect(
            state,
            card.ownerPlayerId,
            actingPlayerId
          )
      )
      .map((card) => card.instanceId)
  );
  if (handGainBlockedIds.size > 0) {
    for (const card of toBounce) {
      if (handGainBlockedIds.has(card.instanceId)) {
        state.log.push(
          `effect:bounce:blocked-by-hand-gain-prevention:${actingPlayerId}:${card.instanceId}`
        );
      }
    }
    toBounce = toBounce.filter(
      (card) => !handGainBlockedIds.has(card.instanceId)
    );
  }
  if (toBounce.length === 0) return state;

  // ENGINE-set-aside-entry-restriction: 移動先が手元 (set_aside) のとき、
  // destination-zone-scoped resistance (cannot_enter_zone) で阻止される対象を
  // 除外する (BSTH08.5-X04「このカードの効果以外で手元に置けない」)。
  // 阻止された対象はバウンスそのものが不成立となり元のゾーンに留まる。
  if (toBounce.some((c) => destinationFor(c.instanceId) === "set_aside")) {
    const entryBlocked = toBounce.filter(
      (c) =>
        destinationFor(c.instanceId) === "set_aside" &&
        isCardZoneEntryAffectBlockedByResistance(
          state,
          c,
          "set_aside",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          sourcePreventionBypass
        )
    );
    if (entryBlocked.length > 0) {
      const entryBlockedIds = new Set(entryBlocked.map((c) => c.instanceId));
      for (const card of entryBlocked) {
        state.log.push(
          `effect:bounce:blocked-by-zone-entry-resistance:${actingPlayerId}:${card.instanceId}`
        );
      }
      toBounce = toBounce.filter((c) => !entryBlockedIds.has(c.instanceId));
    }
    if (toBounce.length === 0) return state;
  }

  const fieldTargets = toBounce.filter((c) => c.zone === "field");
  const fieldTargetIds = new Set(fieldTargets.map((c) => c.instanceId));
  const pendingFieldTargetChildIds = new Set<string>();
  for (const host of fieldTargets) {
    for (const childId of host.attachedChildrenIds) {
      pendingFieldTargetChildIds.add(childId);
    }
  }
  const pendingFieldTargets = fieldTargets.filter(
    (c) => !pendingFieldTargetChildIds.has(c.instanceId)
  );
  const directTargets = toBounce.filter(
    (c) =>
      c.zone !== "field" &&
      !fieldTargetIds.has(c.instanceId) &&
      !pendingFieldTargetChildIds.has(c.instanceId)
  );
  const directTargetIds = new Set(directTargets.map((c) => c.instanceId));

  // engine-deck-derived-clone-spirit: 分身スピリット (discard_on_leave) はバウンスも
  // 手札/手元へ戻らずトラッシュへ強制着地する (07b §5 分身「入れ替えも破棄されるため不可」)。
  const discardRedirectIds = new Set(
    toBounce
      .filter((c) => hasDiscardOnLeaveRestriction(state, c.instanceId))
      .map((c) => c.instanceId)
  );

  // 煌臨元カード一括移動: 直接移動互換用。
  // フィールド対象は pending leave に載せる。即時 zone 移動に落とすと、
  // ブレイヴ分離選択・魂状態置換・煌臨元追従などのフィールド離脱 SSOT を迂回する。
  // 既に離脱 pending の対象は queuePendingLeave の上書き経路で kind/destination を遷移する。
  // (discard_on_leave 対象は元々合体/煌臨できない token のため煌臨元を持たない想定だが、
  //  念のため除外して二重計上を避ける)
  const adventSourceIds = new Set<string>();
  const adventSourceDestinations = new Map<string, "hand" | "set_aside">();
  for (const c of directTargets) {
    if (discardRedirectIds.has(c.instanceId)) continue;
    for (const srcId of adventSourceIdsOf(c)) {
      adventSourceIds.add(srcId);
      adventSourceDestinations.set(srcId, destinationFor(c.instanceId));
    }
  }
  const adventSourceCount = adventSourceIds.size;

  state.log.push(
    ...toBounce.map((c) =>
      discardRedirectIds.has(c.instanceId)
        ? `effect:bounce:${c.instanceId}:discard_on_leave:to_trash`
        : `effect:bounce:${c.instanceId}:to_${destinationFor(c.instanceId)}`
    )
  );
  if (adventSourceCount > 0) {
    state.log.push(
      ...[...adventSourceIds].map(
        (id) =>
          `effect:bounce:advent_sources:[${id}]:to_${adventSourceDestinations.get(id)}`
      )
    );
  }

  let current = state;
  for (const card of pendingFieldTargets) {
    current = queuePendingLeave({
      state: current,
      instanceId: card.instanceId,
      kind: "bounce",
      cause: "effect_resolution",
      chainId:
        pendingLeaveChainId ??
        `effect:bounce:${actingPlayerId}:${card.instanceId}`,
      causePlayerId: actingPlayerId,
      deferZoneMoveUntilChainEnd: false,
      leaveDestination: {
        zone: discardRedirectIds.has(card.instanceId)
          ? "trash"
          : destinationFor(card.instanceId),
      },
      causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      causedByEffectSourcePreventionLevel: sourcePreventionLevel ?? "none",
    });
  }
  if (directTargets.length === 0 && adventSourceIds.size === 0) {
    return current;
  }

  return replaceCardInstances(
    {
      ...current,
      players: current.players.map((p) => {
        if (p.id !== targetPlayerId) return p;
        return {
          ...p,
          // バウンスされたカードのコアはリザーブに戻る
          reserveNormalCoreCount:
            p.reserveNormalCoreCount +
            directTargets.reduce((sum, c) => sum + c.normalCoreCount, 0),
          // 魂状態のカードがバウンスされた場合、soulStateInstanceIds から除去
          soulStateInstanceIds: p.soulStateInstanceIds.filter(
            (id) => !directTargetIds.has(id)
          ),
        };
      }),
    },
    current.cardInstances.map((c) => {
      // 煌臨元カードもバウンス先（手札）に移動
      if (adventSourceIds.has(c.instanceId)) {
        const destination = adventSourceDestinations.get(c.instanceId)!;
        const definitionId =
          c.definitionId !== c.originalDefinitionId
            ? c.originalDefinitionId
            : c.definitionId;
        return applyFaceDownPolicyOnZoneChange(
          {
            ...c,
            definitionId,
            zone: destination,
            normalCoreCount: 0,
            exhaustState: "recovered" as const,
            attachedToInstanceId: null,
            attachedChildrenIds: [],
            underCards: [],
          },
          destination
        );
      }
      if (!directTargetIds.has(c.instanceId)) return c;
      // engine-deck-derived-clone-spirit: discard_on_leave はバウンス先をトラッシュへ強制。
      const actualDestination: Zone = discardRedirectIds.has(c.instanceId)
        ? "trash"
        : destinationFor(c.instanceId);
      // 転醒 A 面自動復帰: B 面でフィールドを離れる場合、definitionId を A 面に戻す
      const definitionId =
        c.definitionId !== c.originalDefinitionId
          ? c.originalDefinitionId
          : c.definitionId;
      return applyFaceDownPolicyOnZoneChange(
        {
          ...c,
          definitionId,
          zone: actualDestination,
          normalCoreCount: 0,
          exhaustState: "recovered" as const,
          attachedToInstanceId: null,
          attachedChildrenIds: [],
          underCards: [],
        },
        actualDestination
      );
    })
  );
}

export function executeDiscardHand(
  state: GameState,
  actingPlayerId: string,
  action: DiscardHandAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  effectTiming?: import("../model").EffectTiming,
  options?: {
    isMandatory?: boolean;
    selectedCardInstanceIds?: readonly string[];
    /**
     * 「N枚まで破棄」= 任意の上限付き範囲 (count: { min: 0, max: N })。
     * true のとき候補が存在すれば常に選択モーダルを出し (matching <= count でも)、
     * 0..min(count, candidates) 枚を任意で破棄させる (canSkip)。
     */
    optionalUpTo?: boolean;
    alternateSelections?: Array<{
      count: number;
      filter?: import("../dsl-types").CardFilter;
      label?: string;
    }>;
    deferMovedToTrashEffects?: boolean;
    sourcePreventionLevel?: EffectPreventionLevel;
    sourcePreventionBypass?: TargetLockBypassProfile;
  }
): GameState {
  const targetPlayerId = action.targetPlayer
    ? resolvePlayerRef(actingPlayerId, action.targetPlayer, state)
    : actingPlayerId;
  const fromZone = action.fromZone ?? "hand";
  const isDeckMill = fromZone === "deck";
  // ENGINE-composite-heterogeneous-removal-budget: mirage 破棄 (BSTH09-X01) は
  // 手札破棄耐性 (prevent_hand_discard) の対象外 (deck ミルと同じ扱い、下記ゲート参照)。
  const isMirageZone = fromZone === "mirage";
  const allTargetHandCards = state.cardInstances.filter((c) => {
    if (c.ownerPlayerId !== targetPlayerId) return false;
    if (
      options?.selectedCardInstanceIds &&
      !options.selectedCardInstanceIds.includes(c.instanceId)
    )
      return false;
    const zones =
      fromZone === "hand_or_set_aside"
        ? (["hand", "set_aside"] as const)
        : [fromZone];
    return action.physicalHandOnly
      ? zones.includes(c.zone as never)
      : isCardInEffectZone(
          state,
          c,
          zones,
          actingPlayerId,
          getCardDefinitionById
        );
  });

  // デッキ上からのミル破棄 (fromZone:"deck") は明示的な discard primitive なので
  // prevent_deck_discard CE の対象。単なる move_card deck→trash とは区別する。
  if (
    isDeckMill &&
    resolveDeckDiscardContainerAffect(
      state,
      targetPlayerId,
      getCardDefinitionById,
      options?.sourcePreventionLevel,
      options?.sourcePreventionBypass
    ).kind !== "allowed"
  ) {
    state.log.push(
      `effect:discard_deck:${targetPlayerId}:immune:no-discardable`
    );
    return state;
  }

  // 手札破棄耐性 (prevent_hand_discard CE)。acting プレイヤーが保護対象の相手のとき
  // だけ、ゲート (handCountMax / minSourceCores) が成立する間、対象の手札カードを
  // 破棄対象から除外する。自分自身の効果による手札破棄 (コストの自捨て等) は止めない。
  // ゲートは解決直前 (この消費時点) で再評価する動的判定。BSFT01-C03/C04。
  // デッキ上からのミル破棄 (fromZone:"deck") / ミラージュ破棄 (fromZone:"mirage") は
  // 手札ではないため対象外。
  const handDiscardDecision =
    isDeckMill || isMirageZone
      ? { kind: "allowed" as const }
      : resolveHandDiscardContainerAffect(
          state,
          targetPlayerId,
          actingPlayerId,
          allTargetHandCards.length,
          getCardDefinitionById,
          options?.sourcePreventionLevel,
          options?.sourcePreventionBypass
        );
  if (handDiscardDecision.kind !== "allowed") {
    // 全カードが耐性で守られているため破棄対象なし = no-op。
    state.log.push(
      `effect:discard_hand:${targetPlayerId}:immune:no-discardable`
    );
    return state;
  }
  const sourceCard = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : undefined;
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  // discard primitive の deck 経路も真のデッキ破棄である。redirect はこの後の
  // source/destination immunity と最終着地の双方で一度だけ決定し、pending 選択へも渡す。
  const deckDiscardDestination: Zone =
    isDeckMill &&
    action.destination !== "deck_bottom" &&
    isDeckDiscardExcludeRedirectActive(state, targetPlayerId)
      ? "removed_from_game"
      : "trash";
  const targetZoneCardCount = allTargetHandCards.length;
  const immunityResults = isDeckMill
    ? []
    : resolveCardImmunityAffectDecisions(
        state,
        allTargetHandCards,
        actingPlayerId,
        options?.sourcePreventionLevel,
        { instance: sourceCard, definition: sourceDefinition },
        getCardDefinitionById,
        options?.sourcePreventionBypass
      );
  const handCards = isDeckMill
    ? allTargetHandCards
    : immunityResults
        .filter((result) => result.decision.kind === "allowed")
        .map((result) => result.card);

  const cardMatchesFilter = (
    c: GameState["cardInstances"][number],
    filter?: import("../dsl-types").CardFilter
  ): boolean => {
    if (!filter) return true;
    const def = getCardDefinitionById(c.definitionId);
    if (!def) return false;
    return matchesCardFilter(c, def, filter, {
      state,
      getCardDefinitionById,
      effectiveCategory: getEffectiveCategory(state, c, def),
      effectiveColors: getEffectiveColors(state, c, def),
    });
  };

  const matching = handCards.filter((c) => cardMatchesFilter(c, action.filter));

  // 破棄枚数の正源 effectiveCount を一本化する。
  //  - targetHandSize 指定時:「手札が N 枚になるように破棄」= max(0, handCount - N)。
  //    handCount は対象ゾーンの手札総数 (handCards.length)。既に N 枚以下なら 0 = no-op。
  //    capCount 指定時は算出した破棄枚数に上限を適用
  //    キャップとして min() に併用する。action.count は既存カード群が
  //    -1/0 を「無視される placeholder」として使う既存慣習があるため上限判定には使わない。
  //  - 未指定時: 従来どおり action.count (-1 = 全捨て)。
  // 以降の選択判定・maxCount・slice はすべて effectiveCount を参照する (SSOT)。
  const effectiveCount =
    action.targetHandSize !== undefined
      ? action.capCount !== undefined
        ? Math.min(
            action.capCount,
            Math.max(0, targetZoneCardCount - action.targetHandSize)
          )
        : Math.max(0, targetZoneCardCount - action.targetHandSize)
      : action.count;

  // 所有者が必要枚数を捨てられるなら、残す耐性カードを公開する必要はない。
  // 不足分の証明、全破棄、確定済み対象の解決時だけ公開する (Q16303)。
  if (
    !isDeckMill &&
    options?.optionalUpTo !== true &&
    effectiveCount !== 0 &&
    (effectiveCount === -1 ||
      matching.length < effectiveCount ||
      options?.selectedCardInstanceIds !== undefined)
  ) {
    state = appendImmunityProofDisclosures(
      state,
      immunityResults.filter((result) =>
        cardMatchesFilter(result.card, action.filter)
      ),
      sourceInstanceId
    );
  }

  // 「デッキの上からN枚」は耐性による候補除外より先に取得ウィンドウを固定する。
  // 上位の保護カードを飛ばしてN枚目の外側を破棄候補にしてはならない。
  const deckDiscardWindow = isDeckMill
    ? effectiveCount === -1
      ? matching
      : matching.slice(0, effectiveCount)
    : [];
  const discardableDeckCards = deckDiscardWindow.filter(
    (card) =>
      !isDeckOperationBlockedByImmunity(
        state,
        [card],
        actingPlayerId,
        getCardDefinitionById,
        options?.sourcePreventionLevel ?? "none",
        {
          ...(sourceCard ? { instance: sourceCard } : {}),
          ...(sourceDefinition ? { definition: sourceDefinition } : {}),
        },
        options?.sourcePreventionBypass
      )
  );
  if (
    isDeckMill &&
    deckDiscardWindow.length > 0 &&
    discardableDeckCards.length === 0
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:discard_deck:${targetPlayerId}:immune:no-discardable`,
      ],
    };
  }

  // alt 用の matching 計算（primary candidates と独立）
  const altSelections = (options?.alternateSelections ?? [])
    .map((alt) => {
      const altMatching = handCards.filter((c) =>
        cardMatchesFilter(c, alt.filter)
      );
      return {
        count: alt.count,
        candidateInstanceIds: altMatching.map((c) => c.instanceId),
        ...(alt.label ? { label: alt.label } : {}),
        ...(alt.filter ? { filter: alt.filter } : {}),
      };
    })
    .filter((a) => a.candidateInstanceIds.length >= a.count);

  // primary・alt 双方候補ゼロなら no-op
  if (matching.length === 0 && altSelections.length === 0) return state;

  // 選択モーダルが必要な条件:
  //  - 任意の上限付き範囲 (optionalUpTo): 候補が1枚でもあれば 0..max を選ばせる
  //    (matching <= count でも「破棄しない」を選べるため常に提示)。
  //  - primary が選択肢を要する (matching > count)
  //  - もしくは alt が存在する（OR 形式の選択を提示する必要あり）
  // unseen (「内容を見ないで破棄」) は所有者に選択権を与えないため、選択モーダルを
  // 生成せず強制破棄の自動確定経路 (matching.slice) に落とす。
  // デッキ上からのミル破棄 (isDeckMill) は「上からN枚まで」の任意上限 (optionalUpTo)
  // のときだけ選択モーダルを出す（0..N の枚数選択、候補は下記で先頭 effectiveCount 枚に
  // 絞る）。固定枚数 (optionalUpTo なし) は従来どおり強制確定経路のまま
  // (BSKB01-C01/C03 等の既存挙動を変えない)。
  const needsSelection =
    options?.selectedCardInstanceIds === undefined &&
    (!isDeckMill || options?.optionalUpTo === true) &&
    action.unseen !== true &&
    effectiveCount !== -1 &&
    effectiveCount > 0 &&
    (options?.optionalUpTo === true
      ? (isDeckMill ? discardableDeckCards : matching).length > 0
      : matching.length > effectiveCount || altSelections.length > 0);

  if (needsSelection) {
    // primary 候補は手札全体（alt フィルタも primary 候補のサブセット前提）。
    // primary が action.filter を持つ場合は matching を使う。filter 無しなら handCards 全体。
    // デッキミルは「上から」位置固定のため、候補を先頭 effectiveCount 枚だけに絞る
    // (matching 全体をそのまま渡すとデッキ中の任意カードを選べてしまう)。
    const primaryCandidates = (
      isDeckMill ? discardableDeckCards : matching
    ).map((c) => c.instanceId);
    const selectionPlayerId =
      action.selectionPlayer === "effect_controller"
        ? actingPlayerId
        : targetPlayerId;
    state.log.push(
      `effect:discard_hand:${targetPlayerId}:pending:${primaryCandidates.length}candidates${altSelections.length > 0 ? `+${altSelections.length}alt` : ""}`
    );
    return {
      ...state,
      pendingZoneSelection: {
        pendingId: nextPendingSelectionId("zs"),
        actingPlayerId: selectionPlayerId,
        sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
        sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
        effectActingPlayerId: actingPlayerId,
        targetPlayerId,
        actionKind: "discard_hand",
        sourceZone: (fromZone === "hand_or_set_aside"
          ? "hand"
          : fromZone) as PendingZoneSelection["sourceZone"],
        candidateCardInstanceIds: primaryCandidates,
        // 任意上限は候補数を超えられない (手札 < max なら手札枚数が実効上限)。
        maxCount:
          options?.optionalUpTo === true
            ? Math.min(effectiveCount, primaryCandidates.length)
            : effectiveCount,
        // 行き先: 通常は trash。`deck_bottom` 指定時はデッキの下へ戻す（BSRK01-C03）。
        // デッキ破棄→除外 redirect 中は pending 解決後も実着地を保つ。
        destination:
          action.destination === "deck_bottom"
            ? "deck_bottom"
            : isDeckMill
              ? (deckDiscardDestination as PendingZoneSelection["destination"])
              : "trash",
        ...(action.suppressMovedToTrashEffects === true
          ? { suppressMovedToTrashEffects: true }
          : {}),
        ...(options?.deferMovedToTrashEffects === true
          ? { deferMovedToTrashEffects: true }
          : {}),
        ...(options?.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: options.sourcePreventionLevel }
          : {}),
        ...(options?.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: options.sourcePreventionBypass }
          : {}),
        remainingActions: [],
        effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
        priorStateSnapshot: state,
        // optionalUpTo は常に skip 可 (「破棄しない」= 0 枚を選べる)。
        ...(options?.optionalUpTo === true
          ? { canSkip: true }
          : options?.isMandatory !== undefined
            ? { canSkip: !options.isMandatory }
            : {}),
        ...(altSelections.length > 0
          ? { alternateSelections: altSelections }
          : {}),
      },
    };
  }

  const toDiscard = isDeckMill
    ? discardableDeckCards
    : effectiveCount === -1
      ? matching
      : matching.slice(0, effectiveCount);
  if (toDiscard.length === 0) return state;
  if (
    isDeckMill &&
    isDeckOperationBlockedByImmunity(
      state,
      toDiscard,
      actingPlayerId,
      getCardDefinitionById,
      options?.sourcePreventionLevel ?? "none",
      {
        ...(sourceCard ? { instance: sourceCard } : {}),
        ...(sourceDefinition ? { definition: sourceDefinition } : {}),
      },
      options?.sourcePreventionBypass
    )
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:discard_deck:${targetPlayerId}:immune:no-discardable`,
      ],
    };
  }

  const discardedIds = new Set(toDiscard.map((c) => c.instanceId));
  const moveDiscardedCards = (
    currentState: GameState,
    destination: import("../model").CardZone
  ): GameState => {
    let nextState = currentState;
    for (const card of toDiscard) {
      nextState = moveCardZone(
        nextState,
        card.instanceId,
        destination,
        undefined
      );
      // ミラージュを対象にした破棄は正当だが、カードがミラージュゾーンを出た時点で
      // セット状態も必ず同時に解除する（08c §ミラージュ）。
      if (card.zone === "mirage") {
        nextState = removeMirageSetState(nextState, card.instanceId);
      }
    }
    return nextState;
  };

  // 行き先: 通常は trash。`deck_bottom` 指定時はデッキの下へ戻す（BSRK01-C03）。
  // executeSendToDeck と同じく zone:deck + コア返却 + 各種付帯リセットを適用する。
  if (action.destination === "deck_bottom") {
    state.log.push(
      ...toDiscard.map(
        (c) =>
          `effect:discard_hand:${targetPlayerId}:deck_bottom:${c.instanceId}`
      )
    );
    const movedState = moveDiscardedCards(state, "deck");
    return moveDeckCardsToPosition(
      replaceCardInstances(
        {
          ...movedState,
        },
        movedState.cardInstances.map((c) =>
          discardedIds.has(c.instanceId)
            ? applyFaceDownPolicyOnZoneChange(
                {
                  ...c,
                  normalCoreCount: 0,
                  exhaustState: "recovered",
                  attachedToInstanceId: null,
                  attachedChildrenIds: [],
                  underCards: [],
                },
                "deck"
              )
            : c
        )
      ),
      targetPlayerId,
      toDiscard.map((c) => c.instanceId),
      "bottom"
    );
  }

  state.log.push(
    `effect:discard_hand:${targetPlayerId}:${isDeckMill ? "deck:" : ""}${toDiscard.length}`
  );
  let result = moveDiscardedCards(state, deckDiscardDestination);

  // redirect 後はトラッシュに置かれていないため、moved_to_trash 自動効果やその抑止/
  // 遅延フラグを処理してはならない。
  if (deckDiscardDestination !== "trash") return result;

  // moved_to_trash の誘発抑止/遅延は、到着先で発揮する常時耐性を止めない。
  if (
    action.suppressMovedToTrashEffects === true ||
    options?.deferMovedToTrashEffects === true
  ) {
    result = recomputeAndRebuildContinuousEffectsForSources(
      result,
      getCardDefinitionById,
      discardedIds
    );
  }

  if (action.suppressMovedToTrashEffects === true) {
    result.log.push(
      `moved_to_trash:suppressed:${targetPlayerId}:${discardedIds.size}`
    );
    return result;
  }

  if (options?.deferMovedToTrashEffects === true) {
    result.log.push(
      `moved_to_trash:deferred:${targetPlayerId}:${discardedIds.size}`
    );
    return result;
  }

  // moved_to_trash 自動効果
  const srcCard = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : undefined;
  const srcDef = srcCard
    ? getCardDefinitionById(srcCard.definitionId)
    : undefined;
  result = processMovedToTrashEffects(
    result,
    [...discardedIds],
    getCardDefinitionById,
    {
      sourceColors: getEffectiveColors(state, srcCard, srcDef),
      sourceTribes: srcDef?.tribe ? srcDef.tribe.split("・") : [],
      ...(srcDef?.name ? { sourceCardName: srcDef.name } : {}),
      ...(srcDef?.printedCategory
        ? { sourceCategory: srcDef.printedCategory }
        : {}),
      ...(srcCard ? { sourcePlayerId: srcCard.controllerPlayerId } : {}),
      fromZone: fromZone === "hand_or_set_aside" ? "hand" : fromZone,
    },
    state
  );

  return result;
}

/**
 * 対象プレイヤーの手札を指定相手に公開する。カードのゾーン移動は伴わない。
 * ログに公開対象の instance ID リストを記録し、GUI はそれを読んで公開表示を行う。
 * 続くステップで破棄/破壊したい場合は、`discard`/`destroy` を後続ステップで組み合わせる。
 */
export function executeRevealHand(
  state: GameState,
  actingPlayerId: string,
  action: RevealHandAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  options?: {
    selectedCardInstanceIds?: readonly string[];
    open?: boolean;
    sourcePreventionLevel?: EffectPreventionLevel;
    sourcePreventionBypass?: TargetLockBypassProfile;
  }
): GameState {
  if (action.count !== undefined && action.count <= 0) return state;
  const targetPlayerId = action.targetPlayer
    ? resolvePlayerRef(actingPlayerId, action.targetPlayer, state)
    : actingPlayerId;

  const allHandCards = state.cardInstances.filter(
    (c) =>
      c.ownerPlayerId === targetPlayerId &&
      isCardInEffectZone(
        state,
        c,
        ["hand"],
        actingPlayerId,
        getCardDefinitionById
      )
  );
  const sourceCard = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : undefined;
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const candidates = allHandCards.filter((c) => {
    if (
      options?.selectedCardInstanceIds &&
      !options.selectedCardInstanceIds.includes(c.instanceId)
    )
      return false;
    if (!action.filter) return true;
    const def = getCardDefinitionById(c.definitionId);
    if (!def) return false;
    return matchesCardFilter(c, def, action.filter, {
      state,
      getCardDefinitionById,
      effectiveCategory: getEffectiveCategory(state, c, def),
      effectiveColors: getEffectiveColors(state, c, def),
    });
  });
  const revealWindow =
    action.count === undefined
      ? candidates
      : candidates.slice(0, Math.floor(action.count));
  const immunityResults = resolveCardImmunityAffectDecisions(
    state,
    revealWindow,
    actingPlayerId,
    options?.sourcePreventionLevel,
    { instance: sourceCard, definition: sourceDefinition },
    getCardDefinitionById,
    options?.sourcePreventionBypass
  );
  state = appendImmunityProofDisclosures(
    state,
    immunityResults,
    sourceInstanceId
  );
  const matching = immunityResults
    .filter((result) => result.decision.kind === "allowed")
    .map((result) => result.card);
  const revealed =
    action.count === undefined
      ? matching
      : matching.slice(0, Math.max(0, Math.floor(action.count)));

  // 手札が空 or フィルタ非マッチ時は no-op（state 不変 → succeeded=false）
  if (revealed.length === 0) return state;

  const ids = revealed.map((c) => c.instanceId).join(",");
  return appendCardRevealDisclosure({
    state: {
      ...state,
      log: [
        ...state.log,
        `effect:reveal_hand:${targetPlayerId}:revealTo=${action.revealTo}:count=${revealed.length}:ids=${ids}`,
      ],
    },
    actorPlayerId: actingPlayerId,
    cardInstanceIds: revealed.map((card) => card.instanceId),
    audience: audienceForDeckVisibility(action.revealTo),
    open: options?.open ?? false,
    sourceInstanceId,
  });
}

/**
 * 対象プレイヤーのデッキ上から N 枚の内容を `revealTo` 指定の相手に開示する。
 * カードのゾーン移動は伴わない（純粋な閲覧）。
 * GUI はログ `effect:peek_deck:...` を読んで上 N 枚の表示を行う。
 * デッキ並び替えが必要な場合は後続ステップで `move_card` 等を組み合わせる。
 */
export function executePeekDeck(
  state: GameState,
  actingPlayerId: string,
  action: PeekDeckAction,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = action.targetPlayer
    ? resolvePlayerRef(actingPlayerId, action.targetPlayer, state)
    : actingPlayerId;

  const deckCards = state.cardInstances.filter(
    (c) => c.ownerPlayerId === targetPlayerId && c.zone === "deck"
  );
  const peeked = deckCards.slice(0, Math.max(0, action.count));

  // デッキが空 or count<=0 の場合は no-op (state 不変 → succeeded=false)
  if (peeked.length === 0) return state;
  if (getCardDefinitionById) {
    const sourceCard = sourceInstanceId
      ? getCardById(state, sourceInstanceId)
      : undefined;
    const sourceDefinition = sourceCard
      ? getCardDefinitionById(sourceCard.definitionId)
      : undefined;
    if (
      isDeckOperationBlockedByImmunity(
        state,
        peeked,
        actingPlayerId,
        getCardDefinitionById,
        sourcePreventionLevel,
        {
          ...(sourceCard ? { instance: sourceCard } : {}),
          ...(sourceDefinition ? { definition: sourceDefinition } : {}),
        },
        sourcePreventionBypass
      )
    ) {
      return {
        ...state,
        log: [
          ...state.log,
          `effect:peek_deck:${targetPlayerId}:immune:no-peekable`,
        ],
      };
    }
  }

  const peekedIds = peeked.map((c) => c.instanceId);
  const ids = peekedIds.join(",");
  const nextState = {
    ...state,
    log: [
      ...state.log,
      `effect:peek_deck:${targetPlayerId}:revealTo=${action.revealTo}:count=${peeked.length}:ids=${ids}`,
    ],
  };
  return rememberKnownDeckCardsByInstanceIds({
    state: appendCardRevealDisclosure({
      state: nextState,
      actorPlayerId: actingPlayerId,
      cardInstanceIds: peekedIds,
      audience: audienceForDeckVisibility(action.revealTo),
      open: false,
      sourceInstanceId,
    }),
    playerId: targetPlayerId,
    instanceIds: peekedIds,
    audience: audienceForDeckVisibility(action.revealTo),
    actorPlayerId: actingPlayerId,
  });
}

/**
 * 指定ゾーン内のカード順序を Fisher-Yates でランダム化する。
 * cardInstances 配列の順序がデッキ順を表すため、対象ゾーンに属するエントリの
 * 占有スロットを保ったまま、その内訳のみを置換する。
 *
 * 0 / 1 枚では順序は変えない。デッキの既知位置は枚数にかかわらず忘却する。
 */
export function executeShuffleZone(
  state: GameState,
  actingPlayerId: string,
  action: ShuffleZoneAction
): GameState {
  const targetPlayerId = action.targetPlayer
    ? resolvePlayerRef(actingPlayerId, action.targetPlayer, state)
    : actingPlayerId;

  const inZoneIndices: number[] = [];
  state.cardInstances.forEach((c, idx) => {
    if (c.ownerPlayerId === targetPlayerId && c.zone === action.zone) {
      inZoneIndices.push(idx);
    }
  });

  if (inZoneIndices.length <= 1)
    return action.zone === "deck"
      ? clearKnownDeckCardsForPlayer(state, targetPlayerId)
      : state;

  const shuffledOrder = inZoneIndices.map((i) => state.cardInstances[i]!);
  for (let i = shuffledOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledOrder[i], shuffledOrder[j]] = [
      shuffledOrder[j]!,
      shuffledOrder[i]!,
    ];
  }

  const next = state.cardInstances.slice();
  inZoneIndices.forEach((origIdx, k) => {
    next[origIdx] = shuffledOrder[k]!;
  });

  const shuffledState = replaceCardInstances(
    {
      ...state,
      log: [
        ...state.log,
        `effect:shuffle_zone:${targetPlayerId}:zone=${action.zone}:count=${inZoneIndices.length}`,
      ],
    },
    next
  );
  return action.zone === "deck"
    ? clearKnownDeckCardsForPlayer(shuffledState, targetPlayerId)
    : shuffledState;
}

export function executeSendToDeck(
  state: GameState,
  actingPlayerId: string,
  action: SendToDeckAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  pendingLeaveChainId?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const rawToSend = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    undefined,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId
  );

  // P3-41: cannot_be_sent_to_deck / cannot_leave_field 効果耐性で阻止される対象を除外
  // P3-43: sourcePreventionLevel === "unpreventable" のとき耐性を貫通
  // 「フィールドに残させない」指定時は cannot_leave_field だけ貫通し、
  // cannot_be_sent_to_deck は維持する。
  const pierceCannotLeaveField = action.pierceCannotLeaveField === true;
  const sendFilter = resolveCardLeaveGate(
    state,
    rawToSend,
    "send_to_deck",
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    pierceCannotLeaveField,
    "effect",
    sourcePreventionBypass
  );
  for (const card of sendFilter.blocked) {
    state.log.push(
      `effect:send_to_deck:blocked-by-resistance:${actingPlayerId}:${card.instanceId}`
    );
  }
  const toSend = sendFilter.allowed;
  if (toSend.length === 0) return state;

  const piercedInstanceIds = new Set<string>();
  if (pierceCannotLeaveField) {
    for (const card of toSend) {
      if (
        isCardLeaveAffectBlockedByResistance(
          state,
          card,
          "send_to_deck",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          false,
          sourcePreventionBypass
        )
      ) {
        piercedInstanceIds.add(card.instanceId);
      }
    }
  }

  const fieldTargetChildIdsToFollowHost = new Set<string>();
  for (const card of toSend) {
    if (card.zone !== "field") continue;
    for (const childId of card.attachedChildrenIds) {
      fieldTargetChildIdsToFollowHost.add(childId);
    }
  }
  const fieldTargets = toSend.filter(
    (card) =>
      card.zone === "field" &&
      !fieldTargetChildIdsToFollowHost.has(card.instanceId)
  );
  const nonFieldTargets = toSend.filter((card) => card.zone !== "field");
  let current = state;
  for (const card of fieldTargets) {
    if (piercedInstanceIds.has(card.instanceId)) {
      current.log.push(
        `effect:send_to_deck:cannot-leave-field-pierced:${actingPlayerId}:${card.instanceId}`
      );
    }
    current.log.push(
      `effect:send_to_deck:${card.instanceId}:${action.position}:pending`
    );
    current = queuePendingLeave({
      state: current,
      instanceId: card.instanceId,
      kind: "bounce",
      cause: "effect_resolution",
      chainId:
        pendingLeaveChainId ??
        `effect:send_to_deck:${actingPlayerId}:${card.instanceId}`,
      causePlayerId: actingPlayerId,
      deferZoneMoveUntilChainEnd: false,
      leaveDestination: { zone: "deck", position: action.position },
      ...(pierceCannotLeaveField ? { preventStayOnField: true } : {}),
      causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      causedByEffectSourcePreventionLevel: sourcePreventionLevel ?? "none",
    });
  }

  if (nonFieldTargets.length === 0) return current;

  const sentIds = new Set(nonFieldTargets.map((c) => c.instanceId));

  // 煌臨元カード一括移動: デッキに戻されるカードの煌臨元もデッキに戻す
  const adventSourceIds = new Set<string>();
  for (const c of nonFieldTargets) {
    for (const srcId of adventSourceIdsOf(c)) adventSourceIds.add(srcId);
  }
  const movedCards = new Map<string, CardInstance>();
  for (const c of current.cardInstances) {
    if (sentIds.has(c.instanceId) || adventSourceIds.has(c.instanceId)) {
      movedCards.set(c.instanceId, c);
    }
  }
  // 枚数は末尾のreplaceCardInstancesが移動元・移動先から同期する。
  const reserveByPlayer = new Map<string, number>();
  for (const c of movedCards.values()) {
    if (sentIds.has(c.instanceId) && c.normalCoreCount > 0) {
      const reservePlayerId =
        action.target.player === "either"
          ? c.controllerPlayerId
          : targetPlayerId;
      reserveByPlayer.set(
        reservePlayerId,
        (reserveByPlayer.get(reservePlayerId) ?? 0) + c.normalCoreCount
      );
    }
  }
  const resetForDeck = (card: CardInstance): CardInstance =>
    applyFaceDownPolicyOnZoneChange(
      {
        ...card,
        zone: "deck" as const,
        controllerPlayerId: card.ownerPlayerId,
        normalCoreCount: 0,
        exhaustState: "recovered" as const,
        attachedToInstanceId: null,
        attachedChildrenIds: [],
        underCards: [],
      },
      "deck"
    );
  const movedIds = new Set([...sentIds, ...adventSourceIds]);
  const movedDeckCardsByOwner = new Map<string, CardInstance[]>();
  for (const card of movedCards.values()) {
    const cards = movedDeckCardsByOwner.get(card.ownerPlayerId) ?? [];
    cards.push(resetForDeck(card));
    movedDeckCardsByOwner.set(card.ownerPlayerId, cards);
  }
  const deckCardsByOwner = new Map<string, CardInstance[]>();
  const nonMovedCards = current.cardInstances.filter(
    (card) => !movedIds.has(card.instanceId)
  );
  for (const card of nonMovedCards) {
    if (card.zone !== "deck") continue;
    const cards = deckCardsByOwner.get(card.ownerPlayerId) ?? [];
    cards.push(card);
    deckCardsByOwner.set(card.ownerPlayerId, cards);
  }
  const emittedDeckOwners = new Set<string>();
  const cardInstances: CardInstance[] = [];
  for (const card of nonMovedCards) {
    if (card.zone !== "deck") {
      cardInstances.push(card);
      continue;
    }
    const ownerPlayerId = card.ownerPlayerId;
    if (emittedDeckOwners.has(ownerPlayerId)) continue;
    emittedDeckOwners.add(ownerPlayerId);
    const existingDeckCards = deckCardsByOwner.get(ownerPlayerId) ?? [];
    const movedDeckCards = movedDeckCardsByOwner.get(ownerPlayerId) ?? [];
    if (action.position === "top") {
      cardInstances.push(...movedDeckCards, ...existingDeckCards);
    } else {
      cardInstances.push(...existingDeckCards, ...movedDeckCards);
    }
  }
  for (const [ownerPlayerId, movedDeckCards] of movedDeckCardsByOwner) {
    if (!emittedDeckOwners.has(ownerPlayerId)) {
      cardInstances.push(...movedDeckCards);
    }
  }

  current.log.push(
    ...nonFieldTargets.map(
      (c) => `effect:send_to_deck:${c.instanceId}:${action.position}`
    )
  );
  return replaceCardInstances(
    {
      ...current,
      players: current.players.map((p) => {
        const reserveGain = reserveByPlayer.get(p.id) ?? 0;
        return reserveGain > 0
          ? {
              ...p,
              reserveNormalCoreCount: p.reserveNormalCoreCount + reserveGain,
            }
          : p;
      }),
    },
    cardInstances
  );
}

/**
 * deck_reveal の remainder（手札に取らなかったオープンカード）を、ordering フェーズ
 * （プレイヤーによる戻し順選択）を出さずに即確定してよいかを判定する SSOT。
 *
 * - 0 枚: 確定すべきものが無い。
 * - `"trash"`: 行き先がトラッシュなら置き順に意味が無い（P3-93 GUI 整合 — テキスト上
 *   意味を持たない選択を出さない）。
 * - 1 枚 かつ `"top_or_bottom"` / `"top_bottom_split"` 以外: 配置先も順序も一意に定まる。
 *
 * `"top"` / `"bottom"` / `"top_or_bottom"` / `"top_bottom_split"` で 2 枚以上は
 * デッキ上/下の並び順や配置が意味を持つため選択を出す。
 */
export function shouldAutoFinalizeDeckRevealRemainder(
  remainder:
    | "top"
    | "bottom"
    | "top_or_bottom"
    | "top_bottom_split"
    | "bottom_or_trash"
    | "trash",
  remainingCount: number
): boolean {
  if (remainingCount === 0) return true;
  if (remainder === "trash") return true;
  if (
    remainingCount === 1 &&
    remainder !== "bottom_or_trash" &&
    remainder !== "top_or_bottom" &&
    remainder !== "top_bottom_split"
  ) {
    return true;
  }
  return false;
}

export function executeDeckReveal(
  state: GameState,
  actingPlayerId: string,
  action: DeckRevealAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): GameState {
  // オープン対象プレイヤー（action.targetPlayer 指定時は対戦相手等）。選択は常に actingPlayerId が行う。
  const targetPlayerId = action.targetPlayer
    ? resolvePlayerRef(actingPlayerId, action.targetPlayer, state)
    : actingPlayerId;
  const revealTo = action.revealTo ?? "both";
  const deckCards = state.cardInstances.filter(
    (c) => c.ownerPlayerId === targetPlayerId && c.zone === "deck"
  );

  // デッキ上からN枚をオープン
  const revealed = deckCards.slice(0, action.revealCount);
  if (revealed.length === 0) return state;

  const revealedIds = revealed.map((c) => c.instanceId);
  const sourceCard = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : undefined;

  // ソースカードの実効色を取得（trigger_colors 判定用、08c:166）
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (
    isDeckOperationBlockedByImmunity(
      state,
      revealed,
      actingPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      {
        ...(sourceCard ? { instance: sourceCard } : {}),
        ...(sourceDef ? { definition: sourceDef } : {}),
      },
      sourcePreventionBypass
    )
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:deck_reveal:${targetPlayerId}:immune:no-revealable`,
      ],
    };
  }
  const sourceColors: CardColor[] = getEffectiveColors(
    state,
    sourceCard,
    sourceDef
  );
  // trigger_tribes 評価用: オープンを行った効果のソースカードの系統。
  const sourceTribes: string[] = sourceDef?.tribe
    ? sourceDef.tribe.split("・")
    : [];

  state = appendCardRevealDisclosure({
    state,
    actorPlayerId: actingPlayerId,
    cardInstanceIds: revealedIds,
    audience: audienceForDeckVisibility(revealTo),
    open: true,
    sourceInstanceId,
  });

  // 各 revealed カードの revealed 効果を検査
  const mandatoryActions: Array<{
    id: string;
    name: string;
    disposition: import("../model").RevealedDisposition;
  }> = [];
  const optionalActions: Array<{
    id: string;
    disposition: import("../model").RevealedDisposition;
  }> = [];
  const blockedDispositionByInstanceId: Record<
    string,
    import("../model").RevealedDisposition
  > = {};

  const revealedUsageGroupByInstanceId: Record<string, string> = {};
  const triggerCtx: TriggerContext = {
    sourceColors,
    sourceTribes,
    ...(sourceDef?.name ? { sourceCardName: sourceDef.name } : {}),
    ...(sourceDef?.printedCategory
      ? { sourceCategory: sourceDef.printedCategory }
      : {}),
    ...(sourceCard ? { sourcePlayerId: sourceCard.controllerPlayerId } : {}),
    fromZone: "deck",
  };
  // 「オープンしたカードの効果は発揮されない」(BSAZ01-CX01[4] 等): suppressRevealedEffects
  // 指定時は revealed disposition の自動発火/手札追加を一切評価しない。
  if (!action.suppressRevealedEffects && revealTo === "both") {
    for (const card of revealed) {
      const def = getCardDefinitionById(card.definitionId);
      if (!def) continue;
      const match = findRevealedEffect(
        state,
        card.instanceId,
        def,
        getCardDefinitionById,
        triggerCtx
      );
      if (!match) continue;
      // All self-set bursts owned by one player compete for the same physical
      // slot. Reuse the shared exclusive-choice group consumed by UI and input
      // validation; a usage limit on the card would change its printed text.
      const exclusiveGroup =
        match.disposition.kind === "set_as_burst"
          ? JSON.stringify(["burst_set_slot", card.ownerPlayerId])
          : match.noDuplicateKey;
      if (exclusiveGroup !== undefined) {
        revealedUsageGroupByInstanceId[card.instanceId] = exclusiveGroup;
      }
      if (match.disposition.kind === "blocked") {
        blockedDispositionByInstanceId[card.instanceId] = match.disposition;
        continue;
      }
      if (match.executionMode === "mandatory") {
        mandatoryActions.push({
          id: card.instanceId,
          name: def.name,
          disposition: match.disposition,
        });
      } else {
        optionalActions.push({
          id: card.instanceId,
          disposition: match.disposition,
        });
      }
    }
  }

  // mandatory カードの ID セット
  const mandatoryIds = mandatoryActions.map((a) => a.id);
  const mandatorySet = new Set(mandatoryIds);
  const remainingRevealedIds = revealedIds.filter(
    (id) => !mandatorySet.has(id)
  );

  // Validate bulk destinations before logging or constructing the new array;
  // this path deliberately does not call moveCardZone for every revealed card.
  const mandatoryDestinations = new Map<string, import("../model").CardZone>();
  for (const { id, disposition } of mandatoryActions) {
    if (disposition.kind === "blocked") continue;
    const dest =
      disposition.kind === "move"
        ? requireCardZone(disposition.destination)
        : "hand";
    mandatoryDestinations.set(id, dest);
  }

  // pending を設定してプレイヤー入力待ちにする
  state.log.push(
    `effect:deck_reveal:${targetPlayerId}:open=${revealed.length}:revealTo=${revealTo}:pending`
  );
  if (mandatoryActions.length > 0) {
    state.log.push(
      `deck_reveal:auto_add:${targetPlayerId}:${mandatoryActions.map((a) => a.name).join(",")}`
    );
  }

  // mandatory カードを disposition に応じて即座にゾーン移動
  const mandatoryExtraZoneEntryIds = [...mandatoryDestinations.entries()]
    .filter(([, zone]) => zone === "hand" || zone === "set_aside")
    .map(([id]) => id);
  const recordMandatoryHandEntries = (result: GameState) =>
    recordHandEntries(state, result, (id) =>
      mandatoryDestinations.get(id) === "hand"
        ? {
            playerId: targetPlayerId,
            sourceInstanceId: id,
            sourceDefinitionId: getCardById(state, id)!.definitionId,
          }
        : undefined
    );

  // zone 更新: mandatory → 各 destination, それ以外 → revealed（オープン中）
  const updatedCardInstances = state.cardInstances.map((c) => {
    const dest = mandatoryDestinations.get(c.instanceId);
    if (dest) {
      return { ...c, zone: dest };
    }
    if (revealedIds.includes(c.instanceId)) {
      return {
        ...c,
        zone: "revealed" as typeof c.zone,
        revealedTo: revealTo,
        revealedByPlayerId: actingPlayerId,
      };
    }
    return c;
  });

  // 全カードが mandatory で消化される場合
  // deckCount はオープン対象プレイヤー（targetPlayerId）から減らす。
  // handCount はカードの owner が targetPlayerId のため、mandatory move destination が "hand" の場合も targetPlayerId の手札に加わる。
  if (
    remainingRevealedIds.length === 0 &&
    optionalActions.length === 0 &&
    !action.beforePickSteps &&
    !action.beforeMoveSteps
  ) {
    const resolvedState: GameState = recordMandatoryHandEntries(
      replaceCardInstances(
        {
          ...state,
          players: state.players.map((p) =>
            p.id === targetPlayerId
              ? {
                  ...p,
                }
              : p
          ),
        },
        updatedCardInstances
      )
    );
    return mandatoryExtraZoneEntryIds.length > 0
      ? recomputeAndRebuildContinuousEffectsForSources(
          resolvedState,
          getCardDefinitionById,
          mandatoryExtraZoneEntryIds
        )
      : resolvedState;
  }

  // remainder="trash" かつ手札に取る pick も任意効果（revealed_choice）も無い場合、
  // 残りオープンカードは順序選択不要でそのままトラッシュへ送る（P3-93: トラッシュ行きに
  // 置き順は無意味。pending を立てると GUI が無意味な戻し順選択を要求してしまう）。
  if (
    action.picks.length === 0 &&
    optionalActions.length === 0 &&
    action.remainder === "trash" &&
    !action.beforePickSteps &&
    !action.beforeMoveSteps
  ) {
    const remainingSet = new Set(remainingRevealedIds);
    const trashedCardInstances = updatedCardInstances.map((c) =>
      remainingSet.has(c.instanceId)
        ? { ...c, zone: "trash" as typeof c.zone }
        : c
    );
    let next: GameState = recordMandatoryHandEntries(
      replaceCardInstances(
        {
          ...state,
          players: state.players.map((p) =>
            p.id === targetPlayerId
              ? {
                  ...p,
                }
              : p
          ),
        },
        trashedCardInstances
      )
    );
    next.log.push(
      `deck_reveal:auto_trash_remainder:${targetPlayerId}:${remainingRevealedIds.length}`
    );
    next = processMovedToTrashEffects(
      next,
      remainingRevealedIds,
      getCardDefinitionById,
      triggerCtx,
      state
    );
    const continuousEffectSourceIds = [
      ...mandatoryExtraZoneEntryIds,
      ...remainingRevealedIds,
    ];
    return continuousEffectSourceIds.length > 0
      ? recomputeAndRebuildContinuousEffectsForSources(
          next,
          getCardDefinitionById,
          continuousEffectSourceIds
        )
      : next;
  }

  // optional 候補がある場合は revealed_choice フェーズ、なければ picking
  const hasOptionalCandidates = optionalActions.length > 0;
  const phase = hasOptionalCandidates
    ? ("revealed_choice" as const)
    : ("picking" as const);

  // optional カードの disposition マップを構築
  const revealedDispositionMap: Record<
    string,
    import("../model").RevealedDisposition
  > = {};
  for (const { id, disposition } of optionalActions) {
    revealedDispositionMap[id] = disposition;
  }
  Object.assign(revealedDispositionMap, blockedDispositionByInstanceId);
  const hasRevealedDispositionMap =
    Object.keys(revealedDispositionMap).length > 0;

  const pendingState: GameState = recordMandatoryHandEntries(
    replaceCardInstances(
      {
        ...state,
        players: state.players.map((p) =>
          p.id === targetPlayerId
            ? {
                ...p,
              }
            : p
        ),
        pendingDeckReveal: buildRevealedChoicePending({
          ...(action.beforePickSteps
            ? { beforePickSteps: action.beforePickSteps }
            : {}),
          ...(action.beforeMoveSteps
            ? { beforeMoveSteps: action.beforeMoveSteps }
            : {}),
          actingPlayerId,
          targetPlayerId,
          sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          revealedCardInstanceIds: remainingRevealedIds,
          originalRevealedCardInstanceIds: revealedIds,
          revealTo,
          picks: action.picks,
          remainder: action.remainder,
          phase,
          origin: "deck",
          priorStateSnapshot: state,
          ...(action.suppressFieldEntryEffects
            ? { suppressFieldEntryEffects: true }
            : {}),
          ...(hasOptionalCandidates
            ? {
                optionalCandidateIds: optionalActions.map((a) => a.id),
                revealedUsageGroupByInstanceId,
              }
            : {}),
          ...(hasRevealedDispositionMap ? { revealedDispositionMap } : {}),
        }),
      },
      updatedCardInstances
    )
  );
  return mandatoryExtraZoneEntryIds.length > 0
    ? recomputeAndRebuildContinuousEffectsForSources(
        pendingState,
        getCardDefinitionById,
        mandatoryExtraZoneEntryIds
      )
    : pendingState;
}
