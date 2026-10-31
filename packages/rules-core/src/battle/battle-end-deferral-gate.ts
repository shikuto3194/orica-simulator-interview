import { getCardById } from "../card/card-lookup";
import { isCombinedBraveEffectSource } from "../effect/effect-source-identity";
import { isActiveCombinedBraveEffectSource } from "../mechanics/star-garment-utils";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingBattleEndDeferral,
} from "../model";
import type { Effect, EffectStep } from "../dsl-types";

function isFieldReadyCard(card: CardInstance | undefined): boolean {
  return (
    card !== undefined &&
    card.zone === "field" &&
    card.pendingLeaveKind === null
  );
}

function isSourceCardTargetSpec(target: unknown): boolean {
  return (
    typeof target === "object" &&
    target !== null &&
    (target as { kind?: unknown }).kind === "source_card"
  );
}

function stepDirectlyTargetsSourceCard(step: EffectStep | undefined): boolean {
  const action = step?.action;
  return (
    action !== undefined &&
    "target" in action &&
    isSourceCardTargetSpec((action as { target?: unknown }).target)
  );
}

function deferredStepsDirectlyTargetOnlySourceCard(
  steps: readonly EffectStep[] | undefined,
  startStepIndex: number
): boolean {
  if (!steps || startStepIndex < 0 || startStepIndex >= steps.length) {
    return false;
  }
  return steps
    .slice(startStepIndex)
    .every((step) => stepDirectlyTargetsSourceCard(step));
}

function getDeferralEffect(options: {
  deferral: PendingBattleEndDeferral;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): Effect | undefined {
  const { deferral, getCardDefinitionById } = options;
  if (deferral.resumeEffectOverride !== undefined) {
    return deferral.resumeEffectOverride;
  }
  return getCardDefinitionById(deferral.sourceDefinitionId)?.effects?.[
    deferral.effectIndex
  ];
}

function isEffectSourceAttachmentRequired(options: {
  deferral: PendingBattleEndDeferral;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const { deferral, getCardDefinitionById } = options;
  if (deferral.effectSourceAttachmentRequired !== undefined) {
    return deferral.effectSourceAttachmentRequired;
  }
  if (deferral.effectSourceOnFieldRequired !== true) {
    return false;
  }
  const effect = getDeferralEffect({ deferral, getCardDefinitionById });
  return !deferredStepsDirectlyTargetOnlySourceCard(
    effect?.steps,
    deferral.resumeFromStepIndex ?? 0
  );
}

function getSourceFieldRequirementInstanceId(options: {
  deferral: PendingBattleEndDeferral;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string {
  const { deferral, getCardDefinitionById } = options;
  const effect = getDeferralEffect({ deferral, getCardDefinitionById });
  if (
    deferredStepsDirectlyTargetOnlySourceCard(
      effect?.steps,
      deferral.resumeFromStepIndex ?? 0
    )
  ) {
    return deferral.sourceCardReferenceInstanceId ?? deferral.sourceInstanceId;
  }
  return deferral.sourceInstanceId;
}

export function canFireBattleEndDeferral(options: {
  state: GameState;
  deferral: PendingBattleEndDeferral;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const { state, deferral, getCardDefinitionById } = options;
  if (deferral.sourceOnFieldRequired === false) return true;
  if ((deferral.activationZone ?? "field") !== "field") return true;

  if (
    !isFieldReadyCard(
      getCardById(
        state,
        getSourceFieldRequirementInstanceId({ deferral, getCardDefinitionById })
      )
    )
  ) {
    return false;
  }

  const effectSourceRequiresField =
    deferral.effectSourceInstanceId !== undefined &&
    deferral.effectSourceInstanceId !== deferral.sourceInstanceId &&
    (deferral.effectSourceOnFieldRequired === true ||
      (deferral.effectSourceOnFieldRequired !== false &&
        isCombinedBraveEffectSource({
          state,
          sourceInstanceId: deferral.sourceInstanceId,
          effectSourceInstanceId: deferral.effectSourceInstanceId,
          ...(deferral.effectSourceDefinitionId !== undefined
            ? { effectSourceDefinitionId: deferral.effectSourceDefinitionId }
            : {}),
          getCardDefinitionById,
        })));
  if (
    effectSourceRequiresField &&
    !isFieldReadyCard(getCardById(state, deferral.effectSourceInstanceId!))
  ) {
    return false;
  }
  if (isEffectSourceAttachmentRequired({ deferral, getCardDefinitionById })) {
    const hostCard = getCardById(state, deferral.sourceInstanceId);
    if (
      !hostCard ||
      !isActiveCombinedBraveEffectSource({
        state,
        hostCard,
        effectSourceInstanceId: deferral.effectSourceInstanceId!,
        ...(deferral.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: deferral.effectSourceDefinitionId }
          : {}),
      })
    ) {
      return false;
    }
  }

  return true;
}
