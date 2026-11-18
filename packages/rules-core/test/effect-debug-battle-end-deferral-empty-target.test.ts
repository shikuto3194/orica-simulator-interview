/**
 * EDH-0000-00: battle_end deferred effect が予約時の未選択空配列を
 * 「0件で選択確定」と誤認し、ブロック辞退後に例外にならないことを固定する。
 */
import { describe, expect, it } from "vitest";

import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  type CardDefinition,
  type GameState,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

const sourceDefinition = ALL_CARDS.find(
  (card) => card.cardNo === "BSTH08.5-X01"
);

if (!sourceDefinition) {
  throw new Error("BSTH08.5-X01 definition is required for EDH-0000-00");
}

const definitionMap = new Map<string, CardDefinition>([
  [sourceDefinition.cardNo, sourceDefinition],
]);
const getCardDefinitionById = (id: string) => definitionMap.get(id);
const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup([
  sourceDefinition,
]);

function battleEndDeferralState(): GameState {
  const source = createCardInstance(sourceDefinition, {
    instanceId: "kokoro",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 2,
    exhaustState: "exhausted",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [source],
    battleEntities: [
      {
        entityId: "battle-entity:kokoro",
        memberInstanceIds: ["kokoro"],
        resolvedBp: 8000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
  });

  return {
    ...base,
    turnNumber: 2,
    activePlayerId: "alice",
    step: "attack",
    window: "declare_block",
    activeAttack: {
      attackId: "edh-0000-attack",
      primaryEntityId: "battle-entity:kokoro",
      participantEntityIds: ["battle-entity:kokoro"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:kokoro",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:kokoro"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
    // The original reproduction reaches battle end with this property present
    // but no target has been selected yet: Kokoro has no attached Brave.
    pendingBattleEndDeferrals: [
      {
        deferralId: "edh-0000-deferral",
        attackId: "edh-0000-attack",
        actingPlayerId: "alice",
        sourceInstanceId: "kokoro",
        sourceDefinitionId: sourceDefinition.cardNo,
        effectIndex: 2,
        targetInstanceIds: [],
      },
    ],
  };
}

describe("EDH-0000-00: empty deferred battle-end target", () => {
  it("does not treat an unresolved empty target list as a required zero-card selection", () => {
    const result = executeBattleResolution({
      state: battleEndDeferralState(),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
    });

    expect(result.state.activeAttack).toBeNull();
    expect(result.state.pendingBattleEndDeferrals).toEqual([]);
    expect(
      result.state.cardInstances.find((card) => card.instanceId === "kokoro")
        ?.zone
    ).toBe("field");
  });
});
