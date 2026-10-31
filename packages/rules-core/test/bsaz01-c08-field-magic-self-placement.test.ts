/** 作戦の常時使用許可と、通常マジック使用で発揮する本文の検証。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  collectGameStateInvariantIssues,
  executeEffect,
  generateFieldCardEffectRegistrations,
  generateMagicRegistrations,
  calculateReduction,
  getLegalActions,
  playMagicCardAsAction,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C08 = cardNoMap.get("BSAZ01-C08")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
};

function actionsFor(state: GameState, playerId: string) {
  state = recomputeAndRebuildContinuousEffects(
    state,
    getCardDefinitionByIdWithSpirits
  );
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    ...effectLookups,
  });
}

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "地球",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const ALICE_SPIRIT = makeSpirit("TEST-ALICE-SPIRIT-C08");
const COMBINED_TARGET: CardDefinition = {
  ...ALICE_SPIRIT,
  cardNo: "TEST-COMBINED-TARGET-C08",
  name: "ジャガーノート",
};

const getCardDefinitionByIdWithSpirits = (id: string) =>
  cardNoMap.get(id) ??
  [ALICE_SPIRIT, COMBINED_TARGET].find((def) => def.cardNo === id);

describe("BSAZ01-C08 effects[1]: 使用時の印字済み軽減枠充足", () => {
  it("自分のフィールドにマジックが1枚あれば軽減1枠が満たされ支払いが1減る", () => {
    const other = { ...C08, cardNo: "TEST-OTHER-MAGIC-C08" } as CardDefinition;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(other, {
          instanceId: "field-magic-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });
    state.cardInstances.push(
      createCardInstance(C08, {
        instanceId: "paying",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const result = calculateReduction({
      card: C08,
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) =>
        id === other.cardNo ? other : getCardDefinitionById(id),
      sourceInstanceId: "paying",
    });
    expect(result.reducedCost).toBe(
      Math.max(0, C08.cost - Math.min(1, C08.reductionSymbols.length))
    );
    expect(result.totalReduction).toBe(
      Math.min(1, C08.reductionSymbols.length)
    );
  });
});

describe("BSAZ01-C08 effects[2]: メイン (手札/トラッシュの「スレイプニール」1枚をコスト不要召喚)", () => {
  it("effect 定義: mode:main + applicability 省略 (通常の手札使用) + summon from_zone cardName + costModifier:free", () => {
    const effect = C08.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef.includes(8)
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(effect.applicability).toBeUndefined();
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind !== "summon") throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "from_zone",
      zone: ["hand", "trash"],
      filter: {
        category: ["spirit", "ultimate", "brave"],
        cardName: [{ contains: "スレイプニール" }],
      },
      count: 1,
    });
    expect(action.costModifier).toBe("free");
  });

  it("generateMagicRegistrations は timing:main で1件登録する", () => {
    const regs = generateMagicRegistrations(C08);
    const mainRegs = regs.filter((r) => r.timing === "main");
    expect(mainRegs).toHaveLength(1);
  });
});

describe("BSAZ01-C08 effects[3]/[4]: スタック (次のバトル終了後まで、自分の合体スピリット1体は相手の効果を受けない)", () => {
  it("effect[3] 定義: mode:stack + applicability 省略 (通常の手札使用) + effect_immunity(combined spirit, duration:battle)", () => {
    const effect = C08.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef.length === 2 &&
        e.textRef.includes(10) &&
        e.textRef.includes(11)
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(effect.applicability).toBeUndefined();

    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind !== "effect_immunity") throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "filter",
      player: "self",
      filter: { category: ["spirit"], combined: true },
      count: 1,
    });
    expect(action.duration).toEqual({ scope: "battle" });
  });

  it("場の作戦は通常使用を許可する常時効果を持つ", () => {
    expect(
      C08.effects!.find((e) =>
        e.steps.some((s) => s.action.kind === "grant_magic_use")
      )
    ).toMatchObject({
      timing: { kind: "continuous" },
      applicability: { zone: "field" },
      timingScope: { player: "both", period: "attack" },
    });
  });

  it("generateMagicRegistrations は timing:stack (手札使用) で1件登録する", () => {
    const regs = generateMagicRegistrations(C08);
    const stackRegs = regs.filter((r) => r.timing === "stack");
    expect(stackRegs).toHaveLength(1);
  });

  it("使用許可を無償のフィールド起動効果として登録しない", () => {
    expect(generateFieldCardEffectRegistrations(C08)).toHaveLength(0);
  });

  it("[board] 実行すると合体している自分のスピリットに effect_immunity CE (duration:battle) が付与される", () => {
    const combinedSpirit = createCardInstance(ALICE_SPIRIT, {
      instanceId: "alice-combined-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      attachedChildrenIds: ["alice-brave"],
    });
    const notCombinedSpirit = createCardInstance(
      { ...ALICE_SPIRIT, cardNo: "TEST-ALICE-NOT-COMBINED-C08" },
      {
        instanceId: "alice-not-combined-spirit",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      }
    );
    const c08Field = createCardInstance(C08, {
      instanceId: "c08-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [combinedSpirit, notCombinedSpirit, c08Field],
    });
    const effect = C08.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "stack" &&
        e.steps.length === 1
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c08-field-magic-self-placement:227",
      state,
      effect,
      sourceInstanceId: "c08-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    const immunityCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immunityCEs).toHaveLength(1);
    expect(immunityCEs[0]!.targetInstanceId).toBe("alice-combined-spirit");
    expect(immunityCEs[0]!.duration).toEqual({ scope: "battle" });
  });
});

describe("BSAZ01-C08 場残置スタックの legal action 提示 (お互いのアタックステップ限定)", () => {
  function baseState(step: GameState["step"]): GameState {
    const c08Field = createCardInstance(C08, {
      instanceId: "c08-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [c08Field],
        playerOverrides: [
          { reserveNormalCoreCount: 20 },
          { reserveNormalCoreCount: 20 },
        ],
      }),
      step,
      activePlayerId: "alice",
      window: step === "attack" ? "flash_before_block" : null,
      activeAttack:
        step === "attack"
          ? {
              attackId: "attack-group:1:alice:battle-entity:none",
              primaryEntityId: "battle-entity:none",
              participantEntityIds: [],
              groupMode: "single",
              target: { kind: "player", playerId: "bob" },
              blockAssignments: [],
              symbolResolutionOrder: [],
              flashBeforeBlockCompleted: false,
              flashAfterBlockCompleted: false,
              // stackResponseSourcePlayerId を alice 以外にすることで
              // getResponseWindowActionTimings が "stack" を返す (C08 はスタック起動)。
              // C07/C10 の flash テストは stackResponseSourcePlayerId:"alice" (=自分開窓) で "flash"。
              flashWindowState: {
                kind: "before_block",
                priorityPlayerId: "alice",
                consecutivePassCount: 0,
                stackResponseSourcePlayerId: "bob",
                pendingStackAction: null,
              },
            }
          : null,
    };
  }

  it("アタックステップのフラッシュ窓では use_magic が提示される", () => {
    const state = baseState("attack");
    const actions = actionsFor(state, "alice");
    const action = actions.find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C08"
    );
    expect(action).toBeDefined();
  });

  it("場の作戦に無償の use_field_card_effect は提示されない", () => {
    expect(
      actionsFor(baseState("attack"), "alice").some(
        (a) =>
          a.kind === "use_field_card_effect" && a.sourceCardNo === "BSAZ01-C08"
      )
    ).toBe(false);
  });

  it("メインステップでは (timingScope 外のため) use_magic が提示されない", () => {
    const state = baseState("main");
    const actions = actionsFor(state, "alice");
    const action = actions.find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C08"
    );
    expect(action).toBeUndefined();
  });

  it("宣言すると flashCardUsageLog に mode:stack で記録される (engine-field-magic-self-placement 用 SSOT)", () => {
    const state = baseState("attack");
    const action = actionsFor(state, "alice").find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C08"
    )!;
    expect(action).toBeDefined();
    const applied = applyLegalAction({
      state,
      action,
      ...(action?.kind === "use_magic"
        ? {
            paymentSources: [
              { kind: "reserve" as const, amount: action.finalCost },
            ],
          }
        : {}),
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      ...effectLookups,
    });
    expect(applied.state.flashCardUsageLog).toContainEqual(
      expect.objectContaining({
        playerId: "alice",
        cardInstanceId: "c08-field",
        cardDefinitionId: "BSAZ01-C08",
        mode: "stack",
      })
    );
  });

  it("C05 が選んだバトル中2体の片方を作戦マジックで効果耐性にすると、耐性のない1体だけ破壊し後続の手札破棄は行わない", () => {
    const c08 = createCardInstance(C08, {
      instanceId: "c08-operation",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const c05 = createCardInstance(cardNoMap.get("BSAZ01-C05")!, {
      instanceId: "c05-response",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(ALICE_SPIRIT, {
      instanceId: "attacking-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const combinedTarget = {
      ...createCardInstance(COMBINED_TARGET, {
        instanceId: "combined-target",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["combined-target-brave"],
    };
    const brave = {
      ...createCardInstance(cardNoMap.get("BSES01-C02")!, {
        instanceId: "combined-target-brave",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        zoneRoleName: "brave",
      }),
      attachedToInstanceId: "combined-target",
    };
    const aliceHand = createCardInstance(ALICE_SPIRIT, {
      instanceId: "alice-hand-c08-stack",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const bobHand = createCardInstance(ALICE_SPIRIT, {
      instanceId: "bob-hand-c08-stack",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          c08,
          c05,
          attacker,
          combinedTarget,
          brave,
          aliceHand,
          bobHand,
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 5, handCount: 2 },
          { handCount: 1, reserveNormalCoreCount: 5 },
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_after_block",
      activeAttack: {
        attackId: "attack-group:c08-stack:bob:battle-entity:combined-target",
        attackerInstanceId: "attacking-spirit",
        blockerInstanceId: "combined-target",
        windowState: "flash_after_block",
        primaryEntityId: "battle-entity:attacking-spirit",
        participantEntityIds: ["battle-entity:attacking-spirit"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:attacking-spirit",
            blockedByEntityIds: ["battle-entity:combined-target"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:attacking-spirit"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "after_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
      battleEntities: [
        {
          entityId: "battle-entity:attacking-spirit",
          controllerPlayerId: "alice",
          memberInstanceIds: ["attacking-spirit"],
          resolvedBp: 2000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:combined-target",
          controllerPlayerId: "bob",
          memberInstanceIds: ["combined-target", "combined-target-brave"],
          resolvedBp: 2000,
          resolvedSymbols: ["yellow"],
          attackState: "blocking",
        },
      ],
    };

    const c05Action = actionsFor(state, "alice").find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "c05-response"
    );
    expect(c05Action).toBeDefined();
    if (!c05Action || c05Action.kind !== "use_magic") return;

    let current = applyLegalAction({
      state,
      action: c05Action,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      targetInstanceIds: ["attacking-spirit", "combined-target"],
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      ...effectLookups,
    }).state;
    expect(
      current.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({
      actionKind: "magic",
      cardInstanceId: "c05-response",
      targetInstanceIds: ["attacking-spirit", "combined-target"],
    });

    const c08Action = actionsFor(current, "bob").find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "c08-operation"
    );
    expect(c08Action).toBeDefined();
    if (!c08Action || c08Action.kind !== "use_magic") return;
    current = applyLegalAction({
      state: current,
      action: c08Action,
      paymentSources: [{ kind: "reserve", amount: c08Action.finalCost }],
      targetInstanceIds: ["combined-target"],
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      ...effectLookups,
    }).state;
    expect(
      collectGameStateInvariantIssues(current).some(
        (issue) =>
          issue.code ===
          "active_attack_flash_pending_field_effect_card_not_on_field"
      )
    ).toBe(false);

    for (let i = 0; i < 4; i += 1) {
      const flashWindowState = current.activeAttack?.flashWindowState;
      if (flashWindowState?.pendingStackAction === null) break;
      const pass = actionsFor(current, flashWindowState.priorityPlayerId).find(
        (action) => action.kind === "pass_battle_flash"
      );
      expect(pass).toBeDefined();
      if (!pass) return;
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById: getCardDefinitionByIdWithSpirits,
        ...effectLookups,
      }).state;
    }

    expect(
      current.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "c08-operation"
      )?.zone
    ).toBe("trash");
    expect(
      current.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "c05-response"
      )?.zone
    ).toBe("trash");
    expect(
      current.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "attacking-spirit"
      )?.zone
    ).toBe("trash");
    expect(
      current.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "combined-target"
      )?.zone
    ).toBe("field");
    expect(
      current.log.some((entry) => entry.includes("magic:effect-fizzled:"))
    ).toBe(false);
    expect(
      current.players.find((player) => player.id === "alice")?.handCount
    ).toBe(1);
    expect(
      current.players.find((player) => player.id === "bob")?.handCount
    ).toBe(1);
    expect(
      current.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "alice-hand-c08-stack"
      )?.zone
    ).toBe("hand");
    expect(
      current.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-hand-c08-stack"
      )?.zone
    ).toBe("hand");
    expect(
      current.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
  });
});

describe("BSAZ01-C08 [board] 手札使用(メイン)で「KG-6 スレイプニール」1枚をコスト不要で召喚する", () => {
  it("summon の from_zone (hand/trash) から実召喚される", () => {
    const target = Array.from(cardNoMap.values()).find((c) =>
      c.name.includes("スレイプニール")
    );
    expect(target).toBeDefined();
    const c08Hand = createCardInstance(C08, {
      instanceId: "c08-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handSleipnir = createCardInstance(target!, {
      instanceId: "hand-sleipnir-c08",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [c08Hand, handSleipnir],
        playerOverrides: [{ reserveNormalCoreCount: 4 }],
      }),
      step: "main",
      activePlayerId: "alice",
    };
    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "c08-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "main",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const summoned = result.state.cardInstances.find(
      (c) => c.instanceId === "hand-sleipnir-c08"
    )!;
    expect(summoned.zone).toBe("field");
  });
});
