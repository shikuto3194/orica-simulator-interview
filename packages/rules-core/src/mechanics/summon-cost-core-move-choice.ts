/**
 * 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを支払わずに
 * 召喚する』代替コスト支払いプリミティブ。
 *
 * 例: BSSL01-M02 effects[0,1]「フラッシュ【烈神憑・影】…自分のトラッシュのコア5個以上を
 *   フィールド/リザーブに置くことで、コストを支払わずに召喚する。」
 *
 * `mechanics/summon-cost-exclude-choice.ts`（トラッシュ○枚まで除外による線形割引）と
 * 同型の「コスト計算より前に任意/必須選択を解決する」パターンを踏襲するが、支払いの実体が
 * カードではなくコアのゾーン移動そのもの（トラッシュ→フィールド/リザーブ）である点が異なる。
 */
import {
  getPlayerTrashCoreCount,
  moveNormalCores,
  moveSoulCore,
} from "../core/core-system";
import type { AdditionalCostModifier } from "../core/cost-system";
import { evaluateApplicability } from "../effect/effect-interpreter";
import {
  collectFieldCardDestinationCandidates,
  partitionTrashMoveWithSoul,
} from "../effect/structured-core-move";
import type { ApplyLegalActionOptions } from "../legal/legal-actions-types";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  NormalCoreContainer,
  PendingSummonCostCoreMoveChoice,
  SoulCoreContainer,
} from "../model";

function collectCoreMovePaymentDestinations(
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined
): string[] {
  const soulStateIds = new Set(
    state.players.flatMap((player) => player.soulStateInstanceIds)
  );
  return collectFieldCardDestinationCandidates({
    state,
    to: { kind: "field", player: "self" },
    toPlayerId: actingPlayerId,
    getCardDefinitionById,
    coreMoveDestinationTargetIds: undefined,
  })
    .filter((card) => !soulStateIds.has(card.instanceId))
    .map((card) => card.instanceId);
}

export interface SummonCostCoreMoveChoiceOption {
  grantsFreeSummon?: boolean;
  /** 支払いを提供する継続効果の effects[] インデックス。 */
  effectIndex: number;
  /** 必須移動枚数下限。 */
  minCount: number;
  /** 選択時点で移動可能なトラッシュのコア総数。 */
  availableCoreCount: number;
  /** 相殺する追加コスト量（正の整数）。 */
  costOffset: number;
  /** 移動先「フィールド」候補の自分のフィールドカード instanceId。 */
  fieldDestinationCandidateInstanceIds: string[];
}

/**
 * sourceCard/sourceDefinition の継続効果から「このカードを召喚するとき、トラッシュの
 * コアN個以上をフィールド/リザーブに置くことでコストを支払わずに召喚する」型の
 * `cost_modify` + `useCostPayment.kind:"core_move"` を探す。
 */
export function getSummonCostCoreMoveChoiceOption(
  state: GameState,
  actingPlayerId: string,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): SummonCostCoreMoveChoiceOption | undefined {
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
      if (!payment || payment.kind !== "core_move") continue;
      const modifier = action.modifier;
      if (
        modifier !== "free" &&
        (typeof modifier !== "object" ||
          !("additionalCostValue" in modifier) ||
          typeof modifier.additionalCostValue !== "number" ||
          modifier.additionalCostValue >= 0)
      ) {
        continue;
      }
      const costOffset =
        modifier === "free" ? 0 : -modifier.additionalCostValue;

      const player = state.players.find((p) => p.id === actingPlayerId);
      const availableCoreCount = player ? getPlayerTrashCoreCount(player) : 0;

      const fieldDestinationCandidateInstanceIds =
        collectCoreMovePaymentDestinations(
          state,
          actingPlayerId,
          getCardDefinitionById
        );

      return {
        ...(modifier === "free" ? { grantsFreeSummon: true } : {}),
        effectIndex,
        minCount: payment.minCount,
        availableCoreCount,
        costOffset,
        fieldDestinationCandidateInstanceIds,
      };
    }
  }

  return undefined;
}

export type SummonCostCoreMoveDestination =
  | { kind: "reserve" }
  | { kind: "field_card"; instanceId: string };

export interface SummonCostCoreMoveChoiceResolution {
  state: GameState;
  /** 支払い確定分の additionalCostModifiers。summon 実行時に渡す。 */
  additionalCostModifiers: AdditionalCostModifier[];
}

/**
 * pendingSummonCostCoreMoveChoice を解決する: 選択された枚数分のコアをトラッシュから
 * 選択したフィールドカード/リザーブへ配分する。無償召喚ならコスト変更による割引を作らず、
 * 旧形式の固定割引だけ additionalCostModifiers を返す。呼び出し側 (legal-actions-apply.ts /
 * pending-action-handlers.ts) はこの直後に同じ sourceInstanceId の summon を
 * additionalCostModifiers 付きで実行する（コア移動は「召喚するとき」に不可分な選択のため、
 * 移動だけ確定して召喚を取りやめる余地は無い＝2 アクションに分割しない）。
 */
export function resolveSummonCostCoreMoveChoiceSelection(
  state: GameState,
  pending: PendingSummonCostCoreMoveChoice,
  selectedCount: number,
  destination: SummonCostCoreMoveDestination,
  allocations?: ApplyLegalActionOptions["summonCostCoreMoveAllocations"],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): SummonCostCoreMoveChoiceResolution {
  if (!Number.isInteger(selectedCount)) {
    throw new Error(
      `Summon cost core move choice: selected count must be an integer: ${selectedCount}`
    );
  }
  if (selectedCount < pending.minCount) {
    throw new Error(
      `Summon cost core move choice: selected ${selectedCount} is below required minCount ${pending.minCount}`
    );
  }
  if (selectedCount > pending.availableCoreCount) {
    throw new Error(
      `Summon cost core move choice: selected ${selectedCount} exceeds available ${pending.availableCoreCount}`
    );
  }
  const playerId = pending.actingPlayerId;
  const player = state.players.find((p) => p.id === playerId);
  const { normalTaken, soulTaken } = partitionTrashMoveWithSoul(
    player,
    selectedCount
  );

  const distribution = allocations ?? [
    {
      destination:
        destination.kind === "reserve"
          ? ("reserve" as const)
          : { fieldCardInstanceId: destination.instanceId },
      normalCount: normalTaken,
      soulCount: soulTaken as 0 | 1,
    },
  ];
  const liveCandidates = collectCoreMovePaymentDestinations(
    state,
    playerId,
    getCardDefinitionById
  );
  let normalTotal = 0,
    soulTotal = 0;
  for (const allocation of distribution) {
    if (
      !Number.isInteger(allocation.normalCount) ||
      allocation.normalCount < 0 ||
      !Number.isInteger(allocation.soulCount ?? 0) ||
      (allocation.soulCount ?? 0) < 0 ||
      (allocation.soulCount ?? 0) > 1
    )
      throw new Error("Summon cost core move choice: invalid core allocation");
    normalTotal += allocation.normalCount;
    soulTotal += allocation.soulCount ?? 0;
    const target = allocation.destination;
    if (
      target !== "reserve" &&
      (!pending.fieldDestinationCandidateInstanceIds.includes(
        target.fieldCardInstanceId
      ) ||
        !liveCandidates.includes(target.fieldCardInstanceId))
    )
      throw new Error(
        `Summon cost core move choice: destination card is not a candidate: ${target.fieldCardInstanceId}`
      );
  }
  if (
    normalTotal + soulTotal !== selectedCount ||
    normalTotal > (player?.trashNormalCoreCount ?? 0) ||
    soulTotal > (player?.soulCoreLocation?.kind === "trash" ? 1 : 0)
  )
    throw new Error(
      "Summon cost core move choice: allocation does not match available cores or selected count"
    );
  let currentState = state;
  for (const allocation of distribution) {
    const destination = allocation.destination;
    const to: NormalCoreContainer =
      destination === "reserve"
        ? { kind: "reserve", playerId }
        : { kind: "card", instanceId: destination.fieldCardInstanceId };
    if (allocation.normalCount > 0)
      currentState = moveNormalCores(
        currentState,
        { kind: "trash", playerId },
        to,
        allocation.normalCount
      );
    if ((allocation.soulCount ?? 0) > 0)
      currentState = moveSoulCore(
        currentState,
        playerId,
        { kind: "trash", playerId },
        to as SoulCoreContainer
      );
  }

  if (selectedCount > 0) {
    currentState = {
      ...currentState,
      log: [
        ...currentState.log,
        `summon-cost-core-move-choice:${pending.pendingId}:${selectedCount}:${destination.kind}`,
      ],
    };
  }

  const additionalCostModifiers: AdditionalCostModifier[] =
    pending.grantsFreeSummon
      ? []
      : [
          {
            amount: -pending.costOffset,
            reason: `summon_cost_core_move:${pending.sourceDefinitionId}`,
          },
        ];

  return { state: currentState, additionalCostModifiers };
}
