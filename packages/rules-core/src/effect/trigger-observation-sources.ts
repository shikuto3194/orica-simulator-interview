import type {
  CardInstance,
  GameState,
  TriggerObservationSnapshot,
  TriggerObservationSourceRole,
} from "../model";
import { adventSourceIdsOf, textRoleUnderCardIdsOf } from "../model";
import { isSoulStateCard } from "../battle/battle-shared";

type ObservationState = Pick<GameState, "cardInstances" | "players">;

function collectSourceHosts(state: ObservationState) {
  const advent = new Map<string, string[]>();
  const text = new Map<string, string[]>();
  const add = (
    index: Map<string, string[]>,
    childId: string,
    hostId: string
  ) => {
    const hosts = index.get(childId) ?? [];
    hosts.push(hostId);
    index.set(childId, hosts);
  };
  for (const host of state.cardInstances) {
    for (const childId of adventSourceIdsOf(host))
      add(advent, childId, host.instanceId);
    for (const childId of textRoleUnderCardIdsOf(host))
      add(text, childId, host.instanceId);
  }
  for (const index of [advent, text])
    for (const hosts of index.values()) hosts.sort();
  return { advent, text };
}

function captureSourceRole(
  state: ObservationState,
  card: CardInstance,
  hosts: ReturnType<typeof collectSourceHosts>
): TriggerObservationSourceRole {
  return {
    soulState: isSoulStateCard(state, card.instanceId),
    soulStateGeneration: card.soulStateGeneration ?? 0,
    effectTextGeneration: card.effectTextGeneration ?? 0,
    ...(card.triggerPresenceGeneration
      ? { triggerPresenceGeneration: card.triggerPresenceGeneration }
      : {}),
    faceDown: card.faceDown === true,
    attachedToInstanceId: card.attachedToInstanceId,
    imaginRightCombinedWith: card.imaginRightCombinedWith ?? null,
    adventSourceHostInstanceIds: hosts.advent.get(card.instanceId) ?? [],
    textRoleHostInstanceIds: hosts.text.get(card.instanceId) ?? [],
  };
}

/** 内部zoneがfieldの魂状態・下カードを、独立した場の効果元と混同しない。 */
export function captureTriggerSourceRole(
  state: ObservationState,
  card: CardInstance
): TriggerObservationSourceRole {
  return captureSourceRole(state, card, collectSourceHosts(state));
}

export function matchesTriggerSourceRole(
  state: ObservationState,
  card: CardInstance | undefined,
  observed: TriggerObservationSourceRole | undefined
): boolean {
  if (card === undefined) return false;
  if (observed === undefined) return true;
  if (
    !Array.isArray(observed.adventSourceHostInstanceIds) ||
    !Array.isArray(observed.textRoleHostInstanceIds)
  )
    return false;
  const current = captureTriggerSourceRole(state, card);
  const sameIds = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length &&
    left.every((id, index) => id === right[index]);
  return (
    current.soulState === observed.soulState &&
    current.soulStateGeneration === observed.soulStateGeneration &&
    current.effectTextGeneration === (observed.effectTextGeneration ?? 0) &&
    (current.triggerPresenceGeneration ?? 0) ===
      (observed.triggerPresenceGeneration ?? 0) &&
    current.faceDown === observed.faceDown &&
    current.attachedToInstanceId === observed.attachedToInstanceId &&
    current.imaginRightCombinedWith === observed.imaginRightCombinedWith &&
    sameIds(
      current.adventSourceHostInstanceIds,
      observed.adventSourceHostInstanceIds
    ) &&
    sameIds(current.textRoleHostInstanceIds, observed.textRoleHostInstanceIds)
  );
}

/** 事象直前の個体と発揮場所。公開/非公開の適用可否は収集側の正源で判定する。 */
export function captureTriggerObservation(
  state: GameState
): TriggerObservationSnapshot {
  const hosts = collectSourceHosts(state);
  return {
    sourceIdentities: Object.fromEntries(
      state.cardInstances.map((card) => [
        card.instanceId,
        {
          definitionId: card.definitionId,
          zone: card.zone,
          fieldInstanceGeneration: card.fieldInstanceGeneration ?? 0,
          attachedToInstanceId: card.attachedToInstanceId,
          sourceRole: captureSourceRole(state, card, hosts),
        },
      ])
    ),
    grantedEffectIds: state.activeContinuousEffects
      .filter((effect) => effect.modifierTag === "granted_effect")
      .map((effect) => effect.effectId),
  };
}

/** 未記録の旧イベントは互換扱い。新イベントでは欠落・別面・別個体を後から補わない。 */
export function canObserveTrigger(
  snapshot: TriggerObservationSnapshot | undefined,
  card: CardInstance,
  state: ObservationState,
  continuedAdventHostId?: string
): boolean {
  if (snapshot === undefined) return true;
  const observed = snapshot.sourceIdentities[card.instanceId];
  if (
    !observed ||
    observed.definitionId !== card.definitionId ||
    observed.zone !== card.zone ||
    observed.fieldInstanceGeneration !== (card.fieldInstanceGeneration ?? 0) ||
    observed.attachedToInstanceId !== card.attachedToInstanceId
  )
    return false;
  if (matchesTriggerSourceRole(state, card, observed.sourceRole)) return true;
  // The same printed ability was already active on the Spirit that became
  // this event's advent source. Permit precisely that role transition.
  return (
    continuedAdventHostId !== undefined &&
    observed.sourceRole !== undefined &&
    Array.isArray(observed.sourceRole.adventSourceHostInstanceIds) &&
    observed.sourceRole.adventSourceHostInstanceIds.length === 0 &&
    matchesTriggerSourceRole(state, card, {
      ...observed.sourceRole,
      adventSourceHostInstanceIds: [continuedAdventHostId],
    })
  );
}
