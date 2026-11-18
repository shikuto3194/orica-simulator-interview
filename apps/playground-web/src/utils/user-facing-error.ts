/** エンジン・ブラウザの診断文を、そのまま英語の操作メッセージとして表示しない。 */
export function userFacingError(
  error: unknown,
  fallback = "操作に失敗しました"
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/[ぁ-んァ-ヶ一-龠]/.test(message)) return message;
  const labels: Record<string, string> = {
    "Failed to fetch": "通信に失敗しました。接続を確認して再試行してください",
    "Load failed": "読み込みに失敗しました",
    "NetworkError when attempting to fetch resource.":
      "通信に失敗しました。接続を確認して再試行してください",
  };
  return Object.hasOwn(labels, message) ? labels[message]! : fallback;
}
