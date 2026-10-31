import type { CardDefinition, GameState } from "../model";
import type { ResolvePendingBurstCheckLegalAction } from "./legal-actions-types";
import {
  applyBurstActivationImmunity,
  type BurstActionRegistrationLookup,
} from "../effect/trigger-system";
import { getBurstEffectSuppressors } from "./legal-actions-shared";
import { getBurstIgnoresOpponentCannotActivateBurst } from "./stack-target-resolution";

/**
 * 発動前の確認表示専用。現在の抑止と発動中耐性を読み、実際の状態は変更しない。
 * この結果を pending/check/stack に保存してはならない。解決時には改めて判定する。
 */
export function previewBurstEffectSuppression(options: {
  state: GameState;
  action: ResolvePendingBurstCheckLegalAction;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredBurstActions: BurstActionRegistrationLookup;
}) {
  const { state, action, getCardDefinitionById, getRegisteredBurstActions } =
    options;
  if (!action.sourceInstanceId || !action.sourceDefinitionId) return null;
  const pending = state.pendingBurstChecks.find(
    (p) => p.checkId === action.checkId
  );
  if (!pending || pending.activationSelected) return null;
  const definition = getCardDefinitionById(action.sourceDefinitionId);
  if (!definition) return null;
  const registration = getRegisteredBurstActions(definition.cardNo)?.[
    action.registrationIndex ?? 0
  ];
  // 発動中だけ有効な耐性も、解決時と同じ関数で評価する（元stateへは書き戻さない）。
  const preview = applyBurstActivationImmunity(
    {
      ...state,
      revealedBurstStates: [
        {
          playerId: action.actingPlayerId,
          cardInstanceId: action.sourceInstanceId,
          checkId: action.checkId,
        },
      ],
    },
    action.checkId,
    getCardDefinitionById
  ).state;
  const sources = getBurstEffectSuppressors(
    preview,
    action.sourceInstanceId,
    action.actingPlayerId,
    {
      getCardDefinitionById,
      ignoresOpponentCannotActivateBurst:
        getBurstIgnoresOpponentCannotActivateBurst(
          definition,
          registration?.effectIndex,
          registration?.effectIndex === undefined
        ),
    }
  );
  if (sources.length === 0 && !pending.effectSuppressed) return null;
  return { sources, eventSuppressed: pending.effectSuppressed === true };
}
