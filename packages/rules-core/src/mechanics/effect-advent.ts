import type { Action } from "../dsl-types";
import type { CardDefinition, GameState } from "../model";
import { getCardById } from "../card/card-lookup";
import { checkAdventConditions, type AdventParams } from "./advent-system";
import {
  getAdjacentAdventDestination,
  getEffectAdventAsIfPermissionHosts,
} from "./host-dual-advent";

/** 効果本文による煌臨はタイミングだけを上書きし、宣言・対象条件を維持する (08a7)。 */
export function getEffectAdventParams(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  adventCardInstanceId: string,
  action: Extract<Action, { kind: "advent" }>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): AdventParams | undefined {
  const card = getCardById(state, adventCardInstanceId);
  const definition = card && getCardDefinitionById(card.definitionId);
  if (
    !card ||
    card.controllerPlayerId !== actingPlayerId ||
    !definition?.adventData
  )
    return undefined;
  const adjacent =
    action.placement === "adjacent"
      ? getAdjacentAdventDestination(
          state,
          sourceInstanceId,
          definition,
          actingPlayerId,
          getCardDefinitionById
        )
      : undefined;
  if (action.placement === "adjacent" && !adjacent) return undefined;
  const permissionHostId = action.asIfPermissionHostInstanceId;
  if (
    permissionHostId !== undefined &&
    !getEffectAdventAsIfPermissionHosts(
      state,
      actingPlayerId,
      [definition],
      getCardDefinitionById
    ).some((host) => host.instanceId === permissionHostId)
  )
    return undefined;
  // 支払い免除はこの効果本文が与える。煌臨カード自身の別の代替支払い許可とは独立。
  const { alternateCostAdvent, ...printedData } = definition.adventData;
  void alternateCostAdvent;
  const variant = printedData.adventVariant ?? "normal";
  const params: AdventParams = {
    adventCardInstanceId,
    targetInstanceId: adjacent?.target.instanceId ?? sourceInstanceId,
    adventData: {
      ...printedData,
      ...(adjacent?.chargeCores ? { chargeCoresOnAdvent: true } : {}),
      adventSourceZone: card.zone === "trash" ? "trash" : "hand",
    },
    isContractAdvent: variant === "contract" || variant === "f_contract",
    isFContractAdvent: variant === "f_contract",
    useAlternateCost:
      action.useAlternateCost === true || permissionHostId !== undefined,
    allowAdventSourceTarget: adjacent !== undefined,
  };
  return "failureReason" in
    checkAdventConditions(state, actingPlayerId, params, getCardDefinitionById)
    ? undefined
    : params;
}

/** 支払い選択前の候補は、成立する実支払いまたは常時許可がある場合だけ残す。 */
export function canResolveEffectAdvent(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  adventCardInstanceId: string,
  action: Extract<Action, { kind: "advent" }>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (
    getEffectAdventParams(
      state,
      actingPlayerId,
      sourceInstanceId,
      adventCardInstanceId,
      action,
      getCardDefinitionById
    )
  )
    return true;
  if (
    action.useAlternateCost ||
    action.asIfPermissionHostInstanceId !== undefined
  )
    return false;
  const card = getCardById(state, adventCardInstanceId);
  const definition = card && getCardDefinitionById(card.definitionId);
  return (
    definition !== undefined &&
    getEffectAdventAsIfPermissionHosts(
      state,
      actingPlayerId,
      [definition],
      getCardDefinitionById
    ).some(
      (host) =>
        getEffectAdventParams(
          state,
          actingPlayerId,
          sourceInstanceId,
          adventCardInstanceId,
          { ...action, asIfPermissionHostInstanceId: host.instanceId },
          getCardDefinitionById
        ) !== undefined
    )
  );
}
