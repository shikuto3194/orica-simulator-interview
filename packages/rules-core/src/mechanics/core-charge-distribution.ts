// SSOT: 「自分のフィールド/リザーブのコアを好きなだけ<対象>に置ける」型の任意コア配置。
// 元は legal/mechanic-trigger-handlers.ts に定義されていたが、effect/ 側 (DSL
// core_distribute の field_and_reserve_self) からも再利用するため mechanics/ へ移設した
// (effect/ が legal/ を import する逆方向依存を避けるため)。
import type {
  CardDefinition,
  CoreDistributionAllowedSource,
  GameState,
  PendingCoreDistribution,
  PlayerState,
} from "../model";
import {
  canMoveCoresFrom,
  canMoveNormalCoresFrom,
} from "../core/core-movability";
import { getCardById } from "../card/card-lookup";

let chargeCoresSequence = 0;

function getChargeZoneSoulCoreCount(player: PlayerState): number {
  const tracked = player.soulCoreLocation?.kind === "reserve" ? 1 : 0;
  return Math.max(player.reserveSoulCoreCount, tracked);
}

function getChargeCardSoulCoreCount(
  player: PlayerState,
  cardInstanceId: string,
  cardSoulCoreCount: number
): number {
  const tracked =
    player.soulCoreLocation?.kind === "card" &&
    player.soulCoreLocation.instanceId === cardInstanceId
      ? 1
      : 0;
  return Math.max(cardSoulCoreCount, tracked);
}

type ChargeCoreSources = Required<
  Pick<
    PendingCoreDistribution,
    | "allowedSources"
    | "sourceAvailable"
    | "soulSourceAvailable"
    | "totalNormalCores"
    | "totalSoulCores"
    | "hasSoulCore"
  >
>;

/** 新規pending生成と保存済み分離pending復元の供給元判定を共有する。 */
export function collectChargeCoreSources(
  state: GameState,
  actingPlayerId: string,
  targetInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceScope: "field_and_reserve" | "reserve_only" = "field_and_reserve"
): ChargeCoreSources {
  const player = state.players.find((p) => p.id === actingPlayerId);
  const allowedSources: CoreDistributionAllowedSource[] = [{ kind: "reserve" }];
  const sourceAvailable: Record<string, number> = {
    reserve: player?.reserveNormalCoreCount ?? 0,
  };
  const soulSourceAvailable: Record<string, number> = {};
  if (player) {
    const reserveSoul = getChargeZoneSoulCoreCount(player);
    if (reserveSoul > 0) soulSourceAvailable["reserve"] = reserveSoul;
  }
  if (sourceScope === "field_and_reserve") {
    for (const c of state.cardInstances) {
      if (c.zone !== "field") continue;
      if (c.controllerPlayerId !== actingPlayerId) continue;
      if (c.instanceId === targetInstanceId) continue;
      const cDef = getCardDefinitionById(c.definitionId);
      if (!cDef || !canMoveCoresFrom(state, c, cDef)) continue;
      const movableNormalCoreCount = canMoveNormalCoresFrom(state, c, cDef)
        ? c.normalCoreCount
        : 0;
      const soulCount = player
        ? getChargeCardSoulCoreCount(player, c.instanceId, c.soulCoreCount)
        : 0;
      if (movableNormalCoreCount > 0 || soulCount > 0) {
        allowedSources.push({ kind: "field", instanceId: c.instanceId });
      }
      if (movableNormalCoreCount > 0) {
        sourceAvailable[`field:${c.instanceId}`] = movableNormalCoreCount;
      }
      if (soulCount > 0) {
        soulSourceAvailable[`field:${c.instanceId}`] = soulCount;
      }
    }
  }
  const totalNormalCores = Object.values(sourceAvailable).reduce(
    (a, b) => a + b,
    0
  );
  const totalSoulCores = Object.values(soulSourceAvailable).reduce(
    (sum, n) => sum + Math.max(0, n),
    0
  );
  return {
    allowedSources,
    sourceAvailable,
    soulSourceAvailable,
    totalNormalCores,
    totalSoulCores,
    hasSoulCore: totalSoulCores > 0,
  };
}

/**
 * 旧保存状態には、分離元の待機コアを除外した供給元一覧が残る。
 * 分離元を煌臨元へ畳む転醒は場/リザーブ供給なので、現盤面で再計算する。
 * pendingId・配置先・継続処理・取消用snapshot・面/コアの実状態は保持する。
 */
export function refreshPendingRebirthSeparationCoreSources(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingCoreDistribution;
  const action = pending?.rebirthCompletion?.deferredAction;
  if (
    !pending ||
    pending.fromKind !== "any_movable" ||
    !action?.separatesFromHost ||
    !action.foldCombinedPartnerToAdventSource
  )
    return state;
  const sources = collectChargeCoreSources(
    state,
    pending.fromPlayerId,
    pending.sourceInstanceId,
    getCardDefinitionById
  );
  const unchanged = (Object.keys(sources) as (keyof ChargeCoreSources)[]).every(
    (key) => JSON.stringify(pending[key]) === JSON.stringify(sources[key])
  );
  return unchanged
    ? state
    : { ...state, pendingCoreDistribution: { ...pending, ...sources } };
}

/**
 * 「自分のフィールド/リザーブのコアを好きなだけ <対象> に置ける」型の任意コア配置を
 * `pendingCoreDistribution` (fromKind:"any_movable") として生成する SSOT ヘルパー。
 *
 * 用途 (10_rules 正源):
 * - 創界石転醒 postRebirth="charge_cores_from_field_reserve" (08a §創界石転醒)
 * - 契約煌臨で魂状態へ煌臨したとき (08a:180「魂状態に煌臨した場合、フィールド/リザーブから
 *   コアを好きなだけ置ける」)
 * - chargeCoresOnAdvent 印字の煌臨 (BSAZ01「このとき、煌臨するカードにフィールド/リザーブの
 *   コアを好きなだけ置く」)
 * - BSGE01【リンクエイド】(P3-111 S6): `sourceScope:"reserve_only"` でリザーブ限定
 *   （10_rules/07b §リンクエイド、CX01/R01〜R05 は文末が「リザーブのコア」限定）。
 * - BSFT01 TR系【転醒】許可窓「合体させるか裏返す」直後の任意コア配置
 *   (`DSL.CoreLocation.field_and_reserve_self` 経由、bsft01-tr-rebirth-permission-window)。
 *
 * ソース: リザーブ + 自分フィールドの移動可能カード（対象カード自身は除外）。
 * 03f: 離脱待機中のカードも実移動前の残存コアを供給できる。
 * `sourceScope:"reserve_only"`（既定は`"field_and_reserve"`）指定時はフィールド候補を含めない。
 * 通常コアは `sourceAvailable`、ソウルコアは `soulSourceAvailable` の別枠で表す。
 * 配置先は単一 (targetInstanceId)。配置可能コアが 0 のときは null を返す（pending を立てない）。
 */
export function buildChargeCoresPendingCoreDistribution(
  state: GameState,
  actingPlayerId: string,
  targetInstanceId: string,
  beforeDefinitionId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  pendingIdPrefix: string,
  options?: {
    sourceScope?: "field_and_reserve" | "reserve_only";
    minTotal?: number;
    candidateDefinitionId?: string;
  }
): PendingCoreDistribution | null {
  const {
    allowedSources,
    sourceAvailable,
    soulSourceAvailable,
    totalNormalCores,
    totalSoulCores,
  } = collectChargeCoreSources(
    state,
    actingPlayerId,
    targetInstanceId,
    getCardDefinitionById,
    options?.sourceScope
  );
  const soulInMovableZone = totalSoulCores > 0;
  const placeableTotal = totalNormalCores + totalSoulCores;
  const minTotal = options?.minTotal ?? 0;
  if (placeableTotal <= 0 || placeableTotal < minTotal) return null;
  return {
    pendingId: `${pendingIdPrefix}-${chargeCoresSequence++}`,
    actingPlayerId,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: beforeDefinitionId,
    candidates: [
      {
        instanceId: targetInstanceId,
        definitionId:
          options?.candidateDefinitionId ??
          getCardById(state, targetInstanceId)?.definitionId ??
          beforeDefinitionId,
      },
    ],
    totalNormalCores,
    hasSoulCore: soulInMovableZone,
    ...(soulInMovableZone ? { totalSoulCores } : {}),
    fromKind: "any_movable",
    allowedSources,
    sourceAvailable,
    ...(soulInMovableZone ? { soulSourceAvailable } : {}),
    ...(minTotal > 0 ? { minTotal } : {}),
    fromPlayerId: actingPlayerId,
    toPlayerId: actingPlayerId,
    effectTiming: { kind: "continuous" },
  };
}
