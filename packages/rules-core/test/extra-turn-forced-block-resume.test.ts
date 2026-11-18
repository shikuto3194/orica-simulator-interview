import { describe, expect, it } from "vitest";
import {
  advanceStep,
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  executeEndAttackStep,
  executeGrantExtraTurn,
  finalizePendingEndFinalizations,
} from "../src/effect/structured-state-grants";
import { resetBattleEntitiesAfterAttackEnd } from "../src/battle/battle-shared";

const spirit: CardDefinition = {
  cardNo: "EXTRA-TURN-BLOCK",
  name: "extra turn block",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
const lookups = {
  getCardDefinitionById: () => spirit,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};

describe("extra turn waits for forced-block confirmation", () => {
  it.each(
    ["alice", "bob"].flatMap((owner) => [
      ...["none", "attacker", "blocker"].map((leaving) => ({
        owner,
        leaving,
        nested: false,
      })),
      { owner, leaving: "blocker", nested: true },
    ])
  )(
    "$owner resumes the confirmed battle ($leaving leaves, nested=$nested)",
    ({ owner, leaving, nested }) => {
      const attacker = owner === "alice" ? "bob" : "alice";
      const card = (id: string, player: string, zone: "field" | "deck") =>
        createCardInstance(spirit, {
          instanceId: id,
          ownerPlayerId: player,
          controllerPlayerId: player,
          zone,
          normalCoreCount: zone === "field" ? 1 : 0,
        });
      const attackerEntity = "battle-entity:attacker";
      const blockerEntity = "battle-entity:blocker";
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ deckCount: 3 }, { deckCount: 3 }],
          cardInstances: [
            card("attacker", attacker, "field"),
            card("blocker", owner, "field"),
            ...["alice", "bob"].flatMap((player) =>
              [0, 1, 2].map((i) => card(`${player}-deck-${i}`, player, "deck"))
            ),
          ],
        }),
        turnNumber: 5,
        activePlayerId: attacker,
        step: "attack",
        window: "pre_declaration_stack",
        battleEntities: [
          {
            entityId: attackerEntity,
            memberInstanceIds: ["attacker"],
            resolvedBp: 1000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
          {
            entityId: blockerEntity,
            memberInstanceIds: ["blocker"],
            resolvedBp: 1000,
            resolvedSymbols: ["red"],
            attackState: "idle",
          },
        ],
        activeAttack: {
          attackId: "interrupted-attack",
          primaryEntityId: attackerEntity,
          participantEntityIds: [attackerEntity],
          groupMode: "single",
          target: { kind: "battle_entity", entityId: blockerEntity },
          designatedTargetInstanceId: "blocker",
          blockAssignments: [
            { participantEntityId: attackerEntity, blockedByEntityIds: [] },
          ],
          symbolResolutionOrder: [attackerEntity],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        } as NonNullable<GameState["activeAttack"]>,
        preDeclarationStackWindow: {
          kind: "forced_block",
          actingPlayerId: owner,
          sourceInstanceId: "blocker",
          participantEntityId: attackerEntity,
          priorityPlayerId: attacker,
          consecutivePassCount: 0,
          previousWindow: "declare_attack",
          stackResponseSourcePlayerId: owner,
          pendingStackAction: null,
        },
      };
      state = executeGrantExtraTurn(
        state,
        owner,
        {
          kind: "grant_extra_turn",
          returnPoint: "previous_attack_battle",
          skipSteps: ["core", "attack"],
        },
        lookups
      );
      expect(state.extraTurnState?.deferredStart).toBe(true);
      const pass = getLegalActions({
        state,
        actingPlayerId: attacker,
        ...lookups,
      }).find((action) => action.kind === "pass_pre_declaration_stack");
      expect(pass).toBeDefined();
      state = applyLegalAction({ state, action: pass!, ...lookups }).state;
      expect([state.activePlayerId, state.step]).toEqual([owner, "start"]);
      expect(state.extraTurnState?.returnContext?.window).not.toBe(
        "pre_declaration_stack"
      );
      expect(
        state.extraTurnState?.returnContext?.activeAttack?.blockAssignments[0]
          ?.blockedByEntityIds
      ).toEqual([blockerEntity]);

      if (nested) {
        state = executeGrantExtraTurn(
          state,
          owner,
          {
            kind: "grant_extra_turn",
            returnPoint: "previous_attack_battle",
            skipSteps: ["core", "attack"],
          },
          lookups
        );
        expect(
          state.extraTurnState?.returnContext?.extraTurnState
        ).not.toBeNull();
      }
      if (leaving !== "none") {
        state = flushPendingLeaves(
          {
            ...state,
            cardInstances: state.cardInstances.map((card) =>
              card.instanceId === leaving
                ? {
                    ...card,
                    pendingLeaveKind: "destroy",
                    pendingLeaveCause: "effect",
                    pendingLeaveChainId: "extra-turn-leave",
                    deferZoneMoveUntilChainEnd: false,
                  }
                : card
            ),
            pendingLeaveEntities: [
              {
                instanceId: leaving,
                kind: "destroy",
                cause: "effect",
                causePlayerId: owner,
                chainId: "extra-turn-leave",
                deferZoneMoveUntilChainEnd: false,
              },
            ],
          },
          lookups.getCardDefinitionById
        );
        expect(
          state.cardInstances.find((card) => card.instanceId === leaving)?.zone
        ).toBe("trash");
        expect(
          state.battleEntities.find(
            (entity) => entity.entityId === `battle-entity:${leaving}`
          )
        ).toMatchObject({
          memberInstanceIds: [],
          leftFieldMemberInstanceIds: [leaving],
        });
        // 別バトルの終了時は、その空実体だけ整理し中断元の離脱履歴を残す。
        const finishedEntityId = "battle-entity:finished-extra-battle";
        state = {
          ...state,
          battleEntities: resetBattleEntitiesAfterAttackEnd({
            ...state,
            activeAttack: {
              attackId: "finished-extra-battle",
              primaryEntityId: finishedEntityId,
              participantEntityIds: [finishedEntityId],
              groupMode: "single",
              target: { kind: "player", playerId: attacker },
              blockAssignments: [
                {
                  participantEntityId: finishedEntityId,
                  blockedByEntityIds: [],
                },
              ],
              symbolResolutionOrder: [finishedEntityId],
              flashBeforeBlockCompleted: true,
              flashAfterBlockCompleted: false,
              flashWindowState: null,
            } as NonNullable<GameState["activeAttack"]>,
            battleEntities: [
              ...state.battleEntities,
              {
                entityId: finishedEntityId,
                memberInstanceIds: [],
                leftFieldMemberInstanceIds: ["finished-member"],
                resolvedBp: 0,
                resolvedSymbols: [],
                attackState: "attacking",
              },
            ],
          }),
        };
        expect(
          state.battleEntities.some(
            (entity) => entity.entityId === finishedEntityId
          )
        ).toBe(false);
        expect(
          state.battleEntities.find(
            (entity) => entity.entityId === `battle-entity:${leaving}`
          )
        ).toMatchObject({
          memberInstanceIds: [],
          leftFieldMemberInstanceIds: [leaving],
        });
      }
      for (let i = 0; i < 20 && state.extraTurnState; i++) {
        state = advanceStep(
          state,
          lookups.getCardDefinitionById,
          lookups.getRegisteredTriggeredEffectActions,
          lookups.getRegisteredBurstActions
        );
      }
      expect(state.extraTurnState).toBeNull();
      expect(state.activePlayerId).toBe(attacker);
      expect(state.activeAttack?.attackId).toBe("interrupted-attack");
      expect(state.preDeclarationStackWindow).toBeNull();
      expect(
        state.playerOrder.flatMap((actingPlayerId) =>
          getLegalActions({ state, actingPlayerId, ...lookups })
        )
      ).not.toHaveLength(0);
      expect(
        state.log.filter((line) => line.startsWith("block:forced:"))
      ).toHaveLength(1);
      for (const [actingPlayerId, kind] of [
        [attacker, "open_battle_flash"],
        [owner, "pass_battle_flash"],
        [attacker, "pass_battle_flash"],
      ]) {
        const action = getLegalActions({
          state,
          actingPlayerId: actingPlayerId!,
          ...lookups,
        }).find((action) => action.kind === kind);
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...lookups }).state;
      }
      expect(state.activeAttack).toBeNull();
      expect(state.players.map((player) => player.lifeNormalCoreCount)).toEqual(
        [5, 5]
      );
      expect(
        state.battleEntities.every(
          (entity) => entity.memberInstanceIds.length > 0
        )
      ).toBe(true);
      if (leaving !== "none") {
        expect(
          state.cardInstances.find((card) => card.instanceId === leaving)?.zone
        ).toBe("trash");
      }
    }
  );

  it.each(["alice", "bob"])(
    "%s does not preserve an ended attack while extra turn is deferred",
    (owner) => {
      const attacker = owner === "alice" ? "bob" : "alice";
      const card = (id: string, player: string, zone: "field" | "deck") =>
        createCardInstance(spirit, {
          instanceId: id,
          ownerPlayerId: player,
          controllerPlayerId: player,
          zone,
          normalCoreCount: zone === "field" ? 1 : 0,
        });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ deckCount: 3 }, { deckCount: 3 }],
          cardInstances: [
            card("blocker", owner, "field"),
            ...["alice", "bob"].flatMap((player) =>
              [0, 1, 2].map((i) => card(`${player}-deck-${i}`, player, "deck"))
            ),
          ],
        }),
        turnNumber: 5,
        activePlayerId: attacker,
        step: "attack",
        window: "stack",
        stackWindow: {
          actingPlayerId: owner,
          previousWindow: "declare_block",
          priorityPlayerId: attacker,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: owner,
          subStackEverOpened: false,
          burstWindowKind: null,
          pendingStackAction: null,
        },
        battleEntities: [
          {
            entityId: "ended-attacker",
            memberInstanceIds: [],
            leftFieldMemberInstanceIds: ["left-attacker"],
            resolvedBp: 0,
            resolvedSymbols: [],
            attackState: "attacking",
          },
          {
            entityId: "battle-entity:blocker",
            memberInstanceIds: ["blocker"],
            resolvedBp: 1000,
            resolvedSymbols: ["red"],
            attackState: "blocking",
          },
        ],
        activeAttack: {
          attackId: "ending-before-extra-turn",
          primaryEntityId: "ended-attacker",
          participantEntityIds: ["ended-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: owner },
          blockAssignments: [
            {
              participantEntityId: "ended-attacker",
              blockedByEntityIds: ["battle-entity:blocker"],
            },
          ],
          symbolResolutionOrder: ["ended-attacker"],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        } as NonNullable<GameState["activeAttack"]>,
      };
      state = executeEndAttackStep(state, attacker);
      state = executeGrantExtraTurn(
        state,
        owner,
        {
          kind: "grant_extra_turn",
          returnPoint: "previous_attack_battle",
          skipSteps: ["core", "attack"],
        },
        lookups
      );
      expect(state.extraTurnState?.deferredStart).toBe(true);
      // 応答窓が閉じ、予約済みの終了処理を確定する境界。
      state = { ...state, window: "declare_block", stackWindow: null };
      state = finalizePendingEndFinalizations(
        state,
        lookups.getCardDefinitionById,
        undefined,
        lookups
      );
      expect([state.activePlayerId, state.step]).toEqual([owner, "start"]);
      expect(state.extraTurnState?.returnContext?.activeAttack).toBeNull();
      expect(
        state.battleEntities.find(
          (entity) => entity.entityId === "ended-attacker"
        )
      ).toBeUndefined();
      expect(
        state.battleEntities.find(
          (entity) => entity.entityId === "battle-entity:blocker"
        )?.attackState
      ).toBe("idle");
      for (let i = 0; i < 10 && state.extraTurnState; i++)
        state = advanceStep(
          state,
          lookups.getCardDefinitionById,
          lookups.getRegisteredTriggeredEffectActions,
          lookups.getRegisteredBurstActions
        );
      expect(state.extraTurnState).toBeNull();
      expect(state.activeAttack).toBeNull();
      state = advanceStep(
        state,
        lookups.getCardDefinitionById,
        lookups.getRegisteredTriggeredEffectActions,
        lookups.getRegisteredBurstActions
      );
      expect(state.step).toBe("end");
    }
  );
});
