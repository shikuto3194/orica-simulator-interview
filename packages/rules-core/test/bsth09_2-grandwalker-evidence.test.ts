/**
 * BSTH09.2-X01 / XX01 の【導託】と【導技】が grandwalkerData carrier から
 * 共通実行経路へ接続されることを、カード固有に検証する。
 */
import { describe, expect, it } from "vitest";
import { divineSkillFlashPosition } from "./divine-skill-timing-position";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getAvailableDivineSkillLegalActions,
  getLegalActions,
} from "../src";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
  resolveOracleMechanic,
  resolvePlacementOracleMechanic,
} from "../src/mechanics/oracle-system";
import type { CardDefinition, GameState, TriggeredMechanic } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(cardNo: string): CardDefinition {
  const definition = cardNoMap.get(cardNo);
  if (!definition) throw new Error(`card not found: ${cardNo}`);
  return definition;
}

function oracleMechanic(
  state: GameState
): Extract<TriggeredMechanic, { kind: "oracle" }> {
  const pending = state.pendingTriggeredEffects.find(
    (entry) => entry.mechanic?.kind === "oracle"
  );
  if (pending?.mechanic?.kind !== "oracle") {
    throw new Error("oracle pending not found");
  }
  return pending.mechanic;
}

function placementOracleMechanic(
  state: GameState
): Extract<TriggeredMechanic, { kind: "placement_oracle" }> {
  const pending = state.pendingTriggeredEffects.find(
    (entry) => entry.mechanic?.kind === "placement_oracle"
  );
  if (pending?.mechanic?.kind !== "placement_oracle") {
    throw new Error("placement oracle pending not found");
  }
  return pending.mechanic;
}

function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (
    (current.stackWindow ||
      current.activeAttack?.flashWindowState?.pendingStackAction) &&
    guard++ < 10
  ) {
    const responderId = (
      current.stackWindow ?? current.activeAttack!.flashWindowState!
    ).priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    } as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );
    expect(pass, `pass_stack for ${responderId}`).toBeDefined();
    current = (
      applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById,
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

function resolvePendingTargetIfAny(
  state: GameState,
  targetInstanceId: string
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => [],
  } as Parameters<typeof getLegalActions>[0]).find(
    (candidate) => candidate.kind === "resolve_pending_effect_target"
  );
  if (!action) return state;
  return (
    applyLegalAction({
      state,
      action,
      targetInstanceIds: [targetInstanceId],
      getCardDefinitionById,
    } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
  ).state;
}

function declareDivineSkill(
  state: GameState,
  sourceInstanceId: string,
  actingPlayerId = ALICE
): GameState {
  const action = getAvailableDivineSkillLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => [],
  }).find((candidate) => candidate.sourceInstanceId === sourceInstanceId);
  expect(action).toBeDefined();
  const declared = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
  });
  expect(declared.ok).toBe(true);
  if (!declared.ok) throw new Error("divine skill declaration failed");
  return passStackUntilClosed(declared.state);
}

describe.each(["BSTH09.2-X01", "BSTH09.2-XX01"])(
  "%s grandwalkerData oracle runtime",
  (cardNo) => {
    it(`${cardNo} guided_oracle: summon trigger moves one void core`, () => {
      const nexus = createCardInstance(card(cardNo), {
        instanceId: "guided-nexus",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      // BSTH09.2-C01 = 赤・幻想・コスト3のスピリットで、両カードの導託条件に一致。
      const trigger = createCardInstance(card("BSTH09.2-C01"), {
        instanceId: "oracle-trigger",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, trigger],
        playerOverrides: [{ voidNormalCoreCount: 3 }, {}],
      });

      const queued = checkAndQueueOracleChoices(
        state,
        "oracle-trigger",
        "summon",
        getCardDefinitionById,
        "test:bsth09_2-grandwalker-evidence:165"
      );
      const mechanic = oracleMechanic(queued);
      expect(mechanic.grandwalkerInstanceId).toBe("guided-nexus");

      const resolved = resolveOracleMechanic(
        queued,
        mechanic,
        ALICE,
        true,
        getCardDefinitionById
      );
      expect(
        resolved.cardInstances.find(
          (entry) => entry.instanceId === "guided-nexus"
        )?.normalCoreCount
      ).toBe(1);
      expect(
        resolved.players.find((player) => player.id === ALICE)
          ?.voidNormalCoreCount
      ).toBe(2);
    });

    it(`${cardNo} placement_oracle: deck top moves to trash and matching core is placed`, () => {
      const nexus = createCardInstance(card(cardNo), {
        instanceId: "guided-nexus",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const matchingDeckCard = createCardInstance(card("BSTH09.2-C01"), {
        instanceId: "matching-deck-card",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, matchingDeckCard],
        playerOverrides: [{ deckCount: 1, voidNormalCoreCount: 3 }, {}],
      });

      const queued = checkAndQueuePlacementOracle(
        state,
        "guided-nexus",
        getCardDefinitionById,
        "test:bsth09_2-grandwalker-evidence:212"
      );
      const mechanic = placementOracleMechanic(queued);
      const resolved = resolvePlacementOracleMechanic(
        queued,
        mechanic,
        getCardDefinitionById
      );

      expect(
        resolved.cardInstances.find(
          (entry) => entry.instanceId === "matching-deck-card"
        )?.zone
      ).toBe("trash");
      expect(
        resolved.cardInstances.find(
          (entry) => entry.instanceId === "guided-nexus"
        )?.normalCoreCount
      ).toBe(1);
    });
  }
);

describe("BSTH09.2-X01 guided_skill runtime", () => {
  it("BSTH09.2-X01 guided_skill: attack core cost pays and resolves send_to_deck", () => {
    const nexus = createCardInstance(card("BSTH09.2-X01"), {
      instanceId: "rinnosuke",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(card("BSTH09.2-C02"), {
      instanceId: "exhausted-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [nexus, target],
    };

    const afterStack = declareDivineSkill(
      divineSkillFlashPosition(state, ALICE),
      "rinnosuke"
    );
    const resolved = resolvePendingTargetIfAny(afterStack, "exhausted-target");
    expect(
      resolved.cardInstances.find((entry) => entry.instanceId === "rinnosuke")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find(
        (entry) => entry.instanceId === "exhausted-target"
      )?.zone
    ).toBe("deck");
    expect(
      getAvailableDivineSkillLegalActions({
        state: resolved,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      }).some((action) => action.sourceInstanceId === "rinnosuke")
    ).toBe(false);
  });
});

describe("BSTH09.2-XX01 guided_skill runtime", () => {
  it("BSTH09.2-XX01 guided_skill: main core cost pays and free trash summon resolves", () => {
    const nexus = createCardInstance(card("BSTH09.2-XX01"), {
      instanceId: "akyuu",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(card("BSTH09.2-C01"), {
      instanceId: "fantasy-trash-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [nexus, target],
    };

    const afterStack = declareDivineSkill(state, "akyuu");
    const afterTarget = resolvePendingTargetIfAny(
      afterStack,
      "fantasy-trash-card"
    );
    const placement = getLegalActions({
      state: afterTarget,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    } as Parameters<typeof getLegalActions>[0]).find(
      (action) => action.kind === "resolve_pending_multi_placement"
    );
    expect(placement).toBeDefined();
    const resolved = (
      applyLegalAction({
        state: afterTarget,
        action: placement!,
        multiPlacementAllocations: [
          {
            destinationInstanceId: "fantasy-trash-card",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;

    expect(
      resolved.cardInstances.find((entry) => entry.instanceId === "akyuu")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find(
        (entry) => entry.instanceId === "fantasy-trash-card"
      )?.zone
    ).toBe("field");
    expect(
      getAvailableDivineSkillLegalActions({
        state: resolved,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      }).some((action) => action.sourceInstanceId === "akyuu")
    ).toBe(false);
  });

  it("BSTH09.2-XX01 guided_skill: 同名の別個体も、最初の発揮後は同ターンに使えない", () => {
    const first = createCardInstance(card("BSTH09.2-XX01"), {
      instanceId: "akyuu-first",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const second = createCardInstance(card("BSTH09.2-XX01"), {
      instanceId: "akyuu-second",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(card("BSTH09.2-C01"), {
      instanceId: "fantasy-trash-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [first, second, target],
    };

    const declared = declareDivineSkill(state, "akyuu-first");

    expect(declared.usedDivineSkillKeysThisTurn).toContain(
      "alice:BSTH09.2-XX01:0"
    );
    expect(
      getAvailableDivineSkillLegalActions({
        state: declared,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      }).some((action) => action.sourceInstanceId === "akyuu-second")
    ).toBe(false);
  });

  it("BSTH09.2-XX01 guided_skill: 相手プレイヤーの同名個体は同ターンにも使える", () => {
    const aliceAkyuu = createCardInstance(card("BSTH09.2-XX01"), {
      instanceId: "alice-akyuu",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const bobAkyuu = createCardInstance(card("BSTH09.2-XX01"), {
      instanceId: "bob-akyuu",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [aliceAkyuu, bobAkyuu],
    };

    const afterAlice = declareDivineSkill(state, "alice-akyuu");
    const bobTurn = { ...afterAlice, activePlayerId: BOB };
    expect(
      getAvailableDivineSkillLegalActions({
        state: bobTurn,
        actingPlayerId: BOB,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      }).some((action) => action.sourceInstanceId === "bob-akyuu")
    ).toBe(true);
  });
});
