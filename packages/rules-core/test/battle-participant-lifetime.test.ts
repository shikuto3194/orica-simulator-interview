import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  isBurstEffectNullifiedByOpponent,
} from "../src";
import type { GameState, LegalAction } from "../src";
import { usageClockOf } from "../src/effect/effect-usage-accounting";
import { GAME_SNAPSHOT_SCHEMA_VERSION, restoreSnapshot } from "../src/snapshot";

const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => cards.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
};

function apply(
  state: GameState,
  kind: LegalAction["kind"],
  sourceInstanceId?: string
): GameState {
  const action = ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({ ...lookups, state, actingPlayerId })
    )
    .find(
      (entry) =>
        entry.kind === kind &&
        entry.can &&
        (sourceInstanceId === undefined ||
          ("sourceInstanceId" in entry &&
            entry.sourceInstanceId === sourceInstanceId))
    );
  if (!action) throw new Error(`Missing legal action: ${kind}`);
  const next = applyLegalAction({ ...lookups, state, action }).state;
  expect(collectGameStateInvariantIssues(next)).toEqual([]);
  return next;
}

describe("バトル参加状態の終了", () => {
  it.each([
    { capsuleCores: 1, legacy: false },
    { capsuleCores: 0, legacy: false },
    { capsuleCores: 1, legacy: true },
  ])(
    "射命丸 文の発揮をカプセルコーポレーションで判定する（コア$capsuleCores、旧保存$legacy）",
    ({ capsuleCores, legacy }) => {
      const capsule = createCardInstance(cards.get("BSDB01-C07")!, {
        instanceId: "capsule",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: capsuleCores,
      });
      const vegeta = createCardInstance(cards.get("BSDB01-C02")!, {
        instanceId: "vegeta",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
        soulCoreCount: 1,
      });
      const aya = createCardInstance(cards.get("BSTH05.5-M04")!, {
        instanceId: "aya",
        ownerPlayerId: "alice",
        zone: "burst",
      });
      const trash = createCardInstance(cards.get("BSTH05.5-C04")!, {
        instanceId: "trash",
        ownerPlayerId: "alice",
        zone: "trash",
      });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            { lifeNormalCoreCount: 5, reserveNormalCoreCount: 3 },
            { lifeNormalCoreCount: 5 },
          ],
          cardInstances: [capsule, vegeta, aya, trash],
        }),
        turnNumber: 3,
        activePlayerId: "bob",
        step: "attack",
        window: "none",
        setBurstStates: [{ playerId: "alice", cardInstanceId: "aya" }],
      };

      state = apply(state, "attack", "vegeta");
      state = apply(state, "pass_pre_declaration_stack");
      state = apply(state, "open_battle_flash");
      state = apply(state, "pass_battle_flash");
      state = apply(state, "pass_battle_flash");
      const battleId = state.activeAttack?.attackId;
      state = apply(state, "decline_block");

      if (legacy) {
        state = restoreSnapshot(
          {
            schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
            savedAt: "2026-11-14T21:34:20.656Z",
            state: {
              ...state,
              battleEntities: state.battleEntities.map((entity) => ({
                ...entity,
                attackState: "idle",
              })),
              activeContinuousEffects: state.activeContinuousEffects.filter(
                (effect) => effect.modifierTag !== "negate_opponent_burst"
              ),
              pendingBattleEndFinalizeAttackIds: [],
            },
          },
          getCardDefinitionById
        ).state;
      }

      expect(state.pendingBurstChecks[0]?.eventKind).toBe("reduce_life");
      expect(state.battleEntities[0]?.attackState).toBe("attacking");
      expect(usageClockOf(state).battleId).toBe(battleId);
      expect(isBurstEffectNullifiedByOpponent(state, "aya", "alice")).toBe(
        capsuleCores === 1
      );
      state = apply(state, "resolve_pending_burst_check", "aya");
      expect(state.revealedBurstStates[0]?.cardInstanceId).toBe("aya");
      for (let i = 0; i < 4 && state.stackWindow !== null; i++) {
        state = apply(state, "pass_stack");
      }

      expect(state.stackWindow).toBeNull();
      const ayaZone = state.cardInstances.find(
        (card) => card.instanceId === "aya"
      )?.zone;
      if (capsuleCores === 0) {
        expect(ayaZone).toBe("field");
        expect(state.pendingMultiPlacement?.sourceInstanceId).toBe("aya");
      } else {
        expect(ayaZone).toBe("trash");
        expect(state.pendingMultiPlacement).toBeNull();
        expect(state.battleEntities[0]?.attackState).toBe("idle");
        expect(state.pendingImmediateBattleEnds).toEqual([]);
        expect(usageClockOf(state).battleId).toBeNull();
        expect(isBurstEffectNullifiedByOpponent(state, "aya", "alice")).toBe(
          false
        );
      }
    }
  );
});
