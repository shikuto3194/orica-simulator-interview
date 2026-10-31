/**
 * rebuildContinuousEffectsFromField のテスト。
 *
 * フィールド/ミラージュ/バースト上のカードから continuous 効果を走査して
 * 未登録の CE を activeContinuousEffects に追加するリビルダの挙動を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  isSafeStateForContinuousRebuild,
  rebuildContinuousEffectsFromField,
} from "../src";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  GameState,
  Zone,
} from "../src";

// ── 共通ヘルパ ─────────────────────────────────────────

/**
 * パチュリー型: continuous + cost_modify (free) で系統指定マジックを無料化。
 */
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

/**
 * Self_state condition 付き continuous (回復状態のときだけ effect_immunity)
 */
function recoveredOnlyImmuneDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "self_state",
            state: "recovered",
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
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

// ── テスト ─────────────────────────────────────────────

describe("rebuildContinuousEffectsFromField", () => {
  it("継続効果カードがフィールドに居るとき CE を登録する", () => {
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

    expect(state.activeContinuousEffects).toHaveLength(0);

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    expect(result.activeContinuousEffects).toHaveLength(1);
    const ce = result.activeContinuousEffects[0]!;
    expect(ce.modifierTag).toBe("cost_override");
    expect(ce.modifierAmount).toBe(0);
    expect(ce.sourceInstanceId).toBe("src-1");
    expect(ce.actingPlayerId).toBe("alice");
    expect(ce.provenance).toEqual({ effectIndex: 0, stepIndex: 0 });
  });

  it("冪等: 同じ state を 2 回渡しても CE が増えない", () => {
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
    const once = rebuildContinuousEffectsFromField(state, lookup);
    const twice = rebuildContinuousEffectsFromField(once, lookup);

    expect(twice.activeContinuousEffects).toHaveLength(1);
  });

  it("旧パイプライン経由で登録済み CE (provenance なし) は重複登録しない", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const legacyCe: ContinuousEffect = {
      effectId: "legacy-ce",
      sourceInstanceId: "src-1",
      sourceDefinitionId: def.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: 0,
      targetFilter: {
        player: "self",
        category: ["magic"],
        tribes: ["紅魔", "導魔"],
      },
      // provenance フィールド意図的に未設定 (旧 CE 想定)
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
      activeContinuousEffects: [legacyCe],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    expect(result.activeContinuousEffects).toHaveLength(1);
    expect(result.activeContinuousEffects[0]!.effectId).toBe("legacy-ce");
  });

  it("ハンドのカードは無視する (フィールドでないため)", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    expect(result.activeContinuousEffects).toHaveLength(0);
  });

  it("condition unmet のときは CE を追加しない (疲労状態の self_state condition)", () => {
    const def = recoveredOnlyImmuneDef("TEST-IMMUNE");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          exhaustState: "exhausted",
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    expect(result.activeContinuousEffects).toHaveLength(0);
  });

  it("condition met (回復状態) のときは CE を追加する", () => {
    const def = recoveredOnlyImmuneDef("TEST-IMMUNE");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          exhaustState: "recovered",
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    expect(result.activeContinuousEffects.length).toBeGreaterThanOrEqual(1);
    const tags = result.activeContinuousEffects.map((ce) => ce.modifierTag);
    expect(tags).toContain("defense_immune");
  });

  it("カード定義が見つからないときはスキップ (no throw)", () => {
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

    // Lookup that returns undefined for everything
    const result = rebuildContinuousEffectsFromField(state, () => undefined);

    expect(result.activeContinuousEffects).toHaveLength(0);
  });

  it("複数のフィールドカードを並行処理する", () => {
    const def1 = patchouliLikeDef("TEST-A");
    const def2 = patchouliLikeDef("TEST-B");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def1, {
          instanceId: "src-A",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(def2, {
          instanceId: "src-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(
      state,
      makeLookup([def1, def2])
    );

    expect(result.activeContinuousEffects).toHaveLength(2);
    const sourceIds = result.activeContinuousEffects.map(
      (ce) => ce.sourceInstanceId
    );
    expect(sourceIds.sort()).toEqual(["src-A", "src-B"]);
  });

  it("Phase 2: executor が native に provenance を付与する (diff-and-tag に依存しない)", () => {
    // 2 つの effects を持つカード定義を作り、2 番目の effects[1] にも CE が登録されることを確認
    const def: CardDefinition = {
      cardNo: "TEST-MULTI",
      name: "TEST-MULTI",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        // effects[0]
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "cost_modify",
                player: "self",
                cardFilter: { category: ["magic"] },
                modifier: "free",
                duration: { scope: "permanent" },
              },
            },
          ],
        },
        // effects[1]
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "effect_immunity",
                target: { kind: "self" },
                duration: { scope: "permanent" },
              },
            },
          ],
        },
      ],
    };
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    expect(result.activeContinuousEffects.length).toBeGreaterThanOrEqual(2);
    const provs = result.activeContinuousEffects
      .filter((ce) => ce.provenance !== undefined)
      .map((ce) => ce.provenance);
    // effects[0], effects[1] それぞれの effectIndex で provenance が記録される
    const indices = provs.map((p) => p!.effectIndex).sort();
    expect(indices).toContain(0);
    expect(indices).toContain(1);
  });
});

// ── 〔重複不可〕(no_duplicate) continuous ────────────────────

describe("rebuildContinuousEffectsFromField: 〔重複不可〕continuous", () => {
  /**
   * 〔重複不可〕付き continuous bp_modify (自分の同名カードを BP+5000)。
   * cardNo と name を分離して「同名・別インスタンス」を作れるようにする。
   */
  function noDupBpDef(
    cardNo: string,
    name: string,
    filter: { cardName?: { contains: string }[]; minCost?: number } = {
      cardName: [{ contains: name }],
    },
    targetOptions: {
      excludeSelf?: boolean;
      zone?: Zone | Zone[];
      budget?: { metric: "bp" | "cost" | "symbol"; amount: number };
    } = {}
  ): CardDefinition {
    return {
      cardNo,
      name,
      printedCategory: "spirit",
      colors: ["red"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "付喪",
      effects: [
        {
          timing: { kind: "continuous" },
          usageLimit: { kind: "no_duplicate" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "self",
                  filter,
                  count: "all",
                  ...targetOptions,
                },
                amount: 5000,
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    };
  }

  it("同名カードが 2 体いても CE 群は 1 invocation 分のみ登録する (多重適用防止)", () => {
    const def = noDupBpDef("TEST-NODUP", "弁々");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(def, {
          instanceId: "src-2",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    // filter.cardName を持つ bp_modify は dynamic-all CE として targetFilter を保持する。
    // 〔重複不可〕は invocation 単位で 1 度だけ実行を許すため、同名2体分へ
    // 個別 CE を作らず、src-1 由来の global CE 1 件だけが登録される。
    const bpCes = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCes).toHaveLength(1);
    const sources = new Set(bpCes.map((ce) => ce.sourceInstanceId));
    expect(sources.size).toBe(1);
    expect(bpCes[0]!.targetInstanceId).toBeUndefined();
    expect(bpCes[0]!.targetFilter).toEqual({
      player: "self",
      cardName: [{ contains: "弁々" }],
    });
  });

  it("minCost を持つ bp_modify は実効コスト文脈が必要なため snapshot CE にする", () => {
    const def = noDupBpDef("TEST-NODUP-MINCOST", "弁々", {
      cardName: [{ contains: "弁々" }],
      minCost: 4,
    });
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(def, {
          instanceId: "src-2",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    const bpCes = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCes).toHaveLength(2);
    expect(bpCes.every((ce) => ce.targetFilter === undefined)).toBe(true);
    expect(new Set(bpCes.map((ce) => ce.targetInstanceId))).toEqual(
      new Set(["src-1", "src-2"])
    );
  });

  it("TargetSpec レベル制約を持つ bp_modify は global CE にせず snapshot CE にする", () => {
    const def = noDupBpDef(
      "TEST-NODUP-EXCLUDE-SELF",
      "弁々",
      { cardName: [{ contains: "弁々" }] },
      { excludeSelf: true }
    );
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(def, {
          instanceId: "src-2",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    const bpCes = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCes).toHaveLength(1);
    expect(bpCes[0]!.targetFilter).toBeUndefined();
    expect(bpCes[0]!.targetInstanceId).toBe("src-2");
  });

  it("別カード名なら別々に CE を登録する (重複不可はカード名スコープ)", () => {
    const defA = noDupBpDef("TEST-NODUP-A", "弁々");
    const defB = noDupBpDef("TEST-NODUP-B", "八橋");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(defA, {
          instanceId: "src-A",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(defB, {
          instanceId: "src-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(
      state,
      makeLookup([defA, defB])
    );

    const bpCes = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCes).toHaveLength(2);
  });

  it("相手が同名を持っていても自分の登録を妨げない (コントローラースコープ)", () => {
    const def = noDupBpDef("TEST-NODUP", "弁々");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(def, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    const bpCes = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    // alice 側 1 つ + bob 側 1 つ = 2 つ (別コントローラーは独立)
    expect(bpCes).toHaveLength(2);
  });
});

// ── safety guard ─────────────────────────────────────────────

describe("rebuildContinuousEffectsFromField: safety guard", () => {
  function fakeAttack(): ActiveAttack {
    return {
      attackId: "atk-1",
      primaryEntityId: "ent-1",
      participantEntityIds: ["ent-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
  }

  it("activeAttack が設定された state で呼ぶと例外を投げる", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      activeAttack: fakeAttack(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    expect(() =>
      rebuildContinuousEffectsFromField(state, makeLookup([def]))
    ).toThrow(/activeAttack/);
  });

  it("effectQueueEntries が残っている state で呼ぶと例外を投げる", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      effectQueueEntries: [
        // 中身は最低限の dummy。ガード検知のために length > 0 にしているだけ。
        // 形式不正でもガードが先に発火するので問題ない。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { dummy: true } as any,
      ],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    expect(() =>
      rebuildContinuousEffectsFromField(state, makeLookup([def]))
    ).toThrow(/effectQueueEntries/);
  });

  it("pendingPrivateDeclarations が残っている state で呼ぶと例外を投げる (P3-44)", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      pendingPrivateDeclarations: [
        // 形式は最低限。length > 0 のガード検知だけ確認する。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { declarationId: "decl-1" } as any,
      ],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    expect(() =>
      rebuildContinuousEffectsFromField(state, makeLookup([def]))
    ).toThrow(/pendingPrivateDeclarations/);
  });

  it("pendingBurstChecks が残っている state で呼ぶと例外を投げる (P3-44)", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      pendingBurstChecks: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { checkId: "check-1" } as any,
      ],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    expect(() =>
      rebuildContinuousEffectsFromField(state, makeLookup([def]))
    ).toThrow(/pendingBurstChecks/);
  });

  it("battleImmediateEffects が残っている state で呼ぶと例外を投げる (P3-44)", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      battleImmediateEffects: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { promptId: "bie-1" } as any,
      ],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    expect(() =>
      rebuildContinuousEffectsFromField(state, makeLookup([def]))
    ).toThrow(/battleImmediateEffects/);
  });

  it("unsafeAllowDuringBattle: true ならガードをバイパスして実行できる", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      activeAttack: fakeAttack(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]), {
      unsafeAllowDuringBattle: true,
    });

    expect(result.activeContinuousEffects).toHaveLength(1);
  });

  it("isSafeStateForContinuousRebuild: 空の state なら true", () => {
    expect(isSafeStateForContinuousRebuild(makeState())).toBe(true);
  });

  it("isSafeStateForContinuousRebuild: activeAttack 設定で false", () => {
    const state: GameState = {
      ...makeState(),
      activeAttack: fakeAttack(),
    };
    expect(isSafeStateForContinuousRebuild(state)).toBe(false);
  });
});

// ── retrigger range-out (リビルダの守備範囲外) ──────────────

describe("rebuildContinuousEffectsFromField: retrigger は守備範囲外", () => {
  /**
   * activated/flash timing の retrigger 効果。
   * リビルダは continuous 効果のみ走査するので、これは触らない。
   */
  function flashRetriggerDef(cardNo: string): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory: "magic",
      colors: ["yellow"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
                amount: -2000,
                duration: { scope: "turn" },
              },
              retrigger: {
                event: "attack",
                triggerPlayer: "self",
                maxCount: 3,
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    };
  }

  it("activated timing の retrigger 効果はリビルダで触らない (CE が増えない)", () => {
    const def = flashRetriggerDef("TEST-RETRIG-FLASH");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        // burst ゾーン (continuous 走査対象) に置いても、timing が continuous でないため
        // リビルダはスキップする
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
    };

    const result = rebuildContinuousEffectsFromField(state, makeLookup([def]));

    expect(result.activeContinuousEffects).toHaveLength(0);
  });
});
