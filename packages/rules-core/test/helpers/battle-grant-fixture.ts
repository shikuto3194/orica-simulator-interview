/**
 * バトルの権利 (P3-170 I11 追加アタック権 / I12 コネクトバトル権) のテスト用 fixture builder。
 *
 * 旧 GameState の `pendingAdditionalAttackGrants` / `activeAttack.connectBattleGrant` を組み立てる代わりに、
 * 共通の使用会計への付与をこのヘルパー経由で行う。テストは台帳 API を直接触らず、
 * 「付与する」「残量を読む」「行使する」だけを使う(残量は台帳から導出した値)。
 */
import {
  additionalAttackGrantRemaining,
  consumeAdditionalAttackGrant,
  getActiveAttackConnectBattleGrant,
  grantAdditionalAttack,
  grantConnectBattle,
} from "../../src/mechanics/battle-grant-usage";
import type { GameState } from "../../src";

/** 追加アタック権を count 個付与する(付与ごとに別の権利。originKey を渡すと再送は二重付与しない)。 */
export function withAdditionalAttackGrants(
  state: GameState,
  sourceInstanceId: string,
  count = 1,
  options: { actingPlayerId?: string; originKey?: string } = {}
): GameState {
  let current = state;
  for (let i = 0; i < count; i++) {
    current = grantAdditionalAttack(current, {
      actingPlayerId: options.actingPlayerId ?? "alice",
      sourceInstanceId,
      ...(options.originKey !== undefined
        ? { originKey: options.originKey }
        : {}),
    });
  }
  return current;
}

/** この個体がいま行使できる追加アタック権の個数(台帳から導出)。 */
export function additionalAttackGrantCount(
  state: GameState,
  sourceInstanceId: string
): number {
  return additionalAttackGrantRemaining(state, sourceInstanceId);
}

/** 追加アタック権を1つ行使した状態にする。 */
export function useAdditionalAttackGrant(
  state: GameState,
  sourceInstanceId: string
): GameState {
  return consumeAdditionalAttackGrant(state, sourceInstanceId);
}

/**
 * 進行中の activeAttack へ連続バトル権(継続 remainingUses 回)を付与する。
 * activeAttack には grantId の参照だけが入り、残量は台帳が持つ。
 */
export function withConnectBattleGrant(
  state: GameState,
  grant: {
    sourceInstanceId: string;
    remainingUses: number;
    actingPlayerId?: string;
    originKey?: string;
  }
): GameState {
  return grantConnectBattle(state, {
    actingPlayerId: grant.actingPlayerId ?? "alice",
    sourceInstanceId: grant.sourceInstanceId,
    maxUses: grant.remainingUses,
    ...(grant.originKey !== undefined ? { originKey: grant.originKey } : {}),
  });
}

/** 進行中のアタックが参照する連続バトル権の残り継続回数(台帳から導出)。権利が無ければ undefined。 */
export function connectBattleRemainingUses(
  state: GameState
): number | undefined {
  return getActiveAttackConnectBattleGrant(state)?.remaining;
}

/** 進行中のアタックが参照する連続バトル権の grantId。 */
export function connectBattleGrantId(state: GameState): string | undefined {
  return state.activeAttack?.connectBattleGrantId ?? undefined;
}

/**
 * いま行使できる追加アタック権を、受益個体のIDの配列で返す(個数ぶん重複)。
 * 旧 `pendingAdditionalAttackGrants`(未行使の権利の配列)に相当する、台帳からの導出値。
 */
export function outstandingAdditionalAttackGrants(state: GameState): string[] {
  const subjects = new Set(
    state.effectAccounting.grants
      .filter((grant) => grant.grantKind === "additional_attack")
      .flatMap((grant) =>
        grant.subjectInstanceId !== undefined ? [grant.subjectInstanceId] : []
      )
  );
  return [...subjects].flatMap((subject) =>
    Array<string>(additionalAttackGrantCount(state, subject)).fill(subject)
  );
}
