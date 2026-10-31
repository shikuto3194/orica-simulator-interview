import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  createPlayerState,
} from "../src/factories";
import { getAccelFreeUseSource } from "../src/mechanics/accel-change-system";
import type {
  AccelData,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

// ENGINE-accel-tribe-cost-override (BSTH08.5-R12 effects[0]) deep-mode iteration 1:
// `getAccelFreeUseSource` は既存の cost_override CE 消費 SSOT (`getApplicableCostOverrideCEs`、
// magic-system.ts の `getMagicFreeUseSource` と同じ経路) をアクセルにも適用できるかを検証する
// 土台。まだ legal-actions-availability.ts / legal-actions-apply.ts へは未配線
// (呼び出し元 0 件、engine-deep-ledger 参照)。

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

function handCardFromDef(
  def: CardDefinition,
  instanceId: string,
  owner = ALICE
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "hand",
  });
}

function makeState(cards: CardInstance[]): GameState {
  const state = createEmptyGameState();
  state.cardInstances = cards;
  state.step = "main";
  state.activePlayerId = ALICE;
  state.players = [
    createPlayerState(ALICE, { reserveNormalCoreCount: 10 }),
    createPlayerState(BOB, { reserveNormalCoreCount: 10 }),
  ];
  return state;
}

const accelEffect: Effect = {
  timing: { kind: "activated", mode: "main" },
  steps: [{ action: { kind: "draw", count: 1 } }],
};

const accelData: AccelData = {
  timing: "main",
  cost: 4,
  reduction: ["red"],
  effects: [accelEffect],
};

const menreiAccelDef = dummyDef({
  cardNo: "ACCEL-MENREI-001",
  name: "面霊のアクセル持ち",
  tribe: "面霊",
  accelData,
});

const otherTribeAccelDef = dummyDef({
  cardNo: "ACCEL-OTHER-001",
  name: "他系統のアクセル持ち",
  tribe: "戦士",
  accelData,
});

function menreiTribeFreeCe(actingPlayerId: string): ContinuousEffect {
  return {
    effectId: "ce-menrei-accel-free",
    sourceInstanceId: "granter-1",
    sourceDefinitionId: "BSTH08.5-R12",
    actingPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cost_override",
    modifierAmount: 0,
    targetFilter: { player: "self", tribes: ["面霊"] },
  };
}

const defLookup = (id: string): CardDefinition | undefined => {
  const defs: Record<string, CardDefinition> = {
    "ACCEL-MENREI-001": menreiAccelDef,
    "ACCEL-OTHER-001": otherTribeAccelDef,
  };
  return defs[id];
};

describe("getAccelFreeUseSource (ENGINE-accel-tribe-cost-override primitive 1)", () => {
  it("cost_override CE が無ければ無料化しない", () => {
    const accelCard = handCardFromDef(menreiAccelDef, "accel-1");
    const state = makeState([accelCard]);

    const result = getAccelFreeUseSource({
      state,
      actingPlayerId: ALICE,
      accelCard,
      accelDefinition: menreiAccelDef,
      getCardDefinitionById: defLookup,
    });

    expect(result.canUseWithoutCost).toBe(false);
  });

  it("自分の系統一致 cost_override CE (amount=0) があれば無料化できる", () => {
    const accelCard = handCardFromDef(menreiAccelDef, "accel-1");
    const state = makeState([accelCard]);
    state.activeContinuousEffects = [menreiTribeFreeCe(ALICE)];

    const result = getAccelFreeUseSource({
      state,
      actingPlayerId: ALICE,
      accelCard,
      accelDefinition: menreiAccelDef,
      getCardDefinitionById: defLookup,
    });

    expect(result.canUseWithoutCost).toBe(true);
    expect(result.sourceInstanceId).toBe("granter-1");
    expect(result.sourceDefinitionId).toBe("BSTH08.5-R12");
  });

  it("系統が一致しないカードには適用されない", () => {
    const accelCard = handCardFromDef(otherTribeAccelDef, "accel-2");
    const state = makeState([accelCard]);
    state.activeContinuousEffects = [menreiTribeFreeCe(ALICE)];

    const result = getAccelFreeUseSource({
      state,
      actingPlayerId: ALICE,
      accelCard,
      accelDefinition: otherTribeAccelDef,
      getCardDefinitionById: defLookup,
    });

    expect(result.canUseWithoutCost).toBe(false);
  });

  it("相手の CE (player=self, actingPlayerId=相手) には適用されない", () => {
    const accelCard = handCardFromDef(menreiAccelDef, "accel-1");
    const state = makeState([accelCard]);
    state.activeContinuousEffects = [menreiTribeFreeCe(BOB)];

    const result = getAccelFreeUseSource({
      state,
      actingPlayerId: ALICE,
      accelCard,
      accelDefinition: menreiAccelDef,
      getCardDefinitionById: defLookup,
    });

    expect(result.canUseWithoutCost).toBe(false);
  });
});
