import { isInHandForOwnEffect } from "./card-access-rules";
import type { Effect } from "../dsl-types";
import { hasEffectiveAdventVariant } from "../mechanics/advent-variant";
import { matchesApplicabilityZoneList } from "../dsl-types";
import type { CardDefinition, CardInstance, GameState } from "../model";
import {
  collectUnderCardScopeIds,
  isCardInSetState,
  isImaginBraveDualCombined,
} from "../model";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import { isEffectivelyCombined } from "../mechanics/virtual-combine";
import { getEffectiveCategories } from "../mechanics/act-as-spirit";

export type EffectApplicabilityLevelEvaluator = (
  state: GameState,
  card: CardInstance,
  definition: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
) => number;

export function evaluateEffectApplicabilityForCard(options: {
  state: GameState;
  applicability: NonNullable<Effect["applicability"]>;
  card: CardInstance;
  definition: CardDefinition | undefined;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getCurrentLevel: EffectApplicabilityLevelEvaluator;
}): boolean {
  const applicability = options.applicability;
  if (applicability.adventSourceHostVariants) {
    const hosts = options.state.cardInstances.filter((host) =>
      host.underCards.some(
        (entry) =>
          entry.role === "advent_source" &&
          entry.cardInstanceId === options.card.instanceId
      )
    );
    if (
      hosts.length > 0 &&
      !hosts.some((host) => {
        if (host.zone !== "field" || host.faceDown) return false;
        return hasEffectiveAdventVariant(
          options.state,
          host.instanceId,
          options.getCardDefinitionById(host.definitionId),
          applicability.adventSourceHostVariants!
        );
      })
    )
      return false;
  }

  if (applicability.zone) {
    const zones = Array.isArray(applicability.zone)
      ? applicability.zone
      : [applicability.zone];
    const underCards = collectUnderCardScopeIds(options.state);
    const isAdventSource = underCards.adventSource.has(options.card.instanceId);
    const isSoulState = getEffectiveSoulStateIds(
      options.state,
      options.getCardDefinitionById
    ).has(options.card.instanceId);
    // runtime zone "burst" alone is insufficient: after burst activation is
    // declared, the face-up card stays in that zone but leaves setBurstStates.
    // "burst_set" applicability is restricted to the still-set state.
    const isBurstSet = isCardInSetState(options.state, options.card);
    if (
      !matchesApplicabilityZoneList(
        zones,
        isInHandForOwnEffect(
          options.state,
          options.card,
          options.card.controllerPlayerId,
          options.getCardDefinitionById
        )
          ? "hand"
          : options.card.zone,
        isAdventSource,
        isSoulState,
        isBurstSet
      )
    ) {
      return false;
    }
  }

  if (applicability.form !== undefined) {
    if (
      !options.definition ||
      !getEffectiveCategories(
        options.state,
        options.card,
        options.definition,
        options.getCardDefinitionById
      ).includes(applicability.form)
    )
      return false;
  }

  if (applicability.level) {
    if (options.definition === undefined) return false;
    const currentLevel = options.getCurrentLevel(
      options.state,
      options.card,
      options.definition,
      options.getCardDefinitionById
    );
    if (
      applicability.level.min !== undefined &&
      currentLevel < applicability.level.min
    ) {
      return false;
    }
    if (
      applicability.level.max !== undefined &&
      currentLevel > applicability.level.max
    ) {
      return false;
    }
  }

  if (applicability.combined !== undefined) {
    const isCombined = isEffectivelyCombined(options.state, options.card);
    if (applicability.combined !== isCombined) return false;
  }

  if (
    applicability.imaginDualCombined !== undefined &&
    applicability.imaginDualCombined !== isImaginBraveDualCombined(options.card)
  ) {
    return false;
  }

  if (applicability.soulState !== undefined) {
    const soulIds = getEffectiveSoulStateIds(
      options.state,
      options.getCardDefinitionById
    );
    if (applicability.soulState !== soulIds.has(options.card.instanceId)) {
      return false;
    }
  }

  return true;
}
