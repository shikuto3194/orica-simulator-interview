export interface ActionButtonChoice {
  key: string;
  label: string;
  sourceId?: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

/** 同じ効果元・同じ文言は1つの入口にする。候補を捨てて代表だけ実行しない。 */
export function groupActionButtonChoices<T extends ActionButtonChoice>(
  choices: readonly T[]
): T[][] {
  const groups = new Map<string, T[]>();
  for (const choice of choices) {
    const key = JSON.stringify([choice.sourceId ?? "", choice.label.trim()]);
    const group = groups.get(key) ?? [];
    group.push(choice);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** 分岐では効果本文を表示する。同じ本文の独立効果も捨てず番号で識別する。 */
export function distinguishActionButtonChoices<T extends ActionButtonChoice>(
  choices: readonly T[]
): T[] {
  const labels = choices.map(
    (choice) => choice.description?.trim() || choice.label
  );
  const used = new Set<string>();
  const distinct = choices.map((choice, index) => {
    const base = labels[index]!;
    let label =
      labels.filter((candidate) => candidate === base).length > 1
        ? `${base}（選択肢${index + 1}）`
        : base;
    while (used.has(label)) label += `（${index + 1}）`;
    used.add(label);
    return { ...choice, label };
  });
  assertUniqueActionButtonLabels(distinct);
  return distinct;
}

/** 表示直前の不変条件。同一画面・同一効果元の同文言ボタンは生成禁止。 */
export function assertUniqueActionButtonLabels(
  choices: readonly Pick<ActionButtonChoice, "sourceId" | "label">[]
): void {
  const seen = new Set<string>();
  for (const choice of choices) {
    const key = JSON.stringify([choice.sourceId ?? "", choice.label.trim()]);
    if (seen.has(key)) throw new Error(`Duplicate action button: ${key}`);
    seen.add(key);
  }
}
