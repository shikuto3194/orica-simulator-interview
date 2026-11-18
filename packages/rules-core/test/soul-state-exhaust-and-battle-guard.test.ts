import { describe, expect, it } from "vitest";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import type {
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";
import {
  applyLegalAction,
  useOpenBattleFlashAsAction,
  createActiveAttack,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  getJoinActiveAttackBlockReason,
  queuePendingLeave,
  resolveBraveAttackContinuation,
  resolveSoulStateReplacement,
} from "../src";
import {
  isBattleCapableCategory,
  removeStateInvalidBattleEntityMembersAndRecompute,
} from "../src/battle/battle-shared";
import { matchesCardFilter } from "../src/card/card-filter";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import {
  executeBattleResolution,
  getUnblockedLifeDamage,
} from "../src/battle/battle-actions";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

const spiritDef: CardDefinition = {
  cardNo: "TEST-SOUL-GUARD-SPIRIT",
  name: "Test Soul Guard Spirit",
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
};

const braveDef: CardDefinition = {
  cardNo: "TEST-SOUL-GUARD-BRAVE",
  name: "Test Soul Guard Brave",
  printedCategory: "brave",
  printedColors: ["white"],
  colors: ["white"],
  symbolColors: ["white"],
  printedCost: 3,
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  textLines: [],
  images: {},
  tribe: "",
};

const ruleStrengthBraveDef: CardDefinition = {
  ...braveDef,
  cardNo: "TEST-SOUL-GUARD-RULE-BRAVE",
  name: "Test Soul Guard Rule Brave",
  effects: [
    {
      timing: { kind: "continuous" },
      applicability: { combined: false },
      steps: [
        {
          action: {
            kind: "prevent_battle",
            target: { kind: "self" },
            restriction: ["attack", "block"],
            duration: { scope: "permanent" },
            ruleStrength: true,
          },
        },
      ],
    },
  ],
};

function getDef(id: string): CardDefinition | undefined {
  if (id === spiritDef.cardNo) return spiritDef;
  if (id === braveDef.cardNo) return braveDef;
  if (id === ruleStrengthBraveDef.cardNo) return ruleStrengthBraveDef;
  return undefined;
}

function withBattle(
  state: GameState,
  attackers: { entityId: string; leaderId: string }[],
  targetPlayerId: string
): GameState {
  const battleEntities: BattleEntity[] = attackers.map((a) => ({
    entityId: a.entityId,
    memberInstanceIds: [a.leaderId],
    resolvedBp: 3000,
    resolvedSymbols: ["red"],
    attackState: "attacking",
  }));
  const group: BattleResolutionGroup = {
    attackId: "atk-1",
    groupMode: "single",
    target: { kind: "player", playerId: targetPlayerId },
    symbolResolutionOrder: attackers.map((a) => a.entityId),
    participantSnapshots: attackers.map((a) => ({
      entityId: a.entityId,
      memberInstanceIds: [a.leaderId],
      resolvedBp: 3000,
      resolvedSymbols: ["red"],
      blockedBy: [],
    })),
  };
  return { ...state, battleEntities, battleResolutionGroup: group };
}

function battlePreventCe(
  targetInstanceId: string,
  ruleStrength?: true
): ContinuousEffect {
  return {
    effectId: `prevent-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: braveDef.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: "atk-1",
    modifierTag: "prevent_battle_both",
    targetInstanceId,
    ...(ruleStrength ? { metadata: { ruleStrength: true } } : {}),
  };
}

describe("魂状態: 疲労/バトル不可の不変条件", () => {
  it("同時アタックから外れたカード限定のライフ下限を、残る参加者のダメージへ混ぜない", () => {
    const tripleDef: CardDefinition = {
      ...spiritDef,
      cardNo: "TEST-TRIPLE-ATTACKER",
      symbolColors: ["red", "red", "red"],
    };
    const lookup = (id: string) =>
      id === tripleDef.cardNo ? tripleDef : getDef(id);
    const a = createCardInstance(tripleDef, {
      instanceId: "a",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const b = createCardInstance(spiritDef, {
      instanceId: "b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ cardInstances: [a, b] });
    const floor = (id: string, minimum: number): ContinuousEffect => ({
      effectId: "floor-" + id,
      sourceInstanceId: id,
      sourceDefinitionId: a.definitionId,
      actingPlayerId: BOB,
      duration: { scope: "this_turn" },
      createdAtTurn: 3,
      createdAtAttackId: "atk-1",
      modifierTag: "life_damage_interception",
      targetInstanceId: BOB,
      metadata: {
        cause: "battle",
        mode: "floor",
        floor: minimum,
        attackerInstanceIds: [id],
      },
    });
    const declared: GameState = {
      ...base,
      step: "attack",
      window: "declare_block",
      turnNumber: 3,
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId: "e-a",
          memberInstanceIds: ["a"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "red", "red"],
          attackState: "attacking",
        },
        {
          entityId: "e-b",
          memberInstanceIds: ["b"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        ...createActiveAttack(base, "e-a", ALICE),
        groupMode: "simultaneous",
        participantEntityIds: ["e-a", "e-b"],
        symbolResolutionOrder: ["e-a", "e-b"],
        blockAssignments: [
          { participantEntityId: "e-a", blockedByEntityIds: [] },
          { participantEntityId: "e-b", blockedByEntityIds: [] },
        ],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
      },
      activeContinuousEffects: [
        floor("a", 1),
        floor("b", 4),
        battlePreventCe("b", true),
      ],
    };
    const removed = removeStateInvalidBattleEntityMembersAndRecompute(
      declared,
      lookup
    );
    expect(removed.battleEntities[1]!.memberInstanceIds).toEqual([]);
    expect(removed.battleEntities[1]!.leftFieldMemberInstanceIds).toEqual([
      "b",
    ]);
    const result = executeBattleResolution({
      state: removed,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    expect(result.totalLifeDamage).toBe(3);
    expect(result.state.players[1]!.lifeNormalCoreCount).toBe(2);
    expect(result.state.cardInstances.map((c) => c.zone)).toEqual([
      "field",
      "field",
    ]);
    expect(result.state.activeAttack).toBeNull();
    expect(result.state.battlesEndedThisTurn).toBe(1);
  });

  it("攻防不可ブレイヴの参加解除はフラッシュ優先権を保ち、二者パス後にだけバトルを終了する", () => {
    const brave = createCardInstance(ruleStrengthBraveDef, {
      instanceId: "remaining-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const base = createEmptyGameState({ cardInstances: [brave] });
    const declared: GameState = {
      ...base,
      activePlayerId: ALICE,
      turnNumber: 3,
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "remaining-entity",
          memberInstanceIds: [brave.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["white"],
          attackState: "attacking",
        },
      ],
      activeAttack: createActiveAttack(base, "remaining-entity", ALICE),
    };
    const opened = useOpenBattleFlashAsAction({
      state: declared,
      actingPlayerId: ALICE,
      flashKind: "before_block",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const before = opened;
    let state = removeStateInvalidBattleEntityMembersAndRecompute(
      before,
      getDef
    );
    expect(state.activeAttack).toEqual(before.activeAttack);
    expect(state.window).toBe("flash_before_block");
    expect(state.activeAttack?.flashWindowState?.priorityPlayerId).toBe(BOB);
    expect(state.battleEntities[0]!.memberInstanceIds).toEqual([]);
    for (const actingPlayerId of [BOB, ALICE]) {
      const action = getLegalActions({
        state,
        actingPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      }).find((action) => action.kind === "pass_battle_flash");
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      if (actingPlayerId === BOB) {
        expect(state.activeAttack).not.toBeNull();
        expect(state.battlesEndedThisTurn ?? 0).toBe(0);
      }
    }
    expect(state.activeAttack).toBeNull();
    expect(state.window).toBe("none");
    expect(state.battlesEndedThisTurn).toBe(1);
    expect(state.players[1]!.lifeNormalCoreCount).toBe(5);
    expect(state.cardInstances[0]!.zone).toBe("field");
    expect(collectGameStateInvariantIssues(state)).toEqual([]);
  });

  it.each(["recovered", "exhausted", "heavily_exhausted"] as const)(
    "enter_soul_state は %s を保持せず魂状態にする",
    (exhaustState) => {
      const card = createCardInstance(spiritDef, {
        instanceId: "soul-exhausted",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
        exhaustState,
      });
      card.exhaustedByUnpreventableEffect = exhaustState !== "recovered";
      const state = createEmptyGameState({
        cardInstances: [card],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "enter_soul_state",
              target: { kind: "self" },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:soul-state-exhaust-and-battle-guard:349",
        state,
        effect,
        sourceInstanceId: "soul-exhausted",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });
      const after = result.cardInstances.find(
        (c) => c.instanceId === "soul-exhausted"
      )!;

      expect(after.normalCoreCount).toBe(0);
      expect(after.exhaustState).toBe("recovered");
      expect(after.exhaustedByUnpreventableEffect).toBe(false);
      const events = collectTriggerEventsFromStateDelta({
        beforeState: state,
        afterState: result,
        source: "action_resolution",
        getCardDefinitionById: getDef,
      });
      expect(events.some((event) => event.eventKind === "recover")).toBe(false);
      expect(result.players[0]!.soulStateInstanceIds).toContain(
        "soul-exhausted"
      );
    }
  );

  it("魂状態はスピリットカードではあるが、通常のスピリット実体ではない", () => {
    const card = createCardInstance(spiritDef, {
      instanceId: "soul-spirit-card",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ soulStateInstanceIds: ["soul-spirit-card"] }, {}],
    });
    const soulStateIds = new Set(["soul-spirit-card"]);

    expect(spiritDef.printedCategory).toBe("spirit");
    expect(isBattleCapableCategory(spiritDef, card, state)).toBe(false);
    expect(
      matchesCardFilter(
        card,
        spiritDef,
        { category: ["spirit"] },
        { soulStateIds }
      )
    ).toBe(false);
    expect(
      matchesCardFilter(
        card,
        spiritDef,
        { category: ["spirit"], soulState: "include" },
        { soulStateIds }
      )
    ).toBe(true);
  });

  it("魂状態のカードは activeAttack があってもスピリット実体でないため join_active_attack できない", () => {
    const attacker = createCardInstance(spiritDef, {
      instanceId: "attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const joiner = createCardInstance(spiritDef, {
      instanceId: "soul-joiner",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      exhaustState: "recovered",
    });
    const base = createEmptyGameState({
      cardInstances: [attacker, joiner],
      playerOverrides: [{ soulStateInstanceIds: ["soul-joiner"] }, {}],
    });
    const state: GameState = {
      ...base,
      step: "attack",
      window: "declare_attack",
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId: "entity-attacker",
          memberInstanceIds: ["attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: createActiveAttack(base, "entity-attacker", ALICE),
    };

    expect(
      getJoinActiveAttackBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "soul-joiner",
        getCardDefinitionById: getDef,
      })
    ).toBe("source_category_cannot_attack");
  });

  it("古い参加体 snapshot が残っていても魂状態カードはライフ減少に寄与しない", () => {
    const soulAttacker = createCardInstance(spiritDef, {
      instanceId: "soul-atk",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      cardInstances: [soulAttacker],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        {
          lifeNormalCoreCount: 5,
          reserveNormalCoreCount: 0,
          soulStateInstanceIds: ["soul-atk"],
        },
      ],
    });

    const battleState = withBattle(
      state,
      [{ entityId: "e-soul", leaderId: "soul-atk" }],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);

    expect(dmg).not.toBeNull();
    expect(dmg!.totalLifeDamage).toBe(0);
    expect(dmg!.participantOwnSymbols.get("e-soul")).toBe(0);
  });

  it("魂状態化したアタック中hostはbattle entityから外れ、普通のprevent_battleブレイヴは自動で継続する", () => {
    const host = createCardInstance(spiritDef, {
      instanceId: "host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const base = createEmptyGameState({
      cardInstances: [host, brave],
    });
    const entityId = "entity-host";
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["host", "brave"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      activeContinuousEffects: [battlePreventCe("brave")],
      pendingSoulStateReplacement: {
        choosingPlayerId: ALICE,
        cardInstanceId: "host",
        originalLeaveKind: "destroy",
        originalLeaveCause: "effect_resolution",
      },
      pendingLeaveEntities: [
        {
          instanceId: "host",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "soul-host",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const after = resolveSoulStateReplacement(state, true, getDef);

    expect(after.players[0]!.soulStateInstanceIds).toContain("host");
    expect(after.battleEntities[0]!.memberInstanceIds).toEqual(["brave"]);
    expect(after.activeAttack).not.toBeNull();
    expect(after.pendingBraveAttackContinuation).toBeNull();
  });

  it("魂状態化したアタック中hostの残存ブレイヴがruleStrength攻防不可なら継続せずbattle entityから外れる", () => {
    const host = createCardInstance(spiritDef, {
      instanceId: "host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const brave = createCardInstance(ruleStrengthBraveDef, {
      instanceId: "brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const base = createEmptyGameState({
      cardInstances: [host, brave],
    });
    const entityId = "entity-host";
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["host", "brave"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      pendingSoulStateReplacement: {
        choosingPlayerId: ALICE,
        cardInstanceId: "host",
        originalLeaveKind: "destroy",
        originalLeaveCause: "effect_resolution",
      },
      pendingLeaveEntities: [
        {
          instanceId: "host",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "soul-host",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const after = resolveSoulStateReplacement(state, true, getDef);

    expect(after.pendingBraveAttackContinuation).toBeNull();
    expect(after.activeAttack).toEqual(state.activeAttack);
    expect(after.battleEntities).toEqual([
      expect.objectContaining({
        memberInstanceIds: [],
        attackState: "attacking",
        resolvedBp: 0,
        resolvedSymbols: [],
      }),
    ]);
  });

  it("印字ruleStrength攻防不可のブレイヴは継続選択にcontinueを表示せず、直叩きcontinueも成立しない", () => {
    const brave = createCardInstance(ruleStrengthBraveDef, {
      instanceId: "brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const entityId = "entity-brave";
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [brave],
      }),
      step: "attack",
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["brave"],
          resolvedBp: 1000,
          resolvedSymbols: ["white"],
          attackState: "attacking",
        },
      ],
      activeAttack: createActiveAttack(
        createEmptyGameState({ cardInstances: [brave] }),
        entityId,
        BOB
      ),
      pendingBraveAttackContinuation: {
        choosingPlayerId: ALICE,
        entityId,
        braveInstanceIds: ["brave"],
      },
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      actions.some(
        (action) =>
          action.kind === "resolve_brave_attack_continuation" &&
          action.choice === "continue"
      )
    ).toBe(false);
    expect(
      actions.some(
        (action) =>
          action.kind === "resolve_brave_attack_continuation" &&
          action.choice === "end_attack"
      )
    ).toBe(true);

    const after = resolveBraveAttackContinuation(state, "continue", getDef);
    expect(after.pendingBraveAttackContinuation).toBeNull();
    expect(after.activeAttack).toEqual(state.activeAttack);
    expect(after.battleEntities).toEqual([
      expect.objectContaining({
        memberInstanceIds: [],
        attackState: "attacking",
        resolvedBp: 0,
        resolvedSymbols: [],
      }),
    ]);
    expect(after.log).toContain(
      `brave-attack-continuation:blocked:${entityId}`
    );
  });

  it("通常prevent_battleは成立済みアタックを維持し、ruleStrengthのみbattle memberから外す", () => {
    const brave = createCardInstance(braveDef, {
      instanceId: "brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const base = createEmptyGameState({
      cardInstances: [brave],
    });
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId: "entity-brave",
          memberInstanceIds: ["brave"],
          resolvedBp: 1000,
          resolvedSymbols: ["white"],
          attackState: "attacking",
        },
      ],
      activeAttack: createActiveAttack(base, "entity-brave", ALICE),
      activeContinuousEffects: [battlePreventCe("brave")],
    };

    const ordinary = removeStateInvalidBattleEntityMembersAndRecompute(
      state,
      getDef
    );
    expect(ordinary.activeAttack).not.toBeNull();
    expect(ordinary.battleEntities[0]!.memberInstanceIds).toEqual(["brave"]);

    const ruleStrength = removeStateInvalidBattleEntityMembersAndRecompute(
      { ...state, activeContinuousEffects: [battlePreventCe("brave", true)] },
      getDef
    );
    expect(ruleStrength.activeAttack).toEqual(state.activeAttack);
    expect(ruleStrength.battleEntities[0]!.memberInstanceIds).toEqual([]);
  });

  it("離脱済みidle battle entity memberを次アタック前に除去する", () => {
    const staleParticipant = createCardInstance(spiritDef, {
      instanceId: "stale-participant",
      ownerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
      exhaustState: "exhausted",
    });
    const nextAttacker = createCardInstance(spiritDef, {
      instanceId: "next-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [staleParticipant, nextAttacker],
    });
    const staleState: GameState = {
      ...base,
      step: "attack",
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId: "battle-entity:stale-participant",
          memberInstanceIds: ["stale-participant"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "idle",
        },
      ],
      activeAttack: null,
      battleResolutionGroup: null,
    };

    expect(
      collectGameStateInvariantIssues(staleState).some(
        (issue) => issue.code === "battle_entity_member_not_on_field"
      )
    ).toBe(true);

    const cleaned = removeStateInvalidBattleEntityMembersAndRecompute(
      staleState,
      getDef
    );

    expect(cleaned.battleEntities).toEqual([]);
    expect(collectGameStateInvariantIssues(cleaned)).toEqual([]);
  });

  it("pending leave flush は離脱済みidle battle entity memberを残さない", () => {
    const leavingParticipant = createCardInstance(spiritDef, {
      instanceId: "leaving-participant",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      cardInstances: [leavingParticipant],
    });
    const staleState: GameState = {
      ...base,
      step: "main",
      activePlayerId: ALICE,
      battleEntities: [
        {
          entityId: "battle-entity:leaving-participant",
          memberInstanceIds: ["leaving-participant"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "idle",
        },
      ],
      activeAttack: null,
      battleResolutionGroup: null,
    };
    const queued = queuePendingLeave({
      state: staleState,
      instanceId: "leaving-participant",
      kind: "vanish",
      cause: "cost_payment",
      chainId: "test-chain",
      causePlayerId: ALICE,
    });

    const flushed = flushPendingLeaves(queued, getDef);

    expect(
      flushed.cardInstances.find(
        (card) => card.instanceId === "leaving-participant"
      )?.zone
    ).toBe("trash");
    expect(flushed.battleEntities).toEqual([]);
    expect(
      flushed.log.some((entry) =>
        entry.startsWith("pending-leave-flushed:vanish:leaving-participant:")
      )
    ).toBe(true);
    expect(collectGameStateInvariantIssues(flushed)).toEqual([]);
  });

  it.each(["attacker", "blocker"] as const)(
    "ruleStrengthで%sが戦闘から外れた後も、成立済みブロックを維持しBP比較せず終了する",
    (removedMember) => {
      const zeroBpDef = {
        ...spiritDef,
        levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
      };
      const lookup = (id: string) =>
        id === spiritDef.cardNo ? zeroBpDef : getDef(id);
      const attacker = createCardInstance(zeroBpDef, {
        instanceId: "attacker",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const blocker = createCardInstance(braveDef, {
        instanceId: "blocker",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "brave",
      });
      const base = createEmptyGameState({ cardInstances: [attacker, blocker] });
      const declared: GameState = {
        ...base,
        step: "attack",
        window: "declare_block",
        turnNumber: 3,
        activePlayerId: ALICE,
        battleEntities: [
          {
            entityId: "entity-attacker",
            memberInstanceIds: ["attacker"],
            resolvedBp: 0,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
          {
            entityId: "entity-blocker",
            memberInstanceIds: ["blocker"],
            resolvedBp: 1000,
            resolvedSymbols: ["white"],
            attackState: "blocking",
          },
        ],
        activeAttack: {
          attackId: "atk-1",
          primaryEntityId: "entity-attacker",
          participantEntityIds: ["entity-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [
            {
              participantEntityId: "entity-attacker",
              blockedByEntityIds: ["entity-blocker"],
            },
          ],
          symbolResolutionOrder: ["entity-attacker"],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        activeContinuousEffects: [battlePreventCe(removedMember, true)],
      };
      const lookups = {
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      };
      let state = removeStateInvalidBattleEntityMembersAndRecompute(
        declared,
        lookup
      );
      expect(
        state.battleEntities.find(
          (e) => e.entityId === "entity-" + removedMember
        )?.memberInstanceIds
      ).toEqual([]);
      expect(
        state.activeAttack?.blockAssignments[0]!.blockedByEntityIds
      ).toEqual(["entity-blocker"]);
      state = useOpenBattleFlashAsAction({
        state,
        actingPlayerId: ALICE,
        flashKind: "after_block",
        ...lookups,
      }).state;
      for (const actingPlayerId of [BOB, ALICE]) {
        const action = getLegalActions({
          state,
          actingPlayerId,
          ...lookups,
        }).find((a) => a.kind === "pass_battle_flash");
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...lookups }).state;
      }
      // 終了時用履歴には場のカードが残っていても、現在の戦闘参加者ではない。
      expect(
        state.log.some((entry) =>
          entry.startsWith("battle:resolution:bp-compare:")
        )
      ).toBe(false);
      expect(state.cardInstances.map((card) => card.zone)).toEqual([
        "field",
        "field",
      ]);
      expect(state.players[1]!.lifeNormalCoreCount).toBe(5);
      expect(state.activeAttack).toBeNull();
      expect(state.battlesEndedThisTurn).toBe(1);
      expect(state.window).toBe("none");
      expect(collectGameStateInvariantIssues(state)).toEqual([]);
    }
  );
});
