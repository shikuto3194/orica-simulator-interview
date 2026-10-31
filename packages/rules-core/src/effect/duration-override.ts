// ============================================================
// Duration Override — 他効果の ContinuousEffect の持続期間 (duration.scope) を、
// 生成後も事後的に書き換えるメタ修飾 (ENGINE-continuous-effect-duration-rewrite)。
//
// カードテキスト例:
//   - 「相手のマジックの『このターンの間』を『次のバトル終了後まで』に変更する」
//     (BSLH01-X03 Lv2-3)
//
// `effect_param_override` (effect-param-override.ts) は他効果の DSL パラメータ
// (target.filter) を書き換えるが、`duration_override` は **既に生成された
// ContinuousEffect の duration そのもの** を、失効判定
// (removeExpiredContinuousEffects) の都度読み替える。対象 CE の生成順序
// (duration_override 登録の前/後どちらに作られたか) に依存しない。
// ============================================================

import type {
  ContinuousEffect,
  Duration,
  GameState,
  CardDefinition,
} from "../model";
import { matchesPlayerCardsScope } from "./effect-param-override";
import { isCEActiveForScope } from "../card/ce-lookup";

/**
 * duration_override CE の metadata 構造。
 * `ContinuousEffect.metadata` (Record<string, unknown>) に格納する。
 */
export interface DurationOverrideMetadata {
  /** 修飾対象になる ContinuousEffect の元 duration.scope。一致する CE のみ書き換える。 */
  fromScope: Duration["scope"];
  /** 書き換え後の duration。 */
  toDuration: Duration;
}

/**
 * CE の metadata から DurationOverrideMetadata を取り出す型ガード付きヘルパー。
 * 妥当でない CE は null を返す。
 */
export function getDurationOverrideMetadata(
  ce: ContinuousEffect
): DurationOverrideMetadata | null {
  if (ce.modifierTag !== "duration_override") return null;
  const raw = ce.metadata as Record<string, unknown> | undefined;
  if (!raw) return null;
  const fromScope = raw.fromScope;
  const toDuration = raw.toDuration;
  if (typeof fromScope !== "string") return null;
  if (typeof toDuration !== "object" || toDuration === null) return null;
  return {
    fromScope: fromScope as Duration["scope"],
    toDuration: toDuration as Duration,
  };
}

/**
 * `ce` の実効 duration を返す。アクティブな `duration_override` CE のうち、
 * `fromScope` が `ce.duration.scope` と一致し、`targetFilter` (player +
 * CardFilter) が `ce.sourceInstanceId` のカードに一致するものが 1 件でもあれば、
 * その `toDuration` を返す (複数一致時は先勝ち)。一致が無ければ `ce.duration` を
 * そのまま返す。
 *
 * `getCardDefinitionById` 省略時は override 判定をスキップし `ce.duration` を返す
 * (安全側)。
 */
export function getEffectiveDuration(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): Duration {
  if (!getCardDefinitionById) return ce.duration;
  if (state.activeContinuousEffects.length === 0) return ce.duration;

  for (const override of state.activeContinuousEffects) {
    if (override.modifierTag !== "duration_override") continue;
    const meta = getDurationOverrideMetadata(override);
    if (!meta) continue;
    if (meta.fromScope !== ce.duration.scope) continue;
    // timingScope (「自分のターン」等) は getGlobalCEs/getCEsForTarget 経由の消費でのみ
    // 自動フィルタされる (model.ts:ContinuousEffect.timingScope 参照)。ここは
    // state.activeContinuousEffects を直接走査するため明示チェックが必要。
    if (!isCEActiveForScope(override, state.step, state.activePlayerId)) {
      continue;
    }
    if (
      !matchesPlayerCardsScope(
        state,
        override,
        ce.sourceInstanceId,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    return meta.toDuration;
  }

  return ce.duration;
}
