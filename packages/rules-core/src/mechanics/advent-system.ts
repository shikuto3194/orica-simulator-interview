import { replaceCardInstances } from "../zone/card-instance-state";
import { isCardInEffectZone } from "../effect/card-access-rules";
/**
 * 煌臨システム。
 * 手札からソウルコアを消費してフィールドのスピリット/アルティメットの上にカードを重ねる。
 * 召喚ではない。
 */
import { transferUnderCards } from "./under-card-transfer";
import type {
  ActiveStack,
  AdventCondition,
  AdventData,
  AdventTimingWindow,
  CardCategory,
  CardColor,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
  PendingAsIfSoulCoreChoiceOption,
  SymbolColor,
} from "../model";
import {
  getHostGrantedAdventChoiceOptions,
  resolveDeferredHostGrantedAdventStack,
} from "./host-dual-advent";
import { collectAndQueueTriggerReactions } from "../effect/trigger-system";
import { checkAndQueueOracleChoicesForTriggerBatch } from "./oracle-system";
import { buildChargeCoresPendingCoreDistribution } from "./core-charge-distribution";
import type { DeferredStackResolverOptions } from "../legal/stack-resolution-types";
import {
  adventSourceIdsOf,
  collectUnderCardScopeIds,
  stripAdventSourceUnderCardReference,
} from "../model";
import { getCardById, isPlayersContractCard } from "../card/card-lookup";
import {
  isContractDefinition,
  matchesCardFilter,
  matchesCardName,
  matchesTribes,
} from "../card/card-filter";
import {
  getEffectiveBp,
  getEffectiveLevel,
  removeBattleEntityMembersAndRecompute,
  recomputeBattleEntityBp,
} from "../battle/battle-shared";
import { matchesBraveConditionForCard } from "../legal/legal-actions-shared";
import { hasCannotAdventRestriction } from "./act-as-spirit";
import { getCEsForTarget, getGlobalCEs } from "../card/ce-lookup";
import { hasContractAdventEligibilityGrant } from "./advent-variant";
import { evaluateCondition } from "../effect/structured-condition-eval";
import {
  isSoulCoreOn,
  moveCardZone,
  resolveCardLeavesFieldCores,
  updateCard,
  updatePlayer,
  moveSoulCore,
  withSoulCoreLocation,
} from "../core/core-system";

/**
 * targetCard に適用中の `advent_cost_override` CE（BSTH02-C03 Lv2 等）から
 * 実効コスト候補を返す。`AdventCondition.minCost` 判定専用（他のコスト判定には
 * 影響しない）。「自分が煌臨するとき」スコープは、target が既に煌臨実行プレイヤーの
 * フィールドカードに絞られていること + targetFilter.player の解決が
 * targetCard.controllerPlayerId と一致することで自然に閉じる (legal-actions-shared.ts
 * の matchesGlobalCETargetFilter と同型ロジックだが import 循環回避のためここで独立実装)。
 */
function getAdventCostOverrides(
  state: GameState,
  targetCard: CardInstance,
  targetDef: CardDefinition
): number[] {
  const instanceCEs = getCEsForTarget(state, targetCard.instanceId).filter(
    (ce) => ce.modifierTag === "advent_cost_override"
  );
  const globalCEs = getGlobalCEs(state).filter((ce) => {
    if (ce.modifierTag !== "advent_cost_override") return false;
    const f = ce.targetFilter;
    if (!f) return false;
    if (f.player !== "either") {
      const filterPlayerId =
        f.player === "self"
          ? ce.actingPlayerId
          : state.players.find((p) => p.id !== ce.actingPlayerId)?.id;
      if (!filterPlayerId || targetCard.controllerPlayerId !== filterPlayerId) {
        return false;
      }
    }
    const { player: _player, ...cardFilter } = f;
    void _player;
    return matchesCardFilter(targetCard, targetDef, cardFilter, {
      state,
      effectiveLevel: getEffectiveLevel(state, targetCard, targetDef),
    });
  });
  return [...instanceCEs, ...globalCEs]
    .map((ce) => ce.modifierAmount)
    .filter((v): v is number => v !== undefined);
}

function retargetAdventInheritedContinuousEffects(
  effects: readonly ContinuousEffect[],
  targetInstanceId: string,
  adventCardInstanceId: string
): ContinuousEffect[] {
  return effects
    .map((ce) => {
      if (ce.targetInstanceId === targetInstanceId) {
        if (hasDurationScope(ce)) {
          return { ...ce, targetInstanceId: adventCardInstanceId };
        }
        return null;
      }
      if (ce.sourceInstanceId === targetInstanceId && hasDurationScope(ce)) {
        return { ...ce, sourceInstanceId: adventCardInstanceId };
      }
      return ce;
    })
    .filter((ce): ce is ContinuousEffect => ce !== null);
}

// ---------------------------------------------------------------------------
// 条件判定
// ---------------------------------------------------------------------------

/**
 * カードカテゴリを煌臨条件の targetCategory と照合する。
 */
function categoryMatchesAdvent(
  category: CardCategory,
  targetCategory: ("spirit" | "ultimate" | "nexus")[]
): boolean {
  if ((targetCategory as readonly CardCategory[]).includes(category))
    return true;
  // ブレイヴは煌臨先にならない（スピリット扱いブレイヴも不可）
  return false;
}

function isAdventTargetCategory(
  category: CardCategory
): category is "spirit" | "ultimate" | "nexus" {
  return (
    category === "spirit" || category === "ultimate" || category === "nexus"
  );
}

function withSoulStateCategoryRelaxed(
  condition: AdventCondition,
  targetDef: CardDefinition
): AdventCondition {
  const category = targetDef.printedCategory;
  if (
    !isAdventTargetCategory(category) ||
    condition.targetCategory.includes(category)
  ) {
    return condition;
  }
  return {
    ...condition,
    targetCategory: [...condition.targetCategory, category],
  };
}

/**
 * フィールドカードが煌臨条件を満たすか判定する。
 * 合体ブレイヴのステータスも含めて評価する。
 */
export function matchesAdventCondition(
  targetCard: CardInstance,
  targetDef: CardDefinition,
  condition: AdventCondition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  state: GameState
): boolean {
  // engine-deck-derived-clone-spirit: 「煌臨できず」制約 (BSAZ02-C07 分身スピリット)。
  if (hasCannotAdventRestriction(state, targetCard.instanceId)) return false;

  // カテゴリチェック
  if (
    !categoryMatchesAdvent(targetDef.printedCategory, condition.targetCategory)
  ) {
    return false;
  }

  if (
    condition.adventState === "advented" &&
    adventSourceIdsOf(targetCard).length === 0
  ) {
    return false;
  }

  // 合体ブレイヴの定義を取得（色・コスト・系統判定に使用）
  const braveColors: CardColor[] = [];
  const braveTribes: string[] = [];
  if (targetCard.attachedChildrenIds.length > 0) {
    for (const braveId of targetCard.attachedChildrenIds) {
      const braveCard = getCardById(state, braveId);
      if (braveCard) {
        const braveDef = getCardDefinitionById(braveCard.definitionId);
        if (braveDef) {
          braveColors.push(...braveDef.colors);
          if (braveDef.tribe) {
            braveTribes.push(...braveDef.tribe.split("・"));
          }
        }
      }
    }
  }

  // 色条件（合体ブレイヴ含む）
  if (condition.colors && condition.colors.length > 0) {
    const allColors = [...targetDef.colors, ...braveColors];
    if (!condition.colors.some((c) => allColors.includes(c))) {
      return false;
    }
  }

  // コスト条件（advent_cost_override CE で「コストはXとしても扱う」付与を含めて判定）
  if (condition.minCost !== undefined) {
    const costs = [
      targetDef.cost,
      ...getAdventCostOverrides(state, targetCard, targetDef),
    ];
    if (!costs.some((c) => c >= condition.minCost!)) return false;
  }

  // 系統条件（合体ブレイヴ含む）
  if (condition.tribes && condition.tribes.length > 0) {
    const baseParts = targetDef.tribe ? targetDef.tribe.split("・") : [];
    const allParts = [...baseParts, ...braveTribes];
    const combinedTribe = allParts.join("・");
    if (
      !matchesTribes(combinedTribe, {
        tribes: condition.tribes,
        ...(condition.tribesLogic
          ? { tribesLogic: condition.tribesLogic }
          : {}),
      })
    ) {
      return false;
    }
  }

  // カード名条件（煌臨先 host の名前指定。「『孫悟空』」等）。
  // 名前は host 本体の印字名で判定する（合体ブレイヴ名は対象外）。
  if (condition.cardNames && condition.cardNames.length > 0) {
    if (!matchesCardName(targetDef.name, condition.cardNames, undefined)) {
      return false;
    }
  }

  // 「契約スピリット」条件（isContractDefinition SSOT、card-filter.ts）。
  if (condition.isContract && !isContractDefinition(targetDef)) {
    return false;
  }

  return true;
}

/**
 * プレイヤーのソウルコアが使用可能か判定する。
 * ソウルコアはフィールド/リザーブ/ライフから使用可能。
 */
export function hasSoulCoreAvailable(
  state: GameState,
  playerId: string,
  options: { dest?: "trash" | "removed_from_game" | "this_card" } = {}
): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.soulCoreLocation) return false;

  const loc = player.soulCoreLocation;
  if (options.dest === "this_card" && loc.kind === "trash") return true;
  return loc.kind === "reserve" || loc.kind === "life" || loc.kind === "card";
}

export function getAdventDeclareUsageKey(definition: CardDefinition): string {
  return `name:${definition.name}`;
}

export interface AdventTimingContext {
  sourceInMainTiming: boolean;
  sourceInFlashTiming: boolean;
  inBattleFlashWindow: boolean;
  isActivePlayer: boolean;
}

export function adventTimingWindowAllowed(
  timing: AdventTimingWindow,
  ctx: AdventTimingContext
): boolean {
  switch (timing) {
    case "main_and_flash":
      return ctx.sourceInMainTiming || ctx.sourceInFlashTiming;
    case "own_attack_step":
      return (
        ctx.sourceInFlashTiming && ctx.inBattleFlashWindow && ctx.isActivePlayer
      );
    case "opponent_attack_step":
      return (
        ctx.sourceInFlashTiming &&
        ctx.inBattleFlashWindow &&
        !ctx.isActivePlayer
      );
    case "own_turn":
      return (
        ctx.isActivePlayer &&
        (ctx.sourceInMainTiming || ctx.sourceInFlashTiming)
      );
    case "both_attack_step":
      return ctx.sourceInFlashTiming && ctx.inBattleFlashWindow;
  }
}

function adventTimingContextFromState(
  state: GameState,
  actingPlayerId: string
): AdventTimingContext {
  const isActivePlayer = state.activePlayerId === actingPlayerId;
  const inBattleFlashWindow = state.activeAttack?.flashWindowState != null;
  return {
    sourceInMainTiming:
      state.step === "main" && isActivePlayer && !inBattleFlashWindow,
    sourceInFlashTiming: inBattleFlashWindow,
    inBattleFlashWindow,
    isActivePlayer,
  };
}

export function getAdventAsIfSoulCoreChoiceOptions(
  state: GameState,
  stack: ActiveStack,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): PendingAsIfSoulCoreChoiceOption[] {
  if (stack.actionKind !== "declare_advent") return [];
  const sourceCard = getCardById(state, stack.cardInstanceId);
  const sourceDefinition = getCardDefinitionById(stack.cardDefinitionId);
  const adventData = sourceDefinition?.adventData;
  const hostOptions = getHostGrantedAdventChoiceOptions(
    state,
    stack.cardInstanceId,
    stack.actingPlayerId,
    getCardDefinitionById
  );
  const grantedOptions: PendingAsIfSoulCoreChoiceOption[] = hostOptions.filter(
    (option) => option.useAlternateCost
  );
  if (hostOptions.some((option) => !option.useAlternateCost)) {
    grantedOptions.unshift({
      choiceId: "normal",
      label: "ソウルコアを置いて煌臨",
      useAlternateCost: false,
    });
  }
  if (!sourceCard || !sourceDefinition || !adventData) return grantedOptions;

  const sourceZone = adventData.adventSourceZone ?? "hand";
  if (
    !isCardInEffectZone(
      state,
      sourceCard,
      [sourceZone],
      stack.actingPlayerId,
      getCardDefinitionById
    ) ||
    sourceCard.controllerPlayerId !== stack.actingPlayerId
  ) {
    return grantedOptions;
  }

  const declareConditionMet =
    !adventData.declareCondition ||
    adventData.declareCondition.length === 0 ||
    evaluateCondition(
      state,
      adventData.declareCondition,
      sourceCard.instanceId,
      stack.actingPlayerId,
      getCardDefinitionById
    );
  if (!declareConditionMet) return grantedOptions;

  const options: PendingAsIfSoulCoreChoiceOption[] = [...grantedOptions];
  const timingContext = adventTimingContextFromState(
    state,
    stack.actingPlayerId
  );
  if (
    !options.some((option) => option.choiceId === "normal") &&
    adventTimingWindowAllowed(adventData.adventTiming, timingContext) &&
    hasSoulCoreAvailable(state, stack.actingPlayerId, {
      dest: adventData.soulCoreDest,
    })
  ) {
    options.push({
      choiceId: "normal",
      label: "ソウルコアを置いて煌臨",
      useAlternateCost: false,
    });
  }

  if (
    adventData.alternateCostAdvent !== undefined &&
    adventTimingWindowAllowed(
      adventData.alternateCostAdvent.timing,
      timingContext
    ) &&
    !state.usedAlternateCostAdventKeysThisTurn.includes(
      getAdventDeclareUsageKey(sourceDefinition)
    ) &&
    evaluateCondition(
      state,
      adventData.alternateCostAdvent.condition,
      sourceCard.instanceId,
      stack.actingPlayerId,
      getCardDefinitionById
    )
  ) {
    options.push({
      choiceId: "alternate",
      label: "置いたものとして煌臨",
      useAlternateCost: true,
    });
  }

  return options;
}

/**
 * targetCard (+ その上に重なっている煌臨元スタック全体) が host 側 exclusive-lock
 * (`HostDualAdventGrant.exclusiveToSlots`、BSDB01-CX01) で保護されているか判定する。
 * 保護中のスタックへは、いずれかの host の `slots.cardNames` に一致するカード
 * (孫悟空/ベジータ) のみが煌臨/合体/入れ替えできる。`incomingCardDef` 省略時
 * (呼び出し元が対象カードを特定できない経路) は安全側 (=保護中なら常に除外) に倒す。
 * 煌臨 (このファイル) / 合体 (legal-actions-availability.ts の brave-combine /
 * contract-combine 列挙) / 入れ替え (同ファイルの brave-swap 列挙、
 * accel-change-system.ts の change-swap 列挙) の 5 subsystem 横断で共有する SSOT
 * (BSDB01-CX01「重なったカードを含むこれらには対象以外を合体/煌臨/入れ替えできない」)。
 */
export function isExcludedByHostExclusiveLock(
  state: GameState,
  targetCard: CardInstance,
  incomingCardDef: CardDefinition | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const towerInstanceIds = [
    targetCard.instanceId,
    ...adventSourceIdsOf(targetCard),
  ];
  for (const instanceId of towerInstanceIds) {
    const towerCard =
      instanceId === targetCard.instanceId
        ? targetCard
        : getCardById(state, instanceId);
    if (!towerCard) continue;
    const towerDef = getCardDefinitionById(towerCard.definitionId);
    const grant = towerDef?.hostDualAdventGrant;
    if (!grant?.exclusiveToSlots) continue;
    if (!incomingCardDef) return true;
    const isExempt = grant.slots.some((slot) =>
      matchesCardName(incomingCardDef.name, [...slot.cardNames], undefined)
    );
    if (!isExempt) return true;
  }
  return false;
}

/** ソウルコアの実支払いで煌臨先が消滅する場合だけ除外する (08a §1、公式 Q17101)。 */
export function canAdventTargetSurvivePayment(
  state: GameState,
  target: CardInstance,
  useAlternateCost = false
): boolean {
  return (
    useAlternateCost ||
    target.normalCoreCount > 0 ||
    !isSoulCoreOn(state, target.instanceId)
  );
}

/**
 * 煌臨可能なフィールドカードをリストアップする。
 * ソウルコアのみの対象は実支払いで消滅する場合に除外する。擬制支払いなら残る。
 */
function canUseTrashAdventHost(
  state: GameState,
  card: CardInstance,
  adventCardDef: CardDefinition | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const def = getCardDefinitionById(card.definitionId);
  const grant = def?.trashAdventHostGrant;
  return (
    card.zone === "trash" &&
    grant !== undefined &&
    adventCardDef !== undefined &&
    !state.usedTrashAdventKeysThisTurn.includes(
      card.controllerPlayerId + ":" + def!.name
    ) &&
    matchesCardName(adventCardDef.name, grant.cardNames, undefined)
  );
}

function trashHostRequiresCoreCharge(
  state: GameState,
  targetId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const host = getCardById(state, targetId);
  return (
    host?.zone === "trash" &&
    getCardDefinitionById(host.definitionId)?.trashAdventHostGrant
      ?.chargeCoresOnAdvent === true
  );
}

export function getAdventTargets(
  state: GameState,
  actingPlayerId: string,
  adventData: AdventData,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  adventCardDef?: CardDefinition,
  useAlternateCost = false
): CardInstance[] {
  const underCardScopeIds = collectUnderCardScopeIds(state);
  return state.cardInstances.filter((card) => {
    if (
      card.zone !== "field" &&
      !canUseTrashAdventHost(state, card, adventCardDef, getCardDefinitionById)
    )
      return false;
    if (card.controllerPlayerId !== actingPlayerId) return false;
    if (underCardScopeIds.textRole.has(card.instanceId)) return false;
    if (
      underCardScopeIds.adventSource.has(card.instanceId) &&
      adventData.includeAdventSourceTarget !== true
    )
      return false;

    const def = getCardDefinitionById(card.definitionId);
    if (!def) return false;

    if (!canAdventTargetSurvivePayment(state, card, useAlternateCost))
      return false;

    // 魂状態のカードには通常の煌臨は不可（契約煌臨のみ可能）
    const player = state.players.find((p) => p.id === actingPlayerId);
    if (player?.soulStateInstanceIds.includes(card.instanceId)) return false;

    if (
      isExcludedByHostExclusiveLock(
        state,
        card,
        adventCardDef,
        getCardDefinitionById
      )
    )
      return false;

    return matchesAdventCondition(
      card,
      def,
      adventData.adventCondition,
      getCardDefinitionById,
      state
    );
  });
}

/**
 * 対象カードが override_properties CE で「【契約煌臨】を持っているものとして扱う」
 * (`properties.grantsContractAdventEligibility`) を付与されているか。
 * BSKB01-R02 effects[0]「このカード/スピリットは【契約煌臨】を持っているものとして扱う」の
 * SSOT。魂状態時の契約煌臨対象資格判定 (`isPlayersContractCard` 一致) に OR 合成する
 * (getContractAdventTargets 宣言時 / executeAdvent 解決時再検証、両方で参照する)。
 */
export { hasContractAdventEligibilityGrant } from "./advent-variant";

/**
 * 契約煌臨可能なターゲットをリストアップする。
 * 通常の煌臨ターゲットに加え、魂状態のカードも対象に含む。
 */
export function getContractAdventTargets(
  state: GameState,
  actingPlayerId: string,
  adventData: AdventData,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  adventCardDef?: CardDefinition,
  useAlternateCost = false
): CardInstance[] {
  // 通常ターゲット
  const normalTargets = getAdventTargets(
    state,
    actingPlayerId,
    adventData,
    getCardDefinitionById,
    adventCardDef,
    useAlternateCost
  );

  // 魂状態のカードも追加（契約カードのみ）
  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) return normalTargets;

  const underCardScopeIds = collectUnderCardScopeIds(state);
  const soulTargets = state.cardInstances.filter((card) => {
    if (card.zone !== "field") return false;
    if (card.controllerPlayerId !== actingPlayerId) return false;
    if (underCardScopeIds.textRole.has(card.instanceId)) return false;
    if (underCardScopeIds.adventSource.has(card.instanceId)) return false;
    if (!player.soulStateInstanceIds.includes(card.instanceId)) return false;

    // engine-deck-derived-clone-spirit: 「煌臨できず」制約 (matchesAdventCondition を
    // 通らないため個別判定、round2 adversarial verifier refute 対応)。
    if (hasCannotAdventRestriction(state, card.instanceId)) return false;

    if (
      isExcludedByHostExclusiveLock(
        state,
        card,
        adventCardDef,
        getCardDefinitionById
      )
    )
      return false;

    // 魂状態のカードは契約カード、または契約煌臨対象資格の付与 (BSKB01-R02) を
    // 受けたカードのみ煌臨可能
    if (
      !isPlayersContractCard(card, player.contractCardNo) &&
      !hasContractAdventEligibilityGrant(state, card.instanceId)
    )
      return false;

    const def = getCardDefinitionById(card.definitionId);
    if (!def) return false;
    // 魂状態はスピリット等として参照できないためカテゴリだけ緩和し、
    // cardNames / minCost / colors / tribes などの煌臨条件は通常経路と共有する。
    return matchesAdventCondition(
      card,
      def,
      withSoulStateCategoryRelaxed(adventData.adventCondition, def),
      getCardDefinitionById,
      state
    );
  });

  return [...normalTargets, ...soulTargets];
}

/**
 * F契約煌臨可能なターゲットをリストアップする。
 * 契約煌臨ターゲットに加え、ネクサスも対象に含む。
 */
export function getFContractAdventTargets(
  state: GameState,
  actingPlayerId: string,
  adventData: AdventData,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  adventCardDef?: CardDefinition,
  useAlternateCost = false
): CardInstance[] {
  // 契約煌臨ターゲット（魂状態含む）
  const contractTargets = getContractAdventTargets(
    state,
    actingPlayerId,
    adventData,
    getCardDefinitionById,
    adventCardDef,
    useAlternateCost
  );

  // F契約煌臨はネクサスにも煌臨可能
  const underCardScopeIds = collectUnderCardScopeIds(state);
  const nexusTargets = state.cardInstances.filter((card) => {
    if (card.zone !== "field") return false;
    if (card.controllerPlayerId !== actingPlayerId) return false;
    if (underCardScopeIds.textRole.has(card.instanceId)) return false;
    if (underCardScopeIds.adventSource.has(card.instanceId)) return false;

    const def = getCardDefinitionById(card.definitionId);
    if (!def || def.printedCategory !== "nexus") return false;

    // 既にcontractTargetsに含まれている場合はスキップ
    if (contractTargets.some((t) => t.instanceId === card.instanceId))
      return false;

    if (
      isExcludedByHostExclusiveLock(
        state,
        card,
        adventCardDef,
        getCardDefinitionById
      )
    )
      return false;

    // 条件チェック（色・コスト・系統）は煌臨条件で判定
    const extendedCondition: AdventCondition = {
      ...adventData.adventCondition,
      targetCategory: [...adventData.adventCondition.targetCategory, "nexus"],
    };
    return matchesAdventCondition(
      card,
      def,
      extendedCondition,
      getCardDefinitionById,
      state
    );
  });

  return [...contractTargets, ...nexusTargets];
}

// ---------------------------------------------------------------------------
// 煌臨実行
// ---------------------------------------------------------------------------

export interface AdventParams {
  /** 煌臨前に追加するカードの選択済みID。未指定時のみ選択を提示する。 */
  selectedSourceIds?: string[] | undefined;
  /** 煌臨するカード（手札）の instanceId */
  adventCardInstanceId: string;
  /** 煌臨先（フィールドカード）の instanceId */
  targetInstanceId: string;
  /** 煌臨カードの AdventData */
  adventData: AdventData;
  /** 契約煌臨かどうか。魂状態への煌臨を許可する */
  isContractAdvent?: boolean;
  /** F契約煌臨かどうか。ネクサスへの煌臨を許可する */
  isFContractAdvent?: boolean;
  /**
   * 代替コスト煌臨 (adventData.alternateCostAdvent、BSSL01-X01[3])。true のとき
   * ソウルコア所持チェック・consumeSoulCore をスキップする（「置いたものとして」＝擬制）。
   */
  useAlternateCost?: boolean;
  /**
   * hostDualAdventGrant のような外部許可で、AdventData 側に
   * includeAdventSourceTarget を持たない合成データでも煌臨元 target を許可する。
   * true でも既存 host の underCards 参照は剥がさない（並行分岐を保持する）。
   */
  allowAdventSourceTarget?: boolean;
}

/**
 * 煌臨を実行する。
 *
 * 処理手順:
 * 1. 手札から公開 → 条件確認
 * 2. 煌臨前の任意追加があれば選択・追加（カードはまだ手札/トラッシュ）
 * 3. ソウルコア消費（スピリット→トラッシュ、アルティメット→除外）
 * 4. 煌臨元の上に重ねる（状態引き継ぎ）
 * 5. 煌臨時効果はトリガーシステムが発火（"advent" CardEventType）
 *
 * @returns 更新後の GameState。煌臨不可能な場合は元の state を返す。
 */
export function executeAdvent(
  state: GameState,
  actingPlayerId: string,
  params: AdventParams,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const {
    adventCardInstanceId,
    targetInstanceId,
    adventData,
    isContractAdvent,
    isFContractAdvent,
    useAlternateCost,
    allowAdventSourceTarget,
  } = params;

  // --- 事前検証 ---

  const adventCard = getCardById(state, adventCardInstanceId);
  if (!adventCard) {
    state.log.push(`advent:${adventCardInstanceId}:card-not-found`);
    return state;
  }

  // 契約煌臨で魂状態への煌臨の場合、手札チェックを緩和
  const player = state.players.find((p) => p.id === actingPlayerId);
  const isSoulStateTarget =
    player?.soulStateInstanceIds.includes(targetInstanceId) ?? false;
  const underCardScopeIds = collectUnderCardScopeIds(state);
  const isAdventSourceTarget =
    underCardScopeIds.adventSource.has(targetInstanceId);
  const isTextRoleUnderCardTarget =
    underCardScopeIds.textRole.has(targetInstanceId);

  // 煌臨元を取り出すゾーン (08a §1 手順1)。既定は手札。
  // トラッシュ起点煌臨 (adventData.adventSourceZone:"trash"、BSAZ01-C01/C02) は
  // トラッシュからこのカードを取り出して重ねる。
  const expectedSourceZone = adventData.adventSourceZone ?? "hand";
  if (
    !isCardInEffectZone(
      state,
      adventCard,
      [expectedSourceZone],
      actingPlayerId,
      getCardDefinitionById
    )
  ) {
    state.log.push(
      `advent:${adventCardInstanceId}:not-in-source-zone:${adventCard.zone}!=${expectedSourceZone}`
    );
    return state;
  }

  let targetCard = getCardById(state, targetInstanceId);
  if (
    !targetCard ||
    (targetCard.zone !== "field" &&
      !canUseTrashAdventHost(
        state,
        targetCard,
        getCardDefinitionById(adventCard.definitionId),
        getCardDefinitionById
      ))
  ) {
    state.log.push(`advent:${adventCardInstanceId}:target-not-on-field`);
    return state;
  }
  if (targetCard.controllerPlayerId !== actingPlayerId) {
    state.log.push(`advent:${adventCardInstanceId}:target-not-controlled`);
    return state;
  }
  if (isTextRoleUnderCardTarget) {
    state.log.push(
      `advent:${adventCardInstanceId}:target-text-role-under-card`
    );
    return state;
  }
  if (
    isAdventSourceTarget &&
    adventData.includeAdventSourceTarget !== true &&
    allowAdventSourceTarget !== true
  ) {
    state.log.push(
      `advent:${adventCardInstanceId}:advent-source-target-not-included`
    );
    return state;
  }

  const adventDef = getCardDefinitionById(adventCard.definitionId);
  const targetDef = getCardDefinitionById(targetCard.definitionId);
  if (!adventDef || !targetDef) {
    state.log.push(`advent:${adventCardInstanceId}:definition-not-found`);
    return state;
  }

  // host 側 exclusive-lock (BSDB01-CX01 hostDualAdventGrant.exclusiveToSlots) の再検証。
  // 宣言〜スタック窓クローズの間に盤面が変わり得るため、対象列挙器 (getAdventTargets 系) と
  // 同じ判定を解決時にも再実行する（魂状態緩和経路の有無に関わらず必ず通す）。
  if (
    isExcludedByHostExclusiveLock(
      state,
      targetCard,
      adventDef,
      getCardDefinitionById
    )
  ) {
    state.log.push(`advent:${adventCardInstanceId}:host-exclusive-lock`);
    return state;
  }

  // 魂状態への煌臨は契約煌臨のみ
  if (isSoulStateTarget && !isContractAdvent) {
    state.log.push(
      `advent:${adventCardInstanceId}:soul-state-target-requires-contract`
    );
    return state;
  }
  if (
    isSoulStateTarget &&
    !isPlayersContractCard(targetCard, player?.contractCardNo) &&
    !hasContractAdventEligibilityGrant(state, targetCard.instanceId)
  ) {
    state.log.push(
      `advent:${adventCardInstanceId}:soul-state-target-not-contract`
    );
    return state;
  }

  if (
    adventData.declareCondition &&
    adventData.declareCondition.length > 0 &&
    !evaluateCondition(
      state,
      adventData.declareCondition,
      adventCardInstanceId,
      actingPlayerId,
      getCardDefinitionById
    )
  ) {
    state.log.push(`advent:${adventCardInstanceId}:declare-condition-not-met`);
    return state;
  }
  if (
    useAlternateCost &&
    adventData.alternateCostAdvent !== undefined &&
    !evaluateCondition(
      state,
      adventData.alternateCostAdvent.condition,
      adventCardInstanceId,
      actingPlayerId,
      getCardDefinitionById
    )
  ) {
    state.log.push(`advent:${adventCardInstanceId}:alternate-cost-not-met`);
    return state;
  }

  // 条件チェック（魂状態の場合はカテゴリチェックのみ緩和）
  // F契約煌臨はネクサスにも煌臨可能 (08a:156) なので、getFContractAdventTargets と
  // 同じく targetCategory に "nexus" を加えてカテゴリ判定を緩和する (列挙器と executor の SSOT)。
  const baseCheckCondition: AdventCondition =
    isFContractAdvent && !isSoulStateTarget
      ? {
          ...adventData.adventCondition,
          targetCategory: [
            ...adventData.adventCondition.targetCategory,
            "nexus",
          ],
        }
      : adventData.adventCondition;
  const checkCondition = isSoulStateTarget
    ? withSoulStateCategoryRelaxed(baseCheckCondition, targetDef)
    : baseCheckCondition;
  if (
    !matchesAdventCondition(
      targetCard,
      targetDef,
      checkCondition,
      getCardDefinitionById,
      state
    )
  ) {
    state.log.push(`advent:${adventCardInstanceId}:condition-not-met`);
    return state;
  }

  // ソウルコア確認（代替コスト経路は「置いたものとして」擬制するため所持不要）
  if (
    !useAlternateCost &&
    !hasSoulCoreAvailable(state, actingPlayerId, {
      dest: adventData.soulCoreDest,
    })
  ) {
    state.log.push(`advent:${adventCardInstanceId}:no-soul-core`);
    return state;
  }

  // 実支払いで消滅する対象だけを除外する。擬制支払い/魂状態は例外。
  if (
    !isSoulStateTarget &&
    !canAdventTargetSurvivePayment(state, targetCard, useAlternateCost)
  ) {
    state.log.push(`advent:${adventCardInstanceId}:target-only-soul-core`);
    return state;
  }

  // --- ソウルコア消費（代替コスト経路は擬制のため実消費しない） ---

  const addition = adventData.beforeAdventSourceAddition;
  if (addition) {
    const candidates = state.cardInstances.filter((card) => {
      const def = getCardDefinitionById(card.definitionId);
      return (
        card.instanceId !== adventCardInstanceId &&
        card.ownerPlayerId === actingPlayerId &&
        isCardInEffectZone(
          state,
          card,
          addition.fromZones,
          actingPlayerId,
          getCardDefinitionById
        ) &&
        def !== undefined &&
        matchesCardFilter(card, def, addition.filter, {
          state,
          getCardDefinitionById,
        })
      );
    });
    if (params.selectedSourceIds === undefined && candidates.length > 0) {
      return {
        ...state,
        pendingZoneSelection: {
          pendingId: `advent-prepare:${state.turnNumber}:${adventCardInstanceId}`,
          actingPlayerId,
          sourceInstanceId: adventCardInstanceId,
          sourceDefinitionId: adventCard.definitionId,
          actionKind: "advent_source",
          sourceZone: addition.fromZones[0]!,
          candidateCardInstanceIds: candidates.map((c) => c.instanceId),
          maxCount: candidates.length,
          destination: "field",
          remainingActions: [],
          effectTiming: { kind: "activated", mode: "flash" },
          canSkip: true,
          priorStateSnapshot: state,
          adventPreparation: { params },
        },
      };
    }
    const selected = new Set(params.selectedSourceIds ?? []);
    for (const card of candidates) {
      if (!selected.has(card.instanceId)) continue;
      state = moveCardZone(state, card.instanceId, "field", "advent-source");
      state =
        attachAsAdventSource(state, card.instanceId, targetInstanceId) ?? state;
    }
    targetCard = getCardById(state, targetInstanceId)!;
  }

  const targetHadSoulCore = isSoulCoreOn(state, targetInstanceId);
  const soulCoreDest = adventData.soulCoreDest;
  let newState = useAlternateCost
    ? {
        ...state,
        log: [
          ...state.log,
          `advent:soul_core:alternate_cost:as_if:${soulCoreDest}`,
        ],
      }
    : consumeSoulCore(
        state,
        actingPlayerId,
        soulCoreDest,
        adventCardInstanceId
      );

  // --- 煌臨元スタック構築 ---
  // 既存の煌臨元カードも含めて新しいスタックを構築（多重煌臨対応）
  const existingSourceIds = adventSourceIdsOf(targetCard);
  const newSourceIds = [targetInstanceId, ...existingSourceIds];

  // --- 状態引き継ぎ ---
  // コア・疲労/回復/重疲労・アタック/ブロック中・合体ブレイヴを引き継ぐ
  // 魂状態への契約煌臨は魂状態側のコアを引き継がず、解決後に
  // buildChargeCoresPendingCoreDistribution で任意コア配置 pending を生成する。
  const inheritedCoreCount = isSoulStateTarget ? 0 : targetCard.normalCoreCount;
  const inheritedSoulCore = isSoulStateTarget ? false : targetHadSoulCore;
  const inheritedExhaustState = isSoulStateTarget
    ? ("recovered" as const)
    : targetCard.exhaustState;
  const inheritedBraveIds = isSoulStateTarget
    ? []
    : [...targetCard.attachedChildrenIds];
  const inheritedFieldPosition = targetCard.fieldPosition;

  // 合体条件チェック: 煌臨後に条件を満たさないブレイヴを分離する。
  // 支援ブレイヴが落ちると別ブレイヴも条件を失うため、残存集合が安定するまで再評価する。
  let validBraveIds = [...inheritedBraveIds];
  const adventCardBeforeMove = getCardById(newState, adventCardInstanceId);
  if (adventCardBeforeMove) {
    let changed: boolean;
    do {
      const simulatedHost: CardInstance = {
        ...adventCardBeforeMove,
        zone: "field",
        zoneRoleName: getZoneRoleName(adventDef),
        attachedChildrenIds: validBraveIds,
      };
      const simulatedState = replaceCardInstances(
        {
          ...newState,
          activeContinuousEffects: retargetAdventInheritedContinuousEffects(
            newState.activeContinuousEffects,
            targetInstanceId,
            adventCardInstanceId
          ),
        },
        newState.cardInstances.map((c) => {
          if (c.instanceId === adventCardInstanceId) {
            return simulatedHost;
          }
          if (validBraveIds.includes(c.instanceId)) {
            return {
              ...c,
              attachedToInstanceId: adventCardInstanceId,
            };
          }
          return c;
        })
      );
      const nextValidBraveIds = validBraveIds.filter((braveId) => {
        const braveCard = getCardById(newState, braveId);
        const braveDef = braveCard
          ? getCardDefinitionById(braveCard.definitionId)
          : undefined;
        if (!braveDef?.braveCondition) {
          return true;
        }
        return matchesBraveConditionForCard({
          condition: braveDef.braveCondition,
          state: simulatedState,
          card: simulatedHost,
          definition: adventDef,
          getCardDefinitionById,
          excludeBraveInstanceId: braveId,
          categoryEvaluation: "brave_host",
        });
      });
      changed = nextValidBraveIds.length !== validBraveIds.length;
      validBraveIds = nextValidBraveIds;
    } while (changed);
  } else {
    validBraveIds = [];
  }
  const validBraveIdSet = new Set(validBraveIds);
  const detachedBraveIds = inheritedBraveIds.filter(
    (braveId) => !validBraveIdSet.has(braveId)
  );

  if (isAdventSourceTarget && adventData.includeAdventSourceTarget === true) {
    newState = replaceCardInstances(
      {
        ...newState,
      },
      stripAdventSourceUnderCardReference(
        newState.cardInstances,
        targetInstanceId
      )
    );
  }

  // トラッシュ host は煌臨の成立時だけフィールドの煌臨元へ移す。召喚はしない。
  if (targetCard.zone === "trash") {
    newState = moveCardZone(
      newState,
      targetInstanceId,
      "field",
      "advent-source"
    );
    newState = {
      ...newState,
      usedTrashAdventKeysThisTurn: [
        ...newState.usedTrashAdventKeysThisTurn,
        actingPlayerId + ":" + targetDef.name,
      ],
    };
  }

  // --- 煌臨カードをフィールドへ (moveCardZone が handCount を自動減算) ---
  newState = moveCardZone(
    newState,
    adventCardInstanceId,
    "field",
    getZoneRoleName(adventDef)
  );

  // --- 煌臨カードのプロパティ設定 ---
  newState = updateCard(newState, adventCardInstanceId, (c) => ({
    ...c,
    fieldPosition: inheritedFieldPosition,
    normalCoreCount: inheritedCoreCount,
    exhaustState: inheritedExhaustState,
    attachedChildrenIds: validBraveIds,
    underCards: newSourceIds.map((id) => ({
      cardInstanceId: id,
      role: "advent_source" as const,
    })),
  }));

  // --- 煌臨先 → 煌臨元（ゾーンは field のまま、adventSourceCard として管理） ---
  newState = transferUnderCards(
    newState,
    targetInstanceId,
    adventCardInstanceId
  );
  newState = updateCard(newState, targetInstanceId, (c) => {
    const definitionId =
      c.definitionId !== c.originalDefinitionId
        ? c.originalDefinitionId
        : c.definitionId;
    return {
      ...c,
      definitionId,
      normalCoreCount: 0,
      exhaustState: "recovered" as const,
      attachedToInstanceId: null,
      attachedChildrenIds: [],
      underCards: [],
      zoneRoleName: "advent-source",
      fieldPosition: undefined,
    };
  });
  newState = replaceCardInstances(
    {
      ...newState,
    },
    newState.cardInstances.map((c) =>
      c.fieldPosition?.anchorInstanceId === targetInstanceId
        ? {
            ...c,
            fieldPosition: {
              ...c.fieldPosition,
              anchorInstanceId: adventCardInstanceId,
            },
          }
        : c
    )
  );

  // --- ソウルコア所在の付け替え (targetInstanceId → adventCardInstanceId) ---
  // inheritedSoulCore=true は targetCard 上にソウルコアがあったケース。
  // 該当 player の soulCoreLocation を新カード側に向け直す。
  if (inheritedSoulCore) {
    const soulOwner = newState.players.find(
      (p) =>
        p.soulCoreLocation?.kind === "card" &&
        p.soulCoreLocation.instanceId === targetInstanceId
    );
    if (soulOwner) {
      newState = withSoulCoreLocation(newState, soulOwner.id, {
        kind: "card",
        instanceId: adventCardInstanceId,
      });
    }
  }

  // --- ブレイヴ処理 ---
  for (const braveId of detachedBraveIds) {
    newState = resolveCardLeavesFieldCores(
      newState,
      braveId,
      null,
      getCardDefinitionById
    );
    newState = updateCard(newState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: null,
    }));
    newState = moveCardZone(newState, braveId, "trash");
  }
  for (const braveId of validBraveIds) {
    newState = updateCard(newState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: adventCardInstanceId,
    }));
  }

  // --- プレイヤー状態更新 (handCount は moveCardZone で自動減算済み) ---
  if (isSoulStateTarget) {
    newState = updatePlayer(newState, actingPlayerId, (p) => ({
      ...p,
      soulStateInstanceIds: p.soulStateInstanceIds.filter(
        (id) => id !== targetInstanceId
      ),
    }));
  }

  // --- 継続効果の引き継ぎ ---
  // 期間指定ある効果のみ引き継ぎ（while_on_field / permanent は消失）
  const updatedCEs = retargetAdventInheritedContinuousEffects(
    newState.activeContinuousEffects,
    targetInstanceId,
    adventCardInstanceId
  );

  // --- バトルエンティティ更新（アタック/ブロック中の煌臨） ---
  const updatedBattleEntities = newState.battleEntities.map((entity) => {
    if (!entity.memberInstanceIds.includes(targetInstanceId)) return entity;

    const newMemberIds = entity.memberInstanceIds
      .filter((id) => !detachedBraveIds.includes(id))
      .map((id) => (id === targetInstanceId ? adventCardInstanceId : id));

    const adventCardUpdated = getCardById(newState, adventCardInstanceId)!;
    const newBp = getEffectiveBp(newState, adventCardUpdated, adventDef);
    const newSymbols: SymbolColor[] = [...adventDef.symbolColors];

    return {
      ...entity,
      memberInstanceIds: newMemberIds,
      resolvedBp: newBp,
      resolvedSymbols: newSymbols,
    };
  });

  newState = {
    ...newState,
    activeContinuousEffects: updatedCEs,
    battleEntities: updatedBattleEntities,
  };
  newState = removeBattleEntityMembersAndRecompute(
    newState,
    detachedBraveIds,
    getCardDefinitionById
  );
  newState = recomputeBattleEntityBp(newState, getCardDefinitionById);

  // ログ
  newState.log.push(
    `advent:${adventCardInstanceId}:on:${targetInstanceId}` +
      `:soul_core_to:${soulCoreDest}` +
      `:sources:[${newSourceIds.join(",")}]` +
      `:cores=${inheritedCoreCount}` +
      (detachedBraveIds.length > 0
        ? `:brave_detached:[${detachedBraveIds.join(",")}]`
        : "") +
      (isContractAdvent ? ":contract" : "") +
      (isFContractAdvent ? ":f-contract" : "")
  );

  return newState;
}

/** 効果内の煌臨。煌臨前選択が終わった後、必要なら任意コア配置へ継続する。 */
export function executeEffectAdvent(
  state: GameState,
  actingPlayerId: string,
  params: AdventParams,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const shouldCharge =
    params.adventData.chargeCoresOnAdvent === true ||
    trashHostRequiresCoreCharge(
      state,
      params.targetInstanceId,
      getCardDefinitionById
    ) ||
    (params.isContractAdvent === true &&
      state.players
        .find((p) => p.id === actingPlayerId)
        ?.soulStateInstanceIds.includes(params.targetInstanceId));
  const after = executeAdvent(
    state,
    actingPlayerId,
    params,
    getCardDefinitionById
  );
  if (
    after === state ||
    after.pendingZoneSelection?.adventPreparation ||
    !shouldCharge ||
    after.pendingCoreDistribution
  )
    return after;
  const card = getCardById(after, params.adventCardInstanceId);
  if (card?.zone !== "field") return after;
  const pendingCoreDistribution = buildChargeCoresPendingCoreDistribution(
    after,
    actingPlayerId,
    card.instanceId,
    card.definitionId,
    getCardDefinitionById,
    "effect-advent-charge"
  );
  return pendingCoreDistribution
    ? { ...after, pendingCoreDistribution }
    : after;
}

/**
 * 煌臨宣言のスタック窓が閉じた後の解決。窓後・煌臨前選択後のいずれも共通の
 * executeAdventで対象と条件を再検証し、成立した場合だけ宣言回数と誘発を記録する。
 */
export function resolveDeferredAdventStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  // 無効化された場合は効果・コストともスキップ（起動コストは効果文内のため）。
  if (resolvedStack.isNullified) return state;
  if (resolvedStack.adventGrantSourceInstanceId !== undefined) {
    return resolveDeferredHostGrantedAdventStack(state, resolvedStack, options);
  }

  const sourceInstanceId = resolvedStack.cardInstanceId;
  const targetInstanceId = resolvedStack.targetInstanceIds[0];
  const actingPlayerId = resolvedStack.actingPlayerId;

  if (!resolvedStack.adventUseAlternateCost && targetInstanceId !== undefined) {
    const normalGrant = getHostGrantedAdventChoiceOptions(
      state,
      sourceInstanceId,
      actingPlayerId,
      options.getCardDefinitionById
    ).find(
      (option) =>
        !option.useAlternateCost &&
        option.proxySourceInstanceId === targetInstanceId
    );
    if (normalGrant) {
      return resolveDeferredHostGrantedAdventStack(
        state,
        { ...resolvedStack, adventGrantSourceInstanceId: targetInstanceId },
        options
      );
    }
  }

  const adventDef = options.getCardDefinitionById(
    resolvedStack.cardDefinitionId
  );
  if (!adventDef?.adventData || targetInstanceId === undefined) {
    return {
      ...state,
      log: [
        ...state.log,
        `[Advent] 煌臨データ不整合のため不発: ${sourceInstanceId}`,
      ],
    };
  }
  const adventData = adventDef.adventData;
  const adventMode = adventData.adventVariant ?? "normal";
  const isContractAdvent =
    adventMode === "contract" || adventMode === "f_contract";
  const isFContractAdvent = adventMode === "f_contract";

  const beforeState = state;

  // 代替コスト経路 (adventData.alternateCostAdvent、BSSL01-X01[3]) を使うかどうかは
  // スタック窓後・対象選択前の pendingAsIfSoulCoreChoice で固定される。
  // resolver 自身は、その選択結果として ActiveStack.adventUseAlternateCost に入った値だけを読む。
  const useAlternateCost = resolvedStack.adventUseAlternateCost === true;

  const afterAdvent = executeAdvent(
    beforeState,
    actingPlayerId,
    {
      adventCardInstanceId: sourceInstanceId,
      targetInstanceId,
      adventData,
      isContractAdvent,
      isFContractAdvent,
      useAlternateCost,
      selectedSourceIds: resolvedStack.adventSelectedSourceIds,
    },
    options.getCardDefinitionById
  );

  // executeAdvent は事前検証失敗時に beforeState をそのまま返す（不発）。
  if (afterAdvent === beforeState) return afterAdvent;
  if (afterAdvent.pendingZoneSelection?.adventPreparation) {
    return {
      ...afterAdvent,
      pendingZoneSelection: {
        ...afterAdvent.pendingZoneSelection,
        adventPreparation: {
          ...afterAdvent.pendingZoneSelection.adventPreparation,
          declaredStack: resolvedStack,
        },
      },
    };
  }

  // トラッシュ起点煌臨 / 代替コスト煌臨 / 通常 declare_advent の
  // 〔ターンに1回:同名〕記録。
  let recordedAdventState = afterAdvent;
  if (adventData.adventSourceZone === "trash") {
    recordedAdventState = {
      ...recordedAdventState,
      usedTrashAdventKeysThisTurn: [
        ...recordedAdventState.usedTrashAdventKeysThisTurn,
        adventDef.cardNo,
      ],
    };
  }
  if (useAlternateCost) {
    const usageKey = getAdventDeclareUsageKey(adventDef);
    recordedAdventState = {
      ...recordedAdventState,
      usedAlternateCostAdventKeysThisTurn: [
        ...recordedAdventState.usedAlternateCostAdventKeysThisTurn,
        usageKey,
      ],
    };
  }
  if (
    adventData.declareUsageLimit?.kind === "per_card_name" &&
    adventData.declareUsageLimit.duration === "turn"
  ) {
    const usageKey = getAdventDeclareUsageKey(adventDef);
    recordedAdventState = {
      ...recordedAdventState,
      usedAdventDeclareKeysThisTurn: [
        ...recordedAdventState.usedAdventDeclareKeysThisTurn,
        usageKey,
      ],
    };
  }

  // 煌臨時 / 召喚時 等の誘発を before/after 差分から検出してキューに積む。
  const stateWithTriggers = collectAndQueueTriggerReactions({
    beforeState,
    afterState: recordedAdventState,
    source: "action_resolution",
    adventVariant: adventMode,
    chainId: resolvedStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: actingPlayerId,
    causedBySourceInstanceId: sourceInstanceId,
  });
  // 煌臨は召喚ではないが、導託/神託本文が「召喚/煌臨したとき」と列挙する場合は
  // advent イベントとして対象になる。通常の action finalization を通らないため、
  // ここで煌臨後の盤面から専用の oracle batch をキューする。
  const stateWithTriggersAndOracle = checkAndQueueOracleChoicesForTriggerBatch(
    stateWithTriggers,
    [{ triggerCardInstanceId: sourceInstanceId, triggerKind: "advent" }],
    options.getCardDefinitionById,
    resolvedStack.chainId
  );

  // 契約煌臨で「魂状態」へ煌臨したとき、フィールド/リザーブのコアを好きなだけ
  // 煌臨スピリットへ置ける（08a:180）。chargeCoresOnAdvent 印字カード（BSAZ01）も同様。
  const targetWasSoulState =
    beforeState.players
      .find((p) => p.id === actingPlayerId)
      ?.soulStateInstanceIds.includes(targetInstanceId) ?? false;
  const shouldChargeCores =
    (targetWasSoulState && isContractAdvent) ||
    adventData.chargeCoresOnAdvent === true ||
    trashHostRequiresCoreCharge(
      beforeState,
      targetInstanceId,
      options.getCardDefinitionById
    );
  if (
    shouldChargeCores &&
    stateWithTriggersAndOracle.pendingCoreDistribution === null
  ) {
    const chargePending = buildChargeCoresPendingCoreDistribution(
      stateWithTriggersAndOracle,
      actingPlayerId,
      sourceInstanceId,
      resolvedStack.cardDefinitionId,
      options.getCardDefinitionById,
      "advent-charge"
    );
    if (chargePending) {
      return {
        ...stateWithTriggersAndOracle,
        pendingCoreDistribution: chargePending,
      };
    }
  }

  return stateWithTriggersAndOracle;
}

// ---------------------------------------------------------------------------
// ソウルコア消費
// ---------------------------------------------------------------------------

/**
 * ソウルコアを消費して指定先に送る。
 * dest:"this_card" は標準の行き先 (trash/removed_from_game) を上書きし、
 * 消費したソウルコアを thisCardInstanceId (煌臨カード自身) に置く
 * (BSSL01-X02「自分のソウルコアをこのスピリットに置く」等のカード固有効果)。
 */
export function consumeSoulCore(
  state: GameState,
  playerId: string,
  dest: "trash" | "removed_from_game" | "this_card",
  thisCardInstanceId: string
): GameState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.soulCoreLocation) return state;

  const loc = player.soulCoreLocation;
  // ライフ上のソウルコアも通常の移動プリミティブで消費し、ライフ0を即時判定する。
  const from =
    loc.kind === "card" || loc.kind === "removed_from_game"
      ? loc
      : { ...loc, playerId };
  const to =
    dest === "this_card"
      ? { kind: "card" as const, instanceId: thisCardInstanceId }
      : dest === "trash"
        ? { kind: "trash" as const, playerId }
        : { kind: "removed_from_game" as const };
  const newState = moveSoulCore(state, playerId, from, to);
  newState.log.push(`advent:soul_core:${loc.kind}:to:${dest}`);
  return newState;
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** 煌臨カードのゾーンロール名を返す */
function getZoneRoleName(def: CardDefinition): string {
  switch (def.printedCategory) {
    case "spirit":
      return "spirit";
    case "ultimate":
      return "ultimate";
    case "brave":
      return "brave";
    case "nexus":
      return "nexus";
    default:
      return def.printedCategory;
  }
}

/**
 * ContinuousEffect が期間指定を持つ（turn / battle / attack / step）か判定。
 * while_on_field / permanent は「期間指定なし」として扱い、煌臨時に引き継がない。
 */
function hasDurationScope(ce: ContinuousEffect): boolean {
  const scope = ce.duration.scope;
  return (
    scope === "turn" ||
    scope === "battle" ||
    scope === "attack" ||
    scope === "step"
  );
}

/**
 * フィールド上のカード `cardInstanceId` を `hostInstanceId` の煌臨元として配置する。
 *
 * 離脱置換 (「相手によって離れるとき、自分の『X』の煌臨元に追加する」) の解決で使用する。
 * `executeAdvent` が 煌臨先カードを 煌臨元へ変える処理 (advent-system.ts: 煌臨先→煌臨元) と
 * 同じ盤面形状を生成する SSOT 入口。08a_advent-rebirth-contract.md L34
 * (「下に表向きで重なる」) / L36 (「フィールド離脱時、煌臨元も全て同じ場所に移動」)。
 *
 * 前提: 呼び出し側で `cardInstanceId` のコアは既にリザーブ等へ退避済み (normalCoreCount は
 * ここで 0 にリセットするが、コア移動自体はゾーン離脱プリミティブの責務)。
 * 煌臨元は host と同じ field ゾーンに留まる (zone は変更しない)。
 *
 * @returns 配置に成功すれば更新後 state、host か card が場にないときは null。
 */
export function attachAsAdventSource(
  state: GameState,
  cardInstanceId: string,
  hostInstanceId: string
): GameState | null {
  const card = getCardById(state, cardInstanceId);
  const host = getCardById(state, hostInstanceId);
  if (!card || !host) return null;
  if (host.zone !== "field") return null;
  if (cardInstanceId === hostInstanceId) return null;

  // 新規煌臨元は最前面 (executeAdvent の newSourceIds = [target, ...existing] と同順)。
  let newState = updateCard(
    transferUnderCards(state, cardInstanceId, hostInstanceId),
    hostInstanceId,
    (c) => ({
      ...c,
      underCards: [
        { cardInstanceId, role: "advent_source" as const },
        ...c.underCards.filter(
          (entry) => entry.cardInstanceId !== cardInstanceId
        ),
      ],
    })
  );

  // 離脱カード → 煌臨元 (転醒 B 面は A 面復帰、表向き、コア 0、合体/煌臨元リンク解除)。
  newState = updateCard(newState, cardInstanceId, (c) => {
    const definitionId =
      c.definitionId !== c.originalDefinitionId
        ? c.originalDefinitionId
        : c.definitionId;
    return {
      ...c,
      definitionId,
      zone: "field" as const,
      faceDown: false,
      normalCoreCount: 0,
      exhaustState: "recovered" as const,
      pendingLeaveKind: null,
      pendingLeaveCause: null,
      pendingLeaveChainId: null,
      deferZoneMoveUntilChainEnd: false,
      attachedToInstanceId: null,
      attachedChildrenIds: [],
      underCards: [],
      zoneRoleName: "advent-source",
    };
  });

  return newState;
}
