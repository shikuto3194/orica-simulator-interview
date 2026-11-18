/**
 * 効果由来の使用枠・消費管理 (P3-170) の型。単一正源。
 *
 * 依存方向: このディレクトリの中核 (types / identity / clock / ledger) は
 * GameState・legal・action実行・GUI を import しない。`model.ts` と `dsl-types.ts` は
 * ここで定義した制限型を参照/再exportするだけで、別のkind列挙を持たない。
 *
 * 設計契約: issues/archive/P3-170/contract.md
 * ルール根拠: manual/ai-reference/10_rules/03e_effect-duration-and-repeat-scope.md
 *             (期間と共有範囲は独立した軸である)
 */

import type { DynamicCount } from "../dsl-types";
import type { Condition } from "../model";

// ============================================================
// DSL (カード定義) 側の制限記述
// ============================================================

/**
 * 制限の共有範囲 (カード定義の記述形)。
 *
 * - "per_instance": 発揮元の個体ごと〔ターンに1回〕等。
 * - "per_card_name": 同名カード全体で共有〔ターンに1回:同名〕等。
 * - "per_group": プレイヤーと limitGroupId 単位 (カード名・個体を跨ぐ)。
 * - "no_duplicate": 〔重複不可〕同名が複数いても同じ出来事 (event) では1体のみ。
 * - "per_trigger_related_instance": 観測された誘発主語 Y の個体ごと「ターンに1回ずつ」型。
 * - "per_trigger_activation": 1つの効果発揮由来の複数誘発を1回に畳む。
 */
export type EffectUsageLimitKind =
  | "per_instance"
  | "per_card_name"
  | "per_group"
  | "no_duplicate"
  | "per_trigger_related_instance"
  | "per_trigger_activation";

/** 期間軸 (カード定義の記述形)。 */
export type EffectUsageLimitDuration = "turn" | "game" | "step" | "battle";

/**
 * 効果の使用回数制限 (カード定義の記述形)。
 * maxCount を省略すると 1 回、duration を省略すると "turn"。
 */
export interface EffectUsageLimit {
  kind: EffectUsageLimitKind;
  /** 制限の期間軸。省略時は "turn"。no_duplicate では event 期間が優先される。 */
  duration?: EffectUsageLimitDuration;
  /** 最大使用回数。省略時は 1。 */
  maxCount?: number;
  /**
   * base maxCount に加算する動的回数。
   * 盤面のみで評価できる DynamicCount を使用し、
   * 「自分のカウント4につき、この効果の発揮回数を+1回する」型を表す。
   */
  maxCountAdditionalDynamic?: DynamicCount;
  /**
   * 条件付き maxCount 上書き。評価時点で最初に成立した entry の maxCount を採用し、
   * 全て不成立なら base の maxCount を使う。
   */
  maxCountOverrides?: readonly {
    when: Condition;
    maxCount: number;
  }[];
  /**
   * 効果解決が相手効果の妨害を受けた場合は使用記録を払い戻し、制限を消費しない
   * (「相手の効果を受けなかったとき…しか使えない」)。
   */
  unlessAffectedByOpponent?: boolean;
}

// ============================================================
// 正規化された制限 (UsageConstraint)
// ============================================================

/** 能力の種別。表示labelとは独立した構造参照の分類。 */
export type AbilityKind =
  | "effect"
  | "step"
  | "choice"
  | "divine_skill"
  | "advent"
  | "gimmick"
  | "oracle"
  | "grant"
  | "rule";

/**
 * 能力への構造化参照。表示ラベルや効果番号の文字列連結を各consumerで作らない。
 * 登録時に1度だけ作り、列挙・pending・実行へ同じ値を渡す。
 */
export interface AbilityRef {
  kind: AbilityKind;
  /** 定義側の識別 (同名共有は nameKey ではなくここを使う。個体ではない)。 */
  definitionKey: string;
  /** 定義内の構造path (effects[2].steps[1] 等) または安定したgrant/能力ID。 */
  path: string;
}

/** 共有範囲 (正規化後)。 */
export type UsageShare =
  | "instance"
  | "card_name"
  | "group"
  | "subject_instance"
  | "grant";

/** 期間 (正規化後)。進行文脈のIDを参照する。 */
export type UsagePeriodKind =
  | "game"
  | "turn"
  | "step"
  | "battle"
  | "event"
  | "activation";

/** 何を数えるか。use への amount 混入を型で禁止する。 */
export type UsageMeasure = "use" | "amount" | "observation" | "fact";

/** 記録する意味上の地点。 */
export type UsageCommitPoint =
  | "declaration"
  | "step"
  | "application"
  | "grant_use";

/** 上限。固定または動的計算式。使用済み数とは別に、状態へ現在の上限を重複保存しない。 */
export interface UsageMaximum {
  base: number;
  additionalDynamic?: DynamicCount;
  overrides?: readonly { when: Condition; maxCount: number }[];
}

/** 個体の世代のうちどれを寿命に含めるか。 */
export interface UsageIncarnation {
  /** 実離脱で更新される場の世代 (fieldInstanceGeneration)。 */
  field: boolean;
  /** 魂状態化で更新される世代 (soulStateGeneration)。【魂状態】を含む効果は false。 */
  soul: boolean;
}

/**
 * 一つの制限節。turn と game、回数と数量などを混同しないよう、
 * 各軸を独立に持つ。
 */
export interface UsageConstraint {
  /** 一つの制限節を識別する。identity.ts の `makeConstraintId` だけが生成する。 */
  constraintId: string;
  abilityRef: AbilityRef;
  share: UsageShare;
  /** share="group"/"grant" のときの共有参照。 */
  groupId?: string;
  /** どのプレイヤーの枠か。 */
  playerScope: "actor" | "beneficiary";
  period: UsagePeriodKind;
  measure: UsageMeasure;
  maximum: UsageMaximum;
  incarnation: UsageIncarnation;
  /**
   * 〔重複不可〕と併用された per_trigger_related_instance は、発揮元を同名で共有する。
   * share="subject_instance" のときだけ意味を持つ。
   */
  shareSourceByName?: boolean;
  commitPoint: UsageCommitPoint;
}

// ============================================================
// 時計 (進行文脈のID)
// ============================================================

/**
 * 使用枠の期間を判定する時計。値はすべて進行文脈のID。
 * GameState から導出する (turnId=turnNumber / stepId=ターン内のステップ序数 /
 * battleId=activeAttack.attackId)。台帳には保存せず、二重管理にしない。
 * 追加ターンへの中断・復帰は `returnContext` の既存退避 (turnContext / activeAttack) で復元される。
 */
export interface UsageClock {
  /** ターン識別 (追加ターンにも固有の値が割り当てられる)。 */
  turnId: number;
  /** ターン内のステップ序数 (同名の追加ステップでも別の値)。turnId と組で一意。 */
  stepId: number;
  /** 現在のバトル (attackId)。バトル外は null。 */
  battleId: string | null;
}

// ============================================================
// 状態 (JSON互換)
// ============================================================

/** 一つの共有枠 (同一 identity の使用量)。 */
export interface UsageBucket {
  /** identity.ts が生成する正規キー。他のモジュールは作らない。 */
  key: string;
  constraintId: string;
  measure: UsageMeasure;
  period: UsagePeriodKind;
  /** この枠を作ったターン。event / activation の整理に使う。 */
  turnId: number;
  /** period に応じた時計の値 (game は 0 固定)。整理の判定に使う。 */
  stepId: number;
  battleId: string | null;
  /** 記録者 (診断・公開投影用)。キーには identity が必要なときだけ含める。 */
  playerId: string;
  amount: number;
}

/** 一つの操作が各bucketに与えた差分。取消はこの差分だけを戻す。 */
export interface UsageDelta {
  bucketKey: string;
  delta: number;
}

export type UsageOperationStatus = "applied" | "refunded";

/** 消費receipt。 */
export interface UsageOperation {
  operationId: string;
  /** 操作を行ったターン。released な操作はこのターンが生存しなくなったら整理する。 */
  turnId: number;
  status: UsageOperationStatus;
  deltas: readonly UsageDelta[];
  /** 継続/pending/取消snapshotから参照されなくなったら true。true かつ期限切れで整理する。 */
  released?: boolean;
}

/** 付与された権利 (追加アタック権・コネクトバトル権等)。残量は使用bucketとの差。 */
export interface UsageGrant {
  grantId: string;
  /** 権利の種別 (grantKind)。同種の合算/置換の規則は本文に従い呼出側が決める。 */
  grantKind: string;
  playerId: string;
  /** 受益個体がある場合。 */
  subjectInstanceId?: string;
  /** 由来の効果元 (由来不明の移行権利は kind: "rule", path: "legacy")。 */
  sourceRef: AbilityRef;
  total: number;
  /** 失効期間。battle 期間の権利は付与時の battleId (attackId) を持つ。 */
  expires: {
    period: UsagePeriodKind;
    turnId: number;
    stepId: number;
    battleId?: string | null;
  };
  /** 付与操作。再開時の二重付与を防ぐ。 */
  operationId: string;
}

/** GameState.effectAccounting。使用会計の唯一の保存先。 */
export interface EffectAccounting {
  /** 会計schema版。保存/roomのmigrationが参照する。 */
  version: 1;
  /** 呼出側がoperationIdを指定しない消費に振る連番 (状態から決定的に採番し、再現性を保つ)。 */
  nextOperationSeq: number;
  buckets: UsageBucket[];
  grants: UsageGrant[];
  operations: UsageOperation[];
}

// ============================================================
// 照会・消費の入出力
// ============================================================

/** 一つの制限に対する照会文脈 (呼出側が確定した事実だけを渡す)。 */
export interface UsageContext {
  /** 使用者 (actor)。共有キーに必要なため新状態では必須。 */
  playerId: string;
  /** 発揮元の個体。 */
  sourceInstanceId: string;
  /** 発揮元の世代。 */
  sourceFieldGeneration: number;
  sourceSoulGeneration: number;
  /** 同名共有の名前解決キー (printed identity正源を呼出側が一か所で解決)。 */
  nameKey: string;
  /** 受益者 (playerScope="beneficiary")。 */
  beneficiaryPlayerId?: string;
  /** 観測された誘発主語 Y。 */
  subjectInstanceId?: string;
  subjectFieldGeneration?: number;
  /** 同一出来事 (pendingId 等)。 */
  eventId?: string;
  /** 同一効果発揮由来 (chainId 等)。 */
  activationId?: string;
  /** grant 共有枠の対象。 */
  grantId?: string;
  /** 現在の時計。 */
  clock: UsageClock;
}

/** 各制限の照会結果。 */
export interface UsageQueryEntry {
  constraintId: string;
  bucketKey: string;
  limit: number;
  used: number;
  remaining: number;
  /** blockedReason は remaining < 需要量のときのみ。 */
  blockedReason?: "exhausted" | "missing_player" | "invalid_maximum";
}

export interface UsageQueryResult {
  entries: readonly UsageQueryEntry[];
  /** 全制限を通過するか (AND)。 */
  allowed: boolean;
}

export type UsageFailureReason =
  | "exhausted"
  | "missing_player"
  | "invalid_amount"
  | "invalid_maximum"
  | "operation_refunded"
  | "operation_conflict";

export type UsageConsumeResult =
  | {
      ok: true;
      accounting: EffectAccounting;
      operation: UsageOperation;
      /** 同じ operationId の再送で何も加算しなかった場合 true。 */
      replayed: boolean;
    }
  | {
      ok: false;
      reason: UsageFailureReason;
      constraintId?: string;
    };

/** 上限評価を呼出側 (evaluateCondition / DynamicCount 評価を持つ層) に委譲するための関数。 */
export type UsageMaximumResolver = (
  constraint: UsageConstraint,
  context: UsageContext
) => number;
