// engine-oracle-ultimate-trigger-opt-in: BSTH05.5-C20「アルティメットカード/アルティメット
// として【導託】できる」型の opt-in 判定。
//
// getEffectiveCategory (act-as-spirit.ts) は legal-action / battle / 対象選択等 全般に効く
// グローバルな実効 category SSOT で、ここを "ultimate" に置換すると対象カードが
// アルティメットとして戦闘参加できてしまう等、印字カテゴリの意味を広く書き換えてしまう。
// この opt-in はそれを拡張せず、`OracleCondition.categories` の判定（神託/導託トリガー検出、
// oracle-system.ts の matchesOracleCondition）でのみ「ultimate」にも一致する局所的な
// bypass として提供する（grandwalker-exhaust-opt-in.ts と同型の設計）。

import { getCEsForTarget } from "../card/ce-lookup";
import type { ContinuousEffect } from "../model";

interface HasActiveCEs {
  readonly activeContinuousEffects: readonly ContinuousEffect[];
}

/**
 * 対象カードが「アルティメットカード/アルティメットとして神託/導託トリガーに参加できる」
 * opt-in (override_properties.properties.actsAsUltimateForOracleTrigger) を持つかを判定する。
 * BSTH05.5-C20 本体の効果には「自分の効果で」等のプレイヤー限定が無いため、
 * actingPlayerId による絞り込みは行わない。
 */
export function hasOracleUltimateOptIn(
  state: HasActiveCEs,
  targetInstanceId: string
): boolean {
  const ces = getCEsForTarget(state, targetInstanceId);
  return ces.some((ce) => {
    if (ce.modifierTag !== "override_properties") return false;
    const props = ce.metadata?.properties as
      | Record<string, unknown>
      | undefined;
    return props?.actsAsUltimateForOracleTrigger === true;
  });
}
