/**
 * P3-14 D-6: choice 変種ごとの前置コスト（BSTH05-C11/C12 型）。
 *
 * 「相手のスピリット2体を手札に戻す。…創界神ネクサスのコア3個をボイドに置くことで、
 *  この効果の対象を相手のスピリット/アルティメット3体にする。」を
 * choice(基本/コスト) + ref_choice + conditional_cost で表現する。
 *
 * - choiceIndex=0: 基本モード（バウンス2体）。コアは動かない。
 * - choiceIndex=1: コア3個 → ボイド（field_card ソースのコスト支払い）→ 3体バウンス。
 * - コア不足 → コスト no-op → conditional_cost ロールバックで全体不発。
 * - 拡張側の対象 0 → 効果側失敗 → コストもロールバック（ことで双方向）。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";
import type { Effect } from "../src/dsl-types";

const COST_FILTER = {
  category: ["nexus"],
  colors: ["green"],
  tribesRequired: ["アシハラ", "創界神"],
} as const;

const FLASH_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      id: "mode",
      action: {
        kind: "bounce",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 2,
        },
        maxPreventable: 1,
      },
      choice: [
        {
          action: {
            kind: "core_move",
            from: {
              kind: "field_card",
              player: "self",
              filter: COST_FILTER as never,
            },
            to: { kind: "void", player: "self" },
            amount: 3,
          },
        },
      ],
    },
    {
      action: {
        kind: "bounce",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit", "ultimate"] },
          count: 3,
        },
        maxPreventable: 1,
      },
      stepCondition: { kind: "ref_choice", stepId: "mode", choiceIndex: 1 },
      connector: "conditional_cost",
    },
  ],
} as Effect;

function makeMagicDef(): CardDefinition {
  return {
    cardNo: "D6-MAGIC-01",
    name: "D6 テストマジック",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [FLASH_EFFECT],
  } as CardDefinition;
}

function makeNexusDef(): CardDefinition {
  return {
    cardNo: "D6-NEXUS-01",
    name: "アシハラ創界神",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    tribe: "アシハラ・創界神",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeSpiritDef(cardNo: string, category = "spirit"): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function buildState(options: { nexusCores: number; opponentTargets: number }): {
  state: GameState;
  defs: Map<string, CardDefinition>;
} {
  const magicDef = makeMagicDef();
  const nexusDef = makeNexusDef();
  const spiritDef = makeSpiritDef("D6-SPIRIT-01");
  const ultimateDef = makeSpiritDef("D6-ULTIMATE-01", "ultimate");

  const cards = [
    createCardInstance(magicDef, {
      instanceId: "magic-1",
      ownerPlayerId: "alice",
      zone: "hand",
    }),
    createCardInstance(nexusDef, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: options.nexusCores,
    }),
  ];
  const targetIds = ["bob-s1", "bob-s2", "bob-u1"];
  for (let i = 0; i < options.opponentTargets; i++) {
    const id = targetIds[i]!;
    cards.push(
      createCardInstance(id === "bob-u1" ? ultimateDef : spiritDef, {
        instanceId: id,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      })
    );
  }

  const defs = new Map<string, CardDefinition>([
    [magicDef.cardNo, magicDef],
    [nexusDef.cardNo, nexusDef],
    [spiritDef.cardNo, spiritDef],
    [ultimateDef.cardNo, ultimateDef],
  ]);
  const state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      startingVoidNormalCoreCount: 0,
    }),
    activePlayerId: "alice",
    step: "attack" as const,
  };
  return { state, defs };
}

function run(
  state: GameState,
  defs: Map<string, CardDefinition>,
  choiceIndex: number,
  targetInstanceIds?: string[]
): GameState {
  return flushPendingLeaves(
    executeEffect({
      chainId: "test:choice-prepaid-cost:186",
      state,
      effect: FLASH_EFFECT,
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id: string) => defs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex,
      ...(targetInstanceIds ? { targetInstanceIds } : {}),
    }),
    (id) => defs.get(id)
  );
}

function coresOn(state: GameState, instanceId: string): number {
  return (
    state.cardInstances.find((c) => c.instanceId === instanceId)
      ?.normalCoreCount ?? 0
  );
}

function zoneOf(state: GameState, instanceId: string): string | undefined {
  return state.cardInstances.find((c) => c.instanceId === instanceId)?.zone;
}

describe("P3-14 D-6: choice 前置コスト (BSTH05-C11/C12 型)", () => {
  it("choiceIndex=0 (基本モード): 2体バウンス、コアは動かない", () => {
    const { state, defs } = buildState({ nexusCores: 4, opponentTargets: 2 });
    const after = run(state, defs, 0, ["bob-s1", "bob-s2"]);
    expect(zoneOf(after, "bob-s1")).toBe("hand");
    expect(zoneOf(after, "bob-s2")).toBe("hand");
    expect(coresOn(after, "nexus-1")).toBe(4);
    expect(
      after.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(0);
  });

  it("choiceIndex=1 (拡張モード): コア3個→ボイド + スピリット/アルティメット3体バウンス", () => {
    const { state, defs } = buildState({ nexusCores: 4, opponentTargets: 3 });
    const after = run(state, defs, 1, ["bob-s1", "bob-s2", "bob-u1"]);
    expect(coresOn(after, "nexus-1")).toBe(1);
    expect(
      after.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(3);
    expect(zoneOf(after, "bob-s1")).toBe("hand");
    expect(zoneOf(after, "bob-s2")).toBe("hand");
    expect(zoneOf(after, "bob-u1")).toBe("hand");
  });

  it("コア不足 (2個) → コスト no-op → 全体不発 (ことで双方向)", () => {
    const { state, defs } = buildState({ nexusCores: 2, opponentTargets: 3 });
    const after = run(state, defs, 1, ["bob-s1", "bob-s2", "bob-u1"]);
    expect(coresOn(after, "nexus-1")).toBe(2);
    expect(
      after.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(0);
    expect(zoneOf(after, "bob-s1")).toBe("field");
    expect(zoneOf(after, "bob-s2")).toBe("field");
    expect(zoneOf(after, "bob-u1")).toBe("field");
  });

  it("拡張側の対象 0 → 効果失敗 → コストもロールバック", () => {
    const { state, defs } = buildState({ nexusCores: 4, opponentTargets: 0 });
    const after = run(state, defs, 1);
    expect(coresOn(after, "nexus-1")).toBe(4);
    expect(
      after.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(0);
  });
});
