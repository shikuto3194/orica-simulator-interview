import { getCardById } from "../card/card-lookup";
import { matchesCardReferenceFilter } from "../card/card-filter";
import { evaluateCondition } from "./structured-condition-eval";
import { evaluateApplicability } from "./effect-applicability";
import type { ExecuteEffectOptions } from "./effect-interpreter";
import type { DSL, Effect, EffectStep } from "../dsl-types";
import type {
  CardDefinition,
  ConditionClause,
  ContinuousEffect,
  GameState,
} from "../model";

function withoutLevel(
  conditions: readonly ConditionClause[] | undefined
): ConditionClause[] {
  return (conditions ?? [])
    .filter((c) => c.kind !== "min_level")
    .map((c) =>
      c.kind === "any_of"
        ? { ...c, groups: c.groups.map((group) => withoutLevel(group)) }
        : c
    );
}

function ignoreEffectLevels(effect: Effect): Effect {
  const mapSteps = (steps: EffectStep[]): EffectStep[] =>
    steps.map((step) => ({
      ...step,
      ...(step.condition ? { condition: withoutLevel(step.condition) } : {}),
      ...(step.choice ? { choice: mapSteps(step.choice) } : {}),
    }));
  const { level: _level, ...applicability } = effect.applicability ?? {};
  return {
    ...effect,
    condition: withoutLevel(effect.condition),
    applicability,
    steps: mapSteps(effect.steps),
  };
}

/** アタック/ブロック時の常時部分も、誘発部分と同じイベント拡張に従う。 */
function extendBattleConditions(
  conditions: readonly ConditionClause[] | undefined,
  extension: NonNullable<
    Extract<
      DSL.GrantedEffectSourceSpec,
      { kind: "card_effects" }
    >["additionalEvents"]
  >
): { conditions: ConditionClause[]; extended: boolean } {
  let extended = false;
  const battleState = (event: string) =>
    event === "attack"
      ? ("attacking" as const)
      : event === "block"
        ? ("blocking" as const)
        : undefined;
  const extend = (clause: ConditionClause): ConditionClause => {
    if (clause.kind === "any_of")
      return {
        ...clause,
        groups: clause.groups.map((group) => group.map(extend)),
      };
    if (
      clause.kind !== "self_state" ||
      clause.reference !== "self" ||
      clause.battleState === undefined ||
      clause.battleState !== battleState(extension.source)
    )
      return clause;
    extended = true;
    return {
      kind: "any_of",
      groups: [
        [clause],
        ...extension.events.flatMap((event) => {
          const state = battleState(event);
          return state ? [[{ ...clause, battleState: state }]] : [];
        }),
      ],
    };
  };
  const mapped = (conditions ?? []).map(extend);
  return { conditions: mapped, extended };
}

/** 通常の効果付与を、動的な取得元と継続効果にも展開する。子CEのIDは再構築しても不変。 */
export function materializeGrantedEffects(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  execute: (options: ExecuteEffectOptions) => GameState
): GameState {
  let current: GameState = {
    ...state,
    activeContinuousEffects: state.activeContinuousEffects.filter(
      (ce) => !ce.metadata?.grantedParentEffectId
    ),
  };
  const processed = new Set<string>();
  for (
    let cursor = 0;
    cursor < current.activeContinuousEffects.length;
    cursor++
  ) {
    const parent = current.activeContinuousEffects[cursor]!;
    if (
      parent.modifierTag !== "granted_effect" ||
      processed.has(parent.effectId)
    )
      continue;
    processed.add(parent.effectId);
    const host = parent.targetInstanceId
      ? getCardById(current, parent.targetInstanceId)
      : undefined;
    if (!host || host.zone !== "field") continue;
    const source = parent.metadata?.grantedEffectSource as
      | DSL.GrantedEffectSourceSpec
      | undefined;
    if (source?.kind === "card_effects") {
      const ids =
        source.from.kind === "under_cards"
          ? new Set(host.underCards.map((u) => u.cardInstanceId))
          : undefined;
      const ancestors =
        (parent.metadata?.grantedDonorIds as string[] | undefined) ?? [];
      let donors = current.cardInstances.filter((card) => {
        if (card.faceDown || ancestors.includes(card.instanceId)) return false;
        if (source.from.kind === "zones") {
          if (card.attachedToInstanceId) return false;
          const player = source.from.player ?? "self";
          if (
            player === "self" &&
            card.controllerPlayerId !== host.controllerPlayerId
          )
            return false;
          if (
            player === "opponent" &&
            card.controllerPlayerId === host.controllerPlayerId
          )
            return false;
        }
        if (
          source.from.kind === "under_cards"
            ? !ids?.has(card.instanceId)
            : !source.from.zones.includes(card.zone)
        )
          return false;
        const def = getCardDefinitionById(card.definitionId);
        return (
          !!def &&
          matchesCardReferenceFilter(card, def, source.from.filter, {
            state: current,
            getCardDefinitionById,
          })
        );
      });
      if (source.from.kind === "zones" && source.from.maxCards !== undefined)
        donors = donors.slice(0, source.from.maxCards);
      const children: ContinuousEffect[] = [];
      for (const donor of donors) {
        const def = getCardDefinitionById(donor.definitionId)!;
        const header = def.textLines.findIndex((line) =>
          line.includes(source.afterTextHeader)
        );
        if (header < 0) continue;
        for (const [effectIndex, printed] of (def.effects ?? []).entries()) {
          if (!printed.textRef?.some((line) => line >= header)) continue;
          let effect = source.ignoreLevel
            ? ignoreEffectLevels(printed)
            : printed;
          const extension = source.additionalEvents;
          let appliedAdditionalEvents: readonly string[] = [];
          if (
            extension &&
            evaluateCondition(
              current,
              extension.condition ?? [],
              host.instanceId,
              host.controllerPlayerId,
              getCardDefinitionById
            )
          ) {
            const extended = extendBattleConditions(
              effect.condition,
              extension
            );
            if (extended.extended) appliedAdditionalEvents = extension.events;
            effect = {
              ...effect,
              condition: extended.conditions,
            };
            if (effect.timing.kind === "card_event") {
              const events = Array.isArray(effect.timing.event)
                ? effect.timing.event
                : [effect.timing.event];
              if (events.includes(extension.source)) {
                appliedAdditionalEvents = extension.events;
                effect = {
                  ...effect,
                  timing: {
                    ...effect.timing,
                    event: [...new Set([...events, ...extension.events])],
                  },
                };
              }
            }
          }
          const { provenance: _parentProvenance, ...parentBase } = parent;
          children.push({
            ...parentBase,
            effectId: `${parent.effectId}:donor:${donor.instanceId}:${effectIndex}`,
            sourceInstanceId: host.instanceId,
            sourceDefinitionId: host.definitionId,
            metadata: {
              grantedEffect: effect,
              grantedEffectSourceInstanceId: donor.instanceId,
              grantedEffectSourceDefinitionId: donor.definitionId,
              grantPlayerRef: "self",
              grantedParentEffectId: parent.effectId,
              grantedDonorIds: [...ancestors, donor.instanceId],
              // 表示も、エンジンがこの能力へ実際に適用したイベント拡張に従う。
              ...(appliedAdditionalEvents.length > 0
                ? { grantedAdditionalEvents: appliedAdditionalEvents }
                : {}),
            },
          });
        }
      }
      current = {
        ...current,
        activeContinuousEffects: [
          ...current.activeContinuousEffects,
          ...children,
        ],
      };
      continue;
    }
    const effect = parent.metadata?.grantedEffect as Effect | undefined;
    if (effect?.timing.kind !== "continuous") continue;
    if (
      !evaluateCondition(
        current,
        effect.condition ?? [],
        host.instanceId,
        host.controllerPlayerId,
        getCardDefinitionById
      )
    )
      continue;
    if (
      effect.applicability &&
      !evaluateApplicability(
        current,
        effect.applicability,
        host.instanceId,
        getCardDefinitionById
      )
    )
      continue;
    const before = new Set(
      current.activeContinuousEffects.map((ce) => ce.effectId)
    );
    const next = execute({
      state: current,
      chainId: `continuous:${parent.effectId}:${host.instanceId}`,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: host.controllerPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    let addedIndex = 0;
    current = {
      ...next,
      activeContinuousEffects: next.activeContinuousEffects.map((ce) => {
        if (before.has(ce.effectId)) return ce;
        const { provenance: _childProvenance, ...child } = ce;
        return {
          ...child,
          effectId: `${parent.effectId}:continuous:${addedIndex++}`,
          metadata: {
            ...ce.metadata,
            grantedParentEffectId: parent.effectId,
            grantedDonorIds: parent.metadata?.grantedDonorIds ?? [],
          },
        };
      }),
    };
  }
  return current;
}
