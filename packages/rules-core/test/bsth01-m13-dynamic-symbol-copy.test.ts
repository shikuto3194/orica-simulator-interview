/**
 * BSTH01-M13「大妖精」effects[2] (Lv1-Lv2):
 * 「このスピリットは、自分のフィールドにあるすべてのシンボルとして扱うシンボル1つを得る。」
 *
 * 旧実装は 6 色 (赤/紫/緑/白/黄/青) を無条件・静的に symbol_add していた（このカード自身の
 * colors が偶然全6色のため見かけ上は成立していたが、原文が要求する「自分のフィールドに
 * 現に存在するシンボル」という動的条件を無視していた）。
 *
 * 本 fix は symbol_add に `symbolSource:"field_colors_present"` を与え、
 * getSymbolAdditions が消費時（実効シンボル参照時）に自分のフィールド上の各カードの
 * base symbolColors を live union して 1 シンボル（複数色バンドル）として返すようにする。
 * CE は 1 件のみ登録され、フィールド構成が変わっても CE 側の再登録は不要。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbols,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const M13 = cardNoMap.get("BSTH01-M13")!;
const RED_CARD = cardNoMap.get("BSDB01-C01")!; // symbolColors: ["red"]
const BLUE_CARD = cardNoMap.get("BSDB01-C02")!; // symbolColors: ["blue"]
const GREEN_CARD = cardNoMap.get("BSLH01-C04")!; // symbolColors: ["green"]

function buildState(
  ownFieldDefs: {
    def: CardDefinition;
    instanceId: string;
    faceDown?: boolean;
  }[],
  opponentFieldDefs: { def: CardDefinition; instanceId: string }[] = []
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    cardInstances: [
      createCardInstance(M13, {
        instanceId: "m13",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      ...ownFieldDefs.map(({ def, instanceId, faceDown }) =>
        createCardInstance(def, {
          instanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          faceDown,
        })
      ),
      ...opponentFieldDefs.map(({ def, instanceId }) =>
        createCardInstance(def, {
          instanceId,
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        })
      ),
    ],
  };
}

function m13Symbols(state: GameState): Set<string> {
  const rebuilt = rebuildContinuousEffectsFromField(
    state,
    getCardDefinitionById
  );
  const m13Instance = rebuilt.cardInstances.find(
    (c) => c.instanceId === "m13"
  )!;
  return new Set(
    getEffectiveSymbols(rebuilt, m13Instance, M13, getCardDefinitionById)
  );
}

describe("BSTH01-M13 大妖精 effects[2] 動的シンボルコピー (stub 解消)", () => {
  it("effects[2] が stub ではなく symbol_add + symbolSource で動的表現されている", () => {
    const effect = M13.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        (e.textRef as number[]).includes(5) &&
        (e.textRef as number[]).includes(6)
    )!;
    expect(effect).toBeDefined();
    expect((effect as { stub?: string }).stub).toBeUndefined();
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action as {
      kind: string;
      symbolSource?: { kind: string; player: string };
    };
    expect(action.kind).toBe("symbol_add");
    expect(action.symbolSource).toEqual({
      kind: "field_colors_present",
      player: "self",
    });
  });

  it("symbol_addition CE は 1 件のみ登録される（旧: 6 件の静的 CE）", () => {
    const state = buildState([{ def: RED_CARD, instanceId: "red1" }]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const ces = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" && ce.targetInstanceId === "m13"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.modifierSymbolSource).toEqual({
      kind: "field_colors_present",
      playerId: "alice",
    });
  });

  it("自分のフィールドに赤のカードのみ → 大妖精は赤のみを得る（旧: 6色固定は誤り）", () => {
    const state = buildState([{ def: RED_CARD, instanceId: "red1" }]);
    expect(m13Symbols(state)).toEqual(new Set(["red"]));
  });

  it("赤+青のカードが自分のフィールドにある → 大妖精は赤/青の2色を得る（緑等は含まない）", () => {
    const state = buildState([
      { def: RED_CARD, instanceId: "red1" },
      { def: BLUE_CARD, instanceId: "blue1" },
    ]);
    expect(m13Symbols(state)).toEqual(new Set(["red", "blue"]));
  });

  it("相手フィールドの緑カードは数えない（自分のフィールド限定）", () => {
    const state = buildState(
      [{ def: RED_CARD, instanceId: "red1" }],
      [{ def: GREEN_CARD, instanceId: "green-opp" }]
    );
    expect(m13Symbols(state)).toEqual(new Set(["red"]));
  });

  it("自分のフィールドの裏向きカードは印字シンボルを漏らさない（P3-69 素性なしルール）", () => {
    const state = buildState([
      { def: RED_CARD, instanceId: "red1" },
      { def: BLUE_CARD, instanceId: "blue-facedown", faceDown: true },
    ]);
    expect(m13Symbols(state)).toEqual(new Set(["red"]));
  });

  it("フィールド構成が変化すると再構築なしで live 再評価される", () => {
    const withBlue = buildState([
      { def: RED_CARD, instanceId: "red1" },
      { def: BLUE_CARD, instanceId: "blue1" },
    ]);
    expect(m13Symbols(withBlue)).toEqual(new Set(["red", "blue"]));

    // 青のカードがフィールドを離れる → CE を再登録せずとも実効シンボルが赤のみに戻る
    const withoutBlue: GameState = {
      ...withBlue,
      cardInstances: withBlue.cardInstances.filter(
        (c) => c.instanceId !== "blue1"
      ),
    };
    expect(m13Symbols(withoutBlue)).toEqual(new Set(["red"]));
  });
});
