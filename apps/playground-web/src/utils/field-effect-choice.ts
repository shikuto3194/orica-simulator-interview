import type {
  CardDefinition,
  FieldCardEffectLegalAction,
} from "@orica/rules-core";

export function getFieldEffectActionDefinitionId(
  action: FieldCardEffectLegalAction
): string {
  return (
    action.sourceEffectDefinitionId ??
    action.sourceCardNo ??
    action.sourceDefinitionId
  );
}

export function fieldEffectChoiceActionKey(
  action: FieldCardEffectLegalAction
): string {
  return [
    action.grantedEffectCeId ? `granted:${action.grantedEffectCeId}` : "field",
    action.sourceInstanceId,
    action.sourceEffectInstanceId ?? action.sourceInstanceId,
    getFieldEffectActionDefinitionId(action),
    action.sourceKind,
    action.timing,
    action.registrationIndex,
    action.choiceIndex ?? "",
  ].join(":");
}

export function dedupeFieldEffectChoiceActions<
  T extends FieldCardEffectLegalAction,
>(actions: readonly T[]): T[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = fieldEffectChoiceActionKey(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function compactEffectChoiceText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** 共通の印字行に複数の支払い分岐がある場合は、選んだ個数の本文だけを表示する。 */
export function divineSkillChoiceText(text: string, coreCost: number): string {
  const branches = [...text.matchAll(/(\d+)個置いたとき、/g)];
  const index = branches.findIndex((branch) => Number(branch[1]) === coreCost);
  if (branches.length < 2 || index < 0) return text;
  const branch = branches[index]!;
  return text
    .slice(branch.index! + branch[0].length, branches[index + 1]?.index)
    .trim();
}

export function extractEffectChoiceTextByEffectIndex(
  def: CardDefinition | undefined,
  effectIndex: number | undefined
): string | null {
  if (!def?.effects || effectIndex === undefined) return null;
  const textRef = def.effects[effectIndex]?.textRef;
  if (!textRef || textRef.length === 0) return null;
  const text = compactEffectChoiceText(
    textRef.map((lineIndex) => def.textLines[lineIndex] ?? "").join("\n")
  );
  return text.length > 0 ? text : null;
}
