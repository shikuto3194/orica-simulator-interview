/**
 * cost_override CE による「コストを支払わずにマジック使用」フローの検証。
 * パチュリー・ノーレッジ (BSTH01-M01) の Lv1-Lv2-Lv3 効果:
 *   「自分は、系統:紅魔/導魔のマジックカードをコストを支払わずに使用できる」
 * を想定した動作テスト。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getApplicableCostOverrideCEs,
  getMagicFreeUseSource,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  ContinuousEffect,
  Effect,
  GameState,
  RegisteredFieldCardEffectAction,
  RegisteredMagicAction,
} from "../src";

// ── 共通ヘルパ ─────────────────────────────────────────

function magicDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "紅魔",
    ...overrides,
  };
}

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 6000 },
      { level: 2, requiredCores: 2, bp: 8000 },
      { level: 3, requiredCores: 4, bp: 11000 },
    ],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "幻想・紅魔・導魔",
  };
}

function freeMagicCostOverrideCE(
  sourceInstanceId: string,
  actingPlayerId: string,
  filter: NonNullable<ContinuousEffect["targetFilter"]>
): ContinuousEffect {
  return {
    effectId: `ce-cost-override-${sourceInstanceId}`,
    sourceInstanceId,
    sourceDefinitionId: "PATCHOULI-DEF",
    actingPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cost_override",
    modifierAmount: 0,
    targetFilter: filter,
  };
}

function additionalCostDeltaCE(
  sourceInstanceId: string,
  actingPlayerId: string,
  amount: number,
  filter: NonNullable<ContinuousEffect["targetFilter"]>
): ContinuousEffect {
  return {
    effectId: `ce-additional-cost-${sourceInstanceId}`,
    sourceInstanceId,
    sourceDefinitionId: "ADDITIONAL-COST-SOURCE",
    actingPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    modifierAmount: amount,
    targetFilter: filter,
  };
}

function costFloorEffect(floor: number): Effect {
  return {
    timing: { kind: "continuous" },
    steps: [
      {
        action: {
          kind: "cost_modify",
          target: { kind: "self" },
          modifier: { floor },
        },
      },
    ],
  } as Effect;
}

function costPaidThisEffectCountEffect(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "count_increase",
          player: "self",
          amount: { source: { kind: "cost_paid_this_effect" } },
        },
      },
    ],
  } as unknown as Effect;
}

const ALICE = "alice";
const BOB = "bob";

// ── getApplicableCostOverrideCEs ───────────────────────────────

describe("getApplicableCostOverrideCEs", () => {
  it("returns CE when category + tribe filter matches", () => {
    const def = magicDef("MAGIC-1");
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        tribes: ["紅魔", "導魔"],
      }),
    ];
    const matches = getApplicableCostOverrideCEs(state, ALICE, def);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.modifierAmount).toBe(0);
  });

  it("matches magic_compatible brave as magic when card instance is provided", () => {
    const def = magicDef("KEY-BRAVE-MAGIC", {
      printedCategory: "brave",
      keywordTags: ["magic_compatible"],
    });
    const card = createCardInstance(def, {
      instanceId: "key-brave-magic",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        tribes: ["紅魔", "導魔"],
      }),
    ];

    const matches = getApplicableCostOverrideCEs(state, ALICE, def, { card });
    expect(matches).toHaveLength(1);
  });

  it("does not match when tribe is mismatched", () => {
    const def = magicDef("MAGIC-1", { tribe: "妖精" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        tribes: ["紅魔", "導魔"],
      }),
    ];
    expect(getApplicableCostOverrideCEs(state, ALICE, def)).toHaveLength(0);
  });

  it("does not match when category is mismatched", () => {
    const def = magicDef("SPIRIT-1", { printedCategory: "spirit" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        tribes: ["紅魔"],
      }),
    ];
    expect(getApplicableCostOverrideCEs(state, ALICE, def)).toHaveLength(0);
  });

  it("does not match when player ref is opponent and acting player is the source", () => {
    const def = magicDef("MAGIC-1");
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    // CE 発揮者 = ALICE, player ref = "self" → ALICE のみが対象
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        tribes: ["紅魔"],
      }),
    ];
    // BOB がマジックを使おうとする → 適用されない
    expect(getApplicableCostOverrideCEs(state, BOB, def)).toHaveLength(0);
  });

  it("matches with multi-tribe card (・区切り)", () => {
    const def = magicDef("MAGIC-1", { tribe: "幻想・紅魔" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        tribes: ["紅魔"],
      }),
    ];
    expect(getApplicableCostOverrideCEs(state, ALICE, def)).toHaveLength(1);
  });

  it("can consume injected effective tribes when caller provides them", () => {
    const def = magicDef("MAGIC-NO-TRIBE", { tribe: "" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        tribes: ["導魔"],
      }),
    ];
    expect(
      getApplicableCostOverrideCEs(state, ALICE, def, {
        effectiveTribes: ["導魔"],
      })
    ).toHaveLength(1);
  });

  it("noTribes uses injected effective tribes when caller provides them", () => {
    const def = magicDef("MAGIC-NO-TRIBE", { tribe: "" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("patchouli-1", ALICE, {
        player: "self",
        category: ["magic"],
        noTribes: true,
      }),
    ];
    expect(
      getApplicableCostOverrideCEs(state, ALICE, def, {
        effectiveTribes: ["導魔"],
      })
    ).toHaveLength(0);
  });

  // ── cardName scoping (ENGINE-conditional-free-magic-use-on-event) ──
  // 「手札にあるこのカードは〜コストを支払わずに使用できる」型は class-wide filter
  // (category/colors/tribes) だけでは同色/同系統の他カードも巻き込む誤爆リスクがある。
  // targetFilter.cardName で instance/カード名単位に scoping できることを検証する。

  it("matches only the source card itself when cardName:'self' is set", () => {
    const def = magicDef("BSAZ01-C03", { tribe: "地球・火星" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      {
        ...freeMagicCostOverrideCE("bsaz01-c03-1", ALICE, {
          player: "self",
          category: ["magic"],
          cardName: "self",
        }),
        sourceDefinitionId: "BSAZ01-C03",
      },
    ];
    const matches = getApplicableCostOverrideCEs(state, ALICE, def, {
      getCardDefinitionById: (id) =>
        id === "BSAZ01-C03" ? magicDef("BSAZ01-C03") : undefined,
    });
    expect(matches).toHaveLength(1);
  });

  it("does not match a same-category/same-tribe sibling card when cardName:'self' is set (誤爆防止)", () => {
    // 同系統・同カテゴリだが別カード名 (「手札にあるこのカードは」の対象外)
    const otherMagicSameTribe = magicDef("BSAZ01-C05", {
      tribe: "地球・火星",
    });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      {
        ...freeMagicCostOverrideCE("bsaz01-c03-1", ALICE, {
          player: "self",
          category: ["magic"],
          cardName: "self",
        }),
        sourceDefinitionId: "BSAZ01-C03",
      },
    ];
    const matches = getApplicableCostOverrideCEs(
      state,
      ALICE,
      otherMagicSameTribe,
      {
        // ce.sourceDefinitionId は BSAZ01-C03 (発生源自身)
        getCardDefinitionById: (id) =>
          id === "BSAZ01-C03" ? magicDef("BSAZ01-C03") : undefined,
      }
    );
    expect(matches).toHaveLength(0);
  });

  it("without getCardDefinitionById, cardName filter fails closed (no false match)", () => {
    const def = magicDef("BSAZ01-C03", { tribe: "地球・火星" });
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    state.activeContinuousEffects = [
      freeMagicCostOverrideCE("bsaz01-c03-1", ALICE, {
        player: "self",
        category: ["magic"],
        cardName: "self",
      }),
    ];
    // getCardDefinitionById 未指定 → sourceDefinition が解決できず self マッチしない
    expect(getApplicableCostOverrideCEs(state, ALICE, def)).toHaveLength(0);
  });
});

// ── getMagicFreeUseSource ───────────────────────────────

describe("getMagicFreeUseSource", () => {
  it("reports canUseWithoutCost=true when matching free CE exists", () => {
    const magic = magicDef("MAGIC-1");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        freeMagicCostOverrideCE("patchouli-1", ALICE, {
          player: "self",
          category: ["magic"],
          tribes: ["紅魔"],
        }),
      ],
    };
    const result = getMagicFreeUseSource({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.canUseWithoutCost).toBe(true);
    expect(result.sourceInstanceId).toBe("patchouli-1");
  });

  it("reports canUseWithoutCost=false when no CE applies", () => {
    const magic = magicDef("MAGIC-1");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    const result = getMagicFreeUseSource({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.canUseWithoutCost).toBe(false);
  });

  it("cardName:'self' scoped CE does not free-use a same-color sibling magic card (誤爆防止)", () => {
    // BSAZ01-C03 が「手札にあるこのカードは〜コストを支払わずに使用できる」CE を登録した
    // 想定。同色・同カテゴリの別カード (BSAZ01-C05) は誤って無料化されない。
    const source = magicDef("BSAZ01-C03");
    const sibling = magicDef("BSAZ01-C05");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(sibling, {
          instanceId: "sibling-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        freeMagicCostOverrideCE("source-1", ALICE, {
          player: "self",
          category: ["magic"],
          cardName: "self",
        }),
      ],
    };
    const defs = new Map([
      [source.cardNo, source],
      [sibling.cardNo, sibling],
    ]);
    // ce.sourceDefinitionId は freeMagicCostOverrideCE ヘルパ既定の "PATCHOULI-DEF" のため、
    // ここでは実際の発生源解決を模した lookup を用意する。
    const result = getMagicFreeUseSource({
      state: {
        ...state,
        activeContinuousEffects: [
          {
            ...state.activeContinuousEffects[0]!,
            sourceDefinitionId: source.cardNo,
          },
        ],
      },
      actingPlayerId: ALICE,
      magicInstanceId: "sibling-1",
      getCardDefinitionById: (id) => defs.get(id),
    });
    expect(result.canUseWithoutCost).toBe(false);
  });

  it("uses effective tribes for cost_override during magic use", () => {
    const magic = magicDef("MAGIC-NO-TRIBE", { tribe: "" });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-add-tribe",
          sourceInstanceId: "source-1",
          sourceDefinitionId: "SOURCE",
          actingPlayerId: ALICE,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "magic-1",
          metadata: { properties: { addTribes: ["導魔"] } },
        },
        freeMagicCostOverrideCE("patchouli-1", ALICE, {
          player: "self",
          category: ["magic"],
          tribes: ["導魔"],
        }),
      ],
    };
    const result = getMagicFreeUseSource({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.canUseWithoutCost).toBe(true);
  });

  it("does not treat locally injected tribes as noTribes for magic cost_override", () => {
    const magic = magicDef("MAGIC-NO-TRIBE", { tribe: "" });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-add-tribe",
          sourceInstanceId: "source-1",
          sourceDefinitionId: "SOURCE",
          actingPlayerId: ALICE,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "magic-1",
          metadata: { properties: { addTribes: ["導魔"] } },
        },
        freeMagicCostOverrideCE("patchouli-1", ALICE, {
          player: "self",
          category: ["magic"],
          noTribes: true,
        }),
      ],
    };
    const result = getMagicFreeUseSource({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "magic-1",
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
    });
    expect(result.canUseWithoutCost).toBe(false);
  });

  it("preserves noTribes when cost_modify registers a cost_override CE", () => {
    const source = spiritDef("SOURCE-COST-MODIFY");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            modifier: "free",
            cardFilter: { category: ["magic"], noTribes: true },
            duration: { scope: "turn" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-override-magic:551",
      state,
      effect,
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.activeContinuousEffects).toHaveLength(1);
    expect(next.activeContinuousEffects[0]!.modifierTag).toBe("cost_override");
    expect(next.activeContinuousEffects[0]!.targetFilter).toMatchObject({
      player: "self",
      category: ["magic"],
      noTribes: true,
    });
  });

  it("preserves hasBurstEffect when cost_modify registers a cost_override CE", () => {
    const source = spiritDef("SOURCE-BURST-COST-OVERRIDE");
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source-burst-free",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            modifier: "free",
            cardFilter: { hasBurstEffect: true },
            duration: { scope: "turn" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:cost-override-magic:598",
      state,
      effect,
      sourceInstanceId: "source-burst-free",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === source.cardNo ? source : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(next.activeContinuousEffects).toHaveLength(1);
    expect(next.activeContinuousEffects[0]!.modifierTag).toBe("cost_override");
    expect(next.activeContinuousEffects[0]!.targetFilter).toMatchObject({
      player: "self",
      hasBurstEffect: true,
    });
  });
});

// ── getAvailableMagicLegalActions: 2 件 push ────────────────

describe("magic legal actions with cost_override CE", () => {
  function buildScenario(opts: {
    /** ALICE の reserve コア数 (paid 可否を切り替えるため) */
    aliceReserve: number;
    /** CE を登録するか */
    withCE: boolean;
    magicOverrides?: Partial<CardDefinition>;
  }): {
    state: GameState;
    definitionLookup: (id: string) => CardDefinition | undefined;
    magicLookup: (cardNo: string) => RegisteredMagicAction[] | undefined;
    fieldEffectLookup: (
      cardNo: string
    ) => readonly RegisteredFieldCardEffectAction[] | undefined;
  } {
    const magic = magicDef("BSTH01-M99", {
      cost: 3,
      reductionSymbols: [],
      tribe: "紅魔",
      ...opts.magicOverrides,
    });
    const patchouli = spiritDef("BSTH01-M01");
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...baseState,
      step: "main",
      window: "main_step",
      activePlayerId: ALICE,
      players: baseState.players.map((p) =>
        p.id === ALICE ? { ...p, reserveNormalCoreCount: opts.aliceReserve } : p
      ),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(patchouli, {
          instanceId: "patchouli-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
      activeContinuousEffects: opts.withCE
        ? [
            freeMagicCostOverrideCE("patchouli-1", ALICE, {
              player: "self",
              category: ["magic"],
              tribes: ["紅魔", "導魔"],
            }),
          ]
        : [],
    };
    const defs = new Map([
      [magic.cardNo, magic],
      [patchouli.cardNo, patchouli],
    ]);
    return {
      state,
      definitionLookup: (id) => defs.get(id),
      magicLookup: (cardNo) =>
        cardNo === magic.cardNo
          ? [{ timing: "main", reason: "test_main_magic" }]
          : undefined,
      fieldEffectLookup: () => undefined,
    };
  }

  it("returns both paid and free legal actions when paying is possible AND CE applies", () => {
    const scenario = buildScenario({ aliceReserve: 5, withCE: true });
    const actions = getLegalActions({
      state: scenario.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );

    expect(actions.length).toBe(2);
    const paid = actions.find(
      (a) => a.kind === "use_magic" && a.costMode === "paid"
    );
    const free = actions.find(
      (a) => a.kind === "use_magic" && a.costMode === "free"
    );
    expect(paid).toBeDefined();
    expect(free).toBeDefined();
    if (free && free.kind === "use_magic") {
      expect(free.finalCost).toBe(0);
      expect(free.costOverrideSourceInstanceId).toBe("patchouli-1");
    }
    if (paid && paid.kind === "use_magic") {
      expect(paid.finalCost).toBeGreaterThan(0);
    }
  });

  it("returns only free legal action when reserve is insufficient but CE applies", () => {
    const scenario = buildScenario({ aliceReserve: 0, withCE: true });
    const actions = getLegalActions({
      state: scenario.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );

    expect(actions.length).toBe(1);
    expect(actions[0]!.kind === "use_magic" && actions[0]!.costMode).toBe(
      "free"
    );
  });

  it("free legal action clamps negative additional_cost at 0", () => {
    const scenario = buildScenario({ aliceReserve: 0, withCE: true });
    const state: GameState = {
      ...scenario.state,
      activeContinuousEffects: [
        ...scenario.state.activeContinuousEffects,
        additionalCostDeltaCE("free-discount", ALICE, -1, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const free = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "free"
    );

    expect(free).toBeDefined();
    if (free && free.kind === "use_magic") {
      expect(free.additionalCost).toBe(-1);
      expect(free.finalCost).toBe(0);
    }
  });

  it("free legal/apply は without-cost 後も cost floor を下回らない", () => {
    const blocked = buildScenario({
      aliceReserve: 0,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(1)] },
    });
    const blockedState: GameState = {
      ...blocked.state,
      cardInstances: blocked.state.cardInstances.map((card) =>
        card.instanceId === "patchouli-1"
          ? { ...card, normalCoreCount: 0 }
          : card
      ),
    };
    const blockedActions = getLegalActions({
      state: blockedState,
      actingPlayerId: ALICE,
      getCardDefinitionById: blocked.definitionLookup,
      getRegisteredFieldCardEffectActions: blocked.fieldEffectLookup,
      getRegisteredMagicActions: blocked.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );
    expect(blockedActions).toHaveLength(0);

    const scenario = buildScenario({
      aliceReserve: 1,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(1)] },
    });
    const free = getLegalActions({
      state: scenario.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "free"
    );

    expect(free).toBeDefined();
    if (free && free.kind === "use_magic") {
      expect(free.finalCost).toBe(1);
    }

    const result = applyLegalAction({
      state: scenario.state,
      action: free!,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    });
    const alice = result.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(1);
  });

  it("free legal/apply は cost floor 適用後に正の additional_cost を加算する", () => {
    const blocked = buildScenario({
      aliceReserve: 3,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(1)] },
    });
    const blockedState: GameState = {
      ...blocked.state,
      cardInstances: blocked.state.cardInstances.map((card) =>
        card.instanceId === "patchouli-1"
          ? { ...card, normalCoreCount: 0 }
          : card
      ),
      activeContinuousEffects: [
        ...blocked.state.activeContinuousEffects,
        additionalCostDeltaCE("free-floor-tax-blocked", ALICE, 3, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const blockedFree = getLegalActions({
      state: blockedState,
      actingPlayerId: ALICE,
      getCardDefinitionById: blocked.definitionLookup,
      getRegisteredFieldCardEffectActions: blocked.fieldEffectLookup,
      getRegisteredMagicActions: blocked.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "free"
    );
    expect(blockedFree).toBeUndefined();

    const scenario = buildScenario({
      aliceReserve: 4,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(1)] },
    });
    const state: GameState = {
      ...scenario.state,
      activeContinuousEffects: [
        ...scenario.state.activeContinuousEffects,
        additionalCostDeltaCE("free-floor-tax", ALICE, 3, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const free = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "free"
    );

    expect(free).toBeDefined();
    if (free && free.kind === "use_magic") {
      expect(free.additionalCost).toBe(3);
      expect(free.finalCost).toBe(4);
    }

    const result = applyLegalAction({
      state,
      action: free!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    });
    const alice = result.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(4);
  });

  it("free deferred resolution は支払い済み finalCost を cost_paid_this_effect へ渡す", () => {
    const scenario = buildScenario({
      aliceReserve: 4,
      withCE: true,
      magicOverrides: {
        effects: [costFloorEffect(1), costPaidThisEffectCountEffect()],
      },
    });
    const state: GameState = {
      ...scenario.state,
      activeContinuousEffects: [
        ...scenario.state.activeContinuousEffects,
        additionalCostDeltaCE("free-floor-tax-deferred", ALICE, 3, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const magic = scenario.definitionLookup("BSTH01-M99")!;
    const magicLookup = buildMagicLookup([magic]);
    const free = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "free"
    );
    expect(free).toBeDefined();
    if (free && free.kind === "use_magic") {
      expect(free.finalCost).toBe(4);
    }

    const declared = applyLegalAction({
      state,
      action: free!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.finalCost).toBe(4);

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(4);
  });

  it("returns only paid legal action when no CE is registered", () => {
    const scenario = buildScenario({ aliceReserve: 5, withCE: false });
    const actions = getLegalActions({
      state: scenario.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );

    expect(actions.length).toBe(1);
    expect(actions[0]!.kind === "use_magic" && actions[0]!.costMode).toBe(
      "paid"
    );
  });

  it("applying costMode=free moves card to in_use without consuming cores", () => {
    const scenario = buildScenario({ aliceReserve: 5, withCE: true });
    const actions = getLegalActions({
      state: scenario.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    });
    const free = actions.find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "free"
    );
    expect(free).toBeDefined();

    const result = applyLegalAction({
      state: scenario.state,
      action: free!,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    });

    // ALICE のリザーブコアは消費されていない (5 のまま)
    const alice = result.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(5);

    // マジックは in_use ゾーンに移動している
    const magicCard = result.state.cardInstances.find(
      (c) => c.instanceId === "magic-1"
    )!;
    expect(magicCard.zone).toBe("in_use");

    // ログに without-cost 行が含まれる
    expect(
      result.state.log.some((l) => l.includes("magic:without-cost:"))
    ).toBe(true);
    // ログに通常の magic:reduction 行は **含まれない**
    expect(result.state.log.some((l) => l.startsWith("magic:reduction:"))).toBe(
      false
    );
  });

  it("BSTH01-M01 の実 card-effect は紅魔/導魔マジックを盤面から無償使用にする", () => {
    const patchouli = ALL_CARDS.find((card) => card.cardNo === "BSTH01-M01")!;
    const magic = ALL_CARDS.find((card) => card.cardNo === "BSTH01-C22")!;
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const initial: GameState = {
      ...base,
      step: "main",
      window: "main_step",
      activePlayerId: ALICE,
      players: base.players.map((player) =>
        player.id === ALICE ? { ...player, reserveNormalCoreCount: 0 } : player
      ),
      cardInstances: [
        createCardInstance(patchouli, {
          instanceId: "patchouli-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(magic, {
          instanceId: "lazy-trilliton-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    const definitionLookup = (id: string) =>
      ALL_CARDS.find((card) => card.cardNo === id);
    const state = rebuildContinuousEffectsFromField(initial, definitionLookup);
    expect(state.activeContinuousEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "patchouli-1",
          modifierTag: "cost_override",
          modifierAmount: 0,
          targetFilter: {
            player: "self",
            category: ["magic"],
            tribes: ["紅魔", "導魔"],
          },
          provenance: { effectIndex: 3, stepIndex: 0 },
        }),
      ])
    );

    const magicLookup = buildMagicLookup(ALL_CARDS);
    const free = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredMagicActions: magicLookup,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "lazy-trilliton-1" &&
        action.costMode === "free"
    );
    expect(free).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: free!,
      getCardDefinitionById: definitionLookup,
      getRegisteredMagicActions: magicLookup,
    }).state;
    expect(
      applied.players.find((player) => player.id === ALICE)!
    ).toMatchObject({ reserveNormalCoreCount: 0 });
    expect(
      applied.cardInstances.find(
        (card) => card.instanceId === "lazy-trilliton-1"
      )?.zone
    ).toBe("in_use");
  });
});

// ── 上書きコスト (amount>0, P2-05 Phase 4a) ────────────────
// XX01「相手はマジックカードを1コストで使用できる」型。
// CE 発揮者 = ALICE (targetFilter.player "opponent")、使用者 = BOB。

describe("magic legal actions with cost_override CE (amount>0, override mode)", () => {
  function overrideCostCE(amount: number): ContinuousEffect {
    return {
      effectId: `ce-cost-override-xx01`,
      sourceInstanceId: "xx01-1",
      sourceDefinitionId: "BSTH07.8-XX01",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: amount,
      targetFilter: { player: "opponent", category: ["magic"] },
    };
  }

  function buildOverrideScenario(opts: {
    bobReserve: number;
    withCE: boolean;
    magicOverrides?: Partial<CardDefinition>;
  }) {
    const magic = magicDef("TEST-M-OVERRIDE", {
      cost: 3,
      tribe: "妖精",
      ...opts.magicOverrides,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...baseState,
      step: "main",
      window: "main_step",
      activePlayerId: BOB,
      players: baseState.players.map((p) =>
        p.id === BOB ? { ...p, reserveNormalCoreCount: opts.bobReserve } : p
      ),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-1",
          ownerPlayerId: BOB,
          zone: "hand",
        }),
      ],
      activeContinuousEffects: opts.withCE ? [overrideCostCE(1)] : [],
    };
    return {
      state,
      definitionLookup: (id: string) =>
        id === magic.cardNo ? magic : undefined,
      magicLookup: (cardNo: string): RegisteredMagicAction[] | undefined =>
        cardNo === magic.cardNo
          ? [{ timing: "main" as const, reason: "test_main_magic" }]
          : undefined,
      fieldEffectLookup: () => undefined,
    };
  }

  it("paid と override の両方が push される (支払い可能 + CE 適用時)", () => {
    const scenario = buildOverrideScenario({ bobReserve: 5, withCE: true });
    const actions = getLegalActions({
      state: scenario.state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );

    expect(actions).toHaveLength(2);
    const override = actions.find(
      (a) => a.kind === "use_magic" && a.costMode === "override"
    );
    expect(override).toBeDefined();
    if (override && override.kind === "use_magic") {
      expect(override.finalCost).toBe(1);
      expect(override.overrideCost).toBe(1);
      expect(override.costOverrideSourceInstanceId).toBe("xx01-1");
    }
  });

  it("通常コストを払えなくても上書きコスト分を払えれば override のみ push される", () => {
    const scenario = buildOverrideScenario({ bobReserve: 1, withCE: true });
    const actions = getLegalActions({
      state: scenario.state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind === "use_magic" && actions[0]!.costMode).toBe(
      "override"
    );
  });

  it("override legal action clamps override cost plus negative additional_cost at 0", () => {
    const scenario = buildOverrideScenario({ bobReserve: 0, withCE: true });
    const state: GameState = {
      ...scenario.state,
      activeContinuousEffects: [
        ...scenario.state.activeContinuousEffects,
        additionalCostDeltaCE("override-discount", BOB, -2, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );

    expect(actions).toHaveLength(1);
    const override = actions[0];
    expect(override.kind === "use_magic" && override.costMode).toBe("override");
    if (override.kind === "use_magic") {
      expect(override.overrideCost).toBe(1);
      expect(override.additionalCost).toBe(-2);
      expect(override.finalCost).toBe(0);
    }
  });

  it("override legal/apply は override 後も cost floor を下回らない", () => {
    const blocked = buildOverrideScenario({
      bobReserve: 1,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(2)] },
    });
    const blockedOverride = getLegalActions({
      state: blocked.state,
      actingPlayerId: BOB,
      getCardDefinitionById: blocked.definitionLookup,
      getRegisteredFieldCardEffectActions: blocked.fieldEffectLookup,
      getRegisteredMagicActions: blocked.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "override"
    );
    expect(blockedOverride).toBeUndefined();

    const scenario = buildOverrideScenario({
      bobReserve: 2,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(2)] },
    });
    const override = getLegalActions({
      state: scenario.state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "override"
    );

    expect(override).toBeDefined();
    if (override && override.kind === "use_magic") {
      expect(override.overrideCost).toBe(1);
      expect(override.finalCost).toBe(2);
    }

    const result = applyLegalAction({
      state: scenario.state,
      action: override!,
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    });
    const bob = result.state.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(0);
    expect(bob.trashNormalCoreCount).toBe(2);
  });

  it("override legal/apply は cost floor 適用後に正の additional_cost を加算する", () => {
    const blocked = buildOverrideScenario({
      bobReserve: 4,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(2)] },
    });
    const blockedState: GameState = {
      ...blocked.state,
      activeContinuousEffects: [
        ...blocked.state.activeContinuousEffects,
        additionalCostDeltaCE("override-floor-tax-blocked", BOB, 3, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const blockedOverride = getLegalActions({
      state: blockedState,
      actingPlayerId: BOB,
      getCardDefinitionById: blocked.definitionLookup,
      getRegisteredFieldCardEffectActions: blocked.fieldEffectLookup,
      getRegisteredMagicActions: blocked.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "override"
    );
    expect(blockedOverride).toBeUndefined();

    const scenario = buildOverrideScenario({
      bobReserve: 5,
      withCE: true,
      magicOverrides: { effects: [costFloorEffect(2)] },
    });
    const state: GameState = {
      ...scenario.state,
      activeContinuousEffects: [
        ...scenario.state.activeContinuousEffects,
        additionalCostDeltaCE("override-floor-tax", BOB, 3, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const override = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "override"
    );

    expect(override).toBeDefined();
    if (override && override.kind === "use_magic") {
      expect(override.overrideCost).toBe(1);
      expect(override.additionalCost).toBe(3);
      expect(override.finalCost).toBe(5);
    }

    const result = applyLegalAction({
      state,
      action: override!,
      paymentSources: [{ kind: "reserve", amount: 5 }],
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    });
    const bob = result.state.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(0);
    expect(bob.trashNormalCoreCount).toBe(5);
  });

  it("override deferred resolution は支払い済み finalCost を cost_paid_this_effect へ渡す", () => {
    const scenario = buildOverrideScenario({
      bobReserve: 5,
      withCE: true,
      magicOverrides: {
        effects: [costFloorEffect(2), costPaidThisEffectCountEffect()],
      },
    });
    const state: GameState = {
      ...scenario.state,
      activeContinuousEffects: [
        ...scenario.state.activeContinuousEffects,
        additionalCostDeltaCE("override-floor-tax-deferred", BOB, 3, {
          player: "self",
          category: ["magic"],
        }),
      ],
    };
    const magic = scenario.definitionLookup("TEST-M-OVERRIDE")!;
    const magicLookup = buildMagicLookup([magic]);
    const override = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "override"
    );
    expect(override).toBeDefined();
    if (override && override.kind === "use_magic") {
      expect(override.finalCost).toBe(5);
    }

    const declared = applyLegalAction({
      state,
      action: override!,
      paymentSources: [{ kind: "reserve", amount: 5 }],
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.finalCost).toBe(5);

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;
    const bob = resolved.players.find((p) => p.id === BOB)!;
    expect(bob.countValue).toBe(5);
  });

  it("CE 発揮者自身 (ALICE) のマジック使用には opponent filter の CE が適用されない", () => {
    const scenario = buildOverrideScenario({ bobReserve: 5, withCE: true });
    const magic = scenario.definitionLookup("TEST-M-OVERRIDE")!;
    const state: GameState = {
      ...scenario.state,
      activePlayerId: ALICE,
      players: scenario.state.players.map((p) =>
        p.id === ALICE ? { ...p, reserveNormalCoreCount: 5 } : p
      ),
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic-alice-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-alice-1"
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind === "use_magic" && actions[0]!.costMode).toBe(
      "paid"
    );
  });

  it("override apply でちょうど上書きコスト分のコアを支払う (5→4)", () => {
    const scenario = buildOverrideScenario({ bobReserve: 5, withCE: true });
    const override = getLegalActions({
      state: scenario.state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "override"
    );
    expect(override).toBeDefined();

    const result = applyLegalAction({
      state: scenario.state,
      action: override!,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    });

    const bob = result.state.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(4);
    const magicCard = result.state.cardInstances.find(
      (c) => c.instanceId === "magic-1"
    )!;
    expect(magicCard.zone).toBe("in_use");
    expect(
      result.state.log.some((l) => l.includes("magic:cost-override:"))
    ).toBe(true);
  });

  it("支払い額が上書きコストと一致しないと reject", () => {
    const scenario = buildOverrideScenario({ bobReserve: 5, withCE: true });
    const override = getLegalActions({
      state: scenario.state,
      actingPlayerId: BOB,
      getCardDefinitionById: scenario.definitionLookup,
      getRegisteredFieldCardEffectActions: scenario.fieldEffectLookup,
      getRegisteredMagicActions: scenario.magicLookup,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "magic-1" &&
        a.costMode === "override"
    );
    expect(() =>
      applyLegalAction({
        state: scenario.state,
        action: override!,
        paymentSources: [{ kind: "reserve", amount: 3 }],
        getCardDefinitionById: scenario.definitionLookup,
        getRegisteredMagicActions: scenario.magicLookup,
      })
    ).toThrow();
  });
});
