import type { CardDefinition, GameState, TriggeredMechanic } from "../model";
import { getCardById } from "../card/card-lookup";
import { executeReevaluationCheck } from "../legal/legal-actions-shared";

type NexusMechanic = Exclude<TriggeredMechanic, { kind: "granted_effect" }>;

/** 専用機構も通常のカード効果と同じ対象・耐性・効果抑止判定を通す。 */
export function canActivateNexusMechanicEffect(
  state: GameState,
  sourceInstanceId: string,
  kind: NexusMechanic["kind"],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const source = getCardById(state, sourceInstanceId);
  const definition = source && getCardDefinitionById(source.definitionId);
  const isStone = kind === "unseal" || kind === "stone_rebirth";
  if (
    !source ||
    source.zone !== "field" ||
    !(isStone ? definition?.grandstoneData : definition?.grandwalkerData)
  )
    return false;
  return executeReevaluationCheck({
    state,
    sourceInstanceId,
    checkKind: "effect_suppression",
    targetInstanceIds: [],
    getCardDefinitionById,
    suppressionEffectDescriptor: {
      sourceDefinitionId: source.definitionId,
      sourceKind: "nexus",
      timingKind: "triggered",
      keywords: [
        kind === "placement_oracle"
          ? "oracle"
          : kind === "stone_rebirth"
            ? "rebirth"
            : kind,
      ],
    },
  });
}
