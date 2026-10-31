import { recomputeBattleEntityBp } from "../battle/battle-shared";
import type { CardDefinition, GameState } from "../model";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";

/** 現在値だけを照合する。解決時点を保持するparticipantSnapshotsは再評価しない。 */
export function collectBattleEntityDerivedValueIssues(options: {
  state: GameState;
  issues: GameStateInvariantIssue[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): void {
  const expected = recomputeBattleEntityBp(
    options.state,
    options.getCardDefinitionById
  );
  for (const [index, entity] of options.state.battleEntities.entries()) {
    const fresh = expected.battleEntities[index]!;
    const values = [
      ["resolvedBp", entity.resolvedBp, fresh.resolvedBp],
      ["resolvedSymbols", entity.resolvedSymbols, fresh.resolvedSymbols],
      [
        "resolvedSymbolCount",
        entity.resolvedSymbolCount ?? entity.resolvedSymbols.length,
        fresh.resolvedSymbolCount ?? fresh.resolvedSymbols.length,
      ],
    ] as const;
    for (const [field, actual, wanted] of values) {
      if (JSON.stringify(actual) === JSON.stringify(wanted)) continue;
      options.issues.push({
        code: "stale_battle_entity_derived_value",
        path: `battleEntities[${index}].${field}`,
        message: `${entity.entityId}.${field} differs from current effective value: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`,
      });
    }
  }
}
