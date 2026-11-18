/**
 * BSTH03-C01 レイセン / BSTH03-C02 因幡てゐ 双色シンボル追加効果テスト。
 *
 * どちらも「メインステップ、自身に色A/色Bとして扱うシンボル1つを追加する」効果を持つ。
 * 従来は symbol_add(単色) + treat_as(もう1色) の近似実装だったが、
 * SymbolAddAction.symbol は SymbolColor[] (dual-color) を既にサポートしている
 * (precedent: BSTH01-C12 ヴワル魔法図書館 effects[1])。本テストは
 * symbol_add(["colorA","colorB"]) 直書きへの置き換えが正しく機能することを検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbolBundles,
  getEffectiveSymbols,
  rebuildContinuousEffectsFromField,
} from "../src";
import { generateFieldCardEffectRegistrations } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const レイセン = cardNoMap.get("BSTH03-C01");
const 因幡てゐ = cardNoMap.get("BSTH03-C02");

function buildState(
  def: CardDefinition,
  instanceId: string,
  cores: number
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(def, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: cores,
      }),
    ],
  };
}

describe("BSTH03-C01 レイセン effects[3] 黄/紫 dual-color symbol_add", () => {
  it("カードデータに存在し、stub 注記が解消されている", () => {
    expect(レイセン).toBeDefined();
    expect(レイセン?.effects?.[3]?.stub).toBeUndefined();
  });

  it("Lv3 (1 コア) の自分のメインステップでは symbol_addition CE が dual-color [yellow,purple] で 1 件登録される", () => {
    const state = buildState(レイセン!, "reisen-1", 1);
    const effect = レイセン!.effects![3]!;
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.timingScope).toEqual({ player: "self", period: "main" });
    const result = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const symbolCEs = result.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.targetInstanceId === "reisen-1"
    );
    expect(symbolCEs).toHaveLength(1);
    expect(symbolCEs[0]!.modifierSymbol).toEqual(["yellow", "purple"]);
  });

  it("dual-color シンボルは印字シンボル(ultimate_symbol)と別 bundle (colors:[purple,yellow], count:1) として追加される", () => {
    const state = buildState(レイセン!, "reisen-2", 1);
    const after = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const card = after.cardInstances[0]!;
    const bundles = getEffectiveSymbolBundles(
      after,
      card,
      レイセン!,
      getCardDefinitionById
    );
    // 印字シンボル (ultimate_symbol × 1) + 追加された dual-color (purple/yellow × 1) = 2 bundles
    expect(bundles).toHaveLength(2);
    const dualBundle = bundles.find((b) => b.colors.length === 2);
    expect(dualBundle?.colors.slice().sort()).toEqual(["purple", "yellow"]);
    expect(dualBundle?.count).toBe(1);
  });

  it("黄・紫いずれの reduction 判定にも getEffectiveSymbols で 1 件ずつ現れる", () => {
    const state = buildState(レイセン!, "reisen-3", 1);
    const after = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const card = after.cardInstances[0]!;
    const symbols = getEffectiveSymbols(
      after,
      card,
      レイセン!,
      getCardDefinitionById
    );
    expect(symbols.filter((s) => s === "yellow")).toHaveLength(1);
    expect(symbols.filter((s) => s === "purple")).toHaveLength(1);
  });
});

describe("BSTH03-C02 因幡てゐ effects[2] 紫/究極 dual-color symbol_add", () => {
  it("カードデータに存在し、stub 注記が解消されている", () => {
    expect(因幡てゐ).toBeDefined();
    expect(因幡てゐ?.effects?.[2]?.stub).toBeUndefined();
  });

  it("Lv1 (1 コア) の自分のメインステップでは symbol_addition CE が dual-color [purple,ultimate_symbol] で 1 件登録される", () => {
    const state = buildState(因幡てゐ!, "tewi-1", 1);
    const effect = 因幡てゐ!.effects![2]!;
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.timingScope).toEqual({ player: "self", period: "main" });
    const result = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const symbolCEs = result.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" && ce.targetInstanceId === "tewi-1"
    );
    expect(symbolCEs).toHaveLength(1);
    expect(symbolCEs[0]!.modifierSymbol).toEqual(["purple", "ultimate_symbol"]);
  });

  it("dual-color シンボルは印字シンボル(yellow)と別 bundle (colors:[purple,ultimate_symbol], count:1) として追加される", () => {
    const state = buildState(因幡てゐ!, "tewi-2", 1);
    const after = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const card = after.cardInstances[0]!;
    const bundles = getEffectiveSymbolBundles(
      after,
      card,
      因幡てゐ!,
      getCardDefinitionById
    );
    // 印字シンボル (yellow × 1) + 追加された dual-color (purple/ultimate_symbol × 1) = 2 bundles
    expect(bundles).toHaveLength(2);
    const dualBundle = bundles.find((b) => b.colors.length === 2);
    expect(dualBundle?.colors.slice().sort()).toEqual([
      "purple",
      "ultimate_symbol",
    ]);
    expect(dualBundle?.count).toBe(1);
  });

  it("C01/C02 とも自分のメイン以外では追加シンボルが有効にならず、field activation も生成しない", () => {
    const reisenOutsideMain = rebuildContinuousEffectsFromField(
      { ...buildState(レイセン!, "reisen-start", 1), step: "start" },
      getCardDefinitionById
    );
    expect(
      getEffectiveSymbols(
        reisenOutsideMain,
        reisenOutsideMain.cardInstances[0]!,
        レイセン!,
        getCardDefinitionById
      )
    ).toEqual(["ultimate_symbol"]);

    const reisenOpponentMain = rebuildContinuousEffectsFromField(
      { ...buildState(レイセン!, "reisen-bob-main", 1), activePlayerId: "bob" },
      getCardDefinitionById
    );
    expect(
      getEffectiveSymbols(
        reisenOpponentMain,
        reisenOpponentMain.cardInstances[0]!,
        レイセン!,
        getCardDefinitionById
      )
    ).toEqual(["ultimate_symbol"]);

    const tewiOutsideMain = rebuildContinuousEffectsFromField(
      { ...buildState(因幡てゐ!, "tewi-start", 1), step: "start" },
      getCardDefinitionById
    );
    expect(
      getEffectiveSymbols(
        tewiOutsideMain,
        tewiOutsideMain.cardInstances[0]!,
        因幡てゐ!,
        getCardDefinitionById
      )
    ).toEqual(["yellow"]);

    const tewiOpponentMain = rebuildContinuousEffectsFromField(
      { ...buildState(因幡てゐ!, "tewi-bob-main", 1), activePlayerId: "bob" },
      getCardDefinitionById
    );
    expect(
      getEffectiveSymbols(
        tewiOpponentMain,
        tewiOpponentMain.cardInstances[0]!,
        因幡てゐ!,
        getCardDefinitionById
      )
    ).toEqual(["yellow"]);

    expect(
      generateFieldCardEffectRegistrations(レイセン!).filter(
        (registration) => registration.effectIndex === 3
      )
    ).toHaveLength(0);
    expect(
      generateFieldCardEffectRegistrations(因幡てゐ!).filter(
        (registration) => registration.effectIndex === 2
      )
    ).toHaveLength(0);
  });
});
