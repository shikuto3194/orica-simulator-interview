import { getCardById } from "../card/card-lookup";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import { canTriggerFromPendingLeaveSource } from "../zone/pending-leave-trigger-event-kind";
import type {
  CardDefinition,
  ExhaustTriggerSubject,
  GameState,
  PendingTriggeredEffect,
  TriggeredMechanic,
} from "../model";

export function captureExhaustTriggerSubjects(
  state: GameState,
  instanceIds: readonly string[]
): ExhaustTriggerSubject[] {
  return [...new Set(instanceIds)].map((instanceId) => {
    const card = getCardById(state, instanceId);
    return {
      instanceId,
      exhaustTriggerGeneration: card?.exhaustTriggerGeneration ?? 0,
      fieldInstanceGeneration: card?.fieldInstanceGeneration ?? 0,
      soulStateGeneration: card?.soulStateGeneration ?? 0,
    };
  });
}

export function isPendingExhaustTriggerEligible(
  state: GameState,
  pending: Pick<
    PendingTriggeredEffect,
    | "eventKind"
    | "relatedInstanceId"
    | "relatedInstanceIds"
    | "relatedInstanceIdsBySourceRegistrationKey"
    | "exhaustTriggerSubjects"
  >,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceRegistrationKey: string
): boolean {
  if (pending.eventKind !== "exhaust") return true;
  const relatedIds =
    pending.relatedInstanceIdsBySourceRegistrationKey?.[
      sourceRegistrationKey
    ] ??
    pending.relatedInstanceIds ??
    (pending.relatedInstanceId === null ? [] : [pending.relatedInstanceId]);
  // 旧保存データは新しい疲労世代だけ 0 として読む。既存の場/魂世代は
  // イベント発生以前にも進んでいた可能性があるのでunknownのまま扱う。
  // 現在の疲労世代で撮り直すと、失効した旧pendingが再疲労時に復活してしまう。
  const subjects =
    pending.exhaustTriggerSubjects ??
    relatedIds.map((instanceId) => ({
      instanceId,
      exhaustTriggerGeneration: 0,
    }));
  return hasEligibleExhaustTriggerSubject(
    state,
    subjects,
    getCardDefinitionById,
    relatedIds
  );
}

/** Q31576: 主体が回復/離脱した疲労誘発は、再疲労/再入場しても復活しない。 */
export function hasEligibleExhaustTriggerSubject(
  state: GameState,
  subjects: readonly ExhaustTriggerSubject[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  relatedInstanceIds?: readonly string[]
): boolean {
  const soulIds = getEffectiveSoulStateIds(state, getCardDefinitionById);
  return subjects.some((subject) => {
    if (
      relatedInstanceIds !== undefined &&
      !relatedInstanceIds.includes(subject.instanceId)
    )
      return false;
    const card = getCardById(state, subject.instanceId);
    return (
      card !== undefined &&
      card.zone === "field" &&
      card.exhaustState !== "recovered" &&
      !soulIds.has(card.instanceId) &&
      (card.exhaustTriggerGeneration ?? 0) ===
        subject.exhaustTriggerGeneration &&
      (subject.fieldInstanceGeneration === undefined ||
        (card.fieldInstanceGeneration ?? 0) ===
          subject.fieldInstanceGeneration) &&
      (subject.soulStateGeneration === undefined ||
        (card.soulStateGeneration ?? 0) === subject.soulStateGeneration)
    );
  });
}

/** 事象の主体が離脱待機でも参照できる。付与効果を発揮するカード自身の資格は別に検査する。 */
export function isGrantedExhaustTriggerEligible(
  state: GameState,
  mechanic: Pick<
    Extract<TriggeredMechanic, { kind: "granted_effect" }>,
    "granteeInstanceId" | "exhaustTriggerSubjects"
  >,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (mechanic.exhaustTriggerSubjects === undefined) return true;
  const grantee = getCardById(state, mechanic.granteeInstanceId);
  return (
    grantee !== undefined &&
    canTriggerFromPendingLeaveSource(state, grantee, {
      eventKind: "exhaust",
      relatedInstanceId: null,
    }) &&
    hasEligibleExhaustTriggerSubject(
      state,
      mechanic.exhaustTriggerSubjects,
      getCardDefinitionById
    )
  );
}
