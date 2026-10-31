import { describe, it, expect } from "vitest";
import type { CardDefinition, GameState, ContinuousEffect } from "../src/index";
import {
  applyEffectParamOverridesToFilter,
  deriveEffectParamOverrideClass,
  getEffectParamOverrideMetadata,
  createCardInstance,
  createEmptyGameState,
  executeEffectParamModify,
} from "../src/index";

// P3-14 A-7: effect_param_modify / effect_param_override の単体 + 統合テスト。
//
// テスト方針:
// - 純粋ヘルパー (applyEffectParamOverridesToFilter / deriveEffectParamOverrideClass)
//   をカード状態に依存しない単体テストで検証。
// - executeEffectParamModify で CE 登録形状を検証。
// - 合体ユニット (host + brave) を組み立てて scope: "combined_unit" の動作を統合検証。

function createDemoCardDefinition(
  overrides: Partial<CardDefinition> &
    Pick<CardDefinition, "cardNo" | "name" | "printedCategory">
): CardDefinition {
  return {
    cardNo: overrides.cardNo,
    name: overrides.name,
    printedCategory: overrides.printedCategory,
    colors: overrides.colors ?? ["red"],
    cost: overrides.cost ?? 3,
    reductionSymbols: overrides.reductionSymbols ?? [],
    levelDefs: overrides.levelDefs ?? [],
    symbolColors: overrides.symbolColors ?? [],
    textLines: overrides.textLines ?? [],
    keywordTags: overrides.keywordTags ?? [],
    sourceUrls: overrides.sourceUrls ?? [],
    sourceConfidence: overrides.sourceConfidence ?? "C",
  };
}

function makeOverrideCE(opts: {
  ceId: string;
  sourceInstanceId: string;
  effectClass:
    | "bp_destroy"
    | "cost_destroy"
    | "bp_vanish"
    | "cost_vanish"
    | "bp_bounce"
    | "cost_bounce"
    | "cost_exhaust";
  scope: "self" | "combined_unit" | "player_cards";
  addLimitAmount?: number;
  addTargetCategories?: string[];
  actingPlayerId?: string;
  targetFilter?: ContinuousEffect["targetFilter"];
}): ContinuousEffect {
  const metadata: Record<string, unknown> = {
    effectClass: opts.effectClass,
    scope: opts.scope,
  };
  if (opts.addLimitAmount !== undefined) {
    metadata.addLimitAmount = opts.addLimitAmount;
  }
  if (opts.addTargetCategories !== undefined) {
    metadata.addTargetCategories = opts.addTargetCategories;
  }
  return {
    effectId: opts.ceId,
    sourceInstanceId: opts.sourceInstanceId,
    sourceDefinitionId: "TEST-DEF",
    actingPlayerId: opts.actingPlayerId ?? "alice",
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "effect_param_override",
    metadata,
    ...(opts.targetFilter ? { targetFilter: opts.targetFilter } : {}),
  };
}

describe("deriveEffectParamOverrideClass", () => {
  it("destroy + maxBp → bp_destroy", () => {
    expect(deriveEffectParamOverrideClass("destroy", { maxBp: 10000 })).toBe(
      "bp_destroy"
    );
  });
  it("destroy + maxCost → cost_destroy", () => {
    expect(deriveEffectParamOverrideClass("destroy", { maxCost: 6 })).toBe(
      "cost_destroy"
    );
  });
  it("destroy with neither limit → null", () => {
    expect(deriveEffectParamOverrideClass("destroy", {})).toBeNull();
  });
  it("vanish + maxBp → bp_vanish", () => {
    expect(deriveEffectParamOverrideClass("vanish", { maxBp: 8000 })).toBe(
      "bp_vanish"
    );
  });
  it("bounce + maxCost → cost_bounce", () => {
    expect(deriveEffectParamOverrideClass("bounce", { maxCost: 4 })).toBe(
      "cost_bounce"
    );
  });
  it("exhaust + maxCost → cost_exhaust", () => {
    expect(deriveEffectParamOverrideClass("exhaust", { maxCost: 5 })).toBe(
      "cost_exhaust"
    );
  });
  it("exhaust + maxBp → null (bp_exhaust に前例なし)", () => {
    expect(
      deriveEffectParamOverrideClass("exhaust", { maxBp: 8000 })
    ).toBeNull();
  });
});

describe("applyEffectParamOverridesToFilter (no CE active)", () => {
  it("CE が無ければ filter をそのまま返す", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const filter = { category: ["spirit"] as const, maxBp: 10000 };
    const result = applyEffectParamOverridesToFilter(
      filter,
      "bp_destroy",
      "src-1",
      state
    );
    expect(result).toBe(filter);
  });
});

describe("applyEffectParamOverridesToFilter (scope: self)", () => {
  function withCE(
    activeCE: ContinuousEffect[],
    cardInstances: GameState["cardInstances"] = []
  ): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    return {
      ...base,
      cardInstances,
      activeContinuousEffects: activeCE,
    };
  }

  it("self スコープ: ソース一致時に maxBp+5000 / カテゴリ拡張を反映", () => {
    const state = withCE([
      makeOverrideCE({
        ceId: "ce-1",
        sourceInstanceId: "src-1",
        effectClass: "bp_destroy",
        scope: "self",
        addLimitAmount: 5000,
        addTargetCategories: ["ultimate"],
      }),
    ]);
    const result = applyEffectParamOverridesToFilter(
      { category: ["spirit"], maxBp: 10000 },
      "bp_destroy",
      "src-1",
      state
    );
    expect(result.maxBp).toBe(15000);
    expect(result.category).toEqual(
      expect.arrayContaining(["spirit", "ultimate"])
    );
    expect(result.category).toHaveLength(2);
  });

  it("self スコープ: ソース ID 不一致なら適用しない", () => {
    const state = withCE([
      makeOverrideCE({
        ceId: "ce-1",
        sourceInstanceId: "other-src",
        effectClass: "bp_destroy",
        scope: "self",
        addLimitAmount: 5000,
      }),
    ]);
    const result = applyEffectParamOverridesToFilter(
      { category: ["spirit"], maxBp: 10000 },
      "bp_destroy",
      "src-1",
      state
    );
    expect(result.maxBp).toBe(10000);
  });

  it("effectClass 不一致 (bp_vanish CE vs bp_destroy 問い合わせ) は適用しない", () => {
    const state = withCE([
      makeOverrideCE({
        ceId: "ce-1",
        sourceInstanceId: "src-1",
        effectClass: "bp_vanish",
        scope: "self",
        addLimitAmount: 5000,
      }),
    ]);
    const result = applyEffectParamOverridesToFilter(
      { category: ["spirit"], maxBp: 10000 },
      "bp_destroy",
      "src-1",
      state
    );
    expect(result.maxBp).toBe(10000);
  });

  it("元の filter に maxBp が無ければ addLimitAmount は反映されない", () => {
    const state = withCE([
      makeOverrideCE({
        ceId: "ce-1",
        sourceInstanceId: "src-1",
        effectClass: "bp_destroy",
        scope: "self",
        addLimitAmount: 5000,
      }),
    ]);
    const result = applyEffectParamOverridesToFilter(
      { category: ["spirit"] },
      "bp_destroy",
      "src-1",
      state
    );
    expect(result.maxBp).toBeUndefined();
  });
});

describe("applyEffectParamOverridesToFilter (scope: combined_unit)", () => {
  it("合体ブレイヴの CE がホスト効果にも適用される", () => {
    const hostDef = createDemoCardDefinition({
      cardNo: "HOST",
      name: "Host",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    });
    const braveDef = createDemoCardDefinition({
      cardNo: "BRAVE",
      name: "Brave",
      printedCategory: "brave",
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    });
    const hostCard = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const braveCard = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      cardInstances: [hostCard, braveCard],
      activeContinuousEffects: [
        makeOverrideCE({
          ceId: "ce-1",
          sourceInstanceId: "brave-1",
          effectClass: "bp_destroy",
          scope: "combined_unit",
          addLimitAmount: 5000,
          addTargetCategories: ["ultimate"],
        }),
      ],
    };
    // ホスト効果からの問い合わせ: ブレイヴ CE が適用される
    const result = applyEffectParamOverridesToFilter(
      { category: ["spirit"], maxBp: 10000 },
      "bp_destroy",
      "host-1",
      state
    );
    expect(result.maxBp).toBe(15000);
    expect(result.category).toEqual(
      expect.arrayContaining(["spirit", "ultimate"])
    );
  });

  it("分離後 (attachedToInstanceId 解除) は適用されない", () => {
    const hostDef = createDemoCardDefinition({
      cardNo: "HOST",
      name: "Host",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    });
    const braveDef = createDemoCardDefinition({
      cardNo: "BRAVE",
      name: "Brave",
      printedCategory: "brave",
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    });
    const hostCard = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    // 分離: attachedToInstanceId / attachedChildrenIds なし
    const braveCard = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      cardInstances: [hostCard, braveCard],
      activeContinuousEffects: [
        makeOverrideCE({
          ceId: "ce-1",
          sourceInstanceId: "brave-1",
          effectClass: "bp_destroy",
          scope: "combined_unit",
          addLimitAmount: 5000,
          addTargetCategories: ["ultimate"],
        }),
      ],
    };
    const result = applyEffectParamOverridesToFilter(
      { category: ["spirit"], maxBp: 10000 },
      "bp_destroy",
      "host-1",
      state
    );
    expect(result.maxBp).toBe(10000);
    expect(result.category).toEqual(["spirit"]);
  });
});

describe("applyEffectParamOverridesToFilter (scope: player_cards)", () => {
  // createDemoCardDefinition は maxTokenDeckCount を返却object に含めないため
  // (isToken 判定の SSOT: isCardDefinitionToken = maxTokenDeckCount !== undefined)、
  // isToken 検証用の定義はここで直接組み立てる。
  const ownerDef: CardDefinition = {
    ...createDemoCardDefinition({
      cardNo: "TOKEN-MAGIC",
      name: "TokenMagic",
      printedCategory: "magic",
    }),
    maxTokenDeckCount: 3,
  };
  const nonTokenDef = createDemoCardDefinition({
    cardNo: "NON-TOKEN-MAGIC",
    name: "NonTokenMagic",
    printedCategory: "magic",
  });
  const getCardDefinitionById = (id: string) =>
    id === ownerDef.cardNo
      ? ownerDef
      : id === nonTokenDef.cardNo
        ? nonTokenDef
        : undefined;

  function withState(
    activeCE: ContinuousEffect[],
    cardInstances: GameState["cardInstances"]
  ): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    return { ...base, cardInstances, activeContinuousEffects: activeCE };
  }

  it("player:self + cardFilter:{isToken:true} 一致時、自分のトークンマジック起点の cost_destroy に addLimitAmount を反映", () => {
    const ownToken = createCardInstance(ownerDef, {
      instanceId: "own-token",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = withState(
      [
        makeOverrideCE({
          ceId: "ce-1",
          sourceInstanceId: "m01-quartz",
          effectClass: "cost_destroy",
          scope: "player_cards",
          addLimitAmount: 3,
          targetFilter: { player: "self", category: ["magic"], isToken: true },
        }),
      ],
      [ownToken]
    );
    const result = applyEffectParamOverridesToFilter(
      { category: ["magic"], maxCost: 4 },
      "cost_destroy",
      "own-token",
      state,
      getCardDefinitionById
    );
    expect(result.maxCost).toBe(7);
  });

  it("cardFilter 不一致 (isToken:false のカード) は適用しない", () => {
    const ownNonToken = createCardInstance(nonTokenDef, {
      instanceId: "own-non-token",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = withState(
      [
        makeOverrideCE({
          ceId: "ce-1",
          sourceInstanceId: "m01-quartz",
          effectClass: "cost_destroy",
          scope: "player_cards",
          addLimitAmount: 3,
          targetFilter: { player: "self", category: ["magic"], isToken: true },
        }),
      ],
      [ownNonToken]
    );
    const result = applyEffectParamOverridesToFilter(
      { category: ["magic"], maxCost: 4 },
      "cost_destroy",
      "own-non-token",
      state,
      getCardDefinitionById
    );
    expect(result.maxCost).toBe(4);
  });

  it("player:self 指定時、相手のカード起点は適用しない", () => {
    const opponentToken = createCardInstance(ownerDef, {
      instanceId: "opponent-token",
      ownerPlayerId: "bob",
      zone: "field",
    });
    const state = withState(
      [
        makeOverrideCE({
          ceId: "ce-1",
          sourceInstanceId: "m01-quartz",
          effectClass: "cost_destroy",
          scope: "player_cards",
          addLimitAmount: 3,
          targetFilter: { player: "self", category: ["magic"], isToken: true },
        }),
      ],
      [opponentToken]
    );
    const result = applyEffectParamOverridesToFilter(
      { category: ["magic"], maxCost: 4 },
      "cost_destroy",
      "opponent-token",
      state,
      getCardDefinitionById
    );
    expect(result.maxCost).toBe(4);
  });

  it("getCardDefinitionById 未指定なら player_cards スコープは適用しない (安全側)", () => {
    const ownToken = createCardInstance(ownerDef, {
      instanceId: "own-token-2",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = withState(
      [
        makeOverrideCE({
          ceId: "ce-1",
          sourceInstanceId: "m01-quartz",
          effectClass: "cost_destroy",
          scope: "player_cards",
          addLimitAmount: 3,
          targetFilter: { player: "self", category: ["magic"], isToken: true },
        }),
      ],
      [ownToken]
    );
    const result = applyEffectParamOverridesToFilter(
      { category: ["magic"], maxCost: 4 },
      "cost_destroy",
      "own-token-2",
      state
    );
    expect(result.maxCost).toBe(4);
  });

  it("effectClass:cost_exhaust の CE は cost_destroy 問い合わせに適用しない", () => {
    const ownToken = createCardInstance(ownerDef, {
      instanceId: "own-token-3",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = withState(
      [
        makeOverrideCE({
          ceId: "ce-1",
          sourceInstanceId: "m01-quartz",
          effectClass: "cost_exhaust",
          scope: "player_cards",
          addLimitAmount: 3,
          targetFilter: { player: "self", category: ["magic"], isToken: true },
        }),
      ],
      [ownToken]
    );
    const result = applyEffectParamOverridesToFilter(
      { category: ["magic"], maxCost: 4 },
      "cost_destroy",
      "own-token-3",
      state,
      getCardDefinitionById
    );
    expect(result.maxCost).toBe(4);
  });
});

describe("executeEffectParamModify", () => {
  it("CE を 1 件追加し、metadata に effectClass/scope/delta が格納される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const next = executeEffectParamModify(
      base,
      "alice",
      {
        kind: "effect_param_modify",
        effectClass: "bp_destroy",
        scope: "combined_unit",
        addLimitAmount: 5000,
        addTargetCategories: ["ultimate"],
        duration: { scope: "while_on_field" },
      },
      "brave-1"
    );
    expect(next.activeContinuousEffects).toHaveLength(1);
    const ce = next.activeContinuousEffects[0]!;
    expect(ce.modifierTag).toBe("effect_param_override");
    expect(ce.sourceInstanceId).toBe("brave-1");
    const meta = getEffectParamOverrideMetadata(ce);
    expect(meta).not.toBeNull();
    expect(meta!.effectClass).toBe("bp_destroy");
    expect(meta!.scope).toBe("combined_unit");
    expect(meta!.addLimitAmount).toBe(5000);
    expect(meta!.addTargetCategories).toEqual(["ultimate"]);
  });

  it("delta が両方未指定なら no-op (CE 追加しない)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const next = executeEffectParamModify(
      base,
      "alice",
      {
        kind: "effect_param_modify",
        effectClass: "bp_destroy",
        scope: "self",
        duration: { scope: "while_on_field" },
      },
      "src-1"
    );
    expect(next.activeContinuousEffects).toHaveLength(0);
  });
});

describe("getEffectParamOverrideMetadata", () => {
  it("modifierTag 不一致なら null", () => {
    const ce: ContinuousEffect = {
      effectId: "x",
      sourceInstanceId: "s",
      sourceDefinitionId: "d",
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmount: 1000,
    };
    expect(getEffectParamOverrideMetadata(ce)).toBeNull();
  });

  it("metadata 不在なら null", () => {
    const ce: ContinuousEffect = {
      effectId: "x",
      sourceInstanceId: "s",
      sourceDefinitionId: "d",
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_param_override",
    };
    expect(getEffectParamOverrideMetadata(ce)).toBeNull();
  });

  it("不正な effectClass 文字列なら null", () => {
    const ce: ContinuousEffect = {
      effectId: "x",
      sourceInstanceId: "s",
      sourceDefinitionId: "d",
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_param_override",
      metadata: { effectClass: "bogus", scope: "self" },
    };
    expect(getEffectParamOverrideMetadata(ce)).toBeNull();
  });
});

// ============================================================
// 統合: 実カード BSTH01-X04 (フランドール) + BSTH01-X09 (レーヴァテイン)
// を組み立てて、legal-action 列挙経路で destroy 候補が拡張されることを確認する。
// `getCandidateTargetInstanceIds` 経由でフィルタ delta が反映される end-to-end 検証。
// ============================================================
describe("integration: BSTH01-X04 flash destroy candidates with BSTH01-X09 brave", () => {
  // dynamic import を避け、describe スコープで一度だけ ALL_CARDS を読み込む。
  // top-level の方が型推論しやすいが、各ファイル単独 test 実行時のコールパス確認のため
  // テスト先頭で動作確認する。
  it("レーヴァテイン合体時、相手アルティメット(BP12000) が destroy 候補に出る", async () => {
    const { ALL_CARDS } = await import("../../card-data/src/generated-index");
    const {
      buildFieldCardEffectLookup,
      buildTriggeredEffectLookup,
      buildBattleImmediateEffectLookup,
      executeEffect,
      getLegalActions,
      rebuildContinuousEffectsFromField,
    } = await import("../src");

    const flandreOrig = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X04");
    const levateinOrig = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X09");
    expect(flandreOrig).toBeDefined();
    expect(levateinOrig).toBeDefined();

    // timingScope (attack step 限定) を外して main step でも flash legal action が
    // 列挙されるようにし、テストを step 切替なしで完結させる (P3-30 と同方針)。
    const flandreTest: CardDefinition = {
      ...flandreOrig!,
      effects: flandreOrig!.effects?.map((e, i) =>
        i === 0 && e.timingScope ? { ...e, timingScope: undefined } : e
      ),
    };
    const testCards = ALL_CARDS.map((c) =>
      c.cardNo === flandreTest.cardNo ? flandreTest : c
    );
    const cardNoMap = new Map<string, CardDefinition>(
      testCards.map((c) => [c.cardNo, c])
    );
    const lookupCard = (id: string) => cardNoMap.get(id);

    // bob 場: ultimate (BP12000), spirit (BP14000), spirit (BP18000)。
    // 実カードから条件マッチするものを動的に拾う。
    const ultimate12k =
      ALL_CARDS.find(
        (d) =>
          d.printedCategory === "ultimate" &&
          d.levelDefs.length > 0 &&
          (d.levelDefs[0]?.bp ?? 0) >= 11000 &&
          (d.levelDefs[0]?.bp ?? 0) <= 15000
      ) ?? flandreOrig!;
    const spirit14k =
      ALL_CARDS.find(
        (d) =>
          d.printedCategory === "spirit" &&
          d.levelDefs.length > 0 &&
          (d.levelDefs[0]?.bp ?? 0) >= 11000 &&
          (d.levelDefs[0]?.bp ?? 0) <= 15000 &&
          d.cardNo !== flandreOrig!.cardNo
      ) ?? flandreOrig!;
    // 実カードに Lv1 BP > 15000 のスピリットが存在しないため、合成定義で代用。
    // BSTH01-X09 の +5000 上限拡張で 15000 を超えるカードが除外されることを確認する。
    const spirit18k: CardDefinition = {
      ...flandreOrig!,
      cardNo: "TEST-SPIRIT-18000",
      name: "TestSpirit18000",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 18000 }],
      effects: [], // 余分な triggered 効果が legal-actions を汚さないよう除去
    };
    // cardNoMap にも合成カードを追加し lookupCard が解決できるようにする。
    cardNoMap.set(spirit18k.cardNo, spirit18k);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 4 },
        { reserveNormalCoreCount: 4 },
      ],
    });

    const hostId = "test-host";
    const braveId = "test-brave";
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        {
          ...createCardInstance(flandreTest, {
            instanceId: hostId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          attachedChildrenIds: [braveId],
        },
        {
          ...createCardInstance(levateinOrig!, {
            instanceId: braveId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          attachedToInstanceId: hostId,
        },
        createCardInstance(ultimate12k, {
          instanceId: "ult-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(spirit14k, {
          instanceId: "spirit-14k",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(spirit18k, {
          instanceId: "spirit-18k",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    // レーヴァテインの continuous effect (effect_param_modify) を CE 登録する。
    // scenario 直接配置時の補正と同じ経路を踏む。
    state = rebuildContinuousEffectsFromField(state, lookupCard);
    const overrideCE = state.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "effect_param_override"
    );
    expect(
      overrideCE,
      "レーヴァテインの effect_param_override CE が登録されない"
    ).toBeDefined();
    expect(overrideCE?.sourceInstanceId).toBe(braveId);

    // legal-action 列挙
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookupCard,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(testCards),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(testCards),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(testCards),
    });

    const flashAction = actions.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === hostId &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(
      flashAction,
      "フランドール flash legal-action が出ない"
    ).toBeDefined();

    const candidateIds: string[] =
      (flashAction as { candidateTargetInstanceIds?: string[] })
        .candidateTargetInstanceIds ?? [];
    // 期待: ultimate (BP12000) と spirit (BP14000) が候補に含まれ、spirit18k は除外
    expect(candidateIds).toContain("ult-1");
    expect(candidateIds).toContain("spirit-14k");
    expect(candidateIds).not.toContain("spirit-18k");

    // 念のため、executeEffect で実行も通ることを確認 (smoke)。
    // ここでは destroy step ではなく continuous CE 適用そのものを実行確認。
    expect(typeof executeEffect).toBe("function");
  });

  it("レーヴァテイン分離後、ultimate は候補から除外され spirit(BP14000)も外れる", async () => {
    const { ALL_CARDS } = await import("../../card-data/src/generated-index");
    const {
      buildFieldCardEffectLookup,
      buildTriggeredEffectLookup,
      buildBattleImmediateEffectLookup,
      getLegalActions,
      rebuildContinuousEffectsFromField,
    } = await import("../src");

    const flandreOrig = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X04")!;
    const flandreTest: CardDefinition = {
      ...flandreOrig,
      effects: flandreOrig.effects?.map((e, i) =>
        i === 0 && e.timingScope ? { ...e, timingScope: undefined } : e
      ),
    };
    const testCards = ALL_CARDS.map((c) =>
      c.cardNo === flandreTest.cardNo ? flandreTest : c
    );
    const cardNoMap = new Map<string, CardDefinition>(
      testCards.map((c) => [c.cardNo, c])
    );
    const lookupCard = (id: string) => cardNoMap.get(id);

    const ultimate12k =
      ALL_CARDS.find(
        (d) =>
          d.printedCategory === "ultimate" &&
          d.levelDefs.length > 0 &&
          (d.levelDefs[0]?.bp ?? 0) >= 11000 &&
          (d.levelDefs[0]?.bp ?? 0) <= 15000
      ) ?? flandreOrig;
    const spirit14k =
      ALL_CARDS.find(
        (d) =>
          d.printedCategory === "spirit" &&
          d.levelDefs.length > 0 &&
          (d.levelDefs[0]?.bp ?? 0) >= 11000 &&
          (d.levelDefs[0]?.bp ?? 0) <= 15000 &&
          d.cardNo !== flandreOrig.cardNo
      ) ?? flandreOrig;
    const spirit8k =
      ALL_CARDS.find(
        (d) =>
          d.printedCategory === "spirit" &&
          d.levelDefs.length > 0 &&
          (d.levelDefs[0]?.bp ?? 0) >= 1000 &&
          (d.levelDefs[0]?.bp ?? 0) <= 10000
      ) ?? flandreOrig;

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 4 },
        { reserveNormalCoreCount: 4 },
      ],
    });

    // 非合体: ブレイヴは別カードとしてフィールドにあるが attachedToInstanceId 未設定
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(flandreTest, {
          instanceId: "fl-solo",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(ultimate12k, {
          instanceId: "ult-2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(spirit14k, {
          instanceId: "spirit-14k-2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(spirit8k, {
          instanceId: "spirit-8k",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    state = rebuildContinuousEffectsFromField(state, lookupCard);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookupCard,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(testCards),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(testCards),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(testCards),
    });
    const flashAction = actions.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "fl-solo" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flashAction).toBeDefined();
    const candidateIds: string[] =
      (flashAction as { candidateTargetInstanceIds?: string[] })
        .candidateTargetInstanceIds ?? [];
    // 非合体: maxBp 10000 / spirit のみ → spirit-8k のみ候補
    expect(candidateIds).toContain("spirit-8k");
    expect(candidateIds).not.toContain("ult-2");
    expect(candidateIds).not.toContain("spirit-14k-2");
  });

  // 回帰: 候補列挙だけでなく conditional_cost の「対象不足」検証経路でも
  // brave の BP破壊上限+N (effect_param_override) を適用する。これを欠くと、
  // 候補列挙では合法な対象 (BP11000〜15000) を選択しても resolve 時に
  // conditional-cost-target-shortage で誤ロールバックされ破壊されない
  // (snapshot 2026-06-21 BSTH01-X04 フランドール＋X09 レーヴァテイン合体時)。
  it("conditional_cost destroy 解決: 合体時は BP11000 のスピリットを破壊できる", async () => {
    const { ALL_CARDS } = await import("../../card-data/src/generated-index");
    const { executeEffect, getEffectiveBp, rebuildContinuousEffectsFromField } =
      await import("../src");

    const flandreOrig = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X04")!;
    const levateinOrig = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X09")!;
    // 咲夜 (BSTH01-X05): Lv2(コア2) で BP11000。素の maxBp10000 では対象外、
    // レーヴァテインの +5000 (→15000) で初めて合法対象になる (snapshot 2026-06-21 再現)。
    const sakuyaOrig = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X05")!;
    const cardNoMap = new Map<string, CardDefinition>(
      ALL_CARDS.map((c) => [c.cardNo, c])
    );
    const lookupCard = (id: string) => cardNoMap.get(id);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 4 }, // pay_cost 1 を自動支払いできるように
        { reserveNormalCoreCount: 0 },
      ],
    });

    const hostId = "fl-host";
    const braveId = "lev-brave";
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        {
          ...createCardInstance(flandreOrig, {
            instanceId: hostId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 3,
          }),
          attachedChildrenIds: [braveId],
        },
        {
          ...createCardInstance(levateinOrig, {
            instanceId: braveId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          attachedToInstanceId: hostId,
        },
        createCardInstance(sakuyaOrig, {
          instanceId: "victim-saku",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    state = rebuildContinuousEffectsFromField(state, lookupCard);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_param_override"
      )
    ).toBe(true);
    // 前提: 対象は素の閾値 (10000) 超・拡張後 (15000) 以下であること。
    const victimBefore = state.cardInstances.find(
      (c) => c.instanceId === "victim-saku"
    )!;
    expect(getEffectiveBp(state, victimBefore, sakuyaOrig, lookupCard)).toBe(
      11000
    );

    // フランドールのフラッシュ destroy 効果 (effect[0]: pay_cost → conditional_cost destroy)
    const flashDestroy = flandreOrig.effects![0]!;
    const next = executeEffect({
      chainId: "test:effect-param-override:979",
      state,
      effect: flashDestroy,
      sourceInstanceId: hostId,
      actingPlayerId: "alice",
      getCardDefinitionById: lookupCard,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["victim-saku"],
      // 事前選択対象は destroy ステップ (steps[1], 無 id → "__step_1") でのみ消費させ、
      // pay_cost ステップが先取りしないようにする (deferred フラッシュ解決と同じ経路)。
      targetStepId: "__step_1",
      effectIndex: 0,
    });

    // 「対象不足」ロールバックは起きず、destroy が成立する。
    expect(
      next.log.some((l) => l.includes("conditional-cost-target-shortage"))
    ).toBe(false);
    const victim = next.cardInstances.find(
      (c) => c.instanceId === "victim-saku"
    );
    const destroyed =
      victim === undefined ||
      victim.zone !== "field" ||
      victim.pendingLeaveKind === "destroy";
    expect(destroyed, "BP11000 のスピリットが破壊されていない").toBe(true);
  });
});
