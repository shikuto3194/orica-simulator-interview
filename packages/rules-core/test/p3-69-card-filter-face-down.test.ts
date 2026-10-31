/**
 * P3-69 Increment 3: card-filter の裏向き null-identity leak 閉鎖の回帰テスト。
 *
 * 裏向き + act_as_spirit 付与無しのカードは null identity = 名前/色/シンボル数/系統/BP/コスト
 * の *素性述語* に一切マッチしない (印字を漏らさない)。一方:
 *  - 表向きカード: 印字どおりマッチ (回帰なし)
 *  - act_as_spirit token: spirit category で従来どおり
 *  - 非素性述語 (zone 等) のみのフィルタ: 裏向きカードでもマッチする (過剰除外しない)
 */
import { describe, it, expect } from "vitest";
import { matchesCardFilter } from "../src/card/card-filter";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { CardFilter } from "../src/dsl-types";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import type { ActAsSpiritMetadata } from "../src/mechanics/act-as-spirit";

const ALICE = "player-1";

function nexusDef(): CardDefinition {
  return {
    cardNo: "TEST-NEXUS",
    name: "テストネクサス",
    printedCategory: "nexus",
    printedColors: ["purple"],
    symbolColors: ["purple", "purple"],
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 7000 }],
    textLines: [],
    images: {},
    tribe: "城・機獣",
    colors: ["purple"],
    keywordTags: [],
  } as unknown as CardDefinition;
}

function makeState(
  faceDown: boolean,
  ces: ContinuousEffect[] = []
): { state: GameState; card: ReturnType<typeof createCardInstance> } {
  const card = createCardInstance(nexusDef(), {
    instanceId: "card-1",
    ownerPlayerId: ALICE,
    zone: "field",
    faceDown,
    cores: 3,
  });
  const state: GameState = {
    ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
    cardInstances: [card],
    activeContinuousEffects: ces,
  };
  return { state, card };
}

function actAsSpiritCE(metadata: ActAsSpiritMetadata): ContinuousEffect {
  return {
    effectId: "ce-aas-card-1",
    sourceInstanceId: "host-1",
    sourceDefinitionId: "HOST",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId: "card-1",
    metadata: metadata as unknown as Record<string, unknown>,
  };
}

describe("P3-69 Increment 3: 裏向き null-identity は素性述語にマッチしない", () => {
  const def = nexusDef();

  const identityFilters: { label: string; filter: CardFilter }[] = [
    { label: "色", filter: { colors: ["purple"] } },
    { label: "色数 (mono)", filter: { colorCount: "mono" } },
    { label: "コスト下限", filter: { minCost: 1 } },
    { label: "コスト上限", filter: { maxCost: 99 } },
    { label: "BP 下限", filter: { minBp: 1 } },
    { label: "BP 上限", filter: { maxBp: 99999 } },
    { label: "シンボル数", filter: { symbolCount: 2 } },
    { label: "系統", filter: { tribes: ["城"] } },
    { label: "必須系統", filter: { tribesRequired: ["城"] } },
    { label: "カード名", filter: { cardName: { contains: "ネクサス" } } },
  ];

  it.each(identityFilters)(
    "裏向き付与無し: 印字に合致する $label フィルタでも非マッチ",
    ({ filter }) => {
      const { state, card } = makeState(true);
      expect(matchesCardFilter(card, def, filter, { state })).toBe(false);
    }
  );

  it.each(identityFilters)(
    "表向き: $label フィルタは印字どおりマッチ (回帰なし)",
    ({ filter }) => {
      const { state, card } = makeState(false);
      expect(matchesCardFilter(card, def, filter, { state })).toBe(true);
    }
  );

  it("非素性述語のみのフィルタ (空フィルタ) は裏向きカードでもマッチ (過剰除外しない)", () => {
    const { state, card } = makeState(true);
    expect(matchesCardFilter(card, def, {}, { state })).toBe(true);
  });

  it("state 無し (印字文脈) は裏向きでも印字フィルタにマッチ (face-up read 保持)", () => {
    const { card } = makeState(true);
    // state を渡さない = deck/hand を印字で絞る等の no-state 文脈
    expect(matchesCardFilter(card, def, { colors: ["purple"] })).toBe(true);
    expect(matchesCardFilter(card, def, { symbolCount: 2 })).toBe(true);
  });

  it("act_as_spirit token (spirit) は category フィルタにマッチ (従来どおり)", () => {
    const ce = actAsSpiritCE({
      statBlueprint: {
        kind: "static_copy",
        snapshot: {
          cost: 7,
          reductionSymbols: [],
          symbolColors: ["red", "red"],
          tribes: ["紅魔"],
          levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
        },
      },
    });
    const { state, card } = makeState(true, [ce]);
    expect(
      matchesCardFilter(card, def, { category: ["spirit"] }, { state })
    ).toBe(true);
  });

  it("resolveTargetSpec は裏向き付与無しカードを印字 category で自動解決しない", () => {
    const { state } = makeState(true);
    const getDef = (id: string) => (id === def.cardNo ? def : undefined);

    for (const category of ["nexus", "spirit"] as const) {
      const resolved = resolveTargetSpec({
        state,
        targetSpec: {
          kind: "filter",
          player: "self",
          filter: { category: [category] },
          count: "all",
        },
        actingPlayerId: ALICE,
        sourceInstanceId: "card-1",
        getCardDefinitionById: getDef,
        stepContext: createStepExecutionContext(state),
      });
      expect(resolved).toHaveLength(0);
    }
  });

  it("resolveTargetSpec は裏向き act_as_spirit token を spirit として自動解決する", () => {
    const ce = actAsSpiritCE({
      statBlueprint: {
        kind: "static_copy",
        snapshot: {
          cost: 7,
          reductionSymbols: [],
          symbolColors: ["red"],
          tribes: ["紅魔"],
          levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
        },
      },
    });
    const { state } = makeState(true, [ce]);
    const getDef = (id: string) => (id === def.cardNo ? def : undefined);

    const resolved = resolveTargetSpec({
      state,
      targetSpec: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"] },
        count: "all",
      },
      actingPlayerId: ALICE,
      sourceInstanceId: "card-1",
      getCardDefinitionById: getDef,
      stepContext: createStepExecutionContext(state),
    });

    expect(resolved.map((card) => card.instanceId)).toEqual(["card-1"]);
  });
});
