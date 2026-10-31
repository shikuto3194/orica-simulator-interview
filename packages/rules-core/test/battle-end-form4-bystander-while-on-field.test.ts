/**
 * バトル終了時 形式4 (10_rules/02 §バトル終了時 形式別、裁定 2026-06-22 /
 * queue ENGINE-battle-end-form4-bystander-while-on-field) — engine 拡張のみの単体テスト。
 *
 * 形式4 = 「Lv1-Lv2『お互いのアタックステップ』...また、バトル終了時、〜」(BSDB01-M01[2]
 * 想定)。既定 (形式1/3) は battle_end の `require_related_instance_on_field` 検証で参加
 * カード (relatedInstanceId) のフィールド残留を要求するが、形式4 は (a) 任意バトル観測 +
 * (b) バトル参加者の離脱を許容 (= 観測対象 on-field を要求しない) + (c) 効果ソース自身は
 * while_on_field gating で表現する。
 *
 * 実装: TimingGameEvent.requireRelatedInstanceOnField:false の opt-out。効果ソース自身の
 * 場残留は sourceZone 既定 (field-only) の getTriggeredEffectSourceUseBlockReason で別軸で
 * 保証される。形式3 (BSTH001-C04 game-event-battle-end-third-party) は opt-out 無しなので
 * 参加カード on-field 要求を従来どおり維持 (回帰なし)。
 *
 * 注: BSDB01-M01 の card-data 着地は production の queueBattleEndTriggers が per-responder
 * pending push をしない consumer side gap が verifier 2026-06-23 round 4 で発覚したため、
 * needs-dsl: ENGINE-battle-end-game-event-responder-distinction で park。本テストは engine
 * primitive (TimingGameEvent.requireRelatedInstanceOnField の opt-out 動作) を合成 CardDefinition
 * で検証する。
 */
import { describe, expect, it } from "vitest";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  queueBattleEndTriggers,
} from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
  StructuredTriggerEvent,
} from "../src/model";

const ALICE = "alice";
const BOB = "bob";

/** 形式4 観測リスナー (任意バトル観測 + 参加者離脱許容 + while_on_field gating) を持つ合成カード。 */
function makeForm4Observer(): CardDefinition {
  return {
    cardNo: "TEST-FORM4-OBSERVER",
    name: "テスト 形式4 観測ネクサス",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1 }],
    symbolColors: ["red"],
    textLines: [
      "Lv1『お互いのアタックステップ』バトル終了時、自分のカウント+1する。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: "battle_end",
          requireRelatedInstanceOnField: false,
        },
        timingScope: { player: "both", period: "attack" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

/** 形式3 観測リスナー (require_related_instance_on_field 既定で参加カード on-field 必須)。 */
function makeForm3Observer(): CardDefinition {
  return {
    cardNo: "TEST-FORM3-OBSERVER",
    name: "テスト 形式3 観測ネクサス",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1 }],
    symbolColors: ["red"],
    textLines: [
      "Lv1『自分のアタックステップ』自分のスピリットのバトル終了時、自分のカウント+1する。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // requireRelatedInstanceOnField 未指定 = 既定 true (= require_related_instance_on_field)
        timing: { kind: "game_event", player: "self", event: "battle_end" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

/** ダミーの参加スピリット。 */
function makeBystanderDef(): CardDefinition {
  return {
    cardNo: "TEST-FORM4-PARTICIPANT",
    name: "テスト参加スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

interface Ctx {
  state: GameState;
  observerId: string;
  participantId: string;
  getDef: (id: string) => CardDefinition | undefined;
  lookup: ReturnType<typeof buildTriggeredEffectLookup>;
}

function setup(opts: {
  observer: CardDefinition;
  observerZone?: "field" | "trash";
  participantZone?: "field" | "trash";
  participantPendingLeave?: boolean;
  step?: "attack" | "main" | "draw";
  activePlayerId?: string;
}): Ctx {
  const bystander = makeBystanderDef();
  const observer = createCardInstance(opts.observer, {
    instanceId: "form4-observer",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: opts.observerZone ?? "field",
    normalCoreCount: 1,
  });
  const participant = createCardInstance(bystander, {
    instanceId: "bystander-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: opts.participantZone ?? "field",
    normalCoreCount: 1,
    ...(opts.participantPendingLeave
      ? { pendingLeaveKind: "destroy" as const }
      : {}),
  });

  const baseState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [observer, participant],
  });
  const state: GameState = {
    ...baseState,
    step: opts.step ?? "attack",
    activePlayerId: opts.activePlayerId ?? ALICE,
  };

  const defs = new Map<string, CardDefinition>([
    [opts.observer.cardNo, opts.observer],
    [bystander.cardNo, bystander],
  ]);

  return {
    state,
    observerId: observer.instanceId,
    participantId: participant.instanceId,
    getDef: (id) => defs.get(id),
    lookup: buildTriggeredEffectLookup([opts.observer, bystander]),
  };
}

function battleEndPending(
  relatedInstanceId: string,
  actionKind: "attack" | "block",
  actingPlayerId: string = ALICE
): PendingTriggeredEffect {
  const event: StructuredTriggerEvent = {
    family: "battle_end",
    validationMode: "require_related_instance_on_field",
    actionKind,
  };
  return {
    pendingId: "pte:battle-end-form4-1",
    actingPlayerId,
    eventKind: "battle_end",
    event,
    source: "battle_resolution",
    chainId: "test:battle-end-form4-bystander-while-on-field:192",
    attackId: "attack:be-form4:1",
    relatedPlayerId: ALICE,
    relatedInstanceId,
    amount: 0,
    step: "attack",
    window: "declare_attack",
    resolvedSourceInstanceIds: [],
  } as PendingTriggeredEffect;
}

describe("バトル終了時 形式4 — TimingGameEvent.requireRelatedInstanceOnField:false opt-out", () => {
  const form4 = makeForm4Observer();

  it("形式4 は参加カードが trash に落ちても候補に含まれる (requireRelatedInstanceOnField:false で on-field 検査を skip)", () => {
    const ctx = setup({ observer: form4, participantZone: "trash" });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeDefined();
  });

  it("形式4 は pendingLeave (離脱予定) の参加カードでも候補に含まれる", () => {
    const ctx = setup({ observer: form4, participantPendingLeave: true });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeDefined();
  });

  it("形式4 は相手のアタックステップでも候補に含まれる (timingScope.player:both)", () => {
    const ctx = setup({ observer: form4, activePlayerId: BOB });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeDefined();
  });

  it("効果ソースが場を離れていれば形式4 でも候補に含まれない (while_on_field gating = sourceZone 既定 field-only)", () => {
    const ctx = setup({ observer: form4, observerZone: "trash" });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeUndefined();
  });

  it("アタックステップ以外 (例 main) のバトル終了では timingScope.period:attack に弾かれ候補に含まれない", () => {
    const ctx = setup({ observer: form4, step: "main" });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeUndefined();
  });
});

describe("opt-out scope — event:'battle_end' 以外では requireRelatedInstanceOnField:false を無効化", () => {
  // verifier 2026-06-23 round 6 lens 2 補正: requireRelatedInstanceOnField:false の opt-out は
  // event === 'battle_end' に限定すべき。advent/rebirth/brave_combined 等の他
  // require_related_instance_on_field event の検査を誤って外さないこと。
  function makeMisuseObserver(): CardDefinition {
    return {
      cardNo: "TEST-MISUSE-OPT-OUT-OBSERVER",
      name: "テスト 誤用 opt-out 観測ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『相手スピリットの煌臨時 (非該当の opt-out 誤用テスト)』",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          // 不正な opt-out: event は advent (battle_end ではない) なのに opt-out flag を立てる
          timing: {
            kind: "game_event",
            player: "either",
            event: "advent",
            requireRelatedInstanceOnField: false,
          },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0],
        },
      ],
    } as CardDefinition;
  }

  it("event:'advent' に requireRelatedInstanceOnField:false を付けても on-field 検査は外れない (battle_end 限定 opt-out)", () => {
    const observer = makeMisuseObserver();
    const ctx = setup({
      observer,
      // 関連カードを trash に置いて on-field 検査の通過/失敗を観察
      participantZone: "trash",
    });
    const advent: StructuredTriggerEvent = {
      family: "enter_field",
      actionKind: "advent",
      validationMode: "require_related_instance_on_field",
    };
    const pending: PendingTriggeredEffect = {
      pendingId: "pte:advent-misuse-1",
      actingPlayerId: ALICE,
      eventKind: "advent",
      event: advent,
      source: "action_resolution",
      chainId: "test:battle-end-form4-bystander-while-on-field:328",
      attackId: null,
      relatedPlayerId: ALICE,
      relatedInstanceId: ctx.participantId, // trash
      amount: 0,
      step: "main",
      window: "main",
      resolvedSourceInstanceIds: [],
    } as PendingTriggeredEffect;
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    // event:advent の require_related_instance_on_field 検査は維持される (opt-out 効かず)
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════
// queueBattleEndTriggers per-responder × per-participant push
// (ENGINE-battle-end-game-event-responder-distinction)
// ════════════════════════════════════════════════════════════════

describe("queueBattleEndTriggers per-responder × per-participant push", () => {
  // 形式4 観測 (BSDB01-M01[2] 型: 自カード上のリスナー、相手側参加バトルも観測)
  function makeForm4OnAlice(): CardDefinition {
    return {
      cardNo: "TEST-FORM4-ON-ALICE",
      name: "テスト 形式4 Alice 側観測ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『お互いのアタックステップ』バトル終了時、自分のカウント+1する。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "either",
            event: "battle_end",
            requireRelatedInstanceOnField: false,
          },
          timingScope: { player: "both", period: "attack" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0],
        },
      ],
    } as CardDefinition;
  }

  // 形式3 観測 (BSTH001-C04 型: 自分の靈異/赤コスト5以上スピリットのバトル終了時)
  function makeForm3OnAlice(): CardDefinition {
    return {
      cardNo: "TEST-FORM3-ON-ALICE",
      name: "テスト 形式3 Alice 側観測ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『自分のアタックステップ』自分のスピリットのバトル終了時、自分のカウント+1する。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "game_event", player: "self", event: "battle_end" },
          timingScope: { player: "self", period: "attack" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0],
        },
      ],
    } as CardDefinition;
  }

  // 形式1 観測 (BSTH01-R02 型: 自己 card_event:battle_end)
  function makeForm1Self(): CardDefinition {
    return {
      cardNo: "TEST-FORM1-SELF",
      name: "テスト 形式1 自己観測スピリット",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 5,
      reductionSymbols: ["red", "red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["red"],
      textLines: ["『このスピリットのバトル終了時』自分のカウント+1する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "battle_end" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0],
        },
      ],
    } as CardDefinition;
  }

  function buildState(opts: {
    aliceCards: CardDefinition[];
    bobParticipantDef?: CardDefinition;
  }): {
    state: GameState;
    aliceObserverIds: string[];
    bobParticipantId: string;
    getDef: (id: string) => CardDefinition | undefined;
    lookup: ReturnType<typeof buildTriggeredEffectLookup>;
  } {
    const bobParticipantDef = opts.bobParticipantDef ?? makeBystanderDef();
    const aliceObservers = opts.aliceCards.map((def, i) =>
      createCardInstance(def, {
        instanceId: `alice-observer-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const bobParticipant = createCardInstance(bobParticipantDef, {
      instanceId: "bob-participant-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [...aliceObservers, bobParticipant],
    });
    // BOB アタックステップ
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: BOB,
    };
    const defs = new Map<string, CardDefinition>(
      [...opts.aliceCards, bobParticipantDef].map((d) => [d.cardNo, d])
    );
    return {
      state,
      aliceObserverIds: aliceObservers.map((c) => c.instanceId),
      bobParticipantId: bobParticipant.instanceId,
      getDef: (id) => defs.get(id),
      lookup: buildTriggeredEffectLookup([
        ...opts.aliceCards,
        bobParticipantDef,
      ]),
    };
  }

  it("形式4 Alice 観測者が BOB のアタックステップ参加バトル終了で発火する (per-responder push)", () => {
    const form4 = makeForm4OnAlice();
    const ctx = buildState({ aliceCards: [form4] });
    const after = queueBattleEndTriggers({
      state: ctx.state,
      participantInstanceIds: [ctx.bobParticipantId],
      attackId: "attack:per-responder:1",
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    // 形式4: Alice 側 observer が候補 pending に含まれる
    const pendings = after.pendingTriggeredEffects;
    expect(pendings.length).toBeGreaterThan(0);
    // 1 つ以上の pending が actingPlayerId=Alice で積まれている
    const alicePendings = pendings.filter((p) => p.actingPlayerId === ALICE);
    expect(alicePendings.length).toBeGreaterThan(0);
    // 形式4 reading は relatedInstanceId=Bob participant
    expect(
      alicePendings.find((p) => p.relatedInstanceId === ctx.bobParticipantId)
    ).toBeDefined();
  });

  it("形式3 Alice 観測者は BOB のアタックステップ (Bob participant) では発火しない (timing.player:self で弾く)", () => {
    const form3 = makeForm3OnAlice();
    const ctx = buildState({ aliceCards: [form3] });
    const after = queueBattleEndTriggers({
      state: ctx.state,
      participantInstanceIds: [ctx.bobParticipantId],
      attackId: "attack:per-responder:2",
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    // Bob participant のバトル終了: relatedPlayer=Bob、Alice 側 form3 listener (player:self) は
    // relatedPlayer === source.controller を要求するため Alice source は弾かれる。
    // ↓ source-scan で弾かれた pending は queue されない (空 pending は積まれない)。
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("形式4 ブロック成立 2 参加者バトルでも同一 source は 1 pending に縮退する (ENGINE-battle-end-multi-participant-responder-dedup 着地)", () => {
    // verifier 2026-06-23 round 7 lens 2 + round 8 lens 5: form4 (player:'either' +
    // requireRelatedInstanceOnField:false) は queueBattleEndTriggers が participants × players
    // で fan-out するため、ブロック成立 (attacker + blocker = 2 participants) で Alice 側
    // responder の form4 source は本来 2 event の候補になるが、event2 の pending に event1 で
    // 解決済の source key を resolvedSourceRegistrationKeys 経由で pre-claim 注入し、
    // 後続 event の source 候補から除外する。結果 1 source = 1 pending に縮退 (count+1 が
    // 1 回だけ発火、二重発火しない)。
    const form4 = makeForm4OnAlice();
    const ctx = buildState({ aliceCards: [form4] });
    // Alice 側にも participant を 1 体追加して 2 participants を構成。
    const aliceParticipant = createCardInstance(makeBystanderDef(), {
      instanceId: "alice-participant-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const stateWith2 = {
      ...ctx.state,
      cardInstances: [...ctx.state.cardInstances, aliceParticipant],
    };
    const after = queueBattleEndTriggers({
      state: stateWith2,
      participantInstanceIds: [
        aliceParticipant.instanceId,
        ctx.bobParticipantId,
      ],
      attackId: "attack:multi-participant:1",
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    // Alice 側 form4 listener 用 pending 数: dedup 着地後は 1 件 (1 source = 1 fire)。
    const aliceForm4Pendings = after.pendingTriggeredEffects.filter(
      (p) => p.actingPlayerId === ALICE && p.eventKind === "battle_end"
    );
    expect(aliceForm4Pendings.length).toBe(1);
  });

  it("形式4 ブロック成立 2 参加者バトルで複数 source が居る場合、各 source 1 pending ずつ縮退する (per-source dedup)", () => {
    // form4 を 2 体並べ、それぞれ独立に 1 fire ずつになることを確認。
    const form4a = makeForm4OnAlice();
    const form4b: CardDefinition = {
      ...form4a,
      cardNo: "TEST-FORM4-ON-ALICE-2",
      name: "テスト 形式4 Alice 側観測ネクサス 2",
    };
    const ctx = buildState({ aliceCards: [form4a, form4b] });
    const aliceParticipant = createCardInstance(makeBystanderDef(), {
      instanceId: "alice-participant-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const stateWith2 = {
      ...ctx.state,
      cardInstances: [...ctx.state.cardInstances, aliceParticipant],
    };
    const after = queueBattleEndTriggers({
      state: stateWith2,
      participantInstanceIds: [
        aliceParticipant.instanceId,
        ctx.bobParticipantId,
      ],
      attackId: "attack:multi-participant:2",
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    // 形式4 source 2 体 → pending 1 件 (両 source が同 pending の sourceChoices に含まれる)。
    // pending は event 単位なので 2 source × 2 event = 4 fire ではなく
    // 1 pending × 2 source = 2 fire (1 source あたり 1 fire) になる。
    const aliceForm4Pendings = after.pendingTriggeredEffects.filter(
      (p) => p.actingPlayerId === ALICE && p.eventKind === "battle_end"
    );
    expect(aliceForm4Pendings.length).toBe(1);
    // 残りの event でこの 2 source が再選択されないことを execute-time 経路で確認する:
    // pending の resolvedSourceRegistrationKeys には pre-claim 注入はないが (event1 で先に claim)、
    // event2 では sourceChoices=0 で pending が積まれない (上記 length=1 = event1 のみ)。
  });

  it("形式1 自己 (Bob participant 自身に card_event:battle_end) は per-responder push でも二重発火しない", () => {
    // Bob participant 自身が形式1 自己リスナーを持つ。
    const form1 = makeForm1Self();
    const ctx = buildState({
      aliceCards: [],
      bobParticipantDef: form1,
    });
    const after = queueBattleEndTriggers({
      state: ctx.state,
      participantInstanceIds: [ctx.bobParticipantId],
      attackId: "attack:per-responder:3",
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    // 形式1: card_event:battle_end は source===relatedInstance 制約で Bob participant のみ source。
    // whose 既定 self で actingPlayer=Bob の pending のみ通過し、actingPlayer=Alice の pending は
    // source.controller=Bob != Alice で弾かれる → 1 pending 分のみ queue される (二重発火なし)。
    const bobParticipantPendings = after.pendingTriggeredEffects.filter(
      (p) => p.relatedInstanceId === ctx.bobParticipantId
    );
    // actingPlayer=Bob の 1 件のみ
    expect(bobParticipantPendings.length).toBe(1);
    expect(bobParticipantPendings[0]!.actingPlayerId).toBe(BOB);
  });
});

describe("バトル終了時 形式3 — 既定 require_related_instance_on_field (回帰防止)", () => {
  const form3 = makeForm3Observer();

  it("形式3 (requireRelatedInstanceOnField 未指定 = 既定 true) は参加カード trash 落ちで候補から除外される", () => {
    const ctx = setup({ observer: form3, participantZone: "trash" });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeUndefined();
  });

  it("形式3 は参加カードが場に残っていれば従来どおり候補に含まれる", () => {
    const ctx = setup({ observer: form3, participantZone: "field" });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeDefined();
  });

  it("形式3 は pendingLeave の参加カードでも除外される (P3-97 同期 flush 規約と整合)", () => {
    const ctx = setup({ observer: form3, participantPendingLeave: true });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.observerId)
    ).toBeUndefined();
  });
});
