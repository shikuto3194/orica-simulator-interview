/**
 * 堅牢な self-play ドライバ (MCTS rollout / 自己対戦学習の土台)。
 *
 * ランダムポリシーでゲームを終局まで進める。各 LegalAction が要求する追加入力
 * (進入コア配置など) を供給し、pending キューを確実に drain することで stuck を排除する。
 *
 * MCTS からは legalActionsFor / applyChosenAction / advance を再利用する
 * (chooseAction を方策ネットに差し替えるだけで同じ駆動経路を使える)。
 */
import {
  initializeGame,
  getLegalActions,
  applyLegalAction,
  advanceStep,
  getCurrentActorPlayerIds,
  getGameProgressBlockerReason,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  expandCardDefinitionsWithBackFaces,
  canProvideEnterFieldCorePlacementSource,
  coreShootSoulDestinationAllowed,
  randomDeck as buildRandomDeck,
  trainingProgressFingerprint,
  type CardDefinition,
  type GameState,
  type LegalAction,
  type ApplyLegalActionOptions,
} from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import {
  generateActionInputChoices,
  summonCostExcludePaymentChoicesForSelection,
} from "../../../packages/rules-core/src/action-input-choices";

export type EngineLookups = {
  getRegisteredTriggeredEffectActions: ReturnType<
    typeof buildTriggeredEffectLookup
  >;
  getRegisteredBurstActions: ReturnType<typeof buildBurstEffectLookup>;
  getRegisteredBattleImmediateEffectActions: ReturnType<
    typeof buildBattleImmediateEffectLookup
  >;
  getRegisteredFieldCardEffectActions: ReturnType<
    typeof buildFieldCardEffectLookup
  >;
  getRegisteredHandActivatedEffectActions: ReturnType<
    typeof buildHandActivatedEffectLookup
  >;
  getRegisteredMagicActions: ReturnType<typeof buildMagicLookup>;
};

export interface Engine {
  cards: CardDefinition[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  lookups: EngineLookups;
}

export function buildEngine(): Engine {
  const cards = ALL_CARDS as CardDefinition[];
  // 両面カードの裏面 (backFace) を定義ルックアップ・効果レジストリへ登録する
  // (SSOT: production と同じ展開関数)。転醒後の instance は definitionId が裏面
  // cardNo へ swap されるため、裏面定義が無いと getCardDefinitionById が undefined を
  // 返してコスト計算等で throw する。デッキ構築プール (cards) は表面のみのまま。
  const withBackFaces = expandCardDefinitionsWithBackFaces(cards);
  const cardNoMap = new Map<string, CardDefinition>(
    withBackFaces.map((c) => [c.cardNo, c])
  );
  const getCardDefinitionById = (id: string) => cardNoMap.get(id);
  const lookups: EngineLookups = {
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(withBackFaces),
    getRegisteredBurstActions: buildBurstEffectLookup(withBackFaces),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(withBackFaces),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(withBackFaces),
    getRegisteredHandActivatedEffectActions:
      buildHandActivatedEffectLookup(withBackFaces),
    getRegisteredMagicActions: buildMagicLookup(withBackFaces),
  };
  return { cards, getCardDefinitionById, lookups };
}

/** 乱数生成器 (0 以上 1 未満)。既定は Math.random。 */
export type Rng = () => number;

/** mulberry32: seed 固定再現用の軽量 PRNG。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomDeck(
  cards: CardDefinition[],
  size = 40,
  rng: Rng = Math.random,
  options: { allowUnavailableDeckCards?: boolean } = {}
): CardDefinition[] {
  return buildRandomDeck(cards, size, rng, options);
}

/**
 * 進入プレイヤーの利用可能コアから minimumCoreCount 個を集めて配置を作る。
 * リザーブ通常コア → リザーブソウルコア → 自場の通常/ソウルコアの順に取る。
 */
function buildEnterFieldPlacements(
  state: GameState,
  count: number,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): ApplyLegalActionOptions["enterFieldCorePlacements"] {
  const pending = state.pendingEnterFieldPlacement;
  if (!pending) return [];
  const owner = pending.actingPlayerId;
  const placements: Array<
    | { kind: "reserve_normal"; amount: number }
    | { kind: "reserve_soul" }
    | { kind: "card_normal"; instanceId: string; amount: number }
    | { kind: "card_soul"; instanceId: string }
  > = [];
  let need = count;

  const player = state.players.find((p) => p.id === owner);
  const fromReserve = Math.min(need, player?.reserveNormalCoreCount ?? 0);
  if (fromReserve > 0) {
    placements.push({ kind: "reserve_normal", amount: fromReserve });
    need -= fromReserve;
  }

  if (need > 0 && (player?.reserveSoulCoreCount ?? 0) > 0) {
    placements.push({ kind: "reserve_soul" });
    need -= 1;
  }

  for (const coreKind of ["normal", "soul"] as const) {
    if (need <= 0) break;
    for (const card of state.cardInstances) {
      if (need <= 0) break;
      if (card.controllerPlayerId !== owner) continue;
      if (card.zone !== "field") continue;
      if (card.instanceId === pending.sourceInstanceId) continue;
      const definition = getCardDefinitionById?.(card.definitionId);
      const canProvide = definition
        ? canProvideEnterFieldCorePlacementSource(
            state,
            owner,
            card,
            definition,
            coreKind
          )
        : coreKind === "normal"
          ? (card.normalCoreCount ?? 0) > 0
          : (card.soulCoreCount ?? 0) > 0;
      if (!canProvide) continue;

      if (coreKind === "soul") {
        placements.push({ kind: "card_soul", instanceId: card.instanceId });
        need -= 1;
        continue;
      }

      const take = Math.min(need, card.normalCoreCount ?? 0);
      if (take > 0) {
        placements.push({
          kind: "card_normal",
          instanceId: card.instanceId,
          amount: take,
        });
        need -= take;
      }
    }
  }
  return placements;
}

/**
 * action が要求する追加入力を供給する (既知 kind のみ)。
 * 未知 kind は空 (エンジンの reserve 自動 fallback に委ねる)。
 */
export function resolveActionInputs(
  state: GameState,
  action: LegalAction,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): Partial<ApplyLegalActionOptions> {
  switch (action.kind) {
    case "resolve_pending_count_decrease":
    case "resolve_pending_effect_optional_repeat_count":
      return (
        generateActionInputChoices(
          state,
          action,
          { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
          1
        ).values[0] ?? {}
      );
    case "resolve_pending_multi_placement": {
      const choices = generateActionInputChoices(
        state,
        action,
        { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
        128
      ).values;
      const score = (input: Partial<ApplyLegalActionOptions>) =>
        (input.multiPlacementAllocations ?? [])
          .flatMap((entry) => entry.placements)
          .reduce(
            (total, entry) =>
              total +
              ("amount" in entry ? entry.amount : 1) * 100 +
              (entry.kind.includes("soul") ? 20 : 0) +
              (entry.kind.startsWith("reserve") ? 0 : 1),
            0
          );
      return choices.sort((a, b) => score(a) - score(b))[0] ?? {};
    }
    case "resolve_pending_core_distribution": {
      // The two phases use final target totals first and incoming physical
      // amounts second. Keep that distinction in the shared generator.
      if (action.targetTotalSelection !== undefined) {
        return (
          generateActionInputChoices(
            state,
            action,
            { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
            128
          ).values[0] ?? {}
        );
      }
      // pending core distribution は UI が配分先と (any_movable のときは) 物理的な
      // 移動元を選ぶ interactive action。空入力のまま apply すると、minimum を満たす
      // 配分でも 0 個を選んだものとして rollback される。自己対戦では最小必要数だけを
      // 先頭の候補へ配り、複数ソースなら no-op にならない source を明示する。
      const normalAllocations: Record<string, number> = {};
      const minTotal = action.minTotal ?? 0;
      const requestedNormal = action.mustPlaceSoulCore
        ? action.totalNormalCores
        : Math.min(action.totalNormalCores, minTotal);
      let remainingNormal = requestedNormal;
      const perCandidateMax =
        action.maxPerCandidate ?? Number.POSITIVE_INFINITY;
      for (const candidate of action.candidates) {
        if (remainingNormal <= 0) break;
        const amount = Math.min(perCandidateMax, remainingNormal);
        if (amount > 0) normalAllocations[candidate.instanceId] = amount;
        remainingNormal -= amount;
      }

      const positiveTargetIds = new Set(
        Object.entries(normalAllocations)
          .filter(([, amount]) => amount > 0)
          .map(([id]) => id)
      );
      const sourceAllocations: Record<string, number> = {};
      if (action.fromKind === "any_movable") {
        let remaining = requestedNormal;
        for (const [sourceKey, available] of Object.entries(
          action.sourceAvailable ?? {}
        )) {
          if (remaining <= 0) break;
          // 同じフィールドカードから同じカードへ動かす no-op は engine が禁止する。
          if (
            sourceKey.startsWith("field:") &&
            positiveTargetIds.has(sourceKey.slice("field:".length))
          ) {
            continue;
          }
          const combinedCap = action.sourceTotalAvailable?.[sourceKey];
          const take = Math.min(
            remaining,
            available,
            combinedCap ?? Number.POSITIVE_INFINITY
          );
          if (take > 0) {
            sourceAllocations[sourceKey] = take;
            remaining -= take;
          }
        }
      }

      const totalSoulCores =
        action.totalSoulCores ?? (action.hasSoulCore ? 1 : 0);
      const requiredSoulCount = action.mustPlaceSoulCore
        ? totalSoulCores
        : Math.min(totalSoulCores, Math.max(0, minTotal - requestedNormal));
      const soulCoreAllocations: Record<string, number> = {};
      if (requiredSoulCount > 0 && action.candidates[0]) {
        soulCoreAllocations[action.candidates[0].instanceId] =
          requiredSoulCount;
      }

      const soulCoreSourceAllocations: Record<string, number> = {};
      if (action.fromKind === "any_movable" && requiredSoulCount > 0) {
        let remaining = requiredSoulCount;
        for (const [sourceKey, available] of Object.entries(
          action.soulSourceAvailable ?? {}
        )) {
          if (remaining <= 0) break;
          if (
            sourceKey.startsWith("field:") &&
            sourceKey === `field:${action.candidates[0]?.instanceId}`
          ) {
            continue;
          }
          const remainingCombinedCapacity = Math.max(
            0,
            (action.sourceTotalAvailable?.[sourceKey] ??
              Number.POSITIVE_INFINITY) - (sourceAllocations[sourceKey] ?? 0)
          );
          const take = Math.min(
            remaining,
            available,
            remainingCombinedCapacity
          );
          if (take > 0) {
            soulCoreSourceAllocations[sourceKey] = take;
            remaining -= take;
          }
        }
      }

      return {
        coreDistributionAllocations: normalAllocations,
        ...(action.fromKind === "any_movable"
          ? { coreDistributionSourceAllocations: sourceAllocations }
          : {}),
        ...(requiredSoulCount > 0
          ? { coreDistributionSoulCoreAllocations: soulCoreAllocations }
          : {}),
        ...(action.fromKind === "any_movable" && requiredSoulCount > 0
          ? {
              coreDistributionSoulCoreSourceAllocations:
                soulCoreSourceAllocations,
            }
          : {}),
      };
    }
    case "resolve_pending_core_split": {
      // split destinations は action が公開する順で、各 cap を超えない最小の
      // 完全分配を作る。これを渡さないと handler は空配列を不正入力として拒否し、
      // continuation と pending leave を残したまま selfplay が停止する。
      let remaining = action.totalAmount;
      const coreSplitDistribution = action.destinations.map((destination) => {
        const amount = Math.min(remaining, destination.cap ?? remaining);
        remaining -= amount;
        return amount;
      });
      return { coreSplitDistribution };
    }
    case "resolve_pending_life_core_selection": {
      // ライフの通常/ソウルコアがともに候補になるときは、持ち主が内訳を明示する。
      // self-play は通常コアを優先し、残りだけソウルコアを選ぶ。これを省略すると
      // handler が choice 必須として reject し、pending が残ったまま fuzz が停止する。
      const normalChosen = Math.min(action.totalAmount, action.normalAvailable);
      return {
        lifeCorePartitionChoice: {
          normalChosen,
          soulChosen: action.totalAmount - normalChosen,
        },
      };
    }
    case "resolve_pending_triggered_effect": {
      // ENGINE-paid-prevention-immunity-card-cost Step3: payPreventionImmunityCost
      // variant で候補数が amount を超えるとき、明示 paidPreventionImmunityCardSelection
      // 未供給だと applyLegalAction が "explicit ... is required" で throw する
      // (候補数===amount のときは engine 側が自動確定するので何もしなくてよい)。
      const candidates =
        action.paidPreventionImmunityCardCostCandidateInstanceIds;
      const amount = action.paidPreventionImmunityCardCostAmount;
      if (candidates && amount !== undefined && candidates.length > amount) {
        return {
          paidPreventionImmunityCardSelection: candidates.slice(0, amount),
        };
      }
      return {};
    }
    case "resolve_pending_effect_summon_cost_payment": {
      // 発揮応答窓のクローズ後に生じる、効果文内 summon のコスト支払い。
      // この pending は human UI と同じく支払い元を明示しなければ解決できない。
      // self-play が入力を省略すると pending が残り、advanceStep もブロックされる
      // (fuzz seed 1558494941, BSTH02.7-X01)。LegalAction が公開する候補を使い、
      // まずリザーブ、次に場、最後に soul-only 候補の順でちょうど requiredCost を払う。
      let remaining = action.requiredCost;
      const summonPaymentSources: NonNullable<
        ApplyLegalActionOptions["summonPaymentSources"]
      > = [];

      const reserveNormalAmount = Math.min(
        remaining,
        action.availableReserveNormalCoreAmount
      );
      if (reserveNormalAmount > 0) {
        summonPaymentSources.push({
          kind: "reserve",
          amount: reserveNormalAmount,
        });
        remaining -= reserveNormalAmount;
      }

      // reserve には通常コアとソウルコアが最大 1 個ずつしかない。通常分で不足した
      // ときだけ、その差分 1 個を includeSoulCore で指定する。
      const reserveSoulAvailable = Math.max(
        0,
        action.availableReserveCoreAmount -
          action.availableReserveNormalCoreAmount
      );
      const reserveSoulAmount = Math.min(remaining, reserveSoulAvailable);
      if (reserveSoulAmount > 0) {
        summonPaymentSources.push({
          kind: "reserve",
          amount: reserveSoulAmount,
          includeSoulCore: true,
        });
        remaining -= reserveSoulAmount;
      }

      const paidCardIds = new Set<string>();
      for (const source of action.availableOnBoardCoreSources) {
        if (remaining <= 0) break;
        const amount = Math.min(remaining, source.availableCoreAmount);
        if (amount <= 0) continue;
        const card = state.cardInstances.find(
          (instance) => instance.instanceId === source.instanceId
        );
        summonPaymentSources.push({
          kind: "card",
          instanceId: source.instanceId,
          amount,
          ...(amount > (card?.normalCoreCount ?? 0) && source.soulCoreAvailable
            ? { includeSoulCore: true }
            : {}),
          ...(source.destination !== undefined
            ? { destination: source.destination }
            : {}),
        });
        paidCardIds.add(source.instanceId);
        remaining -= amount;
      }

      for (const source of action.availableSoulCoreOnlySources) {
        if (remaining <= 0) break;
        if (paidCardIds.has(source.instanceId)) continue;
        summonPaymentSources.push({
          kind: "card",
          instanceId: source.instanceId,
          amount: 1,
          includeSoulCore: true,
        });
        paidCardIds.add(source.instanceId);
        remaining -= 1;
      }

      return { summonPaymentSources };
    }
    case "resolve_pending_enter_field_placement": {
      const pending = state.pendingEnterFieldPlacement;
      const min = pending?.minimumCoreCount ?? 1;
      return {
        enterFieldCorePlacements: buildEnterFieldPlacements(
          state,
          min,
          getCardDefinitionById
        ),
      };
    }
    case "resolve_pending_effect_target":
    case "resolve_pending_step_optional_target_selection": {
      // 強制対象・group・重複可否も通常の意思決定と同じ生成器へ渡す。
      return (
        generateActionInputChoices(
          state,
          action,
          { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
          1
        ).values[0] ?? {}
      );
    }
    case "resolve_pending_as_if_soul_core_choice":
      return {};
    case "resolve_pending_deck_reveal_pick": {
      // デッキオープンの pick 入力。BSRK01-C01 実効果化で selfplay に
      // "加えられる"/"入れ替えられる" 型の任意 pick が露出した。入力未供給だと
      // 必須 pick で throw し、pendingDeckReveal が残って advanceStep stuck になる。
      let selected: string[];
      if (action.canSkip) {
        selected = [];
      } else if (action.exclusiveGroupBranches?.length) {
        // 排他選択グループ (XOR、BSTH08.5-X03/C23型): candidateCardInstanceIds は
        // 全ブランチの union のため、先頭から機械的に slice すると複数ブランチを
        // 跨いだ「どのブランチも満たさない」選択になり得る。候補が実在する
        // (costGate 支払い不能で候補0枚化されていない) 最初のブランチを採用する。
        const branch = action.exclusiveGroupBranches.find(
          (b) => b.candidateCardInstanceIds.length > 0
        );
        selected = branch
          ? branch.candidateCardInstanceIds.slice(0, branch.count)
          : [];
      } else {
        selected = action.candidateCardInstanceIds.slice(
          0,
          action.maxPickCount
        );
      }
      return {
        selectedDeckRevealCardIds: selected,
        ...(action.requiresFreeDestinationChoice && selected.length > 0
          ? {
              deckRevealPickFreeDestination:
                action.freeDestinationChoices?.[0] ?? ("hand" as const),
            }
          : {}),
      };
    }
    case "resolve_pending_deck_reveal_order": {
      const placements =
        action.remainder === "top_bottom_split"
          ? Object.fromEntries(
              action.remainingCardInstanceIds.map((id) => [id, "bottom"])
            )
          : undefined;
      return {
        deckRevealRemainderOrder: action.remainingCardInstanceIds,
        ...(action.remainder === "top_or_bottom"
          ? { deckRevealPlacement: "bottom" as const }
          : {}),
        ...(placements !== undefined
          ? {
              deckRevealRemainderPlacements: placements as Record<
                string,
                "top" | "bottom"
              >,
            }
          : {}),
      };
    }
    case "resolve_pending_zone_selection": {
      return (
        generateActionInputChoices(
          state,
          action,
          { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
          1
        ).values[0] ?? {}
      );
    }
    case "resolve_pending_summon_cost_exclude_choice": {
      // 最大枚数の除外を優先し、支払いは通常入力と同じ生成器へ委譲する。
      // reserve不足時の場/ソウルコアとfullCostPaid/fullReductionを独自計算しない。
      const selected = action.candidateCardInstanceIds.slice(
        0,
        action.maxCount
      );
      const payment = summonCostExcludePaymentChoicesForSelection(
        state,
        action,
        selected,
        1
      ).values[0];
      if (payment) {
        return {
          summonCostExcludeSelectedCardInstanceIds: selected,
          ...payment,
        };
      }
      // 場からの除外が支払い元も失わせる場合は別の合法な除外集合を探す。
      return (
        generateActionInputChoices(
          state,
          action,
          { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
          128
        ).values[0] ?? {}
      );
    }
    case "resolve_pending_summon_cost_core_move_choice": {
      // コア移動後の追加コストも同時に払う。無償召喚/割引だけから支払0と推定しない。
      return (
        generateActionInputChoices(
          state,
          action,
          { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
          128
        ).values[0] ?? {}
      );
    }
    case "resolve_pending_core_shoot": {
      // P3-151: activeAttack 中に露出するコアシュート選択。供給しないと
      // applyPendingCoreShootAction が distribution 0 (totalDistributed < minTotal) で
      // throw し、advanceStep も activeAttack ガードで throw して stuck になる。
      // forced_target_inclusion 対象 (mandatoryTargetInstanceIds) には最低 1 個ずつ
      // 割り振り、残りを候補の availableCores 上限まで貪欲に埋める。
      //
      // 注意 (adversarial verifier round1 refute): candidate.availableCores は
      // ソウルコア候補カードだと normalCoreCount+1 を含み得る
      // (structured-core-shoot.ts の movableCores = normalCoreCount + soulCoresMovable)。
      // distribution (= coreShootDistribution) は通常コアのみの経路で、apply 側
      // (effect-target-handlers.ts) が amount > card.normalCoreCount を throw するため、
      // availableCores をそのまま distribution の上限に使うと超過し得る。通常コア分は
      // card.normalCoreCount で頭打ちにし、ソウルコア分だけ別枠の
      // coreShootSoulCoreInstanceId で渡す。
      const normalCoreCap = (id: string): number => {
        const card = state.cardInstances.find((c) => c.instanceId === id);
        // reserve sentinel 等 cardInstances に無い候補は通常コアのみでキャップ不要。
        return card ? card.normalCoreCount : Number.POSITIVE_INFINITY;
      };
      // adversarial verifier round2 refute: ResolvePendingCoreShootLegalAction には
      // toKind が無く、availableCores だけでは移動先がソウルコア不可 (void 等) かを
      // 判別できない。BattleScreen.tsx の GUI 実装 (soulDestBlocked 相当) と同じ判定を
      // SSOT の coreShootSoulDestinationAllowed 経由で行う (state.pendingCoreShootSelection.toKind
      // を直読みするだけだと "void" 以外の不可 kind が増えたときに追従できない)。
      const soulDestBlocked = !coreShootSoulDestinationAllowed(
        state.pendingCoreShootSelection?.toKind ?? ""
      );
      const fromPlayer = state.players.find(
        (p) => p.id === action.fromPlayerId
      );
      const soulLocation = fromPlayer?.soulCoreLocation;
      const soulCardId =
        !soulDestBlocked &&
        soulLocation?.kind === "card" &&
        action.candidates.some((c) => c.instanceId === soulLocation.instanceId)
          ? soulLocation.instanceId
          : undefined;

      const distribution: Record<string, number> = {};
      let remaining = action.totalAmount;
      let coreShootSoulCoreInstanceId: string | undefined;

      for (const id of action.mandatoryTargetInstanceIds ?? []) {
        if (remaining <= 0) continue;
        if (id === soulCardId && coreShootSoulCoreInstanceId === undefined) {
          coreShootSoulCoreInstanceId = id;
          remaining -= 1;
          continue;
        }
        const candidate = action.candidates.find((c) => c.instanceId === id);
        const cap = Math.min(candidate?.availableCores ?? 0, normalCoreCap(id));
        if (!candidate || cap <= 0) continue;
        distribution[id] = 1;
        remaining -= 1;
      }
      for (const candidate of action.candidates) {
        if (
          remaining > 0 &&
          candidate.instanceId === soulCardId &&
          coreShootSoulCoreInstanceId === undefined
        ) {
          coreShootSoulCoreInstanceId = candidate.instanceId;
          remaining -= 1;
        }
        if (remaining <= 0) break;
        const already = distribution[candidate.instanceId] ?? 0;
        const cap = Math.min(
          candidate.availableCores,
          normalCoreCap(candidate.instanceId)
        );
        const capacity = cap - already;
        if (capacity <= 0) continue;
        const take = Math.min(capacity, remaining);
        distribution[candidate.instanceId] = already + take;
        remaining -= take;
      }
      return {
        coreShootDistribution: distribution,
        ...(coreShootSoulCoreInstanceId ? { coreShootSoulCoreInstanceId } : {}),
      };
    }
    case "resolve_core_source_allocation": {
      // 通常コアの配分とソウルコアの指定は別入力。available は両者の合計。
      // 候補順に支払い、通常コア上限を超える分はソウル1個で補う。
      const allocations: Record<string, number> = {};
      let coreSourceSoulCoreInstanceId: string | undefined;
      let need = action.requiredTotal;
      for (const cand of action.candidates) {
        if (need <= 0) break;
        const take = Math.min(
          need,
          cand.available,
          cand.normalAvailable ?? cand.available
        );
        if (take > 0) allocations[cand.instanceId] = take;
        need -= take;
        if (
          need > 0 &&
          cand.hasSoulCore &&
          take < cand.available &&
          coreSourceSoulCoreInstanceId === undefined
        ) {
          coreSourceSoulCoreInstanceId = cand.instanceId;
          need -= 1;
        }
      }
      return {
        coreSourceAllocations: allocations,
        ...(coreSourceSoulCoreInstanceId
          ? { coreSourceSoulCoreInstanceId }
          : {}),
      };
    }
    default:
      // 通常行動も GUI / PlayerDecision と同じ入力生成器を使う。支払い元を
      // 省略して合法な召喚等を失敗扱いにし、別行動へ逃げることを防ぐ。
      return (
        generateActionInputChoices(
          state,
          action,
          { ...(getCardDefinitionById ? { getCardDefinitionById } : {}) },
          1
        ).values[0] ?? {}
      );
  }
}

/** 現在の手番者と、その合法手 (can===true) を返す。全 actor を順に試す。 */
export function legalActionsFor(
  state: GameState,
  engine: Engine
): { actor?: string; actions: LegalAction[] } {
  for (const actor of getCurrentActorPlayerIds(state, {
    getCardDefinitionById: engine.getCardDefinitionById,
    ...engine.lookups,
  })) {
    const acts = getLegalActions({
      state,
      actingPlayerId: actor,
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    }).filter((a) => a.can);
    if (acts.length > 0) return { actor, actions: acts };
  }
  return { actor: undefined, actions: [] };
}

/** 選んだ行動を適用 (必要な追加入力を供給)。失敗時は throw。純関数: 新 state を返す。 */
export function applyChosenAction(
  state: GameState,
  action: LegalAction,
  engine: Engine
): GameState {
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById: engine.getCardDefinitionById,
    ...engine.lookups,
    ...resolveActionInputs(state, action, engine.getCardDefinitionById),
  }).state;
}

/** ステップ進行 (合法手が無いときの強制進行)。失敗時は throw。 */
export function advance(state: GameState, engine: Engine): GameState {
  return advanceStep(
    state,
    engine.getCardDefinitionById,
    engine.lookups.getRegisteredTriggeredEffectActions,
    engine.lookups.getRegisteredBurstActions,
    engine.lookups.getRegisteredMagicActions
  );
}

/** 終局時の勝者 (引き分け/不明は null)。 */
export function winnerOf(state: GameState): string | null {
  if (state.gameResult === null) return null;
  const losing = state.gameResult.losingPlayerId;
  if (state.gameResult.kind === "draw" || !losing) return null;
  return state.playerOrder.find((p) => p !== losing) ?? null;
}

export type Outcome = "natural" | "capped" | "stuck" | "error";
export interface GameResult {
  steps: number;
  outcome: Outcome;
  winner: string | null;
  lastError?: string;
}

const RECENT_TRANSITION_LIMIT = 24;

function stateCursor(state: GameState): string {
  return `turn=${state.turnNumber},active=${state.activePlayerId},step=${state.step},window=${state.window}`;
}

function recordTransition(
  recentTransitions: string[],
  before: string,
  transition: string,
  after: GameState
): void {
  recentTransitions.push(`${before} --${transition}--> ${stateCursor(after)}`);
  if (recentTransitions.length > RECENT_TRANSITION_LIMIT) {
    recentTransitions.shift();
  }
}

function actionDiagnostic(action: LegalAction, state: GameState): string {
  const record = action as unknown as Record<string, unknown>;
  const details = [
    "actionId",
    "sourceCardNo",
    "sourceInstanceId",
    "sourceEffectInstanceId",
    "braveInstanceId",
    "hostInstanceId",
    "targetInstanceId",
    "registrationIndex",
    "choiceIndex",
  ]
    .flatMap((key) =>
      record[key] === undefined ? [] : [`${key}=${String(record[key])}`]
    )
    .join(",");
  const sourceInstanceId =
    typeof record.sourceInstanceId === "string"
      ? record.sourceInstanceId
      : undefined;
  const sourceCard =
    sourceInstanceId !== undefined
      ? state.cardInstances.find((card) => card.instanceId === sourceInstanceId)
      : undefined;
  const sourceState =
    sourceCard !== undefined
      ? `sourceState=${sourceCard.zone}/${sourceCard.exhaustState}/cores=${sourceCard.normalCoreCount}`
      : undefined;
  const allDetails = [details, sourceState]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(",");
  return allDetails.length > 0
    ? `action:${action.kind}{${allDetails}}`
    : `action:${action.kind}`;
}

function cappedDiagnostic(
  state: GameState,
  maxSteps: number,
  recentTransitions: readonly string[],
  lastApplyError?: string
): string {
  const pending = Object.entries(state)
    .flatMap(([key, value]) => {
      if (!key.startsWith("pending")) return [];
      if (Array.isArray(value))
        return value.length > 0 ? [`${key}=${value.length}`] : [];
      return value !== null && value !== undefined ? [`${key}=open`] : [];
    })
    .join(",");
  const pendingLeaves = state.pendingLeaveEntities
    .map(
      (pendingLeave) =>
        `${pendingLeave.instanceId}{cause=${pendingLeave.cause},chain=${pendingLeave.chainId ?? "null"}}`
    )
    .join(",");
  const pendingBurstChecks = state.pendingBurstChecks
    .map(
      (pendingBurstCheck) =>
        `${pendingBurstCheck.checkId}{actor=${pendingBurstCheck.actingPlayerId},related=${pendingBurstCheck.relatedPlayerId},selected=${pendingBurstCheck.activationSelected === true},resolved=${pendingBurstCheck.resolvedBurstCardInstanceIds.join(",")}}`
    )
    .join(",");
  const pendingStepOptional = state.pendingStepOptionalChoice;
  const pendingStepOptionalDiagnostic = pendingStepOptional
    ? `${pendingStepOptional.sourceInstanceId}{chain=${pendingStepOptional.continuation.chainId ?? "null"}}`
    : undefined;
  const players = state.players
    .map(
      (player) =>
        `${player.id}{deck=${player.deckCount},hand=${player.handCount},life=${player.lifeNormalCoreCount},reserve=${player.reserveNormalCoreCount},trash=${player.trashNormalCoreCount}}`
    )
    .join(",");
  return [
    `maxSteps=${maxSteps} reached without a natural game result`,
    `final={${stateCursor(state)}}`,
    `players=[${players}]`,
    pending.length > 0 ? `pending=[${pending}]` : undefined,
    pendingLeaves.length > 0 ? `pendingLeaves=[${pendingLeaves}]` : undefined,
    pendingBurstChecks.length > 0
      ? `pendingBurstChecks=[${pendingBurstChecks}]`
      : undefined,
    pendingStepOptionalDiagnostic
      ? `pendingStepOptional=${pendingStepOptionalDiagnostic}`
      : undefined,
    lastApplyError ? `lastApplyError=${lastApplyError}` : undefined,
    `recentLogs=[${state.log.slice(-32).join(" | ")}]`,
    `recentTransitions=[${recentTransitions.join(" | ")}]`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
}

/** プレイヤーごとの行動選択方策。state と合法手を受け取り 1 手返す。 */
export type Policy = (
  state: GameState,
  actor: string,
  actions: LegalAction[],
  engine: Engine,
  rng: Rng
) => LegalAction;

/** ランダム方策 (attack 優先バイアス付き)。 */
export const randomPolicy: Policy = (
  _state,
  _actor,
  actions,
  _engine,
  rng = Math.random
) => {
  const pool = [...actions];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  pool.sort((a, b) => (a.kind === "attack" ? -1 : b.kind === "attack" ? 1 : 0));
  return pool[0]!;
};

/**
 * 直前の brave 操作を同じ組で直ちに取り消す選択は、盤面も手番も進めない。
 * 実プレイヤーには合法な選択のまま残すが、終局探索用のランダム方策では 2 手往復を
 * 選ばず step を進める。ここでのみ抑止し、rules-core の brave 操作可否は変えない。
 */
function isImmediateBraveUndo(
  action: LegalAction,
  recentTransitions: readonly string[]
): boolean {
  const lastTransition = recentTransitions[recentTransitions.length - 1];
  if (!lastTransition) return false;

  if (action.kind === "brave_combine") {
    return (
      lastTransition.includes("--action:brave_separate{") &&
      lastTransition.includes(`braveInstanceId=${action.braveInstanceId}`) &&
      lastTransition.includes(`hostInstanceId=${action.targetInstanceId}`)
    );
  }
  if (action.kind === "brave_separate") {
    return (
      lastTransition.includes("--action:brave_combine{") &&
      lastTransition.includes(`braveInstanceId=${action.braveInstanceId}`) &&
      lastTransition.includes(`targetInstanceId=${action.hostInstanceId}`)
    );
  }
  return false;
}

/**
 * Self-play の任意フィールド効果は、対象の入替などで一度だけ既出の論理状態へ
 * 戻ることがある。合法性は残したまま、戻った状態ではその起点 actionId だけを
 * 方策候補から外す。解決中の pending action を外すと効果を閉じられなくなるため、
 * 起点の `use_field_card_effect` に限定して記録・除外する。
 */
type SelfplayProgressGuard = {
  visitedFingerprints: Set<string>;
  originActionIdsByFingerprint: Map<string, Set<string>>;
  blockedActionIdsByFingerprint: Map<string, Set<string>>;
};

export function hasSelfplayResolutionChain(state: GameState): boolean {
  return (
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    state.activeAttack?.flashWindowState?.pendingStackAction !== null ||
    state.pendingStepChoice !== null ||
    state.pendingEffectTargetSelection !== null ||
    state.pendingTargetedDisclosureContinuation !== null ||
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0
  );
}

function isSelfplayRevisitOrigin(action: LegalAction): boolean {
  return action.kind === "use_field_card_effect";
}

function rememberSelfplayProgressTransition(
  guard: SelfplayProgressGuard,
  stateBeforeTransition: GameState,
  nextState: GameState,
  action: LegalAction
): void {
  const beforeFingerprint = trainingProgressFingerprint(stateBeforeTransition);
  const nextFingerprint = trainingProgressFingerprint(nextState);
  const originActionIds = new Set<string>();

  if (isSelfplayRevisitOrigin(action)) {
    originActionIds.add(action.actionId);
  } else if (hasSelfplayResolutionChain(stateBeforeTransition)) {
    for (const actionId of guard.originActionIdsByFingerprint.get(
      beforeFingerprint
    ) ?? []) {
      originActionIds.add(actionId);
    }
  }

  if (
    originActionIds.size > 0 &&
    guard.visitedFingerprints.has(nextFingerprint)
  ) {
    const blocked =
      guard.blockedActionIdsByFingerprint.get(nextFingerprint) ?? new Set();
    for (const actionId of originActionIds) blocked.add(actionId);
    guard.blockedActionIdsByFingerprint.set(nextFingerprint, blocked);
  }

  guard.visitedFingerprints.add(nextFingerprint);
  if (hasSelfplayResolutionChain(nextState) && originActionIds.size > 0) {
    guard.originActionIdsByFingerprint.set(nextFingerprint, originActionIds);
  } else {
    guard.originActionIdsByFingerprint.delete(nextFingerprint);
  }
}

function selfplayActionChoices(
  state: GameState,
  actions: LegalAction[],
  recentTransitions: readonly string[],
  guard: SelfplayProgressGuard
): LegalAction[] {
  const blocked = guard.blockedActionIdsByFingerprint.get(
    trainingProgressFingerprint(state)
  );
  return actions.filter(
    (action) =>
      !isImmediateBraveUndo(action, recentTransitions) &&
      !blocked?.has(action.actionId)
  );
}

/** 通常のメイン行動と同じ重みでステップ終了も選ぶ。未解決入力は共通guardで拒否する。 */
export function chooseSelfplayMainStepAdvance(
  state: GameState,
  actor: string,
  actions: readonly LegalAction[],
  rng: Rng
): boolean {
  if (
    state.gameResult !== null ||
    state.step !== "main" ||
    (state.window !== "none" && state.window !== "step_end") ||
    state.activePlayerId !== actor ||
    getGameProgressBlockerReason(state) !== null
  )
    return false;
  return rng() < 1 / (actions.length + 1);
}

export interface PlayOptions {
  engine: Engine;
  decks?: [CardDefinition[], CardDefinition[]];
  maxSteps?: number;
  /** プレイヤー ID → 方策。未指定は randomPolicy。 */
  policies?: Record<string, Policy>;
  /** seed 固定再現用 PRNG (デッキ生成 + randomPolicy が使用)。未指定は Math.random。 */
  rng?: Rng;
}

/** 1 ゲームを方策に従って終局まで進める。 */
export function playGame(opts: PlayOptions): GameResult {
  // seed 固定再現: engine 内部 (initializeGame のデッキシャッフル / shuffle_zone 効果) も
  // Math.random を使うため、rng 指定時はゲーム中だけ Math.random を差し替えて完全決定化する。
  const originalRandom = Math.random;
  if (opts.rng) Math.random = opts.rng;
  try {
    return playGameInner(opts);
  } finally {
    Math.random = originalRandom;
  }
}

/** `playGame` と同じ駆動だが、長時間 seed 回帰用に定期的に event loop を解放する。 */
export async function playGameAsync(
  opts: PlayOptions,
  yieldEverySteps = 64
): Promise<GameResult> {
  const originalRandom = Math.random;
  if (opts.rng) Math.random = opts.rng;
  try {
    return await playGameInnerAsync(opts, yieldEverySteps);
  } finally {
    Math.random = originalRandom;
  }
}

function playGameInner(opts: PlayOptions): GameResult {
  const { engine } = opts;
  const rng = opts.rng ?? Math.random;
  const maxSteps = opts.maxSteps ?? 4000;
  const decks = opts.decks ?? [
    randomDeck(engine.cards, 40, rng),
    randomDeck(engine.cards, 40, rng),
  ];

  let state: GameState = initializeGame({ decks, skipPreGame: true });
  let lastError: string | undefined;
  const recentTransitions: string[] = [];
  const progressGuard: SelfplayProgressGuard = {
    visitedFingerprints: new Set([trainingProgressFingerprint(state)]),
    originActionIdsByFingerprint: new Map(),
    blockedActionIdsByFingerprint: new Map(),
  };

  for (let steps = 0; steps < maxSteps; steps++) {
    if (state.gameResult !== null)
      return { steps, outcome: "natural", winner: winnerOf(state) };

    const { actor, actions } = legalActionsFor(state, engine);
    const actionChoices = selfplayActionChoices(
      state,
      actions,
      recentTransitions,
      progressGuard
    );

    const policy = actor
      ? (opts.policies?.[actor] ?? randomPolicy)
      : randomPolicy;
    const choseAdvance =
      actor !== undefined &&
      policy === randomPolicy &&
      chooseSelfplayMainStepAdvance(state, actor, actionChoices, rng);
    let progressed = false;
    if (!choseAdvance && actor && actionChoices.length > 0) {
      // 方策の選んだ手から順に試行 (失敗時は別候補へフォールバック)。
      const ordered = [
        policy(state, actor, actionChoices, engine, rng),
        ...actionChoices,
      ];
      for (const action of ordered) {
        try {
          const stateBeforeAction = state;
          const before = stateCursor(stateBeforeAction);
          const nextState = applyChosenAction(
            stateBeforeAction,
            action,
            engine
          );
          rememberSelfplayProgressTransition(
            progressGuard,
            stateBeforeAction,
            nextState,
            action
          );
          state = nextState;
          recordTransition(
            recentTransitions,
            before,
            actionDiagnostic(action, state),
            state
          );
          progressed = true;
          break;
        } catch (e) {
          lastError = (e as Error).message;
        }
      }
    }

    if (!progressed) {
      try {
        const before = stateCursor(state);
        state = advance(state, engine);
        recordTransition(recentTransitions, before, "advance", state);
      } catch (e) {
        return {
          steps,
          outcome: "stuck",
          winner: null,
          lastError: `${(e as Error).message}; ${cappedDiagnostic(
            state,
            maxSteps,
            recentTransitions,
            lastError
          )}`,
        };
      }
    }
  }
  return {
    steps: maxSteps,
    outcome: "capped",
    winner: null,
    lastError: cappedDiagnostic(state, maxSteps, recentTransitions, lastError),
  };
}

async function playGameInnerAsync(
  opts: PlayOptions,
  yieldEverySteps: number
): Promise<GameResult> {
  const { engine } = opts;
  const rng = opts.rng ?? Math.random;
  const maxSteps = opts.maxSteps ?? 4000;
  const decks = opts.decks ?? [
    randomDeck(engine.cards, 40, rng),
    randomDeck(engine.cards, 40, rng),
  ];

  let state: GameState = initializeGame({ decks, skipPreGame: true });
  let lastError: string | undefined;
  const recentTransitions: string[] = [];
  const progressGuard: SelfplayProgressGuard = {
    visitedFingerprints: new Set([trainingProgressFingerprint(state)]),
    originActionIdsByFingerprint: new Map(),
    blockedActionIdsByFingerprint: new Map(),
  };

  for (let steps = 0; steps < maxSteps; steps++) {
    if (yieldEverySteps > 0 && steps > 0 && steps % yieldEverySteps === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (state.gameResult !== null)
      return { steps, outcome: "natural", winner: winnerOf(state) };

    const { actor, actions } = legalActionsFor(state, engine);
    const actionChoices = selfplayActionChoices(
      state,
      actions,
      recentTransitions,
      progressGuard
    );

    const policy = actor
      ? (opts.policies?.[actor] ?? randomPolicy)
      : randomPolicy;
    const choseAdvance =
      actor !== undefined &&
      policy === randomPolicy &&
      chooseSelfplayMainStepAdvance(state, actor, actionChoices, rng);
    let progressed = false;
    if (!choseAdvance && actor && actionChoices.length > 0) {
      const ordered = [
        policy(state, actor, actionChoices, engine, rng),
        ...actionChoices,
      ];
      for (const action of ordered) {
        try {
          const stateBeforeAction = state;
          const before = stateCursor(stateBeforeAction);
          const nextState = applyChosenAction(
            stateBeforeAction,
            action,
            engine
          );
          rememberSelfplayProgressTransition(
            progressGuard,
            stateBeforeAction,
            nextState,
            action
          );
          state = nextState;
          recordTransition(
            recentTransitions,
            before,
            actionDiagnostic(action, state),
            state
          );
          progressed = true;
          break;
        } catch (e) {
          lastError = (e as Error).message;
        }
      }
    }

    if (!progressed) {
      try {
        const before = stateCursor(state);
        state = advance(state, engine);
        recordTransition(recentTransitions, before, "advance", state);
      } catch (e) {
        return {
          steps,
          outcome: "stuck",
          winner: null,
          lastError: `${(e as Error).message}; ${cappedDiagnostic(
            state,
            maxSteps,
            recentTransitions,
            lastError
          )}`,
        };
      }
    }
  }
  return {
    steps: maxSteps,
    outcome: "capped",
    winner: null,
    lastError: cappedDiagnostic(state, maxSteps, recentTransitions, lastError),
  };
}

/** 後方互換: 旧 API (全プレイヤー randomPolicy)。 */
export function playRandomGame(opts: {
  getCardDefinitionById: Engine["getCardDefinitionById"];
  lookups: EngineLookups;
  cards: CardDefinition[];
  decks?: [CardDefinition[], CardDefinition[]];
  maxSteps?: number;
  biasAttack?: boolean;
  rng?: Rng;
}): GameResult {
  return playGame({
    engine: {
      cards: opts.cards,
      getCardDefinitionById: opts.getCardDefinitionById,
      lookups: opts.lookups,
    },
    decks: opts.decks,
    maxSteps: opts.maxSteps,
    rng: opts.rng,
  });
}
