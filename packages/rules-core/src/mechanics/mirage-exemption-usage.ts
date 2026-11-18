/**
 * ミラージュの「セット可能枚数に数えない」効果の使用枠 (P3-170 I08)。
 *
 * 通常セットの行動枠 (`mirageSetPlayerIdsThisTurn` / `burstSetPlayerIdsThisTurn`) はゲームルール上の
 * 制限であり、ここでは扱わない。ここで管理するのは、効果(`mirageData.exemptSetCountLimits`)に
 * 〔ターンに1回:同名〕が付く「通常セット回数の免除」の使用枠だけで、専用の使用済み配列を持たず
 * 共通の使用枠 (`state.effectAccounting`) へ記録する。
 *
 * - 共有: 使用者(プレイヤー) × 同名(cardNo) × ターン (10_rules/08c 主要裁定、2026-10-24)。
 * - 判定は宣言時、記録は解決時 (`resolveSetMiragePlacement`)。無効化・出所消失・宣言取消は記録前なので消費しない。
 * - 公開投影 (AI観測) の免除使用状況は、この枠から導出する (`listUsedMirageSetCountExemptions`)。
 */

import {
  describeUsageBucket,
  isBucketLive,
  makeAbilityRef,
  normalizeUsageLimits,
} from "../effect-usage";
import {
  usageClockOf,
  type UsageSite,
} from "../effect/effect-usage-accounting";
import {
  canUseEffectUsage,
  consumeEffectUsage,
} from "../legal/legal-actions-shared";
import type { EffectUsageLimit, GameState } from "../model";

/** 免除する能力の構造path (mirageData の属性。Effect エントリではない)。 */
const MIRAGE_EXEMPTION_PATH = "mirageData.exemptSetCountLimits";

/** 〔ターンに1回:同名〕。同名はプレイヤーごとに数える。 */
const ONCE_PER_TURN_SAME_NAME: EffectUsageLimit = {
  kind: "per_card_name",
  duration: "turn",
  maxCount: 1,
};

export interface MirageSetCountExemptionArgs {
  state: GameState;
  /** 免除を使うプレイヤー(使用者)。 */
  playerId: string;
  /** 免除する能力を持つミラージュカードの cardNo (同名共有キー)。 */
  cardNo: string;
  /** 実際にセットするカード個体。同名共有の枠には影響しない(診断用)。 */
  sourceInstanceId?: string;
}

function mirageSetCountExemptionSite(
  args: MirageSetCountExemptionArgs
): UsageSite {
  const ability = makeAbilityRef("gimmick", args.cardNo, MIRAGE_EXEMPTION_PATH);
  return {
    state: args.state,
    ability,
    sourceInstanceId: args.sourceInstanceId ?? "",
    sourceDefinitionId: args.cardNo,
    playerId: args.playerId,
    nameKey: args.cardNo,
    constraints: normalizeUsageLimits({
      abilityRef: ability,
      limits: ONCE_PER_TURN_SAME_NAME,
      // 判定は宣言時でも、記録は解決時(適用点)に行う。
      commitPoint: "application",
    }),
  };
}

/**
 * 旧版 (cardNo を持たなかった版) の「プレイヤー単位の免除使用済み」を表す互換キー。
 * 旧形式の保存データを変換する migration (effect-usage/migration.ts) だけが記録し、新規の対戦では
 * 記録しない。同名情報が無いので特定のカード名には捏造せず、記録されたターンの終了まで全同名に対して
 * 使用済みとして扱う (ターンの期間は通常の免除枠と同じ時計で終わる)。
 */
export const LEGACY_PLAYER_WIDE_MIRAGE_EXEMPTION = "*";

/** このターン、このプレイヤーが当該ミラージュの免除を使用済みか。状態は変更しない。 */
export function hasUsedMirageSetCountExemption(
  args: MirageSetCountExemptionArgs
): boolean {
  return (
    !canUseEffectUsage(mirageSetCountExemptionSite(args)) ||
    !canUseEffectUsage(
      mirageSetCountExemptionSite({
        ...args,
        cardNo: LEGACY_PLAYER_WIDE_MIRAGE_EXEMPTION,
      })
    )
  );
}

/**
 * 免除の使用を記録する。既に使用済みなら状態を変更しない(同じ枠を二重に数えない)。
 * 取消は不要な呼出点(解決時の記録)なので receipt は保持しない。
 */
export function consumeMirageSetCountExemption(
  args: MirageSetCountExemptionArgs
): GameState {
  return consumeEffectUsage(mirageSetCountExemptionSite(args)).state;
}

export interface UsedMirageSetCountExemption {
  playerId: string;
  cardNo: string;
}

/**
 * 現在のターンで使用済みの免除を、公開投影用に列挙する(AI観測の `mirageCountExemptionCardNos`)。
 * 使用状況を別配列へ複製せず、共通の使用枠から導出する。中断中の追加ターン前の枠は含めない。
 */
export function listUsedMirageSetCountExemptions(
  state: GameState
): UsedMirageSetCountExemption[] {
  const live = [usageClockOf(state)];
  const used: UsedMirageSetCountExemption[] = [];
  for (const bucket of state.effectAccounting.buckets) {
    if (bucket.measure !== "use" || bucket.amount <= 0) continue;
    if (!isBucketLive(bucket, live)) continue;
    const described = describeUsageBucket(bucket);
    if (
      described?.ability?.kind !== "gimmick" ||
      described.ability.path !== MIRAGE_EXEMPTION_PATH ||
      described.share !== "card_name" ||
      described.period !== "turn" ||
      described.nameKey === undefined
    ) {
      continue;
    }
    used.push({ playerId: described.playerId, cardNo: described.nameKey });
  }
  return used;
}
