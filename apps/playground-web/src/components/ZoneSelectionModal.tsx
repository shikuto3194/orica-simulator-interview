import { zoneDisplayLabel } from "@orica/rules-core";
/**
 * ZoneSelectionModal — 非公開ゾーン（デッキ/トラッシュ/手札）からのカード選択 UI。
 * search_deck, return_from_trash, discard_hand, move_to_set_aside で使用。
 *
 * カード描画は ZoneBrowseModal と同じ `.zone-browse-*` CSS を流用し、画像表示・
 * プレースホルダー・長押し詳細を共通化している。本モーダル固有の差分はクリック動作
 * （アクション発火ではなく選択トグル）と確定/スキップフッターのみ。
 */
import { useState, useMemo, useCallback } from "react";
import type {
  GameState,
  CardDefinition,
  PendingZoneSelection,
} from "@orica/rules-core";
import type { ResolvePendingZoneSelectionLegalAction } from "@orica/rules-core";
import { CardDetailModal } from "./CardDetailModal";
import { describeCardFilter } from "../utils/describe-card-filter";
import { useLongPress } from "../hooks/useLongPress";
import { DeckRevealTargetModal } from "./DeckRevealModal";
import { revealedCandidateCardIds } from "../utils/revealed-target-presentation";

type PerCardDestination = "hand" | "set_aside";

interface ZoneSelectionModalProps {
  state: GameState;
  pending: PendingZoneSelection;
  action: ResolvePendingZoneSelectionLegalAction;
  getDefinition: (id: string) => CardDefinition | undefined;
  onResolve: (
    selectedIds: string[],
    placement?: "top" | "bottom",
    destinationByCardId?: Record<string, PerCardDestination>
  ) => void;
  /** 一時非表示中フラグ。true の間はモーダルを `display: none` で隠して内部 state を保持 */
  hidden?: boolean | undefined;
  criteriaTextOverride?: string | undefined;
  onPeek?: (() => void) | undefined;
}

export const ACTION_KIND_LABELS: Record<
  PendingZoneSelection["actionKind"],
  string
> = {
  brave_separation: "合体上限を満たすよう分離するブレイヴを選択",
  bounce: "戻し先を選択",
  search_deck: "デッキから選択",
  return_from_trash: "トラッシュから選択",
  discard_hand: "手札から破棄",
  move_to_set_aside: "手元に置く",
  advent_source: "煌臨元の下に追加（煌臨する前）",
};

/** 同じ選択処理でも、デッキ戻しを破棄と表示しない。インライン手札選択と共用。 */
export function zoneSelectionLabel(pending: PendingZoneSelection): string {
  if (pending.actionKind === "discard_hand") {
    if (pending.destination === "deck_bottom") return "デッキの下に戻す";
    if (pending.destination === "removed_from_game") return "除外する";
    return `${zoneDisplayLabel(pending.sourceZone)}から破棄`;
  }
  return ACTION_KIND_LABELS[pending.actionKind] ?? "カード選択";
}

const DESTINATION_LABELS: Record<PerCardDestination, string> = {
  hand: "手札",
  set_aside: "手元",
};

/**
 * ZoneSelectionCard — 1 カード分の DOM。クリック=選択トグル、長押し/右クリック=詳細。
 */
function ZoneSelectionCard({
  instanceId,
  def,
  isSelected,
  onToggle,
  onOpenDetail,
}: {
  instanceId: string;
  def: CardDefinition | undefined;
  isSelected: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
}) {
  const lp = useLongPress(onOpenDetail);
  return (
    <div
      className={
        "zone-browse-card" + (isSelected ? " zone-browse-card-selected" : "")
      }
      {...lp.handlers}
      onClick={() => {
        if (lp.consumeFired()) return;
        onToggle();
      }}
      title={def?.name ?? instanceId}
    >
      {def?.image ? (
        <img
          className="zone-browse-card-img"
          src={`/${def.image}`}
          alt={def.name}
          loading="lazy"
        />
      ) : (
        <div className="zone-browse-card-placeholder">
          <span>{def?.name ?? instanceId.slice(0, 8)}</span>
        </div>
      )}
      <div className="zone-browse-card-name">
        {def?.name ?? instanceId.slice(0, 8)}
      </div>
      {def && (
        <div className="zone-browse-card-meta">
          コスト:{def.cost}
          {def.printedCategory === "spirit" && def.levelDefs[0]
            ? ` BP:${def.levelDefs[0].bp}`
            : ""}
        </div>
      )}
    </div>
  );
}

export function ZoneSelectionModal({
  state,
  pending,
  action,
  getDefinition,
  onResolve,
  hidden,
  criteriaTextOverride,
  onPeek,
}: ZoneSelectionModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [placement, setPlacement] = useState<"top" | "bottom" | null>(null);
  const [destinationByCardId, setDestinationByCardId] = useState<
    Record<string, PerCardDestination>
  >({});
  const [detailCard, setDetailCard] = useState<CardDefinition | null>(null);
  const needsPlacementChoice = (action.swapPlacementOptions?.length ?? 0) > 0;
  const needsPerCardDestinationChoice =
    action.requiresPerCardDestinationChoice === true;
  const destinationChoicesFor = useCallback(
    (instanceId: string): PerCardDestination[] =>
      action.perCardDestinationChoices?.[instanceId] ?? ["hand", "set_aside"],
    [action.perCardDestinationChoices]
  );

  const alternates = useMemo(
    () => action.alternateSelections ?? [],
    [action.alternateSelections]
  );
  // 全候補（primary + 各 alt）の合算: alt の候補は primary に含まれていなくてもクリック可能にする。
  const allCandidateIds = useMemo(() => {
    const set = new Set<string>(action.candidateCardInstanceIds);
    for (const alt of alternates) {
      for (const id of alt.candidateInstanceIds) set.add(id);
    }
    return Array.from(set);
  }, [action.candidateCardInstanceIds, alternates]);

  const candidateCards = useMemo(() => {
    return allCandidateIds.map((id) => {
      const inst = state.cardInstances.find((c) => c.instanceId === id);
      const definitionId =
        pending.revealedCardDefinitionIds?.[id] ?? inst?.definitionId;
      const def = definitionId ? getDefinition(definitionId) : undefined;
      return { instanceId: id, inst, def };
    });
  }, [
    state,
    pending.revealedCardDefinitionIds,
    allCandidateIds,
    getDefinition,
  ]);

  const primarySet = useMemo(
    () => new Set(action.candidateCardInstanceIds),
    [action.candidateCardInstanceIds]
  );
  const altSets = useMemo(
    () => alternates.map((a) => new Set(a.candidateInstanceIds)),
    [alternates]
  );

  // 選択集合がどの条件を満たすか判定。
  const matchedAlt = useMemo(() => {
    return alternates.findIndex((alt, i) => {
      if (selectedIds.length !== alt.count) return false;
      const set = altSets[i]!;
      return selectedIds.every((id) => set.has(id));
    });
  }, [selectedIds, alternates, altSets]);
  const primarySatisfied =
    selectedIds.every((id) => primarySet.has(id)) &&
    (action.canSkip
      ? selectedIds.length > 0 && selectedIds.length <= action.maxCount
      : selectedIds.length === action.maxCount);
  const hasPlacement = !needsPlacementChoice || placement !== null;
  const hasPerCardDestinations =
    !needsPerCardDestinationChoice ||
    selectedIds.every((id) => {
      const destination = destinationByCardId[id];
      return (
        (destination === "hand" || destination === "set_aside") &&
        destinationChoicesFor(id).includes(destination)
      );
    });
  const canConfirm =
    (primarySatisfied || matchedAlt >= 0) &&
    hasPlacement &&
    hasPerCardDestinations;
  // 選択上限: primary の上限 or 各 alt の count の最大値
  const selectionCap = useMemo(() => {
    let max = action.maxCount;
    for (const alt of alternates) max = Math.max(max, alt.count);
    return Math.min(max, candidateCards.length);
  }, [action.maxCount, alternates, candidateCards.length]);

  const toggleCard = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        if (prev.includes(id)) {
          setDestinationByCardId((destinations) => {
            const next = { ...destinations };
            delete next[id];
            return next;
          });
          return prev.filter((x) => x !== id);
        }
        if (prev.length >= selectionCap) return prev;
        return [...prev, id];
      });
    },
    [selectionCap]
  );

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onResolve(
      selectedIds,
      placement ?? undefined,
      needsPerCardDestinationChoice ? destinationByCardId : undefined
    );
  }, [
    selectedIds,
    onResolve,
    canConfirm,
    placement,
    needsPerCardDestinationChoice,
    destinationByCardId,
  ]);

  const handleSkip = useCallback(() => {
    if (!hasPlacement) return;
    onResolve([], placement ?? undefined, {});
  }, [onResolve, hasPlacement, placement]);

  const selectedCardsForDestination = useMemo(() => {
    if (!needsPerCardDestinationChoice) return [];
    return selectedIds.map((id) => {
      const inst = state.cardInstances.find((c) => c.instanceId === id);
      const def = inst ? getDefinition(inst.definitionId) : undefined;
      return { instanceId: id, def };
    });
  }, [selectedIds, needsPerCardDestinationChoice, state, getDefinition]);

  const setCardDestination = useCallback(
    (id: string, destination: PerCardDestination) => {
      if (!destinationChoicesFor(id).includes(destination)) return;
      setDestinationByCardId((prev) => ({ ...prev, [id]: destination }));
    },
    [destinationChoicesFor]
  );

  const zoneName = useMemo(() => {
    const zones = Array.from(
      new Set(candidateCards.map(({ inst }) => inst?.zone).filter(Boolean))
    );
    if (zones.length > 1) {
      return zones.map((zone) => zoneDisplayLabel(zone!)).join("/");
    }
    return zoneDisplayLabel(pending.sourceZone);
  }, [candidateCards, pending.sourceZone]);
  const label =
    pending.actionKind === "return_from_trash"
      ? `${zoneName}から選択`
      : zoneSelectionLabel(pending);
  // 表示する確定条件文
  const criteriaText = useMemo(() => {
    if (criteriaTextOverride) return criteriaTextOverride;
    if (alternates.length === 0) {
      return `${zoneName}から${Math.min(action.maxCount, candidateCards.length)}枚選択してください （${selectedIds.length}/${Math.min(action.maxCount, candidateCards.length)}）`;
    }
    const parts = [`${action.maxCount}枚`];
    for (const alt of alternates) {
      parts.push(alt.label ?? describeCardFilter(alt.filter, alt.count));
    }
    return `次のいずれかを選択（${parts.join(" / ")}）— 現在 ${selectedIds.length} 枚`;
  }, [
    alternates,
    action.maxCount,
    candidateCards.length,
    criteriaTextOverride,
    selectedIds.length,
    zoneName,
  ]);

  const revealedIds = revealedCandidateCardIds(state, allCandidateIds);
  if (revealedIds && !needsPlacementChoice && !needsPerCardDestinationChoice) {
    return (
      <DeckRevealTargetModal
        state={state}
        instanceIds={revealedIds}
        getDefinition={getDefinition}
        candidateIds={new Set(allCandidateIds)}
        selectedIds={selectedIds}
        onSelect={toggleCard}
        onConfirm={handleConfirm}
        canConfirm={canConfirm}
        onClose={onPeek ?? (() => {})}
        hidden={hidden}
        description={criteriaText}
        onSkip={action.canSkip ? handleSkip : undefined}
      />
    );
  }
  return (
    <>
      <div
        className={`zone-browse-overlay${hidden ? " modal-hidden" : ""}`}
        aria-hidden={hidden ? "true" : undefined}
      >
        <div className="zone-browse-panel" onClick={(e) => e.stopPropagation()}>
          <div className="zone-browse-header">
            <h3 className="zone-browse-title">{label}</h3>
          </div>
          <p style={{ color: "#aaa", fontSize: 14, margin: "0 0 4px" }}>
            {criteriaText}
          </p>
          <p
            className="zone-browse-hint"
            style={{ textAlign: "left", margin: "0 0 12px" }}
          >
            右クリック / 長押しでカード詳細
          </p>
          {needsPlacementChoice && (
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
                margin: "0 0 12px",
              }}
            >
              <button
                type="button"
                onClick={() => setPlacement("bottom")}
                aria-pressed={placement === "bottom"}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border:
                    placement === "bottom"
                      ? "1px solid #4fc3f7"
                      : "1px solid #666",
                  background: placement === "bottom" ? "#4fc3f7" : "#333",
                  color: placement === "bottom" ? "#000" : "#ccc",
                  cursor: "pointer",
                }}
              >
                デッキの下
              </button>
              <button
                type="button"
                onClick={() => setPlacement("top")}
                aria-pressed={placement === "top"}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border:
                    placement === "top"
                      ? "1px solid #4fc3f7"
                      : "1px solid #666",
                  background: placement === "top" ? "#4fc3f7" : "#333",
                  color: placement === "top" ? "#000" : "#ccc",
                  cursor: "pointer",
                }}
              >
                デッキの上
              </button>
            </div>
          )}

          <div className="zone-browse-grid">
            {candidateCards.map(({ instanceId, def }) => (
              <ZoneSelectionCard
                key={instanceId}
                instanceId={instanceId}
                def={def}
                isSelected={selectedIds.includes(instanceId)}
                onToggle={() => toggleCard(instanceId)}
                onOpenDetail={() => {
                  if (def) setDetailCard(def);
                }}
              />
            ))}
          </div>

          {selectedCardsForDestination.length > 0 && (
            <div
              style={{
                display: "grid",
                gap: 8,
                marginTop: 12,
              }}
            >
              {selectedCardsForDestination.map(({ instanceId, def }) => (
                <div
                  key={instanceId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "#222",
                  }}
                >
                  <span
                    style={{
                      color: "#ddd",
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {def?.name ?? instanceId.slice(0, 8)}
                  </span>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {destinationChoicesFor(instanceId).map((destination) => {
                      const selected =
                        destinationByCardId[instanceId] === destination;
                      return (
                        <button
                          key={destination}
                          aria-pressed={selected}
                          type="button"
                          onClick={() =>
                            setCardDestination(instanceId, destination)
                          }
                          style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            border: selected
                              ? "1px solid #4fc3f7"
                              : "1px solid #666",
                            background: selected ? "#4fc3f7" : "#333",
                            color: selected ? "#000" : "#ccc",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          {DESTINATION_LABELS[destination]}
                        </button>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 16,
            }}
          >
            {(action.canSkip || !!action.handGainCost) && (
              <button
                onClick={handleSkip}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #666",
                  background: "#333",
                  color: "#ccc",
                  cursor:
                    needsPlacementChoice && placement === null
                      ? "not-allowed"
                      : "pointer",
                }}
                disabled={needsPlacementChoice && placement === null}
              >
                {action.handGainCost ? "支払わず回収しない" : "スキップ"}
              </button>
            )}
            <button
              className="ui-primary"
              onClick={handleConfirm}
              disabled={!canConfirm}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: canConfirm ? "#4fc3f7" : "#555",
                color: canConfirm ? "#000" : "#888",
                cursor: canConfirm ? "pointer" : "not-allowed",
                fontWeight: "bold",
              }}
            >
              決定（{selectedIds.length}枚）
            </button>
          </div>
        </div>
      </div>
      {detailCard && (
        <CardDetailModal
          card={detailCard}
          onClose={() => setDetailCard(null)}
          hideDeckActions
          zIndex={1100}
        />
      )}
    </>
  );
}
