import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createActiveAttack,
  createCardInstance,
  type CardDefinition,
  createEmptyGameState,
  executeBattleResolution,
  flushPendingLeaves,
  getLegalActions,
  queuePendingLeave,
  type BattleEntity,
  type GameState,
} from "../src";

function createDemoCardDefinition(
  overrides: Partial<CardDefinition>
): CardDefinition {
  return {
    cardNo: "TEST",
    name: "Test",
    printedCategory: "spirit",
    printedColors: ["red"],
    colors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    ...overrides,
  };
}

for (const category of ["spirit", "ultimate"] as const) {
  for (const role of ["attacking", "blocking"] as const) {
    for (const kind of ["destroy", "vanish", "bounce"] as const) {
      describe(`${category} ${role} ${kind}`, () => {
        for (const { restriction, title } of [
          {
            restriction: [],
            title: "残留後は選択せず参加可否を確定: 制限なし",
          },
          {
            restriction: ["attack"],
            title: "残留後は選択せず参加可否を確定: attack",
          },
          {
            restriction: ["block"],
            title: "残留後は選択せず参加可否を確定: block",
          },
          {
            restriction: ["attack", "block"],
            title: "残留後は選択せず参加可否を確定: attack/block",
          },
        ] as { restriction: ("attack" | "block")[]; title: string }[]) {
          it(title, () => {
            const owner = role === "attacking" ? "alice" : "bob";
            const opponent = owner === "alice" ? "bob" : "alice";
            const hostDef = createDemoCardDefinition({
              cardNo: "HOST",
              printedCategory: category,
            });
            const braveDef = createDemoCardDefinition({
              cardNo: "BRAVE",
              printedCategory: "brave",
              levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
              symbolColors: ["white"],
              effects: restriction.length
                ? [
                    {
                      timing: { kind: "continuous" },
                      applicability: { combined: false },
                      steps: [
                        {
                          action: {
                            kind: "prevent_battle",
                            target: { kind: "self" },
                            restriction,
                            duration: { scope: "permanent" },
                            ruleStrength: true,
                          },
                        },
                      ],
                    },
                  ]
                : [],
            });
            const enemyDef = createDemoCardDefinition({
              cardNo: "ENEMY",
              levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
            });
            const lookup = (id: string) =>
              [hostDef, braveDef, enemyDef].find((d) => d.cardNo === id);
            const host = createCardInstance(hostDef, {
              instanceId: "host",
              ownerPlayerId: owner,
              zone: "field",
              normalCoreCount: 1,
              exhaustState: "exhausted",
              attachedChildrenIds: ["brave"],
            });
            const brave = createCardInstance(braveDef, {
              instanceId: "brave",
              ownerPlayerId: owner,
              zone: "field",
              attachedToInstanceId: "host",
            });
            const enemy = createCardInstance(enemyDef, {
              instanceId: "enemy",
              ownerPlayerId: opponent,
              zone: "field",
              normalCoreCount: 1,
              exhaustState: "exhausted",
            });
            const base = createEmptyGameState({
              playerIds: ["alice", "bob"],
              cardInstances: [host, brave, enemy],
            });
            const entity: BattleEntity = {
              entityId: "combined",
              memberInstanceIds: ["host", "brave"],
              resolvedBp: 6000,
              resolvedSymbols: ["red", "white"],
              attackState: role,
            };
            const attackerId =
              role === "attacking" ? "combined" : "enemy-entity";
            const before: GameState = {
              ...base,
              step: "attack",
              activePlayerId: "alice",
              battleEntities: [
                entity,
                ...(role === "blocking"
                  ? [
                      {
                        entityId: "enemy-entity",
                        memberInstanceIds: ["enemy"],
                        resolvedBp: 2000,
                        resolvedSymbols: ["red" as const],
                        attackState: "attacking" as const,
                      },
                    ]
                  : []),
              ],
              activeAttack: {
                ...createActiveAttack(
                  base,
                  attackerId,
                  role === "blocking" ? opponent : owner
                ),
                flashBeforeBlockCompleted: true,
                flashAfterBlockCompleted: true,
                blockAssignments: [
                  {
                    participantEntityId: attackerId,
                    blockedByEntityIds: role === "blocking" ? ["combined"] : [],
                  },
                ],
              },
            };
            const pending = flushPendingLeaves(
              queuePendingLeave({
                state: before,
                instanceId: "host",
                kind,
                leaveDestination:
                  kind === "bounce" ? { zone: "hand" } : undefined,
                cause: "effect_resolution",
                causePlayerId: opponent,
                chainId: "host-leave",
              }),
              lookup
            );
            const keep = getLegalActions({
              state: pending,
              actingPlayerId: owner,
              getCardDefinitionById: lookup,
            }).find(
              (a) =>
                a.kind === "resolve_brave_leave_choice" && a.choice === "keep"
            );
            expect(keep).toBeDefined();
            const after = applyLegalAction({
              state: pending,
              action: keep!,
              getCardDefinitionById: lookup,
              getRegisteredTriggeredEffectActions: () => [],
            }).state;
            const canContinue = !restriction.includes(
              role === "attacking" ? "attack" : "block"
            );
            expect(
              after.cardInstances.find((c) => c.instanceId === "host")?.zone
            ).toBe(kind === "bounce" ? "hand" : "trash");
            expect(
              after.cardInstances.find((c) => c.instanceId === "brave")
            ).toMatchObject({
              zone: "field",
              attachedToInstanceId: null,
              exhaustState: "exhausted",
            });
            expect(after.pendingBraveLeaveChoice).toBeNull();
            expect(after.pendingBraveAttackContinuation).toBeNull();
            expect(after.activeAttack).toMatchObject(before.activeAttack!);
            expect(
              after.battleEntities.find((e) => e.entityId === "combined")
            ).toMatchObject({
              memberInstanceIds: canContinue ? ["brave"] : [],
              attackState: role,
              resolvedBp: canContinue ? 3000 : 0,
              resolvedSymbols: canContinue ? ["white"] : [],
            });
            expect(
              getLegalActions({
                state: after,
                actingPlayerId: owner,
                getCardDefinitionById: lookup,
              }).some((a) => a.kind === "resolve_brave_attack_continuation")
            ).toBe(false);
            const resolved = executeBattleResolution({
              state: after,
              getCardDefinitionById: lookup,
              getRegisteredTriggeredEffectActions: () => [],
            });
            expect(resolved.totalLifeDamage).toBe(
              role === "attacking" && canContinue ? 1 : 0
            );
            const defendingPlayerId = role === "blocking" ? owner : opponent;
            expect(
              resolved.state.players.find((p) => p.id === defendingPlayerId)!
                .lifeNormalCoreCount
            ).toBe(
              after.players.find((p) => p.id === defendingPlayerId)!
                .lifeNormalCoreCount -
                (role === "attacking" && canContinue ? 1 : 0)
            );
            expect(resolved.destroyedEntityIds).toEqual(
              role === "blocking" && canContinue ? ["enemy-entity"] : []
            );
          });
        }
      });
    }
  }
}
