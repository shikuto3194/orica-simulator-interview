/**
 * 旧形式の使用会計 → `GameState.effectAccounting` の版付き migration (P3-170 W5)。
 *
 * snapshot の復元 (snapshot.ts) と room の DB 復元 (apps/playground-web/server/game-api.ts) が、
 * `backfillOptionalStateFields` より前に通す共通の入口。旧形式の使用済みを失う変換は機能不具合として扱う。
 *
 * - 入力を変更しない (deep copy して変換する)。成功は `{ok:true, state, changed}`、失敗は path 付きの明示エラー。
 * - 版: `effectAccounting.version === 1` が新形式。`effectAccounting` が無い (または旧フィールドがある) state は旧形式。
 * - 冪等: 変換済みの state は同じ内容で返す (旧キーは変換後に除去する)。
 * - 新旧両方がある入力は、等価性を証明できなければ競合エラー。新形式を旧値で上書きしない。
 * - **変換できない旧データは明示エラー**。推測補完・空初期化・fallback はしない。
 *   空の旧配列/辞書は「消費なし」と分かるので空の会計へ変換する。期限切れの記録は破棄する (情報損失ではない)。
 * - 旧→新変換は、各機構が新形式で枠を作る関数 (site 構築関数・`usageIdentityOfLabel` ほか) と
 *   同じ関数・同じ識別で枠を作る。別実装で識別を作らない。
 * - 入れ子の GameState は `nested-states.ts` の型グラフだけを訪問し、独立に変換する
 *   (生JSONの汎用再帰で field 名が似たものを変換しない)。
 *
 * 旧フィールド名を参照してよい唯一の runtime ファイル (scripts/effect-usage-ssot.mjs の LEGACY_FIELD_ALLOW)。
 * 仕様と拒否条件: manual/ai-reference/20_design/20a_effect-usage-accounting-migration.md
 */

import { consumeUsage, createEmptyEffectAccounting } from "./ledger";
import { FIXED_RULE_LABEL_LIMITS } from "./fixed-labels";
import {
  LEGACY_RECORD_LIST_KEYS,
  LEGACY_TURN_KEYS,
  USAGE_ACCOUNTING_MIGRATION_FAILED,
  anyLegacyKeyPresent,
  findLegacyInFlightFlag,
  isRec,
} from "./legacy-guard";
import { findAccountingShapeProblem } from "./accounting-shape";
import { makeAbilityRef } from "./normalize";
import { NESTED_STATE_GRAPH } from "./nested-states";
import type { NestedStateCarrier } from "./nested-states";
import type {
  AbilityRef,
  EffectAccounting,
  EffectUsageLimit,
  UsageConstraint,
  UsageContext,
  UsageDelta,
  UsageOperation,
} from "./types";
import type { CardDefinition, GameState } from "../model";
import {
  grantUsageOnState,
  usageConstraintsOf,
  usageContextOf,
} from "../effect/effect-usage-accounting";
import type { UsageSite } from "../effect/effect-usage-accounting";
import { recordEffectOccurrence } from "../effect/effect-occurrence-gate";
import {
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
} from "../effect/structured-effect-registrations";
import { usageIdentityOfLabel } from "../effect/usage-identity";
import {
  divineSkillDeclarationObservationSite,
  divineSkillUsageSite,
} from "../legal/divine-skill-usage";
import { adventUsageSite } from "../mechanics/advent-usage";
import type { AdventUsageKind } from "../mechanics/advent-usage";
import {
  ADDITIONAL_ATTACK_GRANT_KIND,
  CONNECT_BATTLE_GRANT_KIND,
} from "../mechanics/battle-grant-usage";
import {
  consumeCountGainModifier,
  consumeDeclareGimmickGate,
  consumeTaplessBattleDeclareBudget,
  declareGimmickGateAbilityRef,
  recordUseCostGatePaid,
} from "../mechanics/dedicated-usage";
import {
  LEGACY_PLAYER_WIDE_MIRAGE_EXEMPTION,
  consumeMirageSetCountExemption,
} from "../mechanics/mirage-exemption-usage";
import {
  oracleTriggerUsageSite,
  placementOracleUsageSite,
} from "../mechanics/oracle-usage";
import {
  ceQuantitySourceOf,
  recordGimmickDeclaration,
  recordLifeReductionQuantities,
  recordSymbolAdditionRestrictedCount,
} from "../mechanics/quantity-usage";

// ---------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------

export { USAGE_ACCOUNTING_MIGRATION_FAILED };
export {
  UnmigratedEffectUsageError,
  assertEffectUsageMigrated,
  hasLegacyEffectUsageData,
} from "./legacy-guard";

/** 変換できない旧データを示す明示エラー。path は入れ子を含む (state.effectUsageRecords[3] など)。 */
export interface UsageAccountingMigrationError {
  code: typeof USAGE_ACCOUNTING_MIGRATION_FAILED;
  /** 原因の場所。構造 (field 名と添字) だけで、カード名や非公開情報を含まない。 */
  path: string;
  /** 機械可読の理由コード (拒否条件。20a 文書の表)。 */
  reason: string;
  /** 管理用の詳細 (カード名・個体IDを含みうる)。利用者向け応答には載せない。 */
  detail?: string;
}

export type UsageAccountingMigrationResult =
  | { ok: true; state: GameState; changed: boolean }
  | { ok: false; error: UsageAccountingMigrationError };

export interface UsageAccountingMigrationContext {
  /**
   * 定義解決。旧 effectUsageRecords / 神技キー / 煌臨キーの変換に必要 (cards/ability の定義解決は
   * restore 段階の引数で渡し、parser で名前を推測しない)。旧形式の非空の使用データがあるのに
   * 渡されていない場合は `definitions_required` で失敗する。
   */
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
}

class MigrationFailure extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
    readonly detail?: string
  ) {
    super(`${reason}: ${path}${detail ? ` (${detail})` : ""}`);
  }
}

function fail(path: string, reason: string, detail?: string): never {
  throw new MigrationFailure(path, reason, detail);
}

// ---------------------------------------------------------------
// 旧フィールドの一覧
// ---------------------------------------------------------------

type Rec = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const UNBOUNDED = (): number => Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------
// 入口
// ---------------------------------------------------------------

/** 入れ子の state の変換に共有する、実行全体の状態。 */
interface Global {
  ctx: UsageAccountingMigrationContext;
  /** 変換中/変換済みの state (循環参照・共有参照で二重に変換しない)。 */
  converting: WeakSet<object>;
  /** 型グラフの訪問済み (object, 型名)。 */
  visited: WeakMap<object, Set<string>>;
}

/**
 * 旧形式の使用会計を新形式へ変換する。入力は変更しない。
 * 変換済みの state は同じ参照を `changed:false` で返す (冪等・高速)。
 */
export function migrateEffectAccounting(
  rawState: unknown,
  ctx: UsageAccountingMigrationContext = {}
): UsageAccountingMigrationResult {
  if (!isRec(rawState)) {
    return failure("state", "state_not_object");
  }
  try {
    if (isMigratedFast(rawState)) {
      return {
        ok: true,
        state: rawState as unknown as GameState,
        changed: false,
      };
    }
    const inFlight = findLegacyInFlightFlag(rawState);
    if (inFlight)
      fail(
        inFlight.path,
        "unconvertible_in_flight_usage_flag",
        `${inFlight.key}: 宣言時消費済みの旧フラグは対応する枠を一意に特定できないため変換しません`
      );
    const copy = deepCopy(rawState) as Rec;
    const g: Global = {
      ctx,
      converting: new WeakSet(),
      visited: new WeakMap(),
    };
    convertState(copy, "state", g);
    return { ok: true, state: copy as unknown as GameState, changed: true };
  } catch (error) {
    if (error instanceof MigrationFailure) {
      return failure(error.path, error.reason, error.detail);
    }
    // 壊れた旧データ(null や型違いの入れ子)で変換コードが読み出しに失敗した場合も、
    // 生の例外で落とさず元データを保った明示エラーにする。推測で補って続行はしない。
    if (error instanceof TypeError || error instanceof RangeError) {
      return failure(
        "state",
        "invalid_legacy_shape",
        `旧 state の形が想定外のため変換できません (${error.name}: ${error.message})`
      );
    }
    throw error;
  }
}

/** 入力を変更しないための deep copy。JSON互換の state が前提 (structuredClone があれば使う)。 */
function deepCopy<T>(value: T): T {
  const clone = (globalThis as { structuredClone?: <V>(v: V) => V })
    .structuredClone;
  return clone ? clone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

function failure(
  path: string,
  reason: string,
  detail?: string
): UsageAccountingMigrationResult {
  return {
    ok: false,
    error: {
      code: USAGE_ACCOUNTING_MIGRATION_FAILED,
      path,
      reason,
      ...(detail !== undefined ? { detail } : {}),
    },
  };
}

/** 会計版が1で旧キーが無い state は変換済み (入れ子も新形式で書かれている)。 */
function isMigratedFast(state: Rec): boolean {
  const acc = state.effectAccounting;
  if (!isRec(acc)) return false;
  if (acc.version !== 1) {
    fail(
      "state.effectAccounting.version",
      "unsupported_accounting_version",
      String(acc.version)
    );
  }
  // 版が1でも、破損した会計は明示エラーにする (後段の TypeError や使用枠の増加にしない)。
  const problem = findAccountingShapeProblem(acc);
  if (problem)
    fail(
      `state.effectAccounting.${problem.path}`,
      "invalid_accounting_shape",
      problem.detail
    );
  return (
    typeof state.stepOrdinalThisTurn === "number" && !anyLegacyKeyPresent(state)
  );
}

// ---------------------------------------------------------------
// 1つの state の変換
// ---------------------------------------------------------------

/** 今ターン配列を持つ期間 (現在、または追加ターンに中断された元ターン)。 */
interface Scope {
  kind: "current" | "suspended";
  /** 記録の配列を持つ親 (state または returnContext)。 */
  holder: Rec;
  holderPath: string;
  /** 今ターン配列・辞書を持つ親 (state または returnContext.turnContext)。 */
  turnHolder: Rec | undefined;
  turnHolderPath: string;
  turnNumber: number;
  stepOrdinal: number;
  step: unknown;
  /** この期間のバトル (activeAttack)。無ければ undefined。state 自体は書き換えず、参照するだけ。 */
  attack: Rec | undefined;
}

/** 変換した旧記録。取消 (recordedUsage) の receipt 合成で、旧 refund と同じ記録を特定するのに使う。 */
interface ConvertedRecord {
  record: Rec;
  scope: Scope;
  limits: EffectUsageLimit[];
  constraints: UsageConstraint[];
  matched: number[];
  context: UsageContext;
}

interface Work {
  s: Rec;
  path: string;
  g: Global;
  scopes: Scope[];
  acc: EffectAccounting;
  converted: ConvertedRecord[];
  ops: UsageOperation[];
  opSeq: number;
  cards: Map<string, Rec>;
  cardList: Rec[];
  players: string[];
  /** 新形式の会計が既にある (旧データとの競合を検査する) state。旧形式の運搬フィールドは変換しない。 */
  hasAccounting: boolean;
  defCache: Map<string, CardDefinition | undefined>;
}

function convertState(s: Rec, path: string, g: Global): void {
  if (g.converting.has(s)) return;
  g.converting.add(s);

  const existing = s.effectAccounting;
  // null は「会計なし」ではなく破損 (部分書込み・手編集)。空の会計を作って使用済みを黙って失わず、明示エラーにする。
  if (existing === null)
    fail(`${path}.effectAccounting`, "invalid_accounting_shape", "null");
  const hasAccounting = existing !== undefined;
  if (hasAccounting && (!isRec(existing) || existing.version !== 1)) {
    fail(
      `${path}.effectAccounting.version`,
      "unsupported_accounting_version",
      isRec(existing) ? String(existing.version) : typeof existing
    );
  }

  const work = makeWork(s, path, g, hasAccounting);
  const legacy = work.scopes.map((scope) => readScopeLegacy(scope));

  if (hasAccounting) {
    // 新旧両方がある。等価性を証明できなければ競合エラー。
    if (legacy.some((l) => l.hasGrantData) || hasLegacyAttackShape(work)) {
      fail(
        path,
        "legacy_new_conflict",
        "grants / connect battle exist in both old and new form"
      );
    }
    if (legacy.some((l) => l.hasData)) {
      applyLegacy(work, legacy);
      if (
        !accountingEquivalent(work.acc, existing as unknown as EffectAccounting)
      ) {
        fail(
          path,
          "legacy_new_conflict",
          "old fields differ from effectAccounting"
        );
      }
    }
  } else {
    applyLegacy(work, legacy);
    applyAttackShapes(work);
  }

  stripLegacy(work);
  if (typeof s.stepOrdinalThisTurn !== "number") s.stepOrdinalThisTurn = 0;

  // 入れ子の state と運搬フィールド (receipt) を型グラフに沿って訪問する。
  walk(work, s, "GameState", work.scopes[0]!, path);

  if (!hasAccounting) {
    s.effectAccounting = finalizeAccounting(work);
  }
}

function makeWork(
  s: Rec,
  path: string,
  g: Global,
  hasAccounting: boolean
): Work {
  const cardList = Array.isArray(s.cardInstances)
    ? (s.cardInstances.filter(isRec) as Rec[])
    : [];
  const cards = new Map<string, Rec>();
  for (const card of cardList) {
    const id = str(card.instanceId);
    if (id !== undefined) cards.set(id, card);
  }
  const players = Array.isArray(s.players)
    ? s.players.flatMap((p) => (isRec(p) && str(p.id) ? [str(p.id)!] : []))
    : [];
  return {
    s,
    path,
    g,
    scopes: buildScopes(s, path),
    acc: createEmptyEffectAccounting(),
    converted: [],
    ops: [],
    opSeq: 0,
    cards,
    cardList,
    players,
    hasAccounting,
    defCache: new Map(),
  };
}

function buildScopes(s: Rec, path: string): Scope[] {
  const turnNumber = num(s.turnNumber);
  if (turnNumber === undefined) {
    fail(
      `${path}.turnNumber`,
      "invalid_legacy_shape",
      "turnNumber must be a number"
    );
  }
  const scopes: Scope[] = [
    {
      kind: "current",
      holder: s,
      holderPath: path,
      turnHolder: s,
      turnHolderPath: path,
      turnNumber,
      stepOrdinal: num(s.stepOrdinalThisTurn) ?? 0,
      step: s.step,
      attack: isRec(s.activeAttack) ? s.activeAttack : undefined,
    },
  ];
  // 追加ターンで中断された元ターン (入れ子の追加ターンも連鎖で辿る)。
  let extra = s.extraTurnState;
  let extraPath = `${path}.extraTurnState`;
  while (isRec(extra) && isRec(extra.returnContext)) {
    const rc = extra.returnContext;
    const rcPath = `${extraPath}.returnContext`;
    const rcTurn = num(rc.turnNumber);
    if (rcTurn === undefined) {
      fail(
        `${rcPath}.turnNumber`,
        "invalid_legacy_shape",
        "turnNumber must be a number"
      );
    }
    const turnContext = isRec(rc.turnContext) ? rc.turnContext : undefined;
    scopes.push({
      kind: "suspended",
      holder: rc,
      holderPath: rcPath,
      turnHolder: turnContext,
      turnHolderPath: `${rcPath}.turnContext`,
      turnNumber: rcTurn,
      stepOrdinal: num(turnContext?.stepOrdinalThisTurn) ?? 0,
      step: rc.step,
      attack: isRec(rc.activeAttack) ? rc.activeAttack : undefined,
    });
    extra = rc.extraTurnState;
    extraPath = `${rcPath}.extraTurnState`;
  }
  return scopes;
}

// ---------------------------------------------------------------
// 旧データの読み取り (形の検証つき)
// ---------------------------------------------------------------

interface ScopeLegacy {
  usageRecords: unknown[];
  occurrenceRecords: unknown[];
  divine: string[];
  trashAdvent: string[];
  altAdvent: string[];
  declareAdvent: string[];
  countGain: string[];
  additionalGrants: string[];
  tapless: string[];
  mirage: { playerId: string; cardNo: string; index: number }[];
  /** 最古の版の `mirageSetCountExemptionUsedPlayerIds` (cardNo なしのプレイヤー単位の使用済み)。 */
  ancientMiragePlayers: string[];
  declareGimmick: Record<string, boolean>;
  useCostGate: Record<string, boolean>;
  effectLifeReduction: Record<string, number>;
  declarationCount: Record<string, number>;
  lifeReductionCapped: Record<string, number>;
  filteredLifeReduction: Record<string, number>;
  bpThresholdLifeReduction: Record<string, number>;
  symbolAdditionRestricted: Record<string, number>;
  /** 権利 (grant) の旧データがある。 */
  hasGrantData: boolean;
  hasData: boolean;
}

function list(v: unknown, path: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v))
    fail(path, "invalid_legacy_shape", "expected an array");
  return v;
}

function strList(v: unknown, path: string): string[] {
  return list(v, path).map((x, i) => {
    if (typeof x !== "string") {
      fail(`${path}[${i}]`, "invalid_legacy_shape", "expected a string");
    }
    return x;
  });
}

function record<T>(
  v: unknown,
  path: string,
  check: (x: unknown) => x is T,
  expected: string
): Record<string, T> {
  if (v === undefined || v === null) return {};
  if (!isRec(v)) fail(path, "invalid_legacy_shape", "expected an object");
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!check(x)) fail(`${path}.${k}`, "invalid_legacy_shape", expected);
    out[k] = x;
  }
  return out;
}

const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isCount = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

function readScopeLegacy(scope: Scope): ScopeLegacy {
  const h = scope.turnHolder ?? {};
  const hp = scope.turnHolderPath;
  const mirageRaw = list(
    h.mirageSetCountExemptionsUsed,
    `${hp}.mirageSetCountExemptionsUsed`
  );
  const mirage = mirageRaw.map((entry, index) => {
    const at = `${hp}.mirageSetCountExemptionsUsed[${index}]`;
    if (!isRec(entry) || !str(entry.playerId) || !str(entry.cardNo)) {
      fail(at, "invalid_legacy_shape", "expected {playerId, cardNo}");
    }
    return {
      playerId: str(entry.playerId)!,
      cardNo: str(entry.cardNo)!,
      index,
    };
  });
  // 最古の版は cardNo を持たないプレイヤー単位。新しい配列が無いときだけ意味を持つ。
  const ancient =
    "mirageSetCountExemptionsUsed" in h
      ? []
      : strList(
          h.mirageSetCountExemptionUsedPlayerIds,
          `${hp}.mirageSetCountExemptionUsedPlayerIds`
        );
  const legacy: ScopeLegacy = {
    usageRecords: list(
      scope.holder.effectUsageRecords,
      `${scope.holderPath}.effectUsageRecords`
    ),
    occurrenceRecords: list(
      scope.holder.effectOccurrenceRecords,
      `${scope.holderPath}.effectOccurrenceRecords`
    ),
    divine: strList(
      h.usedDivineSkillKeysThisTurn,
      `${hp}.usedDivineSkillKeysThisTurn`
    ),
    trashAdvent: strList(
      h.usedTrashAdventKeysThisTurn,
      `${hp}.usedTrashAdventKeysThisTurn`
    ),
    altAdvent: strList(
      h.usedAlternateCostAdventKeysThisTurn,
      `${hp}.usedAlternateCostAdventKeysThisTurn`
    ),
    declareAdvent: strList(
      h.usedAdventDeclareKeysThisTurn,
      `${hp}.usedAdventDeclareKeysThisTurn`
    ),
    countGain: strList(
      h.countGainModifierConsumedThisTurn,
      `${hp}.countGainModifierConsumedThisTurn`
    ),
    additionalGrants: strList(
      h.pendingAdditionalAttackGrants,
      `${hp}.pendingAdditionalAttackGrants`
    ),
    tapless: strList(
      h.usedTaplessBattleDeclareInstanceIdsThisTurn,
      `${hp}.usedTaplessBattleDeclareInstanceIdsThisTurn`
    ),
    mirage,
    ancientMiragePlayers: ancient,
    declareGimmick: record(
      h.declareGimmickGateUsedThisTurn,
      `${hp}.declareGimmickGateUsedThisTurn`,
      isBool,
      "expected a boolean"
    ),
    useCostGate: record(
      h.lifeDamageInterceptionUseCostGateUsedThisTurn,
      `${hp}.lifeDamageInterceptionUseCostGateUsedThisTurn`,
      isBool,
      "expected a boolean"
    ),
    effectLifeReduction: record(
      h.effectLifeReductionThisTurn,
      `${hp}.effectLifeReductionThisTurn`,
      isCount,
      "expected a non-negative integer"
    ),
    declarationCount: record(
      h.declarationCountThisTurn,
      `${hp}.declarationCountThisTurn`,
      isCount,
      "expected a non-negative integer"
    ),
    lifeReductionCapped: record(
      h.lifeReductionCappedThisTurn,
      `${hp}.lifeReductionCappedThisTurn`,
      isCount,
      "expected a non-negative integer"
    ),
    filteredLifeReduction: record(
      h.filteredLifeReductionCappedThisTurn,
      `${hp}.filteredLifeReductionCappedThisTurn`,
      isCount,
      "expected a non-negative integer"
    ),
    bpThresholdLifeReduction: record(
      h.bpThresholdCappedLifeReductionThisTurn,
      `${hp}.bpThresholdCappedLifeReductionThisTurn`,
      isCount,
      "expected a non-negative integer"
    ),
    symbolAdditionRestricted: record(
      h.symbolAdditionRestrictedCountThisTurn,
      `${hp}.symbolAdditionRestrictedCountThisTurn`,
      isCount,
      "expected a non-negative integer"
    ),
    hasGrantData: false,
    hasData: false,
  };
  legacy.hasGrantData =
    legacy.additionalGrants.length > 0 ||
    (isRec(scope.attack) && Boolean(scope.attack.connectBattleGrant));
  legacy.hasData =
    legacy.usageRecords.length > 0 ||
    legacy.occurrenceRecords.length > 0 ||
    legacy.divine.length > 0 ||
    legacy.trashAdvent.length > 0 ||
    legacy.altAdvent.length > 0 ||
    legacy.declareAdvent.length > 0 ||
    legacy.countGain.length > 0 ||
    legacy.additionalGrants.length > 0 ||
    legacy.tapless.length > 0 ||
    legacy.mirage.length > 0 ||
    legacy.ancientMiragePlayers.length > 0 ||
    Object.keys(legacy.declareGimmick).length > 0 ||
    Object.keys(legacy.useCostGate).length > 0 ||
    Object.keys(legacy.effectLifeReduction).length > 0 ||
    Object.keys(legacy.declarationCount).length > 0 ||
    Object.keys(legacy.lifeReductionCapped).length > 0 ||
    Object.keys(legacy.filteredLifeReduction).length > 0 ||
    Object.keys(legacy.bpThresholdLifeReduction).length > 0 ||
    Object.keys(legacy.symbolAdditionRestricted).length > 0 ||
    legacy.hasGrantData;
  return legacy;
}

function hasLegacyAttackShape(work: Work): boolean {
  if (
    isRec(work.s.pendingConnectBattleDecision) &&
    "remainingUses" in work.s.pendingConnectBattleDecision
  ) {
    return true;
  }
  return work.scopes.some(
    (scope) => scope.attack && "connectBattleGrant" in scope.attack
  );
}

// ---------------------------------------------------------------
// 旧データの適用
// ---------------------------------------------------------------

function getDef(
  work: Work,
  id: string | undefined,
  path: string
): CardDefinition {
  if (id === undefined)
    fail(path, "definition_not_found", "definition id missing");
  if (work.defCache.has(id)) {
    const cached = work.defCache.get(id);
    if (cached) return cached;
    fail(path, "definition_not_found", id);
  }
  const lookup = work.g.ctx.getCardDefinitionById;
  if (!lookup) fail(path, "definitions_required");
  const def = lookup(id);
  work.defCache.set(id, def);
  if (!def) fail(path, "definition_not_found", id);
  return def;
}

/** 定義が引けない id は undefined (名前検索用)。定義解決そのものが無い場合は失敗。 */
function tryDef(
  work: Work,
  id: string | undefined,
  path: string
): CardDefinition | undefined {
  if (id === undefined) return undefined;
  const lookup = work.g.ctx.getCardDefinitionById;
  if (!lookup) fail(path, "definitions_required");
  return lookup(id);
}

function makeView(work: Work, scope: Scope): GameState {
  return {
    ...work.s,
    turnNumber: scope.turnNumber,
    stepOrdinalThisTurn: scope.stepOrdinal,
    step: scope.step,
    activeAttack: scope.attack as unknown as GameState["activeAttack"],
    effectAccounting: work.acc,
    log: Array.isArray(work.s.log) ? work.s.log : [],
  } as unknown as GameState;
}

/**
 * 本物の状態関数 (各機構の consume / record) を、その期間の時計を持つ view に対して実行する。
 * bucket が増えなかった場合は変換できなかったとして失敗する。
 */
function applyOnView(
  work: Work,
  scope: Scope,
  at: string,
  reason: string,
  fn: (view: GameState) => GameState
): void {
  const view = makeView(work, scope);
  const next = fn(view);
  if (next.effectAccounting.buckets === work.acc.buckets) {
    fail(
      at,
      reason,
      "the old entry could not be represented in the accounting"
    );
  }
  work.acc = next.effectAccounting;
}

function consumeInto(
  work: Work,
  constraints: readonly UsageConstraint[],
  context: UsageContext,
  amount: number,
  at: string
): void {
  const result = consumeUsage(
    work.acc,
    constraints,
    context,
    "",
    UNBOUNDED,
    amount,
    {
      receipt: false,
    }
  );
  if (!result.ok) {
    fail(at, "usage_not_representable", result.reason);
  }
  work.acc = result.accounting;
}

function counts(
  keys: readonly string[]
): Map<string, { n: number; index: number }> {
  const out = new Map<string, { n: number; index: number }>();
  keys.forEach((key, index) => {
    const current = out.get(key);
    if (current) current.n += 1;
    else out.set(key, { n: 1, index });
  });
  return out;
}

function applyLegacy(work: Work, legacy: ScopeLegacy[]): void {
  work.scopes.forEach((scope, i) => applyScope(work, scope, legacy[i]!));
}

function applyScope(work: Work, scope: Scope, l: ScopeLegacy): void {
  const hp = scope.turnHolderPath;
  const rp = scope.holderPath;
  l.usageRecords.forEach((r, i) =>
    convertUsageRecord(work, scope, r, `${rp}.effectUsageRecords[${i}]`, true)
  );
  l.occurrenceRecords.forEach((r, i) =>
    convertOccurrenceRecord(
      work,
      scope,
      r,
      `${rp}.effectOccurrenceRecords[${i}]`
    )
  );
  applyDivineKeys(work, scope, l.divine, `${hp}.usedDivineSkillKeysThisTurn`);
  applyAdventKeys(
    work,
    scope,
    "trash",
    l.trashAdvent,
    `${hp}.usedTrashAdventKeysThisTurn`
  );
  applyAdventKeys(
    work,
    scope,
    "alternate",
    l.altAdvent,
    `${hp}.usedAlternateCostAdventKeysThisTurn`
  );
  applyAdventKeys(
    work,
    scope,
    "declare",
    l.declareAdvent,
    `${hp}.usedAdventDeclareKeysThisTurn`
  );
  applyCountGain(
    work,
    scope,
    l.countGain,
    `${hp}.countGainModifierConsumedThisTurn`
  );
  applyTapless(
    work,
    scope,
    l.tapless,
    `${hp}.usedTaplessBattleDeclareInstanceIdsThisTurn`
  );
  applyMirage(work, scope, l, hp);
  applyDeclareGimmick(
    work,
    scope,
    l.declareGimmick,
    `${hp}.declareGimmickGateUsedThisTurn`
  );
  applyUseCostGate(
    work,
    scope,
    l.useCostGate,
    `${hp}.lifeDamageInterceptionUseCostGateUsedThisTurn`
  );
  applyQuantities(work, scope, l, hp);
  applyAdditionalAttackGrants(
    work,
    scope,
    l.additionalGrants,
    `${hp}.pendingAdditionalAttackGrants`
  );
}

// ----- effectUsageRecords / effectOccurrenceRecords -----

/** 旧 `isRecordInDurationScope` と同じ判定 (現在の期間に有効な記録か)。 */
function recordInScope(scope: Scope, r: Rec): boolean {
  switch (r.duration) {
    case "turn":
      return r.turnNumber === scope.turnNumber;
    case "game":
      return scope.kind === "current";
    case "step":
      return r.turnNumber === scope.turnNumber && r.step === scope.step;
    case "battle":
      return (
        r.attackId !== undefined &&
        r.attackId !== null &&
        r.attackId === (scope.attack?.attackId ?? null)
      );
    default:
      return false;
  }
}

function checkRecordShape(r: unknown, path: string): Rec {
  if (!isRec(r)) fail(path, "invalid_legacy_shape", "expected a record");
  for (const key of [
    "sourceInstanceId",
    "sourceDefinitionId",
    "effectLabel",
  ] as const) {
    if (!str(r[key]))
      fail(`${path}.${key}`, "invalid_legacy_shape", "expected a string");
  }
  if (num(r.turnNumber) === undefined) {
    fail(`${path}.turnNumber`, "invalid_legacy_shape", "expected a number");
  }
  if (!["turn", "game", "step", "battle"].includes(String(r.duration))) {
    fail(`${path}.duration`, "invalid_legacy_shape", "unknown duration");
  }
  if (!isCount(r.count) || r.count === 0) {
    fail(
      `${path}.count`,
      "invalid_legacy_shape",
      "expected a positive integer"
    );
  }
  return r;
}

/** 使用者: 記録の playerId、無ければ発揮元個体の controller (owner と一致=支配変更の証拠なし)。 */
function recordPlayer(work: Work, r: Rec, path: string): string {
  const explicit = str(r.playerId);
  if (explicit) return explicit;
  const card = work.cards.get(String(r.sourceInstanceId));
  if (!card) {
    fail(path, "usage_player_unresolvable", "the source card was not found");
  }
  const owner = str(card.ownerPlayerId);
  const controller = str(card.controllerPlayerId) ?? owner;
  if (!owner || controller !== owner) {
    fail(
      path,
      "usage_player_unresolvable",
      "the controller differs from the owner; the old player cannot be derived"
    );
  }
  return owner;
}

interface RawStep {
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  usageGroupId?: string;
  choice?: { usageLimit?: EffectUsageLimit | EffectUsageLimit[] }[];
}
interface RawEffect {
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  limitGroupId?: string;
  steps?: RawStep[];
}

function toLimits(
  v: EffectUsageLimit | readonly EffectUsageLimit[] | undefined
): EffectUsageLimit[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? [...v] : [v as EffectUsageLimit];
}

function rawEffects(def: CardDefinition): RawEffect[] {
  return (def.effects ?? []) as unknown as RawEffect[];
}

function declarationChoiceStep(effect: RawEffect): RawStep | undefined {
  return effect.steps?.find((step) => (step.choice?.length ?? 0) > 0);
}

/** `magic` ラベルは経路名で効果番号を持たない。制限付きの効果が1つに決まる定義だけ解決する。 */
function uniqueMagicEffect(def: CardDefinition, path: string): RawEffect {
  const limited = rawEffects(def).filter(
    (e) =>
      e.usageLimit !== undefined ||
      declarationChoiceStep(e)?.usageLimit !== undefined
  );
  if (limited.length !== 1) {
    fail(
      path,
      "usage_label_unresolvable",
      `magic label maps to ${limited.length} limited effects`
    );
  }
  return limited[0]!;
}

function effectOfBase(
  def: CardDefinition,
  base: string
): RawEffect | undefined {
  const m = /^effect:(\d+)$/.exec(base);
  return m ? rawEffects(def)[Number(m[1])] : undefined;
}

type LimitSpec = EffectUsageLimit | readonly EffectUsageLimit[] | undefined;

/** 経路名の基底ラベル (choice 変種の接尾辞を除いたもの) が解決した制限。 */
interface BaseLimits {
  limits: EffectUsageLimit[];
  groupId?: string;
  sourceEffect?: RawEffect;
  /** choice 変種別の制限 (choices[0] = 既定、choices[k] = choice[k-1])。 */
  variants?: LimitSpec[];
}

interface RegisteredLike {
  sourceKind?: string;
  usageLimit?: LimitSpec;
  limitGroupId?: string;
  effectIndex?: number;
  choices?: readonly { usageLimit?: LimitSpec }[];
}

function resolveBase(
  work: Work,
  def: CardDefinition,
  base: string,
  path: string
): BaseLimits | undefined {
  const fixed = Object.hasOwn(FIXED_RULE_LABEL_LIMITS, base)
    ? FIXED_RULE_LABEL_LIMITS[base]
    : undefined;
  if (fixed) return { limits: [fixed] };
  if (/^effect:\d+$/.test(base) || base === "magic") {
    const effect =
      base === "magic" ? uniqueMagicEffect(def, path) : effectOfBase(def, base);
    if (!effect) return undefined;
    const step = declarationChoiceStep(effect);
    return {
      limits: toLimits(effect.usageLimit ?? step?.usageLimit),
      ...(effect.limitGroupId !== undefined
        ? { groupId: effect.limitGroupId }
        : {}),
      sourceEffect: effect,
      ...(step
        ? {
            variants: [
              step.usageLimit,
              ...(step.choice ?? []).map((c) => c.usageLimit),
            ],
          }
        : {}),
    };
  }
  // `${sourceKind}:${registration index}` (場のカードの起動効果) / `hand_activated:${index}`。
  // index は効果番号ではなく、登録 (registration) の並びの添字。登録の生成関数が正源。
  const m = /^([a-z_]+):(\d+)$/.exec(base);
  if (!m) return undefined;
  const index = Number(m[2]);
  const registered = (
    m[1] === "hand_activated"
      ? buildHandActivatedEffectLookup([def])(def.cardNo)
      : buildFieldCardEffectLookup([def])(def.cardNo)
  )?.[index] as RegisteredLike | undefined;
  if (
    !registered ||
    (m[1] !== "hand_activated" && registered.sourceKind !== m[1])
  ) {
    return undefined;
  }
  return {
    limits: toLimits(registered.usageLimit),
    ...(registered.limitGroupId !== undefined
      ? { groupId: registered.limitGroupId }
      : {}),
    ...(registered.effectIndex !== undefined &&
    rawEffects(def)[registered.effectIndex]
      ? { sourceEffect: rawEffects(def)[registered.effectIndex]! }
      : {}),
    ...(registered.choices
      ? { variants: registered.choices.map((c) => c.usageLimit) }
      : {}),
  };
}

interface ResolvedLimits {
  limits: EffectUsageLimit[];
  groupId?: string;
  sourceEffect?: RawEffect;
}

/** ラベルから、その効果が持つ制限の一覧を定義から引く。一意に決まらなければ失敗する。 */
function limitsForLabel(
  work: Work,
  def: CardDefinition,
  label: string,
  path: string
): ResolvedLimits {
  const choice = /^(.*):choice:(\d+)$/.exec(label);
  if (choice) {
    // 変種別制限 (「ターンに1回ずつ」): 共有制限とは別ラベルで、共有groupを持たない。
    const base = resolveBase(work, def, choice[1]!, path);
    const limits = toLimits(base?.variants?.[Number(choice[2])]);
    if (!base || limits.length === 0)
      fail(path, "usage_label_unresolvable", label);
    return {
      limits,
      ...(base.sourceEffect ? { sourceEffect: base.sourceEffect } : {}),
    };
  }
  const step = /^__step:(.*):(\d+):(.+)$/.exec(label);
  if (step) {
    const stepDef = tryDef(work, step[1], path) ?? def;
    const effect = rawEffects(stepDef)[Number(step[2])];
    const tail = step[3]!;
    const rawStep = /^\d+$/.test(tail)
      ? effect?.steps?.[Number(tail)]
      : effect?.steps?.find(
          (x) => x.usageGroupId === tail && x.usageLimit !== undefined
        );
    const limits = toLimits(rawStep?.usageLimit);
    if (!effect || !rawStep || limits.length === 0) {
      fail(path, "usage_label_unresolvable", label);
    }
    return {
      limits,
      ...(rawStep.usageGroupId !== undefined
        ? { groupId: rawStep.usageGroupId }
        : {}),
      sourceEffect: effect,
    };
  }
  const base = resolveBase(work, def, label, path);
  if (!base || base.limits.length === 0)
    fail(path, "usage_label_unresolvable", label);
  return {
    limits: base.limits,
    ...(base.groupId !== undefined ? { groupId: base.groupId } : {}),
    ...(base.sourceEffect ? { sourceEffect: base.sourceEffect } : {}),
  };
}

interface ResolvedRecordSite {
  site: UsageSite;
  limits: EffectUsageLimit[];
  groupId: string | undefined;
}

function resolveRecordSite(
  work: Work,
  scope: Scope,
  r: Rec,
  path: string
): ResolvedRecordSite {
  const defId = String(r.sourceDefinitionId);
  const def = getDef(work, defId, `${path}.sourceDefinitionId`);
  const savedLabel = String(r.effectLabel);
  // The old high-count C07 branch shared this limit with effects[2].
  const label =
    defId === "BSDB01-C07" &&
    savedLabel === "effect:3" &&
    str(r.groupId) === "BSDB01-C07-advent-draw"
      ? "effect:2"
      : savedLabel;
  const view = makeView(work, scope);
  const getCardDefinitionById = work.g.ctx.getCardDefinitionById!;
  const playerId = recordPlayer(work, r, path);
  const instanceId = String(r.sourceInstanceId);
  const withRecordFacts = (site: UsageSite): UsageSite => ({
    ...site,
    ...(str(r.relatedInstanceId)
      ? { relatedInstanceId: str(r.relatedInstanceId)! }
      : {}),
    ...(str(r.triggerEventScopeKey)
      ? { triggerEventScopeKey: str(r.triggerEventScopeKey)! }
      : {}),
    ...(str(r.triggerActivationKey)
      ? { triggerActivationKey: str(r.triggerActivationKey)! }
      : {}),
  });

  // 神託 / 神技の旧ラベルは、各機構の現行の site 構築関数がそのまま識別と制限を持つ。
  const card = work.cards.get(instanceId);
  if (label === "oracle:summon_advent" || label === "placement_oracle") {
    if (!card) fail(path, "card_instance_missing", instanceId);
    const args = {
      state: view,
      grandwalker: card as never,
      definition: def,
      playerId,
      getCardDefinitionById,
    };
    const site =
      label === "placement_oracle"
        ? placementOracleUsageSite(args)
        : oracleTriggerUsageSite({ ...args, triggerKind: "summon" });
    if (!site) fail(path, "usage_label_unresolvable", label);
    return { site, limits: toLimits(site.limits), groupId: undefined };
  }
  const divine = /^divine_skill:(\d+)$/.exec(label);
  if (divine) {
    const site = divineSkillUsageSite({
      state: view,
      sourceInstanceId: instanceId,
      skillIndex: Number(divine[1]),
      getCardDefinitionById,
    });
    if (!site) fail(path, "usage_label_unresolvable", label);
    if (site.playerId !== playerId) {
      fail(
        path,
        "usage_player_unresolvable",
        "the divine skill controller differs from the record player"
      );
    }
    return { site, limits: toLimits(site.limits), groupId: undefined };
  }

  const resolved = limitsForLabel(work, def, label, path);
  if ((str(r.groupId) ?? undefined) !== (resolved.groupId ?? undefined)) {
    fail(
      path,
      "usage_record_group_mismatch",
      "the record group differs from the definition"
    );
  }
  const identity = usageIdentityOfLabel(def, defId, label);
  const site = withRecordFacts({
    state: view,
    ability: identity.ability,
    nameAbility: identity.nameAbility,
    sourceInstanceId: instanceId,
    sourceDefinitionId: defId,
    playerId,
    limits: resolved.limits,
    ...(resolved.groupId !== undefined ? { groupId: resolved.groupId } : {}),
    ...(resolved.sourceEffect
      ? {
          sourceEffect: resolved.sourceEffect as unknown as NonNullable<
            UsageSite["sourceEffect"]
          >,
        }
      : {}),
    getCardDefinitionById,
  });
  return { site, limits: resolved.limits, groupId: resolved.groupId };
}

/** 旧 `recordEffectUsageIfLimited` は制限ごとに別レコードを作った。この記録を作りうる制限か。 */
function limitProducesRecord(
  limit: EffectUsageLimit,
  groupId: string | undefined,
  r: Rec
): boolean {
  if (r.duration !== (limit.duration ?? "turn")) return false;
  if ((str(r.groupId) ?? undefined) !== (groupId ?? undefined)) return false;
  const perSubject = limit.kind === "per_trigger_related_instance";
  const noDuplicate = limit.kind === "no_duplicate";
  const perActivation = limit.kind === "per_trigger_activation";
  if (!perSubject && r.relatedInstanceId !== undefined) return false;
  if (!noDuplicate && r.triggerEventScopeKey !== undefined) return false;
  if (!perActivation && r.triggerActivationKey !== undefined) return false;
  return true;
}

/** 記録時の事実 (世代・時計) を持つ文脈。同名/個体/主語の共有キーは記録時の世代で作る。 */
function recordContext(site: UsageSite, r: Rec, scope: Scope): UsageContext {
  const base = usageContextOf(site);
  return {
    ...base,
    sourceFieldGeneration: num(r.sourceFieldInstanceGeneration) ?? 0,
    sourceSoulGeneration: num(r.sourceSoulStateGeneration) ?? 0,
    ...(str(r.relatedInstanceId)
      ? {
          subjectInstanceId: str(r.relatedInstanceId)!,
          subjectFieldGeneration: num(r.relatedFieldInstanceGeneration) ?? 0,
        }
      : {}),
    clock: {
      turnId: Number(r.turnNumber),
      stepId: scope.stepOrdinal,
      battleId: str(scope.attack?.attackId) ?? null,
    },
  };
}

/**
 * 旧 effectUsageRecords の1件を台帳へ変換する。旧は制限ごとに別レコードで、同じ duration の制限が
 * 複数あると1回の使用で count が複数加算されていた (H3)。制限数 m で割り、割り切れなければ失敗する。
 */
function convertUsageRecord(
  work: Work,
  scope: Scope,
  raw: unknown,
  path: string,
  keep: boolean
): void {
  const r = checkRecordShape(raw, path);
  if (!recordInScope(scope, r)) return; // 期限切れ: 情報損失ではない
  const resolved = resolveRecordSite(work, scope, r, path);
  const matched = resolved.limits
    .map((_, i) => i)
    .filter((i) =>
      limitProducesRecord(resolved.limits[i]!, resolved.groupId, r)
    );
  if (matched.length === 0) fail(path, "usage_record_matches_no_limit");
  const count = r.count as number;
  if (count % matched.length !== 0) {
    fail(
      path,
      "usage_record_count_not_divisible",
      `count ${count} is not a multiple of ${matched.length} matching limits`
    );
  }
  const constraints = usageConstraintsOf(resolved.site);
  const context = recordContext(resolved.site, r, scope);
  consumeInto(
    work,
    matched.map((i) => constraints[i]!),
    context,
    count / matched.length,
    path
  );
  if (keep) {
    work.converted.push({
      record: r,
      scope,
      limits: resolved.limits,
      constraints,
      matched,
      context,
    });
  }
}

function convertOccurrenceRecord(
  work: Work,
  scope: Scope,
  raw: unknown,
  path: string
): void {
  const r = checkRecordShape(raw, path);
  if (!recordInScope(scope, r)) return;
  const playerId = recordPlayer(work, r, path);
  const count = r.count as number;
  for (let i = 0; i < count; i++) {
    applyOnView(work, scope, path, "occurrence_not_representable", (view) =>
      recordEffectOccurrence({
        state: view,
        sourceInstanceId: String(r.sourceInstanceId),
        sourceDefinitionId: String(r.sourceDefinitionId),
        effectLabel: String(r.effectLabel),
        duration: r.duration as "turn" | "game" | "step" | "battle",
        ...(str(r.groupId) ? { groupId: str(r.groupId)! } : {}),
        playerId,
      })
    );
  }
}

// ----- I01 神技 -----

type DivineKey =
  | { form: "instance"; instanceId: string; index: number }
  | { form: "name"; playerId: string; cardNo: string; index: number };

function parseDivineKey(work: Work, key: string, at: string): DivineKey {
  const last = key.lastIndexOf(":");
  const index = Number(key.slice(last + 1));
  if (last <= 0 || !Number.isInteger(index) || index < 0) {
    fail(at, "divine_skill_key_unparsable");
  }
  const head = key.slice(0, last);
  if (work.cards.has(head))
    return { form: "instance", instanceId: head, index };
  const colon = head.indexOf(":");
  if (colon > 0 && work.players.includes(head.slice(0, colon))) {
    return {
      form: "name",
      playerId: head.slice(0, colon),
      cardNo: head.slice(colon + 1),
      index,
    };
  }
  return fail(at, "divine_skill_key_unparsable");
}

function applyDivineKeys(
  work: Work,
  scope: Scope,
  keys: string[],
  path: string
): void {
  for (const [key, { n, index }] of counts(keys)) {
    const at = `${path}[${index}]`;
    const parsed = parseDivineKey(work, key, at);
    let card: Rec | undefined;
    if (parsed.form === "instance") {
      card = work.cards.get(parsed.instanceId);
      const owner = str(card?.ownerPlayerId);
      // 神技(once)の旧キーは使用者を持たない。支配変更の証拠が無い(controller = owner)ときだけ導出する。
      if (
        !card ||
        !owner ||
        (str(card.controllerPlayerId) ?? owner) !== owner
      ) {
        fail(at, "divine_skill_player_unresolvable");
      }
    } else {
      card = work.cardList
        .filter(
          (c) =>
            c.definitionId === parsed.cardNo &&
            c.controllerPlayerId === parsed.playerId
        )
        .sort(
          (a, b) => Number(b.zone === "field") - Number(a.zone === "field")
        )[0];
      if (!card) fail(at, "divine_skill_player_unresolvable");
    }
    const def = getDef(work, str(card.definitionId), at);
    if (!def.grandwalkerData?.divineSkills?.[parsed.index]) {
      fail(at, "divine_skill_not_found");
    }
    const view = makeView(work, scope);
    const getCardDefinitionById = work.g.ctx.getCardDefinitionById!;
    const args = {
      state: view,
      sourceInstanceId: String(card.instanceId),
      skillIndex: parsed.index,
      getCardDefinitionById,
    };
    const site = divineSkillUsageSite(args);
    if (site) {
      const limits = toLimits(site.limits);
      const constraints = usageConstraintsOf(site);
      const turnLimited = limits
        .map((_, i) => i)
        .filter((i) => (limits[i]!.duration ?? "turn") === "turn");
      const wantedKind =
        parsed.form === "instance" ? "per_instance" : "per_card_name";
      const applicable = turnLimited.filter(
        (i) => limits[i]!.kind === wantedKind
      );
      if (turnLimited.length > 0 && applicable.length === 0) {
        fail(at, "divine_skill_limit_mismatch");
      }
      // turn 期間の制限が無い技の旧キーは、読まれない書込みだった。回数枠には載せない。
      if (applicable.length > 0) {
        consumeInto(
          work,
          applicable.map((i) => constraints[i]!),
          usageContextOf(site),
          n,
          at
        );
      }
    }
    // 宣言の観測は、制限の有無に関わらず旧キーの件数ぶん記録されていた (神技使用数の正源)。
    const observation = divineSkillDeclarationObservationSite({
      ...args,
      state: makeView(work, scope),
    });
    if (observation?.constraints) {
      consumeInto(
        work,
        observation.constraints,
        usageContextOf(observation),
        n,
        at
      );
    }
  }
}

// ----- I02〜I04 煌臨 -----

function ownersOf(
  work: Work,
  predicate: (card: Rec, def: CardDefinition | undefined) => boolean,
  at: string
) {
  const owners = new Set<string>();
  let controlledByNonOwner = false;
  for (const card of work.cardList) {
    const def = tryDef(work, str(card.definitionId), at);
    if (!predicate(card, def)) continue;
    const owner = str(card.ownerPlayerId);
    if (owner) owners.add(owner);
    if ((str(card.controllerPlayerId) ?? owner) !== owner)
      controlledByNonOwner = true;
  }
  return { owners, controlledByNonOwner };
}

/**
 * 使用者を含まない旧キー (`name:` / cardNo) の使用者。その名前のカードを所有するプレイヤーが
 * 1人だけで、他者が操作している個体も無いときだけ一意に決める。決まらなければ失敗する。
 */
function uniqueUser(
  work: Work,
  predicate: (card: Rec, def: CardDefinition | undefined) => boolean,
  at: string
): string {
  const { owners, controlledByNonOwner } = ownersOf(work, predicate, at);
  if (owners.size !== 1 || controlledByNonOwner) {
    fail(
      at,
      "advent_user_unresolvable",
      "the old key does not contain the player"
    );
  }
  return [...owners][0]!;
}

function findCardByName(
  work: Work,
  name: string,
  userId: string | undefined,
  at: string,
  accept: (def: CardDefinition) => boolean = () => true
): { card: Rec; def: CardDefinition } {
  let found: { card: Rec; def: CardDefinition } | undefined;
  for (const card of work.cardList) {
    const def = tryDef(work, str(card.definitionId), at);
    if (!def || def.name !== name || !accept(def)) continue;
    if (
      !found ||
      (userId !== undefined &&
        card.ownerPlayerId === userId &&
        found.card.ownerPlayerId !== userId)
    ) {
      found = { card, def };
    }
  }
  if (!found)
    fail(at, "advent_definition_unresolvable", "no card with the old name");
  return found;
}

function applyAdventKeys(
  work: Work,
  scope: Scope,
  group: "trash" | "alternate" | "declare",
  keys: string[],
  path: string
): void {
  for (const [key, { n, index }] of counts(keys)) {
    const at = `${path}[${index}]`;
    let kind: AdventUsageKind;
    let actingPlayerId: string;
    let target: { card: Rec; def: CardDefinition };
    if (group === "trash" && !key.includes(":")) {
      // adventData.adventSourceZone:"trash" の旧キー (cardNo のみ。使用者を含まない)。
      kind = "trash_source";
      const def = getDef(work, key, at);
      actingPlayerId = uniqueUser(
        work,
        (card) => card.definitionId === key,
        at
      );
      const card = work.cardList.find(
        (c) => c.definitionId === key && c.ownerPlayerId === actingPlayerId
      );
      if (!card) fail(at, "advent_definition_unresolvable");
      target = { card, def };
    } else if (group === "trash") {
      // trashAdventHostGrant の旧キー `{player}:{名前}` は使用者付き。
      const colon = key.indexOf(":");
      actingPlayerId = key.slice(0, colon);
      if (!work.players.includes(actingPlayerId))
        fail(at, "advent_user_unresolvable");
      kind = "trash_host";
      target = findCardByName(work, key.slice(colon + 1), actingPlayerId, at);
    } else {
      if (!key.startsWith("name:")) fail(at, "advent_key_unparsable");
      const name = key.slice("name:".length);
      kind = group === "declare" ? "declare" : "alternate_cost";
      const accept = (def: CardDefinition): boolean =>
        group !== "declare" || def.adventData?.declareUsageLimit !== undefined;
      actingPlayerId = uniqueUser(
        work,
        (_card, def) => def !== undefined && def.name === name && accept(def),
        at
      );
      target = findCardByName(work, name, actingPlayerId, at, accept);
    }
    const site = adventUsageSite({
      state: makeView(work, scope),
      kind,
      actingPlayerId,
      instanceId: String(target.card.instanceId),
      definition: target.def,
      getCardDefinitionById: work.g.ctx.getCardDefinitionById!,
    });
    const constraints = usageConstraintsOf(site);
    if (constraints.length === 0) fail(at, "advent_definition_unresolvable");
    consumeInto(work, constraints, usageContextOf(site), n, at);
  }
}

// ----- I05〜I07・I10 専用の枠 -----

function onceKeys(keys: readonly string[]): { key: string; index: number }[] {
  return [...counts(keys)].map(([key, { index }]) => ({ key, index }));
}

function applyCountGain(
  work: Work,
  scope: Scope,
  keys: string[],
  path: string
): void {
  for (const { key, index } of onceKeys(keys)) {
    const at = `${path}[${index}]`;
    const colon = key.indexOf(":");
    const playerId = key.slice(0, colon);
    const definitionId = key.slice(colon + 1);
    if (colon <= 0 || !work.players.includes(playerId) || !definitionId) {
      fail(at, "count_gain_key_unparsable");
    }
    const instance = work.cardList.find((c) => c.definitionId === definitionId);
    applyOnView(work, scope, at, "usage_not_representable", (view) =>
      consumeCountGainModifier(
        view,
        {
          sourceInstanceId: str(instance?.instanceId) ?? "",
          sourceDefinitionId: definitionId,
        },
        playerId
      )
    );
  }
}

function applyTapless(
  work: Work,
  scope: Scope,
  ids: string[],
  path: string
): void {
  for (const { key, index } of onceKeys(ids)) {
    const at = `${path}[${index}]`;
    if (!work.cards.has(key)) fail(at, "card_instance_missing");
    applyOnView(work, scope, at, "usage_not_representable", (view) =>
      consumeTaplessBattleDeclareBudget(view, key)
    );
  }
}

function applyMirage(
  work: Work,
  scope: Scope,
  l: ScopeLegacy,
  hp: string
): void {
  const seen = new Set<string>();
  const use = (playerId: string, cardNo: string, at: string): void => {
    const id = JSON.stringify([playerId, cardNo]);
    if (seen.has(id)) return;
    seen.add(id);
    applyOnView(work, scope, at, "usage_not_representable", (view) =>
      consumeMirageSetCountExemption({ state: view, playerId, cardNo })
    );
  };
  for (const entry of l.mirage) {
    // cardNo="*" は旧版のプレイヤー単位の免除消費。特定のカード名に捏造せず、期限まで維持する。
    use(
      entry.playerId,
      entry.cardNo === "*" ? LEGACY_PLAYER_WIDE_MIRAGE_EXEMPTION : entry.cardNo,
      `${hp}.mirageSetCountExemptionsUsed[${entry.index}]`
    );
  }
  l.ancientMiragePlayers.forEach((playerId, i) =>
    use(
      playerId,
      LEGACY_PLAYER_WIDE_MIRAGE_EXEMPTION,
      `${hp}.mirageSetCountExemptionUsedPlayerIds[${i}]`
    )
  );
}

function allContinuousEffects(work: Work): Rec[] {
  const out: Rec[] = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v)) out.push(...v.filter(isRec));
  };
  push(work.s.activeContinuousEffects);
  for (const scope of work.scopes)
    push(scope.holder.suspendedContinuousEffects);
  return out;
}

/** `${player}:${ceId}` 形式の旧キーを分解し、CE を引く。消えた CE は勝手に捨てず失敗する。 */
function splitCeKey(
  work: Work,
  key: string,
  at: string
): { playerId: string; ce: Rec } {
  const colon = key.indexOf(":");
  const playerId = key.slice(0, colon);
  if (colon <= 0 || !work.players.includes(playerId)) {
    fail(at, "continuous_effect_key_unparsable");
  }
  const ceId = key.slice(colon + 1);
  const ce = allContinuousEffects(work).find((c) => c.effectId === ceId);
  if (!ce)
    fail(
      at,
      "continuous_effect_missing",
      "the continuous effect no longer exists"
    );
  return { playerId, ce };
}

/**
 * 宣言ギミックゲートの能力識別。登録時に載せた構造path (metadata.usageAbility) を優先し、
 * 無い手組み CE だけ provenance から導く。コアの列挙 (declareGimmickGateSourceOf) と同じ写像。
 */
function declareGimmickAbilityOfCe(
  ce: Rec,
  protectedPlayerId: string
): AbilityRef {
  const stored = isRec(ce.metadata)
    ? (ce.metadata.usageAbility as AbilityRef | undefined)
    : undefined;
  return (
    stored ??
    declareGimmickGateAbilityRef(
      String(ce.sourceDefinitionId),
      isRec(ce.provenance)
        ? (ce.provenance as { effectIndex: number; stepIndex: number })
        : undefined,
      protectedPlayerId
    )
  );
}

function applyDeclareGimmick(
  work: Work,
  scope: Scope,
  used: Record<string, boolean>,
  path: string
): void {
  for (const [index, [key, flag]] of Object.entries(used).entries()) {
    if (!flag) continue;
    // 辞書キー (プレイヤーID:効果ID) は path に埋めない (失敗の path は構造だけにする契約)。
    const at = `${path}[${index}]`;
    const { playerId, ce } = splitCeKey(work, key, at);
    applyOnView(work, scope, at, "usage_not_representable", (view) =>
      consumeDeclareGimmickGate(view, playerId, {
        sourceInstanceId: String(ce.sourceInstanceId),
        sourceDefinitionId: String(ce.sourceDefinitionId),
        ability: declareGimmickAbilityOfCe(ce, playerId),
      })
    );
  }
}

function applyUseCostGate(
  work: Work,
  scope: Scope,
  used: Record<string, boolean>,
  path: string
): void {
  for (const [index, [key, flag]] of Object.entries(used).entries()) {
    if (!flag) continue;
    // 辞書キー (プレイヤーID:個体ID) は path に埋めない (失敗の path は構造だけにする契約)。
    const at = `${path}[${index}]`;
    const colon = key.indexOf(":");
    const playerId = key.slice(0, colon);
    const instanceId = key.slice(colon + 1);
    if (colon <= 0 || !work.players.includes(playerId)) {
      fail(at, "use_cost_gate_key_unparsable");
    }
    if (!work.cards.has(instanceId)) fail(at, "card_instance_missing");
    applyOnView(work, scope, at, "usage_not_representable", (view) =>
      recordUseCostGatePaid(view, playerId, instanceId)
    );
  }
}

// ----- I13〜I15 数量・宣言事実 -----

function playerKey(work: Work, key: string, at: string): string {
  if (!work.players.includes(key)) fail(at, "quantity_player_unresolvable");
  return key;
}

function applyQuantities(
  work: Work,
  scope: Scope,
  l: ScopeLegacy,
  hp: string
): void {
  for (const [key, amount] of Object.entries(l.effectLifeReduction)) {
    const at = `${hp}.effectLifeReductionThisTurn.${key}`;
    const playerId = playerKey(work, key, at);
    if (amount > 0) {
      applyOnView(work, scope, at, "usage_not_representable", (view) =>
        recordLifeReductionQuantities(view, { playerId, effectCause: amount })
      );
    }
  }
  for (const [key, amount] of Object.entries(l.lifeReductionCapped)) {
    const at = `${hp}.lifeReductionCappedThisTurn.${key}`;
    const playerId = playerKey(work, key, at);
    if (amount > 0) {
      applyOnView(work, scope, at, "usage_not_representable", (view) =>
        recordLifeReductionQuantities(view, { playerId, cappedTotal: amount })
      );
    }
  }
  for (const [key, amount] of Object.entries(l.bpThresholdLifeReduction)) {
    const at = `${hp}.bpThresholdCappedLifeReductionThisTurn.${key}`;
    const playerId = playerKey(work, key, at);
    if (amount > 0) {
      applyOnView(work, scope, at, "usage_not_representable", (view) =>
        recordLifeReductionQuantities(view, { playerId, bpThreshold: amount })
      );
    }
  }
  for (const [key, amount] of Object.entries(l.filteredLifeReduction)) {
    const at = `${hp}.filteredLifeReductionCappedThisTurn.${key}`;
    const { playerId, ce } = splitCeKey(work, key, at);
    if (amount > 0) {
      const source = ceQuantitySourceOf(ce as never, "life_turn_cap", playerId);
      applyOnView(work, scope, at, "usage_not_representable", (view) =>
        recordLifeReductionQuantities(view, {
          playerId,
          filtered: [{ source, amount }],
        })
      );
    }
  }
  for (const [key, amount] of Object.entries(l.symbolAdditionRestricted)) {
    const at = `${hp}.symbolAdditionRestrictedCountThisTurn.${key}`;
    const { playerId, ce } = splitCeKey(work, key, at);
    if (amount > 0) {
      const source = ceQuantitySourceOf(
        ce as never,
        "symbol_restriction",
        playerId
      );
      applyOnView(work, scope, at, "usage_not_representable", (view) =>
        recordSymbolAdditionRestrictedCount(view, playerId, source, amount)
      );
    }
  }
  for (const [key, amount] of Object.entries(l.declarationCount)) {
    const at = `${hp}.declarationCountThisTurn.${key}`;
    const playerId = playerKey(work, key, at);
    for (let i = 0; i < amount; i++) {
      applyOnView(work, scope, at, "usage_not_representable", (view) =>
        recordGimmickDeclaration(view, playerId)
      );
    }
  }
}

// ----- I11 追加アタック権 / I12 コネクトバトル権 -----

/** 由来不明の旧権利。通常能力の共有枠に混ぜないよう、由来を「legacy」と明示した sourceRef で付与する。 */
function legacyGrantSource(kind: string) {
  return makeAbilityRef("rule", kind, "legacy");
}

function grantPlayer(work: Work, instanceId: string, at: string): string {
  const card = work.cards.get(instanceId);
  const player = str(card?.controllerPlayerId) ?? str(card?.ownerPlayerId);
  if (!card || !player)
    fail(at, "card_instance_missing", "the grant source card was not found");
  return player;
}

function applyAdditionalAttackGrants(
  work: Work,
  scope: Scope,
  ids: string[],
  path: string
): void {
  ids.forEach((instanceId, i) => {
    const at = `${path}[${i}]`;
    const playerId = grantPlayer(work, instanceId, at);
    const view = makeView(work, scope);
    const result = grantUsageOnState(view, {
      grantKind: ADDITIONAL_ATTACK_GRANT_KIND,
      playerId,
      subjectInstanceId: instanceId,
      sourceRef: legacyGrantSource(ADDITIONAL_ATTACK_GRANT_KIND),
      total: 1,
      period: "turn",
      originKey: `legacy-additional-attack:${scope.turnNumber}:${i}`,
    });
    if (!result.ok) fail(at, "grant_not_representable", result.reason);
    work.acc = result.state.effectAccounting;
  });
}

/** activeAttack.connectBattleGrant と pendingConnectBattleDecision.remainingUses を新形式へ。 */
function applyAttackShapes(work: Work): void {
  for (const scope of work.scopes) {
    const attack = scope.attack;
    if (!attack || !("connectBattleGrant" in attack)) continue;
    const at = `${scope.kind === "current" ? work.path : scope.holderPath}.activeAttack.connectBattleGrant`;
    const legacy = attack.connectBattleGrant;
    delete attack.connectBattleGrant;
    if (legacy === undefined || legacy === null) continue;
    const attackId = str(attack.attackId);
    if (
      !isRec(legacy) ||
      !str(legacy.sourceInstanceId) ||
      !isCount(legacy.remainingUses) ||
      !attackId
    ) {
      fail(
        at,
        "invalid_legacy_shape",
        "expected {sourceInstanceId, remainingUses}"
      );
    }
    const playerId = grantPlayer(work, String(legacy.sourceInstanceId), at);
    const view = makeView(work, scope);
    const result = grantUsageOnState(view, {
      grantKind: CONNECT_BATTLE_GRANT_KIND,
      playerId,
      subjectInstanceId: String(legacy.sourceInstanceId),
      sourceRef: legacyGrantSource(CONNECT_BATTLE_GRANT_KIND),
      total: legacy.remainingUses,
      period: "battle",
      originKey: `legacy-connect-battle:${attackId}`,
    });
    if (!result.ok) fail(at, "grant_not_representable", result.reason);
    work.acc = result.state.effectAccounting;
    attack.connectBattleGrantId = result.grantId;
    // 決定待ちが同じ権利を指す (旧: 開いた時点の残量の複写)。
    const pending = work.s.pendingConnectBattleDecision;
    if (
      scope.kind === "current" &&
      isRec(pending) &&
      "remainingUses" in pending
    ) {
      if (
        pending.attackId !== attackId ||
        pending.remainingUses !== legacy.remainingUses
      ) {
        fail(
          `${work.path}.pendingConnectBattleDecision`,
          "connect_battle_inconsistent",
          "the pending decision does not match the active attack grant"
        );
      }
      delete pending.remainingUses;
      pending.grantId = result.grantId;
      pending.pendingId = `connect-battle:${attackId}:${result.grantId}:0`;
    }
  }
  const pending = work.s.pendingConnectBattleDecision;
  if (isRec(pending) && "remainingUses" in pending) {
    fail(
      `${work.path}.pendingConnectBattleDecision`,
      "connect_battle_inconsistent",
      "the pending decision has no active attack grant"
    );
  }
}

// ---------------------------------------------------------------
// 旧キーの除去と会計の確定
// ---------------------------------------------------------------

function stripLegacy(work: Work): void {
  for (const scope of work.scopes) {
    for (const key of LEGACY_RECORD_LIST_KEYS) delete scope.holder[key];
    const turn = scope.turnHolder;
    if (!turn) continue;
    for (const key of LEGACY_TURN_KEYS) delete turn[key];
    // 退避した今ターン文脈は、ステップ序数を持つ (旧は現在のステップが序数0)。
    if (
      scope.kind === "suspended" &&
      typeof turn.stepOrdinalThisTurn !== "number"
    ) {
      turn.stepOrdinalThisTurn = 0;
    }
  }
}

function finalizeAccounting(work: Work): EffectAccounting {
  return {
    version: 1,
    nextOperationSeq: 0,
    buckets: work.acc.buckets,
    grants: work.acc.grants,
    // 専用関数の消費が採番した一時の操作は捨て、取消に使う合成 receipt だけを持つ。
    operations: work.ops,
  };
}

/** 新旧両方がある入力の等価性: 使用量 (bucket) と権利 (grant) が一致するときだけ等価。 */
function accountingEquivalent(
  converted: EffectAccounting,
  existing: EffectAccounting
): boolean {
  const amounts = (acc: EffectAccounting): string =>
    JSON.stringify(acc.buckets.map((b) => [b.key, b.amount, b.measure]).sort());
  const grants = (acc: EffectAccounting): string =>
    JSON.stringify(acc.grants.map((g) => [g.grantId, g.total]).sort());
  return (
    amounts(converted) === amounts(existing) &&
    grants(converted) === grants(existing)
  );
}

// ---------------------------------------------------------------
// 型グラフの訪問: 入れ子の GameState と運搬フィールド (receipt)
// ---------------------------------------------------------------

function walk(
  work: Work,
  value: unknown,
  typeName: string,
  scope: Scope,
  path: string
): void {
  if (!isRec(value)) return;
  const node = NESTED_STATE_GRAPH[typeName];
  if (!node) return;
  const seen = work.g.visited.get(value) ?? new Set<string>();
  if (seen.has(typeName)) return;
  seen.add(typeName);
  work.g.visited.set(value, seen);

  // 追加ターンの退避文脈は、中断元の期間に属する。
  const inScope =
    typeName === "ExtraTurnState.returnContext"
      ? (work.scopes.find((sc) => sc.holder === value) ?? scope)
      : scope;

  for (const carrier of node.carriers) {
    convertCarrier(work, value, carrier, inScope, path);
  }
  if (typeName === "PendingLifeDamageDiscardChoice") {
    convertLifeDamageDiscardChoice(work, value, path);
  }
  for (const edge of node.edges) {
    const child = value[edge.prop];
    if (child === undefined || child === null) continue;
    const items = Array.isArray(child) ? child : [child];
    items.forEach((item, i) => {
      const at = Array.isArray(child)
        ? `${path}.${edge.prop}[${i}]`
        : `${path}.${edge.prop}`;
      for (const target of edge.targets) {
        if (target === "GameState") {
          if (isRec(item)) convertState(item, at, work.g);
        } else {
          walk(work, item, target, inScope, at);
        }
      }
    });
  }
}

/**
 * 旧版の選択待ち (pendingLifeDamageDiscardChoice) が持つ能力の識別を、現在の形へ移す。
 * - `turnCapConsumption.filteredEffectIds` (継続効果の連番) は、効果元の能力 (`filteredSources`) へ。
 *   旧 state の数量バケットを移すのと同じ導出 (`ceQuantitySourceOf`) を使う。
 * - `declare_gimmick` の entry が `usageAbility` を持たない旧形式は、継続効果から能力を導く
 *   (列挙側が使う `declareGimmickAbilityOfCe` と同じ写像)。
 * 継続効果が消えていれば推測せず、元の場所を示して失敗する。
 */
function convertLifeDamageDiscardChoice(
  work: Work,
  holder: Rec,
  path: string
): void {
  const playerId = str(holder.decidingPlayerId);
  const consumption = holder.turnCapConsumption;
  if (isRec(consumption) && consumption.filteredEffectIds !== undefined) {
    const at = `${path}.turnCapConsumption.filteredEffectIds`;
    if (work.hasAccounting || consumption.filteredSources !== undefined) {
      fail(
        at,
        "legacy_new_conflict",
        "old turn-cap effect ids in a state that already has the new form"
      );
    }
    if (playerId === undefined || !work.players.includes(playerId)) {
      fail(at, "quantity_player_unresolvable");
    }
    const sources = list(consumption.filteredEffectIds, at).map((id, i) => {
      if (typeof id !== "string") {
        fail(`${at}[${i}]`, "invalid_legacy_shape", "expected a string");
      }
      const { ce } = splitCeKey(work, `${playerId}:${id}`, `${at}[${i}]`);
      return ceQuantitySourceOf(ce as never, "life_turn_cap", playerId);
    });
    delete consumption.filteredEffectIds;
    if (sources.length > 0) consumption.filteredSources = sources;
  }
  if (work.hasAccounting || !Array.isArray(holder.entries)) return;
  holder.entries.forEach((entry: unknown, i: number) => {
    if (
      !isRec(entry) ||
      entry.costKind !== "declare_gimmick" ||
      entry.usageAbility !== undefined
    ) {
      return;
    }
    const at = `${path}.entries[${i}]`;
    const ceId = str(entry.ceEffectId);
    const ce = allContinuousEffects(work).find((c) => c.effectId === ceId);
    if (!ce || playerId === undefined || !work.players.includes(playerId)) {
      fail(
        at,
        "continuous_effect_missing",
        "the continuous effect of the pending gimmick gate no longer exists"
      );
    }
    entry.usageAbility = declareGimmickAbilityOfCe(ce, playerId);
  });
}

function convertCarrier(
  work: Work,
  holder: Rec,
  carrier: NestedStateCarrier,
  scope: Scope,
  path: string
): void {
  if (carrier === "recordedUsage") {
    const value = holder.recordedUsage;
    if (value === undefined || value === null) return;
    if (!isRec(value)) fail(`${path}.recordedUsage`, "invalid_legacy_shape");
    if (Array.isArray(value.operationIds)) return;
    if (work.hasAccounting) {
      fail(
        `${path}.recordedUsage`,
        "legacy_new_conflict",
        "old receipt in a state that has effectAccounting"
      );
    }
    holder.recordedUsage = convertRecordedUsage(
      work,
      scope,
      value,
      sourceHints(holder),
      `${path}.recordedUsage`
    );
    return;
  }
  if (carrier === "refundableUsage") {
    const legacy = holder.refundableUsageEntries;
    if (legacy === undefined) return;
    const at = `${path}.refundableUsageEntries`;
    if (work.hasAccounting) {
      fail(
        at,
        "legacy_new_conflict",
        "old receipt in a state that has effectAccounting"
      );
    }
    const entries = list(legacy, at);
    delete holder.refundableUsageEntries;
    if (entries.length === 0) return;
    const [first, ...rest] = entries;
    if (!isRec(first)) fail(`${at}[0]`, "invalid_legacy_shape");
    holder.refundableUsage = convertRecordedUsage(
      work,
      scope,
      { ...first, ...(rest.length > 0 ? { extraRecords: rest } : {}) },
      sourceHints(holder),
      at
    );
    return;
  }
  const rollback = holder.normalHandPlayRollback;
  if (!isRec(rollback)) return;
  const usageDeltas = rollback.declarationUsageDeltas;
  const occurrenceDeltas = rollback.declarationOccurrenceDeltas;
  if (usageDeltas === undefined && occurrenceDeltas === undefined) return;
  const at = `${path}.normalHandPlayRollback`;
  if (work.hasAccounting) {
    fail(
      at,
      "legacy_new_conflict",
      "old declaration deltas in a state that has effectAccounting"
    );
  }
  const deltas = new Map<string, number>();
  const collect = (run: () => void): void => {
    const saved = work.acc;
    work.acc = createEmptyEffectAccounting();
    try {
      run();
      for (const bucket of work.acc.buckets) {
        deltas.set(bucket.key, (deltas.get(bucket.key) ?? 0) + bucket.amount);
      }
    } finally {
      work.acc = saved;
    }
  };
  list(usageDeltas, `${at}.declarationUsageDeltas`).forEach((r, i) =>
    collect(() =>
      convertUsageRecord(
        work,
        scope,
        r,
        `${at}.declarationUsageDeltas[${i}]`,
        false
      )
    )
  );
  list(occurrenceDeltas, `${at}.declarationOccurrenceDeltas`).forEach((r, i) =>
    collect(() =>
      convertOccurrenceRecord(
        work,
        scope,
        r,
        `${at}.declarationOccurrenceDeltas[${i}]`
      )
    )
  );
  delete rollback.declarationUsageDeltas;
  delete rollback.declarationOccurrenceDeltas;
  if (deltas.size > 0) {
    const operationId = nextOperationId(work);
    work.ops.push({
      operationId,
      turnId: scope.turnNumber,
      status: "applied",
      deltas: [...deltas].map(
        ([bucketKey, delta]): UsageDelta => ({ bucketKey, delta })
      ),
    });
    const existing = Array.isArray(rollback.declarationUsageOperationIds)
      ? (rollback.declarationUsageOperationIds as string[])
      : [];
    rollback.declarationUsageOperationIds = [...existing, operationId];
  }
}

function nextOperationId(work: Work): string {
  return `legacy-op:${work.opSeq++}`;
}

const SOURCE_HINT_KEYS = [
  "effectSourceInstanceId",
  "sourceInstanceId",
  "cardInstanceId",
  "triggerCardInstanceId",
] as const;

/** 旧 refund が呼出元から受け取っていた「既定の発揮元」の候補 (親オブジェクトの発揮元フィールド)。 */
function sourceHints(holder: Rec): string[] {
  const out = new Set<string>();
  for (const key of SOURCE_HINT_KEYS) {
    const v = str(holder[key]);
    if (v) out.add(v);
  }
  return [...out];
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.entries(v as Rec)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`)
    .join(",")}}`;
}

/**
 * 旧 recordedUsage (効果ラベル・制限・共有groupを持つ払い戻し情報) を、新形式の receipt へ置き換える。
 * 旧 refund が「現在のターンとステップの最新の一致記録」から 1 ずつ戻していたのと同じ枠を差分に持つ
 * 操作を合成し、`operationIds` に載せる。枠が特定できなければ失敗する (対戦途中の読込を失敗させる)。
 */
function convertRecordedUsage(
  work: Work,
  scope: Scope,
  value: Rec,
  hints: string[],
  path: string
): Rec {
  const entries: { entry: Rec; at: string }[] = [
    { entry: value, at: path },
    ...list(value.extraRecords, `${path}.extraRecords`).map((e, i) => {
      if (!isRec(e)) fail(`${path}.extraRecords[${i}]`, "invalid_legacy_shape");
      return { entry: e, at: `${path}.extraRecords[${i}]` };
    }),
  ];
  const operationIds: string[] = [];
  const unlessAffected: string[] = [];
  for (const { entry, at } of entries) {
    const label = str(entry.effectLabel);
    if (!label) fail(`${at}.effectLabel`, "invalid_legacy_shape");
    const limits = toLimits(
      entry.usageLimit as EffectUsageLimit | EffectUsageLimit[] | undefined
    );
    if (limits.length === 0) fail(`${at}.usageLimit`, "invalid_legacy_shape");
    const sources = str(entry.sourceInstanceId)
      ? [str(entry.sourceInstanceId)!]
      : hints;
    const deltas = new Map<string, number>();
    const usedByRecord = new Map<ConvertedRecord, Set<number>>();
    for (const limit of limits) {
      const found = findRefundRecord(work, scope, {
        sources,
        label,
        groupId: str(entry.groupId),
        duration: limit.duration ?? "turn",
        relatedInstanceId: str(entry.relatedInstanceId),
        triggerEventScopeKey: str(entry.triggerEventScopeKey),
        at,
      });
      if (!found) continue; // 旧 refund も一致記録が無ければ何もしない
      const used = usedByRecord.get(found) ?? new Set<number>();
      usedByRecord.set(found, used);
      const j = found.matched.find(
        (i) => !used.has(i) && stableJson(found.limits[i]) === stableJson(limit)
      );
      if (j === undefined) {
        fail(
          at,
          "receipt_limit_mismatch",
          "the refund limit is not in the record's limit set"
        );
      }
      used.add(j);
      const bucket = scratchBucketKey(found.constraints[j]!, found.context, at);
      deltas.set(bucket, (deltas.get(bucket) ?? 0) + 1);
    }
    const operationId = nextOperationId(work);
    work.ops.push({
      operationId,
      turnId: scope.turnNumber,
      status: "applied",
      deltas: [...deltas].map(
        ([bucketKey, delta]): UsageDelta => ({ bucketKey, delta })
      ),
    });
    operationIds.push(operationId);
    if (limits.some((limit) => limit.unlessAffectedByOpponent === true)) {
      unlessAffected.push(operationId);
    }
  }
  return {
    operationIds,
    ...(unlessAffected.length > 0
      ? { unlessAffectedByOpponentOperationIds: unlessAffected }
      : {}),
  };
}

/** 1つの制約が1回の消費で触れる bucket のキー (空の会計に消費して読み取る)。 */
function scratchBucketKey(
  constraint: UsageConstraint,
  context: UsageContext,
  at: string
): string {
  const result = consumeUsage(
    createEmptyEffectAccounting(),
    [constraint],
    context,
    "",
    UNBOUNDED,
    1,
    { receipt: false }
  );
  const bucket = result.ok ? result.accounting.buckets[0] : undefined;
  if (!bucket)
    fail(at, "receipt_limit_mismatch", "the refund bucket cannot be derived");
  return bucket.key;
}

/** 旧 `refundEffectUsage` と同じ規則で、取消の対象になった記録 (現在のターン・ステップの最新の一致記録) を探す。 */
function findRefundRecord(
  work: Work,
  scope: Scope,
  query: {
    sources: string[];
    label: string;
    groupId: string | undefined;
    duration: string;
    relatedInstanceId: string | undefined;
    triggerEventScopeKey: string | undefined;
    at: string;
  }
): ConvertedRecord | undefined {
  const matchesFor = (source: string): ConvertedRecord | undefined => {
    for (let i = work.converted.length - 1; i >= 0; i--) {
      const cr = work.converted[i]!;
      const r = cr.record;
      if (cr.scope !== scope) continue;
      if (
        r.sourceInstanceId === source &&
        (query.groupId
          ? r.groupId === query.groupId
          : r.effectLabel === query.label) &&
        r.duration === query.duration &&
        r.turnNumber === scope.turnNumber &&
        r.step === scope.step &&
        (query.relatedInstanceId === undefined ||
          r.relatedInstanceId === query.relatedInstanceId) &&
        (query.triggerEventScopeKey === undefined ||
          r.triggerEventScopeKey === query.triggerEventScopeKey)
      ) {
        return cr;
      }
    }
    return undefined;
  };
  if (query.sources.length === 0) {
    // 発揮元が分からない。一致しうる記録が現在のステップにあるなら取消の対象を特定できない。
    const any = work.converted.some(
      (cr) =>
        cr.scope === scope &&
        (query.groupId
          ? cr.record.groupId === query.groupId
          : cr.record.effectLabel === query.label) &&
        cr.record.duration === query.duration &&
        cr.record.turnNumber === scope.turnNumber &&
        cr.record.step === scope.step
    );
    if (any)
      fail(
        query.at,
        "receipt_source_ambiguous",
        "the refund source instance is unknown"
      );
    return undefined;
  }
  const hits = query.sources
    .map((source) => matchesFor(source))
    .filter((cr): cr is ConvertedRecord => cr !== undefined);
  const distinct = new Set(hits.map((cr) => cr.record.sourceInstanceId));
  if (distinct.size > 1) {
    fail(
      query.at,
      "receipt_source_ambiguous",
      "several candidate sources match the refund"
    );
  }
  return hits[0];
}
