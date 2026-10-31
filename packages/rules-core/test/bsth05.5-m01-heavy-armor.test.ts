/**
 * BSTH05.5-M01「緋想の剣・布都御魂」effects[0]【超重装甲：∞】検証。
 *
 * 原文 textLines[2,3]:
 *   「【合体中】【超重装甲：∞】
 *    このアルティメットは、相手のフィールドにあるシンボルの色の効果を受けない。」
 *
 * ∞ = 固定の色一覧 (BSTH02-X03【超重装甲：紫/緑/白】等) の代わりに、相手フィールドの
 * 実効シンボル色すべてを動的な色集合として使う (immunitySourceScope.
 * colorsFromOpponentFieldSymbols、`getOpponentFieldSymbolColors` 新設)。
 * 発生源カード実効色がその動的集合に含まれるときのみ免疫成立。
 *
 * ブレイヴ自身 (M01) の sourceInstanceId で effect_immunity target:self を実行すると
 * `resolveSelfReferenceCard` が attachedToInstanceId 経由で host を解決するため、
 * CE は host (このアルティメット) に登録される (BSAZ02-C11/BSTH003-M02 同型の
 * combined-brave self-target 規約)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  filterTargetsByPreventionLevel,
  moveCardZone,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import { executeDestroy } from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";
const M01 = card("BSTH05.5-M01");
// BSTH05.5-X01 (比那名居 天子): printedCategory:"ultimate", cost:8, tribe includes "天人"
// → M01 の braveCondition (categories:["ultimate"], tribes:["天人"], minCost:6) を満たす host。
const HOST_DEF = card("BSTH05.5-X01");
// symbolColors:["red"] のスピリット (BOB フィールドの色フィクスチャ)。
const RED_SYMBOL_FIELD_CARD = card("BSDB01-C05");

function buildCombinedState(opponentFieldCards: GameState["cardInstances"]) {
  const host = createCardInstance(HOST_DEF, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedChildrenIds: ["brave-1"],
    normalCoreCount: 1,
  });
  const brave = createCardInstance(M01, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "host-1",
    normalCoreCount: 1,
  });
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, brave, ...opponentFieldCards],
  });
}

function runEffect0(state: GameState): GameState {
  return executeEffect({
    chainId: "test:bsth05.5-m01-heavy-armor:66",
    state,
    effect: M01.effects[0]!,
    effectIndex: 0,
    sourceInstanceId: "brave-1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

describe("BSTH05.5-M01 effects[0]（合体中【超重装甲：∞】相手フィールドのシンボル色の効果を受けない）", () => {
  it("effect定義: continuous + effect_immunity(target:self, sourceScope.colorsFromOpponentFieldSymbols:true, while_on_field)", () => {
    expect(M01.effects[0]!.stub).toBeUndefined();
    expect(M01.effects[0]!.applicability).toEqual({ combined: true });
    const action = M01.effects[0]!.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.sourceScope?.colorsFromOpponentFieldSymbols).toBe(true);
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("host (このアルティメット) に effect_immunity CE が登録される (self→host 解決)", () => {
    const state = buildCombinedState([]);
    const after = runEffect0(state);
    const ce = after.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "defense_immune" && c.targetInstanceId === "host-1"
    );
    expect(ce).toBeDefined();
    expect(ce!.immunitySourceScope?.colorsFromOpponentFieldSymbols).toBe(true);
  });

  it("相手フィールドに赤シンボルのカードがあるとき、赤発生源の相手効果を受けない", () => {
    const oppField = createCardInstance(RED_SYMBOL_FIELD_CARD, {
      instanceId: "opp-red-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = buildCombinedState([oppField]);
    const after = runEffect0(state);
    const host = after.cardInstances.find((c) => c.instanceId === "host-1")!;

    const redSource: CardDefinition = {
      ...card("BSAZ01-C03"),
      colors: ["red"],
    };
    expect(
      isCardImmuneToOpponentEffect(
        after,
        host,
        BOB,
        "none",
        { definition: redSource },
        getDef
      )
    ).toBe(true);
  });

  it("相手フィールドに赤シンボルのカードが無いとき（青のみ）、赤発生源の相手効果を受けない免疫は成立しない", () => {
    const oppField = createCardInstance(card("BSAZ02-C01"), {
      // BSAZ02-C01: colors含む定義がある前提。青シンボルへ差し替えて使用。
      instanceId: "opp-blue-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const blueFieldDef: CardDefinition = {
      ...card("BSAZ02-C01"),
      symbolColors: ["blue"],
    };
    const state: GameState = {
      ...buildCombinedState([oppField]),
    };
    const after = runEffect0(state);
    const host = after.cardInstances.find((c) => c.instanceId === "host-1")!;
    const getDefWithOverride = (id: string): CardDefinition | undefined =>
      id === blueFieldDef.cardNo ? blueFieldDef : cardNoMap.get(id);
    // 直接 effect-resistance-check の getCardDefinitionById 経由フィールド定義を差し替えて
    // 「相手フィールドは青シンボルのみ」を模擬する。
    const redSource: CardDefinition = {
      ...card("BSAZ01-C03"),
      colors: ["red"],
    };
    expect(
      isCardImmuneToOpponentEffect(
        after,
        host,
        BOB,
        "none",
        { definition: redSource },
        getDefWithOverride
      )
    ).toBe(false);
  });

  it("相手フィールドにカードが無いとき、免疫は成立しない（動的色集合が空）", () => {
    const state = buildCombinedState([]);
    const after = runEffect0(state);
    const host = after.cardInstances.find((c) => c.instanceId === "host-1")!;
    const redSource: CardDefinition = {
      ...card("BSAZ01-C03"),
      colors: ["red"],
    };
    expect(
      isCardImmuneToOpponentEffect(
        after,
        host,
        BOB,
        "none",
        { definition: redSource },
        getDef
      )
    ).toBe(false);
  });
});

describe("超重装甲∞と手元シンボルの参照範囲", () => {
  const redSource = card("BSDB01-C05");
  function build(extra: GameState["cardInstances"]) {
    return recomputeAndRebuildContinuousEffects(
      buildCombinedState([
        createCardInstance(redSource, {
          instanceId: "red-effect",
          ownerPlayerId: BOB,
          zone: "hand",
        }),
        ...extra,
      ]),
      getDef
    );
  }
  function assertDefense(state: GameState, protectedFromRed: boolean) {
    const source = state.cardInstances.find(
      (card) => card.instanceId === "red-effect"
    )!;
    expect(
      filterTargetsByPreventionLevel(state, ["host-1"], "none", {
        actingPlayerId: BOB,
        effectSource: { instance: source, definition: redSource },
        getCardDefinitionById: getDef,
      })
    ).toEqual(protectedFromRed ? [] : ["host-1"]);
    const after = executeDestroy(
      state,
      BOB,
      { player: "opponent", category: ["ultimate"], count: 1 },
      getDef,
      source.instanceId,
      ["host-1"]
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "host-1")
        ?.pendingLeaveKind
    ).toBe(protectedFromRed ? null : "destroy");
  }
  it("場が空でも相手手元C20の赤は候補と作用を防ぎ、最後のC20離脱で失効する", () => {
    let state = build([
      createCardInstance(card("BSTH08.5-C20"), {
        instanceId: "mask",
        ownerPlayerId: BOB,
        zone: "set_aside",
      }),
    ]);
    expect(
      state.cardInstances.filter(
        (card) => card.controllerPlayerId === BOB && card.zone === "field"
      )
    ).toEqual([]);
    assertDefense(state, true);
    expect(
      state.cardInstances.find((card) => card.instanceId === "mask")?.zone
    ).toBe("set_aside");
    state = recomputeAndRebuildContinuousEffects(
      moveCardZone(state, "mask", "trash"),
      getDef
    );
    assertDefense(state, false);
  });
  it.each(["hand", "set_aside"] as const)(
    "X01が%sにあっても支払い限定拡張は耐性へ混入しない",
    (zone) => {
      const state = build([
        createCardInstance(card("BSTH08.5-X01"), {
          instanceId: "kokoro",
          ownerPlayerId: BOB,
          zone,
        }),
        createCardInstance(card("BSTH08.5-C21"), {
          instanceId: "mask",
          ownerPlayerId: BOB,
          zone: "set_aside",
        }),
      ]);
      assertDefense(state, false);
    }
  );
});
