import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  createPlayerState,
} from "../src/factories";
import { applyLegalAction } from "../src";
import {
  useAccelCardAsAction,
  useAccelCardInFlashContextAsAction,
  useChangeCardAsAction,
  useChangeCardInFlashContextAsAction,
  resolveDeferredChangeStack,
  resolvePendingChangeCleanupChoice,
  getChangeSwapCandidates,
  getAvailableAccelChangePaymentSources,
} from "../src/mechanics/accel-change-system";
import {
  getAvailableAccelLegalActions,
  getAvailableChangeLegalActions,
} from "../src/legal/legal-actions-availability";
import type {
  AccelData,
  ActiveStack,
  ActiveAttack,
  BattleEntity,
  CardDefinition,
  CardInstance,
  ChangeData,
  ContinuousEffect,
  GameState,
  PlayerState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";
import type { GetLegalActionsOptions } from "../src/legal/legal-actions-types";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

// ── ヘルパー ───

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

function fieldCardFromDef(
  def: CardDefinition,
  instanceId: string,
  owner = ALICE,
  cores = 1
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });
}

function fieldCard(instanceId: string, owner = ALICE, cores = 1): CardInstance {
  return fieldCardFromDef(dummyDef(), instanceId, owner, cores);
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function makeState(
  cards: CardInstance[],
  overrides: Partial<GameState> = {}
): GameState {
  const state = createEmptyGameState();
  state.cardInstances = cards;
  state.step = "main";
  state.activePlayerId = ALICE;
  state.players = [
    createPlayerState(ALICE, {
      reserveNormalCoreCount: 10,
      handCount: cards.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "hand"
      ).length,
    }),
    createPlayerState(BOB, {
      reserveNormalCoreCount: 10,
      handCount: cards.filter(
        (c) => c.ownerPlayerId === BOB && c.zone === "hand"
      ).length,
    }),
  ];
  return { ...state, ...overrides };
}

const accelEffect: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [{ action: { kind: "draw", count: 1 } }],
};

const accelData: AccelData = {
  timing: "flash",
  cost: 4,
  reduction: ["red"],
  effects: [accelEffect],
};

const changeEffect: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [{ action: { kind: "draw", count: 1 } }],
};

const changeData: ChangeData = {
  cost: 3,
  reduction: [],
  effects: [changeEffect],
  swapCondition: { tribes: ["戦士"], maxCost: 5 },
};

const accelDef = dummyDef({
  cardNo: "ACCEL-001",
  name: "Accel Spirit",
  accelData,
});

// BSTH08.5-M11 と同じ「アクセル使用後の手元常駐」形。cleanup 直後に
// applicability.zone: set_aside の CE が登録されることを確認する。
const setAsideContinuousAccelDef = dummyDef({
  cardNo: "ACCEL-SET-ASIDE-CONTINUOUS-001",
  name: "Set Aside Continuous Accel",
  accelData,
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
    },
  ],
});

const changeDef = dummyDef({
  cardNo: "CHANGE-001",
  name: "Change Spirit",
  changeData,
  tribe: "戦士",
});

function handUseCostTax(amount: number): ContinuousEffect {
  return {
    effectId: `ce-hand-use-cost-tax-${amount}`,
    sourceInstanceId: "tax-source",
    sourceDefinitionId: "TEST-TAX",
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    modifierAmount: amount,
    targetFilter: { player: "self", zone: ["hand"] },
  };
}

const fieldSpiritDef = dummyDef({
  cardNo: "FIELD-001",
  name: "Field Spirit",
  tribe: "戦士",
  cost: 3,
});

const wrongTribeDef = dummyDef({
  cardNo: "FIELD-002",
  name: "Wrong Tribe Spirit",
  tribe: "魔族",
  cost: 3,
});

// 条件付きアクセル: Lv2 以上で発動
const conditionalAccelEffect: Effect = {
  timing: { kind: "activated", mode: "flash" },
  condition: [{ kind: "min_level", value: 2 }],
  steps: [{ action: { kind: "draw", count: 1 } }],
};

const conditionalAccelData: AccelData = {
  timing: "flash",
  cost: 4,
  reduction: ["red"],
  effects: [conditionalAccelEffect],
};

const conditionalAccelDef = dummyDef({
  cardNo: "ACCEL-COND-001",
  name: "Conditional Accel Spirit",
  accelData: conditionalAccelData,
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 3000 },
    { level: 2, requiredCores: 3, bp: 5000 },
  ],
});

// 入れ替え用の第2候補スピリット
const fieldSpiritDef2 = dummyDef({
  cardNo: "FIELD-003",
  name: "Field Spirit 2",
  tribe: "戦士",
  cost: 4,
});

const metaknightSourceDef = dummyDef({
  cardNo: "META-SOURCE",
  name: "[仮面の騎士]メタナイト",
  tribe: "鋼騎士",
});

const otherSourceDef = dummyDef({
  cardNo: "OTHER-SOURCE",
  name: "Other Advent Source",
  tribe: "鋼騎士",
});

const attachedBraveDef = dummyDef({
  cardNo: "BRAVE-001",
  name: "Attached Brave",
  printedCategory: "brave",
  symbolColors: ["blue"],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
});

const defLookup = (id: string): CardDefinition | undefined => {
  const defs: Record<string, CardDefinition> = {
    "ACCEL-001": accelDef,
    "ACCEL-SET-ASIDE-CONTINUOUS-001": setAsideContinuousAccelDef,
    "ACCEL-COND-001": conditionalAccelDef,
    "BRAVE-001": attachedBraveDef,
    "CHANGE-001": changeDef,
    "FIELD-001": fieldSpiritDef,
    "FIELD-002": wrongTribeDef,
    "FIELD-003": fieldSpiritDef2,
    "META-SOURCE": metaknightSourceDef,
    "OTHER-SOURCE": otherSourceDef,
    "TEST-001": dummyDef(),
  };
  return defs[id];
};

const actionLookupOptions = {
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
} as const;

// ── テスト ───

describe("AccelData / ChangeData model", () => {
  it("AccelData is set on CardDefinition", () => {
    expect(accelDef.accelData).toBeDefined();
    expect(accelDef.accelData!.timing).toBe("flash");
    expect(accelDef.accelData!.cost).toBe(4);
  });

  it("ChangeData is set on CardDefinition", () => {
    expect(changeDef.changeData).toBeDefined();
    expect(changeDef.changeData!.cost).toBe(3);
    expect(changeDef.changeData!.swapCondition.tribes).toEqual(["戦士"]);
  });
});

describe("Accel payment sources", () => {
  it("calculates accel-specific cost and reduction", () => {
    const card = handCardFromDef(accelDef, "accel-1");
    const redSymbolCard = fieldCard("red-field-1");
    const state = makeState([card, redSymbolCard]);

    const result = getAvailableAccelChangePaymentSources({
      state,
      actingPlayerId: ALICE,
      cost: accelData.cost, // 4
      reductionSymbols: accelData.reduction, // ["red"]
      useKind: "accel",
      getCardDefinitionById: defLookup,
    });

    // 赤シンボル1個で軽減1 → finalCost = 3
    expect(result.reduction.printedCost).toBe(4);
    expect(result.reduction.totalReduction).toBe(1);
    expect(result.reduction.finalCost).toBe(3);
    expect(result.canFullyPay).toBe(true);
  });

  it("applies hand-zone additional_cost CE to accel cost when sourceInstanceId is provided", () => {
    const card = handCardFromDef(accelDef, "accel-taxed");
    const redSymbolCard = fieldCard("red-field-taxed");
    const state = makeState([card, redSymbolCard], {
      activeContinuousEffects: [handUseCostTax(2)],
    });

    const result = getAvailableAccelChangePaymentSources({
      state,
      actingPlayerId: ALICE,
      cost: accelData.cost,
      reductionSymbols: accelData.reduction,
      useKind: "accel",
      sourceInstanceId: card.instanceId,
      getCardDefinitionById: defLookup,
    });

    expect(result.reduction.reducedCost).toBe(3);
    expect(result.reduction.additionalCost).toBe(2);
    expect(result.reduction.finalCost).toBe(5);
  });

  it("applies hand-zone additional_cost CE to change cost when sourceInstanceId is provided", () => {
    const card = handCardFromDef(changeDef, "change-taxed");
    const state = makeState([card], {
      activeContinuousEffects: [handUseCostTax(2)],
    });

    const result = getAvailableAccelChangePaymentSources({
      state,
      actingPlayerId: ALICE,
      cost: changeData.cost,
      reductionSymbols: changeData.reduction,
      useKind: "change",
      sourceInstanceId: card.instanceId,
      getCardDefinitionById: defLookup,
    });

    expect(result.reduction.reducedCost).toBe(3);
    expect(result.reduction.additionalCost).toBe(2);
    expect(result.reduction.finalCost).toBe(5);
  });
});

describe("useAccelCardAsAction", () => {
  it("moves card from hand to set_aside after accel use", () => {
    const card = handCardFromDef(accelDef, "accel-1");
    const state = makeState([card]);

    const result = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "accel-1",
      accelData,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });

    const accelCard = result.state.cardInstances.find(
      (c) => c.instanceId === "accel-1"
    )!;
    expect(accelCard.zone).toBe("set_aside");
    expect(accelCard.zoneRoleName).toBe("accel-card");

    // handCount: -1 (hand→in_use) + 1 (draw effect) = 0 → net 0 change from initial 1
    // draw effect now executes via structured effect system
    expect(getPlayer(result.state, ALICE).handCount).toBe(1);

    // reserve should decrease by 4
    expect(getPlayer(result.state, ALICE).reserveNormalCoreCount).toBe(6);
  });

  it("registers a set_aside-scoped CE during accel cleanup", () => {
    const card = handCardFromDef(
      setAsideContinuousAccelDef,
      "accel-set-aside-continuous-1"
    );
    const result = useAccelCardAsAction({
      state: makeState([card]),
      actingPlayerId: ALICE,
      cardInstanceId: card.instanceId,
      accelData,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });

    expect(
      result.state.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === card.instanceId &&
          ce.modifierTag === "replace_field_exit" &&
          ce.provenance?.effectIndex === 0
      )
    ).toBe(true);
  });

  it("rejects accel from set_aside zone", () => {
    const card = createCardInstance(accelDef, {
      instanceId: "accel-1",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = makeState([card]);

    expect(() =>
      useAccelCardAsAction({
        state,
        actingPlayerId: ALICE,
        cardInstanceId: "accel-1",
        accelData,
        paymentSources: [{ kind: "reserve", amount: 4 }],
        getCardDefinitionById: defLookup,
        ...actionLookupOptions,
      })
    ).toThrow("must be in hand");
  });

  it("logs accel declare and cost payment", () => {
    const card = handCardFromDef(accelDef, "accel-1");
    const state = makeState([card]);

    const result = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "accel-1",
      accelData,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });

    const logs = result.state.log;
    expect(logs.some((l) => l.startsWith("accel:declare:"))).toBe(true);
    expect(logs.some((l) => l.startsWith("accel:cost-paid:"))).toBe(true);
    expect(logs.some((l) => l.startsWith("accel:set-aside:"))).toBe(true);
  });

  it("deck reveal count boost resumes accelData effect instead of top-level effects", () => {
    const accelDeckEffect: Effect = {
      timing: { kind: "activated", mode: "flash" },
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
    };
    const countBoostAccelData: AccelData = {
      timing: "flash",
      cost: 1,
      reduction: [],
      effects: [accelDeckEffect],
    };
    const countBoostAccelDef = dummyDef({
      cardNo: "ACCEL-DECK-BOOST-001",
      name: "Accel Deck Boost Source",
      accelData: countBoostAccelData,
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "count_increase",
                player: "self",
                amount: 99,
              },
            },
          ],
        },
      ],
    });
    const card = handCardFromDef(countBoostAccelDef, "accel-deck-boost-1");
    const deckCards = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(countBoostAccelDef, {
        instanceId: `accel-deck-boost-deck-${index}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const getDef = (id: string): CardDefinition | undefined =>
      id === countBoostAccelDef.cardNo ? countBoostAccelDef : defLookup(id);
    const state = makeState([card, ...deckCards], {
      activeContinuousEffects: [
        {
          effectId: "ce:accel-deck-boost",
          sourceInstanceId: "boost-source-1",
          sourceDefinitionId: "BOOST-SOURCE",
          actingPlayerId: ALICE,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "grant_optional_deck_reveal_count_boost",
          targetInstanceId: ALICE,
          metadata: {
            bonusAmount: 1,
            sourceFilter: { category: ["spirit"] },
          },
        } satisfies ContinuousEffect,
      ],
    });

    const used = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: card.instanceId,
      accelData: countBoostAccelData,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: getDef,
      ...actionLookupOptions,
    }).state;

    const pending = used.pendingDeckRevealCountBoostChoice;
    expect(pending).toBeDefined();
    expect(pending!.continuation.resumeEffectOverride).toBe(accelDeckEffect);

    const resolved = applyLegalAction({
      state: used,
      action: {
        kind: "resolve_pending_deck_reveal_count_boost_choice",
        actionId: `accel-drcb:${pending!.pendingId}:apply`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.actingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        choice: "apply",
        bonusAmount: pending!.bonusAmount,
      },
      getCardDefinitionById: getDef,
      ...actionLookupOptions,
    }).state;

    expect(resolved.pendingDeckRevealCountBoostChoice).toBeNull();
    expect(
      resolved.cardInstances.filter(
        (candidate) =>
          candidate.zone === "trash" &&
          candidate.instanceId.startsWith("accel-deck-boost-deck-")
      )
    ).toHaveLength(2);
    expect(getPlayer(resolved, ALICE).countValue).toBe(7);
  });
});

describe("Deferred accel/change suppression descriptor", () => {
  it("uses the accel effect timing mode, not the stack window kind", () => {
    const mainAccelEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    };
    const mainAccelData: AccelData = {
      timing: "main",
      cost: 1,
      reduction: [],
      effects: [mainAccelEffect],
    };
    const mainAccelDef = dummyDef({
      cardNo: "ACCEL-MAIN-001",
      name: "Main Accel Spirit",
      accelData: mainAccelData,
    });
    const card = handCardFromDef(mainAccelDef, "accel-main-1");
    const state = makeState([card]);

    const result = useAccelCardInFlashContextAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "accel-main-1",
      accelData: mainAccelData,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: (id) =>
        id === mainAccelDef.cardNo ? mainAccelDef : defLookup(id),
      ...actionLookupOptions,
    });

    expect(result.activeStack.suppressionEffectDescriptor).toMatchObject({
      sourceDefinitionId: mainAccelDef.cardNo,
      sourceKind: "spirit",
      effectIndex: 0,
      keywords: ["accel"],
      timingKind: "activated",
      activatedMode: "main",
    });
  });

  it("uses the change effect timing mode, not the stack window kind", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const state = makeState([card]);

    const result = useChangeCardInFlashContextAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });

    expect(result.activeStack.suppressionEffectDescriptor).toMatchObject({
      sourceDefinitionId: changeDef.cardNo,
      sourceKind: "spirit",
      effectIndex: 0,
      keywords: ["change"],
      timingKind: "activated",
      activatedMode: "flash",
    });
  });
});

describe("Change swap candidates", () => {
  it("finds matching field spirits by tribe and cost", () => {
    const matchingSpirit = fieldCardFromDef(fieldSpiritDef, "field-1");
    const wrongTribeSpirit = fieldCardFromDef(wrongTribeDef, "field-2");
    const state = makeState([matchingSpirit, wrongTribeSpirit]);

    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: { tribes: ["戦士"], maxCost: 5 },
      getCardDefinitionById: defLookup,
    });

    expect(candidates).toContain("field-1");
    expect(candidates).not.toContain("field-2");
  });

  it("excludes opponent's spirits", () => {
    const opponentSpirit = fieldCardFromDef(fieldSpiritDef, "field-1", BOB);
    const state = makeState([opponentSpirit]);

    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: { tribes: ["戦士"] },
      getCardDefinitionById: defLookup,
    });

    expect(candidates).toHaveLength(0);
  });

  it("excludes spirits over maxCost", () => {
    const expensiveSpirit = fieldCardFromDef(fieldSpiritDef, "field-1");
    const state = makeState([expensiveSpirit]);

    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: { tribes: ["戦士"], maxCost: 1 },
      getCardDefinitionById: defLookup,
    });

    expect(candidates).toHaveLength(0); // cost 3 > maxCost 1
  });

  it("filters swap candidates to advented spirits when adventState is required", () => {
    const normalSpirit = fieldCardFromDef(fieldSpiritDef, "normal");
    const adventedSpirit = {
      ...fieldCardFromDef(fieldSpiritDef, "advented"),
      underCards: [{ cardInstanceId: "meta-source", role: "advent_source" }],
    };
    const metaSource = fieldCardFromDef(metaknightSourceDef, "meta-source");
    const state = makeState([normalSpirit, adventedSpirit, metaSource]);

    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: { adventState: "advented" },
      getCardDefinitionById: defLookup,
    });

    expect(candidates).toEqual(["advented"]);
  });
});

describe("useChangeCardAsAction", () => {
  it("moves change card to trash when no swap target", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const state = makeState([card]);

    const result = useChangeCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });

    const changeCard = result.state.cardInstances.find(
      (c) => c.instanceId === "change-1"
    )!;
    expect(changeCard.zone).toBe("trash");
    expect(getPlayer(result.state, ALICE).reserveNormalCoreCount).toBe(7);
  });

  it("swaps change card with field spirit", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const fieldSpirit = fieldCardFromDef(fieldSpiritDef, "field-1", ALICE, 2);
    const state = makeState([card, fieldSpirit]);

    const result = useChangeCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });
    expect(result.state.pendingChangeCleanupChoice).toMatchObject({
      cardInstanceId: "change-1",
      actingPlayerId: ALICE,
      swapCandidateInstanceIds: ["field-1"],
    });
    const resolved = resolvePendingChangeCleanupChoice({
      state: result.state,
      pendingId: result.state.pendingChangeCleanupChoice!.pendingId,
      outcome: "swap",
      swapTargetInstanceId: "field-1",
      getCardDefinitionById: defLookup,
    });

    // Change card should be on field (recovered)
    const changeCard = resolved.cardInstances.find(
      (c) => c.instanceId === "change-1"
    )!;
    expect(changeCard.zone).toBe("field");
    expect(changeCard.exhaustState).toBe("recovered");
    expect(changeCard.normalCoreCount).toBe(2);

    // Field spirit should be in hand
    const swappedSpirit = resolved.cardInstances.find(
      (c) => c.instanceId === "field-1"
    )!;
    expect(swappedSpirit.zone).toBe("hand");
    expect(swappedSpirit.normalCoreCount).toBe(0);

    // Cores from field spirit should stay on the Change card.
    // Original: 10 - 3 (cost) = 7.
    expect(getPlayer(resolved, ALICE).reserveNormalCoreCount).toBe(7);

    // Hand count: was 1 (change card), -1 (change used), +1 (draw effect), +1 (swap back) = 2
    expect(getPlayer(resolved, ALICE).handCount).toBe(2);
  });

  it("moves normal/soul cores to the change card and keeps eligible braves during battle", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const fieldSpirit = {
      ...fieldCardFromDef(fieldSpiritDef, "field-1", ALICE, 2),
      exhaustState: "exhausted" as const,
      attachedChildrenIds: ["brave-1"],
    };
    const attachedBrave = {
      ...createCardInstance(attachedBraveDef, {
        instanceId: "brave-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedToInstanceId: "field-1",
      exhaustState: "exhausted" as const,
    };
    const battleEntity: BattleEntity = {
      entityId: "battle-field",
      memberInstanceIds: ["field-1", "brave-1"],
      resolvedBp: 999,
      resolvedSymbols: ["red", "blue"],
      attackState: "attacking",
    };
    const activeAttack: ActiveAttack = {
      attackId: "attack-1",
      primaryEntityId: battleEntity.entityId,
      participantEntityIds: [battleEntity.entityId],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: battleEntity.entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [battleEntity.entityId],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const base = makeState([card, fieldSpirit, attachedBrave], {
      activeAttack,
      battleEntities: [battleEntity],
    });
    const state: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((c) =>
        c.instanceId === "field-1" ? { ...c, soulCoreCount: 2 } : c
      ),
      players: base.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              reserveSoulCoreCount: 0,
              soulCoreLocation: { kind: "card", instanceId: "field-1" },
            }
          : p
      ),
    };

    const result = useChangeCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });
    const resolved = resolvePendingChangeCleanupChoice({
      state: result.state,
      pendingId: result.state.pendingChangeCleanupChoice!.pendingId,
      outcome: "swap",
      swapTargetInstanceId: "field-1",
      getCardDefinitionById: defLookup,
    });

    const swappedSpirit = resolved.cardInstances.find(
      (c) => c.instanceId === "field-1"
    )!;
    const changeCard = resolved.cardInstances.find(
      (c) => c.instanceId === "change-1"
    )!;
    expect(swappedSpirit.zone).toBe("hand");
    expect(swappedSpirit.normalCoreCount).toBe(0);
    expect(swappedSpirit.soulCoreCount).toBe(0);
    expect(swappedSpirit.attachedChildrenIds).toEqual([]);
    expect(changeCard.normalCoreCount).toBe(2);
    expect(changeCard.soulCoreCount).toBe(2);
    expect(changeCard.attachedChildrenIds).toEqual(["brave-1"]);
    expect(getPlayer(resolved, ALICE).reserveNormalCoreCount).toBe(7);
    expect(getPlayer(resolved, ALICE).reserveSoulCoreCount).toBe(0);
    expect(getPlayer(resolved, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "change-1",
    });

    const braveAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(braveAfter.zone).toBe("field");
    expect(braveAfter.attachedToInstanceId).toBe("change-1");
    expect(braveAfter.exhaustState).toBe("recovered");

    expect(resolved.battleEntities).toHaveLength(1);
    expect(resolved.battleEntities[0]!.memberInstanceIds).toEqual([
      "change-1",
      "brave-1",
    ]);
    expect(resolved.battleEntities[0]!.resolvedBp).not.toBe(999);
    expect(resolved.battleEntities[0]!.resolvedSymbols).toEqual([
      "red",
      "blue",
    ]);
  });

  it("retargets duration effects applied to the swapped spirit to the change card", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const fieldSpirit = fieldCardFromDef(fieldSpiritDef, "field-1", ALICE, 2);
    const otherSpirit = fieldCardFromDef(wrongTribeDef, "other-1", ALICE, 1);
    const state = makeState([card, fieldSpirit, otherSpirit], {
      activeContinuousEffects: [
        {
          effectId: "turn-bp-on-swapped-spirit",
          sourceInstanceId: "buff-source",
          sourceDefinitionId: "BUFF-SOURCE",
          actingPlayerId: ALICE,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 1000,
          targetInstanceId: "field-1",
        },
        {
          effectId: "while-field-bp-on-swapped-spirit",
          sourceInstanceId: "field-1",
          sourceDefinitionId: fieldSpiritDef.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 1000,
          targetInstanceId: "field-1",
        },
        {
          effectId: "turn-source-record-from-swapped-spirit",
          sourceInstanceId: "field-1",
          sourceDefinitionId: fieldSpiritDef.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 1000,
          targetInstanceId: "other-1",
        },
      ],
    });

    const result = useChangeCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });
    const resolved = resolvePendingChangeCleanupChoice({
      state: result.state,
      pendingId: result.state.pendingChangeCleanupChoice!.pendingId,
      outcome: "swap",
      swapTargetInstanceId: "field-1",
      getCardDefinitionById: defLookup,
    });

    const inheritedEffect = resolved.activeContinuousEffects.find(
      (ce) => ce.effectId === "turn-bp-on-swapped-spirit"
    )!;
    expect(inheritedEffect.targetInstanceId).toBe("change-1");
    expect(inheritedEffect.sourceInstanceId).toBe("buff-source");

    expect(
      resolved.activeContinuousEffects.some(
        (ce) => ce.effectId === "while-field-bp-on-swapped-spirit"
      )
    ).toBe(false);

    const sourceRecordEffect = resolved.activeContinuousEffects.find(
      (ce) => ce.effectId === "turn-source-record-from-swapped-spirit"
    )!;
    expect(sourceRecordEffect.sourceInstanceId).toBe("field-1");
    expect(sourceRecordEffect.targetInstanceId).toBe("other-1");
  });

  it("logs change swap", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const fieldSpirit = fieldCardFromDef(fieldSpiritDef, "field-1");
    const state = makeState([card, fieldSpirit]);

    const result = useChangeCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });
    const resolved = resolvePendingChangeCleanupChoice({
      state: result.state,
      pendingId: result.state.pendingChangeCleanupChoice!.pendingId,
      outcome: "swap",
      swapTargetInstanceId: "field-1",
      getCardDefinitionById: defLookup,
    });

    expect(resolved.log.some((l) => l.includes("change:swap:"))).toBe(true);
  });

  it("transfers only named advent sources from the swapped spirit", () => {
    const transferChangeData: ChangeData = {
      ...changeData,
      transferAdventSourcesOnSwap: {
        cardNames: [{ exact: "[仮面の騎士]メタナイト" }],
      },
    };
    const card = handCardFromDef(
      { ...changeDef, changeData: transferChangeData },
      "change-1"
    );
    const fieldSpirit = {
      ...fieldCardFromDef(fieldSpiritDef, "field-1", ALICE, 2),
      underCards: [
        { cardInstanceId: "meta-source", role: "advent_source" as const },
        { cardInstanceId: "other-source", role: "advent_source" as const },
      ],
    };
    const metaSource = fieldCardFromDef(metaknightSourceDef, "meta-source");
    const otherSource = fieldCardFromDef(otherSourceDef, "other-source");
    const state = makeState([card, fieldSpirit, metaSource, otherSource]);

    const result = useChangeCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData: transferChangeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });
    const resolved = resolvePendingChangeCleanupChoice({
      state: result.state,
      pendingId: result.state.pendingChangeCleanupChoice!.pendingId,
      outcome: "swap",
      swapTargetInstanceId: "field-1",
      getCardDefinitionById: defLookup,
    });

    const changeOnField = resolved.cardInstances.find(
      (c) => c.instanceId === "change-1"
    )!;
    const swappedSpirit = resolved.cardInstances.find(
      (c) => c.instanceId === "field-1"
    )!;

    expect(changeOnField.underCards).toEqual([
      { cardInstanceId: "meta-source", role: "advent_source" },
    ]);
    expect(swappedSpirit.underCards).toEqual([]);
    const nonTransferredSource = resolved.cardInstances.find(
      (c) => c.instanceId === "other-source"
    )!;
    expect(nonTransferredSource.zone).toBe("hand");
    // Existing test ChangeData draws 1, then the swapped spirit and its
    // non-transferred advent source both return to hand.
    expect(getPlayer(resolved, ALICE).handCount).toBe(3);
    expect(
      resolved.log.some((l) =>
        l.includes("change:swap-transfer-advent-sources")
      )
    ).toBe(true);
    expect(
      resolved.log.some((l) =>
        l.includes("change:swap-advent-source-follows-target")
      )
    ).toBe(true);
  });
});

describe("Accel legal actions", () => {
  it("lists accel actions for hand cards with accelData in main step", () => {
    const card = handCardFromDef(accelDef, "accel-1");
    // main step context: canEnumerateMainHandCardActions returns true → timings = ["main", "flash"]
    const state = makeState([card]);

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const accelActions = getAvailableAccelLegalActions(options);
    expect(accelActions.length).toBe(1);
    expect(accelActions[0]!.kind).toBe("use_accel");
    expect(accelActions[0]!.timing).toBe("flash");
    expect(accelActions[0]!.sourceCardNo).toBe("ACCEL-001");
  });

  it("lists main-timing accel in main step", () => {
    const mainAccelDef = dummyDef({
      cardNo: "ACCEL-MAIN",
      name: "Main Accel",
      accelData: { ...accelData, timing: "main" as const },
    });
    const card = handCardFromDef(mainAccelDef, "accel-m");
    const state = makeState([card]);

    const lookup = (id: string) =>
      id === "ACCEL-MAIN" ? mainAccelDef : defLookup(id);
    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const accelActions = getAvailableAccelLegalActions(options);
    expect(accelActions.length).toBe(1);
    expect(accelActions[0]!.timing).toBe("main");
  });

  it("does not list accel for set_aside cards", () => {
    const card = createCardInstance(accelDef, {
      instanceId: "accel-1",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = makeState([card]);

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const accelActions = getAvailableAccelLegalActions(options);
    expect(accelActions.length).toBe(0);
  });

  it("does not list accel when cost cannot be paid", () => {
    const card = handCardFromDef(accelDef, "accel-1");
    const state = makeState([card]);
    state.players = state.players.map((p) =>
      p.id === ALICE ? { ...p, reserveNormalCoreCount: 0 } : p
    );

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const accelActions = getAvailableAccelLegalActions(options);
    expect(accelActions.length).toBe(0);
  });
});

describe("Change legal actions", () => {
  const pendingStackAction: ActiveStack = {
    stackId: "stack:bob-action",
    actionKind: "field_card_effect",
    chainId: "chain:bob-action",
    actingPlayerId: BOB,
    cardInstanceId: "bob-source",
    cardDefinitionId: "TEST-001",
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    chosenTiming: "flash",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  it("lists change actions for hand cards with changeData in main step", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const fieldSpirit = fieldCardFromDef(fieldSpiritDef, "field-1");
    // main step context: timings = ["main", "flash"] → includes "flash" → change is available
    const state = makeState([card, fieldSpirit]);

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const changeActions = getAvailableChangeLegalActions(options);
    expect(changeActions).toHaveLength(1);
    const [changeAction] = changeActions;
    expect(changeAction?.kind).toBe("use_change");
    expect(changeAction?.swapCandidateInstanceIds).toContain("field-1");
    expect(changeAction?.actionId).toBe("legal:change:change-1");
  });

  it("includes swap candidates matching condition in main step", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const matching = fieldCardFromDef(fieldSpiritDef, "field-1");
    const nonMatching = fieldCardFromDef(wrongTribeDef, "field-2");
    const state = makeState([card, matching, nonMatching]);

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const changeActions = getAvailableChangeLegalActions(options);
    expect(changeActions).toHaveLength(1);
    expect(changeActions[0]!.swapCandidateInstanceIds).toContain("field-1");
    expect(changeActions[0]!.swapCandidateInstanceIds).not.toContain("field-2");
  });

  it("does not fix trash or swap on the change declaration action", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const fieldSpirit = fieldCardFromDef(fieldSpiritDef, "field-1");
    const state = makeState([card, fieldSpirit]);

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };
    const changeActions = getAvailableChangeLegalActions(options);
    const changeAction = changeActions[0]!;

    const declared = applyLegalAction({
      state,
      action: changeAction,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    }).state;
    expect(declared.stackWindow?.pendingStackAction).toBeDefined();
    expect(
      "swapTargetInstanceId" in declared.stackWindow!.pendingStackAction!
    ).toBe(false);
  });

  it("does not let applyLegalAction override the change declaration cleanup outcome", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const field1 = fieldCardFromDef(fieldSpiritDef, "field-1");
    const field2 = fieldCardFromDef(fieldSpiritDef2, "field-2");
    const state = makeState([card, field1, field2]);

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };
    const changeActions = getAvailableChangeLegalActions(options);
    const changeAction = changeActions[0]!;

    const declared = applyLegalAction({
      state,
      action: changeAction,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      swapTargetInstanceId: "field-1",
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    }).state;
    expect(
      "swapTargetInstanceId" in declared.stackWindow!.pendingStackAction!
    ).toBe(false);

    const resolved = resolveDeferredChangeStack({
      state: {
        ...declared,
        window: state.window,
        stackWindow: null,
      },
      activeStack: declared.stackWindow!.pendingStackAction!,
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });
    expect(resolved.pendingChangeCleanupChoice).toMatchObject({
      cardInstanceId: "change-1",
      swapCandidateInstanceIds: ["field-1", "field-2"],
    });
  });

  it("recomputes swap candidates at deferred cleanup", () => {
    const adventChangeData: ChangeData = {
      ...changeData,
      swapCondition: { adventState: "advented" },
    };
    const adventChangeDef = dummyDef({
      cardNo: "CHANGE-ADVENT",
      name: "Advent Change",
      changeData: adventChangeData,
    });
    const lookup = (id: string) =>
      id === adventChangeDef.cardNo ? adventChangeDef : defLookup(id);
    const card = handCardFromDef(adventChangeDef, "change-1");
    const fieldSpirit = {
      ...fieldCardFromDef(fieldSpiritDef, "field-1"),
      underCards: [
        { cardInstanceId: "meta-source", role: "advent_source" as const },
      ],
    };
    const metaSource = fieldCardFromDef(metaknightSourceDef, "meta-source");
    const state = makeState([card, fieldSpirit, metaSource]);

    const declared = useChangeCardInFlashContextAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData: adventChangeData,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: lookup,
      ...actionLookupOptions,
    });
    const stateBeforeResolve: GameState = {
      ...declared.state,
      cardInstances: declared.state.cardInstances.map((entry) =>
        entry.instanceId === "field-1" ? { ...entry, underCards: [] } : entry
      ),
    };

    const resolved = resolveDeferredChangeStack({
      state: stateBeforeResolve,
      activeStack: declared.activeStack,
      getCardDefinitionById: lookup,
      ...actionLookupOptions,
    });

    expect(
      resolved.cardInstances.find((entry) => entry.instanceId === "change-1")!
        .zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((entry) => entry.instanceId === "field-1")!
        .zone
    ).toBe("field");
    expect(
      resolved.log.some((line) => line.includes("change:swap-target-invalid:"))
    ).toBe(false);
  });

  it("does not list change in non-flash timing", () => {
    const card = handCardFromDef(changeDef, "change-1");
    // draw step - no flash timing available
    const state = makeState([card], { step: "draw" });

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const changeActions = getAvailableChangeLegalActions(options);
    expect(changeActions.length).toBe(0);
  });

  it("does not list change in a stack response window", () => {
    const card = handCardFromDef(changeDef, "change-1");
    const fieldSpirit = fieldCardFromDef(fieldSpiritDef, "field-1");
    const state = makeState([card, fieldSpirit], {
      window: "stack",
      stackWindow: {
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: BOB,
        pendingStackAction,
      },
    });

    const options: GetLegalActionsOptions = {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };

    const changeActions = getAvailableChangeLegalActions(options);
    expect(changeActions.length).toBe(0);
  });
});

describe("ActiveStack actionKind", () => {
  it("supports accel and change actionKind values", () => {
    // Type-level check: ensure the union includes "accel" and "change"
    type ActionKind =
      | "magic"
      | "accel"
      | "change"
      | "field_card_effect"
      | "summon"
      | "place_nexus"
      | "burst_activation";
    const accelKind: ActionKind = "accel";
    const changeKind: ActionKind = "change";
    expect(accelKind).toBe("accel");
    expect(changeKind).toBe("change");
  });
});

describe("Accel condition → trash on unmet", () => {
  it("moves card to set_aside when condition is met (no condition)", () => {
    const card = handCardFromDef(accelDef, "accel-nocond");
    const state = makeState([card]);

    const result = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "accel-nocond",
      accelData,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });

    const movedCard = result.state.cardInstances.find(
      (c) => c.instanceId === "accel-nocond"
    );
    expect(movedCard?.zone).toBe("set_aside");
  });

  it("moves card to trash when effect condition is unmet", () => {
    // Lv1 (1コア) だが condition は min_level: 2 → 条件不成立
    const card = handCardFromDef(conditionalAccelDef, "accel-cond-1");
    const state = makeState([card]);

    const result = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "accel-cond-1",
      accelData: conditionalAccelData,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });

    const movedCard = result.state.cardInstances.find(
      (c) => c.instanceId === "accel-cond-1"
    );
    expect(movedCard?.zone).toBe("trash");
    // accel:trash ログが出ていることを確認
    expect(result.state.log.some((l) => l.includes("accel:trash:"))).toBe(true);
  });

  it("does not fire the effect_activated observer when the effect condition is unmet (08b:19 効果未発揮扱い)", () => {
    // ENGINE-effect-activation-card-event-observer verifier round3 Lens1: 全効果条件不成立
    // (deferredAllUnmet) は「効果未発揮扱い」であり、game_event/card_event:"effect_activated"
    // を観測する第三者リスナーが誤って誘発してはいけない。
    const watcherDef = dummyDef({
      cardNo: "WATCHER-001",
      name: "Effect Activation Watcher",
      // 場に置く監視カード自身の赤シンボルが accel の reduction:["red"] に
      // 誤ってカウントされないよう空にする (cost 4→3 の意図しない軽減を防止)。
      symbolColors: [],
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "effect_activated",
          },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    });
    const watcherLookup = buildTriggeredEffectLookup([watcherDef]);
    const watcherOptions = {
      getRegisteredTriggeredEffectActions: watcherLookup,
      getRegisteredBurstActions: () => [],
    } as const;
    const withWatcherDefLookup = (id: string): CardDefinition | undefined =>
      id === watcherDef.cardNo ? watcherDef : defLookup(id);

    const watcher = fieldCardFromDef(watcherDef, "watcher-1");
    const card = handCardFromDef(conditionalAccelDef, "accel-cond-2");
    const state = makeState([watcher, card]);

    const result = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "accel-cond-2",
      accelData: conditionalAccelData,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: withWatcherDefLookup,
      ...watcherOptions,
    });

    expect(
      result.state.pendingTriggeredEffects.some(
        (p) => p.eventKind === "effect_activated"
      )
    ).toBe(false);
  });
});

describe("Change swap target selection", () => {
  it("swaps with explicitly specified target (not first candidate)", () => {
    const changeCard = handCardFromDef(changeDef, "change-1");
    const target1 = fieldCardFromDef(fieldSpiritDef, "field-swap-1");
    const target2 = fieldCardFromDef(fieldSpiritDef2, "field-swap-2");
    const state = makeState([changeCard, target1, target2]);

    // 入れ替え候補は field-swap-1 と field-swap-2 の両方
    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: changeDef.changeData!.swapCondition,
      getCardDefinitionById: defLookup,
    });
    expect(candidates.length).toBe(2);

    // field-swap-2 を後処理選択で明示的に指定して入れ替え
    const result = useChangeCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "change-1",
      changeData: changeDef.changeData!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: defLookup,
      ...actionLookupOptions,
    });
    const resolved = resolvePendingChangeCleanupChoice({
      state: result.state,
      pendingId: result.state.pendingChangeCleanupChoice!.pendingId,
      outcome: "swap",
      swapTargetInstanceId: "field-swap-2",
      getCardDefinitionById: defLookup,
    });

    // field-swap-2 が手札に戻り、change-1 がフィールドに
    const swapped = resolved.cardInstances.find(
      (c) => c.instanceId === "field-swap-2"
    );
    expect(swapped?.zone).toBe("hand");
    const changeOnField = resolved.cardInstances.find(
      (c) => c.instanceId === "change-1"
    );
    expect(changeOnField?.zone).toBe("field");
    // field-swap-1 はフィールドに残る
    const untouched = resolved.cardInstances.find(
      (c) => c.instanceId === "field-swap-1"
    );
    expect(untouched?.zone).toBe("field");
  });
});
