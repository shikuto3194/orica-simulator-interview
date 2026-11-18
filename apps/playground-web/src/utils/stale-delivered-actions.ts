import type { GameState, LegalAction } from "@orica/rules-core";
import { PASS_ACTION_KINDS } from "../components/action-ui";

/**
 * room 対戦で、サーバーが `state.viewerLegalActions` として配送した合法手は
 * 配送 state と同じ version でしか置換されない。操作直後の楽観 state はエンジンが
 * 配送欄を触らず引き継ぐため、確定 state が届くまで「操作前の一覧」を指し続ける。
 *
 * 効果キューは楽観 state から即座に消えるが、キュー項目に紐づかないパス系だけは
 * 古い一覧から ActionBar に残る。送信中は配送一覧由来のパス系を隠して揃える。
 * 配送一覧が無い局面 (ローカル再計算) は楽観 state 上で正しいため対象外。
 */
export function dropStaleDeliveredPassActions(
  actions: readonly LegalAction[],
  options: { deliveredByServer: boolean; dispatchPending: boolean }
): LegalAction[] {
  if (!options.deliveredByServer || !options.dispatchPending) {
    return [...actions];
  }
  return actions.filter((action) => !PASS_ACTION_KINDS.has(action.kind));
}

/**
 * 自分の合法手の正源。room で配送一覧があればそれを使い (本人宛のときのみ)、
 * 無ければローカルエンジンで再計算する。送信中の古い配送一覧は上の関数で補正する。
 */
export function resolveViewerActions(options: {
  roomId: string | null | undefined;
  delivered: GameState["viewerLegalActions"];
  viewingPlayer: string;
  dispatchPending: boolean;
  computeLocalActions: () => readonly LegalAction[];
}): LegalAction[] {
  const delivered = options.roomId ? options.delivered : undefined;
  const actions = delivered
    ? delivered.actingPlayerId === options.viewingPlayer
      ? delivered.actions
      : []
    : options.computeLocalActions();
  return dropStaleDeliveredPassActions(actions, {
    deliveredByServer: !!delivered,
    dispatchPending: options.dispatchPending,
  });
}
