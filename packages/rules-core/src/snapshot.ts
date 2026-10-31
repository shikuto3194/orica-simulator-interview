// ============================================================
// GameSnapshot — シリアライズ可能な GameState スナップショット
//
// 想定用途 (現状は開発・テスト用途):
// - 現在のバトルを JSON にエクスポートして共有・復元
// - シナリオ的な検証用に任意の局面を構築・読み込み
//
// セーブパスを持たなかった本シミュレータに「state を持ち込む経路」を
// 追加することで、P3-18 Phase 4 (継続効果リビルダのセーブ復元統合) を
// この経路にホストする。
// ============================================================

import { replaceCardInstances } from "./zone/card-instance-state";
import { refreshPendingRebirthSeparationCoreSources } from "./mechanics/core-charge-distribution";
import { assertPendingTriggerChainIds } from "./chain-id";
import { restoreUnifiedSourceChoice } from "./effect/restore-source-choice";
import { rebuildContinuousEffectsFromField } from "./effect/continuous-effect-rebuild";
import type { CardDefinition, GameState } from "./model";
import {
  backfillOptionalStateFields,
  syncMinimumRequiredCoresFromCurrentDefinitions,
} from "./state-sanitize";
import {
  pruneIllegalPendingTriggeredEffects,
  type TriggeredEffectActionRegistrationLookup,
} from "./effect/trigger-system";

/**
 * スナップショット形式のバージョン。
 * 互換性のない変更が入ったらインクリメント。
 *
 * v1 → v2: CardInstance.soulCoreAttached 削除 (P3-66)。v1 の cardInstances は
 * 読み込み時に soulCoreAttached フィールドを除去する。SSOT は player.soulCoreLocation。
 */
// v2 → v3: 誘発の原因 chainId を必須化。旧版も有効なIDが揃う状態は読み込める。
export const GAME_SNAPSHOT_SCHEMA_VERSION = 3 as const;
const SUPPORTED_SCHEMA_VERSIONS = new Set<number>([1, 2, 3]);

/**
 * シリアライズ可能な GameState スナップショット。
 * `state` 部は GameState を素のオブジェクトとして格納する。
 */
export interface GameSnapshot {
  schemaVersion: typeof GAME_SNAPSHOT_SCHEMA_VERSION;
  /** 保存時刻 (ISO 8601)。 */
  savedAt: string;
  /** 任意のラベル。UI 上の表示用。 */
  label?: string;
  /** 由来情報。debug 用。 */
  origin?: {
    sourceKind?: "scenario" | "room" | "manual";
    sourceId?: string;
  };
  state: GameState;
}

/** スナップショット parse 結果。 */
export type GameSnapshotParseResult =
  | { ok: true; snapshot: GameSnapshot }
  | { ok: false; error: string };

/**
 * 任意の値を GameSnapshot として解析する。
 * 安全側に倒して厳格にチェックする — 不正な形なら ok=false で拒否。
 *
 * GameState 全体の deep validation はここでは行わない。
 * 復元時に `assertValidGameState` を別途呼ぶ前提。
 */
export function parseGameSnapshot(input: unknown): GameSnapshotParseResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "snapshot must be an object" };
  }
  const obj = input as Record<string, unknown>;

  if (
    typeof obj.schemaVersion !== "number" ||
    !SUPPORTED_SCHEMA_VERSIONS.has(obj.schemaVersion)
  ) {
    return {
      ok: false,
      error: `unsupported schemaVersion: ${String(obj.schemaVersion)} (expected one of ${[...SUPPORTED_SCHEMA_VERSIONS].join(", ")})`,
    };
  }
  if (typeof obj.savedAt !== "string") {
    return { ok: false, error: "savedAt must be a string (ISO 8601)" };
  }
  if (typeof obj.state !== "object" || obj.state === null) {
    return { ok: false, error: "state must be an object" };
  }

  const state = obj.state as Partial<GameState>;
  if (typeof state.turnNumber !== "number") {
    return { ok: false, error: "state.turnNumber must be a number" };
  }
  if (typeof state.activePlayerId !== "string") {
    return { ok: false, error: "state.activePlayerId must be a string" };
  }
  if (!Array.isArray(state.cardInstances)) {
    return { ok: false, error: "state.cardInstances must be an array" };
  }
  if (!Array.isArray(state.players)) {
    return { ok: false, error: "state.players must be an array" };
  }
  if (!Array.isArray(state.activeContinuousEffects)) {
    return {
      ok: false,
      error: "state.activeContinuousEffects must be an array",
    };
  }

  // 後方互換: 新フィールド追加前に保存された state の欠落キーを既定値で補完する。
  const normalizedState = backfillOptionalStateFields(state);
  try {
    assertPendingTriggerChainIds(normalizedState);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // v1 → v2 マイグレーション: 各 cardInstance から soulCoreAttached を除去。
  // SSOT は player.soulCoreLocation なので捨てても情報損失なし。
  if (obj.schemaVersion === 1) {
    const migratedCards = normalizedState.cardInstances.map((card) => {
      if (
        typeof card === "object" &&
        card !== null &&
        "soulCoreAttached" in card
      ) {
        const { soulCoreAttached: _drop, ...rest } = card as Record<
          string,
          unknown
        >;
        void _drop;
        return rest;
      }
      return card;
    });
    const migrated: GameSnapshot = {
      ...(obj as unknown as GameSnapshot),
      schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
      state: replaceCardInstances(
        {
          ...normalizedState,
        },
        migratedCards as GameState["cardInstances"]
      ),
    };
    return { ok: true, snapshot: migrated };
  }

  return {
    ok: true,
    snapshot: {
      ...(obj as unknown as GameSnapshot),
      schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
      state: normalizedState,
    },
  };
}

/**
 * 現在の GameState から GameSnapshot を作る。
 *
 * 純粋関数。state はそのまま deep copy せずに参照保持する点に注意 (caller が必要なら structuredClone する)。
 */
export function createGameSnapshot(
  state: GameState,
  options?: {
    label?: string;
    origin?: GameSnapshot["origin"];
    /** テスト用に時刻を固定する場合のみ。 */
    nowIso?: string;
  }
): GameSnapshot {
  return {
    schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
    savedAt: options?.nowIso ?? new Date().toISOString(),
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.origin ? { origin: options.origin } : {}),
    state,
  };
}

/** スナップショット復元結果。 */
export interface SnapshotRestoreResult {
  state: GameState;
  warnings: string[];
}

/**
 * GameSnapshot から GameState を復元する。
 *
 * 復元手順:
 *   1. cardInstances 内の definitionId が現在のカードデータに存在するか確認
 *   2. continuous 効果リビルダを実行 (= P3-18 Phase 4)
 *      - スナップショット時のカード定義に新しい continuous 効果が増えていれば、
 *        ここで CE が補完される
 *      - state がバトル進行中でも復元できるよう、unsafeAllowDuringBattle を許可
 *      - リビルダは冪等なので、CE が完備していれば差分ゼロで素通り
 *   3. P3-45: 公開・非公開の未宣言 orphan 誘発を共通資格判定でスクラブする
 *      - registration は引けるが applicability / condition / filter で source 候補が
 *        全滅している pending を drop (legal-actions-availability の fallback で
 *        mandatory drain される silent NO-OP を防ぐ)
 *      - `getRegisteredTriggeredEffectActions` 未指定なら scrubbing しない
 *
 * 不正な state 検出は呼び出し側の `assertValidGameState` 役。
 */
export function restoreSnapshot(
  snapshot: GameSnapshot,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  options?: {
    /**
     * P3-45: orphan pending を applicability / source resolvability ベースで scrub する用。
     * 未指定なら pending arrays は触らない (= 後方互換)。
     */
    getRegisteredTriggeredEffectActions?: TriggeredEffectActionRegistrationLookup;
  }
): SnapshotRestoreResult {
  // 原因が欠落した保存状態を、カード定義の再構築・孤立キュー除去で隠さない。
  assertPendingTriggerChainIds(snapshot.state);
  const warnings: string[] = [];
  const synced = syncMinimumRequiredCoresFromCurrentDefinitions(
    snapshot.state,
    getCardDefinitionById
  );
  const state = synced.state;
  if (synced.updatedInstanceIds.length > 0) {
    warnings.push(
      `synced minimumRequiredCores for ${synced.updatedInstanceIds.length} card instance(s) from current definitions: ${synced.updatedInstanceIds.join(", ")}`
    );
  }

  const unknownCards = new Set<string>();
  for (const card of state.cardInstances) {
    if (!getCardDefinitionById(card.definitionId)) {
      unknownCards.add(card.definitionId);
    }
  }
  if (unknownCards.size > 0) {
    warnings.push(
      `unknown cardNo(s) referenced by state.cardInstances: ${[...unknownCards].sort().join(", ")}`
    );
  }

  const beforeCount = state.activeContinuousEffects.length;
  let rebuilt = rebuildContinuousEffectsFromField(
    state,
    getCardDefinitionById,
    // 復元はバトル進行中の state も対象にしうる。
    // リビルダは provenance 一致で冪等性を保つので、
    // カード定義 drift 起因の差分のみが新規追加される。
    {
      unsafeAllowDuringBattle: true,
      skipNewFieldEffectsFromPendingLeave: true,
    }
  );
  const added = rebuilt.activeContinuousEffects.length - beforeCount;
  if (added > 0) {
    warnings.push(
      `rebuilder added ${added} continuous effect(s) that were missing from the snapshot ` +
        "(likely card definition drift since save)"
    );
  }

  rebuilt = refreshPendingRebirthSeparationCoreSources(
    rebuilt,
    getCardDefinitionById
  );

  // P3-45: 公開・非公開の未宣言 orphan 誘発を、通常解決と同じ判定で整理する。
  // 当初観測ケース: P3-44 適用前に save された snapshot に、applicability で
  // 弾かれるべき trigger source の pending が残っており、復元後に
  // legal-actions-availability の fallback パスで silent な mandatory drain が
  // 走っていた。明示 drop + warning で「消えた」事を可視化する。
  if (options?.getRegisteredTriggeredEffectActions) {
    const beforePrune = rebuilt;
    rebuilt = pruneIllegalPendingTriggeredEffects({
      state: rebuilt,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    });
    const retainedPublicIds = new Set(
      rebuilt.pendingTriggeredEffects.map((pending) => pending.pendingId)
    );
    const droppedIds = beforePrune.pendingTriggeredEffects
      .filter((pending) => !retainedPublicIds.has(pending.pendingId))
      .map((pending) => pending.pendingId);
    if (droppedIds.length > 0) {
      warnings.push(
        `scrubbed ${droppedIds.length} orphan pendingTriggeredEffects (no resolvable source under current applicability): ${droppedIds.join(", ")}`
      );
    }
    const retainedPrivateIds = new Set(
      rebuilt.pendingPrivateDeclarations.map((pending) => pending.declarationId)
    );
    const droppedPrivateIds = beforePrune.pendingPrivateDeclarations
      .filter((pending) => !retainedPrivateIds.has(pending.declarationId))
      .map((pending) => pending.declarationId);
    if (droppedPrivateIds.length > 0) {
      warnings.push(
        `scrubbed ${droppedPrivateIds.length} orphan pendingPrivateDeclarations (no resolvable source under current applicability): ${droppedPrivateIds.join(", ")}`
      );
    }
  }

  // 注: 旧セーブの stale flash-window source healing は backfillOptionalStateFields
  // (state-sanitize.ts) に集約。スナップショット経路は parseGameSnapshot が、PvP ルーム
  // 経路は game-api getRoom が同関数を通すため、ここでの追加 healing は不要。

  const migrated = restoreUnifiedSourceChoice(rebuilt, getCardDefinitionById);
  if (migrated !== rebuilt)
    warnings.push(
      "restored obsolete source choice using current unified candidates"
    );
  return { state: migrated, warnings };
}
