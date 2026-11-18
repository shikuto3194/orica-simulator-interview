import type { GameState } from "../model";

const ENTRY_PREFIX = "hand:entry:";
const SOURCED_ENTRY_PREFIX = "hand:entry-source:";
const EXCHANGE_PREFIX = "hand:exchange:";

interface HandEntrySource {
  playerId: string;
  sourceInstanceId: string;
  /** 公開された自己回収効果のカード名を、手札へ移動した後も参照する。 */
  sourceDefinitionId?: string;
}

interface HandEntry {
  instanceId: string;
  source?: HandEntrySource;
}

function parseHandEntry(line: string): HandEntry | undefined {
  if (line.startsWith(ENTRY_PREFIX)) {
    return { instanceId: line.slice(ENTRY_PREFIX.length) };
  }
  if (line.startsWith(SOURCED_ENTRY_PREFIX)) {
    try {
      const entry = JSON.parse(
        line.slice(SOURCED_ENTRY_PREFIX.length)
      ) as HandEntry | null;
      if (
        entry &&
        typeof entry.instanceId === "string" &&
        (!entry.source ||
          (typeof entry.source.playerId === "string" &&
            typeof entry.source.sourceInstanceId === "string"))
      )
        return entry;
    } catch {
      // 古い保存データ等に不完全なログがあっても、盤面差分の収集は継続する。
    }
  }
  return undefined;
}

function entriesFromLogs(logs: readonly string[], prefix: string): string[] {
  return logs
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

function enteredHandIds(before: GameState, after: GameState): string[] {
  const previous = new Map(
    before.cardInstances.map((card) => [card.instanceId, card])
  );
  return after.cardInstances
    .filter((card) => {
      const old = previous.get(card.instanceId);
      return (
        card.zone === "hand" &&
        (old?.zone !== "hand" || old.ownerPlayerId !== card.ownerPlayerId)
      );
    })
    .map((card) => card.instanceId);
}

/** 各移動/アクション境界で入った事実を保存する。後続の破棄や再移動で消さない。 */
export function recordHandEntries(
  before: GameState,
  after: GameState,
  sourceForEntry?: (instanceId: string) => HandEntrySource | undefined
): GameState {
  const entries = after.log.slice(before.log.length).flatMap((line) => {
    const entry = parseHandEntry(line);
    return entry ? [entry] : [];
  });
  const recorded = new Set(entries.map((entry) => entry.instanceId));
  const added = enteredHandIds(before, after).filter((id) => !recorded.has(id));
  if (
    added.length === 0 &&
    (!sourceForEntry || entries.every((entry) => entry.source))
  )
    return after;
  // 内包された自己回収の原因は、外側の効果の原因で上書きしない。
  const log = [...after.log, ...added.map((id) => ENTRY_PREFIX + id)].map(
    (line, index) => {
      if (index < before.log.length || !sourceForEntry) return line;
      const entry = parseHandEntry(line);
      if (!entry || entry.source) return line;
      const source = sourceForEntry(entry.instanceId);
      return source
        ? SOURCED_ENTRY_PREFIX + JSON.stringify({ ...entry, source })
        : line;
    }
  );
  return {
    ...after,
    log,
  };
}

/** 入れ替えで手札に入ったカードだけを除外する。同じ効果の別ドローは除外しない。 */
export function recordHandExchange(
  before: GameState,
  after: GameState,
  exchangedIds?: ReadonlySet<string>
): GameState {
  const ids = enteredHandIds(before, after).filter(
    (id) => !exchangedIds || exchangedIds.has(id)
  );
  if (ids.length === 0) return after;
  const recorded = recordHandEntries(before, after);
  return {
    ...recorded,
    log: [...recorded.log, ...ids.map((id) => EXCHANGE_PREFIX + id)],
  };
}

/** 離脱選択で解決が分かれた場合、手札へ戻ったカードの保存済み原因を引き継ぐ。 */
export function getPendingHandReturnEffectPlayerId(
  before: GameState,
  after: GameState,
  handOwnerPlayerId: string
): string | null {
  const returnedIds = new Set(
    after.cardInstances
      .filter(
        (card) =>
          card.zone === "hand" && card.ownerPlayerId === handOwnerPlayerId
      )
      .map((card) => card.instanceId)
  );
  const causes = new Set(
    before.pendingLeaveEntities
      .filter((leave) => returnedIds.has(leave.instanceId))
      .map((leave) =>
        leave.cause === "effect_resolution" ? leave.causePlayerId : null
      )
      .filter((playerId): playerId is string => playerId !== null)
  );
  return causes.size === 1 ? ([...causes][0] ?? null) : null;
}

/** 記録と境界で新しく手札に入ったカードを数える。総数の純増とは区別する。 */
export function collectHandIncreases(
  before: GameState,
  after: GameState
): Array<{ playerId: string; amount: number; source?: HandEntrySource }> {
  const logs = after.log.slice(before.log.length);
  const recorded = logs.flatMap((line) => {
    const entry = parseHandEntry(line);
    return entry ? [entry] : [];
  });
  const recordedIds = new Set(recorded.map((entry) => entry.instanceId));
  const entries = [
    ...recorded,
    ...enteredHandIds(before, after)
      .filter((id) => !recordedIds.has(id))
      .map((instanceId): HandEntry => ({ instanceId })),
  ];
  const cards = new Map(
    [...before.cardInstances, ...after.cardInstances].map((card) => [
      card.instanceId,
      card,
    ])
  );
  const groups = new Map<
    string,
    { playerId: string; amount: number; source?: HandEntrySource }
  >();
  const add = (playerId: string, amount: number, source?: HandEntrySource) => {
    const key = JSON.stringify([playerId, source ?? null]);
    const group = groups.get(key) ?? {
      playerId,
      amount: 0,
      ...(source ? { source } : {}),
    };
    group.amount += amount;
    groups.set(key, group);
  };
  for (const entry of entries) {
    const owner = cards.get(entry.instanceId)?.ownerPlayerId;
    if (owner) add(owner, 1, entry.source);
  }
  // インスタンスを省略した従来の抽象盤面も扱う。
  for (const player of after.players) {
    const old = before.players.find((p) => p.id === player.id);
    const recordedCount = [...groups.values()]
      .filter((group) => group.playerId === player.id)
      .reduce((sum, group) => sum + group.amount, 0);
    const unrecorded =
      player.handCount - (old?.handCount ?? player.handCount) - recordedCount;
    if (unrecorded > 0) add(player.id, unrecorded);
  }
  const excludedIds = entriesFromLogs(logs, EXCHANGE_PREFIX);
  for (const line of logs) {
    const match = /^mirage:hand-return-no-increase:([^:]+):(.+)$/.exec(line);
    if (match?.[2]) excludedIds.push(match[2]);
  }
  for (const id of excludedIds) {
    const entryIndex = entries.findIndex((entry) => entry.instanceId === id);
    const [entry] = entryIndex >= 0 ? entries.splice(entryIndex, 1) : [];
    const owner = cards.get(id)?.ownerPlayerId;
    if (owner) add(owner, -1, entry?.source);
  }
  return [...groups.values()].filter((group) => group.amount > 0);
}
