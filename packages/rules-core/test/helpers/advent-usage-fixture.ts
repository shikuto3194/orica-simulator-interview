/**
 * 煌臨の回数枠 (P3-170 I02〜I04) のテスト用 fixture。
 *
 * 煌臨の枠は `mechanics/advent-usage.ts` が共通の使用枠 (`state.effectAccounting`) へ
 * 「同名共有 (card_name) × 使用者 × ターン」で記録する。旧 `usedTrashAdventKeysThisTurn` /
 * `usedAlternateCostAdventKeysThisTurn` / `usedAdventDeclareKeysThisTurn` (プレイヤー無しの
 * `name:{名前}` 配列) の読み書き相当をここへ集約する。
 *
 * 本番の使用枠APIを直接 import せず、`effect-usage-fixture.ts` と同様に fixture 経由で使う。
 * 煌臨は種別 (declare / alternate_cost / trash_host / trash_source) を能力指紋に畳み込むため、
 * 種別の復元は指紋の照合で行う。
 */
import { abilityFingerprint } from "../../src/effect-usage";
import {
  canUseAdventUsage,
  consumeAdventUsage,
  type AdventUsageKind,
} from "../../src/mechanics/advent-usage";
import type { CardDefinition, GameState } from "../../src";
import { listEffectUsage } from "./effect-usage-fixture";

export type { AdventUsageKind };

const KINDS: readonly AdventUsageKind[] = [
  "declare",
  "alternate_cost",
  "trash_host",
  "trash_source",
];

function labelOf(kind: AdventUsageKind): string {
  return `fp:${abilityFingerprint({ adventUsage: kind })}`;
}

export interface AdventUsageEntry {
  kind: AdventUsageKind;
  /** 常に "card_name" (同名共有)。 */
  share: string;
  /** 常に "turn"。 */
  period: string;
  /** 使用者 (煌臨を行ったプレイヤー)。 */
  playerId: string;
  amount: number;
  /** 共有キー (枠の主体 = 許可元 / 煌臨カードの printed name)。 */
  nameKey: string;
  periodId: string;
}

/** 現在の煌臨枠を列挙する (旧3配列の読み取り相当)。`kind` を渡すとその種別だけ。 */
export function listAdventUsage(
  state: GameState,
  kind?: AdventUsageKind
): AdventUsageEntry[] {
  const entries: AdventUsageEntry[] = [];
  for (const entry of listEffectUsage(state)) {
    const found = KINDS.find((k) => labelOf(k) === entry.label);
    if (found === undefined) continue;
    if (kind !== undefined && found !== kind) continue;
    entries.push({
      kind: found,
      share: entry.share,
      period: entry.period,
      playerId: entry.playerId,
      amount: entry.amount,
      nameKey: entry.nameKey ?? "",
      periodId: entry.periodId,
    });
  }
  return entries;
}

export interface AdventUsageSeedOptions {
  kind: AdventUsageKind;
  /** 煌臨を行うプレイヤー (使用者)。 */
  actingPlayerId: string;
  /** 枠の主体となる個体 (許可元 / 煌臨元)。 */
  instanceId: string;
  /** 枠の主体となる定義 (許可元が別にあるときは許可元)。 */
  definition: CardDefinition;
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}

/** 実際に煌臨が成立した後と同じ枠を作る (本番の消費関数 consumeAdventUsage を使う)。 */
export function seedAdventUsage(
  state: GameState,
  options: AdventUsageSeedOptions
): GameState {
  return consumeAdventUsage({ state, ...options });
}

/** 枠がいま使用可能か。状態は変更しない。 */
export function canUseAdventUsageForTest(
  state: GameState,
  options: AdventUsageSeedOptions
): boolean {
  return canUseAdventUsage({ state, ...options });
}

/**
 * 煌臨の枠だけを外す (旧 `usedXxxAdventKeysThisTurn: []` 相当)。他の効果の使用枠は残す。
 * `kind` を渡すとその種別だけ外す。
 */
export function withoutAdventUsage(
  state: GameState,
  kind?: AdventUsageKind
): GameState {
  const targets = (kind === undefined ? KINDS : [kind]).map(labelOf);
  const buckets = state.effectAccounting.buckets.filter(
    (bucket) => !targets.some((label) => bucket.constraintId.includes(label))
  );
  return {
    ...state,
    effectAccounting: {
      ...state.effectAccounting,
      buckets,
    },
  };
}
