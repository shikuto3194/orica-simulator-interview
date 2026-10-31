import {
  drawCardsToHand,
  replaceCardInstances,
} from "./zone/card-instance-state";
import { allocateRootTriggerChain } from "./chain-id";
import { syncKnownDeckCardsForStateTransition } from "./known-deck";
import {
  moveCardZone,
  applyLifeZeroDefeat,
  refreshExhaustStates,
  refreshTrashCoresToReserve,
  updateCard,
} from "./core/core-system";
import { recomputeBattleEntityBp } from "./battle/battle-shared";
import { finalizeEffectResolution } from "./effect/effect-resolution";
import { clearExpiredEffectOccurrenceRecords } from "./effect/effect-occurrence-gate";
import {
  canUseEffectByUsageLimit,
  clearExpiredEffectUsageRecords,
  getStableEffectLabel,
  isPlayerImmuneToGameLoss,
  recordEffectUsageIfLimited,
  removeExpiredContinuousEffects,
} from "./legal/legal-actions-shared";
import {
  hasEligibleMainStepEndMagicActivation,
  hasEligibleStepEndDivineSkill,
} from "./legal/legal-actions-availability";
import type { MagicActionRegistrationLookup } from "./legal/legal-actions-types";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingDrawStepCostEntry,
} from "./model";
import type {
  CardFilter,
  DrawStepPrepaidDiscardDisposition,
  Effect,
} from "./dsl-types";
import { matchesCardFilter } from "./card/card-filter";
import { takeNextStep } from "./step-progression";
export { getNextStep } from "./step-progression";
import { freshTurnContext, nextTurnNumber } from "./turn-context";
import { getGlobalCEs } from "./card/ce-lookup";
import {
  evaluateApplicability,
  executeEffect,
} from "./effect/effect-interpreter";
import {
  evaluateCondition,
  materializeDeferredTrashOptionalAdds,
  placeCardFromZoneToField,
} from "./effect/structured-effect-interpreter";
import { resolveAmountToNumber } from "./effect/native-target-resolution";
import { createStepExecutionContext } from "./step-execution-context";
import {
  collectAndQueueTriggerReactions,
  queuePendingReactionsFromTriggerEvents,
} from "./effect/trigger-system";
import { advanceAttackDeclarationStateIfReady } from "./legal/attack-burst-flow";
import {
  recomputeAndRebuildContinuousEffects,
  recomputeAndRebuildContinuousEffectsForSources,
} from "./effect/continuous-effect-rebuild";
import { collectExpiredEffectSuppressionSourceIds } from "./effect/expired-effect-suppression";
import { stabilizeSourcesReleasedByEffectSuppressionExpiry } from "./effect/effect-suppression-expiry-stabilization";
import {
  flushPendingTurnEndExhaustDowngrades,
  startDeferredExtraTurnIfReady,
} from "./effect/structured-state-grants";
import type {
  BurstActionRegistrationLookup,
  CollectedTriggerEvent,
  TriggeredEffectActionRegistrationLookup,
} from "./effect/trigger-system";

/**
 * inline draw-step dispatch (queue を経由しない同期呼び出し) 用の `no_duplicate`
 * per-event scope key。trigger-queue 経路の `PendingTriggeredEffect.pendingId` に相当する
 * turnNumber+activePlayerId+stepSequence から合成する。収集→消費の間は不変、
 * 同一ターンに追加された別ドローステップでは別のキーになる。
 */
function buildDrawStepTriggerEventScopeKey(
  state: GameState,
  activePlayerId: string
): string {
  return `draw-step:${state.turnNumber}:${activePlayerId}:${state.stepSequence ?? 0}`;
}

/**
 * 自分のドローステップで inline 処理する候補の Effect を収集する。
 *
 * - timing: phase / step=draw / whose=self (whose 省略時は self とみなす)
 * - inline: true
 * - applicability / condition / usageLimit を満たす
 *
 * 各エントリは:
 *   - draw_modify ステップ amount を集計してドロー枚数に加算 (プレ)
 *   - 残りステップを `executeEffect({ startFromStepIndex })` で実行 (ポスト)
 *
 * `firstNonDrawModifyStepIndex` は steps 先頭から `draw_modify` 以外が現れる位置。
 */
interface InlineDrawStepEntry {
  card: CardInstance;
  effect: Effect;
  effectIndex: number;
  drawAmount: number;
  firstNonDrawModifyStepIndex: number;
  /**
   * コスト先払い型ドロー枚数修正（model A）の任意前提コスト。0 個なら無条件加算のみ。
   * 各エントリは「手札フィルタ一致カード 1 枚を破棄できれば +bonus」を表す。
   */
  prepaidCosts: Array<{
    bonus: number;
    cardFilter: CardFilter;
    discardDisposition?: DrawStepPrepaidDiscardDisposition;
  }>;
}

function collectInlineDrawStepEntries(
  state: GameState,
  activePlayerId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): InlineDrawStepEntry[] {
  const entries: InlineDrawStepEntry[] = [];
  for (const card of state.cardInstances) {
    if (
      card.zone !== "field" &&
      card.zone !== "mirage" &&
      card.zone !== "burst"
    )
      continue;
    // P3-69: フィールド上の裏向きカードは印字の能力を持たない。
    if (card.zone === "field" && card.faceDown) continue;
    if (card.controllerPlayerId !== activePlayerId) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def?.effects) continue;
    for (let i = 0; i < def.effects.length; i++) {
      const effect = def.effects[i]!;
      if (!effect.inline) continue;
      if (effect.timing.kind !== "phase" || effect.timing.step !== "draw")
        continue;
      if (effect.timing.whose !== undefined && effect.timing.whose !== "self")
        continue;
      if (effect.applicability) {
        if (
          !evaluateApplicability(
            state,
            effect.applicability,
            card.instanceId,
            getCardDefinitionById
          )
        )
          continue;
      }
      if (effect.condition && effect.condition.length > 0) {
        if (
          !evaluateCondition(
            state,
            effect.condition,
            card.instanceId,
            activePlayerId,
            getCardDefinitionById
          )
        )
          continue;
      }
      if (effect.usageLimit) {
        const limits = Array.isArray(effect.usageLimit)
          ? effect.usageLimit
          : [effect.usageLimit];
        const label = getStableEffectLabel("triggered", i, { effectIndex: i });
        const allow = limits.every((u) =>
          canUseEffectByUsageLimit({
            sourceEffect: effect,
            state,
            sourceInstanceId: card.instanceId,
            sourceDefinitionId: card.definitionId,
            getCardDefinitionById,
            effectLabel: label,
            usageLimit: u,
            ...(effect.limitGroupId ? { groupId: effect.limitGroupId } : {}),
            triggerEventScopeKey: buildDrawStepTriggerEventScopeKey(
              state,
              activePlayerId
            ),
          })
        );
        if (!allow) continue;
      }
      let drawAmount = 0;
      let firstNonDrawModify = effect.steps.length;
      const prepaidCosts: Array<{
        bonus: number;
        cardFilter: CardFilter;
        discardDisposition?: DrawStepPrepaidDiscardDisposition;
      }> = [];
      for (let s = 0; s < effect.steps.length; s++) {
        const step = effect.steps[s]!;
        if (step.action.kind === "draw_modify") {
          if (typeof step.action.amount === "number") {
            if (step.action.prepaidCost) {
              // コスト先払い型: システムドロー前に任意コスト判断を解決する（model A）。
              // 無条件 drawAmount には加算せず、prepaidCosts に分離する。
              prepaidCosts.push({
                bonus: step.action.amount,
                cardFilter: step.action.prepaidCost.cardFilter,
                ...(step.action.prepaidCost.discardDisposition
                  ? {
                      discardDisposition:
                        step.action.prepaidCost.discardDisposition,
                    }
                  : {}),
              });
            } else {
              drawAmount += step.action.amount;
            }
          } else if (!step.action.prepaidCost) {
            // 動的 amount (DynamicCount)。「このネクサスのコア4個につきドロー枚数+1」
            // (BSTH003-X01) 型。cores_on(this_card) 等の発動元カード自身基準の量を
            // resolveAmountToNumber (通常 step 実行と同じ chokepoint) で解決する。
            // prepaidCost 併用の動的 amount は現状未使用のため対象外のまま。
            const stepCtx = createStepExecutionContext(state);
            stepCtx.sourceInstanceId = card.instanceId;
            drawAmount += resolveAmountToNumber(
              step.action.amount,
              state,
              activePlayerId,
              stepCtx,
              getCardDefinitionById
            );
          }
        } else {
          firstNonDrawModify = s;
          break;
        }
      }
      entries.push({
        card,
        effect,
        effectIndex: i,
        drawAmount,
        firstNonDrawModifyStepIndex: firstNonDrawModify,
        prepaidCosts,
      });
    }
  }
  return entries;
}

/**
 * コスト先払い型ドロー枚数修正（model A）の任意コストエントリを集める。
 *
 * inline draw-step エントリの prepaidCosts を走査し、手札に破棄候補（cardFilter 一致）が
 * 存在するものだけを `PendingDrawStepCostEntry` に変換する。候補が 0 のコストは支払い不能
 * （= +N 不発）のため pending を立てず黙って無視する。
 *
 * 同名カードによる重複発揮抑止（〔重複不可〕）は本効果の usageLimit per_card_name turn が
 * 担う。sourceDefinitionId 単位の重複排除も usageLimit 付きの効果にだけ適用する。
 */
function collectPendingDrawStepCostEntries(
  state: GameState,
  activePlayerId: string,
  inlineEntries: InlineDrawStepEntry[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): PendingDrawStepCostEntry[] {
  const result: PendingDrawStepCostEntry[] = [];
  const seenDefs = new Set<string>();
  for (const entry of inlineEntries) {
    if (entry.prepaidCosts.length === 0) continue;
    const dedupeByDefinition = entry.effect.usageLimit !== undefined;
    if (dedupeByDefinition && seenDefs.has(entry.card.definitionId)) continue;
    for (const cost of entry.prepaidCosts) {
      const candidateCardInstanceIds = state.cardInstances
        .filter((c) => {
          if (c.ownerPlayerId !== activePlayerId) return false;
          if (c.zone !== "hand") return false;
          const def = getCardDefinitionById(c.definitionId);
          if (!def) return false;
          return matchesCardFilter(c, def, cost.cardFilter);
        })
        .map((c) => c.instanceId);
      if (candidateCardInstanceIds.length === 0) continue;
      if (dedupeByDefinition) {
        seenDefs.add(entry.card.definitionId);
      }
      result.push({
        sourceInstanceId: entry.card.instanceId,
        sourceDefinitionId: entry.card.definitionId,
        effectIndex: entry.effectIndex,
        candidateCardInstanceIds,
        cardFilter: cost.cardFilter,
        bonus: cost.bonus,
        ...(cost.discardDisposition
          ? { discardDisposition: cost.discardDisposition }
          : {}),
      });
    }
  }
  return result;
}

interface DrawStepDrawDeps {
  bonusFromPrepaid: number;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}

/**
 * ドローステップのシステムドロー本体（CE/inline 無条件 draw_modify + prepaid bonus を加算した
 * ドロー → inline ポストステップ → after_draw 発火）を実行する。
 *
 * `bonusFromPrepaid` はコスト先払い型（model A）で支払い済みの追加枚数。通常経路は 0、
 * resolvePendingDrawStepCostChoice からの再開時に確定済み bonus を渡す。
 */
function executeDrawStepDraw(
  state: GameState,
  activePlayerId: string,
  inlineEntries: InlineDrawStepEntry[],
  deps: DrawStepDrawDeps
): GameState {
  let afterState = state;
  let drawStepActualDraw = 0;
  let drawnCardInstanceIds: Set<string> | null = null;
  // 同名カード重複排除を CE 系と inline 系の双方で sourceDefinitionId 単位に行う。
  const seenDrawModifyDefs = new Set<string>();
  let drawCount = 1 + deps.bonusFromPrepaid;
  for (const ce of getGlobalCEs(afterState)) {
    if (ce.modifierTag === "draw_modify" && ce.modifierAmount !== undefined) {
      if (seenDrawModifyDefs.has(ce.sourceDefinitionId)) continue;
      seenDrawModifyDefs.add(ce.sourceDefinitionId);
      drawCount += ce.modifierAmount;
    }
  }
  // inline 効果の無条件 draw_modify ステップ amount を加算（重複排除）
  for (const entry of inlineEntries) {
    if (entry.drawAmount === 0) continue;
    if (seenDrawModifyDefs.has(entry.card.definitionId)) continue;
    seenDrawModifyDefs.add(entry.card.definitionId);
    drawCount += entry.drawAmount;
  }
  drawCount = Math.max(0, drawCount);
  const player = afterState.players.find((p) => p.id === activePlayerId);
  if (player && player.deckCount > 0 && drawCount > 0) {
    const draw = drawCardsToHand(afterState, activePlayerId, drawCount);
    drawStepActualDraw = draw.amount;
    drawnCardInstanceIds = draw.drawnIds;
    afterState = {
      ...draw.state,
      log: [
        ...afterState.log,
        `draw-step:draw:${activePlayerId}:${drawStepActualDraw}`,
      ],
    };
  }
  if (
    drawStepActualDraw > 0 &&
    drawnCardInstanceIds !== null &&
    !afterState.gameResult
  ) {
    afterState = recomputeAndRebuildContinuousEffectsForSources(
      afterState,
      deps.getCardDefinitionById,
      drawnCardInstanceIds
    );
  }

  // 通常ドローも効果ドローと同じ公開知識の更新境界を通す。
  // 神域の上3枚はドロー後効果の解決に入る前に補充される。
  afterState = syncKnownDeckCardsForStateTransition({
    before: state,
    after: afterState,
    actorPlayerId: activePlayerId,
  });

  // inline 効果のポスト実行（システムドロー直後、キューを経由しない）。
  // pending state（zone selection 等）が立った時点で中断し、後続 inline は次ティックに譲る。
  if (
    drawStepActualDraw > 0 &&
    !afterState.gameResult &&
    inlineEntries.length > 0
  ) {
    for (const entry of inlineEntries) {
      if (entry.firstNonDrawModifyStepIndex >= entry.effect.steps.length)
        continue;
      if (
        afterState.pendingZoneSelection !== null ||
        afterState.pendingStepOptionalChoice !== null ||
        afterState.pendingStepChoice !== null ||
        afterState.pendingStepOptionalTargetSelection !== null ||
        afterState.pendingDeckReveal !== null ||
        afterState.pendingCoreShootSelection !== null ||
        afterState.pendingAsIfSoulCoreChoice !== null ||
        afterState.pendingEffectOptionalRepeatChoice !== null ||
        afterState.pendingEffectOptionalRepeatCountSelection !== null ||
        afterState.pendingBorrowedEffectChoice !== null ||
        afterState.pendingBorrowedEffectTargetSelection !== null
      )
        break;
      // usageLimit を先に消費（discard 選択モーダルが立つ前に確定させる）。
      const beforeState = afterState;
      if (entry.effect.usageLimit) {
        const limits = Array.isArray(entry.effect.usageLimit)
          ? entry.effect.usageLimit
          : [entry.effect.usageLimit];
        const label = getStableEffectLabel("triggered", entry.effectIndex, {
          effectIndex: entry.effectIndex,
        });
        for (const u of limits) {
          afterState = recordEffectUsageIfLimited({
            state: afterState,
            sourceInstanceId: entry.card.instanceId,
            sourceDefinitionId: entry.card.definitionId,
            effectLabel: label,
            usageLimit: u,
            ...(entry.effect.limitGroupId
              ? { groupId: entry.effect.limitGroupId }
              : {}),
            triggerEventScopeKey: buildDrawStepTriggerEventScopeKey(
              afterState,
              activePlayerId
            ),
          });
        }
      }
      afterState = executeEffect({
        chainId: `draw-step:${afterState.turnNumber}:${entry.card.instanceId}:${entry.effectIndex}`,
        state: afterState,
        effect: entry.effect,
        effectIndex: entry.effectIndex,
        sourceInstanceId: entry.card.instanceId,
        actingPlayerId: activePlayerId,
        getCardDefinitionById: deps.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          deps.getRegisteredTriggeredEffectActions,
        ...(deps.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: deps.getRegisteredBurstActions }
          : {}),
        startFromStepIndex: entry.firstNonDrawModifyStepIndex,
      });
      afterState = {
        ...afterState,
        log: [
          ...afterState.log,
          `draw-step:inline-effect:${entry.card.instanceId}:effect=${entry.effectIndex}`,
        ],
      };
      afterState = finalizeEffectResolution({
        state: afterState,
        beforeState,
        chainId: `draw-step:${afterState.turnNumber}:${entry.card.instanceId}:${entry.effectIndex}`,
        endLogs: [],
        actingPlayerId: activePlayerId,
        causedBySourceInstanceId: entry.card.instanceId,
        enterFieldCausedByPlayerId: activePlayerId,
        getCardDefinitionById: deps.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          deps.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: deps.getRegisteredBurstActions,
      });
    }
  }

  // ドロー後イベント発火（通常ドローステップ）。
  if (drawStepActualDraw > 0 && !afterState.gameResult) {
    const root = allocateRootTriggerChain(afterState);
    afterState = root.state;
    const afterDrawEvent: CollectedTriggerEvent = {
      actingPlayerId: activePlayerId,
      eventKind: "after_draw",
      source: "step_transition",
      chainId: root.chainId,
      attackId: null,
      relatedPlayerId: activePlayerId,
      relatedInstanceId: null,
      amount: drawStepActualDraw,
      step: "draw",
    };
    afterState = queuePendingReactionsFromTriggerEvents(
      afterState,
      [afterDrawEvent],
      undefined,
      {
        getCardDefinitionById: deps.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          deps.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: deps.getRegisteredBurstActions,
      }
    );
  }
  // Expose deferred trash choices in the state returned by this draw action.
  // Creating one only on the next advance would make that advance throw its
  // pending guard and discard the newly materialized prompt.
  return materializeDeferredTrashOptionalAdds(afterState);
}

function moveDrawStepCostCardAfterPayment(
  state: GameState,
  entry: PendingDrawStepCostEntry,
  discardCardInstanceId: string,
  actingPlayerId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  const disposition = entry.discardDisposition;
  if (!disposition) {
    return moveCardZone(state, discardCardInstanceId, "trash");
  }
  const card = state.cardInstances.find(
    (c) => c.instanceId === discardCardInstanceId
  );
  const def = card ? getCardDefinitionById(card.definitionId) : undefined;
  if (
    !card ||
    !def ||
    disposition.kind !== "move_instead" ||
    disposition.destination !== "field" ||
    !matchesCardFilter(card, def, disposition.ifCardFilter)
  ) {
    return moveCardZone(state, discardCardInstanceId, "trash");
  }

  const normalizedState = updateCard(state, discardCardInstanceId, (c) => ({
    ...c,
    controllerPlayerId: actingPlayerId,
  }));
  const placed = placeCardFromZoneToField(
    normalizedState,
    discardCardInstanceId,
    getCardDefinitionById
  );
  const placedCard = placed.cardInstances.find(
    (c) => c.instanceId === discardCardInstanceId
  );
  if (placedCard?.zone === "field") {
    return {
      ...placed,
      log: [
        ...placed.log,
        `effect:field_place:draw_step_cost:${actingPlayerId}:${discardCardInstanceId}`,
        `draw-step:cost-disposition:${discardCardInstanceId}:field`,
      ],
    };
  }
  return moveCardZone(state, discardCardInstanceId, "trash");
}

function isCurrentDrawStepCostCandidate(
  state: GameState,
  activePlayerId: string,
  entry: PendingDrawStepCostEntry,
  discardCardInstanceId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  if (!entry.candidateCardInstanceIds.includes(discardCardInstanceId)) {
    return false;
  }
  const card = state.cardInstances.find(
    (c) => c.instanceId === discardCardInstanceId
  );
  if (!card || card.ownerPlayerId !== activePlayerId || card.zone !== "hand") {
    return false;
  }
  const def = getCardDefinitionById(card.definitionId);
  return def ? matchesCardFilter(card, def, entry.cardFilter) : false;
}

function refreshRemainingDrawStepCostEntries(
  state: GameState,
  activePlayerId: string,
  entries: PendingDrawStepCostEntry[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): PendingDrawStepCostEntry[] {
  return entries.flatMap((entry) => {
    const candidateCardInstanceIds = entry.candidateCardInstanceIds.filter(
      (candidateId) =>
        isCurrentDrawStepCostCandidate(
          state,
          activePlayerId,
          entry,
          candidateId,
          getCardDefinitionById
        )
    );
    if (candidateCardInstanceIds.length === 0) return [];
    return [{ ...entry, candidateCardInstanceIds }];
  });
}

/**
 * pendingDrawStepCostChoice を解決する（コスト先払い型ドロー枚数修正 model A）。
 *
 * - `pay`: discardCardInstanceId の手札カードをトラッシュへ破棄し、当該エントリの bonus を
 *   resolvedBonus に加算する。
 * - `decline`: 支払わず当該エントリをスキップ（bonus 不加算）。
 *
 * いずれの場合も、残りエントリがあれば pending を更新して継続を待つ。全エントリ解決後に
 * 確定済み bonus を渡してシステムドローを再開する（コスト → ボーナス確定 → システムドロー）。
 */
export function resolvePendingDrawStepCostChoice(
  state: GameState,
  choice: "pay" | "decline",
  discardCardInstanceId: string | undefined,
  deps: {
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
    getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
    getRegisteredBurstActions?: BurstActionRegistrationLookup;
  }
): GameState {
  const pending = state.pendingDrawStepCostChoice;
  if (!pending) return state;
  const entry = pending.entries[0];
  if (!entry) {
    // エントリ枯渇（不変条件違反）。pending を畳んでそのまま返す。
    return { ...state, pendingDrawStepCostChoice: null };
  }

  const activePlayerId = pending.actingPlayerId;
  let afterState = state;
  let resolvedBonus = pending.resolvedBonus;

  if (choice === "pay") {
    if (
      !discardCardInstanceId ||
      !isCurrentDrawStepCostCandidate(
        afterState,
        activePlayerId,
        entry,
        discardCardInstanceId,
        deps.getCardDefinitionById
      )
    ) {
      throw new Error(
        `resolvePendingDrawStepCostChoice: pay requires a valid discard candidate (got ${discardCardInstanceId ?? "undefined"})`
      );
    }
    // usageLimit（〔重複不可〕= per_card_name turn）を支払い確定時に消費する。
    if (entry.effectIndex >= 0) {
      const def = deps.getCardDefinitionById(entry.sourceDefinitionId);
      const effect = def?.effects?.[entry.effectIndex];
      if (effect?.usageLimit) {
        const limits = Array.isArray(effect.usageLimit)
          ? effect.usageLimit
          : [effect.usageLimit];
        const label = getStableEffectLabel("triggered", entry.effectIndex, {
          effectIndex: entry.effectIndex,
        });
        for (const u of limits) {
          afterState = recordEffectUsageIfLimited({
            state: afterState,
            sourceInstanceId: entry.sourceInstanceId,
            sourceDefinitionId: entry.sourceDefinitionId,
            effectLabel: label,
            usageLimit: u,
            ...(effect.limitGroupId ? { groupId: effect.limitGroupId } : {}),
            triggerEventScopeKey: buildDrawStepTriggerEventScopeKey(
              afterState,
              activePlayerId
            ),
          });
        }
      }
    }
    // 手札破棄。条件付きで「トラッシュのかわりに配置」も zone 移動 SSOT 経由で処理する。
    const beforeCostDispositionState = afterState;
    afterState = moveDrawStepCostCardAfterPayment(
      afterState,
      entry,
      discardCardInstanceId,
      activePlayerId,
      deps.getCardDefinitionById
    );
    const beforePaidCard = beforeCostDispositionState.cardInstances.find(
      (c) => c.instanceId === discardCardInstanceId
    );
    const afterPaidCard = afterState.cardInstances.find(
      (c) => c.instanceId === discardCardInstanceId
    );
    if (afterState.pendingMultiPlacement) {
      return {
        ...afterState,
        pendingDrawStepCostChoice: null,
        pendingMultiPlacement: {
          ...afterState.pendingMultiPlacement,
          sourceInstanceId: entry.sourceInstanceId,
          sourceDefinitionId: entry.sourceDefinitionId,
          sourceEffectIndex: entry.effectIndex,
          drawStepResume: {
            ...pending,
            resolvedBonus: resolvedBonus + entry.bonus,
            entries: pending.entries.slice(1),
          },
        },
      };
    }
    if (beforePaidCard?.zone !== "field" && afterPaidCard?.zone === "field") {
      afterState = collectAndQueueTriggerReactions({
        beforeState: beforeCostDispositionState,
        afterState,
        source: "action_resolution",
        chainId: `draw-step:${afterState.turnNumber}:${entry.sourceInstanceId}:${entry.effectIndex}`,
        getCardDefinitionById: deps.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          deps.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: deps.getRegisteredBurstActions,
        causedByPlayerId: activePlayerId,
        causedBySourceInstanceId: entry.sourceInstanceId,
        enterFieldCausedByPlayerId: activePlayerId,
        ...(entry.effectIndex >= 0
          ? { sourceEffectIndex: entry.effectIndex }
          : {}),
      });
    }
    afterState = {
      ...afterState,
      log: [
        ...afterState.log,
        `draw-step:cost-pay:${activePlayerId}:discard=${discardCardInstanceId}:bonus=${entry.bonus}`,
      ],
    };
    resolvedBonus += entry.bonus;
  } else {
    afterState = {
      ...afterState,
      log: [...afterState.log, `draw-step:cost-decline:${activePlayerId}`],
    };
  }

  return resumeDrawStepAfterPlacement(
    afterState,
    { ...pending, resolvedBonus, entries: pending.entries.slice(1) },
    deps
  );
}

export function resumeDrawStepAfterPlacement(
  state: GameState,
  pending: import("./model").PendingDrawStepCostChoice,
  deps: Parameters<typeof resolvePendingDrawStepCostChoice>[3]
): GameState {
  let afterState = state;
  const activePlayerId = pending.actingPlayerId;
  const resolvedBonus = pending.resolvedBonus;
  const remaining = refreshRemainingDrawStepCostEntries(
    afterState,
    activePlayerId,
    pending.entries,
    deps.getCardDefinitionById
  );
  if (remaining.length > 0) {
    return {
      ...afterState,
      pendingDrawStepCostChoice: {
        ...pending,
        resolvedBonus,
        entries: remaining,
      },
    };
  }

  // 全エントリ解決済み → pending を畳んでシステムドローを bonus 付きで再開する。
  afterState = { ...afterState, pendingDrawStepCostChoice: null };
  const inlineEntries = collectInlineDrawStepEntries(
    afterState,
    activePlayerId,
    deps.getCardDefinitionById
  );
  afterState = executeDrawStepDraw(afterState, activePlayerId, inlineEntries, {
    bonusFromPrepaid: resolvedBonus,
    getCardDefinitionById: deps.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      deps.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: deps.getRegisteredBurstActions,
  });

  // ドローステップ後に通常 advanceStep が続行していた処理（start step deck-out 等）は
  // ここでは行わない: pendingDrawStepCostChoice 解決はドローステップ内に留まり、次の
  // advanceStep でリフレッシュ以降へ進む。step は "draw" のまま据え置く。
  return afterState;
}

export function getNextPlayerId(state: GameState): string {
  const currentIndex = state.playerOrder.indexOf(state.activePlayerId);

  if (currentIndex === -1) {
    return state.playerOrder[0] ?? state.activePlayerId;
  }

  return (
    state.playerOrder[(currentIndex + 1) % state.playerOrder.length] ??
    state.activePlayerId
  );
}

export function queuePendingReactionsFromStepTransition(options: {
  beforeState: GameState;
  afterState: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const root = allocateRootTriggerChain(options.afterState);
  return collectAndQueueTriggerReactions({
    beforeState: options.beforeState,
    afterState: root.state,
    source: "step_transition",
    chainId: root.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedBySourceInstanceId: null,
  });
}

/**
 * ゲーム開始時の最初のスタートステップ誘発効果をキューに積む。
 * preGame 完了後（またはシナリオ等で skipPreGame 時の初回ステップ送り前）に呼び出す。
 */
export function queueInitialStartStepTrigger(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  if (state.gameResult) return state;
  const activePlayerId = state.activePlayerId;
  const root = allocateRootTriggerChain(state);
  state = root.state;
  const startStepEvent: CollectedTriggerEvent = {
    actingPlayerId: activePlayerId,
    eventKind: "start_step",
    source: "step_transition",
    chainId: root.chainId,
    attackId: null,
    relatedPlayerId: activePlayerId,
    relatedInstanceId: null,
    amount: null,
    step: "start",
    subPhase: "start",
  };
  let afterState = queuePendingReactionsFromTriggerEvents(
    state,
    [startStepEvent],
    undefined,
    {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }
  );
  afterState = queuePendingReactionsFromStepTransition({
    beforeState: afterState,
    afterState,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  });
  return afterState;
}

/**
 * advanceStep の不変条件ガード。
 *
 * 進行不能なキュー (pending* / stack window / battle group / activeAttack) が残った
 * 状態でステップを進めようとした場合は throw する。`legal-actions.ts` の各キュー
 * 早期 return と GUI 側 `hasPending` の二重防御として engine 内に置く。
 *
 * P3-40 で導入。`pendingPrivateDeclarations` (2026-05-03) は当初単独ガードだったが
 * 他キューを含めて統合した。
 */
function assertNoPendingQueues(state: GameState): void {
  if (state.pendingPromptLock) {
    throw new Error("advanceStep blocked: waiting for a pending player choice");
  }
  if (state.pendingPrivateDeclarations.length > 0) {
    const first = state.pendingPrivateDeclarations[0];
    throw new Error(
      `advanceStep blocked: ${state.pendingPrivateDeclarations.length} pending private declaration(s) remain (first: ${first?.declarationId ?? "?"})`
    );
  }
  if (state.pendingDeferredTriggeredEffects.length > 0) {
    // 通常は pendingPrivateDeclarations が空になる時点で flush されるため、
    // ここに到達したら invariant 違反 (deferred orphan)。
    const first = state.pendingDeferredTriggeredEffects[0];
    throw new Error(
      `advanceStep blocked: ${state.pendingDeferredTriggeredEffects.length} deferred triggered effect(s) remain orphaned (first: ${first?.pendingId ?? "?"})`
    );
  }
  if (state.pendingTriggeredEffects.length > 0) {
    const first = state.pendingTriggeredEffects[0];
    throw new Error(
      `advanceStep blocked: ${state.pendingTriggeredEffects.length} pending triggered effect(s) remain (first: ${first?.pendingId ?? "?"})`
    );
  }
  if (state.pendingBurstChecks.length > 0) {
    const first = state.pendingBurstChecks[0];
    throw new Error(
      `advanceStep blocked: ${state.pendingBurstChecks.length} pending burst check(s) remain (first: ${first?.checkId ?? "?"})`
    );
  }
  if (state.battleImmediateEffects.length > 0) {
    const first = state.battleImmediateEffects[0];
    throw new Error(
      `advanceStep blocked: ${state.battleImmediateEffects.length} battle immediate effect(s) remain (first: ${first?.promptId ?? "?"})`
    );
  }
  if (state.stackWindow !== null) {
    throw new Error(
      `advanceStep blocked: stack window is open (acting: ${state.stackWindow.actingPlayerId})`
    );
  }
  if (state.preDeclarationStackWindow !== null) {
    throw new Error(
      `advanceStep blocked: preDeclarationStackWindow is open (acting: ${state.preDeclarationStackWindow.actingPlayerId})`
    );
  }
  if (state.battleResolutionGroup !== null) {
    throw new Error(
      `advanceStep blocked: battleResolutionGroup is open (attackId: ${state.battleResolutionGroup.attackId})`
    );
  }
  if (state.activeAttack !== null) {
    throw new Error(
      `advanceStep blocked: activeAttack is in progress (attackId: ${state.activeAttack.attackId})`
    );
  }
  if (state.pendingBraveLeaveChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingBraveLeaveChoice is open (hostInstanceId: ${state.pendingBraveLeaveChoice.hostInstanceId})`
    );
  }
  if (state.pendingBraveAttackContinuation !== null) {
    throw new Error(
      `advanceStep blocked: pendingBraveAttackContinuation is open (entityId: ${state.pendingBraveAttackContinuation.entityId})`
    );
  }
  if (state.pendingConnectBattleDecision !== null) {
    throw new Error(
      `advanceStep blocked: pendingConnectBattleDecision is open (pendingId: ${state.pendingConnectBattleDecision.pendingId})`
    );
  }
  if (state.pendingDeckReveal !== null) {
    throw new Error(
      `advanceStep blocked: pendingDeckReveal is open (pendingId: ${state.pendingDeckReveal.pendingId})`
    );
  }
  if (state.pendingZoneSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingZoneSelection is open (pendingId: ${state.pendingZoneSelection.pendingId})`
    );
  }
  if (state.pendingStepOptionalChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingStepOptionalChoice is open (pendingId: ${state.pendingStepOptionalChoice.pendingId})`
    );
  }
  if (state.pendingStepChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingStepChoice is open (pendingId: ${state.pendingStepChoice.pendingId})`
    );
  }
  if (state.pendingDeckRevealCountBoostChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingDeckRevealCountBoostChoice is open (pendingId: ${state.pendingDeckRevealCountBoostChoice.pendingId})`
    );
  }
  if (state.pendingStepOptionalTargetSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingStepOptionalTargetSelection is open (pendingId: ${state.pendingStepOptionalTargetSelection.pendingId})`
    );
  }
  if (state.pendingDrawStepCostChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingDrawStepCostChoice is open (pendingId: ${state.pendingDrawStepCostChoice.pendingId})`
    );
  }
  if (state.pendingSummonCostExcludeChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingSummonCostExcludeChoice is open (pendingId: ${state.pendingSummonCostExcludeChoice.pendingId})`
    );
  }
  if (state.pendingSummonCostCoreMoveChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingSummonCostCoreMoveChoice is open (pendingId: ${state.pendingSummonCostCoreMoveChoice.pendingId})`
    );
  }
  if (state.pendingGroupedSummonCostOverrideChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingGroupedSummonCostOverrideChoice is open (pendingId: ${state.pendingGroupedSummonCostOverrideChoice.pendingId})`
    );
  }
  if (state.pendingLifeDamageDiscardChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingLifeDamageDiscardChoice is open (pendingId: ${state.pendingLifeDamageDiscardChoice.pendingId})`
    );
  }
  if (state.pendingLifeGainReplacementChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingLifeGainReplacementChoice is open (pendingId: ${state.pendingLifeGainReplacementChoice.pendingId})`
    );
  }
  if (state.pendingCoreSplitSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingCoreSplitSelection is open (pendingId: ${state.pendingCoreSplitSelection.pendingId})`
    );
  }
  if (state.pendingCoreShootSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingCoreShootSelection is open (pendingId: ${state.pendingCoreShootSelection.pendingId})`
    );
  }
  if (state.pendingEffectTargetSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingEffectTargetSelection is open (pendingId: ${state.pendingEffectTargetSelection.pendingId})`
    );
  }
  if (state.pendingAsIfSoulCoreChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingAsIfSoulCoreChoice is open (pendingId: ${state.pendingAsIfSoulCoreChoice.pendingId})`
    );
  }
  if (state.pendingEffectOptionalRepeatChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingEffectOptionalRepeatChoice is open (pendingId: ${state.pendingEffectOptionalRepeatChoice.pendingId})`
    );
  }
  if (state.pendingEffectOptionalRepeatCountSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingEffectOptionalRepeatCountSelection is open (pendingId: ${state.pendingEffectOptionalRepeatCountSelection.pendingId})`
    );
  }
  if (state.pendingBorrowedEffectChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingBorrowedEffectChoice is open (pendingId: ${state.pendingBorrowedEffectChoice.pendingId})`
    );
  }
  if (state.pendingBorrowedEffectTargetSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingBorrowedEffectTargetSelection is open (pendingId: ${state.pendingBorrowedEffectTargetSelection.pendingId})`
    );
  }
  if (state.pendingPayToActCoreGate !== null) {
    throw new Error(
      `advanceStep blocked: pendingPayToActCoreGate is open (pendingId: ${state.pendingPayToActCoreGate.pendingId})`
    );
  }
  if (state.pendingPayToActHandDiscardGate !== null) {
    throw new Error(
      `advanceStep blocked: pendingPayToActHandDiscardGate is open (pendingId: ${state.pendingPayToActHandDiscardGate.pendingId})`
    );
  }
  if (state.pendingFieldMagicPreCostTrigger !== null) {
    throw new Error(
      `advanceStep blocked: pendingFieldMagicPreCostTrigger is open (pendingId: ${state.pendingFieldMagicPreCostTrigger.pendingId})`
    );
  }
  if (state.pendingEnterFieldPlacement !== null) {
    throw new Error(
      `advanceStep blocked: pendingEnterFieldPlacement is open (pendingId: ${state.pendingEnterFieldPlacement.pendingId})`
    );
  }
  if (state.pendingBraveCombineChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingBraveCombineChoice is open (pendingId: ${state.pendingBraveCombineChoice.pendingId})`
    );
  }
  if (state.pendingHandTrashSwapChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingHandTrashSwapChoice is open (pendingId: ${state.pendingHandTrashSwapChoice.pendingId})`
    );
  }
  if (state.pendingFieldHandSwapChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingFieldHandSwapChoice is open (pendingId: ${state.pendingFieldHandSwapChoice.pendingId})`
    );
  }
  if (state.pendingTenshoSummon !== null) {
    throw new Error(
      `advanceStep blocked: pendingTenshoSummon is open (pendingId: ${state.pendingTenshoSummon.pendingId})`
    );
  }
  if (state.pendingReverseRebirthSummon !== null) {
    throw new Error(
      `advanceStep blocked: pendingReverseRebirthSummon is open (pendingId: ${state.pendingReverseRebirthSummon.pendingId})`
    );
  }
  if (state.pendingStoneFlipCombine !== null) {
    throw new Error(
      `advanceStep blocked: pendingStoneFlipCombine is open (pendingId: ${state.pendingStoneFlipCombine.pendingId})`
    );
  }
  if (state.pendingCoreDistribution !== null) {
    throw new Error(
      `advanceStep blocked: pendingCoreDistribution is open (pendingId: ${state.pendingCoreDistribution.pendingId})`
    );
  }
  if (state.pendingChangeCleanupChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingChangeCleanupChoice is open (pendingId: ${state.pendingChangeCleanupChoice.pendingId})`
    );
  }
  if (state.pendingCoreSourceAllocation !== null) {
    throw new Error(
      `advanceStep blocked: pendingCoreSourceAllocation is open (pendingId: ${state.pendingCoreSourceAllocation.pendingId})`
    );
  }
  if (state.pendingLinkAidCostSourceChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingLinkAidCostSourceChoice is open (pendingId: ${state.pendingLinkAidCostSourceChoice.pendingId})`
    );
  }
  if (state.pendingSplitSummonChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingSplitSummonChoice is open (pendingId: ${state.pendingSplitSummonChoice.pendingId})`
    );
  }
  if (state.pendingCoreCountSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingCoreCountSelection is open (pendingId: ${state.pendingCoreCountSelection.pendingId})`
    );
  }
  if (state.pendingCountSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingCountSelection is open (pendingId: ${state.pendingCountSelection.pendingId})`
    );
  }
  if (state.pendingDiscardSetBurstCountSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingDiscardSetBurstCountSelection is open (pendingId: ${state.pendingDiscardSetBurstCountSelection.pendingId})`
    );
  }
  if (state.pendingLifeCoreSelection !== null) {
    throw new Error(
      `advanceStep blocked: pendingLifeCoreSelection is open (pendingId: ${state.pendingLifeCoreSelection.pendingId})`
    );
  }
  if (state.pendingEffectSummonCostPayment !== null) {
    throw new Error(
      `advanceStep blocked: pendingEffectSummonCostPayment is open (pendingId: ${state.pendingEffectSummonCostPayment.pendingId})`
    );
  }
  if ((state.pendingTargetRedirects?.length ?? 0) > 0) {
    const first = state.pendingTargetRedirects[0];
    throw new Error(
      `advanceStep blocked: pendingTargetRedirect is open (promptedPlayerId: ${first?.promptedPlayerId ?? "?"})`
    );
  }
  if (state.pendingMultiPlacement !== null) {
    throw new Error(
      `advanceStep blocked: pendingMultiPlacement is open (pendingId: ${state.pendingMultiPlacement.pendingId})`
    );
  }
  if (state.pendingSoulStateReplacement !== null) {
    throw new Error(
      `advanceStep blocked: pendingSoulStateReplacement is open (cardInstanceId: ${state.pendingSoulStateReplacement.cardInstanceId})`
    );
  }
  if (state.pendingAdventSourceReplacement !== null) {
    throw new Error(
      `advanceStep blocked: pendingAdventSourceReplacement is open (cardInstanceId: ${state.pendingAdventSourceReplacement.cardInstanceId})`
    );
  }
  if (state.pendingSetAsideExitReplacementChoice !== null) {
    throw new Error(
      `advanceStep blocked: pendingSetAsideExitReplacementChoice is open (cardInstanceId: ${state.pendingSetAsideExitReplacementChoice.cardInstanceId})`
    );
  }
  // P3-92: 神託/解封/創界石転醒は mechanic 付き pendingTriggeredEffects に統合され、
  // 上の pendingTriggeredEffects guard が滞留を検知する。
  if (state.pendingTrashOptionalAdds.length > 0) {
    const first = state.pendingTrashOptionalAdds[0];
    throw new Error(
      `advanceStep blocked: ${state.pendingTrashOptionalAdds.length} deferred trash optional add(s) remain (first actingPlayer: ${first?.actingPlayerId ?? "?"})`
    );
  }
  if (state.pendingTurnEndFinalizations.length > 0) {
    const first = state.pendingTurnEndFinalizations[0];
    throw new Error(
      `advanceStep blocked: pendingTurnEndFinalization is open (pendingId: ${first?.pendingId ?? "?"})`
    );
  }
  if (state.pendingAttackStepEndFinalizations.length > 0) {
    const first = state.pendingAttackStepEndFinalizations[0];
    throw new Error(
      `advanceStep blocked: pendingAttackStepEndFinalization is open (pendingId: ${first?.pendingId ?? "?"})`
    );
  }
}

export function getGameProgressBlockerReason(state: GameState): string | null {
  try {
    assertNoPendingQueues(state);
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
}

function hasPendingReactionQueues(state: GameState): boolean {
  return (
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingBurstChecks.length > 0
  );
}

function collectSourcesReleasedByExpiredEffectSuppressions(
  stateBeforeExpiry: GameState,
  stateAfterExpiry: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): Set<string> {
  return collectExpiredEffectSuppressionSourceIds(
    stateBeforeExpiry,
    stateAfterExpiry.activeContinuousEffects,
    getCardDefinitionById
  );
}

function rebuildSourcesReleasedByExpiredEffectSuppressions(
  stateBeforeExpiry: GameState,
  stateAfterExpiry: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  const sourceInstanceIds = collectSourcesReleasedByExpiredEffectSuppressions(
    stateBeforeExpiry,
    stateAfterExpiry,
    getCardDefinitionById
  );
  return stabilizeSourcesReleasedByEffectSuppressionExpiry(
    stateAfterExpiry,
    getCardDefinitionById,
    sourceInstanceIds
  );
}

function finishEndStepEffects(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  if (
    (state.pendingExtraSteps?.length ?? 0) > 0 ||
    (state.stepContinuation?.length ?? 0) > 0
  ) {
    return { ...state, window: "step_end" };
  }
  state.log.push(
    `end-step:cleanup:${state.turnNumber}:${state.activePlayerId}`
  );
  const activeContinuousEffectsAfterExpiry = removeExpiredContinuousEffects(
    state,
    { kind: "turn_end" },
    { getCardDefinitionById }
  );
  let afterState: GameState = replaceCardInstances(
    {
      ...state,
      window: "end_step_cleanup",
      activeContinuousEffects: activeContinuousEffectsAfterExpiry,
    },
    state.cardInstances.map((c) =>
      c.divineTransformState ? { ...c, divineTransformState: null } : c
    )
  );
  afterState = applyLifeZeroDefeat(afterState);
  if (afterState.gameResult !== null) return afterState;
  afterState = rebuildSourcesReleasedByExpiredEffectSuppressions(
    state,
    afterState,
    getCardDefinitionById
  );
  // 効果抑制の終了により場の継続効果が復帰した場合、復帰した制約を
  // この cleanup と同じ安定点で反映する。例えば「このスピリットは合体できない」
  // が復帰すると、Q24907 のとおり不正になった合体はここで分離する。
  afterState = flushPendingTurnEndExhaustDowngrades(
    afterState,
    getCardDefinitionById
  );
  afterState = recomputeBattleEntityBp(afterState, getCardDefinitionById);
  return afterState;
}

export function advanceStep(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup,
  getRegisteredMagicActions?: MagicActionRegistrationLookup
): GameState {
  // 発火待ちの moved_to_trash 任意手札追加があれば、ステップ進行前に安定点として materialize する。
  // (他 pending が無ければ pendingDeckReveal に変換され、下の assertNoPendingQueues で進行が止まる)
  state = materializeDeferredTrashOptionalAdds(state);

  // 追加ターン予約は現アタックを中断して開始するため、ここだけ activeAttack を
  // 一時的に除いた同じ pending guard を先に通す。ほかの未解決 queue があれば
  // start せず通常どおり止め、stack/cascade が残る場合も helper が fail-closed する。
  if (state.extraTurnState?.deferredStart === true) {
    assertNoPendingQueues({ ...state, activeAttack: null });
    const stateWithDeferredExtraTurnStarted = startDeferredExtraTurnIfReady(
      state,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );
    if (stateWithDeferredExtraTurnStarted !== state) {
      return stateWithDeferredExtraTurnStarted;
    }
  }

  // P3-40: 進行不能なキューが残ったままステップ進行は許さない。
  // legal-action パイプラインは各キュー drain 用アクション以外を返さないが、GUI が
  // `advanceStep` を直接呼ぶ経路 (handleAdvanceStep など) が同ガードを通らずに
  // 踏み越えるバグを engine 側でも検出する二重防御。
  assertNoPendingQueues(state);

  // --- エンドステップ 2段階処理 ---
  // Phase 1 (end_step_effects): エンドステップ効果解決窓。
  //   advanceStep() を呼ぶと End Step 終了時効果をキューし、効果があれば同ステップ内に留まる。
  if (state.step === "end" && state.window === "end_step_effects") {
    if (!state.gameResult) {
      const root = allocateRootTriggerChain(state);
      state = root.state;
      const endStepEndEvent: CollectedTriggerEvent = {
        actingPlayerId: state.activePlayerId,
        eventKind: "end_step",
        source: "step_transition",
        chainId: root.chainId,
        attackId: null,
        relatedPlayerId: state.activePlayerId,
        relatedInstanceId: null,
        amount: null,
        step: "end",
        subPhase: "end",
      };
      state = queuePendingReactionsFromTriggerEvents(
        state,
        [endStepEndEvent],
        undefined,
        {
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions,
        }
      );
      if (hasPendingReactionQueues(state)) {
        return {
          ...state,
          window: "end_step_end_effects",
        };
      }
    }
    return finishEndStepEffects(state, getCardDefinitionById);
  }

  // Phase 1b: End Step 終了時効果をすべて解決した後、一時効果を除去する。
  if (state.step === "end" && state.window === "end_step_end_effects") {
    return finishEndStepEffects(state, getCardDefinitionById);
  }

  // Phase 2 (end_step_cleanup / none): 一時効果クリーンアップ完了。
  //   advanceStep() を呼ぶと次のターンのスタートステップへ進む。
  //   window="none" はレガシー互換（直接 step="end" を設定した場合）。
  if (
    state.step === "end" &&
    (state.window === "end_step_cleanup" || state.window === "none")
  ) {
    return advanceFromEndStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
  }

  // --- 通常のステップ遷移 ---
  const isCompletingStepEndWindow = state.window === "step_end";
  const activePlayerId = state.activePlayerId;

  // --- ステップ終了時イベント発火 ---
  // 現在のステップを離れる前に subPhase: "end" イベントをキューする。
  // step-end 効果は pending キューに積まれ、step-start 効果より先に解決される（FIFO）。
  if (!isCompletingStepEndWindow && !state.gameResult) {
    const root = allocateRootTriggerChain(state);
    state = root.state;
    const stepEndEvent: CollectedTriggerEvent = {
      actingPlayerId: activePlayerId,
      eventKind: state.step === "end" ? "end_step" : "start_step",
      source: "step_transition",
      chainId: root.chainId,
      attackId: null,
      relatedPlayerId: activePlayerId,
      relatedInstanceId: null,
      amount: null,
      step: state.step,
      subPhase: "end",
    };
    state = queuePendingReactionsFromTriggerEvents(
      state,
      [stepEndEvent],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );
    // engine-hand-self-card-main-end-activation-timing: triggered reaction が無くても、
    // 手札/手元 magic に「そのステップ終了時に使用できる」型 (timingScope.subPhase==="end")
    // の登録があり実際に使用可能なら、既存の pending-reaction 窓と同じ window:"step_end" で
    // 一旦停止してプレイヤーに使用機会を与える (BSTH02.7-C01 effects[1])。
    const hasEligibleStepEndActivation =
      getCardDefinitionById !== undefined &&
      getRegisteredMagicActions !== undefined &&
      hasEligibleMainStepEndMagicActivation({
        state,
        actingPlayerId: activePlayerId,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions,
        getRegisteredMagicActions,
      });
    if (
      getCardDefinitionById !== undefined &&
      getRegisteredTriggeredEffectActions !== undefined &&
      (hasPendingReactionQueues(state) ||
        hasEligibleStepEndActivation ||
        hasEligibleStepEndDivineSkill({
          state,
          actingPlayerId: activePlayerId,
          getCardDefinitionById,
          getRegisteredFieldCardEffectActions: () => undefined,
          getRegisteredTriggeredEffectActions,
          ...(getRegisteredBurstActions ? { getRegisteredBurstActions } : {}),
        }))
    ) {
      return {
        ...state,
        window: "step_end",
      };
    }
  }

  const transition = takeNextStep(state);
  state = transition.state;
  const nextStep = transition.step;

  // 同名の追加ステップも別のステップ。ステップ限定の使用回数を持ち越さない。
  state = {
    ...state,
    effectUsageRecords: state.effectUsageRecords.filter(
      (r) => r.duration !== "step"
    ),
    effectOccurrenceRecords: state.effectOccurrenceRecords.filter(
      (r) => r.duration !== "step"
    ),
  };

  // --- ステップ限定継続効果の失効 ---
  // 「〇〇ステップの間」(duration scope:"step") の効果は、当該ステップを離れる
  // この時点で消滅する。turn_end / battle_end しか扱っていなかったため、
  // 従来は step スコープ効果がステップ・ターンを跨いで残留していた (図書館シンボル追加バグ)。
  let sourcesReleasedBySuppressionExpiry = new Set<string>();
  {
    const leavingStep = state.step;
    const filtered = removeExpiredContinuousEffects(
      state,
      { kind: "step_end", step: leavingStep, activePlayerId },
      { getCardDefinitionById }
    );
    if (filtered.length !== state.activeContinuousEffects.length) {
      const afterExpiry = { ...state, activeContinuousEffects: filtered };
      // step_phase 等の source condition は遷移先の state で判定する。ここで直ちに
      // 再登録すると、main を離れる直前には真だった CE が end にも残留する。
      sourcesReleasedBySuppressionExpiry =
        collectSourcesReleasedByExpiredEffectSuppressions(
          state,
          afterExpiry,
          getCardDefinitionById
        );
      state = applyLifeZeroDefeat(afterExpiry);
      if (state.gameResult !== null) return state;
    }
  }

  if (nextStep === "start" && (state.stepContinuation?.length ?? 0) === 0) {
    return finishEndStepEffects(
      { ...state, step: "end" },
      getCardDefinitionById
    );
  }

  // エンドステップへの遷移: end_step_effects 窓を開いて end_step 誘発をキューする。
  if (nextStep === "end") {
    return enterEndStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      sourcesReleasedBySuppressionExpiry
    );
  }

  // end 以外の通常遷移
  const turnNumber = state.turnNumber;
  const clearsAttack = nextStep !== "attack";

  state.log.push(
    `step:${state.turnNumber}:${state.activePlayerId}:${state.step}->${nextStep}`
  );
  let afterState: GameState = {
    ...state,
    turnNumber,
    activePlayerId,
    step: nextStep,
    stepSequence: (state.stepSequence ?? 0) + 1,
    window: "none",
    activeAttack: clearsAttack ? null : state.activeAttack,
    ...(nextStep === "attack" ? { battlesEndedThisAttackStep: 0 } : {}),
  };

  // ステップ自身を条件にする継続効果（「自分のアタックステップ」等）は、
  // 新ターン開始以外の通常ステップ遷移でも成立・不成立が切り替わる。
  // 攻撃宣言時の battle-state 限定再評価だけでは step_phase 条件を持つ CE を
  // 登録できないため、遷移先の step を確定した直後に汎用の再評価を行う。
  // step-start 誘発の収集前に済ませ、同じ遷移で有効になった CE を後続判定から
  // 一貫して参照できるようにする。
  afterState = recomputeAndRebuildContinuousEffects(
    afterState,
    getCardDefinitionById
  );

  if (sourcesReleasedBySuppressionExpiry.size > 0) {
    afterState = stabilizeSourcesReleasedByEffectSuppressionExpiry(
      afterState,
      getCardDefinitionById,
      sourcesReleasedBySuppressionExpiry
    );
  }

  afterState = {
    ...afterState,
    effectUsageRecords: clearExpiredEffectUsageRecords(afterState),
    effectOccurrenceRecords: clearExpiredEffectOccurrenceRecords(afterState),
  };

  // ステップ開始時誘発効果をキューに積む（固定処理より先）。
  // step フィールドでどのステップの開始かを識別する。
  if (!afterState.gameResult) {
    const root = allocateRootTriggerChain(afterState);
    afterState = root.state;
    const stepStartEvent: CollectedTriggerEvent = {
      actingPlayerId: activePlayerId,
      eventKind: "start_step",
      source: "step_transition",
      chainId: root.chainId,
      attackId: null,
      relatedPlayerId: activePlayerId,
      relatedInstanceId: null,
      amount: null,
      step: nextStep,
      subPhase: "start",
    };
    afterState = queuePendingReactionsFromTriggerEvents(
      afterState,
      [stepStartEvent],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );
  }

  // コアステップ: ボイドからリザーブへコア1個
  if (nextStep === "core") {
    const player = afterState.players.find((p) => p.id === activePlayerId);
    if (player && player.voidNormalCoreCount > 0) {
      afterState = {
        ...afterState,
        players: afterState.players.map((p) =>
          p.id === activePlayerId
            ? {
                ...p,
                voidNormalCoreCount: p.voidNormalCoreCount - 1,
                reserveNormalCoreCount: p.reserveNormalCoreCount + 1,
              }
            : p
        ),
        log: [
          ...afterState.log,
          `core-step:boost:${activePlayerId}:void->reserve:1`,
        ],
      };
    }
  }

  // ドローステップ: デッキから1枚ドロー（デッキ0枚でも敗北しない、次のスタートステップで判定）
  // draw_modify CE でドロー枚数を増減。さらに inline draw step 効果からも +draw を集計する。
  // inline 効果はキューを経由せず本ステップ処理内でプレ/ポスト実行する。
  if (nextStep === "draw") {
    const inlineEntries = collectInlineDrawStepEntries(
      afterState,
      activePlayerId,
      getCardDefinitionById
    );

    // コスト先払い型ドロー枚数修正（model A）: システムドロー**より前に**任意コスト
    // （手札破棄）の支払い判断を解決する。適格な破棄候補がある prepaidCost を集め、
    // 1 件でもあればドローステップを中断して pendingDrawStepCostChoice を立てる。
    // 解決（支払い or 辞退）後に resolvePendingDrawStepCostChoice がドローを再開する。
    const costEntries = collectPendingDrawStepCostEntries(
      afterState,
      activePlayerId,
      inlineEntries,
      getCardDefinitionById
    );
    if (costEntries.length > 0) {
      return {
        ...afterState,
        pendingDrawStepCostChoice: {
          pendingId: `dscc-${afterState.turnNumber}-${activePlayerId}`,
          actingPlayerId: activePlayerId,
          resolvedBonus: 0,
          entries: costEntries,
        },
        log: [
          ...afterState.log,
          `draw-step:cost-choice-open:${activePlayerId}:${costEntries.length}`,
        ],
      };
    }

    afterState = executeDrawStepDraw(
      afterState,
      activePlayerId,
      inlineEntries,
      {
        bonusFromPrepaid: 0,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );
  }

  // スタートステップ: デッキ0枚なら敗北（immune_to_game_loss CE 保有者は除外）
  if (nextStep === "start") {
    const player = afterState.players.find((p) => p.id === activePlayerId);
    if (
      player &&
      player.deckCount <= 0 &&
      !afterState.gameResult &&
      !isPlayerImmuneToGameLoss(afterState, activePlayerId)
    ) {
      afterState = {
        ...afterState,
        gameResult: {
          kind: "player_loss",
          losingPlayerId: activePlayerId,
          reason: "deck_out",
        },
        log: [...afterState.log, `game:deck-out:${activePlayerId}`],
      };
    }
  }

  if (nextStep === "refresh") {
    // P3-14 C-3 拡張: リフレッシュ回復は「疲労(から)回復したとき」(recover) の誘発対象。
    // BSTH08-転醒R02(A)「疲労/効果で回復したとき」は効果回復だけでなくリフレッシュ回復も含む。
    // refreshTrashCoresToReserve のコア移動は trigger イベント種別を持たないため差分対象でも無害。
    const beforeRefresh = afterState;
    afterState = refreshExhaustStates(
      afterState,
      activePlayerId,
      getCardDefinitionById
    );
    const root = allocateRootTriggerChain(afterState);
    afterState = root.state;
    afterState = collectAndQueueTriggerReactions({
      beforeState: beforeRefresh,
      afterState,
      source: "step_transition",
      chainId: root.chainId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      causedBySourceInstanceId: null,
    });
    afterState = refreshTrashCoresToReserve(afterState, activePlayerId);
  }

  // ステップ固定処理（コアブースト、ドロー、リフレッシュ等）による差分は
  // 誘発チェックの対象にしない。beforeState を afterState のコピーにして差分をなくす。
  afterState = queuePendingReactionsFromStepTransition({
    beforeState: afterState,
    afterState,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  });

  return afterState;
}

/**
 * エンドステップに入る。window を end_step_effects に設定し、
 * end_step 誘発効果をキューに積む。
 */
function enterEndStep(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup,
  sourcesReleasedBySuppressionExpiry: ReadonlySet<string> = new Set()
): GameState {
  const activePlayerId = state.activePlayerId;

  state.log.push(
    `step:${state.turnNumber}:${activePlayerId}:${state.step}->end`
  );
  let afterState: GameState = {
    ...state,
    step: "end",
    window: "end_step_effects",
    activeAttack: null,
  };

  // end ステップは advanceStep の通常遷移より先にここへ return するため、
  // step_phase:attack 等の条件付き CE も、この遷移先が確定した時点で再評価する。
  // duration が permanent であっても、継続効果の condition が不成立なら保持しない。
  afterState = recomputeAndRebuildContinuousEffects(
    afterState,
    getCardDefinitionById
  );

  if (sourcesReleasedBySuppressionExpiry.size > 0) {
    afterState = stabilizeSourcesReleasedByEffectSuppressionExpiry(
      afterState,
      getCardDefinitionById,
      sourcesReleasedBySuppressionExpiry
    );
  }

  afterState = {
    ...afterState,
    effectUsageRecords: clearExpiredEffectUsageRecords(afterState),
    effectOccurrenceRecords: clearExpiredEffectOccurrenceRecords(afterState),
  };

  // 差分なしで step_transition の誘発チェック
  afterState = queuePendingReactionsFromStepTransition({
    beforeState: afterState,
    afterState,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  });

  // エンドステップ誘発効果をキュー
  const root = allocateRootTriggerChain(afterState);
  afterState = root.state;
  const endStepEvent: CollectedTriggerEvent = {
    actingPlayerId: activePlayerId,
    eventKind: "end_step",
    source: "step_transition",
    chainId: root.chainId,
    attackId: null,
    relatedPlayerId: activePlayerId,
    relatedInstanceId: null,
    amount: null,
    step: "end",
    subPhase: "start",
  };
  afterState = queuePendingReactionsFromTriggerEvents(
    afterState,
    [endStepEvent],
    undefined,
    {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }
  );

  return afterState;
}

/**
 * エンドステップ (end_step_cleanup) から次のターンのスタートステップへ遷移する。
 * 一時効果の除去は end_step_effects → end_step_cleanup で既に完了済み。
 */
function advanceFromEndStep(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  // --- ステップ限定継続効果の失効 (end ステップ版) ---
  // 通常ステップ遷移 (advanceStep 下方の「ステップ限定継続効果の失効」ブロック) は
  // state.step==="end" のとき Phase1/1b/2 の早期 return で必ず素通りされるため、
  // duration.scope="step" かつ step:"end" の CE はこのブロックを経由しないと
  // 一切失効しない (BSTH05.5-XX01【神域】adversarial verifier lens4 指摘、
  // 「次の自分のエンドステップまで」immune_to_game_loss CE が無期限残留するバグ)。
  // ここで end ステップを離れる直前に同じ step_end トリガーを明示的に呼ぶ。
  let sourcesReleasedBySuppressionExpiry = new Set<string>();
  {
    const filtered = removeExpiredContinuousEffects(
      state,
      { kind: "step_end", step: "end", activePlayerId: state.activePlayerId },
      { getCardDefinitionById }
    );
    if (filtered.length !== state.activeContinuousEffects.length) {
      const afterExpiry = { ...state, activeContinuousEffects: filtered };
      sourcesReleasedBySuppressionExpiry =
        collectSourcesReleasedByExpiredEffectSuppressions(
          state,
          afterExpiry,
          getCardDefinitionById
        );
      state = applyLifeZeroDefeat(afterExpiry);
      if (state.gameResult !== null) return state;
    }
  }

  // P3-63: 追加ターン終了時の復帰処理。
  // BSTH02-M01「相手のアタックステップのバトル中に戻る」のため
  // extraTurnState.returnContext を復元して中断中の状態へ戻る。
  // returnContext が null の場合は、本来の次プレイヤーへ通常遷移を続ける。
  // 追加ターンの実行者が変わっても nextPlayerId を保持する。
  if (state.pendingExtraTurn) {
    const grant = state.pendingExtraTurn;
    return enterTurn(
      {
        ...state,
        extraTurnState: {
          ...grant,
          nextPlayerId:
            state.extraTurnState?.nextPlayerId ?? getNextPlayerId(state),
          returnContext: state.extraTurnState?.returnContext ?? null,
        },
      },
      grant.ownerPlayerId,
      nextTurnNumber(state),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      sourcesReleasedBySuppressionExpiry
    );
  }
  const resumeNextPlayerId = state.extraTurnState?.nextPlayerId;
  if (state.extraTurnState) {
    const returnContext = state.extraTurnState.returnContext;
    if (returnContext) {
      state.log.push(
        `step:${state.turnNumber}:${state.activePlayerId}:extra-turn-end->restore:${returnContext.activePlayerId}:${returnContext.step}`
      );
      let restored: GameState = {
        ...state,
        ...freshTurnContext(),
        ...returnContext.turnContext,
        turnNumber: returnContext.turnNumber,
        activePlayerId: returnContext.activePlayerId,
        step: returnContext.step,
        window: returnContext.window,
        activeAttack: returnContext.activeAttack,
        turnSummonedCardRefs: returnContext.turnSummonedCardRefs
          ? [...returnContext.turnSummonedCardRefs]
          : [],
        extraTurnState: returnContext.extraTurnState ?? null,
        effectUsageRecords: [
          ...state.effectUsageRecords.filter((r) => r.duration === "game"),
          ...(returnContext.effectUsageRecords ?? []).filter(
            (r) => r.duration !== "game"
          ),
        ],
        effectOccurrenceRecords: [
          ...state.effectOccurrenceRecords.filter((r) => r.duration === "game"),
          ...(returnContext.effectOccurrenceRecords ?? []).filter(
            (r) => r.duration !== "game"
          ),
        ],
        activeContinuousEffects: [
          ...state.activeContinuousEffects,
          ...(returnContext.suspendedContinuousEffects ?? []),
        ],
      };
      restored = recomputeAndRebuildContinuousEffects(
        restored,
        getCardDefinitionById
      );
      if (sourcesReleasedBySuppressionExpiry.size > 0) {
        restored = stabilizeSourcesReleasedByEffectSuppressionExpiry(
          restored,
          getCardDefinitionById,
          sourcesReleasedBySuppressionExpiry
        );
      }
      // 追加ターンへ移る直前にアタック宣言後処理（指定アタックの強制ブロック窓
      // や attack-after burst 確認）が保留された場合、extra turn 中は
      // activeAttack が null なので通常の解決後 hook は何もしない。復帰した時点で
      // 同じ正規の後処理へ再投入しないと、指定アタックは flash 窓を開けず、
      // activeAttack が残ったまま advanceStep が blocked になる。
      return advanceAttackDeclarationStateIfReady(restored, {
        getCardDefinitionById,
        ...(getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions }
          : {}),
      });
    }
    // returnContext なし: 通常遷移にフォールスルーする前に extraTurnState を消去
    state = { ...state, extraTurnState: null };
  }

  // ENGINE-opponent-turn-skip (BSAZ01-C03「相手は次のターンを行えない」): 計算した
  // nextPlayerId が pendingTurnSkips に積まれていれば、その番を丸ごと飛ばしてさらに次の
  // プレイヤーへ進める (2人対戦なら自分の連続ターンになる)。1回のスキップにつき
  // turnNumber も1つ消費したものとして扱う (「番」自体は発生している扱い)。
  let nextPlayerId = resumeNextPlayerId ?? getNextPlayerId(state);
  let turnsAdvanced = 1;
  let remainingTurnSkips = state.pendingTurnSkips ?? [];
  while (remainingTurnSkips.includes(nextPlayerId)) {
    state.log.push(
      `step:${state.turnNumber}:${state.activePlayerId}:turn-skip:${nextPlayerId}`
    );
    const skipIndex = remainingTurnSkips.indexOf(nextPlayerId);
    remainingTurnSkips = [
      ...remainingTurnSkips.slice(0, skipIndex),
      ...remainingTurnSkips.slice(skipIndex + 1),
    ];
    nextPlayerId = getNextPlayerId({ ...state, activePlayerId: nextPlayerId });
    turnsAdvanced += 1;
  }
  const newTurnNumber = nextTurnNumber(state, turnsAdvanced);

  state.log.push(`step:${state.turnNumber}:${state.activePlayerId}:end->start`);
  return enterTurn(
    { ...state, pendingTurnSkips: remainingTurnSkips },
    nextPlayerId,
    newTurnNumber,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    sourcesReleasedBySuppressionExpiry
  );
}

/** すべてのターン開始が使う入口。追加ターンでも開始時誘発・敗北判定・回数初期化を行う。 */
export function enterTurn(
  state: GameState,
  nextPlayerId: string,
  nextTurnNumber: number,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup,
  sourcesReleasedBySuppressionExpiry: ReadonlySet<string> = new Set()
): GameState {
  let afterState: GameState = {
    ...state,
    ...freshTurnContext(),
    turnNumber: nextTurnNumber,
    turnNumberHighWaterMark: Math.max(
      state.turnNumberHighWaterMark ?? 0,
      nextTurnNumber
    ),
    stepSequence: (state.stepSequence ?? 0) + 1,
    activePlayerId: nextPlayerId,
    step: "start",
    window: "none",
    activeAttack: null,
  };

  afterState = {
    ...afterState,
    effectUsageRecords: clearExpiredEffectUsageRecords(afterState),
    effectOccurrenceRecords: clearExpiredEffectOccurrenceRecords(afterState),
  };

  // ENGINE-accel-tribe-cost-override: 「〜に置かれたターンの間」型の continuous 効果は
  // duration ではなく condition (self_state:"zone_entered_this_turn" 等) で期限を表現する
  // (rebuildContinuousEffectsFromField の expire→re-register で createdAtTurn が現在ターンに
  // 再スタンプされ続け、duration:{scope:"turn"} だけでは「配置ターン限定」にならないため)。
  // duration ベースの removeExpiredContinuousEffects (このファイル内、turn_end/step_end kind)
  // は condition を見ないため、turnNumber がここで新ターンへ確定した直後に明示的な
  // condition 再評価 (recomputeAndRebuildContinuousEffects) を挟まないと、GUI/REST の
  // 本番経路 (server/game-api.ts → engine.advanceStep、finalizeEffectResolution を経由
  // しない) では条件が false になった CE が無期限残留する
  // (adversarial verifier 2026-07-31 round1 lens4 指摘、実 repro 確認済み)。
  afterState = recomputeAndRebuildContinuousEffects(
    afterState,
    getCardDefinitionById
  );
  afterState = stabilizeSourcesReleasedByEffectSuppressionExpiry(
    afterState,
    getCardDefinitionById,
    sourcesReleasedBySuppressionExpiry
  );

  // スタートステップ: デッキ0枚なら敗北（immune_to_game_loss CE 保有者は除外）
  const player = afterState.players.find((p) => p.id === nextPlayerId);
  if (
    player &&
    player.deckCount <= 0 &&
    !afterState.gameResult &&
    !isPlayerImmuneToGameLoss(afterState, nextPlayerId)
  ) {
    afterState = {
      ...afterState,
      gameResult: {
        kind: "player_loss",
        losingPlayerId: nextPlayerId,
        reason: "deck_out",
      },
      log: [...afterState.log, `game:deck-out:${nextPlayerId}`],
    };
  }

  // 差分なしで step_transition の誘発チェック
  afterState = queuePendingReactionsFromStepTransition({
    beforeState: afterState,
    afterState,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  });

  // スタートステップ誘発
  if (!afterState.gameResult) {
    const root = allocateRootTriggerChain(afterState);
    afterState = root.state;
    const startStepEvent: CollectedTriggerEvent = {
      actingPlayerId: nextPlayerId,
      eventKind: "start_step",
      source: "step_transition",
      chainId: root.chainId,
      attackId: null,
      relatedPlayerId: nextPlayerId,
      relatedInstanceId: null,
      amount: null,
      step: "start",
      subPhase: "start",
    };
    afterState = queuePendingReactionsFromTriggerEvents(
      afterState,
      [startStepEvent],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );
  }

  return afterState;
}
