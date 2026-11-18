import type {
  CardDefinition,
  DivineSkillTiming,
  GameState,
  SuppressionEffectDescriptor,
} from "../model";
import { getCardById } from "../card/card-lookup";
import { getEffectDescriptorSourceKindForPrintedCategory } from "../source-kinds";
import {
  abilityFingerprint,
  buildUsageConstraint,
  makeAbilityRef,
  sharedNameAbilityRef,
} from "../effect-usage";
import type { UsageSite } from "../effect/effect-usage-accounting";
import {
  canUseEffectUsage,
  executeReevaluationCheck,
} from "./legal-actions-shared";
import { deriveSuppressionEffectDescriptor } from "../effect/structured-effect-registrations";
import type { Effect } from "../dsl-types";

/**
 * 神技の使用枠(P3-170 I01)。回数制限は共通の `usageLimit` だけで表し、専用キーを持たない。
 * 宣言(applyDivineSkillAction)と列挙(availability)が同じ枠を参照するよう、ここで一度だけ組み立てる。
 * 〔ターンに1回:同名〕(per_card_name)は、同名かつ同一本文の技を、同じプレイヤー内で共有する。
 */
export function divineSkillUsageSite(options: {
  state: GameState;
  sourceInstanceId: string;
  skillIndex: number;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): UsageSite | undefined {
  const source = getCardById(options.state, options.sourceInstanceId);
  const definition =
    source && options.getCardDefinitionById(source.definitionId);
  const skill = definition?.grandwalkerData?.divineSkills?.[options.skillIndex];
  if (!source || !definition || !skill?.usageLimit) return undefined;
  return {
    state: options.state,
    ability: makeAbilityRef(
      "divine_skill",
      source.definitionId,
      `divineSkills[${options.skillIndex}]`
    ),
    nameAbility: sharedNameAbilityRef(
      definition.name,
      abilityFingerprint(skill)
    ),
    sourceInstanceId: options.sourceInstanceId,
    sourceDefinitionId: source.definitionId,
    playerId: source.controllerPlayerId,
    limits: skill.usageLimit,
    getCardDefinitionById: options.getCardDefinitionById,
    nameKey: definition.name,
  };
}

/**
 * 神技の宣言の観測(measure="observation")。回数制限の有無に関わらず、宣言のたびに1件記録する。
 * 回数制限(divineSkillUsageSite)とは別の枠で、上限で止めない。AI特徴量「このターンの神技使用数」の正源。
 */
export function divineSkillDeclarationObservationSite(options: {
  state: GameState;
  sourceInstanceId: string;
  skillIndex: number;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): UsageSite | undefined {
  const source = getCardById(options.state, options.sourceInstanceId);
  const definition =
    source && options.getCardDefinitionById(source.definitionId);
  if (!source || !definition) return undefined;
  return {
    state: options.state,
    ability: makeAbilityRef(
      "divine_skill",
      source.definitionId,
      `divineSkills[${options.skillIndex}]`
    ),
    sourceInstanceId: options.sourceInstanceId,
    sourceDefinitionId: source.definitionId,
    playerId: source.controllerPlayerId,
    nameKey: definition.name,
    constraints: [
      buildUsageConstraint({
        abilityRef: makeAbilityRef(
          "divine_skill",
          source.definitionId,
          `divineSkills[${options.skillIndex}]/declared`
        ),
        share: "instance",
        period: "turn",
        measure: "observation",
        commitPoint: "declaration",
      }),
    ],
  };
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
  const site = divineSkillUsageSite({
    state,
    sourceInstanceId,
    skillIndex,
    getCardDefinitionById,
  });
  return site === undefined || canUseEffectUsage(site);
}
