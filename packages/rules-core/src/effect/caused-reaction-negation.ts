import type { GameState } from "../model";

/** 原因効果の直接の反応だけを対象とする。反応からの再誘発は別の chainId になる。 */
export function isCausedReactionNegated(
  state: GameState,
  chainId: string | null | undefined,
  reactingPlayerId: string,
  kind: "effect" | "opponent_burst"
): boolean {
  return (
    chainId != null &&
    state.activeContinuousEffects.some(
      (ce) =>
        ce.modifierTag === "negate_caused_reaction" &&
        ce.metadata?.chainId === chainId &&
        ce.metadata.negateTarget === kind &&
        ce.actingPlayerId !== reactingPlayerId
    )
  );
}
