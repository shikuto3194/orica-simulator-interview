/**
 * ミラージュのセット回数免除の使用枠 (P3-170 I08) のテスト用 fixture。
 *
 * 免除の使用は `mechanics/mirage-exemption-usage.ts` が共通の使用枠 (`state.effectAccounting`) へ
 * 「同名(cardNo) × 使用者 × ターン」で記録する。旧 `mirageSetCountExemptionsUsed`
 * (`{ playerId, cardNo }[]`) の読み書き相当をここへ集約する。通常セットの行動枠
 * (`mirageSetPlayerIdsThisTurn` / `burstSetPlayerIdsThisTurn`) は別物でここでは扱わない。
 *
 * 本番の使用枠APIを直接 import せず、`effect-usage-fixture.ts` と同様に fixture 経由で使う。
 * 読み取りは台帳の bucket を直接列挙する(公開投影の導出 listUsedMirageSetCountExemptions とは独立)。
 */
import { describeUsageBucket } from "../../src/effect-usage";
import { consumeMirageSetCountExemption } from "../../src/mechanics/mirage-exemption-usage";
import type { GameState } from "../../src";
import { listEffectUsage } from "./effect-usage-fixture";

/** 免除する能力の構造path (mirageData の属性)。 */
const MIRAGE_EXEMPTION_PATH = "mirageData.exemptSetCountLimits";

export interface MirageSetCountExemptionEntry {
  playerId: string;
  cardNo: string;
}

/** 台帳に残っている免除の使用済みを列挙する (旧配列の読み取り相当)。期限切れで整理済みの枠は含まない。 */
export function listMirageSetCountExemptionsUsed(
  state: GameState
): MirageSetCountExemptionEntry[] {
  return listEffectUsage(state)
    .filter((entry) => entry.label === MIRAGE_EXEMPTION_PATH)
    .map((entry) => ({
      playerId: entry.playerId,
      cardNo: entry.nameKey ?? "",
    }));
}

/** 現在の時計で、免除が使用済みの状態にする (実際に免除を使って解決した後と同じ枠を作る)。 */
export function seedMirageSetCountExemptionUsed(
  state: GameState,
  entry: MirageSetCountExemptionEntry
): GameState {
  return consumeMirageSetCountExemption({ state, ...entry });
}

/** 免除の使用済みだけを外す (旧 `mirageSetCountExemptionsUsed = []` 相当)。他の使用枠は残す。 */
export function withoutMirageSetCountExemptionUsage(
  state: GameState
): GameState {
  const buckets = state.effectAccounting.buckets.filter((bucket) => {
    const described = describeUsageBucket(bucket);
    return described?.ability?.path !== MIRAGE_EXEMPTION_PATH;
  });
  return {
    ...state,
    effectAccounting: { ...state.effectAccounting, buckets },
  };
}
