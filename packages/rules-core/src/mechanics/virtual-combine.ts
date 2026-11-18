import { getCEsForTarget } from "../card/ce-lookup";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  SymbolColor,
} from "../model";

export interface VirtualCombinedBraveDescriptor {
  cardName?: string;
  tribes?: string[];
  cost?: number;
  symbols?: SymbolColor[];
  combinedBoost?: number;
  countsTowardLimit?: boolean;
}

function isSymbolColor(value: unknown): value is SymbolColor {
  return (
    value === "red" ||
    value === "purple" ||
    value === "green" ||
    value === "white" ||
    value === "yellow" ||
    value === "blue" ||
    value === "black"
  );
}

function hasVirtualCombinedOverride(
  state: Pick<GameState, "activeContinuousEffects">,
  instanceId: string
): boolean {
  return getCEsForTarget(state, instanceId).some((ce) => {
    if (ce.modifierTag !== "override_properties" || !ce.metadata) {
      return false;
    }
    const props = ce.metadata.properties as { combined?: unknown } | undefined;
    return props?.combined === true;
  });
}

function readVirtualCombinedBraveDescriptor(
  value: unknown
): VirtualCombinedBraveDescriptor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as {
    cardName?: unknown;
    tribes?: unknown;
    cost?: unknown;
    symbols?: unknown;
    combinedBoost?: unknown;
    countsTowardLimit?: unknown;
  };
  return {
    ...(typeof record.cardName === "string"
      ? { cardName: record.cardName }
      : {}),
    ...(Array.isArray(record.tribes)
      ? {
          tribes: record.tribes.filter(
            (t): t is string => typeof t === "string"
          ),
        }
      : {}),
    ...(typeof record.cost === "number" && Number.isFinite(record.cost)
      ? { cost: record.cost }
      : {}),
    ...(Array.isArray(record.symbols)
      ? { symbols: record.symbols.filter(isSymbolColor) }
      : {}),
    ...(typeof record.combinedBoost === "number" &&
    Number.isFinite(record.combinedBoost)
      ? { combinedBoost: record.combinedBoost }
      : {}),
    ...(typeof record.countsTowardLimit === "boolean"
      ? { countsTowardLimit: record.countsTowardLimit }
      : {}),
  };
}

export function getVirtualCombinedBraves(
  state: Pick<GameState, "activeContinuousEffects">,
  instanceId: string
): VirtualCombinedBraveDescriptor[] {
  return getCEsForTarget(state, instanceId).flatMap((ce) => {
    if (ce.modifierTag !== "override_properties" || !ce.metadata) {
      return [];
    }
    const props = ce.metadata.properties as
      | { virtualAttachedBraves?: unknown }
      | undefined;
    if (!Array.isArray(props?.virtualAttachedBraves)) return [];
    return props.virtualAttachedBraves
      .map(readVirtualCombinedBraveDescriptor)
      .filter((d): d is VirtualCombinedBraveDescriptor => d !== undefined);
  });
}

export function getVirtualCombinedBraveLimitCount(
  state: Pick<GameState, "activeContinuousEffects">,
  instanceId: string
): number {
  return getVirtualCombinedBraves(state, instanceId).filter(
    (brave) => brave.countsTowardLimit !== false
  ).length;
}

export function getVirtualCombinedBraveCostTotal(
  state: Pick<GameState, "activeContinuousEffects">,
  instanceId: string
): number {
  return getVirtualCombinedBraves(state, instanceId).reduce(
    (sum, brave) => sum + (brave.cost ?? 0),
    0
  );
}

export function getVirtualCombinedBraveBpPlusTotal(
  state: Pick<GameState, "activeContinuousEffects">,
  instanceId: string
): number {
  return getVirtualCombinedBraves(state, instanceId).reduce(
    (sum, brave) => sum + (brave.combinedBoost ?? 0),
    0
  );
}

export function isEffectivelyCombined(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "cardInstances">>,
  card: Pick<
    CardInstance,
    "instanceId" | "attachedToInstanceId" | "attachedChildrenIds"
  > &
    Partial<Pick<CardInstance, "underCards">>
): boolean {
  const cardInstances = state.cardInstances;
  const parentCard =
    cardInstances?.find((c) => c.instanceId === card.instanceId) ?? card;
  const parentUnderCardIds = new Set(
    parentCard.underCards?.map((entry) => entry.cardInstanceId) ?? []
  );
  const isUnderCard = (parentInstanceId: string, childInstanceId: string) =>
    cardInstances
      ?.find((c) => c.instanceId === parentInstanceId)
      ?.underCards.some((entry) => entry.cardInstanceId === childInstanceId) ??
    false;

  const isAttachedAsCombinedChild =
    card.attachedToInstanceId !== null &&
    !isUnderCard(card.attachedToInstanceId, card.instanceId);

  const hasCombinedChild = cardInstances
    ? card.attachedChildrenIds.some(
        (childId) => !parentUnderCardIds.has(childId)
      ) ||
      cardInstances.some(
        (child) =>
          child.attachedToInstanceId === card.instanceId &&
          !parentUnderCardIds.has(child.instanceId)
      )
    : card.attachedChildrenIds.length > 0;

  return (
    isAttachedAsCombinedChild ||
    hasCombinedChild ||
    hasVirtualCombinedOverride(state, card.instanceId)
  );
}

/**
 * カード自身が合体スピリットのブレイヴ側メンバーかを返す。
 *
 * `isEffectivelyCombined()` はホスト側にも true を返すため、ブレイヴ自身の Lv/BP＋表示や
 * Lv 条件評価ではこの helper を使って「合体子カード」に限定する。text_role のアンダーカードは
 * `attachedToInstanceId` を持つ場合があるが、`isEffectivelyCombined()` が除外する。
 */
export function isCombinedBrave(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "cardInstances">>,
  card: CardInstance,
  definition: Pick<CardDefinition, "printedCategory"> | undefined
): boolean {
  if (definition?.printedCategory !== "brave") return false;

  // 異魔神の右スロットは host.attachedChildrenIds に反映しない非対称表現だが、
  // brave 自身に右ホストが記録されていれば合体子カードである。
  if (card.imaginRightCombinedWith !== null) return true;

  return (
    card.attachedToInstanceId !== null && isEffectivelyCombined(state, card)
  );
}
