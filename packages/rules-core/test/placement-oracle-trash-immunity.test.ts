import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolvePlacementOracleMechanic } from "../src/mechanics/oracle-system";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { isCardUseRestricted } from "../src/legal/legal-actions-shared";
import { resolveAmount } from "../src/effect/target-resolution";
import { createStepExecutionContext } from "../src/step-execution-context";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);

describe("配置時神託とトラッシュにあるカードの耐性", () => {
  it("ジュラ・テンペスト連邦国があっても3枚をトラッシュへ置き、対象2枚を参照してコア2個を置く", () => {
    const source = definitions.get("BSTS01-C05")!;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{}, { deckCount: 3 }],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "tempest",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(definitions.get("BSSA01-XX01")!, {
          instanceId: "cardinal",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(definitions.get("BSSA01-C01")!, {
          instanceId: "hand-card",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
        ...["BSSA01-C01", "BSSA01-C02", "BSTH02-R11"].map((cardNo, index) =>
          createCardInstance(definitions.get(cardNo)!, {
            instanceId: `deck-${index}`,
            ownerPlayerId: "bob",
            zone: "deck",
          })
        ),
      ],
    });
    const protectedState = executeEffect({
      chainId: "test:placement-oracle-trash-immunity:45",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "tempest",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      protectedState.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "defense_immune"
      )
    ).toBe(true);

    const after = resolvePlacementOracleMechanic(
      protectedState,
      { kind: "placement_oracle", grandwalkerInstanceId: "cardinal" },
      getCardDefinitionById
    );

    expect(
      after.cardInstances
        .filter((card) => card.zone === "trash")
        .map((card) => card.instanceId)
    ).toEqual(["deck-0", "deck-1", "deck-2"]);
    expect(after.players.find((player) => player.id === "bob")?.deckCount).toBe(
      0
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "cardinal")
        ?.normalCoreCount
    ).toBe(2);
    // 「あるとき」「N枚あるとき」と数量参照は、耐性カードも数える。
    for (const condition of [
      {
        kind: "cards_in_zone" as const,
        player: "self" as const,
        zone: "trash" as const,
        filter: { cardName: { exact: definitions.get("BSSA01-C01")!.name } },
        min: 1,
      },
      {
        kind: "cards_in_zone" as const,
        player: "self" as const,
        zone: "trash" as const,
        filter: { tribes: ["夜錆"] },
        min: 2,
      },
    ]) {
      expect(
        evaluateCondition(
          after,
          [condition],
          "cardinal",
          "bob",
          getCardDefinitionById
        )
      ).toBe(true);
    }
    expect(
      resolveAmount(
        {
          source: {
            kind: "cards_in_zone",
            zone: "trash",
            player: "self",
            filter: { tribes: ["夜錆"] },
          },
        },
        after,
        "bob",
        createStepExecutionContext(after),
        getCardDefinitionById
      )
    ).toBe(2);
    // トラッシュのカード自身の効果は使用不可。R11の回収選択も発生しない。
    expect(after.pendingTrashOptionalAdds).toHaveLength(0);
    const inTrash = after.cardInstances.find(
      (card) => card.instanceId === "deck-0"
    )!;
    expect(
      isCardUseRestricted(
        after,
        "bob",
        inTrash,
        getCardDefinitionById(inTrash.definitionId)!,
        getCardDefinitionById
      )
    ).toBe(true);
    // 外への移動と交換はどちらもトラッシュ側の耐性で拒否される。
    for (const action of [
      {
        kind: "move_card" as const,
        from: { zone: "trash" as const, player: "self" as const },
        to: { zone: "hand" as const },
        count: "all" as const,
      },
      {
        kind: "queue_hand_trash_swap" as const,
        outgoingFilter: {},
        incomingFilter: {},
      },
    ]) {
      const result = executeEffect({
        chainId: "test:placement-oracle-trash-immunity:148",
        state: structuredClone(after),
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action }],
        },
        sourceInstanceId: "cardinal",
        actingPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(
        result.cardInstances.filter((card) => card.zone === "trash")
      ).toHaveLength(3);
      expect(
        result.cardInstances.find((card) => card.instanceId === "hand-card")
          ?.zone
      ).toBe("hand");
      expect(result.pendingHandTrashSwapChoice).toBeNull();
    }
  });
});
