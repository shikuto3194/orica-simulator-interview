import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSAZ02-C16「我は地球人というだけで憎いがな」effects[0,1,2] 検証。
 *
 * 原文 (textLines[0]):
 *   〔ターンに1回：同名〕トラッシュにあるこのカードは、自分のエンドステップに、手札の
 *   系統：「火星」を持つカードと入れ替えられる。
 * 原文 (textLines[2]):
 *   手札にあるこのカードは、自分の導界者ネクサスが相手の効果の対象になるとき、コストを
 *   支払わずに使用できる。
 * 原文 (textLines[4,5]):
 *   フラッシュ
 *   〔ターンに1回：同名〕自分の「ヴァース」を含む創界神ネクサス1つを破壊することで、
 *   自分のデッキを上から5枚オープンする。その中の、「アルドノアドライブ」1枚を手札に
 *   加え、アルティメットカード1枚を召喚条件を無視してコストを支払わずに召喚する。
 *   残ったカードはデッキの下に戻す。
 *
 * 検証点:
 *  - effects[0]: engine-atomic-hand-trash-swap-legal-action (BSTH02.7-TR03(A) precedent) を
 *    トラッシュ常駐 (applicability.zone:"trash") + 自分のエンドステップ限定
 *    (timing.kind:"phase"/step:"end"/whose:"self") へ適用。incomingFrom:"source_card" で発揮元個体だけに絞る。
 *  - effects[1]: BSAZ02-M02 effects[1] と同一テキストのため同型 DSL
 *    (targetsGrandwalker:"only"+hasMechanic:["guided"]+cause:opponent_effect+
 *    use_magic_without_cost)。
 *  - effects[2]: 「Xを破壊することで、Yする」= conditional_cost (BSAZ02-M02 effects[2]
 *    precedent)。destroy 側フィルタは「ヴァース」を含む創界神ネクサス限定
 *    (targetsGrandwalker:"only"、BSAZ02-C09 effects[2,3] 同型。現行カードプールの「ヴァース」は
 *    grandwalkerData.kind:"guided" のみのため hasMechanic 追加narrowingなし)。deck_reveal
 *    picks は destination:"hand"(「アルドノアドライブ」1枚) + destination:"field"
 *    (アルティメット1枚、コスト不要・召喚条件無視は deck_reveal 経由の field entry が
 *    元々どちらも検査しないため追加実装不要)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { matchesCardFilterByDef } from "../src/card/card-filter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const C16 = card("BSAZ02-C16");
// 実カード「アルドノアドライブ」(BSAZ02-C10)。effects[2] pick1 の cardName:exact フィクスチャ。
const ALDNOAH_DRIVE = card("BSAZ02-C10");
// 実カード「[導界者]アセイラム・ヴァース・アリューシア」(BSAZ02-X04)。
// grandwalkerData.kind:"guided" + 名前に「ヴァース」を含む、effects[1,2] の共通フィクスチャ。
const VERS_NEXUS = card("BSAZ02-X04");
// 導界者ネクサスだが「ヴァース」を含まない。effects[2] の破壊コスト対象外を確認する。
const NON_VERS_GUIDED_NEXUS = card("BSES01-CX01");

const marsHandCard: CardDefinition = {
  cardNo: "TEST-C16-MARS-HAND",
  name: "火星テスト手札",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  tribe: "火星",
  sourceUrls: [],
  sourceConfidence: "C",
};

const nonMarsHandCard: CardDefinition = {
  ...marsHandCard,
  cardNo: "TEST-C16-NONMARS-HAND",
  tribe: "地球",
};

function ultimateDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テストアルティメット ${cardNo}`,
    printedCategory: "ultimate",
    colors: ["white"],
    // 初期リザーブ4個では通常の召喚コストを絶対に払えない値にする。
    // deck_reveal の destination:"field" が無償の effect field-entry であることを、
    // 最終盤面（field 着地 + 維持コア1個だけ消費）で検証する。
    cost: 9,
    reductionSymbols: [],
    levelDefs: [{ level: 3, requiredCores: 1, bp: 5000 }],
    symbolColors: ["ultimate_symbol"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    // 効果駆動 summon (deck_reveal destination:"field") は召喚条件を検査しないことを
    // 確認するため、絶対に満たせない条件を宣言する。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 99,
      },
    ],
  };
}
const DECK_ULTIMATE = ultimateDef("TEST-C16-DECK-ULTIMATE");

const FILLER: CardDefinition = {
  cardNo: "TEST-C16-FILLER",
  name: "フィラーテスト",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const testDefs = [marsHandCard, nonMarsHandCard, DECK_ULTIMATE, FILLER];
const getDef = (id: string): CardDefinition | undefined =>
  testDefs.find((d) => d.cardNo === id) ?? cardNoMap.get(id);

describe("BSAZ02-C16 effects[0]: トラッシュ常駐エンドステップ手札火星カード入れ替え", () => {
  const effect = C16.effects![0]!;

  it("effect定義: applicability.zone:trash + phase(end,self) + optional + condition(手札火星1枚以上) + queue_hand_trash_swap(incomingFrom:source_card)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "self",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.condition).toEqual([
      {
        kind: "cards_in_zone",
        player: "self",
        zone: ["hand"],
        filter: { tribes: ["火星"] },
        min: 1,
      },
    ]);
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "queue_hand_trash_swap",
      outgoingFilter: { tribes: ["火星"] },
      outgoingZones: ["hand"],
      incomingFilter: {},
      incomingFrom: "source_card",
    });
  });

  it("[board] 実行: 手札の火星カードとトラッシュの自分自身 (cardName:self) が交換候補として提示される", () => {
    const trashCard = createCardInstance(C16, {
      instanceId: "c16-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const handCard = createCardInstance(marsHandCard, {
      instanceId: "mars-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [trashCard, handCard],
    });
    const queued = executeEffect({
      chainId: "test:bsaz02-c16-earthling-hatred:188",
      state,
      effect,
      sourceInstanceId: trashCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(queued.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      queued.pendingHandTrashSwapChoice!.outgoingCandidateInstanceIds
    ).toEqual(["mars-hand-1"]);
    expect(
      queued.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["c16-trash-1"]);

    const pendingId = queued.pendingHandTrashSwapChoice!.pendingId;
    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_hand_trash",
        actionId: "test:c16-swap",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        pendingId,
        sourceInstanceId: trashCard.instanceId,
        sourceCardNo: C16.cardNo,
        outgoingCardInstanceId: "mars-hand-1",
        outgoingCardNo: marsHandCard.cardNo,
        incomingCardInstanceId: "c16-trash-1",
        incomingCardNo: C16.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    const after = result.state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "c16-trash-1")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "mars-hand-1")!.zone
    ).toBe("trash");
  });

  it("手札に火星カードが無ければ発火しない (condition gate)", () => {
    const trashCard = createCardInstance(C16, {
      instanceId: "c16-trash-2",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const handCard = createCardInstance(nonMarsHandCard, {
      instanceId: "nonmars-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [trashCard, handCard],
    });
    const queued = executeEffect({
      chainId: "test:bsaz02-c16-earthling-hatred:248",
      state,
      effect,
      sourceInstanceId: trashCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(queued.pendingHandTrashSwapChoice).toBeNull();
  });
});

describe("BSAZ02-C16 effects[1]: 自分の導界者ネクサスが相手の効果の対象になるとき、コスト不要使用", () => {
  const effect = C16.effects![1]!;

  it("effect定義: BSAZ02-M02 effects[1] と同型 (game_event targeted, cause:opponent_effect, use_magic_without_cost)", () => {
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

  it("triggerFilter は導界者ネクサス「[導界者]アセイラム・ヴァース・アリューシア」に一致する", () => {
    const filter = (
      effect.timing as Extract<typeof effect.timing, { kind: "game_event" }>
    ).triggerFilter!;
    expect(matchesCardFilterByDef(VERS_NEXUS, filter)).toBe(true);
  });
});

describe("BSAZ02-C16 effects[2]: フラッシュ〔ターンに1回：同名〕「ヴァース」創界神ネクサス破壊→デッキ5枚オープン→アルドノアドライブ手札+アルティメット召喚条件無視コスト不要召喚", () => {
  const effect = C16.effects![2]!;

  it("effect定義: mode:flash + destroy(自分,「ヴァース」を含む創界神ネクサス) → conditional_cost deck_reveal(revealCount:5, picks:[hand「アルドノアドライブ」,field ultimate], remainder:bottom)", () => {
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
        targetsGrandwalker: "only",
        cardName: [{ contains: "ヴァース" }],
      },
      count: 1,
    });
    const revealStep = effect.steps[1]!;
    expect(revealStep.connector).toBe("conditional_cost");
    expect(revealStep.action.kind).toBe("deck_reveal");
    if (revealStep.action.kind !== "deck_reveal")
      throw new Error("unreachable");
    expect(revealStep.action.revealCount).toBe(5);
    expect(revealStep.action.remainder).toBe("bottom");
    expect(revealStep.action.picks).toEqual([
      {
        count: 1,
        filter: { cardName: { contains: "アルドノアドライブ" } },
        destination: "hand",
        mandatory: true,
      },
      {
        count: 1,
        filter: { category: ["ultimate"] },
        destination: "field",
        mandatory: true,
      },
    ]);
  });

  it("destroy側フィルタは「ヴァース」を含む導界者(創界神カテゴリ)ネクサスにだけ一致し、非ヴァース導界者/通常ネクサスを除外する", () => {
    const destroyAction = effect.steps[0]!.action;
    if (destroyAction.kind !== "destroy") throw new Error("unreachable");
    if (destroyAction.target.kind !== "filter") throw new Error("unreachable");
    const filter = destroyAction.target.filter;
    expect(matchesCardFilterByDef(VERS_NEXUS, filter)).toBe(true);
    expect(matchesCardFilterByDef(NON_VERS_GUIDED_NEXUS, filter)).toBe(false);
    expect(matchesCardFilterByDef(FILLER, filter)).toBe(false);
  });

  it.each(["アルドノアドライブ", "改良アルドノアドライブ"])(
    "[board] %s: 実行: 「ヴァース」ネクサス破壊(pending-leave)→デッキ5枚オープン→「アルドノアドライブ」手札加算＋アルティメット召喚条件無視コスト不要召喚、残りはデッキ下へ",
    (driveName) => {
      const lookup = (id: string) =>
        id === ALDNOAH_DRIVE.cardNo
          ? { ...ALDNOAH_DRIVE, name: driveName }
          : getDef(id);
      const versNexus = createCardInstance(VERS_NEXUS, {
        instanceId: "alice-vers-nexus",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "nexus",
      });
      const deckAldnoah = createCardInstance(ALDNOAH_DRIVE, {
        instanceId: "deck-aldnoah-drive",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const deckUltimate = createCardInstance(DECK_ULTIMATE, {
        instanceId: "deck-ultimate",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const fillers = [0, 1, 2].map((i) =>
        createCardInstance(FILLER, {
          instanceId: `deck-filler-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          versNexus,
          deckAldnoah,
          fillers[0]!,
          deckUltimate,
          fillers[1]!,
          fillers[2]!,
        ],
        playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
      });
      const afterReveal = executeEffect({
        chainId: "test:bsaz02-c16-earthling-hatred:386",
        state,
        effect,
        sourceInstanceId: "c16-source",
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      expect(
        afterReveal.pendingLeaveEntities.map((p) => p.instanceId)
      ).toContain(versNexus.instanceId);
      expect(afterReveal.pendingDeckReveal).not.toBeNull();

      // deck_reveal は pick グループ (hand「アルドノアドライブ」→ field ultimate) を
      // 1つずつ resolve_pending_deck_reveal_pick で解決し、両方完了後の残り3枚
      // (remainder:"bottom") は resolve_pending_deck_reveal_order で確定する。
      let after = afterReveal;
      for (let i = 0; i < 5 && after.pendingDeckReveal; i++) {
        const actions = getLegalActions({
          state: after,
          actingPlayerId: ALICE,
          getCardDefinitionById: lookup,
        });
        const pickAction = actions.find(
          (a) => a.kind === "resolve_pending_deck_reveal_pick"
        );
        const orderAction = actions.find(
          (a) => a.kind === "resolve_pending_deck_reveal_order"
        );
        if (
          pickAction &&
          pickAction.kind === "resolve_pending_deck_reveal_pick"
        ) {
          after = applyLegalAction({
            state: after,
            action: pickAction,
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions: noTriggerLookup,
            selectedDeckRevealCardIds:
              pickAction.candidateCardInstanceIds.slice(
                0,
                pickAction.maxPickCount
              ),
          }).state;
        } else if (
          orderAction &&
          orderAction.kind === "resolve_pending_deck_reveal_order"
        ) {
          after = applyLegalAction({
            state: after,
            action: orderAction,
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions: noTriggerLookup,
            deckRevealRemainderOrder: orderAction.remainingCardInstanceIds,
          }).state;
        } else {
          break;
        }
        after = finishCoreChoices(after, lookup);
      }
      expect(after.pendingDeckReveal).toBeNull();
      const aldnoah = after.cardInstances.find(
        (c) => c.instanceId === deckAldnoah.instanceId
      )!;
      expect(aldnoah.zone).toBe("hand");
      const ultimate = after.cardInstances.find(
        (c) => c.instanceId === deckUltimate.instanceId
      )!;
      // 召喚条件を満たさないアルティメットでも effect 駆動 summon (deck_reveal
      // destination:"field") は召喚条件を検査しないため場に出る。
      expect(ultimate.zone).toBe("field");
      for (const f of fillers) {
        const found = after.cardInstances.find(
          (c) => c.instanceId === f.instanceId
        )!;
        expect(found.zone).toBe("deck");
      }
      // 無償召喚: マジック的なコスト支払いは発生しないが、Lv3 requiredCores:1 の維持コアは
      // テストプレイヤーが維持コア選択を送ることで
      // リザーブから場のカードへ配置される (4 → 3)。コア不足のまま場に残らないことを確認する
      // ことで、次の状態ベースアクションでの即時コア不足消滅を防ぐ。
      expect(ultimate.normalCoreCount).toBe(1);
      const alice = after.players.find((p) => p.id === ALICE)!;
      expect(alice.reserveNormalCoreCount).toBe(3);
    }
  );

  it("「ヴァース」創界神ネクサスが無ければ (conditional_cost 不成立) デッキオープンは発生しない", () => {
    const deckAldnoah = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "deck-aldnoah-drive-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [deckAldnoah],
    });
    const after = executeEffect({
      chainId: "test:bsaz02-c16-earthling-hatred:481",
      state,
      effect,
      sourceInstanceId: "c16-source-2",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingDeckReveal).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === deckAldnoah.instanceId)!
        .zone
    ).toBe("deck");
  });
});
