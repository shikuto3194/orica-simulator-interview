import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { calculateReduction } from "../src/core/cost-system";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src";
import {
  getAvailableMagicPaymentSources,
  getMagicCostOverrideSource,
  playMagicCardAsAction,
} from "../src/mechanics/magic-system";
import type { CardDefinition } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const PLAYER = "player-1";
const C17 = card("BSGE01-C17");

function printedCost(
  effectMode: "main" | "flash" | "stack",
  zone: "hand" | "set_aside" = "hand"
): number {
  const source = createCardInstance(C17, {
    instanceId: "bsge01-c17-hand",
    ownerPlayerId: PLAYER,
    controllerPlayerId: PLAYER,
    zone,
  });
  const state = createEmptyGameState({
    playerIds: [PLAYER, "player-2"],
    cardInstances: [source],
  });

  return calculateReduction({
    state,
    actingPlayerId: PLAYER,
    card: C17,
    getCardDefinitionById: getDef,
    sourceInstanceId: source.instanceId,
    effectMode,
  }).printedCost;
}

describe("BSGE01-C17 デッド・プルーフ", () => {
  it("スタック効果使用時だけ自身のコストを3にする", () => {
    expect(printedCost("stack")).toBe(3);
    expect(printedCost("flash")).toBe(4);
    expect(printedCost("main")).toBe(4);
    expect(printedCost("stack", "set_aside")).toBe(3);
    expect(C17.effects?.[0]?.stub).toBeUndefined();
  });

  it("実使用経路でも chosenTiming=stack のコストとして扱う", () => {
    const source = createCardInstance(C17, {
      instanceId: "bsge01-c17-hand",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [source],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: PLAYER,
      magicInstanceId: source.instanceId,
      chosenTiming: "stack",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      resolveEffect: (current) => current,
    });

    expect(result.reduction.finalCost).toBe(3);
  });

  it("支払い元候補の可否判定にも stack コストを使う", () => {
    const source = createCardInstance(C17, {
      instanceId: "bsge01-c17-hand",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [source],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });

    const stackSources = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: PLAYER,
      magicInstanceId: source.instanceId,
      getCardDefinitionById: getDef,
      effectMode: "stack",
    });
    const mainSources = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: PLAYER,
      magicInstanceId: source.instanceId,
      getCardDefinitionById: getDef,
      effectMode: "main",
    });

    expect(stackSources.reduction.finalCost).toBe(3);
    expect(stackSources.canFullyPay).toBe(true);
    expect(mainSources.reduction.finalCost).toBe(4);
    expect(mainSources.canFullyPay).toBe(false);
  });

  it("hand/set_aside の自己 cost override は CE 登録せず direct 読み取りだけで効く", () => {
    const source = createCardInstance(C17, {
      instanceId: "bsge01-c17-hand",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const otherMagic = createCardInstance(card("BSGE01-C16"), {
      instanceId: "other-magic-hand",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [source, otherMagic],
    });

    const withCe = executeEffect({
      chainId: "test:bsge01-c17-stack-cost:141",
      state,
      effect: C17.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: PLAYER,
      getCardDefinitionById: getDef,
    });

    expect(withCe.activeContinuousEffects).toHaveLength(0);
    expect(
      getMagicCostOverrideSource({
        state: withCe,
        actingPlayerId: PLAYER,
        magicInstanceId: source.instanceId,
        getCardDefinitionById: getDef,
        effectMode: "stack",
      })
    ).toBeNull();
    expect(
      getAvailableMagicPaymentSources({
        state: withCe,
        actingPlayerId: PLAYER,
        magicInstanceId: source.instanceId,
        getCardDefinitionById: getDef,
        effectMode: "stack",
      }).reduction.finalCost
    ).toBe(3);
    expect(
      getMagicCostOverrideSource({
        state: withCe,
        actingPlayerId: PLAYER,
        magicInstanceId: source.instanceId,
        getCardDefinitionById: getDef,
        effectMode: "flash",
      })
    ).toBeNull();
    expect(
      getMagicCostOverrideSource({
        state: withCe,
        actingPlayerId: PLAYER,
        magicInstanceId: otherMagic.instanceId,
        getCardDefinitionById: getDef,
        effectMode: "stack",
      })
    ).toBeNull();
  });

  it("stack 支払い候補は cost 3 を base にして軽減を必ず適用し、override source を出さない", () => {
    const source = createCardInstance(C17, {
      instanceId: "bsge01-c17-hand",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const blueSymbol = createCardInstance(card("BSGE01-C07"), {
      instanceId: "blue-symbol",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [source, blueSymbol],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    });

    const stackSources = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: PLAYER,
      magicInstanceId: source.instanceId,
      getCardDefinitionById: getDef,
      effectMode: "stack",
    });

    expect(stackSources.reduction.reducedCost).toBe(2);
    expect(stackSources.reduction.finalCost).toBe(2);
    expect(stackSources.reduction.totalReduction).toBe(1);
    expect(
      getMagicCostOverrideSource({
        state,
        actingPlayerId: PLAYER,
        magicInstanceId: source.instanceId,
        getCardDefinitionById: getDef,
        effectMode: "stack",
      })
    ).toBeNull();
  });
});
