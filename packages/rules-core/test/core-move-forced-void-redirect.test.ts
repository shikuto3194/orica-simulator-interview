import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  generateSoulCoreOutsideGame,
  getAvailableBraveCombineLegalActions,
  moveNormalCores,
  moveSoulCore,
  resolveCardLeavesFieldCores,
  applyCardCostPayments,
} from "../src";
import { applyEnterFieldCorePlacements } from "../src/zone/enter-field-placement-execution";
import {
  getAvailableLifeCoreMoveChoices,
  moveLifeCoreByEffect,
} from "../src/core/core-system";
import { executeCoreMove } from "../src/effect/structured-core-move";
import { executeCoreDistribute } from "../src/effect/native-move-core-handlers";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeSummonSelf } from "../src/effect/structured-summon";
import { canAutoExecuteSummonFromZoneCandidate } from "../src/effect/summon-from-zone-candidates";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { CardDefinition, CardInstance } from "../src";
import type { DSL, Effect } from "../src/dsl-types";

// ENGINE-token-independent-core-void-redirect (deep mode iteration 1-3):
// BSKB01-T01「このカード/スピリットはコアを、出すとき以外で置けず、移動するとき/
// このスピリットがフィールドを離れるとき、ボイドに置かなければならない」の
// 「移動するとき」半分（moveNormalCores 単一 choke point での強制ボイド上書き）。
// iteration 2: choke point 自体に加え、実際の呼び出し元（コスト支払い等、from:card
// で他カードへコアを動かし得る経路）へ getCardDefinitionById を配線し、choke point
// が実際の効果解決経路でも効くことを確認する。
// iteration 3: 「出すとき以外で置けず」の配置制限半分（moveNormalCores 単一 choke
// point の to 側で強制禁止）。enter-field 配置ヘルパー
// (`applyEnterFieldCorePlacements` / structured-summon.ts の auto 配置) は
// allowEnterFieldOnlyPlacementDestination を opt-in し、to 側だけを許可する一方、
// source 側の forced-void token は実配置 source として拒否/skip する。

const ALICE = "player-1";
const BOB = "player-2";

function tokenDef(
  redirect = true,
  placementRestricted = false
): CardDefinition {
  return {
    cardNo: "TEST-T01",
    name: "Test Token",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 5,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
    textLines: [],
    keywordTags: [],
    images: {},
    tribe: "",
    tokenIndependentCoreManagement:
      redirect || placementRestricted
        ? {
            redirectCoresToVoid: redirect,
            placementRestrictedToEnterField: placementRestricted,
          }
        : undefined,
  } as CardDefinition;
}

function plainDef(): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    keywordTags: [],
    images: {},
    tribe: "",
  } as CardDefinition;
}

function braveDef(): CardDefinition {
  return {
    ...plainDef(),
    cardNo: "TEST-BRAVE",
    name: "Test Brave",
    printedCategory: "brave",
  } as CardDefinition;
}

function fieldCard(
  def: CardDefinition,
  instanceId: string,
  owner = ALICE,
  cores = 1,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function getPlayer(state: ReturnType<typeof createEmptyGameState>, id: string) {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: ReturnType<typeof createEmptyGameState>, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function lookupById(defs: Record<string, CardDefinition>) {
  return (id: string) => defs[id];
}

describe("moveNormalCores: forced core void redirect (tokenIndependentCoreManagement)", () => {
  it("redirects an effect-driven move off a flagged card to void, ignoring the requested destination", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 2)],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "card", instanceId: "t1" },
      { kind: "reserve", playerId: ALICE },
      2,
      lookupById({ [def.cardNo]: def })
    );

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(2);
  });

  it("does not redirect when getCardDefinitionById is omitted (backward compatible no-op)", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 2)],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "card", instanceId: "t1" },
      { kind: "reserve", playerId: ALICE },
      2
    );

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(2);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(0);
  });

  it("does not redirect cards without the flag (regular spirits keep their destination)", () => {
    const def = plainDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "s1", ALICE, 2)],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "card", instanceId: "s1" },
      { kind: "reserve", playerId: ALICE },
      2,
      lookupById({ [def.cardNo]: def })
    );

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(2);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(0);
  });

  it("leaves a move that is already targeting void untouched", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 1)],
      playerOverrides: [{ voidNormalCoreCount: 0 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "card", instanceId: "t1" },
      { kind: "void", playerId: ALICE },
      1,
      lookupById({ [def.cardNo]: def })
    );

    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(1);
  });
});

describe("resolveCardLeavesFieldCores: forced core void redirect on leave-field", () => {
  it("sends a flagged card's cores to void instead of the controller's reserve", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 3)],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = resolveCardLeavesFieldCores(
      state,
      "t1",
      null,
      lookupById({ [def.cardNo]: def })
    );

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(3);
  });

  it("keeps default reserve destination for a card without the flag", () => {
    const def = plainDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "s1", ALICE, 3)],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = resolveCardLeavesFieldCores(
      state,
      "s1",
      null,
      lookupById({ [def.cardNo]: def })
    );

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(3);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(0);
  });
});

describe("applyCardCostPayments: forced core void redirect through a real caller", () => {
  it("redirects a flagged card's core used as cost payment source to void instead of trash", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 1)],
      playerOverrides: [{ trashNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = applyCardCostPayments({
      state,
      actingPlayerId: ALICE,
      chainId: "test-chain",
      paymentSources: [{ kind: "card", instanceId: "t1", amount: 1 }],
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
    });

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(1);
  });

  it("keeps the normal trash destination for cost payment from a card without the flag", () => {
    const def = plainDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "s1", ALICE, 1)],
      playerOverrides: [{ trashNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = applyCardCostPayments({
      state,
      actingPlayerId: ALICE,
      chainId: "test-chain",
      paymentSources: [{ kind: "card", instanceId: "s1", amount: 1 }],
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
    });

    expect(getCard(next, "s1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(0);
  });
});

describe("moveNormalCores: enter-field-only placement restriction (tokenIndependentCoreManagement)", () => {
  it("blocks a placement onto a flagged card when getCardDefinitionById is supplied (no-op, state unchanged rather than throw)", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "reserve", playerId: ALICE },
      { kind: "card", instanceId: "t1" },
      1,
      lookupById({ [def.cardNo]: def })
    );

    expect(next).toBe(state);
    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(2);
  });

  it("allows the placement when getCardDefinitionById is omitted (enter-field helpers stay exempt)", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "reserve", playerId: ALICE },
      { kind: "card", instanceId: "t1" },
      1
    );

    expect(getCard(next, "t1").normalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(1);
  });

  it("allows enter-field destination while preserving source forced-void redirects", () => {
    const token = tokenDef(true, true);
    const plain = plainDef();
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(token, "token-source", ALICE, 1),
        fieldCard(plain, "plain-destination", ALICE, 0),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "card", instanceId: "token-source" },
      { kind: "card", instanceId: "plain-destination" },
      1,
      lookupById({ [token.cardNo]: token, [plain.cardNo]: plain }),
      { allowEnterFieldOnlyPlacementDestination: true }
    );

    expect(getCard(next, "token-source").normalCoreCount).toBe(0);
    expect(getCard(next, "plain-destination").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(1);
  });

  it("allows the actual enter-field placement path (applyEnterFieldCorePlacements) onto a flagged card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });

    const next = applyEnterFieldCorePlacements({
      state,
      actingPlayerId: ALICE,
      destinationInstanceId: "t1",
      placements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
    });

    expect(getCard(next, "t1").normalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
  });

  it("rejects a forced-void card as an actual enter-field placement source", () => {
    const token = tokenDef(true, true);
    const plain = plainDef();
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(token, "token-source", ALICE, 1),
        fieldCard(plain, "plain-destination", ALICE, 0),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });

    expect(() =>
      applyEnterFieldCorePlacements({
        state,
        actingPlayerId: ALICE,
        destinationInstanceId: "plain-destination",
        placements: [
          { kind: "card_normal", instanceId: "token-source", amount: 1 },
        ],
        getCardDefinitionById: lookupById({
          [token.cardNo]: token,
          [plain.cardNo]: plain,
        }),
      })
    ).toThrow(/redirect moved cores to void/);
  });

  it("rejects a forced-void card's soul core as an enter-field placement source", () => {
    const token = tokenDef(true, true);
    const plain = plainDef();
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(token, "token-source", ALICE, 0),
        fieldCard(plain, "plain-destination", ALICE, 0),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "token-source" },
        },
      ],
    });

    expect(() =>
      applyEnterFieldCorePlacements({
        state,
        actingPlayerId: ALICE,
        destinationInstanceId: "plain-destination",
        placements: [{ kind: "card_soul", instanceId: "token-source" }],
        getCardDefinitionById: lookupById({
          [token.cardNo]: token,
          [plain.cardNo]: plain,
        }),
      })
    ).toThrow(/redirect moved cores to void/);
  });

  it("keeps structured summon auto-placement searching after skipping a forced-void token source", () => {
    const token = tokenDef(true, true);
    const plain = plainDef();
    const target = {
      ...plainDef(),
      cardNo: "TEST-SUMMON-TARGET",
      name: "Test Summon Target",
      printedCost: 0,
      cost: 0,
    } as CardDefinition;
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(token, "token-source", ALICE, 1),
        createCardInstance(target, {
          instanceId: "summon-target",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "hand",
          normalCoreCount: 0,
        }),
        fieldCard(plain, "plain-source", ALICE, 1),
      ],
      playerOverrides: [
        {
          handCount: 1,
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 0,
        },
      ],
    });

    const next = executeSummonSelf(
      state,
      "test:core-move-forced-void-redirect:450",
      ALICE,
      {
        kind: "summon",
        target: "self",
        zone: "hand",
        withoutCost: true,
      },
      "summon-target",
      lookupById({
        [token.cardNo]: token,
        [plain.cardNo]: plain,
        [target.cardNo]: target,
      }),
      undefined,
      [{ kind: "card_normal", instanceId: "plain-source", amount: 1 }]
    );

    expect(getCard(next, "summon-target").zone).toBe("field");
    expect(getCard(next, "summon-target").normalCoreCount).toBe(1);
    expect(getCard(next, "token-source").normalCoreCount).toBe(1);
    expect(getCard(next, "plain-source").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(0);
  });

  it("does not mark from-zone auto summon executable when only a redirecting token source exists", () => {
    const token = tokenDef(true, true);
    const target = {
      ...plainDef(),
      cardNo: "TEST-FROM-ZONE-TARGET",
      name: "Test From Zone Target",
      printedCost: 0,
      cost: 0,
    } as CardDefinition;
    const candidate = createCardInstance(target, {
      instanceId: "from-zone-target",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      cardInstances: [fieldCard(token, "token-source", ALICE, 1), candidate],
      playerOverrides: [
        {
          handCount: 1,
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 0,
        },
      ],
    });

    expect(
      canAutoExecuteSummonFromZoneCandidate({
        state,
        actingPlayerId: ALICE,
        action: {
          kind: "summon",
          target: "other",
          zone: "hand",
          withoutCost: true,
        },
        candidate,
        getCardDefinitionById: lookupById({
          [token.cardNo]: token,
          [target.cardNo]: target,
        }),
      })
    ).toBe(false);
  });

  it("does not restrict placement onto cards without the flag", () => {
    const def = plainDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "s1", ALICE, 0)],
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "reserve", playerId: ALICE },
      { kind: "card", instanceId: "s1" },
      1,
      lookupById({ [def.cardNo]: def })
    );

    expect(getCard(next, "s1").normalCoreCount).toBe(1);
  });

  it("blocked placement (no-op) does not fire a conditional_result step chained after core_move (round3 verifier concern, refuted by code trace and reconfirmed here)", () => {
    // didNonCardActionChangeState("core_move") は pre/post の players/cardInstances 差分のみを
    // 見る (native-effect-front-helpers.ts:113)。moveNormalCores が state を完全に不変で返せば
    // stepSucceeded=false が正しく導出され、conditional_result 後続 (count_increase) は
    // 発火しないはず。generic core_move DSL (任意のカードが将来 T01 を対象にし得る) を
    // executeEffect 経由で通し、実際の interpreter パイプラインで検証する。
    const def = tokenDef(false, true);
    const sourceDef: CardDefinition = {
      cardNo: "TEST-SRC",
      name: "Test Source",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      textLines: [],
      keywordTags: [],
      images: {},
      tribe: [],
    } as CardDefinition;
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            to: { kind: "card_instance", instanceId: "t1" },
            amount: 1,
          },
        },
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
          connector: "conditional_result",
        },
      ],
    };
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(def, "t1", ALICE, 0),
        fieldCard(sourceDef, "src", ALICE, 0),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 1, countValue: 0 }],
    });
    const lookup = lookupById({
      [def.cardNo]: def,
      [sourceDef.cardNo]: sourceDef,
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:587",
      state,
      effect,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    // core_move 自体が no-op (state 不変) だったことの確認。
    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(1);
    // conditional_result 後続の count_increase は発火しない (前提 step が失敗扱い)。
    expect(getPlayer(next, ALICE).countValue).toBe(0);
  });

  it("effect core_move to:field_card single-target path also blocks non-enter-field placement onto a flagged card", () => {
    const def = tokenDef(false, true);
    const sourceDef: CardDefinition = {
      ...plainDef(),
      cardNo: "TEST-SRC-FIELD-CARD",
      name: "Test Source Field Card",
      printedCategory: "nexus",
    } as CardDefinition;
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "field_card",
              player: "self",
              filter: { category: ["spirit"] },
            },
            amount: 1,
          },
        },
      ],
    };
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(def, "t1", ALICE, 0),
        fieldCard(sourceDef, "src", ALICE, 0),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });
    const lookup = lookupById({
      [def.cardNo]: def,
      [sourceDef.cardNo]: sourceDef,
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:640",
      state,
      effect,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(1);
  });

  it("effect core_move reserve->this_card blocks non-enter-field placement onto a flagged source card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:660",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "t1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(1);
  });

  it("effect core_move trash->this_card blocks non-enter-field placement onto a flagged source card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ trashNormalCoreCount: 1 }],
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:692",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "t1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).trashNormalCoreCount).toBe(1);
  });

  it("effect core_move life->this_card blocks non-enter-field placement onto a flagged source card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ lifeNormalCoreCount: 1 }],
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:724",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "t1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(1);
  });

  it("effect core_move trash soul->this_card blocks non-enter-field placement onto a flagged source card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ soulCoreLocation: { kind: "trash" } }],
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:756",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "t1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(next, "t1").soulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "trash",
    });
    expect(getPlayer(next, ALICE).trashSoulCoreCount).toBe(1);
  });

  it("effect core_move life soul->this_card blocks non-enter-field placement onto a flagged source card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [
        { lifeNormalCoreCount: 0, soulCoreLocation: { kind: "life" } },
      ],
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:793",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "t1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(next, "t1").soulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "life",
    });
    expect(getPlayer(next, ALICE).lifeSoulCoreCount).toBe(1);
  });

  it("effect core_move card_instance soul->card_instance blocks non-enter-field placement onto a flagged destination card", () => {
    const sourceDef = plainDef();
    const destDef = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(sourceDef, "src", ALICE, 0),
        fieldCard(destDef, "t1", ALICE, 0),
      ],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "src" } },
      ],
    });

    const next = executeCoreMove(
      state,
      ALICE,
      { kind: "card_instance", instanceId: "src" },
      { kind: "card_instance", instanceId: "t1" },
      1,
      "src",
      undefined,
      undefined,
      lookupById({ [sourceDef.cardNo]: sourceDef, [destDef.cardNo]: destDef })
    );

    expect(getCard(next, "src").soulCoreCount).toBe(1);
    expect(getCard(next, "t1").soulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "src",
    });
  });

  it("core_set_to_level skips a placement-restricted card without consuming void cores", () => {
    const def = {
      ...tokenDef(false, true),
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 8000 },
        { level: 2, requiredCores: 2, bp: 10000 },
      ],
    } as CardDefinition;
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ voidNormalCoreCount: 2 }],
    });

    const next = executeEffect({
      chainId: "test:core-move-forced-void-redirect:867",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_set_to_level",
              from: { kind: "void", player: "self" },
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: "all",
              },
              level: 2,
            },
          },
        ],
      },
      sourceInstanceId: "t1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["t1"],
    });

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(2);
    expect(next.log.some((entry) => entry.includes("core_set_to_level"))).toBe(
      false
    );
  });

  it("life-core choice generation excludes normal and soul cores for non-enter-field placement onto a flagged card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          soulCoreLocation: { kind: "life" },
        },
      ],
    });

    expect(
      getAvailableLifeCoreMoveChoices({
        state,
        playerId: ALICE,
        destination: { kind: "card", instanceId: "t1" },
        effectKind: "generic",
        getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      })
    ).toEqual([]);
  });

  it("moveLifeCoreByEffect rejects non-enter-field placement onto a flagged card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ lifeNormalCoreCount: 1 }],
    });

    expect(() =>
      moveLifeCoreByEffect({
        state,
        playerId: ALICE,
        destination: { kind: "card", instanceId: "t1" },
        effectKind: "generic",
        getCardDefinitionById: lookupById({ [def.cardNo]: def }),
      })
    ).toThrow(/No life core can move/);
    expect(getCard(state, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(state, ALICE).lifeNormalCoreCount).toBe(1);
  });

  it("moveSoulCore blocks non-enter-field placement onto a flagged card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });

    const next = moveSoulCore(
      state,
      ALICE,
      { kind: "reserve", playerId: ALICE },
      { kind: "card", instanceId: "t1" },
      1,
      lookupById({ [def.cardNo]: def })
    );

    expect(next).toBe(state);
    expect(getCard(next, "t1").soulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveSoulCoreCount).toBe(1);
  });

  it("generateSoulCoreOutsideGame blocks non-enter-field generation onto a flagged card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
    });

    const next = generateSoulCoreOutsideGame(
      state,
      ALICE,
      { kind: "card", instanceId: "t1" },
      1,
      lookupById({ [def.cardNo]: def })
    );

    expect(next).toBe(state);
    expect(getCard(next, "t1").soulCoreCount).toBe(0);
  });

  it("field destination candidate collection excludes flagged cards before opening soul-core distribution pending", () => {
    const flagged = tokenDef(false, true);
    const plain = plainDef();
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(flagged, "t1", ALICE, 0),
        fieldCard(plain, "s1", ALICE, 0),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });

    const next = executeCoreMove(
      state,
      ALICE,
      { kind: "reserve", player: "self" },
      { kind: "field", player: "self" },
      1,
      "source",
      undefined,
      undefined,
      lookupById({ [flagged.cardNo]: flagged, [plain.cardNo]: plain })
    );

    expect(
      next.pendingCoreDistribution?.candidates.map((entry) => entry.instanceId)
    ).toEqual(["s1"]);
  });

  it("outside_game soul-core generation to field_card treats a flagged card as no target", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
    });

    const next = executeCoreMove(
      state,
      ALICE,
      { kind: "outside_game" },
      {
        kind: "field_card",
        player: "self",
        filter: { category: ["spirit"] },
      },
      1,
      "source",
      undefined,
      undefined,
      lookupById({ [def.cardNo]: def })
    );

    expect(next.pendingCoreDistribution).toBeNull();
    expect(getCard(next, "t1").soulCoreCount).toBe(0);
    expect(next.log).toContain(
      `effect:core_move:outside_game->field:${ALICE}:0:no-targets`
    );
  });

  it("applyEnterFieldCorePlacements allows reserve soul placement onto a flagged card", () => {
    const def = tokenDef(false, true);
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });

    const next = applyEnterFieldCorePlacements({
      state,
      actingPlayerId: ALICE,
      destinationInstanceId: "t1",
      placements: [{ kind: "reserve_soul" }],
      getCardDefinitionById: lookupById({ [def.cardNo]: def }),
    });

    expect(getCard(next, "t1").soulCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "t1",
    });
  });

  it("brave combine candidates exclude a placement-restricted host when the incoming brave has cores to move", () => {
    const hostDef = tokenDef(false, true);
    const incomingDef = braveDef();
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(hostDef, "host", ALICE, 1),
        fieldCard(incomingDef, "brave", ALICE, 1),
      ],
    });
    const lookup = lookupById({
      [hostDef.cardNo]: hostDef,
      [incomingDef.cardNo]: incomingDef,
    });

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    expect(actions).toEqual([]);
  });

  it("executeBraveCombine does not attach after a placement-restricted host blocks the required core transfer", () => {
    const hostDef = tokenDef(false, true);
    const incomingDef = braveDef();
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard(hostDef, "host", ALICE, 1),
        fieldCard(incomingDef, "brave", ALICE, 1),
      ],
    });
    const lookup = lookupById({
      [hostDef.cardNo]: hostDef,
      [incomingDef.cardNo]: incomingDef,
    });

    const next = executeBraveCombine(state, ALICE, "brave", "host", lookup);

    expect(next).toBe(state);
    expect(getCard(next, "brave").attachedToInstanceId).toBeNull();
    expect(getCard(next, "brave").normalCoreCount).toBe(1);
    expect(getCard(next, "host").attachedChildrenIds).toEqual([]);
    expect(getCard(next, "host").normalCoreCount).toBe(1);
  });
});

describe("executeCoreDistribute: attached combined child destination normalization", () => {
  it("does not open a zero-candidate pending when resolved targets collapse to only an attached child brave", () => {
    const hostDef = plainDef();
    const braveDef = {
      ...plainDef(),
      cardNo: "TEST-BRAVE",
      name: "Test Brave",
      printedCategory: "brave",
    } as CardDefinition;
    const host = fieldCard(hostDef, "host", ALICE, 2, {
      attachedChildrenIds: ["brave"],
    });
    const brave = fieldCard(braveDef, "brave", ALICE, 1, {
      attachedToInstanceId: "host",
    });
    const state = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "host" } },
      ],
    });
    const action: DSL.CoreDistributeAction = {
      kind: "core_distribute",
      from: {
        kind: "field",
        player: "self",
        filter: { category: ["spirit"] },
      },
      to: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"] },
        count: "all",
      },
      amount: 1,
      mode: "player_choice",
    };

    const next = executeCoreDistribute(
      action,
      state,
      ALICE,
      "host",
      lookupById({
        [hostDef.cardNo]: hostDef,
        [braveDef.cardNo]: braveDef,
      }),
      createStepExecutionContext(state),
      ["brave"]
    );

    expect(next.pendingCoreDistribution).toBeNull();
    expect(next.log).toContain(
      "effect:core_distribute:field:no_destination_targets:1->0"
    );
  });

  it("derives field-source pending destination owner from normalized targets after placement-restricted cards are removed", () => {
    const sourceDef = plainDef();
    const restrictedDef = tokenDef(false, true);
    const destinationDef = {
      ...plainDef(),
      cardNo: "TEST-DEST",
      name: "Test Destination",
    } as CardDefinition;
    const source = fieldCard(sourceDef, "source", ALICE, 2);
    const ownRestrictedTarget = fieldCard(
      restrictedDef,
      "own-restricted-target",
      ALICE,
      1
    );
    const opponentDestination = fieldCard(
      destinationDef,
      "opponent-destination",
      BOB,
      1
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, ownRestrictedTarget, opponentDestination],
    });
    const action: DSL.CoreDistributeAction = {
      kind: "core_distribute",
      from: {
        kind: "field",
        player: "self",
        filter: { category: ["spirit"] },
      },
      to: { kind: "target_card" },
      amount: 1,
      mode: "player_choice",
    };

    const next = executeCoreDistribute(
      action,
      state,
      ALICE,
      "source",
      lookupById({
        [sourceDef.cardNo]: sourceDef,
        [restrictedDef.cardNo]: restrictedDef,
        [destinationDef.cardNo]: destinationDef,
      }),
      createStepExecutionContext(state),
      ["own-restricted-target", "opponent-destination"]
    );

    const pending = next.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(
      pending!.candidates.map((candidate) => candidate.instanceId)
    ).toEqual(["opponent-destination"]);
    expect(pending!.fromPlayerId).toBe(ALICE);
    expect(pending!.toPlayerId).toBe(BOB);
  });
});

// iteration 5: handleFieldCoreShoot（field 源コアシュート）は moveNormalCores を経由せず
// cardInstances/players を直接書き換える別経路のため、choke point 配線だけでは効かない
// (round2 verifier 指摘で iteration4 stub 解消は revert 済)。distMap (player-selected)/
// coreTakes (auto-fallback) の両分岐にソースカード単位の判定を追加し、BSKB01-T01 から
// 相手のコアシュートで奪われたコアも常にそのカード持ち主の void へ振り替わることを検証する。
describe("executeCoreMove (field-source coreshoot): forced core void redirect on stolen cores", () => {
  it("auto-fallback (single candidate): opponent's coreshoot off a flagged card redirects to its owner's void, not the attacker's destination", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [fieldCard(def, "t1", ALICE, 2)],
      playerOverrides: [
        { voidNormalCoreCount: 0 },
        { reserveNormalCoreCount: 0 },
      ],
    });

    const next = executeCoreMove(
      state,
      BOB,
      { kind: "field", player: "opponent" },
      { kind: "reserve", player: "self" },
      2,
      "bob-source",
      undefined,
      undefined,
      lookupById({ [def.cardNo]: def })
    );

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getPlayer(next, BOB).reserveNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(2);
    expect(
      next.log.some((l) =>
        l.startsWith(`effect:core_move:field:forced_void_redirect:${ALICE}:2`)
      )
    ).toBe(true);
  });

  it("player-selected distribution: only the flagged source's share is redirected, the rest still reaches the chosen destination", () => {
    const flagged = tokenDef();
    const plain = plainDef();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        fieldCard(flagged, "t1", ALICE, 2),
        fieldCard(plain, "s1", ALICE, 1),
      ],
      playerOverrides: [
        { voidNormalCoreCount: 0 },
        { reserveNormalCoreCount: 0 },
      ],
    });

    const next = executeCoreMove(
      state,
      BOB,
      { kind: "field", player: "opponent" },
      { kind: "reserve", player: "self" },
      3,
      "bob-source",
      { t1: 2, s1: 1 },
      undefined,
      lookupById({ [flagged.cardNo]: flagged, [plain.cardNo]: plain })
    );

    expect(getCard(next, "t1").normalCoreCount).toBe(0);
    expect(getCard(next, "s1").normalCoreCount).toBe(0);
    expect(getPlayer(next, BOB).reserveNormalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(2);
  });
});

// ENGINE-void-soul-core-count: 10_rules/06「ボイドは常に不可。explicit 指定でも soul を
// ボイドに置けない」は generic「コア」に soul を含む場合の唯一の例外なしの硬制約
// (BS36 Q5941)。BSKB01-T01 のテキスト「コアを...ボイドに置かなければならない」も generic
// 表記のため、この硬制約下では通常コアのみが対象になり (§41-42 の「行き先がボイドの
// generic 効果では通常コア強制」)、ソウルコアは hasForcedCoreVoidRedirect が立っていても
// 常に非ボイドの通常行き先 (genericSoulDestination SSOT) のまま扱う。
// adversarial verifier (round1 lens1/6, BSKB01-T01) がソウルコアを強制ボイド振替する
// 誤実装を反証したため、正しい（振替しない）挙動を固定するリグレッションテスト。
describe("moveSoulCore / resolveCardLeavesFieldCores: soul cores are never redirected to void, even off a hasForcedCoreVoidRedirect card", () => {
  it("moveSoulCore keeps the requested non-void destination for a flagged card's soul core", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "t1" } },
      ],
    });

    const next = moveSoulCore(
      state,
      ALICE,
      { kind: "card", instanceId: "t1" },
      { kind: "reserve", playerId: ALICE },
      1
    );

    expect(getPlayer(next, ALICE).reserveSoulCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });

  it("resolveCardLeavesFieldCores sends the flagged card holder's soul core to reserve, not void", () => {
    const def = tokenDef();
    const state = createEmptyGameState({
      cardInstances: [fieldCard(def, "t1", ALICE, 0)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "t1" } },
      ],
    });

    const next = resolveCardLeavesFieldCores(
      state,
      "t1",
      null,
      lookupById({ [def.cardNo]: def })
    );

    expect(getCard(next, "t1").soulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveSoulCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });
});
