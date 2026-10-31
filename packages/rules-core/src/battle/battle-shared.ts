import {
  getEffectiveCategory,
  getEffectiveTribe,
  resolveActAsSpiritLevel,
  resolveActAsSpiritSymbolBundles,
} from "../mechanics/act-as-spirit";
import { getCardById } from "../card/card-lookup";
import { getPrintedSymbolEntries } from "../model";
import { calculateLevelFromResources } from "../card/level-calculation";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  getCombinedUnitBp,
  getEffectiveBp,
  getEffectiveColors,
  getEffectiveLevelCostDelta,
  getEffectiveLevelCostOverride,
  getEffectiveLevelOverride,
  getEffectiveTribes,
  getCombinedUnitBraveChildren,
  matchesGlobalCETargetFilter,
  getOverriddenProperties,
  getSymbolAdditions,
} from "../legal/legal-actions-shared";
import {
  getVirtualCombinedBraves,
  isCombinedBrave,
} from "../mechanics/virtual-combine";

// 実効 BP の正源は legal-actions-shared.ts に置く（循環回避の配置。理由は同ファイル参照）。
// 従来 `import { getEffectiveBp } from "./battle-shared"` を維持するため re-export する。
export { getEffectiveBp, getCombinedUnitBp };
import type {
  ActiveAttack,
  ActiveAttackBlockAssignment,
  ActiveAttackTarget,
  BattleEntity,
  BattleResolutionEntitySnapshot,
  BattleResolutionGroup,
  BattleResolutionParticipantSnapshot,
  CardColor,
  CardDefinition,
  CardInstance,
  GameState,
  SymbolColor,
} from "../model";
import { isCardTextCardState, normalizeAsColors } from "../model";

export function getBattleCardInstanceOrThrow(
  state: GameState,
  instanceId: string,
  detail: string
): CardInstance {
  const cardInstance = getCardById(state, instanceId);

  if (!cardInstance) {
    throw new Error(`${detail}: ${instanceId}`);
  }

  return cardInstance;
}

export function getBattleCardDefinitionOrThrow(
  definitionId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): CardDefinition {
  const definition = getCardDefinitionById(definitionId);

  if (!definition) {
    throw new Error(`Unknown card definition: ${definitionId}`);
  }

  return definition;
}

export function isBattleCapableCategory(
  definition: CardDefinition,
  sourceCard: CardInstance,
  state?: Pick<GameState, "activeContinuousEffects" | "players"> &
    Partial<
      Pick<GameState, "cardInstances" | "step" | "activePlayerId" | "window">
    >
): boolean {
  if (isCardTextCardState(sourceCard, state)) {
    return false;
  }

  // 転神/転者状態: ネクサスもスピリットとしてバトル可能
  if (sourceCard.divineTransformState) {
    return true;
  }

  // 「種類として扱わない」は実体の喪失ではない（BSTH03-M01 等）。
  // 種類の置換・分身付与は実効種類の正源を使い、印字へ独自に戻さない。
  const category = getEffectiveCategory(
    state ?? { activeContinuousEffects: [] },
    sourceCard,
    definition,
    true
  );
  return (
    category === "spirit" || category === "ultimate" || category === "brave"
  );
}

export function isSoulStateCard(
  state: Pick<GameState, "players"> | undefined,
  instanceId: string
): boolean {
  return (
    state?.players.some((p) => p.soulStateInstanceIds.includes(instanceId)) ??
    false
  );
}

function getRuleStrengthBattlePreventTags(
  attackState: BattleEntity["attackState"]
): readonly string[] {
  switch (attackState) {
    case "attacking":
      return ["prevent_battle_attack", "prevent_battle_both"];
    case "blocking":
      return ["prevent_battle_block", "prevent_battle_both"];
    case "idle":
      return [];
  }
}

function battleRestrictionMatchesAttackState(
  restriction: readonly ("attack" | "block")[] | "attack" | "block" | "both",
  attackState: BattleEntity["attackState"]
): boolean {
  const required =
    attackState === "attacking"
      ? "attack"
      : attackState === "blocking"
        ? "block"
        : null;
  if (required === null) return false;
  return Array.isArray(restriction)
    ? restriction.includes(required)
    : restriction === required || restriction === "both";
}

function effectApplicabilityMatchesCurrentCombination(
  effect: NonNullable<CardDefinition["effects"]>[number],
  card: CardInstance
): boolean {
  const combined = effect.applicability?.combined;
  if (combined === undefined) return true;
  const isCombined = card.attachedToInstanceId != null;
  return combined === isCombined;
}

function hasPrintedRuleStrengthBattlePrevent(
  card: CardInstance,
  attackState: BattleEntity["attackState"],
  getCardDefinitionById:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined
): boolean {
  const definition = getCardDefinitionById?.(card.definitionId);
  if (!definition?.effects) return false;

  for (const effect of definition.effects) {
    if (effect.timing.kind !== "continuous") continue;
    if (effect.condition !== undefined) continue;
    if (effect.timingScope !== undefined) continue;
    if (!effectApplicabilityMatchesCurrentCombination(effect, card)) continue;
    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind !== "prevent_battle") continue;
      if (action.ruleStrength !== true) continue;
      if (action.target.kind !== "self") continue;
      if (
        battleRestrictionMatchesAttackState(action.restriction, attackState)
      ) {
        return true;
      }
    }
  }

  return false;
}

export function isRuleStrengthBattlePrevented(
  state: GameState,
  instanceId: string,
  attackState: BattleEntity["attackState"],
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): boolean {
  const tags = getRuleStrengthBattlePreventTags(attackState);
  if (tags.length === 0) return false;
  const card = getCardById(state, instanceId);
  const activeCePrevents = state.activeContinuousEffects.some((ce) => {
    if (!tags.includes(ce.modifierTag)) return false;
    const metadata = ce.metadata as { ruleStrength?: boolean } | undefined;
    if (metadata?.ruleStrength !== true) return false;
    if (ce.targetInstanceId === instanceId) return true;
    return (
      card !== undefined &&
      ce.targetFilter !== undefined &&
      getCardDefinitionById !== undefined &&
      matchesGlobalCETargetFilter(state, ce, card, getCardDefinitionById)
    );
  });
  if (activeCePrevents) return true;
  return (
    card !== undefined &&
    hasPrintedRuleStrengthBattlePrevent(
      card,
      attackState,
      getCardDefinitionById
    )
  );
}

/** Current combat membership, shared by removal, rebuild and resolution.
 * An attached card belongs to its host's unit; it cannot become a standalone
 * combatant merely because the host left the entity or entered soul state.
 * A detached brave (no physical host) can still continue the declared battle.
 */
export function isCurrentCombatMember(
  state: GameState,
  entity: Pick<BattleEntity, "memberInstanceIds">,
  memberInstanceId: string
): boolean {
  const card = getCardById(state, memberInstanceId);
  if (!card || isCardTextCardState(card, state)) return false;
  const hostIds = [
    card.attachedToInstanceId,
    card.imaginRightCombinedWith,
  ].filter((id): id is string => id != null);
  return (
    hostIds.length === 0 ||
    hostIds.some((hostId) => {
      if (!entity.memberInstanceIds.includes(hostId)) return false;
      const host = getCardById(state, hostId);
      return host !== undefined && !isCardTextCardState(host, state);
    })
  );
}

function isBattleEntityMemberInvalidatedByState(
  state: GameState,
  entity: BattleEntity,
  memberInstanceId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  const card = getCardById(state, memberInstanceId);
  if (!card || !isCurrentCombatMember(state, entity, memberInstanceId))
    return true;
  const definition = getCardDefinitionById(card.definitionId);
  if (!definition) return false;
  if (!isBattleCapableCategory(definition, card, state)) return true;
  return isRuleStrengthBattlePrevented(
    state,
    memberInstanceId,
    entity.attackState,
    getCardDefinitionById
  );
}

export function getBattleEntityMemberIdsInvalidatedByState(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): string[] {
  const invalidated = new Set<string>();
  for (const entity of state.battleEntities) {
    for (const memberInstanceId of entity.memberInstanceIds) {
      if (
        isBattleEntityMemberInvalidatedByState(
          state,
          entity,
          memberInstanceId,
          getCardDefinitionById
        )
      ) {
        invalidated.add(memberInstanceId);
      }
    }
  }
  return [...invalidated];
}

export function removeStateInvalidBattleEntityMembersAndRecompute(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  return removeBattleEntityMembersAndRecompute(
    state,
    getBattleEntityMemberIdsInvalidatedByState(state, getCardDefinitionById),
    getCardDefinitionById
  );
}

// 実効 BP の正源 getEffectiveBp は legal-actions-shared.ts へ移設した
// (候補列挙 getCandidateTargetInstanceIds と同居させ DI を不要にするため)。
// 本モジュールでは下部で re-export し、従来の `from "./battle-shared"` import を維持する。

/**
 * 単一カードの実効シンボルを返す。base symbols (definition.symbolColors) に symbol_addition CE を追加。
 * override_properties CE によるシンボル上書きがある場合はそちらを base として使用。
 */
export function getEffectiveSymbols(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): SymbolColor[] {
  return getEffectiveSymbolBundles(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById,
    visited
  ).flatMap((bundle) =>
    Array.from({ length: bundle.count }, () => bundle.colors).flat()
  );
}

/**
 * シンボル表示用バンドル。`colors` は同一シンボルが持つ全色 (単色なら 1 要素、
 * 「赤としても扱う」等で複色になる場合は複数要素)。`count` は同色組み合わせの個数。
 */
export interface SymbolBundle {
  colors: SymbolColor[];
  count: number;
}

const SYMBOL_DISPLAY_ORDER: readonly SymbolColor[] = [
  "red",
  "purple",
  "green",
  "white",
  "yellow",
  "blue",
  "black",
  "ultimate_symbol",
  "guide",
  "god",
  "seven",
  "six",
];

function compareSymbols(a: SymbolColor, b: SymbolColor): number {
  const ai = SYMBOL_DISPLAY_ORDER.indexOf(a);
  const bi = SYMBOL_DISPLAY_ORDER.indexOf(b);
  return (
    (ai === -1 ? Number.POSITIVE_INFINITY : ai) -
    (bi === -1 ? Number.POSITIVE_INFINITY : bi)
  );
}

/**
 * カードの実効シンボルを「色組み合わせ × 個数」のバンドル列で返す。
 * - base symbols の物理的な1個ごとの色集合を保持（印字複合シンボルを含む）
 * - treat_as_symbol / treat_as_color_and_symbol / treat_as_symbol_and_reduction CE で
 *   既存全エントリに色を追加 (「としても扱う」)
 * - symbol_addition CE は新規 1 色エントリとして追加
 * - 同色組み合わせを集計して返す
 */
export function getEffectiveSymbolBundles(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): SymbolBundle[] {
  const overridden = getOverriddenProperties(
    state,
    sourceCard.instanceId,
    getCardDefinitionById
  );
  let entries: SymbolColor[][];
  if (overridden?.symbols) {
    entries =
      overridden.symbolColorEntries?.map((colors) => [...colors]) ??
      overridden.symbols.map((symbol) => [symbol]);
  } else {
    // P3-69: act_as_spirit トークンは付与元シンボルを base に。裏向きで付与無しは素性なし。
    const tokenBundles = getCardDefinitionById
      ? resolveActAsSpiritSymbolBundles(
          state,
          sourceCard,
          (s, c, d, v) =>
            getCombinedUnitSymbolBundles(s, c, d, getCardDefinitionById, v),
          getCardDefinitionById,
          visited
        )
      : undefined;
    if (tokenBundles !== undefined) {
      entries = tokenBundles.flatMap((bundle) =>
        Array.from({ length: bundle.count }, () => [...bundle.colors])
      );
    } else if (sourceCard.faceDown) {
      entries = [];
    } else if (sourceCard.divineTransformState?.symbols) {
      entries = sourceCard.divineTransformState.symbols.map((symbol) => [
        symbol,
      ]);
    } else if (sourceDefinition) {
      entries = getPrintedSymbolEntries(sourceDefinition);
    } else {
      entries = [];
    }
  }

  const symbolCountFixed = overridden?.symbolCountFixed === true;

  if (!symbolCountFixed) {
    for (const colors of getSymbolAdditions(
      state,
      sourceCard.instanceId,
      getCardDefinitionById
    )) {
      entries.push([...colors]);
    }
  }
  return groupSymbolEntries(
    applySymbolColorTreatments(state, sourceCard, sourceDefinition, entries)
  );
}

/** Q3263: 合体/効果で追加されたシンボルも合体先の色追加を受ける。 */
function applySymbolColorTreatments(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  entries: SymbolColor[][]
): SymbolColor[][] {
  for (const ce of state.activeContinuousEffects) {
    if (ce.targetInstanceId !== sourceCard.instanceId) continue;
    if (
      ce.modifierTag !== "treat_as_symbol" &&
      ce.modifierTag !== "treat_as_color_and_symbol" &&
      ce.modifierTag !== "treat_as_symbol_and_reduction"
    )
      continue;
    // treat_as 系は modifierSymbol の全色 (多色対応) を既存 entry に追加する。
    for (const addedColor of ce.modifierSymbol ?? []) {
      entries = entries.map((colors) =>
        colors.includes(addedColor) ? colors : [...colors, addedColor]
      );
    }
  }

  // フィールド外のカードは通常 continuous CE 未登録なので、`appliesToCard:true` +
  // `aspects` 含 `"symbol"` の treat_as を DSL 直接読みで補う。これは
  // 「このカード/<実体種類>のシンボルは～としても扱う」の「このカード」側を表し、
  // 手札だけでなくデッキ/トラッシュ/手元/除外など表向きの全ゾーンで有効。
  // フィールド等の CE 登録対象ゾーンでも直接読みを併用するが、色追加は重複除去される。
  // `getEffectiveColors` (色) / `getEffectiveReductionSymbolEntries` (軽減) と並列の処理。
  // 裏向きカードは null identity なので印字効果を漏らさない。
  if (!sourceCard.faceDown && sourceDefinition) {
    for (const effect of sourceDefinition.effects ?? []) {
      if (effect.timing.kind !== "continuous") continue;
      // 条件付きは保守的にスキップ (getEffectiveColors と同型)。
      if (effect.condition && effect.condition.length > 0) continue;
      if (effect.applicability) continue;

      for (const step of effect.steps) {
        const action = step.action;
        if (action.kind !== "treat_as") continue;
        if (!action.appliesToCard) continue;
        if (action.cardStateOnly && !isCardTextCardState(sourceCard, state)) {
          continue;
        }
        // `whenPayingForFilter` 付きは通常時の実効シンボルではなく、対象カードの
        // コスト支払い文脈でのみ cost-system が加色する。
        if (action.whenPayingForFilter) continue;
        if (!action.aspects.includes("symbol")) continue;
        for (const addedColor of normalizeAsColors(action.asColor ?? [])) {
          entries = entries.map((colors) =>
            colors.includes(addedColor) ? colors : [...colors, addedColor]
          );
        }
      }
    }
  }

  return entries;
}

function groupSymbolEntries(entries: SymbolColor[][]): SymbolBundle[] {
  const groups = new Map<string, SymbolBundle>();
  for (const colors of entries) {
    const sorted = [...colors].sort(compareSymbols);
    const key = sorted.join(",");
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { colors: sorted, count: 1 });
  }
  return Array.from(groups.values());
}

/**
 * 合体スピリット (1 体) としての実効シンボルバンドルを返す。
 *
 * `getEffectiveSymbolBundles` は二重計上を避けるため host 単体しか返さないが、
 * 「合体スピリットは 1 体として扱う」「ブレイヴのシンボルがスピリットに追加」
 * (05_brave-and-attack-special-cases.md) に従い、host 自身のシンボルに合体中の
 * ブレイヴ children のシンボルを合算したい表示・参照文脈ではこの helper を使う。
 *
 * card がブレイヴ children を持たない (合体していない) 場合は
 * `getEffectiveSymbolBundles(card)` と同値。
 */
export function getCombinedUnitSymbolBundles(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): SymbolBundle[] {
  const merged: SymbolColor[][] = [];
  const pushBundles = (bundles: SymbolBundle[]) => {
    for (const b of bundles) {
      for (let i = 0; i < b.count; i++) merged.push([...b.colors]);
    }
  };
  const ownSymbolBundles = getEffectiveSymbolBundles(
    state,
    card,
    definition,
    getCardDefinitionById,
    visited
  );
  pushBundles(ownSymbolBundles);
  if (
    getOverriddenProperties(state, card.instanceId, getCardDefinitionById)
      ?.symbolCountFixed
  ) {
    return ownSymbolBundles;
  }
  for (const child of getCombinedUnitBraveChildren(
    state,
    card,
    getCardDefinitionById
  )) {
    const childDef = getCardDefinitionById?.(child.definitionId);
    pushBundles(
      getEffectiveSymbolBundles(
        state,
        child,
        childDef,
        getCardDefinitionById,
        visited
      )
    );
  }
  for (const virtualBrave of getVirtualCombinedBraves(state, card.instanceId)) {
    for (const symbol of virtualBrave.symbols ?? []) {
      merged.push([symbol]);
    }
  }

  return groupSymbolEntries(
    applySymbolColorTreatments(state, card, definition, merged)
  );
}

/**
 * 合体スピリット (1 体) としての実効「シンボル数」を返す。
 * SymbolBundle 単位 (dual-color treat_as は 1 シンボル) で数える正源。
 *
 * `getCombinedUnitSymbols(...).length` は flat 配列 (dual-color を多重展開) の長さで、
 * 「シンボル数」とは異なる (dual-color を 2 とカウントしてしまう)。
 * `filter.symbolCount` / `filter.minSymbolCount` の比較対象 (getPrintedSymbolEntries(def).length と同型)
 * として使うのはこの関数。
 */
export function getCombinedUnitSymbolCount(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  return getCombinedUnitSymbolBundles(
    state,
    card,
    definition,
    getCardDefinitionById
  ).reduce((sum, b) => sum + b.count, 0);
}

/**
 * 合体スピリット (1 体) としての実効シンボル (flat)。
 * `getCombinedUnitSymbolBundles` の flat 版。
 */
export function getCombinedUnitSymbols(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): SymbolColor[] {
  const out: SymbolColor[] = [];
  for (const b of getCombinedUnitSymbolBundles(
    state,
    card,
    definition,
    getCardDefinitionById
  )) {
    for (let i = 0; i < b.count; i++) out.push(...b.colors);
  }
  return out;
}

type EffectiveLevelCostSnapshot = {
  levelCostDelta: number;
  levelCostOverride?: { lv1?: number; lv2?: number; lv3?: number } | undefined;
  /**
   * `override_properties.level` の実効値。
   * - `"max"`: コア数計算より優先し、対象カード自身の最高 Lv を返す。
   * - `{delta}`: コア数計算結果（`levelCostDelta`/`levelCostOverride` 適用後）に加算する。
   */
  levelOverride?: "max" | { delta: number } | undefined;
};

type EffectiveLevelCostResolver = (
  state: GameState,
  card: CardInstance,
  definition: CardDefinition
) => EffectiveLevelCostSnapshot;

function calculateEffectiveLevelFromCosts(
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  totalCores: number,
  countValue: number,
  costs: EffectiveLevelCostSnapshot
): number {
  // act_as_spirit でなく def も無い (viewer sanitize 済) なら算出不能 → 0
  if (!sourceDefinition) return 0;

  if (sourceDefinition.levelDefs.length === 0) return 0;

  // Ver.17.0 例2: 消滅待機スピリットはコアが全移動して Lv0 でも、待機に入った時点の
  // Lv（pendingLeaveLvSnapshot）で扱う。Lv 依存の離脱時効果・表示の単一経路にする。
  if (
    sourceCard.pendingLeaveKind === "vanish" &&
    sourceCard.pendingLeaveLvSnapshot !== null
  ) {
    return sourceCard.pendingLeaveLvSnapshot;
  }

  if (costs.levelOverride === "max") {
    let maxLevel = 0;
    for (const ld of sourceDefinition.levelDefs) {
      maxLevel = Math.max(maxLevel, ld.level);
    }
    return maxLevel;
  }

  const lv = calculateLevelFromResources(
    sourceDefinition.levelDefs,
    totalCores,
    countValue,
    costs.levelCostDelta,
    costs.levelCostOverride
  );

  // `{delta}` はコア数基準の通常算出値（levelCostDelta/levelCostOverride 適用後）への
  // 加算上書き。「Lvを2つ下として扱う」= delta:-2（BSTH08.5-X02）。最低Lv未満（負値含む）
  // になり得るが、その消滅判定は CardFilter.belowOwnMinimumLevel 側の責務。
  if (costs.levelOverride && typeof costs.levelOverride === "object") {
    return lv + costs.levelOverride.delta;
  }

  return lv;
}

function getEffectiveLevelWithCostResolver(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set(),
  resolveCosts: EffectiveLevelCostResolver = (
    nextState,
    nextCard,
    nextDefinition
  ) => ({
    levelCostDelta: getEffectiveLevelCostDelta(
      nextState,
      nextCard,
      nextDefinition,
      getCardDefinitionById
    ),
    levelCostOverride: getEffectiveLevelCostOverride(
      nextState,
      nextCard,
      nextDefinition,
      getCardDefinitionById
    ),
    levelOverride: getEffectiveLevelOverride(
      nextState,
      nextCard,
      nextDefinition,
      getCardDefinitionById
    ),
  })
): number {
  // 合体後のブレイヴ自身は Lv を持たない。Lv1 として扱うのは、合体していない
  // スピリット状態のブレイヴだけ（10_rules/05）。合体スピリットの Lv は host 側で算出する。
  if (isCombinedBrave(state, sourceCard, sourceDefinition)) return 0;

  // act_as_spirit (P3-47 F-2) — token は本体追従の Lv を返す
  if (getCardDefinitionById) {
    const tokenLv = resolveActAsSpiritLevel(
      state,
      sourceCard,
      (s, c, d, v) =>
        getEffectiveLevelWithCostResolver(
          s,
          c,
          d,
          getCardDefinitionById,
          v,
          resolveCosts
        ),
      getCardDefinitionById,
      visited
    );
    if (tokenLv !== undefined) return tokenLv;
  }

  if (
    sourceCard.pendingLeaveKind === "vanish" &&
    sourceCard.pendingLeaveLvSnapshot !== null
  ) {
    return sourceCard.pendingLeaveLvSnapshot;
  }

  const totalCores = getTotalCoresOnCardById(state, sourceCard.instanceId);
  return calculateEffectiveLevelFromCosts(
    sourceCard,
    sourceDefinition,
    totalCores,
    state.players.find((player) => player.id === sourceCard.controllerPlayerId)
      ?.countValue ?? 0,
    sourceDefinition
      ? resolveCosts(state, sourceCard, sourceDefinition)
      : { levelCostDelta: 0 }
  );
}

/**
 * カードの実効レベルを返す。コア数と override_properties.levelCost (Lv 別必要コア数) を考慮。
 * levelDefs を持たないカードと、合体スピリットのブレイヴ側メンバーは 0 を返す。
 */
export function getEffectiveLevel(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): number {
  return getEffectiveLevelWithCostResolver(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById,
    visited
  );
}

/**
 * global override_properties の targetFilter 判定用。
 *
 * 通常の `getEffectiveLevel` と同じ Lv 算出 SSOT を使いつつ、global CE 自身の
 * targetFilter 再帰だけを避けるため、Lv コストは instance 宛て CE のみに限定する。
 */
export function getEffectiveLevelWithLocalOverridesOnly(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): number {
  return getEffectiveLevelWithCostResolver(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById,
    visited,
    (nextState, nextCard) => {
      const overridden = getOverriddenProperties(
        nextState,
        nextCard.instanceId,
        getCardDefinitionById,
        false
      );
      return {
        levelCostDelta: overridden?.levelCostDelta ?? 0,
        levelCostOverride: overridden?.levelCost,
        levelOverride: overridden?.level,
      };
    }
  );
}

/**
 * global override_properties の targetFilter 評価用。
 *
 * Lv コストを変更する global CE 自身を除外して実効 Lv を計算する。これにより
 * symbol-only など別種の global CE は通常の Lv コスト変更を反映でき、Lv コスト CE
 * 自身の minLevel/maxLevel 判定だけは自己参照しない。
 */
export function getEffectiveLevelExcludingGlobalOverrideProperties(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  excludedGlobalEffectIds: ReadonlySet<string>,
  visited: ReadonlySet<string> = new Set()
): number {
  return getEffectiveLevelWithCostResolver(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById,
    visited,
    (nextState, nextCard, nextDefinition) => ({
      levelCostDelta: getEffectiveLevelCostDelta(
        nextState,
        nextCard,
        nextDefinition,
        getCardDefinitionById,
        { excludedGlobalEffectIds }
      ),
      levelCostOverride: getEffectiveLevelCostOverride(
        nextState,
        nextCard,
        nextDefinition,
        getCardDefinitionById,
        { excludedGlobalEffectIds }
      ),
      levelOverride: getEffectiveLevelOverride(
        nextState,
        nextCard,
        nextDefinition,
        getCardDefinitionById,
        { excludedGlobalEffectIds }
      ),
    })
  );
}

/**
 * BattleEntity の全 member の実効シンボルを合算して返す。
 * host + attached brave の base symbols に、各 member 向け symbol_addition CE を加算。
 */
export function getEffectiveSymbolsForEntity(
  state: GameState,
  entity: BattleEntity,
  cardInstancesById: Map<string, CardInstance>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SymbolColor[] {
  return getEffectiveSymbolBundlesForEntity(
    state,
    entity,
    cardInstancesById,
    getCardDefinitionById
  ).flatMap((bundle) =>
    Array.from({ length: bundle.count }, () => bundle.colors).flat()
  );
}

export function getEffectiveSymbolBundlesForEntity(
  state: GameState,
  entity: BattleEntity,
  cardInstancesById: Map<string, CardInstance>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SymbolBundle[] {
  const primaryId = entity.memberInstanceIds[0];
  const primaryCard = primaryId ? cardInstancesById.get(primaryId) : undefined;
  const primaryDefinition = primaryCard
    ? getCardDefinitionById(primaryCard.definitionId)
    : undefined;
  if (primaryCard && primaryDefinition) {
    const primaryBundles = getEffectiveSymbolBundles(
      state,
      primaryCard,
      primaryDefinition,
      getCardDefinitionById
    );
    if (
      getOverriddenProperties(
        state,
        primaryCard.instanceId,
        getCardDefinitionById
      )?.symbolCountFixed
    ) {
      return primaryBundles;
    }
  }

  const bundles: SymbolBundle[] = [];
  for (const memberId of entity.memberInstanceIds) {
    const card = cardInstancesById.get(memberId);
    if (!card) continue;
    const definition = getCardDefinitionById(card.definitionId);
    if (!definition) continue;
    bundles.push(
      ...getEffectiveSymbolBundles(
        state,
        card,
        definition,
        getCardDefinitionById
      )
    );
  }
  if (primaryCard) {
    for (const virtualBrave of getVirtualCombinedBraves(
      state,
      primaryCard.instanceId
    )) {
      for (const symbol of virtualBrave.symbols ?? []) {
        bundles.push({ colors: [symbol], count: 1 });
      }
    }
  }
  return primaryCard
    ? groupSymbolEntries(
        applySymbolColorTreatments(
          state,
          primaryCard,
          primaryDefinition,
          bundles.flatMap((bundle) =>
            Array.from({ length: bundle.count }, () => [...bundle.colors])
          )
        )
      )
    : bundles;
}

/**
 * P3-69: カードの実効素性 (identity) を 1 つのビューに集約した中央 resolver。
 *
 * 裏向き (faceDown) / `act_as_spirit` / `divineTransform` / `override_properties` /
 * 各種 CE modifier の優先順位解決を、従来は dimension ごとに分散していた
 * `getEffective*` 群が個別に再実装していた。本 resolver はそれらを単一の入口に集約し、
 * consumer が `def.*` を直読みせず実効値を得る choke point を提供する。
 *
 * 各 dimension は **lazy** に計算される (初回アクセス時のみ)。大半の consumer は 1 dimension
 * しか読まないため、全 dimension の eager 計算は hot path を不要に重くする
 * (最重量の `symbolBundles` を無駄計算する)。
 *
 * NOTE (Increment 0): 本体は既存 `getEffective*` への委譲 (option b)。dimension ごとの
 * ロジック移設 (option a) と cross-call memo 化は後続 Increment で行う。
 */
export interface EffectiveIdentity {
  /** 実効 category。裏向き + 付与無しは `undefined` (印字を漏らさない)。 */
  readonly category: CardDefinition["printedCategory"] | undefined;
  /** 実効系統リスト (override addTribes 反映)。`getEffectiveTribes` 相当。 */
  readonly tribes: string[];
  /** 実効系統文字列 ("・"連結, faceDown/act_as_spirit 固有)。`getEffectiveTribe` 相当。 */
  readonly tribe: string;
  /** 実効色リスト (treat_as_color 反映)。`getEffectiveColors` 相当。 */
  readonly colors: CardColor[];
  /** 実効シンボル (flat)。`getEffectiveSymbols` 相当。 */
  readonly symbols: SymbolColor[];
  /** 実効シンボルバンドル (色組み合わせ×個数)。`getEffectiveSymbolBundles` 相当。 */
  readonly symbolBundles: SymbolBundle[];
  /** 実効 BP。`getEffectiveBp` 相当。 */
  readonly bp: number;
  /** 実効 Lv。`getEffectiveLevel` 相当。 */
  readonly level: number;
}

/** 初回アクセス時のみ `fn` を評価し以後はキャッシュ値を返す getter を作る。 */
function lazyMemo<T>(fn: () => T): () => T {
  let computed = false;
  let value: T;
  return () => {
    if (!computed) {
      value = fn();
      computed = true;
    }
    return value;
  };
}

interface EffectiveIdentityCacheEntry {
  card: CardInstance;
  definition: CardDefinition;
  lookup: ((id: string) => CardDefinition | undefined) | undefined;
  view: EffectiveIdentity;
}

// 実効値はステップ・カウント・他カード等にも依存する。依存フィールドを手で列挙せず、
// 同じ不変stateと同じ引数の間だけ再利用する。部分配列を共有する別stateとは共有しない。
const identityCache = new WeakMap<
  GameState,
  Map<string, EffectiveIdentityCacheEntry>
>();

/**
 * P3-69: 中央 identity resolver。dimension ごとに lazy 評価する `EffectiveIdentity` を返す。
 * 同一 view 内では各 dimension は 1 度だけ計算され、さらに同一 (state, card, def, lookup) では
 * view 自体が memo 共有される。
 */
export function resolveEffectiveIdentity(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): EffectiveIdentity {
  let bucket = identityCache.get(state);
  if (!bucket) {
    bucket = new Map<string, EffectiveIdentityCacheEntry>();
    identityCache.set(state, bucket);
  }
  const cached = bucket.get(card.instanceId);
  if (
    cached?.card === card &&
    cached.definition === def &&
    cached.lookup === getCardDefinitionById
  )
    return cached.view;
  const view = buildEffectiveIdentity(state, card, def, getCardDefinitionById);
  bucket.set(card.instanceId, {
    card,
    definition: def,
    lookup: getCardDefinitionById,
    view,
  });
  return view;
}

/** lazy getter で各 dimension を初回のみ計算する `EffectiveIdentity` view を構築する。 */
function buildEffectiveIdentity(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): EffectiveIdentity {
  const category = lazyMemo(() => getEffectiveCategory(state, card, def));
  const tribes = lazyMemo(() =>
    getEffectiveTribes(state, card, def, getCardDefinitionById)
  );
  const tribe = lazyMemo(() =>
    getEffectiveTribe(state, card, def, getCardDefinitionById)
  );
  const colors = lazyMemo(() => getEffectiveColors(state, card, def));
  const symbols = lazyMemo(() =>
    getEffectiveSymbols(state, card, def, getCardDefinitionById)
  );
  const symbolBundles = lazyMemo(() =>
    getEffectiveSymbolBundles(state, card, def, getCardDefinitionById)
  );
  const bp = lazyMemo(() =>
    getEffectiveBp(state, card, def, getCardDefinitionById)
  );
  const level = lazyMemo(() =>
    getEffectiveLevel(state, card, def, getCardDefinitionById)
  );
  return {
    get category() {
      return category();
    },
    get tribes() {
      return tribes();
    },
    get tribe() {
      return tribe();
    },
    get colors() {
      return colors();
    },
    get symbols() {
      return symbols();
    },
    get symbolBundles() {
      return symbolBundles();
    },
    get bp() {
      return bp();
    },
    get level() {
      return level();
    },
  };
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 全 BattleEntity の resolvedBp と resolvedSymbols を再計算する。
 * bp_modifier / symbol_addition CE の登録/期限切れ後に呼び出す。
 */
export function recomputeBattleEntityBp(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  if (state.battleEntities.length === 0) return state;

  const cardInstancesById = new Map(
    state.cardInstances.map((c) => [c.instanceId, c])
  );

  let changed = false;
  const updated = state.battleEntities.map((entity) => {
    // BP: 主カード (先頭 member) 基準で再計算
    const primaryId = entity.memberInstanceIds[0];
    if (!primaryId) return entity;
    const card = cardInstancesById.get(primaryId);
    if (!card) return entity;
    // 離脱処理の途中では、後続の構成員除去が残留ブレイヴを引き継ぐ。
    // 再計算だけで離脱済み主カードのentityを空にしない。
    if (card.zone !== "field") return entity;

    const definition = getCardDefinitionById(card.definitionId);
    if (!definition) return entity;

    const currentMemberInstanceIds = getCurrentCombatMemberInstanceIds(
      state,
      card,
      getCardDefinitionById
    );
    const membersChanged = !arraysEqual(
      currentMemberInstanceIds,
      entity.memberInstanceIds
    );
    const entityForSymbols = membersChanged
      ? { ...entity, memberInstanceIds: currentMemberInstanceIds }
      : entity;

    // 合体スピリットはブレイヴの BP＋ も含めた実効 BP で再計算する。
    const newBp =
      currentMemberInstanceIds.length === 0
        ? 0
        : getCombinedUnitBp(state, card, definition, getCardDefinitionById);

    // シンボル: 全 member の base symbols + 各 member の symbol_addition CE を合算
    const newSymbols = getEffectiveSymbolsForEntity(
      state,
      entityForSymbols,
      cardInstancesById,
      getCardDefinitionById
    );
    const newSymbolCount = getEffectiveSymbolBundlesForEntity(
      state,
      entityForSymbols,
      cardInstancesById,
      getCardDefinitionById
    ).reduce((sum, bundle) => sum + bundle.count, 0);

    const bpChanged = newBp !== entity.resolvedBp;
    const symbolsChanged = !arraysEqual(newSymbols, entity.resolvedSymbols);
    const symbolCountChanged =
      newSymbolCount !== (entity.resolvedSymbolCount ?? newSymbols.length);

    if (!membersChanged && !bpChanged && !symbolsChanged && !symbolCountChanged)
      return entity;

    changed = true;
    return {
      ...entity,
      ...(membersChanged
        ? { memberInstanceIds: currentMemberInstanceIds }
        : {}),
      ...(bpChanged ? { resolvedBp: newBp } : {}),
      ...(symbolsChanged ? { resolvedSymbols: newSymbols } : {}),
      ...(symbolCountChanged ? { resolvedSymbolCount: newSymbolCount } : {}),
    };
  });

  if (!changed) return state;
  return { ...state, battleEntities: updated };
}

/**
 * Returns every entity whose identity must survive an active battle, even
 * after all of its current members have left that battle entity. A preserved
 * empty shell keeps a declared block and the subsequent battle-end tail
 * intact until resolution/finalize.
 */
export function getActiveAttackReferencedBattleEntityIds(
  activeAttack: ActiveAttack | null
): Set<string> {
  if (activeAttack === null) return new Set();
  return new Set([
    ...activeAttack.participantEntityIds,
    ...activeAttack.blockAssignments.flatMap(
      (assignment) => assignment.blockedByEntityIds
    ),
    ...(activeAttack.target.kind === "battle_entity"
      ? [activeAttack.target.entityId]
      : []),
  ]);
}

function getInterruptedAttackReferencedBattleEntityIds(
  state: GameState
): Set<string> {
  const referenced = new Set<string>();
  for (
    let extra = state.extraTurnState;
    extra;
    extra = extra.returnContext?.extraTurnState ?? null
  ) {
    if (extra.deferredStart === true) continue;
    for (const id of getActiveAttackReferencedBattleEntityIds(
      extra.returnContext?.activeAttack ?? null
    )) {
      referenced.add(id);
    }
  }
  return referenced;
}

export function removeBattleEntityMembersAndRecompute(
  state: GameState,
  memberInstanceIds: readonly string[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  if (memberInstanceIds.length === 0 || state.battleEntities.length === 0) {
    return state;
  }

  // Q17092 / 10_rules/02: removing a combatant never ends an established
  // battle. Zone moves, soul state, continuous rebuilds and brave separation
  // all retain its identity until the battle-end pipeline finalizes.
  const preserveEmptyEntityIds =
    getInterruptedAttackReferencedBattleEntityIds(state);
  for (const id of getActiveAttackReferencedBattleEntityIds(
    state.activeAttack
  )) {
    preserveEmptyEntityIds.add(id);
  }
  // 合体先離脱後のスピリット状態で攻防不可になったブレイヴも除く。
  // 参加可能な残留ブレイヴは、攻撃側・防御側とも選択なしで継続する。
  const removed = new Set([
    ...memberInstanceIds,
    ...getBattleEntityMemberIdsInvalidatedByState(state, getCardDefinitionById),
  ]);
  let changed = false;
  const battleEntities = state.battleEntities
    .map((entity) => {
      const remainingMembers = entity.memberInstanceIds.filter(
        (id) => !removed.has(id)
      );
      const nextMembers = remainingMembers.filter((id) =>
        isCurrentCombatMember(
          state,
          { memberInstanceIds: remainingMembers },
          id
        )
      );
      if (nextMembers.length === entity.memberInstanceIds.length) {
        return entity;
      }
      changed = true;
      const preserveEntity = preserveEmptyEntityIds.has(entity.entityId);
      if (nextMembers.length === 0 && preserveEntity) {
        const leftFieldMemberInstanceIds = [
          ...(entity.leftFieldMemberInstanceIds ?? []),
        ];
        for (const memberId of entity.memberInstanceIds) {
          if (
            !nextMembers.includes(memberId) &&
            !leftFieldMemberInstanceIds.includes(memberId)
          ) {
            leftFieldMemberInstanceIds.push(memberId);
          }
        }
        return {
          ...entity,
          memberInstanceIds: [],
          ...(leftFieldMemberInstanceIds.length > 0
            ? { leftFieldMemberInstanceIds }
            : {}),
          resolvedBp: 0,
          resolvedSymbols: [],
          resolvedSymbolCount: 0,
        };
      }
      return { ...entity, memberInstanceIds: nextMembers };
    })
    .filter(
      (entity) =>
        entity.memberInstanceIds.length > 0 ||
        preserveEmptyEntityIds.has(entity.entityId)
    );

  if (!changed) return state;

  const battleEntityIds = new Set(
    battleEntities.map((entity) => entity.entityId)
  );
  const pendingBraveAttackContinuation =
    state.pendingBraveAttackContinuation === null
      ? null
      : battleEntityIds.has(state.pendingBraveAttackContinuation.entityId)
        ? {
            ...state.pendingBraveAttackContinuation,
            braveInstanceIds:
              state.pendingBraveAttackContinuation.braveInstanceIds.filter(
                (id) => !removed.has(id)
              ),
          }
        : null;

  return recomputeBattleEntityBp(
    {
      ...state,
      battleEntities,
      pendingBraveAttackContinuation:
        pendingBraveAttackContinuation &&
        pendingBraveAttackContinuation.braveInstanceIds.length > 0
          ? pendingBraveAttackContinuation
          : null,
    },
    getCardDefinitionById
  );
}

/**
 * Clear transient attack/block markers once an attack has ended.
 *
 * Field members remain available for subsequent attacks, while empty shells
 * retained during an active battle are discarded with their attack state.
 */
export function resetBattleEntitiesAfterAttackEnd(
  state: GameState
): BattleEntity[] {
  // 今終わるバトルは整理するが、追加ターンから戻る中断元はまだ終了していない。
  const interruptedEntityIds =
    getInterruptedAttackReferencedBattleEntityIds(state);
  const survivingFieldCardIds = new Set(
    state.cardInstances
      .filter(
        (cardInstance) =>
          cardInstance.zone === "field" &&
          cardInstance.pendingLeaveKind === null
      )
      .map((cardInstance) => cardInstance.instanceId)
  );

  const nextBattleEntities: BattleEntity[] = [];
  for (const battleEntity of state.battleEntities) {
    if (interruptedEntityIds.has(battleEntity.entityId)) {
      nextBattleEntities.push(battleEntity);
      continue;
    }
    const survivingMemberIds = battleEntity.memberInstanceIds.filter(
      (memberInstanceId) => survivingFieldCardIds.has(memberInstanceId)
    );
    if (survivingMemberIds.length === 0) continue;

    const resetBattleEntity: BattleEntity = {
      ...battleEntity,
      memberInstanceIds: survivingMemberIds,
      attackState: "idle",
    };
    delete resetBattleEntity.leftFieldMemberInstanceIds;
    nextBattleEntities.push(resetBattleEntity);
  }

  return nextBattleEntities;
}

export function getBattleEntityByMemberInstanceId(
  state: GameState,
  sourceInstanceId: string
): BattleEntity | undefined {
  return state.battleEntities.find((battleEntity) =>
    battleEntity.memberInstanceIds.includes(sourceInstanceId)
  );
}

export function getBattleEntityById(
  state: GameState,
  entityId: string
): BattleEntity | undefined {
  return state.battleEntities.find(
    (battleEntity) => battleEntity.entityId === entityId
  );
}

export function getBattleEntityBattleEndMemberInstanceIds(
  battleEntity: Pick<
    BattleEntity,
    "memberInstanceIds" | "leftFieldMemberInstanceIds"
  >
): string[] {
  return battleEntity.memberInstanceIds.length > 0
    ? [...battleEntity.memberInstanceIds]
    : [...(battleEntity.leftFieldMemberInstanceIds ?? [])];
}

export function createBattleResolutionEntitySnapshot(
  battleEntity: BattleEntity
): BattleResolutionEntitySnapshot {
  const memberInstanceIds =
    getBattleEntityBattleEndMemberInstanceIds(battleEntity);
  return {
    entityId: battleEntity.entityId,
    memberInstanceIds,
    resolvedBp: battleEntity.resolvedBp,
    resolvedSymbols: [...battleEntity.resolvedSymbols],
    ...(battleEntity.resolvedSymbolCount !== undefined
      ? { resolvedSymbolCount: battleEntity.resolvedSymbolCount }
      : {}),
  };
}

export function battleEntityHasNoFieldReadyMember(
  state: GameState,
  entityId: string
): boolean {
  const entity = getBattleEntityById(state, entityId);
  if (!entity) return false;
  return !entity.memberInstanceIds.some((memberInstanceId) => {
    const card = getCardById(state, memberInstanceId);
    return card?.zone === "field" && card.pendingLeaveKind === null;
  });
}

export function getAttackEntityId(
  state: GameState,
  sourceInstanceId: string
): string {
  return (
    getBattleEntityByMemberInstanceId(state, sourceInstanceId)?.entityId ??
    `battle-entity:${sourceInstanceId}`
  );
}

function createActiveAttackId(
  state: GameState,
  primaryEntityId: string
): string {
  return `attack-group:${state.turnNumber}:${state.activePlayerId}:${primaryEntityId}`;
}

function getDefaultAttackTarget(
  state: GameState,
  actingPlayerId: string
): ActiveAttackTarget {
  const playerIndex = state.playerOrder.indexOf(actingPlayerId);

  if (playerIndex === -1) {
    throw new Error(
      `Acting player is not part of playerOrder: ${actingPlayerId}`
    );
  }

  if (state.playerOrder.length < 2) {
    throw new Error("activeAttack requires at least two players");
  }

  const defendingPlayerId =
    state.playerOrder[(playerIndex + 1) % state.playerOrder.length];

  if (!defendingPlayerId) {
    throw new Error("Could not resolve the defending player for activeAttack");
  }

  return {
    kind: "player",
    playerId: defendingPlayerId,
  };
}

function createUnblockedAssignments(
  participantEntityIds: readonly string[]
): ActiveAttackBlockAssignment[] {
  return participantEntityIds.map((participantEntityId) => ({
    participantEntityId,
    blockedByEntityIds: [],
  }));
}

export function mergeBlockAssignments(options: {
  existingAssignments: readonly ActiveAttackBlockAssignment[];
  participantEntityIds: readonly string[];
}): ActiveAttackBlockAssignment[] {
  const existingAssignmentsByParticipantId = new Map(
    options.existingAssignments.map((assignment) => [
      assignment.participantEntityId,
      assignment,
    ])
  );

  return options.participantEntityIds.map(
    (participantEntityId) =>
      existingAssignmentsByParticipantId.get(participantEntityId) ?? {
        participantEntityId,
        blockedByEntityIds: [],
      }
  );
}

export function createActiveAttack(
  state: GameState,
  primaryEntityId: string,
  actingPlayerId: string
): ActiveAttack {
  return {
    attackId: createActiveAttackId(state, primaryEntityId),
    primaryEntityId,
    participantEntityIds: [primaryEntityId],
    groupMode: "single",
    target: getDefaultAttackTarget(state, actingPlayerId),
    blockAssignments: createUnblockedAssignments([primaryEntityId]),
    symbolResolutionOrder: [primaryEntityId],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
}

export function getActiveAttackBattleEntities(
  state: GameState
): BattleEntity[] {
  if (!state.activeAttack) {
    return [];
  }

  return state.activeAttack.participantEntityIds
    .map((entityId) => getBattleEntityById(state, entityId))
    .filter((battleEntity): battleEntity is BattleEntity =>
      Boolean(battleEntity)
    );
}

export function canStartBattleResolutionInWindow(
  window: GameState["window"]
): boolean {
  return window === "declare_attack" || window === "declare_block";
}

export function createBattleResolutionGroup(
  state: GameState
): BattleResolutionGroup {
  const activeAttack = state.activeAttack;

  if (!activeAttack) {
    throw new Error("Cannot create battleResolutionGroup without activeAttack");
  }

  const participantSnapshots: BattleResolutionParticipantSnapshot[] =
    activeAttack.participantEntityIds.map((participantEntityId) => {
      const participantBattleEntity = getBattleEntityById(
        state,
        participantEntityId
      );

      if (!participantBattleEntity) {
        throw new Error(
          `Missing battle entity for battleResolutionGroup participant: ${participantEntityId}`
        );
      }

      const assignment = activeAttack.blockAssignments.find(
        (currentAssignment) =>
          currentAssignment.participantEntityId === participantEntityId
      );

      if (!assignment) {
        throw new Error(
          `Missing block assignment for battleResolutionGroup participant: ${participantEntityId}`
        );
      }

      const blockedBy = assignment.blockedByEntityIds.map((blockerEntityId) => {
        const blocker = getBattleEntityById(state, blockerEntityId);
        if (!blocker) {
          throw new Error(
            `Missing blocker battle entity for battleResolutionGroup participant: ${participantEntityId}`
          );
        }
        return createBattleResolutionEntitySnapshot(blocker);
      });

      return {
        ...createBattleResolutionEntitySnapshot(participantBattleEntity),
        blockedBy,
      };
    });

  return {
    attackId: activeAttack.attackId,
    groupMode: activeAttack.groupMode,
    target:
      activeAttack.target.kind === "player"
        ? {
            kind: "player",
            playerId: activeAttack.target.playerId,
          }
        : {
            kind: "battle_entity",
            entityId: activeAttack.target.entityId,
          },
    symbolResolutionOrder: [...activeAttack.symbolResolutionOrder],
    participantSnapshots,
  };
}

export function getOrCreateCombatBattleEntity(options: {
  state: GameState;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): BattleEntity {
  const memberInstanceIds = getCurrentCombatMemberInstanceIds(
    options.state,
    options.sourceCard,
    options.getCardDefinitionById
  );
  const cardInstancesById = new Map(
    options.state.cardInstances.map((c) => [c.instanceId, c])
  );
  const buildEntity = (
    base: Pick<BattleEntity, "entityId" | "attackState">
  ) => {
    const entity: BattleEntity = {
      ...base,
      memberInstanceIds,
      // BP / シンボルとも recomputeBattleEntityBp と同一の実効値で初期化する。
      // 印字シンボル直読みだと合体スピリットがブレイヴ分のシンボル (= ライフ) を
      // 失い、recompute が走らないアタック (アタック時効果なし) で過少になる。
      // BP も合体スピリットはブレイヴの BP＋ を含めた実効値で初期化する。
      resolvedBp: getCombinedUnitBp(
        options.state,
        options.sourceCard,
        options.sourceDefinition,
        options.getCardDefinitionById
      ),
      resolvedSymbols: [],
    };
    entity.resolvedSymbols = getEffectiveSymbolsForEntity(
      options.state,
      entity,
      cardInstancesById,
      options.getCardDefinitionById
    );
    entity.resolvedSymbolCount = getEffectiveSymbolBundlesForEntity(
      options.state,
      entity,
      cardInstancesById,
      options.getCardDefinitionById
    ).reduce((sum, bundle) => sum + bundle.count, 0);
    return entity;
  };

  const existingBattleEntity = getBattleEntityByMemberInstanceId(
    options.state,
    options.sourceCard.instanceId
  );

  if (existingBattleEntity) {
    return buildEntity(existingBattleEntity);
  }

  return buildEntity({
    entityId: getAttackEntityId(options.state, options.sourceCard.instanceId),
    attackState: "idle",
  });
}

function getCurrentCombatMemberInstanceIds(
  state: GameState,
  sourceCard: CardInstance,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): string[] {
  // 合体スピリットの場合、ホストとブレイヴの両方を member に含める。
  // ホスト破壊後にブレイヴがアタック継続できるようにするため。
  const memberInstanceIds = [sourceCard.instanceId];
  for (const brave of getCombinedUnitBraveChildren(
    state,
    sourceCard,
    getCardDefinitionById
  )) {
    if (memberInstanceIds.includes(brave.instanceId)) continue;
    memberInstanceIds.push(brave.instanceId);
  }
  return memberInstanceIds.filter((id) =>
    isCurrentCombatMember(state, { memberInstanceIds }, id)
  );
}

export function canDeclareBlockInWindow(window: GameState["window"]): boolean {
  return window === "declare_attack" || window === "declare_block";
}

export function getActiveAttackAssignment(
  state: GameState,
  participantEntityId: string
): ActiveAttackBlockAssignment | undefined {
  return state.activeAttack?.blockAssignments.find(
    (assignment) => assignment.participantEntityId === participantEntityId
  );
}

export function isEntityAssignedAsBlocker(
  state: GameState,
  blockerEntityId: string
): boolean {
  return (
    state.activeAttack?.blockAssignments.some((assignment) =>
      assignment.blockedByEntityIds.includes(blockerEntityId)
    ) ?? false
  );
}
