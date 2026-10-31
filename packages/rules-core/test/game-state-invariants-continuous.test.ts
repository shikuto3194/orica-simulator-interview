/**
 * collectContinuousEffectInvariantIssues / assertValidGameState の continuous 拡張テスト。
 *
 * - missing_continuous_effect: フィールドカードに対応する CE が無い場合に報告される
 * - stale_continuous_effect: provenance の sourceInstanceId / definitionId / effects[index] が
 *   存在しない場合に報告される
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { finalizeBattleEndScopeExpirations } from "../src/battle/battle-end-scope-finalize";
import {
  collectContinuousEffectInvariantIssues,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  Effect,
  GameState,
  GameStateInvariantIssue,
} from "../src";

function patchouliLikeDef(cardNo: string): CardDefinition {
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
    ],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "紅魔",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: {
                category: ["magic"],
                tribes: ["紅魔", "導魔"],
              },
              modifier: "free",
              duration: { scope: "permanent" },
            },
          },
        ],
      },
    ],
  };
}

function suppressibleKeyBraveLikeDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "brave",
    colors: ["white"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "鍵",
    effects: [
      {
        timing: { kind: "continuous" },
        // 発揮条件を持つ常時効果なので effect_suppression の対象になる。
        applicability: { combined: false, soulState: false },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "exhaust",
              source: "all",
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
      },
    ],
  };
}

function suppressibleTreatAsBraveDef(cardNo: string): CardDefinition {
  return {
    ...suppressibleKeyBraveLikeDef(cardNo),
    printedCategory: "nexus",
    effects: [
      {
        timing: { kind: "continuous" },
        applicability: { combined: false, soulState: false },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { treatAsCategory: "brave" },
              duration: { scope: "permanent" },
            },
          },
        ],
      },
    ],
  };
}

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

function makeLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

describe("collectContinuousEffectInvariantIssues", () => {
  it("正常系: rebuild 済み state では missing/stale は 0 件", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const initial: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    const lookup = makeLookup([def]);
    const rebuilt = rebuildContinuousEffectsFromField(initial, lookup);

    expect(rebuilt.activeContinuousEffects).toHaveLength(1);
    expect(rebuilt.activeContinuousEffects[0]!.provenance).toEqual({
      effectIndex: 0,
      stepIndex: 0,
    });

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: rebuilt,
      issues,
      getCardDefinitionById: lookup,
    });
    expect(issues).toHaveLength(0);
  });

  it("missing_continuous_effect: フィールドカードに対応する CE が無いと検出する", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    const lookup = makeLookup([def]);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state,
      issues,
      getCardDefinitionById: lookup,
    });

    const missing = issues.filter(
      (i) => i.code === "missing_continuous_effect"
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]!.path).toContain("src-1:0");
  });

  it("effect_suppression 中の条件付き継続効果は missing として報告しない", () => {
    const sourceDef = suppressibleKeyBraveLikeDef("TEST-SUPPRESSIBLE-KEY");
    const suppressorDef = patchouliLikeDef("TEST-SUPPRESSOR");
    const source = createCardInstance(sourceDef, {
      instanceId: "suppressed-key",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const suppressor = createCardInstance(suppressorDef, {
      instanceId: "suppressor",
      ownerPlayerId: "bob",
      zone: "in_use",
      cores: 0,
    });
    const effectSuppression: ContinuousEffect = {
      effectId: "suppress-key-effect",
      sourceInstanceId: suppressor.instanceId,
      sourceDefinitionId: suppressorDef.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: "attack-group:1:alice:battle-entity:attacker",
      modifierTag: "effect_suppression",
      targetInstanceId: source.instanceId,
      metadata: {},
    };
    const state: GameState = {
      ...makeState(),
      cardInstances: [source, suppressor],
      activeContinuousEffects: [effectSuppression],
    };
    const issues: GameStateInvariantIssue[] = [];

    collectContinuousEffectInvariantIssues({
      state,
      issues,
      getCardDefinitionById: makeLookup([sourceDef, suppressorDef]),
    });

    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("BSFT01-TR10(A) の battle 終了時に抑止された BSFT01-TR08(A) の key brave CE を復元する", () => {
    const sourceDef = ALL_CARDS.find(
      (card) => card.cardNo === "BSFT01-TR08(A)"
    )!;
    const suppressorDef = ALL_CARDS.find(
      (card) => card.cardNo === "BSFT01-TR10(A)"
    )!;
    const source = createCardInstance(sourceDef, {
      instanceId: "card-5",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const suppressor = createCardInstance(suppressorDef, {
      instanceId: "card-61",
      ownerPlayerId: "bob",
      zone: "in_use",
      cores: 0,
    });
    const state: GameState = {
      ...makeState(),
      step: "attack",
      cardInstances: [source, suppressor],
      activeContinuousEffects: [
        {
          effectId: "dsl-ce-suppress_effect-ticket",
          sourceInstanceId: suppressor.instanceId,
          sourceDefinitionId: suppressorDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "battle" },
          createdAtTurn: 28,
          createdAtAttackId: null,
          modifierTag: "effect_suppression",
          targetInstanceId: source.instanceId,
          timingScope: { player: "both", period: "attack" },
          provenance: { effectIndex: 1, stepIndex: 0 },
          metadata: {},
        },
      ],
    };
    const lookup = makeLookup([...ALL_CARDS]);
    const afterBattle = finalizeBattleEndScopeExpirations(
      state,
      "attack-group:28:alice:battle-entity:card-14",
      lookup
    );
    const restoredTags = afterBattle.activeContinuousEffects
      .filter((effect) => effect.sourceInstanceId === source.instanceId)
      .map((effect) => effect.modifierTag);

    expect(restoredTags).toEqual(
      expect.arrayContaining(["cannot_be_exhausted", "prevent_battle_both"])
    );

    const issues: GameStateInvariantIssue[] = [];

    collectContinuousEffectInvariantIssues({
      state: afterBattle,
      issues,
      getCardDefinitionById: lookup,
    });

    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("battle 終了時に動的 filter 型抑止から解放された条件付き CE を復元する", () => {
    const sourceDef = suppressibleKeyBraveLikeDef(
      "TEST-DYNAMIC-SUPPRESS-TARGET"
    );
    const suppressorDef = patchouliLikeDef("TEST-DYNAMIC-SUPPRESSOR");
    const source = createCardInstance(sourceDef, {
      instanceId: "dynamic-suppressed-key",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const suppressor = createCardInstance(suppressorDef, {
      instanceId: "dynamic-suppressor",
      ownerPlayerId: "bob",
      zone: "in_use",
      cores: 0,
    });
    const state: GameState = {
      ...makeState(),
      cardInstances: [source, suppressor],
      activeContinuousEffects: [
        {
          effectId: "dynamic-battle-suppress-key-effect",
          sourceInstanceId: suppressor.instanceId,
          sourceDefinitionId: suppressorDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "battle" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "effect_suppression",
          metadata: {
            suppressTargetFilter: { category: ["brave"] },
            suppressTargetPlayer: "opponent",
          },
        },
      ],
    };
    const afterBattle = finalizeBattleEndScopeExpirations(
      state,
      "attack-group:1:alice:battle-entity:attacker",
      makeLookup([sourceDef, suppressorDef])
    );

    expect(
      afterBattle.activeContinuousEffects
        .filter((effect) => effect.sourceInstanceId === source.instanceId)
        .map((effect) => effect.modifierTag)
    ).toEqual(
      expect.arrayContaining(["cannot_be_exhausted", "prevent_battle_both"])
    );
  });

  it("動的 filter 一致を自身の CE が与える場合も battle 終了時に復元する", () => {
    const sourceDef = suppressibleTreatAsBraveDef("TEST-SELF-MATCHING-TARGET");
    const suppressorDef = patchouliLikeDef("TEST-SELF-MATCHING-SUPPRESSOR");
    const source = createCardInstance(sourceDef, {
      instanceId: "self-matching-target",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const suppressor = createCardInstance(suppressorDef, {
      instanceId: "self-matching-suppressor",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 0,
    });
    const lookup = makeLookup([sourceDef, suppressorDef]);
    const withSourceCe = rebuildContinuousEffectsFromField(
      {
        ...makeState(),
        cardInstances: [source, suppressor],
      },
      lookup
    );
    const suppressEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "suppress_effect",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["brave"] },
              count: "all",
            },
            duration: { scope: "battle" },
          },
        },
      ],
    };
    const withSuppression = executeEffect({
      chainId: "test:game-state-invariants-continuous:412",
      state: withSourceCe,
      effect: suppressEffect,
      sourceInstanceId: suppressor.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    });
    const suppressed = recomputeAndRebuildContinuousEffects(
      withSuppression,
      lookup
    );

    expect(
      suppressed.activeContinuousEffects.some(
        (effect) => effect.sourceInstanceId === source.instanceId
      )
    ).toBe(false);
    expect(
      suppressed.activeContinuousEffects.find(
        (effect) => effect.modifierTag === "effect_suppression"
      )?.metadata?.suppressedSourceInstanceIds
    ).toContain(source.instanceId);

    const afterBattle = finalizeBattleEndScopeExpirations(
      suppressed,
      "attack-group:1:alice:battle-entity:attacker",
      lookup
    );

    expect(
      afterBattle.activeContinuousEffects
        .filter((effect) => effect.sourceInstanceId === source.instanceId)
        .map((effect) => effect.modifierTag)
    ).toContain("override_properties");
  });

  it("stale_continuous_effect: 存在しない sourceInstanceId を指す CE", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const orphanCe: ContinuousEffect = {
      effectId: "orphan-ce",
      sourceInstanceId: "ghost-source",
      sourceDefinitionId: def.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: 0,
      targetFilter: { player: "self" },
      provenance: { effectIndex: 0, stepIndex: 0 },
    };
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [orphanCe],
    };
    const lookup = makeLookup([def]);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state,
      issues,
      getCardDefinitionById: lookup,
    });

    const stale = issues.filter((i) => i.code === "stale_continuous_effect");
    expect(stale).toHaveLength(1);
    expect(stale[0]!.message).toContain("ghost-source");
  });

  it("stale_continuous_effect: definitionId が見つからない CE", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const orphanCe: ContinuousEffect = {
      effectId: "orphan-ce",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "TEST-PATCHOULI",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: 0,
      targetFilter: { player: "self" },
      provenance: { effectIndex: 0, stepIndex: 0 },
    };
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      activeContinuousEffects: [orphanCe],
    };
    // ルックアップに def を含めない
    const lookup = makeLookup([]);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state,
      issues,
      getCardDefinitionById: lookup,
    });

    const stale = issues.filter((i) => i.code === "stale_continuous_effect");
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale[0]!.message).toContain("definition");
  });

  it("stale_continuous_effect: effects[effectIndex] が存在しない CE", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const orphanCe: ContinuousEffect = {
      effectId: "orphan-ce",
      sourceInstanceId: "src-1",
      sourceDefinitionId: def.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: 0,
      targetFilter: { player: "self" },
      provenance: { effectIndex: 99, stepIndex: 0 }, // 範囲外
    };
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      activeContinuousEffects: [orphanCe],
    };
    const lookup = makeLookup([def]);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state,
      issues,
      getCardDefinitionById: lookup,
    });

    const stale = issues.filter((i) => i.code === "stale_continuous_effect");
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale[0]!.message).toContain("effects[99]");
  });

  it("provenance を持たない CE は staleness 判定をスキップする (旧 CE 互換)", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const legacyCe: ContinuousEffect = {
      effectId: "legacy-ce",
      sourceInstanceId: "ghost-source",
      sourceDefinitionId: def.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: 0,
      targetFilter: { player: "self" },
      // provenance なし
    };
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [legacyCe],
    };
    const lookup = makeLookup([def]);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state,
      issues,
      getCardDefinitionById: lookup,
    });

    expect(
      issues.filter((i) => i.code === "stale_continuous_effect")
    ).toHaveLength(0);
  });

  it("collectGameStateInvariantIssues: getCardDefinitionById 未指定なら継続効果検査をスキップ", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    // option 無し → continuous は走らない
    const issuesNoOpt = collectGameStateInvariantIssues(state);
    expect(
      issuesNoOpt.filter((i) => i.code === "missing_continuous_effect")
    ).toHaveLength(0);

    // option あり → missing が出る
    const issuesWithOpt = collectGameStateInvariantIssues(state, {
      getCardDefinitionById: makeLookup([def]),
    });
    expect(
      issuesWithOpt.filter((i) => i.code === "missing_continuous_effect")
    ).toHaveLength(1);
  });
});
