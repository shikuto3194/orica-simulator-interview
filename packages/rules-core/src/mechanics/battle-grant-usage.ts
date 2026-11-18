/**
 * バトルに関する「権利」(P3-170 I11 追加アタック権 / I12 コネクトバトル権)を共通の使用会計へ載せる薄い層。
 * GameState に専用の権利配列・残量を持たず、付与は `UsageGrant`(固有 grantId)として台帳に置き、
 * 行使は `grant_use` として台帳の bucket に数える。残量は台帳から導出する派生値で、
 * 進行側(`activeAttack` / `pendingConnectBattleDecision`)は grantId の参照だけを持つ。
 *
 * 現行の挙動(共有範囲・消費地点・合算/置換)を意味として保存する。本文に根拠の無い規則は足さない。
 *
 * - I11 additional_attack : 受益個体 = 付与元と同じ個体。ターン限り。付与ごとに別の権利(加算)。
 *       行使はアタック宣言の確定時に1つ(`confirmAttackDeclarationAsAction`)。
 * - I12 connect_battle    : 受益個体 = 付与元。当該アタック(activeAttack)の間だけ有効。
 *       同じ activeAttack への再付与は置換(旧付与は破棄)。行使は「継続」を選んだ時に1回。
 */

import {
  consumeGrantOnState,
  getActiveGrantOnState,
  grantUsageOnState,
  listActiveGrantsOnState,
  revokeGrantOnState,
} from "../effect/effect-usage-accounting";
import type { GrantView } from "../effect/effect-usage-accounting";
import { makeAbilityRef } from "../effect-usage";
import type { AbilityRef } from "../effect-usage";
import type { GameState } from "../model";

export {
  ADDITIONAL_ATTACK_GRANT_KIND,
  CONNECT_BATTLE_GRANT_KIND,
} from "../effect/effect-usage-accounting";
import {
  ADDITIONAL_ATTACK_GRANT_KIND,
  CONNECT_BATTLE_GRANT_KIND,
} from "../effect/effect-usage-accounting";

/** 付与元の能力参照。効果の位置ではなく、付与する権利の種別と付与元カード定義で識別する。 */
function grantSourceRef(
  state: GameState,
  grantKind: string,
  sourceInstanceId: string
): AbilityRef {
  const definitionId =
    state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
      ?.definitionId ?? grantKind;
  return makeAbilityRef("grant", definitionId, grantKind);
}

// ---------------------------------------------------------------
// I11 additional_attack (BSTH01-X05)
// ---------------------------------------------------------------

export interface AdditionalAttackGrantInput {
  actingPlayerId: string;
  /** 受益個体(付与元と同じ個体)。 */
  sourceInstanceId: string;
  /** 付与元の効果発揮を一意にする識別(chainId)。同じ値の再付与は二重に付与しない。 */
  originKey?: string;
}

/** 「疲労状態でもアタック宣言できる」一回限りの権利を付与する(ターン限り)。付与ごとに別の権利。 */
export function grantAdditionalAttack(
  state: GameState,
  input: AdditionalAttackGrantInput
): GameState {
  const result = grantUsageOnState(state, {
    grantKind: ADDITIONAL_ATTACK_GRANT_KIND,
    playerId: input.actingPlayerId,
    subjectInstanceId: input.sourceInstanceId,
    sourceRef: grantSourceRef(
      state,
      ADDITIONAL_ATTACK_GRANT_KIND,
      input.sourceInstanceId
    ),
    total: 1,
    period: "turn",
    ...(input.originKey !== undefined ? { originKey: input.originKey } : {}),
  });
  return result.state;
}

/** この個体が行使できる追加アタック権の残り(付与順)。 */
function usableAdditionalAttackGrants(
  state: GameState,
  instanceId: string
): GrantView[] {
  return listActiveGrantsOnState(state, {
    grantKind: ADDITIONAL_ATTACK_GRANT_KIND,
    subjectInstanceId: instanceId,
  }).filter((grant) => grant.remaining > 0);
}

/** この個体に、いま行使できる追加アタック権があるか。 */
export function hasAdditionalAttackGrant(
  state: GameState,
  instanceId: string
): boolean {
  return usableAdditionalAttackGrants(state, instanceId).length > 0;
}

/** この個体が行使できる追加アタック権の合計(診断・表示用の派生値)。 */
export function additionalAttackGrantRemaining(
  state: GameState,
  instanceId: string
): number {
  return usableAdditionalAttackGrants(state, instanceId).reduce(
    (sum, grant) => sum + grant.remaining,
    0
  );
}

/** 宣言の確定時に追加アタック権を1つ行使する(最も早く付与された権利から)。無ければ state を変えない。 */
export function consumeAdditionalAttackGrant(
  state: GameState,
  instanceId: string
): GameState {
  const grant = usableAdditionalAttackGrants(state, instanceId)[0];
  if (grant === undefined) return state;
  return consumeGrantOnState(state, grant.grantId).state;
}

// ---------------------------------------------------------------
// I12 connect_battle (BSTH06-X03)
// ---------------------------------------------------------------

export interface ConnectBattleGrantInput {
  actingPlayerId: string;
  sourceInstanceId: string;
  /** 継続回数(総バトル回数ではない)。 */
  maxUses: number;
  originKey?: string;
}

/**
 * 進行中のアタックへ連続バトルの権利を付与し、`activeAttack.connectBattleGrantId` に参照だけを持たせる。
 * 同じ activeAttack への再付与は置換(旧付与は破棄)。進行中のアタックが無ければ何もしない。
 * 同じ効果発揮の再送(pending 再開)は同じ grantId になり、残量を巻き戻さない。
 */
export function grantConnectBattle(
  state: GameState,
  input: ConnectBattleGrantInput
): GameState {
  const attack = state.activeAttack;
  if (!attack) return state;
  const result = grantUsageOnState(state, {
    grantKind: CONNECT_BATTLE_GRANT_KIND,
    playerId: input.actingPlayerId,
    subjectInstanceId: input.sourceInstanceId,
    sourceRef: grantSourceRef(
      state,
      CONNECT_BATTLE_GRANT_KIND,
      input.sourceInstanceId
    ),
    total: input.maxUses,
    period: "battle",
    // 効果発揮の識別が無い付与は状態から採番して別の付与にする(置換の検査・直接呼出し用)。
    ...(input.originKey !== undefined
      ? { originKey: `${input.originKey}@${attack.attackId}` }
      : {}),
  });
  if (!result.ok) return state;
  const replaced = attack.connectBattleGrantId;
  const base =
    replaced !== undefined && replaced !== null && replaced !== result.grantId
      ? revokeGrantOnState(result.state, replaced)
      : result.state;
  return {
    ...base,
    activeAttack: { ...attack, connectBattleGrantId: result.grantId },
  };
}

export interface ConnectBattleGrantView {
  grantId: string;
  /** 付与元(受益個体)。 */
  sourceInstanceId: string;
  /** 行使済みの回数(継続を選んだ回数)。 */
  used: number;
  /** 残りの継続回数。台帳から導出した派生値。 */
  remaining: number;
}

/** 参照 grantId の連続バトル権。無効(失効・未付与)なら undefined。 */
export function getConnectBattleGrant(
  state: GameState,
  grantId: string | null | undefined
): ConnectBattleGrantView | undefined {
  if (grantId === undefined || grantId === null) return undefined;
  const view = getActiveGrantOnState(state, grantId);
  if (
    view === undefined ||
    view.grantKind !== CONNECT_BATTLE_GRANT_KIND ||
    view.subjectInstanceId === undefined
  ) {
    return undefined;
  }
  return {
    grantId: view.grantId,
    sourceInstanceId: view.subjectInstanceId,
    used: view.used,
    remaining: view.remaining,
  };
}

/** 進行中のアタックが参照する連続バトル権。 */
export function getActiveAttackConnectBattleGrant(
  state: GameState
): ConnectBattleGrantView | undefined {
  return getConnectBattleGrant(state, state.activeAttack?.connectBattleGrantId);
}

/**
 * 「継続」を選んだ時に1回行使する。`operationId` は決定待ちの識別から作り、
 * 同じ決定の再送で二重に消費しない。残量が無ければ state を変えない。
 */
export function consumeConnectBattleUse(
  state: GameState,
  grantId: string,
  operationId: string
): GameState {
  return consumeGrantOnState(state, grantId, { operationId }).state;
}
