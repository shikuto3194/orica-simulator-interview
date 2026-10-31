import type { CardInstance, Zone } from "../model";

interface HasCardInstances {
  readonly cardInstances: readonly CardInstance[];
}

type ZoneMap = ReadonlyMap<Zone, readonly CardInstance[]>;

const zoneCache = new WeakMap<readonly CardInstance[], ZoneMap>();

function buildZoneIndex(cards: readonly CardInstance[]): ZoneMap {
  let map = zoneCache.get(cards);
  if (!map) {
    const m = new Map<Zone, CardInstance[]>();
    for (const card of cards) {
      let arr = m.get(card.zone);
      if (!arr) {
        arr = [];
        m.set(card.zone, arr);
      }
      arr.push(card);
    }
    map = m;
    zoneCache.set(cards, map);
  }
  return map;
}

const EMPTY: readonly CardInstance[] = [];

/**
 * 指定ゾーンのカードを O(1) で取得する。
 */
export function getCardsByZone(
  state: HasCardInstances,
  zone: Zone
): readonly CardInstance[] {
  return buildZoneIndex(state.cardInstances).get(zone) ?? EMPTY;
}
