import { isRecordInDurationScope } from "../legal/legal-actions-shared";
import type {
  EffectUsageLimitDuration,
  EffectUsageRecord,
  GameState,
} from "../model";

/**
 * 「ターンに/ゲーム中にN回目の観測でのみ発火する」型 (BSLH01-C05/R03 quartz set-effect 等)
 * の累積 occurrence tally。`effectUsageRecords`/`recordEffectUsageIfLimited` (効果の発動/宣言
 * 時にのみ加算) とは別軸で、トリガー条件の検出成功のたび (発動可否に関わらず) 無条件で加算する。
 * レコード shape は `EffectUsageRecord` を再利用し、duration スコープ判定 (`turn`/`game`/
 * `step`/`battle`) は `isRecordInDurationScope` と共有する (SSOT)。
 *
 * 正源: ENGINE-nth-occurrence-trigger-gate。Step3 着地済み: trigger-system.ts の
 * queueReactionsInternal から呼び出され (tally 加算 + ゲート判定)、BSLH01-C05/R03 の
 * quartz set-effect (card-data BSLH01.ts occurrenceGate フィールド) から参照される。
 */

export interface RecordEffectOccurrenceOptions {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectLabel: string;
  duration: EffectUsageLimitDuration;
  /**
   * 共有 tally グループ ID (`EffectOccurrenceGate.groupId` と同型)。設定時は
   * effectLabel ではなく groupId でレコードをマッチ/合算する
   * (`canUseEffectByUsageLimit` の groupId マッチと同パターン、SSOT)。
   */
  groupId?: string;
}

/**
 * groupId が設定されていれば groupId で、無ければ effectLabel でレコードをマッチする。
 * `canUseEffectByUsageLimit` (legal-actions-shared.ts) の `matchesLabel` と同型。
 */
function matchesOccurrenceLabel(
  record: EffectUsageRecord,
  params: { effectLabel: string; groupId?: string }
): boolean {
  return params.groupId
    ? record.groupId === params.groupId
    : record.effectLabel === params.effectLabel;
}

/**
 * 現在の scope (duration 基準) における occurrence tally を 1 加算した
 * `effectOccurrenceRecords` を返す (純関数、state は書き換えない)。
 * 同一 (sourceInstanceId, effectLabel|groupId, duration, turnNumber, step, [attackId]) の
 * レコードが scope 内に既にあれば count+1、無ければ count:1 で新規作成する。
 */
export function recordEffectOccurrence(
  options: RecordEffectOccurrenceOptions
): EffectUsageRecord[] {
  const {
    state,
    sourceInstanceId,
    sourceDefinitionId,
    effectLabel,
    duration,
    groupId,
  } = options;
  const attackId: string | null | undefined =
    duration === "battle" ? (state.activeAttack?.attackId ?? null) : undefined;
  const existingIndex = state.effectOccurrenceRecords.findIndex(
    (r) =>
      r.sourceInstanceId === sourceInstanceId &&
      matchesOccurrenceLabel(r, {
        effectLabel,
        ...(groupId !== undefined ? { groupId } : {}),
      }) &&
      r.duration === duration &&
      isRecordInDurationScope(r, state, duration)
  );

  if (existingIndex >= 0) {
    return state.effectOccurrenceRecords.map((r, i) =>
      i === existingIndex ? { ...r, count: r.count + 1 } : r
    );
  }

  return [
    ...state.effectOccurrenceRecords,
    {
      sourceInstanceId,
      sourceDefinitionId,
      effectLabel,
      turnNumber: state.turnNumber,
      step: state.step,
      duration,
      count: 1,
      ...(attackId !== undefined ? { attackId } : {}),
      ...(groupId ? { groupId } : {}),
    },
  ];
}

/**
 * 現在の scope (duration 基準) における occurrence tally を読み取り専用で取得する。
 * レコードが無ければ 0。
 */
export function getEffectOccurrenceCount(
  state: GameState,
  params: {
    sourceInstanceId: string;
    effectLabel: string;
    duration: EffectUsageLimitDuration;
    groupId?: string;
  }
): number {
  const record = state.effectOccurrenceRecords.find(
    (r) =>
      r.sourceInstanceId === params.sourceInstanceId &&
      matchesOccurrenceLabel(r, {
        effectLabel: params.effectLabel,
        ...(params.groupId !== undefined ? { groupId: params.groupId } : {}),
      }) &&
      r.duration === params.duration &&
      isRecordInDurationScope(r, state, params.duration)
  );
  return record?.count ?? 0;
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
    effectLabel: string;
    duration: EffectUsageLimitDuration;
    targetCount: number;
    groupId?: string;
  }
): boolean {
  return (
    getEffectOccurrenceCount(state, {
      sourceInstanceId: params.sourceInstanceId,
      effectLabel: params.effectLabel,
      duration: params.duration,
      ...(params.groupId !== undefined ? { groupId: params.groupId } : {}),
    }) === params.targetCount
  );
}

/**
 * 期限切れの occurrence レコードをクリアする。`clearExpiredEffectUsageRecords`
 * (legal-actions-shared.ts) と対称。ターン終了時/ステップ遷移時に呼び出す想定。
 */
export function clearExpiredEffectOccurrenceRecords(
  state: GameState
): EffectUsageRecord[] {
  return state.effectOccurrenceRecords.filter((record) =>
    isRecordInDurationScope(record, state, record.duration)
  );
}
