import {
  adventSourceIdsOf,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { getAttachedFieldBravesForHost } from "./field-under-card-visual";

export interface CardActionModalGroup<T extends LegalAction = LegalAction> {
  instanceId: string;
  actions: T[];
}

export function getFieldTapTargetIdsForCardClick(
  state: GameState,
  instanceId: string
): string[] {
  const ids = new Set<string>([instanceId]);
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  if (!card) return [...ids];

  for (const child of getAttachedFieldBravesForHost(
    state.cardInstances,
    card
  )) {
    ids.add(child.instanceId);
  }

  if (card.attachedToInstanceId) {
    ids.add(card.attachedToInstanceId);
    const host = state.cardInstances.find(
      (c) => c.instanceId === card.attachedToInstanceId
    );
    const siblings = host
      ? getAttachedFieldBravesForHost(state.cardInstances, host)
      : [];
    for (const child of siblings) {
      ids.add(child.instanceId);
    }
  }

  // 煌臨元は独立した盤面カードとして描画されないため、上のカードから操作する。
  // 合体ブレイヴを押した場合も、同じホストの煌臨元へ到達できるようにする。
  for (const id of [...ids]) {
    const member = state.cardInstances.find((c) => c.instanceId === id);
    if (!member || member.zone !== "field") continue;
    for (const sourceId of adventSourceIdsOf(member)) ids.add(sourceId);
  }

  return [...ids];
}

/** 操作可能な発揮元を含むカードを、クリック時と同じ範囲で強調する。 */
export function getSelectableFieldTapIds(
  state: GameState,
  actionTargetIds: ReadonlySet<string>
): Set<string> {
  const ids = new Set(actionTargetIds);
  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (
      getFieldTapTargetIdsForCardClick(state, card.instanceId).some((id) =>
        actionTargetIds.has(id)
      )
    ) {
      ids.add(card.instanceId);
    }
  }
  return ids;
}

export function getCardActionModalSourceInstanceId(
  action: LegalAction,
  fallbackInstanceId: string
): string {
  switch (action.kind) {
    case "use_field_card_effect":
      return action.sourceEffectInstanceId ?? action.sourceInstanceId;
    default:
      return fallbackInstanceId;
  }
}

export function groupCardActionsForModal<T extends LegalAction>(
  actions: readonly T[],
  fallbackInstanceId: string
): CardActionModalGroup<T>[] {
  const groups: CardActionModalGroup<T>[] = [];
  const groupById = new Map<string, CardActionModalGroup<T>>();

  for (const action of actions) {
    const instanceId = getCardActionModalSourceInstanceId(
      action,
      fallbackInstanceId
    );
    let group = groupById.get(instanceId);
    if (!group) {
      group = { instanceId, actions: [] };
      groupById.set(instanceId, group);
      groups.push(group);
    }
    group.actions.push(action);
  }

  return groups;
}
