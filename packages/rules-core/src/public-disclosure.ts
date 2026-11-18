import { getMultiPlacementTargets } from "./pending-state-guards";
import { isAwaitingEffectEntryCores } from "./zone/enter-field-placement-pending";
/**
 * 公開情報イベントの append / 状態遷移観測。
 *
 * 文字列 `GameState.log` はデバッグ用であり、ここでは一切読まない。カード名も
 * 保存せず、公開時点の definitionId snapshot と、追跡可能な間だけの instanceId を
 * GUI renderer に渡す。
 */
import type {
  GameState,
  PublicDisclosure,
  PublicDisclosureActionLabel,
  PublicDisclosureAudience,
  PublicDisclosureResult,
  PublicDisclosureTarget,
  Zone,
} from "./model";
import type { Action } from "./dsl-types";
import { syncKnownDeckCardsForStateTransition } from "./known-deck";
import { hasPublicCardContentsRule } from "./effect/card-access-rules";

type PublicDisclosureInput = Omit<PublicDisclosure, "id" | "sequence">;

type PublicCardReference = {
  instanceId?: string;
  definitionIdSnapshot?: string;
};

const PUBLIC_CARD_ZONES = new Set<Zone>([
  "field",
  "trash",
  "void",
  "removed_from_game",
  "set_aside",
  "mirage",
  "count_area",
]);

export function disclosureAudienceCanView(
  audience: PublicDisclosureAudience,
  actorPlayerId: string,
  viewerPlayerId: string | null
): boolean {
  if (audience === "both") return true;
  if (viewerPlayerId === null) return false;
  return audience === "actor_only"
    ? viewerPlayerId === actorPlayerId
    : viewerPlayerId !== actorPlayerId;
}

/** カードの現在の素性を対象宣言に含めてもよいかの可視性判定。 */
export function isCardIdentityPublicForDisclosure(
  state: GameState,
  instanceId: string
): boolean {
  const card = state.cardInstances.find(
    (entry) => entry.instanceId === instanceId
  );
  if (!card) return false;
  if (hasPublicCardContentsRule(state, card)) return true;
  if (card.zone === "revealed") return (card.revealedTo ?? "both") === "both";
  if (card.zone === "burst") {
    return (state.revealedBurstStates ?? []).some(
      (entry) => entry.cardInstanceId === instanceId
    );
  }
  return PUBLIC_CARD_ZONES.has(card.zone) && card.faceDown !== true;
}

export function appendPublicDisclosure(
  state: GameState,
  disclosure: PublicDisclosureInput
): GameState {
  const previous = state.publicDisclosures ?? [];
  const sequence = previous.at(-1)?.sequence ?? 0;
  const nextSequence = sequence + 1;
  const source = disclosure.source
    ? withDefinitionIdSnapshot(state, disclosure.source)
    : undefined;
  const entry: PublicDisclosure = {
    ...disclosure,
    ...(source ? { source } : {}),
    targets: disclosure.targets.map((target) =>
      target.kind === "card" ? withDefinitionIdSnapshot(state, target) : target
    ),
    results: disclosure.results.map((result) =>
      result.kind === "hidden_card_move"
        ? result
        : withDefinitionIdSnapshot(state, result)
    ),
    id: `public-disclosure:${state.turnNumber}:${nextSequence}`,
    sequence: nextSequence,
  };
  return {
    ...state,
    publicDisclosures: [...previous, entry],
  };
}

/** 「オープン」と、ゾーンを動かさず内容を見せる「公開」を区別して記録する。 */
export function appendCardRevealDisclosure(args: {
  state: GameState;
  actorPlayerId: string;
  cardInstanceIds: readonly string[];
  audience: PublicDisclosureAudience;
  open: boolean;
  sourceInstanceId?: string | undefined;
}): GameState {
  if (args.cardInstanceIds.length === 0) return args.state;
  return appendPublicDisclosure(args.state, {
    turnNumber: args.state.turnNumber,
    step: args.state.step,
    actorPlayerId: args.actorPlayerId,
    audience: args.audience,
    ...(args.sourceInstanceId
      ? { source: { instanceId: args.sourceInstanceId } }
      : {}),
    kind: "deck_revealed",
    targets: args.cardInstanceIds.map((instanceId) => ({
      kind: "card",
      instanceId,
      actionLabel: args.open ? "reveal" : "show_cards",
    })),
    results: [],
  });
}

function withDefinitionIdSnapshot<T extends PublicCardReference>(
  state: GameState,
  reference: T
): T {
  if (reference.definitionIdSnapshot || !reference.instanceId) {
    return reference;
  }
  const card = state.cardInstances.find(
    (entry) => entry.instanceId === reference.instanceId
  );
  if (!card || card.definitionId === "_hidden_card_") return reference;
  return { ...reference, definitionIdSnapshot: card.definitionId };
}

function actionLabelForDestination(
  to: Zone,
  position?: "top" | "bottom"
): PublicDisclosureActionLabel | undefined {
  switch (to) {
    case "hand":
      return "add_to_hand";
    case "deck":
      return position === "top"
        ? "move_to_top"
        : position === "bottom"
          ? "move_to_bottom"
          : "move_to_deck";
    case "trash":
      return "move_to_trash";
    case "field":
      return "move_to_field";
    case "mirage":
      return "mirage_set";
    case "set_aside":
      return "move_to_set_aside";
    case "removed_from_game":
      return "move_to_removed";
  }
  return undefined;
}

/** DSL action を移動先・デッキ位置込みで renderer 用の安定キーに射影する。 */
export function publicDisclosureActionLabelForAction(
  action: Action
): PublicDisclosureActionLabel | undefined {
  switch (action.kind) {
    case "summon":
      return fieldEntryActionLabel(
        action.enterFieldEventKind ?? "summon",
        action.effectScope
      );
    case "put":
      return fieldEntryActionLabel("put", action.effectScope);
    case "advent":
      return "advent";
    case "rebirth":
      return "rebirth";
    case "reverse_rebirth":
      return action.mode === "flip" ? "flip" : "summon";
    case "reveal_hand":
    case "peek_deck":
      return "show_cards";
    case "destroy":
    case "bp_compare_destroy":
      return "destroy";
    case "vanish":
      return "vanish";
    case "core_move":
    case "core_distribute":
    case "core_set_to_level":
    case "pay_cost":
      return "core_move";
    case "bp_modify":
      return "bp_modified";
    case "draw":
      return "draw";
    case "life_damage":
      return "life_reduce";
    case "life_fill":
      return "life_recover";
    case "recover":
      return "recover";
    case "exhaust":
      return action.degree === "heavy_exhaust" ? "heavily_exhaust" : "exhaust";
    case "set_exhaust_state":
      return action.state === "heavily_exhausted"
        ? "heavily_exhaust"
        : action.state === "recovered"
          ? "recover"
          : "exhaust";
    case "count_increase":
      return "count_increase";
    case "count_decrease":
      return "count_decrease";
    case "count_set":
      return "count_set";
    case "symbol_add":
      return "symbol_modified";
    case "enter_soul_state":
      return "enter_soul_state";
    case "place":
      return "place";
    case "brave_combine_effect":
      return "combine";
    case "brave_separate_effect":
      return "separate";
    case "negate":
      return "negate";
    case "suppress_effect":
    case "suppress_stack_source":
      return "suppress";
    case "effect_immunity":
    case "effect_resistance":
      return "immunity_added";
    case "grant_effect":
      return "effect_granted";
    case "discard":
      return action.destination === "deck_bottom"
        ? "move_to_bottom"
        : "discard";
    case "bullet_edit":
      return "bullet_edit_place";
    case "swap_bullet_edit":
      return "bullet_edit_swap";
    case "move_card":
      return actionLabelForDestination(action.to.zone, action.to.position);
    case "move_self":
      return actionLabelForDestination(action.destination);
    case "set_self_as_mirage":
      return "mirage_set";
    case "send_to_deck":
      return action.position === "top" ? "move_to_top" : "move_to_bottom";
    case "bounce":
      return action.destination === "set_aside"
        ? "move_to_set_aside"
        : "add_to_hand";
    case "remove_from_game":
      return "move_to_removed";
  }
  return undefined;
}

function fieldEntryActionLabel(
  kind: "summon" | "place" | "put",
  effectScope?: string
): PublicDisclosureActionLabel {
  return kind === "put" && effectScope === "genkai" ? "genkai" : kind;
}

/** 宣言/解決が保持している操作。カード種別から召喚とは推測しない。 */
export interface PublicDisclosureActionContext {
  kind: string;
  cardInstanceId?: string;
  braveInstanceId?: string;
  sourceInstanceId?: string;
}

function contextualActionLabel(
  context: PublicDisclosureActionContext | undefined,
  instanceId: string
): PublicDisclosureActionLabel | undefined {
  if (
    !context ||
    (context.cardInstanceId ??
      context.braveInstanceId ??
      context.sourceInstanceId) !== instanceId
  )
    return undefined;
  switch (context.kind) {
    case "summon":
      return "summon";
    case "place_nexus":
      return "place";
    case "contract_combine":
      return "contract_combine";
    case "declare_advent":
    case "declare_host_dual_advent":
    case "declare_dual_host_advent":
      return "advent";
    case "declare_manifest":
      return "manifest";
    case "brave_combine":
      return "combine";
    case "brave_separate":
      return "separate";
    case "brave_swap":
      return "brave_swap";
    case "flip_instead_of_attack":
      return "flip";
  }
  return undefined;
}

function actionKindForFallback(
  action: Action,
  actionLabel: PublicDisclosureActionLabel
): string | undefined {
  return actionLabel === "action_execute" ? action.kind : undefined;
}

function playerLifeCount(state: GameState, playerId: string): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return player ? player.lifeNormalCoreCount + player.lifeSoulCoreCount : 0;
}

/** 付随する離脱・移動先置換を、元アクションの動詞で誤表示しない。 */
function actionLabelForCardMove(
  label: PublicDisclosureActionLabel,
  to: Zone
): PublicDisclosureActionLabel {
  switch (label) {
    case "summon":
    case "place":
    case "put":
    case "genkai":
    case "advent":
    case "contract_combine":
    case "manifest":
    case "combine":
    case "move_to_field":
      if (to === "field") return label;
      break;
    case "destroy":
    case "vanish":
    case "discard":
    case "move_to_trash":
      if (to === "trash") return label;
      break;
    case "add_to_hand":
    case "draw":
      if (to === "hand") return label;
      break;
    case "move_to_deck":
    case "move_to_top":
    case "move_to_bottom":
      if (to === "deck") return label;
      break;
    case "move_to_set_aside":
      if (to === "set_aside") return label;
      break;
    case "move_to_removed":
      if (to === "removed_from_game") return label;
      break;
    case "mirage_set":
      if (to === "mirage") return label;
      break;
    case "core_move":
    case "bp_modified":
    case "recover":
    case "exhaust":
    case "heavily_exhaust":
      break;
    default:
      return label;
  }
  return actionLabelForDestination(to) ?? label;
}

function cardCoreCount(
  card: GameState["cardInstances"][number] | undefined
): number {
  return card ? card.normalCoreCount + card.soulCoreCount : 0;
}

function collectCardStateResults(
  before: GameState,
  after: GameState,
  labelForCard: (instanceId: string) => PublicDisclosureActionLabel | undefined
): PublicDisclosureResult[] {
  const results: PublicDisclosureResult[] = [];
  const beforeCards = new Map(
    before.cardInstances.map((card) => [card.instanceId, card])
  );
  const beforeSouls = new Set(
    before.players.flatMap((player) => player.soulStateInstanceIds)
  );
  const afterSouls = new Set(
    after.players.flatMap((player) => player.soulStateInstanceIds)
  );
  for (const card of after.cardInstances) {
    const previous = beforeCards.get(card.instanceId);
    if (
      !previous ||
      card.zone !== "field" ||
      !isCardIdentityPublicForDisclosure(after, card.instanceId)
    )
      continue;
    if (isAwaitingEffectEntryCores(after, card.instanceId)) continue;
    const label = labelForCard(card.instanceId);
    const add = (actionLabel: PublicDisclosureActionLabel) =>
      results.push({
        kind: "card_state",
        instanceId: card.instanceId,
        actionLabel,
      });
    if (
      previous.zone === "field" &&
      previous.definitionId !== card.definitionId
    ) {
      add(label === "rebirth" || label === "summon" ? label : "flip");
    }
    if (
      card.zoneRoleName === "brave" &&
      previous.attachedToInstanceId !== card.attachedToInstanceId &&
      (previous.zone === "field" || label !== "contract_combine")
    ) {
      add(
        label === "contract_combine"
          ? label
          : card.attachedToInstanceId === null
            ? "separate"
            : previous.attachedToInstanceId === null
              ? "combine"
              : "brave_swap"
      );
    }
    if (
      previous.zone === "field" &&
      beforeSouls.has(card.instanceId) !== afterSouls.has(card.instanceId)
    ) {
      add(
        afterSouls.has(card.instanceId)
          ? "enter_soul_state"
          : label === "summon"
            ? label
            : "leave_soul_state"
      );
    }
  }
  return results;
}

/**
 * ゾーン移動だけでは失われる、公開済みの数値・状態変化を単一 DSL step から採取する。
 * 非公開カードの identity は扱わず、player の公開カウンタと公開カードだけを対象にする。
 */
function collectEffectStepStateResults(args: {
  before: GameState;
  after: GameState;
  action: Action;
}): PublicDisclosureResult[] {
  const results: PublicDisclosureResult[] = [];
  const actionLabel =
    publicDisclosureActionLabelForAction(args.action) ?? "action_execute";
  const actionKind = actionKindForFallback(args.action, actionLabel);
  const withActionKind = actionKind ? { actionKind } : {};

  for (const afterPlayer of args.after.players) {
    const beforePlayer = args.before.players.find(
      (candidate) => candidate.id === afterPlayer.id
    );
    if (!beforePlayer) continue;

    const lifeDelta =
      playerLifeCount(args.after, afterPlayer.id) -
      playerLifeCount(args.before, afterPlayer.id);
    if (lifeDelta !== 0) {
      results.push({
        kind: "life_delta",
        playerId: afterPlayer.id,
        amount: lifeDelta,
        actionLabel: lifeDelta < 0 ? "life_reduce" : "life_recover",
      });
    }

    const countDelta = afterPlayer.countValue - beforePlayer.countValue;
    if (countDelta !== 0) {
      results.push({
        kind: "count_delta",
        playerId: afterPlayer.id,
        amount: countDelta,
        ...(args.action.kind === "count_set"
          ? { value: afterPlayer.countValue }
          : {}),
        actionLabel:
          args.action.kind === "count_set"
            ? "count_set"
            : countDelta > 0
              ? "count_increase"
              : "count_decrease",
      });
    }

    if (args.action.kind === "draw") {
      const handDelta = afterPlayer.handCount - beforePlayer.handCount;
      if (handDelta > 0) {
        results.push({
          kind: "hand_delta",
          playerId: afterPlayer.id,
          amount: handDelta,
          actionLabel: "draw",
        });
      }
    }

    if (
      args.action.kind === "core_move" ||
      args.action.kind === "core_distribute" ||
      args.action.kind === "core_set_to_level" ||
      args.action.kind === "pay_cost"
    ) {
      const containerCounts: Array<[Zone, number, number]> = [
        [
          "reserve",
          beforePlayer.reserveNormalCoreCount +
            beforePlayer.reserveSoulCoreCount,
          afterPlayer.reserveNormalCoreCount + afterPlayer.reserveSoulCoreCount,
        ],
        [
          "trash",
          beforePlayer.trashNormalCoreCount + beforePlayer.trashSoulCoreCount,
          afterPlayer.trashNormalCoreCount + afterPlayer.trashSoulCoreCount,
        ],
        [
          "void",
          beforePlayer.voidNormalCoreCount,
          afterPlayer.voidNormalCoreCount,
        ],
      ];
      for (const [zone, beforeCount, afterCount] of containerCounts) {
        if (beforeCount === afterCount) continue;
        results.push({
          kind: "core_delta",
          playerId: afterPlayer.id,
          zone,
          amount: afterCount - beforeCount,
          actionLabel: "core_move",
        });
      }
    }
  }

  const beforeCards = new Map(
    args.before.cardInstances.map((card) => [card.instanceId, card])
  );
  for (const afterCard of args.after.cardInstances) {
    const beforeCard = beforeCards.get(afterCard.instanceId);
    if (!beforeCard) continue;
    const isPublic =
      isCardIdentityPublicForDisclosure(args.before, afterCard.instanceId) ||
      isCardIdentityPublicForDisclosure(args.after, afterCard.instanceId);
    if (!isPublic) continue;

    if (beforeCard.exhaustState !== afterCard.exhaustState) {
      results.push({
        kind: "exhaust_state",
        instanceId: afterCard.instanceId,
        exhaustState: afterCard.exhaustState,
        actionLabel:
          afterCard.exhaustState === "recovered" ||
          beforeCard.exhaustState === "heavily_exhausted"
            ? "recover"
            : afterCard.exhaustState === "heavily_exhausted"
              ? "heavily_exhaust"
              : "exhaust",
        ...withActionKind,
      });
    }

    if (
      actionLabel === "core_move" &&
      cardCoreCount(beforeCard) !== cardCoreCount(afterCard)
    ) {
      results.push({
        kind: "core_delta",
        instanceId: afterCard.instanceId,
        amount: cardCoreCount(afterCard) - cardCoreCount(beforeCard),
        actionLabel: "core_move",
      });
    }
  }
  return [
    ...results,
    ...collectCardStateResults(args.before, args.after, () => actionLabel),
  ];
}

function audienceForRevealedCard(
  card: GameState["cardInstances"][number]
): PublicDisclosureAudience {
  switch (card.revealedTo ?? "both") {
    case "self":
      return "actor_only";
    case "opponent":
      return "opponent_only";
    default:
      return "both";
  }
}

/**
 * ゾーン遷移の結果としてカード素性を載せられる viewer 範囲。
 *
 * 素性が非公開なら undefined。呼び出し側は移動の事実を匿名で残す。
 */
function publicAudienceForCard(
  state: GameState,
  card: GameState["cardInstances"][number]
): PublicDisclosureAudience | undefined {
  if (hasPublicCardContentsRule(state, card)) return "both";
  if (card.zone === "revealed") return audienceForRevealedCard(card);
  if (card.zone === "burst") {
    return (state.revealedBurstStates ?? []).some(
      (entry) => entry.cardInstanceId === card.instanceId
    )
      ? "both"
      : undefined;
  }
  return PUBLIC_CARD_ZONES.has(card.zone) && card.faceDown !== true
    ? "both"
    : undefined;
}

/** 素性も live instance も持たない、移動の公開事実。 */
function hiddenCardMoveResult(
  previous: GameState["cardInstances"][number],
  to: Zone,
  actionLabel: PublicDisclosureActionLabel
): PublicDisclosureResult {
  return {
    kind: "hidden_card_move",
    playerId: previous.ownerPlayerId,
    count: 1,
    from: previous.zone,
    to,
    hiddenReason: "without_showing_contents",
    actionLabel,
  };
}

function sourceFromStateTransition(
  after: GameState,
  actorPlayerId: string
): PublicDisclosure["source"] | undefined {
  const source = after.cardInstances.find(
    (card) =>
      card.controllerPlayerId === actorPlayerId && card.zone === "in_use"
  );
  return source ? { instanceId: source.instanceId } : undefined;
}

interface CardZoneMove {
  previous: GameState["cardInstances"][number];
  current: GameState["cardInstances"][number];
}

interface PlannedCardZoneMove extends CardZoneMove {
  to: Zone;
}

function collectCardZoneMoves(
  before: GameState,
  after: GameState
): CardZoneMove[] {
  const beforeById = new Map(
    before.cardInstances.map((card) => [card.instanceId, card])
  );
  const moves: CardZoneMove[] = [];
  for (const current of after.cardInstances) {
    // 使用宣言の内部待機場所。使用自体は効果キューで表示し、実際の行き先で記録する。
    if (current.zone === "in_use") continue;
    const previous = beforeById.get(current.instanceId);
    if (isAwaitingEffectEntryCores(after, current.instanceId)) continue;
    const finalizedTarget = getMultiPlacementTargets(
      before.pendingMultiPlacement
    ).find((target) => target.instanceId === current.instanceId);
    const origin =
      finalizedTarget && current.zone === "field"
        ? before.pendingMultiPlacement?.priorStateSnapshot?.cardInstances.find(
            (card) => card.instanceId === current.instanceId
          )
        : undefined;
    if (!previous && current.zone !== "field") continue;
    const source = origin ?? previous ?? current;
    if (
      previous &&
      source.zone === current.zone &&
      (!finalizedTarget || finalizedTarget.enterFieldEventKind === null)
    ) {
      continue;
    }
    moves.push({ previous: source, current });
  }
  return moves;
}

function deckCardsForPlayer(
  state: GameState,
  playerId: string
): GameState["cardInstances"] {
  return state.cardInstances.filter(
    (card) => card.ownerPlayerId === playerId && card.zone === "deck"
  );
}

function inferDeckMovePositionFromStateTransition(
  before: GameState,
  after: GameState,
  current: GameState["cardInstances"][number]
): "top" | "bottom" | undefined {
  if (current.zone !== "deck") return undefined;
  const beforeDeckIds = new Set(
    deckCardsForPlayer(before, current.ownerPlayerId).map(
      (card) => card.instanceId
    )
  );
  if (beforeDeckIds.size === 0) return undefined;
  const afterDeck = deckCardsForPlayer(after, current.ownerPlayerId);
  const currentTopIndex = afterDeck.findIndex(
    (card) => card.instanceId === current.instanceId
  );
  if (currentTopIndex < 0) return undefined;
  const existingIndexes = afterDeck.flatMap((card, index) =>
    beforeDeckIds.has(card.instanceId) ? [index] : []
  );
  if (existingIndexes.length === 0) return undefined;
  if (currentTopIndex < Math.min(...existingIndexes)) return "top";
  if (currentTopIndex > Math.max(...existingIndexes)) return "bottom";
  return undefined;
}

function deckPlacementSnapshotForCard(
  state: GameState,
  card: GameState["cardInstances"][number],
  position: "top" | "bottom" | undefined
): Pick<
  PublicDisclosureResult,
  "deckPositionSnapshot" | "deckIndexFromBottomSnapshot" | "deckCountSnapshot"
> {
  if (card.zone !== "deck" || !position) return {};
  const deckCards = deckCardsForPlayer(state, card.ownerPlayerId);
  const topIndex = deckCards.findIndex(
    (entry) => entry.instanceId === card.instanceId
  );
  if (topIndex < 0) return {};
  const deckCountSnapshot = deckCards.length;
  return {
    deckPositionSnapshot: position,
    deckIndexFromBottomSnapshot: deckCountSnapshot - 1 - topIndex,
    deckCountSnapshot,
  };
}

function deckMovePositionForActionLabel(
  actionLabel: PublicDisclosureActionLabel
): "top" | "bottom" | undefined {
  if (actionLabel === "move_to_top") return "top";
  if (actionLabel === "move_to_bottom") return "bottom";
  return undefined;
}

function defaultPendingLeaveDestination(
  kind: GameState["pendingLeaveEntities"][number]["kind"]
): Zone {
  return kind === "remove_from_game" ? "removed_from_game" : "trash";
}

function pendingLeaveDestinationKey(
  pending: GameState["pendingLeaveEntities"][number]
): string {
  const destination = pending.leaveDestination;
  if (!destination) return `${defaultPendingLeaveDestination(pending.kind)}::`;
  return `${destination.zone}:${destination.position ?? ""}`;
}

function collectPendingLeaveZoneMoves(
  before: GameState,
  after: GameState
): PlannedCardZoneMove[] {
  const beforePendingById = new Map(
    before.pendingLeaveEntities.map((pending) => [pending.instanceId, pending])
  );
  const beforeCardById = new Map(
    before.cardInstances.map((card) => [card.instanceId, card])
  );
  const afterCardById = new Map(
    after.cardInstances.map((card) => [card.instanceId, card])
  );
  const moves: PlannedCardZoneMove[] = [];
  for (const pending of after.pendingLeaveEntities) {
    const previousPending = beforePendingById.get(pending.instanceId);
    if (
      previousPending &&
      previousPending.kind === pending.kind &&
      pendingLeaveDestinationKey(previousPending) ===
        pendingLeaveDestinationKey(pending)
    ) {
      continue;
    }
    const previous = beforeCardById.get(pending.instanceId);
    const current = afterCardById.get(pending.instanceId);
    if (
      !previous ||
      !current ||
      previous.zone !== "field" ||
      current.zone !== "field"
    ) {
      continue;
    }
    const to =
      pending.leaveDestination?.zone ??
      defaultPendingLeaveDestination(pending.kind);
    if (to === "field") continue;
    moves.push({ previous, current, to });
  }
  return moves;
}

function appendResultsToMatchingTargetRecords(args: {
  state: GameState;
  actorPlayerId: string;
  resultsByAudience: Map<PublicDisclosureAudience, PublicDisclosureResult[]>;
  eligibleDisclosureIds?: ReadonlySet<string>;
  eligibleTargetInstanceIds?: ReadonlySet<string>;
}): { state: GameState; unmatchedByAudience: typeof args.resultsByAudience } {
  const entries = [...(args.state.publicDisclosures ?? [])];
  const unmatchedByAudience = new Map<
    PublicDisclosureAudience,
    PublicDisclosureResult[]
  >();

  for (const [audience, results] of args.resultsByAudience) {
    for (const rawResult of results) {
      const result = withDefinitionIdSnapshot(args.state, rawResult);
      const matchingEntryIndex =
        result.instanceId === undefined ||
        (args.eligibleTargetInstanceIds !== undefined &&
          !args.eligibleTargetInstanceIds.has(result.instanceId))
          ? -1
          : entries.findLastIndex(
              (entry) =>
                entry.kind === "target_declared" &&
                (args.eligibleDisclosureIds === undefined ||
                  args.eligibleDisclosureIds.has(entry.id)) &&
                entry.actorPlayerId === args.actorPlayerId &&
                entry.audience === audience &&
                entry.targets.some(
                  (target) => target.instanceId === result.instanceId
                )
            );
      if (matchingEntryIndex < 0) {
        const unmatched = unmatchedByAudience.get(audience) ?? [];
        unmatched.push(result);
        unmatchedByAudience.set(audience, unmatched);
        continue;
      }

      const matchingEntry = entries[matchingEntryIndex]!;
      entries[matchingEntryIndex] = {
        ...matchingEntry,
        results: [...matchingEntry.results, result],
      };
    }
  }

  return {
    state: { ...args.state, publicDisclosures: entries },
    unmatchedByAudience,
  };
}

/**
 * DSL の単一 step が同期完了した直後に、action の意味を失わない状態で移動を記録する。
 * legal action 全体の差分観測は pending/finalization 経路の補完として残す。
 */
export function appendPublicDisclosuresForEffectStepTransition(args: {
  before: GameState;
  after: GameState;
  actorPlayerId: string;
  action: Action;
  sourceInstanceId?: string;
  effectIndex?: number;
  definitionPath?: readonly (string | number)[] | null;
  targetInstanceIds?: readonly string[];
}): GameState {
  const moves = collectCardZoneMoves(args.before, args.after);
  const pendingMoves = collectPendingLeaveZoneMoves(args.before, args.after);
  const stateResults = collectEffectStepStateResults({
    before: args.before,
    after: args.after,
    action: args.action,
  });
  if (
    (moves.length === 0 &&
      pendingMoves.length === 0 &&
      stateResults.length === 0) ||
    args.action.kind === "deck_reveal"
  ) {
    return syncKnownDeckCardsForStateTransition({
      before: args.before,
      after: args.after,
      actorPlayerId: args.actorPlayerId,
    });
  }

  const actionLabel =
    publicDisclosureActionLabelForAction(args.action) ?? "action_execute";
  const actionKind = actionKindForFallback(args.action, actionLabel);
  const hidesIdentity =
    (args.action.kind === "discard" || args.action.kind === "move_card") &&
    args.action.unseen === true;
  // 移動元自身が非公開カードでも、source snapshot から素性を漏らさない。
  // 使用宣言済みの in_use は効果キューでも公開されている。
  const sourceIsPublic =
    args.sourceInstanceId &&
    [args.before, args.after].some(
      (state) =>
        isCardIdentityPublicForDisclosure(state, args.sourceInstanceId!) ||
        state.cardInstances.some(
          (card) =>
            card.instanceId === args.sourceInstanceId && card.zone === "in_use"
        )
    );
  const source =
    args.sourceInstanceId && sourceIsPublic
      ? {
          instanceId: args.sourceInstanceId,
          ...(args.effectIndex !== undefined
            ? { effectIndex: args.effectIndex }
            : {}),
          ...(args.definitionPath !== undefined
            ? { definitionPath: args.definitionPath }
            : {}),
        }
      : undefined;

  if (hidesIdentity) {
    const grouped = new Map<string, PublicDisclosureResult>();
    const hiddenMoves = [
      ...moves.map(({ previous, current }) => ({
        from: previous.zone,
        to: current.zone,
      })),
      ...pendingMoves.map(({ previous, to }) => ({
        from: previous.zone,
        to,
      })),
    ];
    for (const { from, to } of hiddenMoves) {
      const key = `${from}:${to}`;
      const existing = grouped.get(key);
      grouped.set(key, {
        kind: "hidden_card_move",
        count: (existing?.count ?? 0) + 1,
        from,
        to,
        hiddenReason: "without_showing_contents",
        actionLabel,
        ...(actionKind ? { actionKind } : {}),
      });
    }
    const next = appendPublicDisclosure(args.after, {
      turnNumber: args.after.turnNumber,
      step: args.after.step,
      actorPlayerId: args.actorPlayerId,
      audience: "both",
      ...(source ? { source } : {}),
      kind: "hidden_card_action",
      targets: [],
      results: [...grouped.values()],
    });
    return syncKnownDeckCardsForStateTransition({
      before: args.before,
      after: next,
      actorPlayerId: args.actorPlayerId,
    });
  }

  const resultsByAudience = new Map<
    PublicDisclosureAudience,
    PublicDisclosureResult[]
  >();
  if (stateResults.length > 0) {
    resultsByAudience.set("both", stateResults);
  }
  for (const { previous, current } of moves) {
    const audience =
      publicAudienceForCard(args.after, current) ??
      publicAudienceForCard(args.before, previous);
    // ドローは枚数の既存イベントで記録する（画像もその枚数から導出）。
    if (
      !audience &&
      stateResults.some(
        (result) =>
          result.kind === "hand_delta" &&
          result.actionLabel === "draw" &&
          result.playerId === current.ownerPlayerId &&
          previous.zone === "deck" &&
          current.zone === "hand"
      )
    )
      continue;
    const results = resultsByAudience.get(audience ?? "both") ?? [];
    const moveLabel = actionLabelForCardMove(
      current.zone === "field" &&
        actionLabel === "summon" &&
        current.zoneRoleName === "nexus"
        ? "place"
        : actionLabel,
      current.zone
    );
    const deckPosition = deckMovePositionForActionLabel(moveLabel);
    results.push(
      audience
        ? {
            kind: "card_move",
            instanceId: current.instanceId,
            ...(previous.zone !== current.zone ? { from: previous.zone } : {}),
            to: current.zone,
            actionLabel: moveLabel,
            ...deckPlacementSnapshotForCard(args.after, current, deckPosition),
            ...(actionKind ? { actionKind } : {}),
          }
        : hiddenCardMoveResult(previous, current.zone, moveLabel)
    );
    resultsByAudience.set(audience ?? "both", results);
  }
  for (const { previous, current, to } of pendingMoves) {
    const audience =
      publicAudienceForCard(args.after, current) ??
      publicAudienceForCard(args.before, previous);
    const results = resultsByAudience.get(audience ?? "both") ?? [];
    const moveLabel = actionLabelForCardMove(actionLabel, to);
    const deckPosition = deckMovePositionForActionLabel(moveLabel);
    results.push(
      audience
        ? {
            kind: "card_move",
            instanceId: current.instanceId,
            from: previous.zone,
            to,
            actionLabel: moveLabel,
            ...deckPlacementSnapshotForCard(args.after, current, deckPosition),
            ...(actionKind ? { actionKind } : {}),
          }
        : hiddenCardMoveResult(previous, to, moveLabel)
    );
    resultsByAudience.set(audience ?? "both", results);
  }

  const correlated = appendResultsToMatchingTargetRecords({
    state: args.after,
    actorPlayerId: args.actorPlayerId,
    resultsByAudience,
    ...(args.targetInstanceIds !== undefined
      ? { eligibleTargetInstanceIds: new Set(args.targetInstanceIds) }
      : {}),
  });
  let next = correlated.state;
  for (const [audience, results] of correlated.unmatchedByAudience) {
    next = appendPublicDisclosure(next, {
      turnNumber: args.after.turnNumber,
      step: args.after.step,
      actorPlayerId: args.actorPlayerId,
      audience,
      ...(source ? { source } : {}),
      kind: results.some(
        (result) =>
          result.kind === "card_move" ||
          result.kind === "destroyed" ||
          result.kind === "hidden_card_move"
      )
        ? "zone_moved"
        : "state_changed",
      targets: [],
      results,
    });
  }
  return syncKnownDeckCardsForStateTransition({
    before: args.before,
    after: next,
    actorPlayerId: args.actorPlayerId,
  });
}

/**
 * legal action 後の公開ゾーン差分を構造化イベントにする共通出口。
 *
 * 対象宣言が同一 action 内で先に emit 済みなら、その record に結果を補完する。
 * これにより「対象」と「結果」が別ログへ二重 emit されない。
 */
export function appendPublicDisclosuresForStateTransition(args: {
  before: GameState;
  after: GameState;
  actorPlayerId: string;
  action?: PublicDisclosureActionContext;
}): GameState {
  const { before, after, actorPlayerId } = args;
  const previousDisclosures = new Map(
    (before.publicDisclosures ?? []).map((entry) => [entry.id, entry])
  );
  const newDisclosures = (after.publicDisclosures ?? []).flatMap((entry) => {
    const previous = previousDisclosures.get(entry.id);
    if (!previous) return [entry];
    return entry.results.length > previous.results.length
      ? [
          {
            ...entry,
            targets: [],
            results: entry.results.slice(previous.results.length),
          },
        ]
      : [];
  });
  const cardMoves = collectCardZoneMoves(before, after);
  const alreadyRecordedMoveIds = new Set(
    newDisclosures.flatMap((entry) => [
      ...entry.results.flatMap((result) =>
        (result.kind === "card_move" || result.kind === "destroyed") &&
        result.instanceId
          ? [result.instanceId]
          : []
      ),
    ])
  );
  const recordedLifeDeltaByPlayer = new Map<string, number>();
  for (const disclosure of newDisclosures) {
    for (const result of disclosure.results) {
      if (
        result.kind !== "life_delta" ||
        !result.playerId ||
        result.amount === undefined
      ) {
        continue;
      }
      recordedLifeDeltaByPlayer.set(
        result.playerId,
        (recordedLifeDeltaByPlayer.get(result.playerId) ?? 0) + result.amount
      );
    }
  }
  const remainingLifeDeltaByPlayer = new Map<string, number>();
  for (const afterPlayer of after.players) {
    const beforePlayer = before.players.find(
      (candidate) => candidate.id === afterPlayer.id
    );
    if (!beforePlayer) continue;
    const actualDelta =
      playerLifeCount(after, afterPlayer.id) -
      playerLifeCount(before, afterPlayer.id);
    const remainingDelta =
      actualDelta - (recordedLifeDeltaByPlayer.get(afterPlayer.id) ?? 0);
    if (remainingDelta !== 0) {
      remainingLifeDeltaByPlayer.set(afterPlayer.id, remainingDelta);
    }
  }
  const hiddenMoveBudgets: Array<{
    from: Zone;
    to: Zone;
    remaining: number;
    playerId?: string;
    allowChangedDestination: boolean;
  }> = [];
  for (const entry of newDisclosures) {
    for (const result of entry.results) {
      if (
        result.kind === "hand_delta" &&
        result.actionLabel === "draw" &&
        (result.amount ?? 0) > 0
      ) {
        hiddenMoveBudgets.push({
          from: "deck",
          to: "hand",
          remaining: result.amount!,
          allowChangedDestination: false,
          ...(result.playerId ? { playerId: result.playerId } : {}),
        });
        continue;
      }
      if (result.kind !== "hidden_card_move" || !result.from || !result.to) {
        continue;
      }
      const existing = hiddenMoveBudgets.find(
        (budget) =>
          budget.from === result.from &&
          budget.to === result.to &&
          budget.allowChangedDestination &&
          budget.playerId === result.playerId
      );
      if (existing) existing.remaining += result.count ?? 1;
      else {
        hiddenMoveBudgets.push({
          from: result.from,
          to: result.to,
          remaining: result.count ?? 1,
          allowChangedDestination: true,
          ...(result.playerId ? { playerId: result.playerId } : {}),
        });
      }
    }
  }
  const revealTargetsByAudience = new Map<
    PublicDisclosureAudience,
    PublicDisclosureTarget[]
  >();
  const movesByAudience = new Map<
    PublicDisclosureAudience,
    PublicDisclosureResult[]
  >();

  let next = after;
  const stateResults = collectCardStateResults(before, after, (instanceId) =>
    contextualActionLabel(args.action, instanceId)
  ).filter(
    (result) =>
      !newDisclosures.some((entry) =>
        entry.results.some(
          (recorded) =>
            recorded.instanceId === result.instanceId &&
            (recorded.kind === "card_state" ||
              recorded.actionLabel === "contract_combine" ||
              recorded.actionLabel === result.actionLabel)
        )
      )
  );
  if (stateResults.length > 0) {
    next = appendPublicDisclosure(next, {
      turnNumber: after.turnNumber,
      step: after.step,
      actorPlayerId,
      audience: "both",
      kind: "state_changed",
      targets: [],
      results: stateResults,
    });
  }
  const battleEntityMemberIds = (
    state: GameState,
    entityId: string | undefined
  ): string[] =>
    entityId
      ? (state.battleEntities.find((entity) => entity.entityId === entityId)
          ?.memberInstanceIds ?? [])
      : [];
  const actorForCard = (instanceId: string | undefined, fallback: string) =>
    (instanceId
      ? (after.cardInstances.find((card) => card.instanceId === instanceId)
          ?.controllerPlayerId ??
        before.cardInstances.find((card) => card.instanceId === instanceId)
          ?.controllerPlayerId)
      : undefined) ?? fallback;

  const beforeAttack = before.activeAttack;
  const afterAttack = after.activeAttack;
  if (
    afterAttack &&
    (!beforeAttack || beforeAttack.attackId !== afterAttack.attackId)
  ) {
    const primaryMemberIds = battleEntityMemberIds(
      after,
      afterAttack.primaryEntityId
    );
    const primaryInstanceId = primaryMemberIds[0];
    const attackerMemberIds = (
      afterAttack.participantEntityIds ?? [afterAttack.primaryEntityId]
    ).flatMap((entityId) => battleEntityMemberIds(after, entityId));
    const attackTargets: PublicDisclosureTarget[] = attackerMemberIds.map(
      (instanceId) => ({
        kind: "card",
        instanceId,
        actionLabel: "attack",
      })
    );
    if (afterAttack.target.kind === "player") {
      attackTargets.push({
        kind: "player",
        playerId: afterAttack.target.playerId,
        actionLabel: "attack_target",
      });
    } else {
      attackTargets.push(
        ...battleEntityMemberIds(after, afterAttack.target.entityId).map(
          (instanceId): PublicDisclosureTarget => ({
            kind: "card",
            instanceId,
            actionLabel: "attack_target",
          })
        )
      );
    }
    next = appendPublicDisclosure(next, {
      turnNumber: after.turnNumber,
      step: after.step,
      actorPlayerId: actorForCard(primaryInstanceId, after.activePlayerId),
      audience: "both",
      ...(primaryInstanceId
        ? { source: { instanceId: primaryInstanceId } }
        : {}),
      kind: "attack_declared",
      attackId: afterAttack.attackId,
      targets: attackTargets,
      results: [],
    });
  }

  if (
    beforeAttack &&
    afterAttack &&
    beforeAttack.attackId === afterAttack.attackId
  ) {
    for (const afterAssignment of afterAttack.blockAssignments ?? []) {
      const beforeBlockerIds = new Set(
        (beforeAttack.blockAssignments ?? []).find(
          (assignment) =>
            assignment.participantEntityId ===
            afterAssignment.participantEntityId
        )?.blockedByEntityIds ?? []
      );
      for (const blockerEntityId of afterAssignment.blockedByEntityIds) {
        if (beforeBlockerIds.has(blockerEntityId)) continue;
        const blockerMemberIds = battleEntityMemberIds(after, blockerEntityId);
        const blockerInstanceId = blockerMemberIds[0];
        const blockedMemberIds = battleEntityMemberIds(
          after,
          afterAssignment.participantEntityId
        );
        next = appendPublicDisclosure(next, {
          turnNumber: after.turnNumber,
          step: after.step,
          actorPlayerId: actorForCard(blockerInstanceId, actorPlayerId),
          audience: "both",
          ...(blockerInstanceId
            ? { source: { instanceId: blockerInstanceId } }
            : {}),
          kind: "block_declared",
          attackId: afterAttack.attackId,
          targets: [
            ...blockerMemberIds.map(
              (instanceId): PublicDisclosureTarget => ({
                kind: "card",
                instanceId,
                actionLabel: "block",
              })
            ),
            ...blockedMemberIds.map(
              (instanceId): PublicDisclosureTarget => ({
                kind: "card",
                instanceId,
                actionLabel: "block_target",
              })
            ),
          ],
          results: [],
        });
      }
    }
  }

  const connectDecisionOpened =
    after.pendingConnectBattleDecision !== null &&
    after.pendingConnectBattleDecision?.attackId === beforeAttack?.attackId &&
    before.pendingConnectBattleDecision?.pendingId !==
      after.pendingConnectBattleDecision.pendingId;
  const battleResolved =
    beforeAttack !== null &&
    !newDisclosures.some(
      (entry) =>
        entry.kind === "battle_resolved" &&
        entry.attackId === beforeAttack.attackId
    ) &&
    (afterAttack?.attackId !== beforeAttack.attackId || connectDecisionOpened);
  if (battleResolved && beforeAttack) {
    const primaryMemberIds = battleEntityMemberIds(
      before,
      beforeAttack.primaryEntityId
    );
    const primaryInstanceId = primaryMemberIds[0];
    const recordedBattleDestroyedIds = new Set([
      ...(beforeAttack.battleDestroyedRecords ?? []).map(
        (record) => record.instanceId
      ),
      ...(afterAttack?.battleDestroyedRecords ?? []).map(
        (record) => record.instanceId
      ),
    ]);
    const fieldLeaveMoves = cardMoves.filter(
      ({ previous, current }) =>
        previous.zone === "field" &&
        current.zone !== "field" &&
        !alreadyRecordedMoveIds.has(current.instanceId)
    );
    const destroyedMoves = fieldLeaveMoves.filter(({ current }) =>
      recordedBattleDestroyedIds.has(current.instanceId)
    );
    const battleResults: PublicDisclosureResult[] = destroyedMoves.map(
      ({ previous, current }) => ({
        kind: "destroyed",
        instanceId: current.instanceId,
        from: previous.zone,
        to: current.zone,
        actionLabel: "destroy",
      })
    );
    for (const { current } of destroyedMoves) {
      alreadyRecordedMoveIds.add(current.instanceId);
    }
    for (const [playerId, amount] of remainingLifeDeltaByPlayer) {
      battleResults.push({
        kind: "life_delta",
        playerId,
        amount,
        actionLabel: amount < 0 ? "life_reduce" : "life_recover",
      });
    }
    remainingLifeDeltaByPlayer.clear();
    next = appendPublicDisclosure(next, {
      turnNumber: after.turnNumber,
      step: after.step,
      actorPlayerId: actorForCard(primaryInstanceId, before.activePlayerId),
      audience: "both",
      ...(primaryInstanceId
        ? { source: { instanceId: primaryInstanceId } }
        : {}),
      kind: "battle_resolved",
      attackId: beforeAttack.attackId,
      targets: primaryMemberIds.map((instanceId) => ({
        kind: "card" as const,
        instanceId,
        actionLabel: "battle_resolve" as const,
      })),
      results: battleResults,
    });
  }

  for (const [playerId, amount] of remainingLifeDeltaByPlayer) {
    next = appendPublicDisclosure(next, {
      turnNumber: after.turnNumber,
      step: after.step,
      actorPlayerId,
      audience: "both",
      kind: "state_changed",
      targets: [
        {
          kind: "player",
          playerId,
          actionLabel: amount < 0 ? "life_reduce" : "life_recover",
        },
      ],
      results: [
        {
          kind: "life_delta",
          playerId,
          amount,
          actionLabel: amount < 0 ? "life_reduce" : "life_recover",
        },
      ],
    });
  }

  for (const { previous, current } of cardMoves) {
    if (alreadyRecordedMoveIds.has(current.instanceId)) continue;
    const hiddenBudget =
      hiddenMoveBudgets.find(
        (budget) =>
          budget.remaining > 0 &&
          (!budget.playerId || budget.playerId === current.ownerPlayerId) &&
          budget.from === previous.zone &&
          budget.to === current.zone
      ) ??
      hiddenMoveBudgets.find(
        (budget) =>
          budget.remaining > 0 &&
          budget.allowChangedDestination &&
          budget.from === previous.zone &&
          (!budget.playerId || budget.playerId === current.ownerPlayerId)
      );
    if (hiddenBudget) {
      hiddenBudget.remaining -= 1;
      continue;
    }

    if (previous.zone === "deck" && current.zone === "revealed") {
      if (
        newDisclosures.some(
          (entry) =>
            entry.kind === "deck_revealed" &&
            entry.targets.some(
              (target) => target.instanceId === current.instanceId
            )
        )
      )
        continue;
      const audience = audienceForRevealedCard(current);
      const revealTargets = revealTargetsByAudience.get(audience) ?? [];
      revealTargets.push({
        kind: "card",
        instanceId: current.instanceId,
        actionLabel: "reveal",
      });
      revealTargetsByAudience.set(audience, revealTargets);
      continue;
    }

    // 現在の公開範囲を優先する。例: self-only reveal → trash はトラッシュに
    // 表向きで置かれた時点から両者へ公開される。非公開間も匿名で記録する。
    const audience =
      publicAudienceForCard(after, current) ??
      publicAudienceForCard(before, previous) ??
      newDisclosures.find(
        (entry) =>
          entry.kind === "deck_revealed" &&
          entry.targets.some(
            (target) => target.instanceId === current.instanceId
          )
      )?.audience;
    const inferredDeckPosition =
      current.zone === "deck"
        ? before.pendingZoneSelection?.candidateCardInstanceIds.includes(
            current.instanceId
          )
          ? before.pendingZoneSelection.destination === "deck_bottom"
            ? "bottom"
            : (before.pendingZoneSelection.destinationPosition ??
              inferDeckMovePositionFromStateTransition(before, after, current))
          : inferDeckMovePositionFromStateTransition(before, after, current)
        : undefined;
    const placementTarget = getMultiPlacementTargets(
      before.pendingMultiPlacement
    ).find((target) => target.instanceId === current.instanceId);
    const fieldLabel =
      placementTarget && placementTarget.enterFieldEventKind !== null
        ? fieldEntryActionLabel(
            placementTarget.enterFieldEventKind ?? "summon",
            placementTarget.effectScope
          )
        : contextualActionLabel(args.action, current.instanceId);
    const resultActionLabel: PublicDisclosureActionLabel =
      current.zone === "field" && fieldLabel
        ? fieldLabel
        : previous.zone === "hand" && current.zone === "trash"
          ? "discard"
          : inferredDeckPosition
            ? inferredDeckPosition === "top"
              ? "move_to_top"
              : "move_to_bottom"
            : (actionLabelForDestination(current.zone) ?? "action_execute");
    const result: PublicDisclosureResult = audience
      ? {
          kind: "card_move",
          instanceId: current.instanceId,
          ...(previous.zone !== current.zone ? { from: previous.zone } : {}),
          to: current.zone,
          actionLabel: resultActionLabel,
          ...deckPlacementSnapshotForCard(after, current, inferredDeckPosition),
        }
      : hiddenCardMoveResult(previous, current.zone, resultActionLabel);
    const existing = movesByAudience.get(audience ?? "both") ?? [];
    existing.push(result);
    movesByAudience.set(audience ?? "both", existing);
  }

  for (const [audience, revealTargets] of revealTargetsByAudience) {
    const source = sourceFromStateTransition(after, actorPlayerId);
    next = appendPublicDisclosure(next, {
      turnNumber: after.turnNumber,
      step: after.step,
      actorPlayerId,
      audience,
      ...(source ? { source } : {}),
      kind: "deck_revealed",
      targets: revealTargets,
      results: [],
    });
  }

  const correlated = appendResultsToMatchingTargetRecords({
    state: next,
    actorPlayerId,
    resultsByAudience: movesByAudience,
    eligibleDisclosureIds: new Set(
      newDisclosures
        .filter((entry) => entry.kind === "target_declared")
        .map((entry) => entry.id)
    ),
  });
  next = correlated.state;
  for (const [audience, results] of correlated.unmatchedByAudience) {
    const source = sourceFromStateTransition(after, actorPlayerId);
    next = appendPublicDisclosure(next, {
      turnNumber: after.turnNumber,
      step: after.step,
      actorPlayerId,
      audience,
      ...(source ? { source } : {}),
      kind: results.some(
        (result) => result.from === "revealed" && result.to === "hand"
      )
        ? "picked"
        : "zone_moved",
      targets: [],
      results,
    });
  }

  return syncKnownDeckCardsForStateTransition({
    before,
    after: next,
    actorPlayerId,
  });
}
