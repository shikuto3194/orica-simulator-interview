/**
 * 発生源スコープ限定の「相手の効果を受けない」(immunitySourceScope) の回帰テスト。
 *
 * 「相手のスピリットの効果を受けない」「相手の赤の効果を受けない」「コスト5以下の相手の
 * 効果を受けない」型の defense_immune は、効果の*発生源カード*がスコープ
 * (categories / colors / maxCost) に一致するときだけ免疫を成立させる。スコープ無しの
 * blanket 免疫 (従来挙動) と区別する。
 *
 * - isCardImmuneToOpponentEffect: effectSource.definition を渡し、スコープ照合する。
 * - 発生源不明 (definition 未提供) は保守的に免疫を成立させない (過剰免疫を防ぐ)。
 * - getStrongestDefenseLevel (発生源非依存の SSOT) はスコープ付き CE を数えない。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  filterTargetsByPreventionLevel,
  getStrongestDefenseLevel,
  isCardTextCardState,
} from "../src";
import { isBattleCapableCategory } from "../src/battle/battle-shared";
import { getEffectiveCategory } from "../src/mechanics/act-as-spirit";
import { executeDestroy } from "../src/effect/structured-effect-interpreter";
import {
  filterOutImmuneCards,
  isCardImmuneToOpponentEffect,
} from "../src/effect/effect-resistance-check";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src/model";

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

function fieldCard(instanceId: string, owner = ALICE): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 3,
  });
}

/** instanceId を「相手の効果を受けない」にする defense_immune CE (任意で発生源スコープ付き)。 */
function immunityCE(
  targetInstanceId: string,
  immunitySourceScope?: ContinuousEffect["immunitySourceScope"]
): ContinuousEffect {
  return {
    effectId: `di-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "TEST-IMMUNE",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
    ...(immunitySourceScope ? { immunitySourceScope } : {}),
  };
}

function stateWith(card: CardInstance, ce: ContinuousEffect): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: [card],
    activeContinuousEffects: [ce],
  };
}

describe("発生源スコープ限定 immunity (immunitySourceScope)", () => {
  // 公式エターナル Q3641: スピリットカード状態の効果も「スピリットの効果」。
  // 戦闘実体の有無を効果源の種類照合へ流用しない。
  it.each(["hand", "trash", "set_aside", "burst", "field"] as const)(
    "%s のスピリットカードは戦闘できなくても、スピリット効果耐性で防がれる",
    (zone) => {
      const sourceDef = dummyDef({ cardNo: "CARD-STATE-SOURCE" });
      const source = createCardInstance(sourceDef, {
        instanceId: "source",
        ownerPlayerId: BOB,
        zone,
        zoneRoleName: "spirit-card",
      });
      const protectedTarget = fieldCard("protected");
      const otherTarget = fieldCard("unprotected");
      const state = {
        ...stateWith(
          protectedTarget,
          immunityCE("protected", { categories: ["spirit"] })
        ),
        cardInstances: [source, protectedTarget, otherTarget],
      };
      const lookup = (id: string) =>
        id === sourceDef.cardNo ? sourceDef : dummyDef();
      expect(isCardTextCardState(source, state)).toBe(true);
      expect(isBattleCapableCategory(sourceDef, source, state)).toBe(false);
      expect(getEffectiveCategory(state, source, sourceDef)).toBe("spirit");
      expect(
        filterTargetsByPreventionLevel(
          state,
          ["protected", "unprotected"],
          "none",
          {
            actingPlayerId: BOB,
            effectSource: { instance: source, definition: sourceDef },
          }
        )
      ).toEqual(["unprotected"]);
      const after = executeDestroy(
        state,
        BOB,
        { player: "opponent", category: ["spirit"], count: -1 },
        lookup,
        source.instanceId
      );
      expect(
        after.cardInstances.find((c) => c.instanceId === "protected")!
          .pendingLeaveKind
      ).toBeNull();
      expect(
        after.cardInstances.find((c) => c.instanceId === "unprotected")!
          .pendingLeaveKind
      ).toBe("destroy");
    }
  );

  it("categories:['spirit'] はスピリット発生源の相手効果のみ免疫、マジック発生源は受ける", () => {
    const target = fieldCard("t1");
    const state = stateWith(
      target,
      immunityCE("t1", { categories: ["spirit"] })
    );

    const spiritSource = dummyDef({ printedCategory: "spirit" });
    const magicSource = dummyDef({ printedCategory: "magic" });

    // スピリット発生源 → 免疫成立
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: spiritSource,
      })
    ).toBe(true);
    // マジック発生源 → 免疫不成立 (受ける)
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: magicSource,
      })
    ).toBe(false);
  });

  it("発生源不明 (definition 未提供) はスコープ付き免疫を成立させない (過剰免疫防止)", () => {
    const target = fieldCard("t2");
    const state = stateWith(
      target,
      immunityCE("t2", { categories: ["spirit"] })
    );

    expect(isCardImmuneToOpponentEffect(state, target, BOB)).toBe(false);
    expect(isCardImmuneToOpponentEffect(state, target, BOB, "none", {})).toBe(
      false
    );
  });

  it("colors / maxCost スコープも発生源カードで照合する (複数条件は AND)", () => {
    const target = fieldCard("t3");
    const state = stateWith(
      target,
      immunityCE("t3", { colors: ["blue"], maxCost: 4 })
    );

    // 青 ∧ コスト4以下 → 免疫
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: dummyDef({ colors: ["blue"], cost: 4 }),
      })
    ).toBe(true);
    // 青だがコスト5 → AND 不成立で受ける
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: dummyDef({ colors: ["blue"], cost: 5 }),
      })
    ).toBe(false);
    // コスト4以下だが赤 → 色不一致で受ける
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: dummyDef({ colors: ["red"], cost: 2 }),
      })
    ).toBe(false);
  });

  it("スコープ無し blanket 免疫は発生源を問わず免疫 (従来挙動を維持)", () => {
    const target = fieldCard("t4");
    const state = stateWith(target, immunityCE("t4"));

    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: dummyDef({ printedCategory: "magic" }),
      })
    ).toBe(true);
    // 発生源不明でも blanket は成立
    expect(isCardImmuneToOpponentEffect(state, target, BOB)).toBe(true);
  });

  it("getStrongestDefenseLevel (発生源非依存 SSOT) はスコープ付き CE を数えない", () => {
    const target = fieldCard("t5");
    const scoped = stateWith(
      target,
      immunityCE("t5", { categories: ["spirit"] })
    );
    const blanket = stateWith(target, immunityCE("t5"));

    // スコープ付きのみ → blanket 集計では none (発生源を知らないため数えない)
    expect(getStrongestDefenseLevel(scoped, "t5")).toBe("none");
    // スコープ無し → 従来どおり immune
    expect(getStrongestDefenseLevel(blanket, "t5")).toBe("immune");
  });

  it("filterOutImmuneCards も発生源定義でスコープ照合して分割する", () => {
    const target = fieldCard("t6");
    const state = stateWith(
      target,
      immunityCE("t6", { categories: ["spirit"] })
    );

    // スピリット発生源 → blocked
    const bySpirit = filterOutImmuneCards(state, [target], BOB, "none", {
      definition: dummyDef({ printedCategory: "spirit" }),
    });
    expect(bySpirit.blocked.map((c) => c.instanceId)).toEqual(["t6"]);
    expect(bySpirit.allowed).toHaveLength(0);

    // マジック発生源 → allowed
    const byMagic = filterOutImmuneCards(state, [target], BOB, "none", {
      definition: dummyDef({ printedCategory: "magic" }),
    });
    expect(byMagic.allowed.map((c) => c.instanceId)).toEqual(["t6"]);
    expect(byMagic.blocked).toHaveLength(0);
  });

  it("filterTargetsByPreventionLevel は sourceScope に合う発生源だけを候補除外する", () => {
    const target = fieldCard("target-1", ALICE);
    const sourceSpiritDef = dummyDef({
      cardNo: "SRC-SPIRIT",
      printedCategory: "spirit",
    });
    const sourceMagicDef = dummyDef({
      cardNo: "SRC-MAGIC",
      printedCategory: "magic",
    });
    const sourceSpirit = createCardInstance(sourceSpiritDef, {
      instanceId: "source-spirit-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const sourceMagic = createCardInstance(sourceMagicDef, {
      instanceId: "source-magic-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [target, sourceSpirit, sourceMagic],
      activeContinuousEffects: [
        immunityCE("target-1", { categories: ["spirit", "nexus"] }),
      ],
    };

    expect(
      filterTargetsByPreventionLevel(state, ["target-1"], "none", {
        actingPlayerId: BOB,
        effectSource: {
          instance: sourceSpirit,
          definition: sourceSpiritDef,
        },
      })
    ).toEqual([]);
    expect(
      filterTargetsByPreventionLevel(state, ["target-1"], "none", {
        actingPlayerId: BOB,
        effectSource: {
          instance: sourceMagic,
          definition: sourceMagicDef,
        },
      })
    ).toEqual(["target-1"]);
  });

  it("sourceScope.excludeSelf は同一 sourceInstanceId の効果だけ免疫対象から除外する", () => {
    const target = fieldCard("target-exclude-self", ALICE);
    const otherSource = createCardInstance(dummyDef(), {
      instanceId: "other-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [target, otherSource],
      activeContinuousEffects: [
        {
          ...immunityCE("target-exclude-self", { excludeSelf: true }),
          immunityPlayerScope: "any",
        },
      ],
    };

    expect(
      isCardImmuneToOpponentEffect(state, target, ALICE, "none", {
        instance: target,
        definition: dummyDef(),
      })
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        instance: otherSource,
        definition: dummyDef(),
      })
    ).toBe(true);
    expect(isCardImmuneToOpponentEffect(state, target, BOB)).toBe(true);
    expect(isCardImmuneToOpponentEffect(state, target, BOB, "none", {})).toBe(
      true
    );
  });
});

/**
 * 発生源スコープは*実効値*で照合する（印字値ではない）。発生源 instance を渡すと
 * getEffectiveColors（treat_as_color）/ getEffectiveCategory（act_as_spirit）を反映する。
 */
function treatAsColorCE(
  targetInstanceId: string,
  color: string
): ContinuousEffect {
  return {
    effectId: `tac-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "TEST-TREAT",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "treat_as_color",
    modifierSymbol: [color as never],
    targetInstanceId,
  };
}

function actAsSpiritCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `aas-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "TEST-ACT",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit",
    targetInstanceId,
  };
}

describe("発生源スコープは実効値で照合する (printed ではない)", () => {
  it("colors:['red'] は treat_as_color で赤化した青発生源にも免疫成立 (実効色)", () => {
    const target = fieldCard("ti1", ALICE);
    // 発生源: 印字は青。treat_as_color CE で赤を加色 → 実効色 {青,赤}。
    const source = createCardInstance(dummyDef({ colors: ["blue"] }), {
      instanceId: "src1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [target, source],
      activeContinuousEffects: [
        immunityCE("ti1", { colors: ["red"] }),
        treatAsColorCE("src1", "red"),
      ],
    };

    // instance を渡す → 実効色で赤一致 → 免疫成立
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        instance: source,
        definition: dummyDef({ colors: ["blue"] }),
      })
    ).toBe(true);
    // definition のみ (印字 blue) のフォールバックでは不成立 = 実効化の効果を裏付ける
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: dummyDef({ colors: ["blue"] }),
      })
    ).toBe(false);
  });

  it("categories:['spirit'] は act_as_spirit でスピリット化した発生源にも免疫成立 (実効 category)", () => {
    const target = fieldCard("ti2", ALICE);
    // 発生源: 印字 nexus。act_as_spirit CE で実効 category=spirit。
    const source = createCardInstance(dummyDef({ printedCategory: "nexus" }), {
      instanceId: "src2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [target, source],
      activeContinuousEffects: [
        immunityCE("ti2", { categories: ["spirit"] }),
        actAsSpiritCE("src2"),
      ],
    };

    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        instance: source,
        definition: dummyDef({ printedCategory: "nexus" }),
      })
    ).toBe(true);
    // 印字 nexus のフォールバックでは spirit スコープに一致しない
    expect(
      isCardImmuneToOpponentEffect(state, target, BOB, "none", {
        definition: dummyDef({ printedCategory: "nexus" }),
      })
    ).toBe(false);
  });
});
