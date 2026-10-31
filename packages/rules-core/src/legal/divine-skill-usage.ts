import type {
  CardDefinition,
  DivineSkillTiming,
  GameState,
  SuppressionEffectDescriptor,
} from "../model";
import { getCardById } from "../card/card-lookup";
import { getEffectDescriptorSourceKindForPrintedCategory } from "../source-kinds";
import {
  canUseEffectByUsageLimit,
  executeReevaluationCheck,
} from "./legal-actions-shared";
import { deriveSuppressionEffectDescriptor } from "../effect/structured-effect-registrations";
import type { Effect } from "../dsl-types";

/**
 * Derive the per-turn usage ledger key for divine/guided skills.
 *
 * A printed `〔ターンに1回:同名〕` restriction is shared by cards with the
 * same name under one player, not across both players. Keep declaration and
 * availability on this single SSOT so their gate cannot diverge.
 */
export function getDivineSkillUsageKey(options: {
  sourceInstanceId: string;
  controllerPlayerId: string;
  sourceCardNo: string;
  skillIndex: number;
  turnLimit: "once" | "once_per_name";
}): string {
  if (options.turnLimit === "once_per_name") {
    return `${options.controllerPlayerId}:${options.sourceCardNo}:${options.skillIndex}`;
  }
  return `${options.sourceInstanceId}:${options.skillIndex}`;
}
export function deriveDivineSkillSuppressionEffectDescriptor(options: {
  sourceDefinitionId: string;
  sourceKind: NonNullable<SuppressionEffectDescriptor["sourceKind"]>;
  effectIndex: number;
  label: string;
  timing: DivineSkillTiming | undefined;
  effects?: readonly Effect[] | undefined;
}): SuppressionEffectDescriptor {
  const mode =
    typeof options.timing === "object" ? options.timing.mode : options.timing;
  const containsActionKinds = [
    ...new Set(
      (options.effects ?? []).flatMap(
        (effect) =>
          deriveSuppressionEffectDescriptor(effect).containsActionKinds ?? []
      )
    ),
  ];
  return {
    sourceDefinitionId: options.sourceDefinitionId,
    sourceKind: options.sourceKind,
    effectIndex: options.effectIndex,
    effectLabels: [options.label],
    keywords: [options.label],
    timingKind: "activated",
    ...(containsActionKinds.length > 0 ? { containsActionKinds } : {}),
    ...(mode === "main" || mode === "flash" ? { activatedMode: mode } : {}),
  };
}

/** 神技の列挙・宣言・解決は同じ効果抑止判定を通す。 */
export function canActivateDivineSkillEffect(
  state: GameState,
  sourceInstanceId: string,
  skillIndex: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const source = getCardById(state, sourceInstanceId);
  const definition = source && getCardDefinitionById(source.definitionId);
  const skill = definition?.grandwalkerData?.divineSkills?.[skillIndex];
  if (!source || source.zone !== "field" || !definition || !skill) return false;
  return executeReevaluationCheck({
    state,
    sourceInstanceId,
    checkKind: "effect_suppression",
    targetInstanceIds: [],
    getCardDefinitionById,
    suppressionEffectDescriptor: deriveDivineSkillSuppressionEffectDescriptor({
      sourceDefinitionId: source.definitionId,
      sourceKind: getEffectDescriptorSourceKindForPrintedCategory(
        definition.printedCategory
      ),
      effectIndex: skillIndex,
      label: skill.label,
      timing: skill.timing,
      effects: skill.effects,
    }),
  });
}

/** 回数制限は宣言時だけ確認する。消費済みの宣言を解決するときは再判定しない。 */
export function canDeclareDivineSkillEffect(
  state: GameState,
  sourceInstanceId: string,
  skillIndex: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (
    !canActivateDivineSkillEffect(
      state,
      sourceInstanceId,
      skillIndex,
      getCardDefinitionById
    )
  )
    return false;
  const source = getCardById(state, sourceInstanceId)!;
  const skill = getCardDefinitionById(source.definitionId)!.grandwalkerData!
    .divineSkills![skillIndex]!;
  return (
    !skill.usageLimit ||
    canUseEffectByUsageLimit({
      state,
      sourceInstanceId,
      sourceDefinitionId: source.definitionId,
      playerId: source.controllerPlayerId,
      getCardDefinitionById,
      effectLabel: `divine_skill:${skillIndex}`,
      usageLimit: skill.usageLimit,
    })
  );
}
