/** ゲーム終了理由の表示用ラベル。内部 reason はリプレイ用に変更しない。 */
export function gameResultReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    illegal_burst_set: "不正バーストセット",
    life_zero: "ライフ 0",
    deck_out: "デッキアウト",
  };
  if (Object.hasOwn(labels, reason)) return labels[reason]!;
  return /[ぁ-んァ-ヶ一-龠]/.test(reason) ? reason : "ゲーム終了";
}
