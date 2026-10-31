import type { DSL, Effect, EffectStep } from "../dsl-types";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
  Zone,
} from "../model";
import { getCEsForTarget } from "../card/ce-lookup";
import {
  matchesCardFilter,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import { getEffectiveColors } from "../legal/legal-actions-shared";
import { nextDslCeId } from "./native-action-shared";
import { resolvePlayerRef } from "./structured-effect-interpreter";
import { deriveEffectLabelsFromTextRefs } from "./effect-label-utils";

type Lookup = (id: string) => CardDefinition | undefined;
type Rule =
  | DSL.GrantDeckHandAccessAction
  | DSL.RequireEffectCostAction
  | DSL.GrantMagicUseAction;

export function registerCardAccessRule(
  state: GameState,
  sourceId: string,
  actor: string,
  action: Rule,
  effect: Effect,
  provenance?: ContinuousEffect["provenance"]
): GameState {
  const players =
    action.kind === "grant_magic_use"
      ? [sourceId]
      : action.player === "either"
        ? state.playerOrder
        : [resolvePlayerRef(actor, action.player, state)];
  const ces: ContinuousEffect[] = players.map((player) => ({
    effectId: nextDslCeId(action.kind),
    sourceInstanceId: sourceId,
    sourceDefinitionId: state.cardInstances.find(
      (c) => c.instanceId === sourceId
    )!.definitionId,
    actingPlayerId: actor,
    targetInstanceId: player,
    modifierTag:
      action.kind === "grant_magic_use"
        ? "magic_use_permission"
        : action.kind === "grant_deck_hand_access"
          ? "deck_hand_access"
          : "required_effect_cost",
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    ...(provenance ? { provenance } : {}),
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    metadata: { rule: action },
  }));
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...ces],
  };
}

/** 使用許可は合法手の拡張。効果を宣言・解決するアクションは生成しない。 */
export function hasMagicUsePermission(
  state: GameState,
  cardId: string,
  timing: "main" | "flash" | "stack"
): boolean {
  return getCEsForTarget(state, cardId).some(
    (ce) =>
      ce.modifierTag === "magic_use_permission" &&
      (ce.metadata?.rule as DSL.GrantMagicUseAction | undefined)?.timing ===
        timing
  );
}

/** Physical deck order is preserved while looking at cards, until the reorder is committed. */
function deckIdsForAccess(state: GameState, owner: string): string[] {
  const deck = state.cardInstances
    .filter((c) => c.ownerPlayerId === owner && c.zone === "deck")
    .map((c) => c.instanceId);
  const pending =
    state.pendingDeckReveal ??
    state.pendingZoneSelection?.deckRevealResumeAfterSwapSelection;
  if (
    !pending ||
    pending.revealTo !== "self" ||
    pending.actingPlayerId !== owner
  )
    return deck;
  const looked =
    pending.originalRevealedCardInstanceIds ?? pending.revealedCardInstanceIds;
  return [
    ...new Set([
      ...looked.filter((id) =>
        state.cardInstances.some(
          (c) =>
            c.instanceId === id && (c.zone === "revealed" || c.zone === "deck")
        )
      ),
      ...deck,
    ]),
  ];
}

export function getFaceUpDeckIds(state: GameState, owner: string): string[] {
  // 過去のスナップショットには CE 配列が無い。公開権限は既定で付与しない。
  if (!state.activeContinuousEffects?.length) return [];
  const count = Math.max(
    0,
    ...getCEsForTarget(state, owner)
      .filter((ce) => ce.modifierTag === "deck_hand_access")
      .map((ce) => (ce.metadata?.rule as DSL.GrantDeckHandAccessAction).count)
  );
  // 私的な閲覧中も使用許可・論理上のデッキ順は維持するが、閲覧中の
  // カード自体は相手に非公開。元の上3枚を追跡して選択結果を漏らさない。
  const physicalDeckIds = new Set(
    state.cardInstances
      .filter((card) => card.zone === "deck")
      .map((card) => card.instanceId)
  );
  return deckIdsForAccess(state, owner)
    .slice(0, count)
    .filter((id) => physicalDeckIds.has(id));
}

/** QA-056/057: visibility exceptions shared by viewer sanitization, logs, and known deck slots. */
export function hasPublicCardContentsRule(
  state: GameState,
  card: CardInstance,
  faceUpIds?: ReadonlySet<string>
): boolean {
  return (
    (card.zone === "field" && card.faceDownContentsPublic === true) ||
    (faceUpIds
      ? faceUpIds.has(card.instanceId)
      : getFaceUpDeckIds(state, card.ownerPlayerId).includes(card.instanceId))
  );
}

export function getDeckHandCards(
  state: GameState,
  owner: string,
  lookup: Lookup
): CardInstance[] {
  const order = deckIdsForAccess(state, owner);
  const rules = getCEsForTarget(state, owner)
    .filter((ce) => ce.modifierTag === "deck_hand_access")
    .map((ce) => ce.metadata?.rule as DSL.GrantDeckHandAccessAction);
  return state.cardInstances.filter((card) => {
    if (card.ownerPlayerId !== owner) return false;
    const index = order.indexOf(card.instanceId);
    if (index < 0) return false;
    const def = lookup(card.definitionId);
    return (
      !!def &&
      rules.some(
        (rule) =>
          index < rule.count &&
          matchesCardFilter(card, def, rule.filter, {
            state,
            getCardDefinitionById: lookup,
            effectiveColors: getEffectiveColors(state, card, def),
          })
      )
    );
  });
}

export function isInHandForOwnEffect(
  state: GameState,
  card: CardInstance,
  actor: string,
  lookup: Lookup
): boolean {
  return (
    card.zone === "hand" ||
    (card.ownerPlayerId === actor &&
      getDeckHandCards(state, actor, lookup).some(
        (c) => c.instanceId === card.instanceId
      ))
  );
}

/** Keep deck cards in their physical zone, including when reporting the origin to the opponent. */
export function getOwnHandCards(
  state: GameState,
  actor: string,
  lookup: Lookup
): CardInstance[] {
  return [
    ...state.cardInstances.filter(
      (c) => c.ownerPlayerId === actor && c.zone === "hand"
    ),
    ...getDeckHandCards(state, actor, lookup),
  ];
}

export function withRequiredEffectCost(
  state: GameState,
  effect: Effect,
  source: CardInstance | undefined,
  actor: string,
  lookup: Lookup,
  eventAction?: string
): Effect {
  if (!source || effect.timing.kind !== "card_event") return effect;
  const def = lookup(source.definitionId);
  if (!def) return effect;
  const events = eventAction
    ? [eventAction]
    : Array.isArray(effect.timing.event)
      ? effect.timing.event
      : [effect.timing.event];
  const labels = deriveEffectLabelsFromTextRefs(effect, def.textLines, events);
  const rules = getCEsForTarget(state, actor)
    .filter((ce) => ce.modifierTag === "required_effect_cost")
    .map((ce) => ce.metadata?.rule as DSL.RequireEffectCostAction)
    .filter(
      (rule) =>
        rule.events.some((event) => events.includes(event)) &&
        rule.categories.some((category) =>
          rule.events.some((event) =>
            labels.includes(`${category}_${event}_time`)
          )
        ) &&
        (!rule.sourceFilter ||
          matchesCardReferenceFilter(source, def, rule.sourceFilter, {
            state,
            getCardDefinitionById: lookup,
            effectiveColors: getEffectiveColors(state, source, def),
          }))
    );
  if (!rules.length) return effect;
  const id = "required-effect-cost";
  const paid = { kind: "ref_succeeded", stepId: id } as const;
  const steps: EffectStep[] = [
    {
      id,
      executionMode: "optional",
      action: {
        kind: "pay_cost",
        amount: rules.reduce((n, rule) => n + rule.amount, 0),
        allowFieldCorePayment: true,
      },
    },
    ...effect.steps.map((step, index) => ({
      ...step,
      id: step.id ?? `__step_${index}`,
      stepCondition: step.stepCondition
        ? { kind: "all" as const, conditions: [paid, step.stepCondition] }
        : paid,
    })),
  ];
  return { ...effect, steps };
}

/** Own effects can reference the deck as hand; opponents keep the physical zone. */
export function isCardInEffectZone(
  state: GameState,
  card: CardInstance,
  zones: readonly Zone[],
  actor: string,
  lookup: Lookup
): boolean {
  return (
    zones.includes(card.zone) ||
    (zones.includes("hand") && isInHandForOwnEffect(state, card, actor, lookup))
  );
}

/** Logical source for the owner's activation permissions; card.zone stays physical. */
export function getOwnEffectSourceZone(
  state: GameState,
  card: CardInstance,
  actor: string,
  lookup: Lookup
): Zone {
  return isInHandForOwnEffect(state, card, actor, lookup) ? "hand" : card.zone;
}
