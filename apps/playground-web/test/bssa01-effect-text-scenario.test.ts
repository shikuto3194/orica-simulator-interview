import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { buildBssa01EffectTextScenario } from "../src/scenario-bssa01-effect-text";

const def = ALL_CARDS.find((card) => card.cardNo === "BSSA01-X02")!;
const lookups = {
  getCardDefinitionById: (id: string) =>
    ALL_CARDS.find((card) => card.cardNo === id),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: () => undefined,
  getRegisteredFieldCardEffectActions: () => undefined,
  getRegisteredMagicActions: () => undefined,
  getRegisteredBurstActions: () => undefined,
};

function act(state: GameState, owner: string, kind: LegalAction["kind"]) {
  const actions = getLegalActions({ state, actingPlayerId: owner, ...lookups });
  const action = actions.find((candidate) => candidate.kind === kind);
  expect(action, JSON.stringify(actions)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}

describe("反逆者アリス: 使用済み召喚とライフ回復の切り分け", () => {
  it.each(["alice", "bob"])(
    "%s: メイン使用済みでも第2効果だけを宣言・解決する",
    (owner) => {
      const queued = buildBssa01EffectTextScenario(
        [...ALL_CARDS],
        new URLSearchParams({ owner, stage: "queued" })
      );
      expect(
        queued.effectUsageRecords.filter(
          (record) => record.sourceDefinitionId === def.cardNo
        )
      ).toMatchObject([
        { step: "main", effectLabel: "effect:1", duration: "turn", count: 1 },
        { step: "main", effectLabel: "effect:1", duration: "game", count: 1 },
      ]);
      expect(
        queued.battleImmediateEffects.map((prompt) => prompt.registrationIndex)
      ).toEqual([1]);
      let state = act(queued, owner, "resolve_battle_immediate_effect");
      expect(state.stackWindow?.pendingStackAction).toMatchObject({
        battleImmediateRegistrationIndex: 1,
        suppressionEffectDescriptor: { effectIndex: 2 },
      });
      state = act(state, owner === "alice" ? "bob" : "alice", "pass_stack");
      if (state.pendingStepOptionalChoice)
        state = act(state, owner, "resolve_pending_step_optional_choice");
      expect(state.players.find((player) => player.id === owner)).toMatchObject(
        {
          lifeNormalCoreCount: 5,
          trashNormalCoreCount: 0,
          soulCoreLocation: { kind: "trash" },
        }
      );
      expect(
        state.cardInstances.find((card) => card.instanceId === "rebel-alice")
          ?.normalCoreCount
      ).toBe(3);
      expect(state.effectUsageRecords).toEqual(queued.effectUsageRecords);
      expect(state.battleImmediateEffects).toEqual([]);
      expect(state.stackWindow).toBeNull();
    }
  );

  it.each([
    { instanceId: "rebel-alice", turnNumber: 5, expected: [1] },
    { instanceId: "second-alice", turnNumber: 5, expected: [1] },
    { instanceId: "rebel-alice", turnNumber: 7, expected: [1] },
    { instanceId: "second-alice", turnNumber: 7, expected: [0, 1] },
  ])(
    "$instanceId / T$turnNumber: 同名ターン制限と個体ゲーム制限を別々に適用する",
    ({ instanceId, turnNumber, expected }) => {
      const queued = buildBssa01EffectTextScenario(
        [...ALL_CARDS],
        new URLSearchParams({ stage: "queued" })
      );
      const source = { ...queued.cardInstances[0]!, instanceId };
      const state = queueRegisteredBattleImmediateEffects({
        state: {
          ...queued,
          turnNumber,
          battleImmediateEffects: [],
          cardInstances: [source],
        },
        attackId: "next-attack",
        participantEntityId: `battle-entity:${instanceId}`,
        actingPlayerId: "alice",
        sourceCard: source,
        sourceDefinition: def,
        timing: "attack",
        ...lookups,
      });
      expect(
        state.battleImmediateEffects.map((prompt) => prompt.registrationIndex)
      ).toEqual(expected);
    }
  );
});
