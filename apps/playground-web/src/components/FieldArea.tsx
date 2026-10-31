import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  SymbolBundle,
} from "@orica/rules-core";
import {
  calculateLevelFromResources,
  applyFieldPositions,
  getActAsSpiritMetadata,
  getCombinedUnitBp,
  getEffectiveLevel,
  getFaceUpDeckIds,
  getCombinedUnitSymbolBundles,
  getFieldSymbolSources,
  isCardTextCardState,
  shouldRecoverSpiritStateBraveExhaustion,
} from "@orica/rules-core";
import { CardView } from "./CardView";
import { SymbolOverlayChunks } from "./SymbolOverlayChunks";
import { EffectSourceContext } from "./EffectSourceScope";
import { getDeclaringCardIds } from "../utils/declaration-display";
import { useZoneSwipe } from "../hooks/useZoneSwipe";
import { QuartzAttributeOverlay } from "./QuartzAttributeOverlay";
import { fieldCardDisplayKind } from "../utils/field-card-display";
import { isBattleCapableCategory } from "../../../../packages/rules-core/src/battle/battle-shared";
import { symbolBundleChunks } from "../utils/symbol-format";
import {
  resolveSoulCoreDisplayCount,
  type SoulCoreDisplayOverride,
} from "../coreDisplayOverrides";
import {
  buildFieldSharedCardGroups,
  buildHostDualAdventSideByCard,
  getAttachedFieldBravesForHost,
  getFieldUnderCardVisual,
  getLocalFieldUnderCardVisual,
  type FieldSharedCardGroup,
  type FieldUnderCardVisual,
} from "../utils/field-under-card-visual";

interface FieldAreaProps {
  state: GameState;
  cards: CardInstance[];
  getDefinition: (id: string) => CardDefinition | undefined;
  playerId: string;
  isOpponent?: boolean | undefined;
  selectableIds?: Set<string> | undefined;
  onCardClick?: ((instanceId: string) => void) | undefined;
  onDetailRequest?: ((instanceId: string) => void) | undefined;
  coreMoveMode?: boolean | undefined;
  coreMoveFrom?: string | null | undefined;
  /** 手動コア移動の現在 phase で選択不可なカード instanceId 集合。 */
  coreMoveBlockedIds?: Set<string> | undefined;
  onCoreMoveClick?: ((locationId: string) => void) | undefined;
  /** タップ式コア操作モード (cost_payment / placement / core_shoot / count_decrease / core_split / core_source_allocation) */
  coreTapMode?:
    | "cost_payment"
    | "placement"
    | "core_shoot"
    | "count_decrease"
    | "core_split"
    | "core_source_allocation"
    | undefined;
  /** タップ式コア操作でタップ可能なカード ID セット */
  coreTapTargetIds?: Set<string> | undefined;
  /** タップ式コア操作でリザーブがタップ可能か */
  coreTapReserve?: boolean | undefined;
  /**
   * P3-47 F-5: タップ式コア操作で trash / life ゾーンを source としてタップ可能か。
   * `count_area` は optional repeat の追加カウント選択で同じタップ経路を使う。
   */
  coreTapZones?: ReadonlySet<"trash" | "life" | "count_area"> | undefined;
  /**
   * P3-47 F-5: 現在「アクティブソース」として選択されている locationId。
   * `multi_source_distribute` モード時に該当ゾーン / カードに `ac-selected` を付ける。
   */
  multiSourceActiveKey?: string | null | undefined;
  /** タップ式コア操作のタップハンドラ (locationId = instanceId or "reserve" / "trash" / "life") */
  onCoreTapClick?: ((locationId: string) => void) | undefined;
  /** 表示用コアオーバーライド: instanceId or "reserve" → 表示用通常コア数 */
  coreDisplayOverrides?: Record<string, number> | undefined;
  /** ソウルコア表示オーバーライド: instanceId or "reserve" → boolean 差分または表示数 */
  soulCoreDisplayOverrides?:
    | Record<string, SoulCoreDisplayOverride>
    | undefined;
  /**
   * 確定前 (コア選択モード中) の Lv / BP / シンボルバッジ算出に使う仮想 state。
   * `coreDisplayOverrides` が「コア数」を仮想表示するのと対になり、こちらは
   * コア総数に依存する実効 Lv / BP / シンボル (継続効果込み) を仮想コアで再計算するために使う。
   * `applyDraftCoreMoves(previewState)` + 掴み中コアの source 減算を反映した state を caller が渡す。
   * 未指定 (コア選択モード外) なら実 `state` で算出する。
   */
  coreCalcState?: GameState | undefined;
  /** トラッシュクリック時のコールバック */
  onTrashClick?: (() => void) | undefined;
  /** 除外ゾーンを閲覧する。 */
  onRemovedClick?: (() => void) | undefined;
  /** 手元ゾーンクリック時のコールバック */
  onSetAsideClick?: (() => void) | undefined;
  onFieldCardsClick?: (() => void) | undefined;
  /** バーストエリア（バースト + ミラージュ）クリック時のコールバック */
  onBurstClick?: (() => void) | undefined;
  /** デッキクリック時のコールバック */
  onDeckClick?: (() => void) | undefined;
  /** シンボル表示モード: フィールドカードをグレーアウト + シンボルラベルオーバーレイ */
  symbolOverlayMode?: boolean | undefined;
}

function fieldStackWrapperStyle(visual: FieldUnderCardVisual): CSSProperties {
  return {
    "--field-stack-overhang-x": `${visual.overhangX}px`,
    "--field-stack-overhang-y": `${visual.overhangY}px`,
  } as CSSProperties;
}

function combinedFieldSpacing(
  braveCount: number,
  visual: FieldUnderCardVisual | null
): CSSProperties {
  const extra = Math.max(0, braveCount - 1) * 10;
  return {
    "--combined-brave-extra-offset": `${extra}px`,
    "--composition-space-extra": `${Math.max(extra, visual?.overhangY ?? 0)}px`,
  } as CSSProperties;
}

function combinedFieldClasses({
  exhaustState,
  isOpponent,
  isDeclaring = false,
  isAttacker = false,
  isBlocker = false,
}: {
  exhaustState: CardInstance["exhaustState"];
  isOpponent: boolean | undefined;
  isDeclaring?: boolean;
  isAttacker?: boolean;
  isBlocker?: boolean;
}): string {
  return [
    isDeclaring
      ? "combined-rot-30"
      : exhaustState === "exhausted"
        ? "combined-rot-90"
        : exhaustState === "heavily_exhausted"
          ? "combined-rot-180"
          : "",
    isAttacker ? "combined-attacker" : isBlocker ? "combined-blocker" : "",
    isOpponent ||
    isDeclaring ||
    isAttacker ||
    isBlocker ||
    exhaustState !== "recovered"
      ? "combined-xf"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

type QuartzSoulLayout = {
  className: string;
  style: CSSProperties;
  inlineEnd: string;
};

type SoulStateLayout = {
  style: CSSProperties;
  inlineEnd: string;
};

function effectivePrintedLevel(
  def: CardDefinition | undefined,
  totalCores: number,
  countValue: number
): number | null {
  if (!def || def.levelDefs.length === 0) return null;
  return calculateLevelFromResources(def.levelDefs, totalCores, countValue);
}

function effectivePrintedBp(
  def: CardDefinition | undefined,
  totalCores: number
): number | null {
  if (!def || def.levelDefs.length === 0) return null;
  let bp = 0;
  for (const levelDef of def.levelDefs) {
    if (totalCores >= levelDef.requiredCores) bp = levelDef.bp ?? 0;
  }
  return bp;
}

function fieldBadgeOverlay(options: {
  key: string;
  slot: "left" | "right";
  isSoulState: boolean;
  exhaustState: CardInstance["exhaustState"];
  bp: number | null;
  level: number | null;
  normalCoreCount: number;
  soulCoreCount: number;
}) {
  return (
    <div
      key={options.key}
      className={`shared-field-anchor-badges shared-field-anchor-badges-slot-${options.slot} shared-field-anchor-badges-${options.exhaustState}`}
      aria-hidden="true"
    >
      {!options.isSoulState && options.bp !== null && (
        <div className="card-bp-badge">
          <span className="bp-value">{options.bp}</span>
        </div>
      )}
      {!options.isSoulState && options.level !== null && (
        <div className="card-level-badge">Lv{options.level}</div>
      )}
      {(options.normalCoreCount > 0 || options.soulCoreCount > 0) && (
        <div className="card-cores">
          {options.normalCoreCount > 0 && (
            <span className="core-count-group">
              <img className="core-icon" src="/images/ForGUI/core.png" alt="" />
              <span className="core-count-num">{options.normalCoreCount}</span>
            </span>
          )}
          {options.soulCoreCount > 0 && (
            <span className="core-count-group">
              <img
                className="core-icon core-soul-icon"
                src="/images/ForGUI/soul-core.png"
                alt=""
              />
              <span className="core-count-num">{options.soulCoreCount}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function cssCalcSum(parts: string[]): string {
  const nonZeroParts = parts.filter((part) => part !== "0px");
  if (nonZeroParts.length === 0) return "0px";
  if (nonZeroParts.length === 1) return nonZeroParts[0]!;
  return `calc(${nonZeroParts.join(" + ")})`;
}

function soulStateStride(footprint: string): string {
  return `calc(${footprint} + var(--soul-state-card-gap))`;
}

function soulStateLayoutStyle(
  offset: string,
  footprint: string
): CSSProperties {
  return {
    "--soul-offset": offset,
    "--soul-footprint": footprint,
  } as CSSProperties;
}

function soulStateFootprint(
  attachedBraveCount: number,
  visual: FieldUnderCardVisual | null
): string {
  const braveExtraOffset = Math.max(0, attachedBraveCount - 1) * 10;
  const compositionSpaceExtra = Math.max(
    braveExtraOffset,
    visual?.overhangY ?? 0
  );
  if (attachedBraveCount > 0) {
    return `max(calc(var(--battle-card-w) + var(--brave-overhang-y) + ${compositionSpaceExtra}px), calc(var(--battle-card-w) + var(--brave-overhang-x) + var(--combined-overhang-shift) * 2 + ${braveExtraOffset}px + 1px))`;
  }

  const inlineOverhang =
    visual?.peek.layout === "star-garment-triangle"
      ? Math.max(visual.overhangX, visual.overhangY)
      : (visual?.overhangX ?? 0);
  return inlineOverhang > 0
    ? `calc(var(--battle-card-w) + ${inlineOverhang * 2}px)`
    : "var(--battle-card-w)";
}

/** 横方向だけ追従する。scrollIntoView は overflow-y:hidden でも縦位置を動かす。 */
function scrollFieldCardIntoView(scroll: HTMLElement, target: Element): void {
  const viewport = scroll.getBoundingClientRect();
  const card = target.getBoundingClientRect();
  const before = card.left - viewport.left;
  const after = card.right - viewport.right;
  const left =
    before < 0 && after <= 0 ? before : after > 0 && before >= 0 ? after : 0;
  if (left !== 0) scroll.scrollBy({ left, behavior: "smooth" });
}

function quartzLayoutStyle(x: string, y: string, z: number): CSSProperties {
  return {
    "--quartz-layout-x": x,
    "--quartz-layout-y": y,
    "--quartz-layout-z": String(z),
  } as CSSProperties;
}

function quartzSlotX(slot: "left" | "center" | "right"): string {
  if (slot === "left") return "0px";
  if (slot === "center") return "var(--quartz-cluster-step-x)";
  return "calc(var(--quartz-cluster-step-x) + var(--quartz-cluster-step-x))";
}

function quartzSlotY(slot: "left" | "center" | "right", index: number): string {
  if (slot === "center") {
    return "calc(var(--quartz-cluster-top) + var(--quartz-cluster-step-y) + var(--quartz-cluster-step-y))";
  }
  return (
    [
      "var(--quartz-cluster-top)",
      "calc(var(--quartz-cluster-top) + var(--quartz-cluster-step-y))",
      "calc(var(--quartz-cluster-top) + var(--quartz-cluster-step-y) + var(--quartz-cluster-step-y))",
    ][Math.min(index, 2)] ??
    "calc(var(--quartz-cluster-top) + var(--quartz-cluster-step-y) + var(--quartz-cluster-step-y))"
  );
}

export function FieldArea({
  state,
  cards,
  getDefinition,
  playerId,
  isOpponent,
  selectableIds,
  onCardClick,
  onDetailRequest,
  coreMoveMode,
  coreMoveFrom,
  coreMoveBlockedIds,
  onCoreMoveClick,
  coreTapMode: _coreTapMode,
  coreTapTargetIds,
  coreTapReserve,
  coreTapZones,
  multiSourceActiveKey,
  onCoreTapClick,
  coreDisplayOverrides,
  soulCoreDisplayOverrides,
  coreCalcState,
  onTrashClick,
  onRemovedClick,
  onSetAsideClick,
  onFieldCardsClick,
  onBurstClick,
  onDeckClick,
  symbolOverlayMode,
}: FieldAreaProps) {
  const removedSwipe = useZoneSwipe(
    isOpponent ? "right" : "left",
    onRemovedClick
  );
  // コア選択モード中は仮想コア state (coreCalcState) を実効 Lv / BP / シンボルの
  // 算出基盤に使う。これにより「掴む → 置く」途中の確定前盤面でも Lv / BP バッジが
  // コア数バッジと連動して仮想変化する。モード外は実 state にフォールバック。
  const calcState = coreCalcState ?? state;
  const spirits = cards.filter(
    (c) =>
      c.controllerPlayerId === playerId &&
      fieldCardDisplayKind(state, c, getDefinition) === "spirit"
  );
  const nexuses = cards.filter(
    (c) =>
      c.controllerPlayerId === playerId &&
      fieldCardDisplayKind(state, c, getDefinition) === "nexus"
  );
  const fieldCards = cards.filter(
    (c) =>
      c.controllerPlayerId === playerId &&
      fieldCardDisplayKind(state, c, getDefinition) === "card"
  );
  const burst = cards.find(
    (c) => c.controllerPlayerId === playerId && c.zone === "burst"
  );
  const player = state.players.find((p) => p.id === playerId);
  const deckCount = cards.filter(
    (c) => c.controllerPlayerId === playerId && c.zone === "deck"
  ).length;
  const faceUpDeckTopId = getFaceUpDeckIds(state, playerId)[0];
  const faceUpDeckTop = cards.find((c) => c.instanceId === faceUpDeckTopId);
  const faceUpDeckTopDef = faceUpDeckTop
    ? getDefinition(faceUpDeckTop.definitionId)
    : undefined;
  const trashCards = cards.filter(
    (c) => c.controllerPlayerId === playerId && c.zone === "trash"
  );
  const trashCount = trashCards.length;
  const topTrashCard =
    trashCards.length > 0 ? trashCards[trashCards.length - 1] : null;
  const topTrashDef = topTrashCard
    ? getDefinition(topTrashCard.definitionId)
    : undefined;
  const setAsideCards = cards.filter(
    (c) => c.ownerPlayerId === playerId && c.zone === "set_aside"
  );
  const mirageCards = cards
    .filter((c) => c.controllerPlayerId === playerId && c.zone === "mirage")
    .sort(
      (a, b) =>
        state.mirageSetStates.findIndex(
          (entry) => entry.cardInstanceId === a.instanceId
        ) -
        state.mirageSetStates.findIndex(
          (entry) => entry.cardInstanceId === b.instanceId
        )
    );
  const hasMirage = mirageCards.length > 0;
  const countAreaCards = cards.filter(
    (c) => c.controllerPlayerId === playerId && c.zone === "count_area"
  );
  // カウント表示はエンジン正源 countValue（カウントエリアのコア数。転醒/効果の
  // カウント+1 はここに入る）+ カウントエリアに置かれたカード枚数。
  // 旧表示はカード枚数のみで、転醒のカウント+1 が GUI に反映されなかった。
  const countDisplayValue =
    coreDisplayOverrides?.["count_area"] ??
    (player?.countValue ?? 0) + countAreaCards.length;

  // P3-101 S4: ソウルコアはロケーション別カウント (実カウント) を表示する
  // (旧: soulCoreLocation の boolean 存在判定のみ、2個目以降が不可視化するバグ。
  // 例: BSLH01-X05 の generateSoulCoreOutsideGame でリザーブに2個目が生成される)。
  const lifeSoulDisplayCount = resolveSoulCoreDisplayCount(
    player?.lifeSoulCoreCount ?? 0,
    soulCoreDisplayOverrides?.["life"],
    player?.soulCoreLocation?.kind === "life"
  );
  const reserveSoulDisplayCount = resolveSoulCoreDisplayCount(
    player?.reserveSoulCoreCount ?? 0,
    soulCoreDisplayOverrides?.["reserve"],
    player?.soulCoreLocation?.kind === "reserve"
  );
  const trashSoulDisplayCount = resolveSoulCoreDisplayCount(
    player?.trashSoulCoreCount ?? 0,
    soulCoreDisplayOverrides?.["trash"],
    player?.soulCoreLocation?.kind === "trash"
  );

  // 手札等からの発動では、同じ所有者の別のセットカードを表向きにしない。
  const revealedBurst = state.revealedBurstStates?.find(
    (r) => r.playerId === playerId && r.cardInstanceId === burst?.instanceId
  );
  const burstDef = burst ? getDefinition(burst.definitionId) : undefined;

  // ライフダメージ検知
  const prevLifeRef = useRef(player?.lifeNormalCoreCount ?? 0);
  const [lifeDamageFlash, setLifeDamageFlash] = useState(false);
  useEffect(() => {
    const currentLife = player?.lifeNormalCoreCount ?? 0;
    if (prevLifeRef.current > currentLife) {
      setLifeDamageFlash(true); // eslint-disable-line react-hooks/set-state-in-effect -- ライフダメージフラッシュ
      const timer = setTimeout(() => setLifeDamageFlash(false), 600);
      return () => clearTimeout(timer);
    }
    prevLifeRef.current = currentLife;
  }, [player?.lifeNormalCoreCount]);

  // B-3: 魂状態・契約カードの判定
  const soulStateIds = useMemo(
    () => new Set(player?.soulStateInstanceIds ?? []),
    [player?.soulStateInstanceIds]
  );

  // P2-08 10-1: アタッカー／ブロッカーの instanceId セット（戦闘時の強調クラス用）
  // P2-05: 全 participant を対象化 (旧実装は primary のみで、同時アタックの
  // 2体目以降に枠が付かなかった)。blockAssignments の並び順でペア色 index を振り、
  // アタッカーとそのブロッカーが同じ色を共有する (1ペア目=赤、2ペア目=青、…)。
  const { attackerIds, blockerIds, battlePairColorIndexByInstanceId } =
    useMemo(() => {
      const attackerSet = new Set<string>();
      const blockerSet = new Set<string>();
      const pairColorMap = new Map<string, number>();
      const attack = state.activeAttack;
      if (attack && state.battleEntities) {
        (attack.blockAssignments ?? []).forEach((assignment, pairIndex) => {
          const participantEntity = state.battleEntities.find(
            (e) => e.entityId === assignment.participantEntityId
          );
          if (participantEntity) {
            for (const id of participantEntity.memberInstanceIds) {
              attackerSet.add(id);
              pairColorMap.set(id, pairIndex);
            }
          }
          // P2-05 Phase 5: 1 participant に複数ブロッカー (blockedByEntityIds) が付く場合、
          // 同じ攻撃体のペアとして同一 pairIndex (同色) を共有する。
          for (const blockerEntityId of assignment.blockedByEntityIds) {
            const blockerEntity = state.battleEntities.find(
              (e) => e.entityId === blockerEntityId
            );
            if (blockerEntity) {
              for (const id of blockerEntity.memberInstanceIds) {
                blockerSet.add(id);
                pairColorMap.set(id, pairIndex);
              }
            }
          }
        });
        // blockAssignments 未生成の局面 (指定アタック保留等) は primary を fallback
        if ((attack.blockAssignments ?? []).length === 0) {
          const attackerEntity = state.battleEntities.find(
            (e) => e.entityId === attack.primaryEntityId
          );
          if (attackerEntity) {
            for (const id of attackerEntity.memberInstanceIds) {
              attackerSet.add(id);
            }
          }
        }
      }
      return {
        attackerIds: attackerSet,
        blockerIds: blockerSet,
        battlePairColorIndexByInstanceId: pairColorMap,
      };
    }, [state.activeAttack, state.battleEntities]);

  // 各フィールドカードに対する実質BP・実効シンボルを算出
  // P3-47 F-2 Step 7: act_as_spirit CE が乗ったカード (token) は元の definition の
  // levelDefs が空でも host 由来の BP を返したいので gate を緩める。
  // 相手視点では sanitizer により token の definitionId が _hidden_card_ に書き換わり
  // getDefinition が undefined を返すが、act_as_spirit の resolver は host 経由で
  // BP/Lv/シンボルを解決できるので、isToken のときは def 無しでも cache に登録する。
  const effectiveBpCache = useMemo(() => {
    const map = new Map<string, number>();
    for (const card of [...spirits, ...nexuses]) {
      if (isCardTextCardState(card, calcState)) continue;
      const def = getDefinition(card.definitionId);
      const isToken =
        getActAsSpiritMetadata(calcState, card.instanceId) !== undefined;
      if (
        isToken ||
        (def && def.levelDefs.length > 0 && isBattleCapableCategory(def, card))
      ) {
        // 合体スピリットはブレイヴの BP＋ を含めた実効 BP を表示する。
        map.set(
          card.instanceId,
          getCombinedUnitBp(calcState, card, def, getDefinition)
        );
      }
    }
    return map;
  }, [calcState, spirits, nexuses, getDefinition]);

  // P3-47 F-2 Step 7: token は本体追従の Lv を表示する。
  // act_as_spirit CE 経由で「currentLv」aspect が含まれていれば host の現在 Lv が返る。
  // P3-83: 消滅 (コア欠損) 待機スピリットは現在コア由来 (Lv0) ではなく消滅時 Lv
  // (pendingLeaveLvSnapshot) を表示する。getEffectiveLevel が snapshot を返すので
  // resolvedLevel として渡し、CardView の printedLevel (= 現在コア) より優先させる。
  const effectiveLevelCache = useMemo(() => {
    const map = new Map<string, number>();
    for (const card of [...spirits, ...nexuses]) {
      if (isCardTextCardState(card, calcState)) continue;
      const def = getDefinition(card.definitionId);
      const isToken =
        getActAsSpiritMetadata(calcState, card.instanceId) !== undefined;
      const isVanishWaiting =
        card.pendingLeaveKind === "vanish" &&
        card.pendingLeaveLvSnapshot !== null;
      if (isToken || isVanishWaiting || (def && def.levelDefs.length > 0)) {
        map.set(
          card.instanceId,
          getEffectiveLevel(calcState, card, def, getDefinition)
        );
      }
    }
    return map;
  }, [calcState, spirits, nexuses, getDefinition]);

  const effectiveSymbolBundlesCache = useMemo(() => {
    const map = new Map<string, SymbolBundle[]>();
    for (const card of [...spirits, ...nexuses]) {
      const def = getDefinition(card.definitionId);
      const isToken =
        getActAsSpiritMetadata(calcState, card.instanceId) !== undefined;
      if (def || isToken) {
        map.set(
          card.instanceId,
          getCombinedUnitSymbolBundles(calcState, card, def, getDefinition)
        );
      }
    }
    return map;
  }, [calcState, spirits, nexuses, getDefinition]);

  const extendedSymbolSources = useMemo(() => {
    if (!symbolOverlayMode) return [];
    const fieldIds = new Set(
      calcState.cardInstances
        .filter((card) => card.zone === "field")
        .map((card) => card.instanceId)
    );
    return getFieldSymbolSources({
      state: calcState,
      actingPlayerId: playerId,
      getCardDefinitionById: getDefinition,
    }).filter((source) => !fieldIds.has(source.sourceInstanceId));
  }, [calcState, playerId, getDefinition, symbolOverlayMode]);

  // P3-56: scroll 容器内の自動スクロール用 ref
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevFieldIdsRef = useRef<Set<string>>(new Set());

  // 公開情報の対象アンカーは field-center-scroll の起点から安定している必要がある。
  // 魂状態は印刷カテゴリ由来の行を維持したままライフ側端へ固定し、同じ優先度内では
  // P3-56 の合体優先・元のカード順を保つ（Array#sort は stable）。
  const filteredSpirits = useMemo(
    () =>
      spirits.filter(
        (c) =>
          c.attachedToInstanceId === null && c.imaginRightCombinedWith === null
      ),
    [spirits]
  );
  const sharedFieldGroups = useMemo(
    () => buildFieldSharedCardGroups(cards, getDefinition),
    [cards, getDefinition]
  );
  const sharedGroupByAnchorId = useMemo(() => {
    const map = new Map<string, FieldSharedCardGroup>();
    for (const group of sharedFieldGroups) {
      for (const anchorId of group.anchorCardIds) map.set(anchorId, group);
    }
    return map;
  }, [sharedFieldGroups]);
  const sortedSpirits = useMemo(() => {
    const prioritized = [...filteredSpirits].sort((a, b) => {
      const aIsSoulState = soulStateIds.has(a.instanceId);
      const bIsSoulState = soulStateIds.has(b.instanceId);
      if (aIsSoulState !== bIsSoulState) return aIsSoulState ? -1 : 1;
      const aIsCombined =
        getAttachedFieldBravesForHost(cards, a).length > 0 ||
        sharedGroupByAnchorId.has(a.instanceId);
      const bIsCombined =
        getAttachedFieldBravesForHost(cards, b).length > 0 ||
        sharedGroupByAnchorId.has(b.instanceId);
      if (aIsCombined === bIsCombined) return 0;
      return aIsCombined ? -1 : 1;
    });
    const byId = new Map(prioritized.map((card) => [card.instanceId, card]));
    const emitted = new Set<string>();
    const grouped: CardInstance[] = [];
    for (const card of prioritized) {
      if (emitted.has(card.instanceId)) continue;
      const group = sharedGroupByAnchorId.get(card.instanceId);
      if (!group) {
        grouped.push(card);
        emitted.add(card.instanceId);
        continue;
      }
      for (const anchorId of group.anchorCardIds) {
        const anchor = byId.get(anchorId);
        if (!anchor || emitted.has(anchorId)) continue;
        grouped.push(anchor);
        emitted.add(anchorId);
      }
    }
    return applyFieldPositions(grouped);
  }, [cards, filteredSpirits, sharedGroupByAnchorId, soulStateIds]);
  const sortedNexuses = useMemo(
    () =>
      [...nexuses].sort((a, b) => {
        const aIsSoulState = soulStateIds.has(a.instanceId);
        const bIsSoulState = soulStateIds.has(b.instanceId);
        if (aIsSoulState === bIsSoulState) return 0;
        return aIsSoulState ? -1 : 1;
      }),
    [nexuses, soulStateIds]
  );
  const hostDualAdventSideByCard = useMemo(
    () => buildHostDualAdventSideByCard(cards, getDefinition),
    [cards, getDefinition]
  );
  const quartzSoulLayoutById = useMemo(() => {
    const layoutById = new Map<string, QuartzSoulLayout>();
    const cardById = new Map(cards.map((card) => [card.instanceId, card]));
    const hostIds = Array.from(
      new Set(state.quartzSetStates.map((setState) => setState.hostInstanceId))
    );

    for (const hostId of hostIds) {
      const host = cardById.get(hostId);
      if (
        !host ||
        host.controllerPlayerId !== playerId ||
        host.zone !== "field" ||
        !soulStateIds.has(host.instanceId)
      ) {
        continue;
      }

      const setStates = state.quartzSetStates.filter((setState) => {
        if (setState.hostInstanceId !== hostId) return false;
        const quartz = cardById.get(setState.quartzInstanceId);
        return (
          quartz !== undefined &&
          quartz.controllerPlayerId === playerId &&
          quartz.zone === "field" &&
          soulStateIds.has(quartz.instanceId)
        );
      });
      if (setStates.length === 0) continue;

      layoutById.set(hostId, {
        className: "quartz-set-field-card quartz-set-host",
        inlineEnd:
          "calc(var(--quartz-cluster-step-x) + var(--battle-grid-col))",
        style: quartzLayoutStyle(
          "var(--quartz-cluster-step-x)",
          "calc(var(--quartz-cluster-top) + var(--quartz-cluster-step-y) - 8px)",
          9
        ),
      });

      const nextIndexBySlot = { left: 0, center: 0, right: 0 };
      for (const setState of setStates) {
        const slot = setState.slot;
        const slotIndex = nextIndexBySlot[slot];
        nextIndexBySlot[slot] += 1;
        layoutById.set(setState.quartzInstanceId, {
          className: `quartz-set-field-card quartz-set-card quartz-set-slot-${slot}`,
          inlineEnd: `calc(${quartzSlotX(slot)} + var(--battle-grid-col))`,
          style: quartzLayoutStyle(
            quartzSlotX(slot),
            quartzSlotY(slot, slotIndex),
            slot === "center" ? 5 : 4
          ),
        });
      }
    }

    return layoutById;
  }, [cards, playerId, soulStateIds, state.quartzSetStates]);
  const soulSpiritLayoutById = useMemo(() => {
    const layoutById = new Map<string, SoulStateLayout>();
    const strides: string[] = [];

    for (const card of sortedSpirits) {
      if (!soulStateIds.has(card.instanceId)) continue;
      if (quartzSoulLayoutById.has(card.instanceId)) continue;

      const sharedGroup = sharedGroupByAnchorId.get(card.instanceId);
      const attachedBraveCount = getAttachedFieldBravesForHost(cards, card, {
        excludeInstanceIds:
          sharedGroup?.kind === "imagin-brave"
            ? new Set([sharedGroup.sharedCardId])
            : undefined,
      }).length;
      const visual = sharedGroup
        ? getLocalFieldUnderCardVisual(card, sharedGroup.sharedCardId)
        : getFieldUnderCardVisual(
            card,
            hostDualAdventSideByCard.get(card.instanceId)
          );
      const footprint = soulStateFootprint(attachedBraveCount, visual);
      layoutById.set(card.instanceId, {
        style: soulStateLayoutStyle(cssCalcSum(strides), footprint),
        inlineEnd: cssCalcSum([...strides, footprint]),
      });
      strides.push(soulStateStride(footprint));
    }

    return layoutById;
  }, [
    cards,
    hostDualAdventSideByCard,
    quartzSoulLayoutById,
    sharedGroupByAnchorId,
    sortedSpirits,
    soulStateIds,
  ]);
  const soulNexusLayoutById = useMemo(() => {
    const layoutById = new Map<string, SoulStateLayout>();
    const strides: string[] = [];

    for (const card of sortedNexuses) {
      if (!soulStateIds.has(card.instanceId)) continue;

      const attachedBraveCount = getAttachedFieldBravesForHost(
        cards,
        card
      ).length;
      const visual = getFieldUnderCardVisual(
        card,
        hostDualAdventSideByCard.get(card.instanceId)
      );
      const footprint = soulStateFootprint(attachedBraveCount, visual);
      layoutById.set(card.instanceId, {
        style: soulStateLayoutStyle(cssCalcSum(strides), footprint),
        inlineEnd: cssCalcSum([...strides, footprint]),
      });
      strides.push(soulStateStride(footprint));
    }

    return layoutById;
  }, [cards, hostDualAdventSideByCard, sortedNexuses, soulStateIds]);
  const fallbackSoulLayoutStyle = useMemo(
    () => soulStateLayoutStyle("0px", "var(--battle-card-w)"),
    []
  );
  // absolute 配置の魂状態/クォーツも通常カードの占有列へ算入する。
  // 最大の右端までを両行に予約し、疲労した合体カードが固定列へ重ならないようにする。
  const soulLaneWidth = useMemo(() => {
    const ends = [
      ...soulSpiritLayoutById.values(),
      ...soulNexusLayoutById.values(),
      ...quartzSoulLayoutById.values(),
    ].map((layout) => layout.inlineEnd);
    return ends.length > 0
      ? `calc(var(--soul-state-edge-inset) + max(${ends.join(", ")}))`
      : null;
  }, [soulSpiritLayoutById, soulNexusLayoutById, quartzSoulLayoutById]);
  const spiritGridColumnById = useMemo(
    () =>
      new Map(
        sortedSpirits
          .filter((card) => !soulStateIds.has(card.instanceId))
          .map((card, index) => [
            card.instanceId,
            index + (soulLaneWidth ? 2 : 1),
          ])
      ),
    [sortedSpirits, soulStateIds, soulLaneWidth]
  );
  const displayedSharedFieldGroups = useMemo(
    () =>
      sharedFieldGroups.flatMap((group) => {
        const columns = group.anchorCardIds.map((id) =>
          spiritGridColumnById.get(id)
        );
        if (columns.some((column) => column === undefined)) return [];
        return [
          {
            group,
            startColumn: Math.min(...(columns as number[])),
            endColumn: Math.max(...(columns as number[])),
          },
        ];
      }),
    [sharedFieldGroups, spiritGridColumnById]
  );

  // P3-56: 新規召喚 / 出現カードへの自動 scroll
  useEffect(() => {
    const currentIds = new Set(
      [...sortedSpirits, ...sortedNexuses].map((c) => c.instanceId)
    );
    const newIds = [...currentIds].filter(
      (id) => !prevFieldIdsRef.current.has(id)
    );
    if (newIds.length > 0 && scrollRef.current) {
      const lastNewId = newIds[newIds.length - 1];
      const target = scrollRef.current.querySelector(
        `[data-instance-id="${lastNewId}"], [data-testid="card-${lastNewId}"]`
      );
      if (target) {
        scrollFieldCardIntoView(scrollRef.current, target);
      }
    }
    prevFieldIdsRef.current = currentIds;
  }, [sortedSpirits, sortedNexuses]);

  const declaringIds = useMemo(() => getDeclaringCardIds(state), [state]);
  const declaringSourceId = declaringIds.values().next().value ?? null;
  const effectSourceId = useContext(EffectSourceContext);
  useEffect(() => {
    if (!effectSourceId || !scrollRef.current) return;
    const target = scrollRef.current.querySelector(
      `[data-testid="card-${CSS.escape(effectSourceId)}"]`
    );
    if (target) scrollFieldCardIntoView(scrollRef.current, target);
  }, [effectSourceId]);
  const attackingPrimaryId =
    state.window === "declare_attack" && state.activeAttack
      ? state.activeAttack.primaryEntityId
      : null;
  useEffect(() => {
    let targetId: string | null = null;
    if (declaringSourceId) {
      targetId = declaringSourceId;
    } else if (attackingPrimaryId) {
      const entity = state.battleEntities?.find(
        (e) => e.entityId === attackingPrimaryId
      );
      targetId = entity?.memberInstanceIds[0] ?? null;
    }
    if (targetId && scrollRef.current) {
      const target = scrollRef.current.querySelector(
        `[data-instance-id="${targetId}"], [data-testid="card-${targetId}"]`
      );
      if (target) {
        scrollFieldCardIntoView(scrollRef.current, target);
      }
    }
  }, [declaringSourceId, attackingPrimaryId, state.battleEntities]);

  return (
    <div
      className={`field-area ${isOpponent ? "field-opponent" : "field-self"}`}
      data-testid={isOpponent ? "field-opponent" : "field-self"}
    >
      {/* 左サイド: バースト + ライフ + リザーブ */}
      <div className="field-left-side">
        <div
          className={`burst-slot ${hasMirage ? "burst-has-mirage" : ""} ${revealedBurst ? "burst-revealed" : ""}${onBurstClick ? " burst-clickable" : ""}`}
          title={onBurstClick ? "バーストエリア（クリックで閲覧）" : "バースト"}
          onClick={onBurstClick}
        >
          <div
            className={`burst-card-layer ${burst ? "burst-set" : "burst-empty"}`}
          >
            {burst ? (
              <div className="burst-flip-container">
                <div className="burst-flip-inner">
                  <div className="burst-flip-front">
                    <img
                      className="card-back-img"
                      src="/images/ForGUI/card-back.jpg"
                      alt="バースト"
                    />
                  </div>
                  <div className="burst-flip-back">
                    {burstDef?.image ? (
                      <img
                        className="card-back-img"
                        src={`/${burstDef.image}`}
                        alt={burstDef.name}
                      />
                    ) : (
                      <span className="burst-label">バースト</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <span className="burst-label">バースト</span>
            )}
          </div>
          {/* ミラージュ: バーストエリア内で表向きに重ねてセット */}
          {mirageCards.map((card, index) => {
            const mirageDef = getDefinition(card.definitionId);
            return (
              <div
                key={card.instanceId}
                className="mirage-slot"
                data-mirage-instance-id={card.instanceId}
                title={`セット${index + 1}: ${mirageDef?.name ?? "ミラージュ"}`}
                style={
                  {
                    "--mirage-layer-index": index,
                  } as CSSProperties
                }
              >
                {mirageDef?.image ? (
                  <img
                    className="mirage-card-img"
                    src={`/${mirageDef.image}`}
                    alt={mirageDef.name}
                  />
                ) : (
                  <span className="mirage-label-fallback">
                    {mirageDef?.name ?? "ミラージュ"}
                  </span>
                )}
                <span className="mirage-badge">
                  {mirageCards.length > 1 ? `セット${index + 1}` : "ミラージュ"}
                </span>
              </div>
            );
          })}
        </div>
        <div
          className={`life-display${lifeDamageFlash ? " life-damage-flash" : ""} ${coreTapTargetIds?.has(`life:${playerId}`) || (coreTapZones?.has("life") && !isOpponent) ? "ac-selectable" : ""} ${multiSourceActiveKey === "life" ? "ac-selected" : ""}`}
          title={
            coreTapTargetIds?.has(`life:${playerId}`) ||
            (coreTapZones?.has("life") && !isOpponent)
              ? "ライフ (ソース選択)"
              : "ライフ"
          }
          data-testid={`life-${playerId}`}
          data-replay-zone="life"
          onClick={
            coreTapTargetIds?.has(`life:${playerId}`) ||
            (coreTapZones?.has("life") && !isOpponent)
              ? () =>
                  onCoreTapClick?.(
                    coreTapTargetIds?.has(`life:${playerId}`)
                      ? `life:${playerId}`
                      : "life"
                  )
              : undefined
          }
        >
          <span className="zone-label">ライフ</span>
          <div
            className={`life-cores${
              (coreDisplayOverrides?.["life"] ??
                player?.lifeNormalCoreCount ??
                0) +
                lifeSoulDisplayCount >
              6
                ? " life-many"
                : ""
            }`}
          >
            {player &&
              Array.from(
                {
                  length:
                    coreDisplayOverrides?.["life"] ??
                    player.lifeNormalCoreCount,
                },
                (_, i) => (
                  <img
                    key={i}
                    className="life-core-img"
                    src="/images/ForGUI/core.png"
                    alt="ライフ"
                  />
                )
              )}
            {Array.from({ length: lifeSoulDisplayCount }, (_, i) => (
              <img
                key={`soul-${i}`}
                className="life-core-img"
                src="/images/ForGUI/soul-core.png"
                alt="ソウルコア"
              />
            ))}
          </div>
        </div>
        {/* フィールド/リザーブ横断コアシュート (BSTH001-X01): 相手リザーブも
            coreTapTargetIds に sentinel `reserve:<playerId>` が含まれるときタップ可能。
            自分リザーブの通常タップ (coreTapReserve) とは別経路。
            selectableIds に sentinel "reserve" が含まれる場合は onCardClick 経由で
            自分のリザーブをタップ選択できる。 */}
        <div
          className={`reserve-display ${coreMoveMode ? "ac-selectable" : ""} ${coreMoveFrom === "reserve" ? "ac-selected" : ""} ${coreTapReserve || (coreTapTargetIds?.has(`reserve:${playerId}`) ?? false) || (!isOpponent && (selectableIds?.has("reserve") ?? false)) ? "ac-selectable" : ""} ${multiSourceActiveKey === "reserve" ? "ac-selected" : ""}`}
          title="リザーブ"
          onClick={
            coreTapTargetIds?.has(`reserve:${playerId}`)
              ? () => onCoreTapClick?.(`reserve:${playerId}`)
              : coreTapReserve && !isOpponent
                ? () => onCoreTapClick?.("reserve")
                : coreMoveMode && !isOpponent
                  ? () => onCoreMoveClick?.("reserve")
                  : !isOpponent && selectableIds?.has("reserve") && onCardClick
                    ? () => onCardClick("reserve")
                    : undefined
          }
        >
          <span className="zone-label">リザーブ</span>
          <div
            className="reserve-cores"
            data-testid={`reserve-count-${playerId}`}
            data-replay-zone="reserve"
          >
            <img
              className="reserve-core-img"
              src="/images/ForGUI/core.png"
              alt="コア"
            />
            <span className="reserve-count">
              {coreDisplayOverrides?.["reserve"] ??
                player?.reserveNormalCoreCount ??
                0}
            </span>
            {reserveSoulDisplayCount > 0 && (
              <>
                <img
                  className="reserve-core-img"
                  src="/images/ForGUI/soul-core.png"
                  alt="ソウルコア"
                />
                <span className="reserve-count">{reserveSoulDisplayCount}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 中央: フィールド */}
      <div
        className={`field-center${setAsideCards.length > 0 ? " has-set-aside" : ""}${fieldCards.length > 0 ? " has-field-card-pile" : ""}`}
      >
        {/* 手元ゾーン: ネクサス行のトラッシュ側端に absolute 配置 (自分=下端 / 相手=上端)
         * scroll 容器の外に置くことで scroll 位置に追従せず常時固定。 */}
        {setAsideCards.length > 0 && (
          <div
            className={`set-aside-zone ${isOpponent ? "set-aside-opponent" : "set-aside-self"}`}
            title={`手元 (${setAsideCards.length}枚)`}
            data-testid={`set-aside-${playerId}`}
            role="button"
            tabIndex={0}
            aria-label={`手元 ${setAsideCards.length}枚`}
            style={
              {
                "--card-count": setAsideCards.length,
              } as React.CSSProperties
            }
            onClick={(e) => {
              e.stopPropagation();
              onSetAsideClick?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onSetAsideClick?.();
              }
            }}
          >
            {setAsideCards.map((card, i) => (
              <div
                key={card.instanceId}
                className="set-aside-card-slot"
                style={{ "--slot-index": i } as React.CSSProperties}
              >
                <CardView
                  card={card}
                  definition={getDefinition(card.definitionId)}
                  size="small"
                />
              </div>
            ))}
          </div>
        )}

        {fieldCards.length > 0 && (
          <div
            className={`set-aside-zone field-card-pile ${isOpponent ? "set-aside-opponent" : "set-aside-self"}${fieldCards.some((c) => selectableIds?.has(c.instanceId) || coreTapTargetIds?.has(c.instanceId)) ? " ac-selectable" : ""}`}
            data-testid={`field-cards-${playerId}`}
            role="button"
            tabIndex={0}
            aria-label={`フィールドのカード ${fieldCards.length}枚`}
            title={`フィールドのカード (${fieldCards.length}枚)`}
            style={{ "--card-count": fieldCards.length } as CSSProperties}
            onClick={onFieldCardsClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFieldCardsClick?.();
              }
            }}
          >
            {fieldCards.map((card, i) => (
              <div
                key={card.instanceId}
                className="set-aside-card-slot"
                style={{ "--slot-index": i } as CSSProperties}
              >
                <CardView
                  card={card}
                  definition={getDefinition(card.definitionId)}
                  size="small"
                  hideStats
                />
              </div>
            ))}
          </div>
        )}

        {/* P3-56: scroll 容器。 spirit + nexus 2 行を一体スクロール (自分↔相手は独立)。 */}
        <div
          className={`field-center-scroll${extendedSymbolSources.length > 0 && spirits.length === 0 && nexuses.length === 0 ? " field-only-extended-symbols" : ""}`}
          ref={scrollRef}
        >
          {soulLaneWidth && (
            <div
              className="soul-state-phantom"
              aria-hidden="true"
              style={{ width: soulLaneWidth }}
            />
          )}
          <div
            className="field-spirit-row"
            data-testid={`spirit-row-${playerId}`}
          >
            {sortedSpirits.map((card) => {
              const attackerEntityIds = state.activeAttack
                ? (state.battleEntities?.find(
                    (e) => e.entityId === state.activeAttack!.primaryEntityId
                  )?.memberInstanceIds ?? [])
                : [];
              const isDeclaring = declaringIds.has(card.instanceId);
              const isCoreSource =
                coreMoveFrom === card.instanceId ||
                multiSourceActiveKey === `field:${card.instanceId}`;
              const isCoreTapTarget =
                coreTapTargetIds?.has(card.instanceId) ?? false;
              const sharedGroup = sharedGroupByAnchorId.get(card.instanceId);
              const attachedBraves = getAttachedFieldBravesForHost(
                cards,
                card,
                {
                  excludeInstanceIds:
                    sharedGroup?.kind === "imagin-brave"
                      ? new Set([sharedGroup.sharedCardId])
                      : undefined,
                }
              );
              const isSoulState = soulStateIds.has(card.instanceId);
              const cardDefinition = getDefinition(card.definitionId);
              const stackVisual = sharedGroup
                ? getLocalFieldUnderCardVisual(card, sharedGroup.sharedCardId)
                : getFieldUnderCardVisual(
                    card,
                    hostDualAdventSideByCard.get(card.instanceId)
                  );
              const displayStackVisual = stackVisual;
              const stackClass = displayStackVisual
                ? ` has-field-stack field-stack-${displayStackVisual.peek.layout}`
                : "";
              const stackStyle = displayStackVisual
                ? fieldStackWrapperStyle(displayStackVisual)
                : undefined;
              const displayCard =
                card.attachedToInstanceId === null &&
                shouldRecoverSpiritStateBraveExhaustion(card, cardDefinition) &&
                card.exhaustState !== "recovered"
                  ? { ...card, exhaustState: "recovered" as const }
                  : card;
              const displayExhaustState = isSoulState
                ? "recovered"
                : displayCard.exhaustState;
              const quartzLayout = quartzSoulLayoutById.get(card.instanceId);
              const soulLayout = soulSpiritLayoutById.get(card.instanceId);
              const soulPositionStyle =
                quartzLayout?.style ??
                soulLayout?.style ??
                fallbackSoulLayoutStyle;
              const baseWrapperStyle = isSoulState
                ? ({ ...stackStyle, ...soulPositionStyle } as CSSProperties)
                : stackStyle;
              const wrapperStyle = {
                ...baseWrapperStyle,
                ...combinedFieldSpacing(
                  attachedBraves.length,
                  displayStackVisual
                ),
                ...(isSoulState
                  ? {}
                  : { gridColumn: spiritGridColumnById.get(card.instanceId) }),
              } as CSSProperties;
              // 合体スピリット全体の selectable 判定
              const wrapperSelectable =
                !coreMoveMode &&
                !isCoreTapTarget &&
                attachedBraves.length > 0 &&
                (selectableIds?.has(card.instanceId) ||
                  attachedBraves.some((brave) =>
                    selectableIds?.has(brave.instanceId)
                  ));
              const displayNormalCoreCount =
                coreDisplayOverrides?.[card.instanceId];
              const displaySoulCoreCount = resolveSoulCoreDisplayCount(
                card.soulCoreCount,
                soulCoreDisplayOverrides?.[card.instanceId],
                player?.soulCoreLocation?.kind === "card" &&
                  player.soulCoreLocation.instanceId === card.instanceId
              );
              // シンボル表示モード: host に host+brave 合算 chunks / brave 子はラベル無しグレー
              // 魂状態のシンボルは軽減に使えないため、合体分も含めて表示しない。
              const overlayChunks =
                symbolOverlayMode && !isSoulState
                  ? symbolBundleChunks(
                      effectiveSymbolBundlesCache.get(card.instanceId) ?? []
                    )
                  : undefined;
              // 合体スピリットは host+brave を 1 つの剛体として wrapper ごと変形させる
              // (個別 card-view の transform は CSS 側で抑止)。host のバトル状態を wrapper に
              // 反映: 疲労/重疲労/宣言の回転、アタッカー/ブロッカーの前進(lunge)。
              const hostDeclaring = isDeclaring;
              const hostAttackerHi = attackerIds.has(card.instanceId);
              const hostBlockerHi = blockerIds.has(card.instanceId);
              const combinedClasses =
                attachedBraves.length > 0
                  ? combinedFieldClasses({
                      exhaustState: displayExhaustState,
                      isOpponent,
                      isDeclaring: hostDeclaring,
                      isAttacker: hostAttackerHi,
                      isBlocker: hostBlockerHi,
                    })
                  : "";
              return (
                <div
                  key={card.instanceId}
                  data-instance-id={card.instanceId}
                  className={`combined-spirit-wrapper field-card-stack-wrapper${attachedBraves.length > 0 ? " has-brave" : ""}${stackClass}${sharedGroup ? ` shared-field-anchor shared-field-anchor-${sharedGroup.kind}` : ""}${isSoulState ? " soul-state-field-card soul-state-spirit" : ""}${quartzLayout ? " " + quartzLayout.className : ""}${wrapperSelectable ? " selectable" : ""}${combinedClasses ? " " + combinedClasses : ""}`}
                  style={wrapperStyle}
                  onClick={
                    attachedBraves.length > 0 && wrapperSelectable
                      ? (e) => {
                          e.stopPropagation();
                          onCardClick?.(card.instanceId);
                        }
                      : undefined
                  }
                >
                  {attachedBraves.map((brave, index) => (
                    <CardView
                      key={brave.instanceId}
                      card={brave}
                      definition={getDefinition(brave.definitionId)}
                      size="medium"
                      hideStats
                      layoutClassName="combined-brave-member"
                      layoutStyle={
                        { "--combined-brave-index": index } as CSSProperties
                      }
                      symbolOverlayActive={symbolOverlayMode}
                      onDetailRequest={() =>
                        onDetailRequest?.(brave.instanceId)
                      }
                    />
                  ))}
                  <CardView
                    card={displayCard}
                    definition={cardDefinition}
                    layoutClassName="combined-host-member"
                    braveBpBonus={
                      attachedBraves.length > 0
                        ? attachedBraves.reduce((total, brave) => {
                            // ブレイヴの BP＋ は印字された `(0)合体 +N` (combinedBoost)。
                            // スピリット状態 Lv1 BP (levelDefs) とは別値（getCombinedUnitBp と同規約）。
                            const braveDef = getDefinition(brave.definitionId);
                            return (
                              total +
                              (braveDef?.combinedBoost ??
                                braveDef?.levelDefs?.[0]?.bp ??
                                0)
                            );
                          }, 0)
                        : 0
                    }
                    size="medium"
                    isSelectable={
                      coreMoveMode
                        ? // P3-90: 独立コア管理カードは core-move 対象外（ハイライトしない）
                          !(coreMoveBlockedIds?.has(card.instanceId) ?? false)
                        : isCoreTapTarget
                          ? true
                          : attachedBraves.length === 0 &&
                            (selectableIds?.has(card.instanceId) ?? false)
                    }
                    isHighlighted={isCoreSource}
                    isAttacking={
                      attackerEntityIds.includes(card.instanceId) &&
                      !isDeclaring
                    }
                    isDeclaring={isDeclaring}
                    isAttackerHighlight={attackerIds.has(card.instanceId)}
                    isBlockerHighlight={blockerIds.has(card.instanceId)}
                    battlePairColorIndex={battlePairColorIndexByInstanceId.get(
                      card.instanceId
                    )}
                    onClick={
                      isCoreTapTarget
                        ? () => onCoreTapClick?.(card.instanceId)
                        : coreMoveMode && !isOpponent
                          ? () => onCoreMoveClick?.(card.instanceId)
                          : attachedBraves.length > 0
                            ? undefined // 合体中は wrapper で処理
                            : () => onCardClick?.(card.instanceId)
                    }
                    displayNormalCoreCount={displayNormalCoreCount}
                    displaySoulCoreCount={displaySoulCoreCount}
                    onDetailRequest={
                      coreMoveMode || isCoreTapTarget
                        ? () => {}
                        : () => onDetailRequest?.(card.instanceId)
                    }
                    resolvedBp={effectiveBpCache.get(card.instanceId)}
                    resolvedLevel={effectiveLevelCache.get(card.instanceId)}
                    symbolOverlayActive={symbolOverlayMode}
                    symbolOverlayChunks={overlayChunks}
                    isRebirthed={
                      card.definitionId !== card.originalDefinitionId
                    }
                    isAdventActive={
                      displayStackVisual?.hasAdventSource ?? false
                    }
                    underCardPeek={displayStackVisual?.peek}
                    isSoulState={isSoulState}
                  />
                  {symbolOverlayMode && cardDefinition?.quartzHostData && (
                    <QuartzAttributeOverlay
                      state={state}
                      hostInstanceId={card.instanceId}
                      getDefinition={getDefinition}
                    />
                  )}
                </div>
              );
            })}
            {displayedSharedFieldGroups.map(
              ({ group, startColumn, endColumn }) => {
                const sharedCard = cards.find(
                  (card) => card.instanceId === group.sharedCardId
                );
                if (!sharedCard) return null;
                const recoveredSharedCard =
                  sharedCard.exhaustState === "recovered"
                    ? sharedCard
                    : ({
                        ...sharedCard,
                        exhaustState: "recovered" as const,
                        exhaustedByUnpreventableEffect: false,
                      } satisfies CardInstance);
                const sharedImaginAnchorBadges =
                  group.kind === "imagin-brave"
                    ? group.anchorCardIds.flatMap((anchorId, index) => {
                        const anchorCard = cards.find(
                          (card) => card.instanceId === anchorId
                        );
                        if (!anchorCard) return [];
                        const anchorDefinition = getDefinition(
                          anchorCard.definitionId
                        );
                        const anchorDisplayCard =
                          anchorCard.attachedToInstanceId === null &&
                          shouldRecoverSpiritStateBraveExhaustion(
                            anchorCard,
                            anchorDefinition
                          ) &&
                          anchorCard.exhaustState !== "recovered"
                            ? {
                                ...anchorCard,
                                exhaustState: "recovered" as const,
                              }
                            : anchorCard;
                        const displayNormalCoreCount =
                          coreDisplayOverrides?.[anchorCard.instanceId];
                        const displaySoulCoreCount =
                          resolveSoulCoreDisplayCount(
                            anchorCard.soulCoreCount,
                            soulCoreDisplayOverrides?.[anchorCard.instanceId],
                            player?.soulCoreLocation?.kind === "card" &&
                              player.soulCoreLocation.instanceId ===
                                anchorCard.instanceId
                          );
                        const visualNormalCoreCount =
                          displayNormalCoreCount ?? anchorCard.normalCoreCount;
                        const visualTotalCoreCount =
                          visualNormalCoreCount + displaySoulCoreCount;
                        const visualLevel =
                          effectiveLevelCache.get(anchorCard.instanceId) ??
                          effectivePrintedLevel(
                            anchorDefinition,
                            visualTotalCoreCount,
                            state.players.find(
                              (p) => p.id === anchorCard.controllerPlayerId
                            )?.countValue ?? 0
                          );
                        const visualBp =
                          effectiveBpCache.get(anchorCard.instanceId) ??
                          effectivePrintedBp(
                            anchorDefinition,
                            visualTotalCoreCount
                          );
                        const displayExhaustState = soulStateIds.has(
                          anchorCard.instanceId
                        )
                          ? "recovered"
                          : anchorDisplayCard.exhaustState;

                        return [
                          fieldBadgeOverlay({
                            key: `shared-badges-${anchorCard.instanceId}`,
                            slot: index === 0 ? "left" : "right",
                            exhaustState: displayExhaustState,
                            isSoulState: soulStateIds.has(
                              anchorCard.instanceId
                            ),
                            bp: visualBp,
                            level: visualLevel,
                            normalCoreCount: visualNormalCoreCount,
                            soulCoreCount: displaySoulCoreCount,
                          }),
                        ];
                      })
                    : null;
                return (
                  <div
                    key={`shared-${group.sharedCardId}`}
                    className={`shared-field-card-overlay shared-field-card-${group.kind}`}
                    data-testid={`shared-field-card-${group.sharedCardId}`}
                    style={
                      {
                        gridColumn: `${startColumn} / ${endColumn + 1}`,
                      } as CSSProperties
                    }
                  >
                    <CardView
                      card={recoveredSharedCard}
                      definition={getDefinition(sharedCard.definitionId)}
                      size="medium"
                      hideStats
                      layoutClassName="shared-field-card-member"
                      symbolOverlayActive={symbolOverlayMode}
                      onDetailRequest={() =>
                        onDetailRequest?.(sharedCard.instanceId)
                      }
                    />
                    {sharedImaginAnchorBadges}
                  </div>
                );
              }
            )}
            {extendedSymbolSources.length > 0 && (
              <div
                className="field-extended-symbols"
                data-testid={`field-extended-symbols-${playerId}`}
                aria-label="フィールドとしても扱うシンボル"
              >
                {extendedSymbolSources.map((source) => (
                  <div
                    key={source.sourceInstanceId}
                    className="field-extended-symbol-source"
                    data-symbol-source-id={source.sourceInstanceId}
                    title={getDefinition(source.sourceDefinitionId)?.name}
                  >
                    <SymbolOverlayChunks
                      chunks={symbolBundleChunks(
                        source.symbolEntries.map((entry) => ({
                          colors: [...entry.colors],
                          count: 1,
                        }))
                      )}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* P3-56: nexus row は self/opp 共通で spirit row の後に常時レンダリング。
           * 視覚行順は CSS の grid-row 明示割当 (self=row2 / opp=row1) で実現。 */}
          {sortedNexuses.length > 0 && (
            <div className="field-nexus-row">
              {sortedNexuses.map((card) => {
                const isTapTarget =
                  coreTapTargetIds?.has(card.instanceId) ?? false;
                const isFieldSelectable =
                  selectableIds?.has(card.instanceId) ?? false;
                const isSoulState = soulStateIds.has(card.instanceId);
                const overlayChunks =
                  symbolOverlayMode && !isSoulState
                    ? symbolBundleChunks(
                        effectiveSymbolBundlesCache.get(card.instanceId) ?? []
                      )
                    : undefined;
                // ENGINE-brave-combine-nexus-host: ネクサスへ合体したブレイヴを表示する
                // (spirit row の combined-spirit-wrapper と同型。ネクサスは疲労以外の
                // バトル状態を持たないため attacker/blocker/宣言中の回転classは対象外)。
                const attachedBraves = getAttachedFieldBravesForHost(
                  cards,
                  card
                );
                const hasBraves = attachedBraves.length > 0;
                const cardDefinition = getDefinition(card.definitionId);
                const stackVisual = getFieldUnderCardVisual(
                  card,
                  hostDualAdventSideByCard.get(card.instanceId)
                );
                const displayStackVisual = stackVisual;
                const stackClass = displayStackVisual
                  ? ` has-field-stack field-card-stack-nexus field-stack-${displayStackVisual.peek.layout}`
                  : "";
                const stackStyle = displayStackVisual
                  ? fieldStackWrapperStyle(displayStackVisual)
                  : undefined;
                const displayCard =
                  card.attachedToInstanceId === null &&
                  shouldRecoverSpiritStateBraveExhaustion(
                    card,
                    cardDefinition
                  ) &&
                  card.exhaustState !== "recovered"
                    ? { ...card, exhaustState: "recovered" as const }
                    : card;
                const soulStateStyle = isSoulState
                  ? ({
                      ...stackStyle,
                      ...(soulNexusLayoutById.get(card.instanceId)?.style ??
                        fallbackSoulLayoutStyle),
                    } as CSSProperties)
                  : stackStyle;
                const wrapperStyle = {
                  ...soulStateStyle,
                  ...combinedFieldSpacing(
                    attachedBraves.length,
                    displayStackVisual
                  ),
                };
                const combinedClasses = combinedFieldClasses({
                  exhaustState: isSoulState
                    ? "recovered"
                    : displayCard.exhaustState,
                  isOpponent,
                });
                const wrapperSelectable =
                  !coreMoveMode &&
                  !isTapTarget &&
                  hasBraves &&
                  (selectableIds?.has(card.instanceId) ||
                    attachedBraves.some((brave) =>
                      selectableIds?.has(brave.instanceId)
                    ));
                const cardView = (
                  <CardView
                    key={hasBraves ? undefined : card.instanceId}
                    card={displayCard}
                    definition={cardDefinition}
                    layoutClassName={
                      hasBraves ? "combined-host-member" : undefined
                    }
                    size="medium"
                    resolvedLevel={effectiveLevelCache.get(card.instanceId)}
                    braveBpBonus={attachedBraves.reduce(
                      (total, brave) =>
                        total +
                        (getDefinition(brave.definitionId)?.combinedBoost ?? 0),
                      0
                    )}
                    displayNormalCoreCount={
                      coreDisplayOverrides?.[card.instanceId]
                    }
                    displaySoulCoreCount={resolveSoulCoreDisplayCount(
                      card.soulCoreCount,
                      soulCoreDisplayOverrides?.[card.instanceId],
                      player?.soulCoreLocation?.kind === "card" &&
                        player.soulCoreLocation.instanceId === card.instanceId
                    )}
                    symbolOverlayActive={symbolOverlayMode}
                    symbolOverlayChunks={overlayChunks}
                    isRebirthed={
                      card.definitionId !== card.originalDefinitionId
                    }
                    isAdventActive={
                      displayStackVisual?.hasAdventSource ?? false
                    }
                    underCardPeek={displayStackVisual?.peek}
                    isSoulState={isSoulState}
                    isSelectable={
                      isTapTarget ||
                      // P3-90: 独立コア管理カード（創界神 / 導界者 / 創界石）は
                      // 手動コア移動の対象外。core-move モードでもハイライトしない。
                      (!isOpponent &&
                        coreMoveMode &&
                        !(coreMoveBlockedIds?.has(card.instanceId) ?? false)) ||
                      (!hasBraves && isFieldSelectable)
                    }
                    onClick={
                      isTapTarget
                        ? () => onCoreTapClick?.(card.instanceId)
                        : !isOpponent && coreMoveMode
                          ? () => onCoreMoveClick?.(card.instanceId)
                          : hasBraves
                            ? undefined // 合体中は wrapper で処理
                            : !isOpponent
                              ? () => onCardClick?.(card.instanceId)
                              : isFieldSelectable
                                ? () => onCardClick?.(card.instanceId)
                                : undefined
                    }
                    onDetailRequest={
                      isTapTarget || (!isOpponent && coreMoveMode)
                        ? () => {}
                        : () => onDetailRequest?.(card.instanceId)
                    }
                  />
                );
                if (!hasBraves) {
                  if (!stackVisual && !isSoulState) return cardView;
                  return (
                    <div
                      key={card.instanceId}
                      data-instance-id={card.instanceId}
                      className={`field-card-stack-wrapper${stackClass}${isSoulState ? " soul-state-field-card soul-state-nexus" : ""}`}
                      style={soulStateStyle}
                    >
                      {cardView}
                    </div>
                  );
                }
                return (
                  <div
                    key={card.instanceId}
                    data-instance-id={card.instanceId}
                    className={`combined-spirit-wrapper combined-nexus-wrapper field-card-stack-wrapper has-brave${stackClass}${isSoulState ? " soul-state-field-card soul-state-nexus" : ""}${wrapperSelectable ? " selectable" : ""} ${combinedClasses}`}
                    style={wrapperStyle}
                    onClick={
                      wrapperSelectable
                        ? (e) => {
                            e.stopPropagation();
                            onCardClick?.(card.instanceId);
                          }
                        : undefined
                    }
                  >
                    {attachedBraves.map((brave, index) => (
                      <CardView
                        key={brave.instanceId}
                        card={brave}
                        definition={getDefinition(brave.definitionId)}
                        size="medium"
                        hideStats
                        layoutClassName="combined-brave-member"
                        layoutStyle={
                          { "--combined-brave-index": index } as CSSProperties
                        }
                        symbolOverlayActive={symbolOverlayMode}
                        onDetailRequest={() =>
                          onDetailRequest?.(brave.instanceId)
                        }
                      />
                    ))}
                    {cardView}
                  </div>
                );
              })}
            </div>
          )}
          {/* P3-56: 手元 zone と被るネクサス track 領域確保 (invisible phantom)。
           * scroll 容器内の grid 末尾に配置することで「手元有時のみネクサス行が早期 scroll 起動」。 */}
          {setAsideCards.length > 0 && fieldCards.length === 0 && (
            <div className="set-aside-phantom" aria-hidden="true" />
          )}
        </div>
      </div>

      {/* 右サイド: カウント + デッキ + トラッシュ */}
      <div className="field-right-side">
        <div
          className={`count-area-display${coreTapZones?.has("count_area") && !isOpponent ? " ac-selectable" : ""} ${multiSourceActiveKey === "count_area" ? "ac-selected" : ""}`}
          title={
            coreTapZones?.has("count_area") && !isOpponent
              ? "カウントエリア (ソース選択)"
              : "カウントエリア"
          }
          onClick={
            coreTapZones?.has("count_area") && !isOpponent
              ? () => onCoreTapClick?.("count_area")
              : undefined
          }
        >
          <span className="zone-label">カウント</span>
          <div className="count-area-cores">
            <img
              className="reserve-core-img"
              src="/images/ForGUI/core.png"
              alt="カウント"
            />
            <span className="count-area-number">{countDisplayValue}</span>
          </div>
        </div>
        <div
          className={`deck-display${onDeckClick ? " deck-clickable" : ""}`}
          title={onDeckClick ? "デッキ（クリックで閲覧）" : "デッキ"}
          data-testid={`deck-display-${playerId}`}
          data-replay-zone="deck"
          role={onDeckClick ? "button" : undefined}
          tabIndex={onDeckClick ? 0 : undefined}
          onClick={onDeckClick}
          onKeyDown={
            onDeckClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onDeckClick();
                  }
                }
              : undefined
          }
        >
          <img
            className="deck-card-back"
            src={
              faceUpDeckTopDef?.image
                ? `/${faceUpDeckTopDef.image}`
                : "/images/ForGUI/card-back.jpg"
            }
            alt={faceUpDeckTopDef?.name ?? "デッキ"}
          />
          <span className="deck-count">{deckCount}</span>
        </div>
        <div className="trash-zone-row" {...removedSwipe}>
          <div
            className={`trash-display${onTrashClick ? " trash-clickable" : ""} ${coreTapTargetIds?.has(`trash:${playerId}`) || (coreTapZones?.has("trash") && !isOpponent) ? "ac-selectable" : ""} ${multiSourceActiveKey === "trash" ? "ac-selected" : ""}`}
            title={
              coreTapTargetIds?.has(`trash:${playerId}`) ||
              (coreTapZones?.has("trash") && !isOpponent)
                ? "トラッシュ (ソース選択)"
                : "トラッシュ（クリックで閲覧）"
            }
            onClick={
              coreTapTargetIds?.has(`trash:${playerId}`) ||
              (coreTapZones?.has("trash") && !isOpponent)
                ? () =>
                    onCoreTapClick?.(
                      coreTapTargetIds?.has(`trash:${playerId}`)
                        ? `trash:${playerId}`
                        : "trash"
                    )
                : onTrashClick
            }
          >
            {topTrashDef?.image ? (
              <img
                className="trash-card-img"
                src={`/${topTrashDef.image}`}
                alt={topTrashDef.name}
              />
            ) : trashCount > 0 ? (
              <img
                className="trash-card-img"
                src="/images/ForGUI/card-back.jpg"
                alt="トラッシュ"
              />
            ) : (
              <span className="zone-label">トラッシュ</span>
            )}
            <span className="trash-count">{trashCount}枚</span>
            {(() => {
              if (!player) return null;
              const trashNormalDisplay =
                coreDisplayOverrides?.["trash"] ?? player.trashNormalCoreCount;
              if (trashNormalDisplay <= 0 && trashSoulDisplayCount <= 0)
                return null;
              return (
                <div className="trash-cores">
                  <img
                    className="trash-core-img"
                    src="/images/ForGUI/core.png"
                    alt="コア"
                  />
                  <span>{trashNormalDisplay}</span>
                  {trashSoulDisplayCount > 0 && (
                    <>
                      <img
                        className="trash-core-img"
                        src="/images/ForGUI/soul-core.png"
                        alt="ソウルコア"
                      />
                      <span>{trashSoulDisplayCount}</span>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
          <button
            type="button"
            className="removed-zone-button"
            data-testid={`removed-zone-${playerId}`}
            title={`${isOpponent ? "相手" : "自分"}の除外（クリックで閲覧）`}
            aria-label={`${isOpponent ? "相手" : "自分"}の除外`}
            onClick={onRemovedClick}
            disabled={!onRemovedClick}
          >
            <span aria-hidden="true">{isOpponent ? "＜" : "＞"}</span>
            <span>除</span>
            <span>外</span>
            <span aria-hidden="true">{isOpponent ? "＜" : "＞"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
