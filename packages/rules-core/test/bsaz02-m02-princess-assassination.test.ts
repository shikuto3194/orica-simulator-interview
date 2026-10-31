/**
 * BSAZ02-M02「アセイラム姫暗殺事件」effects[0,1,2] 検証。
 *
 * 原文 (textLines[0]):
 *   〔ターンに1回：同名〕トラッシュにあるこのカードは、系統：「火星」を持つネクサスが
 *   配置されたとき、手札に戻せる。
 * 原文 (textLines[2]):
 *   手札にあるこのカードは、自分の導界者ネクサスが相手の効果の対象になるとき、
 *   コストを支払わずに使用できる。
 * 原文 (textLines[4,5]):
 *   フラッシュ
 *   〔ターンに1回:同名〕自分の「ヴァース」を含む導界者ネクサス1つを破壊することで、
 *   手札のコスト7以下のアルティメットカード1枚を召喚条件を無視してコストを支払わずに
 *   召喚する。
 *
 * 検証点:
 *  - effects[0]: BSAZ02-M03 effects[0] 同型のトラッシュ常駐第三者観測 (自分/相手いずれの
 *    火星ネクサス配置でも誘発)。usageLimit の duration は turn (M03 は game)。
 *  - effects[1]: BSES01-C01 effects[2] 同型 (targetsGrandwalker:"only"+hasMechanic:["guided"]
 *    で導界者ネクサスのみに絞る)。創界神(grandwalker)専用ネクサス・通常ネクサスには
 *    マッチしないことを matchesCardFilterByDef で確認する。
 *  - effects[2]: 「Xを破壊することで、Yする」= conditional_cost (BSAZ01-C07 effects[3]
 *    precedent)。destroy 側フィルタは「ヴァース」を名前に含む導界者ネクサスのみに一致し、
 *    創界神ネクサスや「ヴァース」を含まない導界者ネクサスには一致しないことを確認する。
 *    summon 側は ignoreSummonCondition:true でこの action 単発の召喚条件を無視するため、
 *    召喚条件を満たさないアルティメットでも盤面上召喚が成立することを確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { matchesCardFilterByDef } from "../src/card/card-filter";
import type { CardDefinition, GameState } from "../src/model";
import { applyLegalAction, getLegalActions } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const M02 = card("BSAZ02-M02");

const ALICE = "player-1";
const BOB = "player-2";

function marsNexusDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト火星ネクサス ${cardNo}`,
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "火星",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const NEXUS1 = marsNexusDef("TEST-MARS-NEXUS-M02-1");

const guidedVersNexusDef: CardDefinition = {
  cardNo: "TEST-GUIDED-VERS-NEXUS",
  name: "テスト導界者ヴァースネクサス",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  grandwalkerData: {
    kind: "guided",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
} as CardDefinition;

const guidedNoVersNameDef: CardDefinition = {
  ...guidedVersNexusDef,
  cardNo: "TEST-GUIDED-NO-VERS-NAME",
  name: "テスト導界者別名ネクサス",
};

const grandwalkerNexusDef: CardDefinition = {
  ...guidedVersNexusDef,
  cardNo: "TEST-GRANDWALKER-VERS-NEXUS",
  name: "テスト創界神ヴァースネクサス",
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
};

const regularNexusDef: CardDefinition = {
  cardNo: "TEST-REGULAR-NEXUS",
  name: "テスト通常ネクサス",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

function ultimateDef(cardNo: string, cost: number): CardDefinition {
  return {
    cardNo,
    name: `テストアルティメット ${cardNo}`,
    printedCategory: "ultimate",
    colors: ["white"],
    cost,
    reductionSymbols: [],
    levelDefs: [{ level: 3, requiredCores: 1, bp: 5000 }],
    symbolColors: ["ultimate_symbol"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    // 召喚条件を満たさないカードでも effect 駆動 summon は無視して召喚できることを
    // 確認するため、絶対に満たせない条件 (自分の CF アルティメット99体以上) を宣言する。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 99,
      },
    ],
  } as CardDefinition;
}
const ULTIMATE_CHEAP = ultimateDef("TEST-ULTIMATE-CHEAP", 7);

const testDefRegistry = new Map<string, CardDefinition>(
  [
    M02,
    NEXUS1,
    guidedVersNexusDef,
    guidedNoVersNameDef,
    grandwalkerNexusDef,
    regularNexusDef,
    ULTIMATE_CHEAP,
  ].map((d) => [d.cardNo, d])
);
const getDef = (id: string): CardDefinition | undefined =>
  testDefRegistry.get(id) ?? cardNoMap.get(id);

describe("BSAZ02-M02 effects[0]: トラッシュ常駐の自己回収 (火星ネクサスが配置されたとき、自分/相手いずれも対象)", () => {
  const effect = M02.effects![0]!;

  it("effect 定義: applicability.zone:trash + game_event(place, player:either, category:nexus, tribes:火星)、〔ターンに1回：同名〕", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "place",
      triggerFilter: { category: ["nexus"], tribes: ["火星"] },
      sourceWhose: "either",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
  });

  function setup(nexusOwner: string) {
    const trashCard = createCardInstance(M02, {
      instanceId: "m02-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const beforeNexus = createCardInstance(NEXUS1, {
      instanceId: "mars-nexus-1",
      ownerPlayerId: nexusOwner,
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [beforeNexus, trashCard],
    });
    const after: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((c) =>
        c.instanceId === beforeNexus.instanceId
          ? { ...c, zone: "field" as const, zoneRoleName: "nexus" }
          : c
      ),
    };
    const lookup = buildTriggeredEffectLookup([M02, NEXUS1]);
    return {
      before,
      after,
      trashCard,
      afterNexus: after.cardInstances[0]!,
      lookup,
    };
  }

  it("相手の火星ネクサス配置でも誘発候補に含まれる (「自分の」限定が無い＝player:either)", () => {
    const ctx = setup(BOB);
    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: ctx.after,
      source: "action_resolution",
      chainId: "m02-opponent-place-chain",
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.afterNexus.instanceId
    );
    expect(pending).toBeDefined();
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.trashCard.instanceId)
    ).toBeDefined();
  });

  it("実行: move_card でトラッシュのこのカードが手札に戻る", () => {
    const ctx = setup(ALICE);
    const result = executeEffect({
      chainId: "test:bsaz02-m02-princess-assassination:243",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.trashCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const moved = result.cardInstances.find(
      (c) => c.instanceId === ctx.trashCard.instanceId
    )!;
    expect(moved.zone).toBe("hand");
  });
});

describe("BSAZ02-M02 effects[1]: 自分の導界者ネクサスが相手の効果の対象になるとき、コスト不要使用", () => {
  const effect = M02.effects![1]!;

  it("effect 定義: game_event(targeted, player:self, cause:opponent_effect) + triggerFilter(targetsGrandwalker:only, hasMechanic:guided) + use_magic_without_cost", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: "hand" });
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "targeted",
      triggerFilter: {
        category: ["nexus"],
        targetsGrandwalker: "only",
        hasMechanic: ["guided"],
      },
      cause: ["opponent_effect"],
    });
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "use_magic_without_cost",
      magicTiming: "flash",
    });
  });

  it("triggerFilter は導界者ネクサスにのみ一致し、創界神ネクサス・通常ネクサスには一致しない", () => {
    const filter = (
      effect.timing as Extract<typeof effect.timing, { kind: "game_event" }>
    ).triggerFilter!;
    expect(matchesCardFilterByDef(guidedVersNexusDef, filter)).toBe(true);
    expect(matchesCardFilterByDef(guidedNoVersNameDef, filter)).toBe(true);
    expect(matchesCardFilterByDef(grandwalkerNexusDef, filter)).toBe(false);
    expect(matchesCardFilterByDef(regularNexusDef, filter)).toBe(false);
  });

  function makeOpponentMagicTargetingNexusDef(): CardDefinition {
    return {
      cardNo: "TEST-M02-OPPONENT-TARGET-MAGIC",
      name: "テスト相手ネクサス対象マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のネクサス1つのコアすべてをボイドに置く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cores",
              action: {
                kind: "core_move",
                from: {
                  kind: "field_card",
                  player: "opponent",
                  filter: { category: ["nexus"], targetsGrandwalker: true },
                },
                to: { kind: "void", player: "opponent" },
                amount: "all",
              },
            },
          ],
        },
      ],
    } as CardDefinition;
  }

  it("[board] 相手の効果が自分の導界者ネクサスを対象化すると、targeted disclosure で手札のこのカードが誘発候補に上がる (BSES01-C01 precedent)", () => {
    const magicDef = makeOpponentMagicTargetingNexusDef();
    const versNexus = createCardInstance(guidedVersNexusDef, {
      instanceId: "alice-vers-nexus-targeted",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 2,
    });
    const handCard = createCardInstance(M02, {
      instanceId: "m02-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const definitions = [...ALL_CARDS, guidedVersNexusDef, magicDef];
    const getDefWithFixtures = (id: string): CardDefinition | undefined =>
      definitions.find((d) => d.cardNo === id);
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [versNexus, handCard, magic],
    });
    const lookup = buildTriggeredEffectLookup(definitions);

    const disclosure = executeEffect({
      chainId: "test:bsaz02-m02-princess-assassination:358",
      state: baseState,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithFixtures,
      getRegisteredTriggeredEffectActions: lookup,
      targetInstanceIds: [versNexus.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });

    // applicability.zone:"hand" のカードは相手に手札を明かさないため pendingTriggeredEffects
    // ではなく pendingPrivateDeclarations 経由で誘発候補になる (BSTS01-R03 precedent、
    // engine-conditional-free-magic-use-on-event.test.ts)。
    const declaration = disclosure.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === handCard.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("targeted");
    expect(declaration!.ownerPlayerId).toBe(ALICE);
  });

  it("[board] 自分自身の効果が自分の導界者ネクサスを対象化しても誘発候補に上がらない (cause:opponent_effect限定)", () => {
    const selfMagicDef: CardDefinition = {
      ...makeOpponentMagicTargetingNexusDef(),
      cardNo: "TEST-M02-SELF-TARGET-MAGIC",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cores",
              action: {
                kind: "core_move",
                from: {
                  kind: "field_card",
                  player: "self",
                  filter: { category: ["nexus"], targetsGrandwalker: true },
                },
                to: { kind: "void", player: "self" },
                amount: "all",
              },
            },
          ],
        },
      ],
    };
    const versNexus = createCardInstance(guidedVersNexusDef, {
      instanceId: "alice-vers-nexus-self-targeted",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 2,
    });
    const handCard = createCardInstance(M02, {
      instanceId: "m02-hand-2",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(selfMagicDef, {
      instanceId: "alice-self-target-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const definitions = [...ALL_CARDS, guidedVersNexusDef, selfMagicDef];
    const getDefWithFixtures = (id: string): CardDefinition | undefined =>
      definitions.find((d) => d.cardNo === id);
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [versNexus, handCard, magic],
    });
    const lookup = buildTriggeredEffectLookup(definitions);

    const disclosure = executeEffect({
      chainId: "test:bsaz02-m02-princess-assassination:435",
      state: baseState,
      effect: selfMagicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithFixtures,
      getRegisteredTriggeredEffectActions: lookup,
      targetInstanceIds: [versNexus.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });

    expect(
      disclosure.pendingPrivateDeclarations.find(
        (d) => d.sourceInstanceId === handCard.instanceId
      )
    ).toBeUndefined();
  });
});

describe("BSAZ02-M02 effects[2]: フラッシュ〔ターンに1回:同名〕「ヴァース」を含む導界者ネクサス1つを破壊することで、手札のコスト7以下アルティメットを召喚条件無視・コスト不要召喚", () => {
  const effect = M02.effects![2]!;

  it("effect 定義: mode:flash + destroy(自分,「ヴァース」を含む導界者ネクサス) → conditional_cost summon(from_zone:hand, category:ultimate, maxCost:7, costModifier:free)、〔ターンに1回:同名〕", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.steps).toHaveLength(2);
    const destroyAction = effect.steps[0]!.action;
    expect(destroyAction.kind).toBe("destroy");
    if (destroyAction.kind !== "destroy") throw new Error("unreachable");
    expect(destroyAction.target).toEqual({
      kind: "filter",
      player: "self",
      filter: {
        category: ["nexus"],
        cardName: { contains: "ヴァース" },
        targetsGrandwalker: "only",
        hasMechanic: ["guided"],
      },
      count: 1,
    });
    const summonStep = effect.steps[1]!;
    expect(summonStep.connector).toBe("conditional_cost");
    expect(summonStep.action.kind).toBe("summon");
    if (summonStep.action.kind !== "summon") throw new Error("unreachable");
    expect(summonStep.action.target).toEqual({
      kind: "from_zone",
      zone: ["hand"],
      filter: { category: ["ultimate"], maxCost: 7 },
      count: 1,
    });
    expect(summonStep.action.costModifier).toBe("free");
    expect(summonStep.action.ignoreSummonCondition).toBe(true);
  });

  it("destroy 側フィルタは「ヴァース」を含む導界者ネクサスにのみ一致し、名前に「ヴァース」を含まない導界者と創界神には一致しない", () => {
    const destroyAction = effect.steps[0]!.action;
    if (destroyAction.kind !== "destroy") throw new Error("unreachable");
    if (destroyAction.target.kind !== "filter") throw new Error("unreachable");
    const filter = destroyAction.target.filter;
    expect(matchesCardFilterByDef(guidedVersNexusDef, filter)).toBe(true);
    expect(matchesCardFilterByDef(guidedNoVersNameDef, filter)).toBe(false);
    expect(matchesCardFilterByDef(grandwalkerNexusDef, filter)).toBe(false);
  });

  it("[board] 実行: 「ヴァース」を含む導界者ネクサスが破壊(pending-leave)され、召喚条件を満たさないアルティメットでもコスト不要で召喚が成立する", () => {
    const versNexus = createCardInstance(guidedVersNexusDef, {
      instanceId: "alice-vers-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const handUltimate = createCardInstance(ULTIMATE_CHEAP, {
      instanceId: "alice-hand-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [versNexus, handUltimate],
      playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
    });
    let result = executeEffect({
      chainId: "test:bsaz02-m02-princess-assassination:523",
      state,
      effect,
      sourceInstanceId: "m02-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const placementAction = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: placementAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: handUltimate.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;
    const paidNexus = result.cardInstances.find(
      (card) => card.instanceId === versNexus.instanceId
    )!;
    // 維持コア配置の解決で効果 continuation まで完了し、宣言コストの破壊も flush される。
    expect(paidNexus.zone).toBe("trash");
    const summoned = result.cardInstances.find(
      (c) => c.instanceId === handUltimate.instanceId
    )!;
    expect(summoned.zone).toBe("field");
    // 無償召喚: マジック的なコスト支払いは発生せず、消費は Lv3 requiredCores:1 の
    // フィールド進入時自動コア配置(reserve→カード)分のみ (4 → 3、C07 precedent と同型)。
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(3);
  });
});
