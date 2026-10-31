/**
 * ENGINE-battle-end-deferred-yield-finalize:
 * `fireBattleEndDeferrals` (timing.deferredTo:"battle_end" 効果の battle_end 再開) 内で
 * 実行された効果が step.executionMode:"optional" の execute/decline 未解決 (`pendingStepOptionalChoice`)
 * で中断した場合、旧実装は `executeBattleResolution` がその継続未解決を無視して
 * `finalizeBattleEndScopeExpirations` (scope:"battle" CE 失効) を即座に呼んでいた
 * (10_rules/02 L167 違反: battle_end 誘発効果の解決完了前に battle 中のみ有効な効果が失効する)。
 *
 * ルール正源: manual/ai-reference/10_rules/02_turn-flow-and-timing.md L167
 *   「バトル終了時 に誘発する効果を先に解決し、バトル中のみ有効な効果が
 *    失効してからバトル終了。」
 *
 * 本テストは alice の attacker に effect_immunity scope:battle が登録され、同じ attacker が
 * 「このスピリットのアタック時、バトル終了時、コアをトラッシュからリザーブへ置ける」型の
 * deferredTo:"battle_end" + 任意 (executionMode:"optional") 効果を持つ状況で、
 *
 * - executeBattleResolution 直後: fireBattleEndDeferrals が pendingStepOptionalChoice を
 *   生成して中断するため、scope:battle CE はまだ alive (pendingBattleEndFinalizeAttackIds に予約)。
 * - pendingStepOptionalChoice を decline で解決: 解決完了時点で初めて scope:battle CE が失効する。
 *
 * ことを行動レベルで証明する (BSKB01-X01 effects[1] 型の precedent — bp_compare_destroy を
 * 単純な core_move に差し替えた最小 fixture)。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
  applyLegalAction,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src/index";
import { executeEndSingleBattle } from "../src/battle/battle-actions";
import {
  getBattleEndDeferralChainId,
  hasPendingBattleEndFinalizeBlockers,
  isBattleEndDeferralChainForAttack,
  maybeFinalizeBattleEndScopeExpirations,
} from "../src/battle/battle-end-scope-finalize";
import {
  finalizeEffectResolution,
  processPendingImmediateBattleEnds,
} from "../src/effect/effect-resolution";
import {
  flushPendingLeavesAndQueueReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { executeEndBattle } from "../src/effect/structured-state-grants";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import { shouldDiscardRemainingStacksAfterBattleEnded } from "../src/legal/stack-resolution-core";
import type {
  ActiveAttack,
  ActiveStack,
  CardDefinition,
  ContinuousEffectTag,
  GameState,
  LegalAction,
} from "../src/index";

function makeAttackerDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-ATK",
    name: "テスト攻撃者(deferred-yield-finalize)",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // effects[0]: 『このスピリットのアタック時』自身に effect_immunity duration:battle。
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [0],
      },
      // effects[1]: 『このスピリットのアタック時』バトル終了時、トラッシュのコア1個を
      // 自分のリザーブに置ける (任意 = executionMode:"optional")。BSKB01-X01 effects[1] と
      // 同型 (deferredTo:"battle_end" + step 任意) の最小 fixture。
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ],
        textRef: [1],
      },
    ],
  };
}

function makeTargetSelectionAttackerDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-ATK-TARGET",
    name: "テスト攻撃者(deferred-yield-finalize-target)",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [
          {
            id: "optional-bounce",
            executionMode: "optional",
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [1],
      },
    ],
  };
}

function makeBattleEndSetAsideRemoveSourceDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-SET-ASIDE-REMOVE-SOURCE",
    name: "テスト battle_end 手元除外 source",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "self",
                filter: {},
                count: 1,
                zone: "set_aside",
              },
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeSetAsideSelfReturnDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-SET-ASIDE-SELF-RETURN",
    name: "テスト手元自己除外置換",
    printedCategory: "brave",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "remove_from_game",
              source: "self",
              duration: { scope: "permanent" },
              replacement: { kind: "move_to", zone: "hand" },
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleEndBorrowSourceDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト battle_end borrow source",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [
          {
            action: {
              kind: "borrow_card_event_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              borrowEvents: ["attack"],
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBorrowChoiceDonorDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-BORROW-CHOICE-DONOR",
    name: "テスト borrow choice donor",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["blue"],
    textLines: [
      "Lv1『このスピリットのアタック時』",
      "自分のカウント+2する。",
      "自分のカウント+3する。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 2 } },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 3 } },
        ],
        textRef: [0, 2],
      },
    ],
  };
}

function makeBorrowTargetDonorDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-BORROW-TARGET-DONOR",
    name: "テスト borrow target donor",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["blue"],
    textLines: [
      "Lv1『このスピリットのアタック時』",
      "相手のスピリット1体を疲労させる。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  };
}

function makeEnemySpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-ENEMY",
    name: "テスト相手スピリット",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function makeTargetedResponderDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-TARGETED-RESPONDER",
    name: "テスト targeted responder",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "targeted",
          player: "self",
        },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleEndTargetingSourceDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト battle_end 対象効果元",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            id: "destroy-target",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleEndOptionalCountSourceDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト battle_end optional count 元",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            executionMode: "optional",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleEndMandatoryCountSourceDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト battle_end mandatory count 元",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 7 },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleEndLifeGainSourceDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-LIFE-GAIN",
    name: "テスト battle_end ライフ増加元",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleEndLifeDamageDiscardSourceDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-LIFE-DAMAGE-DISCARD",
    name: "テスト battle_end ライフ減少元",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeDiscardCostGateDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-DISCARD-GATE",
    name: "テスト discard cost gate",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent_effect",
              mode: "replace",
              discardCostGate: { zones: ["hand", "set_aside"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleLifeReducedNegateCountDef(): CardDefinition {
  return {
    cardNo: "TEST-DYF-BATTLE-LIFE-REDUCED-NEGATE",
    name: "テスト battle_life_reduced negate",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        condition: [{ kind: "battle_life_reduced", negate: true }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 9,
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeBattleEndWaitEffect(
  attackId: string
): GameState["activeContinuousEffects"][number] {
  return {
    effectId: `ce:${attackId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "TEST-BATTLE-END-WAIT",
    actingPlayerId: "alice",
    duration: { scope: "battle" },
    createdAtTurn: 1,
    createdAtAttackId: attackId,
    modifierTag: "effect_immunity",
    targetInstanceId: "source-1",
  };
}

function expectBattleEndWaitEffectCleared(
  state: GameState,
  attackId: string,
  effectId: string
): void {
  expect(state.pendingBattleEndFinalizeAttackIds).not.toContain(attackId);
  expect(
    state.activeContinuousEffects.some((effect) => effect.effectId === effectId)
  ).toBe(false);
  expect(state.log).toContain(`battle:end-scope-finalize:drained:${attackId}`);
}

describe("ENGINE-battle-end-deferred-yield-finalize", () => {
  it("battle_end deferral chain matching は colon を含む attackId の prefix 衝突を起こさない", () => {
    const attackId = "attack:entity:1";
    const siblingAttackId = "attack:entity:1:extra";
    const chainId = getBattleEndDeferralChainId(attackId);
    const siblingChainId = getBattleEndDeferralChainId(siblingAttackId);

    expect(isBattleEndDeferralChainForAttack(chainId, attackId)).toBe(true);
    expect(
      isBattleEndDeferralChainForAttack(`${chainId}:target:0`, attackId)
    ).toBe(true);
    expect(
      isBattleEndDeferralChainForAttack(
        `trigger:pending:${chainId}:destroy:alice`,
        attackId
      )
    ).toBe(true);
    expect(isBattleEndDeferralChainForAttack(siblingChainId, attackId)).toBe(
      false
    );
    expect(
      isBattleEndDeferralChainForAttack(`${siblingChainId}:target:0`, attackId)
    ).toBe(false);
  });

  it("battle_end scope CE 失効は finalize blocker の共通判定で pending core distribution を待つ", () => {
    const attackId = "attack:shared-finalize-blocker:1";
    const sourceDef = makeAttackerDef();
    const targetDef = makeEnemySpiritDef();
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const battleEndEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
      }),
      turnNumber: 2,
      activeContinuousEffects: [battleEndEffect],
      pendingCoreDistribution: {
        pendingId: "pending:shared-finalize-blocker",
        actingPlayerId: "alice",
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: sourceDef.cardNo,
        candidates: [
          {
            instanceId: target.instanceId,
            definitionId: targetDef.cardNo,
          },
        ],
        totalNormalCores: 1,
        hasSoulCore: false,
        fromKind: "reserve",
        minTotal: 0,
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "activated", mode: "main" },
        battleEndDeferralAttackId: attackId,
      },
    };

    expect(hasPendingBattleEndFinalizeBlockers(state, attackId)).toBe(true);
    expect(
      removeExpiredContinuousEffects(state, { kind: "battle_end", attackId })
    ).toEqual([battleEndEffect]);
  });

  it("battle_end deferred remove_from_game が手元除外置換 pending を出す間は battle CE 失効を待つ", () => {
    const attackId = "attack:set-aside-exit-replacement:1";
    const sourceDef = makeBattleEndSetAsideRemoveSourceDef();
    const setAsideDef = makeSetAsideSelfReturnDef();
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [setAsideDef.cardNo, setAsideDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const setAsideCard = createCardInstance(setAsideDef, {
      instanceId: "set-aside-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const withSetAsideReplacement = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, setAsideCard],
      }),
      getCardDefinitionById
    );
    expect(
      withSetAsideReplacement.activeContinuousEffects.some(
        (effect) =>
          effect.targetInstanceId === "set-aside-1" &&
          effect.modifierTag === "replace_field_exit"
      )
    ).toBe(true);

    const battleEndEffect = makeBattleEndWaitEffect(attackId);
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "source-entity",
      participantEntityIds: ["source-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "source-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["source-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...withSetAsideReplacement,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "source-entity",
          memberInstanceIds: ["source-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      activeContinuousEffects: [
        ...withSetAsideReplacement.activeContinuousEffects,
        battleEndEffect,
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:set-aside-exit-replacement",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: sourceDef.cardNo,
          effectIndex: 0,
        },
      ],
    };

    const resolved = executeBattleResolution({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    const pending = resolved.pendingSetAsideExitReplacementChoice;
    expect(pending).toMatchObject({
      choosingPlayerId: "alice",
      cardInstanceId: "set-aside-1",
      battleEndDeferralAttackId: attackId,
      replacement: { kind: "move_to", zone: "hand" },
    });

    const blockerOnlyState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: resolved.cardInstances,
      }),
      activeContinuousEffects: [battleEndEffect],
      pendingBattleEndFinalizeAttackIds: [attackId],
      pendingSetAsideExitReplacementChoice: pending,
    };
    expect(
      hasPendingBattleEndFinalizeBlockers(blockerOnlyState, attackId)
    ).toBe(true);
    expect(
      maybeFinalizeBattleEndScopeExpirations(
        blockerOnlyState,
        getCardDefinitionById
      ).activeContinuousEffects
    ).toEqual([battleEndEffect]);

    const afterReplace = applyLegalAction({
      state: blockerOnlyState,
      action: {
        kind: "resolve_set_aside_exit_replacement_choice",
        actionId: "set-aside-exit-replacement-replace-set-aside-1",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        cardInstanceId: "set-aside-1",
        choice: "replace",
        replacementKind: "move_to",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(afterReplace.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(afterReplace.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(afterReplace.activeContinuousEffects).not.toContain(battleEndEffect);
    expect(
      afterReplace.cardInstances.find(
        (card) => card.instanceId === "set-aside-1"
      )?.zone
    ).toBe("hand");
  });

  it("手元除外置換 pending 解決後に同一 battle の後続 battle_end deferral を再開してから finalize する", () => {
    const attackId = "attack:set-aside-exit-replacement-sequential:1";
    const firstDef = makeBattleEndSetAsideRemoveSourceDef();
    const secondDef = makeBattleEndMandatoryCountSourceDef(
      "TEST-DYF-SET-ASIDE-SEQUENTIAL-COUNT"
    );
    const setAsideDef = makeSetAsideSelfReturnDef();
    const defs = new Map<string, CardDefinition>([
      [firstDef.cardNo, firstDef],
      [secondDef.cardNo, secondDef],
      [setAsideDef.cardNo, setAsideDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];
    const firstSource = createCardInstance(firstDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const secondSource = createCardInstance(secondDef, {
      instanceId: "source-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const setAsideCard = createCardInstance(setAsideDef, {
      instanceId: "set-aside-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const withSetAsideReplacement = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [firstSource, secondSource, setAsideCard],
      }),
      getCardDefinitionById
    );
    const battleEndEffect = makeBattleEndWaitEffect(attackId);
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "source-entity",
      participantEntityIds: ["source-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "source-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["source-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...withSetAsideReplacement,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "source-entity",
          memberInstanceIds: ["source-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      activeContinuousEffects: [
        ...withSetAsideReplacement.activeContinuousEffects,
        battleEndEffect,
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:set-aside-exit-replacement-first",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: firstDef.cardNo,
          effectIndex: 0,
        },
        {
          deferralId: "def:set-aside-exit-replacement-second",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "source-2",
          sourceDefinitionId: secondDef.cardNo,
          effectIndex: 0,
        },
      ],
    };

    const pendingState = executeBattleResolution({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(pendingState.pendingSetAsideExitReplacementChoice).toMatchObject({
      cardInstanceId: "set-aside-1",
      battleEndDeferralAttackId: attackId,
    });
    expect(pendingState.pendingBattleEndDeferrals).toMatchObject([
      { deferralId: "def:set-aside-exit-replacement-second", attackId },
    ]);
    expect(pendingState.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      pendingState.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEndEffect.effectId
      )
    ).toBe(true);

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).find(
      (candidate) =>
        candidate.kind === "resolve_set_aside_exit_replacement_choice" &&
        candidate.choice === "replace"
    );
    expect(action).toBeDefined();
    const afterReplace = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(afterReplace.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(afterReplace.pendingBattleEndDeferrals).toEqual([]);
    expect(afterReplace.pendingImmediateBattleEnds).toEqual([]);
    expect(afterReplace.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterReplace.log.some((line) =>
        line.includes(`battle:end-deferral:fire:${attackId}:source-2:0`)
      )
    ).toBe(true);
    expect(
      afterReplace.players.find((player) => player.id === "alice")!.countValue
    ).toBe(7);
    expect(
      afterReplace.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEndEffect.effectId
      )
    ).toBe(false);
  });

  it("battle_end deferred borrow choice pending は解決完了まで battle CE 失効を待つ", () => {
    const attackId = "attack:borrow-choice:1";
    const sourceDef = makeBattleEndBorrowSourceDef(
      "TEST-DYF-BORROW-CHOICE-SOURCE"
    );
    const donorDef = makeBorrowChoiceDonorDef();
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [donorDef.cardNo, donorDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "donor-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const battleEndEffect = makeBattleEndWaitEffect(attackId);
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "source-entity",
      participantEntityIds: ["source-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "source-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["source-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, donor],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "source-entity",
          memberInstanceIds: ["source-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      activeContinuousEffects: [battleEndEffect],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:borrow-choice",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: sourceDef.cardNo,
          effectIndex: 0,
          targetInstanceIds: ["donor-1"],
        },
      ],
    };

    const pendingState = executeBattleResolution({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(pendingState.pendingBorrowedEffectChoice).toMatchObject({
      sourceInstanceId: "source-1",
      targetInstanceId: "donor-1",
      battleEndDeferralAttackId: attackId,
    });
    expect(pendingState.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(hasPendingBattleEndFinalizeBlockers(pendingState, attackId)).toBe(
      true
    );
    expect(
      pendingState.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEndEffect.effectId
      )
    ).toBe(true);

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).find(
      (candidate) =>
        candidate.kind === "resolve_borrowed_effect_choice" &&
        candidate.borrowedEffectIndex === 1
    );
    expect(action).toBeDefined();
    const afterChoice = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(afterChoice.pendingBorrowedEffectChoice).toBeNull();
    expect(afterChoice.pendingImmediateBattleEnds).toEqual([]);
    expect(afterChoice.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterChoice.players.find((player) => player.id === "alice")!.countValue
    ).toBe(3);
    expect(
      afterChoice.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEndEffect.effectId
      )
    ).toBe(false);
  });

  it("battle_end deferred borrow target pending は対象解決完了まで battle CE 失効を待つ", () => {
    const attackId = "attack:borrow-target:1";
    const sourceDef = makeBattleEndBorrowSourceDef(
      "TEST-DYF-BORROW-TARGET-SOURCE"
    );
    const donorDef = makeBorrowTargetDonorDef();
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [donorDef.cardNo, donorDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "donor-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const enemy = createCardInstance(donorDef, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const battleEndEffect = makeBattleEndWaitEffect(attackId);
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "source-entity",
      participantEntityIds: ["source-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "source-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["source-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, donor, enemy],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "source-entity",
          memberInstanceIds: ["source-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      activeContinuousEffects: [battleEndEffect],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:borrow-target",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: sourceDef.cardNo,
          effectIndex: 0,
          targetInstanceIds: ["donor-1"],
        },
      ],
    };

    const pendingState = executeBattleResolution({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(pendingState.pendingBorrowedEffectTargetSelection).toMatchObject({
      sourceInstanceId: "source-1",
      targetInstanceId: "donor-1",
      borrowedEffectIndex: 0,
      battleEndDeferralAttackId: attackId,
    });
    expect(
      pendingState.pendingBorrowedEffectTargetSelection!.candidateInstanceIds
    ).toEqual(["donor-1", "enemy-1"]);
    expect(hasPendingBattleEndFinalizeBlockers(pendingState, attackId)).toBe(
      true
    );

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).find((candidate) => candidate.kind === "resolve_borrowed_effect_target");
    expect(action).toBeDefined();
    const afterTarget = applyLegalAction({
      state: pendingState,
      action: action!,
      targetInstanceIds: ["enemy-1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(afterTarget.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(afterTarget.pendingImmediateBattleEnds).toEqual([]);
    expect(afterTarget.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterTarget.cardInstances.find((card) => card.instanceId === "enemy-1")!
        .exhaustState
    ).toBe("exhausted");
    expect(
      afterTarget.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEndEffect.effectId
      )
    ).toBe(false);
  });

  it("通常 attack trigger の attackId は battle_end deferral marker として伝搬しない", () => {
    const sourceDef: CardDefinition = {
      cardNo: "TEST-NORMAL-ATTACK-TRIGGER-CORE-SHOOT",
      name: "テスト通常attack trigger core shoot",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [{ count: 1, filter: { category: ["spirit"] } }],
                remainder: "bottom",
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const victimDef: CardDefinition = {
      cardNo: "TEST-NORMAL-ATTACK-TRIGGER-VICTIM",
      name: "テスト通常attack trigger victim",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [victimDef.cardNo, victimDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const getRegisteredTriggeredEffectActions = (cardNo: string) =>
      cardNo === sourceDef.cardNo
        ? [
            {
              sourceKind: "spirit" as const,
              eventKind: "attack" as const,
              executionMode: "mandatory" as const,
              effectIndex: 0,
            },
          ]
        : undefined;
    const source = createCardInstance(sourceDef, {
      instanceId: "normal-trigger-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const revealedCard = createCardInstance(victimDef, {
      instanceId: "normal-trigger-revealed-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const attackId = "attack:normal-trigger:1";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, revealedCard],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "none",
      pendingTriggeredEffects: [
        {
          pendingId: "pending:normal-attack-trigger",
          actingPlayerId: "alice",
          eventKind: "attack",
          source: "action_resolution",
          chainId: "normal-attack-chain",
          attackId,
          relatedPlayerId: "alice",
          relatedInstanceId: "normal-trigger-source",
          amount: null,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    let after = applyLegalAction({
      state,
      action: {
        chainId: "test:battle-end-deferred-yield-finalize:1432",
        kind: "resolve_pending_triggered_effect",
        actionId: "resolve-normal-attack-trigger",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: "pending:normal-attack-trigger",
        eventKind: "attack",
        executionMode: "mandatory",
        sourceKind: "spirit",
        sourceInstanceId: "normal-trigger-source",
        sourceDefinitionId: sourceDef.cardNo,
        sourceCardNo: sourceDef.cardNo,
        registrationIndex: 0,
        targetMode: "none",
        requiredTargetCount: 0,
        targetEffectFilterTags: ["general"],
        candidateTargetInstanceIds: [],
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
    }).state;
    if (after.window === "stack" && after.stackWindow !== null) {
      const pass = getLegalActions({
        state: after,
        actingPlayerId: after.stackWindow.priorityPlayerId,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: () => [],
      }).find((candidate) => candidate.kind === "pass_stack");
      expect(pass).toBeDefined();
      after = applyLegalAction({
        state: after,
        action: pass!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: () => [],
      }).state;
    }

    expect(after.pendingDeckReveal).not.toBeNull();
    expect(
      after.pendingDeckReveal?.continuation?.battleEndDeferralAttackId
    ).toBeUndefined();
    expect(after.pendingBattleEndFinalizeAttackIds).toEqual([]);
  });

  it("scope:'battle' effect_immunity は battle_end deferred 効果の pendingStepOptionalChoice 解決完了まで alive", () => {
    const attackerDef = makeAttackerDef();
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];

    const attacker = createCardInstance(attackerDef, {
      instanceId: "dyf-atk-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });

    const attackId = "attack:dyf-be-atk:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "dyf-be-atk",
      participantEntityIds: ["dyf-be-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "dyf-be-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["dyf-be-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };

    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker],
    });
    const midBattle: GameState = {
      ...baseState,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "dyf-be-atk",
          memberInstanceIds: ["dyf-atk-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
    };

    // 1. attacker のアタック時 effect_immunity を発揮 (CE 生成)。
    const afterImmunity = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:1537",
      state: midBattle,
      effect: attackerDef.effects![0]!,
      sourceInstanceId: "dyf-atk-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      effectIndex: 0,
    });
    const ceForAttacker = afterImmunity.activeContinuousEffects.find(
      (ce) =>
        ce.targetInstanceId === "dyf-atk-1" &&
        ce.modifierTag === "defense_immune" &&
        ce.duration.scope === "battle"
    );
    expect(ceForAttacker).toBeDefined();

    // 2. 同じアタック時に deferredTo:"battle_end" 効果を発揮 → pendingBattleEndDeferrals に予約。
    const queued = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:1555",
      state: afterImmunity,
      effect: attackerDef.effects![1]!,
      sourceInstanceId: "dyf-atk-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      effectIndex: 1,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    // 3. executeBattleResolution: fireBattleEndDeferrals が effects[1] を再開し、
    //    step.executionMode:"optional" で pendingStepOptionalChoice が立って中断する。
    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(resolved.state.pendingStepOptionalChoice).not.toBeNull();
    expect(
      resolved.state.pendingStepOptionalChoice!.continuation
        .battleEndDeferralAttackId
    ).toBe(attackId);

    // 4. 行動証拠 (本丸その1): pendingStepOptionalChoice が残るため finalize は
    //    pendingBattleEndFinalizeAttackIds に予約され、scope:'battle' CE はまだ alive。
    expect(resolved.state.pendingBattleEndFinalizeAttackIds).toContain(
      attackId
    );
    expect(
      resolved.state.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "dyf-atk-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeDefined();

    // 5. pendingStepOptionalChoice を decline で解決 (継続完了)。
    const pending = resolved.state.pendingStepOptionalChoice!;
    const afterDecline = applyLegalAction({
      state: resolved.state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    // 6. 行動証拠 (本丸その2): 継続解決完了により scope:'battle' CE はここで初めて失効し、
    //    pendingBattleEndFinalizeAttackIds からも除去される。
    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(afterDecline.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterDecline.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "dyf-atk-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeUndefined();
  });

  it("battle_end deferral は pending 中に同一 battle の後続 deferral を即時発火しない", () => {
    const optionalDef = makeBattleEndOptionalCountSourceDef(
      "TEST-BATTLE-END-SEQUENTIAL-OPTIONAL"
    );
    const mandatoryDef = makeBattleEndMandatoryCountSourceDef(
      "TEST-BATTLE-END-SEQUENTIAL-MANDATORY"
    );
    const defs = new Map<string, CardDefinition>([
      [optionalDef.cardNo, optionalDef],
      [mandatoryDef.cardNo, mandatoryDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];
    const optionalSource = createCardInstance(optionalDef, {
      instanceId: "seq-source-optional-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const mandatorySource = createCardInstance(mandatoryDef, {
      instanceId: "seq-source-mandatory-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack:dyf-sequential:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "seq-atk",
      participantEntityIds: ["seq-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "seq-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["seq-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [optionalSource, mandatorySource],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "seq-atk",
          memberInstanceIds: ["seq-source-optional-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      activeContinuousEffects: [battleEffect],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:seq-optional",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "seq-source-optional-1",
          sourceDefinitionId: optionalDef.cardNo,
          effectIndex: 0,
        },
        {
          deferralId: "def:seq-mandatory",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "seq-source-mandatory-1",
          sourceDefinitionId: mandatoryDef.cardNo,
          effectIndex: 0,
        },
      ],
    };

    const resolved = executeBattleResolution({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(resolved.pendingStepOptionalChoice).not.toBeNull();
    expect(resolved.log).toContain(
      `battle:end-deferral:fire:${attackId}:seq-source-optional-1:0`
    );
    expect(resolved.log).not.toContain(
      `battle:end-deferral:fire:${attackId}:seq-source-mandatory-1:0`
    );
    expect(resolved.pendingBattleEndDeferrals).toMatchObject([
      { deferralId: "def:seq-mandatory", attackId },
    ]);
    expect(resolved.pendingImmediateBattleEnds).toMatchObject([
      { attackId, battleEndEntryStarted: true },
    ]);
    expect(resolved.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      resolved.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(true);
    expect(
      resolved.players.find((player) => player.id === "alice")!.countValue
    ).toBe(0);

    const pending = resolved.pendingStepOptionalChoice!;
    const afterDecline = applyLegalAction({
      state: resolved,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(afterDecline.log).toContain(
      `battle:end-deferral:fire:${attackId}:seq-source-mandatory-1:0`
    );
    expect(afterDecline.pendingBattleEndDeferrals).toHaveLength(0);
    expect(afterDecline.pendingImmediateBattleEnds).toHaveLength(0);
    expect(
      afterDecline.players.find((player) => player.id === "alice")!.countValue
    ).toBe(7);
    expect(afterDecline.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterDecline.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(false);
  });

  it("scope:'battle' CE は battle_end deferred 効果の optional target 選択と派生バースト確認の完了まで alive", () => {
    const attackerDef = makeTargetSelectionAttackerDef();
    const enemyDef = makeEnemySpiritDef();
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
      [enemyDef.cardNo, enemyDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];

    const attacker = createCardInstance(attackerDef, {
      instanceId: "dyf-atk-target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const enemy1 = createCardInstance(enemyDef, {
      instanceId: "dyf-enemy-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const enemy2 = createCardInstance(enemyDef, {
      instanceId: "dyf-enemy-2",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });

    const attackId = "attack:dyf-be-atk-target:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "dyf-be-atk-target",
      participantEntityIds: ["dyf-be-atk-target"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "dyf-be-atk-target", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["dyf-be-atk-target"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };

    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker, enemy1, enemy2],
    });
    const midBattle: GameState = {
      ...baseState,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "dyf-be-atk-target",
          memberInstanceIds: ["dyf-atk-target-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
    };

    const afterImmunity = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:1848",
      state: midBattle,
      effect: attackerDef.effects![0]!,
      sourceInstanceId: "dyf-atk-target-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      effectIndex: 0,
    });
    const queued = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:1857",
      state: afterImmunity,
      effect: attackerDef.effects![1]!,
      sourceInstanceId: "dyf-atk-target-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      effectIndex: 1,
    });

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
    });
    const optional = resolved.state.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: resolved.state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${optional.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: optional.actingPlayerId,
        pendingId: optional.pendingId,
        sourceInstanceId: optional.sourceInstanceId,
        effectIndex: optional.effectIndex,
        stepIndex: optional.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    const targetPending = afterExecute.pendingStepOptionalTargetSelection!;
    expect(targetPending.continuation.battleEndDeferralAttackId).toBe(attackId);
    expect(afterExecute.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      afterExecute.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "dyf-atk-target-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeDefined();

    let afterTarget = applyLegalAction({
      state: afterExecute,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${targetPending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: targetPending.actingPlayerId,
        pendingId: targetPending.pendingId,
        sourceInstanceId: targetPending.sourceInstanceId,
        sourceDefinitionId: targetPending.sourceDefinitionId,
        effectIndex: targetPending.effectIndex,
        stepIndex: targetPending.stepIndex,
        requiredTargetCount: targetPending.requiredTargetCount,
        maxTargetCount: targetPending.maxTargetCount,
        candidateTargetInstanceIds: targetPending.candidateInstanceIds,
      },
      targetInstanceIds: ["dyf-enemy-2"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(afterTarget.pendingStepOptionalTargetSelection).toBeNull();
    // 選択だけ消えて効果本体が不発になる回帰を防ぐ。
    expect(
      afterTarget.cardInstances.find((c) => c.instanceId === "dyf-enemy-2")
        ?.zone
    ).toBe("hand");
    // 実際のバウンスが生成した未セットのバースト確認も消化する。
    for (let i = 0; i < 10 && afterTarget.pendingBurstChecks.length > 0; i++) {
      const check = getLegalActions({
        state: afterTarget,
        actingPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }).find(
        (a) =>
          a.kind === "resolve_pending_burst_check" &&
          a.can &&
          !a.sourceInstanceId
      );
      expect(check).toBeDefined();
      afterTarget = applyLegalAction({
        state: afterTarget,
        action: check!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredBurstActions: () => [],
      }).state;
    }
    expect(afterTarget.pendingBurstChecks).toHaveLength(0);
    expect(afterTarget.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterTarget.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "dyf-atk-target-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeUndefined();
  });

  it("ただちにバトル終了は解決待ちバーストを保持して battle_end entry を待つ", () => {
    const burstDef: CardDefinition = {
      cardNo: "TEST-BURST-CANCEL",
      name: "テストバースト",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map<string, CardDefinition>([[burstDef.cardNo, burstDef]]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const burstCard = createCardInstance(burstDef, {
      instanceId: "burst-cancel-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
      cores: 0,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [burstCard],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      pendingImmediateBattleEnds: [
        {
          attackId: "attack:burst-cancel:1",
          participantInstanceIds: [],
          blockSideInstanceIds: [],
          participantSnapshots: [],
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "bc-immediate-end",
          actingPlayerId: "bob",
          eventKind: "leave_field",
          source: "action_resolution",
          chainId: "chain:leave-before-end",
          attackId: "attack:burst-cancel:1",
          relatedPlayerId: "bob",
          relatedInstanceId: "left-field-1",
          amount: 1,
          step: "attack",
          window: "flash_after_block",
          resolvedBurstCardInstanceIds: [],
        },
      ],
      setBurstStates: [],
      revealedBurstStates: [
        {
          playerId: "bob",
          cardInstanceId: "burst-cancel-1",
          checkId: "bc-immediate-end",
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "burst-window-immune-card:bc-immediate-end",
          sourceInstanceId: "burst-cancel-1",
          sourceDefinitionId: burstDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: "attack:burst-cancel:1",
          modifierTag: "defense_immune",
          targetInstanceId: "burst-cancel-1",
          metadata: { burstActivationWindow: "bc-immediate-end" },
        },
      ],
    };

    const after = processPendingImmediateBattleEnds({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(after.pendingImmediateBattleEnds).toHaveLength(1);
    expect(after.pendingImmediateBattleEnds[0]?.attackId).toBe(
      "attack:burst-cancel:1"
    );
    expect(after.pendingBurstChecks).toHaveLength(1);
    expect(after.pendingBurstChecks[0]?.checkId).toBe("bc-immediate-end");
    expect(after.revealedBurstStates).toContainEqual({
      playerId: "bob",
      cardInstanceId: "burst-cancel-1",
      checkId: "bc-immediate-end",
    });
    expect(after.setBurstStates).toHaveLength(0);
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.metadata?.burstActivationWindow === "bc-immediate-end"
      )
    ).toBe(true);
    expect(after.log).not.toContain(
      "burst:cancelled-by-immediate-battle-end:bc-immediate-end"
    );
  });

  it("immediate battle_end deferral の optional target 選択完了まで scope:'battle' CE は alive", () => {
    const attackerDef = makeTargetSelectionAttackerDef();
    const enemyDef = makeEnemySpiritDef();
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
      [enemyDef.cardNo, enemyDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];

    const attacker = createCardInstance(attackerDef, {
      instanceId: "dyf-immediate-atk-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const enemy1 = createCardInstance(enemyDef, {
      instanceId: "dyf-immediate-enemy-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const enemy2 = createCardInstance(enemyDef, {
      instanceId: "dyf-immediate-enemy-2",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack:dyf-immediate:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "dyf-immediate-atk",
      participantEntityIds: ["dyf-immediate-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "dyf-immediate-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["dyf-immediate-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker, enemy1, enemy2],
    });
    const midBattle: GameState = {
      ...baseState,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "dyf-immediate-atk",
          memberInstanceIds: ["dyf-immediate-atk-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
    };
    const afterImmunity = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:2145",
      state: midBattle,
      effect: attackerDef.effects![0]!,
      sourceInstanceId: "dyf-immediate-atk-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      effectIndex: 0,
    });
    const queued = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:2154",
      state: afterImmunity,
      effect: attackerDef.effects![1]!,
      sourceInstanceId: "dyf-immediate-atk-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      effectIndex: 1,
    });

    const afterImmediate = processPendingImmediateBattleEnds({
      state: {
        ...queued,
        activeAttack: null,
        battleEntities: [],
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: ["dyf-immediate-atk-1"],
            blockSideInstanceIds: [],
            participantSnapshots: [
              {
                entityId: "dyf-immediate-atk",
                memberInstanceIds: ["dyf-immediate-atk-1"],
                blockedBy: [],
              },
            ],
          },
        ],
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    });

    const optional = afterImmediate.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: afterImmediate,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${optional.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: optional.actingPlayerId,
        pendingId: optional.pendingId,
        sourceInstanceId: optional.sourceInstanceId,
        effectIndex: optional.effectIndex,
        stepIndex: optional.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(
      afterExecute.pendingStepOptionalTargetSelection?.continuation
        .battleEndDeferralAttackId
    ).toBe(attackId);
    expect(afterExecute.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      afterExecute.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "dyf-immediate-atk-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeDefined();
  });

  it("immediate battle_end deferral は pending 中に同一 battle の後続 deferral を即時発火しない", () => {
    const optionalDef = makeBattleEndOptionalCountSourceDef(
      "TEST-IMMEDIATE-SEQUENTIAL-OPTIONAL"
    );
    const mandatoryDef = makeBattleEndMandatoryCountSourceDef(
      "TEST-IMMEDIATE-SEQUENTIAL-MANDATORY"
    );
    const defs = new Map<string, CardDefinition>([
      [optionalDef.cardNo, optionalDef],
      [mandatoryDef.cardNo, mandatoryDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const noTriggerLookup = () => [];
    const optionalSource = createCardInstance(optionalDef, {
      instanceId: "immediate-seq-optional-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const mandatorySource = createCardInstance(mandatoryDef, {
      instanceId: "immediate-seq-mandatory-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack:dyf-immediate-sequential:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);

    const afterImmediate = processPendingImmediateBattleEnds({
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [optionalSource, mandatorySource],
        }),
        turnNumber: 2,
        activePlayerId: "alice",
        step: "attack",
        window: "battle_resolution",
        activeContinuousEffects: [battleEffect],
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: ["immediate-seq-optional-1"],
            blockSideInstanceIds: [],
            participantSnapshots: [
              {
                entityId: "immediate-seq-atk",
                memberInstanceIds: ["immediate-seq-optional-1"],
                blockedBy: [],
              },
            ],
          },
        ],
        pendingBattleEndDeferrals: [
          {
            deferralId: "def:immediate-seq-optional",
            attackId,
            actingPlayerId: "alice",
            sourceInstanceId: "immediate-seq-optional-1",
            sourceDefinitionId: optionalDef.cardNo,
            effectIndex: 0,
          },
          {
            deferralId: "def:immediate-seq-mandatory",
            attackId,
            actingPlayerId: "alice",
            sourceInstanceId: "immediate-seq-mandatory-1",
            sourceDefinitionId: mandatoryDef.cardNo,
            effectIndex: 0,
          },
        ],
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    });

    expect(afterImmediate.pendingStepOptionalChoice).not.toBeNull();
    expect(afterImmediate.log).toContain(
      `battle:end-deferral:fire:${attackId}:immediate-seq-optional-1:0`
    );
    expect(afterImmediate.log).not.toContain(
      `battle:end-deferral:fire:${attackId}:immediate-seq-mandatory-1:0`
    );
    expect(afterImmediate.pendingBattleEndDeferrals).toMatchObject([
      { deferralId: "def:immediate-seq-mandatory", attackId },
    ]);
    expect(afterImmediate.pendingImmediateBattleEnds).toMatchObject([
      { attackId, battleEndEntryStarted: true },
    ]);
    expect(afterImmediate.pendingBattleEndFinalizeAttackIds).toContain(
      attackId
    );
    expect(
      afterImmediate.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(true);
    expect(
      afterImmediate.players.find((player) => player.id === "alice")!.countValue
    ).toBe(0);

    const pending = afterImmediate.pendingStepOptionalChoice!;
    const afterDecline = applyLegalAction({
      state: afterImmediate,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(afterDecline.log).toContain(
      `battle:end-deferral:fire:${attackId}:immediate-seq-mandatory-1:0`
    );
    expect(afterDecline.pendingBattleEndDeferrals).toHaveLength(0);
    expect(afterDecline.pendingImmediateBattleEnds).toHaveLength(0);
    expect(
      afterDecline.players.find((player) => player.id === "alice")!.countValue
    ).toBe(7);
    expect(afterDecline.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterDecline.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(false);
  });

  it("battle_end finalize は pendingLifeCoreSelection 解決完了まで待ってから失効する", () => {
    const sourceDef = makeEnemySpiritDef();
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "life-core-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack:life-core-selection:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      players: base.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              lifeNormalCoreCount: 2,
              reserveNormalCoreCount: 0,
            }
          : player
      ),
      activeContinuousEffects: [battleEffect],
      pendingBattleEndFinalizeAttackIds: [attackId],
      pendingLifeCoreSelection: {
        pendingId: "lcs-battle-end",
        actingPlayerId: "alice",
        effectSourcePlayerId: "alice",
        sourceInstanceId: "life-core-source-1",
        sourceDefinitionId: sourceDef.cardNo,
        fromLocation: { kind: "life", player: "self" },
        toLocation: { kind: "reserve", player: "self" },
        normalAvailable: 2,
        soulAvailable: 0,
        totalAmount: 1,
        effectTiming: { kind: "activated", mode: "main" },
        battleEndDeferralAttackId: attackId,
      },
    };

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      state,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const action = getLegalActions({
      state: blocked,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(action).toBeDefined();

    const afterResolve = applyLegalAction({
      state: blocked,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      lifeCorePartitionChoice: { normalChosen: 1, soulChosen: 0 },
    }).state;

    expect(afterResolve.pendingLifeCoreSelection).toBeNull();
    const burstCheck = afterResolve.pendingBurstChecks[0]!;
    expect(burstCheck).toMatchObject({
      chainId: `${getBattleEndDeferralChainId(attackId)}:life-core-selection:lcs-battle-end`,
      eventKind: "reduce_life",
      relatedPlayerId: "alice",
    });
    expect(afterResolve.pendingBattleEndFinalizeAttackIds).toContain(attackId);

    const afterBurstDecline = applyLegalAction({
      state: afterResolve,
      action: {
        chainId: "test:battle-end-deferred-yield-finalize:2449",
        kind: "decline_pending_burst_check",
        actionId: `decline_pending_burst_check:${burstCheck.checkId}`,
        can: true,
        reason: "test",
        actingPlayerId: burstCheck.actingPlayerId,
        checkId: burstCheck.checkId,
        eventKind: burstCheck.eventKind,
        relatedPlayerId: burstCheck.relatedPlayerId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expectBattleEndWaitEffectCleared(
      afterBurstDecline,
      attackId,
      battleEffect.effectId
    );
  });

  it("battle_end finalize は pendingCoreCountSelection の後続 step 再開完了まで待つ", () => {
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-CORE-COUNT-RESUME",
      name: "テスト battle_end core count resume",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              id: "core-choice",
              action: {
                kind: "core_move",
                from: { kind: "reserve", player: "self" },
                to: { kind: "trash", player: "self" },
                amount: { min: 0, max: 2 },
              },
            },
            {
              connector: "conditional_result",
              action: {
                kind: "count_increase",
                player: "self",
                amount: {
                  source: {
                    kind: "step_numeric_amount",
                    stepId: "core-choice",
                  },
                },
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const getCardDefinitionById = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : undefined;
    const source = createCardInstance(sourceDef, {
      instanceId: "core-count-resume-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack:core-count-resume:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      playerOverrides: [
        { reserveNormalCoreCount: 3, trashNormalCoreCount: 0, countValue: 0 },
        {},
      ],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      activeContinuousEffects: [battleEffect],
      pendingBattleEndFinalizeAttackIds: [attackId],
    };

    const afterPending = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "core-count-resume-source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      chainId,
    });

    expect(afterPending.pendingCoreCountSelection).toMatchObject({
      battleEndDeferralAttackId: attackId,
      min: 0,
      max: 2,
    });
    expect(afterPending.pendingCoreCountSelection?.continuation).toMatchObject({
      battleEndDeferralAttackId: attackId,
      resumeStepIndex: 1,
      recordStepId: "core-choice",
    });
    expect(afterPending.players.find((p) => p.id === "alice")!.countValue).toBe(
      0
    );
    expect(afterPending.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(afterPending.activeContinuousEffects).toContainEqual(battleEffect);

    const action = getLegalActions({
      state: afterPending,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).find((candidate) => candidate.kind === "resolve_pending_core_count");
    expect(action).toBeDefined();

    const afterResolve = applyLegalAction({
      state: afterPending,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      coreCountSelection: 2,
    }).state;

    const alice = afterResolve.players.find((p) => p.id === "alice")!;
    expect(afterResolve.pendingCoreCountSelection).toBeNull();
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(2);
    expect(alice.countValue).toBe(2);
    expectBattleEndWaitEffectCleared(
      afterResolve,
      attackId,
      battleEffect.effectId
    );
  });

  it("immediate battle_end deferral は予約時 targetInstanceIds と targetStepId を再利用する", () => {
    const sourceDef = makeBattleEndTargetingSourceDef(
      "TEST-IMMEDIATE-TARGET-CARRY"
    );
    const enemyDef = makeEnemySpiritDef();
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [enemyDef.cardNo, enemyDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "immediate-carry-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const target1 = createCardInstance(enemyDef, {
      instanceId: "immediate-carry-target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const target2 = createCardInstance(enemyDef, {
      instanceId: "immediate-carry-target-2",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack:immediate-target-carry:1";
    const after = processPendingImmediateBattleEnds({
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, target1, target2],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "battle_resolution",
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: ["immediate-carry-source-1"],
            blockSideInstanceIds: [],
            participantSnapshots: [
              {
                entityId: "immediate-carry-entity",
                memberInstanceIds: ["immediate-carry-source-1"],
                blockedBy: [],
              },
            ],
          },
        ],
        pendingBattleEndDeferrals: [
          {
            deferralId: "def:immediate-target-carry",
            attackId,
            actingPlayerId: "alice",
            sourceInstanceId: "immediate-carry-source-1",
            sourceDefinitionId: sourceDef.cardNo,
            effectIndex: 0,
            targetInstanceIds: ["immediate-carry-target-2"],
            targetStepId: "destroy-target",
          },
        ],
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "immediate-carry-target-1"
      )?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "immediate-carry-target-2"
      )?.zone
    ).toBe("trash");
    expect(after.log).toContain(
      `pending-leave:destroy:immediate-carry-target-2:${getBattleEndDeferralChainId(attackId)}:effect_resolution`
    );
    expect(after.log).toContain(
      `pending-leave-flushed:destroy:immediate-carry-target-2:${getBattleEndDeferralChainId(attackId)}:effect_resolution`
    );
  });

  it("end_single_battle は解決待ちバーストと burstActivationWindow CE を保持する", () => {
    const attackerDef = makeAttackerDef();
    const burstDef: CardDefinition = {
      cardNo: "TEST-SINGLE-BATTLE-BURST",
      name: "テスト単一バトル終了バースト",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
      [burstDef.cardNo, burstDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attacker = createCardInstance(attackerDef, {
      instanceId: "single-end-atk-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstCard = createCardInstance(burstDef, {
      instanceId: "single-end-burst-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
      cores: 0,
    });
    const attackId = "attack:single-end:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "single-end-atk",
      participantEntityIds: ["single-end-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "single-end-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["single-end-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker, burstCard],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      battleEntities: [
        {
          entityId: "single-end-atk",
          memberInstanceIds: ["single-end-atk-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      pendingBurstChecks: [
        {
          checkId: "bc-single-end",
          actingPlayerId: "bob",
          eventKind: "leave_field",
          source: "action_resolution",
          chainId: "chain:single-end",
          attackId,
          relatedPlayerId: "bob",
          relatedInstanceId: "left-before-single-end",
          amount: 1,
          step: "attack",
          window: "flash_after_block",
          resolvedBurstCardInstanceIds: [],
        },
      ],
      setBurstStates: [],
      revealedBurstStates: [
        {
          playerId: "bob",
          cardInstanceId: "single-end-burst-1",
          checkId: "bc-single-end",
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "burst-window-immune-card:bc-single-end",
          sourceInstanceId: "single-end-burst-1",
          sourceDefinitionId: burstDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: attackId,
          modifierTag: "defense_immune",
          targetInstanceId: "single-end-burst-1",
          metadata: { burstActivationWindow: "bc-single-end" },
        },
      ],
    };

    const after = executeEndSingleBattle(
      state,
      "alice",
      false,
      getCardDefinitionById,
      () => []
    );

    expect(after.pendingBurstChecks).toHaveLength(1);
    expect(after.pendingBurstChecks[0]?.checkId).toBe("bc-single-end");
    expect(after.revealedBurstStates).toContainEqual({
      playerId: "bob",
      cardInstanceId: "single-end-burst-1",
      checkId: "bc-single-end",
    });
    expect(after.setBurstStates).toHaveLength(0);
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.metadata?.burstActivationWindow === "bc-single-end"
      )
    ).toBe(true);
    expect(after.log).not.toContain(
      "burst:cancelled-by-immediate-battle-end:bc-single-end"
    );
  });

  it("end_battle 非 deferred 経路も解決待ちバーストを保持して battle_end entry を遅延する", () => {
    const attackerDef = makeAttackerDef();
    const burstDef: CardDefinition = {
      cardNo: "TEST-END-BATTLE-BURST",
      name: "テスト通常即時バトル終了バースト",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
      [burstDef.cardNo, burstDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attacker = createCardInstance(attackerDef, {
      instanceId: "end-battle-atk-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstCard = createCardInstance(burstDef, {
      instanceId: "end-battle-burst-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
      cores: 0,
    });
    const attackId = "attack:end-battle:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "end-battle-atk",
      participantEntityIds: ["end-battle-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "end-battle-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["end-battle-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker, burstCard],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      battleEntities: [
        {
          entityId: "end-battle-atk",
          memberInstanceIds: ["end-battle-atk-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      pendingBurstChecks: [
        {
          checkId: "bc-end-battle",
          actingPlayerId: "bob",
          eventKind: "leave_field",
          source: "action_resolution",
          chainId: "chain:end-battle",
          attackId,
          relatedPlayerId: "bob",
          relatedInstanceId: "left-before-end-battle",
          amount: 1,
          step: "attack",
          window: "flash_after_block",
          resolvedBurstCardInstanceIds: [],
        },
      ],
      setBurstStates: [],
      revealedBurstStates: [
        {
          playerId: "bob",
          cardInstanceId: "end-battle-burst-1",
          checkId: "bc-end-battle",
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "burst-window-immune-card:bc-end-battle",
          sourceInstanceId: "end-battle-burst-1",
          sourceDefinitionId: burstDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: attackId,
          modifierTag: "defense_immune",
          targetInstanceId: "end-battle-burst-1",
          metadata: { burstActivationWindow: "bc-end-battle" },
        },
      ],
    };

    const after = executeEndBattle(
      state,
      "alice",
      false,
      getCardDefinitionById,
      () => [],
      undefined,
      false
    );

    expect(after.pendingImmediateBattleEnds).toHaveLength(1);
    expect(after.pendingImmediateBattleEnds[0]?.attackId).toBe(attackId);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
    expect(after.pendingBurstChecks).toHaveLength(1);
    expect(after.pendingBurstChecks[0]?.checkId).toBe("bc-end-battle");
    expect(after.revealedBurstStates).toContainEqual({
      playerId: "bob",
      cardInstanceId: "end-battle-burst-1",
      checkId: "bc-end-battle",
    });
    expect(after.setBurstStates).toHaveLength(0);
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.metadata?.burstActivationWindow === "bc-end-battle"
      )
    ).toBe(true);
    expect(after.log).not.toContain(
      "burst:cancelled-by-immediate-battle-end:bc-end-battle"
    );
  });

  it("native end_battle 経路は離場済み参加体を battle_end entry に引き継ぐ", () => {
    const attackerDef = makeAttackerDef();
    const blockerDef: CardDefinition = {
      ...makeAttackerDef(),
      cardNo: "TEST-NATIVE-END-BATTLE-LEFT-BLOCKER",
      name: "テスト native end_battle 離場ブロッカー",
    };
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
      [blockerDef.cardNo, blockerDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attacker = createCardInstance(attackerDef, {
      instanceId: "native-left-attacker",
      ownerPlayerId: "alice",
      zone: "trash",
      cores: 0,
    });
    const blocker = createCardInstance(blockerDef, {
      instanceId: "native-left-blocker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
      cores: 0,
    });
    const attackId = "attack:native-left-field-entry:1";
    const attackerEntityId = "battle-entity:native-left-attacker";
    const blockerEntityId = "battle-entity:native-left-blocker";
    const activeAttack: ActiveAttack = {
      attackId,
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
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker, blocker],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      activeAttack,
      battleEntities: [
        {
          entityId: attackerEntityId,
          memberInstanceIds: [],
          leftFieldMemberInstanceIds: ["native-left-attacker"],
          resolvedBp: 0,
          resolvedSymbols: [],
          attackState: "attacking",
        },
        {
          entityId: blockerEntityId,
          memberInstanceIds: [],
          leftFieldMemberInstanceIds: ["native-left-blocker"],
          resolvedBp: 0,
          resolvedSymbols: [],
          attackState: "blocking",
        },
      ],
    };

    const after = executeEndBattle(
      state,
      "alice",
      false,
      getCardDefinitionById,
      () => [],
      undefined,
      true
    );

    expect(after.activeAttack).toBeNull();
    expect(after.pendingImmediateBattleEnds).toHaveLength(1);
    expect(after.pendingImmediateBattleEnds[0]).toMatchObject({
      attackId,
      participantInstanceIds: ["native-left-attacker", "native-left-blocker"],
      blockSideInstanceIds: ["native-left-blocker"],
      participantSnapshots: [
        {
          entityId: attackerEntityId,
          memberInstanceIds: ["native-left-attacker"],
          blockedBy: [
            {
              entityId: blockerEntityId,
              memberInstanceIds: ["native-left-blocker"],
            },
          ],
        },
      ],
    });
  });

  it("native end_battle 経路は battle_end deferral 自壊の destroy trigger を待ってから battle scope CE を失効する", () => {
    const attackId = "attack:native-end-battle-source-destroy:1";
    const sourceDef: CardDefinition = {
      cardNo: "TEST-NATIVE-END-BATTLE-SOURCE",
      name: "テスト native end_battle 自壊元",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const enderDef: CardDefinition = {
      cardNo: "TEST-NATIVE-END-BATTLE-END",
      name: "テスト native end_battle 実行元",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "flash" },
          steps: [{ action: { kind: "end_battle" } }],
          textRef: [0],
        },
      ],
    };
    const listenerDef: CardDefinition = {
      cardNo: "TEST-NATIVE-END-BATTLE-LISTENER",
      name: "テスト native end_battle destroy listener",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "game_event", player: "self", event: "destroy" },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const grantLeaveFieldStayEffect: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "grant_effect",
            target: { kind: "self" },
            grantedEffect: {
              timing: { kind: "card_event", event: "leave_field" },
              executionMode: "optional",
              steps: [
                {
                  action: {
                    kind: "stay_on_field",
                    target: { kind: "self" },
                  },
                },
              ],
              textRef: [0],
            },
          },
        },
      ],
      textRef: [0],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [enderDef.cardNo, enderDef],
      [listenerDef.cardNo, listenerDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const getRegisteredTriggeredEffectActions = (cardNo: string) =>
      cardNo === listenerDef.cardNo
        ? [
            {
              sourceKind: "spirit" as const,
              eventKind: "destroy" as const,
              effectIndex: 0,
            },
          ]
        : [];
    const source = createCardInstance(sourceDef, {
      instanceId: "native-end-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const ender = createCardInstance(enderDef, {
      instanceId: "native-end-caster-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const listener = createCardInstance(listenerDef, {
      instanceId: "native-end-listener-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const withGranted = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:3204",
      state: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ender, listener],
      }),
      effect: grantLeaveFieldStayEffect,
      sourceInstanceId: "native-end-source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "native-end-source-entity",
      participantEntityIds: ["native-end-source-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "native-end-source-entity",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["native-end-source-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...withGranted,
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      activeAttack,
      battleEntities: [
        {
          entityId: "native-end-source-entity",
          memberInstanceIds: ["native-end-source-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:native-end-source-destroy",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "native-end-source-1",
          sourceDefinitionId: sourceDef.cardNo,
          effectIndex: 0,
        },
      ],
      activeContinuousEffects: [
        ...withGranted.activeContinuousEffects,
        battleEffect,
      ],
    };

    const executed = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:3265",
      state,
      effect: enderDef.effects![0]!,
      sourceInstanceId: "native-end-caster-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
    });
    expect(executed.pendingImmediateBattleEnds).toHaveLength(1);
    const after = finalizeEffectResolution({
      state: executed,
      beforeState: state,
      chainId: "audit-native-end",
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: "native-end-caster-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
    });

    const registeredDestroyPending = after.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "destroy" &&
        pending.relatedInstanceId === "native-end-source-1" &&
        Object.keys(
          pending.relatedInstanceIdsBySourceRegistrationKey ?? {}
        ).some((key) => key.startsWith("native-end-listener-1#"))
    );
    expect(registeredDestroyPending).toMatchObject({
      chainId: getBattleEndDeferralChainId(attackId),
      attackId,
      relatedInstanceId: "native-end-source-1",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: after,
      pendingEffect: registeredDestroyPending!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    });
    expect(
      choices.some(
        (choice) => choice.sourceCard.instanceId === "native-end-listener-1"
      )
    ).toBe(true);

    const grantedPending = after.pendingTriggeredEffects.find(
      (pending) =>
        pending.mechanic?.kind === "granted_effect" &&
        pending.mechanic.granteeInstanceId === "native-end-source-1"
    );
    expect(grantedPending).toMatchObject({
      chainId: getBattleEndDeferralChainId(attackId),
      relatedInstanceId: "native-end-source-1",
    });
    expect(after.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      after.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(true);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "native-end-source-1"
      )
    ).toMatchObject({
      zone: "field",
      pendingLeaveKind: "destroy",
      pendingLeaveChainId: getBattleEndDeferralChainId(attackId),
    });
  });

  it("native end_battle 経路は battle_end deferral の target carry と root chain を保持する", () => {
    const attackId = "attack:native-end-battle-target-carry:1";
    const sourceDef = makeBattleEndTargetingSourceDef(
      "TEST-NATIVE-END-BATTLE-TARGET-CARRY"
    );
    const enderDef: CardDefinition = {
      cardNo: "TEST-NATIVE-END-BATTLE-TARGET-CARRY-END",
      name: "テスト native end_battle target carry 実行元",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "flash" },
          steps: [{ action: { kind: "end_battle" } }],
          textRef: [0],
        },
      ],
    };
    const enemyDef = makeEnemySpiritDef();
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [enderDef.cardNo, enderDef],
      [enemyDef.cardNo, enemyDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "native-carry-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const ender = createCardInstance(enderDef, {
      instanceId: "native-carry-ender-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const target1 = createCardInstance(enemyDef, {
      instanceId: "native-carry-target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const target2 = createCardInstance(enemyDef, {
      instanceId: "native-carry-target-2",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "native-carry-entity",
      participantEntityIds: ["native-carry-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "native-carry-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["native-carry-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ender, target1, target2],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      activeAttack,
      battleEntities: [
        {
          entityId: "native-carry-entity",
          memberInstanceIds: ["native-carry-source-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:native-target-carry",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "native-carry-source-1",
          sourceDefinitionId: sourceDef.cardNo,
          effectIndex: 0,
          targetInstanceIds: ["native-carry-target-2"],
          targetStepId: "destroy-target",
        },
      ],
    };

    const executed = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:3442",
      state,
      effect: enderDef.effects![0]!,
      sourceInstanceId: "native-carry-ender-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
    });
    expect(executed.pendingImmediateBattleEnds).toHaveLength(1);
    const after = finalizeEffectResolution({
      state: executed,
      beforeState: state,
      chainId: "audit-native-end",
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: "native-carry-ender-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "native-carry-target-1"
      )?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "native-carry-target-2"
      )?.zone
    ).toBe("trash");
    expect(after.log).toContain(
      `pending-leave:destroy:native-carry-target-2:${getBattleEndDeferralChainId(attackId)}:effect_resolution`
    );
    expect(after.log).toContain(
      `pending-leave-flushed:destroy:native-carry-target-2:${getBattleEndDeferralChainId(attackId)}:effect_resolution`
    );
  });

  it("native end_battle 経路は combined brave effect source が離脱済みなら deferral を発火しない", () => {
    const attackId = "attack:native-end-battle-source-left:1";
    const effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef: CardDefinition = {
      cardNo: "TEST-NATIVE-END-BATTLE-SKIP-HOST",
      name: "テスト native end battle skip host",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const braveDef: CardDefinition = {
      ...hostDef,
      cardNo: "TEST-NATIVE-END-BATTLE-SKIP-BRAVE",
      name: "テスト native end battle skip brave",
      printedCategory: "brave",
      effects: [effect],
    };
    const enderDef: CardDefinition = {
      ...hostDef,
      cardNo: "TEST-NATIVE-END-BATTLE-SKIP-END",
      name: "テスト native end battle skip ender",
      effects: [
        {
          timing: { kind: "flash" },
          steps: [{ action: { kind: "end_battle" } }],
          textRef: [0],
        },
      ],
    };
    const defs = new Map<string, CardDefinition>([
      [hostDef.cardNo, hostDef],
      [braveDef.cardNo, braveDef],
      [enderDef.cardNo, enderDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const host = createCardInstance(hostDef, {
      instanceId: "native-end-skip-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "native-end-skip-brave",
      ownerPlayerId: "alice",
      zone: "trash",
      cores: 0,
    });
    const ender = createCardInstance(enderDef, {
      instanceId: "native-end-skip-ender",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "native-end-skip-entity",
      participantEntityIds: ["native-end-skip-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "native-end-skip-entity",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["native-end-skip-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, trashNormalCoreCount: 1 },
          {},
        ],
        cardInstances: [host, brave, ender],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      activeAttack,
      battleEntities: [
        {
          entityId: "native-end-skip-entity",
          memberInstanceIds: [host.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:native-end-skip",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: hostDef.cardNo,
          effectSourceInstanceId: brave.instanceId,
          effectSourceDefinitionId: braveDef.cardNo,
          sourceCardReferenceInstanceId: brave.instanceId,
          effectSourceOnFieldRequired: true,
          effectSourceAttachmentRequired: true,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
    };

    const executed = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:3614",
      state,
      effect: enderDef.effects![0]!,
      sourceInstanceId: ender.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
    });
    const after = finalizeEffectResolution({
      state: executed,
      beforeState: state,
      chainId: "audit-native-end",
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: ender.instanceId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const alice = after.players.find((player) => player.id === "alice")!;

    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(after.log).toContain(
      `battle:end-deferral:skip-source-left:${attackId}:${host.instanceId}:0`
    );
    expect(
      after.log.some((entry) =>
        entry.startsWith(
          `battle:end-deferral:fire:${attackId}:${host.instanceId}:0`
        )
      )
    ).toBe(false);
  });

  it("native end_battle 経路は sourceCardReferenceInstanceId と resumeEffectOverride を保持する", () => {
    const attackId = "attack:native-end-battle-source-card-ref:1";
    const effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { kind: "source_card" },
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef: CardDefinition = {
      cardNo: "TEST-NATIVE-END-BATTLE-REF-HOST",
      name: "テスト native end battle ref host",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const braveDef: CardDefinition = {
      ...hostDef,
      cardNo: "TEST-NATIVE-END-BATTLE-REF-BRAVE",
      name: "テスト native end battle ref brave",
      printedCategory: "brave",
      effects: [effect],
    };
    const enderDef: CardDefinition = {
      ...hostDef,
      cardNo: "TEST-NATIVE-END-BATTLE-REF-END",
      name: "テスト native end battle ref ender",
      effects: [
        {
          timing: { kind: "flash" },
          steps: [{ action: { kind: "end_battle" } }],
          textRef: [0],
        },
      ],
    };
    const defs = new Map<string, CardDefinition>([
      [hostDef.cardNo, hostDef],
      [braveDef.cardNo, braveDef],
      [enderDef.cardNo, enderDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const host = createCardInstance(hostDef, {
      instanceId: "native-end-ref-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedChildrenIds: ["native-end-ref-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "native-end-ref-brave",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedToInstanceId: host.instanceId,
    });
    const ender = createCardInstance(enderDef, {
      instanceId: "native-end-ref-ender",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "native-end-ref-entity",
      participantEntityIds: ["native-end-ref-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "native-end-ref-entity",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["native-end-ref-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const queued: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, ender],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      activeAttack,
      battleEntities: [
        {
          entityId: "native-end-ref-entity",
          memberInstanceIds: [host.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:native-end-ref",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: hostDef.cardNo,
          effectSourceInstanceId: brave.instanceId,
          effectSourceDefinitionId: braveDef.cardNo,
          sourceCardReferenceInstanceId: brave.instanceId,
          effectSourceOnFieldRequired: true,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
    };
    const separatedBeforeBattleEnd: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((card) =>
        card.instanceId === host.instanceId
          ? { ...card, attachedChildrenIds: [] }
          : card.instanceId === brave.instanceId
            ? { ...card, attachedToInstanceId: null }
            : card
      ),
    };

    const executed = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:3787",
      state: separatedBeforeBattleEnd,
      effect: enderDef.effects![0]!,
      sourceInstanceId: ender.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
    });
    const after = finalizeEffectResolution({
      state: executed,
      beforeState: separatedBeforeBattleEnd,
      chainId: "audit-native-end",
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: ender.instanceId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)
    ).toMatchObject({
      zone: "field",
      pendingLeaveKind: null,
    });
    expect(
      after.cardInstances.find((card) => card.instanceId === brave.instanceId)
    ).toMatchObject({
      zone: "trash",
      pendingLeaveKind: null,
      attachedToInstanceId: null,
    });
    expect(after.log).toContain(
      `battle:end-deferral:fire:${attackId}:${host.instanceId}:0`
    );
  });

  it("end_single_battle 経路は battle_end deferral 自壊の burst check を battle_end chain で積む", () => {
    const attackId = "attack:single-end-battle-source-destroy:1";
    const sourceDef: CardDefinition = {
      cardNo: "TEST-SINGLE-END-BATTLE-SOURCE",
      name: "テスト single end battle 自壊元",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const burstDef: CardDefinition = {
      cardNo: "TEST-SINGLE-END-BATTLE-BURST",
      name: "テスト single end battle burst",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [burstDef.cardNo, burstDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "single-end-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burst = createCardInstance(burstDef, {
      instanceId: "single-end-burst-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
      cores: 0,
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "single-end-source-entity",
      participantEntityIds: ["single-end-source-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "single-end-source-entity",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["single-end-source-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, burst],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      activeAttack,
      battleEntities: [
        {
          entityId: "single-end-source-entity",
          memberInstanceIds: ["single-end-source-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      setBurstStates: [
        { playerId: "bob", cardInstanceId: "single-end-burst-1" },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:single-end-source-destroy",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "single-end-source-1",
          sourceDefinitionId: sourceDef.cardNo,
          effectIndex: 0,
        },
      ],
      activeContinuousEffects: [battleEffect],
    };

    const after = executeEndSingleBattle(
      state,
      "alice",
      false,
      getCardDefinitionById,
      () => [],
      (cardNo) =>
        cardNo === burstDef.cardNo
          ? [
              {
                sourceKind: "spirit",
                eventKind: "leave_field",
                whose: "opponent",
              },
            ]
          : []
    );

    const burstCheck = after.pendingBurstChecks.find(
      (check) => check.relatedInstanceId === "single-end-source-1"
    );
    expect(burstCheck).toMatchObject({
      actingPlayerId: "bob",
      eventKind: "leave_field",
      chainId: getBattleEndDeferralChainId(attackId),
      relatedPlayerId: "alice",
    });
    expect(after.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      after.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(true);
  });

  it("battle_end finalize は pre-finalize flush が積んだ private declaration / burst check を待つ", () => {
    const attackId = "attack:pre-finalize-reaction:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const battleEffect: GameState["activeContinuousEffects"][number] = {
      effectId: "ce:pre-finalize:battle",
      sourceInstanceId: "source-1",
      sourceDefinitionId: "TEST-BATTLE-END-WAIT",
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: attackId,
      modifierTag: "effect_immunity",
      targetInstanceId: "source-1",
    };
    const state: GameState = {
      ...base,
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingPrivateDeclarations: [
        {
          declarationId: "decl:pre-finalize",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: "TEST-BATTLE-END-WAIT",
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "pending:pre-finalize",
          eventKind: "destroy",
          source: "action_resolution",
          chainId,
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source-1",
          amount: null,
          step: "attack",
          window: "battle_resolution",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:pre-finalize",
          actingPlayerId: "bob",
          eventKind: "leave_field",
          source: "action_resolution",
          chainId,
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source-1",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const blocked = maybeFinalizeBattleEndScopeExpirations(state);

    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const drained = maybeFinalizeBattleEndScopeExpirations({
      ...blocked,
      pendingPrivateDeclarations: [],
      pendingBurstChecks: [],
    });

    expect(drained.pendingBattleEndFinalizeAttackIds).not.toContain(attackId);
    expect(
      drained.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(false);
  });

  it("battle_end pre-finalize flush は child chain の pendingLeave 登録誘発も待つ", () => {
    const attackId = "attack:pre-finalize-child-chain:1";
    const rootChainId = getBattleEndDeferralChainId(attackId);
    const childChainId = `${rootChainId}:after_triggers:1`;
    const victimDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-CHILD-CHAIN-VICTIM",
      name: "テスト battle_end child chain victim",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "destroy" },
          steps: [
            {
              action: { kind: "draw", count: 1 },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const getCardDefinitionById = (id: string) =>
      id === victimDef.cardNo ? victimDef : undefined;
    const getRegisteredTriggeredEffectActions = (cardNo: string) =>
      cardNo === victimDef.cardNo
        ? [
            {
              sourceKind: "spirit" as const,
              eventKind: "destroy" as const,
              effectIndex: 0,
            },
          ]
        : [];
    const victim = createCardInstance(victimDef, {
      instanceId: "child-chain-victim-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          {
            ...victim,
            pendingLeaveKind: "destroy",
            pendingLeaveCause: "effect_resolution",
            pendingLeaveChainId: childChainId,
          },
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingLeaveEntities: [
        {
          instanceId: "child-chain-victim-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: childChainId,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const after = maybeFinalizeBattleEndScopeExpirations(
      state,
      getCardDefinitionById,
      {
        flushBeforeFinalize: (current, id) =>
          flushPendingLeavesAndQueueReactions({
            beforeFlushState: current,
            chainId: getBattleEndDeferralChainId(id),
            attackId: id,
            getCardDefinitionById,
            getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: () => [],
            queueRegisteredPreFlush: true,
          }),
      }
    );

    expect(
      after.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "destroy" &&
          pending.relatedInstanceId === "child-chain-victim-1" &&
          pending.chainId === childChainId
      )
    ).toBe(true);
    expect(after.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(after.activeContinuousEffects).toContainEqual(battleEffect);
  });

  it("battle_end pre-finalize flush は別 chain の pendingLeave を流さない", () => {
    const attackId = "attack:pre-finalize-scoped-flush:1";
    const rootChainId = getBattleEndDeferralChainId(attackId);
    const unrelatedChainId = "effect:unrelated-chain:1";
    const victimDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-SCOPED-FLUSH-VICTIM",
      name: "テスト battle_end scoped flush victim",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const getCardDefinitionById = (id: string) =>
      id === victimDef.cardNo ? victimDef : undefined;
    const scopedVictim = createCardInstance(victimDef, {
      instanceId: "scoped-flush-victim-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: rootChainId,
    });
    const unrelatedVictim = createCardInstance(victimDef, {
      instanceId: "unrelated-flush-victim-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: unrelatedChainId,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [scopedVictim, unrelatedVictim],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingLeaveEntities: [
        {
          instanceId: "scoped-flush-victim-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: rootChainId,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
        {
          instanceId: "unrelated-flush-victim-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: unrelatedChainId,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const after = maybeFinalizeBattleEndScopeExpirations(
      state,
      getCardDefinitionById,
      {
        flushBeforeFinalize: (current, id) =>
          flushPendingLeavesAndQueueReactions({
            beforeFlushState: current,
            chainId: getBattleEndDeferralChainId(id),
            attackId: id,
            getCardDefinitionById,
            getRegisteredTriggeredEffectActions: () => [],
            getRegisteredBurstActions: () => [],
            queueRegisteredPreFlush: true,
          }),
      }
    );

    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
    expect(
      after.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "scoped-flush-victim-1"
      )?.zone
    ).toBe("trash");
    const unrelatedAfter = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "unrelated-flush-victim-1"
    );
    expect(unrelatedAfter?.zone).toBe("field");
    expect(unrelatedAfter?.pendingLeaveKind).toBe("destroy");
    expect(after.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: "unrelated-flush-victim-1",
        chainId: unrelatedChainId,
      }),
    ]);
  });

  it("battle_end 子孫 trigger chain の flush は同じ attack の pendingLeave だけを流す", () => {
    const attackId = "attack:child-trigger-scoped-flush:1";
    const siblingAttackId = "attack:child-trigger-scoped-flush:2";
    const rootChainId = getBattleEndDeferralChainId(attackId);
    const childTriggerChainId = `trigger:pending:${rootChainId}:destroy:alice`;
    const siblingChainId = getBattleEndDeferralChainId(siblingAttackId);
    const victimDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-CHILD-SCOPED-FLUSH-VICTIM",
      name: "テスト battle_end child scoped flush victim",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const getCardDefinitionById = (id: string) =>
      id === victimDef.cardNo ? victimDef : undefined;
    const scopedVictim = createCardInstance(victimDef, {
      instanceId: "child-scoped-flush-victim-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: `${rootChainId}:target:0`,
    });
    const siblingVictim = createCardInstance(victimDef, {
      instanceId: "child-scoped-flush-sibling-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: siblingChainId,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [scopedVictim, siblingVictim],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingLeaveEntities: [
        {
          instanceId: "child-scoped-flush-victim-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: `${rootChainId}:target:0`,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
        {
          instanceId: "child-scoped-flush-sibling-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: siblingChainId,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const after = flushPendingLeavesAndQueueReactions({
      beforeFlushState: state,
      chainId: childTriggerChainId,
      attackId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      queueRegisteredPreFlush: true,
    });

    expect(
      after.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "child-scoped-flush-victim-1"
      )?.zone
    ).toBe("trash");
    const siblingAfter = after.cardInstances.find(
      (cardInstance) =>
        cardInstance.instanceId === "child-scoped-flush-sibling-1"
    );
    expect(siblingAfter?.zone).toBe("field");
    expect(siblingAfter?.pendingLeaveKind).toBe("destroy");
    expect(after.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: "child-scoped-flush-sibling-1",
        chainId: siblingChainId,
      }),
    ]);
  });

  it("battle_end deferral の count_decrease pending は解決完了まで battle scope CE を保持する", () => {
    const attackId = "attack:count-selection:1";
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-COUNT-SELECTION-SOURCE",
      name: "テスト battle_end count selection source",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              id: "count-down",
              action: {
                kind: "count_decrease",
                player: "self",
                amount: { min: 0 },
              },
            },
            {
              connector: "conditional_result",
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const getCardDefinitionById = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : undefined;
    const source = createCardInstance(sourceDef, {
      instanceId: "battle-end-count-selection-source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
    };

    const generated = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:4440",
      state,
      effect: sourceDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "battle-end-count-selection-source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      battleEndDeferralAttackId: attackId,
    });

    expect(generated.pendingCountSelection).toMatchObject({
      battleEndDeferralAttackId: attackId,
    });
    expect(
      generated.pendingCountSelection?.continuation?.battleEndDeferralAttackId
    ).toBe(attackId);

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      generated,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const action = getLegalActions({
      state: blocked,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((candidate) => candidate.kind === "resolve_pending_count_decrease");
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: blocked,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      countDecreaseSelection: 2,
    }).state;

    expect(resolved.pendingCountSelection).toBeNull();
    expectBattleEndWaitEffectCleared(resolved, attackId, battleEffect.effectId);
  });

  it("battle_end finalize は after_triggers continuation 完了まで battle scope CE を保持する", () => {
    const attackId = "attack:after-triggers-continuation:1";
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-AFTER-TRIGGERS-SOURCE",
      name: "テスト battle_end after_triggers 元",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
            {
              connector: "after_triggers",
              action: { kind: "draw", count: 1 },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const victimDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-AFTER-TRIGGERS-VICTIM",
      name: "テスト battle_end after_triggers 被破壊",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "leave_field" },
          steps: [
            {
              action: {
                kind: "stay_on_field",
                target: { kind: "self" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [victimDef.cardNo, victimDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const getRegisteredTriggeredEffectActions = (cardNo: string) =>
      cardNo === victimDef.cardNo
        ? [
            {
              sourceKind: "spirit" as const,
              eventKind: "leave_field" as const,
              effectIndex: 0,
            },
          ]
        : [];
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "after-triggers-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const victim = createCardInstance(victimDef, {
      instanceId: "after-triggers-victim-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, victim],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
    };

    const afterDeferred = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "after-triggers-source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      chainId: getBattleEndDeferralChainId(attackId),
    });

    expect(afterDeferred.pendingAfterTriggersContinuations).toHaveLength(1);
    expect(
      afterDeferred.pendingAfterTriggersContinuations[0]
        ?.battleEndDeferralAttackId
    ).toBe(attackId);
    expect(
      afterDeferred.pendingAfterTriggersContinuations[0]?.waitChainId
    ).toBe(`${getBattleEndDeferralChainId(attackId)}:after_triggers:1`);
    expect(
      afterDeferred.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "destroy" &&
          pending.relatedInstanceId === "after-triggers-victim-1"
      )
    ).toBe(true);

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      afterDeferred,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      blocked.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(true);

    let current = blocked;
    for (let guard = 0; guard < 8; guard++) {
      if (
        current.pendingTriggeredEffects.length === 0 &&
        current.pendingAfterTriggersContinuations.length === 0 &&
        current.stackWindow === null
      ) {
        break;
      }
      let action: LegalAction | undefined;
      for (const actingPlayerId of ["bob", "alice"]) {
        const actions = getLegalActions({
          state: current,
          actingPlayerId,
          ...lookups,
        });
        action =
          actions.find(
            (candidate) => candidate.kind === "resolve_pending_triggered_effect"
          ) ??
          actions.find(
            (candidate) => candidate.kind === "select_pending_to_resolve"
          ) ??
          actions.find((candidate) => candidate.kind === "pass_stack");
        if (action) break;
      }
      expect(action).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: action!,
        ...lookups,
      }).state;
    }

    expect(current.pendingAfterTriggersContinuations).toHaveLength(0);
    expectBattleEndWaitEffectCleared(current, attackId, battleEffect.effectId);
    expect(
      current.log.some((entry) =>
        entry.startsWith("effect:after_triggers:resume:")
      )
    ).toBe(true);
  });

  it("battle_end finalize は targeted disclosure continuation 完了まで battle scope CE を保持する", () => {
    const attackId = "attack:targeted-disclosure-continuation:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const sourceDef = makeBattleEndTargetingSourceDef(
      "TEST-BATTLE-END-TARGETED-DISCLOSURE-SOURCE"
    );
    const targetDef = makeTargetedResponderDef();
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [targetDef.cardNo, targetDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const getRegisteredTriggeredEffectActions = (cardNo: string) =>
      cardNo === targetDef.cardNo
        ? [
            {
              sourceKind: "spirit" as const,
              eventKind: "targeted" as const,
              effectIndex: 0,
            },
          ]
        : [];
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "targeted-disclosure-source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "targeted-disclosure-target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
    };

    const afterDisclosure = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "targeted-disclosure-source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      chainId,
    });

    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        sourceInstanceId: "targeted-disclosure-source-1",
        chainId,
        targetInstanceIds: ["targeted-disclosure-target-1"],
        battleEndDeferralAttackId: attackId,
      }
    );
    expect(afterDisclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedInstanceId: "targeted-disclosure-target-1",
      chainId: `${chainId}:step:0:activation:0:target:0`,
    });

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      afterDisclosure,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const resolveAction = getLegalActions({
      state: blocked,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "targeted-disclosure-target-1"
    );
    expect(resolveAction).toBeDefined();

    let afterResolve = applyLegalAction({
      state: blocked,
      action: resolveAction!,
      ...lookups,
    }).state;

    for (let guard = 0; guard < 8; guard++) {
      if (
        afterResolve.pendingTargetedDisclosureContinuation === null &&
        afterResolve.pendingTriggeredEffects.length === 0 &&
        afterResolve.stackWindow === null
      ) {
        break;
      }
      let action: LegalAction | undefined;
      for (const actingPlayerId of ["bob", "alice"]) {
        const actions = getLegalActions({
          state: afterResolve,
          actingPlayerId,
          ...lookups,
        });
        action =
          actions.find(
            (candidate) => candidate.kind === "resolve_pending_triggered_effect"
          ) ??
          actions.find(
            (candidate) => candidate.kind === "select_pending_to_resolve"
          ) ??
          actions.find((candidate) => candidate.kind === "pass_stack");
        if (action) break;
      }
      expect(action).toBeDefined();
      afterResolve = applyLegalAction({
        state: afterResolve,
        action: action!,
        ...lookups,
      }).state;
    }

    expect(afterResolve.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterResolve.pendingTriggeredEffects).toHaveLength(0);
    expectBattleEndWaitEffectCleared(
      afterResolve,
      attackId,
      battleEffect.effectId
    );
  });

  it("battle_end finalize は deferred triggered stack 由来の targeted disclosure continuation でも battle scope CE を保持する", () => {
    const attackId = "attack:targeted-disclosure-deferred-stack:1";
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const triggeredPendingSnapshot: NonNullable<
      ActiveStack["triggeredPendingSnapshot"]
    > = {
      pendingId: "pending:targeted-disclosure-deferred-stack",
      actingPlayerId: "alice",
      eventKind: "battle_end",
      source: "action_resolution",
      chainId: "trigger:targeted-disclosure-deferred-stack",
      attackId,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: base.step,
      window: base.window,
      resolvedSourceInstanceIds: [],
    };
    const deferredStack: ActiveStack = {
      stackId: "stack:targeted-disclosure-deferred-stack",
      actionKind: "triggered_effect",
      chainId: "trigger:targeted-disclosure-deferred-stack",
      actingPlayerId: "alice",
      cardInstanceId: "deferred-stack-source",
      cardDefinitionId: "TEST-DEFERRED-STACK-SOURCE",
      targetInstanceIds: ["deferred-stack-target"],
      targetEffectFilterTags: [],
      triggeredPendingSnapshot,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const state: GameState = {
      ...base,
      pendingBattleEndFinalizeAttackIds: [attackId],
      pendingTargetedDisclosureContinuation: {
        chainId: "test:battle-end-deferred-yield-finalize:4869",
        pendingId: "targeted-disclosure:deferred-stack",
        sourceDefinitionId: "TEST-DEFERRED-STACK-SOURCE",
        effectIndex: 0,
        sourceInstanceId: "deferred-stack-source",
        effectActionKind: "triggered_effect",
        actingPlayerId: "alice",
        resumeStepIndex: 0,
        stepContext: { results: {} },
        targetInstanceIds: ["deferred-stack-target"],
        targetStepId: "__active_stack_target__",
        remainingStacks: [],
        deferredStackResolution: { deferredStack },
      },
    };

    expect(hasPendingBattleEndFinalizeBlockers(state, attackId)).toBe(true);
    expect(
      maybeFinalizeBattleEndScopeExpirations(state, () => undefined)
        .pendingBattleEndFinalizeAttackIds
    ).toContain(attackId);
  });

  it("battle_end finalize は effect target selection pending 完了まで待つ", () => {
    const attackId = "attack:effect-target-selection:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const chainId = getBattleEndDeferralChainId(attackId);
    const deferredStack: ActiveStack = {
      stackId: "stack:effect-target-selection",
      actionKind: "triggered_effect",
      chainId,
      actingPlayerId: "alice",
      cardInstanceId: "effect-target-selection-source",
      cardDefinitionId: "TEST-EFFECT-TARGET-SELECTION-SOURCE",
      targetInstanceIds: [],
      targetEffectFilterTags: [],
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingEffectTargetSelection: {
        pendingId: "effect-target-selection:deferred-stack",
        actingPlayerId: "alice",
        sourceInstanceId: "effect-target-selection-source",
        sourceDefinitionId: "TEST-EFFECT-TARGET-SELECTION-SOURCE",
        deferredStack,
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["effect-target-selection-target"],
        targetEffectFilterTags: [],
        battleEndDeferralAttackId: attackId,
      },
    };

    expect(hasPendingBattleEndFinalizeBlockers(state, attackId)).toBe(true);
    const blocked = maybeFinalizeBattleEndScopeExpirations(
      state,
      () => undefined
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);
  });

  it("battle_end finalize は effect summon brave combine choice 完了まで待つ", () => {
    const attackId = "attack:effect-summon-brave-combine:1";
    const summonBraveEffect: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "summon-brave",
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "hand",
              filter: { category: ["brave"] },
              count: 1,
            },
            costModifier: "free",
          },
        },
        {
          action: { kind: "count_increase", player: "self", amount: 7 },
          connector: "sequential",
        },
      ],
      textRef: [0],
    };
    const sourceDef: CardDefinition = {
      ...makeEnemySpiritDef(),
      cardNo: "TEST-EFFECT-SUMMON-BRAVE-SOURCE",
      name: "テスト effect summon brave 元",
      colors: ["red"],
      symbolColors: ["red"],
      effects: [summonBraveEffect],
    };
    const hostDef: CardDefinition = {
      ...makeEnemySpiritDef(),
      cardNo: "TEST-EFFECT-SUMMON-BRAVE-HOST",
      name: "テスト合体先",
    };
    const braveDef: CardDefinition = {
      cardNo: "TEST-EFFECT-SUMMON-BRAVE",
      name: "テスト効果召喚ブレイヴ",
      printedCategory: "brave",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      combinedBoost: 1000,
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [hostDef.cardNo, hostDef],
      [braveDef.cardNo, braveDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "effect-summon-brave-source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(hostDef, {
      instanceId: "effect-summon-brave-host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "effect-summon-brave-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0, reserveNormalCoreCount: 2 }, {}],
        cardInstances: [source, host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
    };

    const generated = executeEffect({
      state,
      effect: summonBraveEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      chainId: getBattleEndDeferralChainId(attackId),
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
    });

    expect(generated.pendingBraveCombineChoice).toMatchObject({
      braveInstanceId: brave.instanceId,
      battleEndDeferralAttackId: attackId,
      effectSummon: {
        continuation: { battleEndDeferralAttackId: attackId },
      },
    });
    const blocked = maybeFinalizeBattleEndScopeExpirations(
      generated,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);
    expect(
      blocked.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);

    const action = getLegalActions({
      state: blocked,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_brave_combine_choice" &&
        candidate.chosenHostInstanceId === host.instanceId
    );
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state: blocked,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(after.pendingBraveCombineChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === brave.instanceId)
        ?.attachedToInstanceId
    ).toBe(host.instanceId);
    expect(
      after.players.find((player) => player.id === "alice")?.countValue
    ).toBe(7);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("battle_end finalize は deck reveal count boost choice 完了まで待つ", () => {
    const attackId = "attack:deck-reveal-count-boost:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-DECK-COUNT-BOOST-SOURCE",
      name: "テスト battle_end deck count boost source",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "discard",
                count: 1,
                fromZone: "deck",
              },
            },
            {
              action: {
                kind: "count_increase",
                player: "self",
                amount: 7,
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "deck-count-boost-source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCards = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(sourceDef, {
        instanceId: `deck-count-boost-deck-${index}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const boostEffect: GameState["activeContinuousEffects"][number] = {
      effectId: "ce:deck-reveal-count-boost",
      sourceInstanceId: "deck-count-boost-source-1",
      sourceDefinitionId: sourceDef.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "grant_optional_deck_reveal_count_boost",
      targetInstanceId: "alice",
      metadata: {
        bonusAmount: 1,
        sourceFilter: { category: ["spirit"] },
      },
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0 }, {}],
        cardInstances: [source, ...deckCards],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect, boostEffect],
    };

    const generated = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      chainId,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
    });

    expect(generated.pendingDeckRevealCountBoostChoice).toMatchObject({
      sourceInstanceId: source.instanceId,
      battleEndDeferralAttackId: attackId,
      continuation: { battleEndDeferralAttackId: attackId },
    });
    const blocked = maybeFinalizeBattleEndScopeExpirations(
      generated,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);
    expect(
      blocked.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);

    const pending = blocked.pendingDeckRevealCountBoostChoice!;
    const after = applyLegalAction({
      state: blocked,
      action: {
        kind: "resolve_pending_deck_reveal_count_boost_choice",
        actionId: `drcb-${pending.pendingId}:apply`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "apply",
        bonusAmount: pending.bonusAmount,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(after.pendingDeckRevealCountBoostChoice).toBeNull();
    expect(
      after.cardInstances.filter(
        (card) =>
          card.zone === "trash" &&
          card.instanceId.startsWith("deck-count-boost-deck-")
      )
    ).toHaveLength(2);
    expect(
      after.players.find((player) => player.id === "alice")?.countValue
    ).toBe(7);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("battle_end 中の deck reveal count boost continuation は accel 等の一時 Effect を保持する", () => {
    const attackId = "attack:deck-reveal-count-boost-accel:1";
    const sourceAccelEffect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          deferTo: "battle_end",
          action: {
            kind: "discard",
            count: 1,
            fromZone: "deck",
          },
        },
        {
          action: {
            kind: "count_increase",
            player: "self",
            amount: 7,
          },
        },
      ],
      textRef: [1],
    } satisfies NonNullable<
      NonNullable<CardDefinition["accelData"]>["effects"]
    >[number];
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-DECK-COUNT-BOOST-ACCEL-SOURCE",
      name: "テスト battle_end deck count boost accel source",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["accel"],
      sourceUrls: [],
      sourceConfidence: "C",
      // effects[0] は accelData.effects[0] と別物。resumeEffectOverride を落とすと
      // continuation 解決後にこちらへ戻るため、count が 99 になって検出できる。
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "count_increase",
                player: "self",
                amount: 99,
              },
            },
          ],
          textRef: [0],
        },
      ],
      accelData: {
        timing: "flash",
        cost: 1,
        reduction: [],
        effects: [sourceAccelEffect],
      },
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "deck-count-boost-accel-source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCards = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(sourceDef, {
        instanceId: `deck-count-boost-accel-deck-${index}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "deck-count-boost-accel-be",
      participantEntityIds: ["deck-count-boost-accel-be"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "deck-count-boost-accel-be",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["deck-count-boost-accel-be"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const boostEffect: GameState["activeContinuousEffects"][number] = {
      effectId: "ce:deck-reveal-count-boost-accel",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: sourceDef.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "grant_optional_deck_reveal_count_boost",
      targetInstanceId: "alice",
      metadata: {
        bonusAmount: 1,
        sourceFilter: { category: ["spirit"] },
      },
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0 }, {}],
        cardInstances: [source, ...deckCards],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      activeAttack,
      battleEntities: [
        {
          entityId: "deck-count-boost-accel-be",
          memberInstanceIds: [source.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeContinuousEffects: [battleEffect, boostEffect],
    };

    const queued = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:5376",
      state,
      effect: sourceAccelEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
    });
    expect(queued.pendingBattleEndDeferrals[0]).toMatchObject({
      resumeEffectOverride: sourceAccelEffect,
    });

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    expect(
      resolved.state.pendingDeckRevealCountBoostChoice?.continuation
        .resumeEffectOverride
    ).toBe(sourceAccelEffect);
    expect(resolved.state.pendingBattleEndFinalizeAttackIds).toContain(
      attackId
    );

    const pending = resolved.state.pendingDeckRevealCountBoostChoice!;
    const after = applyLegalAction({
      state: resolved.state,
      action: {
        kind: "resolve_pending_deck_reveal_count_boost_choice",
        actionId: `drcb-${pending.pendingId}:apply`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "apply",
        bonusAmount: pending.bonusAmount,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(after.pendingDeckRevealCountBoostChoice).toBeNull();
    expect(
      after.cardInstances.filter(
        (card) =>
          card.zone === "trash" &&
          card.instanceId.startsWith("deck-count-boost-accel-deck-")
      )
    ).toHaveLength(2);
    expect(
      after.players.find((player) => player.id === "alice")?.countValue
    ).toBe(7);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("battle_end finalize は pendingMultiPlacement の配置完了まで待つ", () => {
    const attackId = "attack:multi-placement-battle-end:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-MULTI-PLACEMENT-SOURCE",
      name: "テスト battle_end multi placement source",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              id: "summon-two",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit"] },
                  count: 2,
                },
                costModifier: "free",
              },
            },
            {
              id: "count-after-placement",
              action: { kind: "count_increase", player: "self", amount: 7 },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const summonedDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-MULTI-PLACEMENT-SUMMONED",
      name: "テスト battle_end multi placement summoned",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 0,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const remainingDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-MULTI-PLACEMENT-REMAINING",
      name: "テスト battle_end multi placement remaining",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 3 },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [summonedDef.cardNo, summonedDef],
      [remainingDef.cardNo, remainingDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const summonedA = createCardInstance(summonedDef, {
      instanceId: "summoned-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const summonedB = createCardInstance(summonedDef, {
      instanceId: "summoned-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const remainingSource = createCardInstance(remainingDef, {
      instanceId: "remaining-source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, summonedA, summonedB, remainingSource],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      activeContinuousEffects: [battleEffect],
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 2, countValue: 0 }
          : player
      ),
    };

    const generated = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      chainId,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      summonPaymentSources: [{ kind: "reserve", amount: 0 }],
    });

    expect(
      generated.pendingMultiPlacement?.priorStateSnapshot
        ?.pendingBattleEndFinalizeAttackIds
    ).not.toContain(attackId);
    expect(generated.pendingMultiPlacement).toMatchObject({
      battleEndDeferralAttackId: attackId,
      continuation: { battleEndDeferralAttackId: attackId },
    });
    expect(generated.pendingMultiPlacement?.continuation?.resumeStepIndex).toBe(
      1
    );
    expect(hasPendingBattleEndFinalizeBlockers(generated, attackId)).toBe(true);
    const deferred: GameState = {
      ...generated,
      pendingBattleEndFinalizeAttackIds: [attackId],
      log: [...generated.log, `battle:end-scope-finalize:deferred:${attackId}`],
    };
    const blocked = maybeFinalizeBattleEndScopeExpirations(
      deferred,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);
    expect(
      blocked.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);

    const action = getLegalActions({
      state: blocked,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();
    const abortAction = getLegalActions({
      state: blocked,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((candidate) => candidate.kind === "abort_pending_multi_placement");
    expect(abortAction).toBeDefined();

    const blockedWithRemaining: GameState = {
      ...blocked,
      pendingBattleEndDeferrals: [
        {
          deferralId: "def:multi-placement-remaining",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: remainingSource.instanceId,
          sourceDefinitionId: remainingDef.cardNo,
          effectIndex: 0,
        },
      ],
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: [source.instanceId],
          blockSideInstanceIds: [],
          participantSnapshots: [
            {
              entityId: "entity-source",
              memberInstanceIds: [source.instanceId],
              resolvedBp: 1000,
              resolvedSymbols: ["red"],
              blockedBy: [],
            },
          ],
          battleEndEntryStarted: true,
        },
      ],
    };

    const afterAbort = applyLegalAction({
      state: blockedWithRemaining,
      action: abortAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(afterAbort.pendingMultiPlacement).toBeNull();
    expect(
      afterAbort.players.find((player) => player.id === "alice")?.countValue
    ).toBe(3);
    expect(
      afterAbort.cardInstances.find((card) => card.instanceId === "summoned-a")
        ?.zone
    ).toBe("trash");
    expect(
      afterAbort.cardInstances.find((card) => card.instanceId === "summoned-b")
        ?.zone
    ).toBe("trash");
    expect(afterAbort.pendingBattleEndDeferrals).toHaveLength(0);
    expect(afterAbort.pendingImmediateBattleEnds).toHaveLength(0);
    expect(afterAbort.log).toContain(
      `battle:end-deferral:fire:${attackId}:remaining-source-1:0`
    );
    expect(afterAbort.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      afterAbort.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(false);

    const after = applyLegalAction({
      state: blocked,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: "summoned-a",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "summoned-b",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;

    expect(after.pendingMultiPlacement).toBeNull();
    expect(
      after.players.find((player) => player.id === "alice")?.countValue
    ).toBe(7);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it.each(["abort", "rollback"] as const)(
    "battle_end finalize は pendingCoreDistribution %s 後も後続 deferral queue を保持する",
    (mode) => {
      const attackId = `attack:core-distribution-${mode}:1`;
      const sourceDef: CardDefinition = {
        cardNo: `TEST-BATTLE-END-CORE-DISTRIBUTION-${mode.toUpperCase()}-SOURCE`,
        name: "テスト battle_end core distribution source",
        printedCategory: "spirit",
        colors: ["red"],
        cost: 1,
        reductionSymbols: ["red"],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
        symbolColors: ["red"],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
        effects: [],
      };
      const targetDef: CardDefinition = {
        ...sourceDef,
        cardNo: `TEST-BATTLE-END-CORE-DISTRIBUTION-${mode.toUpperCase()}-TARGET`,
        name: "テスト battle_end core distribution target",
      };
      const remainingDef: CardDefinition = {
        ...sourceDef,
        cardNo: `TEST-BATTLE-END-CORE-DISTRIBUTION-${mode.toUpperCase()}-REMAINING`,
        name: "テスト battle_end core distribution remaining",
        effects: [
          {
            timing: { kind: "card_event", event: "attack" },
            steps: [
              {
                action: {
                  kind: "count_increase",
                  player: "self",
                  amount: 3,
                },
              },
            ],
            textRef: [0],
          },
        ],
      };
      const defs = new Map<string, CardDefinition>([
        [sourceDef.cardNo, sourceDef],
        [targetDef.cardNo, targetDef],
        [remainingDef.cardNo, remainingDef],
      ]);
      const getCardDefinitionById = (id: string) => defs.get(id);
      const source = createCardInstance(sourceDef, {
        instanceId: "source-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const target = createCardInstance(targetDef, {
        instanceId: "core-distribution-target-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const remainingSource = createCardInstance(remainingDef, {
        instanceId: "remaining-core-distribution-source-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const battleEffect = makeBattleEndWaitEffect(attackId);
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target, remainingSource],
        playerOverrides: [{ reserveNormalCoreCount: 1, countValue: 0 }, {}],
      });
      const priorStateSnapshot: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        window: "battle_resolution",
        activeContinuousEffects: [battleEffect],
      };
      const pendingState: GameState = {
        ...priorStateSnapshot,
        pendingBattleEndFinalizeAttackIds: [attackId],
        pendingBattleEndDeferrals: [
          {
            deferralId: `def:core-distribution-${mode}:remaining`,
            attackId,
            actingPlayerId: "alice",
            sourceInstanceId: remainingSource.instanceId,
            sourceDefinitionId: remainingDef.cardNo,
            effectIndex: 0,
          },
        ],
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: [source.instanceId],
            blockSideInstanceIds: [],
            participantSnapshots: [
              {
                entityId: "entity-source",
                memberInstanceIds: [source.instanceId],
                resolvedBp: 1000,
                resolvedSymbols: ["red"],
                blockedBy: [],
              },
            ],
            battleEndEntryStarted: true,
          },
        ],
        pendingCoreDistribution: {
          pendingId: `cd-${mode}`,
          actingPlayerId: "alice",
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: sourceDef.cardNo,
          candidates: [
            {
              instanceId: target.instanceId,
              definitionId: targetDef.cardNo,
            },
          ],
          totalNormalCores: 1,
          hasSoulCore: false,
          fromKind: "reserve",
          minTotal: 0,
          rollbackIfBelowMinTotal: {
            minTotal: 1,
            reason: "rebirth_minimum_core",
          },
          fromPlayerId: "alice",
          toPlayerId: "alice",
          effectTiming: { kind: "activated", mode: "main" },
          battleEndDeferralAttackId: attackId,
          priorStateSnapshot,
        },
      };
      expect(
        pendingState.pendingCoreDistribution.priorStateSnapshot
          ?.pendingBattleEndDeferrals
      ).toHaveLength(0);
      expect(hasPendingBattleEndFinalizeBlockers(pendingState, attackId)).toBe(
        true
      );

      const action = getLegalActions({
        state: pendingState,
        actingPlayerId: "alice",
        getCardDefinitionById,
      }).find((candidate) =>
        mode === "abort"
          ? candidate.kind === "abort_pending_core_distribution"
          : candidate.kind === "resolve_pending_core_distribution"
      );
      expect(action).toBeDefined();

      const after = applyLegalAction({
        state: pendingState,
        action: action!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
        ...(mode === "rollback" ? { coreDistributionAllocations: {} } : {}),
      }).state;

      expect(after.pendingCoreDistribution).toBeNull();
      expect(after.pendingBattleEndDeferrals).toHaveLength(0);
      expect(after.pendingImmediateBattleEnds).toHaveLength(0);
      expect(after.pendingBattleEndFinalizeAttackIds).not.toContain(attackId);
      expect(after.log).toContain(
        `battle:end-deferral:fire:${attackId}:remaining-core-distribution-source-1:0`
      );
      expect(
        after.players.find((player) => player.id === "alice")?.countValue
      ).toBe(3);
      expect(
        after.cardInstances.find(
          (card) => card.instanceId === target.instanceId
        )?.normalCoreCount
      ).toBe(0);
      expect(
        after.activeContinuousEffects.some(
          (effect) => effect.effectId === battleEffect.effectId
        )
      ).toBe(false);
    }
  );

  it("battle_end finalize は target redirect continuation 完了まで battle scope CE を保持する", () => {
    const attackId = "attack:target-redirect-continuation:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const sourceDef = makeBattleEndTargetingSourceDef(
      "TEST-BATTLE-END-REDIRECT-SOURCE"
    );
    const targetDef = makeEnemySpiritDef();
    const replacementDef: CardDefinition = {
      ...makeEnemySpiritDef(),
      cardNo: "TEST-DYF-REDIRECT-REPLACEMENT",
      name: "テスト redirect 置換先",
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [targetDef.cardNo, targetDef],
      [replacementDef.cardNo, replacementDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "target-redirect-source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const protectedTarget = createCardInstance(targetDef, {
      instanceId: "target-redirect-protected-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const replacement = createCardInstance(replacementDef, {
      instanceId: "target-redirect-replacement-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const redirectEffect: GameState["activeContinuousEffects"][number] = {
      effectId: "ce:target-redirect",
      sourceInstanceId: "target-redirect-protected-1",
      sourceDefinitionId: targetDef.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      targetInstanceId: "target-redirect-protected-1",
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "opponent",
          protectedTargetKind: "instances",
          protectedInstanceIds: ["target-redirect-protected-1"],
        },
        redirectCandidateSource: {
          kind: "explicit",
          instanceIds: ["target-redirect-replacement-1"],
        },
        optional: true,
      } as Record<string, unknown>,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, protectedTarget, replacement],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect, redirectEffect],
    };

    const afterRedirectPending = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "target-redirect-source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      chainId,
    });

    expect(afterRedirectPending.pendingTargetRedirects).toHaveLength(1);
    expect(
      afterRedirectPending.pendingTargetRedirects[0]?.continuation
        ?.battleEndDeferralAttackId
    ).toBe(attackId);

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      afterRedirectPending,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const pending = blocked.pendingTargetRedirects[0]!;
    const afterDecline = applyLegalAction({
      state: blocked,
      action: {
        kind: "decline_target_redirect",
        actionId: `decline:${pending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: pending.promptedPlayerId,
        pendingId: pending.pendingId,
      },
      ...lookups,
    }).state;

    expect(afterDecline.pendingTargetRedirects).toHaveLength(0);
    expectBattleEndWaitEffectCleared(
      afterDecline,
      attackId,
      battleEffect.effectId
    );
  });

  it("battle_end deferral の native source_card destroy は battle_end chain で pendingLeave を積む", () => {
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-SOURCE-DESTROY",
      name: "テスト battle_end source_card destroy",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const getCardDefinitionById = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : undefined;
    const source = createCardInstance(sourceDef, {
      instanceId: "native-source-destroy-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack:native-source-destroy:1";

    const after = executeEffect({
      chainId: "test:battle-end-deferred-yield-finalize:6078",
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "battle_resolution",
      },
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "native-source-destroy-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      battleEndDeferralAttackId: attackId,
      effectIndex: 0,
    });

    const pendingLeave = after.pendingLeaveEntities.find(
      (entity) => entity.instanceId === "native-source-destroy-1"
    );
    expect(pendingLeave).toMatchObject({
      kind: "destroy",
      chainId: getBattleEndDeferralChainId(attackId),
    });
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "native-source-destroy-1"
      )?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("pendingImmediateBattleEnds 経由の battle_end source_card destroy は sourceCardReference を保持する", () => {
    const effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { kind: "source_card" },
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef: CardDefinition = {
      cardNo: "TEST-IMMEDIATE-BATTLE-END-HOST",
      name: "テスト immediate battle_end host",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [effect],
    };
    const braveDef: CardDefinition = {
      ...hostDef,
      cardNo: "TEST-IMMEDIATE-BATTLE-END-BRAVE",
      name: "テスト immediate battle_end brave",
      printedCategory: "brave",
      effects: [effect],
    };
    const defs = new Map<string, CardDefinition>([
      [hostDef.cardNo, hostDef],
      [braveDef.cardNo, braveDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attackId = "attack:immediate-battle-end-source-card-ref:1";
    const host = createCardInstance(hostDef, {
      instanceId: "immediate-battle-end-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedChildrenIds: ["immediate-battle-end-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "immediate-battle-end-brave",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      attachedToInstanceId: host.instanceId,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      pendingBattleEndDeferrals: [
        {
          deferralId: "deferral:immediate-battle-end-source-card-ref",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: hostDef.cardNo,
          effectSourceInstanceId: brave.instanceId,
          effectSourceDefinitionId: braveDef.cardNo,
          sourceCardReferenceInstanceId: brave.instanceId,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: [host.instanceId],
          blockSideInstanceIds: [],
          participantSnapshots: [
            {
              entityId: "entity-immediate-battle-end-host",
              memberInstanceIds: [host.instanceId],
              resolvedBp: 1000,
              resolvedSymbols: ["red"],
              blockedBy: [],
            },
          ],
          appliedLifeDamage: 1,
          participantOwnSymbols: [
            {
              entityId: "entity-immediate-battle-end-host",
              ownSymbols: 1,
            },
          ],
          battleEndEntryStarted: true,
        },
      ],
    };

    const after = processPendingImmediateBattleEnds({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    const hostAfter = after.cardInstances.find(
      (card) => card.instanceId === host.instanceId
    );
    const braveAfter = after.cardInstances.find(
      (card) => card.instanceId === brave.instanceId
    );
    expect(hostAfter?.zone).toBe("field");
    expect(hostAfter?.pendingLeaveKind).toBeNull();
    expect(hostAfter?.attachedChildrenIds).not.toContain(brave.instanceId);
    expect(braveAfter?.zone).toBe("trash");
    expect(braveAfter?.pendingLeaveKind).toBeNull();
    expect(braveAfter?.attachedToInstanceId).toBeNull();
    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.pendingImmediateBattleEnds).toHaveLength(0);
  });

  it("pendingImmediateBattleEnds 経由の battle_end は combined brave effect source が離脱済みなら発火しない", () => {
    const effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef: CardDefinition = {
      cardNo: "TEST-IMMEDIATE-BATTLE-END-SKIP-HOST",
      name: "テスト immediate battle_end skip host",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [effect],
    };
    const braveDef: CardDefinition = {
      ...hostDef,
      cardNo: "TEST-IMMEDIATE-BATTLE-END-SKIP-BRAVE",
      name: "テスト immediate battle_end skip brave",
      printedCategory: "brave",
      effects: [effect],
    };
    const defs = new Map<string, CardDefinition>([
      [hostDef.cardNo, hostDef],
      [braveDef.cardNo, braveDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attackId = "attack:immediate-battle-end-source-left:1";
    const host = createCardInstance(hostDef, {
      instanceId: "immediate-battle-end-skip-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "immediate-battle-end-skip-brave",
      ownerPlayerId: "alice",
      zone: "trash",
      cores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, trashNormalCoreCount: 1 },
          {},
        ],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      pendingBattleEndDeferrals: [
        {
          deferralId: "deferral:immediate-battle-end-source-left",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: hostDef.cardNo,
          effectSourceInstanceId: brave.instanceId,
          effectSourceDefinitionId: braveDef.cardNo,
          sourceCardReferenceInstanceId: brave.instanceId,
          effectSourceOnFieldRequired: true,
          effectSourceAttachmentRequired: true,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: [host.instanceId],
          blockSideInstanceIds: [],
          participantSnapshots: [
            {
              entityId: "entity-immediate-battle-end-skip-host",
              memberInstanceIds: [host.instanceId],
              resolvedBp: 1000,
              resolvedSymbols: ["red"],
              blockedBy: [],
            },
          ],
          appliedLifeDamage: 1,
          participantOwnSymbols: [
            {
              entityId: "entity-immediate-battle-end-skip-host",
              ownSymbols: 1,
            },
          ],
          battleEndEntryStarted: true,
        },
      ],
    };

    const after = processPendingImmediateBattleEnds({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const alice = after.players.find((player) => player.id === "alice")!;

    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(after.log).toContain(
      `battle:end-deferral:skip-source-left:${attackId}:${host.instanceId}:0`
    );
    expect(
      after.log.some((entry) =>
        entry.startsWith(
          `battle:end-deferral:fire:${attackId}:${host.instanceId}:0`
        )
      )
    ).toBe(false);
    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.pendingImmediateBattleEnds).toHaveLength(0);
  });

  it("pendingImmediateBattleEnds 経由の battle_end は combined brave effect source が分離して field に残っても発火しない", () => {
    const effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const hostDef: CardDefinition = {
      cardNo: "TEST-IMMEDIATE-BATTLE-END-SEPARATED-HOST",
      name: "テスト immediate battle_end separated host",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [effect],
    };
    const braveDef: CardDefinition = {
      ...hostDef,
      cardNo: "TEST-IMMEDIATE-BATTLE-END-SEPARATED-BRAVE",
      name: "テスト immediate battle_end separated brave",
      printedCategory: "brave",
      effects: [effect],
    };
    const defs = new Map<string, CardDefinition>([
      [hostDef.cardNo, hostDef],
      [braveDef.cardNo, braveDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attackId = "attack:immediate-battle-end-source-separated:1";
    const host = createCardInstance(hostDef, {
      instanceId: "immediate-battle-end-separated-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedChildrenIds: [],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "immediate-battle-end-separated-brave",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedToInstanceId: null,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, trashNormalCoreCount: 1 },
          {},
        ],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      pendingBattleEndDeferrals: [
        {
          deferralId: "deferral:immediate-battle-end-source-separated",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: hostDef.cardNo,
          effectSourceInstanceId: brave.instanceId,
          effectSourceDefinitionId: braveDef.cardNo,
          sourceCardReferenceInstanceId: brave.instanceId,
          effectSourceOnFieldRequired: true,
          effectSourceAttachmentRequired: true,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: [host.instanceId],
          blockSideInstanceIds: [],
          participantSnapshots: [
            {
              entityId: "entity-immediate-battle-end-separated-host",
              memberInstanceIds: [host.instanceId],
              resolvedBp: 1000,
              resolvedSymbols: ["red"],
              blockedBy: [],
            },
          ],
          appliedLifeDamage: 1,
          participantOwnSymbols: [
            {
              entityId: "entity-immediate-battle-end-separated-host",
              ownSymbols: 1,
            },
          ],
          battleEndEntryStarted: true,
        },
      ],
    };

    const after = processPendingImmediateBattleEnds({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const alice = after.players.find((player) => player.id === "alice")!;

    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(after.log).toContain(
      `battle:end-deferral:skip-source-left:${attackId}:${host.instanceId}:0`
    );
    expect(
      after.log.some((entry) =>
        entry.startsWith(
          `battle:end-deferral:fire:${attackId}:${host.instanceId}:0`
        )
      )
    ).toBe(false);
    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.pendingImmediateBattleEnds).toHaveLength(0);
  });

  it("pendingImmediateBattleEnds 経由の battle_end は activationZone を executeEffect へ復元する", () => {
    const effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_increase",
            player: "self",
            amount: 1,
          },
          stepCondition: { kind: "activation_zone", zones: ["hand"] },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const sourceDef: CardDefinition = {
      cardNo: "TEST-IMMEDIATE-BATTLE-END-ACTIVATION-ZONE",
      name: "テスト immediate battle_end activation zone",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [effect],
    };
    const attackId = "attack:immediate-battle-end-activation-zone:1";
    const source = createCardInstance(sourceDef, {
      instanceId: "immediate-battle-end-activation-zone-source",
      ownerPlayerId: "alice",
      zone: "in_use",
      cores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      pendingBattleEndDeferrals: [
        {
          deferralId: "deferral:immediate-battle-end-activation-zone",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: sourceDef.cardNo,
          activationZone: "hand",
          sourceOnFieldRequired: false,
          effectIndex: 0,
          resumeEffectOverride: effect,
        },
      ],
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: [],
          blockSideInstanceIds: [],
          participantSnapshots: [],
          appliedLifeDamage: 0,
          participantOwnSymbols: [],
          battleEndEntryStarted: true,
        },
      ],
    };

    const after = processPendingImmediateBattleEnds({
      state,
      getCardDefinitionById: (id) =>
        id === sourceDef.cardNo ? sourceDef : undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const alice = after.players.find((player) => player.id === "alice")!;

    expect(alice.countValue).toBe(1);
    expect(after.log).toContain(
      `battle:end-deferral:fire:${attackId}:${source.instanceId}:0`
    );
    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.pendingImmediateBattleEnds).toHaveLength(0);
  });

  it("battle_end deferral 解決終了時の destroy trigger は attackId を保持して battle scope CE を止める", () => {
    const attackId = "attack:deferred-source-destroy-trigger:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-SOURCE-DESTROY-TRIGGER",
      name: "テスト battle_end source destroy trigger",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          steps: [
            {
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const listenerDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-SOURCE-DESTROY-LISTENER",
      name: "テスト battle_end destroy listener",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "game_event", player: "self", event: "destroy" },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [listenerDef.cardNo, listenerDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const getRegisteredTriggeredEffectActions = (cardNo: string) =>
      cardNo === listenerDef.cardNo
        ? [
            {
              sourceKind: "spirit" as const,
              eventKind: "destroy" as const,
              effectIndex: 0,
            },
          ]
        : [];
    const source = createCardInstance(sourceDef, {
      instanceId: "deferred-source-destroy-trigger-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const listener = createCardInstance(listenerDef, {
      instanceId: "deferred-source-destroy-trigger-listener-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const beforeState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, listener],
    });
    const stateWithPendingLeave: GameState = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((card) =>
        card.instanceId === "deferred-source-destroy-trigger-source-1"
          ? {
              ...card,
              pendingLeaveKind: "destroy",
              pendingLeaveCause: "effect_resolution",
              pendingLeaveChainId: chainId,
            }
          : card
      ),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingLeaveEntities: [
        {
          instanceId: "deferred-source-destroy-trigger-source-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const afterDeferred = finalizeEffectResolution({
      beforeState,
      state: stateWithPendingLeave,
      chainId,
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: "deferred-source-destroy-trigger-source-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: () => [],
      battleEndDeferralAttackId: attackId,
    });

    const pending = afterDeferred.pendingTriggeredEffects.find(
      (candidate) =>
        candidate.eventKind === "destroy" &&
        candidate.relatedInstanceId ===
          "deferred-source-destroy-trigger-source-1"
    );
    expect(pending).toMatchObject({
      chainId,
      attackId,
      relatedInstanceId: "deferred-source-destroy-trigger-source-1",
    });

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      afterDeferred,
      getCardDefinitionById
    );

    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);
  });

  it("battle_end finalize は通常 core_move が開いた core_shoot pending の解決完了まで待つ", () => {
    const sourceDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-CORE-SHOOT-SOURCE",
      name: "テスト battle_end core_shoot source",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "opponent" },
                to: { kind: "trash", player: "opponent" },
                amount: 1,
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const victimDef: CardDefinition = {
      cardNo: "TEST-BATTLE-END-CORE-SHOOT-VICTIM",
      name: "テスト battle_end core_shoot victim",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [victimDef.cardNo, victimDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const source = createCardInstance(sourceDef, {
      instanceId: "core-shoot-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const victimA = createCardInstance(victimDef, {
      instanceId: "core-shoot-victim-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const victimB = createCardInstance(victimDef, {
      instanceId: "core-shoot-victim-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const attackId = "attack:core-shoot:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const chainId = getBattleEndDeferralChainId(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, victimA, victimB],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
    };

    const generated = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "core-shoot-source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      chainId,
    });

    expect(generated.pendingCoreShootSelection).not.toBeNull();
    expect(generated.pendingCoreShootSelection?.battleEndDeferralAttackId).toBe(
      attackId
    );

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      generated,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const action = getLegalActions({
      state: blocked,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((candidate) => candidate.kind === "resolve_pending_core_shoot");
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state: blocked,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      coreShootDistribution: { "core-shoot-victim-a": 1 },
    }).state;

    expect(after.pendingCoreShootSelection).toBeNull();
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "core-shoot-victim-a"
      )?.normalCoreCount
    ).toBe(1);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("battle_end finalize は life_gain_replacement pending の decline resume 完了まで待つ", () => {
    const sourceDef = makeBattleEndLifeGainSourceDef();
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const attackId = "attack:life-gain-replacement:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const lifeGainReplacementEffect: GameState["activeContinuousEffects"][number] =
      {
        effectId: "ce:life-gain-replacement",
        sourceInstanceId: "source-1",
        sourceDefinitionId: sourceDef.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "game" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "life_gain_replacement",
        targetInstanceId: "alice",
      };
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const chainId = getBattleEndDeferralChainId(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { lifeNormalCoreCount: 3, reserveNormalCoreCount: 2 },
          { lifeNormalCoreCount: 3 },
        ],
        cardInstances: [source],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect, lifeGainReplacementEffect],
    };

    const generated = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      chainId,
    });

    expect(generated.pendingLifeGainReplacementChoice).not.toBeNull();
    expect(
      generated.pendingLifeGainReplacementChoice?.battleEndDeferralAttackId
    ).toBe(attackId);
    expect(
      generated.pendingLifeGainReplacementChoice?.coreMoveResume
        ?.battleEndDeferralAttackId
    ).toBe(attackId);

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      generated,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const action = getLegalActions({
      state: blocked,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_life_gain_replacement_choice"
    );
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state: blocked,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      lifeGainReplacementChoice: "decline",
    }).state;

    expect(after.pendingLifeGainReplacementChoice).toBeNull();
    expect(
      after.players.find((player) => player.id === "alice")?.lifeNormalCoreCount
    ).toBe(4);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("battle_end finalize は life_damage_discard pending の decline resume 完了まで待つ", () => {
    const sourceDef = makeBattleEndLifeDamageDiscardSourceDef();
    const gateDef = makeDiscardCostGateDef();
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const gate = createCardInstance(gateDef, {
      instanceId: "discard-gate-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
      normalCoreCount: 0,
    });
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [gateDef.cardNo, gateDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attackId = "attack:life-damage-discard:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const chainId = getBattleEndDeferralChainId(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        ],
        cardInstances: [source, gate],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
    };

    const generated = executeEffect({
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "source-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      effectIndex: 0,
      firingBattleEndDeferral: true,
      battleEndDeferralAttackId: attackId,
      chainId,
    });

    expect(generated.pendingLifeDamageDiscardChoice).not.toBeNull();
    expect(
      generated.pendingLifeDamageDiscardChoice?.battleEndDeferralAttackId
    ).toBe(attackId);
    expect(
      generated.pendingLifeDamageDiscardChoice?.coreMoveResume
        ?.battleEndDeferralAttackId
    ).toBe(attackId);

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      generated,
      getCardDefinitionById
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const action = getLegalActions({
      state: blocked,
      actingPlayerId: "bob",
      getCardDefinitionById,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_life_damage_discard_choice"
    );
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state: blocked,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      lifeDamageDiscardChoice: "decline",
    }).state;

    expect(after.pendingLifeDamageDiscardChoice).toBeNull();
    expect(
      after.players.find((player) => player.id === "bob")?.lifeNormalCoreCount
    ).toBe(2);
    expect(
      after.players.find((player) => player.id === "bob")
        ?.reserveNormalCoreCount
    ).toBe(1);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("pending burst 後の battle_end 再開は battle_life_reduced 文脈を維持する", () => {
    const sourceDef = makeBattleLifeReducedNegateCountDef();
    const source = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const attackId = "attack:pending-burst-life-reduced:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 0 }, { countValue: 0 }],
        cardInstances: [source],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingBattleEndDeferrals: [
        {
          deferralId: "deferral:life-reduced",
          attackId,
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: sourceDef.cardNo,
          effectIndex: 0,
        },
      ],
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: ["source-1"],
          blockSideInstanceIds: [],
          participantSnapshots: [
            {
              entityId: "entity-source",
              memberInstanceIds: ["source-1"],
              resolvedBp: 1000,
              resolvedSymbols: ["red"],
              blockedBy: [],
            },
          ],
          appliedLifeDamage: 1,
          participantOwnSymbols: [{ entityId: "entity-source", ownSymbols: 1 }],
          battleEndEntryStarted: true,
        },
      ],
    };

    const after = processPendingImmediateBattleEnds({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.players.find((player) => player.id === "alice")?.countValue
    ).toBe(0);
    expect(after.log).not.toContain("effect:count_increase:alice:9");
    expect(after.pendingBattleEndFinalizeAttackIds).not.toContain(attackId);
    expect(
      after.activeContinuousEffects.some(
        (effect) => effect.effectId === battleEffect.effectId
      )
    ).toBe(false);
  });

  it("battle_end finalize は private declaration skip drain 後に再開する", () => {
    const attackId = "attack:private-skip-drain:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingPrivateDeclarations: [
        {
          declarationId: "decl:private-skip",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: "TEST-PRIVATE-SKIP",
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "pending:private-skip",
          eventKind: "destroy",
          source: "action_resolution",
          chainId,
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source-1",
          amount: null,
          step: "attack",
          window: "battle_resolution",
        },
      ],
    };
    const action: Extract<
      LegalAction,
      { kind: "skip_private_triggered_effect" }
    > = {
      chainId: "test:battle-end-deferred-yield-finalize:7201",
      kind: "skip_private_triggered_effect",
      actionId: "skip_private_triggered_effect:decl:private-skip",
      can: true,
      reason: "test_skip_private_triggered_effect",
      actingPlayerId: "alice",
      declarationId: "decl:private-skip",
      eventKind: "destroy",
      sourceInstanceId: "source-1",
      sourceDefinitionId: "TEST-PRIVATE-SKIP",
      sourceCardNo: "TEST-PRIVATE-SKIP",
      registrationIndex: 0,
    };

    const after = applyLegalAction({
      state,
      action,
      getCardDefinitionById: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(after.pendingPrivateDeclarations).toHaveLength(0);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("battle_end finalize は direct battle_end private declaration の skip drain 後に再開する", () => {
    const attackId = "attack:direct-private-battle-end-skip:1";
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingPrivateDeclarations: [
        {
          declarationId: "decl:direct-private-battle-end",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: "TEST-DIRECT-PRIVATE-BATTLE-END",
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "pending:direct-private-battle-end",
          eventKind: "battle_end",
          source: "battle_end",
          chainId: "test:battle-end-deferred-yield-finalize:7239",
          attackId,
          relatedPlayerId: "alice",
          relatedInstanceId: "source-1",
          amount: null,
          step: "attack",
          window: "battle_resolution",
        },
      ],
    };

    const blocked = maybeFinalizeBattleEndScopeExpirations(
      state,
      () => undefined
    );
    expect(blocked.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(blocked.activeContinuousEffects).toContainEqual(battleEffect);

    const action: Extract<
      LegalAction,
      { kind: "skip_private_triggered_effect" }
    > = {
      chainId: "test:battle-end-deferred-yield-finalize:7272",
      kind: "skip_private_triggered_effect",
      actionId: "skip_private_triggered_effect:decl:direct-private-battle-end",
      can: true,
      reason: "test_skip_private_triggered_effect",
      actingPlayerId: "alice",
      declarationId: "decl:direct-private-battle-end",
      eventKind: "battle_end",
      sourceInstanceId: "source-1",
      sourceDefinitionId: "TEST-DIRECT-PRIVATE-BATTLE-END",
      sourceCardNo: "TEST-DIRECT-PRIVATE-BATTLE-END",
      registrationIndex: 0,
    };

    const after = applyLegalAction({
      state: blocked,
      action,
      getCardDefinitionById: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(after.pendingPrivateDeclarations).toHaveLength(0);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it("battle_end finalize は private declaration condition-unmet drain 後に再開する", () => {
    const attackId = "attack:private-condition-unmet-drain:1";
    const chainId = getBattleEndDeferralChainId(attackId);
    const battleEffect = makeBattleEndWaitEffect(attackId);
    const privateDef: CardDefinition = {
      cardNo: "TEST-PRIVATE-CONDITION-UNMET",
      name: "テスト非公開誘発条件不成立",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "destroy" },
          condition: [{ kind: "hand_count", player: "self", min: 99 }],
          steps: [],
          textRef: [0],
        },
      ],
    };
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [battleEffect],
      pendingPrivateDeclarations: [
        {
          declarationId: "decl:private-condition-unmet",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "source-1",
          sourceDefinitionId: privateDef.cardNo,
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "pending:private-condition-unmet",
          eventKind: "destroy",
          source: "action_resolution",
          chainId,
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source-1",
          amount: null,
          step: "attack",
          window: "battle_resolution",
        },
      ],
    };
    const action: Extract<
      LegalAction,
      { kind: "declare_private_triggered_effect" }
    > = {
      chainId: "test:battle-end-deferred-yield-finalize:7358",
      kind: "declare_private_triggered_effect",
      actionId: "declare_private_triggered_effect:decl:private-condition-unmet",
      can: true,
      reason: "test_declare_private_triggered_effect",
      actingPlayerId: "alice",
      declarationId: "decl:private-condition-unmet",
      eventKind: "destroy",
      sourceInstanceId: "source-1",
      sourceDefinitionId: privateDef.cardNo,
      sourceCardNo: privateDef.cardNo,
      registrationIndex: 0,
    };

    const after = applyLegalAction({
      state,
      action,
      getCardDefinitionById: (id) =>
        id === privateDef.cardNo ? privateDef : undefined,
      getRegisteredTriggeredEffectActions: (cardNo) =>
        cardNo === privateDef.cardNo
          ? [{ sourceKind: "spirit", eventKind: "destroy", effectIndex: 0 }]
          : [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(after.pendingPrivateDeclarations).toHaveLength(0);
    expectBattleEndWaitEffectCleared(after, attackId, battleEffect.effectId);
  });

  it.each([
    "decline_pending_burst_check",
    "resolve_pending_burst_check",
  ] as const)(
    "battle_end / attack_step_end finalize は %s drain 後に再開する",
    (kind) => {
      const attackId = `attack:burst-${kind}-drain:1`;
      const chainId = getBattleEndDeferralChainId(attackId);
      const battleEffect = makeBattleEndWaitEffect(attackId);
      const checkId = `burst:${kind}`;
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        window: "battle_resolution",
        pendingBattleEndFinalizeAttackIds: [attackId],
        activeContinuousEffects: [battleEffect],
        pendingBurstChecks: [
          {
            checkId,
            actingPlayerId: "bob",
            eventKind: "leave_field",
            source: "action_resolution",
            chainId,
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: "source-1",
            amount: 1,
            step: "attack",
            window: "battle_resolution",
            resolvedBurstCardInstanceIds: [],
          },
        ],
        // バーストが battle 解決を中断した後は、pendingImmediateBattleEnds が
        // battle_end を再開してから効果によるアタックステップ終了を確定する。
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: [],
            blockSideInstanceIds: [],
            participantSnapshots: [],
          },
        ],
        pendingAttackStepEndFinalizations: [
          {
            pendingId: `attack-step-end:${kind}`,
            actingPlayerId: "alice",
            sourceInstanceId: "source-1",
            createdAtTurn: 1,
          },
        ],
      };
      const action =
        kind === "decline_pending_burst_check"
          ? ({
              chainId: "test:battle-end-deferred-yield-finalize:7443",
              kind,
              actionId: `decline_pending_burst_check:${checkId}`,
              can: true,
              reason: "test_decline_pending_burst_check",
              actingPlayerId: "bob",
              checkId,
              eventKind: "leave_field",
              relatedPlayerId: "alice",
            } satisfies Extract<
              LegalAction,
              { kind: "decline_pending_burst_check" }
            >)
          : ({
              chainId: "test:battle-end-deferred-yield-finalize:7456",
              kind,
              actionId: `resolve_pending_burst_check:${checkId}`,
              can: true,
              reason: "test_resolve_pending_burst_check",
              actingPlayerId: "bob",
              checkId,
              eventKind: "leave_field",
              relatedPlayerId: "alice",
              targetMode: "none",
              requiredTargetCount: 0,
              targetEffectFilterTags: ["general"],
              candidateTargetInstanceIds: [],
              availableChosenLifeCoreKinds: [],
              requiresChosenLifeCoreKind: false,
              playsSourceCardWithoutCostAfterResolve: false,
              usesSourceCardWithoutCostAfterResolve: false,
              playsTargetCardWithoutCostAfterResolve: false,
              usesTargetCardWithoutCostAfterResolve: false,
              enterFieldCorePlacementRule: "optional",
              minimumEnterFieldCoreCount: 0,
              maximumEnterFieldCoreCount: null,
              requiresEnterFieldCorePlacements: false,
              targetFollowUpMagicOptions: [],
              targetEnterFieldCorePlacementOptions: [],
            } satisfies Extract<
              LegalAction,
              { kind: "resolve_pending_burst_check" }
            >);

      const after = applyLegalAction({
        state,
        action,
        getCardDefinitionById: () => undefined,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }).state;

      expect(after.pendingBurstChecks).toHaveLength(0);
      expect(after.pendingImmediateBattleEnds).toHaveLength(0);
      expect(
        after.activeContinuousEffects.some(
          (effect) => effect.effectId === battleEffect.effectId
        )
      ).toBe(false);
      expect(after.pendingAttackStepEndFinalizations).toHaveLength(0);
      expect(after.step).toBe("end");
    }
  );

  it("battle 終了で activeAttack が null 化したときだけ remaining stack cascade を破棄する", () => {
    const def = makeAttackerDef();
    const activeAttack: ActiveAttack = {
      attackId: "attack:discard-cascade:1",
      primaryEntityId: "discard-cascade-atk",
      participantEntityIds: ["discard-cascade-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "discard-cascade-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["discard-cascade-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const remainingStacks: ActiveStack[] = [
      {
        stackId: "stack-after-battle-end",
        actionKind: "use_magic",
        chainId: "chain-after-battle-end",
        actingPlayerId: "alice",
        cardInstanceId: "missing-card",
        cardDefinitionId: def.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
      },
    ];
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "none",
      activeAttack,
    };
    const after: GameState = {
      ...before,
      activeAttack: null,
      battlesEndedThisTurn: 1,
      log: ["effect:end_battle:alice"],
    };

    expect(
      shouldDiscardRemainingStacksAfterBattleEnded(
        before,
        after,
        remainingStacks
      )
    ).toBe(true);
    expect(
      shouldDiscardRemainingStacksAfterBattleEnded(
        after,
        { ...after, log: [...after.log, "effect:end_battle:alice:old"] },
        remainingStacks
      )
    ).toBe(false);
  });
});
