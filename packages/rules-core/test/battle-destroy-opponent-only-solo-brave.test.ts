/**
 * queueBattleDestroyOpponentOnlyTriggers (battle-actions.ts) の勝者/被破壊側カテゴリ判定は
 * excludeCategory の影響を避けるため getEffectiveCategory → isBattleCapableCategory へ移行した
 * (BSTH03-M01 adversarial verifier round2 対応)。isBattleCapableCategory は brave category も
 * battle 参加可能と判定するため、ホストが離れてブレイヴ単体でアタック継続する場合
 * (P2-10、05_brave-and-attack-special-cases.md「スピリット状態のブレイヴは独立したスピリット
 * として扱われる」) に battleResolutionGroup の member が brave 単体になるケースでも
 * battle_destroy_opponent_only が正しく発火することを固定する
 * (adversarial verifier round3: 旧実装は brave を除外していたため未発火だった)。
 */
import { describe, expect, it } from "vitest";
import { executeBattleResolution, buildTriggeredEffectLookup } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const braveDef: CardDefinition = {
  cardNo: "TEST-SOLO-BRAVE",
  name: "単独継続ブレイヴ",
  printedCategory: "brave",
  printedColors: ["red"],
  symbolColors: ["red"],
  printedCost: 2,
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  textLines: [],
  images: {},
  colors: ["red"],
  effects: [
    {
      timing: { kind: "card_event", event: "battle_destroy_opponent_only" },
      executionMode: "optional",
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
    },
  ],
};

const opponentDef: CardDefinition = {
  cardNo: "TEST-SOLO-BRAVE-OPPONENT",
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
  [braveDef.cardNo, braveDef],
  [opponentDef.cardNo, opponentDef],
]);
const getCardDefinitionById = (id: string) => defMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup([braveDef, opponentDef]);

describe("battle_destroy_opponent_only: ホスト離脱後のブレイヴ単体アタック継続 (P2-10)", () => {
  it("brave 単体の memberInstanceIds でも勝者として battle_destroy_opponent_only を観測できる", () => {
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      zoneRoleName: "brave",
    });
    const opponent = createCardInstance(opponentDef, {
      instanceId: "opponent-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });

    const battleState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, opponent],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-solo-brave",
        primaryEntityId: "battle-entity:brave-1",
        participantEntityIds: ["battle-entity:brave-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:brave-1",
            blockedByEntityIds: ["battle-entity:opponent-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:brave-1"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-entity:brave-1",
          // ホストが破壊済み・離脱後の単体継続を模擬 (P2-10 resolveBraveAttackContinuation
          // の結果と同じ形: memberInstanceIds が brave 単体)。
          memberInstanceIds: ["brave-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
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

    const resolved = executeBattleResolution({
      state: battleState,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "opponent-1")!.zone
    ).toBe("trash");
    expect(resolved.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "battle_destroy_opponent_only",
        relatedInstanceId: "brave-1",
        relatedInstanceIds: ["opponent-1"],
      })
    );
  });
});
