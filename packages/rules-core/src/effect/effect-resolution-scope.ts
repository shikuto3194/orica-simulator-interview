import { requireTriggerChainId } from "../chain-id";
import {
  getBattleEndDeferralChainId,
  isBattleEndDeferralChainForAttack,
} from "../battle/battle-end-finalize-blockers";
import { executeEffect, type ExecuteEffectOptions } from "./effect-interpreter";
import {
  finalizeEffectResolution,
  runActionMainResolution,
  type ActionMainResolutionOptions,
} from "./effect-resolution";

type WithoutChain<T> = Omit<T, "chainId"> & { chainId?: never };

/**
 * 解決の原因はこのスコープだけが所有する。再開と最終化で別のIDを選べない。
 * バトル終了の寿命情報を付ける場合も、原因ID全体を祖先として保持する。
 * beforeState と after_triggers の区間境界は各処理のまま保つ。
 */
export function createEffectResolutionScope(
  cause: {
    readonly chainId: string;
    readonly battleEndDeferralAttackId?: string;
  },
  battleEndAttackId = cause.battleEndDeferralAttackId
) {
  const chainId = getBattleEndScopedChainId(
    requireTriggerChainId(cause.chainId),
    battleEndAttackId
  );
  return {
    chainId,
    execute(options: WithoutChain<ExecuteEffectOptions>) {
      return executeEffect({ ...options, chainId });
    },
    finalize(
      options: WithoutChain<Parameters<typeof finalizeEffectResolution>[0]>
    ) {
      return finalizeEffectResolution({ ...options, chainId });
    },
    run<Context extends object>(
      options: WithoutChain<ActionMainResolutionOptions<Context>>
    ) {
      return runActionMainResolution({
        ...options,
        chainId,
        context: {
          ...options.context,
          ...(battleEndAttackId !== undefined
            ? { battleEndDeferralAttackId: battleEndAttackId }
            : {}),
        },
      });
    },
  } as const;
}

/** 寿命用の印を加えても、元の原因とその祖先を切らない。 */
function getBattleEndScopedChainId(
  baseChainId: string,
  battleEndAttackId: string | undefined
): string {
  if (
    battleEndAttackId === undefined ||
    isBattleEndDeferralChainForAttack(baseChainId, battleEndAttackId)
  )
    return baseChainId;
  return `${getBattleEndDeferralChainId(battleEndAttackId)}:${baseChainId}`;
}
