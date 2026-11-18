/**
 * 神託/導託の回数制限 (P3-170 I09) のテスト用 fixture。
 *
 * 召喚/煌臨での神託(`oracleTriggerUsageLimit`)と配置時神託(`placementOracle.usageLimit`)は、
 * `mechanics/oracle-usage.ts` が共通の使用枠 (`state.effectAccounting`) へ記録する。
 * 旧 `effectLabel: "oracle:summon_advent"` / `"placement_oracle"` の読み書き相当をここへ集約する。
 *
 * 本番の使用枠APIを直接 import せず、fixture 経由で使う。枠の同定は本番の oracle-usage の枠定義に従う。
 */
import {
  oracleTriggerUsageSite,
  placementOracleUsageSite,
} from "../../src/mechanics/oracle-usage";
import {
  canUseEffectUsage,
  consumeEffectUsage,
  queryEffectUsage,
} from "../../src/legal/legal-actions-shared";
import type { CardDefinition, GameState, OracleTriggerKind } from "../../src";
import type { UsageSite } from "../../src/effect/effect-usage-accounting";

type GetDef = (id: string) => CardDefinition | undefined;

export interface OracleUsageStatus {
  limit: number;
  used: number;
  remaining: number;
  /** いま神託を行えるか (全制限を通過するか)。 */
  allowed: boolean;
}

function siteOf(
  state: GameState,
  grandwalkerInstanceId: string,
  getDef: GetDef,
  kind: "placement" | { trigger: OracleTriggerKind }
): UsageSite | undefined {
  const grandwalker = state.cardInstances.find(
    (card) => card.instanceId === grandwalkerInstanceId
  );
  const definition = grandwalker && getDef(grandwalker.definitionId);
  if (!grandwalker || !definition) {
    throw new Error(
      `oracle-usage fixture: 創界神を特定できません (${grandwalkerInstanceId})`
    );
  }
  const args = {
    state,
    grandwalker,
    definition,
    playerId: grandwalker.controllerPlayerId,
    getCardDefinitionById: getDef,
  };
  return kind === "placement"
    ? placementOracleUsageSite(args)
    : oracleTriggerUsageSite({ ...args, triggerKind: kind.trigger });
}

function statusOf(site: UsageSite | undefined): OracleUsageStatus | undefined {
  if (!site) return undefined;
  const query = queryEffectUsage(site);
  const entry = query.entries[0];
  return entry
    ? {
        limit: entry.limit,
        used: entry.used,
        remaining: entry.remaining,
        allowed: query.allowed,
      }
    : undefined;
}

/** 配置時神託の使用状況。回数制限が無い創界神は undefined。状態は変更しない。 */
export function placementOracleUsage(
  state: GameState,
  grandwalkerInstanceId: string,
  getDef: GetDef
): OracleUsageStatus | undefined {
  return statusOf(siteOf(state, grandwalkerInstanceId, getDef, "placement"));
}

/** 召喚/煌臨での神託の使用状況。回数制限が無い(または対象外のトリガー)なら undefined。 */
export function oracleTriggerUsage(
  state: GameState,
  grandwalkerInstanceId: string,
  triggerKind: OracleTriggerKind,
  getDef: GetDef
): OracleUsageStatus | undefined {
  return statusOf(
    siteOf(state, grandwalkerInstanceId, getDef, { trigger: triggerKind })
  );
}

/** 配置時神託を1回行った後と同じ枠にする。 */
export function seedPlacementOracleUsage(
  state: GameState,
  grandwalkerInstanceId: string,
  getDef: GetDef
): GameState {
  const site = siteOf(state, grandwalkerInstanceId, getDef, "placement");
  return site ? consumeEffectUsage(site).state : state;
}

/** 召喚/煌臨での神託を1回行った後と同じ枠にする。 */
export function seedOracleTriggerUsage(
  state: GameState,
  grandwalkerInstanceId: string,
  triggerKind: OracleTriggerKind,
  getDef: GetDef
): GameState {
  const site = siteOf(state, grandwalkerInstanceId, getDef, {
    trigger: triggerKind,
  });
  return site ? consumeEffectUsage(site).state : state;
}

/** その神託がいま使用枠の上で行えるか (制限が無ければ true)。 */
export function canUseOracleTriggerUsage(
  state: GameState,
  grandwalkerInstanceId: string,
  triggerKind: OracleTriggerKind,
  getDef: GetDef
): boolean {
  const site = siteOf(state, grandwalkerInstanceId, getDef, {
    trigger: triggerKind,
  });
  return site === undefined || canUseEffectUsage(site);
}
