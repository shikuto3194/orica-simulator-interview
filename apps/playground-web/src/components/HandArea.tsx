import type { CardDefinition, CardInstance } from "@orica/rules-core";
import { CardView } from "./CardView";

interface HandAreaProps {
  cards: CardInstance[];
  getDefinition: (id: string) => CardDefinition | undefined;
  selectableIds?: Set<string> | undefined;
  /** ゾーン選択モード中: 選択済みカード */
  selectedIds?: Set<string> | undefined;
  /** ゾーン選択モード中: 候補外（グレーアウト） */
  nonCandidateIds?: Set<string> | undefined;
  onCardClick?: ((instanceId: string) => void) | undefined;
  onDetailRequest?: ((instanceId: string) => void) | undefined;
  onDragStart?: ((instanceId: string) => void) | undefined;
  onTouchDragPlay?: ((instanceId: string) => void) | undefined;
}

export function HandArea({
  cards,
  getDefinition,
  selectableIds,
  selectedIds,
  nonCandidateIds,
  onCardClick,
  onDetailRequest,
  onDragStart,
  onTouchDragPlay,
}: HandAreaProps) {
  return (
    <div className="hand-area" data-testid="hand-area">
      {cards.map((card) => {
        const isSelectable = selectableIds?.has(card.instanceId) ?? false;
        const isSelected = selectedIds?.has(card.instanceId) ?? false;
        const isNonCandidate = nonCandidateIds?.has(card.instanceId) ?? false;
        return (
          <CardView
            key={card.instanceId}
            card={card}
            definition={getDefinition(card.definitionId)}
            size="medium"
            isSelectable={isSelectable}
            isSelected={isSelected}
            isNonCandidate={isNonCandidate}
            isDraggable={isSelectable && !selectedIds && !nonCandidateIds}
            onClick={() => onCardClick?.(card.instanceId)}
            onDragStart={onDragStart}
            onTouchDragPlay={onTouchDragPlay}
            onDetailRequest={() => onDetailRequest?.(card.instanceId)}
          />
        );
      })}
      {cards.length === 0 && <div className="hand-empty">手札なし</div>}
    </div>
  );
}
