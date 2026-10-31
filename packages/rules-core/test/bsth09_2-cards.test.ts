/**
 * BSTH09.2 (東方求聞史記) カードの effects 検証テスト。
 * 導界者/転醒中心。導託/導技/導域/転醒トリガーは stub。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getCombinedUnitSymbols,
  getEffectiveLevel,
  getEffectiveSymbolsForEntity,
  getEffectiveSymbols,
  rebuildContinuousEffectsFromField,
  matchesAnyOracleCondition,
} from "../src";
import type {
  BattleEntity,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH09.2-C01 本居 小鈴", () => {
  const card = cardNoMap.get("BSTH09.2-C01")!;
  const purpleCostCard: CardDefinition = {
    cardNo: "TEST-PURPLE-COST",
    name: "紫軽減テスト",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const symbolAdditionCE = (
    targetInstanceId: string,
    symbol: "red" | "purple" | "green" | "white" | "yellow" | "blue"
  ): ContinuousEffect => ({
    effectId: `ce-extra-symbol-${targetInstanceId}`,
    sourceInstanceId: "external-source",
    sourceDefinitionId: "BSGE01-C05",
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "symbol_addition",
    modifierSymbol: [symbol],
    targetInstanceId,
  });
  const opponentNexusLevelCostCE = (): ContinuousEffect => ({
    effectId: "ce-opponent-nexus-lv-cost",
    sourceInstanceId: "kosuzu-1",
    sourceDefinitionId: card.cardNo,
    actingPlayerId: "alice",
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties",
    targetFilter: { player: "opponent", category: ["nexus"] },
    metadata: {
      properties: { levelCost: { lv1: 1 } },
      overridePropertiesSourcePreventionLevel: "none",
      overridePropertiesSourceTargetLockBypass: { kind: "none" },
      overridePropertiesSourcePreventionBypass: { kind: "none" },
      overridePropertiesEffectSourceInstanceId: "kosuzu-1",
      overridePropertiesEffectSourceDefinitionId: card.cardNo,
    },
  });

  it("treat_as緑 + 召喚時 deck_reveal(起幻赤緑導界者 + 幻想&起幻) + Lv1ネクサスsymbol override", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "treat_as") expect(t.asColor).toBe("green");
    const reveal = card.effects![1]!.steps[0]!.action;
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks[1]!.filter?.tribesLogic).toBe("and");
    }
    expect(card.effects![2]!.stub).toBeUndefined();
    expect(card.effects![2]!.applicability?.level).toEqual({
      min: 1,
      max: 2,
    });
    const override = card.effects![2]!.steps[0]!.action;
    if (
      override.kind === "override_properties" &&
      typeof override.target === "object" &&
      "filter" in override.target
    ) {
      expect(override.target.player).toBe("opponent");
      expect(override.target.filter).toEqual({
        category: ["nexus"],
        minLevel: 1,
        maxLevel: 1,
      });
      expect(override.properties).toEqual({
        symbols: [],
        symbolCountFixed: true,
      });
      expect(override.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("盤面検証: 相手Lv1ネクサスだけシンボル0、Lv2/自分側/スピリットは維持", () => {
    const normalNexus = cardNoMap.get("BSTH09-C05")!;
    const opponentSpirit = cardNoMap.get("BSTH09.2-C02")!;
    const brave = cardNoMap.get("BSGE01-C05")!;
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "kosuzu-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(normalNexus, {
          instanceId: "bob-nexus-lv1",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 0,
          attachedChildrenIds: ["bob-brave"],
        }),
        createCardInstance(brave, {
          instanceId: "bob-brave",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
          attachedToInstanceId: "bob-nexus-lv1",
        }),
        createCardInstance(normalNexus, {
          instanceId: "bob-nexus-lv2",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(normalNexus, {
          instanceId: "alice-nexus-lv1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(opponentSpirit, {
          instanceId: "bob-spirit",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const overrideCe = rebuilt.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "override_properties"
    );
    expect(overrideCe?.targetFilter).toMatchObject({
      player: "opponent",
      category: ["nexus"],
      minLevel: 1,
      maxLevel: 1,
    });
    expect(overrideCe?.targetInstanceId).toBeUndefined();

    const symbolsOf = (instanceId: string, def: CardDefinition) =>
      getEffectiveSymbols(
        rebuilt,
        rebuilt.cardInstances.find((c) => c.instanceId === instanceId)!,
        def,
        getCardDefinitionById
      );

    expect(symbolsOf("bob-nexus-lv1", normalNexus)).toEqual([]);
    expect(symbolsOf("bob-nexus-lv2", normalNexus)).toEqual(["red"]);
    expect(symbolsOf("alice-nexus-lv1", normalNexus)).toEqual(["red"]);
    expect(symbolsOf("bob-spirit", opponentSpirit)).toEqual(["red"]);

    const afterLevelUp: GameState = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((c) =>
        c.instanceId === "bob-nexus-lv1" ? { ...c, normalCoreCount: 1 } : c
      ),
    };
    const leveledNexus = afterLevelUp.cardInstances.find(
      (c) => c.instanceId === "bob-nexus-lv1"
    )!;
    expect(
      getEffectiveSymbols(
        afterLevelUp,
        leveledNexus,
        normalNexus,
        getCardDefinitionById
      )
    ).toEqual(["red"]);

    const withGlobalLevelCost: GameState = {
      ...rebuilt,
      activeContinuousEffects: [
        opponentNexusLevelCostCE(),
        ...rebuilt.activeContinuousEffects,
      ],
    };
    const levelCostedNexus = withGlobalLevelCost.cardInstances.find(
      (c) => c.instanceId === "bob-nexus-lv1"
    )!;
    expect(
      getEffectiveLevel(
        withGlobalLevelCost,
        levelCostedNexus,
        normalNexus,
        getCardDefinitionById
      )
    ).toBe(0);
    // symbol-only global override の minLevel/maxLevel 判定は、他の global
    // Lvコスト変更を反映した実効Lvで行う。0コアネクサスは Lv1 でなくなるので、
    // BSTH09.2-C01 のシンボル0固定は適用されない。
    expect(
      getEffectiveSymbols(
        withGlobalLevelCost,
        levelCostedNexus,
        normalNexus,
        getCardDefinitionById
      )
    ).toEqual(["red"]);

    const withExtraSymbol: GameState = {
      ...rebuilt,
      activeContinuousEffects: [
        ...rebuilt.activeContinuousEffects,
        symbolAdditionCE("bob-nexus-lv1", "purple"),
      ],
    };
    const fixedNexus = withExtraSymbol.cardInstances.find(
      (c) => c.instanceId === "bob-nexus-lv1"
    )!;
    // 公式 Q15011: 「0にする」固定値変更中は、symbol_addition や合体ブレイヴで
    // シンボル数が増えない。
    expect(
      getEffectiveSymbols(
        withExtraSymbol,
        fixedNexus,
        normalNexus,
        getCardDefinitionById
      )
    ).toEqual([]);
    expect(
      getCombinedUnitSymbols(
        withExtraSymbol,
        fixedNexus,
        normalNexus,
        getCardDefinitionById
      )
    ).toEqual([]);

    const cardInstancesById = new Map(
      withExtraSymbol.cardInstances.map((c) => [c.instanceId, c])
    );
    const entity: BattleEntity = {
      entityId: "entity-bob-nexus-lv1",
      memberInstanceIds: ["bob-nexus-lv1", "bob-brave"],
      resolvedBp: 0,
      resolvedSymbols: [],
      attackState: "idle",
    };
    expect(
      getEffectiveSymbolsForEntity(
        withExtraSymbol,
        entity,
        cardInstancesById,
        getCardDefinitionById
      )
    ).toEqual([]);
    const reduction = calculateReduction({
      state: {
        ...withExtraSymbol,
        battleEntities: [entity],
      },
      actingPlayerId: "bob",
      card: purpleCostCard,
      getCardDefinitionById,
    });
    expect(reduction.totalReduction).toBe(0);
  });
});

describe("BSTH09.2-C02 朱鷺子", () => {
  const card = cardNoMap.get("BSTH09.2-C02")!;
  it("召喚時 destroy filter: filterOr [通常ネクサス, 創界神/導界者ネクサスのみ] + exclude 起幻 grandwalker (stub 解消)", () => {
    expect(card.effects![0]!.stub).toBeUndefined();
    const d = card.effects![0]!.steps[0]!.action;
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      const f = d.target.filter;
      expect(f.filterOr).toEqual([
        { category: ["nexus"] },
        { category: ["nexus"], targetsGrandwalker: "only" },
      ]);
      expect(f.exclude).toEqual({
        category: ["nexus"],
        targetsGrandwalker: "only",
        tribesRequired: ["起幻"],
      });
    }
    const flash = card.effects![1]!;
    expect(flash.steps[0]!.action.kind).toBe("exhaust");
    expect(flash.steps[1]!.connector).toBe("conditional_cost");
    expect(flash.steps[1]!.action.kind).toBe("draw");
  });

  it("召喚時 destroy 実行: 起幻を持つ相手導界者ネクサス (BSTH09.2-X01) は破壊対象外", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tokiko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // BSTH09.2-X01 = 導界者・起幻 → 起幻除外で対象外
    const guidedKigen = createCardInstance(cardNoMap.get("BSTH09.2-X01")!, {
      instanceId: "guided-kigen-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, guidedKigen],
    };
    const result = executeEffect({
      chainId: "test:bsth09_2-cards:356",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "tokiko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const leave = result.pendingLeaveEntities.find(
      (e) => e.instanceId === "guided-kigen-1"
    );
    expect(leave).toBeUndefined();
  });

  it("召喚時 destroy 実行: 起幻を持たない相手導界者ネクサス (BSTH003-X01 = 導界者・導魔) は破壊対象", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tokiko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // BSTH003-X01 = 導界者・導魔 (起幻なし) → 破壊対象
    const guidedNoKigen = createCardInstance(cardNoMap.get("BSTH003-X01")!, {
      instanceId: "guided-no-kigen-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, guidedNoKigen],
    };
    const result = executeEffect({
      chainId: "test:bsth09_2-cards:391",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "tokiko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const leave = result.pendingLeaveEntities.find(
      (e) => e.instanceId === "guided-no-kigen-1"
    );
    expect(leave).toBeDefined();
  });
});

describe.each(["BSTH09.2-X01", "BSTH09.2-XX01"])(
  "%s 導界者ネクサス",
  (cardNo) => {
    const card = cardNoMap.get(cardNo)!;
    it("grandwalkerData(guided): 幻想&コスト3以上 / 転醒ネクサス + 配置時コア配置禁止タグ", () => {
      expect(card.grandwalkerData?.kind).toBe("guided");
      expect(card.grandwalkerData?.oracleConditions).toEqual([
        {
          tribes: ["幻想"],
          minCost: 3,
          categories: ["spirit", "ultimate", "nexus"],
        },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ]);
      expect(card.keywordTags).toContain(
        "enter_field_core_placement_forbidden"
      );
    });

    it("導託対象マッチ: 幻想コスト3+/転醒ネクサスが対象、コスト2導界者自身は対象外", () => {
      const gw = card.grandwalkerData!;
      // BSTH09.2-C01: 起幻・幻想 スピリット コスト3 → 対象
      expect(
        matchesAnyOracleCondition(cardNoMap.get("BSTH09.2-C01")!, gw)
      ).toBe(true);
      // BSTH09.2-転醒R03(A): 転醒(両面)ネクサス → 対象
      expect(
        matchesAnyOracleCondition(cardNoMap.get("BSTH09.2-転醒R03(A)")!, gw)
      ).toBe(true);
      // 自分自身 (コスト2・転醒なしネクサス) → 対象外
      expect(matchesAnyOracleCondition(card, gw)).toBe(false);
    });

    it("treat_as(赤/緑) + 導技は divineSkills(coreCost:4, ターン1回) として宣言", () => {
      const treat = card.effects!.find(
        (e) => e.steps[0]?.action.kind === "treat_as"
      )!;
      const colors = treat.steps.map((s) =>
        s.action.kind === "treat_as" ? s.action.asColor : null
      );
      expect(colors).toEqual(["red", "green"]);

      // 導技=神技扱い → grandwalkerData.divineSkills へ移管。コア4個コストは
      // エンジンが発揮コストとして検査・支払いするため effects[] には残さない。
      const skill = card.grandwalkerData!.divineSkills![0]!;
      expect(skill.coreCost).toBe(4);
      expect(skill.turnLimit).toBe(
        cardNo === "BSTH09.2-XX01" ? "once_per_name" : "once"
      );
      // effects[] 側に activated/flash の導技は残っていない。
      expect(card.effects!.some((e) => e.timing.kind === "activated")).toBe(
        false
      );
    });

    it("levelDefs Lv1=0コア/Lv2=4コア: 実効Lvがコア数で切り替わり導域min_level:2が成立可能", () => {
      expect(card.levelDefs).toEqual([
        { level: 1, requiredCores: 0, bp: 0 },
        { level: 2, requiredCores: 4, bp: 0 },
      ]);
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const atCores = (n: number) => {
        const nexus = createCardInstance(card, {
          instanceId: "guide-nexus-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: n,
        });
        const state: GameState = { ...base, cardInstances: [nexus] };
        return getEffectiveLevel(state, nexus, card, getCardDefinitionById);
      };
      expect(atCores(0)).toBe(1);
      expect(atCores(3)).toBe(1);
      expect(atCores(4)).toBe(2);
      const guideDomain = card.effects!.find((e) =>
        e.condition?.some((c) => c.kind === "min_level" && c.value === 2)
      );
      expect(guideDomain).toBeDefined();
    });
  }
);

describe("BSTH09.2-X01 霖之助 導技/導域", () => {
  const card = cardNoMap.get("BSTH09.2-X01")!;
  it("導技: divineSkills(flash/お互いのアタックステップ) + send_to_deck(bottom, コスト8以下/疲労状態)", () => {
    const skill = card.grandwalkerData!.divineSkills![0]!;
    expect(skill.coreCost).toBe(4);
    expect(skill.timing).toEqual({
      step: "attack",
      whose: "both",
      mode: "flash",
    });
    expect(skill.turnLimit).toBe("once");
    const send = skill.effects![0]!.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind === "send_to_deck") {
      expect(send.position).toBe("bottom");
      if (typeof send.target === "object" && "filter" in send.target) {
        expect(send.target.filter.maxCost).toBe(8);
        expect(send.target.filter.category).toEqual(["spirit", "ultimate"]);
        // 「疲労状態の」対象限定は exhaustState:"exhausted" で強制（stub 解消）。
        expect(send.target.filter.exhaustState).toBe("exhausted");
      }
    }
  });

  // 【導域】Lv2『自分のアタックステップ』第三者 game_event:battle_end 観測
  // (BSTH09.2-X01 effects[1])。BSTH001-C04 同型 game_event + triggerFilter +
  // costBasis="printed"。no_duplicate legal-actions-apply 経路は
  // game-event-no-duplicate-multi-source.test.ts で検証済
  // (ENGINE-no-duplicate-game-event-pending-e2e-test)。
  it("導域 Lv2: game_event:battle_end + triggerFilter (起幻+赤/緑+本来コスト5+) + min_level 2 + no_duplicate + core_move opponent.life→opponent.reserve (BSTH09.2-X01)", () => {
    const domain = card.effects!.find((e) => e.textRef?.includes(11))!;
    expect(domain.stub).toBeUndefined();
    expect(domain.timing.kind).toBe("game_event");
    if (domain.timing.kind !== "game_event") return;
    expect(domain.timing.event).toBe("battle_end");
    expect(domain.timingScope).toEqual({ player: "self", period: "attack" });
    expect(domain.timing.player).toBe("self");
    expect(domain.timing.triggerFilter).toMatchObject({
      category: ["spirit", "ultimate"],
      colors: ["red", "green"],
      tribesRequired: ["起幻"],
      minCost: 5,
      costBasis: "printed",
    });
    expect(domain.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(domain.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(domain.steps).toHaveLength(1);
    const action = domain.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.from).toEqual({ kind: "life", player: "opponent" });
      expect(action.to).toEqual({ kind: "reserve", player: "opponent" });
      expect(action.amount).toBe(1);
    }
  });

  it("導技本体実行: コスト8以下の疲労相手スピリットがデッキへ（コア消費はエンジン側）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const nexus = createCardInstance(card, {
      instanceId: "rinnosuke-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(cardNoMap.get("BSTH09.2-C02")!, {
      instanceId: "tokiko-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [nexus, target],
    };
    // 本体 effect（コスト後）を実行: 対象1体のみのため自動選択でデッキ送り。
    const skill = card.grandwalkerData!.divineSkills![0]!;
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth09_2-cards:570",
        state,
        effect: skill.effects![0]!,
        sourceInstanceId: "rinnosuke-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      }),
      getCardDefinitionById
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "tokiko-1")!.zone
    ).toBe("deck");
  });
});

describe("BSTH09.2-XX01 阿求 導技/導域", () => {
  const card = cardNoMap.get("BSTH09.2-XX01")!;
  it("導技: divineSkills(main) + summon(トラッシュの幻想赤/緑スピ/アル1枚, コスト支払いなし)", () => {
    const skill = card.grandwalkerData!.divineSkills![0]!;
    expect(skill.coreCost).toBe(4);
    expect(skill.timing).toBe("main");
    expect(skill.turnLimit).toBe("once_per_name");
    const summon = skill.effects![0]!.steps[0]!.action;
    expect(summon.kind).toBe("summon");
    if (summon.kind === "summon" && summon.target.kind === "from_zone") {
      expect(summon.target.zone).toBe("trash");
      expect(summon.target.count).toBe(1);
      expect(summon.target.filter).toEqual({
        category: ["spirit", "ultimate"],
        colors: ["red", "green"],
        tribes: ["幻想"],
      });
      expect(summon.costModifier).toBe("free");
    }
  });

  it("導域 Lv2: symbol_add(red, filter minCost5) + 重複しない=no_duplicate", () => {
    const sa = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "symbol_add"
    )!;
    expect(sa.usageLimit).toEqual({ kind: "no_duplicate" });
    const a = sa.steps[0]!.action;
    if (a.kind === "symbol_add") {
      expect(a.symbol).toBe("red");
      if (typeof a.target === "object" && "filter" in a.target) {
        expect(a.target.filter.minCost).toBe(5);
      }
    }
  });

  it("導域 盤面検証: ネクサスLv2(4コア)で起幻コスト5の赤スピリットが赤×2、Lv1(0コア)では赤×1", () => {
    const kikuri = cardNoMap.get("BSTH001-R02")!; // 起幻・幻想・靈異 / 赤 / コスト5 / 継続シンボル効果なし
    const symbolsAt = (nexusCores: number) => {
      const state: GameState = {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          createCardInstance(card, {
            instanceId: "akyuu-1",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: nexusCores,
          }),
          createCardInstance(kikuri, {
            instanceId: "kikuri-1",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      const rebuilt = rebuildContinuousEffectsFromField(
        state,
        getCardDefinitionById
      );
      const spirit = rebuilt.cardInstances.find(
        (c) => c.instanceId === "kikuri-1"
      )!;
      return getEffectiveSymbols(
        rebuilt,
        spirit,
        kikuri,
        getCardDefinitionById
      );
    };
    expect(symbolsAt(0)).toEqual(["red"]);
    expect(symbolsAt(4)).toEqual(["red", "red"]);
  });

  it("導技本体実行: トラッシュの幻想スピリットが召喚される（コア消費はエンジン側）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const nexus = createCardInstance(card, {
      instanceId: "akyuu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const trashSpirit = createCardInstance(cardNoMap.get("BSTH09.2-C01")!, {
      instanceId: "kosuzu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [nexus, trashSpirit],
    };
    // 本体 effect（コスト後）を実行: トラッシュの幻想スピリットが召喚される。
    const skill = card.grandwalkerData!.divineSkills![0]!;
    const result = executeEffect({
      chainId: "test:bsth09_2-cards:685",
      state,
      effect: skill.effects![0]!,
      sourceInstanceId: "akyuu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "kosuzu-1")!.zone
    ).toBe("field");
  });
});

describe("BSTH09.2-転醒R01(A) マミゾウ", () => {
  const card = cardNoMap.get("BSTH09.2-転醒R01(A)")!;
  it("召喚/アタック時 core_move + treat_as赤 + 転醒トリガー(exhaust/leave_field) rebirth(3) / 両面", () => {
    expect(card.isDoubleSided).toBe(true);
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("core_move");
    const treat = card.effects![1]!.steps[0]!.action;
    if (treat.kind === "treat_as") expect(treat.asColor).toBe("red");
    // [2] スピリット/アルティメットの疲労時（game_event:exhaust）
    const exhaustEff = card.effects![2]!;
    expect(exhaustEff.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "exhaust",
      triggerFilter: { category: ["spirit", "ultimate"] },
    });
    expect(exhaustEff.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "count_value", player: "self", max: 3 },
    ]);
    expect(exhaustEff.stub).toBeUndefined();
    const r2 = exhaustEff.steps[0]!.action;
    if (r2.kind === "rebirth") expect(r2.maxCount).toBe(3);
    // [3] このスピリットが相手によって離れるとき（card_event:leave_field）。
    //   スピリットなので相手効果(opponent_effect)＋相手アタックによるバトル破壊(battle)。
    const leaveEff = card.effects![3]!;
    expect(leaveEff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leaveEff.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "count_value", player: "self", max: 3 },
    ]);
    expect(leaveEff.stub).toBeUndefined();
    expect(leaveEff.steps[0]!.action.kind).toBe("rebirth");
  });
});

describe("BSTH09.2-転醒R03(A) 幻想郷", () => {
  const card = cardNoMap.get("BSTH09.2-転醒R03(A)")!;
  it("転醒トリガー(reduce_life + leave_field) rebirth(3) + 軽減シンボル補助 + バースト無効", () => {
    expect(card.isDoubleSided).toBe(true);
    // [0] ライフ減少 (game_event: reduce_life)
    const lifeChangeEff = card.effects![0]!;
    expect(lifeChangeEff.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "reduce_life",
    });
    expect(lifeChangeEff.condition).toEqual([
      { kind: "count_value", player: "self", max: 3 },
    ]);
    expect(lifeChangeEff.stub).toBeUndefined();
    const rebirth = lifeChangeEff.steps[0]!.action;
    if (rebirth.kind === "rebirth") expect(rebirth.maxCount).toBe(3);
    // [1] このネクサスが相手によって離れる (card_event: leave_field cause:opponent_effect)
    const leaveEff = card.effects![1]!;
    expect(leaveEff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leaveEff.stub).toBeUndefined();
    const rebirth2 = leaveEff.steps[0]!.action;
    if (rebirth2.kind === "rebirth") expect(rebirth2.maxCount).toBe(3);
    // [2] 幻想/導界者カードの召喚/配置/使用時に軽減シンボル1つを満たす (stub 解消)。
    const reductionAssist = card.effects![2]!;
    expect(reductionAssist.stub).toBeUndefined();
    const treatAs = reductionAssist.steps[0]!.action;
    expect(treatAs.kind).toBe("treat_as");
    if (treatAs.kind === "treat_as") {
      expect(treatAs.aspects).toEqual(["reduction_symbol"]);
      expect(treatAs.whenPayingForFilter).toEqual({
        tribes: ["幻想", "導界者"],
      });
      expect(treatAs.waivesReductionRequirement).toBe(true);
    }
    // stub は残っていない (バースト無効 effects[3] も含め全解消済み)。
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("盤面検証: 幻想/導界者カードの召喚コストが軽減シンボル1つ分自動で満たされる", () => {
    const nexus = card;
    const fantasyMagic: CardDefinition = {
      cardNo: "TEST-FANTASY-MAGIC",
      name: "幻想テストマジック",
      printedCategory: "magic",
      colors: ["red"],
      cost: 2,
      reductionSymbols: ["red"],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "幻想",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const unrelatedMagic: CardDefinition = {
      ...fantasyMagic,
      cardNo: "TEST-UNRELATED-MAGIC",
      tribe: "無関係",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(nexus, {
          instanceId: "gensokyo-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
    };
    const withFantasy = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: fantasyMagic,
      getCardDefinitionById: (id) => getCardDefinitionById(id) ?? fantasyMagic,
    });
    expect(withFantasy.totalReduction).toBe(1);
    expect(withFantasy.reducedCost).toBe(1);

    const withUnrelated = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: unrelatedMagic,
      getCardDefinitionById: (id) =>
        getCardDefinitionById(id) ?? unrelatedMagic,
    });
    expect(withUnrelated.totalReduction).toBe(0);
    expect(withUnrelated.reducedCost).toBe(2);
  });
});
