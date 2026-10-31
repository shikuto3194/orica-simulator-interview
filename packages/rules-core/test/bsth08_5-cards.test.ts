/**
 * BSTH08.5 (東方心綺楼) カードの effects 検証テスト。
 * 能面/面霊 アクセルブレイヴ中心。accel/手元/合体/創界神 の多くは stub。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  matchesCardFilter,
  rebuildContinuousEffectsFromField,
} from "../src";
import { executeBattleResolution } from "../src/battle/battle-actions";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { processPendingImmediateBattleEnds } from "../src/effect/effect-resolution";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  resolveDeferredAccelStack,
  useAccelCardInFlashContextAsAction,
} from "../src/mechanics/accel-change-system";
import {
  getStackNegatePreventionLevel,
  stackMatchesNegateAction,
} from "../src/stack/stack-negate";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  Effect,
  GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);

it("BSTH08.5-X01 秦 こころの画像正本の軽減は赤3・神1・導1に完全一致する", () => {
  expect(cardNoMap.get("BSTH08.5-X01")!.reductionSymbols).toEqual([
    "red",
    "red",
    "red",
    "god",
    "guide",
  ]);
});
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

function applyFirstPassStack(state: GameState): GameState {
  const pass = ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({
        state,
        actingPlayerId,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      })
    )
    .find((action) => action.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  }).state;
}

function resolveStepChoice(state: GameState, choiceIndex: number): GameState {
  const choice = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  }).find(
    (action) =>
      action.kind === "resolve_pending_step_choice" &&
      action.choiceIndex === choiceIndex
  );
  expect(choice).toBeDefined();
  return applyLegalAction({
    state,
    action: choice!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  }).state;
}

// 能面ブレイヴ共通: 合体条件 面霊＆コスト6以上
describe("BSTH08.5 能面ブレイヴ braveCondition", () => {
  it.each([
    "BSTH08.5-C20",
    "BSTH08.5-C21",
    "BSTH08.5-C22",
    "BSTH08.5-C23",
    "BSTH08.5-C24",
    "BSTH08.5-M11",
    "BSTH08.5-R11",
    "BSTH08.5-R12",
    "BSTH08.5-R13",
    "BSTH08.5-X04",
  ])("%s は braveCondition(面霊, minCost6) を持つ", (cardNo) => {
    expect(cardNoMap.get(cardNo)!.braveCondition).toEqual({
      tribes: ["面霊"],
      minCost: 6,
    });
  });
});

// adversarial verifier 2026-07-25 round1 指摘: accelData.effects[0].steps が空 (stub 未実装)
// のまま accelData を付与すると getAvailableAccelLegalActions
// (legal-actions-availability.ts:8423 `!sourceDefinition?.accelData` ゲートのみ) を通過し、
// コストだけ払わせて何も起きない no-op アクセルが実戦経路に出てしまう。
// steps 未実装のカードは accelData を付けない (旧来どおり card.effects の stub のみ) こと。
// BSTH08.5-R12 は ENGINE-move-card-actual-count-amount で steps 実装済み・
// accelData 付与済みのため本ガード対象から除外 (2026-07-31)。現在ガード対象カード無し
// (対象が出たら it.each にカード番号を追加する)。

describe("BSTH08.5-C20 能面・女", () => {
  const card = cardNoMap.get("BSTH08.5-C20")!;
  it("手元常駐: 面霊ブレイヴのシンボルをフィールド扱い + アクセルメイン deck_reveal(4枚, 創界神/スピ/ブレイヴ)", () => {
    expect(card.effects![0]!.applicability).toEqual({ zone: "set_aside" });
    expect(card.effects![0]!.steps[0]!.action).toEqual({
      kind: "extend_field_symbol_source",
      player: "self",
      zone: "set_aside",
      filter: { category: ["brave"], tribes: ["面霊"] },
      duration: { scope: "permanent" },
    });
    expect(card.accelData).toEqual({
      timing: "main",
      cost: 3,
      reduction: ["red"],
      effects: expect.any(Array),
    });
    const reveal = card.accelData!.effects![0]!.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(4);
      expect(reveal.picks.length).toBe(3);
      expect(reveal.remainder).toBe("trash");
    }
  });

  it("[EDH-0007] 再計算後も手元の面霊ブレイヴを全カードの軽減供給源として扱い、発生源が離れると失効する", () => {
    const menreiSymbolDefinition: CardDefinition = {
      ...card,
      cardNo: "test-c20-menrei-symbol-source",
      effects: undefined,
    };
    const summoningCardDefinition: CardDefinition = {
      ...card,
      cardNo: "test-c20-summoning-card",
      effects: undefined,
    };
    const getTestCardDefinitionById = (id: string) =>
      id === menreiSymbolDefinition.cardNo
        ? menreiSymbolDefinition
        : id === summoningCardDefinition.cardNo
          ? summoningCardDefinition
          : getCardDefinitionById(id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(card, {
          instanceId: "c20-source",
          ownerPlayerId: "alice",
          zone: "set_aside",
        }),
        createCardInstance(menreiSymbolDefinition, {
          instanceId: "c20-menrei-symbol",
          ownerPlayerId: "alice",
          zone: "set_aside",
        }),
        createCardInstance(summoningCardDefinition, {
          instanceId: "c20-summoning-card",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const recomputed = recomputeContinuousEffects(
      rebuildContinuousEffectsFromField(state, getTestCardDefinitionById)
    );
    expect(
      recomputed.activeContinuousEffects.some(
        (effect) => effect.sourceInstanceId === "c20-source"
      )
    ).toBe(true);
    const reduction = calculateReduction({
      state: recomputed,
      actingPlayerId: "alice",
      card: summoningCardDefinition,
      getCardDefinitionById: getTestCardDefinitionById,
      sourceInstanceId: "c20-summoning-card",
    });
    expect(
      reduction.fieldSymbolSources.some(
        (source) => source.sourceInstanceId === "c20-menrei-symbol"
      )
    ).toBe(true);

    const sourceLeftSetAside = {
      ...recomputed,
      cardInstances: recomputed.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "c20-source"
          ? { ...cardInstance, zone: "trash" as const }
          : cardInstance
      ),
    };
    expect(
      recomputeContinuousEffects(
        sourceLeftSetAside
      ).activeContinuousEffects.some(
        (effect) => effect.sourceInstanceId === "c20-source"
      )
    ).toBe(false);
  });
});

describe("BSTH08.5-C21 能面・大飛出", () => {
  const card = cardNoMap.get("BSTH08.5-C21")!;
  it("手元常駐: お互いデッキ破棄不可 + BP6000以下のアタックで自分ライフ1ターン2以上減らない", () => {
    const e = card.effects![0]!;
    expect(e.applicability).toEqual({ zone: "set_aside" });
    // お互いのデッキは破棄されない (prevent_deck_discard either)。
    const deckGuard = e.steps.find(
      (s) => s.action.kind === "prevent_deck_discard"
    )?.action;
    expect(deckGuard).toBeDefined();
    if (deckGuard?.kind === "prevent_deck_discard") {
      expect(deckGuard.player).toBe("either");
    }
    const action = e.steps.find(
      (s) => s.action.kind === "life_damage_interception"
    )!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.attackerBpTurnCap).toBe(1);
      expect(action.attackerFilter).toEqual({
        maxBp: 6000,
        category: ["spirit", "ultimate"],
      });
    }
  });
  it("アクセルメイン 3ドロー+破棄choice (accelData)", () => {
    const e = card.accelData!.effects![0]!;
    expect(e.steps[0]!.action.kind).toBe("draw");
    expect(e.steps[1]!.action.kind).toBe("discard");
    expect(e.steps[1]!.choice?.[0]?.action.kind).toBe("discard");
  });

  it("[board] use_accel→stack後に discard choice を pendingStepChoice で選択できる", () => {
    const deckMenrei = createCardInstance(cardNoMap.get("BSTH08.5-C22")!, {
      instanceId: "c21-menrei-deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const source = createCardInstance(card, {
      instanceId: "c21-accel-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, deckMenrei],
        startingDeckCount: 10,
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const useAccel = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "use_accel");
    expect(useAccel).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: useAccel!,
      paymentSources: [{ kind: "reserve", amount: useAccel!.finalCost }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe("accel");

    const afterStack = applyFirstPassStack(declared);
    expect(afterStack.players.find((p) => p.id === "alice")?.deckCount).toBe(7);
    expect(
      afterStack.cardInstances.find((c) => c.instanceId === "c21-menrei-deck-1")
        ?.zone
    ).toBe("hand");
    expect(
      afterStack.pendingStepChoice?.choices.map((c) => c.choiceIndex)
    ).toEqual([0, 1]);

    const afterChoice = resolveStepChoice(afterStack, 1);
    expect(
      afterChoice.cardInstances.find(
        (c) => c.instanceId === "c21-menrei-deck-1"
      )?.zone
    ).toBe("trash");
    expect(
      afterChoice.cardInstances.find((c) => c.instanceId === "c21-accel-1")
        ?.zone
    ).toBe("set_aside");
    expect(afterChoice.pendingAccelCleanups ?? []).toHaveLength(0);
  });
});

describe("BSTH08.5-C22 能面・猿", () => {
  const card = cardNoMap.get("BSTH08.5-C22")!;
  // アクセルの終了予約だけを検証する。こころのバトル離脱時任意効果を介入させない。
  const battleDef: CardDefinition = {
    ...cardNoMap.get("BSTH08.5-X01")!,
    cardNo: "TEST-C22-BATTLE",
    effects: [],
  };
  cardNoMap.set(battleDef.cardNo, battleDef);
  function buildC22BattleState(
    extraContinuousEffects: ContinuousEffect[] = []
  ): GameState {
    const source = createCardInstance(card, {
      instanceId: "c22-saru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(battleDef, {
      instanceId: "c22-attacker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const blocker = createCardInstance(battleDef, {
      instanceId: "c22-blocker-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:c22:1",
      primaryEntityId: "c22-attacker-be",
      participantEntityIds: ["c22-attacker-be"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "c22-attacker-be",
          blockedByEntityIds: ["c22-blocker-be"],
        },
      ],
      blockDeclarationCompleted: true,
      symbolResolutionOrder: ["c22-attacker-be"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, attacker, blocker],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "c22-attacker-be",
          resolvedBp: 4000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["c22-attacker-1"],
        },
        {
          entityId: "c22-blocker-be",
          resolvedBp: 1000,
          attackState: "blocking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["c22-blocker-1"],
        },
      ],
      activeContinuousEffects: extraContinuousEffects,
    };
  }

  function queueC22Accel(state: GameState): GameState {
    return executeEffect({
      chainId: "test:bsth08_5-cards:405",
      state,
      effect: card.accelData!.effects![0]!,
      sourceInstanceId: "c22-saru-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effectIndex: 0,
    });
  }

  it("アクセルフラッシュ: battle_end deferred end_attack_step + 失敗時だけ1回 retry / 合体中 unblockable", () => {
    expect(card.keywordTags).toContain("accel");
    expect(card.accelData).toEqual({
      timing: "flash",
      cost: 4,
      reduction: ["red", "red"],
      effects: expect.any(Array),
    });
    const accel = card.accelData!.effects![0]!;
    expect(accel.stub).toBeUndefined();
    expect(accel.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(accel.steps[0]).toEqual({
      id: "end-attack-step",
      deferTo: "battle_end",
      action: { kind: "end_attack_step" },
    });
    expect(accel.steps[1]).toEqual({
      id: "retry-end-attack-step",
      executionMode: "optional",
      stepCondition: {
        kind: "ref_blocked_by_opponent_effect",
        stepId: "end-attack-step",
      },
      action: { kind: "end_attack_step" },
    });
    const combined = card.effects![1]!;
    expect(combined.applicability).toEqual({ combined: true });
    expect(combined.steps[0]!.action.kind).toBe("unblockable");
  });

  it("[board] BSTH08.5-C22 アクセル実行: 発揮時点では予約のみ、バトル終了時にアタックステップを終了する", () => {
    const queued = queueC22Accel(buildC22BattleState());
    expect(queued.step).toBe("attack");
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);
    expect(queued.pendingBattleEndDeferrals[0]).toEqual(
      expect.objectContaining({
        sourceInstanceId: "c22-saru-1",
        sourceDefinitionId: "BSTH08.5-C22",
        resumeEffectOverride: card.accelData!.effects![0]!,
      })
    );

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(resolved.state.step).toBe("end");
    expect(
      resolved.state.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:finalized:alice")
      )
    ).toHaveLength(1);
    expect(resolved.state.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] BSTH08.5-C22 アクセル実行: immediate battle_end 再開でも accelData 効果を実行する", () => {
    const queued = queueC22Accel(buildC22BattleState());
    const deferral = queued.pendingBattleEndDeferrals[0]!;

    const resolved = processPendingImmediateBattleEnds({
      state: {
        ...queued,
        activeAttack: null,
        battleEntities: [],
        pendingImmediateBattleEnds: [
          {
            attackId: deferral.attackId,
            participantInstanceIds: ["c22-attacker-1", "c22-blocker-1"],
            blockSideInstanceIds: ["c22-blocker-1"],
            participantSnapshots: [
              {
                entityId: "c22-attacker-be",
                memberInstanceIds: ["c22-attacker-1"],
                resolvedBp: 4000,
                resolvedSymbols: ["red"],
                blockedBy: [
                  {
                    entityId: "c22-blocker-be",
                    memberInstanceIds: ["c22-blocker-1"],
                    resolvedBp: 1000,
                    resolvedSymbols: ["red"],
                  },
                ],
              },
            ],
            appliedLifeDamage: 0,
            participantOwnSymbols: [
              { entityId: "c22-attacker-be", ownSymbols: 0 },
            ],
            battleEndEntryStarted: true,
          },
        ],
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(resolved.step).toBe("attack");
    expect(resolved.pendingImmediateBattleEnds).toHaveLength(0);
    expect(resolved.pendingBattleEndDeferrals).toHaveLength(0);
    expect(resolved.pendingAttackStepEndFinalizations).toHaveLength(1);
    expect(resolved.pendingAttackStepEndFinalizations[0]).toEqual(
      expect.objectContaining({
        actingPlayerId: "alice",
        sourceInstanceId: "c22-saru-1",
      })
    );
    expect(
      resolved.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:pending:alice")
      )
    ).toHaveLength(1);
  });

  it("[board] BSTH08.5-C22 アクセル実行: 相手効果の終了妨害下では任意 retry を提示し、実行すると同じ制限を受ける", () => {
    const restrictEndAttackStep: ContinuousEffect = {
      effectId: "c22-restrict-end-attack-step",
      sourceInstanceId: "c22-restrict-src",
      sourceDefinitionId: "TEST-C22-RESTRICT",
      actingPlayerId: "bob",
      targetInstanceId: "alice",
      modifierTag: "restrict_end_attack_step",
      duration: { scope: "turn" },
      createdAtTurn: 2,
      createdAtAttackId: null,
    };
    const queued = queueC22Accel(buildC22BattleState([restrictEndAttackStep]));
    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(resolved.state.step).toBe("attack");
    expect(resolved.state.pendingStepOptionalChoice).toEqual(
      expect.objectContaining({
        sourceInstanceId: "c22-saru-1",
        sourceDefinitionId: "BSTH08.5-C22",
        stepIndex: 1,
        stepLabel: "retry-end-attack-step",
        canExecute: true,
      })
    );
    expect(
      resolved.state.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:blocked-by-restriction:alice")
      )
    ).toHaveLength(1);

    const retry = resolved.state.pendingStepOptionalChoice!;
    const afterRetry = applyLegalAction({
      state: resolved.state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `c22-retry:${retry.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: retry.choosingPlayerId,
        pendingId: retry.pendingId,
        sourceInstanceId: retry.sourceInstanceId,
        effectIndex: retry.effectIndex,
        stepIndex: retry.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(afterRetry.pendingStepOptionalChoice).toBeNull();
    expect(afterRetry.step).toBe("attack");
    expect(
      afterRetry.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:blocked-by-restriction:alice")
      )
    ).toHaveLength(2);
  });

  it("[board] BSTH08.5-C22 アクセル実行: 予約後の実終了時に相手効果で妨害されても retry を提示する", () => {
    const restrictDef: CardDefinition = {
      cardNo: "TEST-C22-DELAYED-RESTRICT",
      name: "C22 delayed restrict source",
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
          timing: { kind: "card_event", event: "battle_end" },
          steps: [
            {
              action: {
                kind: "restrict_end_attack_step",
                player: "opponent",
                duration: { scope: "turn" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === restrictDef.cardNo ? restrictDef : getCardDefinitionById(id);
    const restrictSource = createCardInstance(restrictDef, {
      instanceId: "c22-delayed-restrict-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = buildC22BattleState();
    const withRestrictSource: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, restrictSource],
    };
    const queued = executeEffect({
      chainId: "test:bsth08_5-cards:640",
      state: withRestrictSource,
      effect: card.accelData!.effects![0]!,
      sourceInstanceId: "c22-saru-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      effectIndex: 0,
    });
    const withLaterRestrictDeferral: GameState = {
      ...queued,
      pendingBattleEndDeferrals: [
        ...queued.pendingBattleEndDeferrals,
        {
          deferralId: "bed:c22-delayed-restrict",
          attackId: queued.activeAttack!.attackId,
          actingPlayerId: "bob",
          sourceInstanceId: restrictSource.instanceId,
          sourceDefinitionId: restrictDef.cardNo,
          effectIndex: 0,
        },
      ],
    };

    const resolved = executeBattleResolution({
      state: withLaterRestrictDeferral,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(resolved.state.step).toBe("attack");
    expect(resolved.state.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(resolved.state.pendingStepOptionalChoice).toEqual(
      expect.objectContaining({
        sourceInstanceId: "c22-saru-1",
        sourceDefinitionId: "BSTH08.5-C22",
        stepIndex: 1,
        stepLabel: "retry-end-attack-step",
        canExecute: true,
      })
    );
    expect(
      resolved.state.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:blocked-by-restriction:alice")
      )
    ).toHaveLength(1);

    const retry = resolved.state.pendingStepOptionalChoice!;
    const afterRetry = applyLegalAction({
      state: resolved.state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `c22-delayed-retry:${retry.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: retry.choosingPlayerId,
        pendingId: retry.pendingId,
        sourceInstanceId: retry.sourceInstanceId,
        effectIndex: retry.effectIndex,
        stepIndex: retry.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(afterRetry.pendingStepOptionalChoice).toBeNull();
    expect(afterRetry.step).toBe("attack");
    expect(
      afterRetry.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:blocked-by-restriction:alice")
      )
    ).toHaveLength(2);
  });

  it("[board] BSTH08.5-C22 アクセル実行: retry 条件が AND 全体で不成立なら提示しない", () => {
    const restrictEndAttackStep: ContinuousEffect = {
      effectId: "c22-restrict-end-attack-step-and",
      sourceInstanceId: "c22-restrict-src-and",
      sourceDefinitionId: "TEST-C22-RESTRICT-AND",
      actingPlayerId: "bob",
      targetInstanceId: "alice",
      modifierTag: "restrict_end_attack_step",
      duration: { scope: "turn" },
      createdAtTurn: 2,
      createdAtAttackId: null,
    };
    const guardedRetryEffect: Effect = {
      ...card.accelData!.effects![0]!,
      steps: [
        card.accelData!.effects![0]!.steps[0]!,
        {
          ...card.accelData!.effects![0]!.steps[1]!,
          stepCondition: {
            kind: "all",
            conditions: [
              {
                kind: "ref_blocked_by_opponent_effect",
                stepId: "end-attack-step",
              },
              { kind: "ref_count", stepId: "missing-step", min: 1 },
            ],
          },
        },
      ],
    };
    const queued = executeEffect({
      chainId: "test:bsth08_5-cards:747",
      state: buildC22BattleState([restrictEndAttackStep]),
      effect: guardedRetryEffect,
      sourceInstanceId: "c22-saru-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effectIndex: 0,
    });

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(resolved.state.step).toBe("attack");
    expect(
      resolved.state.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:blocked-by-restriction:alice")
      )
    ).toHaveLength(1);
    expect(resolved.state.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] BSTH08.5-C22 アクセル実行: 自分由来の終了妨害では retry を提示しない", () => {
    const selfRestrictEndAttackStep: ContinuousEffect = {
      effectId: "c22-self-restrict-end-attack-step",
      sourceInstanceId: "c22-self-restrict-src",
      sourceDefinitionId: "TEST-C22-SELF-RESTRICT",
      actingPlayerId: "alice",
      targetInstanceId: "alice",
      modifierTag: "restrict_end_attack_step",
      duration: { scope: "turn" },
      createdAtTurn: 2,
      createdAtAttackId: null,
    };
    const queued = queueC22Accel(
      buildC22BattleState([selfRestrictEndAttackStep])
    );
    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(resolved.state.step).toBe("attack");
    expect(
      resolved.state.log.filter((entry) =>
        entry.startsWith("effect:end_attack_step:blocked-by-restriction:alice")
      )
    ).toHaveLength(1);
    expect(resolved.state.pendingStepOptionalChoice).toBeNull();
  });
});

describe("BSTH08.5-C24 能面・姥", () => {
  const card = cardNoMap.get("BSTH08.5-C24")!;
  it("アクセルフラッシュ search_zone(trash→hand/手元 per-card choice, ゲーム3回, accelData)", () => {
    expect(card.keywordTags).toContain("accel");
    const e = card.accelData!.effects![0]!;
    expect(e.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 3,
    });
    const step = e.steps[0]!;
    expect(step.action.kind).toBe("search_zone");
    if (step.action.kind === "search_zone") {
      expect(step.action.destination).toBe("hand_or_set_aside_choice");
    }
    expect(step.choice).toBeUndefined();
  });

  it("[board] アクセル実行: トラッシュの面霊カードが選択した手札へ移動する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const trashed = createCardInstance(card, {
      instanceId: "uba-trashed-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [trashed],
    };
    const afterEffect = executeEffect({
      chainId: "test:bsth08_5-cards:835",
      state,
      effect: card.accelData!.effects![0]!,
      sourceInstanceId: "uba-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const zoneSelection = afterEffect.pendingZoneSelection!;
    expect(zoneSelection.destination).toBe("hand_or_set_aside_choice");
    const result = applyLegalAction({
      state: afterEffect,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: zoneSelection.candidateCardInstanceIds,
      zoneSelectionDestinationByCardId: Object.fromEntries(
        zoneSelection.candidateCardInstanceIds.map((id) => [id, "hand"])
      ) as Record<string, "hand">,
      getCardDefinitionById,
    }).state;
    expect(
      result.cardInstances.find((c) => c.instanceId === "uba-trashed-1")!.zone
    ).toBe("hand");
  });

  it("[board] deferred accel 解決後に各カードの手札/手元を pendingZoneSelection で選択できる", () => {
    const source = createCardInstance(card, {
      instanceId: "c24-accel-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const trashed = createCardInstance(cardNoMap.get("BSTH08.5-C21")!, {
      instanceId: "c24-trash-menrei-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const trashed2 = createCardInstance(cardNoMap.get("BSTH08.5-C22")!, {
      instanceId: "c24-trash-menrei-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, trashed, trashed2],
      }),
      activePlayerId: "alice",
      step: "attack",
    };
    const declared = useAccelCardInFlashContextAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "c24-accel-1",
      accelData: card.accelData!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    const afterStack = resolveDeferredAccelStack({
      state: declared.state,
      activeStack: declared.activeStack,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(afterStack.pendingStepChoice).toBeNull();
    expect(afterStack.pendingZoneSelection?.destination).toBe(
      "hand_or_set_aside_choice"
    );
    const zsAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(zsAction).toMatchObject({
      requiresPerCardDestinationChoice: true,
      maxCount: 2,
      canSkip: true,
    });

    const afterZone = applyLegalAction({
      state: afterStack,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["c24-trash-menrei-1", "c24-trash-menrei-2"],
      zoneSelectionDestinationByCardId: {
        "c24-trash-menrei-1": "hand",
        "c24-trash-menrei-2": "set_aside",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(
      afterZone.cardInstances.find((c) => c.instanceId === "c24-trash-menrei-1")
        ?.zone
    ).toBe("hand");
    expect(
      afterZone.cardInstances.find((c) => c.instanceId === "c24-trash-menrei-2")
        ?.zone
    ).toBe("set_aside");
    expect(
      afterZone.cardInstances.find((c) => c.instanceId === "c24-accel-1")?.zone
    ).toBe("set_aside");
    expect(afterZone.pendingAccelCleanups ?? []).toHaveLength(0);
  });

  it("手元常駐: effect_resistance(core_below_min, coreMinimumSource:own_level_required_cores lv1)", () => {
    const e = card.effects![0]!;
    expect(e.applicability).toEqual({ zone: "set_aside" });
    expect(e.stub).toBeUndefined();
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("effect_resistance");
    if (action.kind === "effect_resistance") {
      expect(action.resistsOutcome).toBe("core_below_min");
      expect(action.source).toBe("opponent_effect");
      expect(action.coreMinimumSource).toEqual({
        kind: "own_level_required_cores",
        level: 1,
      });
      if ("filter" in action.target) {
        expect(action.target.filter).toEqual({
          category: ["spirit"],
          tribes: ["面霊"],
        });
      }
    }
  });

  it("[board] 手元にあるこのカードは、面霊スピリットのコアを相手効果で自身のLv1コスト未満にしない", () => {
    const menreiSpirit: CardDefinition = {
      cardNo: "TEST-MENREI-SPIRIT-C24",
      name: "テスト面霊スピリット",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 2, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "面霊",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const coreShootSrc: CardDefinition = {
      cardNo: "TEST-CORESHOOT-SRC-C24",
      name: "コアシュート源",
      printedCategory: "magic",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: {
                  kind: "field",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                },
                to: { kind: "void", player: "opponent" },
                amount: 3,
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = new Map<string, CardDefinition>([
      [card.cardNo, card],
      [menreiSpirit.cardNo, menreiSpirit],
      [coreShootSrc.cardNo, coreShootSrc],
    ]);
    const getDef = (id: string) => defs.get(id);

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const c24Instance = createCardInstance(card, {
      instanceId: "c24-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const spirit = createCardInstance(menreiSpirit, {
      instanceId: "menrei-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const src = createCardInstance(coreShootSrc, {
      instanceId: "src-bob",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const seeded: GameState = {
      ...base,
      activePlayerId: "bob",
      cardInstances: [c24Instance, spirit, src],
    };
    const state = rebuildContinuousEffectsFromField(seeded, getDef);

    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1050",
      state,
      effect: coreShootSrc.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "menrei-1"
    )!;
    // コアシュート量3に対し、Lv1requiredCores=2 の下限保護でコアは2のまま (0にならない)。
    expect(after.normalCoreCount).toBe(2);
  });

  it("[board] 面霊以外のスピリットは耐性を受けずコアを奪われる", () => {
    const outsider: CardDefinition = {
      cardNo: "TEST-OUTSIDER-C24",
      name: "無関係スピリット",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const coreShootSrc: CardDefinition = {
      cardNo: "TEST-CORESHOOT-SRC-C24-B",
      name: "コアシュート源",
      printedCategory: "magic",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: {
                  kind: "field",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                },
                to: { kind: "void", player: "opponent" },
                amount: 3,
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = new Map<string, CardDefinition>([
      [card.cardNo, card],
      [outsider.cardNo, outsider],
      [coreShootSrc.cardNo, coreShootSrc],
    ]);
    const getDef = (id: string) => defs.get(id);

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const c24Instance = createCardInstance(card, {
      instanceId: "c24-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const outsiderInstance = createCardInstance(outsider, {
      instanceId: "outsider-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const src = createCardInstance(coreShootSrc, {
      instanceId: "src-bob-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const seeded: GameState = {
      ...base,
      activePlayerId: "bob",
      cardInstances: [c24Instance, outsiderInstance, src],
    };
    const state = rebuildContinuousEffectsFromField(seeded, getDef);

    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1147",
      state,
      effect: coreShootSrc.effects![0]!,
      sourceInstanceId: "src-bob-2",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "outsider-1"
    )!;
    expect(after.normalCoreCount).toBe(0);
  });
});

describe("BSTH08.5-M11 獅子", () => {
  const card = cardNoMap.get("BSTH08.5-M11")!;
  it("アクセルフラッシュ send_to_deck は相手アタックステップ中だけ防止不可 / 合体中 send_to_deck + burst 発動不可", () => {
    expect(card.keywordTags).toContain("accel");
    expect(card.accelData).toMatchObject({
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
    });
    const accel = card.accelData!.effects![0]!;
    expect(accel.stub).toBeUndefined();
    expect(accel.timingScope).toBeUndefined();
    expect(accel.preventionLevel).toBe("unpreventable");
    expect(accel.preventionLevelCondition).toEqual([
      { kind: "step_phase", step: "attack", whose: "opponent" },
    ]);
    expect(accel.steps[0]!.action.kind).toBe("send_to_deck");

    expect(card.effects![1]!.applicability).toEqual({ combined: true });
    expect(card.effects![1]!.stub).toBeUndefined();
    expect(card.effects![1]!.steps[1]!.action).toMatchObject({
      kind: "restrict_burst_activation",
      player: "opponent",
      duration: { scope: "battle" },
    });
  });

  it("アクセル効果実行: 相手1体がデッキ下へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "shishi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH08.5-X01")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
    };
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth08_5-cards:1212",
        state,
        effect: card.accelData!.effects![0]!,
        sourceInstanceId: "shishi-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      }),
      getCardDefinitionById
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-1")!.zone
    ).toBe("deck");
  });

  it("Q1481: 条件付きの防止不可を持つ手札アクセルも発揮前無効化の対象になる", () => {
    function declareDuringAttack(activePlayerId: "alice" | "bob") {
      const handCard = createCardInstance(card, {
        instanceId: `shishi-hand-${activePlayerId}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      });
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [handCard],
        playerOverrides: [
          { handCount: 1, reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 5 },
        ],
      });
      const state: GameState = {
        ...base,
        activePlayerId,
        step: "attack",
      };
      return useAccelCardInFlashContextAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: handCard.instanceId,
        accelData: card.accelData!,
        paymentSources: [{ kind: "reserve", amount: 5 }],
        targetInstanceIds: [],
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      });
    }

    const opponentAttack = declareDuringAttack("bob");
    expect(opponentAttack.activeStack.actionKind).toBe("accel");
    expect(opponentAttack.activeStack.sourceActivationZone).toBe("hand");
    expect(opponentAttack.activeStack.chosenTiming).toBe("flash");
    expect(opponentAttack.activeStack.activationLabel).toBe("flash");
    expect(opponentAttack.activeStack.preventionLevel).toBe("unpreventable");
    expect(getStackNegatePreventionLevel(opponentAttack.activeStack)).toBe(
      "none"
    );
    expect(
      stackMatchesNegateAction({
        state: opponentAttack.state,
        stack: opponentAttack.activeStack,
        request: { negateTarget: "effect", targetEffectTiming: "flash" },
        actingPlayerId: "bob",
        getCardDefinitionById,
      })
    ).toBe(true);

    expect(
      stackMatchesNegateAction({
        state: opponentAttack.state,
        stack: {
          ...opponentAttack.activeStack,
          negatePreventionLevel: "unpreventable",
        },
        request: { negateTarget: "effect", targetEffectTiming: "flash" },
        actingPlayerId: "bob",
        getCardDefinitionById,
      })
    ).toBe(false);

    const selfAttack = declareDuringAttack("alice");
    expect(selfAttack.activeStack.preventionLevel).toBe("unpreventable");
    expect(getStackNegatePreventionLevel(selfAttack.activeStack)).toBe("none");
    expect(
      stackMatchesNegateAction({
        state: selfAttack.state,
        stack: selfAttack.activeStack,
        request: { negateTarget: "effect", targetEffectTiming: "flash" },
        actingPlayerId: "bob",
        getCardDefinitionById,
      })
    ).toBe(true);
  });

  it("[EDH-0008] stack 解決後のアクセル cleanup で手元常駐の除外置換 CE を登録する", () => {
    const handCard = createCardInstance(card, {
      instanceId: "shishi-edh-0008-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [handCard],
        playerOverrides: [
          { handCount: 1, reserveNormalCoreCount: 5 },
          { reserveNormalCoreCount: 5 },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const accelAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "use_accel");
    expect(accelAction).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: accelAction!,
      paymentSources: [{ kind: "reserve", amount: accelAction!.finalCost }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe("accel");

    // pass_stack の action 境界まで通す。ここで deferred resolver の保留 cleanup が
    // 共通 finalize により実行され、手元常駐CEも同じ state transition で登録される。
    const resolved = applyFirstPassStack(declared);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === handCard.instanceId)
        ?.zone
    ).toBe("set_aside");
    expect(
      resolved.activeContinuousEffects.find(
        (ce) =>
          ce.sourceInstanceId === handCard.instanceId &&
          ce.modifierTag === "replace_field_exit" &&
          ce.provenance?.effectIndex === 0
      )
    ).toMatchObject({
      sourceDefinitionId: "BSTH08.5-M11",
      targetInstanceId: handCard.instanceId,
      duration: { scope: "permanent" },
    });
  });

  it("合体中アタック時: このバトルの間 opponent の burst 発動宣言を出さない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(cardNoMap.get("BSTH08.5-X01")!, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.attachedChildrenIds = ["shishi-combined-1"];
    const self = createCardInstance(card, {
      instanceId: "shishi-combined-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    self.attachedToInstanceId = "host-1";
    const enemy = createCardInstance(cardNoMap.get("BSTH08.5-X01")!, {
      instanceId: "enemy-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobBurst = createCardInstance(cardNoMap.get("BSTH01-M13")!, {
      instanceId: "bob-burst-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      activeAttack: {
        attackId: "attack-1",
        attackerInstanceId: "shishi-combined-1",
        defenderPlayerId: "bob",
        blockedByInstanceId: null,
        startedAtTurn: base.turnNumber,
      },
      cardInstances: [host, self, enemy, bobBurst],
      setBurstStates: [{ playerId: "bob", cardInstanceId: "bob-burst-1" }],
    };
    const pendingBurstChecks: GameState["pendingBurstChecks"] = [
      {
        checkId: "bob-reduce-life-check",
        actingPlayerId: "bob",
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:bsth08_5-cards:1408",
        attackId: "attack-1",
        relatedPlayerId: "bob",
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "flash_before_block",
        resolvedBurstCardInstanceIds: [],
      },
    ];
    const beforeRestrictionActions = getLegalActions({
      state: { ...state, pendingBurstChecks },
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredBurstActions,
    });
    expect(
      beforeRestrictionActions.some(
        (action) => action.kind === "resolve_pending_burst_check"
      )
    ).toBe(true);

    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1436",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "shishi-combined-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const restrictionCe = result.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "cannot_activate_opponent_burst"
    );
    expect(restrictionCe).toMatchObject({
      targetInstanceId: "bob",
      duration: { scope: "battle" },
    });
    const recomputed = recomputeContinuousEffects(result);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "cannot_activate_opponent_burst"
      )
    ).toBe(true);

    const burstWindow: GameState = {
      ...recomputed,
      pendingBurstChecks,
    };
    const bobActions = getLegalActions({
      state: burstWindow,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredBurstActions,
    });
    expect(
      bobActions.some((action) => action.kind === "resolve_pending_burst_check")
    ).toBe(false);
    expect(
      bobActions.some((action) => action.kind === "decline_pending_burst_check")
    ).toBe(true);
  });
});

describe("BSTH08.5-R11 能面・狐", () => {
  const card = cardNoMap.get("BSTH08.5-R11")!;
  it("アクセルフラッシュ destroy(minSymbolCount:2 = シンボル2つ以上, 2体) / 合体中 destroy 2", () => {
    expect(card.accelData).toMatchObject({
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
    });
    const a = card.accelData!.effects![0]!.steps[0]!.action;
    if (
      a.kind === "destroy" &&
      typeof a.target === "object" &&
      "filter" in a.target
    ) {
      // 「シンボル2つ以上の相手のスピリット/アルティメット」=
      //   印字 symbolColors.length >= 2 (minSymbolCount:2)。
      //   旧 symbolCount:2 (完全一致) は『2つだけ』を意味し、symbol3+ のカードを
      //   弾いていた近似だったため minSymbolCount に置換。
      expect(a.target.filter.minSymbolCount).toBe(2);
      expect(a.target.filter.symbolCount).toBeUndefined();
      expect(a.target.count).toBe(2);
    }
    expect(card.effects![1]!.applicability).toEqual({ combined: true });
  });

  it("手元常駐: BP2000以下のスピリットがアタックしたとき破壊できる (game_event:attack + triggerFilter + trigger_related_instance, stub 解消)", () => {
    const e = card.effects![0]!;
    expect(e.applicability).toEqual({ zone: "set_aside" });
    expect(e.stub).toBeUndefined();
    // 原文に「自分の」「相手の」の限定が無いため player:"either"。
    expect(e.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "attack",
      triggerFilter: { category: ["spirit"], maxBp: 2000 },
    });
    // 「破壊できる」= 任意発動。
    expect(e.executionMode).toBe("optional");
    expect(e.steps).toHaveLength(1);
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("destroy");
    if (action.kind === "destroy") {
      expect(action.target).toEqual({ kind: "trigger_related_instance" });
    }
  });

  it("手元常駐実行: アタックしたBP2000以下のスピリット(トリガー対象)が破壊される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const setAsideCard = createCardInstance(card, {
      instanceId: "kitsune-setaside",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const lowBpDef = ALL_CARDS.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs[0]!.bp <= 2000 &&
        d.cardNo !== "BSTH08.5-R11"
    )!;
    const attacker = createCardInstance(lowBpDef, {
      instanceId: "bob-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [setAsideCard, attacker],
    };
    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1548",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "kitsune-setaside",
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: "bob-attacker",
    });
    const flushed = flushPendingLeaves(result, getCardDefinitionById);
    const attackerAfter = flushed.cardInstances.find(
      (c) => c.instanceId === "bob-attacker"
    )!;
    expect(attackerAfter.zone).toBe("trash");
  });

  it("[SSOT] triggerFilter.maxBp は実効BP判定: bp_modifier で2000以下になった攻撃者(印字BPは2000超)も候補になる (adversarial verifier round1 refute修正)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const setAsideCard = createCardInstance(card, {
      instanceId: "kitsune-ssot",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const highBpDef = ALL_CARDS.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs[0]!.bp > 2000 &&
        d.cardNo !== "BSTH08.5-R11"
    )!;
    const attacker = createCardInstance(highBpDef, {
      instanceId: "bob-boosted-down",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    // 印字BP > 2000 のカードを bp_modifier CE で実効BP=2000ちょうどまで下げる。
    // 印字BPだけを見る旧実装ならこの攻撃者は誤って候補から除外されていた。
    const reduceAmount = highBpDef.levelDefs[0]!.bp - 2000;
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [setAsideCard, attacker],
      activeContinuousEffects: [
        {
          effectId: "ce-bp-reduce-ssot",
          sourceInstanceId: "bob-boosted-down",
          sourceDefinitionId: highBpDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: -reduceAmount,
          targetInstanceId: "bob-boosted-down",
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:attack:bob-boosted-down",
          // actingPlayerId = 応答側(=source管理者)。kitsune-ssot は alice 管理なので alice。
          actingPlayerId: "alice",
          eventKind: "attack",
          source: "action_resolution",
          chainId: "test:bsth08_5-cards:1606",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: "bob-boosted-down",
          amount: 0,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };
    const lookup = buildTriggeredEffectLookup([card]);
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: state.pendingTriggeredEffects[0]!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      choices.some((c) => c.sourceCard.instanceId === "kitsune-ssot")
    ).toBe(true);
  });

  it("アクセル実行: シンボル2つ以上の相手2体は破壊されシンボル1体は対象外のまま", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "kitsune-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const multiSymDef = ALL_CARDS.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.symbolColors.length >= 2 &&
        d.cardNo !== "BSTH08.5-R11"
    )!;
    const target1 = createCardInstance(multiSymDef, {
      instanceId: "bob-multi-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const target2 = createCardInstance(multiSymDef, {
      instanceId: "bob-multi-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    // 陰性対照は category:["spirit","ultimate"] を満たしつつ symbolColors.length===1 の
    // カードにする（BSTH08.5-R12 は category:"brave" のため category 除外と minSymbolCount
    // 除外を混同してしまい検証にならない。BSTH08.5-X01 は spirit かつシンボル1色）。
    const singleSymDef = cardNoMap.get("BSTH08.5-X01")!;
    expect(singleSymDef.printedCategory).toBe("spirit");
    expect(singleSymDef.symbolColors.length).toBe(1);
    const target3 = createCardInstance(singleSymDef, {
      instanceId: "bob-single-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, target1, target2, target3],
    };
    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1679",
      state,
      effect: card.accelData!.effects![0]!,
      sourceInstanceId: "kitsune-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-multi-1")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-multi-2")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-single-1")!
        .pendingLeaveKind
    ).toBeNull();
  });

  it("minSymbolCount:2 はシンボル1のスピリットを弾き、シンボル2以上のスピリットを許す", () => {
    // 印字 symbolColors.length=1 のスピリット（例: BSTH08.5-R12 = ["red"]）
    const onlyOne = cardNoMap.get("BSTH08.5-R12")!;
    expect(onlyOne.symbolColors.length).toBe(1);
    const oneSym = createCardInstance(onlyOne, {
      instanceId: "sym1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    expect(matchesCardFilter(oneSym, onlyOne, { minSymbolCount: 2 })).toBe(
      false
    );
    // 印字 symbolColors.length>=2 のスピリットを別途探す
    const symGe2 = ALL_CARDS.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.symbolColors.length >= 2 &&
        d.cardNo !== "BSTH08.5-R11"
    );
    expect(symGe2).toBeDefined();
    const multiSym = createCardInstance(symGe2!, {
      instanceId: "sym2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    expect(matchesCardFilter(multiSym, symGe2!, { minSymbolCount: 2 })).toBe(
      true
    );
  });
  it("合体中 destroy は「このスピリットのBP以下」= 動的 maxBpSource", () => {
    const combined = card.effects![1]!;
    const action = combined.steps[0]!.action;
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.maxBpSource).toBe("self_effective_bp");
      expect(action.target.count).toBe(2);
    } else {
      throw new Error("destroy filter target expected");
    }
    expect(combined.stub).toBeUndefined();
  });
});

describe("BSTH08.5-R13 能面・鬼", () => {
  const card = cardNoMap.get("BSTH08.5-R13")!;
  it("アクセルフラッシュ destroy 1 / 合体中 battle_end core_move(life→reserve)", () => {
    expect(card.accelData).toMatchObject({
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
    });
    const accel = card.accelData!.effects![0]!;
    expect(accel.steps[0]!.action.kind).toBe("destroy");
    const combined = card.effects![1]!;
    if (combined.timing.kind === "card_event") {
      expect(combined.timing.deferredTo).toBe("battle_end");
    }
    expect(combined.steps[0]!.action.kind).toBe("core_move");

    // アクセル効果実行: 相手のスピリットが破壊されトラッシュへ。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "oni-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const target = createCardInstance(cardNoMap.get("BSTH08.5-X01")!, {
      instanceId: "bob-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, target],
    };
    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1781",
      state,
      effect: accel,
      sourceInstanceId: "oni-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-target")!
        .pendingLeaveKind
    ).toBe("destroy");
  });

  it("手元常駐フラッシュ: 2コスト支払い相手創界神ネクサスのコア3個をボイドへ", () => {
    // effects[0] = applicability set_aside flash: pay_cost(2) → conditional_cost core_move
    const setAside = card.effects!.find(
      (e) =>
        e.timing.kind === "activated" && e.applicability?.zone === "set_aside"
    )!;
    expect(setAside).toBeDefined();
    expect(setAside.stub).toBeUndefined();
    expect(setAside.steps[0]!.action.kind).toBe("pay_cost");
    const coreMove = setAside.steps[1]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.amount).toBe(3);
      expect(coreMove.from.kind).toBe("field_card");
    }

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "oni-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, grandwalker],
    };
    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1833",
      state,
      effect: setAside,
      sourceInstanceId: "oni-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    // 創界神ネクサスのコアが 5 → 2 (3個ボイドへ)。
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-grandwalker")!
        .normalCoreCount
    ).toBe(2);
  });
});

describe("BSTH08.5-X01 秦 こころ", () => {
  const card = cardNoMap.get("BSTH08.5-X01")!;
  const stayEffect = card.effects![1]!;

  it("相手離脱時 手元の面霊ブレイヴ1枚除外→stay_on_field / この効果は相手の効果を受けない", () => {
    expect(stayEffect.stub).toBeUndefined();
    expect(stayEffect.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(stayEffect.executionMode).toBe("optional");
    expect(stayEffect.preventionLevel).toBe("unpreventable");
    expect(stayEffect.steps[0]!.action).toMatchObject({
      kind: "search_zone",
      zone: "set_aside",
      filter: { category: ["brave"], tribes: ["面霊"] },
      count: 1,
      destination: "removed_from_game",
    });
    expect(stayEffect.steps[1]!.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
    });
    expect(stayEffect.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: stayEffect.steps[0]!.id,
    });
  });

  it("手元に面霊ブレイヴがあれば除外して field に残る（コアも疲労状態も維持）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "kokoro-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-kokoro-1",
    });
    const setAsideBrave = createCardInstance(cardNoMap.get("BSTH08.5-C20")!, {
      instanceId: "kokoro-set-aside-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const state: GameState = {
      ...base,
      cardInstances: [self, setAsideBrave],
      pendingLeaveEntities: [
        {
          instanceId: "kokoro-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-kokoro-1",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1912",
      state,
      effect: stayEffect,
      sourceInstanceId: "kokoro-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((c) => c.instanceId === "kokoro-1")!;
    expect(inst.zone).toBe("field");
    expect(inst.exhaustState).toBe("exhausted");
    expect(inst.pendingLeaveKind).toBeNull();
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "kokoro-1")
    ).toBeUndefined();
    expect(
      result.cardInstances.find((c) => c.instanceId === "kokoro-set-aside-1")!
        .zone
    ).toBe("removed_from_game");
  });

  it("手元に面霊ブレイヴが無ければ除外できず field に残れない（stay_on_field 不発）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "kokoro-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-kokoro-2",
    });
    const state: GameState = {
      ...base,
      cardInstances: [self],
      pendingLeaveEntities: [
        {
          instanceId: "kokoro-2",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-kokoro-2",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:bsth08_5-cards:1959",
      state,
      effect: stayEffect,
      sourceInstanceId: "kokoro-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const inst = result.cardInstances.find((c) => c.instanceId === "kokoro-2")!;
    // stay_on_field が不発なので zone/pendingLeave は変化なし（離脱パイプラインへ続く）。
    expect(inst.zone).toBe("field");
    expect(inst.pendingLeaveKind).toBe("destroy");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "kokoro-2")
    ).toBeDefined();
  });

  it("[EDH-0007] 再計算後も手元の系統:面霊カードのシンボルで自身だけを軽減でき、召喚元を離れると失効する", () => {
    const costEffect = card.effects![0]!;
    expect(costEffect.stub).toBeUndefined();
    expect(costEffect.applicability).toEqual({ zone: ["hand", "set_aside"] });
    expect(costEffect.steps[0]!.action).toEqual({
      kind: "extend_field_symbol_source",
      player: "self",
      targetScope: "source_card",
      zone: "set_aside",
      filter: { tribes: ["面霊"] },
      duration: { scope: "permanent" },
    });

    const menreiSymbolDefinition: CardDefinition = {
      ...cardNoMap.get("BSTH08.5-C20")!,
      cardNo: "test-menrei-symbol-source",
      effects: undefined,
    };
    const unrelatedCardDefinition: CardDefinition = {
      ...card,
      cardNo: "test-unrelated-summon-card",
      effects: undefined,
    };
    const getTestCardDefinitionById = (id: string) =>
      id === menreiSymbolDefinition.cardNo
        ? menreiSymbolDefinition
        : id === unrelatedCardDefinition.cardNo
          ? unrelatedCardDefinition
          : getCardDefinitionById(id);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(card, {
          instanceId: "kokoro-hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(menreiSymbolDefinition, {
          instanceId: "kokoro-set-aside-menrei",
          ownerPlayerId: "alice",
          zone: "set_aside",
        }),
        createCardInstance(unrelatedCardDefinition, {
          instanceId: "unrelated-hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getTestCardDefinitionById
    );
    const recomputed = recomputeContinuousEffects(rebuilt);
    const reduction = calculateReduction({
      state: recomputed,
      actingPlayerId: "alice",
      card,
      getCardDefinitionById: getTestCardDefinitionById,
      sourceInstanceId: "kokoro-hand",
    });
    // 手元の面霊ブレイヴが自身の軽減供給源に加わる。
    expect(
      reduction.fieldSymbolSources.some(
        (s) => s.sourceInstanceId === "kokoro-set-aside-menrei"
      )
    ).toBe(true);

    const unrelatedReduction = calculateReduction({
      state: recomputed,
      actingPlayerId: "alice",
      card: unrelatedCardDefinition,
      getCardDefinitionById: getTestCardDefinitionById,
      sourceInstanceId: "unrelated-hand",
    });
    expect(
      unrelatedReduction.fieldSymbolSources.some(
        (s) => s.sourceInstanceId === "kokoro-set-aside-menrei"
      )
    ).toBe(false);

    const sourceLeftHand = {
      ...recomputed,
      cardInstances: recomputed.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "kokoro-hand"
          ? { ...cardInstance, zone: "trash" as const }
          : cardInstance
      ),
    };
    expect(
      recomputeContinuousEffects(sourceLeftHand).activeContinuousEffects.some(
        (effect) => effect.sourceInstanceId === "kokoro-hand"
      )
    ).toBe(false);
  });
});

describe("BSTH08.5-X02 [心綺楼]こいし (burst)", () => {
  const card = cardNoMap.get("BSTH08.5-X02")!;
  it("burst(life_decrease) Lv2下扱い→最低Lv未満消滅→ライフ補充→召喚 (stub 撤去、詳細は bsth08-5-x02-level-down-vanish.test.ts)", () => {
    const burst = card.effects![0]!;
    expect(burst.timing.kind).toBe("burst");
    expect(burst.steps[0]!.action.kind).toBe("override_properties");
    expect(burst.steps[3]!.action.kind).toBe("summon");
    expect(burst.stub).toBeUndefined();
  });
});

describe("BSTH08.5-X03 創界神 摩多羅", () => {
  const card = cardNoMap.get("BSTH08.5-X03")!;
  it("grandwalkerData(grandwalker, 面霊系スピリット/アクセルブレイヴ) + treat_as(赤/導)", () => {
    expect(card.grandwalkerData?.kind).toBe("grandwalker");
    expect(card.grandwalkerData?.oracleConditions).toEqual([
      {
        tribes: ["面霊", "天渡", "化神"],
        categories: ["spirit"],
        minCost: 3,
      },
      { categories: ["brave"], hasMechanic: ["accel"] },
    ]);
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const colors = treat.steps.map((s) =>
      s.action.kind === "treat_as" ? s.action.asColor : null
    );
    expect(colors).toEqual(["red", "guide"]);
    // 【神技：3】は divineSkills 経路（deck_reveal 排他選択は DeckRevealPick.exclusiveGroup
    // で表現、bsth08_5-x03-deck-reveal-exclusive-pick.test.ts 参照）。神域は top-level effects で実 DSL 化済み。
    const skill = card.grandwalkerData!.divineSkills![0]!;
    expect(skill.label).toBe("divine_skill");
    expect(skill.coreCost).toBe(3);
    expect(skill.timing).toBe("flash");
    expect(skill.turnLimit).toBe("once");
    expect(skill.effects![0]!.stub).toBeUndefined();
    expect(card.effects!.filter((e) => e.stub)).toHaveLength(0);
  });

  it("神域 実行: Lv2 で手元の面霊ブレイヴに effect_immunity CE を登録", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "okina-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2 (requiredCores 1)
    });
    const brave = createCardInstance(cardNoMap.get("BSTH08.5-X04")!, {
      instanceId: "men-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, brave],
    };
    const zoneEffect = card.effects![1]!;
    expect(zoneEffect.stub).toBeUndefined();
    expect(zoneEffect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const result = executeEffect({
      chainId: "test:bsth08_5-cards:2144",
      state,
      effect: zoneEffect,
      sourceInstanceId: "okina-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    // ENGINE-effect-immunity-hand-zone-scope: 手元(非field)ゾーン対象は per-instance
    // snapshot CE ではなく global CE (targetFilter.zone) として登録する。
    // per-instance targetInstanceId 版だと recomputeContinuousEffects の
    // 「targetInstanceId 付き CE は対象カードが field を離れたら除去」規約に抵触し、
    // 手元カードへ付与した直後の recompute で消えてしまうため。
    const brave2 = result.cardInstances.find((c) => c.instanceId === "men-1")!;
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.targetInstanceId === undefined &&
          ce.targetFilter?.zone?.includes("set_aside")
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        result,
        brave2,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);
  });
});

describe("BSTH08.5-X04 希望の面", () => {
  const card = cardNoMap.get("BSTH08.5-X04")!;
  it("braveCondition + アクセルフラッシュ draw(optional) + 合体中シンボル加算", () => {
    expect(card.accelData).toMatchObject({
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
    });
    const draw = card.accelData!.effects!.find(
      (e) => e.steps[0]?.action.kind === "draw"
    )!;
    expect(draw.executionMode).toBe("optional");
    const combined = card.effects!.find((e) => e.applicability?.combined)!;
    expect(combined.stub).toBeUndefined();
    expect(combined.steps[0]?.action.kind).toBe("symbol_add");
  });
});
