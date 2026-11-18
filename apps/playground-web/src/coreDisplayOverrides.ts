import type {
  GameState,
  NormalCoreContainer,
  PlayerScopedSoulCoreLocation,
  SoulCoreContainer,
} from "@orica/rules-core";
import type { HeldCoreEntry } from "./coreSelectionFacade";

/**
 * SSOT: コアの所在コンテナ → 表示オーバーライドのキー文字列。
 *
 * - `reserve` / `trash` / `life`: `viewingPlayer` 自身のゾーンのみキー化 (相手ゾーンは
 *   共有キーを汚さないよう `null`)。
 * - `card`: `instanceId`。
 * - `void` / `removed_from_game`: 表示対象外 (`null`)。
 *
 * 通常コア (`computeCoreDisplayOverrides`) とソウルコア
 * (`computeSoulCoreDisplayOverrides`) の held ループ、および soulCoreLocation 差分が
 * **すべてこの 1 関数を通る**。源種別 (reserve/trash/life/card) の分岐をここへ集約し、
 * 「片方だけ分岐を取りこぼしてドリフトする」SSOT 違反 (2026-06-06 のトラッシュ/ライフ
 * ソウル表示バグの根本原因) を再発させないための単一正源。
 *
 * NOTE: ソース→キー写像の正源はここ 1 箇所のみ。新しいゾーン種別やコンテナ種別を
 * 表示に載せるときも、各 producer で個別判別せずこの関数を拡張すること。
 * (tap 用 locationId 変換 `normalContainerToLocationId` は viewing-player guard を
 * 持たない別用途なので混同しない。)
 */
export function coreContainerDisplayKey(
  container: NormalCoreContainer | SoulCoreContainer,
  viewingPlayer: string
): string | null {
  switch (container.kind) {
    case "reserve":
    case "trash":
    case "life":
      return container.playerId === viewingPlayer ? container.kind : null;
    case "card":
      return container.instanceId;
    default:
      return null; // void / removed_from_game
  }
}

/**
 * player-scoped な `soulCoreLocation` (playerId を持たない) を所有者明示で
 * `coreContainerDisplayKey` に橋渡しする内部ヘルパ。zones は owner、card は instanceId。
 */
function soulLocationDisplayKey(
  loc: PlayerScopedSoulCoreLocation | null | undefined,
  ownerPlayerId: string,
  viewingPlayer: string
): string | null {
  if (!loc) return null;
  if (loc.kind === "card") return coreContainerDisplayKey(loc, viewingPlayer);
  if (loc.kind === "reserve" || loc.kind === "trash" || loc.kind === "life") {
    return coreContainerDisplayKey(
      { kind: loc.kind, playerId: ownerPlayerId },
      viewingPlayer
    );
  }
  return null; // removed_from_game
}

/**
 * 通常コア表示オーバーライド (`instanceId` / "reserve" / "trash" / "life" → 表示用コア数)。
 *
 * BattleScreen の `coreDisplayOverrides` useMemo から抽出。コア選択モード中:
 * 1. `previewState` (確定 draft 反映済み) と実 `state` の通常コア数 diff を反映。
 * 2. `heldCores` (掴んだが未配置の通常コア) を source から 1 ずつ減算。
 * 3. 単一ソース `trash_distribution` の全配置必須 (minTotal===totalNormalCores) は
 *    発揮時点で source ゾーンを即 0 相当へ。
 *
 * 源種別 → キーの写像は `coreContainerDisplayKey` を共有 (soul producer と同一正源)。
 */
export function computeCoreDisplayOverrides(params: {
  isActive: boolean;
  previewState: GameState;
  state: GameState;
  heldCores: readonly HeldCoreEntry[];
  viewingPlayer: string;
  pendingCoreDistribution: GameState["pendingCoreDistribution"];
}): Record<string, number> | undefined {
  const {
    isActive,
    previewState,
    state,
    heldCores,
    viewingPlayer,
    pendingCoreDistribution,
  } = params;
  if (!isActive) return undefined;
  const overrides: Record<string, number> = {};
  if (previewState !== state) {
    // reserve / trash / life diff: 自分のゾーンのみ (相手リザーブはシュート preview で
    // 変わり得るが表示キーは viewingPlayer 視点で固定)。
    for (const player of state.players) {
      const previewPlayer = previewState.players.find(
        (p) => p.id === player.id
      );
      if (!previewPlayer) continue;
      if (player.id !== viewingPlayer) continue;
      if (
        previewPlayer.reserveNormalCoreCount !== player.reserveNormalCoreCount
      )
        overrides["reserve"] = previewPlayer.reserveNormalCoreCount;
      if (previewPlayer.trashNormalCoreCount !== player.trashNormalCoreCount)
        overrides["trash"] = previewPlayer.trashNormalCoreCount;
      if (previewPlayer.lifeNormalCoreCount !== player.lifeNormalCoreCount)
        overrides["life"] = previewPlayer.lifeNormalCoreCount;
    }
    // card diff
    const previewCards = new Map(
      previewState.cardInstances.map((c) => [c.instanceId, c])
    );
    for (const card of state.cardInstances) {
      const preview = previewCards.get(card.instanceId);
      if (!preview) continue;
      if (preview.normalCoreCount !== card.normalCoreCount)
        overrides[card.instanceId] = preview.normalCoreCount;
    }
  }
  // heldCores 反映: 掴み中の通常コアを source から減算する。既に override に値が
  // ある場合はそれを基点に、無い場合は現在 state を基点に 1 ずつ引く。
  if (heldCores.length > 0) {
    const viewingPlayerObj = state.players.find((p) => p.id === viewingPlayer);
    for (const entry of heldCores) {
      if (entry.kind !== "normal") continue;
      const key = coreContainerDisplayKey(entry.from, viewingPlayer);
      if (key === null) continue;
      const existing = overrides[key];
      let baseCount: number;
      if (existing !== undefined) {
        baseCount = existing;
      } else if (key === "reserve") {
        baseCount = viewingPlayerObj?.reserveNormalCoreCount ?? 0;
      } else if (key === "trash") {
        baseCount = viewingPlayerObj?.trashNormalCoreCount ?? 0;
      } else if (key === "life") {
        baseCount = viewingPlayerObj?.lifeNormalCoreCount ?? 0;
      } else {
        baseCount =
          state.cardInstances.find((c) => c.instanceId === key)
            ?.normalCoreCount ?? 0;
      }
      overrides[key] = Math.max(0, baseCount - 1);
    }
  }
  // 単一ソース trash_distribution で「コアすべてを置く」(全配置必須 =
  // minTotal === totalNormalCores、例: BSTH01-M01) の場合、効果発揮の時点で source
  // ゾーンの全通常コアを掴む扱いとし、配置進捗に依らず即 source を 0 相当へ減らす。
  const dist = pendingCoreDistribution;
  if (
    dist &&
    dist.fromKind !== "any_movable" &&
    dist.minTotal !== undefined &&
    dist.minTotal === dist.totalNormalCores
  ) {
    const sourceKey =
      dist.fromKind === "reserve" ||
      dist.fromKind === "trash" ||
      dist.fromKind === "life"
        ? dist.fromKind
        : null;
    if (sourceKey === null)
      return Object.keys(overrides).length > 0 ? overrides : undefined;
    const viewingPlayerObj = state.players.find((p) => p.id === viewingPlayer);
    const baseCount =
      sourceKey === "reserve"
        ? (viewingPlayerObj?.reserveNormalCoreCount ?? 0)
        : sourceKey === "trash"
          ? (viewingPlayerObj?.trashNormalCoreCount ?? 0)
          : (viewingPlayerObj?.lifeNormalCoreCount ?? 0);
    overrides[sourceKey] = Math.max(0, baseCount - dist.totalNormalCores);
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/**
 * ソウルコア表示数解決 (S4 段階、P3-101 §S4)。
 *
 * `computeSoulCoreDisplayOverrides` は、draft/held 差分で実数カウントが分かる場合は
 * number を返し、primary pointer の移動だけを示す古い経路では true/false を返す。
 * 本関数は両方を実カウント (`player.reserveSoulCoreCount` 等) に合成し、1 個前提の
 * 表示 (アイコン1枚固定) を廃止して実数表示にする。
 *
 * 単一ソウルの世界 (現行カードプールの主流) では override===true かつ
 * `hadPrimaryHere===false` の場合のみ +1、false かつ `hadPrimaryHere===true` の
 * 場合のみ -1 となり、旧 boolean 表示と完全に一致する (非回帰)。
 * 複数ソウル環境 (例: BSLH01-X05 の `generateSoulCoreOutsideGame` で2個目を生成) では
 * base count に正しく上乗せされる。
 */
export function resolveSoulCoreDisplayCount(
  baseCount: number,
  override: boolean | number | undefined,
  hadPrimaryHere: boolean
): number {
  if (typeof override === "number") return Math.max(0, override);
  if (override === true) return baseCount + (hadPrimaryHere ? 0 : 1);
  if (override === false)
    return Math.max(0, baseCount - (hadPrimaryHere ? 1 : 0));
  return baseCount;
}

export type SoulCoreDisplayOverride = boolean | number;

function getSoulCoreDisplayBaseCount(
  state: GameState,
  key: string,
  viewingPlayer: string
): number {
  const viewingPlayerObj = state.players.find((p) => p.id === viewingPlayer);
  if (key === "reserve") return viewingPlayerObj?.reserveSoulCoreCount ?? 0;
  if (key === "trash") return viewingPlayerObj?.trashSoulCoreCount ?? 0;
  if (key === "life") return viewingPlayerObj?.lifeSoulCoreCount ?? 0;
  return (
    state.cardInstances.find((c) => c.instanceId === key)?.soulCoreCount ?? 0
  );
}

/**
 * ソウルコア仮想表示オーバーライド (`instanceId` / "reserve" / "trash" / "life" →
 * number=表示数、または旧差分の true=+1 / false=-1)。
 *
 * 1. `previewState` と実 `state` の `soulCoreLocation` 差分 → 移動元 false / 移動先 true。
 * 2. `heldCores` (掴んだが未配置のソウルコア) の source 数を 1 ずつ減算。
 *    grab phase ではまだ draft 化されていないため previewState には乗らず、ここで消す。
 * 3. 単一ソース `trash_distribution` の `mustPlaceSoulCore` は発揮時点で source の
 *    ソウルを掴む扱いとして即時に数値減算する。
 *
 * 源種別 → キーの写像は `coreContainerDisplayKey` を共有 (normal producer と同一正源)。
 * reserve / trash / life / 自分 field カードの 4 ソース全対応 (通常コアと対称)。
 */
export function computeSoulCoreDisplayOverrides(params: {
  isActive: boolean;
  previewState: GameState;
  state: GameState;
  heldCores: readonly HeldCoreEntry[];
  viewingPlayer: string;
  pendingCoreDistribution: GameState["pendingCoreDistribution"];
}): Record<string, SoulCoreDisplayOverride> | undefined {
  const {
    isActive,
    previewState,
    state,
    heldCores,
    viewingPlayer,
    pendingCoreDistribution,
  } = params;
  if (!isActive) return undefined;
  const overrides: Record<string, SoulCoreDisplayOverride> = {};
  if (previewState !== state) {
    for (const player of state.players) {
      const previewPlayer = previewState.players.find(
        (p) => p.id === player.id
      );
      if (!previewPlayer) continue;
      if (player.id === viewingPlayer) {
        if (previewPlayer.reserveSoulCoreCount !== player.reserveSoulCoreCount)
          overrides["reserve"] = previewPlayer.reserveSoulCoreCount;
        if (previewPlayer.trashSoulCoreCount !== player.trashSoulCoreCount)
          overrides["trash"] = previewPlayer.trashSoulCoreCount;
        if (previewPlayer.lifeSoulCoreCount !== player.lifeSoulCoreCount)
          overrides["life"] = previewPlayer.lifeSoulCoreCount;
      }
      const realLoc = player.soulCoreLocation;
      const previewLoc = previewPlayer.soulCoreLocation;
      const realKey = soulLocationDisplayKey(realLoc, player.id, viewingPlayer);
      const previewKey = soulLocationDisplayKey(
        previewLoc,
        player.id,
        viewingPlayer
      );
      if (realKey === previewKey && realLoc?.kind === previewLoc?.kind)
        continue;
      // 移動元: false (元位置にソウル消去マーク)
      if (
        realKey !== null &&
        realKey !== previewKey &&
        overrides[realKey] === undefined
      )
        overrides[realKey] = false;
      // 移動先: true (新位置にソウル表示マーク)
      if (
        previewKey !== null &&
        previewKey !== realKey &&
        overrides[previewKey] === undefined
      )
        overrides[previewKey] = true;
    }
    const previewCards = new Map(
      previewState.cardInstances.map((c) => [c.instanceId, c])
    );
    for (const card of state.cardInstances) {
      const preview = previewCards.get(card.instanceId);
      if (!preview) continue;
      if (preview.soulCoreCount !== card.soulCoreCount) {
        overrides[card.instanceId] = preview.soulCoreCount;
      }
    }
  }
  // heldCores 反映: 掴み中のソウルコアを source から 1 ずつ減算する。
  // 既に数値 override があればそれを基点にし、無ければ現在 state を基点にする。
  for (const entry of heldCores) {
    if (entry.kind !== "soul") continue;
    const key = coreContainerDisplayKey(entry.from, viewingPlayer);
    if (key === null) continue;
    if (overrides[key] === true) continue;
    const base =
      typeof overrides[key] === "number"
        ? overrides[key]
        : getSoulCoreDisplayBaseCount(state, key, viewingPlayer);
    overrides[key] = Math.max(0, base - 1);
  }
  // 単一ソース trash_distribution でソウルコアも必ず配置する (mustPlaceSoulCore、
  // 例: BSTH01-M01「コアすべて」) 場合、トラッシュのソウルコアも効果発揮の時点で
  // 掴む扱いとし、トラッシュ表示から即消去マーク (false) する。
  const dist = pendingCoreDistribution;
  if (
    dist &&
    dist.fromKind !== "any_movable" &&
    dist.mustPlaceSoulCore === true &&
    dist.hasSoulCore
  ) {
    const sourceKey =
      dist.fromKind === "reserve" ||
      dist.fromKind === "trash" ||
      dist.fromKind === "life"
        ? dist.fromKind
        : null;
    if (sourceKey && overrides[sourceKey] !== true) {
      const base =
        typeof overrides[sourceKey] === "number"
          ? overrides[sourceKey]
          : getSoulCoreDisplayBaseCount(state, sourceKey, viewingPlayer);
      overrides[sourceKey] = Math.max(0, base - (dist.totalSoulCores ?? 1));
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
