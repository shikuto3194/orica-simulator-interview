import type {
  ActiveStack,
  CardInstance,
  EffectActivationSourceZone,
} from "../model";

/** 使用途中でも召喚/使用の起点を参照する。現在ゾーン自体は変更しない。 */
export function getCardUseSourceZone(card: CardInstance): CardInstance["zone"] {
  return card.zone === "in_use"
    ? (card.inUseSourceZone ?? card.zone)
    : card.zone;
}

interface HasCardInstances {
  readonly cardInstances: readonly CardInstance[];
}

const cache = new WeakMap<
  HasCardInstances,
  ReadonlyMap<string, CardInstance>
>();

function buildIndex(
  state: HasCardInstances
): ReadonlyMap<string, CardInstance> {
  let map = cache.get(state);
  if (!map) {
    map = new Map(state.cardInstances.map((c) => [c.instanceId, c]));
    cache.set(state, map);
  }
  return map;
}

export function getCardById(
  state: HasCardInstances,
  instanceId: string
): CardInstance | undefined {
  return buildIndex(state).get(instanceId);
}

export function getCardByIdOrThrow(
  state: HasCardInstances,
  instanceId: string
): CardInstance {
  const card = getCardById(state, instanceId);
  if (!card) {
    throw new Error(`Unknown card instance: ${instanceId}`);
  }
  return card;
}

/**
 * card が player の宣言した契約カード（player.contractCardNo）かどうかを判定する SSOT。
 * 裏返り/煌臨等で instance.definitionId が印字と変わっていても originalDefinitionId で
 * 一致判定できるよう両方を見る（advent-system.ts / state-based-actions.ts と同じ規約）。
 */
export function isPlayersContractCard(
  card: Pick<CardInstance, "definitionId" | "originalDefinitionId">,
  contractCardNo: string | null | undefined
): boolean {
  if (!contractCardNo) return false;
  return (
    card.originalDefinitionId === contractCardNo ||
    card.definitionId === contractCardNo
  );
}

/**
 * ActiveStack の宣言時発動元ゾーンを解決する SSOT
 * (`StepCondition.kind:"activation_zone"` の元データ、pay-to-act-hand-discard-gate.ts /
 * ENGINE-effect-immunity-own-pending-resolution の effect_declaration 絞り込み双方で使う)。
 * sourceActivationZone (accel/change/hand_card_effect 汎用) → magicActivationZone
 * (マジック後方互換) → source card の現在ゾーン、の順にフォールバックする。
 */
export function getStackSourceActivationZone(
  state: HasCardInstances,
  stack: ActiveStack,
  observerPlayerId?: string
): EffectActivationSourceZone | undefined {
  if (
    observerPlayerId !== stack.actingPlayerId &&
    stack.sourcePhysicalZone !== undefined
  )
    return stack.sourcePhysicalZone;
  if (stack.sourceActivationZone !== undefined)
    return stack.sourceActivationZone;
  if (stack.magicActivationZone !== undefined) return stack.magicActivationZone;
  const source = getCardById(state, stack.cardInstanceId);
  if (
    source?.zone === "hand" ||
    source?.zone === "set_aside" ||
    source?.zone === "trash" ||
    source?.zone === "field" ||
    source?.zone === "mirage"
  ) {
    return source.zone;
  }
  return undefined;
}
