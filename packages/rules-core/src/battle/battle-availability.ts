import {
  canStartBattleResolutionInWindow,
  canDeclareBlockInWindow,
  getActiveAttackAssignment,
  getAttackEntityId,
  battleEntityHasNoFieldReadyMember,
  getBattleCardDefinitionOrThrow,
  getBattleCardInstanceOrThrow,
  getBattleEntityById,
  getBattleEntityByMemberInstanceId,
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  isBattleCapableCategory,
  isEntityAssignedAsBlocker,
  isRuleStrengthBattlePrevented,
  isSoulStateCard,
  resolveEffectiveIdentity,
} from "./battle-shared";
import type {
  AttackDeclarationBlockReason,
  BlockDeclarationBlockReason,
  DeclineBlockBlockReason,
  JoinActiveAttackBlockReason,
  OpenBattleFlashBlockReason,
  PassBattleFlashBlockReason,
} from "./battle-types";
import type {
  ActiveAttack,
  BattleFlashWindowKind,
  CardCategory,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectPreventionLevel,
  GameState,
} from "../model";
import type { CardFilter } from "../dsl-types";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import {
  getCEsForTarget,
  getGlobalCEs,
  isCEActiveForScope,
} from "../card/ce-lookup";
import {
  isCardLeaveAffectBlockedByResistance,
  resolveCardExhaustAffect,
  resolveCardImmunityAffect,
} from "../effect/effect-affect-adapter";
import {
  getRequiredMultiBlockGrant,
  matchesGlobalCETargetFilter,
} from "../legal/legal-actions-shared";
import { getTotalCoresOnCardById } from "../core/core-system";
import { getCardById } from "../card/card-lookup";
import { getFieldCoreSourceTakeableCount } from "../effect/structured-core-shoot";
import {
  matchesCardFilter,
  matchesCardReferenceFilter,
  type MatchCardFilterOptions,
} from "../card/card-filter";
import { isCardExhaustionForbidden } from "../mechanics/brave-spirit-state-recovery";
import {
  applyCardTargetAcquisitionGate,
  effectSourceContext,
} from "../effect/structured-effect-interpreter";
import type { TargetLockBypassProfile } from "../effect/target-affect-gate";

/**
 * ENGINE-additional-attack-mid-declare-attack-window-risk:
 * `additional_attack` で付与された「疲労状態でもアタック宣言できる」一回限り grant を持つか。
 * `GameState.pendingAdditionalAttackGrants` を直接参照する (SSOT)。
 */
export function hasPendingAdditionalAttackGrant(
  state: GameState,
  sourceInstanceId: string
): boolean {
  return state.pendingAdditionalAttackGrants.includes(sourceInstanceId);
}

/**
 * 動的フィルタの戦闘属性CE（targetFilterあり）が対象カードに適用されるか判定する。
 * ブロック不可は防御側、「ブロックされない」は攻撃側を渡す。耐性もその対象で評価する。
 */
function hasApplicableGlobalBattleCE(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  tags: readonly string[],
  options?: { ignoreEffectsFromPlayerId?: string }
): boolean {
  const coreCount = getTotalCoresOnCardById(state, card.instanceId);
  for (const ce of getGlobalCEs(state)) {
    if (!tags.includes(ce.modifierTag)) continue;
    if (options?.ignoreEffectsFromPlayerId === ce.actingPlayerId) continue;
    const targetLockBypass = ce.metadata?.sourceTargetLockBypass as
      | TargetLockBypassProfile
      | undefined;
    // 全体への継続効果も、適用時に対象へ含められるかを確認する。
    // 通常の「防げない」は対象ロックを貫通しない（04b2）。
    if (
      ce.metadata?.ruleStrength !== true &&
      applyCardTargetAcquisitionGate(
        state,
        [card],
        {
          ...effectSourceContext(
            ce.actingPlayerId,
            ce.sourceInstanceId,
            readContinuousEffectPreventionLevel(ce),
            targetLockBypass
          ),
          sourceDefinitionId: ce.sourceDefinitionId,
        },
        "include_all",
        getCardDefinitionById
      ).length === 0
    )
      continue;
    if (
      ce.metadata?.ruleStrength !== true &&
      resolveCardImmunityAffect(
        state,
        card,
        ce.actingPlayerId,
        readContinuousEffectPreventionLevel(ce),
        {
          instance: getCardById(state, ce.sourceInstanceId),
          definition: getCardDefinitionById(ce.sourceDefinitionId),
        },
        getCardDefinitionById,
        targetLockBypass
      ).kind !== "allowed"
    )
      continue;
    if (
      matchesGlobalCETargetFilter(
        state,
        ce,
        card,
        getCardDefinitionById,
        coreCount
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 「アタック/ブロックする(対象)から Nコスト支払わなければアタック/ブロックできない」
 * (battle_cost_gate, BSAZ01-C09) の必要コスト量を返す。対象に一致するゲートが無ければ 0。
 * 複数ゲートが重複するときは最大値を要求する（〔重複不可〕は同名タグ集約ではなく別カードの
 * 独立ゲートなので単純合算ではなく最大値を採用する。本カードは唯一の出典のため実質単一）。
 * 支払いは対象カード自身の通常コアからのみ (metadata.costAmount、省略時1)。
 */
export function getRequiredBattleCostGateAmount(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  tags: readonly string[],
  options?: { ignoreEffectsFromPlayerId?: string }
): number {
  let required = 0;
  for (const ce of getGlobalCEs(state)) {
    if (!tags.includes(ce.modifierTag)) continue;
    if (options?.ignoreEffectsFromPlayerId === ce.actingPlayerId) continue;
    if (
      ce.metadata?.["firstAttackOnly"] === true &&
      (state.battlesEndedThisAttackStep ?? 0) !== 0
    ) {
      continue;
    }
    const fixedTargetIds = ce.metadata?.["targetInstanceIds"];
    if (
      Array.isArray(fixedTargetIds) &&
      !fixedTargetIds.includes(card.instanceId)
    ) {
      continue;
    }
    if (!matchesGlobalCETargetFilter(state, ce, card, getCardDefinitionById)) {
      continue;
    }
    const amount =
      typeof ce.metadata?.["costAmount"] === "number"
        ? (ce.metadata["costAmount"] as number)
        : 1;
    if (amount > required) required = amount;
  }
  return required;
}

/**
 * battle_cost_gate ゲートが対象に適用され、かつ対象自身の通常コアで支払えないため
 * アタック/ブロック宣言できないか判定する (BSAZ01-C09)。
 *
 * コスト源泉が対象カード自身のコアであるため、この支払いは対象への「効果」として
 * 効果耐性/免疫・コア最低残存数保護の対象になる (needs-ruling.jsonl BSAZ01-C09、
 * 2026-08-05 ユーザー確認: 03d.md の発揮前提除去型と同型)。「効果を受けない」カードは
 * ゲート元プレイヤーにコアを強制徴収されないため支払い自体が成立せず、
 * 「コアがN個より少なくならない」保護カードは残存数を割り込む支払いができない —
 * いずれも結果としてアタック/ブロック不可になる。判定は pay-to-act-core-gate.ts の
 * 発揮前提コア除去ゲートと同じ SSOT `getFieldCoreSourceTakeableCount` を通す
 * (raw normalCoreCount を直接比較しない)。
 */
function isBattleCostGateUnaffordable(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  kind: "attack" | "block",
  options?: { ignoreEffectsFromPlayerId?: string }
): boolean {
  const tags =
    kind === "attack"
      ? ["battle_cost_gate_attack", "battle_cost_gate_both"]
      : ["battle_cost_gate_block", "battle_cost_gate_both"];
  let required = 0;
  let takeableForRequired = 0;
  for (const ce of getGlobalCEs(state)) {
    if (!tags.includes(ce.modifierTag)) continue;
    if (options?.ignoreEffectsFromPlayerId === ce.actingPlayerId) continue;
    if (
      ce.metadata?.["firstAttackOnly"] === true &&
      (state.battlesEndedThisAttackStep ?? 0) !== 0
    ) {
      continue;
    }
    const fixedTargetIds = ce.metadata?.["targetInstanceIds"];
    if (
      Array.isArray(fixedTargetIds) &&
      !fixedTargetIds.includes(card.instanceId)
    ) {
      continue;
    }
    if (!matchesGlobalCETargetFilter(state, ce, card, getCardDefinitionById)) {
      continue;
    }
    const amount =
      typeof ce.metadata?.["costAmount"] === "number"
        ? (ce.metadata["costAmount"] as number)
        : 1;
    if (amount < required) continue;
    const sourceCard = getCardById(state, ce.sourceInstanceId);
    const sourceDefinition = getCardDefinitionById(ce.sourceDefinitionId);
    required = amount;
    takeableForRequired = getFieldCoreSourceTakeableCount(
      state,
      card,
      ce.actingPlayerId,
      {
        effectSource: {
          ...(sourceCard ? { instance: sourceCard } : {}),
          ...(sourceDefinition ? { definition: sourceDefinition } : {}),
        },
        getCardDefinitionById,
        filter: {},
      }
    );
  }
  return required > 0 && takeableForRequired < required;
}

function getAttackExhaustCostCategories(ce: {
  metadata?: Record<string, unknown>;
}): CardCategory[] {
  const raw = ce.metadata?.["costTargetCategory"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (value): value is CardCategory =>
      value === "spirit" ||
      value === "ultimate" ||
      value === "brave" ||
      value === "nexus" ||
      value === "magic"
  );
}

function getEligibleAttackExhaustCostSourceIdsForGate(options: {
  state: GameState;
  attacker: CardInstance;
  categories: readonly CardCategory[];
  gateActingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string[] {
  const candidates: string[] = [];
  for (const card of options.state.cardInstances) {
    if (card.instanceId === options.attacker.instanceId) continue;
    if (card.controllerPlayerId !== options.attacker.controllerPlayerId) {
      continue;
    }
    if (
      card.zone !== "field" ||
      card.pendingLeaveKind !== null ||
      card.attachedToInstanceId !== null ||
      card.exhaustState !== "recovered"
    ) {
      continue;
    }
    const def = options.getCardDefinitionById(card.definitionId);
    if (!def) continue;
    if (isCardExhaustionForbidden(card, def)) continue;
    const category = getEffectiveCategory(options.state, card, def);
    if (
      category !== undefined &&
      options.categories.includes(category) &&
      resolveCardExhaustAffect(
        options.state,
        card,
        options.gateActingPlayerId,
        options.getCardDefinitionById
      ).kind === "allowed"
    ) {
      candidates.push(card.instanceId);
    }
  }
  return candidates;
}

/**
 * attack_exhaust_cost_gate が対象に要求する疲労コスト候補。
 * null = ゲート無し、[] = ゲート有りだが支払い候補無し。
 */
export function getRequiredAttackExhaustCostSourceCandidates(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  excludedInstanceIds: ReadonlySet<string> = new Set()
): string[] | null {
  let candidateIds: string[] | null = null;
  for (const ce of getGlobalCEs(state)) {
    if (ce.modifierTag !== "attack_exhaust_cost_gate") continue;
    if (
      !isCEActiveForScope(
        ce,
        state.step,
        state.activePlayerId,
        state.window === "step_end" ? "end" : undefined
      )
    ) {
      continue;
    }
    if (!matchesGlobalCETargetFilter(state, ce, card, getCardDefinitionById)) {
      continue;
    }
    const categories = getAttackExhaustCostCategories(ce);
    if (categories.length === 0) return [];
    const candidates = getEligibleAttackExhaustCostSourceIdsForGate({
      state,
      attacker: card,
      categories,
      gateActingPlayerId: ce.actingPlayerId,
      getCardDefinitionById,
    }).filter((id) => !excludedInstanceIds.has(id));
    candidateIds =
      candidateIds === null
        ? candidates
        : candidateIds.filter((id) => candidates.includes(id));
  }
  return candidateIds;
}

export function getRequiredAttackExhaustCostCount(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): number {
  let required = 0;
  for (const ce of getGlobalCEs(state)) {
    if (ce.modifierTag !== "attack_exhaust_cost_gate") continue;
    if (
      !isCEActiveForScope(
        ce,
        state.step,
        state.activePlayerId,
        state.window === "step_end" ? "end" : undefined
      )
    ) {
      continue;
    }
    if (!matchesGlobalCETargetFilter(state, ce, card, getCardDefinitionById)) {
      continue;
    }
    if (getAttackExhaustCostCategories(ce).length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    required += 1;
  }
  return required;
}

function isAttackExhaustCostGateUnaffordable(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  const candidates = getRequiredAttackExhaustCostSourceCandidates(
    state,
    card,
    getCardDefinitionById
  );
  const requiredCount = getRequiredAttackExhaustCostCount(
    state,
    card,
    getCardDefinitionById
  );
  return candidates !== null && candidates.length < requiredCount;
}

function getEligibleBattleDestroyCostSourceIdsForGate(options: {
  destination?: "deck_bottom" | undefined;
  state: GameState;
  sourceCard: CardInstance;
  categories: readonly CardCategory[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string[] {
  const candidates: string[] = [];
  for (const card of options.state.cardInstances) {
    if (card.instanceId === options.sourceCard.instanceId) continue;
    if (card.controllerPlayerId !== options.sourceCard.controllerPlayerId) {
      continue;
    }
    if (
      card.zone !== "field" ||
      card.pendingLeaveKind !== null ||
      card.attachedToInstanceId !== null
    ) {
      continue;
    }
    const def = options.getCardDefinitionById(card.definitionId);
    if (!def) continue;
    const category = getEffectiveCategory(options.state, card, def);
    if (
      category !== undefined &&
      options.categories.includes(category) &&
      // 破壊コストは対象自身の controller が自分自身のカードに対して支払う (自傷)。
      // resistance 判定の actingPlayerId は CE 発行元 (ce.actingPlayerId、= 相手) ではなく
      // 実行側 (payBattleDestroyCostSources) と同じ「破壊するプレイヤー自身」
      // (= card.controllerPlayerId、宣言プレイヤー本人) を渡す。CE 発行元を渡すと
      // 「相手の効果からは破壊されない」耐性が誤って自傷破壊にも適用されてしまう
      // (doesEffectResistanceSourceApplyToController は actingPlayerId===controllerPlayerId
      // のとき無条件許可するため、実行側と同じ actingPlayerId でなければ候補列挙と
      // 実行で判定が食い違う)。
      !isCardLeaveAffectBlockedByResistance(
        options.state,
        card,
        options.destination === "deck_bottom" ? "send_to_deck" : "destroy",
        card.controllerPlayerId,
        options.getCardDefinitionById
      )
    ) {
      candidates.push(card.instanceId);
    }
  }
  return candidates;
}

/** SSOT for listing, affordability and consumption of declaration card costs. */
function getBattleCardCostRequirements(
  state: GameState,
  card: CardInstance,
  lookup: (id: string) => CardDefinition | undefined,
  tags: readonly string[],
  excludedIds: ReadonlySet<string> = new Set(),
  options?: { ignoreEffectsFromPlayerId?: string }
) {
  return getGlobalCEs(state)
    .filter(
      (ce) =>
        tags.includes(ce.modifierTag) &&
        options?.ignoreEffectsFromPlayerId !== ce.actingPlayerId &&
        matchesGlobalCETargetFilter(state, ce, card, lookup)
    )
    .map((ce) => {
      const destination =
        ce.metadata?.costDestination === "deck_bottom"
          ? ("deck_bottom" as const)
          : ("destroy" as const);
      return {
        effectId: ce.effectId,
        destination,
        candidates: getEligibleBattleDestroyCostSourceIdsForGate({
          state,
          sourceCard: card,
          categories: getAttackExhaustCostCategories(ce),
          getCardDefinitionById: lookup,
          destination: destination === "deck_bottom" ? destination : undefined,
        })
          .filter((id) => !excludedIds.has(id))
          .sort(),
      };
    })
    .sort((a, b) => a.effectId.localeCompare(b.effectId));
}

type BattleCardCostPaymentPlan = {
  effectId: string;
  instanceId: string;
  destination: "destroy" | "deck_bottom";
}[];

/** Requirements are stable by effect ID. Mixed destinations use ordered IDs. */
function* iterateBattleCardCostPaymentPlans(
  state: GameState,
  card: CardInstance,
  lookup: (id: string) => CardDefinition | undefined,
  tags: readonly string[],
  selectedIds?: readonly string[],
  excludedIds: ReadonlySet<string> = new Set(),
  options?: { ignoreEffectsFromPlayerId?: string }
): Generator<BattleCardCostPaymentPlan> {
  const requirements = getBattleCardCostRequirements(
    state,
    card,
    lookup,
    tags,
    excludedIds,
    options
  );
  if (
    selectedIds &&
    (new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.length !== requirements.length)
  )
    return;
  const ordered =
    new Set(requirements.map((rule) => rule.destination)).size > 1;
  const used = new Set<string>();
  const plan: BattleCardCostPaymentPlan = [];
  function* match(index: number): Generator<BattleCardCostPaymentPlan> {
    const rule = requirements[index];
    if (!rule) {
      yield [...plan];
      return;
    }
    for (const id of rule.candidates) {
      if (
        used.has(id) ||
        (selectedIds &&
          (ordered ? selectedIds[index] !== id : !selectedIds.includes(id)))
      )
        continue;
      used.add(id);
      plan.push({
        effectId: rule.effectId,
        instanceId: id,
        destination: rule.destination,
      });
      yield* match(index + 1);
      used.delete(id);
      plan.pop();
    }
  }
  yield* match(0);
}

/** Fast first witness for affordability, or validate the player's ordered plan. */
export function getBattleCardCostPaymentPlan(
  ...args: Parameters<typeof iterateBattleCardCostPaymentPlans>
): BattleCardCostPaymentPlan | null {
  return iterateBattleCardCostPaymentPlans(...args).next().value ?? null;
}

/** Every distinct assignment of cards to destinations, shared by UI and execution. */
export function getBattleCardCostPaymentPlans(
  ...args: Parameters<typeof iterateBattleCardCostPaymentPlans>
): BattleCardCostPaymentPlan[] {
  const unique = new Map<string, BattleCardCostPaymentPlan>();
  for (const plan of iterateBattleCardCostPaymentPlans(...args)) {
    const key = plan
      .map((item) => `${item.destination}:${item.instanceId}`)
      .sort()
      .join("|");
    if (!unique.has(key)) unique.set(key, plan);
  }
  return [...unique.values()];
}

/**
 * battle_destroy_cost_gate が対象に要求する破壊コスト候補。
 * null = ゲート無し、[] = ゲート有りだが支払い候補無し (BSDB01-C09)。
 * tags で attack/block/both の適用範囲を絞る (battle_cost_gate と同じ構造)。
 */
export function getRequiredBattleDestroyCostSourceCandidates(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  tags: readonly string[],
  excludedInstanceIds: ReadonlySet<string> = new Set(),
  options?: { ignoreEffectsFromPlayerId?: string }
): string[] | null {
  const requirements = getBattleCardCostRequirements(
    state,
    card,
    getCardDefinitionById,
    tags,
    excludedInstanceIds,
    options
  );
  return requirements.length
    ? [...new Set(requirements.flatMap((rule) => rule.candidates))]
    : null;
}

export function getRequiredBattleDestroyCostCount(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  tags: readonly string[],
  options?: { ignoreEffectsFromPlayerId?: string }
): number {
  return getBattleCardCostRequirements(
    state,
    card,
    getCardDefinitionById,
    tags,
    new Set(),
    options
  ).length;
}

function isBattleDestroyCostGateUnaffordable(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  kind: "attack" | "block",
  options?: { ignoreEffectsFromPlayerId?: string }
): boolean {
  const tags =
    kind === "attack"
      ? ["battle_destroy_cost_gate_attack", "battle_destroy_cost_gate_both"]
      : ["battle_destroy_cost_gate_block", "battle_destroy_cost_gate_both"];
  return (
    getBattleCardCostPaymentPlan(
      state,
      card,
      getCardDefinitionById,
      tags,
      undefined,
      new Set(),
      options
    ) === null
  );
}

/** CE でアタック禁止されているか判定 */
function isAttackPreventedByCE(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  // 保存盤面などで CE が未登録でも、印字されたルール強度の攻防禁止を守る。
  // バトル継続判定と同じ正源を使い、通常の効果による禁止とは区別する。
  if (
    isRuleStrengthBattlePrevented(
      state,
      card.instanceId,
      "attacking",
      getCardDefinitionById
    )
  ) {
    return true;
  }
  for (const ce of getCEsForTarget(state, card.instanceId)) {
    if (
      ce.modifierTag === "prevent_attack" ||
      ce.modifierTag === "prevent_battle_attack" ||
      ce.modifierTag === "prevent_battle_both"
    ) {
      return true;
    }
  }
  if (
    hasApplicableGlobalBattleCE(state, card, getCardDefinitionById, [
      "prevent_battle_attack",
      "prevent_battle_both",
    ])
  ) {
    return true;
  }
  return (
    isBattleCostGateUnaffordable(
      state,
      card,
      getCardDefinitionById,
      "attack"
    ) ||
    isAttackExhaustCostGateUnaffordable(state, card, getCardDefinitionById) ||
    isBattleDestroyCostGateUnaffordable(
      state,
      card,
      getCardDefinitionById,
      "attack"
    )
  );
}

/**
 * 「このスピリットは可能ならこのターンの最初にアタックする」CE の対象カード instanceId を
 * 取得する (ENGINE-force-first-attack-this-turn)。actingPlayerId が発揮者と一致する CE のみ
 * 対象にする（「自分の」スピリット限定効果のため）。対象 instanceId が未確定のため
 * `getCEsForTarget` は使えず、他の CE 判定 (`isAttackPreventedByCE` 等) と同様
 * `isCEActiveForScope` で timingScope フィルタを揃える（ce-lookup.ts の SSOT 経路）。
 * 無ければ null。
 */
function getForcedFirstAttackerInstanceId(
  state: GameState,
  actingPlayerId: string
): string | null {
  const currentSubPhase = state.window === "step_end" ? "end" : undefined;
  for (const ce of state.activeContinuousEffects) {
    if (
      ce.modifierTag === "force_first_attacker" &&
      ce.actingPlayerId === actingPlayerId &&
      isCEActiveForScope(ce, state.step, state.activePlayerId, currentSubPhase)
    ) {
      return ce.targetInstanceId ?? null;
    }
  }
  return null;
}

/**
 * 「このスピリットは可能ならこのターンの最初にアタックする」の強制対象カードが、
 * 今ターンまだバトルが1つも終了しておらず(=「最初」の機会がまだ残っている)、かつ
 * 現に合法アタック宣言可能な間の instanceId を返す (ENGINE-force-first-attack-this-turn)。
 * 「可能なら」が実際に有効な間だけ、(1) 他カードのアタック宣言 (`getAttackDeclarationBlockReason`)、
 * (2) 攻めずにアタックステップを終了する選択 (`getAvailableEndAttackStepLegalActions`)
 * の両方を抑止するために使う（「可能なら」の強制がプレイヤーの end_attack_step 選択で
 * 素通りされる抜け道を塞ぐ）。無ければ null。
 */
export function getPendingForcedFirstAttackerId(
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): string | null {
  if ((state.battlesEndedThisTurn ?? 0) !== 0) return null;
  const forcedFirstAttackerId = getForcedFirstAttackerInstanceId(
    state,
    actingPlayerId
  );
  if (forcedFirstAttackerId === null) return null;
  const blockReason =
    getAttackDeclarationBlockReasonIgnoringForcedFirstAttacker({
      state,
      actingPlayerId,
      sourceInstanceId: forcedFirstAttackerId,
      getCardDefinitionById,
    });
  return blockReason === null ? forcedFirstAttackerId : null;
}

/** CE でブロック禁止されているか判定 */
function isBlockPreventedByCE(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  options?: { ignoreEffectsFromPlayerId?: string }
): boolean {
  // 保存盤面などで CE が未登録でも、印字されたルール強度の攻防禁止を守る。
  // バトル継続判定と同じ正源を使い、通常の効果による禁止とは区別する。
  if (
    isRuleStrengthBattlePrevented(
      state,
      card.instanceId,
      "blocking",
      getCardDefinitionById
    )
  ) {
    return true;
  }
  for (const ce of getCEsForTarget(state, card.instanceId)) {
    if (
      ce.modifierTag === "prevent_battle_block" ||
      ce.modifierTag === "prevent_battle_both"
    ) {
      if (options?.ignoreEffectsFromPlayerId === ce.actingPlayerId) continue;
      return true;
    }
  }
  if (
    hasApplicableGlobalBattleCE(
      state,
      card,
      getCardDefinitionById,
      ["prevent_battle_block", "prevent_battle_both"],
      options
    )
  ) {
    return true;
  }
  return (
    isBattleCostGateUnaffordable(
      state,
      card,
      getCardDefinitionById,
      "block",
      options
    ) ||
    isBattleDestroyCostGateUnaffordable(
      state,
      card,
      getCardDefinitionById,
      "block",
      options
    )
  );
}

/**
 * 指定アタックの attacker (発生源カード) を ActiveAttack から解決する
 * (装甲/効果耐性チェックのスコープ照合用。攻撃側 battle entity の代表 member を
 * 発生源カードとして扱う — 同時アタック group でも代表 1 体で判定する簡略化)。
 */
export function getDesignatedAttackAttackerCard(
  state: GameState,
  activeAttack: Pick<ActiveAttack, "primaryEntityId">
): CardInstance | undefined {
  const attackerEntity = getBattleEntityById(
    state,
    activeAttack.primaryEntityId
  );
  const attackerInstanceId = attackerEntity?.memberInstanceIds[0];
  return attackerInstanceId !== undefined
    ? getCardById(state, attackerInstanceId)
    : undefined;
}

/**
 * 指定アタックの対象として選べるか判定 (10_rules/05b §指定アタック 重要制約:
 * 「ブロックできない」対象には指定できない = prevent_battle_block/both CE / 非バトル可能
 * カテゴリ / 魂状態を除外する。装甲/超重装甲などの「相手の[色]の効果を受けない」対象にも
 * 指定できない = デフォルトでは指定アタックも「(発生源カードの色の)効果」として扱われ、
 * 該当色の装甲で防げる。公式FAQ複数件 (BS52 Q20739 / BS62 / BS63 Q10163 / BS64 Q10516 /
 * BS73 / BSC50 / CB18 / CB22 / CB29 / CB30 / CB32 / PC04 / SD69 等) が「専用の無効化
 * 文言（この「指定アタック」効果は〜効果では防げません、等）を持つ場合のみ装甲を防げる」
 * という共通パターンを一貫して示す — 裏を返せばデフォルトは装甲で防げる。
 * 発生源カードは attackerCard (呼び出し元が ActiveAttack から解決、
 * [[getDesignatedAttackAttackerCard]]) — 印字/実効カラーで装甲スコープと照合する。
 * ENGINE-designated-attack-armor-guard 解消 (2026-07-11, needs-ruling.jsonl 26番)。
 * 疲労状態は判定しない — 指定アタックは対象が疲労状態でも強制的にブロック宣言させるため、
 * 通常ブロックの回復状態要件はここでは適用しない。
 */
export function isDesignatedAttackTargetLegal(
  state: GameState,
  targetCard: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  attackerCard: CardInstance | undefined
): boolean {
  if (targetCard.zone !== "field") return false;
  if (isSoulStateCard(state, targetCard.instanceId)) return false;
  const targetDefinition = getBattleCardDefinitionOrThrow(
    targetCard.definitionId,
    getCardDefinitionById
  );
  if (!isBattleCapableCategory(targetDefinition, targetCard, state)) {
    return false;
  }
  if (attackerCard !== undefined) {
    const attackerDefinition = getCardDefinitionById(attackerCard.definitionId);
    const immunityDecision = resolveCardImmunityAffect(
      state,
      targetCard,
      attackerCard.controllerPlayerId,
      "none",
      { instance: attackerCard, definition: attackerDefinition },
      getCardDefinitionById
    );
    if (immunityDecision.kind !== "allowed") {
      return false;
    }
  }
  return !isBlockPreventedByCE(state, targetCard, getCardDefinitionById);
}

/**
 * CE で「疲労状態でもブロックできる」が付与されているか判定。
 * 通常ブロックは回復状態が必要（10_rules/02 L122 / 05 L114）だが、この CE を持つ
 * カードは疲労状態でもブロック宣言できる（block-while-exhausted）。
 */
function isBlockAllowedWhileExhaustedByCE(
  state: GameState,
  instanceId: string
): boolean {
  for (const ce of getCEsForTarget(state, instanceId)) {
    if (ce.modifierTag === "allow_block_while_exhausted") {
      return true;
    }
  }
  return false;
}

/**
 * CE で「疲労状態のこのスピリットは、重疲労させることでアタックできる」が付与されているか判定
 * (allow_attack_while_exhausted, BSTH09-C04【追撃】)。isBlockAllowedWhileExhaustedByCE の
 * アタック版。適用可否 (exhaustState==="exhausted" のみ、重疲労は対象外) は呼び出し側が判定する。
 */
export function isAttackAllowedWhileExhaustedByCE(
  state: GameState,
  instanceId: string
): boolean {
  for (const ce of getCEsForTarget(state, instanceId)) {
    if (ce.modifierTag === "allow_attack_while_exhausted") {
      return true;
    }
  }
  return false;
}

/**
 * CE で「ターンに1回、疲労せずにアタック/ブロックできる」が付与されており、かつ
 * このターンまだ未消費か判定 (allow_tapless_battle_declare, BSTH09-C03)。
 * 消費記録は `GameState.usedTaplessBattleDeclareInstanceIdsThisTurn`
 * (アタック/ブロック共有の同一予算、ターン遷移時にクリア)。
 */
export function hasUnusedTaplessBattleDeclareGrant(
  state: GameState,
  instanceId: string
): boolean {
  if (state.usedTaplessBattleDeclareInstanceIdsThisTurn.includes(instanceId)) {
    return false;
  }
  for (const ce of getCEsForTarget(state, instanceId)) {
    if (ce.modifierTag === "allow_tapless_battle_declare") {
      return true;
    }
  }
  return false;
}

function canBlockUnblockableByCE(
  state: GameState,
  instanceId: string
): boolean {
  return getCEsForTarget(state, instanceId).some(
    (ce) => ce.modifierTag === "block_unblockable"
  );
}

function isAttackParticipantUnblockable(
  state: GameState,
  participantEntityId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  options?: { ignoreEffectsFromPlayerId?: string }
): boolean {
  const participant = getBattleEntityById(state, participantEntityId);
  if (!participant) return false;
  return participant.memberInstanceIds.some((instanceId) => {
    const card = getCardById(state, instanceId);
    return (
      getCEsForTarget(state, instanceId).some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.actingPlayerId !== options?.ignoreEffectsFromPlayerId
      ) ||
      (card !== undefined &&
        hasApplicableGlobalBattleCE(
          state,
          card,
          getCardDefinitionById,
          ["unblockable"],
          options
        ))
    );
  });
}

function isAttackParticipantUnblockableSpiritOrUltimate(
  state: GameState,
  participantEntityId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  const participant = getBattleEntityById(state, participantEntityId);
  if (!participant) return false;
  const hasUnblockableCE = isAttackParticipantUnblockable(
    state,
    participantEntityId,
    getCardDefinitionById
  );
  if (!hasUnblockableCE) return false;

  const leaderInstanceId = participant.memberInstanceIds[0];
  if (!leaderInstanceId) return false;
  const leaderCard = state.cardInstances.find(
    (card) => card.instanceId === leaderInstanceId
  );
  if (!leaderCard) return false;
  const leaderDef = getCardDefinitionById(leaderCard.definitionId);
  if (!leaderDef) return false;
  const effectiveCategory = getEffectiveCategory(state, leaderCard, leaderDef);
  if (effectiveCategory === "spirit" || effectiveCategory === "ultimate") {
    return true;
  }
  return false;
}

function hasAnyBlockedParticipant(state: GameState): boolean {
  return (
    state.activeAttack?.blockAssignments.some(
      (assignment) => assignment.blockedByEntityIds.length > 0
    ) ?? false
  );
}

/**
 * この participant (アタッカー) をブロックするために必要な最小ブロッカー数を返す
 * (P2-05 Phase 5)。既定 1。`require_multi_block` CE (BSFT01-TR06(B) 型) の判定結果は
 * `blockerCapacity` と同様にアタック宣言確定時に `assignment.requiredBlockerCount` へ
 * スナップショットされている (SSOT、confirmAttackDeclarationAsAction 参照)。
 */
export function getRequiredBlockerCountForParticipant(
  state: GameState,
  participantEntityId: string
): number {
  const assignment = getActiveAttackAssignment(state, participantEntityId);
  return assignment?.requiredBlockerCount ?? 1;
}

/**
 * アタック宣言確定時、participant ごとの複数体ブロック強制数をスナップショットする
 * (P2-05 Phase 5)。攻撃側プレイヤー (`actingPlayerId`) に `require_multi_block` CE
 * (BSFT01-TR06(B) 型) があり、かつ participant のリーダーカードが filter に合致する
 * 場合のみ 2 以上を返す。合致しなければ undefined (既定 1 扱い)。
 */
export function resolveRequiredBlockerCountForAttacker(
  state: GameState,
  actingPlayerId: string,
  participantEntityId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): number | undefined {
  const grant = getRequiredMultiBlockGrant(state, actingPlayerId);
  if (!grant) return undefined;
  const participant = getBattleEntityById(state, participantEntityId);
  const leaderInstanceId = participant?.memberInstanceIds[0];
  const leaderCard = leaderInstanceId
    ? getCardById(state, leaderInstanceId)
    : undefined;
  const leaderDef = leaderCard
    ? getCardDefinitionById(leaderCard.definitionId)
    : undefined;
  if (!leaderCard || !leaderDef) return undefined;
  if (
    !matchesCardReferenceFilter(
      leaderCard,
      leaderDef,
      grant.filter,
      buildBattleCardFilterOptions({
        state,
        card: leaderCard,
        definition: leaderDef,
        getCardDefinitionById,
      })
    )
  ) {
    return undefined;
  }
  return grant.requiredBlockerCount;
}

/**
 * 現在のブロック宣言窓に、必要数未満のブロッカーしか宣言されていない participant
 * (複数体ブロック強制の途中状態) が存在するか (P2-05 Phase 5)。存在する間は防御側が
 * blockerCapacity 上限に達していてもブロック宣言の優先権を保持する
 * (2体目以降を宣言し終えるまで「ブロックしない」へ後退できない)。
 */
function getIncompleteRequiredMultiBlockParticipantEntityId(
  state: GameState
): string | null {
  const activeAttack = state.activeAttack;
  if (!activeAttack) return null;
  for (const assignment of activeAttack.blockAssignments) {
    if (assignment.blockedByEntityIds.length === 0) continue;
    const requiredCount = assignment.requiredBlockerCount ?? 1;
    if (assignment.blockedByEntityIds.length < requiredCount) {
      return assignment.participantEntityId;
    }
  }
  return null;
}

/**
 * 現在のアタックに対する防御側のブロック数上限を返す (P2-05)。
 * 単体アタック = 1。同時アタックは ActiveAttack.blockerCapacity
 * (allow_simultaneous_attack CE のスナップショット) を解決する。
 * 未設定の同時アタック = 1 (公式 Q26724)。
 */
export function getEffectiveBlockerCapacity(state: GameState): number {
  const activeAttack = state.activeAttack;
  if (activeAttack === null) return 0;
  if (activeAttack.groupMode !== "simultaneous") return 1;
  const capacity = activeAttack.blockerCapacity ?? 1;
  if (capacity === "participant_count") {
    return activeAttack.participantEntityIds.length;
  }
  return Math.max(1, capacity);
}

function countDeclaredBlocks(state: GameState): number {
  return (
    state.activeAttack?.blockAssignments.filter(
      (assignment) => assignment.blockedByEntityIds.length > 0
    ).length ?? 0
  );
}

/**
 * 防御側がまだ追加のブロック宣言を行いうる状態か (P2-05 複数ブロック)。
 * true の間は after_block flash を開けず、防御側の追加 block /
 * decline_block (=ブロック完了宣言) を待つ。
 * 1 件もブロックが無い場合は false (従来の decline 経路が担当)。
 *
 * P2-05 Phase 5: 複数体ブロック強制 (`requiredBlockerCount`) の途中状態
 * (1 体宣言済み・必要数未満) がある場合は、blockerCapacity 上限に関わらず true
 * (2体目以降を宣言し終えるまで後退できない)。
 */
export function canDeclareMoreBlocks(state: GameState): boolean {
  const activeAttack = state.activeAttack;
  if (activeAttack === null) return false;
  if (getIncompleteRequiredMultiBlockParticipantEntityId(state) !== null) {
    return true;
  }
  if (activeAttack.blockDeclarationCompleted === true) return false;
  const blockedCount = countDeclaredBlocks(state);
  if (blockedCount === 0) return false;
  const hasUnblockedParticipant = activeAttack.blockAssignments.some(
    (assignment) => assignment.blockedByEntityIds.length === 0
  );
  if (!hasUnblockedParticipant) return false;
  if (blockedCount < getEffectiveBlockerCapacity(state)) return true;
  return false;
}

/**
 * `getAttackDeclarationBlockReason` の本体から「このスピリットは可能ならこのターンの最初に
 * アタックする」チェックだけを除いたもの。`getPendingForcedFirstAttackerId` が強制対象カード
 * 自身の legality を判定する際にこちらを呼ぶことで、`getAttackDeclarationBlockReason` との
 * 相互再帰を避ける（強制チェックが自分自身の legality 判定に依存するため、素の
 * `getAttackDeclarationBlockReason` を再帰させると無限ループになる）。
 */
function getAttackDeclarationBlockReasonIgnoringForcedFirstAttacker(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): AttackDeclarationBlockReason | null {
  if (options.state.step !== "attack") {
    return "not_attack_step";
  }

  if (options.state.activePlayerId !== options.actingPlayerId) {
    return "not_active_player";
  }

  if (options.state.window !== "none") {
    return "window_not_open";
  }

  const sourceCard = getBattleCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown attack source card"
  );
  const sourceDefinition = getBattleCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );

  if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  if (sourceCard.zone !== "field") {
    return "source_not_on_field";
  }

  if (sourceCard.pendingLeaveKind !== null) {
    return "source_pending_leave";
  }

  if (sourceCard.attachedToInstanceId !== null) {
    return "source_is_attached";
  }

  if (!isBattleCapableCategory(sourceDefinition, sourceCard, options.state)) {
    return "source_category_cannot_attack";
  }

  // 異魔神ブレイヴはスピリット状態でも疲労しないため、宣言元にはできない。
  if (isCardExhaustionForbidden(sourceCard, sourceDefinition)) {
    return "source_not_ready";
  }

  // 魂状態のカードはアタック不可
  if (isSoulStateCard(options.state, options.sourceInstanceId)) {
    return "source_not_ready";
  }

  // CE によるアタック禁止チェック
  if (
    isAttackPreventedByCE(
      options.state,
      sourceCard,
      options.getCardDefinitionById
    )
  ) {
    return "source_not_ready"; // prevent_attack CE
  }

  if (
    sourceCard.exhaustState !== "recovered" &&
    !hasPendingAdditionalAttackGrant(options.state, options.sourceInstanceId) &&
    !(
      sourceCard.exhaustState === "exhausted" &&
      isAttackAllowedWhileExhaustedByCE(options.state, options.sourceInstanceId)
    )
  ) {
    return "source_not_ready";
  }

  if (options.state.activeAttack !== null) {
    return "another_attack_in_progress";
  }

  return null;
}

/**
 * アタック宣言の legality を判定する。`getAttackDeclarationBlockReasonIgnoringForcedFirstAttacker`
 * の基本チェックに加え、「このスピリットは可能ならこのターンの最初にアタックする」強制チェック
 * (ENGINE-force-first-attack-this-turn) を行う。強制対象カードが自分自身以外で、かつ強制対象
 * カード自身が現に合法アタック宣言可能 (`getPendingForcedFirstAttackerId` が非 null を返す内部で
 * `...IgnoringForcedFirstAttacker` を使い自己参照を避けている) なら、他カードのアタック宣言を
 * 抑止する。強制対象が既に疲労/離場等で宣言不能なら (「可能なら」)、通常のアタック宣言に戻る。
 */
export function getAttackDeclarationBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): AttackDeclarationBlockReason | null {
  const baseReason =
    getAttackDeclarationBlockReasonIgnoringForcedFirstAttacker(options);
  if (baseReason !== null) return baseReason;

  const forcedFirstAttackerId = getPendingForcedFirstAttackerId(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  if (
    forcedFirstAttackerId !== null &&
    forcedFirstAttackerId !== options.sourceInstanceId
  ) {
    return "forced_first_attacker_pending";
  }

  return null;
}

export function getJoinActiveAttackBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): JoinActiveAttackBlockReason | null {
  if (options.state.step !== "attack") {
    return "not_attack_step";
  }

  if (options.state.activePlayerId !== options.actingPlayerId) {
    return "not_active_player";
  }

  if (options.state.activeAttack === null) {
    return "no_active_attack";
  }

  const sourceCard = getBattleCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown join-attack source card"
  );
  const sourceDefinition = getBattleCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );

  if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  if (sourceCard.zone !== "field") {
    return "source_not_on_field";
  }

  if (sourceCard.pendingLeaveKind !== null) {
    return "source_pending_leave";
  }

  if (sourceCard.attachedToInstanceId !== null) {
    return "source_is_attached";
  }

  if (!isBattleCapableCategory(sourceDefinition, sourceCard, options.state)) {
    return "source_category_cannot_attack";
  }

  // 魂状態のカードはアタックへ合流できない
  if (isSoulStateCard(options.state, options.sourceInstanceId)) {
    return "source_not_ready";
  }

  if (
    isAttackPreventedByCE(
      options.state,
      sourceCard,
      options.getCardDefinitionById
    )
  ) {
    return "source_not_ready"; // prevent_attack CE
  }

  if (sourceCard.exhaustState !== "recovered") {
    return "source_not_ready";
  }

  const sourceBattleEntity = getBattleEntityByMemberInstanceId(
    options.state,
    options.sourceInstanceId
  );
  const sourceEntityId =
    sourceBattleEntity?.entityId ??
    getAttackEntityId(options.state, options.sourceInstanceId);

  if (
    options.state.activeAttack.participantEntityIds.includes(sourceEntityId)
  ) {
    return "source_already_in_active_attack";
  }

  return null;
}

function buildBattleCardFilterOptions(options: {
  state: GameState;
  card: CardInstance;
  definition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): MatchCardFilterOptions {
  const identity = resolveEffectiveIdentity(
    options.state,
    options.card,
    options.definition,
    options.getCardDefinitionById
  );
  return {
    state: options.state,
    effectiveCategory: identity.category,
    effectiveTribes: identity.tribes,
    effectiveColors: identity.colors,
    effectiveBp:
      options.card.zone === "field"
        ? getCombinedUnitBp(
            options.state,
            options.card,
            options.definition,
            options.getCardDefinitionById
          )
        : undefined,
    effectiveLevel: options.card.zone === "field" ? identity.level : undefined,
    coreCount: getTotalCoresOnCardById(options.state, options.card.instanceId),
    effectiveSymbolCount:
      options.card.zone === "field"
        ? getCombinedUnitSymbolCount(
            options.state,
            options.card,
            options.definition,
            options.getCardDefinitionById
          )
        : undefined,
  };
}

function requireBlockIfAbleMatchesParticipant(options: {
  state: GameState;
  ce: ContinuousEffect;
  participantEntityId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const filter = options.ce.metadata?.attackerFilter as CardFilter | undefined;
  const participant = getBattleEntityById(
    options.state,
    options.participantEntityId
  );
  if (filter === undefined) {
    return (
      participant?.memberInstanceIds.includes(options.ce.sourceInstanceId) ??
      false
    );
  }
  const leaderInstanceId = participant?.memberInstanceIds[0];
  const leaderCard = leaderInstanceId
    ? getCardById(options.state, leaderInstanceId)
    : undefined;
  const leaderDef = leaderCard
    ? options.getCardDefinitionById(leaderCard.definitionId)
    : undefined;
  return (
    leaderCard !== undefined &&
    leaderDef !== undefined &&
    matchesCardReferenceFilter(
      leaderCard,
      leaderDef,
      filter,
      buildBattleCardFilterOptions({
        state: options.state,
        card: leaderCard,
        definition: leaderDef,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    )
  );
}

function requireBlockIfAbleMatchesBlockerFilter(options: {
  state: GameState;
  ce: ContinuousEffect;
  card: CardInstance;
  definition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const filter = options.ce.metadata?.blockerFilter as CardFilter | undefined;
  const matchesFilter =
    filter === undefined ||
    matchesCardFilter(
      options.card,
      options.definition,
      filter,
      buildBattleCardFilterOptions({
        state: options.state,
        card: options.card,
        definition: options.definition,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    );
  return matchesFilter;
}

function requireBlockIfAbleMatchesBlocker(options: {
  state: GameState;
  ce: ContinuousEffect;
  card: CardInstance;
  definition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  if (!requireBlockIfAbleMatchesBlockerFilter(options)) {
    return false;
  }

  const sourceCard = getCardById(options.state, options.ce.sourceInstanceId);
  const sourceDefinition = sourceCard
    ? (options.getCardDefinitionById(sourceCard.definitionId) ??
      options.getCardDefinitionById(options.ce.sourceDefinitionId))
    : options.getCardDefinitionById(options.ce.sourceDefinitionId);
  const immunityDecision = resolveCardImmunityAffect(
    options.state,
    options.card,
    options.ce.actingPlayerId,
    readContinuousEffectPreventionLevel(options.ce),
    { instance: sourceCard, definition: sourceDefinition },
    options.getCardDefinitionById
  );
  return immunityDecision.kind === "allowed";
}

function readContinuousEffectPreventionLevel(
  ce: ContinuousEffect
): EffectPreventionLevel {
  const value = ce.metadata?.preventionLevel;
  return value === "unpreventable" || value === "immune" || value === "suppress"
    ? value
    : "none";
}

function getUnpreventableRequireBlockSourcePlayerId(options: {
  state: GameState;
  participantEntityId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string | undefined {
  const activeAttack = options.state.activeAttack;
  const attackingPlayerId = options.state.activePlayerId;
  if (activeAttack === null || attackingPlayerId === null) return undefined;

  for (const ce of getCEsForTarget(options.state, attackingPlayerId)) {
    if (ce.modifierTag !== "require_block_if_able") continue;
    if (ce.metadata?.preventionLevel !== "unpreventable") continue;
    if (requireBlockIfAbleMatchesParticipant({ ...options, ce })) {
      if (
        !requireBlockIfAbleMatchesBlocker({
          state: options.state,
          ce,
          card: options.sourceCard,
          definition: options.sourceDefinition,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      ) {
        continue;
      }
      return ce.actingPlayerId;
    }
  }
  return undefined;
}

export function getIgnoredBlockPreventPlayerIdForUnpreventableRequireBlock(options: {
  state: GameState;
  participantEntityId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string | undefined {
  const unpreventableRequireBlockSourcePlayerId =
    getUnpreventableRequireBlockSourcePlayerId(options);
  return unpreventableRequireBlockSourcePlayerId !== undefined &&
    unpreventableRequireBlockSourcePlayerId !==
      options.sourceCard.controllerPlayerId
    ? options.sourceCard.controllerPlayerId
    : undefined;
}

export function getBlockDeclarationBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  participantEntityId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /**
   * P2-05 Phase 5: 複数体ブロック強制の「候補が要求数だけ揃っているか」プリフライト検査
   * が候補を数える際、自己再帰による無限ループを避けるためにこの検査自体をスキップする
   * 内部フラグ。呼び出し元は通常指定しない。
   */
  skipMultiBlockPreflight?: boolean;
  /**
   * require_block_if_able の「義務対象 participant を優先してブロックする」検査が
   * 合法候補を数えるとき、自己再帰を避けるためにこの検査だけをスキップする内部フラグ。
   */
  skipRequireBlockIfAblePriority?: boolean;
}): BlockDeclarationBlockReason | null {
  if (options.state.step !== "attack") {
    return "not_attack_step";
  }

  const activeAttack = options.state.activeAttack;

  if (activeAttack === null) {
    return "no_active_attack";
  }

  if (options.state.battleImmediateEffects.length > 0) {
    return "pending_battle_immediate_effects";
  }

  if (activeAttack.flashWindowState !== null) {
    return "window_not_open";
  }

  if (!activeAttack.flashBeforeBlockCompleted) {
    return "window_not_open";
  }

  if (!canDeclareBlockInWindow(options.state.window)) {
    return "window_not_open";
  }

  if (activeAttack.target.kind !== "player") {
    return "active_attack_not_targeting_player";
  }

  if (activeAttack.target.playerId !== options.actingPlayerId) {
    return "not_defending_player";
  }

  const sourceCard = getBattleCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown block source card"
  );
  const sourceDefinition = getBattleCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );

  if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  if (sourceCard.zone !== "field") {
    return "source_not_on_field";
  }

  if (sourceCard.pendingLeaveKind !== null) {
    return "source_pending_leave";
  }

  if (sourceCard.attachedToInstanceId !== null) {
    return "source_is_attached";
  }

  if (!isBattleCapableCategory(sourceDefinition, sourceCard, options.state)) {
    return "source_category_cannot_block";
  }

  // 異魔神ブレイヴはスピリット状態でも疲労しないため、宣言元にはできない。
  if (isCardExhaustionForbidden(sourceCard, sourceDefinition)) {
    return "source_not_ready";
  }

  // 魂状態のカードはブロック不可
  if (isSoulStateCard(options.state, options.sourceInstanceId)) {
    return "source_not_ready";
  }

  const ignoreBlockPreventFromPlayerId =
    getIgnoredBlockPreventPlayerIdForUnpreventableRequireBlock({
      state: options.state,
      participantEntityId: options.participantEntityId,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    });

  if (
    isBlockPreventedByCE(
      options.state,
      sourceCard,
      options.getCardDefinitionById,
      ignoreBlockPreventFromPlayerId !== undefined
        ? { ignoreEffectsFromPlayerId: ignoreBlockPreventFromPlayerId }
        : undefined
    )
  ) {
    return "source_not_ready"; // prevent_battle_block CE
  }

  // 通常は回復状態のみブロック可。ただし「疲労状態でもブロックできる」CE 付与時は
  // 疲労/重疲労状態でもブロック宣言を許可する（block-while-exhausted）。
  if (
    sourceCard.exhaustState !== "recovered" &&
    !isBlockAllowedWhileExhaustedByCE(options.state, options.sourceInstanceId)
  ) {
    return "source_not_ready";
  }

  const sourceBattleEntity = getBattleEntityByMemberInstanceId(
    options.state,
    options.sourceInstanceId
  );
  const sourceEntityId =
    sourceBattleEntity?.entityId ??
    getAttackEntityId(options.state, options.sourceInstanceId);

  if (activeAttack.participantEntityIds.includes(sourceEntityId)) {
    return "source_already_in_active_attack";
  }

  if (
    sourceBattleEntity?.attackState === "blocking" ||
    isEntityAssignedAsBlocker(options.state, sourceEntityId)
  ) {
    return "source_already_blocking";
  }

  if (
    !activeAttack.participantEntityIds.includes(options.participantEntityId)
  ) {
    return "participant_not_in_active_attack";
  }

  if (
    battleEntityHasNoFieldReadyMember(
      options.state,
      options.participantEntityId
    )
  ) {
    return "participant_not_ready";
  }

  const participantIsUnblockable = isAttackParticipantUnblockable(
    options.state,
    options.participantEntityId,
    options.getCardDefinitionById,
    ignoreBlockPreventFromPlayerId !== undefined
      ? { ignoreEffectsFromPlayerId: ignoreBlockPreventFromPlayerId }
      : undefined
  );
  const sourceCanBlockUnblockable =
    canBlockUnblockableByCE(options.state, options.sourceInstanceId) &&
    isAttackParticipantUnblockableSpiritOrUltimate(
      options.state,
      options.participantEntityId,
      options.getCardDefinitionById
    );

  if (participantIsUnblockable && !sourceCanBlockUnblockable) {
    return "attacker_unblockable";
  }

  const participantAssignment = getActiveAttackAssignment(
    options.state,
    options.participantEntityId
  );

  if (!participantAssignment) {
    return "participant_not_in_active_attack";
  }

  const requiredBlockerCount = participantAssignment.requiredBlockerCount ?? 1;

  if (participantAssignment.blockedByEntityIds.length >= requiredBlockerCount) {
    return "participant_already_blocked";
  }

  if (!options.skipRequireBlockIfAblePriority) {
    const pendingRequiredParticipantEntityId =
      getPendingRequireBlockIfAbleParticipantEntityId({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
      });
    if (
      pendingRequiredParticipantEntityId !== null &&
      pendingRequiredParticipantEntityId !== options.participantEntityId
    ) {
      return "required_block_if_able_pending";
    }
    if (pendingRequiredParticipantEntityId === options.participantEntityId) {
      const requireBlockCEs = getRequireBlockIfAbleCEsForParticipant({
        state: options.state,
        participantEntityId: options.participantEntityId,
        getCardDefinitionById: options.getCardDefinitionById,
      });
      if (
        requireBlockCEs.length > 0 &&
        !requireBlockCEs.some((ce) =>
          requireBlockIfAbleMatchesBlockerFilter({
            state: options.state,
            ce,
            card: sourceCard,
            definition: sourceDefinition,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        )
      ) {
        return "required_block_if_able_pending";
      }
    }
  }

  // P2-05 Phase 5: 複数体ブロック強制の 2 体目以降は「新たな攻撃対象をブロックする」
  // わけではないため、ブロック数上限 (= 何体の攻撃対象をブロックするか) の対象外とする。
  const isCompletingPartialMultiBlock =
    participantAssignment.blockedByEntityIds.length > 0;

  // P2-05: ブロック数上限 (単体=1 / 同時アタックは blockerCapacity)。
  if (
    !isCompletingPartialMultiBlock &&
    countDeclaredBlocks(options.state) >=
      getEffectiveBlockerCapacity(options.state)
  ) {
    return "block_capacity_reached";
  }

  if (!options.skipMultiBlockPreflight) {
    // P2-05 Phase 5: 別の participant が複数体ブロック強制の途中 (必要数未満) なら、
    // それを完了するまで他の participant への新規ブロック宣言は不可。
    const incompleteParticipantEntityId =
      getIncompleteRequiredMultiBlockParticipantEntityId(options.state);
    if (
      incompleteParticipantEntityId !== null &&
      incompleteParticipantEntityId !== options.participantEntityId
    ) {
      return "pending_incomplete_multi_block";
    }

    // P2-05 Phase 5: 複数体ブロック強制の 1 体目を宣言する際、要求数を満たせる候補が
    // 場に揃っているか事前検証する。揃わない場合、1 体だけブロックした不正な中間状態に
    // 入ってしまうのを防ぐため、このアタッカーはそもそもブロック宣言できない。
    if (
      !isCompletingPartialMultiBlock &&
      requiredBlockerCount > 1 &&
      countEligibleMultiBlockCandidates({
        ...options,
        requiredBlockerCount,
      }) < requiredBlockerCount
    ) {
      return "insufficient_blockers_for_required_multi_block";
    }
  }

  // P2-05: 防御側が「これ以上ブロックしない」を宣言済み。
  if (activeAttack.blockDeclarationCompleted === true) {
    return "block_declaration_completed";
  }

  return null;
}

/**
 * P2-05 Phase 5: `participantEntityId` を複数体ブロック強制でブロックできる候補
 * (`sourceInstanceId` を含む) が場に何体いるかを数える。`getBlockDeclarationBlockReason`
 * を `skipMultiBlockPreflight:true` で候補ごとに再評価する (SSOT: 他の全ブロック合法性
 * 判定を再実装せず共有する)。
 */
function countEligibleMultiBlockCandidates(options: {
  state: GameState;
  actingPlayerId: string;
  participantEntityId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  requiredBlockerCount: number;
}): number {
  let count = 0;
  for (const card of options.state.cardInstances) {
    if (
      card.zone !== "field" ||
      card.controllerPlayerId !== options.actingPlayerId
    ) {
      continue;
    }
    const reason = getBlockDeclarationBlockReason({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: card.instanceId,
      participantEntityId: options.participantEntityId,
      getCardDefinitionById: options.getCardDefinitionById,
      skipMultiBlockPreflight: true,
      skipRequireBlockIfAblePriority: true,
    });
    if (reason === null) {
      count += 1;
      if (count >= options.requiredBlockerCount) {
        return count;
      }
    }
  }
  return count;
}

function getRequireBlockIfAbleCEsForParticipant(options: {
  state: GameState;
  participantEntityId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): ContinuousEffect[] {
  const attackingPlayerId = options.state.activePlayerId;
  if (attackingPlayerId === null) return [];

  const result: ContinuousEffect[] = [];
  for (const ce of getCEsForTarget(options.state, attackingPlayerId)) {
    if (ce.modifierTag !== "require_block_if_able") continue;
    if (
      requireBlockIfAbleMatchesParticipant({
        ...options,
        ce,
      })
    ) {
      result.push(ce);
    }
  }

  return result;
}

function getPendingRequireBlockIfAbleParticipantEntityId(options: {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string | null {
  const activeAttack = options.state.activeAttack;
  if (activeAttack === null) return null;

  for (const assignment of activeAttack.blockAssignments) {
    const requireBlockCEs = getRequireBlockIfAbleCEsForParticipant({
      ...options,
      participantEntityId: assignment.participantEntityId,
    });
    if (requireBlockCEs.length === 0) continue;
    if (
      assignment.blockedByEntityIds.length >=
      (assignment.requiredBlockerCount ?? 1)
    ) {
      continue;
    }

    for (const card of options.state.cardInstances) {
      if (
        card.zone !== "field" ||
        card.controllerPlayerId !== options.actingPlayerId
      ) {
        continue;
      }
      const definition = options.getCardDefinitionById(card.definitionId);
      if (definition === undefined) continue;
      if (
        !requireBlockCEs.some((ce) =>
          requireBlockIfAbleMatchesBlocker({
            state: options.state,
            ce,
            card,
            definition,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        )
      ) {
        continue;
      }
      if (
        getBlockDeclarationBlockReason({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: card.instanceId,
          participantEntityId: assignment.participantEntityId,
          getCardDefinitionById: options.getCardDefinitionById,
          skipRequireBlockIfAblePriority: true,
        }) === null
      ) {
        return assignment.participantEntityId;
      }
    }
  }

  return null;
}

/**
 * P3-55 Phase B: 防御側 (非アクティブプレイヤー) の `decline_block` action が
 * legal にならない理由を返す。前提:
 * - before_block flash が完了していること (flashBeforeBlockCompleted=true)
 * - まだブロック宣言が 1 件もないこと (一度でも宣言したら decline 経路には戻らない)
 * - フラッシュ窓 / battle resolution / battle immediate effect の解決中でないこと
 */
export function getDeclineBlockBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): DeclineBlockBlockReason | null {
  if (options.state.step !== "attack") {
    return "not_attack_step";
  }

  if (options.state.activePlayerId === options.actingPlayerId) {
    return "not_defending_player";
  }

  if (options.state.activeAttack === null) {
    return "no_active_attack";
  }

  if (options.state.battleImmediateEffects.length > 0) {
    return "pending_battle_immediate_effects";
  }

  if (options.state.activeAttack.flashWindowState !== null) {
    return "flash_window_open";
  }

  if (!options.state.activeAttack.flashBeforeBlockCompleted) {
    return "before_block_flash_not_completed";
  }

  // P2-05: 複数ブロック中 (まだ追加ブロック可能) の decline_block は
  // 「残りはブロックしない」完了宣言として legal。追加ブロック余地が無い
  // ブロック済み状態では従来どおり手遅れ。
  if (
    hasAnyBlockedParticipant(options.state) &&
    !canDeclareMoreBlocks(options.state)
  ) {
    return "block_already_declared";
  }

  if (getPendingRequireBlockIfAbleParticipantEntityId(options) !== null) {
    return "required_block_if_able";
  }

  if (options.state.battleResolutionGroup !== null) {
    return "battle_resolution_group_already_exists";
  }

  if (!canStartBattleResolutionInWindow(options.state.window)) {
    return "window_not_open";
  }

  return null;
}

export function getOpenBattleFlashBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  flashKind: BattleFlashWindowKind;
}): OpenBattleFlashBlockReason | null {
  if (options.state.step !== "attack") {
    return "not_attack_step";
  }

  if (options.state.activePlayerId !== options.actingPlayerId) {
    return "not_active_player";
  }

  const activeAttack = options.state.activeAttack;

  if (activeAttack === null) {
    return "no_active_attack";
  }

  if (options.state.battleImmediateEffects.length > 0) {
    return "pending_battle_immediate_effects";
  }

  if (options.state.battleResolutionGroup !== null) {
    return "battle_resolution_group_already_exists";
  }

  if (activeAttack.flashWindowState !== null) {
    return "flash_window_already_open";
  }

  if (options.flashKind === "before_block") {
    if (options.state.window !== "declare_attack") {
      return "window_not_open";
    }

    if (activeAttack.designatedTargetInstanceId !== undefined) {
      return "window_not_open";
    }

    if (activeAttack.flashBeforeBlockCompleted) {
      return "flash_window_already_completed";
    }

    return null;
  }

  if (options.state.window !== "declare_block") {
    return "window_not_open";
  }

  if (!hasAnyBlockedParticipant(options.state)) {
    return "after_block_flash_not_available";
  }

  // P2-05: 複数ブロック中は防御側の全ブロック宣言完了
  // (容量到達 / 未ブロック participant 消化 / decline_block 完了宣言) まで
  // after_block flash を開けない。
  if (canDeclareMoreBlocks(options.state)) {
    return "block_declaration_not_completed";
  }

  if (activeAttack.flashAfterBlockCompleted) {
    return "flash_window_already_completed";
  }

  return null;
}

export function getPassBattleFlashBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
}): PassBattleFlashBlockReason | null {
  if (options.state.step !== "attack") {
    return "not_attack_step";
  }

  const activeAttack = options.state.activeAttack;

  if (activeAttack === null) {
    return "no_active_attack";
  }

  if (
    options.state.window !== "flash_before_block" &&
    options.state.window !== "flash_after_block" &&
    options.state.window !== "stack_before_block" &&
    options.state.window !== "stack_after_block"
  ) {
    return "flash_window_not_open";
  }

  const flashWindowState = activeAttack.flashWindowState;

  if (flashWindowState === null) {
    return "flash_window_state_missing";
  }

  if (flashWindowState.priorityPlayerId !== options.actingPlayerId) {
    return "not_priority_player";
  }

  return null;
}
