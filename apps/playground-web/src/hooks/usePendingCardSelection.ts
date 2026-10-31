import { useMemo, useState } from "react";
import { getOwnHandCards } from "@orica/rules-core";
import type { CardDefinition, GameState, LegalAction } from "@orica/rules-core";
import {
  buildBattleCostCardChoice,
  type BattleCostAction,
} from "../utils/battle-cost-card-choice";

type ChoiceAction = Extract<
  LegalAction,
  {
    kind:
      | "resolve_pending_draw_step_cost_choice"
      | "resolve_pending_summon_cost_exclude_choice"
      | "resolve_pending_grouped_summon_cost_override_choice"
      | "resolve_pending_split_summon_choice"
      | "swap_hand_trash"
      | "swap_field_hand"
      | "resolve_tensho_summon"
      | "resolve_advent_source_replacement";
  }
>;

export interface CardChoice {
  key: string;
  action: ChoiceAction | BattleCostAction;
  orderedChoices?: {
    action: ChoiceAction | BattleCostAction;
    steps: { id: string; label: string }[];
  }[];
  canCancel?: boolean;
  candidateIds: readonly string[];
  min: number;
  max: number;
  tokenMax?: number;
  title: string;
  description: string;
  confirmLabel: (count: number) => string;
  payload: (ids: string[], tokenCount: number) => Record<string, unknown>;
  declinePayload?: Record<string, unknown>;
  declineAction?: LegalAction;
  declineLabel?: string;
}

/** エンジンが提示した候補をそのまま、手札展開とゾーン候補へ渡す。 */
export function buildPendingCardChoice(
  state: GameState,
  actions: readonly LegalAction[],
  getDefinition: (id: string) => CardDefinition | undefined
): CardChoice | null {
  for (const action of actions) {
    switch (action.kind) {
      case "swap_hand_trash":
      case "swap_field_hand":
      case "resolve_tensho_summon":
      case "resolve_advent_source_replacement": {
        const variants = actions.filter(
          (candidate): candidate is ChoiceAction =>
            candidate.kind === action.kind &&
            ("pendingId" in action
              ? "pendingId" in candidate &&
                candidate.pendingId === action.pendingId
              : "cardInstanceId" in candidate &&
                candidate.cardInstanceId === action.cardInstanceId)
        );
        const orderedChoices = variants.flatMap<
          NonNullable<CardChoice["orderedChoices"]>[number]
        >((variant) => {
          switch (variant.kind) {
            case "swap_hand_trash":
              return [
                {
                  action: variant,
                  steps: [
                    {
                      id: variant.outgoingCardInstanceId,
                      label: "トラッシュへ送るカードを選択",
                    },
                    {
                      id: variant.incomingCardInstanceId,
                      label: "トラッシュから戻すカードを選択",
                    },
                  ],
                },
              ];
            case "swap_field_hand":
              return [
                {
                  action: variant,
                  steps: [
                    {
                      id: variant.incomingCardInstanceId,
                      label: "フィールドへ入れる手札を選択",
                    },
                  ],
                },
              ];
            case "resolve_tensho_summon":
              return [
                {
                  action: variant,
                  steps: [
                    {
                      id: variant.chosenTargetInstanceId,
                      label: "コアを移す対象スピリットを選択",
                    },
                  ],
                },
              ];
            case "resolve_advent_source_replacement":
              return variant.hostInstanceId
                ? [
                    {
                      action: variant,
                      steps: [
                        {
                          id: variant.hostInstanceId,
                          label: "煌臨元を追加するカードを選択",
                        },
                      ],
                    },
                  ]
                : [];
            default:
              return [];
          }
        });
        if (orderedChoices.length === 0) break;
        const declineAction = variants.find(
          (variant) =>
            variant.kind === "resolve_advent_source_replacement" &&
            variant.choice === "trash"
        );
        const handZones = state.pendingHandTrashSwapChoice?.outgoingZones ?? [
          "hand",
          "set_aside",
        ];
        return {
          key: JSON.stringify(variants),
          action,
          orderedChoices,
          candidateIds: [
            ...new Set(
              orderedChoices.flatMap((option) =>
                option.steps.map((step) => step.id)
              )
            ),
          ],
          min: orderedChoices[0]!.steps.length,
          max: orderedChoices[0]!.steps.length,
          title:
            action.kind === "swap_hand_trash"
              ? `${handZones.includes("set_aside") ? "手札/手元" : "手札"}とトラッシュの入れ替え`
              : action.kind === "swap_field_hand"
                ? "フィールドと手札の入れ替え"
                : action.kind === "resolve_tensho_summon"
                  ? "転召"
                  : "煌臨元への追加",
          description: "案内に従って候補カードを選択してください。",
          confirmLabel: () => "決定",
          payload: () => ({}),
          ...(declineAction
            ? { declineAction, declineLabel: "トラッシュに置く" }
            : {}),
        };
      }
      case "resolve_pending_draw_step_cost_choice": {
        const pending = state.pendingDrawStepCostChoice;
        const entry = pending?.entries[0];
        if (!pending || !entry || pending.pendingId !== action.pendingId) break;
        return {
          key: JSON.stringify([pending.pendingId, entry]),
          action,
          candidateIds: entry.candidateCardInstanceIds,
          min: 1,
          max: 1,
          title: `ドロー枚数 +${entry.bonus}`,
          description: `${getDefinition(entry.sourceDefinitionId)?.name ?? entry.sourceDefinitionId}: 手札1枚を破棄してドロー枚数を+${entry.bonus}します。`,
          confirmLabel: () => "破棄して支払う",
          payload: (ids) => ({
            drawStepCostChoice: "pay",
            drawStepCostDiscardCardInstanceId: ids[0],
          }),
          declinePayload: { drawStepCostChoice: "decline" },
        };
      }
      case "resolve_pending_summon_cost_exclude_choice": {
        const pending = state.pendingSummonCostExcludeChoice;
        if (!pending || pending.pendingId !== action.pendingId) break;
        return {
          key: JSON.stringify(pending),
          action,
          candidateIds: pending.candidateCardInstanceIds,
          min: pending.minCount ?? 0,
          max: pending.maxCount,
          title: pending.fullCostPaid
            ? "召喚コストの代替支払い"
            : "召喚コスト軽減",
          description: pending.fullCostPaid
            ? `候補から${pending.minCount ?? 1}枚を除外すると召喚コスト全額を支払ったものとして扱います。余分なコストは別途支払います。`
            : pending.fullReduction
              ? `${pending.maxCount}枚まで除外すると軽減シンボルすべてを満たします（0枚で通常コスト）。`
              : `${pending.maxCount}枚まで除外できます。1枚につきコスト-${pending.discountPerCard}（0枚で通常コスト）。`,
          confirmLabel: (count) =>
            count === 0 ? "除外せず召喚" : "除外して召喚",
          // この選択だけは BattleScreen の既存コスト支払い継続へ渡す。
          payload: () => ({}),
        };
      }
      case "resolve_pending_grouped_summon_cost_override_choice": {
        const pending = state.pendingGroupedSummonCostOverrideChoice;
        if (!pending || pending.pendingId !== action.pendingId) break;
        return {
          key: JSON.stringify(pending),
          action,
          candidateIds: pending.candidateCardInstanceIds,
          min: 0,
          max: pending.maxCount,
          title: "複数召喚のコスト軽減",
          description: `${pending.maxCount}枚まで除外できます。${pending.groupSize}枚につき召喚対象1体のコストが${pending.overrideCost}になります（0枚で通常コスト）。`,
          confirmLabel: (count) =>
            count === 0 ? "除外せず召喚" : "除外して召喚",
          payload: (ids) => ({
            groupedSummonCostOverrideSelectedCardInstanceIds: ids,
          }),
        };
      }
      case "resolve_pending_split_summon_choice": {
        const pending = state.pendingSplitSummonChoice;
        if (!pending || pending.pendingId !== action.pendingId) break;
        return {
          key: JSON.stringify(pending),
          action,
          candidateIds: pending.zoneCandidateInstanceIds,
          min: 0,
          max: pending.totalCount,
          tokenMax: pending.maxTokenCount,
          title: "トークンを出す / 通常召喚の分配選択",
          description: `合計${pending.totalCount}体まで、トークンと候補カードの通常召喚を組み合わせて選べます。`,
          confirmLabel: () => "決定",
          payload: (ids, tokenCount) => ({
            splitSummonTokenCount: tokenCount,
            splitSummonZoneCardInstanceIds: ids,
          }),
        };
      }
    }
  }
  return null;
}

export function usePendingCardSelection(
  state: GameState,
  actions: readonly LegalAction[],
  getDefinition: (id: string) => CardDefinition | undefined,
  viewingPlayer: string,
  battleCostActions?: readonly BattleCostAction[]
) {
  const choice = useMemo(
    () =>
      buildPendingCardChoice(state, actions, getDefinition) ??
      buildBattleCostCardChoice(state, battleCostActions ?? [], getDefinition),
    [state, actions, getDefinition, battleCostActions]
  );
  const [selection, setSelection] = useState({
    key: "",
    ids: [] as string[],
    tokenCount: 0,
  });
  // 同一 pending 内の次の支払い先でも、その描画から選択を引き継がない。
  const current =
    selection.key === choice?.key
      ? selection
      : { key: choice?.key ?? "", ids: [], tokenCount: 0 };
  const remainingChoices = choice?.orderedChoices?.filter((option) =>
    current.ids.every((id, index) => option.steps[index]?.id === id)
  );
  const resolvedAction = remainingChoices?.find(
    (option) => option.steps.length === current.ids.length
  )?.action;
  const candidateIds = new Set(
    remainingChoices
      ? remainingChoices.flatMap(
          (option) => option.steps[current.ids.length]?.id ?? []
        )
      : (choice?.candidateIds ?? [])
  );
  const ownHandIds = new Set(
    getOwnHandCards(state, viewingPlayer, getDefinition).map(
      (card) => card.instanceId
    )
  );
  const handIds = new Set([...candidateIds].filter((id) => ownHandIds.has(id)));
  const zoneIds = [...new Set([...candidateIds, ...current.ids])].filter(
    (id) => !ownHandIds.has(id)
  );
  const total = current.ids.length + current.tokenCount;
  return {
    choice,
    resolvedAction: remainingChoices ? resolvedAction : choice?.action,
    nextLabel: remainingChoices
      ? [
          ...new Set(
            remainingChoices.flatMap(
              (option) => option.steps[current.ids.length]?.label ?? []
            )
          ),
        ].join(" / ")
      : undefined,
    candidateIds,
    handIds,
    zoneIds,
    selectedIds: current.ids,
    tokenCount: current.tokenCount,
    total,
    canConfirm:
      !!choice &&
      total >= choice.min &&
      total <= choice.max &&
      (remainingChoices
        ? !!resolvedAction
        : current.ids.every((id) => candidateIds.has(id))),
    toggle: (id: string) => {
      if (!choice || !candidateIds.has(id)) return;
      setSelection((previous) => {
        const value =
          previous.key === choice.key
            ? previous
            : { key: choice.key, ids: [], tokenCount: 0 };
        if (!choice.orderedChoices && value.ids.includes(id))
          return {
            ...value,
            ids: value.ids.filter((selected) => selected !== id),
          };
        if (value.ids.length + value.tokenCount >= choice.max) return value;
        return { ...value, ids: [...value.ids, id] };
      });
    },
    changeTokenCount: (delta: number) => {
      if (!choice || choice.tokenMax === undefined) return;
      setSelection({
        ...current,
        tokenCount: Math.max(
          0,
          Math.min(
            current.tokenCount + delta,
            choice.tokenMax,
            choice.max - current.ids.length
          )
        ),
      });
    },
    reset: () =>
      setSelection({ key: choice?.key ?? "", ids: [], tokenCount: 0 }),
  };
}
