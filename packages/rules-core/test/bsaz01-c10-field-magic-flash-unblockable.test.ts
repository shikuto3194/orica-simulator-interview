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
  calculateReduction,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C10 = cardNoMap.get("BSAZ01-C10")!;
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
    getCardDefinitionByIdWithSpirit
  );
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
    ...effectLookups,
  });
}

function makeEarthCfSpirit(cardNo: string): CardDefinition {
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
    tribe: "地球・ＣＦ",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const EARTH_CF_SPIRIT = makeEarthCfSpirit("TEST-EARTH-CF");

const getCardDefinitionByIdWithSpirit = (id: string) =>
  cardNoMap.get(id) ??
  (id === EARTH_CF_SPIRIT.cardNo ? EARTH_CF_SPIRIT : undefined);

describe("BSAZ01-C10 effects[1]: 使用時の印字済み軽減枠充足", () => {
  it("effect 定義: treat_as reduction_symbol + waivesReductionRequirement + count(cards_in_zone field/self/magic)", () => {
    const effect = C10.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 0 &&
        e.steps.length > 0 &&
        e.steps[0]!.action.kind === "treat_as"
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("treat_as");
    if (action.kind !== "treat_as") throw new Error("unreachable");
    expect(action.asColor).toBe("yellow");
    expect(action.waivesReductionRequirement).toBe(true);
    expect(action.count).toEqual({
      source: {
        kind: "cards_in_zone",
        zone: "field",
        player: "self",
        filter: { category: ["magic"] },
      },
    });
  });

  it("自分のフィールドにマジックが2枚あれば軽減2枠を上限に支払いが減る", () => {
    const other = { ...C10, cardNo: "TEST-OTHER-MAGIC" } as CardDefinition;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(other, {
          instanceId: "field-magic-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(other, {
          instanceId: "field-magic-2",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });
    state.cardInstances.push(
      createCardInstance(C10, {
        instanceId: "paying",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const result = calculateReduction({
      card: C10,
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) =>
        id === other.cardNo ? other : getCardDefinitionById(id),
      sourceInstanceId: "paying",
    });
    expect(result.reducedCost).toBe(
      Math.max(0, C10.cost - Math.min(2, C10.reductionSymbols.length))
    );
    expect(result.totalReduction).toBe(
      Math.min(2, C10.reductionSymbols.length)
    );
  });
});

describe("BSAZ01-C10 effects[2]: フィールド常駐フラッシュ (地球・ＣＦすべてブロックされない)", () => {
  it("effect 定義: applicability.zone:field + timingScope both/attack + unblockable(filter, tribesRequired)", () => {
    const effect = C10.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef.includes(7) &&
        e.steps.length > 0 &&
        e.steps[0]!.action.kind === "unblockable"
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });

    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("unblockable");
    if (action.kind !== "unblockable") throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "filter",
      player: "self",
      filter: { category: ["spirit"], tribesRequired: ["地球", "ＣＦ"] },
      count: "all",
    });
    expect(action.duration).toEqual({ scope: "turn" });
  });

  it("使用許可を無償のフィールド起動効果として登録しない", () => {
    expect(generateFieldCardEffectRegistrations(C10)).toHaveLength(0);
  });

  it("実行すると自分の地球・ＣＦスピリットに unblockable CE (duration:turn) が付与される", () => {
    const spirit = createCardInstance(EARTH_CF_SPIRIT, {
      instanceId: "alice-earth-cf",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const otherTribeSpirit = createCardInstance(
      { ...EARTH_CF_SPIRIT, cardNo: "TEST-OTHER-TRIBE", tribe: "火星" },
      {
        instanceId: "alice-other-tribe",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      }
    );
    const c10Field = createCardInstance(C10, {
      instanceId: "c10-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [spirit, otherTribeSpirit, c10Field],
    });
    const effect = C10.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "flash" &&
        e.steps[0]?.action.kind === "unblockable"
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c10-field-magic-flash-unblockable:205",
      state,
      effect,
      sourceInstanceId: "c10-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithSpirit,
    });
    const unblockableCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "unblockable"
    );
    expect(unblockableCEs).toHaveLength(1);
    expect(unblockableCEs[0]!.targetInstanceId).toBe("alice-earth-cf");
    expect(unblockableCEs[0]!.duration).toEqual({ scope: "turn" });
  });
});

describe("BSAZ01-C10 場残置フラッシュの legal action 提示 (お互いのアタックステップ限定)", () => {
  function baseState(step: GameState["step"]): GameState {
    const c10Field = createCardInstance(C10, {
      instanceId: "c10-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [c10Field],
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
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C10"
    );
    expect(action).toBeDefined();
  });

  it("メインステップでは (timingScope 外のため) use_magic が提示されない", () => {
    const state = baseState("main");
    const actions = actionsFor(state, "alice");
    const action = actions.find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C10"
    );
    expect(action).toBeUndefined();
  });

  it("宣言すると flashCardUsageLog に mode:flash で記録される (engine-field-magic-self-placement 用 SSOT)", () => {
    // 場からも通常使用として記録し、使用後の自己配置判定へ渡す。
    const state = baseState("attack");
    const action = actionsFor(state, "alice").find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C10"
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
      getCardDefinitionById,
      ...effectLookups,
    });
    expect(applied.state.flashCardUsageLog).toContainEqual(
      expect.objectContaining({
        playerId: "alice",
        cardInstanceId: "c10-field",
        cardDefinitionId: "BSAZ01-C10",
        mode: "flash",
      })
    );
  });
});
