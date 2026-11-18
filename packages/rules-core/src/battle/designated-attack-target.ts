import { getCardById } from "../card/card-lookup";
import type { CardDefinition, GameState } from "../model";
import {
  getDesignatedAttackAttackerCard,
  isDesignatedAttackTargetLegal,
} from "./battle-availability";
import { getOrCreateCombatBattleEntity } from "./battle-shared";

/** 宣言済みアタックの対象予約。強制ブロックは既存の誘発・バースト完了処理が行う。 */
export function designateActiveAttackTarget(
  state: GameState,
  targetInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string
): GameState {
  const activeAttack = state.activeAttack;
  if (
    !activeAttack ||
    state.window !== "declare_attack" ||
    state.battleResolutionGroup
  )
    return state;
  if (
    activeAttack.flashBeforeBlockCompleted ||
    activeAttack.blockAssignments.some((a) => a.blockedByEntityIds.length > 0)
  )
    return state;
  const attacker = getDesignatedAttackAttackerCard(state, activeAttack);
  const source = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : attacker;
  if (
    !attacker ||
    attacker.zone !== "field" ||
    attacker.pendingLeaveKind !== null
  )
    return state;
  if (
    !source ||
    (source.instanceId !== attacker.instanceId &&
      source.attachedToInstanceId !== attacker.instanceId)
  )
    return state;
  const target = getCardById(state, targetInstanceId);
  const targetDefinition = target && getCardDefinitionById(target.definitionId);
  if (
    !target ||
    !targetDefinition ||
    target.controllerPlayerId === attacker.controllerPlayerId ||
    target.pendingLeaveKind !== null ||
    target.attachedToInstanceId !== null ||
    !isDesignatedAttackTargetLegal(
      state,
      target,
      getCardDefinitionById,
      attacker
    )
  )
    return state;
  const entity = getOrCreateCombatBattleEntity({
    state,
    sourceCard: target,
    sourceDefinition: targetDefinition,
    getCardDefinitionById,
  });
  const hasEntity = state.battleEntities.some(
    (e) => e.entityId === entity.entityId
  );
  return {
    ...state,
    battleEntities: hasEntity
      ? state.battleEntities.map((e) =>
          e.entityId === entity.entityId ? entity : e
        )
      : [...state.battleEntities, entity],
    activeAttack: {
      ...activeAttack,
      target: { kind: "battle_entity", entityId: entity.entityId },
      designatedTargetInstanceId: target.instanceId,
    },
    log: [
      ...state.log,
      `attack:spirit-target-pending:${target.instanceId}:${entity.entityId}`,
    ],
  };
}
