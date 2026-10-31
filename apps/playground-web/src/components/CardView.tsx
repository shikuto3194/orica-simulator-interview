import { useContext, useRef, useCallback, useEffect, useState } from "react";
import { EffectSourceContext } from "./EffectSourceScope";
import type { CSSProperties } from "react";
import type { CardDefinition, CardInstance } from "@orica/rules-core";
import { calculateLevelFromResources } from "@orica/rules-core";
import { isBattleCapableCategory } from "../../../../packages/rules-core/src/battle/battle-shared";
import { SymbolOverlayChunks } from "./SymbolOverlayChunks";
import type { SymbolChunk } from "../utils/symbol-format";
import { useLongPress } from "../hooks/useLongPress";
import type { FieldUnderCardPeek } from "../utils/field-under-card-visual";

/** 煌臨スタック peek: 1 段あたりのずらし量 (px) と最大描画段数。
 * 「重なっていることが分かればよい」要件のため、枚数が多くても最大段数で打ち切る。 */
const ADVENT_PEEK_STEP_PX = 4;
const ADVENT_PEEK_MAX_LAYERS = 4;

interface CardViewProps {
  card: CardInstance;
  definition: CardDefinition | undefined;
  isHighlighted?: boolean | undefined;
  isSelectable?: boolean | undefined;
  /** ゾーン選択モード中: 選択済みマーク（青枠+チェック）を表示 */
  isSelected?: boolean | undefined;
  /** ゾーン選択モード中の候補外: グレーアウトしてクリック不可 */
  isNonCandidate?: boolean | undefined;
  isAttacking?: boolean | undefined;
  /** 宣言中（まだ成立前）: 30度傾き */
  isDeclaring?: boolean | undefined;
  /** P2-08 10-1: 現在のアタッカー（成立後の戦闘中強調。赤外枠 + 前方 translateY） */
  isAttackerHighlight?: boolean | undefined;
  /** P2-08 10-1: 現在のブロッカー（成立後の戦闘中強調。青外枠 + 前方 translateY） */
  isBlockerHighlight?: boolean | undefined;
  isDraggable?: boolean | undefined;
  isDropTarget?: boolean | undefined;
  onClick?: (() => void) | undefined;
  onDetailRequest?: (() => void) | undefined;
  onDragStart?: ((instanceId: string) => void) | undefined;
  onDrop?: ((instanceId: string) => void) | undefined;
  /** タッチドラッグでフィールド方向に移動したときのコールバック */
  onTouchDragPlay?: ((instanceId: string) => void) | undefined;
  /** 合体中ブレイヴ: コア/Lv/BP を非表示 */
  hideStats?: boolean | undefined;
  /** ブレイヴの BP+ 加算値 */
  braveBpBonus?: number | undefined;
  /** 表示用コア数オーバーライド（未指定なら card.normalCoreCount を使用） */
  displayNormalCoreCount?: number | undefined;
  /**
   * 表示用ソウルコア添着数（P3-101 S4）。caller (FieldArea 等) が
   * `resolveSoulCoreDisplayCount(card.soulCoreCount, override, hadPrimaryHere)` を渡す。
   * 未指定は 0。
   */
  displaySoulCoreCount?: number | undefined;
  size?: "small" | "medium" | "large" | undefined;
  /** 実質BP（継続効果適用後）。指定時はカード定義BPの代わりに表示 */
  resolvedBp?: number | undefined;
  /** 実質Lv（継続効果適用後）。P3-47 F-2 act_as_spirit token 等で host 由来 Lv を表示するために使う */
  resolvedLevel?: number | undefined;
  /** シンボル表示モード: true でグレーアウト + pointer-events:none */
  symbolOverlayActive?: boolean | undefined;
  /** シンボル表示モード: 非空配列ならカード中央に色別シンボルラベル (色n) を表示 */
  symbolOverlayChunks?: readonly SymbolChunk[] | undefined;
  /** B-1: 転醒中（A面→B面 or B面→A面に裏返った状態） */
  isRebirthed?: boolean | undefined;
  /** B-2: 煌臨中（adventSourceCardIds.length > 0） */
  isAdventActive?: boolean | undefined;
  /** B-2: 煌臨元の枚数。下端に重なり (peek) を描画してスタックを表現する。 */
  adventSourceCount?: number | undefined;
  /** フィールド上のアンダーカード重なり peek。指定時は adventSourceCount より優先する。 */
  underCardPeek?: FieldUnderCardPeek | undefined;
  /** B-3: 魂状態（契約カードが魂状態で残留中） */
  isSoulState?: boolean | undefined;
  /**
   * P2-05: 同時アタックのペア色 index (blockAssignments の並び順)。
   * アタッカーとそのブロッカーが同じ色の外枠を持ち、誰が誰をブロックしているかを
   * 視覚的に紐付ける (1ペア目=赤、2ペア目=青、以降 緑/黄/紫)。
   */
  battlePairColorIndex?: number | undefined;
  /** Field composition 内で member ごとの座標を与えるための内部レイアウト用 class/style。 */
  layoutClassName?: string | undefined;
  layoutStyle?: CSSProperties | undefined;
}

/** P2-05: バトルペア色パレット (1ペア目=赤, 2ペア目=青, ...)。 */
export const BATTLE_PAIR_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f1c40f",
  "#9b59b6",
] as const;

export function CardView({
  card,
  definition,
  isHighlighted,
  isSelectable,
  isSelected,
  isNonCandidate,
  isAttacking,
  isDeclaring,
  isAttackerHighlight,
  isBlockerHighlight,
  isDraggable,
  isDropTarget,
  onClick,
  onDetailRequest,
  onDragStart,
  onDrop,
  onTouchDragPlay,
  hideStats,
  braveBpBonus = 0,
  displayNormalCoreCount,
  displaySoulCoreCount,
  size = "medium",
  resolvedBp,
  resolvedLevel,
  symbolOverlayActive,
  symbolOverlayChunks,
  isRebirthed,
  isAdventActive,
  adventSourceCount,
  underCardPeek,
  isSoulState,
  battlePairColorIndex,
  layoutClassName,
  layoutStyle,
}: CardViewProps) {
  const isEffectSource = useContext(EffectSourceContext) === card.instanceId;
  const colorClass = definition?.colors[0] ?? "unknown";

  // B-1: 転醒フリップアニメーション — definitionId の変化を検知
  const prevDefIdRef = useRef(card.definitionId);
  const [rebirthFlipping, setRebirthFlipping] = useState(false);
  useEffect(() => {
    if (prevDefIdRef.current !== card.definitionId && card.zone === "field") {
      setRebirthFlipping(true); // eslint-disable-line react-hooks/set-state-in-effect -- 転醒フリップアニメーション
      const timer = setTimeout(() => setRebirthFlipping(false), 600);
      prevDefIdRef.current = card.definitionId;
      return () => clearTimeout(timer);
    }
    prevDefIdRef.current = card.definitionId;
  }, [card.definitionId, card.zone]);

  // Long press / right-click → card detail。
  // long-press 発火後の click は consumeFired で抑制（重複発火バグ防止）。
  const lp = useLongPress(() => onDetailRequest?.());

  // タッチドラッグ: 上方向に50px以上移動でドロップ扱い
  const touchStartY = useRef<number | null>(null);
  const touchDragFired = useRef(false);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isDraggable) return;
      touchStartY.current = e.touches[0]!.clientY;
      touchDragFired.current = false;
      lp.cancel();
    },
    [isDraggable, lp]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (
        !isDraggable ||
        touchStartY.current === null ||
        touchDragFired.current
      )
        return;
      const dy = touchStartY.current - e.touches[0]!.clientY;
      if (dy > 50) {
        // 上方向に50px以上 → フィールドへのドラッグとみなす
        touchDragFired.current = true;
        touchStartY.current = null;
        lp.cancel();
        onTouchDragPlay?.(card.instanceId);
      }
    },
    [isDraggable, card.instanceId, onTouchDragPlay, lp]
  );

  const handleTouchEnd = useCallback(() => {
    touchStartY.current = null;
  }, []);

  const isOnField = card.zone === "field";
  // P3-47 F-1: 裏向きフィールド配置。owner viewer は通常画像 + 裏マーカー、
  // opponent viewer は sanitizer により definition が undefined となるため card-back を表示する。
  const isFaceDown = card.faceDown === true && isOnField;
  // P3-47 F-2 Step 7: act_as_spirit token は face-down でも BP/Lv バッジを表示する
  // (host 由来のステータスを resolvedBp / resolvedLevel から受け取る)。
  const isActAsSpiritToken = isOnField && resolvedBp !== undefined;
  const showExhaustion =
    isOnField && !isSoulState && (!isFaceDown || isActAsSpiritToken);
  const isExhausted = showExhaustion && card.exhaustState === "exhausted";
  const isHeavilyExhausted =
    showExhaustion && card.exhaustState === "heavily_exhausted";
  const effectiveCoreCount = displayNormalCoreCount ?? card.normalCoreCount;
  const effectiveSoulCoreCount = displaySoulCoreCount ?? 0;
  const totalCores = effectiveCoreCount + effectiveSoulCoreCount;

  const baseBp =
    isOnField &&
    !hideStats &&
    !isFaceDown &&
    definition &&
    definition.levelDefs.length > 0 &&
    isBattleCapableCategory(definition, card)
      ? getBpForCores(definition, totalCores)
      : null;
  // resolvedBp が渡された場合はそれを使用（継続効果適用済み）。
  // act_as_spirit token は face-down でも resolvedBp を採用。
  const bp =
    isFaceDown && !isActAsSpiritToken
      ? null
      : resolvedBp !== undefined
        ? resolvedBp
        : baseBp !== null
          ? baseBp + braveBpBonus
          : null;

  const printedLevel =
    isOnField &&
    !hideStats &&
    !isFaceDown &&
    definition &&
    definition.levelDefs.length > 0
      ? getLevelForCores(definition, totalCores)
      : null;
  // act_as_spirit token は host 由来の resolvedLevel を優先表示。
  const level =
    isFaceDown && !isActAsSpiritToken
      ? null
      : resolvedLevel !== undefined
        ? resolvedLevel
        : printedLevel;

  // フィールド上のアンダーカード重なり (peek)。下カードの中身は見せず、カード縁だけを
  // box-shadow で表現する。FieldArea 側の wrapper がはみ出し分の占有領域を確保する。
  const fallbackAdventPeek: FieldUnderCardPeek | undefined =
    adventSourceCount && adventSourceCount > 0
      ? {
          layout: "vertical",
          count: adventSourceCount,
          stepPx: ADVENT_PEEK_STEP_PX,
        }
      : undefined;
  const stackPeek = underCardPeek ?? fallbackAdventPeek;
  const stackStyle: CSSProperties | undefined = stackPeek
    ? (() => {
        const parts: string[] = [];
        if (stackPeek.layout === "star-garment-triangle") {
          const y = stackPeek.stepPx;
          for (const x of [-stackPeek.stepPx, stackPeek.stepPx]) {
            parts.push(`${x}px ${y}px 0 0 #2c2c3e`);
            parts.push(`${x}px ${y}px 0 1px rgba(255, 255, 255, 0.18)`);
          }
        } else if (
          stackPeek.layout === "buddy-v-left" ||
          stackPeek.layout === "buddy-v-right"
        ) {
          const x =
            stackPeek.layout === "buddy-v-left"
              ? stackPeek.stepPx
              : -stackPeek.stepPx;
          const y = stackPeek.stepPx;
          parts.push(`${x}px ${y}px 0 0 #2c2c3e`);
          parts.push(`${x}px ${y}px 0 1px rgba(255, 255, 255, 0.18)`);
        } else {
          const layers = Math.min(stackPeek.count, ADVENT_PEEK_MAX_LAYERS);
          for (let i = 1; i <= layers; i++) {
            const off = i * stackPeek.stepPx;
            parts.push(`0 ${off}px 0 0 #2c2c3e`);
            parts.push(`0 ${off}px 0 1px rgba(255, 255, 255, 0.18)`);
          }
        }
        return { "--field-stack-shadow": parts.join(", ") } as CSSProperties;
      })()
    : undefined;

  // P2-05: ペア色 (--ac-pair-color)。ac-attacker / ac-blocker の外枠色が
  // この CSS 変数を参照する (未設定時は従来の赤/青 fallback)。
  const battlePairStyle: CSSProperties | undefined =
    battlePairColorIndex !== undefined
      ? ({
          "--ac-pair-color":
            BATTLE_PAIR_COLORS[
              battlePairColorIndex % BATTLE_PAIR_COLORS.length
            ],
        } as CSSProperties)
      : undefined;

  return (
    <div
      style={
        stackStyle || battlePairStyle
          ? { ...stackStyle, ...battlePairStyle, ...layoutStyle }
          : layoutStyle
      }
      className={[
        "card-view",
        `card-${size}`,
        `card-color-${colorClass}`,
        isExhausted ? "card-exhausted" : "",
        isHeavilyExhausted ? "card-heavily-exhausted" : "",
        isHighlighted ? "card-highlighted" : "",
        isEffectSource ? "card-effect-source" : "",
        isSelectable ? "ac-selectable" : "",
        isSelected ? "ac-selected" : "",
        isNonCandidate ? "card-non-candidate" : "",
        isAttacking ? "card-attacking" : "",
        isDeclaring ? "card-declaring" : "",
        isAttackerHighlight ? "ac-attacker" : "",
        isBlockerHighlight ? "ac-blocker" : "",
        isDraggable ? "card-draggable" : "",
        isDropTarget ? "card-drop-target" : "",
        card.pendingLeaveKind ? "card-pending-leave" : "",
        rebirthFlipping ? "card-rebirth-flip" : "",
        isRebirthed ? "card-rebirthed" : "",
        stackPeek ? "card-under-stack" : "",
        isAdventActive ? "card-advent-active" : "",
        isSoulState ? "card-soul-state" : "",
        isFaceDown ? "card-face-down" : "",
        symbolOverlayActive ? "card-symbol-overlay-active" : "",
        layoutClassName ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => {
        // 長押し/右クリックで詳細を開いた直後の click は握り潰す。
        // onDetailRequest がある (= 長押しが詳細を開く) ときは親要素への伝播も
        // 止め、合体スピリットの wrapper onClick による「詳細表示 + 対象選択」の
        // 二重発火を防ぐ。onDetailRequest 無し (例: 手元カード) は親 click に依存
        // する従来挙動を保つため伝播は止めない。
        if (lp.consumeFired()) {
          if (onDetailRequest) e.stopPropagation();
          return;
        }
        if (isSelectable && !isNonCandidate) onClick?.();
      }}
      {...lp.handlers}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      draggable={isDraggable}
      onDragStart={
        isDraggable
          ? (e) => {
              lp.cancel();
              e.dataTransfer.setData("text/plain", card.instanceId);
              onDragStart?.(card.instanceId);
            }
          : undefined
      }
      onDragOver={isDropTarget ? (e) => e.preventDefault() : undefined}
      onDrop={
        isDropTarget
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onDrop?.(card.instanceId);
            }
          : undefined
      }
      title={
        isFaceDown && !definition
          ? "裏向きカード"
          : (definition?.name ?? card.definitionId)
      }
      data-testid={`card-${card.instanceId}`}
      data-card-zone={card.zone}
      data-card-face-down={isFaceDown ? "true" : undefined}
      data-card-category={
        isFaceDown && !definition
          ? "face-down"
          : (definition?.printedCategory ?? "unknown")
      }
      data-card-name={
        isFaceDown && !definition
          ? "face-down"
          : (definition?.name ?? card.definitionId)
      }
    >
      {isFaceDown ? (
        // フィールド上の裏向きカードは owner / opponent viewer 共通で裏面画像を表示。
        // 詳細はクリック/長押しで CardDetailModal に表示する (act_as_spirit token は
        // host 由来の効力ステータスを含めた分身ビューになる)。
        <img
          className="card-image card-back-img"
          src="/images/ForGUI/card-back.jpg"
          alt="裏向きのカード"
          loading="lazy"
        />
      ) : definition?.image ? (
        <img
          className="card-image"
          src={`/${definition.image}`}
          alt={definition.name}
          loading="lazy"
        />
      ) : (
        <div className="card-placeholder">
          <span className="card-name-text">
            {definition?.name ?? card.definitionId}
          </span>
          <span className="card-category">
            {definition?.printedCategory ?? "?"}
          </span>
        </div>
      )}

      {!isSoulState && bp !== null && (
        <div className="card-bp-badge">
          <span className="bp-value">{bp}</span>
        </div>
      )}

      {!isSoulState && level !== null && (
        <div className="card-level-badge">Lv{level}</div>
      )}

      {card.zone === "set_aside" && (
        <div className="card-set-aside-badge" aria-label="手元">
          手元
        </div>
      )}
      {card.zone === "deck" && (
        <div className="card-set-aside-badge" aria-label="デッキ">
          デッキ
        </div>
      )}

      {!hideStats && (effectiveCoreCount > 0 || effectiveSoulCoreCount > 0) && (
        <div className="card-cores">
          {effectiveCoreCount > 0 && (
            <span className="core-count-group">
              <img
                className="core-icon"
                src="/images/ForGUI/core.png"
                alt="コア"
              />
              <span className="core-count-num">{effectiveCoreCount}</span>
            </span>
          )}
          {effectiveSoulCoreCount > 0 && (
            <span className="core-count-group">
              <img
                className="core-icon core-soul-icon"
                src="/images/ForGUI/soul-core.png"
                alt="ソウルコア"
              />
              <span className="core-count-num">{effectiveSoulCoreCount}</span>
            </span>
          )}
        </div>
      )}

      {/* シンボル表示モード: 効果適用後シンボルのテキストオーバーレイ (色別)。
          glossy なシンボル (god/guide/ultimate_symbol) は CSS 側でグラデーション色になるため
          inline color は付けず className で見た目を切り替える。
          また symbol-${name} クラスは常に付与し、symbol-black などの per-symbol CSS を有効化する。 */}
      {symbolOverlayChunks && symbolOverlayChunks.length > 0 && (
        <div className="card-symbol-overlay">
          <SymbolOverlayChunks chunks={symbolOverlayChunks} />
        </div>
      )}

      {/* 待機状態のテキストバッジは廃止。待機状態はカード画像の微透明 (.card-pending-leave)
          のみで表現する (Lv/BP/コア等のバッジは透明化せず維持)。 */}

      {/* B-1 転醒 / B-2 煌臨中 のテキストバッジは廃止。
          転醒 = カード画像が B 面に差し替わる + シアングロー (.card-rebirthed) で表現。
          煌臨 = 金グロー (.card-advent-active) + 下端の重なり peek (--advent-stack-shadow) で表現。
          枚数の確認は長押し/右クリック → 煌臨スタックモーダル (ZoneBrowseModal 流用)。 */}

      {/* ゾーン選択モード: 選択済みチェック */}
      {isSelected && (
        <div className="card-selected-check" aria-label="選択中">
          ✓
        </div>
      )}
    </div>
  );
}

function getLevelForCores(def: CardDefinition, totalCores: number): number {
  // カウント等の実状態は FieldArea から resolvedLevel が渡される。
  return calculateLevelFromResources(def.levelDefs, totalCores);
}

function getBpForCores(def: CardDefinition, totalCores: number): number {
  let bp = 0;
  for (const ld of def.levelDefs) {
    if (totalCores >= ld.requiredCores) {
      bp = ld.bp ?? 0;
    }
  }
  return bp;
}
