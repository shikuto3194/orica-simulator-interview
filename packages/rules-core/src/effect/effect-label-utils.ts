import type { Effect } from "../dsl-types";

/** A shared 時 suffix applies to every member of a printed compound heading. */
function hasPrintedTiming(text: string, timing: string): boolean {
  return new RegExp(`${timing}(?:[/／][^『』時/／]+)*時`).test(text);
}

function isEffectTimingHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  const hasTimingText =
    /『[^』]*(?:召喚|煌臨|契約合体|配置|アタック|ブロック)[^』]*時[^』]*』/.test(
      trimmed
    ) || /『[^』]*バトル終了[^』]*』/.test(trimmed);
  return hasTimingText && /^(?:Lv\d|【[^】]+】|『)/.test(trimmed);
}

function getEffectContextLines(
  effect: Effect,
  sourceTextLines: readonly string[] | undefined
): string[] {
  if (!sourceTextLines || !effect.textRef || effect.textRef.length === 0) {
    return effect.heading ? [effect.heading] : [];
  }
  const contextLineIndexes = new Set<number>();
  for (const index of effect.textRef) {
    const ownLine = sourceTextLines[index] ?? "";
    if (isEffectTimingHeadingLine(ownLine)) {
      contextLineIndexes.add(index);
    }
    for (let i = index - 1; i >= 0; i--) {
      const line = sourceTextLines[i] ?? "";
      if (line.trim() === "") break;
      if (isEffectTimingHeadingLine(line)) {
        contextLineIndexes.add(i);
        break;
      }
    }
  }
  return [...contextLineIndexes]
    .sort((a, b) => a - b)
    .map((index) => sourceTextLines[index] ?? "");
}

export function deriveEffectLabelsFromTextRefs(
  effect: Effect,
  sourceTextLines: readonly string[] | undefined,
  eventAction?: string | readonly string[]
): string[] {
  const contextLines = getEffectContextLines(effect, sourceTextLines);
  if (contextLines.length === 0) {
    return [];
  }
  const text = contextLines.join("\n");
  const labels: string[] = [];
  const mentionsSpirit =
    text.includes("このスピリット") ||
    text.includes("スピリット/アルティメット") ||
    text.includes("スピリット/ブレイヴ");
  const mentionsUltimate =
    text.includes("このアルティメット") ||
    text.includes("このスピリット/アルティメット");
  const mentionsNexus = text.includes("このネクサス");
  const hasAttackTime = hasPrintedTiming(text, "アタック");
  const hasBlockTime = hasPrintedTiming(text, "ブロック");
  const hasSummonTime = hasPrintedTiming(text, "召喚");
  const eventActions =
    eventAction === undefined
      ? []
      : Array.isArray(eventAction)
        ? eventAction
        : [eventAction];
  const restrictByEventAction = eventActions.length > 0;
  if (
    hasAttackTime &&
    (!restrictByEventAction || eventActions.includes("attack"))
  ) {
    if (mentionsSpirit) labels.push("spirit_attack_time");
    if (mentionsUltimate) labels.push("ultimate_attack_time");
  }
  if (
    hasBlockTime &&
    (!restrictByEventAction || eventActions.includes("block"))
  ) {
    if (mentionsSpirit) labels.push("spirit_block_time");
    if (mentionsUltimate) labels.push("ultimate_block_time");
  }
  if (
    hasSummonTime &&
    (!restrictByEventAction || eventActions.includes("summon"))
  ) {
    if (mentionsSpirit) labels.push("spirit_summon_time");
    if (mentionsUltimate) labels.push("ultimate_summon_time");
  }
  if (
    hasPrintedTiming(text, "煌臨") &&
    (!restrictByEventAction || eventActions.includes("advent"))
  ) {
    if (mentionsSpirit) labels.push("spirit_advent_time");
    if (mentionsUltimate) labels.push("ultimate_advent_time");
  }
  if (
    hasPrintedTiming(text, "配置") &&
    mentionsNexus &&
    (!restrictByEventAction || eventActions.includes("place"))
  ) {
    labels.push("nexus_place_time");
  }
  return labels;
}

export function deriveTriggerPhrasesFromTextRefs(
  effect: Effect,
  sourceTextLines: readonly string[] | undefined
): string[] | undefined {
  const parts: string[] = [];
  if (effect.heading) parts.push(effect.heading);
  if (sourceTextLines && effect.textRef && effect.textRef.length > 0) {
    const contextLineIndexes = new Set<number>();
    for (const index of effect.textRef) {
      contextLineIndexes.add(index);
      for (let i = index - 1; i >= 0; i--) {
        const line = sourceTextLines[i] ?? "";
        if (line.trim() === "") break;
        if (isEffectTimingHeadingLine(line)) {
          contextLineIndexes.add(i);
          break;
        }
      }
    }
    parts.push(
      ...[...contextLineIndexes]
        .sort((a, b) => a - b)
        .map((index) => sourceTextLines[index] ?? "")
    );
  }
  const text = parts.join("\n");
  if (text.length === 0) return undefined;

  const phrases: string[] = [];
  const push = (phrase: string) => {
    if (!phrases.includes(phrase)) phrases.push(phrase);
  };
  for (const timing of ["召喚", "契約合体", "配置", "アタック", "ブロック"]) {
    if (hasPrintedTiming(text, timing)) push(`${timing}時`);
  }
  if (text.includes("バトル終了")) push("バトル終了");
  return phrases.length > 0 ? phrases : undefined;
}

export function effectMatchesCardEventLabel(
  effect: Effect,
  sourceTextLines: readonly string[] | undefined,
  events: readonly string[],
  opts?: { requireSelfReference?: boolean }
): boolean {
  const labels = deriveEffectLabelsFromTextRefs(
    effect,
    sourceTextLines,
    effect.timing.kind === "card_event" ? effect.timing.event : undefined
  );
  if (opts?.requireSelfReference === true) {
    const text = getEffectContextLines(effect, sourceTextLines).join("\n");
    if (
      !text.includes("このスピリット") &&
      !text.includes("このアルティメット") &&
      !text.includes("このスピリット/アルティメット")
    ) {
      return false;
    }
  }
  const wanted = new Set<string>();
  if (events.includes("attack")) {
    wanted.add("spirit_attack_time");
    wanted.add("ultimate_attack_time");
  }
  if (events.includes("block")) {
    wanted.add("spirit_block_time");
    wanted.add("ultimate_block_time");
  }
  if (events.includes("summon")) {
    wanted.add("spirit_summon_time");
    wanted.add("ultimate_summon_time");
  }
  return labels.some((label) => wanted.has(label));
}

/** 魂状態でも同じ個体として使用回数を引き継ぐ効果か。効果単位の DSL / 本文参照を正源とする。 */
export function effectIncludesSoulState(
  effect: Effect | undefined,
  sourceTextLines: readonly string[] | undefined
): boolean {
  if (!effect) return false;
  const applicability = effect.applicability;
  // 同じ本文を spirit/soul の別 DSL 効果に分割している場合、soulState:false でも本文の魂状態見出しを共有する。
  const zones = applicability?.zone;
  if (
    applicability?.soulState === true ||
    zones === "soul_state" ||
    (Array.isArray(zones) && zones.includes("soul_state"))
  )
    return true;
  const lines = [
    effect.heading ?? "",
    ...(effect.textRef ?? []).map((i) => sourceTextLines?.[i] ?? ""),
  ];
  return lines.some((line) => /[【〖]魂状態[】〗]/.test(line));
}
