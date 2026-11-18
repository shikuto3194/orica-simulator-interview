import {
  buildUsageConstraint,
  describeUsageBucket,
  makeAbilityRef,
} from "../effect-usage";
import type { UsageBucket } from "../effect-usage";
import {
  consumeUsageOnState,
  queryUsageOnState,
} from "./effect-usage-accounting";
import type { UsageSite } from "./effect-usage-accounting";
import type { EffectUsageLimitDuration, GameState } from "../model";

/**
 * 「ターンに/ゲーム中にN回目の観測でのみ発火する」型 (BSLH01-C05/R03 quartz set-effect 等)
 * の観測 tally (P3-170 I15)。
 *
 * 共通の使用会計の **観測 (measure="observation")** として記録する。観測は、トリガー条件の
 * 検出成功のたび (発動可否に関わらず) 無条件で加算し、上限で止めない。効果の発動回数
 * (measure="use"、`usageLimit`) とは別の枠で、同じ出来事を二重に保存しない。
 * 期間 (turn / game / step / battle) の判断は使用会計の時計だけが行う (機構別のリセットを持たない)。
 *
 * 識別: 効果帰属の個体 (sourceInstanceId) × (groupId があれば共有 tally グループ、無ければ効果ラベル)。
 * groupId 指定時は effectLabel ではなく groupId で合算する (同一個体の複数 effect エントリで共有)。
 *
 * 正源: ENGINE-nth-occurrence-trigger-gate。trigger-system.ts の queueReactionsInternal から
 * 呼び出され (tally 加算 + ゲート判定)、BSLH01-C05/R03 の quartz set-effect
 * (card-data BSLH01.ts occurrenceGate フィールド) から参照される。
 */

export interface RecordEffectOccurrenceOptions {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectLabel: string;
  duration: EffectUsageLimitDuration;
  /**
   * 共有 tally グループ ID (`EffectOccurrenceGate.groupId` と同型)。設定時は
   * effectLabel ではなく groupId で合算する。
   */
  groupId?: string;
  /**
   * 観測を行うプレイヤー (診断用。tally の識別には使わない)。省略時は効果帰属の個体の
   * コントローラーから導く。
   */
  playerId?: string;
}

/** 観測 tally の共有 group 名の接頭辞 (使用回数の group 共有枠と衝突させない)。 */
const OCCURRENCE_GROUP_PREFIX = "occurrence:";
/** 観測 tally の能力参照が持つ定義キー (個体で識別するため定義IDは使わない)。 */
const OCCURRENCE_DEFINITION_KEY = "effect-occurrence";
/** 効果ラベル単位の観測 tally の path 接尾辞 (同じ効果の使用回数の枠と衝突させない)。 */
const OCCURRENCE_PATH_SUFFIX = "/occurrence";

function occurrenceSite(params: RecordEffectOccurrenceOptions): UsageSite {
  // 識別は効果帰属の個体 (share="instance") と効果ラベルで決まる。定義IDは個体から一意に
  // 定まるため能力参照には含めず、読み取り側が定義IDを知らなくても同じ枠を指せる。
  const ability = makeAbilityRef(
    "effect",
    OCCURRENCE_DEFINITION_KEY,
    `${params.effectLabel}${OCCURRENCE_PATH_SUFFIX}`
  );
  return {
    state: params.state,
    ability,
    sourceInstanceId: params.sourceInstanceId,
    sourceDefinitionId: params.sourceDefinitionId,
    ...(params.playerId !== undefined ? { playerId: params.playerId } : {}),
    constraints: [
      buildUsageConstraint({
        abilityRef: ability,
        share: "instance",
        period: params.duration,
        measure: "observation",
        ...(params.groupId !== undefined
          ? { groupId: `${OCCURRENCE_GROUP_PREFIX}${params.groupId}` }
          : {}),
        commitPoint: "application",
      }),
    ],
  };
}

const resolveUnbounded = (): number => Number.MAX_SAFE_INTEGER;

/**
 * 現在の期間における観測 tally を 1 加算した状態を返す (純関数、入力 state は変更しない)。
 * 観測は取消の対象 (宣言中の観測は宣言取消で戻る) なので receipt を残す。
 */
export function recordEffectOccurrence(
  options: RecordEffectOccurrenceOptions
): GameState {
  return consumeUsageOnState(occurrenceSite(options), resolveUnbounded).state;
}

/**
 * 現在の期間における観測 tally を読み取り専用で取得する。無ければ 0。
 */
export function getEffectOccurrenceCount(
  state: GameState,
  params: {
    sourceInstanceId: string;
    sourceDefinitionId?: string;
    effectLabel: string;
    duration: EffectUsageLimitDuration;
    groupId?: string;
    playerId?: string;
  }
): number {
  const sourceDefinitionId =
    params.sourceDefinitionId ??
    state.cardInstances.find((c) => c.instanceId === params.sourceInstanceId)
      ?.definitionId ??
    "";
  return queryUsageOnState(
    occurrenceSite({ ...params, state, sourceDefinitionId }),
    resolveUnbounded
  ).entries.reduce((sum, entry) => sum + entry.used, 0);
}

/**
 * `recordEffectOccurrence` 適用後の tally が指定 `targetCount` と厳密一致するかを返す。
 * 「Nターン中N回目のみ発火 (N-1回目までは何も起きない)」型のゲート判定に使う
 * (`maxCount` 上限型の `EffectUsageLimit` とは異なり、範囲ではなく単一値との一致を見る)。
 */
export function isExactOccurrenceMatch(
  state: GameState,
  params: {
    sourceInstanceId: string;
    sourceDefinitionId?: string;
    effectLabel: string;
    duration: EffectUsageLimitDuration;
    targetCount: number;
    groupId?: string;
    playerId?: string;
  }
): boolean {
  return getEffectOccurrenceCount(state, params) === params.targetCount;
}

/**
 * 観測 tally の bucket か。取消用 snapshot へ巻き戻しても観測された出来事は戻さない
 * (誘発待機列と同じ扱い)。pending-resolution-policy が使う。
 */
export function isEffectOccurrenceBucket(bucket: UsageBucket): boolean {
  if (bucket.measure !== "observation") return false;
  const described = describeUsageBucket(bucket);
  if (described === null) return false;
  return (
    (described.groupId?.startsWith(OCCURRENCE_GROUP_PREFIX) ?? false) ||
    (described.ability?.path.endsWith(OCCURRENCE_PATH_SUFFIX) ?? false)
  );
}
