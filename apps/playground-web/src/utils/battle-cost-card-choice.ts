import {
  getBattleCardCostPaymentPlan,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import type { CardChoice } from "../hooks/usePendingCardSelection";

export type BattleCostAction = Extract<
  LegalAction,
  { kind: "attack" | "join_active_attack" | "block" }
>;

/** 支払い順ごとに合法な action を絞り、カードの役割・組合せを失わずに選ぶ。 */
export function buildBattleCostCardChoice(
  state: GameState,
  actions: readonly BattleCostAction[],
  getDefinition: (id: string) => CardDefinition | undefined
): CardChoice | null {
  const first = actions[0];
  if (!first) return null;
  const orderedChoices = actions.map((action) => {
    const source = state.cardInstances.find(
      (card) => card.instanceId === action.sourceInstanceId
    );
    const ids =
      action.battleDestroyCostSourceInstanceIds ??
      (action.battleDestroyCostSourceInstanceId
        ? [action.battleDestroyCostSourceInstanceId]
        : []);
    const plan = source
      ? getBattleCardCostPaymentPlan(
          state,
          source,
          getDefinition,
          [
            action.kind === "block"
              ? "battle_destroy_cost_gate_block"
              : "battle_destroy_cost_gate_attack",
            "battle_destroy_cost_gate_both",
          ],
          ids
        )
      : null;
    const steps = plan
      ? plan.map((item) => ({
          id: item.instanceId,
          label:
            item.destination === "destroy"
              ? "破壊するカードを選択"
              : "デッキ下へ戻すカードを選択",
        }))
      : ids.map((id) => ({ id, label: "破壊するカードを選択" }));
    if (
      "attackExhaustCostSourceInstanceId" in action ||
      "attackExhaustCostSourceInstanceIds" in action
    ) {
      const exhaustIds =
        action.attackExhaustCostSourceInstanceIds ??
        (action.attackExhaustCostSourceInstanceId
          ? [action.attackExhaustCostSourceInstanceId]
          : []);
      steps.push(
        ...exhaustIds.map((id) => ({ id, label: "重疲労させるカードを選択" }))
      );
    }
    return { action, steps };
  });
  return {
    key: JSON.stringify(actions),
    action: first,
    orderedChoices,
    candidateIds: [
      ...new Set(
        orderedChoices.flatMap((option) => option.steps.map((step) => step.id))
      ),
    ],
    min: Math.min(...orderedChoices.map((option) => option.steps.length)),
    max: Math.max(...orderedChoices.map((option) => option.steps.length)),
    title: "アタック・ブロックの支払いカードを選択",
    description: "案内された支払い順に候補カードを選んでください。",
    confirmLabel: () => "支払って宣言",
    payload: () => ({}),
    canCancel: true,
  };
}
