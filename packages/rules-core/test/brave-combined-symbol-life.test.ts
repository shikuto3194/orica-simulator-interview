/**
 * 合体スピリット (ホスト + ブレイヴ) のアタックによるライフ減少が、
 * 実効シンボル数 (ホスト + ブレイヴ) で計算されることを検証する。
 *
 * 退行防止: 以前は `getOrCreateCombatBattleEntity` が `resolvedSymbols` を
 * ホストの印字シンボルのみで初期化していたため、アタック時効果を持たない
 * 合体スピリットはブレイヴのシンボル分のライフを減らせなかった。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  getEffectiveSymbolsForEntity,
  getLegalActions,
  applyLegalAction,
  executeBattleResolution,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
  confirmAttackDeclarationAsAction,
  useDeclineBlockAsAction,
} from "../src";
import { getOrCreateCombatBattleEntity } from "../src/battle/battle-shared";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { createCardInstance, createEmptyGameState } from "../src/factories";

const noFieldEffects = () => [] as const;

function makeSpirit(): CardDefinition {
  return {
    cardNo: "HOST-SYM",
    name: "ホスト",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeBrave(): CardDefinition {
  return {
    cardNo: "BRAVE-SYM",
    name: "ブレイヴ",
    printedCategory: "brave",
    colors: ["white"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["white"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("合体スピリットの実効シンボル数", () => {
  it("スピリット状態ブレイヴの旧 battle entity を合体時に除去する", () => {
    const hostDef = makeSpirit();
    const braveDef = makeBrave();
    const lookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      battleEntities: [
        {
          entityId: "battle-entity:brave-1",
          memberInstanceIds: ["brave-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["white" as const],
          attackState: "idle" as const,
        },
      ],
    };

    const combined = executeBraveCombine(
      before,
      "alice",
      "brave-1",
      "host-1",
      lookup
    );

    expect(combined.battleEntities).toEqual([]);
    const hostAfter = combined.cardInstances.find(
      (card) => card.instanceId === "host-1"
    )!;
    const attackEntity = getOrCreateCombatBattleEntity({
      state: combined,
      sourceCard: hostAfter,
      sourceDefinition: hostDef,
      getCardDefinitionById: lookup,
    });
    expect(attackEntity.memberInstanceIds).toEqual(["host-1", "brave-1"]);
  });

  it("BSAZ01-C11 型の after-block 合体でも成立済みブロックを保持する", () => {
    const hostDef = makeSpirit();
    const braveDef = makeBrave();
    const lookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;
    const attacker = createCardInstance(hostDef, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const blockerHost = createCardInstance(hostDef, {
      instanceId: "blocker-host-1",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const blockerBrave = createCardInstance(braveDef, {
      instanceId: "blocker-brave-1",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const attackerEntityId = "battle-entity:attacker-1";
    const blockerEntityId = "battle-entity:blocker-brave-1";
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{}, { lifeNormalCoreCount: 5 }],
        cardInstances: [attacker, blockerHost, blockerBrave],
      }),
      activePlayerId: "alice",
      step: "attack",
      activeAttack: {
        attackId: "attack-group:1:alice:attacker-1",
        primaryEntityId: attackerEntityId,
        participantEntityIds: [attackerEntityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: attackerEntityId,
            blockedByEntityIds: [blockerEntityId],
          },
        ],
        symbolResolutionOrder: [attackerEntityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
        attackAfterBurstChecked: true,
        ownAttackBurstChecked: true,
      },
      battleEntities: [
        {
          entityId: attackerEntityId,
          memberInstanceIds: ["attacker-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: blockerEntityId,
          memberInstanceIds: ["blocker-brave-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["white"],
          attackState: "blocking",
        },
      ],
    };

    const combined = executeBraveCombine(
      before,
      "bob",
      "blocker-brave-1",
      "blocker-host-1",
      lookup
    );

    expect(
      combined.battleEntities.find(
        (entity) => entity.entityId === blockerEntityId
      )
    ).toMatchObject({
      memberInstanceIds: [],
      leftFieldMemberInstanceIds: ["blocker-brave-1"],
      attackState: "blocking",
    });
    expect(combined.activeAttack?.blockAssignments).toEqual([
      {
        participantEntityId: attackerEntityId,
        blockedByEntityIds: [blockerEntityId],
      },
    ]);

    const resolved = executeBattleResolution({
      state: combined,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    expect(resolved.totalLifeDamage).toBe(0);
  });

  it("getOrCreateCombatBattleEntity はホスト + ブレイヴの実効シンボルで初期化する", () => {
    const hostDef = makeSpirit();
    const braveDef = makeBrave();
    const lookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: "host-1",
    };

    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    });

    const entity = getOrCreateCombatBattleEntity({
      state,
      sourceCard: host,
      sourceDefinition: hostDef,
      getCardDefinitionById: lookup,
    });

    // ホスト + ブレイヴの両方が member
    expect(entity.memberInstanceIds).toEqual(["host-1", "brave-1"]);
    // シンボルはホスト (red) + ブレイヴ (white) の 2 個 → ライフ 2 点
    expect(entity.resolvedSymbols).toEqual(["red", "white"]);
    expect(entity.resolvedSymbols.length).toBe(2);

    // recompute (源泉) と一致すること
    const cardInstancesById = new Map(
      state.cardInstances.map((c) => [c.instanceId, c])
    );
    expect(entity.resolvedSymbols).toEqual(
      getEffectiveSymbolsForEntity(state, entity, cardInstancesById, lookup)
    );
  });

  it.each([false, true])(
    "合体スピリットの2シンボルでライフ2減少（ブレイヴ多色=%s）",
    (dualColor) => {
      const hostDef = makeSpirit();
      const braveDef = makeBrave();
      const lookup = (id: string) =>
        id === hostDef.cardNo
          ? hostDef
          : id === braveDef.cardNo
            ? braveDef
            : undefined;

      const host = {
        ...createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "recovered" as const,
        }),
        attachedChildrenIds: ["brave-1"],
      };
      const brave = {
        ...createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "field",
          exhaustState: "recovered" as const,
        }),
        attachedToInstanceId: "host-1",
      };

      // bob はブロッカー無し・ライフ 5。合体スピリットの素アタックでライフを観測する。
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{}, { lifeNormalCoreCount: 5 }],
        }),
        cardInstances: [host, brave],
        step: "attack",
        turnNumber: 2,
        activePlayerId: "alice",
      };

      if (dualColor) {
        state.activeContinuousEffects = [
          {
            effectId: "dual-brave",
            sourceInstanceId: "brave-1",
            sourceDefinitionId: braveDef.cardNo,
            actingPlayerId: "alice",
            targetInstanceId: "brave-1",
            modifierTag: "treat_as_symbol",
            modifierSymbol: ["blue"],
            duration: { scope: "turn" },
            createdAtTurn: 2,
            createdAtAttackId: null,
          },
        ];
      }
      const bobLifeBefore = state.players.find(
        (p) => p.id === "bob"
      )!.lifeNormalCoreCount;
      expect(bobLifeBefore).toBe(5);

      // アタック宣言 → 相手の事前宣言スタックをパス → 宣言確定
      const tentative = useAttackAsAction({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "host-1",
        getCardDefinitionById: lookup,
      });
      const afterPass = usePassPreDeclarationStackAsAction({
        state: tentative,
        actingPlayerId: "bob",
      });
      const attackResult = confirmAttackDeclarationAsAction(
        afterPass.closedWindow!,
        afterPass.state,
        { getCardDefinitionById: lookup }
      );

      // バトルフラッシュ窓を開いて両者パス
      const openAction = getLegalActions({
        state: attackResult.state,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: noFieldEffects,
      }).find((a) => a.kind === "open_battle_flash");
      let readyForBlock = attackResult.state;
      if (openAction) {
        let s = applyLegalAction({
          state: attackResult.state,
          action: openAction,
          getCardDefinitionById: lookup,
        }).state;
        for (let i = 0; i < 2 && s.activeAttack?.flashWindowState; i++) {
          const priority = s.activeAttack.flashWindowState.priorityPlayerId;
          const pass = getLegalActions({
            state: s,
            actingPlayerId: priority,
            getCardDefinitionById: lookup,
            getRegisteredFieldCardEffectActions: noFieldEffects,
          }).find((a) => a.kind === "pass_battle_flash");
          if (!pass) break;
          s = applyLegalAction({
            state: s,
            action: pass,
            getCardDefinitionById: lookup,
          }).state;
        }
        readyForBlock = s;
      }

      // bob はブロックしない → バトル解決
      const declineResult = useDeclineBlockAsAction({
        state: readyForBlock,
        actingPlayerId: "bob",
        getCardDefinitionById: lookup,
      });

      const bobAfter = declineResult.state.players.find((p) => p.id === "bob")!;
      // host (red) + brave (white) = 2 シンボル → ライフ 2 減少
      expect(bobAfter.lifeNormalCoreCount).toBe(bobLifeBefore - 2);
    }
  );

  it("古い host 単体 battle entity が残っていても、合体後アタックはブレイヴのシンボルを含める", () => {
    const hostDef = makeSpirit();
    const braveDef = makeBrave();
    const lookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    const hostBefore = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered" as const,
    });
    const braveBefore = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      exhaustState: "recovered" as const,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{}, { lifeNormalCoreCount: 5 }],
      cardInstances: [hostBefore, braveBefore],
    });
    const staleEntity = getOrCreateCombatBattleEntity({
      state: baseState,
      sourceCard: hostBefore,
      sourceDefinition: hostDef,
      getCardDefinitionById: lookup,
    });
    expect(staleEntity.memberInstanceIds).toEqual(["host-1"]);
    expect(staleEntity.resolvedSymbols).toEqual(["red"]);

    const combinedState: GameState = {
      ...baseState,
      cardInstances: [
        { ...hostBefore, attachedChildrenIds: ["brave-1"] },
        { ...braveBefore, attachedToInstanceId: "host-1" },
      ],
      battleEntities: [staleEntity],
      step: "attack",
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const bobLifeBefore = combinedState.players.find(
      (p) => p.id === "bob"
    )!.lifeNormalCoreCount;

    const tentative = useAttackAsAction({
      state: combinedState,
      actingPlayerId: "alice",
      sourceInstanceId: "host-1",
      getCardDefinitionById: lookup,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "bob",
    });
    const attackResult = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: lookup }
    );

    const attackEntity = attackResult.state.battleEntities.find(
      (entity) => entity.memberInstanceIds[0] === "host-1"
    );
    expect(attackEntity?.memberInstanceIds).toEqual(["host-1", "brave-1"]);
    expect(attackEntity?.resolvedSymbols).toEqual(["red", "white"]);

    const openAction = getLegalActions({
      state: attackResult.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: noFieldEffects,
    }).find((a) => a.kind === "open_battle_flash");
    let readyForBlock = attackResult.state;
    if (openAction) {
      let s = applyLegalAction({
        state: attackResult.state,
        action: openAction,
        getCardDefinitionById: lookup,
      }).state;
      for (let i = 0; i < 2 && s.activeAttack?.flashWindowState; i++) {
        const priority = s.activeAttack.flashWindowState.priorityPlayerId;
        const pass = getLegalActions({
          state: s,
          actingPlayerId: priority,
          getCardDefinitionById: lookup,
          getRegisteredFieldCardEffectActions: noFieldEffects,
        }).find((a) => a.kind === "pass_battle_flash");
        if (!pass) break;
        s = applyLegalAction({
          state: s,
          action: pass,
          getCardDefinitionById: lookup,
        }).state;
      }
      readyForBlock = s;
    }

    const declineResult = useDeclineBlockAsAction({
      state: readyForBlock,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    });
    const bobAfter = declineResult.state.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(bobLifeBefore - 2);
  });
});
