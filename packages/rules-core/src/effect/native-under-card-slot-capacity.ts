// engine-tx01b-under-card-slot-capacity-inherit: host 自身の underCardSlots 枠上限へ、
// text_role アンダーカードそれぞれが持つ自身の underCardSlots (同一 roleTag) maxCount を
// 合算加算する継続効果登録。symbol_add(symbolSource.kind==="under_card_symbols") と同型の
// 自己参照型動的加算だが、対象はシンボルではなく underCardSlots 枠上限そのもの
// (BSAZ02-TX01(B) backFace effects[3] precedent)。

import { getCardById } from "../card/card-lookup";
import type {
  CardDefinition,
  ContinuousEffect,
  EffectDuration,
  EffectPreventionLevel,
  GameState,
  TimingScope,
  UnderCardSlotCapacityGrantAction,
} from "../model";
import {
  durationStr,
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import { nextCeId } from "./structured-effect-sequences";
import type { TargetLockBypassProfile } from "./target-affect-gate";

export function executeUnderCardSlotCapacityGrant(
  state: GameState,
  actingPlayerId: string,
  action: UnderCardSlotCapacityGrantAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toModify = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true
  );
  if (toModify.length === 0) {
    state.log.push(
      `effect:under_card_slot_capacity_grant:${action.hostRoleTag}:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffects: ContinuousEffect[] = toModify.map((card) => ({
    effectId: nextCeId("under_card_slot_capacity"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration as EffectDuration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "under_card_slot_capacity",
    modifierUnderCardSlotBonus: {
      hostRoleTag: action.hostRoleTag,
      childRoleTag: action.childRoleTag,
      ...(action.childFilter ? { childFilter: action.childFilter } : {}),
    },
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toModify.map(
      (c) =>
        `effect:under_card_slot_capacity_grant:registered:${c.instanceId}:${action.hostRoleTag}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}
