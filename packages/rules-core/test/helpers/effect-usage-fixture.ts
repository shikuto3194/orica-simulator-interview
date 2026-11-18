/**
 * 使用枠 (P3-170 effectAccounting) のテスト用 fixture builder。
 *
 * テストは本番の使用枠API (canUse / record / refund / 台帳) を直接 import せず、このヘルパーを使う。
 * 本番APIが最終形へ移る際はこのファイルだけを更新する。旧 `effectUsageRecords` 配列や旧形式の
 * 状態を作る箇所は、migration の互換fixtureを除きここへ集約する。
 *
 * 呼出しは「効果ラベル + 制限」で表す。ラベルは `effect:N` / `magic` / `__step:…` /
 * `…:choice:k` などの安定した効果識別。制限 (`usageLimit`) は、検証対象の効果が持つものと同じ値を渡す。
 */
import {
  canUseEffectUsage as canUseEffectUsageFacade,
  consumeEffectUsage,
  refundEffectUsageOperations,
} from "../../src/legal/legal-actions-shared";
import { parseBucketKey, usageBucketKeys } from "../../src/effect-usage";
import { usageIdentityOfLabel } from "../../src/effect/usage-identity";
import {
  pruneEffectAccounting,
  usageConstraintsOf,
  usageContextOf,
  type UsageSite,
} from "../../src/effect/effect-usage-accounting";
import { ALL_CARDS } from "../../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../../src";
import type { EffectUsageLimit, GameState } from "../../src";

export interface EffectUsageFixtureOptions {
  sourceInstanceId: string;
  /** 省略時は発揮元個体の definitionId。 */
  sourceDefinitionId?: string;
  effectLabel: string;
  /** undefined は「制限なし」(消費しない)。 */
  usageLimit: EffectUsageLimit | EffectUsageLimit[] | undefined;
  groupId?: string;
  playerId?: string;
  relatedInstanceId?: string;
  triggerEventScopeKey?: string;
  triggerActivationKey?: string;
  /** 発揮する効果そのもの。【魂状態】を含む効果かの判定 (個体枠の寿命) に使う。 */
  sourceEffect?: import("../../src").Effect;
  /** 動的上限・条件付き上限の評価に必要な定義参照。 */
  getCardDefinitionById?: (
    id: string
  ) => import("../../src").CardDefinition | undefined;
}

function definitionIdOf(
  state: GameState,
  options: EffectUsageFixtureOptions
): string {
  const id =
    options.sourceDefinitionId ??
    state.cardInstances.find((c) => c.instanceId === options.sourceInstanceId)
      ?.definitionId;
  if (id === undefined) {
    throw new Error(
      `effect-usage fixture: sourceDefinitionId を決められません (${options.sourceInstanceId})`
    );
  }
  return id;
}

// 実カードを使うテストが定義を渡さなくても本番と同じ識別(同名共有の能力指紋を含む)になるよう、
// 既定はカタログ(表面+裏面)から引く。合成定義のテストは getCardDefinitionById を渡す。
const catalogDefinitions = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
    card.cardNo,
    card,
  ])
);

function usageIdentityFieldsOf(
  sourceDefinitionId: string,
  options: EffectUsageFixtureOptions
) {
  const identity = usageIdentityOfLabel(
    options.getCardDefinitionById?.(sourceDefinitionId) ??
      catalogDefinitions.get(sourceDefinitionId),
    sourceDefinitionId,
    options.effectLabel
  );
  return { ability: identity.ability, nameAbility: identity.nameAbility };
}

/** 効果ラベル(安定した効果識別)から UsageSite を組む。fixture 専用。 */
function siteOf(
  state: GameState,
  options: EffectUsageFixtureOptions
): UsageSite {
  const sourceDefinitionId = definitionIdOf(state, options);
  return {
    state,
    // 本番と同じ写像で識別を作る(定義が解決できないときは定義ID+ラベルだけの識別)。
    ...usageIdentityFieldsOf(sourceDefinitionId, options),
    sourceInstanceId: options.sourceInstanceId,
    sourceDefinitionId,
    limits: options.usageLimit,
    ...(options.playerId !== undefined ? { playerId: options.playerId } : {}),
    ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
    ...(options.sourceEffect ? { sourceEffect: options.sourceEffect } : {}),
    // 本番の呼出点は常に定義解決を持つので、同名共有の鍵 (printed name) も本番と同じになるよう
    // 既定はカタログから引く。合成定義のテストは getCardDefinitionById を渡す。
    getCardDefinitionById:
      options.getCardDefinitionById ??
      ((id: string) => catalogDefinitions.get(id)),
    ...(options.relatedInstanceId !== undefined
      ? { relatedInstanceId: options.relatedInstanceId }
      : {}),
    ...(options.triggerEventScopeKey !== undefined
      ? { triggerEventScopeKey: options.triggerEventScopeKey }
      : {}),
    ...(options.triggerActivationKey !== undefined
      ? { triggerActivationKey: options.triggerActivationKey }
      : {}),
  };
}

/** 現在の時計 (ターン・ステップ・バトル) で、効果が `times` 回使用済みの状態にする。 */
export function seedEffectUsage(
  state: GameState,
  options: EffectUsageFixtureOptions & { times?: number }
): GameState {
  let current = state;
  for (let i = 0; i < (options.times ?? 1); i++) {
    // 消費できない(既に上限)呼出しは状態を変更しない。取消を保持しない消費。
    current = consumeEffectUsage(siteOf(current, options)).state;
  }
  return current;
}

/** 効果がいま使用可能か (全制限を通過するか)。状態は変更しない。 */
export function canUseEffectUsage(
  state: GameState,
  options: EffectUsageFixtureOptions
): boolean {
  return canUseEffectUsageFacade(siteOf(state, options));
}

/**
 * 直近に記録した同じ枠の使用を1回取り消す (テスト専用)。
 * 本番の取消は receipt (operationId) だけを戻す。ここでは「同じ枠を差分に持つ直近の適用済み操作」の
 * receipt を探して、本番と同じ `refundEffectUsageOperations` で戻す。
 */
export function refundEffectUsageForTest(
  state: GameState,
  options: EffectUsageFixtureOptions
): GameState {
  // 発揮元カードが state に無いと使用者を決められない。黙って成功しないよう siteOf で検査する。
  const site = siteOf(state, options);
  const keys = usageBucketKeys(usageConstraintsOf(site), usageContextOf(site));
  if (keys.length === 0) return state;
  const operations = state.effectAccounting.operations;
  for (let i = operations.length - 1; i >= 0; i--) {
    const operation = operations[i]!;
    if (operation.status !== "applied") continue;
    const held = new Set(operation.deltas.map((d) => d.bucketKey));
    if (keys.every((key) => held.has(key)))
      return refundEffectUsageOperations(state, [operation.operationId]);
  }
  return state;
}

export interface EffectUsageEntry {
  /** 効果ラベル (`effect:N` 等。移行前の effectLabel に相当)。 */
  label: string;
  share: string;
  period: string;
  playerId: string;
  amount: number;
  /**
   * share="instance" の枠の発揮元個体 (旧レコードの sourceInstanceId 相当)。
   * 同名共有・グループ共有の枠には個体が無いので undefined。
   */
  sourceInstanceId?: string;
  /** share="subject_instance" の誘発主語 Y の個体 (旧 relatedInstanceId 相当)。 */
  subjectInstanceId?: string;
  /** share="card_name" の同名共有キー (printed name。呼出側が与えた nameKey)。 */
  nameKey?: string;
  /** share="group" の共有グループID。 */
  groupId?: string;
  /**
   * 期間ID。event 期間は `event:<pendingId 等>`、activation 期間は `activation:<chainId>`、
   * turn は `turn:<n>`、step は `step:<turn>.<序数>`、game は `game`。
   * (旧 triggerEventScopeKey / triggerActivationKey の確認はこの値で行う)
   */
  periodId: string;
}

/**
 * 現在の会計の「使用回数」枠を読みやすい形で列挙する (旧 `state.effectUsageRecords` の読み取り相当)。
 * 期限切れで整理された枠・観測/数量/事実は含まない。
 */
export function listEffectUsage(state: GameState): EffectUsageEntry[] {
  return state.effectAccounting.buckets
    .filter((bucket) => bucket.measure === "use")
    .map((bucket) => {
      // constraintId = [abilityKeyOrGroup, groupId|null, share, period, ordinal]
      const constraint = parseBucketKey(bucket.constraintId);
      const abilityKeyOrGroup = String(constraint[0]);
      const groupId = constraint[1];
      let label: string;
      if (typeof groupId === "string") {
        label = groupId;
      } else {
        const ability = JSON.parse(abilityKeyOrGroup) as [
          string,
          string,
          string,
        ];
        label = displayLabelOfPath(ability[2], ability[1]);
      }
      // bucket.key = [constraintId, share, <共有識別…>, 期間ID]。共有識別は identity.ts が決める。
      const key = parseBucketKey(bucket.key);
      const share = String(constraint[2]);
      const periodId = String(key[key.length - 1]);
      return {
        label,
        share,
        period: String(constraint[3]),
        playerId: bucket.playerId,
        amount: bucket.amount,
        periodId,
        ...(share === "instance" ? { sourceInstanceId: String(key[2]) } : {}),
        ...(share === "card_name" ? { nameKey: String(key[3]) } : {}),
        ...(share === "group" ? { groupId: String(key[3]) } : {}),
        ...(share === "subject_instance" && key[1] === "subject_instance"
          ? { subjectInstanceId: String(key[4]) }
          : {}),
      };
    });
}

/**
 * 同名共有 (share="card_name") の枠が `listEffectUsage` で見せる label (`fp:<能力指紋>`) を、
 * 効果ラベル (`effect:N` / `effect:N:choice:k` / `__step:…`) から求める。
 * 旧 assert の `label: "effect:N"` (どの効果の枠か) に相当する。定義が解決できないときは
 * 「定義ID+ラベル」だけの代替識別になって本番の識別と食い違うため、黙って通さず例外にする。
 */
export function sharedNameUsageLabel(
  definitionId: string,
  effectLabel: string,
  getCardDefinitionById?: EffectUsageFixtureOptions["getCardDefinitionById"]
): string {
  const definition =
    getCardDefinitionById?.(definitionId) ??
    catalogDefinitions.get(definitionId);
  if (definition === undefined) {
    throw new Error(
      `sharedNameUsageLabel: 定義を解決できません (${definitionId})`
    );
  }
  return usageIdentityOfLabel(definition, definitionId, effectLabel).nameAbility
    .path;
}

/** 使用回数枠の個数 (旧 `effectUsageRecords.length` 相当)。 */
export function effectUsageEntryCount(state: GameState): number {
  return listEffectUsage(state).length;
}

/** 指定ラベルの使用回数の合計。 */
export function effectUsageAmount(state: GameState, label: string): number {
  return listEffectUsage(state)
    .filter((entry) => entry.label === label)
    .reduce((sum, entry) => sum + entry.amount, 0);
}

/** 期限を越えた枠を整理する (旧 clearExpiredEffectUsageRecords 相当)。時計は state から導出される。 */
export function pruneExpiredEffectUsageForTest(state: GameState): GameState {
  return pruneEffectAccounting(state);
}

/**
 * 構造path(`effects[N]` / `effects[N].choices[k]` / `effects[N].steps[j]`)を、テストが読みやすい
 * 旧来の安定ラベル(`effect:N` / `effect:N:choice:k` / `__step:…`)に戻す。表示専用。
 */
function displayLabelOfPath(path: string, definitionKey: string): string {
  const choice = /^effects\[(\d+)\]\.choices\[(\d+)\]$/.exec(path);
  if (choice) return `effect:${choice[1]}:choice:${choice[2]}`;
  const effect = /^effects\[(\d+)\]$/.exec(path);
  if (effect) return `effect:${effect[1]}`;
  const step = /^effects\[(\d+)\]\.steps\[(\d+)\]$/.exec(path);
  if (step) return `__step:${definitionKey}:${step[1]}:${step[2]}`;
  const stepGroup = /^effects\[(\d+)\]\.stepGroup\[(.+)\]$/.exec(path);
  if (stepGroup)
    return `__step:${definitionKey}:${stepGroup[1]}:${stepGroup[2]}`;
  if (path.startsWith("label:")) return path.slice("label:".length);
  return path;
}
