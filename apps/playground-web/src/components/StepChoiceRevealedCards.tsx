import type {
  CardDefinition,
  GameState,
  PendingStepChoice,
} from "@orica/rules-core";
import { DeckRevealCards } from "./DeckRevealModal";

/** 公開中の二択では、分岐を決める前にその公開内容を確認できるようにする。 */
export function StepChoiceRevealedCards({
  state,
  pending,
  getDefinition,
}: {
  state: GameState;
  pending: PendingStepChoice;
  getDefinition: (id: string) => CardDefinition | undefined;
}) {
  const ids = new Set(
    Object.values(pending.continuation.stepContext.results).flatMap(
      (result) => result.revealedCardInstanceIds ?? []
    )
  );
  const cards = state.cardInstances.filter(
    (card) => ids.has(card.instanceId) && card.zone === "revealed"
  );
  if (cards.length === 0) return null;
  return (
    <section
      aria-label="公開中のカード"
      style={{ maxWidth: "90vw", textAlign: "center" }}
    >
      <div>公開中のカード</div>
      <DeckRevealCards
        state={state}
        instanceIds={cards.map((card) => card.instanceId)}
        getDefinition={getDefinition}
        selectedIds={
          pending.continuation.targetInstanceIds ??
          pending.continuation.stepContext.selectedTargetInstanceIds ??
          []
        }
      />
    </section>
  );
}
