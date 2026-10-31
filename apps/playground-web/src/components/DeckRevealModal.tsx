/**
 * DeckRevealModal — デッキの公開・閲覧効果のカード選択 UI。
 * 効果の可視範囲に従ってカードを表示し、ピックグループごとに選択させる。
 * ordering フェーズではタップ順で残りカードの戻し順を指定する。
 */
import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import type {
  GameState,
  CardDefinition,
  PendingDeckReveal,
  DeckRevealPick,
} from "@orica/rules-core";
import type {
  ResolvePendingDeckRevealPickLegalAction,
  ResolvePendingDeckRevealOrderLegalAction,
} from "@orica/rules-core";
import { CardDetailModal } from "./CardDetailModal";
import { useLongPress } from "../hooks/useLongPress";
import { deckRevealPickSelection } from "../deck-reveal-pick-ui";

interface DeckRevealModalProps {
  state: GameState;
  pending: PendingDeckReveal;
  action:
    | ResolvePendingDeckRevealPickLegalAction
    | ResolvePendingDeckRevealOrderLegalAction;
  getDefinition: (id: string) => CardDefinition | undefined;
  onResolve: (
    selectedIds: string[],
    placement?: "top" | "bottom" | "trash",
    remainderPlacements?: Record<string, "top" | "bottom">,
    freeDestination?: "hand" | "set_aside"
  ) => void;
  /** 一時非表示中フラグ。 true の間はモーダルを `display: none` で隠して内部 state を保持 */
  hidden?: boolean | undefined;
}

/**
 * DrCard — DeckRevealModal 内のカードエレメント。
 * クリック/タップ = primary action（toggleCard / addToOrder）、長押し / 右クリック = カード詳細。
 */
function DrCard({
  def,
  className,
  onPrimary,
  openDetail,
  children,
}: {
  def: CardDefinition | undefined;
  className: string;
  onPrimary: (() => void) | undefined;
  openDetail: (def: CardDefinition | undefined) => void;
  children: React.ReactNode;
}) {
  const lp = useLongPress(() => openDetail(def));
  return (
    <div
      className={className}
      {...lp.handlers}
      onClick={() => {
        if (lp.consumeFired()) return;
        onPrimary?.();
      }}
    >
      {children}
    </div>
  );
}

/** オープン・閲覧の途中手順も、同じカード表示と詳細操作を使う。stateは表示用。 */
export function DeckRevealCards({
  state,
  instanceIds,
  getDefinition,
  candidateIds,
  selectedIds = [],
  pickedIds = [],
  disabledIds = [],
  onSelect,
}: {
  state: GameState;
  instanceIds: readonly string[];
  getDefinition: (id: string) => CardDefinition | undefined;
  candidateIds?: ReadonlySet<string> | undefined;
  selectedIds?: readonly string[] | undefined;
  pickedIds?: readonly string[] | undefined;
  disabledIds?: readonly string[] | undefined;
  onSelect?: ((id: string) => void) | undefined;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = state.cardInstances.find(
    (card) => card.instanceId === detailId
  );
  const detailCard = detail ? getDefinition(detail.definitionId) : undefined;
  return (
    <>
      <div className="dr-cards">
        {instanceIds.map((id) => {
          const card = state.cardInstances.find(
            (item) => item.instanceId === id
          );
          const def = card ? getDefinition(card.definitionId) : undefined;
          const candidate = candidateIds?.has(id) ?? true;
          const selected = selectedIds.includes(id);
          const picked = pickedIds.includes(id);
          const disabled = disabledIds.includes(id);
          return (
            <DrCard
              key={id}
              def={def}
              className={`dr-card${selected ? " selected" : ""}${picked ? " already-picked" : ""}${!candidate && !picked ? " not-candidate" : ""}`}
              onPrimary={
                onSelect && candidate && !picked && !disabled
                  ? () => onSelect(id)
                  : undefined
              }
              openDetail={() => setDetailId(id)}
            >
              <img
                src={
                  def?.image ? `/${def.image}` : "/images/ForGUI/card-back.jpg"
                }
                alt={def?.name ?? "非公開カード"}
                className="dr-card-img"
              />
              <div className="dr-card-name">{def?.name ?? "非公開カード"}</div>
              {picked && <div className="dr-card-label picked">選択済</div>}
              {selected && (
                <div className="dr-card-label selecting">選択中</div>
              )}
              {!candidate && !picked && (
                <div className="dr-card-label disabled">対象外</div>
              )}
              {disabled && (
                <div className="dr-card-label disabled">重複不可</div>
              )}
            </DrCard>
          );
        })}
      </div>
      {detailCard &&
        createPortal(
          <CardDetailModal
            card={detailCard ?? null}
            show={!!detailCard}
            onClose={() => setDetailId(null)}
            hideDeckActions
            zIndex={1800}
          />,
          document.body
        )}
    </>
  );
}

/** 公開カードが対象になった途中手順。選択draftはBattleScreenと共有し、確定まで保持。 */
export function DeckRevealTargetModal({
  state,
  instanceIds,
  getDefinition,
  candidateIds,
  selectedIds,
  pickedIds,
  onSelect,
  onConfirm,
  canConfirm,
  onClose,
  hidden,
  onSkip,
  description,
}: {
  state: GameState;
  instanceIds: readonly string[];
  getDefinition: (id: string) => CardDefinition | undefined;
  candidateIds?: ReadonlySet<string> | undefined;
  selectedIds?: readonly string[] | undefined;
  pickedIds?: readonly string[] | undefined;
  onSelect?: ((id: string) => void) | undefined;
  onConfirm?: (() => void) | undefined;
  canConfirm?: boolean | undefined;
  onClose: () => void;
  hidden?: boolean | undefined;
  onSkip?: (() => void) | undefined;
  description?: string | undefined;
}) {
  const privateView = instanceIds.some(
    (id) =>
      state.cardInstances.find((card) => card.instanceId === id)?.revealedTo !==
        undefined &&
      state.cardInstances.find((card) => card.instanceId === id)?.revealedTo !==
        "both"
  );
  return (
    <div
      className={`dr-overlay${hidden ? " modal-hidden" : ""}`}
      aria-hidden={hidden ? "true" : undefined}
      style={!onSelect ? { zIndex: 1700 } : undefined}
    >
      <div className="dr-modal dr-target-modal">
        <h3 className="dr-title">
          {privateView ? "閲覧中のカード" : "デッキオープン"}
          {onSelect ? " — 対象選択" : ""}
        </h3>
        <div className="dr-detail-hint">長押し / 右クリックでカード詳細</div>
        {description && <div className="dr-description">{description}</div>}
        <DeckRevealCards
          state={state}
          instanceIds={instanceIds}
          getDefinition={getDefinition}
          candidateIds={candidateIds}
          selectedIds={selectedIds}
          pickedIds={pickedIds}
          onSelect={onSelect}
        />
        <div className="dr-actions">
          {onSkip && (
            <button className="dr-btn skip" onClick={onSkip}>
              0枚選ぶ
            </button>
          )}
          {onConfirm && (
            <button
              className="dr-btn confirm"
              disabled={!canConfirm}
              onClick={onConfirm}
            >
              確定 ({selectedIds?.length ?? 0}枚)
            </button>
          )}
          <button className="dr-btn skip" onClick={onClose}>
            {onSelect ? "盤面確認" : "閉じる"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ピックグループのフィルタ条件を日本語で説明 */
function describePickFilter(pick: DeckRevealPick): string {
  const parts: string[] = [];
  if (pick.filter?.colors) {
    const colorJa: Record<string, string> = {
      red: "赤",
      purple: "紫",
      green: "緑",
      white: "白",
      yellow: "黄",
      blue: "青",
    };
    parts.push(pick.filter.colors.map((c) => colorJa[c] ?? c).join("/"));
  }
  if (pick.filter?.tribes)
    parts.push(`系統：「${pick.filter.tribes.join("」「")}」`);
  if (pick.filter?.category) {
    const catJa: Record<string, string> = {
      spirit: "スピリット",
      nexus: "ネクサス",
      brave: "ブレイヴ",
      magic: "マジック",
      ultimate: "アルティメット",
    };
    parts.push(
      pick.filter.category
        .map((c) =>
          c === "nexus" && pick.filter?.targetsGrandwalker === "only"
            ? "創界神ネクサス"
            : (catJa[c] ?? c)
        )
        .join("／")
    );
  }
  return parts.length > 0
    ? `${parts.join("の")}${pick.count < 0 ? "すべて" : `合計${pick.count}枚（候補不足時は可能な枚数）`}`
    : `カード${pick.count < 0 ? "すべて" : `${pick.count}枚`}`;
}

export function DeckRevealModal({
  state,
  pending,
  action,
  getDefinition,
  onResolve,
  hidden,
}: DeckRevealModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [branchIndex, setBranchIndex] = useState<number | null>(null);
  // ordering フェーズ: タップ順で並べた順番
  const [orderSequence, setOrderSequence] = useState<string[]>([]);
  // top_or_bottom 時の配置選択
  const [placement, setPlacement] = useState<"top" | "bottom" | "trash" | null>(
    null
  );
  const [splitPlacements, setSplitPlacements] = useState<
    Record<string, "top" | "bottom">
  >({});
  // 「手札に加えるまたは手元に置く」自由選択 (BSTH08.5-C23、交換を伴わない destination 選択)
  const [freeDestination, setFreeDestination] = useState<
    "hand" | "set_aside" | null
  >(null);
  // カード詳細モーダル
  const [detailCard, setDetailCard] = useState<CardDefinition | null>(null);

  const isRevealedChoice =
    pending.phase === "revealed_choice" &&
    action.kind === "resolve_pending_deck_reveal_pick";
  const hasBurstSetChoice =
    isRevealedChoice &&
    Object.values(pending.revealedDispositionMap ?? {}).some(
      (disposition) => disposition.kind === "set_as_burst"
    );
  const isPicking =
    !isRevealedChoice && action.kind === "resolve_pending_deck_reveal_pick";
  const isOrdering = action.kind === "resolve_pending_deck_reveal_order";
  const pickAction =
    isPicking || isRevealedChoice
      ? (action as ResolvePendingDeckRevealPickLegalAction)
      : null;
  const orderAction = isOrdering
    ? (action as ResolvePendingDeckRevealOrderLegalAction)
    : null;

  // ordering フェーズの残りカード
  const remainingCards = useMemo(() => {
    if (!orderAction) return [];
    return orderAction.remainingCardInstanceIds.map((id) => {
      const inst = state.cardInstances.find((c) => c.instanceId === id);
      const def = inst ? getDefinition(inst.definitionId) : undefined;
      return { instanceId: id, inst, def };
    });
  }, [state, orderAction, getDefinition]);

  const branches = isPicking ? pickAction?.exclusiveGroupBranches : undefined;
  const selection = pickAction
    ? deckRevealPickSelection(pickAction, branchIndex, selectedIds)
    : null;
  const branchPicks = branches?.length
    ? pending.picks.slice(
        pending.currentPickIndex,
        pending.currentPickIndex + branches.length
      )
    : [];

  // 排他選択では分岐を先に選び、その候補だけを有効にする。
  const candidateSet = useMemo(() => {
    return new Set(selection?.candidateIds ?? []);
  }, [selection?.candidateIds]);

  const needsPlacementChoice =
    isOrdering &&
    orderAction &&
    "remainder" in orderAction &&
    (orderAction.remainder === "top_or_bottom" ||
      orderAction.remainder === "bottom_or_trash");
  const alternatePlacement =
    orderAction?.remainder === "bottom_or_trash" ? "trash" : "top";
  const needsSplitPlacementChoice =
    isOrdering &&
    orderAction &&
    "remainder" in orderAction &&
    orderAction.remainder === "top_bottom_split";
  const splitOrderLabels = useMemo(() => {
    if (!needsSplitPlacementChoice) return new Map<string, string>();

    const labels = new Map<string, string>();
    const orderedSplitIds = orderSequence.filter((id) => splitPlacements[id]);
    const bottomIds = orderedSplitIds.filter(
      (id) => splitPlacements[id] === "bottom"
    );
    const topIds = orderedSplitIds.filter(
      (id) => splitPlacements[id] === "top"
    );
    bottomIds.forEach((id, index) => labels.set(id, `下${index + 1}`));
    topIds.forEach((id, index) => labels.set(id, `上${index + 1}`));
    return labels;
  }, [needsSplitPlacementChoice, orderSequence, splitPlacements]);
  const displayedOrderingCards = useMemo(() => {
    if (!needsSplitPlacementChoice) {
      return [
        ...orderSequence.map(
          (id) => remainingCards.find((c) => c.instanceId === id)!
        ),
        ...remainingCards.filter((c) => !orderSequence.includes(c.instanceId)),
      ];
    }

    const orderedSplitIds = orderSequence.filter((id) => splitPlacements[id]);
    const bottomIds = orderedSplitIds.filter(
      (id) => splitPlacements[id] === "bottom"
    );
    const topIds = orderedSplitIds.filter(
      (id) => splitPlacements[id] === "top"
    );
    const orderedSet = new Set(orderedSplitIds);
    const unselectedIds = remainingCards
      .map((card) => card.instanceId)
      .filter((id) => !orderedSet.has(id));
    const cardById = new Map(
      remainingCards.map((card) => [card.instanceId, card])
    );

    return [...bottomIds, ...unselectedIds, ...[...topIds].reverse()]
      .map((id) => cardById.get(id))
      .filter((card) => card !== undefined);
  }, [
    needsSplitPlacementChoice,
    orderSequence,
    remainingCards,
    splitPlacements,
  ]);
  const allSplitPlacementsChosen =
    !needsSplitPlacementChoice ||
    remainingCards.every((card) => splitPlacements[card.instanceId]);
  const hasOrderDraft =
    orderSequence.length > 0 ||
    placement !== null ||
    Object.keys(splitPlacements).length > 0;
  const showOrderReset = needsSplitPlacementChoice || hasOrderDraft;

  const currentPick = isPicking
    ? pending.picks[pending.currentPickIndex]
    : null;
  // revealed_choice は任意。重複不可と交換用手札の上限は legal action が返す。
  const requiredCount = isRevealedChoice ? 0 : (selection?.requiredCount ?? 0);
  const maxSelect = selection?.maxCount ?? 0;

  // picking: カード選択トグル
  const toggleCard = useCallback(
    (id: string) => {
      if (!candidateSet.has(id)) return;
      setSelectedIds((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length >= maxSelect) return prev;
        const group = isRevealedChoice
          ? pending.revealedUsageGroupByInstanceId?.[id]
          : undefined;
        if (
          group !== undefined &&
          prev.some(
            (selected) =>
              pending.revealedUsageGroupByInstanceId?.[selected] === group
          )
        )
          return prev;
        return [...prev, id];
      });
    },
    [
      candidateSet,
      maxSelect,
      isRevealedChoice,
      pending.revealedUsageGroupByInstanceId,
    ]
  );

  // ordering: タップ順で順番追加
  const addToOrder = useCallback((id: string) => {
    setOrderSequence((prev) => {
      if (prev.includes(id)) return prev; // 既に追加済み
      return [...prev, id];
    });
  }, []);

  const setSplitPlacement = useCallback(
    (id: string, value: "top" | "bottom") => {
      setSplitPlacements((prev) => ({ ...prev, [id]: value }));
      setOrderSequence((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    []
  );

  // ordering: 順番リセット
  const resetOrder = useCallback(() => {
    setOrderSequence([]);
    setPlacement(null);
    setSplitPlacements({});
  }, []);

  const needsFreeDestinationChoice =
    isPicking &&
    !!pickAction?.requiresFreeDestinationChoice &&
    selectedIds.length > 0;
  const freeDestinationChoices = pickAction?.freeDestinationChoices ?? [
    "hand",
    "set_aside",
  ];

  const handleConfirmPick = () => {
    if (!selection?.canConfirm) return;
    onResolve(
      selectedIds,
      undefined,
      undefined,
      needsFreeDestinationChoice ? (freeDestination ?? undefined) : undefined
    );
    setSelectedIds([]);
    setBranchIndex(null);
    setFreeDestination(null);
  };

  const handleSkipPick = () => {
    onResolve([]);
    setSelectedIds([]);
    setBranchIndex(null);
    setFreeDestination(null);
  };

  const handleConfirmOrder = () => {
    // 未選択のカードがあれば末尾に追加
    const allIds = orderAction!.remainingCardInstanceIds;
    const ordered = needsSplitPlacementChoice
      ? [
          ...orderSequence.filter((id) => splitPlacements[id] === "bottom"),
          ...orderSequence
            .filter((id) => splitPlacements[id] === "top")
            .reverse(),
        ]
      : [...orderSequence];
    for (const id of allIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    onResolve(
      ordered,
      needsPlacementChoice ? (placement ?? "bottom") : undefined,
      needsSplitPlacementChoice ? splitPlacements : undefined
    );
    setOrderSequence([]);
    setPlacement(null);
    setSplitPlacements({});
  };

  const orderingTitle = needsSplitPlacementChoice
    ? "残りカードの戻し先と順番を確定"
    : needsPlacementChoice
      ? "残りカードの戻し先を確定"
      : "残りカードの順番を確定（デッキ下から順にタップ）";

  const deckViewTitle =
    (pending.revealTo ?? "both") === "both"
      ? "デッキオープン"
      : "デッキの内容を見る";

  // カード詳細を long-press / 右クリックで開く
  const openDetail = useCallback((def: CardDefinition | undefined) => {
    if (def) setDetailCard(def);
  }, []);

  return (
    <>
      <div
        className={`dr-overlay${hidden ? " modal-hidden" : ""}`}
        aria-hidden={hidden ? "true" : undefined}
      >
        <div className="dr-modal">
          <h3 className="dr-title">
            {isRevealedChoice
              ? hasBurstSetChoice
                ? "オープンカード自身の効果"
                : pending.origin === "trash"
                  ? "トラッシュからの手札追加"
                  : (pending.revealTo ?? "both") === "both"
                    ? "オープンカードの手札追加"
                    : "閲覧したカードの手札追加"
              : isPicking
                ? `${deckViewTitle} — グループ ${pending.currentPickIndex + 1}/${pending.picks.length}`
                : orderingTitle}
          </h3>
          <div className="dr-detail-hint">長押し / 右クリックでカード詳細</div>
          {!!pickAction?.handGainCost && (
            <div className="dr-description">
              手札に加えるには{pickAction.handGainCost}
              コストの支払いが必要です。
              {isRevealedChoice
                ? "カード自身の回収効果ごとに支払います。"
                : "この効果の回収全体で1回支払います。支払わない場合は回収せず、残ったカードの処理に進みます。"}
            </div>
          )}
          {isRevealedChoice && (
            <div className="dr-description">
              {hasBurstSetChoice
                ? "効果を使うカードを選択してください（任意）"
                : "手札に加えるカードを選択してください（任意）"}
            </div>
          )}
          {!!branches?.length && (
            <div
              className="dr-description"
              role="group"
              aria-label="回収する分岐"
            >
              <div>どちらかの分岐を選んでください</div>
              {branches.map((branch, index) => (
                <button
                  key={index}
                  type="button"
                  className={`dr-btn${branchIndex === index ? " confirm" : " skip"}`}
                  aria-pressed={branchIndex === index}
                  disabled={branch.candidateCardInstanceIds.length === 0}
                  onClick={() => {
                    setBranchIndex(index);
                    setSelectedIds([]);
                    setFreeDestination(null);
                  }}
                >
                  分岐{index + 1}:{" "}
                  {branchPicks[index]
                    ? describePickFilter(branchPicks[index]!)
                    : "カード"}
                  {branch.costGate
                    ? `（${branch.costGate}コストを支払い）`
                    : "（コスト不要）"}
                  {` — 今回${branch.count}枚`}
                  {branch.candidateCardInstanceIds.length === 0
                    ? "（選択可能な候補なし）"
                    : ""}
                </button>
              ))}
            </div>
          )}
          {isPicking && currentPick && !branches?.length && (
            <div className="dr-description">
              選択: {describePickFilter(currentPick)}
            </div>
          )}
          {needsFreeDestinationChoice && (
            <div className="dr-description">
              <div style={{ marginBottom: 6 }}>
                選んだカードの行き先を選んでください
              </div>
              <div
                style={{ display: "flex", gap: 8, justifyContent: "center" }}
              >
                {freeDestinationChoices.includes("hand") && (
                  <button
                    type="button"
                    className={`dr-btn${freeDestination === "hand" ? " confirm" : " skip"}`}
                    onClick={() => setFreeDestination("hand")}
                  >
                    手札に加える
                  </button>
                )}
                {freeDestinationChoices.includes("set_aside") && (
                  <button
                    type="button"
                    className={`dr-btn${freeDestination === "set_aside" ? " confirm" : " skip"}`}
                    onClick={() => setFreeDestination("set_aside")}
                  >
                    手元に置く
                  </button>
                )}
              </div>
            </div>
          )}
          {isOrdering && (
            <div className="dr-description">
              {needsPlacementChoice ? (
                <>
                  <div style={{ marginBottom: 6 }}>
                    カードを戻す位置を選んでください
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      justifyContent: "center",
                    }}
                  >
                    <button
                      className={`dr-btn${placement === "bottom" ? " confirm" : " skip"}`}
                      onClick={() => setPlacement("bottom")}
                    >
                      デッキの下に戻す
                    </button>
                    <button
                      className={`dr-btn${placement === alternatePlacement ? " confirm" : " skip"}`}
                      onClick={() => setPlacement(alternatePlacement)}
                    >
                      {alternatePlacement === "trash"
                        ? "破棄する"
                        : "デッキの上に戻す"}
                    </button>
                  </div>
                </>
              ) : needsSplitPlacementChoice ? (
                <>
                  各カードの下/上を戻す順に選んでください（
                  {orderSequence.length}/{remainingCards.length}）
                </>
              ) : (
                <>
                  タップした順にデッキの下に戻します（{orderSequence.length}/
                  {remainingCards.length}）
                </>
              )}
            </div>
          )}

          {/* revealed_choice / picking フェーズ */}
          {(isPicking || isRevealedChoice) && (
            <DeckRevealCards
              state={state}
              instanceIds={pending.revealedCardInstanceIds}
              getDefinition={getDefinition}
              candidateIds={candidateSet}
              selectedIds={selectedIds}
              pickedIds={pending.pickedCardInstanceIds}
              disabledIds={
                isRevealedChoice
                  ? pending.revealedCardInstanceIds.filter((id) => {
                      const group =
                        pending.revealedUsageGroupByInstanceId?.[id];
                      return (
                        !selectedIds.includes(id) &&
                        group !== undefined &&
                        selectedIds.some(
                          (selected) =>
                            pending.revealedUsageGroupByInstanceId?.[
                              selected
                            ] === group
                        )
                      );
                    })
                  : []
              }
              onSelect={toggleCard}
            />
          )}

          {/* ordering フェーズ — 全カード1行表示 */}
          {isOrdering && (
            <>
              <div className="dr-order-preview-labels">
                <span className="dr-order-arrow">◀ デッキの下</span>
                <span className="dr-order-arrow">デッキの上 ▶</span>
              </div>
              <div className="dr-cards">
                {/* 左=デッキ下 / 右=デッキ上。上下分配では上1が右端になるよう並べ替える。 */}
                {displayedOrderingCards.map((card) => {
                  if (!card) return null;
                  const { instanceId, def } = card;
                  const orderIdx = orderSequence.indexOf(instanceId);
                  const isOrdered = orderIdx >= 0;
                  return (
                    <DrCard
                      key={instanceId}
                      def={def}
                      className={`dr-card${isOrdered ? " ordered" : ""}`}
                      onPrimary={
                        isOrdered || needsSplitPlacementChoice
                          ? undefined
                          : () => addToOrder(instanceId)
                      }
                      openDetail={openDetail}
                    >
                      {def?.image ? (
                        <img
                          src={`/${def.image}`}
                          alt={def?.name ?? "?"}
                          className="dr-card-img"
                        />
                      ) : (
                        <div className="dr-card-placeholder">
                          {def?.name ?? "?"}
                        </div>
                      )}
                      {isOrdered && (
                        <div className="dr-card-order-badge">
                          {splitOrderLabels.get(instanceId) ?? orderIdx + 1}
                        </div>
                      )}
                      {needsSplitPlacementChoice && (
                        <div className="dr-split-placement-controls">
                          <button
                            type="button"
                            className={`dr-split-placement-btn${splitPlacements[instanceId] === "bottom" ? " active bottom" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSplitPlacement(instanceId, "bottom");
                            }}
                          >
                            下
                          </button>
                          <button
                            type="button"
                            className={`dr-split-placement-btn${splitPlacements[instanceId] === "top" ? " active top" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSplitPlacement(instanceId, "top");
                            }}
                          >
                            上
                          </button>
                        </div>
                      )}
                    </DrCard>
                  );
                })}
              </div>
            </>
          )}

          <div className="dr-actions">
            {isRevealedChoice && (
              <>
                {selectedIds.length > 0 && (
                  <button
                    className="dr-btn confirm"
                    onClick={handleConfirmPick}
                  >
                    {hasBurstSetChoice ? "効果を使う" : "手札に加える"} (
                    {selectedIds.length}枚)
                  </button>
                )}
                <button className="dr-btn skip" onClick={handleSkipPick}>
                  {hasBurstSetChoice ? "使わない" : "加えない"}
                </button>
              </>
            )}
            {isPicking && (
              <>
                <button
                  className="dr-btn confirm"
                  onClick={handleConfirmPick}
                  disabled={
                    !selection?.canConfirm ||
                    (needsFreeDestinationChoice && freeDestination === null)
                  }
                >
                  確定 ({selectedIds.length}/{requiredCount})
                </button>
                {pickAction?.canSkip && (
                  <button className="dr-btn skip" onClick={handleSkipPick}>
                    {pickAction.handGainCost ? "支払わず回収しない" : "0枚選ぶ"}
                  </button>
                )}
              </>
            )}
            {isOrdering && (
              <>
                <button
                  className="dr-btn confirm"
                  onClick={handleConfirmOrder}
                  disabled={
                    !!(needsPlacementChoice && placement === null) ||
                    !allSplitPlacementsChosen
                  }
                >
                  順番確定
                </button>
                {showOrderReset && (
                  <button className="dr-btn skip" onClick={resetOrder}>
                    リセット
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* カード詳細モーダル */}
      <CardDetailModal
        card={detailCard}
        show={detailCard !== null}
        onClose={() => setDetailCard(null)}
        hideDeckActions
        zIndex={1100}
      />
    </>
  );
}
