import { replaceCardInstances } from "./zone/card-instance-state";
import type {
  CardInstance,
  GameState,
  KnownDeckCard,
  PublicDisclosureAudience,
} from "./model";
import { ZONE_VISIBILITY } from "./zone/face-down-policy";
import {
  getFaceUpDeckIds,
  hasPublicCardContentsRule,
} from "./effect/card-access-rules";

const HIDDEN = "_hidden_card_";
function withoutProjection(state: GameState): GameState {
  const { knownDeckCards: _projection, ...rest } = state;
  return rest;
}
type Visibility = NonNullable<CardInstance["deckKnowledge"]>;

export function audienceForDeckVisibility(
  revealTo: "self" | "opponent" | "both"
): PublicDisclosureAudience {
  return revealTo === "self"
    ? "actor_only"
    : revealTo === "opponent"
      ? "opponent_only"
      : "both";
}

function knownSourceVisibility(
  state: GameState,
  card: CardInstance,
  actorPlayerId: string
): Visibility | undefined {
  if (card.definitionId === HIDDEN) return undefined;
  if (hasPublicCardContentsRule(state, card))
    return { audience: "both", actorPlayerId };
  if (card.zone === "revealed") {
    return {
      audience: audienceForDeckVisibility(card.revealedTo ?? "both"),
      actorPlayerId: card.revealedByPlayerId ?? actorPlayerId,
    };
  }
  if (card.zone === "burst") {
    return (state.revealedBurstStates ?? []).some(
      (entry) => entry.cardInstanceId === card.instanceId
    )
      ? { audience: "both", actorPlayerId }
      : { audience: "actor_only", actorPlayerId: card.ownerPlayerId };
  }
  if (ZONE_VISIBILITY[card.zone] === "controller_only" || card.faceDown) {
    return { audience: "actor_only", actorPlayerId: card.ownerPlayerId };
  }
  return ZONE_VISIBILITY[card.zone] === "public" && !card.faceDown
    ? { audience: "both", actorPlayerId }
    : undefined;
}

function mergeVisibility(
  previous: Visibility | null | undefined,
  next: Visibility
): Visibility {
  if (!previous) return next;
  if (previous.audience === "both") return previous;
  if (next.audience === "both") return next;
  const sameViewer =
    (previous.actorPlayerId === next.actorPlayerId) ===
    (previous.audience === next.audience);
  return sameViewer
    ? previous
    : { audience: "both", actorPlayerId: next.actorPlayerId };
}

/** 旧形式の完全な保存状態だけを移行する。秘匿済みビューの位置から実体を復元しない。 */
function legacyKnowledgeByInstanceId(
  state: GameState
): Map<string, Visibility> {
  const result = new Map<string, Visibility>();
  if (!state.knownDeckCards?.length) return result;
  const decks = new Map<string, CardInstance[]>();
  for (const card of state.cardInstances) {
    if (card.zone !== "deck") continue;
    const deck = decks.get(card.ownerPlayerId) ?? [];
    deck.push(card);
    decks.set(card.ownerPlayerId, deck);
  }
  for (const entry of state.knownDeckCards) {
    const deck = decks.get(entry.playerId) ?? [];
    const card = deck[deck.length - 1 - entry.indexFromBottom];
    if (
      !card ||
      card.definitionId === HIDDEN ||
      card.definitionId !== entry.definitionIdSnapshot ||
      card.deckKnowledge !== undefined
    )
      continue;
    result.set(
      card.instanceId,
      mergeVisibility(result.get(card.instanceId), {
        audience: entry.audience,
        actorPlayerId: entry.actorPlayerId,
      })
    );
  }
  return result;
}

/** 旧保存状態を読込境界で一度だけ移行する。秘匿済みビューの実体対応は復元しない。 */
export function normalizeLegacyDeckKnowledge(state: GameState): GameState {
  if (
    !state.knownDeckCards ||
    state.cardInstances.some(
      (card) => card.zone === "deck" && card.definitionId === HIDDEN
    )
  )
    return state;
  const legacy = legacyKnowledgeByInstanceId(state);
  return replaceCardInstances(
    {
      ...withoutProjection(state),
    },
    state.cardInstances.map((card) => {
      const visibility = legacy.get(card.instanceId);
      return visibility ? { ...card, deckKnowledge: visibility } : card;
    })
  );
}

/** 位置とカード名は実デッキから導出する。knownDeckCards は配送用 projection だけ。 */
export function getKnownDeckCards(state: GameState): KnownDeckCard[] {
  const legacy = legacyKnowledgeByInstanceId(state);
  const bottomIndices = new Map<string, number>();
  const result: KnownDeckCard[] = [];
  for (let i = state.cardInstances.length - 1; i >= 0; i--) {
    const card = state.cardInstances[i]!;
    if (card.zone !== "deck") continue;
    const indexFromBottom = bottomIndices.get(card.ownerPlayerId) ?? 0;
    bottomIndices.set(card.ownerPlayerId, indexFromBottom + 1);
    const visibility = card.deckKnowledge ?? legacy.get(card.instanceId);
    if (!visibility || card.definitionId === HIDDEN) continue;
    result.push({
      playerId: card.ownerPlayerId,
      indexFromBottom,
      definitionIdSnapshot: card.definitionId,
      ...visibility,
    });
  }
  // サニタイズ済み snapshot の再表示では、既に配送された匿名スロットだけを使う。
  // 実体がある authoritative state では旧 projection を正源にしない。
  for (const entry of state.knownDeckCards ?? []) {
    const deck = state.cardInstances.filter(
      (card) => card.zone === "deck" && card.ownerPlayerId === entry.playerId
    );
    if (deck.length > 0 && deck.every((card) => card.definitionId === HIDDEN))
      result.push(entry);
  }
  return result.sort(
    (a, b) =>
      a.playerId.localeCompare(b.playerId) ||
      a.indexFromBottom - b.indexFromBottom
  );
}

export function clearKnownDeckCardsForPlayer(
  state: GameState,
  playerId: string
): GameState {
  const legacy = legacyKnowledgeByInstanceId(state);
  return replaceCardInstances(
    {
      ...withoutProjection(state),
    },
    state.cardInstances.map((card) => {
      if (card.zone === "deck" && card.ownerPlayerId === playerId)
        return { ...card, deckKnowledge: null };
      const visibility = legacy.get(card.instanceId);
      return visibility ? { ...card, deckKnowledge: visibility } : card;
    })
  );
}

export function rememberKnownDeckCardsByInstanceIds(args: {
  state: GameState;
  playerId: string;
  instanceIds: readonly string[];
  audience: PublicDisclosureAudience;
  actorPlayerId: string;
}): GameState {
  const { state, playerId, audience, actorPlayerId } = args;
  const ids = new Set(args.instanceIds);
  const legacy = legacyKnowledgeByInstanceId(state);
  return replaceCardInstances(
    {
      ...withoutProjection(state),
    },
    state.cardInstances.map((card) => {
      const previous = card.deckKnowledge ?? legacy.get(card.instanceId);
      if (
        card.zone === "deck" &&
        card.ownerPlayerId === playerId &&
        ids.has(card.instanceId) &&
        card.definitionId !== HIDDEN
      ) {
        return {
          ...card,
          deckKnowledge: mergeVisibility(previous, { audience, actorPlayerId }),
        };
      }
      return legacy.has(card.instanceId) && previous
        ? { ...card, deckKnowledge: previous }
        : card;
    })
  );
}

/** ゾーン境界の公開範囲だけを更新する。位置の再投影・補正は行わない。 */
export function syncKnownDeckCardsForStateTransition(args: {
  before: GameState;
  after: GameState;
  actorPlayerId: string;
}): GameState {
  const { before, after, actorPlayerId } = args;
  const publicIds = new Set(
    after.playerOrder.flatMap((id) => getFaceUpDeckIds(after, id))
  );
  const beforeById = new Map(
    before.cardInstances.map((card) => [card.instanceId, card])
  );
  const legacy = legacyKnowledgeByInstanceId(before);
  return replaceCardInstances(
    {
      ...withoutProjection(after),
    },
    after.cardInstances.map((card) => {
      if (card.zone !== "deck") {
        if (card.deckKnowledge === undefined) return card;
        const { deckKnowledge: _expired, ...rest } = card;
        return rest;
      }
      if (publicIds.has(card.instanceId))
        return {
          ...card,
          deckKnowledge: { audience: "both" as const, actorPlayerId },
        };
      // 内側の解決で設定済みなら再発見しない。null は内側で確定した未知状態（shuffle・非公開ゾーンからの戻し）。
      if (card.deckKnowledge !== undefined) return card;
      const previous = beforeById.get(card.instanceId);
      if (!previous) return card;
      const visibility =
        knownSourceVisibility(before, previous, actorPlayerId) ??
        (previous.zone === "deck" ? legacy.get(card.instanceId) : undefined);
      if (visibility) return { ...card, deckKnowledge: visibility };
      // 非公開ゾーン経由の戻しも確定させ、外側の古い公開 before から再発見させない。
      return previous.zone !== "deck" ? { ...card, deckKnowledge: null } : card;
    })
  );
}
