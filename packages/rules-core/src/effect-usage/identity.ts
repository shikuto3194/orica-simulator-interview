/**
 * 使用枠の識別 (bucketキー・constraintId・期間ID) を生成する唯一のモジュール。
 *
 * 他のモジュールは `bucketKey` / `constraintId` / 期間IDを文字列連結で作らない
 * (scripts/check-ssot.mjs の P3-170 規則が機械検知する)。
 * 判定に必要な軸 (共有・期間・世代・使用者) はここで一度だけキーに畳み込む。
 */

import type {
  AbilityRef,
  UsageBucket,
  UsageClock,
  UsageConstraint,
  UsageContext,
  UsagePeriodKind,
  UsageShare,
} from "./types";

/** 区切りに使えない文字を含むidでもキーが衝突しないよう、JSON配列で正規化する。 */
function canonical(parts: readonly (string | number | null)[]): string {
  return JSON.stringify(parts);
}

/** キー順に依存しない安定した直列化 (指紋用)。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}

/** cyrb53 (非暗号用途の53bitハッシュ)。保存サイズを抑えるため能力指紋に使う。 */
function cyrb53(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const fingerprintCache = new WeakMap<object, string>();

/**
 * 能力の内容 (効果定義) の安定指紋。同名共有で「同じ本文の共有能力」を判定する。
 * 同名でも内容が違えば別指紋 (別枠)、別definitionIdでも内容が同じなら同指紋 (同枠)。
 * 定義は不変データなので object 参照でキャッシュする。
 */
export function abilityFingerprint(definition: object): string {
  const cached = fingerprintCache.get(definition);
  if (cached !== undefined) return cached;
  const fingerprint = cyrb53(stableStringify(definition));
  fingerprintCache.set(definition, fingerprint);
  return fingerprint;
}

/** 能力参照を1つの文字列に畳む。表示labelとは独立。 */
export function abilityRefKey(ref: AbilityRef): string {
  return canonical([ref.kind, ref.definitionKey, ref.path]);
}

/**
 * 1つの制限節のID。能力と (共有, 期間) の組から決まり、同一能力内で重複する場合だけ
 * 序数で区別する。turn と game、回数と数量を混同しない。
 */
export function makeConstraintId(
  ref: AbilityRef,
  share: UsageConstraint["share"],
  period: UsagePeriodKind,
  ordinal = 0,
  groupId?: string
): string {
  return canonical([
    groupId !== undefined ? "group" : abilityRefKey(ref),
    groupId ?? null,
    share,
    period,
    ordinal,
  ]);
}

/**
 * 付与された権利 (UsageGrant) の固有ID。付与元の効果発揮 (`originKey`: chainId 等)・受益個体・
 * 権利の種別・付与元の能力参照から決まる。同じ効果発揮の再開で同じIDになり、二重付与を防ぐ。
 * 部品は `encodeURIComponent` で区切り文字と衝突しない形にし、actionId / pendingId に
 * そのまま埋め込める読みやすい文字列にする。
 */
export function makeGrantId(
  grantKind: string,
  sourceRef: AbilityRef,
  subjectInstanceId: string | undefined,
  originKey: string
): string {
  const refFingerprint = cyrb53(abilityRefKey(sourceRef));
  return [
    "grant",
    grantKind,
    subjectInstanceId ?? "-",
    originKey,
    refFingerprint,
  ]
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join(":");
}

// ----- 期間ID (型ごとに接頭辞が異なる。step名だけをIDにしない) -----

export function turnPeriodId(clock: UsageClock): string {
  return `turn:${clock.turnId}`;
}

export function stepPeriodId(clock: UsageClock): string {
  // ステップ序数はターン内で振られるため、ターンIDと組にして一意にする。
  return `step:${clock.turnId}.${clock.stepId}`;
}

export function battlePeriodId(clock: UsageClock): string | null {
  return clock.battleId === null ? null : `battle:${clock.battleId}`;
}

export function eventPeriodId(eventId: string): string {
  return `event:${eventId}`;
}

export function activationPeriodId(activationId: string): string {
  return `activation:${activationId}`;
}

/**
 * 制約と文脈から、その期間を一意に表すIDを返す。期間が成立しない場合は null
 * (例: バトル外の battle 期間は常に非マッチ=使用不可)。
 *
 * event / activation 期間の識別子が文脈に無い場合は、従来どおり turn 期間に退避する
 * (非誘発経路の〔重複不可〕・〔誘発1回〕。10_rules/03c 〔重複不可〕 per-event scope の
 * legacy経路)。退避は実行時の挙動規則であり、旧保存形式の補完ではない。
 */
export function resolvePeriodId(
  period: UsagePeriodKind,
  context: Pick<UsageContext, "clock" | "eventId" | "activationId">
): string | null {
  switch (period) {
    case "game":
      return "game";
    case "turn":
      return turnPeriodId(context.clock);
    case "step":
      return stepPeriodId(context.clock);
    case "battle":
      return battlePeriodId(context.clock);
    case "event":
      return context.eventId !== undefined
        ? eventPeriodId(context.eventId)
        : turnPeriodId(context.clock);
    case "activation":
      return context.activationId !== undefined
        ? activationPeriodId(context.activationId)
        : turnPeriodId(context.clock);
  }
}

// ----- 共有キー -----

/** 個体の世代キー。実離脱 (field) と魂状態化 (soul) のどちらを寿命に含めるか。 */
function incarnationKey(
  constraint: UsageConstraint,
  fieldGeneration: number,
  soulGeneration: number
): string {
  const field = constraint.incarnation.field ? fieldGeneration : 0;
  const soul = constraint.incarnation.soul ? soulGeneration : 0;
  return `${field}.${soul}`;
}

function playerOf(
  constraint: UsageConstraint,
  context: UsageContext
): string | undefined {
  return constraint.playerScope === "beneficiary"
    ? (context.beneficiaryPlayerId ?? context.playerId)
    : context.playerId;
}

/**
 * 共有範囲ごとの識別を畳み込み、bucketキーを返す。
 * 返り値が null のときは枠が成立しない (バトル外のバトル期間・使用者欠落・grant未指定)。
 * `playerId` が欠落した場合は `{ missingPlayer: true }` で理由を区別する。
 */
export function makeBucketKey(
  constraint: UsageConstraint,
  context: UsageContext
): { key: string } | { missingPlayer: true } | null {
  const period = resolvePeriodId(constraint.period, context);
  if (period === null) return null;
  const player = playerOf(constraint, context);
  if (!player) return { missingPlayer: true };

  switch (constraint.share) {
    case "instance":
      return {
        key: canonical([
          constraint.constraintId,
          "instance",
          context.sourceInstanceId,
          incarnationKey(
            constraint,
            context.sourceFieldGeneration,
            context.sourceSoulGeneration
          ),
          period,
        ]),
      };
    case "card_name":
      // 同名共有の履歴は実離脱・魂状態でも保持する。使用者ごとに独立。
      return {
        key: canonical([
          constraint.constraintId,
          "card_name",
          player,
          context.nameKey,
          period,
        ]),
      };
    case "group": {
      if (constraint.groupId === undefined) return null;
      return {
        key: canonical([
          constraint.constraintId,
          "group",
          player,
          constraint.groupId,
          period,
        ]),
      };
    }
    case "subject_instance": {
      if (context.subjectInstanceId === undefined) {
        // 主語のないイベント (player値イベント等) では per_instance 同様に動く。
        return {
          key: canonical([
            constraint.constraintId,
            "subject_none",
            constraint.shareSourceByName
              ? `name:${context.nameKey}`
              : context.sourceInstanceId,
            constraint.shareSourceByName ? player : null,
            period,
          ]),
        };
      }
      return {
        key: canonical([
          constraint.constraintId,
          "subject_instance",
          constraint.shareSourceByName
            ? `name:${context.nameKey}`
            : context.sourceInstanceId,
          constraint.shareSourceByName ? player : null,
          context.subjectInstanceId,
          context.subjectFieldGeneration ?? 0,
          period,
        ]),
      };
    }
    case "grant": {
      const grantId = context.grantId ?? constraint.groupId;
      if (grantId === undefined) return null;
      return {
        key: canonical([
          constraint.constraintId,
          "grant",
          player,
          grantId,
          period,
        ]),
      };
    }
  }
}

/**
 * constraintId から能力種別 (AbilityKind) を取り出す。共有グループ枠は能力参照を持たないため
 * undefined。キー形式の所有者である identity.ts だけがこの解析を行う。
 */
export function abilityKindOfConstraintId(
  constraintId: string
): AbilityRef["kind"] | undefined {
  const [head] = JSON.parse(constraintId) as [string];
  if (head === "group") return undefined;
  const [kind] = JSON.parse(head) as [AbilityRef["kind"]];
  return kind;
}

/** 保存済みbucketを構造に戻した読み取り専用の記述 (公開投影・診断用)。 */
export interface DescribedUsageBucket {
  /** 共有groupの枠は能力参照を持たない (null)。 */
  ability: AbilityRef | null;
  groupId: string | null;
  share: UsageShare;
  period: UsagePeriodKind;
  playerId: string;
  /** share="card_name" の同名共有キー (呼出側が与えた nameKey)。 */
  nameKey?: string;
  amount: number;
}

/**
 * bucket を構造に戻す。外部モジュールがキー文字列を自前で解析しないための入口で、
 * キー形式の所有者である identity.ts だけが解析する。形式が想定外 (破損) の場合は null。
 */
export function describeUsageBucket(
  bucket: UsageBucket
): DescribedUsageBucket | null {
  try {
    // constraintId = [abilityRefKey | "group", groupId | null, share, period, ordinal]
    const constraint = JSON.parse(bucket.constraintId) as (string | null)[];
    const groupId = constraint[1];
    let ability: AbilityRef | null = null;
    if (typeof groupId !== "string") {
      const [kind, definitionKey, path] = JSON.parse(String(constraint[0])) as [
        AbilityRef["kind"],
        string,
        string,
      ];
      ability = { kind, definitionKey, path };
    }
    const share = constraint[2] as UsageShare;
    // bucket.key = [constraintId, share, <共有識別…>, 期間ID]
    const key = JSON.parse(bucket.key) as (string | number | null)[];
    return {
      ability,
      groupId: typeof groupId === "string" ? groupId : null,
      share,
      period: constraint[3] as UsagePeriodKind,
      playerId: bucket.playerId,
      ...(share === "card_name" ? { nameKey: String(key[3]) } : {}),
      amount: bucket.amount,
    };
  } catch {
    return null;
  }
}

/** constraintId から能力参照を取り出す。共有グループ枠は能力参照を持たないため undefined。 */
export function abilityRefOfConstraintId(
  constraintId: string
): AbilityRef | undefined {
  const [head] = JSON.parse(constraintId) as [string];
  if (head === "group") return undefined;
  const [kind, definitionKey, path] = JSON.parse(head) as [
    AbilityRef["kind"],
    string,
    string,
  ];
  return { kind, definitionKey, path };
}

/** 診断用: bucketキーを JSON 配列として読み戻す (保存migrationの検査用)。 */
export function parseBucketKey(
  key: string
): readonly (string | number | null)[] {
  return JSON.parse(key) as (string | number | null)[];
}
