import type {
  CardDefinition,
  GameState,
  PendingStepChoice,
} from "@orica/rules-core";
import { DeckRevealCards } from "./DeckRevealModal";

/** 配置選択中は、選択済みの公開カードだけをHUD内で確認できるようにする。 */
export function StepChoiceRevealedCards({
  state,
  pending,
  getDefinition,
}: {
  state: GameState;
  pending: PendingStepChoice;
  getDefinition: (id: string) => CardDefinition | undefined;
}) {
  const selectedIds =
    pending.continuation.targetInstanceIds ??
    pending.continuation.stepContext.selectedTargetInstanceIds ??
    [];
  if (selectedIds.length === 0) return null;
  const ids = new Set(
    Object.values(pending.continuation.stepContext.results).flatMap(
      (result) => result.revealedCardInstanceIds ?? []
    )
  );
  const cards = state.cardInstances.filter(
    (card) =>
      ids.has(card.instanceId) &&
      selectedIds.includes(card.instanceId) &&
      card.zone === "revealed"
  );
  if (cards.length === 0) return null;
  return (
    <section
      aria-label="選択済みの公開カード"
      style={{ maxWidth: "90vw", textAlign: "center" }}
    >
      <div>選択済みの公開カード</div>
      <DeckRevealCards
        state={state}
        instanceIds={cards.map((card) => card.instanceId)}
        getDefinition={getDefinition}
        selectedIds={selectedIds}
      />
    </section>
  );
}
