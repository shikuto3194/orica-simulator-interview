/**
 * field_name_uniqueness（フィールド同名唯一性制限）のテスト。
 *
 * 「待機状態を含まない自分の同名スピリットはフィールドに1体しか存在できない」
 * （BSSG01 戦姫絶唱シンフォギア等）を表す continuous 効果が:
 *  1. フィールド上で `field_name_uniqueness` CE として登録されること
 *  2. `isBlockedByFieldNameUniqueness` が静的な同名 1 体の存在で召喚をブロックし、
 *     待機状態（pendingLeave）の既存個体はカウントから除外する（場唯一性バイパス）こと
 * を検証する。
 *
 * ルール正源: 10_rules/04_state-based-rules.md「待機状態中の場唯一性バイパス」。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  isBlockedByFieldNameUniqueness,
  rebuildContinuousEffectsFromField,
} from "../src";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

function makeLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

/** field_name_uniqueness continuous 効果を持つスピリット定義。 */
function uniqueSpiritDef(
  cardNo: string,
  name: string,
  names: "self" | string[] = "self"
): CardDefinition {
  return {
    cardNo,
    name,
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "装者",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "field_name_uniqueness",
              names,
              duration: { scope: "while_on_field" },
            },
          },
        ],
      },
    ],
  };
}

describe("field_name_uniqueness CE 登録", () => {
  it("continuous 効果を持つカードがフィールドに居ると CE を登録する (names:self)", () => {
    const def = uniqueSpiritDef("TEST-UNIQ-1", "暁 切歌");
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

    expect(result.activeContinuousEffects).toHaveLength(1);
    const ce = result.activeContinuousEffects[0]!;
    expect(ce.modifierTag).toBe("field_name_uniqueness");
    // 「自分の」フィールドに紐付く → targetInstanceId = controllerPlayerId
    expect(ce.targetInstanceId).toBe("alice");
    expect(ce.actingPlayerId).toBe("alice");
    expect(ce.metadata?.restrictedNames).toEqual(["暁 切歌"]);
  });

  it("冪等: 同じ state を 2 回 rebuild しても CE が増えない", () => {
    const def = uniqueSpiritDef("TEST-UNIQ-1", "暁 切歌");
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
    const lookup = makeLookup([def]);
    const once = rebuildContinuousEffectsFromField(state, lookup);
    const twice = rebuildContinuousEffectsFromField(once, lookup);
    expect(twice.activeContinuousEffects).toHaveLength(1);
  });

  it("[EDH-0007] BSSG02-C01 の場唯一性 CE は再計算を跨いでも保持する", () => {
    const def = ALL_CARDS.find((c) => c.cardNo === "BSSG02-C01")!;
    expect(def).toBeDefined();
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "akatsuki-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const lookup = (id: string) =>
      ALL_CARDS.find((c) => c.cardNo === id) ?? undefined;
    const result = rebuildContinuousEffectsFromField(state, lookup);
    const recomputed = recomputeContinuousEffects(result);
    const ce = recomputed.activeContinuousEffects.find(
      (e) => e.modifierTag === "field_name_uniqueness"
    );
    expect(ce).toBeDefined();
    expect(ce!.provenance?.effectIndex).toBe(0);
    expect(ce!.metadata?.restrictedNames).toEqual([
      "マリア・カデンツァヴナ・イヴ",
    ]);
  });
});

describe("isBlockedByFieldNameUniqueness", () => {
  const def = uniqueSpiritDef("TEST-UNIQ-1", "暁 切歌");
  const lookup = makeLookup([def]);

  /** alice 向けの field_name_uniqueness CE を 1 件持つ state を作る。 */
  function stateWithCe(
    restrictedNames: string[],
    fieldCards: GameState["cardInstances"]
  ): GameState {
    const ce: ContinuousEffect = {
      effectId: "uniq-ce",
      sourceInstanceId: "src-1",
      sourceDefinitionId: def.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "field_name_uniqueness",
      targetInstanceId: "alice",
      metadata: { restrictedNames },
    };
    return {
      ...makeState(),
      cardInstances: fieldCards,
      activeContinuousEffects: [ce],
    };
  }

  function fieldCopy(
    overrides: Parameters<typeof createCardInstance>[1]
  ): GameState["cardInstances"][number] {
    return createCardInstance(def, {
      zone: "field",
      ownerPlayerId: "alice",
      cores: 1,
      ...overrides,
    });
  }

  it("静的な同名スピリットが自フィールドにいれば召喚不可", () => {
    const state = stateWithCe(
      ["暁 切歌"],
      [fieldCopy({ instanceId: "existing-1" })]
    );
    expect(isBlockedByFieldNameUniqueness(state, "alice", def, lookup)).toBe(
      true
    );
  });

  it("既存の同名が待機状態(pendingLeave)なら召喚可 (場唯一性バイパス)", () => {
    const pendingCopy = fieldCopy({ instanceId: "leaving-1" });
    pendingCopy.pendingLeaveKind = "destroy";
    const state = stateWithCe(["暁 切歌"], [pendingCopy]);
    expect(isBlockedByFieldNameUniqueness(state, "alice", def, lookup)).toBe(
      false
    );
  });

  it("自フィールドに同名がいなければ召喚可", () => {
    const state = stateWithCe(["暁 切歌"], []);
    expect(isBlockedByFieldNameUniqueness(state, "alice", def, lookup)).toBe(
      false
    );
  });

  it("相手フィールドの同名は自分の制限に影響しない", () => {
    const bobCopy = fieldCopy({
      instanceId: "bob-1",
      ownerPlayerId: "bob",
    });
    bobCopy.controllerPlayerId = "bob";
    const state = stateWithCe(["暁 切歌"], [bobCopy]);
    expect(isBlockedByFieldNameUniqueness(state, "alice", def, lookup)).toBe(
      false
    );
  });

  it("制限名に含まれないカードはブロックしない", () => {
    const otherDef = uniqueSpiritDef("TEST-OTHER", "響 裏命");
    const otherLookup = makeLookup([def, otherDef]);
    const state = stateWithCe(
      ["暁 切歌"],
      [fieldCopy({ instanceId: "existing-1" })]
    );
    expect(
      isBlockedByFieldNameUniqueness(state, "alice", otherDef, otherLookup)
    ).toBe(false);
  });

  it("CE が無ければブロックしない", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [fieldCopy({ instanceId: "existing-1" })],
    };
    expect(isBlockedByFieldNameUniqueness(state, "alice", def, lookup)).toBe(
      false
    );
  });

  it("明示名配列 (X03型) は列挙された各名をそれぞれ制限する", () => {
    const kiriDef = uniqueSpiritDef("TEST-KIRI", "暁 切歌");
    const shirabeDef = uniqueSpiritDef("TEST-SHIRABE", "月読 調");
    const multiLookup = makeLookup([def, kiriDef, shirabeDef]);
    // 「月読 調」1 体が静的にフィールドにいる
    const shirabeOnField = createCardInstance(shirabeDef, {
      instanceId: "shirabe-1",
      zone: "field",
      ownerPlayerId: "alice",
      cores: 1,
    });
    const state = stateWithCe(["暁 切歌", "月読 調"], [shirabeOnField]);
    // 「月読 調」の追加召喚は不可
    expect(
      isBlockedByFieldNameUniqueness(state, "alice", shirabeDef, multiLookup)
    ).toBe(true);
    // 「暁 切歌」は静的個体がいないので可（制限名には含まれるが盤面に 0 体）
    expect(
      isBlockedByFieldNameUniqueness(state, "alice", kiriDef, multiLookup)
    ).toBe(false);
  });
});

describe("field_name_uniqueness 系統フィルタ + カウント連動上限 (BSFT01 星霊衣)", () => {
  // 「系統:『光導』と『星霊』を持つ自分のスピリットはフィールドに1体しか存在できない。
  //  自分のカウント4以上のとき2体まで」を表す filter ベース制限。
  function starSpiritDef(cardNo: string, name: string): CardDefinition {
    return {
      cardNo,
      name,
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "光導・星霊",
      effects: [],
    };
  }

  const srcDef = starSpiritDef("TEST-STAR-SRC", "星霊衣A");
  const otherStar = starSpiritDef("TEST-STAR-2", "星霊衣B");
  const plainDef: CardDefinition = {
    ...starSpiritDef("TEST-PLAIN", "平凡な装者"),
    tribe: "装者",
  };
  const lookup = makeLookup([srcDef, otherStar, plainDef]);

  function stateWithFilterCe(
    fieldCards: GameState["cardInstances"],
    countValue: number
  ): GameState {
    const ce: ContinuousEffect = {
      effectId: "uniq-filter-ce",
      sourceInstanceId: "src-1",
      sourceDefinitionId: srcDef.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "field_name_uniqueness",
      targetInstanceId: "alice",
      metadata: {
        restrictedNames: [],
        restrictFilter: {
          tribesRequired: ["光導", "星霊"],
          category: ["spirit"],
        },
        maxCount: 1,
        boostCondition: [{ kind: "count_value", player: "self", min: 4 }],
        boostedMaxCount: 2,
      },
    };
    const base = makeState();
    return {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, countValue } : p
      ),
      cardInstances: fieldCards,
      activeContinuousEffects: [ce],
    };
  }

  function starOnField(
    cardNo: string,
    instanceId: string
  ): GameState["cardInstances"][number] {
    const d = cardNo === srcDef.cardNo ? srcDef : otherStar;
    return createCardInstance(d, {
      instanceId,
      zone: "field",
      ownerPlayerId: "alice",
      cores: 1,
    });
  }

  it("系統 AND(光導+星霊)の静的 1 体で 2 体目召喚不可（カウント<4）", () => {
    const state = stateWithFilterCe([starOnField(srcDef.cardNo, "src-1")], 0);
    expect(
      isBlockedByFieldNameUniqueness(
        state,
        "alice",
        otherStar,
        lookup,
        evaluateCondition
      )
    ).toBe(true);
  });

  it("カウント4以上で上限が2体に上がり、静的 1 体なら 2 体目召喚可", () => {
    const state = stateWithFilterCe([starOnField(srcDef.cardNo, "src-1")], 4);
    expect(
      isBlockedByFieldNameUniqueness(
        state,
        "alice",
        otherStar,
        lookup,
        evaluateCondition
      )
    ).toBe(false);
  });

  it("カウント4以上でも静的 2 体いれば 3 体目召喚不可", () => {
    const state = stateWithFilterCe(
      [
        starOnField(srcDef.cardNo, "src-1"),
        starOnField(otherStar.cardNo, "s2"),
      ],
      4
    );
    expect(
      isBlockedByFieldNameUniqueness(
        state,
        "alice",
        otherStar,
        lookup,
        evaluateCondition
      )
    ).toBe(true);
  });

  it("系統を満たさないカードは制限対象外（装者単体は召喚可）", () => {
    const state = stateWithFilterCe([starOnField(srcDef.cardNo, "src-1")], 0);
    expect(
      isBlockedByFieldNameUniqueness(
        state,
        "alice",
        plainDef,
        lookup,
        evaluateCondition
      )
    ).toBe(false);
  });

  it("待機状態(pendingLeave)の星霊衣はカウントから除外（場唯一性バイパス）", () => {
    const leaving = starOnField(srcDef.cardNo, "src-1");
    leaving.pendingLeaveKind = "destroy";
    const state = stateWithFilterCe([leaving], 0);
    expect(
      isBlockedByFieldNameUniqueness(
        state,
        "alice",
        otherStar,
        lookup,
        evaluateCondition
      )
    ).toBe(false);
  });

  it("evaluateCondition 未注入時は boost されず基本上限(1)で判定", () => {
    const state = stateWithFilterCe([starOnField(srcDef.cardNo, "src-1")], 4);
    // boost 条件(カウント4以上)を満たすが評価器が無い → max=1 のまま 2 体目不可
    expect(
      isBlockedByFieldNameUniqueness(state, "alice", otherStar, lookup)
    ).toBe(true);
  });
});
