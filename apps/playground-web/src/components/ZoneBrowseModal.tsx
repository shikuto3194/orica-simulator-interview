import {
  getFaceUpDeckIds,
  isSoulStateCard,
  zoneDisplayLabel,
} from "@orica/rules-core";
/**
 * ZoneBrowseModal — 任意タイミングでゾーン（トラッシュ/ボイド/手元/バーストエリア/デッキ/フィールドのカード状態）のカード一覧を閲覧。
 *
 * 自分の公開中のデッキ・手元・トラッシュ・フィールドのカード状態
 * (かつ playerId === viewingPlayerId) のときは:
 *   - 1クリック → 召喚/使用アクション選択（legal action がある場合。トラッシュは
 *     「トラッシュにあるこのカードは…手札に戻る」等の手札起動効果 use_hand_card_effect、
 *     engine-trash-zone-flash-activated-recovery）
 *   - 右クリック / 長押し → カード詳細モーダル
 * それ以外（相手の手元/トラッシュ、除外、バーストエリア）は read-only で 1クリック=詳細。
 *
 * zone === "burst" は「バースト + ミラージュ」の合成ビュー（FieldArea の表示構成と同型:
 * ミラージュはバーストエリアに重ねてセットされる）。表裏判定は本コンポーネントでは行わず、
 * 呼び出し側が渡す `state` に委ねる（sanitizeStateForViewer 済みの `displayState` を渡せば、
 * 未公開の相手バーストは `definitionId` が伏せられ `getDefinition` が `undefined` を返す。
 * ミラージュは元々相手にも公開のため常に実カードが解決される）。
 *
 * zone === "deck" は `knownDeckCards` の既知スロットを下→上に表示する。
 * 現在表向きのカードだけ実体に結び付けて操作でき、未知区間は裏向きに畳む。
 */
import { useState, useMemo, type CSSProperties } from "react";
import { normalizeUnderCardRoleTag } from "@orica/rules-core";
import type {
  GameState,
  KnownDeckCard,
  CardDefinition,
  CardInstance,
  LegalAction,
  Zone,
} from "@orica/rules-core";
import { CardDetailModal } from "./CardDetailModal";
import { useLongPress } from "../hooks/useLongPress";
import { fieldCardDisplayKind } from "../utils/field-card-display";

export interface ZoneBrowseSnapshotCard {
  key: string;
  instanceId?: string;
  definitionIdSnapshot: string;
  badgeLabel?: string;
  detailStateLabel?: string;
  badgeTone?: ZoneBrowseSnapshotTone;
}

export type ZoneBrowseSnapshotTone = "neutral" | "selected" | "danger";

interface ZoneBrowseModalProps {
  state: GameState;
  /** ゾーン閲覧モード。instanceIds 指定時は無視される。 */
  zone?:
    | "trash"
    | "void"
    | "removed_from_game"
    | "set_aside"
    | "burst"
    | "deck"
    | "field";
  playerId?: string;
  playerLabel?: string;
  getDefinition: (id: string) => CardDefinition | undefined;
  onClose: () => void;
  /** 現在の legal actions。自分の手元のクリック→アクション発火に使う。 */
  actions?: readonly LegalAction[];
  /** 自分のプレイヤーID。手元クリックでアクション発火するか判定。 */
  viewingPlayerId?: string;
  /** 自分の手元カードがクリックされたとき呼ばれる。アクション選択モーダルを開く想定。 */
  onCardAction?: (instanceId: string, cardActions: LegalAction[]) => void;
  /** 明示リストモード: この instanceId 列を順番どおり表示 (zone フィルタの代わり)。
   * 煌臨スタック (煌臨先＋煌臨元) の閲覧などに流用する。read-only (クリック/長押し=詳細)。 */
  instanceIds?: readonly string[];
  /** 履歴 snapshot リストモード: live instance が無くても definition snapshot だけで表示する。 */
  snapshotCards?: readonly ZoneBrowseSnapshotCard[];
  /** 明示リストモードのヘッダタイトル。 */
  titleOverride?: string;
  /** 明示リストモードを「自分/相手 + ゾーン」単位で分割表示する。 */
  groupByOwnerZone?: boolean;
  /** 明示リストモードをフィールド重なりの役割単位で分割表示する。 */
  groupByFieldStackRole?: boolean;
  /** 対象選択モード: 選択可能な instanceId。 */
  selectableIds?: ReadonlySet<string>;
  /** 対象選択モード: 選択済み instanceId。 */
  selectedIds?: readonly string[];
  /** 対象選択モード: カードクリック時の選択ハンドラ。 */
  onSelectInstance?: (instanceId: string) => void;
  /** 対象選択モード用の下部ヒント。 */
  selectionHint?: string;
}

const CATEGORY_ORDER: Record<string, number> = {
  spirit: 0,
  ultimate: 1,
  brave: 2,
  nexus: 3,
  magic: 4,
};

const ZONE_GROUP_ORDER: Partial<Record<Zone, number>> = {
  hand: 0,
  set_aside: 1,
  trash: 2,
  void: 3,
  removed_from_game: 4,
  burst: 5,
  mirage: 6,
  deck: 7,
  life: 8,
  reserve: 9,
  field: 10,
  revealed: 11,
  in_use: 12,
};

type ZoneBrowseItem = {
  instance: CardInstance;
  def: CardDefinition | undefined;
};

type ZoneBrowseSnapshotItem = {
  key: string;
  def: CardDefinition | undefined;
  definitionIdSnapshot: string;
  badgeLabel?: string;
  detailStateLabel?: string;
  badgeTone?: ZoneBrowseSnapshotTone;
};

type ZoneBrowseGroup = {
  key: string;
  ownerPlayerId?: string;
  zone?: Zone;
  sortOrder?: number;
  title: string;
  items: ZoneBrowseItem[];
};

type DeckBrowseSegment =
  | { kind: "hidden"; count: number; key: string }
  | {
      kind: "known";
      entry: KnownDeckCard;
      def: CardDefinition | undefined;
      instanceId?: string;
    };

function zoneOwnerPlayerId(instance: CardInstance): string {
  return instance.zone === "set_aside"
    ? instance.ownerPlayerId
    : instance.controllerPlayerId;
}

function zoneOwnerLabel(
  playerId: string,
  viewingPlayerId: string | undefined
): string {
  if (!viewingPlayerId) return "プレイヤー";
  return playerId === viewingPlayerId ? "自分" : "相手";
}

function underCardRoleLabel(entryRole: {
  role: "advent_source" | "text_role";
  roleTag?: string | undefined;
}): { key: string; title: string; sortOrder: number } {
  if (entryRole.role === "advent_source") {
    return { key: "role:advent_source", title: "煌臨元", sortOrder: 1 };
  }
  const roleTag =
    normalizeUnderCardRoleTag(entryRole.roleTag) ?? "アンダーカード";
  return {
    key: `role:text:${roleTag}`,
    title: roleTag,
    sortOrder: 2,
  };
}

/**
 * ZoneBrowseCard — 1 カード分の DOM。クリック=primary、長押し/右クリック=詳細。
 */
function ZoneBrowseCard({
  def,
  badgeLabel,
  badgeTone,
  isActionable,
  isSelected,
  onPrimary,
  onOpenDetail,
  deckTitle,
}: {
  def: CardDefinition | undefined;
  badgeLabel?: string;
  badgeTone?: ZoneBrowseSnapshotTone;
  isActionable: boolean;
  isSelected: boolean;
  onPrimary: () => void;
  onOpenDetail: () => void;
  deckTitle?: string;
}) {
  const lp = useLongPress(onOpenDetail);
  const Root = deckTitle === undefined ? "div" : "button";
  const cardClass =
    deckTitle === undefined ? "zone-browse-card" : "deck-browse-card";
  return (
    <Root
      {...(deckTitle !== undefined ? { type: "button" as const } : {})}
      className={
        (deckTitle === undefined
          ? "zone-browse-card"
          : "deck-browse-known-card") +
        (isActionable ? " zone-browse-card-actionable" : "") +
        (isSelected ? " zone-browse-card-selected" : "")
      }
      {...lp.handlers}
      onClick={() => {
        if (lp.consumeFired()) return;
        onPrimary();
      }}
      title={deckTitle ?? def?.name ?? "？？？"}
    >
      {def?.image ? (
        <img
          className={`${cardClass}-img`}
          src={`/${def.image}`}
          alt={def.name}
          loading="lazy"
        />
      ) : def ? (
        <div className={`${cardClass}-placeholder`}>
          <span>{def.name}</span>
        </div>
      ) : (
        // def が無い = sanitizeStateForViewer によって伏せられた相手の非公開カード
        // (未公開バースト等)。instanceId の断片ではなく裏向きカードとして表示する。
        <img
          className={`${cardClass}-img`}
          src="/images/ForGUI/card-back.jpg"
          alt="裏向き"
          loading="lazy"
        />
      )}
      {badgeLabel ? (
        <div
          className={`zone-browse-card-badge zone-browse-card-badge-${
            badgeTone ?? "neutral"
          }`}
        >
          {badgeLabel}
        </div>
      ) : null}
      <div className={`${cardClass}-name`}>{def?.name ?? "？？？"}</div>
    </Root>
  );
}

function HiddenDeckSegment({ count }: { count: number }) {
  const renderBack = (key: string) => (
    <img
      key={key}
      className="deck-browse-card-img"
      src="/images/ForGUI/card-back.jpg"
      alt="裏向き"
      loading="lazy"
    />
  );
  return (
    <div
      className={`deck-browse-hidden${count >= 3 ? " deck-browse-hidden-collapsed" : ""}`}
      title={`非公開 ${count}枚`}
    >
      {count >= 3
        ? [
            renderBack("bottom"),
            <span key="ellipsis" className="deck-browse-hidden-ellipsis">
              ...
            </span>,
            renderBack("top"),
          ]
        : Array.from({ length: count }).map((_, index) =>
            renderBack(String(index))
          )}
      <span className="deck-browse-hidden-count">{count}</span>
    </div>
  );
}

export function ZoneBrowseModal({
  state,
  zone,
  playerId,
  playerLabel,
  getDefinition,
  onClose,
  actions,
  viewingPlayerId,
  onCardAction,
  instanceIds,
  snapshotCards,
  titleOverride,
  groupByOwnerZone,
  groupByFieldStackRole,
  selectableIds,
  selectedIds,
  onSelectInstance,
  selectionHint,
}: ZoneBrowseModalProps) {
  const [detailInstanceId, setDetailInstanceId] = useState<string | null>(null);
  const [detailDefinitionId, setDetailDefinitionId] = useState<string | null>(
    null
  );
  const [detailHistoryStateLabel, setDetailHistoryStateLabel] = useState<
    string | undefined
  >(undefined);

  /** 明示リストモード (煌臨スタック等) かどうか。 */
  const explicit = instanceIds !== undefined || snapshotCards !== undefined;
  const isSnapshotBrowse = snapshotCards !== undefined;
  const isDeckBrowse = !explicit && zone === "deck" && playerId !== undefined;
  const deckCards = useMemo(
    () =>
      isDeckBrowse
        ? state.cardInstances.filter(
            (card) => card.ownerPlayerId === playerId && card.zone === "deck"
          )
        : [],
    [isDeckBrowse, playerId, state.cardInstances]
  );
  const deckCount = deckCards.length;
  const deckSegments = useMemo<DeckBrowseSegment[]>(() => {
    if (!isDeckBrowse || !playerId) return [];
    const faceUpIds = new Set(getFaceUpDeckIds(state, playerId));
    const knownByIndex = new Map<number, KnownDeckCard>();
    for (const entry of state.knownDeckCards ?? []) {
      if (entry.playerId !== playerId) continue;
      if (entry.indexFromBottom < 0 || entry.indexFromBottom >= deckCount) {
        continue;
      }
      knownByIndex.set(entry.indexFromBottom, entry);
    }

    const knownEntries = [...knownByIndex.values()].sort(
      (a, b) => a.indexFromBottom - b.indexFromBottom
    );
    const segments: DeckBrowseSegment[] = [];
    let cursor = 0;
    for (const entry of knownEntries) {
      if (entry.indexFromBottom > cursor) {
        segments.push({
          kind: "hidden",
          count: entry.indexFromBottom - cursor,
          key: `hidden:${cursor}:${entry.indexFromBottom}`,
        });
      }
      // 既知位置の履歴は hidden instance に再接続しない。現在の公開カードだけ操作する。
      const liveCard = deckCards[deckCount - 1 - entry.indexFromBottom];
      const instanceId =
        liveCard &&
        faceUpIds.has(liveCard.instanceId) &&
        liveCard.definitionId === entry.definitionIdSnapshot
          ? liveCard.instanceId
          : undefined;
      segments.push({
        kind: "known",
        entry,
        def: getDefinition(entry.definitionIdSnapshot),
        ...(instanceId ? { instanceId } : {}),
      });
      cursor = entry.indexFromBottom + 1;
    }
    if (cursor < deckCount) {
      segments.push({
        kind: "hidden",
        count: deckCount - cursor,
        key: `hidden:${cursor}:end`,
      });
    }
    return segments;
  }, [deckCards, deckCount, getDefinition, isDeckBrowse, playerId, state]);

  const zoneCards = useMemo<ZoneBrowseItem[]>(() => {
    if (isDeckBrowse) return [];
    if (isSnapshotBrowse) return [];
    // 明示リストモード: 指定 instanceId を順番どおりに解決する (ソートしない)。
    if (instanceIds) {
      return instanceIds
        .map((id) => state.cardInstances.find((c) => c.instanceId === id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map((c) => ({ instance: c, def: getDefinition(c.definitionId) }));
    }
    const cards = state.cardInstances
      .filter((c) => {
        // バーストエリア = バースト + ミラージュの合成ビュー (FieldArea の表示構成と同型)。
        if (zone === "burst") {
          return (
            c.controllerPlayerId === playerId &&
            (c.zone === "burst" || c.zone === "mirage")
          );
        }
        const matchPlayer =
          zone === "set_aside"
            ? c.ownerPlayerId === playerId
            : c.controllerPlayerId === playerId;
        return (
          matchPlayer &&
          c.zone === zone &&
          (zone !== "field" ||
            fieldCardDisplayKind(state, c, getDefinition) === "card")
        );
      })
      .map((c) => ({ instance: c, def: getDefinition(c.definitionId) }));
    cards.sort((a, b) => {
      const catA = CATEGORY_ORDER[a.def?.printedCategory ?? ""] ?? 99;
      const catB = CATEGORY_ORDER[b.def?.printedCategory ?? ""] ?? 99;
      if (catA !== catB) return catA - catB;
      const costA = a.def?.cost ?? 0;
      const costB = b.def?.cost ?? 0;
      if (costA !== costB) return costA - costB;
      return (a.def?.name ?? "").localeCompare(b.def?.name ?? "");
    });
    return cards;
  }, [
    state,
    playerId,
    zone,
    getDefinition,
    instanceIds,
    isDeckBrowse,
    isSnapshotBrowse,
  ]);

  const snapshotItems = useMemo<ZoneBrowseSnapshotItem[]>(() => {
    if (!snapshotCards) return [];
    return snapshotCards.map((entry) => ({
      key: entry.key,
      def: getDefinition(entry.definitionIdSnapshot),
      definitionIdSnapshot: entry.definitionIdSnapshot,
      ...(entry.badgeLabel ? { badgeLabel: entry.badgeLabel } : {}),
      ...(entry.detailStateLabel
        ? { detailStateLabel: entry.detailStateLabel }
        : {}),
      ...(entry.badgeTone ? { badgeTone: entry.badgeTone } : {}),
    }));
  }, [getDefinition, snapshotCards]);

  const label =
    zone === "field"
      ? "フィールドのカード"
      : zone
        ? zoneDisplayLabel(zone)
        : "";
  const groupedZoneCards = useMemo<ZoneBrowseGroup[]>(() => {
    if (!explicit || !groupByOwnerZone) return [];
    const byKey = new Map<string, ZoneBrowseGroup>();
    for (const item of zoneCards) {
      const ownerId = zoneOwnerPlayerId(item.instance);
      const zoneKey = item.instance.zone;
      const soulState = isSoulStateCard(state, item.instance.instanceId);
      const key = `${ownerId}:${zoneKey}:${soulState}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.items.push(item);
        continue;
      }
      byKey.set(key, {
        key,
        ownerPlayerId: ownerId,
        zone: zoneKey,
        title: `${zoneOwnerLabel(ownerId, viewingPlayerId)}の${soulState ? "魂状態" : zoneDisplayLabel(zoneKey)}`,
        items: [item],
      });
    }
    return [...byKey.values()].sort((a, b) => {
      const ownerA =
        viewingPlayerId && a.ownerPlayerId === viewingPlayerId ? 0 : 1;
      const ownerB =
        viewingPlayerId && b.ownerPlayerId === viewingPlayerId ? 0 : 1;
      if (ownerA !== ownerB) return ownerA - ownerB;
      const zoneA = a.zone ? (ZONE_GROUP_ORDER[a.zone] ?? 99) : 99;
      const zoneB = b.zone ? (ZONE_GROUP_ORDER[b.zone] ?? 99) : 99;
      if (zoneA !== zoneB) return zoneA - zoneB;
      return a.key.localeCompare(b.key);
    });
  }, [explicit, groupByOwnerZone, viewingPlayerId, zoneCards, state]);
  const fieldStackRoleGroups = useMemo<ZoneBrowseGroup[]>(() => {
    if (!explicit || !groupByFieldStackRole || !instanceIds) return [];
    const explicitIds = new Set(instanceIds);
    const referencesByUnderCardId = new Map<
      string,
      { role: "advent_source" | "text_role"; roleTag?: string | undefined }[]
    >();
    const attachedBraveIds = new Set<string>();
    for (const card of state.cardInstances) {
      if (!explicitIds.has(card.instanceId)) continue;
      for (const childId of card.attachedChildrenIds) {
        if (explicitIds.has(childId)) attachedBraveIds.add(childId);
      }
      for (const entry of card.underCards ?? []) {
        if (!explicitIds.has(entry.cardInstanceId)) continue;
        const list = referencesByUnderCardId.get(entry.cardInstanceId) ?? [];
        list.push(entry);
        referencesByUnderCardId.set(entry.cardInstanceId, list);
      }
    }
    for (const card of state.cardInstances) {
      if (!explicitIds.has(card.instanceId)) continue;
      if (
        card.imaginRightCombinedWith !== null &&
        explicitIds.has(card.imaginRightCombinedWith)
      ) {
        attachedBraveIds.add(card.instanceId);
      }
    }

    const byKey = new Map<string, ZoneBrowseGroup>();
    for (const item of zoneCards) {
      const refs = referencesByUnderCardId.get(item.instance.instanceId) ?? [];
      const role = attachedBraveIds.has(item.instance.instanceId)
        ? { key: "role:combined-brave", title: "合体ブレイヴ", sortOrder: 1 }
        : refs.length === 0
          ? { key: "role:body", title: "本体", sortOrder: 0 }
          : (() => {
              const labels = refs.map(underCardRoleLabel);
              const uniqueKeys = new Set(labels.map((label) => label.key));
              if (uniqueKeys.size === 1) return labels[0]!;
              return {
                key: "role:mixed",
                title: "複数ロール",
                sortOrder: 9,
              };
            })();
      const existing = byKey.get(role.key);
      if (existing) {
        existing.items.push(item);
        continue;
      }
      byKey.set(role.key, {
        key: role.key,
        title: role.title,
        sortOrder: role.sortOrder,
        items: [item],
      });
    }
    return [...byKey.values()].sort((a, b) => {
      const orderA = a.sortOrder ?? 99;
      const orderB = b.sortOrder ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.key.localeCompare(b.key);
    });
  }, [
    explicit,
    groupByFieldStackRole,
    instanceIds,
    state.cardInstances,
    zoneCards,
  ]);

  /** 自分の公開デッキ/手元/トラッシュ/フィールドのカード状態は legal action から操作可能。 */
  const isOwnActionableZone =
    !explicit &&
    (zone === "set_aside" ||
      zone === "trash" ||
      zone === "field" ||
      zone === "deck") &&
    viewingPlayerId !== undefined &&
    playerId === viewingPlayerId;

  // インスタンスごとに引ける legal action マップ
  const cardActionsByInstance = useMemo(() => {
    if (!isOwnActionableZone || !actions)
      return new Map<string, LegalAction[]>();
    const map = new Map<string, LegalAction[]>();
    for (const a of actions) {
      if ("sourceInstanceId" in a) {
        const list = map.get(a.sourceInstanceId) ?? [];
        list.push(a);
        map.set(a.sourceInstanceId, list);
      }
    }
    return map;
  }, [actions, isOwnActionableZone]);

  const detailInstance = detailInstanceId
    ? state.cardInstances.find((c) => c.instanceId === detailInstanceId)
    : null;
  const detailCard = detailInstance
    ? (getDefinition(detailInstance.definitionId) ?? null)
    : null;
  const detailDefinition = detailDefinitionId
    ? (getDefinition(detailDefinitionId) ?? null)
    : null;

  const handleCardPrimary = (instanceId: string) => {
    if (selectableIds?.has(instanceId) && onSelectInstance) {
      onSelectInstance(instanceId);
      return;
    }
    if (isOwnActionableZone) {
      const cardActions = cardActionsByInstance.get(instanceId);
      if (cardActions && cardActions.length > 0 && onCardAction) {
        onCardAction(instanceId, cardActions);
        onClose();
        return;
      }
      // アクションがないときは詳細モーダルにフォールバック
    }
    setDetailInstanceId(instanceId);
  };

  const renderCards = (items: readonly ZoneBrowseItem[]) =>
    items.map(({ instance, def }) => {
      const cardActions = cardActionsByInstance.get(instance.instanceId);
      const isActionable =
        selectableIds?.has(instance.instanceId) === true ||
        (isOwnActionableZone &&
          cardActions !== undefined &&
          cardActions.length > 0);
      const isSelected = selectedIds?.includes(instance.instanceId) === true;
      return (
        <ZoneBrowseCard
          key={instance.instanceId}
          def={def}
          isActionable={isActionable}
          isSelected={isSelected}
          onPrimary={() => handleCardPrimary(instance.instanceId)}
          onOpenDetail={() => {
            setDetailInstanceId(instance.instanceId);
          }}
        />
      );
    });

  const renderSnapshotCards = (items: readonly ZoneBrowseSnapshotItem[]) =>
    items.map((item) => (
      <ZoneBrowseCard
        key={item.key}
        def={item.def}
        {...(item.badgeLabel ? { badgeLabel: item.badgeLabel } : {})}
        {...(item.badgeTone ? { badgeTone: item.badgeTone } : {})}
        isActionable={false}
        isSelected={false}
        onPrimary={() => {
          setDetailDefinitionId(item.definitionIdSnapshot);
          setDetailHistoryStateLabel(item.detailStateLabel);
        }}
        onOpenDetail={() => {
          setDetailDefinitionId(item.definitionIdSnapshot);
          setDetailHistoryStateLabel(item.detailStateLabel);
        }}
      />
    ));

  const renderDeckBrowse = () => (
    <>
      <div className="deck-browse-axis" aria-hidden="true">
        <span>◀ 下</span>
        <strong>{deckCount}枚</strong>
        <span>上 ▶</span>
      </div>
      <div className="deck-browse-track">
        {deckCount === 0 ? (
          <p className="zone-browse-empty">カードがありません</p>
        ) : (
          deckSegments.map((segment) =>
            segment.kind === "hidden" ? (
              <HiddenDeckSegment key={segment.key} count={segment.count} />
            ) : (
              <ZoneBrowseCard
                key={`${segment.entry.playerId}:${segment.entry.indexFromBottom}`}
                def={segment.def}
                deckTitle={
                  segment.def
                    ? `${segment.def.name}（下から${segment.entry.indexFromBottom + 1}枚目）`
                    : `公開済みカード（下から${segment.entry.indexFromBottom + 1}枚目）`
                }
                isActionable={
                  segment.instanceId !== undefined &&
                  (selectableIds?.has(segment.instanceId) === true ||
                    (cardActionsByInstance.get(segment.instanceId)?.length ??
                      0) > 0)
                }
                isSelected={
                  segment.instanceId !== undefined &&
                  selectedIds?.includes(segment.instanceId) === true
                }
                onPrimary={() => {
                  if (segment.instanceId) handleCardPrimary(segment.instanceId);
                  else
                    setDetailDefinitionId(segment.entry.definitionIdSnapshot);
                }}
                onOpenDetail={() => {
                  if (segment.instanceId)
                    setDetailInstanceId(segment.instanceId);
                  else
                    setDetailDefinitionId(segment.entry.definitionIdSnapshot);
                }}
              />
            )
          )
        )}
      </div>
    </>
  );
  const title = explicit
    ? `${titleOverride ?? "カード"}（${
        snapshotCards ? snapshotItems.length : zoneCards.length
      }枚）`
    : isDeckBrowse
      ? `${playerLabel}の${label}（${deckCount}枚）`
      : `${playerLabel}の${label}（${zoneCards.length}枚）`;

  return (
    <>
      <div className="zone-browse-overlay" onClick={onClose}>
        <div
          className={`zone-browse-panel${isDeckBrowse ? " deck-browse-panel" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="zone-browse-header">
            <h3 className="zone-browse-title">{title}</h3>
            <button className="zone-browse-close" onClick={onClose}>
              ✕
            </button>
          </div>

          {isDeckBrowse ? (
            renderDeckBrowse()
          ) : isSnapshotBrowse ? (
            snapshotItems.length === 0 ? (
              <p className="zone-browse-empty">カードがありません</p>
            ) : (
              <div className="zone-browse-grid">
                {renderSnapshotCards(snapshotItems)}
              </div>
            )
          ) : zoneCards.length === 0 ? (
            <p className="zone-browse-empty">カードがありません</p>
          ) : groupByFieldStackRole && fieldStackRoleGroups.length > 0 ? (
            <div className="zone-browse-groups zone-browse-groups-field-stack">
              {fieldStackRoleGroups.map((group) => (
                <section
                  className={`zone-browse-group ${
                    group.items.length >= 3
                      ? "zone-browse-group-wide"
                      : "zone-browse-group-pack"
                  }`}
                  key={group.key}
                  style={
                    {
                      "--zone-browse-group-cards": String(group.items.length),
                    } as CSSProperties
                  }
                >
                  <h4 className="zone-browse-group-title">
                    {group.title}
                    <span>{group.items.length}枚</span>
                  </h4>
                  <div className="zone-browse-grid">
                    {renderCards(group.items)}
                  </div>
                </section>
              ))}
            </div>
          ) : groupByOwnerZone && groupedZoneCards.length > 0 ? (
            <div className="zone-browse-groups">
              {groupedZoneCards.map((group) => (
                <section className="zone-browse-group" key={group.key}>
                  <h4 className="zone-browse-group-title">
                    {group.title}
                    <span>{group.items.length}枚</span>
                  </h4>
                  <div className="zone-browse-grid">
                    {renderCards(group.items)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="zone-browse-grid">{renderCards(zoneCards)}</div>
          )}

          {selectionHint ? (
            <p className="zone-browse-hint">{selectionHint}</p>
          ) : isOwnActionableZone ? (
            <p className="zone-browse-hint">
              クリック: 召喚/使用 ／ 右クリック・長押し: 詳細
            </p>
          ) : null}
        </div>
      </div>
      {detailInstanceId && detailInstance && (
        <CardDetailModal
          card={detailCard}
          cardInstance={detailInstance}
          gameState={state}
          getCardDefinitionById={getDefinition}
          onClose={() => setDetailInstanceId(null)}
          hideDeckActions
          zIndex={1100}
        />
      )}
      {detailDefinitionId && detailDefinition && (
        <CardDetailModal
          card={detailDefinition}
          {...(detailHistoryStateLabel
            ? { historyStateLabel: detailHistoryStateLabel }
            : {})}
          onClose={() => {
            setDetailDefinitionId(null);
            setDetailHistoryStateLabel(undefined);
          }}
          hideDeckActions
          zIndex={1100}
        />
      )}
    </>
  );
}
