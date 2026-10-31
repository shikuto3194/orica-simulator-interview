interface LogPanelProps {
  log: readonly string[];
  maxEntries?: number;
}

const PLAYER_JA: Record<string, string> = { alice: "自分", bob: "相手" };

/** ログエントリを読みやすくフォーマット。マッチしなければ原文を返す。 */
function formatLogEntry(entry: string): string | null {
  // 公開情報: 手札に加えたカード
  const pickedMatch = entry.match(/^deck_reveal:picked_cards:(\w+):(.+)$/);
  if (pickedMatch) {
    const player = PLAYER_JA[pickedMatch[1]!] ?? pickedMatch[1]!;
    const cards = pickedMatch[2]!.split(",");
    return `📖 ${player}が手札に加えた: ${cards.join("、")}`;
  }
  const privatePickedMatch = entry.match(
    /^deck_reveal:picked_cards_private:(\w+):count=(\d+)$/
  );
  if (privatePickedMatch) {
    const player = PLAYER_JA[privatePickedMatch[1]!] ?? privatePickedMatch[1]!;
    return `📖 ${player}がカード${privatePickedMatch[2]}枚を手札に加えた`;
  }
  // revealed 効果: 強制手札追加
  const autoAddMatch = entry.match(/^deck_reveal:auto_add_hand:(\w+):(.+)$/);
  if (autoAddMatch) {
    const player = PLAYER_JA[autoAddMatch[1]!] ?? autoAddMatch[1]!;
    const cards = autoAddMatch[2]!.split(",");
    return `📖 ${player}のオープンカードを自動で手札に追加: ${cards.join("、")}`;
  }
  // revealed 効果: 任意手札追加
  const revChoiceMatch = entry.match(
    /^deck_reveal:revealed_choice_add_hand:(\w+):(.+)$/
  );
  if (revChoiceMatch) {
    const player = PLAYER_JA[revChoiceMatch[1]!] ?? revChoiceMatch[1]!;
    const cards = revChoiceMatch[2]!.split(",");
    return `📖 ${player}がオープンカードを手札に追加: ${cards.join("、")}`;
  }
  // デッキオープン
  const openMatch = entry.match(
    /^effect:deck_reveal:(\w+):open=(\d+)(?::revealTo=(self|opponent|both))?:pending$/
  );
  if (openMatch) {
    const player = PLAYER_JA[openMatch[1]!] ?? openMatch[1]!;
    if (openMatch[3] === "self") {
      return `📖 ${player}がデッキを${openMatch[2]}枚見る`;
    }
    return `📖 ${player}がデッキを${openMatch[2]}枚オープン`;
  }
  // 召喚
  const summonMatch = entry.match(
    /^summon:declare:.*?:(\w+):main:summon:.*?:([\w-]+)$/
  );
  if (summonMatch) {
    const player = PLAYER_JA[summonMatch[1]!] ?? summonMatch[1]!;
    return `🃏 ${player}がスピリットを召喚 (${summonMatch[2]})`;
  }
  // 誘発効果解決
  if (entry.includes("trigger:resolve-main:start")) return null; // 詳細は省略
  if (entry.includes("trigger:resolve-main:end")) return null;
  // 非表示にするノイズログ
  if (entry.startsWith("summon:") && !entry.includes("declare")) return null;
  if (entry.startsWith("burst:queued:")) return null;
  if (entry.startsWith("trigger:queued:")) return null;
  return entry;
}

export function LogPanel({ log, maxEntries = 20 }: LogPanelProps) {
  const recent = log.slice(-maxEntries * 2); // フィルタ後に最大件数になるよう余分に取る
  const formatted = recent
    .map(formatLogEntry)
    .filter((e): e is string => e !== null)
    .slice(-maxEntries);

  return (
    <div className="log-panel">
      <h3 className="log-title">ログ</h3>
      <div className="log-entries">
        {formatted.map((entry, i) => (
          <div key={i} className="log-entry">
            {entry}
          </div>
        ))}
        {log.length === 0 && <div className="log-empty">ログなし</div>}
      </div>
    </div>
  );
}
