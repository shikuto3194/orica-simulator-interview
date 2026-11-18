/**
 * 使用会計 (effect-usage/) と GameState をつなぐアダプタ層。
 *
 * 中核 (effect-usage/) は GameState に依存しない。ここは進行文脈 (ターン・ステップ・バトル・
 * 追加ターンの中断元) から時計を導出し、台帳の整理を呼ぶだけで、識別キーや上限の判断は持たない。
 */

import { getCardById } from "../card/card-lookup";
import {
  allocateOperationId,
  consumeUsage,
  grantUsage,
  pruneAccounting,
  queryUsage,
  refundUsage,
  releaseOperation,
  revokeGrant,
} from "../effect-usage/ledger";
import {
  abilityKindOfConstraintId,
  abilityRefOfConstraintId,
  makeGrantId,
} from "../effect-usage/identity";
import {
  buildUsageConstraint,
  normalizeUsageLimits,
} from "../effect-usage/normalize";
import type {
  AbilityRef,
  EffectAccounting,
  EffectUsageLimit,
  UsageClock,
  UsageConstraint,
  UsageContext,
  UsageFailureReason,
  UsageGrant,
  UsageMaximumResolver,
  UsagePeriodKind,
  UsageQueryResult,
} from "../effect-usage/types";
import type { Effect } from "../dsl-types";
import type { CardDefinition, ExtraTurnState, GameState } from "../model";
import { effectIncludesSoulState } from "./effect-label-utils";
import { getCurrentBattleAttackId } from "../battle/battle-end-finalize-blockers";

/** Capture the immutable ledger for historical condition evaluation. */
export function captureEffectAccountingView(
  state: Pick<GameState, "effectAccounting">
): Readonly<Pick<GameState, "effectAccounting">> {
  return { effectAccounting: state.effectAccounting };
}

/** 現在の時計。台帳には保存せず GameState から導出する。 */
export function usageClockOf(state: GameState): UsageClock {
  return {
    turnId: state.turnNumber,
    stepId: state.stepOrdinalThisTurn,
    battleId: getCurrentBattleAttackId(state),
  };
}

/**
 * 追加ターンの中断元の時計を、returnContext の連鎖から導出する。
 * 中断元の turn/step/battle は returnContext が退避しているため、台帳は退避しない。
 */
export function suspendedUsageClocks(state: GameState): UsageClock[] {
  const clocks: UsageClock[] = [];
  let extra: ExtraTurnState | null | undefined = state.extraTurnState;
  while (extra?.returnContext) {
    const ctx = extra.returnContext;
    clocks.push({
      turnId: ctx.turnNumber,
      stepId: ctx.turnContext?.stepOrdinalThisTurn ?? 0,
      battleId: ctx.activeAttack?.attackId ?? null,
    });
    extra = ctx.extraTurnState;
  }
  return clocks;
}

/** 現在 + 中断元。この集合に属さない枠は整理してよい。 */
export function liveUsageClocks(state: GameState): UsageClock[] {
  return [usageClockOf(state), ...suspendedUsageClocks(state)];
}

/**
 * 取消のため receipt を保持した操作 (retain) が、いま参照されているか。
 * 参照元は recordedUsage / refundableUsage (払い戻し情報) と宣言取消の差分
 * (declarationUsageOperationIds)。会計 (effectAccounting) と log は走査しない。
 */
const OPERATION_REFERENCE_KEYS = new Set(["recordedUsage", "refundableUsage"]);

function collectReferencedUsageOperationIds(state: GameState): Set<string> {
  const referenced = new Set<string>();
  const visited = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (typeof value !== "object" || value === null) continue;
      if (OPERATION_REFERENCE_KEYS.has(key)) {
        const ids = (value as { operationIds?: unknown }).operationIds;
        if (Array.isArray(ids)) {
          for (const id of ids) if (typeof id === "string") referenced.add(id);
        }
      } else if (
        key === "declarationUsageOperationIds" &&
        Array.isArray(value)
      ) {
        for (const id of value) if (typeof id === "string") referenced.add(id);
        continue;
      }
      walk(value);
    }
  };
  for (const [key, value] of Object.entries(state)) {
    if (key === "effectAccounting" || key === "log") continue;
    walk(value);
  }
  return referenced;
}

/**
 * 参照されなくなった保持中の操作を release する。release 済みの操作は作成ターンが
 * 生存しなくなったら整理される (保持は有界)。まだ参照中の操作は期限切れだけでは消さない。
 */
export function releaseUnreferencedUsageOperations(
  state: GameState
): GameState {
  const retained = state.effectAccounting.operations.filter(
    (op) => op.released !== true
  );
  if (retained.length === 0) return state;
  const referenced = collectReferencedUsageOperationIds(state);
  let accounting = state.effectAccounting;
  for (const op of retained) {
    if (!referenced.has(op.operationId)) {
      accounting = releaseOperation(accounting, op.operationId);
    }
  }
  return accounting === state.effectAccounting
    ? state
    : { ...state, effectAccounting: accounting };
}

/** 期限を越えた枠を整理する (時計だけで判断。機構別のリセットではない)。 */
export function pruneEffectAccounting(input: GameState): GameState {
  const state = releaseUnreferencedUsageOperations(input);
  const effectAccounting = pruneAccounting(
    state.effectAccounting,
    liveUsageClocks(state)
  );
  return effectAccounting === state.effectAccounting
    ? state
    : { ...state, effectAccounting };
}

// ---------------------------------------------------------------
// 呼出点の入力 (UsageSite) から制約と文脈を一度だけ組み立てる
// ---------------------------------------------------------------

/**
 * 使用枠を照会・消費する呼出点が確定している事実。
 * 識別 (abilityRef) は登録時に一度だけ作られたものを渡し、ここで文字列連結して作らない。
 */
export interface UsageSite {
  state: GameState;
  ability: AbilityRef;
  /** 同名共有 (名前+能力指紋) 用の能力参照。未指定なら ability を使う。 */
  nameAbility?: AbilityRef;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 使用者。未指定なら発揮元の controller → owner から導出する。 */
  playerId?: string;
  limits?: EffectUsageLimit | readonly EffectUsageLimit[] | undefined;
  /**
   * 回数制限では表せない枠(事実・数量・観測・権利の行使)の正規化済み制約。
   * `buildUsageConstraint` で作る。指定時は limits より優先する(両方は指定しない)。
   */
  constraints?: readonly UsageConstraint[];
  /** 共有使用制限グループ (limitGroupId / usageGroupId を正規化した参照)。 */
  groupId?: string;
  /** 発揮する効果そのもの。【魂状態】を含むかの判定に使う。 */
  sourceEffect?: Effect | undefined;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  /** 観測された誘発主語 Y。 */
  relatedInstanceId?: string;
  /** 同一出来事 (pendingId 等)。 */
  triggerEventScopeKey?: string;
  /** 同一効果発揮由来 (chainId 等)。 */
  triggerActivationKey?: string;
  /** 同名共有の名前解決キー。未指定なら定義の printed name(定義が引けなければ sourceDefinitionId)。 */
  nameKey?: string;
  /** share="grant" の枠が指す付与済み権利のID。 */
  grantId?: string;
}

/** 制限記述を制約へ正規化する (登録時に一度。呼出点ごとの再計算は移行期のみ)。 */
export function usageConstraintsOf(site: UsageSite): UsageConstraint[] {
  if (site.constraints !== undefined) return [...site.constraints];
  const textLines = site.getCardDefinitionById?.(
    site.sourceDefinitionId
  )?.textLines;
  return normalizeUsageLimits({
    abilityRef: site.ability,
    ...(site.nameAbility ? { nameAbilityRef: site.nameAbility } : {}),
    limits: site.limits,
    ...(site.groupId !== undefined ? { groupId: site.groupId } : {}),
    includesSoulState: effectIncludesSoulState(site.sourceEffect, textLines),
  });
}

/** 使用者を決める。明示 > 発揮元の controller > owner。決まらなければ undefined。 */
export function usagePlayerOf(
  state: GameState,
  site: Pick<UsageSite, "sourceInstanceId" | "playerId">
): string | undefined {
  if (site.playerId) return site.playerId;
  // cardInstances 未設定の最小 state (一部 unit test が `as GameState` で渡す) でも落とさない。
  const card = state.cardInstances?.find(
    (c) => c.instanceId === site.sourceInstanceId
  );
  return card?.controllerPlayerId ?? card?.ownerPlayerId;
}

/**
 * 呼出点の事実と現在の時計から UsageContext を作る。
 * 使用者を決められない場合は playerId を空にし、台帳が missing_player として拒否する
 * (使用者の推測補完をしない)。
 */
export function usageContextOf(site: UsageSite): UsageContext {
  const { state } = site;
  const source = getCardById(state, site.sourceInstanceId);
  const subject =
    site.relatedInstanceId !== undefined
      ? getCardById(state, site.relatedInstanceId)
      : undefined;
  return {
    playerId: usagePlayerOf(state, site) ?? "",
    sourceInstanceId: site.sourceInstanceId,
    sourceFieldGeneration: source?.fieldInstanceGeneration ?? 0,
    sourceSoulGeneration: source?.soulStateGeneration ?? 0,
    // 同名共有の鍵は printed name(10_rules/03e)。定義が引けるなら名前、引けなければ定義IDで共有する。
    nameKey:
      site.nameKey ??
      site.getCardDefinitionById?.(site.sourceDefinitionId)?.name ??
      site.sourceDefinitionId,
    ...(site.relatedInstanceId !== undefined
      ? {
          subjectInstanceId: site.relatedInstanceId,
          subjectFieldGeneration: subject?.fieldInstanceGeneration ?? 0,
        }
      : {}),
    ...(site.triggerEventScopeKey !== undefined
      ? { eventId: site.triggerEventScopeKey }
      : {}),
    ...(site.triggerActivationKey !== undefined
      ? { activationId: site.triggerActivationKey }
      : {}),
    ...(site.grantId !== undefined ? { grantId: site.grantId } : {}),
    clock: usageClockOf(state),
  };
}

// ---------------------------------------------------------------
// GameState へ台帳の結果を反映する唯一の層 (書込みはここだけ)
// ---------------------------------------------------------------

/** 各制限の limit / used / remaining。状態は変更しない。 */
export function queryUsageOnState(
  site: UsageSite,
  resolveMaximum: UsageMaximumResolver,
  demand = 1
): UsageQueryResult {
  const constraints = usageConstraintsOf(site);
  if (constraints.length === 0) return { entries: [], allowed: true };
  return queryUsage(
    site.state.effectAccounting,
    constraints,
    usageContextOf(site),
    resolveMaximum,
    demand
  );
}

export type ConsumeOnStateResult =
  | {
      ok: true;
      state: GameState;
      /** 制限が無い呼出点では undefined。取消には operationId を保持して使う。 */
      operationId: string | undefined;
      replayed: boolean;
    }
  | {
      ok: false;
      state: GameState;
      reason: UsageFailureReason;
      constraintId?: string;
    };

export interface ConsumeOnStateOptions {
  /** 指定なしなら状態から決定的に採番する。pending再開で同じ消費を指すときは同じIDを渡す。 */
  operationId?: string;
  amount?: number;
  /**
   * true: receipt を呼出点が参照し続ける (取消・継続のため)。false/省略: 取消を保持しない
   * 消費で、作成ターンの終了後に整理される。
   */
  retain?: boolean;
  /**
   * false: 取消の対象にならない記録 (確定した数量・宣言事実)。receipt を残さないため
   * operationId は返らず、宣言取消などの refund も巻き込まない。
   */
  receipt?: boolean;
}

/**
 * 全制限を原子的に消費する。失敗時は state を変更せず、理由を返す。
 * 制限が無い (constraints が空) 呼出点は成功として state をそのまま返す。
 */
export function consumeUsageOnState(
  site: UsageSite,
  resolveMaximum: UsageMaximumResolver,
  options: ConsumeOnStateOptions = {}
): ConsumeOnStateResult {
  const constraints = usageConstraintsOf(site);
  if (constraints.length === 0) {
    return {
      ok: true,
      state: site.state,
      operationId: undefined,
      replayed: false,
    };
  }
  let accounting = site.state.effectAccounting;
  const hasReceipt = options.receipt !== false;
  let operationId = options.operationId;
  if (hasReceipt && operationId === undefined) {
    const allocated = allocateOperationId(accounting);
    accounting = allocated.accounting;
    operationId = allocated.operationId;
  }
  const result = consumeUsage(
    accounting,
    constraints,
    usageContextOf(site),
    operationId ?? "",
    resolveMaximum,
    options.amount ?? 1,
    { released: options.retain !== true, receipt: hasReceipt }
  );
  if (!result.ok) {
    return {
      ok: false,
      // 採番も含め、失敗した呼出しは state を一切変更しない (同一参照で返す)。
      state: site.state,
      reason: result.reason,
      ...(result.constraintId !== undefined
        ? { constraintId: result.constraintId }
        : {}),
    };
  }
  return {
    ok: true,
    state: { ...site.state, effectAccounting: result.accounting },
    operationId,
    replayed: result.replayed,
  };
}

/** 操作 (receipt) の差分だけを取り消す。未知・取消済みの操作IDは状態を変えない。 */
export function refundUsageOperationsOnState(
  state: GameState,
  operationIds: readonly string[]
): GameState {
  let accounting = state.effectAccounting;
  for (const operationId of operationIds) {
    accounting = refundUsage(accounting, operationId);
  }
  return accounting === state.effectAccounting
    ? state
    : { ...state, effectAccounting: accounting };
}

/**
 * 現在のターンに観測された量(measure="observation")を、能力種別ごとに合計する。
 * 観測は回数制限の有無に関わらず記録されるため、AI特徴量などの「出来事の数」に使える。
 */
export function observedAmountThisTurn(
  state: GameState,
  abilityKind: AbilityRef["kind"]
): number {
  let total = 0;
  for (const bucket of state.effectAccounting.buckets) {
    if (
      bucket.measure === "observation" &&
      bucket.turnId === state.turnNumber &&
      abilityKindOfConstraintId(bucket.constraintId) === abilityKind
    ) {
      total += bucket.amount;
    }
  }
  return total;
}

// ---------------------------------------------------------------
// 権利 (grant): 追加アタック権・コネクトバトル権など「N回行使できる」付与
// ---------------------------------------------------------------
// 付与は固有の grantId を持つ UsageGrant として台帳に置き、行使は grant_use として bucket に数える。
// 残量は total と行使量の差で、状態には保存しない(進行側は grantId の参照だけを持つ)。

/** 権利の付与指定。 */
export interface GrantOnStateSpec {
  /** 権利の種別 (例: "additional_attack" / "connect_battle")。 */
  grantKind: string;
  /** 権利を持つプレイヤー。 */
  playerId: string;
  /** 受益個体。 */
  subjectInstanceId?: string;
  /** 付与元の能力参照。 */
  sourceRef: AbilityRef;
  /** 行使できる回数。 */
  total: number;
  /** 権利の失効期間 (turn / battle 等)。現在の時計に結び付ける。 */
  period: UsagePeriodKind;
  /**
   * 付与元の効果発揮を一意に表す識別 (chainId 等)。同じ値の再付与(pending 再開)は何も追加しない。
   * 省略時は状態から決定的に採番し、別の付与として扱う。
   */
  originKey?: string;
}

export type GrantOnStateResult =
  | {
      ok: true;
      state: GameState;
      grantId: string;
      /** 同じ付与の再送で何も追加しなかった。 */
      replayed: boolean;
    }
  | {
      ok: false;
      state: GameState;
      reason: "invalid_amount" | "grant_conflict";
    };

/** 権利を付与する。同じ originKey の再送は二重に付与しない。 */
export function grantUsageOnState(
  state: GameState,
  grantInput: GrantOnStateSpec
): GrantOnStateResult {
  let accounting = state.effectAccounting;
  let originKey = grantInput.originKey;
  if (originKey === undefined) {
    const allocated = allocateOperationId(accounting);
    accounting = allocated.accounting;
    originKey = allocated.operationId;
  }
  const clock = usageClockOf(state);
  const grantId = makeGrantId(
    grantInput.grantKind,
    grantInput.sourceRef,
    grantInput.subjectInstanceId,
    originKey
  );
  const grant: UsageGrant = {
    grantId,
    grantKind: grantInput.grantKind,
    playerId: grantInput.playerId,
    ...(grantInput.subjectInstanceId !== undefined
      ? { subjectInstanceId: grantInput.subjectInstanceId }
      : {}),
    sourceRef: grantInput.sourceRef,
    total: grantInput.total,
    expires: {
      period: grantInput.period,
      turnId: clock.turnId,
      stepId: clock.stepId,
      ...(grantInput.period === "battle" ? { battleId: clock.battleId } : {}),
    },
    operationId: `grant-op:${grantId}`,
  };
  const result = grantUsage(accounting, grant);
  if (!result.ok) {
    return { ok: false, state, reason: result.reason };
  }
  return {
    ok: true,
    state:
      result.accounting === state.effectAccounting
        ? state
        : { ...state, effectAccounting: result.accounting },
    grantId,
    replayed: result.replayed,
  };
}

/** 権利を取り消す(置換された付与の整理など)。未知のIDは状態を変えない。 */
export function revokeGrantOnState(
  state: GameState,
  grantId: string
): GameState {
  const accounting = revokeGrant(state.effectAccounting, grantId);
  return accounting === state.effectAccounting
    ? state
    : { ...state, effectAccounting: accounting };
}

/** 権利がいまの時計で有効か(失効期間の中か)。 */
function isGrantActive(grant: UsageGrant, clock: UsageClock): boolean {
  switch (grant.expires.period) {
    case "game":
      return true;
    case "turn":
    case "event":
    case "activation":
      return grant.expires.turnId === clock.turnId;
    case "step":
      return (
        grant.expires.turnId === clock.turnId &&
        grant.expires.stepId === clock.stepId
      );
    case "battle":
      return (
        clock.battleId !== null && grant.expires.battleId === clock.battleId
      );
  }
}

/** 行使(grant_use)を数える枠。総量は権利の total、共有は付与ごと(grantId)。 */
function grantUseSite(state: GameState, grant: UsageGrant): UsageSite {
  const subject = grant.subjectInstanceId;
  const definitionId =
    (subject !== undefined
      ? getCardById(state, subject)?.definitionId
      : undefined) ?? grant.sourceRef.definitionKey;
  return {
    state,
    ability: grant.sourceRef,
    sourceInstanceId: subject ?? "",
    sourceDefinitionId: definitionId,
    playerId: grant.playerId,
    grantId: grant.grantId,
    constraints: [
      buildUsageConstraint({
        abilityRef: grant.sourceRef,
        share: "grant",
        period: grant.expires.period,
        measure: "use",
        maximum: { base: grant.total },
        commitPoint: "grant_use",
      }),
    ],
  };
}

/** 権利の上限は付与時の total で固定(動的上限なし)。 */
const grantMaximum: UsageMaximumResolver = (constraint) =>
  constraint.maximum.base;

/** 権利の照会結果。残量は台帳から導出した派生値。 */
export interface GrantView {
  grantId: string;
  grantKind: string;
  playerId: string;
  subjectInstanceId: string | undefined;
  total: number;
  used: number;
  remaining: number;
}

function viewOfGrant(state: GameState, grant: UsageGrant): GrantView {
  const entry = queryUsageOnState(grantUseSite(state, grant), grantMaximum)
    .entries[0];
  const used = entry?.used ?? 0;
  return {
    grantId: grant.grantId,
    grantKind: grant.grantKind,
    playerId: grant.playerId,
    subjectInstanceId: grant.subjectInstanceId,
    total: grant.total,
    used,
    remaining: Math.max(0, grant.total - used),
  };
}

/** いまの時計で有効な権利を付与順に返す。残量は台帳から導出する(状態には保存しない)。 */
export function listActiveGrantsOnState(
  state: GameState,
  filter: { grantKind: string; subjectInstanceId?: string }
): GrantView[] {
  const clock = usageClockOf(state);
  return state.effectAccounting.grants
    .filter(
      (grant) =>
        grant.grantKind === filter.grantKind &&
        (filter.subjectInstanceId === undefined ||
          grant.subjectInstanceId === filter.subjectInstanceId) &&
        isGrantActive(grant, clock)
    )
    .map((grant) => viewOfGrant(state, grant));
}

/** grantId の権利。無効(失効・未付与)なら undefined。 */
export function getActiveGrantOnState(
  state: GameState,
  grantId: string
): GrantView | undefined {
  const grant = state.effectAccounting.grants.find(
    (g) => g.grantId === grantId
  );
  if (!grant || !isGrantActive(grant, usageClockOf(state))) return undefined;
  return viewOfGrant(state, grant);
}

export type ConsumeGrantResult =
  | { ok: true; state: GameState; replayed: boolean }
  | { ok: false; state: GameState; reason: UsageFailureReason | "no_grant" };

/**
 * 権利を1回行使する(grant_use)。残量が無い・失効・未付与なら state を変えずに理由を返す。
 * `operationId` を渡すと同じ行使の再送は何も加算しない(pending 再開で同じIDを渡す)。
 */
export function consumeGrantOnState(
  state: GameState,
  grantId: string,
  options: { operationId?: string } = {}
): ConsumeGrantResult {
  const grant = state.effectAccounting.grants.find(
    (g) => g.grantId === grantId
  );
  if (!grant || !isGrantActive(grant, usageClockOf(state))) {
    return { ok: false, state, reason: "no_grant" };
  }
  const result = consumeUsageOnState(
    grantUseSite(state, grant),
    grantMaximum,
    options.operationId !== undefined
      ? { operationId: options.operationId }
      : {}
  );
  return result.ok
    ? { ok: true, state: result.state, replayed: result.replayed }
    : { ok: false, state, reason: result.reason };
}

/**
 * 取消用 snapshot へ巻き戻したとき、観測された出来事の bucket (`keep` が真) だけは
 * 現在の値を保持する。誘発待機列と同じく「一度観測した出来事は盤面の巻き戻しで戻さない」。
 * それ以外の bucket (回数・数量・宣言事実) は snapshot のまま (盤面と一緒に戻る)。
 */
export function keepBucketsAfterRollback(
  restored: GameState,
  current: GameState,
  keep: (bucket: import("../effect-usage/types").UsageBucket) => boolean
): GameState {
  const kept = current.effectAccounting.buckets.filter(keep);
  const restoredKept = restored.effectAccounting.buckets.filter(keep);
  if (
    kept.length === restoredKept.length &&
    kept.every((bucket, i) => bucket === restoredKept[i])
  ) {
    return restored;
  }
  return {
    ...restored,
    effectAccounting: {
      ...restored.effectAccounting,
      buckets: [
        ...restored.effectAccounting.buckets.filter((b) => !keep(b)),
        ...kept,
      ],
    },
  };
}

// ---------------------------------------------------------------
// 公開投影 (viewer / 相手 / 観戦者)
// ---------------------------------------------------------------

/** 追加アタック権・コネクトバトル権の種別 (battle-grant-usage が使う。公開投影もこれを参照する)。 */
export const ADDITIONAL_ATTACK_GRANT_KIND = "additional_attack";
export const CONNECT_BATTLE_GRANT_KIND = "connect_battle";

/**
 * 全 viewer に公開する権利の種別。アタックの回数・相手の戦闘への干渉は盤面で見える公開情報で、
 * 旧 state でも `pendingAdditionalAttackGrants` / `activeAttack.connectBattleGrant` は伏せられていなかった。
 */
const PUBLIC_GRANT_KINDS: ReadonlySet<string> = new Set([
  ADDITIONAL_ATTACK_GRANT_KIND,
  CONNECT_BATTLE_GRANT_KIND,
]);

/**
 * 相手・観戦者にも公開する枠か。公開が設計されているのはミラージュ免除の使用 (AI観測
 * `mirageCountExemptionCardNos` と同じ情報量を維持する)、公開される権利の行使、神技等の宣言数の観測。
 */
function isPubliclyVisibleBucket(
  bucket: Pick<EffectAccounting["buckets"][number], "constraintId" | "measure">,
  publicGrantUseConstraintIds: ReadonlySet<string>
): boolean {
  const { constraintId } = bucket;
  const ref = abilityRefOfConstraintId(constraintId);
  return (
    (ref?.kind === "gimmick" &&
      ref.path === "mirageData.exemptSetCountLimits") ||
    // 神技・導技・界放・契約技の宣言は公開された行動。宣言数の観測 (AI 特徴量「神技使用数」の正源) は、
    // 旧 usedDivineSkillKeysThisTurn が相手にも見えていたのと同じく相手・観戦者にも見せる。
    // 使用回数の枠 (measure=use) は公開しない。
    (bucket.measure === "observation" && ref?.kind === "divine_skill") ||
    // 公開される権利(追加アタック権・コネクトバトル権)の行使量も同じ範囲で公開する。付与だけを
    // 公開して行使を伏せると、相手の視点では行使済みの権利が未使用(残量=total)に見える。
    publicGrantUseConstraintIds.has(constraintId)
  );
}

/** 公開される権利の行使(grant_use)枠の制約ID。`grantUseSite` と同じ制約から作る。 */
function publicGrantUseConstraintIdsOf(
  accounting: EffectAccounting
): Set<string> {
  return new Set(
    accounting.grants
      .filter((grant) => PUBLIC_GRANT_KINDS.has(grant.grantKind))
      .map(
        (grant) =>
          buildUsageConstraint({
            abilityRef: grant.sourceRef,
            share: "grant",
            period: grant.expires.period,
            measure: "use",
            maximum: { base: grant.total },
            commitPoint: "grant_use",
          }).constraintId
      )
  );
}

/** viewer に見える枠と、その枠だけを触った receipt(自動採番 ID は 0 から詰め直す)。 */
function visibleAccountingParts(
  accounting: EffectAccounting,
  viewerPlayerId: string | null
): {
  buckets: EffectAccounting["buckets"];
  operations: EffectAccounting["operations"];
  idMap: Map<string, string>;
} {
  const publicUse = publicGrantUseConstraintIdsOf(accounting);
  const buckets = accounting.buckets.filter(
    (bucket) =>
      (viewerPlayerId !== null && bucket.playerId === viewerPlayerId) ||
      isPubliclyVisibleBucket(bucket, publicUse)
  );
  const visibleKeys = new Set(buckets.map((bucket) => bucket.key));
  const visible = accounting.operations.filter(
    (operation) =>
      operation.deltas.length > 0 &&
      operation.deltas.every((delta) => visibleKeys.has(delta.bucketKey))
  );
  const operations = renumberAutoOperationIds(visible);
  const idMap = new Map<string, string>();
  visible.forEach((operation, index) =>
    idMap.set(operation.operationId, operations[index]!.operationId)
  );
  return { buckets, operations, idMap };
}

/**
 * viewer に渡す会計の投影。会計は能力由来の非公開カード情報(手札・伏せ札の定義ID、非公開宣言の
 * 使用など)を含みうるため、そのまま渡さない。
 *  - 本人: 自分の枠・権利・receiptを全て渡す。
 *  - 相手・観戦者(viewerPlayerId が null を含む): 公開が設計された枠(ミラージュ免除・公開される
 *    権利の行使・神技等の宣言数の観測)と権利(追加アタック権・コネクトバトル権)だけ。
 * クライアントは使用可否を自分で判定せず、サーバーの合法手を正源とする(compatibility.md)。
 */
export function projectEffectAccountingForViewer(
  accounting: EffectAccounting,
  viewerPlayerId: string | null
): EffectAccounting {
  const { buckets, operations } = visibleAccountingParts(
    accounting,
    viewerPlayerId
  );
  return {
    ...accounting,
    // 採番カウンタと自動採番の receipt ID (`usage-op:N`) は全プレイヤーの消費で進む共有の値。
    // そのまま渡すと、相手の非公開な使用回数制限付き宣言の件数が、カウンタの差分や ID の欠番
    // から推定できる (本人にも、相手分の欠番が見える)。見える receipt だけを 0 から詰めて
    // 振り直し、カウンタも見える receipt の件数から決める (投影は表示専用で、サーバーが正源)。
    nextOperationSeq: visibleNextOperationSeq(operations),
    buckets,
    grants: accounting.grants.filter(
      (grant) =>
        PUBLIC_GRANT_KINDS.has(grant.grantKind) ||
        (viewerPlayerId !== null && grant.playerId === viewerPlayerId)
    ),
    operations,
  };
}

/** 投影前の会計から、viewer に見える receipt の ID の写像(元 ID → 投影後 ID)を作る。 */
export function viewerUsageOperationIdMap(
  accounting: EffectAccounting,
  viewerPlayerId: string | null
): ReadonlyMap<string, string> {
  return visibleAccountingParts(accounting, viewerPlayerId).idMap;
}

const OPERATION_ID_LIST_KEYS = new Set([
  "operationIds",
  "unlessAffectedByOpponentOperationIds",
  "declarationUsageOperationIds",
]);
const OPERATION_ID_SCALAR_KEYS = new Set([
  "privateDeclarationUsageOperationId",
  "usageOperationId",
]);
/** 値が receipt ID の写像 (usageGroupId -> `usage-op:N`)。stepContext が運搬する。 */
const OPERATION_ID_MAP_KEYS = new Set(["stepUsageReceipts"]);

/** viewer 投影が receipt ID を写す (または取り除く) state 上のプロパティ名。型との対応は test が検査する。 */
export const USAGE_OPERATION_REFERENCE_KEYS: ReadonlySet<string> = new Set([
  ...OPERATION_ID_LIST_KEYS,
  ...OPERATION_ID_SCALAR_KEYS,
  ...OPERATION_ID_MAP_KEYS,
]);

/**
 * state に運搬される receipt 参照(recordedUsage / refundableUsage / declarationUsageOperationIds /
 * privateDeclarationUsageOperationId / usageOperationId / stepUsageReceipts の値)を、投影した会計と同じ ID へ写す。
 * 公開されるスタック・pending に生の `usage-op:N` を残すと、全プレイヤー共通の採番カウンタから
 * 相手の非公開な消費の件数が分かる。viewer に見えない receipt への参照は取り除く。
 * 会計(effectAccounting)と log は走査しない。変更が無い部分は同じ参照を返す。
 */
export function projectUsageOperationReferencesForViewer(
  state: GameState,
  idMap: ReadonlyMap<string, string>
): GameState {
  const rewriteList = (ids: readonly unknown[]): string[] =>
    ids.flatMap((id) => {
      const mapped = typeof id === "string" ? idMap.get(id) : undefined;
      return mapped === undefined ? [] : [mapped];
    });
  const walk = (node: unknown): unknown => {
    if (typeof node !== "object" || node === null) return node;
    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const out = walk(item);
        if (out !== item) changed = true;
        return out;
      });
      return changed ? next : node;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      let out: unknown;
      if (OPERATION_ID_LIST_KEYS.has(key) && Array.isArray(value)) {
        const mapped = rewriteList(value);
        out =
          mapped.length === value.length &&
          mapped.every((id, index) => id === value[index])
            ? value
            : mapped;
      } else if (
        OPERATION_ID_SCALAR_KEYS.has(key) &&
        typeof value === "string"
      ) {
        const mapped = idMap.get(value);
        if (mapped === undefined) {
          changed = true;
          continue;
        }
        out = mapped;
      } else if (
        OPERATION_ID_MAP_KEYS.has(key) &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const entries = Object.entries(value as Record<string, unknown>);
        const mappedEntries = entries.flatMap(([groupId, id]) => {
          const mapped = typeof id === "string" ? idMap.get(id) : undefined;
          return mapped === undefined ? [] : [[groupId, mapped] as const];
        });
        out =
          mappedEntries.length === entries.length &&
          mappedEntries.every(([, id], index) => id === entries[index]?.[1])
            ? value
            : Object.fromEntries(mappedEntries);
      } else {
        out = walk(value);
      }
      if (out !== value) changed = true;
      next[key] = out;
    }
    return changed ? next : node;
  };
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === "effectAccounting" || key === "log") {
      next[key] = value;
      continue;
    }
    const out = walk(value);
    if (out !== value) changed = true;
    next[key] = out;
  }
  return changed ? (next as unknown as GameState) : state;
}

/**
 * 見えている receipt のうち自動採番 (`usage-op:N`) のものを、出現順に `usage-op:0..` へ詰め直す。
 * 呼出側が決めた ID (連鎖由来の originKey 等) は公開情報なのでそのまま残す。
 */
function renumberAutoOperationIds<T extends { operationId: string }>(
  operations: readonly T[]
): T[] {
  let next = 0;
  return operations.map((operation) =>
    /^usage-op:\d+$/.test(operation.operationId)
      ? { ...operation, operationId: `usage-op:${next++}` }
      : operation
  );
}

/** 自動採番 (`usage-op:N`) の receipt のうち見えているものの次の番号。見える receipt が無ければ 0。 */
function visibleNextOperationSeq(
  operations: readonly { operationId: string }[]
): number {
  let next = 0;
  for (const { operationId } of operations) {
    const match = /^usage-op:(\d+)$/.exec(operationId);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}
