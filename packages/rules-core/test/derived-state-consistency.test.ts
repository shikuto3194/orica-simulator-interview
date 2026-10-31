import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { createBattleResolutionEntitySnapshot } from "../src/battle/battle-shared";
import {
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
  recomputeAndRebuildContinuousEffectsForSources,
  recomputeAndRebuildBattleStateContinuousEffects,
} from "../src/effect/continuous-effect-rebuild";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import type { CardDefinition, GameState } from "../src/model";

const definition: CardDefinition = {
  cardNo: "TEST-DERIVED",
  name: "バトル常時効果",
  printedCategory: "spirit",
  colors: ["black"],
  symbolColors: ["black"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      condition: [{ kind: "in_battle" }],
      steps: [
        {
          action: {
            kind: "symbol_add",
            target: { kind: "self" },
            symbol: "black",
            duration: { scope: "while_on_field" },
          },
        },
        {
          action: {
            kind: "bp_modify",
            target: { kind: "self" },
            amount: 2000,
            duration: { scope: "while_on_field" },
          },
        },
      ],
    },
  ],
};
const lookup = (id: string) =>
  id === definition.cardNo ? definition : undefined;
function initial(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    battleEntities: [
      {
        entityId: "entity",
        memberInstanceIds: ["source"],
        attackState: "attacking",
        resolvedBp: 1000,
        resolvedSymbols: ["black"],
        resolvedSymbolCount: 1,
      },
    ],
  };
}
const rebuilders = [
  ["field", (s: GameState) => rebuildContinuousEffectsFromField(s, lookup)],
  ["full", (s: GameState) => recomputeAndRebuildContinuousEffects(s, lookup)],
  [
    "sources",
    (s: GameState) =>
      recomputeAndRebuildContinuousEffectsForSources(s, lookup, ["source"]),
  ],
  [
    "battle",
    (s: GameState) =>
      recomputeAndRebuildBattleStateContinuousEffects(s, lookup),
  ],
] as const;
const staleIssues = (state: GameState) =>
  collectGameStateInvariantIssues(state, {
    getCardDefinitionById: lookup,
  }).filter((issue) => issue.code === "stale_battle_entity_derived_value");

describe("継続効果の再構築境界がバトル現在値の同期まで所有する", () => {
  it.each(rebuilders)(
    "%s: 呼出元の追加処理なしでBP・シンボルを同期する",
    (_, rebuild) => {
      const before = initial();
      const after = rebuild(before);
      expect(after.battleEntities[0]).toMatchObject({
        resolvedBp: 3000,
        resolvedSymbols: ["black", "black"],
        resolvedSymbolCount: 2,
      });
      expect(staleIssues(after)).toEqual([]);
      expect(before.battleEntities[0]?.resolvedSymbolCount).toBe(1);
      expect(rebuild(after).battleEntities).toEqual(after.battleEntities);
    }
  );
  it.each(rebuilders.slice(1))(
    "%s: 条件終了で現在値を戻し、解決snapshotを保持する",
    (_, rebuild) => {
      const active = rebuild(initial());
      const snapshot = createBattleResolutionEntitySnapshot(
        active.battleEntities[0]!
      );
      const ended: GameState = {
        ...active,
        battleEntities: active.battleEntities.map((e) => ({
          ...e,
          attackState: "idle",
        })),
      };
      const after = rebuild(ended);
      expect(after.battleEntities[0]).toMatchObject({
        resolvedBp: 1000,
        resolvedSymbols: ["black"],
        resolvedSymbolCount: 1,
      });
      expect(snapshot).toMatchObject({
        resolvedBp: 3000,
        resolvedSymbols: ["black", "black"],
        resolvedSymbolCount: 2,
      });
      expect(staleIssues(after)).toEqual([]);
    }
  );
  it("対象sourceが空でも失効後の現在値を同期する", () => {
    const active = recomputeAndRebuildContinuousEffects(initial(), lookup);
    const ended: GameState = {
      ...active,
      battleEntities: active.battleEntities.map((e) => ({
        ...e,
        attackState: "idle",
      })),
    };
    const after = recomputeAndRebuildContinuousEffectsForSources(
      ended,
      lookup,
      []
    );
    expect(after.battleEntities[0]?.resolvedBp).toBe(1000);
    expect(after.battleEntities[0]?.resolvedSymbolCount).toBe(1);
  });
  it("CEだけ正しく保存値が古い状態を不変条件検査で検出する", () => {
    const active = recomputeAndRebuildContinuousEffects(initial(), lookup);
    const stale = { ...active, battleEntities: initial().battleEntities };
    expect(staleIssues(stale).map((issue) => issue.path)).toEqual([
      "battleEntities[0].resolvedBp",
      "battleEntities[0].resolvedSymbols",
      "battleEntities[0].resolvedSymbolCount",
    ]);
  });
});
