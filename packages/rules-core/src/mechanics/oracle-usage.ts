/**
 * 神託/導託の回数制限(P3-170 I09)。専用の制限型を持たず、カード定義の共通の制限型
 * (`EffectUsageLimit`) を正規化し、共通の使用枠 (`state.effectAccounting`) で管理する。
 *
 * - 召喚/煌臨での神託: `grandwalkerData.oracleTriggerUsageLimit`(BSLH01-X01〔ステップに1回〕)。
 *   発揮元の創界神/導界者の個体ごと。受諾して実際に神託を行ったときに記録する(辞退では記録しない)。
 * - 配置時神託: `grandwalkerData.placementOracle.usageLimit`(BSES01-CX01 / BSTH02.7-CX01〔ターンに1回:同名〕)。
 *   通常配置と復活配置で同じ枠を共有する。デッキ上のカードをトラッシュへ置く解決時に記録する。
 *
 * 候補の列挙・辞退では消費しない。未解決の候補が既にある間に新しい候補を積まない「予約」は、
 * 実際の保留処理(pendingTriggeredEffects / スタック)から導出し、使用枠には書かない
 * (oracle-system.ts の hasReserved*OraclePending)。
 */

import {
  abilityFingerprint,
  makeAbilityRef,
  sharedNameAbilityRef,
} from "../effect-usage";
import type { UsageSite } from "../effect/effect-usage-accounting";
import type {
  CardDefinition,
  CardInstance,
  EffectUsageLimit,
  GameState,
  GrandwalkerData,
  OracleTriggerKind,
} from "../model";

type OracleUsageLimits = EffectUsageLimit | EffectUsageLimit[];

/** 召喚/煌臨の通常神託にだけ適用される制限。配置・使用など他のイベントには適用しない。 */
function oracleTriggerLimitsFor(
  data: GrandwalkerData,
  triggerKind: OracleTriggerKind
): OracleUsageLimits | undefined {
  return triggerKind === "summon" || triggerKind === "advent"
    ? data.oracleTriggerUsageLimit
    : undefined;
}

export interface OracleUsageArgs {
  state: GameState;
  /** 発揮元の創界神/導界者ネクサス。 */
  grandwalker: CardInstance;
  definition: CardDefinition;
  /** 神託を行うプレイヤー(使用者)。 */
  playerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}

/**
 * 召喚/煌臨での神託の使用枠。制限が無い(または対象外のトリガー)なら undefined。
 * 枠は発揮元の個体ごと(per_instance)で、能力は定義のこの神託そのもの。
 */
export function oracleTriggerUsageSite(
  args: OracleUsageArgs & { triggerKind: OracleTriggerKind }
): UsageSite | undefined {
  const data = args.definition.grandwalkerData;
  const limits = data && oracleTriggerLimitsFor(data, args.triggerKind);
  if (!limits) return undefined;
  return {
    state: args.state,
    ability: makeAbilityRef(
      "oracle",
      args.grandwalker.definitionId,
      "grandwalkerData.oracleTriggerUsageLimit"
    ),
    sourceInstanceId: args.grandwalker.instanceId,
    sourceDefinitionId: args.grandwalker.definitionId,
    playerId: args.playerId,
    limits,
    getCardDefinitionById: args.getCardDefinitionById,
  };
}

const placementFingerprintCache = new WeakMap<GrandwalkerData, string>();

/** 配置時神託そのものの内容(設定と対象条件)の指紋。同名でも内容が違えば別の枠にする。 */
function placementOracleFingerprint(data: GrandwalkerData): string {
  let cached = placementFingerprintCache.get(data);
  if (cached === undefined) {
    cached = abilityFingerprint({
      placementOracle: data.placementOracle,
      oracleConditions: data.oracleConditions,
      placementOracleReturnToHand: data.placementOracleReturnToHand,
    });
    placementFingerprintCache.set(data, cached);
  }
  return cached;
}

/**
 * 配置時神託の使用枠。制限が無いなら undefined。同名(printed name)かつ同じ内容の配置時神託は、
 * 使用者ごとに枠を共有する(〔ターンに1回:同名〕)。
 */
export function placementOracleUsageSite(
  args: OracleUsageArgs
): UsageSite | undefined {
  const data = args.definition.grandwalkerData;
  const placementOracle =
    data?.placementOracle && typeof data.placementOracle === "object"
      ? data.placementOracle
      : undefined;
  const limits = placementOracle?.usageLimit;
  if (!data || !limits) return undefined;
  return {
    state: args.state,
    ability: makeAbilityRef(
      "oracle",
      args.grandwalker.definitionId,
      "grandwalkerData.placementOracle"
    ),
    nameAbility: sharedNameAbilityRef(
      args.definition.name,
      placementOracleFingerprint(data)
    ),
    sourceInstanceId: args.grandwalker.instanceId,
    sourceDefinitionId: args.grandwalker.definitionId,
    playerId: args.playerId,
    nameKey: args.definition.name,
    limits,
    getCardDefinitionById: args.getCardDefinitionById,
  };
}
