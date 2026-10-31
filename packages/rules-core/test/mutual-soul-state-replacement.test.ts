import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildMutualSoulStateScenario } from "../../../apps/playground-web/src/scenario-mutual-soul-state";
import {
  applyLegalAction,
  flushPendingLeaves,
  getLegalActions,
  type GameState,
} from "../src";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((d) => d.cardNo === id);
const card = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;

describe("相打ちの両プレイヤーの魂状態選択", () => {
  it.each(
    ["alice", "bob"].flatMap((owner) =>
      [false, true].flatMap((contract) =>
        (["keep", "decline"] as const).flatMap((first) =>
          (["keep", "decline"] as const).map((second) => ({
            owner,
            contract,
            first,
            second,
          }))
        )
      )
    )
  )(
    "攻撃=$owner 契約=$contract 選択=$first/$second",
    ({ owner, contract, first, second }) => {
      let state = buildMutualSoulStateScenario(
        ALL_CARDS,
        new URLSearchParams({ owner, contract: contract ? "1" : "0" })
      );
      expect(state.pendingLeaveEntities).toHaveLength(2);
      for (const playerId of ["alice", "bob"]) {
        expect(card(state, `mutual-${playerId}`)).toMatchObject({
          zone: "field",
          normalCoreCount: 2,
          pendingLeaveKind: "destroy",
        });
      }
      if (!contract) {
        expect(
          state.activeContinuousEffects
            .filter((ce) => ce.modifierTag === "replace_field_exit")
            .map((ce) => ce.targetInstanceId)
            .sort()
        ).toEqual(["mutual-alice", "mutual-bob"]);
      }
      // 選択中に再flushされても、まだ提示されていない相手のカードを動かさない。
      state = flushPendingLeaves(state, getCardDefinitionById);
      expect(state.pendingLeaveEntities).toHaveLength(2);
      const chosen = new Set<string>();
      for (const choice of [first, second]) {
        const pending = state.pendingSoulStateReplacement;
        expect(pending).not.toBeNull();
        expect(chosen.has(pending!.choosingPlayerId)).toBe(false);
        const playerId = pending!.choosingPlayerId;
        const other = playerId === "alice" ? "bob" : "alice";
        expect(
          getLegalActions({
            state,
            actingPlayerId: other,
            getCardDefinitionById,
          }).filter((a) => a.can && a.kind === "resolve_soul_state_replacement")
        ).toHaveLength(0);
        const action = getLegalActions({
          state,
          actingPlayerId: playerId,
          getCardDefinitionById,
        }).find(
          (a) =>
            a.can &&
            a.kind === "resolve_soul_state_replacement" &&
            a.choice === choice
        );
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredBurstActions: () => [],
          getCardDefinitionById,
        }).state;
        chosen.add(playerId);
        expect(
          state.players
            .find((p) => p.id === playerId)!
            .soulStateInstanceIds.includes(`mutual-${playerId}`)
        ).toBe(choice === "keep");
        expect(card(state, `mutual-${playerId}`).zone).toBe(
          choice === "keep" ? "field" : "trash"
        );
        expect(
          state.players.find((p) => p.id === playerId)!.reserveNormalCoreCount
        ).toBe(5);
        if (chosen.size === 1) {
          expect(state.pendingSoulStateReplacement?.choosingPlayerId).toBe(
            other
          );
          expect(card(state, `mutual-${other}`)).toMatchObject({
            zone: "field",
            normalCoreCount: 2,
            pendingLeaveKind: "destroy",
          });
          expect(state.pendingImmediateBattleEnds).toHaveLength(1);
        }
      }
      expect(chosen.size).toBe(2);
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(state.pendingLeaveEntities).toEqual([]);
      expect(state.pendingImmediateBattleEnds).toEqual([]);
      expect(state.activeAttack).toBeNull();
      expect(state.battlesEndedThisTurn).toBe(1);
    }
  );
});
