import { ALL_CARDS } from "@orica/card-data";
import { cardCategoryLabel } from "@orica/rules-core";
import { useState, type ReactNode } from "react";
import {
  calculateLevelFromResources,
  collectUnderCardScopeIds,
  evaluateCondition,
  getActAsSpiritMetadata,
  getCombinedUnitBp,
  getEffectiveColors,
  getEffectiveLevel,
  getCombinedUnitSymbolBundles,
  getEffectiveReductionSymbolEntries,
  getEffectiveTribes,
  getOverriddenProperties,
  getTotalCoresOnCardById,
  isCombinedBrave,
  isSoulCoreOn,
  resolveActAsSpiritBp,
  resolveActAsSpiritLevel,
  type ActAsSpiritStatAspect,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type LevelDefinition,
  type SymbolColor,
} from "@orica/rules-core";
import {
  COLOR_JA,
  formatPrintedSymbols,
  formatReductionSymbolEntries,
  formatSymbolBundles,
} from "../utils/symbol-format";
import { getCurrentEffectDisplaysForCard } from "../utils/granted-effect-display";

const cellStyle: React.CSSProperties = {
  border: "1px solid #444",
  padding: "2px 6px",
  background: "#1e1e3a",
};

/** 分身 (act_as_spirit) が overrides.keywords で付与する制約キーワードの日本語文。 */
const BUNSHIN_KEYWORD_JA: Record<string, string> = {
  cannot_combine: "このスピリットは合体できない。",
};

/**
 * 分身 (act_as_spirit) の Lv/BP テーブル行を組み立てる。
 *
 * フランドール【フォーオブアカインド】本文「同じ…Lv、BPを持つ Lvコスト1…の
 * スピリットとして扱い」に従い:
 * - BP は各 Lv とも host（コピー元）と同じ → host levelDefs の bp を採用
 * - 維持コア (Lvコスト) は overrides.levelDefs が指定する値を全 Lv 共通で適用
 *   （例: Lvコスト1 → Lv1/Lv2/Lv3 とも requiredCores=1）
 *
 * overrides.levelDefs の bp はスタブ (0) のため host bp で上書きする。
 */
function mergeBunshinLevelDefs(
  hostDefs: LevelDefinition[] | undefined,
  overrideDefs: LevelDefinition[] | undefined
): LevelDefinition[] | undefined {
  if (!hostDefs || hostDefs.length === 0) return overrideDefs;
  if (!overrideDefs || overrideDefs.length === 0) return hostDefs;
  const byLevel = new Map(overrideDefs.map((d) => [d.level, d]));
  const lvCost = overrideDefs[0]!.requiredCores; // 全 Lv 共通の Lvコスト
  return hostDefs.map((l) => {
    const o = byLevel.get(l.level);
    const requiredCores = o?.requiredCores ?? lvCost;
    const bp = o && o.bp ? o.bp : l.bp;
    return bp === undefined
      ? { level: l.level, requiredCores }
      : { level: l.level, requiredCores, bp };
  });
}

/**
 * メタ値の統一レンダラ。
 * - effective が printed と異なる → `元値 →○○`（黄色 diff、自分の分身/override 文脈）
 * - effective が無い/同じ → printed のみ素表示（非分身・裏向き分身は diff 基準が無い）
 */
function MetaValue({
  printed,
  effective,
}: {
  printed: ReactNode;
  effective?: ReactNode;
}): ReactNode {
  const changed =
    effective !== undefined && effective !== null && effective !== printed;
  if (!changed) return printed;
  return (
    <>
      <span className="cdm-printed-strike">{printed}</span>
      <span className="cdm-effective-arrow">→</span>
      <span className="cdm-effective-value">{effective}</span>
    </>
  );
}

/**
 * 分身 (act_as_spirit) の Lv/BP テーブル + 現在状態行。
 * 通常モーダルの `.cdm-level-table` / `.cdm-field-status` と同一構造。
 *
 * `printedLevelDefs` を渡すと（自分側 = 元カード既知）、各セルを
 * `元値 →分身値` の diff でメタ行と同じ視覚言語に揃える。渡さない場合
 * （裏向き分身 = diff 基準なし）は分身値の素表示に縮退する。
 */
function BunshinLevelTable({
  levelDefs,
  printedLevelDefs,
  activeLevel,
  activeBp,
  isField,
  coreCount,
  hasSoulCore,
  exhaustState,
  isSoulState,
  symbolText,
}: {
  levelDefs: LevelDefinition[] | undefined;
  printedLevelDefs?: LevelDefinition[];
  activeLevel: number;
  activeBp: number;
  isField: boolean;
  coreCount: number;
  hasSoulCore: boolean;
  exhaustState: CardInstance["exhaustState"];
  isSoulState?: boolean;
  symbolText?: string | null;
}): ReactNode {
  if (!levelDefs || levelDefs.length === 0) return null;
  const printedByLevel = printedLevelDefs
    ? new Map(printedLevelDefs.map((d) => [d.level, d]))
    : undefined;
  const diffMode = !!printedByLevel;
  // セル描画: diff 基準なし(裏向き)=素表示 / 元値あり=MetaValue diff /
  // 元カードに無い Lv(分身が新規付与)=黄色字 (override と同じ視覚言語)。
  const renderCell = (
    hasPrinted: boolean,
    printedVal: ReactNode,
    value: ReactNode
  ): ReactNode => {
    if (!diffMode) return value;
    if (hasPrinted) return <MetaValue printed={printedVal} effective={value} />;
    return <span className="cdm-effective-value">{value}</span>;
  };
  return (
    <div style={{ marginBottom: "0.7em", overflowX: "auto" }}>
      <table className="cdm-level-table">
        <thead>
          <tr>
            <th style={cellStyle}></th>
            {levelDefs.map((l) => {
              const p = printedByLevel?.get(l.level);
              return (
                <th
                  key={l.level}
                  style={cellStyle}
                  className={
                    isField && l.level === activeLevel ? "level-active" : ""
                  }
                >
                  Lv{l.level} (
                  {renderCell(
                    !!p,
                    p?.requiredCount !== undefined
                      ? `C${p.requiredCount}`
                      : p?.requiredCores,
                    l.requiredCount !== undefined
                      ? `C${l.requiredCount}`
                      : l.requiredCores
                  )}
                  )
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cellStyle}>BP</td>
            {levelDefs.map((l) => {
              const p = printedByLevel?.get(l.level);
              return (
                <td
                  key={l.level}
                  style={cellStyle}
                  className={
                    isField && l.level === activeLevel ? "level-active" : ""
                  }
                >
                  {renderCell(!!p, p?.bp ?? "-", l.bp ?? "-")}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      {isField && (activeLevel > 0 || isSoulState) && (
        <div className="cdm-field-status">
          {!isSoulState && (
            <span>
              現在 Lv{activeLevel}
              {activeBp > 0 ? ` / BP${activeBp}` : ""}
            </span>
          )}
          {!isSoulState && (
            <span>
              コア: {coreCount}
              {hasSoulCore ? " + ソウルコア" : ""}
            </span>
          )}
          <span>
            状態:{" "}
            {isSoulState
              ? "魂状態"
              : exhaustState === "exhausted"
                ? "疲労"
                : "回復"}
          </span>
          {!isSoulState && symbolText && <span>シンボル: {symbolText}</span>}
        </div>
      )}
    </div>
  );
}

interface CardDetailModalProps {
  card: CardDefinition | null;
  show?: boolean;
  onClose: () => void;
  onSetDeckThumbnail?: (cardNo: string) => void;
  inDeck?: boolean;
  countInDeck?: number;
  onIncrease?: (cardNo: string) => void;
  onDecrease?: (cardNo: string) => void;
  getTokenCount?: (cardNo: string) => number;
  onTokenIncrease?: (cardNo: string) => void;
  onTokenDecrease?: (cardNo: string) => void;
  allCards?: CardDefinition[];
  hideDeckActions?: boolean;
  zIndex?: number;
  /** バトル画面用: CardInstance を渡すとフィールド状態（レベル、コア、疲労）を表示 */
  cardInstance?: CardInstance;
  /** バトル画面用: gameState と getCardDefinitionById を渡すと現在 Lv/BP/シンボルを効果適用後の値で表示 */
  gameState?: GameState;
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  /** 公開情報ログの snapshot 詳細用: live state ではなく、その履歴上の処理ラベル。 */
  historyStateLabel?: string;
}

function isSoulStateInstance(
  state: Pick<GameState, "players"> | undefined,
  instanceId: string | undefined
): boolean {
  return (
    !!instanceId &&
    (state?.players.some((p) => p.soulStateInstanceIds.includes(instanceId)) ??
      false)
  );
}

/** 合体中ブレイヴのカード詳細に表示する「現在」値。 */
export function resolveCombinedBraveCurrentState(
  gameState: GameState | undefined,
  cardInstance: CardInstance | undefined,
  cardDefinition: CardDefinition | undefined
): string | null {
  if (
    !gameState ||
    !cardInstance ||
    !cardDefinition ||
    !isCombinedBrave(gameState, cardInstance, cardDefinition)
  ) {
    return null;
  }

  const combinedBoost =
    cardDefinition.combinedBoost ??
    cardDefinition.levelDefs.find((level) => level.level === 1)?.bp ??
    0;
  return `合体中/＋${combinedBoost}`;
}

export function resolvePrintedCombinedBoostDisplay(
  cardDefinition:
    | { printedCategory?: string; combinedBoost?: number }
    | undefined
): string | null {
  if (
    !cardDefinition ||
    cardDefinition.printedCategory !== "brave" ||
    cardDefinition.combinedBoost === undefined
  ) {
    return null;
  }
  return `＋${cardDefinition.combinedBoost}`;
}

interface CardDetailFaceState {
  card: CardDefinition | null;
  initialShowFront: boolean;
}

function hasBackFace(
  definition: CardDefinition
): definition is CardDefinition & {
  backFace: NonNullable<CardDefinition["backFace"]>;
} {
  return definition.isDoubleSided === true && definition.backFace !== undefined;
}

function getBackFaceCardNo(definition: CardDefinition): string | undefined {
  if (!definition.backFace) return undefined;
  return definition.backFace.cardNo ?? `${definition.cardNo}_back`;
}

/**
 * CardDetailModal は表示中の `card` を表面定義として扱う。
 * 転醒後の場カードでは definitionId が B 面 cardNo に差し替わるため、
 * 合成された B 面定義から originalDefinitionId の A 面定義へ戻して
 * 「表面に戻す」/「裏面を見る」トグルの正源を復元する。
 */
export function resolveCardDetailFaceState(
  card: CardDefinition | null,
  cardInstance: CardInstance | undefined,
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined
): CardDetailFaceState {
  if (!card) return { card: null, initialShowFront: true };

  if (hasBackFace(card)) {
    const backCardNo = getBackFaceCardNo(card);
    return {
      card,
      initialShowFront: cardInstance?.definitionId !== backCardNo,
    };
  }

  const frontCard =
    cardInstance && getCardDefinitionById
      ? getCardDefinitionById(cardInstance.originalDefinitionId)
      : undefined;
  if (frontCard && hasBackFace(frontCard)) {
    const backCardNo = getBackFaceCardNo(frontCard);
    if (
      backCardNo === card.cardNo ||
      backCardNo === cardInstance?.definitionId
    ) {
      return { card: frontCard, initialShowFront: false };
    }
  }

  return { card, initialShowFront: true };
}

export function CardDetailModal(props: CardDetailModalProps) {
  if (props.show === false) return null;
  return (
    <CardDetailModalContent
      key={`${props.card?.cardNo ?? "hidden"}:${props.cardInstance?.instanceId ?? "preview"}`}
      {...props}
    />
  );
}

function CardDetailModalContent({
  card,
  show = true,
  onClose,
  onSetDeckThumbnail,
  inDeck,
  countInDeck = 0,
  onIncrease,
  onDecrease,
  getTokenCount,
  onTokenIncrease,
  onTokenDecrease,
  allCards = ALL_CARDS,
  hideDeckActions = false,
  zIndex,
  cardInstance,
  gameState,
  getCardDefinitionById,
  historyStateLabel,
}: CardDetailModalProps) {
  const faceState = resolveCardDetailFaceState(
    card,
    cardInstance,
    getCardDefinitionById
  );
  const [internalShowFront, setInternalShowFront] = useState(
    faceState.initialShowFront
  );
  const [tokenIndex, setTokenIndex] = useState<number | null>(null);

  if (!show) return null;

  // 相手フィールドの裏向き分身ケース: sanitizer により definitionId=_hidden_card_
  // となり card は null になるが、state.activeContinuousEffects は伏せられない
  // ため act_as_spirit メタデータは取得可能。元カードの正体を伏せたまま分身情報
  // だけを minimal レンダーで開示する。
  if (!card) {
    if (cardInstance && gameState) {
      const meta = getActAsSpiritMetadata(gameState, cardInstance.instanceId);
      if (meta) {
        return (
          <BunshinOnlyDetail
            cardInstance={cardInstance}
            gameState={gameState}
            getCardDefinitionById={getCardDefinitionById}
            onClose={onClose}
            zIndex={zIndex}
          />
        );
      }
    }
    return null;
  }

  const displayCard = faceState.card ?? card;
  const isDoubleSided = displayCard.isDoubleSided && displayCard.backFace;
  const relatedTokens = (displayCard.relatedTokenCardNos ?? [])
    .map(
      (cardNo) =>
        getCardDefinitionById?.(cardNo) ??
        allCards.find((c) => c.cardNo === cardNo)
    )
    .filter((token): token is CardDefinition => token !== undefined);
  const hasRelatedTokens = relatedTokens.length > 0;
  const showToken = tokenIndex !== null && hasRelatedTokens;

  // Determine active display side
  type DisplayData = {
    name: string;
    printedCategory: string;
    colors: string[];
    cost: number;
    reductionSymbols: string[];
    levelDefs: LevelDefinition[];
    symbolColors: string[];
    symbolColorEntries?: string[][];
    textLines: string[];
    keywordTags: string[];
    tribe?: string;
    image?: string;
    rarity?: string;
    pack?: string;
    cardNo?: string;
    maxTokenDeckCount?: number;
    combinedBoost?: number;
    printedOverCount?: CardDefinition["printedOverCount"];
  };

  let activeData: DisplayData;
  let activeCardNo: string = displayCard.cardNo;
  let activeIsToken = false;

  if (showToken && hasRelatedTokens) {
    const resolved = relatedTokens[tokenIndex!];
    if (resolved) {
      activeData = resolved;
      activeCardNo = resolved.cardNo;
      activeIsToken = resolved.keywordTags.includes("token");
    } else {
      activeData = displayCard;
    }
  } else if (isDoubleSided && !internalShowFront) {
    const back = displayCard.backFace!;
    activeData = { ...back, cardNo: back.cardNo ?? displayCard.cardNo };
  } else {
    activeData = displayCard;
  }

  if (!activeIsToken && displayCard.keywordTags.includes("token")) {
    activeIsToken = true;
  }

  const mainMaxCount = activeIsToken ? 0 : (displayCard.maxDeckCount ?? 3);
  const tokenMaxCount = (activeData as CardDefinition).maxTokenDeckCount ?? 9;
  const maxCount = activeIsToken ? tokenMaxCount : mainMaxCount;
  const currentCount = activeIsToken
    ? getTokenCount
      ? getTokenCount(activeCardNo)
      : 0
    : countInDeck;

  const handleIncrease = () => {
    if (activeIsToken) {
      onTokenIncrease?.(activeCardNo);
      return;
    }
    onIncrease?.(displayCard.cardNo);
  };
  const handleDecrease = () => {
    if (activeIsToken) {
      onTokenDecrease?.(activeCardNo);
      return;
    }
    onDecrease?.(displayCard.cardNo);
  };

  // 効果適用後（override / treat_as / addTribes 等）の値を計算する。
  // cardInstance + gameState + getCardDefinitionById が揃った文脈でのみ
  // 「printed → effective」の差分表示を行う（zone 不問）。
  const ci = showToken ? undefined : cardInstance;
  const isSoulState = isSoulStateInstance(gameState, ci?.instanceId);
  const sourceDefForCi =
    ci && getCardDefinitionById ? getCardDefinitionById(ci.definitionId) : null;
  const combinedBraveCurrentState = resolveCombinedBraveCurrentState(
    gameState,
    ci,
    sourceDefForCi ?? undefined
  );
  const useEffective = !!(ci && gameState && sourceDefForCi);
  const overridden = useEffective
    ? getOverriddenProperties(gameState!, ci!.instanceId, getCardDefinitionById)
    : null;
  const effectiveColors = useEffective
    ? getEffectiveColors(gameState!, ci!, sourceDefForCi!)
    : null;
  const effectiveTribes = useEffective
    ? getEffectiveTribes(
        gameState!,
        ci!,
        sourceDefForCi!,
        getCardDefinitionById
      )
    : null;
  const effectiveReductionEntries = useEffective
    ? getEffectiveReductionSymbolEntries(
        sourceDefForCi!,
        gameState!,
        ci!.controllerPlayerId,
        getCardDefinitionById!,
        ci!.instanceId,
        undefined
      )
    : null;
  const currentEffectDisplays = useEffective
    ? getCurrentEffectDisplaysForCard(
        gameState!,
        ci!,
        sourceDefForCi!,
        getCardDefinitionById!
      ).filter((entry) => entry.text !== null)
    : [];
  // act_as_spirit (分身) detection — host 由来の効力ステータスで diff 表示する。
  const bunshinMeta = useEffective
    ? getActAsSpiritMetadata(gameState!, ci!.instanceId)
    : undefined;
  const bunshinHostCard =
    bunshinMeta?.statBlueprint.kind === "live_copy_from"
      ? gameState!.cardInstances.find(
          (c) =>
            c.instanceId ===
            (bunshinMeta.statBlueprint as { sourceInstanceId: string })
              .sourceInstanceId
        )
      : undefined;
  const bunshinHostDef =
    bunshinHostCard && getCardDefinitionById
      ? getCardDefinitionById(bunshinHostCard.definitionId)
      : undefined;
  const bunshinAspects: readonly ActAsSpiritStatAspect[] =
    bunshinMeta?.statBlueprint.kind === "live_copy_from"
      ? bunshinMeta.statBlueprint.aspects
      : [];
  const bunshinSnapshot =
    bunshinMeta?.statBlueprint.kind === "static_copy"
      ? bunshinMeta.statBlueprint.snapshot
      : undefined;
  const bunshinHasAspect = (aspect: ActAsSpiritStatAspect): boolean => {
    if (!bunshinMeta) return false;
    if (bunshinSnapshot) return true; // snapshot は全 aspect を保持
    return bunshinAspects.includes(aspect);
  };

  // 分身は「act_as_spirit が明示的に付与した項目」だけを持つ。aspects に含まれず
  // overrides にも無い項目は「持たない」(empty/default) として diff 表示する。
  // 例: フランドール【フォーオブアカインド】の card text は「コスト、シンボル、
  // 系統、Lv、BP」を granted し、属性・軽減は granted しない → 軽減・属性は空。
  const bunshinCost: number | undefined = bunshinMeta
    ? bunshinHasAspect("cost")
      ? (bunshinSnapshot?.cost ?? bunshinHostDef?.cost ?? 0)
      : 0
    : undefined;
  const bunshinReduction: SymbolColor[] | undefined = bunshinMeta
    ? bunshinHasAspect("reductionSymbols")
      ? (bunshinSnapshot?.reductionSymbols ??
        bunshinHostDef?.reductionSymbols ??
        [])
      : []
    : undefined;
  const bunshinTribes: string[] | undefined = bunshinMeta
    ? bunshinHasAspect("tribes")
      ? (bunshinSnapshot?.tribes ??
        (bunshinHostDef?.tribe ? bunshinHostDef.tribe.split("・") : []))
      : []
    : undefined;
  // 属性 (colors) は ActAsSpiritStatAspect に含まれない → 分身は常に色を持たない。
  // 将来 colors aspect を追加した場合はここで host から引く。
  const bunshinColors: string[] | undefined = bunshinMeta ? [] : undefined;
  // Lv/BP テーブル: host の BP に overrides の Lvコストを全 Lv 適用してマージ。
  const bunshinLevelDefs: LevelDefinition[] | undefined = bunshinMeta
    ? mergeBunshinLevelDefs(
        bunshinSnapshot?.levelDefs ??
          (bunshinHasAspect("levelDefs")
            ? bunshinHostDef?.levelDefs
            : undefined),
        bunshinMeta.overrides?.levelDefs
      )
    : undefined;
  const bunshinKeywords = bunshinMeta?.overrides?.keywords ?? [];

  // bunshin が有効な場合は overridden より bunshin 由来の値を優先。
  const effectiveCost =
    bunshinMeta && bunshinCost !== undefined ? bunshinCost : overridden?.cost;
  const effectiveCardName =
    bunshinMeta?.overrides?.cardName ?? overridden?.cardName;
  const effectiveCategoryOverride = bunshinMeta
    ? "spirit"
    : overridden?.treatAsCategory;

  const printedColorText =
    activeData.colors.map((c) => COLOR_JA[c] ?? c).join("・") || "-";
  const baseEffectiveColorText = effectiveColors
    ? effectiveColors.map((c) => COLOR_JA[c] ?? c).join("・") || "-"
    : null;
  const effectiveColorText =
    bunshinColors !== undefined
      ? bunshinColors.length === 0
        ? "-"
        : bunshinColors.map((c) => COLOR_JA[c] ?? c).join("・")
      : baseEffectiveColorText;
  const colorChanged =
    effectiveColorText !== null && effectiveColorText !== printedColorText;

  const printedCategoryText = (() => {
    const base = cardCategoryLabel(activeData.printedCategory);
    if (activeData.keywordTags?.includes("contract")) return `契約${base}`;
    if (activeData.keywordTags?.includes("token")) return `トークン${base}`;
    return base;
  })();
  const effectiveCategoryText = effectiveCategoryOverride
    ? cardCategoryLabel(effectiveCategoryOverride)
    : null;
  const categoryChanged =
    effectiveCategoryText !== null &&
    effectiveCategoryText !== printedCategoryText;

  const printedReductionText = formatReductionSymbolEntries(
    activeData.reductionSymbols.map((symbol) => ({ colors: [symbol] }))
  );
  const baseEffectiveReductionText = effectiveReductionEntries
    ? formatReductionSymbolEntries(effectiveReductionEntries)
    : null;
  // bunshin で reductionSymbols が aspects に含まれる場合は host 由来の値で上書き。
  const effectiveReductionText =
    bunshinReduction !== undefined
      ? bunshinReduction.length === 0
        ? "-"
        : formatReductionSymbolEntries(
            bunshinReduction.map((symbol) => ({ colors: [symbol] }))
          )
      : baseEffectiveReductionText;
  const reductionChanged =
    effectiveReductionText !== null &&
    effectiveReductionText !== printedReductionText;

  const printedSymbolText = formatPrintedSymbols(activeData);
  // 合体スピリットは1体として扱う: host のシンボルに合体中ブレイヴ分を合算して表示
  // (フィールドのシンボルバッジと一致させる)。合体していなければ host 単体と同値。
  const effectiveSymbolText = useEffective
    ? formatSymbolBundles(
        getCombinedUnitSymbolBundles(
          gameState!,
          ci!,
          sourceDefForCi!,
          getCardDefinitionById
        )
      )
    : null;
  const symbolChanged =
    effectiveSymbolText !== null && effectiveSymbolText !== printedSymbolText;

  const printedTribeText = activeData.tribe ?? "-";
  const baseEffectiveTribeText = effectiveTribes
    ? effectiveTribes.length > 0
      ? effectiveTribes.join("・")
      : "-"
    : null;
  const effectiveTribeText =
    bunshinTribes !== undefined
      ? bunshinTribes.length > 0
        ? bunshinTribes.join("・")
        : "-"
      : baseEffectiveTribeText;
  const tribeChanged =
    effectiveTribeText !== null && effectiveTribeText !== printedTribeText;

  const costChanged =
    effectiveCost !== undefined && effectiveCost !== activeData.cost;
  const nameChanged =
    effectiveCardName !== undefined && effectiveCardName !== activeData.name;
  const printedCombinedBoostDisplay =
    resolvePrintedCombinedBoostDisplay(activeData);

  return (
    <div
      className="cdm-overlay"
      style={zIndex ? { zIndex } : undefined}
      onClick={onClose}
    >
      <div className="cdm-content" onClick={(e) => e.stopPropagation()}>
        <button className="cdm-close" onClick={onClose}>
          ×
        </button>
        <div className="cdm-image-wrap">
          {activeData.image ? (
            <img
              src={`/${activeData.image}`}
              alt={activeData.name}
              className="cdm-card-img"
            />
          ) : (
            <div className="cdm-card-placeholder">{activeData.name}</div>
          )}
        </div>

        {isDoubleSided && !showToken && (
          <button
            className="cdm-toggle-btn"
            onClick={() => setInternalShowFront((front) => !front)}
          >
            {internalShowFront ? "裏面を見る" : "表面に戻す"}
          </button>
        )}
        {hasRelatedTokens && (
          <div style={{ textAlign: "center", marginBottom: "1em" }}>
            <button
              className="cdm-token-toggle"
              onClick={() => setTokenIndex(showToken ? null : 0)}
            >
              {showToken ? "元のカードに戻る" : "トークンを見る"}
            </button>
            {showToken && relatedTokens.length > 1 && (
              <div className="cdm-token-nav">
                <button
                  aria-label="前のトークン"
                  onClick={() =>
                    setTokenIndex((index) => Math.max(0, (index ?? 0) - 1))
                  }
                  disabled={tokenIndex === 0}
                >
                  ◀
                </button>
                <span>
                  {activeData.name}（{(tokenIndex ?? 0) + 1}/
                  {relatedTokens.length}）
                </span>
                <button
                  aria-label="次のトークン"
                  onClick={() =>
                    setTokenIndex((index) =>
                      Math.min(relatedTokens.length - 1, (index ?? 0) + 1)
                    )
                  }
                  disabled={tokenIndex === relatedTokens.length - 1}
                >
                  ▶
                </button>
              </div>
            )}
          </div>
        )}

        {/* Deck actions */}
        {!hideDeckActions && (
          <>
            <div
              style={{
                minHeight: "2.5em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "1em",
              }}
            >
              {onSetDeckThumbnail &&
              (activeIsToken ? currentCount > 0 : inDeck) &&
              maxCount > 0 ? (
                <button
                  className="cdm-thumbnail-btn"
                  onClick={() => {
                    onSetDeckThumbnail(activeCardNo);
                    onClose();
                  }}
                >
                  デッキ画像に指定
                </button>
              ) : (
                <span
                  style={{
                    display: "inline-block",
                    width: "8.5em",
                    height: "2.2em",
                  }}
                />
              )}
            </div>
            <div className="cdm-deck-controls">
              {maxCount > 0 ? (
                <>
                  <button
                    onClick={handleDecrease}
                    className={`cdm-btn-minus${activeIsToken ? " token" : ""}`}
                    disabled={currentCount <= 0}
                  >
                    -
                  </button>
                  <span>
                    {currentCount} / {maxCount}
                  </span>
                  <button
                    onClick={handleIncrease}
                    className={`cdm-btn-plus${activeIsToken ? " token" : ""}`}
                    disabled={currentCount >= maxCount}
                  >
                    +
                  </button>
                </>
              ) : !activeIsToken ? (
                <span style={{ color: "#e94560", fontWeight: "bold" }}>
                  このカードはデッキに入れられません。
                </span>
              ) : null}
            </div>
          </>
        )}

        <h2 className="cdm-card-name">
          <MetaValue
            printed={activeData.name}
            effective={nameChanged ? effectiveCardName : undefined}
          />
        </h2>
        <div className="cdm-meta">
          <span>
            属性:{" "}
            <MetaValue
              printed={printedColorText}
              effective={colorChanged ? effectiveColorText : undefined}
            />
          </span>
          <span>
            コスト:{" "}
            <MetaValue
              printed={activeData.cost}
              effective={costChanged ? effectiveCost : undefined}
            />
          </span>
          {(printedReductionText || effectiveReductionText) && (
            <span>
              軽減:{" "}
              <MetaValue
                printed={printedReductionText || "-"}
                effective={
                  reductionChanged ? effectiveReductionText || "-" : undefined
                }
              />
            </span>
          )}
          <span>
            カード種類:{" "}
            <MetaValue
              printed={printedCategoryText}
              effective={categoryChanged ? effectiveCategoryText : undefined}
            />
          </span>
          <span>
            系統:{" "}
            <MetaValue
              printed={printedTribeText}
              effective={tribeChanged ? effectiveTribeText : undefined}
            />
          </span>
          {(printedSymbolText || effectiveSymbolText) && (
            <span>
              シンボル:{" "}
              <MetaValue
                printed={printedSymbolText || "-"}
                effective={
                  symbolChanged ? effectiveSymbolText || "-" : undefined
                }
              />
            </span>
          )}
        </div>

        {/* Level/BP table */}
        {bunshinMeta
          ? (() => {
              const totalCores =
                ci && gameState
                  ? getTotalCoresOnCardById(gameState, ci.instanceId)
                  : (ci?.normalCoreCount ?? 0);
              const lv = useEffective
                ? getEffectiveLevel(
                    gameState!,
                    ci!,
                    sourceDefForCi!,
                    getCardDefinitionById
                  )
                : 0;
              const bp = useEffective
                ? getCombinedUnitBp(
                    gameState!,
                    ci!,
                    sourceDefForCi!,
                    getCardDefinitionById
                  )
                : 0;
              return (
                <BunshinLevelTable
                  levelDefs={bunshinLevelDefs ?? activeData.levelDefs}
                  printedLevelDefs={activeData.levelDefs}
                  activeLevel={lv}
                  activeBp={bp}
                  isField={ci?.zone === "field"}
                  coreCount={totalCores}
                  hasSoulCore={
                    !!(
                      gameState &&
                      ci &&
                      isSoulCoreOn(gameState, ci.instanceId)
                    )
                  }
                  exhaustState={ci?.exhaustState ?? "recovered"}
                  isSoulState={isSoulState}
                  symbolText={effectiveSymbolText}
                />
              );
            })()
          : activeData.levelDefs && activeData.levelDefs.length > 0
            ? (() => {
                const totalCores =
                  ci && gameState
                    ? getTotalCoresOnCardById(gameState, ci.instanceId)
                    : (ci?.normalCoreCount ?? 0);
                const activeLevel = useEffective
                  ? getEffectiveLevel(
                      gameState!,
                      ci!,
                      sourceDefForCi!,
                      getCardDefinitionById
                    )
                  : ci
                    ? calculateLevelFromResources(
                        activeData.levelDefs,
                        totalCores,
                        gameState?.players.find(
                          (p) => p.id === ci.controllerPlayerId
                        )?.countValue ?? 0
                      )
                    : 0;
                // 閲覧中の面が実体と一致する場合だけ、現在状態を強調する。
                const isCurrentFieldFace =
                  ci?.zone === "field" &&
                  !isSoulState &&
                  !showToken &&
                  (!isDoubleSided ||
                    internalShowFront === faceState.initialShowFront) &&
                  (!gameState ||
                    !collectUnderCardScopeIds(gameState).adventSource.has(
                      ci.instanceId
                    ));
                const isCombined =
                  isCurrentFieldFace && combinedBraveCurrentState !== null;
                const overCount = activeData.printedOverCount;
                const isOverCount =
                  isCurrentFieldFace &&
                  !!overCount &&
                  !!gameState &&
                  evaluateCondition(
                    gameState,
                    [
                      {
                        kind: "count_value",
                        player: "self",
                        min: overCount.minCount,
                      },
                    ],
                    ci.instanceId,
                    ci.controllerPlayerId,
                    getCardDefinitionById ?? (() => undefined)
                  );
                const activeBp = useEffective
                  ? getCombinedUnitBp(
                      gameState!,
                      ci!,
                      sourceDefForCi!,
                      getCardDefinitionById
                    )
                  : ci
                    ? (activeData.levelDefs.find(
                        (ld) => ld.level === activeLevel
                      )?.bp ?? 0)
                    : 0;
                // override_properties.levelCost / bp による Lv ヘッダ・BP セルの上書き表示
                const overrideLevelCost = overridden?.levelCost;
                const overrideBp = overridden?.bp;
                const overrideRequiredCoresFor = (
                  level: number
                ): number | undefined => {
                  if (!overrideLevelCost) return undefined;
                  if (level === 1) return overrideLevelCost.lv1;
                  if (level === 2) return overrideLevelCost.lv2;
                  if (level === 3) return overrideLevelCost.lv3;
                  return undefined;
                };
                const overrideBpFor = (level: number): number | undefined => {
                  if (!overrideBp) return undefined;
                  if (level === 1) return overrideBp.lv1;
                  if (level === 2) return overrideBp.lv2;
                  if (level === 3) return overrideBp.lv3;
                  return undefined;
                };
                return (
                  <div style={{ marginBottom: "0.7em", overflowX: "auto" }}>
                    <table className="cdm-level-table">
                      <thead>
                        <tr>
                          <th style={cellStyle}></th>
                          {activeData.levelDefs.map((l) => {
                            const overriddenCores = overrideRequiredCoresFor(
                              l.level
                            );
                            const coresChanged =
                              l.requiredCount === undefined &&
                              overriddenCores !== undefined &&
                              overriddenCores !== l.requiredCores;
                            return (
                              <th
                                key={l.level}
                                style={cellStyle}
                                className={
                                  isCurrentFieldFace &&
                                  !isCombined &&
                                  l.level === activeLevel
                                    ? "level-active"
                                    : ""
                                }
                              >
                                Lv{l.level} (
                                {coresChanged ? (
                                  <>
                                    <span className="cdm-printed-strike">
                                      {l.requiredCores}
                                    </span>
                                    <span className="cdm-effective-arrow">
                                      →
                                    </span>
                                    <span className="cdm-effective-value">
                                      {overriddenCores}
                                    </span>
                                  </>
                                ) : l.requiredCount !== undefined ? (
                                  `C${l.requiredCount}`
                                ) : (
                                  l.requiredCores
                                )}
                                )
                              </th>
                            );
                          })}
                          {overCount && (
                            <th
                              className={`oc-col${isOverCount ? " level-active" : ""}`}
                              style={cellStyle}
                            >
                              OC({overCount.minCount}+)
                            </th>
                          )}
                          {printedCombinedBoostDisplay !== null && (
                            <th
                              className={`combined-col${isCombined ? " level-active" : ""}`}
                              style={cellStyle}
                            >
                              合体中
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={cellStyle}>BP</td>
                          {activeData.levelDefs.map((l) => {
                            const overriddenBp = overrideBpFor(l.level);
                            const bpChanged =
                              overriddenBp !== undefined &&
                              overriddenBp !== (l.bp ?? undefined);
                            return (
                              <td
                                key={l.level}
                                style={cellStyle}
                                className={
                                  isCurrentFieldFace &&
                                  !isCombined &&
                                  l.level === activeLevel
                                    ? "level-active"
                                    : ""
                                }
                              >
                                {bpChanged ? (
                                  <>
                                    <span className="cdm-printed-strike">
                                      {l.bp ?? "-"}
                                    </span>
                                    <span className="cdm-effective-arrow">
                                      →
                                    </span>
                                    <span className="cdm-effective-value">
                                      {overriddenBp}
                                    </span>
                                  </>
                                ) : (
                                  (l.bp ?? "-")
                                )}
                              </td>
                            );
                          })}
                          {overCount && (
                            <td
                              className={`oc-col${isOverCount ? " level-active" : ""}`}
                              style={cellStyle}
                            >
                              ＋{overCount.bpBonus}
                            </td>
                          )}
                          {printedCombinedBoostDisplay !== null && (
                            <td
                              className={`combined-col${isCombined ? " level-active" : ""}`}
                              style={cellStyle}
                            >
                              {printedCombinedBoostDisplay}
                            </td>
                          )}
                        </tr>
                      </tbody>
                    </table>
                    {ci &&
                    ci.zone === "field" &&
                    (activeLevel > 0 ||
                      isSoulState ||
                      combinedBraveCurrentState !== null) ? (
                      <div className="cdm-field-status">
                        {!isSoulState && (
                          <span>
                            現在{" "}
                            {combinedBraveCurrentState ?? (
                              <>
                                Lv{activeLevel}
                                {activeBp > 0 ? ` / BP${activeBp}` : ""}
                              </>
                            )}
                          </span>
                        )}
                        {!isSoulState && combinedBraveCurrentState === null && (
                          <span>
                            コア: {ci.normalCoreCount}
                            {gameState && isSoulCoreOn(gameState, ci.instanceId)
                              ? " + ソウルコア"
                              : ""}
                          </span>
                        )}
                        {combinedBraveCurrentState === null && (
                          <span>
                            状態:{" "}
                            {isSoulState
                              ? "魂状態"
                              : ci.exhaustState === "exhausted"
                                ? "疲労"
                                : "回復"}
                          </span>
                        )}
                        {!isSoulState &&
                          combinedBraveCurrentState === null &&
                          effectiveSymbolText && (
                            <span>シンボル: {effectiveSymbolText}</span>
                          )}
                      </div>
                    ) : null}
                  </div>
                );
              })()
            : null}

        {historyStateLabel && !showToken ? (
          <div className="cdm-field-status cdm-history-status">
            <span>{historyStateLabel}</span>
          </div>
        ) : null}

        <div className="cdm-meta">
          <span>レアリティ: {activeData.rarity ?? "-"}</span>
          <span>収録弾: {activeData.pack ?? "-"}</span>
          <span>カード番号: {activeData.cardNo ?? displayCard.cardNo}</span>
        </div>

        {bunshinMeta && bunshinKeywords.some((k) => BUNSHIN_KEYWORD_JA[k]) && (
          <div className="cdm-granted-keywords accent">
            {bunshinKeywords
              .map((k) => BUNSHIN_KEYWORD_JA[k])
              .filter((text): text is string => !!text)
              .map((text, idx) => (
                <div key={idx}>
                  <span className="cdm-effective-arrow">→</span>
                  {text}
                </div>
              ))}
          </div>
        )}

        {currentEffectDisplays.length > 0 && (
          <div className="cdm-granted-keywords accent">
            {currentEffectDisplays.map((entry) => (
              <div key={entry.continuousEffect.effectId}>
                <span className="cdm-effective-arrow">→</span>
                {entry.text}
              </div>
            ))}
          </div>
        )}

        <div className={`cdm-effect${bunshinMeta ? " cdm-effect-muted" : ""}`}>
          {renderEffect(activeData.textLines)}
        </div>
      </div>
    </div>
  );
}

function renderEffect(textLines: string[]): ReactNode {
  if (!textLines || textLines.length === 0) return "テキストなし";
  const result: ReactNode[] = [];
  let i = 0;
  let foundAldnoah = false;

  while (i < textLines.length) {
    const line = textLines[i]!;
    if (!foundAldnoah && /^【アルドノアドライブ：/.test(line)) {
      foundAldnoah = true; // eslint-disable-line no-useless-assignment -- used as loop guard in subsequent iterations
      const rest = textLines.slice(i);
      result.push(
        <div key={i} className="cdm-effect-aldnoah">
          {rest.map((l, idx) => (
            <span key={idx}>
              {l}
              {idx < rest.length - 1 ? <br /> : null}
            </span>
          ))}
        </div>
      );
      break;
    } else if (!foundAldnoah && /^【解封：/.test(line)) {
      let end = i + 1;
      while (
        end < textLines.length &&
        textLines[end]!.trim() !== "" &&
        !/^【アルドノアドライブ：/.test(textLines[end]!)
      )
        end++;
      const block = textLines.slice(i, end);
      result.push(
        <div key={i} className="cdm-effect-unseal">
          {block.map((l, idx) => (
            <span key={idx}>
              {l}
              {idx < block.length - 1 ? <br /> : null}
            </span>
          ))}
        </div>
      );
      i = end;
    } else if (!foundAldnoah && /^【(真・)?導託：/.test(line)) {
      let end = i + 1;
      while (
        end < textLines.length &&
        textLines[end]!.trim() !== "" &&
        !/^【アルドノアドライブ：/.test(textLines[end]!)
      )
        end++;
      const block = textLines.slice(i, end);
      result.push(
        <div key={i} className="cdm-effect-guide">
          {block.map((l, idx) => (
            <span key={idx}>
              {l}
              {idx < block.length - 1 ? <br /> : null}
            </span>
          ))}
        </div>
      );
      i = end;
    } else if (!foundAldnoah && /^【(真・)?神託：/.test(line)) {
      let end = i + 1;
      while (
        end < textLines.length &&
        textLines[end]!.trim() !== "" &&
        !/^【アルドノアドライブ：/.test(textLines[end]!)
      )
        end++;
      const block = textLines.slice(i, end);
      result.push(
        <div key={i} className="cdm-effect-oracle">
          {block.map((l, idx) => (
            <span key={idx}>
              {l}
              {idx < block.length - 1 ? <br /> : null}
            </span>
          ))}
        </div>
      );
      i = end;
    } else if (!foundAldnoah) {
      result.push(
        <span key={i}>
          {line}
          {i < textLines.length - 1 ? <br /> : null}
        </span>
      );
      i++;
    } else {
      i++;
    }
  }
  return result;
}

/**
 * 相手フィールド裏向き分身用のミニマル詳細表示。
 *
 * sanitizer により元カードの definitionId は伏せられているが、act_as_spirit
 * 継続効果のメタデータは state.activeContinuousEffects 経由で残っているため、
 * 元の正体を伏せたまま「分身として持つ効果」だけを公開する。
 */
interface BunshinOnlyDetailProps {
  cardInstance: CardInstance;
  gameState: GameState;
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  onClose: () => void;
  zIndex: number | undefined;
}

function BunshinOnlyDetail({
  cardInstance,
  gameState,
  getCardDefinitionById,
  onClose,
  zIndex,
}: BunshinOnlyDetailProps): ReactNode {
  const meta = getActAsSpiritMetadata(gameState, cardInstance.instanceId);
  if (!meta) return null;

  const totalCores = getTotalCoresOnCardById(
    gameState,
    cardInstance.instanceId
  );

  const blueprint = meta.statBlueprint;
  const aspects: readonly ActAsSpiritStatAspect[] =
    blueprint.kind === "live_copy_from" ? blueprint.aspects : [];
  const snapshot =
    blueprint.kind === "static_copy" ? blueprint.snapshot : undefined;

  const hostInstance =
    blueprint.kind === "live_copy_from" && getCardDefinitionById
      ? gameState.cardInstances.find(
          (c) => c.instanceId === blueprint.sourceInstanceId
        )
      : undefined;
  const hostDef =
    hostInstance && getCardDefinitionById
      ? getCardDefinitionById(hostInstance.definitionId)
      : undefined;

  const hasAspect = (a: ActAsSpiritStatAspect): boolean => {
    if (snapshot) return true;
    return aspects.includes(a);
  };

  const cost = hasAspect("cost") ? (snapshot?.cost ?? hostDef?.cost ?? 0) : 0;
  const reduction: SymbolColor[] = hasAspect("reductionSymbols")
    ? (snapshot?.reductionSymbols ?? hostDef?.reductionSymbols ?? [])
    : [];
  const tribes: string[] = hasAspect("tribes")
    ? (snapshot?.tribes ?? (hostDef?.tribe ? hostDef.tribe.split("・") : []))
    : [];
  // Lv/BP テーブル: host の BP に overrides の Lvコストを全 Lv 適用してマージ。
  const levelDefs: LevelDefinition[] | undefined = mergeBunshinLevelDefs(
    snapshot?.levelDefs ??
      (hasAspect("levelDefs") ? hostDef?.levelDefs : undefined),
    meta.overrides?.levelDefs
  );

  const lv = getCardDefinitionById
    ? (resolveActAsSpiritLevel(
        gameState,
        cardInstance,
        (s, c, d, v) => getEffectiveLevel(s, c, d, getCardDefinitionById, v),
        getCardDefinitionById
      ) ?? 0)
    : 0;
  const bp = getCardDefinitionById
    ? (resolveActAsSpiritBp(
        gameState,
        cardInstance,
        // 分身は合体ユニットを追従する (シンボルと同様、ブレイヴの BP＋ を含む)。
        (s, c, d, v) => getCombinedUnitBp(s, c, d, getCardDefinitionById, v),
        getCardDefinitionById
      ) ?? 0)
    : 0;

  const keywords = meta.overrides?.keywords ?? [];

  // 分身名: act_as_spirit が override する名前、無ければコピー元 host の名前。
  // host は表向きで公開 (コピー対象の cost/BP/系統は本モーダルで既に開示済み) の
  // ため、分身名も相手に対して公開情報。伏せるのは token のベース元カードの正体のみ。
  const bunshinName = meta.overrides?.cardName ?? hostDef?.name;

  const symbolText = formatSymbolBundles(
    getCombinedUnitSymbolBundles(
      gameState,
      cardInstance,
      getCardDefinitionById?.(cardInstance.definitionId),
      getCardDefinitionById
    )
  );
  const isSoulState = isSoulStateInstance(gameState, cardInstance.instanceId);
  const grantedKeywordLines = keywords
    .map((k) => BUNSHIN_KEYWORD_JA[k])
    .filter((text): text is string => !!text);

  return (
    <div
      className="cdm-overlay"
      style={zIndex ? { zIndex } : undefined}
      onClick={onClose}
      data-testid="card-detail-modal-bunshin-only"
    >
      <div className="cdm-content" onClick={(e) => e.stopPropagation()}>
        <button className="cdm-close" onClick={onClose}>
          ×
        </button>
        {/* 画像だけ裏面に差し替え、レイアウトは通常モーダルと同一 */}
        <div className="cdm-image-wrap">
          <img
            src="/images/ForGUI/card-back.jpg"
            alt="スピリット"
            className="cdm-card-img"
          />
        </div>

        {/* 元カードが伏せられているため diff 基準が無く、すべて素表示（白字） */}
        <h2 className="cdm-card-name" data-testid="bunshin-name">
          {bunshinName ?? "スピリット"}
        </h2>
        <div className="cdm-meta">
          <span>属性: -</span>
          <span>コスト: {cost}</span>
          {reduction.length > 0 && (
            <span>
              軽減:{" "}
              {formatReductionSymbolEntries(
                reduction.map((symbol) => ({ colors: [symbol] }))
              )}
            </span>
          )}
          <span>カード種類: スピリット</span>
          <span>系統: {tribes.length > 0 ? tribes.join("・") : "-"}</span>
          {symbolText && <span>シンボル: {symbolText}</span>}
        </div>

        <BunshinLevelTable
          levelDefs={levelDefs}
          activeLevel={lv}
          activeBp={bp}
          isField={cardInstance.zone === "field"}
          coreCount={totalCores}
          hasSoulCore={isSoulCoreOn(gameState, cardInstance.instanceId)}
          exhaustState={cardInstance.exhaustState}
          isSoulState={isSoulState}
          symbolText={symbolText}
        />

        {grantedKeywordLines.length > 0 && (
          <div className="cdm-granted-keywords">
            {grantedKeywordLines.map((text, idx) => (
              <div key={idx}>{text}</div>
            ))}
          </div>
        )}

        <div className="cdm-hidden-notice">
          ※ 元カードの情報は伏せられています。
        </div>
      </div>
    </div>
  );
}
