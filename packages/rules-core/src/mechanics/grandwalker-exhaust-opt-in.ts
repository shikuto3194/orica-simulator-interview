// engine-grandwalker-nexus-self-exhaust-flag: BSTH05.5-C20「自分の効果で、導界者ネクサス
// として疲労させることができる」型の opt-in 判定。
//
// isGrandwalkerOrGuidedNexus (model.ts) は grandwalkerData の静的定義値のみを見る 12 箇所超の
// 公開 SSOT 述語で、通常のターゲティング除外 (card-filter.ts の既定 grandwalker 除外) もこれに
// 依存する。この opt-in はそれを拡張せず、`CardFilter.targetsGrandwalker:"only"` +
// `includesGrandwalkerExhaustOptIn:true` を明示的に立てた消費側フィルタでのみ有効な
// 局所的な bypass として card-filter.ts から呼び出す。
//
// 「自分の効果で」= このカードを opt-in させた継続効果 (override_properties CE) の
// actingPlayerId と、いま判定を要求している actingPlayerId が一致するときのみ有効。

import { getCEsForTarget } from "../card/ce-lookup";
import type { ContinuousEffect } from "../model";

interface HasActiveCEs {
  readonly activeContinuousEffects: readonly ContinuousEffect[];
}

/**
 * 対象カードが、`actingPlayerId` の効果に限り「導界者ネクサス」として扱われる opt-in
 * (override_properties.properties.actsAsGuidedNexusForOwnExhaustEffects) を持つかを判定する。
 */
export function hasGrandwalkerExhaustOptIn(
  state: HasActiveCEs,
  targetInstanceId: string,
  actingPlayerId: string
): boolean {
  const ces = getCEsForTarget(state, targetInstanceId);
  return ces.some((ce) => {
    if (ce.modifierTag !== "override_properties") return false;
    if (ce.actingPlayerId !== actingPlayerId) return false;
    const props = ce.metadata?.properties as
      | Record<string, unknown>
      | undefined;
    return props?.actsAsGuidedNexusForOwnExhaustEffects === true;
  });
}
