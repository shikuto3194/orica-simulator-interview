import type {
  CardDefinition,
  GameState,
  PendingDeckReveal,
  PendingMirageSetChoice,
} from "../model";
import {
  createStepExecutionContext,
  serializeStepContext,
} from "../step-execution-context";
import { getCardById } from "../card/card-lookup";
import {
  getMirageReplacementChoiceLabel,
  planMirageSetReplacements,
} from "../mechanics/mirage-system";

/** deck revealの移動・支払い・誘発より前に、既存step choice UIで個別交換を確定する。 */
export function prepareDeckRevealMirageChoice(
  state: GameState,
  pending: PendingDeckReveal,
  sourceInstanceIds: string[],
  resume: PendingMirageSetChoice["resume"],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): { state?: GameState; replacementsByInstanceId: Record<string, string[]> } {
  const plan = planMirageSetReplacements({
    state,
    actingPlayerId: pending.actingPlayerId,
    sourceInstanceIds,
    getCardDefinitionById,
    ...(pending.mirageReplacementsByInstanceId !== undefined
      ? { replacementsByInstanceId: pending.mirageReplacementsByInstanceId }
      : {}),
  });
  if (!plan.unresolved) return plan;
  const unresolved = plan.unresolved;
  const card = getCardById(state, unresolved.sourceInstanceId)!;
  const name = getCardDefinitionById(card.definitionId)?.name ?? "ミラージュ";
  const pendingId = `mirage-choice:${pending.pendingId}:${unresolved.sourceInstanceId}`;
  return {
    replacementsByInstanceId: plan.replacementsByInstanceId,
    state: {
      ...state,
      pendingDeckReveal: null,
      pendingStepChoice: {
        pendingId,
        actingPlayerId: pending.actingPlayerId,
        choosingPlayerId: pending.actingPlayerId,
        sourceInstanceId: pending.sourceInstanceId,
        sourceDefinitionId: pending.sourceDefinitionId,
        effectIndex: pending.continuation?.effectIndex ?? 0,
        stepIndex: 0,
        prompt: {
          label: "ミラージュセット",
          question: `${name}の追加、または入れ替えるカードを選んでください`,
        },
        choices: unresolved.choices.map((choice, choiceIndex) => ({
          choiceIndex,
          label: getMirageReplacementChoiceLabel(
            unresolved.state,
            pending.actingPlayerId,
            choice,
            getCardDefinitionById
          ),
        })),
        continuation: {
          sourceInstanceId: pending.sourceInstanceId,
          sourceDefinitionId: pending.sourceDefinitionId,
          actingPlayerId: pending.actingPlayerId,
          effectIndex: pending.continuation?.effectIndex ?? 0,
          stepIndex: 0,
          stepContext: serializeStepContext(createStepExecutionContext(state)),
          chainId:
            pending.continuation?.chainId ?? `deck-reveal:${pending.pendingId}`,
        },
        mirageSetChoice: JSON.parse(
          JSON.stringify({
            reveal: pending,
            sourceInstanceIds,
            sourceInstanceId: unresolved.sourceInstanceId,
            replacementChoices: unresolved.choices,
            replacementsByInstanceId: plan.replacementsByInstanceId,
            resume,
          })
        ),
      },
      log: [...state.log, `mirage:choice-pending:${pendingId}`],
    },
  };
}
