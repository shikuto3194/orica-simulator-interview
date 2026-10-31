import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { GameState, LegalAction } from "../src";
import { getHostGrantedAdventChoiceOptions } from "../src/mechanics/host-dual-advent";
import { adventFlashPosition as flash } from "./advent-flash-position";

const definitions = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getDef = (id: string) => definitions.get(id);
const lookups = {
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};
const printed = ALL_CARDS.flatMap((card) => {
  const header = card.textLines.find((line) =>
    /フラッシュ\s*[【《][^】》]*煌臨/.test(line)
  );
  return header ? [{ card, header }] : [];
});

function position(cardNo = "BSDB01-X02", countValue = 4): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          countValue,
          handCount: 1,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "host" },
        },
        {},
      ],
      cardInstances: [
        createCardInstance(getDef("BSDB01-CX01")!, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          soulCoreCount: 1,
        }),
        createCardInstance(getDef(cardNo)!, {
          instanceId: "hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    }),
    step: "main",
    window: "none",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}

function actions(state: GameState, playerId = "alice") {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById: getDef,
    ...lookups,
  });
}
function declaration(state: GameState) {
  return actions(state).find(
    (a) => a.kind === "declare_advent" && a.sourceInstanceId === "hand"
  );
}
function apply(
  state: GameState,
  kind: LegalAction["kind"],
  playerId = "alice",
  targetInstanceIds?: string[]
) {
  const action = actions(state, playerId).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  const result = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    targetInstanceIds,
    ...lookups,
  }).state;
  return result;
}

describe("全煌臨カードの本文と宣言データ", () => {
  it.each(printed.map((row) => [row.card.cardNo, row] as const))(
    "%s: 印字タイミングとカウント条件",
    (_no, { card, header }) => {
      const data = card.adventData ?? card.dualHostAdventData;
      expect(data).toBeDefined();
      const expected = header.includes("自分のターン")
        ? "own_turn"
        : header.includes("お互いのアタックステップ")
          ? "both_attack_step"
          : header.includes("自分のアタックステップ")
            ? "own_attack_step"
            : header.includes("相手のアタックステップ")
              ? "opponent_attack_step"
              : "main_and_flash";
      expect(data!.adventTiming).toBe(expected);
      const count = header.match(/(?:カウント|C)(\d+)以上/);
      if (count)
        expect(card.adventData?.declareCondition).toContainEqual({
          kind: "count_value",
          player: "self",
          min: Number(count[1]),
        });
    }
  );
});

describe("常時の擬制支払いは煌臨条件を変更しない", () => {
  it.each([1, 4])(
    "保存盤面相当: メイン・カウント%sではX02を提示しない",
    (count) => {
      const state = position("BSDB01-X02", count);
      expect(declaration(state)).toBeUndefined();
      expect(
        getHostGrantedAdventChoiceOptions(state, "hand", "alice", getDef)
      ).toEqual([]);
    }
  );
  it("フラッシュでもカウント3ではX02を提示しない", () => {
    const state = flash(position("BSDB01-X02", 3));
    expect(declaration(state)).toBeUndefined();
    expect(
      getHostGrantedAdventChoiceOptions(state, "hand", "alice", getDef)
    ).toEqual([]);
  });
  it.each(["alice", "bob"])(
    "%sのアタック中: カウント4で擬制支払いでき、ソウルコアを引き継ぐ",
    (active) => {
      let state = flash(position(), active);
      expect(declaration(state)).toBeDefined();
      state = apply(state, "declare_advent");
      state = apply(
        state,
        "pass_battle_flash",
        state.activeAttack!.flashWindowState!.priorityPlayerId
      );
      expect(
        state.pendingEffectTargetSelection?.candidateInstanceIds
      ).toContain("host");
      state = apply(state, "resolve_pending_effect_target", "alice", ["host"]);
      expect(
        state.cardInstances.find((c) => c.instanceId === "hand")
      ).toMatchObject({
        zone: "field",
        soulCoreCount: 1,
        underCards: [{ role: "advent_source", cardInstanceId: "host" }],
      });
      expect(state.usedAlternateCostAdventKeysThisTurn).toContain(
        "name:孫悟空＆ベジータ"
      );
    }
  );
  it("窓中にカウント条件を失えば擬制支払いでも不発", () => {
    let state = apply(flash(position()), "declare_advent");
    state.players.find((p) => p.id === "alice")!.countValue = 3;
    state = apply(
      state,
      "pass_battle_flash",
      state.activeAttack!.flashWindowState!.priorityPlayerId
    );
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.cardInstances.find((c) => c.instanceId === "hand")?.zone).toBe(
      "hand"
    );
    expect(state.usedAlternateCostAdventKeysThisTurn).toEqual([]);
  });
  it("自分のターン指定は相手のフラッシュで宣言できない", () => {
    expect(
      declaration(flash(position("BSDB01-R01", 2), "bob"))
    ).toBeUndefined();
  });
  it("煌臨キーワードを持たないカードに支払い置換だけで煌臨を付与しない", () => {
    const state = position("BSSG01-C01");
    state.cardInstances[0] = createCardInstance(getDef("BSSG01-M01")!, {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    expect(declaration(state)).toBeUndefined();
  });
  it("常時の支払い置換でも煌臨先のコスト条件を満たす必要がある", () => {
    const state = flash(position("BSSG01-M03"));
    state.cardInstances[0] = createCardInstance(getDef("BSSG01-M01")!, {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      soulCoreCount: 1,
    });
    expect(declaration(state)).toBeDefined();
    const getLowCostDef = (id: string) =>
      id === "BSSG01-M01" ? { ...getDef(id)!, cost: 3 } : getDef(id);
    expect(
      getHostGrantedAdventChoiceOptions(state, "hand", "alice", getLowCostDef)
    ).toEqual([]);
    expect(
      getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getLowCostDef,
        ...lookups,
      }).some(
        (action) =>
          action.kind === "declare_advent" && action.sourceInstanceId === "hand"
      )
    ).toBe(false);
  });
});
