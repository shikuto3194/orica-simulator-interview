/**
 * BSAZ02-C09「エデルリッゾ」effects[0..3] 検証。
 *
 * 原文 (textLines[0,2,3,5,6,7]):
 *   手札にあるこのカードは、自分の「ヴァース」が配置されたとき、コストを支払わずに
 *   配置できる。
 *   Lv1-Lv2〔ターンに1回：同名〕自分のスピリット/アルティメット/ネクサスの下に
 *   「アルドノアドライブ」が置かれたとき、ボイドからコア1個ずつをこのネクサスと
 *   自分の「ヴァース」を含む導界者ネクサスに置く。
 *   Lv2 自分の「ヴァース」があるとき、このネクサスは相手の効果を受けない。さらに、
 *   相手のスピリット/アルティメットすべてに"『このスピリット/アルティメットの
 *   アタック時』相手は相手の創界神ネクサス1つを指定できる。このターンの間、
 *   指定された創界神ネクサスは、破壊されない。"を与える。
 *
 * 検証点:
 *  - ENGINE-c09-text-role-under-card-third-party-trigger (新設): text_role アンダーカード
 *    実配置の diff 検出 (collectTriggerEventsFromStateDelta) + CardFilter.hasUnderCardRoleTag。
 *    汎用単体テストは engine-text-role-under-card-third-party-trigger.test.ts に分離。
 *  - effects[0]: 手札にあるこのカードが「ヴァース」配置の game_event で自己召喚 (free)。
 *  - effects[1]: text_role_under_card_placed 誘発で void→this_card 1個 + void→自分の
 *    「ヴァース」を含む導界者ネクサス群 one_each（同名の創界神は対象外）。
 *  - effects[2]: 自分のヴァース存在時のみ effect_resistance CE が登録される。
 *  - effects[3]: 自分のヴァース存在時のみ、相手スピリット/アルティメットへ grant_effect
 *    (アタック時 grandwalker ネクサス1つ選択→破壊耐性 turn) が登録される。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string) => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const C09 = card("BSAZ02-C09");
const triggeredLookup = buildTriggeredEffectLookup([...ALL_CARDS]);

/** テスト専用「ヴァース」相当導界者ネクサス定義 (card-data 未収録の名前参照)。 */
const VAAS_DEF: CardDefinition = {
  cardNo: "TEST-VAAS",
  name: "ヴァース",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "火星",
  sourceUrls: [],
  sourceConfidence: "C",
  grandwalkerData: {
    kind: "guided",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
};
cardNoMap.set(VAAS_DEF.cardNo, VAAS_DEF);

/** 同名でも創界神である限り、C09 の「導界者」コア配置先にはならない否定フィクスチャ。 */
const VAAS_GRANDWALKER_DEF: CardDefinition = {
  ...VAAS_DEF,
  cardNo: "TEST-C09-VAAS-GRANDWALKER",
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
};
cardNoMap.set(VAAS_GRANDWALKER_DEF.cardNo, VAAS_GRANDWALKER_DEF);

/** 「ヴァース」ではない別名の grandwalker ネクサス (cardName 絞り込み検証用の否定フィクスチャ)。 */
const OTHER_GRANDWALKER_DEF: CardDefinition = {
  cardNo: "TEST-C09-OTHER-GRANDWALKER",
  name: "別の創界神",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "火星",
  sourceUrls: [],
  sourceConfidence: "C",
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
};
cardNoMap.set(OTHER_GRANDWALKER_DEF.cardNo, OTHER_GRANDWALKER_DEF);

/** 通常のスピリット/アルティメット (grandwalker ではない) フィラー。 */
const PLAIN_UNIT_DEF: CardDefinition = {
  cardNo: "TEST-C09-UNIT",
  name: "フィラーユニット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(PLAIN_UNIT_DEF.cardNo, PLAIN_UNIT_DEF);

function runEffect(
  state: GameState,
  effectIndex: number,
  opts: { sourceInstanceId?: string; triggerRelatedInstanceId?: string } = {}
): GameState {
  return executeEffect({
    chainId: "test:bsaz02-c09-edelweiss:122",
    state,
    effect: C09.effects![effectIndex]!,
    effectIndex,
    sourceInstanceId: opts.sourceInstanceId ?? "src-c09",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    triggerRelatedInstanceId: opts.triggerRelatedInstanceId,
  });
}

function legalActionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredFieldCardEffectActions: () => [],
  });
}

function closeStackWindow(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const pass = legalActionsFor(current, responderId).find(
      (action) => action.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    }).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

function resolveC09DriveTrigger(
  state: GameState,
  sourceInstanceId: string,
  ownerPlayerId: string
): GameState {
  let current = state;
  const select = legalActionsFor(current, current.activePlayerId).find(
    (action) =>
      action.kind === "select_pending_to_resolve" &&
      action.sourceInstanceId === sourceInstanceId
  );
  if (select) {
    current = applyLegalAction({
      state: current,
      action: select,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    }).state;
  }
  const resolve = legalActionsFor(current, ownerPlayerId).find(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      action.sourceInstanceId === sourceInstanceId
  );
  expect(resolve).toBeDefined();
  current = applyLegalAction({
    state: current,
    action: resolve!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions: undefined,
  }).state;
  return closeStackWindow(current);
}

describe("BSAZ02-C09 effects[0]（手札からの「ヴァース」配置時無償配置）", () => {
  it("triggerRelatedInstanceId をこのカード自身にして free summon を発揮すると手札から場へ出る", () => {
    const src = createCardInstance(C09, {
      instanceId: "src-c09",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
      }),
      players: [
        { ...createEmptyGameState({ playerIds: [ALICE, BOB] }).players[0]! },
      ].concat(
        createEmptyGameState({ playerIds: [ALICE, BOB] }).players.slice(1)
      ),
    };
    const withHand: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      ),
    };
    const after = runEffect(withHand, 0, {
      triggerRelatedInstanceId: "src-c09",
    });
    const placed = after.cardInstances.find((c) => c.instanceId === "src-c09")!;
    expect(placed.zone).toBe("field");
  });
});

describe("BSAZ02-C09 effects[1]（Lv1-2: アルドノアドライブ実配置でコア1個ずつ配置）", () => {
  it("一次画像で照合した本文を導界者ネクサス専用のfilterとして保持する", () => {
    expect(C09.sourceConfidence).toBe("B");
    expect(C09.sourceUrls).toContain("images/BSAZ02-C09.png");
    expect(C09.textLines[3]).toContain("導界者ネクサス");
    expect(C09.textLines[3]).not.toContain("創界神ネクサス");
    expect(C09.effects[1]?.steps[1]?.action).toMatchObject({
      kind: "core_distribute",
      to: {
        kind: "filter",
        filter: {
          category: ["nexus"],
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
          cardName: [{ contains: "ヴァース" }],
        },
      },
      mode: "one_each",
    });
  });

  it("このネクサス自身 + 自分の「ヴァース」を含む導界者ネクサスへ、ボイドから1個ずつ置く", () => {
    const src = createCardInstance(C09, {
      instanceId: "src-c09",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const vaas = createCardInstance(VAAS_DEF, {
      instanceId: "vaas-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const otherPlayerVaas = createCardInstance(VAAS_DEF, {
      instanceId: "vaas-bob",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 0,
    });
    const plain = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "plain-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const otherGrandwalker = createCardInstance(OTHER_GRANDWALKER_DEF, {
      instanceId: "other-grandwalker-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const vaasGrandwalker = createCardInstance(VAAS_GRANDWALKER_DEF, {
      instanceId: "vaas-grandwalker-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        src,
        vaas,
        otherPlayerVaas,
        plain,
        otherGrandwalker,
        vaasGrandwalker,
      ],
      playerOverrides: [{ voidNormalCoreCount: 10 }, {}],
    });

    // ホスト = plain-1 (自分のスピリット) の下に「アルドノアドライブ」が実配置された想定。
    const after = runEffect(state, 1, {
      triggerRelatedInstanceId: "plain-1",
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === "src-c09")!
        .normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find((c) => c.instanceId === "vaas-1")!
        .normalCoreCount
    ).toBe(1);
    // 相手の導界者ネクサスには置かれない (player:"self" フィルタ)。
    expect(
      after.cardInstances.find((c) => c.instanceId === "vaas-bob")!
        .normalCoreCount
    ).toBe(0);
    // 導界者でない通常カードには置かれない。
    expect(
      after.cardInstances.find((c) => c.instanceId === "plain-1")!
        .normalCoreCount
    ).toBe(0);
    // 自分の導界者ネクサスでも「ヴァース」という名を含まなければ置かれない。
    expect(
      after.cardInstances.find((c) => c.instanceId === "other-grandwalker-1")!
        .normalCoreCount
    ).toBe(0);
    // 同名でも創界神ネクサスには置かれない (原文は「導界者ネクサス」)。
    expect(
      after.cardInstances.find((c) => c.instanceId === "vaas-grandwalker-1")!
        .normalCoreCount
    ).toBe(0);
  });

  it("実際のアンダーカード配置誘発では、同じ自分の2枚目は同ターンに解決できず、相手の同名カードは独立して解決する", () => {
    expect(
      triggeredLookup(C09.cardNo)?.find(
        (registration) => registration.effectIndex === 1
      )?.usageLimit
    ).toMatchObject({ kind: "per_card_name", duration: "turn", maxCount: 1 });
    const first = createCardInstance(C09, {
      instanceId: "c09-first",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const sameName = createCardInstance(C09, {
      instanceId: "c09-same-name",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const opponentSameName = createCardInstance(C09, {
      instanceId: "c09-opponent",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 0,
    });
    const aliceVaas = createCardInstance(VAAS_DEF, {
      instanceId: "alice-vaas",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const aliceOtherGrandwalker = createCardInstance(OTHER_GRANDWALKER_DEF, {
      instanceId: "alice-other-grandwalker",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const aliceVaasGrandwalker = createCardInstance(VAAS_GRANDWALKER_DEF, {
      instanceId: "alice-vaas-grandwalker",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const aliceHost = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "alice-host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const aliceDrive = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "alice-drive",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const aliceDriveAgain = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "alice-drive-again",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const bobVaas = createCardInstance(VAAS_DEF, {
      instanceId: "bob-vaas",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 0,
    });
    const bobHost = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "bob-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 0,
    });
    const bobDrive = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "bob-drive",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const beforeAlice = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        first,
        sameName,
        opponentSameName,
        aliceVaas,
        aliceOtherGrandwalker,
        aliceVaasGrandwalker,
        aliceHost,
        aliceDrive,
        aliceDriveAgain,
        bobVaas,
        bobHost,
        bobDrive,
      ],
      playerOverrides: [
        { voidNormalCoreCount: 10 },
        { voidNormalCoreCount: 10 },
      ],
    });
    const afterAlicePlacement: GameState = {
      ...beforeAlice,
      cardInstances: beforeAlice.cardInstances.map((cardInstance) => {
        if (cardInstance.instanceId === aliceHost.instanceId)
          return {
            ...cardInstance,
            underCards: [
              {
                cardInstanceId: aliceDrive.instanceId,
                role: "text_role" as const,
                roleTag: "アルドノアドライブ",
              },
            ],
          };
        if (cardInstance.instanceId === aliceDrive.instanceId)
          return {
            ...cardInstance,
            zone: "field" as const,
            attachedToInstanceId: aliceHost.instanceId,
          };
        return cardInstance;
      }),
    };
    const queuedAlice = collectAndQueueTriggerReactions({
      chainId: "test:bsaz02-c09-edelweiss:461",
      beforeState: beforeAlice,
      afterState: afterAlicePlacement,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      queuedAlice.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "text_role_under_card_placed"
      )
    ).toHaveLength(1);
    const afterFirst = resolveC09DriveTrigger(
      queuedAlice,
      first.instanceId,
      ALICE
    );
    expect(
      afterFirst.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === first.instanceId
      )!.normalCoreCount
    ).toBe(1);
    expect(
      afterFirst.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === sameName.instanceId
      )!.normalCoreCount
    ).toBe(0);
    expect(
      afterFirst.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === aliceVaas.instanceId
      )!.normalCoreCount
    ).toBe(1);
    expect(
      afterFirst.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === aliceOtherGrandwalker.instanceId
      )!.normalCoreCount
    ).toBe(0);
    // 実誘発の解決でも、同名の創界神は「導界者ネクサス」指定に含まれない。
    expect(
      afterFirst.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === aliceVaasGrandwalker.instanceId
      )!.normalCoreCount
    ).toBe(0);
    expect(afterFirst.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: first.instanceId,
          sourceDefinitionId: C09.cardNo,
          effectLabel: "effect:1",
          duration: "turn",
        }),
      ])
    );
    const afterAliceSecondPlacement: GameState = {
      ...afterFirst,
      cardInstances: afterFirst.cardInstances.map((cardInstance) => {
        if (cardInstance.instanceId === aliceHost.instanceId)
          return {
            ...cardInstance,
            underCards: [
              ...cardInstance.underCards,
              {
                cardInstanceId: aliceDriveAgain.instanceId,
                role: "text_role" as const,
                roleTag: "アルドノアドライブ",
              },
            ],
          };
        if (cardInstance.instanceId === aliceDriveAgain.instanceId)
          return {
            ...cardInstance,
            zone: "field" as const,
            attachedToInstanceId: aliceHost.instanceId,
          };
        return cardInstance;
      }),
    };
    const queuedAliceSecond = collectAndQueueTriggerReactions({
      chainId: "test:bsaz02-c09-edelweiss:542",
      beforeState: afterFirst,
      afterState: afterAliceSecondPlacement,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    // 発揮不能の pending を除去する skipOnly は許容し、再発揮は許可しない。
    expect(
      legalActionsFor(queuedAliceSecond, ALICE).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          !action.skipOnly &&
          action.sourceInstanceId === sameName.instanceId
      )
    ).toBe(false);

    const beforeBob: GameState = {
      ...queuedAliceSecond,
      activePlayerId: BOB,
    };
    const afterBobPlacement: GameState = {
      ...beforeBob,
      cardInstances: beforeBob.cardInstances.map((cardInstance) => {
        if (cardInstance.instanceId === bobHost.instanceId)
          return {
            ...cardInstance,
            underCards: [
              {
                cardInstanceId: bobDrive.instanceId,
                role: "text_role" as const,
                roleTag: "アルドノアドライブ",
              },
            ],
          };
        if (cardInstance.instanceId === bobDrive.instanceId)
          return {
            ...cardInstance,
            zone: "field" as const,
            attachedToInstanceId: bobHost.instanceId,
          };
        return cardInstance;
      }),
    };
    const queuedBob = collectAndQueueTriggerReactions({
      chainId: "test:bsaz02-c09-edelweiss:587",
      beforeState: beforeBob,
      afterState: afterBobPlacement,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    const afterOpponent = resolveC09DriveTrigger(
      queuedBob,
      opponentSameName.instanceId,
      BOB
    );

    expect(
      afterOpponent.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === opponentSameName.instanceId
      )!.normalCoreCount
    ).toBe(1);
    expect(
      afterOpponent.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === bobVaas.instanceId
      )!.normalCoreCount
    ).toBe(1);
  });
});

describe("BSAZ02-C09 effects[2]（Lv2: 自分のヴァース存在時のみ相手の効果を受けない）", () => {
  it("ヴァースがあるとき、effect_resistance(targeted/included, opponent_effect) CE が登録される", () => {
    const src = createCardInstance(C09, {
      instanceId: "src-c09",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 2, // Lv2
    });
    const vaas = createCardInstance(VAAS_DEF, {
      instanceId: "vaas-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, vaas],
      }),
      getDef
    );
    const resistance = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "src-c09" && ce.modifierTag === "defense_immune"
    );
    expect(resistance).toHaveLength(1);
  });

  it("ヴァースが無いとき、effect_resistance CE は登録されない", () => {
    const src = createCardInstance(C09, {
      instanceId: "src-c09",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 2, // Lv2
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
      }),
      getDef
    );
    const resistance = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "src-c09" && ce.modifierTag === "defense_immune"
    );
    expect(resistance).toHaveLength(0);
  });
});

describe("BSAZ02-C09 effects[3]（Lv2: 自分のヴァース存在時のみ相手全体へ攻撃時ネクサス保護を付与）", () => {
  it("ヴァースがあるとき、相手のスピリット/アルティメットそれぞれに granted_effect CE が登録される", () => {
    const src = createCardInstance(C09, {
      instanceId: "src-c09",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 2, // Lv2
    });
    const vaas = createCardInstance(VAAS_DEF, {
      instanceId: "vaas-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const bobUnit = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, vaas, bobUnit],
      }),
      getDef
    );
    const granted = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "src-c09" &&
        ce.modifierTag === "granted_effect" &&
        ce.targetInstanceId === "bob-unit"
    );
    expect(granted).toHaveLength(1);
  });

  it("ヴァースが無いとき、granted_effect CE は登録されない", () => {
    const src = createCardInstance(C09, {
      instanceId: "src-c09",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 2, // Lv2
    });
    const bobUnit = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, bobUnit],
      }),
      getDef
    );
    const granted = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "src-c09" && ce.modifierTag === "granted_effect"
    );
    expect(granted).toHaveLength(0);
  });

  it("原文の二重『相手』を正しく解決する: 誘発の actingPlayerId はC09のコントローラ(自分)で、解決すると自分の創界神ネクサスが破壊耐性を得る (verifier round1 指摘の修正確認)", () => {
    const src = createCardInstance(C09, {
      instanceId: "src-c09",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 2, // Lv2
    });
    const vaas = createCardInstance(VAAS_DEF, {
      instanceId: "vaas-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const bobUnit = createCardInstance(PLAIN_UNIT_DEF, {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, vaas, bobUnit],
      }),
      getDef
    );

    const withPending = queueGrantedEffectTriggersFromTriggerEvents(
      rebuilt,
      [
        {
          chainId: "test:bsaz02-c09-edelweiss:761",
          eventKind: "attack",
          relatedInstanceId: "bob-unit",
          relatedPlayerId: BOB,
        },
      ],
      getDef
    );
    const pendings = withPending.pendingTriggeredEffects.filter(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    expect(pendings).toHaveLength(1);
    // 誘発の解決権は被付与カード(bob-unit)の相手 = C09のコントローラ(ALICE)。
    expect(pendings[0]!.actingPlayerId).toBe(ALICE);

    const resolveAction = getLegalActions({
      state: withPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pendings[0]!.pendingId
    );
    expect(resolveAction).toBeDefined();
    let current = applyLegalAction({
      state: withPending,
      action: resolveAction!,
      getCardDefinitionById: getDef,
    }).state;
    let guard = 0;
    while (current.stackWindow && guard++ < 10) {
      const responderId = current.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: current,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getDef,
      }).state;
    }

    // 対象 grandwalker ネクサス候補は vaas-1 のみ (=ALICE の場) なので確定的に解決される。
    const vaasAfter = current.cardInstances.find(
      (c) => c.instanceId === "vaas-1"
    )!;
    const resistanceCEs = current.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "vaas-1" &&
        ce.modifierTag === "cannot_be_destroyed"
    );
    expect(resistanceCEs.length).toBeGreaterThan(0);
    expect(vaasAfter.instanceId).toBe("vaas-1");
    // BOBのカードには破壊耐性が付かない(自分=ALICE視点のネクサスのみ保護)。
    const bobUnitResistance = current.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "bob-unit" &&
        ce.modifierTag === "cannot_be_destroyed"
    );
    expect(bobUnitResistance).toHaveLength(0);
  });
});
