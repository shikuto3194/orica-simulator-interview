/**
 * BSTH03-X01「蓬莱山 輝夜」/ BSTH03-X04「藤原 妹紅」effects[0] (Lv3-Lv5 継続効果):
 * 「このアルティメットは、フィールドを離れず、コアがLv3コストより少なくならない。
 *  この効果は一切の効果を受けない。」
 *
 * effect_resistance(resistsOutcome:["leave_field","core_below_min"],
 * coreMinimumSource:{kind:"own_level_required_cores",level:3}, source:"all") の
 * 既存 primitive 組み合わせで表現する（BSTH08.5 面霊スピリット level:1 版 / BSTH03-X02
 * 「フィールドを離れず」source:"all" と同型。stale stub 解消）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const ALL_CARDS_MAP = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (cardNo: string): CardDefinition => {
  const def = ALL_CARDS_MAP.get(cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def;
};
const getCardDefinitionById = (id: string) => ALL_CARDS_MAP.get(id);
const emptyLookup = () => undefined;

function makeCoreShootSource(amount: number): CardDefinition {
  return {
    cardNo: "SRC-CORESHOOT-X01X04",
    name: "コアシュート源",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: { category: ["ultimate"] },
              },
              to: { kind: "void", player: "opponent" },
              amount,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

describe.each(["BSTH03-X01", "BSTH03-X04"])(
  "%s effects[0]: フィールド離脱不可 + コアLv3コスト下限 + 一切の効果を受けない (source:all)",
  (cardNo) => {
    const ultimate = card(cardNo);
    const continuous = ultimate.effects![0]!;

    it("DSL 構造: effect_resistance(resistsOutcome:[leave_field, core_below_min], coreMinimumSource:own_level_required_cores lv3, source:all)", () => {
      expect(continuous.stub).toBeUndefined();
      expect(continuous.timing).toEqual({ kind: "continuous" });
      expect(continuous.condition).toEqual([{ kind: "min_level", value: 3 }]);
      const action = continuous.steps[0]!.action;
      expect(action.kind).toBe("effect_resistance");
      if (action.kind === "effect_resistance") {
        expect(action.resistsOutcome).toEqual([
          "leave_field",
          "core_below_min",
        ]);
        expect(action.source).toBe("all");
        expect(action.coreMinimumSource).toEqual({
          kind: "own_level_required_cores",
          level: 3,
        });
        expect(action.duration).toEqual({ scope: "while_on_field" });
      }
    });

    it("[board] Lv3必要コア数(1)より少なくなる相手のコア除去は、下限(1)でクランプされる", () => {
      const src = makeCoreShootSource(5);
      const level3RequiredCores = ultimate.levelDefs.find(
        (l) => l.level === 3
      )!.requiredCores;
      expect(level3RequiredCores).toBe(1);

      const defs = new Map<string, CardDefinition>([
        [src.cardNo, src],
        [ultimate.cardNo, ultimate],
      ]);
      const state = rebuildContinuousEffectsFromField(
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
          activePlayerId: "bob",
          cardInstances: [
            createCardInstance(src, {
              instanceId: "src-bob",
              ownerPlayerId: "bob",
              zone: "field",
            }),
            createCardInstance(ultimate, {
              instanceId: "alice-ultimate",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 3,
            }),
          ],
        },
        getCardDefinitionById
      );

      const result = executeEffect({
        chainId: "test:bsth03-x01-x04-leave-core-floor:126",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-bob",
        actingPlayerId: "bob",
        getCardDefinitionById: (id) => defs.get(id),
        getRegisteredTriggeredEffectActions: emptyLookup,
      });

      const after = result.cardInstances.find(
        (c) => c.instanceId === "alice-ultimate"
      )!;
      // amount:5 の除去でも Lv3 requiredCores(1) を割り込めずクランプされる。
      expect(after.normalCoreCount).toBe(level3RequiredCores);
    });

    it("[board] 相手の破壊効果はフィールド離脱不可耐性(source:all)で防がれる", () => {
      const state: GameState = rebuildContinuousEffectsFromField(
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
          activePlayerId: "bob",
          cardInstances: [
            createCardInstance(ultimate, {
              instanceId: "alice-ultimate",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 3,
            }),
          ],
        },
        getCardDefinitionById
      );

      const destroyEffect = {
        timing: { kind: "activated" as const, mode: "flash" as const },
        steps: [
          {
            action: {
              kind: "destroy" as const,
              target: {
                kind: "filter" as const,
                player: "opponent" as const,
                filter: { category: ["ultimate" as const] },
                count: 1,
              },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:bsth03-x01-x04-leave-core-floor:176",
        state,
        effect: destroyEffect,
        sourceInstanceId: "alice-ultimate",
        actingPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: emptyLookup,
      });

      const after = result.cardInstances.find(
        (c) => c.instanceId === "alice-ultimate"
      )!;
      expect(after.zone).toBe("field");
    });
  }
);
