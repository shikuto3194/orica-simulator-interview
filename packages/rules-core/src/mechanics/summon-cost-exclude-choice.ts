/**
 * 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』の可変枚数コスト軽減プリミティブ。
 *
 * 例: BSTH02.7-M01 Lv1「このカードを召喚するとき、自分のトラッシュにあるカード2枚までを
 *   除外し、除外したカード1枚につきコストを-1する。」
 *
 * pendingDrawStepCostChoice (model A, 10_rules/02) と同型の「コストより前に任意選択を解決」
 * パターンを召喚コスト計算の直前に適用する。DSL 表現は `getMagicZoneCostDiscountOptions`
 * (magic use 専用・固定枚数) と同じ `cost_modify` + `useCostPayment` を再利用し、
 * `useCostPayment.kind: "exclude"` の可変 maxCount 版として拡張する (SSOT)。
 */
import {
  matchesCardFilter,
  getApplicableAdditionalCostDelta,
} from "../card/card-filter";
import { moveCardZone } from "../core/core-system";
import type { AdditionalCostModifier } from "../core/cost-system";
import { evaluateApplicability } from "../effect/effect-interpreter";
import { executeRemoveFromGame } from "../effect/structured-card-replacement";
import { getEffectiveColors } from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingSummonCostExcludeChoice,
} from "../model";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import { queuePreFlushGrantedEffectsAndFlushPendingLeaves } from "../zone/pending-leave-flush";
import { getCardsByZone } from "../zone/zone-partition";

export interface SummonCostExcludeChoiceOption {
  /** 割引を提供する継続効果の effects[] インデックス。 */
  effectIndex: number;
  /** 選択可能な最大除外枚数。 */
  maxCount: number;
  /** 除外1枚につきの追加コスト軽減量（正の整数）。fullReduction:true のとき 0 (未使用)。 */
  discountPerCard: number;
  /** 除外候補（フィルタ適用済みの自分の対象ゾーン instanceId）。 */
  candidateCardInstanceIds: string[];
  /** 除外元ゾーン。省略時 "trash" 相当。 */
  sourceZone: "trash" | "field" | "hand_or_set_aside";
  /** 必須除外枚数。0/省略時は任意（従来挙動）。 */
  minCount: number;
  /**
   * true のとき、除外は線形割引ではなく `costModifier:"full_reduction"` 相当に合流する
   * (ENGINE-summon-self-exclude-alt-cost-full-reduction, BSTH11-M01 effects[0])。
   */
  fullReduction: boolean;
  fullCostPaid?: boolean;
}

/**
 * sourceCard/sourceDefinition の継続効果から「このカードを召喚するとき、トラッシュ○枚まで
 * 除外してコストを軽減する」型の cost_modify を探す。候補が 0 枚（対象フィルタに一致する
 * トラッシュカードが無い）の場合は選択の余地が無いため undefined を返す
 * （通常の召喚コストで進める＝pending を開かない）。
 */
export function getSummonCostExcludeChoiceOption(
  state: GameState,
  actingPlayerId: string,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  normalActionPermissionEffectIndex?: number,
  effectSummonEffectIndex?: number
): SummonCostExcludeChoiceOption | undefined {
  const effects = sourceDefinition.effects ?? [];

  for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
    const effect = effects[effectIndex]!;
    if (effect.timing.kind !== "continuous") continue;
    if (
      effect.condition &&
      effect.condition.length > 0 &&
      !evaluateCondition(
        state,
        effect.condition,
        sourceCard.instanceId,
        actingPlayerId,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    if (
      effect.applicability &&
      !evaluateApplicability(
        state,
        effect.applicability,
        sourceCard.instanceId,
        getCardDefinitionById
      )
    ) {
      continue;
    }

    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind !== "cost_modify") continue;
      if (!action.target || action.target.kind !== "self") continue;
      const payment = action.useCostPayment;
      if (!payment || payment.kind !== "exclude") continue;
      if (
        payment.normalActionPermissionEffectIndex !== undefined &&
        payment.normalActionPermissionEffectIndex !==
          normalActionPermissionEffectIndex
      ) {
        continue;
      }
      const fullReduction = payment.fullReduction === true;
      if (
        payment.effectSummonEffectIndex !== undefined &&
        payment.effectSummonEffectIndex !== effectSummonEffectIndex
      )
        continue;
      // fullReduction 時は modifier.additionalCostValue (線形割引) を使わないため
      // 負数チェックを課さない。線形割引時は従来どおり負数の additionalCostValue を要求する。
      let discountPerCard = 0;
      if (!fullReduction && !payment.fullCostPaid) {
        const modifier = action.modifier;
        if (
          typeof modifier !== "object" ||
          !("additionalCostValue" in modifier) ||
          // useCostPayment (可変枚数コスト軽減) は DynamicCount 未対応。数値のみ扱う
          // (ENGINE-cost-modify-additional-cost-value-dynamic-amount のスコープ外)。
          typeof modifier.additionalCostValue !== "number" ||
          modifier.additionalCostValue >= 0
        ) {
          continue;
        }
        discountPerCard = -modifier.additionalCostValue;
      }
      const minCount = payment.minCount ?? 0;

      const candidateZones: readonly (
        | "hand"
        | "set_aside"
        | "trash"
        | "field"
      )[] =
        payment.sourceZone === "hand_or_set_aside"
          ? ["hand", "set_aside"]
          : [payment.sourceZone];
      const candidateCardInstanceIds = candidateZones
        .flatMap((zone) => getCardsByZone(state, zone))
        .filter((card) => card.ownerPlayerId === actingPlayerId)
        // sourceZone:"hand_or_set_aside" (ENGINE-summon-self-exclude-alt-cost-full-reduction)
        // では召喚されるカード自身が候補ゾーンに存在し得る (手札/手元から自分自身を召喚)。
        // 自己参照の除外選択は意味を成さないため常に除外する。
        .filter((card) => card.instanceId !== sourceCard.instanceId)
        .filter((card) => {
          if (!payment.filter) return true;
          const def = getCardDefinitionById(card.definitionId);
          if (!def) return false;
          return matchesCardFilter(card, def, payment.filter, {
            effectiveColors: getEffectiveColors(state, card, def),
          });
        })
        .map((card) => card.instanceId);

      // 任意割引 (minCount:0) は候補0件なら「割引の余地なし」として通常コストへ
      // フォールバックさせる (従来挙動)。必須支払い (minCount>0) は候補0件でも
      // option を返し、呼び出し側 (getAvailableHandSummonPermissionLegalActions) が
      // 「除外できないので許可 effect 自体を提示しない」判断に使う
      // (engine-alt-cost-summon-multizone: 通常コストへのフォールバックを許さない)。
      if (candidateCardInstanceIds.length === 0 && minCount === 0) continue;

      return {
        effectIndex,
        maxCount: payment.maxCount,
        discountPerCard,
        candidateCardInstanceIds,
        sourceZone: payment.sourceZone,
        minCount,
        fullReduction,
        ...(payment.fullCostPaid ? { fullCostPaid: true } : {}),
      };
    }
  }

  return undefined;
}

export interface SummonCostExcludeChoiceResolution {
  state: GameState;
  /** 選択枚数分の割引 (0 枚選択時は空配列)。summon 実行時の additionalCostModifiers に渡す。 */
  additionalCostModifiers: AdditionalCostModifier[];
  /**
   * true のとき、呼び出し側は additionalCostModifiers ではなく
   * `calculateFullReductionSummonCost` を fixedPaymentCost として summon を実行する
   * (ENGINE-summon-self-exclude-alt-cost-full-reduction)。
   */
  grantsFullReduction: boolean;
  grantsFullCostPaid: boolean;
}

/**
 * pendingSummonCostExcludeChoice を解決する: 選択されたカードをトラッシュから
 * removed_from_game へ移動し、選択枚数 × discountPerCard の additionalCostModifiers を返す。
 * 呼び出し側 (legal-actions-apply.ts) はこの直後に同じ sourceInstanceId の summon を
 * additionalCostModifiers 付きで実行する（除外は「召喚するとき」に不可分な選択のため、
 * 除外だけ確定して召喚を取りやめる余地は無い＝2 アクションに分割しない）。
 */
export function resolveSummonCostExcludeChoiceSelection(
  state: GameState,
  pending: PendingSummonCostExcludeChoice,
  selectedCardInstanceIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SummonCostExcludeChoiceResolution {
  const uniqueSelected = Array.from(new Set(selectedCardInstanceIds));
  if (uniqueSelected.length !== selectedCardInstanceIds.length) {
    throw new Error("Summon cost exclude choice: duplicate card selection");
  }
  if (uniqueSelected.length > pending.maxCount) {
    throw new Error(
      `Summon cost exclude choice: selected ${uniqueSelected.length} exceeds maxCount ${pending.maxCount}`
    );
  }
  const minCount = pending.minCount ?? 0;
  if (uniqueSelected.length < minCount) {
    throw new Error(
      `Summon cost exclude choice: selected ${uniqueSelected.length} is below required minCount ${minCount}`
    );
  }
  const candidateSet = new Set(pending.candidateCardInstanceIds);
  const invalidId = uniqueSelected.find((id) => !candidateSet.has(id));
  if (invalidId !== undefined) {
    throw new Error(
      `Summon cost exclude choice: selected card is not a candidate: ${invalidId}`
    );
  }

  let currentState = state;
  if (pending.sourceZone === "field") {
    // フィールドのカード (合体中の鍵ブレイヴ等) の除外はフィールド離脱 SSOT
    // (executeRemoveFromGame → queuePendingLeave → flushPendingLeaves) を経由する。
    // 素の moveCardZone/直接 state 書き換えだと cannot_leave_field /
    // cannot_be_removed_from_game 耐性チェック (resolveCardLeaveGate) と、離脱誘発
    // (『このブレイヴが場を離れたとき』等) の発火機構をどちらもスキップしてしまう
    // (engine-alt-cost-summon-multizone, adversarial verifier 2026-07-08 round1 Lens3
    // で指摘・是正)。除外は「召喚するとき」に不可分な即時支払いのため、queue した
    // pendingLeave をこの関数内で即 flush し、呼び出し元の
    // MID_EFFECT_CONTINUATION_RESUME_KINDS 判定タイミングに依存しない。
    for (const id of uniqueSelected) {
      currentState = executeRemoveFromGame(
        currentState,
        pending.actingPlayerId,
        {
          kind: "remove_from_game",
          target: { player: "self", filter: {}, count: 1 },
        },
        getCardDefinitionById,
        pending.sourceInstanceId,
        [id]
      );
    }
    currentState = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
      state: currentState,
      getCardDefinitionById,
    });
  } else {
    for (const id of uniqueSelected) {
      currentState = moveCardZone(currentState, id, "removed_from_game");
    }
  }

  if (uniqueSelected.length > 0) {
    currentState = {
      ...currentState,
      log: [
        ...currentState.log,
        `summon-cost-exclude-choice:${pending.pendingId}:${uniqueSelected.length}`,
      ],
    };
  }

  const additionalCostModifiers: AdditionalCostModifier[] =
    uniqueSelected.length > 0
      ? [
          {
            amount: -(uniqueSelected.length * pending.discountPerCard),
            reason: `summon_cost_exclude:${pending.sourceDefinitionId}`,
          },
        ]
      : [];

  const grantsFullReduction =
    pending.fullReduction === true && uniqueSelected.length > 0;

  return {
    state: currentState,
    additionalCostModifiers,
    grantsFullReduction,
    grantsFullCostPaid:
      pending.fullCostPaid === true && uniqueSelected.length > 0,
  };
}

/** 全額支払い済みの召喚でも残る「余分に支払う」分。通常のコスト変更は含めない。 */
export function calculateFullyPaidSummonRemainingCost(
  state: GameState,
  actingPlayerId: string,
  definition: CardDefinition,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  summonCause?: "effect" | "burst"
): number {
  return Math.max(
    0,
    getApplicableAdditionalCostDelta(state, actingPlayerId, definition, {
      card,
      cardZone: card.zone,
      getCardDefinitionById,
      onlyAdditionalPayment: true,
      ...(summonCause ? { summonCause } : {}),
    })
  );
}
