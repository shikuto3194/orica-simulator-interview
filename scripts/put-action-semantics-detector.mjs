/**
 * 「出す」を summon 形状で表現してしまう旧 DSL の機械検出。
 *
 * 文言読解ではなく構造的不変条件だけを見る:
 * - token pool からの場入りは put
 * - enterFieldEventKind:"put" による summon 偽装は禁止
 * - token/通常召喚の混在選択は split_field_entry_choice
 */

function isObject(value) {
  return value !== null && typeof value === "object";
}

export function findPutActionSemanticIssues(root) {
  const issues = [];
  const visited = new Set();

  const visit = (value, path) => {
    if (!isObject(value) || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }

    if (value.kind === "summon" && value.target?.kind === "from_token_pool") {
      issues.push({
        path,
        detail: 'from_token_pool は kind:"put" で宣言する',
      });
    }
    if (value.kind === "summon" && value.enterFieldEventKind === "put") {
      issues.push({
        path,
        detail:
          'enterFieldEventKind:"put" で summon を偽装せず kind:"put" を使う',
      });
    }
    if (value.kind === "split_summon_choice") {
      issues.push({
        path,
        detail:
          'token put と通常 summon の混在選択は kind:"split_field_entry_choice" を使う',
      });
    }
    if (
      value.kind === "split_field_entry_choice" &&
      value.tokenAction?.kind !== "put"
    ) {
      issues.push({
        path: `${path}.tokenAction`,
        detail: 'split_field_entry_choice.tokenAction は kind:"put" にする',
      });
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key);
    }
  };

  visit(root, "");
  return issues;
}
