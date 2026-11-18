import { getTriggerEventFactFilterOptions } from "../effect/trigger-event-facts";
/**
 * grandstone-system.ts — 創界石ネクサスサブシステム（解封 / コア閾値転醒）
 *
 * 創界石ネクサスは創界神と同型のコア管理（配置時コア不可・汎用コア移動から独立・
 * 離脱時コア→ボイド）を持つが、対象判定は別カテゴリ（創界神対象の効果も受けない。
 * `CardFilter.targetsGrandstone` でのみ対象化できる）。
 *
 * 解封: 【解封：〔...〕】条件成立時、ボイドからコア1個をこのネクサスに置ける（任意）。
 *   - カードイベント系（召喚/アタック/転醒）と手札増加系（自分の効果による手札増加）の
 *     2 系統の条件がある。トリガー検出は collectAndQueueTriggerReactions（summon/rebirth/
 *     increase_hand）と battle-actions のアタック宣言箇所にフックする。
 * 転醒: 「このネクサスのコアが N 個以上になったとき、裏返せる」— コア数が閾値以上の
 *   増加のたびに mechanic 付き誘発エントリ（P3-92: pendingTriggeredEffects）をキューし、
 *   受諾で裏返す（retainCores 残して残りはボイドへ。通常転醒のリザーブ返却と異なる）。
 *
 * ソース: 独自カードサイトのカード本文のみ（external-qa に創界石/解封の裁定なし、
 * 2026-06-10 確認）。曖昧点は needs-ruling 管理。
 */

import { canObserveTrigger } from "../effect/trigger-observation-sources";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  GrandstoneData,
  TriggerEventCause,
  TriggeredMechanic,
  UnsealCondition,
  UnsealEventKind,
  TriggerEventFacts,
  SemanticTriggerEvent,
} from "../model";
import {
  countValueVisibleToEffect,
  createMechanicPendingTriggeredEffect,
  isGrandstoneNexus,
} from "../model";
import { getCardById } from "../card/card-lookup";
import { matchesCardReferenceFilter, matchesTribes } from "../card/card-filter";
import {
  getNormalCoreCountAtLocation,
  moveNormalCores,
} from "../core/core-system";
import {
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import { usesFieldCardCategory } from "../effect/event-card-category-context";
import { canActivateNexusMechanicEffect } from "./nexus-mechanic-suppression";
import { hasMatchingTriggeredMechanicSourceIdentity } from "../effect/triggered-mechanic-eligibility";
import { requireTriggerChainId } from "../chain-id";

let unsealPendingSequence = 0;
let stoneRebirthPendingSequence = 0;

// ---------------------------------------------------------------------------
// Unseal condition matching
// ---------------------------------------------------------------------------

type UnsealCardEventKind = "summon" | "attack" | "rebirth";

/**
 * カードイベント（召喚/アタック/転醒）が UnsealCondition にマッチするか判定する。
 * cardFilter のフィールド間は AND、各フィールド内（nameContains/tribes）は OR。
 * 「カード名に「X」を含む」は部分一致（card-filter の CardNameMatch 規約と同じ）。
 */
export function matchesUnsealCardEvent(options: {
  state: GameState;
  eventFacts?: TriggerEventFacts;
  event: UnsealCardEventKind;
  triggerCard: CardInstance;
  triggerDef: CardDefinition;
  condition: UnsealCondition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const { condition, triggerDef } = options;
  if (!condition.events.includes(options.event)) return false;
  // hand_increase 専用条件（causeFilter のみ）はカードイベントにマッチしない
  if (condition.causeFilter && !condition.cardFilter) return false;

  const filter = condition.cardFilter;
  if (!filter) return true;

  if (filter.categories && filter.categories.length > 0) {
    if (
      !matchesCardReferenceFilter(
        options.triggerCard,
        triggerDef,
        { category: filter.categories },
        {
          state: options.state,
          fieldCategoryContext: usesFieldCardCategory(options.event),
          getCardDefinitionById: options.getCardDefinitionById,
          ...(options.eventFacts
            ? getTriggerEventFactFilterOptions(
                options.eventFacts,
                options.triggerCard.instanceId
              )
            : {}),
        }
      )
    ) {
      return false;
    }
  }

  if (filter.nameContains && filter.nameContains.length > 0) {
    if (!filter.nameContains.some((n) => triggerDef.name.includes(n))) {
      return false;
    }
  }

  if (filter.tribes && filter.tribes.length > 0) {
    const tribes = options.eventFacts
      ? (options.eventFacts.cards[options.triggerCard.instanceId]?.filterOptions
          .effectiveTribes ?? [])
      : getEffectiveTribes(
          options.state,
          options.triggerCard,
          triggerDef,
          options.getCardDefinitionById
        );
    if (!matchesTribes(undefined, filter, tribes)) return false;
  }

  return true;
}

/**
 * 手札増加イベントが UnsealCondition にマッチするか判定する。
 * 「〜を持つ自分の効果による自分の手札の増加」: 原因効果の発揮元カードの
 * 実効系統/実効色で判定する。原因カードが特定できない場合は fail-closed。
 */
export function matchesUnsealHandIncrease(options: {
  state: GameState;
  eventFacts?: TriggerEventFacts;
  condition: UnsealCondition;
  causeCard: CardInstance | null;
  causeDef: CardDefinition | null;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const { condition } = options;
  if (!condition.events.includes("hand_increase")) return false;

  const filter = condition.causeFilter;
  if (!filter) return true;
  if (!options.causeCard || !options.causeDef) return false;

  if (filter.tribes && filter.tribes.length > 0) {
    const tribes = options.eventFacts
      ? (options.eventFacts.cards[options.causeCard.instanceId]?.filterOptions
          .effectiveTribes ?? [])
      : getEffectiveTribes(
          options.state,
          options.causeCard,
          options.causeDef,
          options.getCardDefinitionById
        );
    if (!matchesTribes(undefined, filter, tribes)) return false;
  }

  if (filter.colors && filter.colors.length > 0) {
    const colors = options.eventFacts
      ? (options.eventFacts.cards[options.causeCard.instanceId]?.filterOptions
          .effectiveColors ?? [])
      : getEffectiveColors(options.state, options.causeCard, options.causeDef);
    if (!filter.colors.some((c) => colors.includes(c))) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Unseal trigger detection & queueing
// ---------------------------------------------------------------------------

function listFieldGrandstones(
  state: GameState,
  controllerPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Array<{ card: CardInstance; def: CardDefinition; data: GrandstoneData }> {
  const result: Array<{
    card: CardInstance;
    def: CardDefinition;
    data: GrandstoneData;
  }> = [];
  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== controllerPlayerId) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def || !isGrandstoneNexus(def) || !def.grandstoneData) continue;
    result.push({ card, def, data: def.grandstoneData });
  }
  return result;
}

/** 解封/閾値転醒のイベントは固定し、発揮時の抑止・資源・カウントを共通再判定する。 */
export function getGrandstoneMechanicEligibility(
  state: GameState,
  stone: CardInstance,
  definition: CardDefinition,
  kind: "unseal" | "stone_rebirth",
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): {
  explicitConditionMet: boolean;
  resourcesAvailable: boolean;
  canActivate: boolean;
} {
  const data = definition.grandstoneData;
  if (!data)
    return {
      explicitConditionMet: false,
      resourcesAvailable: false,
      canActivate: false,
    };
  const unsuppressed = canActivateNexusMechanicEffect(
    state,
    stone.instanceId,
    kind,
    getCardDefinitionById
  );
  if (kind === "unseal") {
    const resourcesAvailable =
      getNormalCoreCountAtLocation(state, {
        kind: "void",
        playerId: stone.controllerPlayerId,
      }) > 0;
    return {
      explicitConditionMet: true,
      resourcesAvailable,
      canActivate: unsuppressed && resourcesAvailable,
    };
  }
  const player = state.players.find((p) => p.id === stone.controllerPlayerId);
  const explicitConditionMet =
    data.rebirthMaxCount == null ||
    countValueVisibleToEffect(
      player?.countValue,
      player?.protectedCounts,
      definition.tribe?.split("・") ?? []
    ) <= data.rebirthMaxCount;
  const validRebirthSource =
    !!definition.isDoubleSided &&
    !!definition.backFace &&
    data.rebirthCoreThreshold != null &&
    stone.normalCoreCount >= data.rebirthCoreThreshold;
  return {
    explicitConditionMet,
    resourcesAvailable: true,
    canActivate: unsuppressed && validRebirthSource && explicitConditionMet,
  };
}

export function canActivateGrandstoneMechanic(
  ...args: Parameters<typeof getGrandstoneMechanicEligibility>
): boolean {
  return getGrandstoneMechanicEligibility(...args).canActivate;
}

function queueUnsealChoice(
  state: GameState,
  options: {
    grandstone: CardInstance;
    triggerEvent: UnsealEventKind;
    triggerCardInstanceId: string | null;
    chainId: string | null;
    canActivate: boolean;
    captureDynamicEligibility: boolean;
  }
): GameState {
  const playerId = options.grandstone.controllerPlayerId;
  if (!options.canActivate && !options.captureDynamicEligibility) return state;

  // 同一 (創界石, トリガーカード, イベント) の重複キューを防ぐ
  const duplicated = state.pendingTriggeredEffects.some(
    (p) =>
      p.mechanic?.kind === "unseal" &&
      p.mechanic.grandstoneInstanceId === options.grandstone.instanceId &&
      p.mechanic.triggerCardInstanceId === options.triggerCardInstanceId &&
      p.mechanic.triggerEvent === options.triggerEvent
  );
  if (duplicated) return state;

  const pending = createMechanicPendingTriggeredEffect({
    state,
    pendingId: `unseal-${options.grandstone.instanceId}-${unsealPendingSequence++}`,
    chainId: requireTriggerChainId(options.chainId),
    actingPlayerId: playerId,
    relatedInstanceId: options.grandstone.instanceId,
    mechanic: {
      kind: "unseal",
      grandstoneInstanceId: options.grandstone.instanceId,
      triggerEvent: options.triggerEvent,
      triggerCardInstanceId: options.triggerCardInstanceId,
    },
  });
  return {
    ...state,
    pendingTriggeredEffects: [
      ...state.pendingTriggeredEffects,
      {
        ...pending,
        ...(!options.canActivate ? { dormantMechanic: true } : {}),
      },
    ],
  };
}

/**
 * カードイベント（召喚/アタック/転醒）に対する解封選択をキューイングする。
 *
 * 解封条件は全カードで「自分の〜」なので、トリガーカードと同じコントローラーの
 * 創界石のみ走査する。転醒イベントでは、裏返ったカードの A 面定義が
 * `rebirthExcludedFromUnseal`（「この転醒で【解封】はできない」）を持つ場合は発火しない。
 */
export function checkAndQueueUnsealChoicesForCardEvent(
  state: GameState,
  triggerCardInstanceId: string,
  event: UnsealCardEventKind,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  chainId: string | null,
  observationSnapshot?: import("../model").TriggerObservationSnapshot,
  eventFacts?: TriggerEventFacts
): GameState {
  const triggerCard = eventFacts
    ? eventFacts.cards[triggerCardInstanceId]?.card
    : getCardById(state, triggerCardInstanceId);
  if (!triggerCard) return state;
  const triggerDef = getCardDefinitionById(triggerCard.definitionId);
  if (!triggerDef) return state;

  // 「この転醒で【解封】はできない」(BSTH02.7): 裏返った創界石の A 面定義で判定
  if (event === "rebirth") {
    const frontDef = getCardDefinitionById(triggerCard.originalDefinitionId);
    if (frontDef?.grandstoneData?.rebirthExcludedFromUnseal) return state;
  }

  let currentState = state;
  const stones = listFieldGrandstones(
    currentState,
    triggerCard.controllerPlayerId,
    getCardDefinitionById
  );
  for (const stone of stones) {
    if (!canObserveTrigger(observationSnapshot, stone.card, state)) continue;
    if (
      eventFacts &&
      !canActivateNexusMechanicEffect(
        { ...state, ...eventFacts.filterState },
        stone.card.instanceId,
        "unseal",
        getCardDefinitionById
      )
    )
      continue;
    if (
      !canActivateNexusMechanicEffect(
        currentState,
        stone.card.instanceId,
        "unseal",
        getCardDefinitionById
      )
    )
      continue;
    // 自分自身のイベントでは発火しない（転醒で裏返った直後の自身など）
    if (stone.card.instanceId === triggerCardInstanceId) continue;
    const matched = stone.data.unsealConditions.some((cond) =>
      matchesUnsealCardEvent({
        state: currentState,
        event,
        ...(eventFacts ? { eventFacts } : {}),
        triggerCard,
        triggerDef,
        condition: cond,
        getCardDefinitionById,
      })
    );
    if (!matched) continue;
    currentState = queueUnsealChoice(currentState, {
      grandstone: stone.card,
      canActivate: canActivateGrandstoneMechanic(
        currentState,
        stone.card,
        stone.def,
        "unseal",
        getCardDefinitionById
      ),
      captureDynamicEligibility: observationSnapshot !== undefined,
      triggerEvent: event,
      triggerCardInstanceId,
      chainId,
    });
  }
  return currentState;
}

/**
 * 手札増加イベントに対する解封選択をキューイングする。
 *
 * @param growerPlayerId 手札が増えたプレイヤー（解封条件は「自分の手札の増加」なので
 *   創界石のコントローラーと一致する必要がある）
 * @param causeSourceInstanceId 増加の原因効果の発揮元カード。null なら原因カードを
 *   特定できない経路（causeFilter 付き条件は fail-closed でマッチしない）
 */
export function checkAndQueueUnsealChoicesForHandIncrease(
  state: GameState,
  growerPlayerId: string,
  causeSourceInstanceId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  chainId: string | null,
  observationSnapshot?: import("../model").TriggerObservationSnapshot,
  eventFacts?: TriggerEventFacts
): GameState {
  const causeCard = causeSourceInstanceId
    ? ((eventFacts
        ? eventFacts.cards[causeSourceInstanceId]?.card
        : getCardById(state, causeSourceInstanceId)) ?? null)
    : null;
  const causeDef = causeCard
    ? (getCardDefinitionById(causeCard.definitionId) ?? null)
    : null;

  // 「自分の効果による」: 原因カードのコントローラー = 手札が増えたプレイヤー
  if (causeCard && causeCard.controllerPlayerId !== growerPlayerId) {
    return state;
  }

  let currentState = state;
  const stones = listFieldGrandstones(
    currentState,
    growerPlayerId,
    getCardDefinitionById
  );
  for (const stone of stones) {
    if (!canObserveTrigger(observationSnapshot, stone.card, state)) continue;
    if (
      eventFacts &&
      !canActivateNexusMechanicEffect(
        { ...state, ...eventFacts.filterState },
        stone.card.instanceId,
        "unseal",
        getCardDefinitionById
      )
    )
      continue;
    if (
      !canActivateNexusMechanicEffect(
        currentState,
        stone.card.instanceId,
        "unseal",
        getCardDefinitionById
      )
    )
      continue;
    const matched = stone.data.unsealConditions.some((cond) =>
      matchesUnsealHandIncrease({
        state: currentState,
        condition: cond,
        ...(eventFacts ? { eventFacts } : {}),
        causeCard,
        causeDef,
        getCardDefinitionById,
      })
    );
    if (!matched) continue;
    currentState = queueUnsealChoice(currentState, {
      grandstone: stone.card,
      canActivate: canActivateGrandstoneMechanic(
        currentState,
        stone.card,
        stone.def,
        "unseal",
        getCardDefinitionById
      ),
      captureDynamicEligibility: observationSnapshot !== undefined,
      triggerEvent: "hand_increase",
      triggerCardInstanceId: causeSourceInstanceId,
      chainId,
    });
  }
  return currentState;
}

/**
 * collectAndQueueTriggerReactions から呼ばれる解封一括フック。
 * 収集済みトリガーイベントのうち summon / rebirth / increase_hand を解封判定に流す。
 * アタックは state delta に現れないため battle-actions 側のフックで別途処理する。
 */
export function queueUnsealChoicesFromTriggerEvents(
  state: GameState,
  events: ReadonlyArray<{
    eventKind: string;
    eventFactOccurrences?: TriggerEventFacts[];
    chainId: string | null;
    relatedInstanceId: string | null;
    relatedPlayerId: string | null;
    cause?: TriggerEventCause;
    observationSnapshot?: import("../model").TriggerObservationSnapshot;
  }>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let currentState = state;
  for (const event of events)
    for (const facts of event.eventFactOccurrences ?? [undefined]) {
      if (event.eventKind === "summon" && event.relatedInstanceId) {
        currentState = checkAndQueueUnsealChoicesForCardEvent(
          currentState,
          event.relatedInstanceId,
          "summon",
          getCardDefinitionById,
          event.chainId,
          facts?.observationSnapshot ?? event.observationSnapshot,
          facts
        );
      } else if (event.eventKind === "rebirth" && event.relatedInstanceId) {
        currentState = checkAndQueueUnsealChoicesForCardEvent(
          currentState,
          event.relatedInstanceId,
          "rebirth",
          getCardDefinitionById,
          event.chainId,
          facts?.observationSnapshot ?? event.observationSnapshot,
          facts
        );
      } else if (
        event.eventKind === "increase_hand" &&
        event.relatedPlayerId &&
        event.cause === "self_effect"
      ) {
        // バーストや内包された自己回収は外側の効果元と異なる。
        // 手札移動ごとに確定したイベントの原因を参照する。
        currentState = checkAndQueueUnsealChoicesForHandIncrease(
          currentState,
          event.relatedPlayerId,
          event.relatedInstanceId,
          getCardDefinitionById,
          event.chainId,
          facts?.observationSnapshot ?? event.observationSnapshot,
          facts
        );
      }
    }
  return currentState;
}

// ---------------------------------------------------------------------------
// Unseal choice resolution
// ---------------------------------------------------------------------------

/**
 * 解封 mechanic を解決する（コア+1 を受け入れるか辞退するか）。
 * pending のキュー除去は呼び出し側（legal-actions-apply の mechanic 分岐）が行う。
 * 受諾でボイド→創界石にコア1個。コアが転醒閾値を跨いだ場合は
 * 転醒 mechanic も誘発キューに積む。
 */
export function resolveUnsealMechanic(
  state: GameState,
  mechanic: Extract<TriggeredMechanic, { kind: "unseal" }>,
  actingPlayerId: string,
  accept: boolean,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  chainId: string
): GameState {
  if (!accept) {
    return {
      ...state,
      log: [...state.log, `[Unseal] ${actingPlayerId} は解封コア+1 を辞退`],
    };
  }

  const voidCores = getNormalCoreCountAtLocation(state, {
    kind: "void",
    playerId: actingPlayerId,
  });
  if (voidCores <= 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `[Unseal] ボイドにコアがないため解封コア+1 を実行できない`,
      ],
    };
  }

  const stone = getCardById(state, mechanic.grandstoneInstanceId);
  if (!hasMatchingTriggeredMechanicSourceIdentity(stone, mechanic, state))
    return state;
  if (!stone || stone.zone !== "field") {
    return {
      ...state,
      log: [
        ...state.log,
        `[Unseal] 創界石がフィールドにないため解封コア+1 を実行できない`,
      ],
    };
  }

  const beforeMove = state;
  if (
    !canActivateNexusMechanicEffect(
      state,
      stone.instanceId,
      "unseal",
      getCardDefinitionById
    )
  )
    return state;
  let newState = moveNormalCores(
    state,
    { kind: "void", playerId: actingPlayerId },
    { kind: "card", instanceId: mechanic.grandstoneInstanceId },
    1
  );
  newState = {
    ...newState,
    log: [
      ...newState.log,
      `[Unseal] ${actingPlayerId} の創界石ネクサスにボイドからコア+1`,
    ],
  };

  // コア追加で「N個以上になった」なら転醒選択をキュー
  newState = checkAndQueueStoneRebirthChoices(
    beforeMove,
    newState,
    getCardDefinitionById,
    chainId
  );

  return newState;
}

// ---------------------------------------------------------------------------
// Stone rebirth (コア閾値転醒) queueing
// ---------------------------------------------------------------------------

/** The shared fact detector; observation capture must not invent a second threshold rule. */
export function collectStoneRebirthCoreIncreases(
  beforeState: GameState,
  afterState: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Array<{ card: CardInstance; definition: CardDefinition }> {
  const beforeById = new Map(
    beforeState.cardInstances.map((card) => [card.instanceId, card])
  );
  return afterState.cardInstances.flatMap((card) => {
    if (card.zone !== "field") return [];
    const definition = getCardDefinitionById(card.definitionId);
    const threshold = definition?.grandstoneData?.rebirthCoreThreshold;
    if (
      threshold == null ||
      !definition?.isDoubleSided ||
      !definition.backFace ||
      card.normalCoreCount <=
        (beforeById.get(card.instanceId)?.normalCoreCount ?? 0) ||
      card.normalCoreCount < threshold
    )
      return [];
    return [{ card, definition }];
  });
}

/**
 * 創界石のコア数が「N 個以上になった」増加を検出し、転醒選択をキューする。
 *
 * 「コアが N 個以上になったとき」は誘発（08a:83 転醒は誘発）。ユーザー裁定 2026-06-10:
 * 「以上」なので閾値跨ぎ (2→3) **だけでなく、既に閾値以上での増加 (3→4 等) も
 * 「N 個以上になった」に含む**。すなわち「コアが増加し、かつ結果が閾値以上」のたびに発火する
 * （旧実装は境界跨ぎ1回のみで狭すぎた）。辞退後の再挑戦には新たなコア増加が要る。
 * コア減少では発火しない。
 */
export function checkAndQueueStoneRebirthChoices(
  beforeState: GameState,
  afterState: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  chainId: string | null,
  options: {
    captureDynamicEligibility?: boolean;
    simultaneousGroupId?: string;
    /** Captured before the collection boundary consumes its evidence receipts. */
    operationObservations?: readonly SemanticTriggerEvent[];
  } = {}
): GameState {
  let currentState = afterState;
  for (const { card, definition: def } of collectStoneRebirthCoreIncreases(
    beforeState,
    afterState,
    getCardDefinitionById
  )) {
    const observations = options.operationObservations?.filter(
      (event) =>
        event.eventKind === "stone_rebirth" &&
        event.relatedInstanceId === card.instanceId
    );
    if (
      observations?.length &&
      !observations.some((event) =>
        canObserveTrigger(event.observationSnapshot, card, currentState)
      )
    )
      continue;
    if (
      !canActivateNexusMechanicEffect(
        currentState,
        card.instanceId,
        "stone_rebirth",
        getCardDefinitionById
      )
    )
      continue;
    const eligibility = getGrandstoneMechanicEligibility(
      currentState,
      card,
      def,
      "stone_rebirth",
      getCardDefinitionById
    );
    const canActivate = eligibility.canActivate;
    if (!canActivate && !options.captureDynamicEligibility) continue;

    const duplicated = currentState.pendingTriggeredEffects.find(
      (p) =>
        p.mechanic?.kind === "stone_rebirth" &&
        p.mechanic.grandstoneInstanceId === card.instanceId
    );
    if (duplicated) {
      // resolveUnsealMechanic may already have enqueued this exact transition.
      // Only this collection interval's new candidate can join its explicit group.
      const simultaneousGroupId = options.simultaneousGroupId;
      if (
        simultaneousGroupId &&
        duplicated.chainId === chainId &&
        !beforeState.pendingTriggeredEffects.some(
          (p) => p.pendingId === duplicated.pendingId
        )
      ) {
        currentState = {
          ...currentState,
          pendingTriggeredEffects: currentState.pendingTriggeredEffects.map(
            (p) =>
              p.pendingId === duplicated.pendingId
                ? { ...p, simultaneousGroupId }
                : p
          ),
        };
      }
      continue;
    }

    const pending = createMechanicPendingTriggeredEffect({
      state: currentState,
      pendingId: `stone-rebirth-${card.instanceId}-${stoneRebirthPendingSequence++}`,
      chainId: requireTriggerChainId(chainId),
      actingPlayerId: card.controllerPlayerId,
      relatedInstanceId: card.instanceId,
      mechanic: {
        kind: "stone_rebirth",
        grandstoneInstanceId: card.instanceId,
      },
    });
    currentState = {
      ...currentState,
      pendingTriggeredEffects: [
        ...currentState.pendingTriggeredEffects,
        {
          ...pending,
          ...(options.simultaneousGroupId
            ? { simultaneousGroupId: options.simultaneousGroupId }
            : {}),
          ...(!canActivate ? { dormantMechanic: true } : {}),
          ...(!eligibility.explicitConditionMet
            ? { dormantMechanicCondition: true }
            : {}),
        },
      ],
    };
  }
  return currentState;
}
