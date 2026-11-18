/**
 * 「盤面確認」ボタンは画面に1つだけ。何を一時的に隠すかは、いま出ている層で決まる。
 *  - modal : 対象選択などの全画面モーダル (modalsHidden を切り替える)
 *  - queue : 効果キュー (カード群と ActionBar をまとめて隠す)
 *  - action: キューが無いときの ActionBar だけ
 * 優先度は modal > queue > action。
 */
export type BoardPeekLayer = "modal" | "queue" | "action";

export function boardPeekLayer(input: {
  hasFullScreenModal: boolean;
  queueCount: number;
  actionButtonCount: number;
}): BoardPeekLayer | null {
  if (input.hasFullScreenModal) return "modal";
  if (input.queueCount > 0) return "queue";
  if (input.actionButtonCount > 0) return "action";
  return null;
}

export function boardPeekLabel(input: {
  layer: BoardPeekLayer;
  peeked: boolean;
  queueCount: number;
  modalReturnLabel: string;
}): string {
  if (!input.peeked) return "盤面確認";
  if (input.layer === "modal") return input.modalReturnLabel;
  if (input.layer === "queue") return `解決待ち ${input.queueCount}`;
  return "操作に戻る";
}

/**
 * ActionBar を隠すか。
 * 効果キューを隠した (盤面確認) ときは、ボタンが右側のデッキ等を覆わないよう一緒に隠す。
 * UI pending 中のキュー自動非表示は盤面確認ではないので、ここでは隠さない。
 */
export function isActionBarPeeked(input: {
  layer: BoardPeekLayer | null;
  hasUiPending: boolean;
  effectQueueVisible: boolean;
  actionBarPeeked: boolean;
}): boolean {
  if (input.layer === "queue") {
    return !input.hasUiPending && !input.effectQueueVisible;
  }
  if (input.layer === "action") return input.actionBarPeeked;
  return false;
}
