/**
 * requiredCoreMoveCost の事前判定 (`canPayRequiredEffectCosts`) は、コア移動元候補判定の
 * SSOT (`getFieldCoreSourceTakeableCount`) が持つ層1「独立コア管理 (創界神/導界者/創界石
 * ネクサス) は汎用コア移動の対象外」を通していなかった (guard-audit probe
 * core-source-takeable-parallel 検出)。ネクサス上のコアだけを原資に「コアN個を払わなければ
 * 発揮できない」型の choice/conditional_cost 事前ゲートが誤って「払える」と判定していたバグ。
 *
 * 対照: BSTH01-M03 effects[2] の界放コスト (「自分の導界者ネクサスのコア1個 → this_card」) は
 * `filter.targetsGrandwalker:true` で明示的にネクサスを狙うため、ゲートは従来通り許可し続ける
 * (escape hatch)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { canPayRequiredEffectCosts } from "../src/legal/required-effect-cost-gate";

const ALICE = "alice";
const BOB = "bob";
const CARDS_BY_NO = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c as CardDefinition])
);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  CARDS_BY_NO.get(id);
const defOf = (n: string): CardDefinition => {
  const d = CARDS_BY_NO.get(n);
  if (!d) throw new Error("missing card def: " + n);
  return d;
};

function boardWithGuidedNexusOnly(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const xx01 = createCardInstance(defOf("BSTH04-XX01"), {
    instanceId: "nexus-1",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 2,
  });
  const state: GameState = { ...base, cardInstances: [xx01] };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

describe("requiredCoreMoveCost 事前ゲートは独立コア管理ネクサスを原資から除外する", () => {
  it("導界者ネクサスのコアのみの盤面で、無印 filter の界放コストは支払い不可", () => {
    const state = boardWithGuidedNexusOnly();
    const canPay = canPayRequiredEffectCosts(
      state,
      ALICE,
      {
        requiredCoreMoveCost: {
          sourcePlayer: "self",
          sourceFilter: {},
          destination: { kind: "this_card" },
          amount: 1,
        },
      },
      getCardDefinitionById
    );
    expect(canPay).toBe(false);
  });

  it("targetsGrandwalker:true で明示的に狙うときは従来通り支払い可能 (escape hatch)", () => {
    const state = boardWithGuidedNexusOnly();
    const canPay = canPayRequiredEffectCosts(
      state,
      ALICE,
      {
        requiredCoreMoveCost: {
          sourcePlayer: "self",
          sourceFilter: { targetsGrandwalker: true },
          destination: { kind: "this_card" },
          amount: 1,
        },
      },
      getCardDefinitionById
    );
    expect(canPay).toBe(true);
  });

  it("通常スピリット上のコアは従来通り原資に含まれる (除外は独立コア管理のみ)", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const spirit = createCardInstance(defOf("BSTH04-X02"), {
      instanceId: "spirit-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = { ...base, cardInstances: [spirit] };
    const canPay = canPayRequiredEffectCosts(
      state,
      ALICE,
      {
        requiredCoreMoveCost: {
          sourcePlayer: "self",
          sourceFilter: {},
          destination: { kind: "this_card" },
          amount: 1,
        },
      },
      getCardDefinitionById
    );
    expect(canPay).toBe(true);
  });
});
