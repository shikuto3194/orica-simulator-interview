import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
/**
 * BSTH02.7-R01「博愛の仏蘭西人形」effects[0]:
 * 「自分はデッキの下から2枚ドローできる。または、自分のトラッシュにあるマジックカード1枚を
 *  手札/手元/デッキの上に戻せる。その後、ドローしなかったとき、自分のカウント1以上なら、
 *  〔ステップに1回:同名〕系統：「幻想」/「導魔」/「動玩」を持つコスト7以下のスピリットカード
 *  1枚をコストを支払わずに召喚できる。」
 *
 * choice (draw2 既定 / trash magic → hand・set_aside・deck top の3択) + 選択と成立結果で
 * 「ドローしなかったとき」を判定 + count_value(min:1) + costModifier:"free" 召喚の組み合わせで表現。
 * 新規 primitive 不要 (既存 choice/ref_choice/count_value/summon の組み合わせ)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src/index";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState } from "../src/index";

function drainOptionalStepsWithExecute(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined
): GameState {
  let s = state;
  while (s.pendingStepOptionalChoice !== null) {
    const psoc = s.pendingStepOptionalChoice;
    s = applyLegalAction({
      state: s,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }
  return s;
}

const ALL_CARDS_MAP = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (cardNo: string): CardDefinition => {
  const def = ALL_CARDS_MAP.get(cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def;
};

const MAGIC_IN_TRASH: CardDefinition = {
  cardNo: "TEST-R01-TRASH-MAGIC",
  name: "トラッシュのマジック",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const HAND_SPIRIT: CardDefinition = {
  cardNo: "TEST-R01-HAND-SPIRIT",
  name: "手札の幻想導魔スピリット",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・導魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

function getBSTHDefinition(id: string): CardDefinition | undefined {
  return ALL_CARDS_MAP.get(id) ?? extraDefs.get(id);
}
const extraDefs = new Map<string, CardDefinition>([
  [MAGIC_IN_TRASH.cardNo, MAGIC_IN_TRASH],
  [HAND_SPIRIT.cardNo, HAND_SPIRIT],
]);

function makeState(
  cardInstances: GameState["cardInstances"],
  countValue: number
): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances,
    playerOverrides: [{ countValue, handCount: 1 }, {}],
  });
}

describe("BSTH02.7-R01 effects[0]: 召喚時 二択(ドロー/トラッシュ回収) + 無コスト召喚", () => {
  const r01 = card("BSTH02.7-R01");
  const summonTime = r01.effects![0]!;

  it("DSL 構造: stub 解消・choice 3種 (手札/手元/デッキ上) + 無コスト召喚 stepCondition", () => {
    expect(summonTime.stub).toBeUndefined();
    // 効果全体の「できる」は effect-level で選ぶ。発揮後の最初の二択を
    // step-level で辞退して、後段の召喚だけを使うことはできない。
    expect(summonTime.executionMode).toBe("optional");
    expect(summonTime.steps).toHaveLength(2);
    const modeStep = summonTime.steps[0]!;
    expect(modeStep.executionMode).toBeUndefined();
    expect(modeStep.action.kind).toBe("draw");
    // 原文「デッキの下から2枚ドロー」= position:"bottom"（省略時は既定 "top" になる）。
    expect(modeStep.action).toMatchObject({ count: 2, position: "bottom" });
    expect(modeStep.choice).toHaveLength(3);
    const summonStep = summonTime.steps[1]!;
    expect(summonStep.action.kind).toBe("summon");
    if (
      summonStep.action.kind === "summon" &&
      summonStep.action.target.kind === "from_zone"
    ) {
      expect(summonStep.action.costModifier).toBe("free");
      // textLines[1] は「幻想」/「導魔」/「動玩」(「と」を含まないフラットOR)。
      // 同カード effects[1] textLines[4]「幻想」と「導魔」/「動玩」(AND+OR) とは区別する。
      expect(summonStep.action.target.filter).toEqual({
        category: ["spirit"],
        tribes: ["幻想", "導魔", "動玩"],
        maxCost: 7,
      });
    }
    expect(summonStep.stepCondition).toEqual({
      kind: "all",
      conditions: [
        { kind: "ref_choice", stepId: "mode", choiceIndex: 0 },
        { kind: "ref_succeeded", stepId: "mode" },
      ],
      not: true,
    });
    expect(summonStep.condition).toEqual([
      { kind: "count_value", player: "self", min: 1 },
    ]);
    expect(summonStep.executionMode).toBe("optional");
  });

  it("[board] 手札に戻す(choiceIndex:1) を選び、カウント1以上なら無コスト召喚される", () => {
    const source = createCardInstance(r01, {
      instanceId: "r01-src",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const trashMagic = createCardInstance(MAGIC_IN_TRASH, {
      instanceId: "trash-magic",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const handSpirit = createCardInstance(HAND_SPIRIT, {
      instanceId: "hand-spirit",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const before = makeState([source, trashMagic, handSpirit], 1);

    let after = acceptOptionalSteps(
      executeEffect({
        chainId: "test:bsth02-7-r01-summon-time-choice:174",
        state: before,
        effect: summonTime,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSTHDefinition,
        getRegisteredTriggeredEffectActions: () => [],
        choiceIndex: 1,
      }),
      getBSTHDefinition
    );
    after = drainOptionalStepsWithExecute(after, getBSTHDefinition);

    expect(
      after.cardInstances.find((c) => c.instanceId === "trash-magic")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-spirit")?.zone
    ).toBe("field");
  });

  it("[board] デッキ下2枚ドロー(choiceIndex:0、既定) を選ぶと無コスト召喚は発動しない", () => {
    const source = createCardInstance(r01, {
      instanceId: "r01-src",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const trashMagic = createCardInstance(MAGIC_IN_TRASH, {
      instanceId: "trash-magic",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const handSpirit = createCardInstance(HAND_SPIRIT, {
      instanceId: "hand-spirit",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    // デッキ順序が判別できるよう3枚配置 (先頭=top / 末尾=bottom)。
    // 原文「デッキの下から2枚ドロー」= position:"bottom" が正しく配線されていれば
    // deck-top (先頭) は残り、deck-mid/deck-bottom (末尾2枚) が手札に移る。
    const deckTop = createCardInstance(MAGIC_IN_TRASH, {
      instanceId: "deck-top",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const deckMid = createCardInstance(MAGIC_IN_TRASH, {
      instanceId: "deck-mid",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const deckBottom = createCardInstance(MAGIC_IN_TRASH, {
      instanceId: "deck-bottom",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const before = makeState(
      [source, trashMagic, handSpirit, deckTop, deckMid, deckBottom],
      1
    );

    const after = acceptOptionalSteps(
      executeEffect({
        chainId: "test:bsth02-7-r01-summon-time-choice:235",
        state: before,
        effect: summonTime,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSTHDefinition,
        getRegisteredTriggeredEffectActions: () => [],
        choiceIndex: 0,
      }),
      getBSTHDefinition
    );

    expect(after.players.find((p) => p.id === "alice")?.handCount).toBe(3);
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-top")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-mid")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-bottom")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "trash-magic")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-spirit")?.zone
    ).toBe("hand");
  });

  it("[board] 手札に戻す(choiceIndex:1) を選んでもカウント0なら無コスト召喚は発動しない", () => {
    const source = createCardInstance(r01, {
      instanceId: "r01-src",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const trashMagic = createCardInstance(MAGIC_IN_TRASH, {
      instanceId: "trash-magic",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const handSpirit = createCardInstance(HAND_SPIRIT, {
      instanceId: "hand-spirit",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const before = makeState([source, trashMagic, handSpirit], 0);

    const after = acceptOptionalSteps(
      executeEffect({
        chainId: "test:bsth02-7-r01-summon-time-choice:284",
        state: before,
        effect: summonTime,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getBSTHDefinition,
        getRegisteredTriggeredEffectActions: () => [],
        choiceIndex: 1,
      }),
      getBSTHDefinition
    );

    expect(
      after.cardInstances.find((c) => c.instanceId === "trash-magic")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-spirit")?.zone
    ).toBe("hand");
  });

  it("[board] 発揮後のドロー分岐は辞退できず、空デッキでドローしなかった結果のみ後段召喚を選べる", () => {
    const source = createCardInstance(r01, {
      instanceId: "r01-src",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const spirit = createCardInstance(HAND_SPIRIT, {
      instanceId: "hand-spirit",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    // 空のデッキではドローは成立しない。ただし effect の発揮が
    // 選ばれた後、先頭 step の execute/decline prompt は出されない。
    let state = executeEffect({
      chainId: "test:bsth02-7-r01-summon-time-choice:317",
      state: makeState([source, spirit], 1),
      effect: summonTime,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getBSTHDefinition,
      choiceIndex: 0,
    });
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(1);
    state = drainOptionalStepsWithExecute(state, getBSTHDefinition);
    expect(
      state.cardInstances.find((c) => c.instanceId === spirit.instanceId)?.zone
    ).toBe("field");
    expect(state.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] 幻想を持たない導魔スピリット(動玩/導魔いずれかのみ)もフラットORで召喚候補になる", () => {
    // textLines[1]「系統：「幻想」/「導魔」/「動玩」を持つ」は「と」を含まないため
    // 3系統フラットOR (tribesRequired 不要)。同カード effects[1] textLines[4]
    // 「幻想」と「導魔」/「動玩」(AND+OR) とは区別する。
    const doutakuOnlySpirit: CardDefinition = {
      cardNo: "TEST-R01-DOUTAKU-ONLY-SPIRIT",
      name: "幻想を持たない動玩スピリット",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 2000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "動玩",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map<string, CardDefinition>([
      ...extraDefs,
      [doutakuOnlySpirit.cardNo, doutakuOnlySpirit],
    ]);
    const getDef = (id: string) => ALL_CARDS_MAP.get(id) ?? localDefs.get(id);

    const source = createCardInstance(r01, {
      instanceId: "r01-src",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const trashMagic = createCardInstance(MAGIC_IN_TRASH, {
      instanceId: "trash-magic",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const spirit = createCardInstance(doutakuOnlySpirit, {
      instanceId: "doutaku-spirit",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const before = makeState([source, trashMagic, spirit], 1);

    let after = acceptOptionalSteps(
      executeEffect({
        chainId: "test:bsth02-7-r01-summon-time-choice:376",
        state: before,
        effect: summonTime,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        choiceIndex: 1,
      }),
      getDef
    );
    after = drainOptionalStepsWithExecute(after, getDef);

    expect(
      after.cardInstances.find((c) => c.instanceId === "doutaku-spirit")?.zone
    ).toBe("field");
  });
});
