import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const card = lookup("BSTH10-M01")!;
function board(cores: number) {
  const base = createEmptyGameState({
    cardInstances: [
      createCardInstance(card, {
        instanceId: "clownpiece",
        ownerPlayerId: "player-1",
        zone: "hand",
      }),
      createCardInstance(lookup("BSTH10-C03")!, {
        instanceId: "cost",
        ownerPlayerId: "player-1",
        zone: "hand",
      }),
    ],
  });
  return {
    ...base,
    step: "attack" as const,
    players: base.players.map((p) =>
      p.id === "player-1"
        ? {
            ...p,
            handCount: 2,
            reserveNormalCoreCount: cores,
            reserveSoulCoreCount: 0,
          }
        : p
    ),
  };
}
describe("BSTH10-M01 フラッシュ召喚", () => {
  it("手札とトラッシュの黒1色／妖精3枚を除外する割引もコスト3で召喚する", () => {
    const base = board(4);
    const state = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        ...["trash-a", "trash-b"].map((instanceId) =>
          createCardInstance(lookup("BSTH10-C03")!, {
            instanceId,
            ownerPlayerId: "player-1",
            zone: "trash",
          })
        ),
      ],
    };
    const result = executeEffect({
      chainId: "test:bsth10-m01-flash:56",
      state,
      effect: card.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "clownpiece",
      actingPlayerId: "player-1",
      choiceIndex: 2,
      targetInstanceIds: ["cost", "trash-a", "trash-b"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "clownpiece")?.zone
    ).toBe("field");
    expect(result.players[0]!.trashNormalCoreCount).toBe(3);
    expect(
      result.cardInstances
        .filter((c) => ["cost", "trash-a", "trash-b"].includes(c.instanceId))
        .every((c) => c.zone === "removed_from_game")
    ).toBe(true);
  });
  it.each([
    { choice: 0, cores: 6, paid: 5, costZone: "hand" },
    { choice: 1, cores: 4, paid: 3, costZone: "removed_from_game" },
  ])(
    "選択$choice のコストを支払い召喚する",
    ({ choice, cores, paid, costZone }) => {
      const result = executeEffect({
        chainId: "test:bsth10-m01-flash:83",
        state: board(cores),
        effect: card.effects![2]!,
        effectIndex: 2,
        sourceInstanceId: "clownpiece",
        actingPlayerId: "player-1",
        choiceIndex: choice,
        ...(choice ? { targetInstanceIds: ["cost"] } : {}),
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(
        result.cardInstances.find((c) => c.instanceId === "clownpiece")?.zone,
        JSON.stringify(result.log)
      ).toBe("field");
      expect(result.players[0]!.trashNormalCoreCount).toBe(paid);
      expect(
        result.cardInstances.find((c) => c.instanceId === "cost")?.zone
      ).toBe(costZone);
    }
  );
  it("召喚コストを払えない場合、割引のための除外だけを行わない", () => {
    const result = executeEffect({
      chainId: "test:bsth10-m01-flash:105",
      state: board(0),
      effect: card.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "clownpiece",
      actingPlayerId: "player-1",
      choiceIndex: 1,
      targetInstanceIds: ["cost"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "cost")?.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((c) => c.instanceId === "clownpiece")?.zone
    ).toBe("hand");
  });
});
