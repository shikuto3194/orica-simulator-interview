/**
 * BSTH05-M01「ヒソウテンソク」effects[1]: Lv2『アタック/ブロック時』相手のスピリット/
 * アルティメットだけを破壊したとき回復する。BSFT01-TR05(B) precedent と同型の
 * battle_destroy_opponent_only card_event (勝者側の自己発火・アタック/ブロック共通)
 * で表現する (stub 解消)。
 */
import { describe, it, expect } from "vitest";
import { BSTH05_CARDS } from "../../card-data/src/cards/BSTH05";
import {
  applyLegalAction,
  executeBattleResolution,
  buildTriggeredEffectLookup,
  getLegalActions,
} from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const m01Def = BSTH05_CARDS.find((c) => c.cardNo === "BSTH05-M01")!;

const opponentDef: CardDefinition = {
  cardNo: "TEST-BSTH05-M01-OPPONENT",
  name: "対戦相手",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["blue"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  images: {},
  colors: ["blue"],
};

const defMap = new Map<string, CardDefinition>([
  [m01Def.cardNo, m01Def],
  [opponentDef.cardNo, opponentDef],
]);
const getCardDefinitionById = (id: string) => defMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup([m01Def, opponentDef]);

function buildBattleState(m01Cores: number): GameState {
  const m01 = createCardInstance(m01Def, {
    instanceId: "m01-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: m01Cores,
    exhaustState: "exhausted",
  });
  const opponent = createCardInstance(opponentDef, {
    instanceId: "opponent-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01, opponent],
    }),
    activePlayerId: ALICE,
    step: "attack",
    window: "none",
    activeAttack: {
      attackId: "attack-m01",
      primaryEntityId: "battle-entity:m01-1",
      participantEntityIds: ["battle-entity:m01-1"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:m01-1",
          blockedByEntityIds: ["battle-entity:opponent-1"],
        },
      ],
      symbolResolutionOrder: ["battle-entity:m01-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    },
    battleEntities: [
      {
        entityId: "battle-entity:m01-1",
        memberInstanceIds: ["m01-1"],
        resolvedBp: 10000,
        resolvedSymbols: ["green"],
        attackState: "attacking",
      },
      {
        entityId: "battle-entity:opponent-1",
        memberInstanceIds: ["opponent-1"],
        resolvedBp: 1000,
        resolvedSymbols: ["blue"],
        attackState: "blocking",
      },
    ],
  };
}

function resolvePendingBattleDestroyTrigger(state: GameState): GameState {
  const legalActions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  });
  const resolveAction = legalActions.find(
    (a) => a.kind === "resolve_pending_triggered_effect"
  );
  expect(resolveAction).toBeDefined();
  let current = applyLegalAction({
    state,
    action: resolveAction!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
  if (current.window === "stack" && current.stackWindow) {
    const opponentId = current.stackWindow.priorityPlayerId;
    current = applyLegalAction({
      state: current,
      action: {
        kind: "pass_stack",
        actionId: `pass:${opponentId}`,
        can: true,
        reason: "test_close",
        actingPlayerId: opponentId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }
  return current;
}

describe("BSTH05-M01 ヒソウテンソク effects[1]", () => {
  it("Lv2: 相手のスピリット/アルティメットだけを破壊したとき回復する", () => {
    const afterBattle = executeBattleResolution({
      state: buildBattleState(3),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(afterBattle.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "battle_destroy_opponent_only",
        relatedInstanceId: "m01-1",
        relatedInstanceIds: ["opponent-1"],
      })
    );

    const resolved = resolvePendingBattleDestroyTrigger(afterBattle);

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "opponent-1")!.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "m01-1")!.exhaustState
    ).toBe("recovered");
  });

  it("Lv1: min_level未満では回復せず、トリガー自体が発生しない", () => {
    const afterBattle = executeBattleResolution({
      state: buildBattleState(1),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(
      afterBattle.cardInstances.find((c) => c.instanceId === "opponent-1")!.zone
    ).toBe("trash");
    expect(afterBattle.pendingTriggeredEffects).toEqual([]);
    expect(
      afterBattle.cardInstances.find((c) => c.instanceId === "m01-1")!
        .exhaustState
    ).toBe("exhausted");
  });
});
