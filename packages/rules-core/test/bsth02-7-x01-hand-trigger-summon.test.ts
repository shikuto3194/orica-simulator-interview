import { finishCoreChoices } from "./helpers/core-choice-driver";
import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
import { collectAfterPhysicalLeave } from "./physical-leave-test-helper";
/**
 * BSTH02.7-X01「ゴリアテ人形」effects[0]/[1]:
 * 〔重複不可〕手札/手元にあるこのカードは、自分の「アリス邸」か系統：「動玩」/「導魔」を
 * 持つスピリットが、転醒したか、相手によってフィールドを離れたとき、相手のスピリット/
 * アルティメット1体をデッキの下に戻すことができ、1コスト支払って召喚できる。
 *
 * 前回 iteration (2026-07-06) は「design-flaw: 手札観測の他カードイベント時間窓型トリガーが
 * engine に0件」として needs-dsl.audit.jsonl に park していたが、再調査の結果これは誤りで、
 * 既存の game_event timing + applicability.zone:hand の triggered-effect パイプライン
 * (precedent: BSDB01-M02 ピッコロ, BSTH02.7-TX01(A)) でそのまま表現可能と判明した。
 * rebirth (cause概念を持たない) と leave_field(cause:opponent_effect) は異なる
 * event family のため2つの effect に分割している (単一 timing.event 配列+共通 cause では
 * rebirth 側が fail-closed で死ぬ)。
 *
 * 実装過程で別の真の engine gap を発見: `OPT_IN_TRIGGER_EVENT_KINDS`(trigger-system.ts)に
 * "rebirth" が誤って含まれており、「B 面自身の card_event:rebirth」以外の第三者 game_event
 * リスナー(本カードの手札トリガー等)が opt-in フィルタで先回りに弾かれていた。
 * recover/battle_end/flash と同じ理由で opt-in から除外した
 * (ENGINE-rebirth-third-party-game-event-opt-in-gap)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildTriggeredEffectLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { autoResumePendingOptionalSteps } from "../src/effect/optional-step-auto-resume";
import {
  flushPendingLeaves,
  queuePendingLeave,
} from "../src/state-based-actions";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X01 = cardNoMap.get("BSTH02.7-X01")!;

const ALICE = "alice";
const BOB = "bob";

function makeOpponentSpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH02-7-X01-OPP-SPIRIT",
    name: "テスト相手スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeDoutakuSpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH02-7-X01-DOUTAKU-SPIRIT",
    name: "テスト動玩スピリット(単一面)",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["yellow"],
    tribe: "動玩",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const FRONT_NO = "TEST-X01-DOUTAKU-FRONT(A)";
const BACK_NO = "TEST-X01-DOUTAKU-FRONT(B)";

/** 自分の系統:「動玩」を持つダブルフェイススピリット (transmute で B 面へ転醒する)。 */
function makeDoutakuDoubleSided(): CardDefinition {
  return {
    cardNo: FRONT_NO,
    name: "テスト動玩スピリット",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: ["double_sided"],
    tribe: "動玩",
    sourceUrls: [],
    sourceConfidence: "C",
    isDoubleSided: true,
    backFace: {
      name: "テスト動玩スピリット(B)",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "動玩",
      cardNo: BACK_NO,
    },
  } as CardDefinition;
}

describe("BSTH02.7-X01 effects[0]/[1]: 手札/手元トリガー(アリス邸/動玩・導魔スピリットの転醒or相手離脱)", () => {
  const rebirthEffect = X01.effects!.find(
    (e) => e.timing.kind === "game_event" && e.timing.event === "rebirth"
  )!;
  const leaveEffect = X01.effects!.find(
    (e) => e.timing.kind === "game_event" && e.timing.event === "leave_field"
  )!;

  it("rebirth effect 定義: applicability.zone:[hand,set_aside] + triggerFilter filterOr(アリス邸 or 動玩/導魔スピリット) + no_duplicate + cause無し", () => {
    expect(rebirthEffect.applicability).toEqual({
      zone: ["hand", "set_aside"],
    });
    expect(rebirthEffect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "rebirth",
      triggerFilter: {
        filterOr: [
          { cardName: [{ contains: "アリス邸" }] },
          {
            category: ["spirit"],
            tribes: ["導魔", "動玩"],
            tribesLogic: "or",
          },
        ],
      },
    });
    expect(rebirthEffect.executionMode).toBe("optional");
    expect(rebirthEffect.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(rebirthEffect.steps).toHaveLength(2);
    expect(rebirthEffect.steps[0]!.executionMode).toBe("optional");
    expect(rebirthEffect.steps[1]!.executionMode).toBe("optional");
    expect(rebirthEffect.steps[1]!.connector).toBe("simultaneous");
  });

  it("leave_field effect 定義: 同一 triggerFilter + cause:[opponent_effect,battle](「相手によって」=広義)", () => {
    expect(leaveEffect.applicability).toEqual({ zone: ["hand", "set_aside"] });
    expect(leaveEffect.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leaveEffect.usageLimit).toEqual({ kind: "no_duplicate" });
  });

  it("自分の動玩スピリットが転醒したとき、手札のこのカードが private declaration 候補に含まれる", () => {
    const front = makeDoutakuDoubleSided();
    // B 面 (BACK_NO) を独立 top-level 定義としても展開する。triggerFilter の
    // 系統/カテゴリ判定は afterCard (=B 面) の definitionId で解決するため必須
    // (rebirth-trigger.test.ts makeBackAsTopLevel と同型)。
    const back: CardDefinition = {
      cardNo: BACK_NO,
      name: front.backFace!.name!,
      printedCategory: front.backFace!.printedCategory!,
      colors: front.backFace!.colors!,
      cost: front.backFace!.cost!,
      reductionSymbols: front.backFace!.reductionSymbols!,
      levelDefs: front.backFace!.levelDefs!,
      symbolColors: front.backFace!.symbolColors!,
      textLines: front.backFace!.textLines!,
      keywordTags: front.backFace!.keywordTags!,
      tribe: front.backFace!.tribe,
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const lookup = buildTriggeredEffectLookup([X01, front, back]);
    const getDef = (id: string) =>
      id === X01.cardNo
        ? X01
        : id === FRONT_NO
          ? front
          : id === BACK_NO
            ? back
            : undefined;

    const cardBefore = createCardInstance(front, {
      instanceId: "doutaku-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cardAfter = { ...cardBefore, definitionId: BACK_NO };
    const handCard = createCardInstance(X01, {
      instanceId: "x01-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });

    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [cardBefore, handCard],
    });
    const after: GameState = {
      ...before,
      cardInstances: [cardAfter, handCard],
    };

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsth02-7-x01-hand-trigger-summon:215",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = queued.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === handCard.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("rebirth");
  });

  it("実行: 相手スピリットをデッキ下へ送り、1コスト払って手札からこのカードを召喚する", () => {
    const opponentDef = makeOpponentSpiritDef();
    const opponentSpirit = createCardInstance(opponentDef, {
      instanceId: "opp-spirit-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(X01, {
      instanceId: "x01-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [opponentSpirit, handCard],
    });
    const getDef = (id: string) =>
      id === X01.cardNo
        ? X01
        : id === opponentDef.cardNo
          ? opponentDef
          : undefined;
    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([X01, opponentDef]);

    const first = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth02-7-x01-hand-trigger-summon:257",
      state,
      effect: rebirthEffect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });

    const result = finishCoreChoices(
      flushPendingLeaves(
        autoResumePendingOptionalSteps({
          state: first,
          effect: rebirthEffect,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: lookup,
          executeEffectFn: executeEffect,
        }),
        getDef
      ),
      getDef,
      { getRegisteredTriggeredEffectActions: lookup }
    );

    const sentToDeck = result.cardInstances.find(
      (c) => c.instanceId === opponentSpirit.instanceId
    )!;
    expect(sentToDeck.zone).toBe("deck");

    const summoned = result.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(summoned.zone).toBe("field");
  });

  it("自分の動玩スピリットが相手起因で破壊されて実移動したとき、手札のこのカードが private declaration 候補に含まれる (cause:opponent_effect)", () => {
    const doutakuDef = makeDoutakuSpiritDef();
    const doutaku = createCardInstance(doutakuDef, {
      instanceId: "doutaku-plain-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(X01, {
      instanceId: "x01-hand-2",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [doutaku, handCard],
    });
    const lookup = buildTriggeredEffectLookup([X01, doutakuDef]);
    const getDef = (id: string) =>
      id === X01.cardNo
        ? X01
        : id === doutakuDef.cardNo
          ? doutakuDef
          : undefined;

    const chainId = "x01-leave-field-opponent-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: doutaku.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId,
    });

    const queued = collectAfterPhysicalLeave({
      beforeState: before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = queued.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === handCard.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("leave_field");
    expect(
      queued.cardInstances.find(
        (card) => card.instanceId === doutaku.instanceId
      )?.zone
    ).toBe("trash");
    expect(declaration!.event?.cause).toBe("opponent_effect");
  });

  it("自分自身の効果 (self_effect) による破壊では、pending 自体が queue されない (cause:opponent_effect/battle 不一致)", () => {
    const doutakuDef = makeDoutakuSpiritDef();
    const doutaku = createCardInstance(doutakuDef, {
      instanceId: "doutaku-plain-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(X01, {
      instanceId: "x01-hand-3",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [doutaku, handCard],
    });
    const lookup = buildTriggeredEffectLookup([X01, doutakuDef]);
    const getDef = (id: string) =>
      id === X01.cardNo
        ? X01
        : id === doutakuDef.cardNo
          ? doutakuDef
          : undefined;

    const chainId = "x01-leave-field-self-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: doutaku.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      chainId,
    });

    const queued = collectAfterPhysicalLeave({
      beforeState: before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      queued.pendingPrivateDeclarations.find(
        (d) => d.sourceInstanceId === handCard.instanceId
      )
    ).toBeUndefined();
    expect(
      queued.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === doutaku.instanceId
      )
    ).toBeUndefined();
  });

  it("実行 (leave_field): 相手スピリットをデッキ下へ送り、1コスト払って手札からこのカードを召喚する", () => {
    const opponentDef = makeOpponentSpiritDef();
    const opponentSpirit = createCardInstance(opponentDef, {
      instanceId: "opp-spirit-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(X01, {
      instanceId: "x01-hand-4",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [opponentSpirit, handCard],
    });
    const getDef = (id: string) =>
      id === X01.cardNo
        ? X01
        : id === opponentDef.cardNo
          ? opponentDef
          : undefined;
    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([X01, opponentDef]);

    const first = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth02-7-x01-hand-trigger-summon:431",
      state,
      effect: leaveEffect,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });

    const result = finishCoreChoices(
      flushPendingLeaves(
        autoResumePendingOptionalSteps({
          state: first,
          effect: leaveEffect,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: lookup,
          executeEffectFn: executeEffect,
        }),
        getDef
      ),
      getDef,
      { getRegisteredTriggeredEffectActions: lookup }
    );

    const sentToDeck = result.cardInstances.find(
      (c) => c.instanceId === opponentSpirit.instanceId
    )!;
    expect(sentToDeck.zone).toBe("deck");

    const summoned = result.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(summoned.zone).toBe("field");
  });
});
