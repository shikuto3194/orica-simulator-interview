import {
  normalizeUnderCardRoleTag,
  type CardDefinition,
  type CardInstance,
  type UnderCardEntry,
} from "@orica/rules-core";

const ADVENT_STACK_STEP_PX = 4;
const TEXT_ROLE_STACK_STEP_PX = 4;
const STACK_PEEK_MAX_LAYERS = 4;
const STAR_GARMENT_ROLE_TAG = "星霊衣";

export type FieldUnderCardPeekLayout =
  | "vertical"
  | "star-garment-triangle"
  | "buddy-v-left"
  | "buddy-v-right";

export interface FieldUnderCardPeek {
  layout: FieldUnderCardPeekLayout;
  count: number;
  stepPx: number;
}

export interface FieldUnderCardVisual {
  entries: readonly UnderCardEntry[];
  browseInstanceIds: readonly string[];
  browseTitle: string;
  hasAdventSource: boolean;
  peek: FieldUnderCardPeek;
  overhangX: number;
  overhangY: number;
}

export type HostDualAdventSide = "left" | "right";

export type FieldSharedCardKind = "imagin-brave" | "true-buddy";

/**
 * 2 体の field anchor が同じ物理カードを共有する描画関係。
 * sharedCardId は盤面上では 1 枚だけ描画し、anchor ごとの browse からは同じ
 * instanceId を参照する。左右 anchor の疲労状態は共有カードへ伝播させない。
 */
export interface FieldSharedCardGroup {
  kind: FieldSharedCardKind;
  sharedCardId: string;
  anchorCardIds: readonly [string, string];
}

export interface FieldStackBrowse {
  instanceIds: readonly string[];
  title: string;
}

export interface AttachedFieldBravesForHostOptions {
  excludeInstanceIds?: ReadonlySet<string> | undefined;
}

function underCardIdsOf(card: CardInstance): string[] {
  return (card.underCards ?? []).map((entry) => entry.cardInstanceId);
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function buildDualAdventOccupantsByHostId(
  cards: readonly CardInstance[],
  getDefinition: (id: string) => CardDefinition | undefined
): Map<string, string[]> {
  const cardById = new Map(cards.map((card) => [card.instanceId, card]));
  const occupantsByHostId = new Map<string, string[]>();

  for (const card of cards) {
    if (card.zone !== "field") continue;
    for (const entry of card.underCards ?? []) {
      if (entry.role !== "advent_source") continue;
      const host = cardById.get(entry.cardInstanceId);
      const hostDef = host ? getDefinition(host.definitionId) : undefined;
      if (!host || (hostDef?.hostDualAdventGrant?.slots.length ?? 0) < 2) {
        continue;
      }
      const occupants = occupantsByHostId.get(host.instanceId) ?? [];
      if (!occupants.includes(card.instanceId)) occupants.push(card.instanceId);
      occupantsByHostId.set(host.instanceId, occupants);
    }
  }

  return occupantsByHostId;
}

export function buildFieldSharedCardGroups(
  cards: readonly CardInstance[],
  getDefinition: (id: string) => CardDefinition | undefined
): FieldSharedCardGroup[] {
  const cardById = new Map(cards.map((card) => [card.instanceId, card]));
  const groups: FieldSharedCardGroup[] = [];

  for (const brave of cards) {
    if (
      brave.zone !== "field" ||
      brave.attachedToInstanceId === null ||
      brave.imaginRightCombinedWith === null
    ) {
      continue;
    }
    const left = cardById.get(brave.attachedToInstanceId);
    const right = cardById.get(brave.imaginRightCombinedWith);
    if (!left || !right || left.zone !== "field" || right.zone !== "field") {
      continue;
    }
    groups.push({
      kind: "imagin-brave",
      sharedCardId: brave.instanceId,
      anchorCardIds: [left.instanceId, right.instanceId],
    });
  }

  for (const [hostId, occupants] of buildDualAdventOccupantsByHostId(
    cards,
    getDefinition
  )) {
    if (occupants.length < 2) continue;
    groups.push({
      kind: "true-buddy",
      sharedCardId: hostId,
      anchorCardIds: [occupants[0]!, occupants[1]!],
    });
  }

  return groups;
}

function roleTagLabel(entry: UnderCardEntry): string {
  if (entry.role === "advent_source") return "煌臨";
  return normalizeUnderCardRoleTag(entry.roleTag) ?? "アンダーカード";
}

function buildBrowseTitle(entries: readonly UnderCardEntry[]): string {
  if (
    entries.length > 0 &&
    entries.every((entry) => entry.role === "advent_source")
  ) {
    return "煌臨スタック";
  }
  const labels = Array.from(new Set(entries.map(roleTagLabel)));
  return labels.length === 1 ? labels[0]! : "アンダーカード";
}

export function buildHostDualAdventSideByCard(
  cards: readonly CardInstance[],
  getDefinition: (id: string) => CardDefinition | undefined
): Map<string, HostDualAdventSide> {
  const sideByCard = new Map<string, HostDualAdventSide>();
  for (const group of buildFieldSharedCardGroups(cards, getDefinition)) {
    if (group.kind !== "true-buddy") continue;
    sideByCard.set(group.anchorCardIds[0], "left");
    sideByCard.set(group.anchorCardIds[1], "right");
  }
  return sideByCard;
}

export function buildSharedFieldCardBrowseByCard(
  cards: readonly CardInstance[],
  getDefinition: (id: string) => CardDefinition | undefined
): Map<string, FieldStackBrowse> {
  const browseByCard = new Map<string, FieldStackBrowse>();
  for (const group of buildFieldSharedCardGroups(cards, getDefinition)) {
    for (const anchorId of group.anchorCardIds) {
      browseByCard.set(anchorId, {
        instanceIds: [anchorId, group.sharedCardId],
        title: group.kind === "true-buddy" ? "真・バディ" : "異魔神合体",
      });
    }
  }
  return browseByCard;
}

export function getAttachedFieldBravesForHost(
  cards: readonly CardInstance[],
  host: CardInstance,
  options: AttachedFieldBravesForHostOptions = {}
): CardInstance[] {
  const hostUnderCardIds = new Set(underCardIdsOf(host));
  const hostOrderById = new Map(
    host.attachedChildrenIds.map((id, index) => [id, index])
  );
  const cardOrderById = new Map(
    cards.map((card, index) => [card.instanceId, index])
  );
  const orderOf = (card: CardInstance): number =>
    hostOrderById.get(card.instanceId) ?? Number.MAX_SAFE_INTEGER;
  const fallbackOrderOf = (card: CardInstance): number =>
    cardOrderById.get(card.instanceId) ?? Number.MAX_SAFE_INTEGER;

  return cards
    .filter(
      (child) =>
        child.zone === "field" &&
        child.zoneRoleName === "brave" &&
        (child.attachedToInstanceId === host.instanceId ||
          child.imaginRightCombinedWith === host.instanceId) &&
        !hostUnderCardIds.has(child.instanceId) &&
        !(options.excludeInstanceIds?.has(child.instanceId) ?? false)
    )
    .sort((left, right) => {
      const hostOrderDelta = orderOf(left) - orderOf(right);
      if (hostOrderDelta !== 0) return hostOrderDelta;
      return fallbackOrderOf(left) - fallbackOrderOf(right);
    });
}

export function buildFieldStackBrowseByCard(
  cards: readonly CardInstance[],
  getDefinition: (id: string) => CardDefinition | undefined
): Map<string, FieldStackBrowse> {
  const sharedGroups = buildFieldSharedCardGroups(cards, getDefinition);
  const sharedGroupByAnchorId = new Map<string, FieldSharedCardGroup>();
  for (const group of sharedGroups) {
    for (const anchorId of group.anchorCardIds) {
      sharedGroupByAnchorId.set(anchorId, group);
    }
  }
  const sharedCardIds = new Set(
    sharedGroups.map((group) => group.sharedCardId)
  );
  const browseByCard = new Map<string, FieldStackBrowse>();

  for (const card of cards) {
    if (card.zone !== "field") continue;

    const sharedGroup = sharedGroupByAnchorId.get(card.instanceId);
    const sharedCardId = sharedGroup?.sharedCardId;
    const attachedBraveIds = getAttachedFieldBravesForHost(cards, card, {
      excludeInstanceIds: sharedCardIds,
    }).map((child) => child.instanceId);
    const visual = getFieldUnderCardVisual(card);
    const localVisual = sharedCardId
      ? getLocalFieldUnderCardVisual(card, sharedCardId)
      : visual;
    if (!sharedCardId && attachedBraveIds.length === 0 && !visual) continue;

    const instanceIds = [card.instanceId];
    if (sharedCardId) pushUnique(instanceIds, sharedCardId);
    for (const id of attachedBraveIds) pushUnique(instanceIds, id);
    for (const id of visual?.browseInstanceIds.slice(1) ?? []) {
      pushUnique(instanceIds, id);
    }

    const hasAttachedStack =
      sharedCardId !== undefined || attachedBraveIds.length > 0;
    const hasMixedStack = attachedBraveIds.length > 0 && localVisual !== null;
    const title = hasMixedStack
      ? "フィールド重なり"
      : sharedGroup
        ? sharedGroup.kind === "true-buddy"
          ? "真・バディ"
          : "異魔神合体"
        : hasAttachedStack
          ? "合体スピリット"
          : (visual?.browseTitle ?? "カード");
    const browse: FieldStackBrowse = { instanceIds, title };

    browseByCard.set(card.instanceId, browse);
    if (sharedCardId) browseByCard.set(sharedCardId, browse);
    for (const id of attachedBraveIds) browseByCard.set(id, browse);
  }

  return browseByCard;
}

/** 共有カードだけを除いた、anchor 固有の under-card 表示を返す。 */
export function getLocalFieldUnderCardVisual(
  card: CardInstance,
  sharedCardId?: string
): FieldUnderCardVisual | null {
  if (!sharedCardId) return getFieldUnderCardVisual(card);
  const localEntries = (card.underCards ?? []).filter(
    (entry) => entry.cardInstanceId !== sharedCardId
  );
  if (localEntries.length === 0) return null;
  return getFieldUnderCardVisual({ ...card, underCards: localEntries });
}

export function getFieldUnderCardVisual(
  card: CardInstance,
  hostDualAdventSide?: HostDualAdventSide
): FieldUnderCardVisual | null {
  const entries = card.underCards ?? [];
  if (entries.length === 0) return null;

  const hasAdventSource = entries.some(
    (entry) => entry.role === "advent_source"
  );
  const allAdventSource = entries.every(
    (entry) => entry.role === "advent_source"
  );
  const allStarGarment =
    entries.length === 2 &&
    entries.every(
      (entry) =>
        entry.role === "text_role" && entry.roleTag === STAR_GARMENT_ROLE_TAG
    );
  const stepPx = allAdventSource
    ? ADVENT_STACK_STEP_PX
    : TEXT_ROLE_STACK_STEP_PX;
  const layout: FieldUnderCardPeekLayout =
    hostDualAdventSide === "left"
      ? "buddy-v-left"
      : hostDualAdventSide === "right"
        ? "buddy-v-right"
        : allStarGarment
          ? "star-garment-triangle"
          : "vertical";
  const visibleLayers =
    layout === "vertical" ? Math.min(entries.length, STACK_PEEK_MAX_LAYERS) : 1;

  return {
    entries,
    browseInstanceIds: [card.instanceId, ...underCardIdsOf(card)],
    browseTitle: buildBrowseTitle(entries),
    hasAdventSource,
    peek: {
      layout,
      count: entries.length,
      stepPx,
    },
    overhangX:
      layout === "star-garment-triangle"
        ? stepPx * 2
        : layout === "buddy-v-left" || layout === "buddy-v-right"
          ? stepPx
          : 0,
    overhangY: visibleLayers * stepPx + 2,
  };
}
