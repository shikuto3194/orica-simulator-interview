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

import type {
  CardDefinition,
  CardInstance,
  GameState,
  GrandstoneData,
  TriggerEventCause,
  TriggeredMechanic,
  UnsealCondition,
  UnsealEventKind,
} from "../model";
import {
  createMechanicPendingTriggeredEffect,
  isGrandstoneNexus,
} from "../model";
import { getCardById } from "../card/card-lookup";
import { matchesTribes } from "../card/card-filter";
import {
  getNormalCoreCountAtLocation,
  moveNormalCores,
} from "../core/core-system";
import {
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import { getEffectiveCategory } from "./act-as-spirit";
import { canActivateNexusMechanicEffect } from "./nexus-mechanic-suppression";
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
    const effectiveCategory = getEffectiveCategory(
      options.state,
      options.triggerCard,
      triggerDef
    );
    if (
      effectiveCategory === undefined ||
      !filter.categories.includes(effectiveCategory)
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
    const tribes = getEffectiveTribes(
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
    const tribes = getEffectiveTribes(
      options.state,
      options.causeCard,
      options.causeDef,
      options.getCardDefinitionById
    );
    if (!matchesTribes(undefined, filter, tribes)) return false;
  }

  if (filter.colors && filter.colors.length > 0) {
    const colors = getEffectiveColors(
      options.state,
      options.causeCard,
      options.causeDef
    );
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

function queueUnsealChoice(
  state: GameState,
  options: {
    grandstone: CardInstance;
    triggerEvent: UnsealEventKind;
    triggerCardInstanceId: string | null;
    chainId: string | null;
  }
): GameState {
  const playerId = options.grandstone.controllerPlayerId;
  // ボイドにコアがなければ選択不要（oracle と同じ）
  const voidCores = getNormalCoreCountAtLocation(state, {
    kind: "void",
    playerId,
  });
  if (voidCores <= 0) return state;

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
    pendingTriggeredEffects: [...state.pendingTriggeredEffects, pending],
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
  chainId: string | null
): GameState {
  const triggerCard = getCardById(state, triggerCardInstanceId);
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
        triggerCard,
        triggerDef,
        condition: cond,
        getCardDefinitionById,
      })
    );
    if (!matched) continue;
    currentState = queueUnsealChoice(currentState, {
      grandstone: stone.card,
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
  chainId: string | null
): GameState {
  const causeCard = causeSourceInstanceId
    ? (getCardById(state, causeSourceInstanceId) ?? null)
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
        causeCard,
        causeDef,
        getCardDefinitionById,
      })
    );
    if (!matched) continue;
    currentState = queueUnsealChoice(currentState, {
      grandstone: stone.card,
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
    chainId: string | null;
    relatedInstanceId: string | null;
    relatedPlayerId: string | null;
    cause?: TriggerEventCause;
  }>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let currentState = state;
  for (const event of events) {
    if (event.eventKind === "summon" && event.relatedInstanceId) {
      currentState = checkAndQueueUnsealChoicesForCardEvent(
        currentState,
        event.relatedInstanceId,
        "summon",
        getCardDefinitionById,
        event.chainId
      );
    } else if (event.eventKind === "rebirth" && event.relatedInstanceId) {
      currentState = checkAndQueueUnsealChoicesForCardEvent(
        currentState,
        event.relatedInstanceId,
        "rebirth",
        getCardDefinitionById,
        event.chainId
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
        event.chainId
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
  chainId: string | null
): GameState {
  const beforeById = new Map(
    beforeState.cardInstances.map((c) => [c.instanceId, c])
  );

  let currentState = afterState;
  for (const card of afterState.cardInstances) {
    if (card.zone !== "field") continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def?.grandstoneData) continue;
    if (
      !canActivateNexusMechanicEffect(
        currentState,
        card.instanceId,
        "stone_rebirth",
        getCardDefinitionById
      )
    )
      continue;
    const data = def.grandstoneData;
    if (data.rebirthCoreThreshold == null) continue;
    if (!def.isDoubleSided || !def.backFace) continue;

    const beforeCard = beforeById.get(card.instanceId);
    const beforeCores = beforeCard?.normalCoreCount ?? 0;
    const afterCores = card.normalCoreCount;
    // コアが増加し、かつ結果が閾値以上のとき発火（「N 個以上になった」）。
    if (afterCores <= beforeCores || afterCores < data.rebirthCoreThreshold) {
      continue;
    }

    // 転醒条件: 自分のカウントがこの値以下（キュー時に判定、解決時にも再判定）
    if (data.rebirthMaxCount != null) {
      const player = currentState.players.find(
        (p) => p.id === card.controllerPlayerId
      );
      if ((player?.countValue ?? 0) > data.rebirthMaxCount) continue;
    }

    const duplicated = currentState.pendingTriggeredEffects.some(
      (p) =>
        p.mechanic?.kind === "stone_rebirth" &&
        p.mechanic.grandstoneInstanceId === card.instanceId
    );
    if (duplicated) continue;

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
        pending,
      ],
    };
  }
  return currentState;
}
