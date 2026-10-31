/**
 * P3-94 repro: 効果由来の多色シンボル (treat_as) がコスト軽減に反映されるか。
 *
 * 観測盤面 (snapshot 2026-06-11): alice フィールドに
 *  - BSTH04-X01 [導界者]西行寺 幽々子 ×2 (印字シンボル=導/guide、効果でシンボルを黄/紫としても扱う)
 *  - BSTH04-C02 メディスン (印字シンボル=黄/yellow、効果でシンボルを紫としても扱う)
 * の状態で BSTH04-C12 投銭 (cost 4 / 軽減シンボル 紫・黄・導) を使うと、
 * 3 シンボル全てが軽減アイコンに合致して支払い 1 になるべき。
 *
 * 実カード定義 + 実際の continuous-effect 登録経路 (rebuildContinuousEffectsFromField) を
 * 通して end-to-end で検証する (treat_as CE が場で登録され、軽減計算に流れるか)。
 */
import { describe, expect, it } from "vitest";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbolBundles,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { ALL_CARDS } from "../../card-data/src/generated-index";

const ALICE = "alice";
const BOB = "bob";

const CARDS_BY_NO = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c as CardDefinition])
);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  CARDS_BY_NO.get(id);

function defOf(cardNo: string): CardDefinition {
  const d = CARDS_BY_NO.get(cardNo);
  if (!d) throw new Error(`missing card def: ${cardNo}`);
  return d;
}

describe("P3-94: 効果由来の多色シンボルがコスト軽減に効く", () => {
  function buildBoard(): GameState {
    const x01 = defOf("BSTH04-X01");
    const c02 = defOf("BSTH04-C02");
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const x01a = createCardInstance(x01, {
      instanceId: "x01-a",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const x01b = createCardInstance(x01, {
      instanceId: "x01-b",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const c02inst = createCardInstance(c02, {
      instanceId: "c02-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...base,
      cardInstances: [x01a, x01b, c02inst],
    };
    // 実際の継続効果登録経路を通す (treat_as を CE 化)。
    return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
  }

  it("X01 の実効シンボルバンドルが 導+黄+紫 を含む", () => {
    const state = buildBoard();
    const x01a = state.cardInstances.find((c) => c.instanceId === "x01-a")!;
    const bundles = getEffectiveSymbolBundles(
      state,
      x01a,
      defOf("BSTH04-X01"),
      getCardDefinitionById
    );
    const allColors = new Set(bundles.flatMap((b) => b.colors));
    expect(allColors.has("guide")).toBe(true);
    expect(allColors.has("yellow")).toBe(true);
    expect(allColors.has("purple")).toBe(true);
  });

  it("C12 投銭 (cost4 / 軽減 紫黄導) は X01×2 + C02 で支払い 1", () => {
    const state = buildBoard();
    const c12 = defOf("BSTH04-C12");
    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: c12,
      getCardDefinitionById,
    });
    expect(result.totalReduction).toBe(3);
    expect(result.reducedCost).toBe(1);
  });
});
