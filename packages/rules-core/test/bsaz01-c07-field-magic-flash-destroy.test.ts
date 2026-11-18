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
const C07 = cardNoMap.get("BSAZ01-C07")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const effectLookups = {
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
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
const ALICE_SPIRIT = makeSpirit("TEST-ALICE-SPIRIT");
const BOB_SPIRIT = makeSpirit("TEST-BOB-SPIRIT");

const getCardDefinitionByIdWithSpirits = (id: string) =>
  cardNoMap.get(id) ??
  (id === ALICE_SPIRIT.cardNo
    ? ALICE_SPIRIT
    : id === BOB_SPIRIT.cardNo
      ? BOB_SPIRIT
      : undefined);

describe("BSAZ01-C07 effects[1]: 使用時の印字済み軽減枠充足", () => {
  it("自分のフィールドにマジックが1枚あれば軽減1枠が満たされ支払いが1減る", () => {
    const other = { ...C07, cardNo: "TEST-OTHER-MAGIC-C07" } as CardDefinition;
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
      createCardInstance(C07, {
        instanceId: "paying",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const result = calculateReduction({
      card: C07,
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) =>
        id === other.cardNo ? other : getCardDefinitionById(id),
      sourceInstanceId: "paying",
    });
    expect(result.reducedCost).toBe(
      Math.max(0, C07.cost - Math.min(1, C07.reductionSymbols.length))
    );
    expect(result.totalReduction).toBe(
      Math.min(1, C07.reductionSymbols.length)
    );
  });
});

describe("BSAZ01-C07 effects[2]: メイン (手札/トラッシュの「スレイプニール」1枚をコスト不要召喚)", () => {
  it("effect 定義: mode:main + applicability 省略 (通常の手札使用) + summon from_zone cardName + costModifier:free", () => {
    const effect = C07.effects!.find(
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
    const regs = generateMagicRegistrations(C07);
    const mainRegs = regs.filter((r) => r.timing === "main");
    expect(mainRegs).toHaveLength(1);
  });

  it("[board] 手札使用(メイン)で手札の「KG-6 スレイプニール」1枚をコスト不要で召喚する", () => {
    const target = Array.from(cardNoMap.values()).find((c) =>
      c.name.includes("スレイプニール")
    );
    expect(target).toBeDefined();
    const c07Hand = createCardInstance(C07, {
      instanceId: "c07-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handSleipnir = createCardInstance(target!, {
      instanceId: "hand-sleipnir",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [c07Hand, handSleipnir],
        // C07 のコスト3 (reserve払い) に加え、召喚される「スレイプニール」の
        // フィールド進入時最低コア(Lv1 requiredCores:1)を自動配置する分の予備を確保する。
        playerOverrides: [{ reserveNormalCoreCount: 4 }],
      }),
      step: "main",
      activePlayerId: "alice",
    };
    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "c07-hand",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "main",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const summoned = result.state.cardInstances.find(
      (c) => c.instanceId === "hand-sleipnir"
    )!;
    expect(summoned.zone).toBe("field");
  });
});

describe("BSAZ01-C07 effects[3]/[4]: フラッシュ (自分のスピリット1体を破壊することで、相手のスピリット/アルティメット1体を破壊する)", () => {
  it("effect[3] 定義: mode:flash + applicability 省略 (通常の手札使用) + destroy(self) → conditional_cost destroy(opponent)", () => {
    const effect = C07.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef.length === 2 &&
        e.textRef.includes(10) &&
        e.textRef.includes(11)
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.applicability).toBeUndefined();
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0]!.action.kind).toBe("destroy");
    expect(effect.steps[1]!.action.kind).toBe("destroy");
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
  });

  it("場の作戦は通常使用を許可する常時効果を持つ", () => {
    expect(
      C07.effects!.find((e) =>
        e.steps.some((s) => s.action.kind === "grant_magic_use")
      )
    ).toMatchObject({
      timing: { kind: "continuous" },
      applicability: { zone: "field" },
      timingScope: { player: "both", period: "attack" },
    });
  });

  it("generateMagicRegistrations は timing:flash (手札使用) で1件登録する", () => {
    const regs = generateMagicRegistrations(C07);
    const flashRegs = regs.filter((r) => r.timing === "flash");
    expect(flashRegs).toHaveLength(1);
  });

  it("使用許可を無償のフィールド起動効果として登録しない", () => {
    expect(generateFieldCardEffectRegistrations(C07)).toHaveLength(0);
  });

  it("[board] 実行すると自分のスピリット1体と相手のスピリット1体がどちらも破壊 (pending-leave) される", () => {
    const aliceSpirit = createCardInstance(ALICE_SPIRIT, {
      instanceId: "alice-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobSpirit = createCardInstance(BOB_SPIRIT, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const c07Field = createCardInstance(C07, {
      instanceId: "c07-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [aliceSpirit, bobSpirit, c07Field],
    });
    const effect = C07.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "flash" &&
        e.steps.length === 2
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c07-field-magic-flash-destroy:264",
      state,
      effect,
      sourceInstanceId: "c07-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    // destroy は state-based action での pending-leave flush まで即時ゾーン移動しない
    // (project_pending_leave_owner_chain_model)。ここでは破壊判定そのもの
    // (pendingLeaveEntities への積み上げ) を検証する。
    const pendingInstanceIds = after.pendingLeaveEntities.map(
      (p) => p.instanceId
    );
    expect(pendingInstanceIds).toContain("alice-spirit");
    expect(pendingInstanceIds).toContain("bob-spirit");
  });
});

describe("BSAZ01-C07 場残置フラッシュの legal action 提示 (お互いのアタックステップ限定)", () => {
  function baseState(step: GameState["step"]): GameState {
    const c07Field = createCardInstance(C07, {
      instanceId: "c07-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const aliceSpirit = createCardInstance(ALICE_SPIRIT, {
      instanceId: "alice-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobSpirit = createCardInstance(BOB_SPIRIT, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [c07Field, aliceSpirit, bobSpirit],
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
              flashWindowState: {
                kind: "before_block",
                priorityPlayerId: "alice",
                consecutivePassCount: 0,
                stackResponseSourcePlayerId: "alice",
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
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C07"
    );
    expect(action).toBeDefined();
  });

  it("メインステップでは (timingScope 外のため) use_magic が提示されない", () => {
    const state = baseState("main");
    const actions = actionsFor(state, "alice");
    const action = actions.find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C07"
    );
    expect(action).toBeUndefined();
  });

  it("宣言すると flashCardUsageLog に mode:flash で記録される (engine-field-magic-self-placement 用 SSOT)", () => {
    const state = baseState("attack");
    const action = actionsFor(state, "alice").find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C07"
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
        cardInstanceId: "c07-field",
        cardDefinitionId: "BSAZ01-C07",
        mode: "flash",
      })
    );
  });

  it("応答マジックの支払いで相手側の対象が消滅したら、未選択groupを不発処理して窓を完了する", () => {
    let state = baseState("attack");
    const action = actionsFor(state, "alice").find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === C07.cardNo
    )!;
    expect(action.finalCost).toBe(2);
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances.map((card) =>
          card.instanceId === "alice-spirit"
            ? {
                ...card,
                normalCoreCount: action.finalCost,
                cores: action.finalCost,
              }
            : card.instanceId === "bob-spirit"
              ? { ...card, normalCoreCount: 4, cores: 4 }
              : card
        ),
        createCardInstance(cardNoMap.get("BSRK01-C06")!, {
          instanceId: "bob-response",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    };
    const reserveBefore = state.players[0]!.reserveNormalCoreCount;
    const trashBefore = state.players[0]!.trashNormalCoreCount;
    const bobReserveBefore = state.players[1]!.reserveNormalCoreCount;
    const bobTrashBefore = state.players[1]!.trashNormalCoreCount;
    state = applyLegalAction({
      state,
      action,
      paymentSources: [
        { kind: "field", instanceId: "alice-spirit", amount: action.finalCost },
      ],
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      ...effectLookups,
    }).state;
    expect(
      state.pendingLeaveEntities.map((leave) => leave.instanceId)
    ).toContain("alice-spirit");
    expect(
      state.cardInstances.find((card) => card.instanceId === "alice-spirit")
        ?.zone
    ).toBe("field");
    expect(state.pendingEffectTargetSelection).toBeNull();
    const response = actionsFor(state, "bob").find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "bob-response" &&
        candidate.effectIndex === 2
    )!;
    expect(response).toBeDefined();
    expect(response.finalCost).toBe(4);
    state = applyLegalAction({
      state,
      action: response,
      paymentSources: [
        { kind: "field", instanceId: "bob-spirit", amount: response.finalCost },
      ],
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      ...effectLookups,
    }).state;
    for (
      let index = 0;
      index < 4 && state.activeAttack?.flashWindowState?.pendingStackAction;
      index++
    ) {
      const playerId = state.activeAttack!.flashWindowState!.priorityPlayerId;
      const pass = actionsFor(state, playerId).find(
        (candidate) => candidate.kind === "pass_battle_flash"
      )!;
      expect(pass).toBeDefined();
      state = applyLegalAction({
        state,
        action: pass,
        getCardDefinitionById: getCardDefinitionByIdWithSpirits,
        ...effectLookups,
      }).state;
    }
    expect(
      state.log.some((entry) => entry.endsWith(":unselected-target-groups"))
    ).toBe(true);
    expect(
      state.cardInstances.find((card) => card.instanceId === "c07-field")?.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((card) => card.instanceId === "alice-spirit")
        ?.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((card) => card.instanceId === "bob-spirit")?.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((card) => card.instanceId === "bob-response")
        ?.zone
    ).toBe("trash");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(reserveBefore);
    expect(state.players[0]!.trashNormalCoreCount).toBe(
      trashBefore + action.finalCost
    );
    expect(state.players[1]!.reserveNormalCoreCount).toBe(bobReserveBefore);
    expect(state.players[1]!.trashNormalCoreCount).toBe(
      bobTrashBefore + response.finalCost
    );
    expect(state.pendingLeaveEntities).toHaveLength(0);
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(state.stackWindow).toBeNull();
    expect(state.activeAttack?.flashWindowState?.pendingStackAction).toBeNull();
    expect(
      state.flashCardUsageLog.filter(
        (entry) => entry.cardInstanceId === "c07-field"
      )
    ).toHaveLength(1);
  });
});
