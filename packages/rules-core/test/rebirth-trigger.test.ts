/**
 * engine-drain 1 (P3-14 C-2): 転醒時 (card_event:"rebirth") のトリガー発火配線テスト。
 *
 * 転醒 (executeRebirth) はダブルフェイスカードを B 面へ裏返す。B 面の『転醒時』効果は
 * card_event:"rebirth" として発火すべきだが、従来は flip 時に rebirth イベントが
 * emit されず発火していなかった。本テストは:
 *   - collectTriggerEventsFromStateDelta が front→back flip を rebirth イベントとして検出する
 *   - flip では summon / place / leave_field の誤イベントを emit しない
 *   - 煌臨元カードの A 面復帰 (B→A) を rebirth として誤検出しない
 *   - collectAndQueueTriggerReactions で B 面『転醒時』効果が pending 化される
 *   - executeRebirth の実 flip 経由でも rebirth イベントが検出される
 *   - 通常召喚は依然 summon を emit する (リグレッションなし)
 * を検証する。
 *
 * 注: 本タスクは「rebirth イベント dispatch の配線」が範囲。production の ALL_CARDS は
 * back face を top-level 定義として展開していない (buildLookup は cardNo→def のみ) ため、
 * production で B 面 effects を resolve するには別途 back-face 登録が必要。本テストは
 * lookup / 登録に B 面を明示的に含めて event dispatch 経路を行使する。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  collectTriggerEventsFromStateDelta,
  collectAndQueueTriggerReactions,
  triggerEventKindToStructuredEvent,
} from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import type { RebirthAction } from "../src/model";
import { createCardInstance, createEmptyGameState } from "../src/factories";

// --- Fixtures ---

const FRONT_NO = "TEST-REBIRTH(A)";
const BACK_NO = "TEST-REBIRTH(B)";

/**
 * B 面に『転醒時』(card_event:"rebirth") の count_increase 効果を持つダブルフェイス
 * スピリットの A 面定義。B 面は backFace に格納し、別 top-level 定義としても登録できる
 * よう同一 cardNo (BACK_NO) を共有する。
 */
function makeDoubleSidedFront(): CardDefinition {
  return {
    cardNo: FRONT_NO,
    name: "Test Rebirth Front",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["purple"],
    textLines: ["Lv1【転醒：自分のカウント3以下】このスピリットを裏返せる。"],
    keywordTags: ["double_sided"],
    sourceUrls: [],
    sourceConfidence: "C",
    isDoubleSided: true,
    backFace: {
      name: "Test Rebirth Back",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["purple"],
      textLines: ["Lv1『このスピリットの転醒時』デッキから1枚ドローする。"],
      keywordTags: [],
      cardNo: BACK_NO,
      effects: [
        {
          timing: { kind: "card_event", event: "rebirth" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    },
  };
}

/**
 * backFace を top-level の独立定義に展開したもの (production の buildLookup が back face を
 * 展開しないため、テストではこれを lookup / triggered-effect 登録に含めて B 面 effects を
 * resolve 可能にする)。
 */
function makeBackAsTopLevel(front: CardDefinition): CardDefinition {
  const back = front.backFace!;
  return {
    cardNo: back.cardNo!,
    name: back.name,
    printedCategory: back.printedCategory,
    colors: back.colors,
    cost: back.cost,
    reductionSymbols: back.reductionSymbols,
    levelDefs: back.levelDefs,
    symbolColors: back.symbolColors,
    textLines: back.textLines,
    keywordTags: back.keywordTags,
    sourceUrls: [],
    sourceConfidence: "C",
    ...(back.effects ? { effects: back.effects } : {}),
  };
}

function makePlainSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `Plain ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

// --- triggerEventKindToStructuredEvent mapping ---

describe("triggerEventKindToStructuredEvent — rebirth", () => {
  it("maps rebirth to state_change family with require_related_instance_on_field", () => {
    expect(triggerEventKindToStructuredEvent("rebirth")).toEqual({
      family: "state_change",
      // P3-14 C-2: state_change family 内の種別判別 (exhaust/recover/rebirth)。
      actionKind: "rebirth",
      validationMode: "require_related_instance_on_field",
    });
  });
});

// --- collectTriggerEventsFromStateDelta: rebirth detection ---

describe("collectTriggerEventsFromStateDelta — rebirth (転醒) detection", () => {
  it("emits a rebirth event when a field card flips A-face → B-face", () => {
    const front = makeDoubleSidedFront();
    const lookup = createLookup([front]);

    const cardBefore = createCardInstance(front, {
      instanceId: "df-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    // executeRebirth の delta を模倣: definitionId を B 面へ swap (zone/originalDefinitionId は不変)。
    const cardAfter = { ...cardBefore, definitionId: BACK_NO };

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookup,
    });

    const rebirthEvents = events.filter((e) => e.eventKind === "rebirth");
    expect(rebirthEvents.length).toBe(1);
    expect(rebirthEvents[0]!.relatedInstanceId).toBe("df-1");
    expect(rebirthEvents[0]!.actingPlayerId).toBe("alice");
    expect(rebirthEvents[0]!.relatedPlayerId).toBe("alice");
  });

  it("does NOT emit summon / place / leave_field on a rebirth flip", () => {
    const front = makeDoubleSidedFront();
    const lookup = createLookup([front]);

    const cardBefore = createCardInstance(front, {
      instanceId: "df-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    const cardAfter = { ...cardBefore, definitionId: BACK_NO };

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookup,
    });

    expect(events.filter((e) => e.eventKind === "summon").length).toBe(0);
    expect(events.filter((e) => e.eventKind === "place").length).toBe(0);
    expect(events.filter((e) => e.eventKind === "leave_field").length).toBe(0);
  });

  it("does NOT emit rebirth for an advent-source A-face revert (B→A definitionId change)", () => {
    // 煌臨元カードは executeAdvent で definitionId を originalDefinitionId (= A 面) へ戻す。
    // before=B 面定義, after=A 面定義 の遷移。before 定義 (back face を top-level 化したもの)
    // は isDoubleSided ではないため rebirth として誤検出してはならない。
    const front = makeDoubleSidedFront();
    const back = makeBackAsTopLevel(front);
    const lookup = createLookup([front, back]);

    const cardBefore = createCardInstance(back, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    // definitionId が A 面へ戻る (originalDefinitionId は createCardInstance では back の cardNo)。
    const cardAfter = { ...cardBefore, definitionId: FRONT_NO };

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookup,
    });

    expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(0);
  });

  it("skips rebirth detection when getCardDefinitionById is not provided (back-compat)", () => {
    const front = makeDoubleSidedFront();
    const cardBefore = createCardInstance(front, {
      instanceId: "df-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    const cardAfter = { ...cardBefore, definitionId: BACK_NO };

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      // getCardDefinitionById 省略
    });

    expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(0);
  });

  it("still emits summon (not rebirth) for a normal spirit summon — no regression", () => {
    const plain = makePlainSpirit("PLAIN-1");
    const front = makeDoubleSidedFront();
    const lookup = createLookup([plain, front]);

    const cardBefore = createCardInstance(plain, {
      instanceId: "s1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const cardAfter = {
      ...cardBefore,
      zone: "field" as const,
      zoneRoleName: "spirit",
    };

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookup,
    });

    expect(events.filter((e) => e.eventKind === "summon").length).toBe(1);
    expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(0);
  });
});

// --- collectAndQueueTriggerReactions: B 面『転醒時』が pending 化される ---

describe("collectAndQueueTriggerReactions — rebirth queues B-face 転醒時 effect", () => {
  it("queues a pending triggered effect for the B-face card_event:rebirth", () => {
    const front = makeDoubleSidedFront();
    const back = makeBackAsTopLevel(front);
    const lookup = createLookup([front, back]);
    // B 面を triggered-effect 登録に含める (production は別途 back-face 登録が必要)。
    const triggeredLookup = buildTriggeredEffectLookup([front, back]);

    const cardBefore = createCardInstance(front, {
      instanceId: "df-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    const cardAfter = { ...cardBefore, definitionId: BACK_NO };

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:rebirth-trigger:335",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "rebirth"
    );
    expect(rebirthPendings.length).toBe(1);
    expect(rebirthPendings[0]!.relatedInstanceId).toBe("df-1");
    expect(rebirthPendings[0]!.actingPlayerId).toBe("alice");
    expect(rebirthPendings[0]!.event).toMatchObject({ family: "state_change" });
  });

  it("does NOT queue a rebirth pending when the B-face has no 転醒時 effect (opt-in)", () => {
    // B 面に rebirth timing 効果を持たないダブルフェイスは pending を作らない。
    const front = makeDoubleSidedFront();
    const back = makeBackAsTopLevel(front);
    // B 面の effects を剥がす。
    const backNoEffect: CardDefinition = { ...back };
    delete backNoEffect.effects;
    const lookup = createLookup([front, backNoEffect]);
    const triggeredLookup = buildTriggeredEffectLookup([front, backNoEffect]);

    const cardBefore = createCardInstance(front, {
      instanceId: "df-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    const cardAfter = { ...cardBefore, definitionId: BACK_NO };

    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [cardBefore],
    });
    const after = { ...before, cardInstances: [cardAfter] };

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:rebirth-trigger:378",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      queued.pendingTriggeredEffects.filter((p) => p.eventKind === "rebirth")
        .length
    ).toBe(0);
  });

  it("does NOT offer a rebirth effect as a responder to an exhaust event (state_change cross-talk guard)", async () => {
    // 同一カードが card_event:rebirth と card_event:exhaust を併せ持つ場合、
    // exhaust イベントに対して rebirth 効果が source choice に出てはならない
    // (rebirth/exhaust/recover は state_change family を共有するため、event 文字列照合で絞る)。
    const front = makeDoubleSidedFront();
    const back = makeBackAsTopLevel(front);
    // B 面に exhaust 効果も追加。
    const backWithExhaust: CardDefinition = {
      ...back,
      effects: [
        ...(back.effects ?? []),
        {
          timing: { kind: "card_event", event: "exhaust" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const lookup = createLookup([front, backWithExhaust]);
    const triggeredLookup = buildTriggeredEffectLookup([
      front,
      backWithExhaust,
    ]);

    const { getAvailableTriggeredEffectSourceChoices } =
      await import("../src/effect/trigger-system");

    const onField = createCardInstance(backWithExhaust, {
      instanceId: "b-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [onField],
    });

    const exhaustPending = {
      pendingId: "p-exhaust",
      actingPlayerId: "alice",
      eventKind: "exhaust" as const,
      event: triggerEventKindToStructuredEvent("exhaust"),
      source: "action_resolution" as const,
      chainId: "test:rebirth-trigger:432",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "b-1",
      amount: null,
      step: state.step,
      window: state.window,
      resolvedSourceInstanceIds: [],
    };

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: exhaustPending,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    // exhaust 効果のみが候補。rebirth 効果 (effectIndex 0) は除外される。
    expect(choices.length).toBe(1);
    expect(choices[0]!.actionRegistration.eventKind).toBe("exhaust");
  });
});

// --- executeRebirth (実 flip) 経由で rebirth イベントが検出される ---

describe("executeRebirth + collectTriggerEventsFromStateDelta — end-to-end flip", () => {
  it("real executeRebirth flip yields exactly one rebirth event and counts +1", () => {
    const front = makeDoubleSidedFront();
    const back = makeBackAsTopLevel(front);
    const lookup = createLookup([front, back]);

    const card = createCardInstance(front, {
      instanceId: "df-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });

    const action: RebirthAction = {
      kind: "rebirth",
      maxCount: 3,
      triggerDescription: "",
    };
    const after = executeRebirth(
      before,
      "alice",
      action,
      "df-1",
      lookup,
      "test:rebirth-trigger:487"
    );

    // flip が実際に起きたことを確認 (definitionId が B 面へ、カウント+1)。
    const flipped = after.cardInstances.find((c) => c.instanceId === "df-1")!;
    expect(flipped.definitionId).toBe(BACK_NO);
    expect(flipped.zone).toBe("field");
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(1);

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookup,
    });

    const rebirthEvents = events.filter((e) => e.eventKind === "rebirth");
    expect(rebirthEvents.length).toBe(1);
    expect(rebirthEvents[0]!.relatedInstanceId).toBe("df-1");
    // flip では場入り/離脱イベントは出ない。
    expect(events.filter((e) => e.eventKind === "summon").length).toBe(0);
    expect(events.filter((e) => e.eventKind === "leave_field").length).toBe(0);
  });
});
