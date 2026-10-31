import type { DSL, EffectStep } from "../dsl-types";
import type { CardDefinition, GameState } from "../model";
import type { StepExecutionContext } from "../step-execution-context";
import {
  moveCardZone,
  moveNormalCores,
  moveSoulCore,
  updateCard,
} from "../core/core-system";
import { resolveCardImmunityAffect } from "./effect-affect-adapter";
import { executeEnterSoulState } from "./structured-soul-state";
import { isEligibleBraveSeparationTarget } from "../legal/legal-actions-shared";
import { moveNormalCoresForBraveSeparation } from "../legal/brave-combine-state-helpers";
import { resolveSeparatedBraveExhaustState } from "../mechanics/brave-spirit-state-recovery";
import { hasPreventBraveSeparationRestriction } from "../mechanics/brave-separation-restriction";
import { isAttachedCombinedChild } from "../mechanics/act-as-spirit";

type Lookup = (id: string) => CardDefinition | undefined;

/** Owner decisions resume through optional steps; the UI presents them as state choices. */
export function expandTurnFaceDown(
  state: GameState,
  ids: readonly string[],
  actor: string,
  sourceId: string,
  lookup: Lookup,
  context: StepExecutionContext,
  preventionLevel?: import("../model").EffectPreventionLevel,
  preventionBypass?: import("./target-affect-gate").TargetLockBypassProfile
): EffectStep[] {
  const steps: EffectStep[] = [];
  const seen = new Set<string>();
  const source = state.cardInstances.find((c) => c.instanceId === sourceId);
  const visit = (id: string, attached = false) => {
    if (seen.has(id)) return;
    seen.add(id);
    const card = state.cardInstances.find((c) => c.instanceId === id);
    const def = card && lookup(card.definitionId);
    if (!card || !def || (card.faceDown && !attached)) return;
    if (
      !attached &&
      resolveCardImmunityAffect(
        state,
        card,
        actor,
        preventionLevel,
        {
          ...(source ? { instance: source } : {}),
          ...(source && lookup(source.definitionId)
            ? { definition: lookup(source.definitionId)! }
            : {}),
        },
        lookup,
        preventionBypass
      ).kind !== "allowed"
    )
      return;
    for (const child of card.attachedChildrenIds) visit(child, true);
    for (const child of card.underCards) visit(child.cardInstanceId, true);
    const ref = `face-down:${id}`;
    context.results.set(ref, {
      stepId: ref,
      affectedCardInstanceIds: [id],
      succeeded: true,
    });
    const action = (
      resolution: NonNullable<DSL.TurnFaceDownAction["resolution"]>
    ): DSL.TurnFaceDownAction => ({
      kind: "turn_face_down",
      target: { kind: "ref", stepId: ref },
      resolution,
    });
    const alternatives: EffectStep[] = [];
    if (!card.faceDown && def.keywordTags.includes("contract"))
      alternatives.push({
        id: `${ref}:soul`,
        label: "魂状態にする",
        prompt: {
          label: "魂状態にする",
          question: `「${def.name}」を魂状態にしますか？`,
          sourceText:
            "裏向きにする代わりに、対象の契約カードを魂状態にできます。",
        },
        action: action("soul_state"),
      });
    if (
      def.printedCategory === "brave" &&
      isAttachedCombinedChild(state, card) &&
      card.attachedToInstanceId &&
      !hasPreventBraveSeparationRestriction(state, card.attachedToInstanceId) &&
      isEligibleBraveSeparationTarget(state, card, lookup)
    ) {
      alternatives.push({
        id: `${ref}:separate`,
        label: "ブレイヴを分離する",
        prompt: {
          label: "ブレイヴを分離する",
          question: `「${def.name}」を分離しますか？`,
          sourceText: "分離しない場合、このブレイヴも一緒に裏向きになります。",
        },
        action: action("separate"),
      });
    }
    const priorIds: string[] = [];
    const unlessResolved = () =>
      priorIds.length
        ? {
            stepCondition: {
              kind: "all" as const,
              conditions: priorIds.map((stepId) => ({
                kind: "ref_succeeded" as const,
                stepId,
                not: true,
              })),
            },
          }
        : {};
    for (const alternative of alternatives) {
      steps.push({
        ...alternative,
        ...unlessResolved(),
        executionMode: "optional",
        chooser: card.ownerPlayerId === actor ? "self" : "opponent",
      });
      priorIds.push(alternative.id!);
    }
    steps.push({
      label: "裏向きにする",
      executionMode: "mandatory",
      action: action("face_down"),
      ...unlessResolved(),
    });
  };
  for (const id of ids) visit(id);
  return steps;
}

export function resolveTurnFaceDown(
  initial: GameState,
  ids: readonly string[],
  resolution: DSL.TurnFaceDownAction["resolution"],
  lookup: Lookup
): GameState {
  let state = initial;
  for (const id of ids) {
    const card = state.cardInstances.find((c) => c.instanceId === id);
    const def = card && lookup(card.definitionId);
    if (!card || !def || (card.faceDown && card.attachedToInstanceId === null))
      continue;
    if (resolution === "separate") {
      const host = state.cardInstances.find(
        (c) => c.instanceId === card.attachedToInstanceId
      );
      if (
        !host ||
        !isAttachedCombinedChild(state, card) ||
        !isEligibleBraveSeparationTarget(state, card, lookup) ||
        hasPreventBraveSeparationRestriction(state, host.instanceId)
      )
        continue;
      const needed = Math.max(
        0,
        (card.minimumRequiredCores ?? 0) -
          card.normalCoreCount -
          card.soulCoreCount
      );
      if (needed)
        state = moveNormalCoresForBraveSeparation(
          state,
          card.ownerPlayerId,
          id,
          needed,
          lookup
        );
      state = updateCard(state, id, (c) => ({
        ...c,
        attachedToInstanceId: null,
        exhaustState: resolveSeparatedBraveExhaustState(card, def, host),
      }));
      state = updateCard(state, host.instanceId, (c) => ({
        ...c,
        attachedChildrenIds: c.attachedChildrenIds.filter(
          (child) => child !== id
        ),
      }));
      continue;
    }
    // Detach first; the card stays on the field, so no leave event is queued.
    for (const host of state.cardInstances) {
      if (
        host.attachedChildrenIds.includes(id) ||
        host.underCards.some((entry) => entry.cardInstanceId === id)
      )
        state = updateCard(state, host.instanceId, (c) => ({
          ...c,
          attachedChildrenIds: c.attachedChildrenIds.filter(
            (child) => child !== id
          ),
          underCards: c.underCards.filter(
            (entry) => entry.cardInstanceId !== id
          ),
        }));
    }
    if (card.zone !== "field") state = moveCardZone(state, id, "field", "card");
    state = updateCard(state, id, (c) => ({
      ...c,
      attachedToInstanceId: null,
      underCards: [],
      attachedChildrenIds: [],
    }));
    if (resolution === "soul_state") {
      state = executeEnterSoulState(
        state,
        card.ownerPlayerId,
        { target: { player: "self", selfCard: true, count: 1 } },
        lookup,
        id
      );
      continue;
    }
    if (card.normalCoreCount)
      state = moveNormalCores(
        state,
        { kind: "card", instanceId: id },
        { kind: "reserve", playerId: card.ownerPlayerId },
        card.normalCoreCount,
        lookup
      );
    if (card.soulCoreCount > 0)
      state = moveSoulCore(
        state,
        card.ownerPlayerId,
        { kind: "card", instanceId: id },
        { kind: "reserve", playerId: card.ownerPlayerId },
        card.soulCoreCount,
        lookup
      );
    if (def.keywordTags.includes("token"))
      state = moveCardZone(state, id, "removed_from_game");
    else {
      // qa-056: 元の実体を失う。同じ field 内でカード状態へ変わり、離脱はしない。
      state = moveCardZone(state, id, "field", "card");
      state = updateCard(state, id, (c) => ({
        ...c,
        faceDown: true,
        faceDownContentsPublic: true,
        divineTransformState: null,
      }));
    }
    state = { ...state, log: [...state.log, `effect:turn_face_down:${id}`] };
  }
  return state;
}
