import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  playSummonAsAction,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  createGameSnapshot,
  getLegalActions,
  getEffectiveLevel,
  getEffectiveBp,
  restoreSnapshot,
  type GameState,
} from "../src";

const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);

describe("2026-09-29の一次カード画像で確認した印字軽減", () => {
  it.each([
    ["BSLH01-C11", ["black"], ["seven", "seven"]],
    ["BSTH11-C03", ["green"], ["green", "green", "god"]],
    ["BSTH11-C05", ["green"], ["seven", "seven"]],
    ["BSTH11-M01", ["green"], ["green", "green", "green", "god"]],
    ["BSTS01-C03", ["green"], ["green", "green"]],
    ["BSTS01-C04", ["green"], ["green", "green"]],
  ] as const)(
    "%s の印字シンボル/軽減を保持する",
    (cardNo, symbols, reductions) => {
      const card = getDef(cardNo)!;
      expect(card.symbolColors).toEqual(symbols);
      expect(card.reductionSymbols).toEqual(reductions);
    }
  );

  it.each([
    ["BSTH11-C03", ["BSTH11-C01", "BSTH11-C01", "BSTH11-C01"], 2],
    ["BSTH11-C03", ["BSTH11-C01", "BSTH11-C01", "BSTH11-X01"], 1],
    ["BSTH11-M01", Array<string>(4).fill("BSTH11-C01"), 3],
    ["BSTH11-M01", ["BSTH11-C01", "BSTH11-C01", "BSTH11-C01", "BSTH11-X01"], 2],
    ["BSTH11-C05", ["BSTH11-C01", "BSTH11-C01"], 1],
    ["BSTH11-C05", ["BSLH01-C01", "BSLH01-C01"], 1],
    ["BSLH01-C11", ["BSLH01-C11"], 2],
    ["BSTS01-C03", ["BSTS01-C03"], 2],
    ["BSTS01-C04", ["BSTS01-C04"], 2],
  ] as const)(
    "%s: %jのシンボルで支払いコスト%d",
    (cardNo, sources, finalCost) => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: sources.map((source, index) =>
          createCardInstance(getDef(source)!, {
            instanceId: `symbol-${index}`,
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      });
      expect(
        calculateReduction({
          state,
          actingPlayerId: "alice",
          card: getDef(cardNo)!,
          getCardDefinitionById: getDef,
        }).finalCost
      ).toBe(finalCost);
    }
  );

  it("BSTH11-C03: 添付盤面の5コアで4支払いと1維持を確保できる", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {},
          {
            reserveNormalCoreCount: 4,
            reserveSoulCoreCount: 1,
            soulCoreLocation: { kind: "reserve" },
          },
        ],
        cardInstances: ["BSTH11-C03", "BSTH11-C01", "BSTH11-R01"].map((no) =>
          createCardInstance(getDef(no)!, {
            instanceId: no,
            ownerPlayerId: "bob",
            zone: "hand",
          })
        ),
      }),
      activePlayerId: "bob",
      turnNumber: 2,
      step: "main",
      window: "none",
    };
    const actions = (board: GameState) =>
      getLegalActions({
        state: board,
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
      });
    expect(
      actions(state)
        .filter((a) => a.kind === "summon")
        .map((a) => a.sourceDefinitionId)
    ).toEqual(expect.arrayContaining(["BSTH11-C01", "BSTH11-R01"]));
    const summon = actions(state).find(
      (a) => a.kind === "summon" && a.sourceDefinitionId === "BSTH11-C03"
    );
    expect(summon).toMatchObject({
      finalCost: 4,
      minimumEnterFieldCoreCount: 1,
    });
    const saved = createGameSnapshot({
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.definitionId === "BSTH11-C03" ? { ...c, minimumRequiredCores: 2 } : c
      ),
    });
    const restored = restoreSnapshot(saved, getDef).state;
    expect(
      actions(restored).find(
        (a) => a.kind === "summon" && a.sourceDefinitionId === "BSTH11-C03"
      )
    ).toMatchObject({ finalCost: 4, minimumEnterFieldCoreCount: 1 });
    const after = playSummonAsAction({
      state: restored,
      actingPlayerId: "bob",
      cardInstanceId: "BSTH11-C03",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      paymentSources: [{ kind: "reserve", amount: 4 }],
      enterFieldCorePlacements: [{ kind: "reserve_soul", amount: 1 }],
    }).state;
    expect(
      after.cardInstances.find((c) => c.definitionId === "BSTH11-C03")
    ).toMatchObject({
      zone: "field",
      normalCoreCount: 0,
      soulCoreCount: 1,
      minimumRequiredCores: 1,
    });
    expect(after.players.find((p) => p.id === "bob")).toMatchObject({
      reserveNormalCoreCount: 0,
      reserveSoulCoreCount: 0,
      trashNormalCoreCount: 4,
    });
    const withFour = {
      ...state,
      players: state.players.map((p) =>
        p.id === "bob" ? { ...p, reserveNormalCoreCount: 3 } : p
      ),
    };
    expect(
      actions(withFour).some(
        (a) => a.kind === "summon" && a.sourceDefinitionId === "BSTH11-C03"
      )
    ).toBe(false);
  });

  it.each([
    [1, 1, 4000],
    [2, 2, 6000],
    [3, 2, 6000],
    [4, 3, 8000],
  ])("BSTH11-C03: コア%d個でLv%d/BP%d", (cores, level, bp) => {
    const def = getDef("BSTH11-C03")!;
    const lily = createCardInstance(def, {
      instanceId: "lily",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: cores,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [lily],
    });
    expect(getEffectiveLevel(state, lily, def, getDef)).toBe(level);
    expect(getEffectiveBp(state, lily, def, getDef)).toBe(bp);
  });
});
