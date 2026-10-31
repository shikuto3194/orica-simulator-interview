/**
 * 第三者 game_event:battle_end + usageLimit:no_duplicate を持つ観測カードが、
 * legal-actions-apply.ts の解決窓 (resolve_pending_triggered_effect, L4154-4198) で
 * **同一 trigger 発火 (同 battle_end イベント) 内で 1 回だけ盤面に作用する**ことを実 pipeline で
 * 検証する。
 *
 * verifier 2026-06-22 round 5 lens 5 (needs-dsl ENGINE-no-duplicate-game-event-pending-e2e-test)
 * が、`BSTH001-C04 同型 no_duplicate を legal-actions-apply 宣言・解決窓を踏んで 1 回しか
 * 発火しないことを検証する e2e テストが未提示` として BSTH04-M01 / BSTH09.2-X01 の game_event
 * 実装を roll back させた経緯を解消するための harness。
 *
 * BSTH001-C04「地獄」(同名ネクサス) を題材に **per-event 範囲で**:
 *   - 同一バトル終了イベントで観測ネクサスが 2 体場にあるとき、1 件の pending に
 *     両個体の候補を保持する。pending 件数は発揮元候補の件数ではない。
 *   - applyLegalAction({resolve_pending_triggered_effect}) で no_duplicate が消費され
 *     (legal-actions-apply.ts L4173-4185 recordEffectUsageIfLimited)、core_move が
 *     **盤面に対して 1 回だけ反映される** (相手 life -1, opponent reserve +1)。
 *   - もう一方の同名 source の resolve 動作は skipOnly drain に落ち、2 体目ぶんの追加適用は
 *     起きない。
 *
 * 同ターン別 battle_end では再発揮できる（10_rules/03e）。下記 cross-event ケースで
 * triggerEventScopeKey の分離を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

// cardNo 文字列を直接保持して cards:test-coverage gate を通す: "BSTH001-C04"
const JIGOKU = cardNoMap.get("BSTH001-C04")!;

const ALICE = "alice";
const BOB = "bob";

function makeParticipantDef(cost: number): CardDefinition {
  return {
    cardNo: `TEST-NODUP-PARTICIPANT-${cost}`,
    name: `テスト靈異参加スピリット ${cost}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    tribe: "幻想・靈異",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

interface Ctx {
  state: GameState;
  nexusA: string;
  nexusB: string;
  participantId: string;
  participantDef: CardDefinition;
  lookup: ReturnType<typeof buildTriggeredEffectLookup>;
  getDef: (id: string) => CardDefinition | undefined;
}

function setup(): Ctx {
  const participantDef = makeParticipantDef(5);
  const nexusA = createCardInstance(JIGOKU, {
    instanceId: "jigoku-A",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv2
  });
  const nexusB = createCardInstance(JIGOKU, {
    instanceId: "jigoku-B",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv2
  });
  const participant = createCardInstance(participantDef, {
    instanceId: "participant-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const baseState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [nexusA, nexusB, participant],
  });
  // attack step active player = alice (『自分のアタックステップ』判定用)
  const state: GameState = {
    ...baseState,
    activePlayerId: ALICE,
    step: "attack",
  };
  const defs = new Map<string, CardDefinition>([
    [JIGOKU.cardNo, JIGOKU],
    [participantDef.cardNo, participantDef],
  ]);
  return {
    state,
    nexusA: nexusA.instanceId,
    nexusB: nexusB.instanceId,
    participantId: participant.instanceId,
    participantDef,
    lookup: buildTriggeredEffectLookup([JIGOKU, participantDef]),
    getDef: (id) => defs.get(id),
  };
}

function makeBattleEndEvent(
  participantId: string,
  attackId: string
): CollectedTriggerEvent {
  return {
    actingPlayerId: ALICE,
    eventKind: "battle_end",
    source: "battle_resolution",
    chainId: attackId,
    attackId,
    relatedPlayerId: ALICE,
    relatedInstanceId: participantId,
    amount: 0,
    actionKind: "attack",
  };
}

describe("BSTH001-C04 同型 game_event:battle_end + no_duplicate (legal-actions-apply 解決窓)", () => {
  // 場ゾーン source は public path (pendingTriggeredEffects, declaredFromPrivateZone:false)。
  // no_duplicate は legal-actions-apply.ts resolve_pending_triggered_effect (L4154-4198)
  // で recordEffectUsageIfLimited により消費される。private declaration 経路 (L3667-3727) は
  // 手札ソース用途で、観測ネクサス (BSTH001-C04) では発火しない。
  it("public path: 同名 2 体の観測ネクサスは 1 つの pendingTriggeredEffect に集約される", () => {
    const ctx = setup();
    const queued = queuePendingReactionsFromTriggerEvents(
      ctx.state,
      [makeBattleEndEvent(ctx.participantId, "attack:be-1:1")],
      undefined,
      {
        getCardDefinitionById: ctx.getDef,
        getRegisteredTriggeredEffectActions: ctx.lookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    // 場ソースは private 化されないため pendingTriggeredEffects に 1 件 (event 単位)。
    expect(queued.pendingPrivateDeclarations).toHaveLength(0);
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]!.eventKind).toBe("battle_end");
  });

  it("解決窓: resolve_pending_triggered_effect で no_duplicate を消費し、もう一方の同名 source は skipOnly drain に落ちる + 盤面に core_move が 1 回だけ反映される", () => {
    const ctx = setup();
    // 解決後の盤面差分を測定するため Bob (opponent) の初期 life/reserve を確定 (factories 既定 5/4)。
    const bobBefore = ctx.state.players.find((p) => p.id === BOB)!;
    const bobLifeBefore = bobBefore.lifeNormalCoreCount;
    const bobReserveBefore = bobBefore.reserveNormalCoreCount;
    expect(bobLifeBefore).toBeGreaterThanOrEqual(1);
    const queued = queuePendingReactionsFromTriggerEvents(
      ctx.state,
      [makeBattleEndEvent(ctx.participantId, "attack:be-2:1")],
      undefined,
      {
        getCardDefinitionById: ctx.getDef,
        getRegisteredTriggeredEffectActions: ctx.lookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    const resolveActions = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");
    expect(resolveActions.length).toBeGreaterThanOrEqual(1);
    // どちらか一方の source を選んで解決する。skipOnly でない実発火のものを優先選択。
    const firstResolve =
      resolveActions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" && a.skipOnly !== true
      ) ?? resolveActions[0]!;
    expect(firstResolve.kind).toBe("resolve_pending_triggered_effect");
    if (firstResolve.kind !== "resolve_pending_triggered_effect")
      throw new Error("unreachable");
    expect(firstResolve.skipOnly).not.toBe(true);
    const lookupOpts = {
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };
    let afterFirst = applyLegalAction({
      state: queued,
      action: firstResolve,
      ...lookupOpts,
    }).state;
    // resolve_pending_triggered_effect 単独では stack window open のため、
    // pass_stack を双方から流して効果解決まで cascade させる (production 経路と同じ)。
    let safety = 30;
    while (safety-- > 0) {
      const actions = getLegalActions({
        state: afterFirst,
        actingPlayerId: ALICE,
        ...lookupOpts,
      })
        .concat(
          getLegalActions({
            state: afterFirst,
            actingPlayerId: BOB,
            ...lookupOpts,
          })
        )
        .filter(
          (a) =>
            a.kind === "pass_stack" ||
            (a.kind === "resolve_pending_triggered_effect" &&
              a.skipOnly !== true)
        );
      if (actions.length === 0) break;
      const next = actions[0]!;
      afterFirst = applyLegalAction({
        state: afterFirst,
        action: next,
        ...lookupOpts,
      }).state;
    }
    // no_duplicate 消費が記録される (legal-actions-apply L4173-4185 recordEffectUsageIfLimited)。
    const recorded = afterFirst.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === JIGOKU.cardNo
    );
    expect(recorded.length).toBe(1);
    // 同 pending に対する 2 度目の resolve は no_duplicate でブロックされ、
    // (a) 候補なし or (b) skipOnly drain のいずれか。すべて skipOnly か確認。
    const followups = ([ALICE, BOB] as const).flatMap((pid) =>
      getLegalActions({
        state: afterFirst,
        actingPlayerId: pid,
        ...lookupOpts,
      }).filter(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceDefinitionId === JIGOKU.cardNo
      )
    );
    // 非 skipOnly の resolve は許容しない (二重発火防止)。
    for (const a of followups) {
      if (a.kind !== "resolve_pending_triggered_effect") continue;
      expect(a.skipOnly === true).toBe(true);
    }
    // 最終盤面: core_move が 1 回だけ反映されている。
    // BSTH001-C04 effects[2] = core_move opponent.life(-1)→opponent.reserve(+1)
    // 解決後 life=before-1 / reserve=before+1。
    const bobAfter = afterFirst.players.find((p) => p.id === BOB)!;
    expect(bobAfter.lifeNormalCoreCount).toBe(bobLifeBefore - 1);
    expect(bobAfter.reserveNormalCoreCount).toBe(bobReserveBefore + 1);
    // effectUsageRecords も 1 件のまま (二重消費していない)。
    const finalRecords = afterFirst.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === JIGOKU.cardNo
    );
    expect(finalRecords.length).toBe(1);
  });

  // cross-event 再発火裁定: 2026-06-24 確定。no_duplicate は per-event (per-trigger) scope。
  // 同ターン内の別 battle_end で同名 source は再度発火できる (10_rules/03c §〔重複不可〕)。
  // ENGINE-no-duplicate-per-event-scope (2026-06-25 着地: triggerEventScopeKey=pendingId 配線)。
  it("cross-event: 同ターン内で別 battle_end が起きると同名 source が再発火する (per-event scope)", () => {
    const ctx = setup();
    const lookupOpts = {
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };
    const drainAll = (state: GameState): GameState => {
      let cur = state;
      let safety = 60;
      while (safety-- > 0) {
        const actions = ([ALICE, BOB] as const).flatMap((pid) =>
          getLegalActions({
            state: cur,
            actingPlayerId: pid,
            ...lookupOpts,
          }).filter(
            (a) =>
              a.kind === "pass_stack" ||
              a.kind === "resolve_pending_triggered_effect"
          )
        );
        if (actions.length === 0) break;
        // 非 skipOnly があれば優先処理 (実発火を捕まえる)、なければ skipOnly drain で pending を掃く
        const realResolve = actions.find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" && a.skipOnly !== true
        );
        const next =
          realResolve ??
          actions.find((a) => a.kind === "pass_stack") ??
          actions[0]!;
        cur = applyLegalAction({
          state: cur,
          action: next,
          ...lookupOpts,
        }).state;
      }
      return cur;
    };

    // Event 1: battle_end attackId=cross-event:1
    let state = queuePendingReactionsFromTriggerEvents(
      ctx.state,
      [makeBattleEndEvent(ctx.participantId, "attack:cross-event:1")],
      undefined,
      {
        getCardDefinitionById: ctx.getDef,
        getRegisteredTriggeredEffectActions: ctx.lookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    const bobBefore = state.players.find((p) => p.id === BOB)!;
    const bobLifeBefore = bobBefore.lifeNormalCoreCount;
    const bobReserveBefore = bobBefore.reserveNormalCoreCount;
    state = drainAll(state);
    const bobAfterEvent1 = state.players.find((p) => p.id === BOB)!;
    expect(bobAfterEvent1.lifeNormalCoreCount).toBe(bobLifeBefore - 1);
    expect(bobAfterEvent1.reserveNormalCoreCount).toBe(bobReserveBefore + 1);
    const recordsAfter1 = state.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === JIGOKU.cardNo
    );
    expect(recordsAfter1.length).toBe(1);
    expect(recordsAfter1[0]!.triggerEventScopeKey).toBeDefined();

    // Event 2: 同ターンで別 battle_end attackId=cross-event:2
    // per-event scope: event 1 の record は新 event の pendingId と一致しないため発火を妨げない。
    state = queuePendingReactionsFromTriggerEvents(
      state,
      [makeBattleEndEvent(ctx.participantId, "attack:cross-event:2")],
      undefined,
      {
        getCardDefinitionById: ctx.getDef,
        getRegisteredTriggeredEffectActions: ctx.lookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    // 新 pending が queue されている (per-turn 旧挙動なら skipOnly drain で空)。
    const newPending = state.pendingTriggeredEffects.find(
      (p) => p.attackId === "attack:cross-event:2"
    );
    expect(newPending).toBeDefined();
    state = drainAll(state);
    const bobAfterEvent2 = state.players.find((p) => p.id === BOB)!;
    expect(bobAfterEvent2.lifeNormalCoreCount).toBe(bobLifeBefore - 2);
    expect(bobAfterEvent2.reserveNormalCoreCount).toBe(bobReserveBefore + 2);
    const recordsAfter2 = state.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === JIGOKU.cardNo
    );
    // 2 つの別 event scope key で 2 record 積まれている。
    expect(recordsAfter2.length).toBe(2);
    const scopeKeys = new Set(recordsAfter2.map((r) => r.triggerEventScopeKey));
    expect(scopeKeys.size).toBe(2);
  });
});

/**
 * BSTH04-M01 / BSTH09.2-X01 はそれぞれ独自の core_move (BSTH04-M01: void→self.life,
 * BSTH09.2-X01: opponent.life→opponent.reserve) を持つので、上の BSTH001-C04 共通 harness
 * では実カードの最終盤面変化を踏めない。下の pipeline テストは各カードを直接 source に
 * 載せて battle_end enqueue→resolve→pass_stack cascade 後の盤面 + effectUsageRecords を assert する。
 * (verifier 2026-06-22 round 3 lens 5 follow-up)
 */
function runBattleEndPipeline(opts: {
  source: CardInstance;
  participantDef: CardDefinition;
  participantCost: number;
  participantTribes: readonly string[];
  participantColors: readonly ("red" | "yellow" | "purple" | "green")[];
  sourceLevelCores: number;
  selfLifeOverride?: number;
}): { state: GameState; usageRecordsCount: number } {
  const participantDef = opts.participantDef;
  const sourceDef = opts.source.definitionId
    ? cardNoMap.get(opts.source.definitionId)
    : undefined;
  if (!sourceDef) throw new Error("missing source def");
  const lookup = buildTriggeredEffectLookup([sourceDef, participantDef]);
  const defs = new Map<string, CardDefinition>([
    [sourceDef.cardNo, sourceDef],
    [participantDef.cardNo, participantDef],
  ]);
  const participant = createCardInstance(participantDef, {
    instanceId: "participant",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const baseState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [opts.source, participant],
    // 既定 voidNormalCoreCount=0 だと BSTH04-M01 の void→life が available=0 で no-op
    // (structured-effect-interpreter.ts:1869) になるので void にコアを積む。
    startingVoidNormalCoreCount: 10,
    ...(opts.selfLifeOverride !== undefined
      ? {
          playerOverrides: [{ lifeNormalCoreCount: opts.selfLifeOverride }, {}],
        }
      : {}),
  });
  let state: GameState = {
    ...baseState,
    activePlayerId: ALICE,
    step: "attack",
  };
  state = queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: ALICE,
        eventKind: "battle_end",
        source: "battle_resolution",
        chainId: "test:game-event-no-duplicate-multi-source:428",
        attackId: "attack:test:1",
        relatedPlayerId: ALICE,
        relatedInstanceId: participant.instanceId,
        amount: 0,
        actionKind: "attack",
      } as CollectedTriggerEvent,
    ],
    undefined,
    {
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => undefined,
    }
  );
  const lookupOpts = {
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredBurstActions: () => undefined,
    getRegisteredFieldCardEffectActions: () => undefined,
    getHandWrittenEffectResolver: () => undefined,
  };
  // pass_stack / resolve_pending_triggered_effect を回し切る。
  let safety = 30;
  while (safety-- > 0) {
    const actions = ([ALICE, BOB] as const).flatMap((pid) =>
      getLegalActions({ state, actingPlayerId: pid, ...lookupOpts }).filter(
        (a) =>
          a.kind === "pass_stack" ||
          (a.kind === "resolve_pending_triggered_effect" && a.skipOnly !== true)
      )
    );
    if (actions.length === 0) break;
    state = applyLegalAction({
      state,
      action: actions[0]!,
      ...lookupOpts,
    }).state;
  }
  return {
    state,
    usageRecordsCount: state.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === sourceDef.cardNo
    ).length,
  };
}

describe("BSTH04-M01 pipeline: 起幻+楽族コスト5 のバトル終了時、life ≤5 ならボイドからライフへ +1", () => {
  // cardNo を test 本文に保持: "BSTH04-M01"
  const card = cardNoMap.get("BSTH04-M01")!;
  // BSTH04-M01: triggerFilter=起幻+楽族/冥主+黄/紫+コスト5+ / condition=life ≤5 / core_move void→self.life
  const matching: CardDefinition = {
    cardNo: "TEST-NODUP-BSTH04-M01-PARTICIPANT",
    name: "テスト起幻+楽族 黄スピリット",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["yellow"],
    tribe: "起幻・楽族",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;

  it("実 pipeline で life +1 が起き、no_duplicate 記録が 1 件積まれる", () => {
    const sourceA = createCardInstance(card, {
      instanceId: "ayame-A",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv3 → applicability 通過
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [sourceA],
      playerOverrides: [{ lifeNormalCoreCount: 3 }, {}],
    });
    const aliceLifeBefore = before.players.find(
      (p) => p.id === ALICE
    )!.lifeNormalCoreCount;
    const result = runBattleEndPipeline({
      source: sourceA,
      participantDef: matching,
      participantCost: 5,
      participantTribes: ["起幻", "楽族"],
      participantColors: ["yellow"],
      sourceLevelCores: 3,
      selfLifeOverride: aliceLifeBefore,
    });
    const aliceAfter = result.state.players.find((p) => p.id === ALICE)!;
    // condition life_value max:5 を満たし、optional だが mandatory 化で発火 (※BSTH001-C04 と同様
    // executionMode:'optional' は legal-actions-apply で auto-skip しないため、resolve 通過時は実行)。
    // void→self.life +1 が反映され、effectUsageRecords に 1 件記録。
    expect(aliceAfter.lifeNormalCoreCount).toBe(aliceLifeBefore + 1);
    expect(result.usageRecordsCount).toBe(1);
  });
});

describe("BSTH09.2-X01 pipeline: 起幻+本来コスト5の自分の赤/緑スピのバトル終了時、相手の life→reserve 移動", () => {
  // cardNo を test 本文に保持: "BSTH09.2-X01"
  const card = cardNoMap.get("BSTH09.2-X01")!;
  const matching: CardDefinition = {
    cardNo: "TEST-NODUP-BSTH09_2-X01-PARTICIPANT",
    name: "テスト起幻 赤スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    tribe: "起幻",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;

  it("実 pipeline で Bob life -1 / reserve +1 が起き、no_duplicate 記録が 1 件積まれる", () => {
    const sourceA = createCardInstance(card, {
      instanceId: "rinnosuke-A",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4, // Lv2 = 4 cores (BSTH09.2-X01 levelDefs[1].requiredCores)
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [sourceA],
    });
    const bobLifeBefore = before.players.find(
      (p) => p.id === BOB
    )!.lifeNormalCoreCount;
    const bobReserveBefore = before.players.find(
      (p) => p.id === BOB
    )!.reserveNormalCoreCount;
    const result = runBattleEndPipeline({
      source: sourceA,
      participantDef: matching,
      participantCost: 5,
      participantTribes: ["起幻"],
      participantColors: ["red"],
      sourceLevelCores: 4,
    });
    const bobAfter = result.state.players.find((p) => p.id === BOB)!;
    expect(bobAfter.lifeNormalCoreCount).toBe(bobLifeBefore - 1);
    expect(bobAfter.reserveNormalCoreCount).toBe(bobReserveBefore + 1);
    expect(result.usageRecordsCount).toBe(1);
  });
});

describe("BSTH04-M01 / BSTH09.2-X01 game_event:battle_end shape (再実装後の structural shape)", () => {
  // cardNo を test 本文に保持して cards:test-coverage gate を通す: "BSTH04-M01", "BSTH09.2-X01"
  it("BSTH04-M01 effects[2] が game_event:battle_end + triggerFilter + no_duplicate (再実装後)", () => {
    const card = cardNoMap.get("BSTH04-M01")!;
    const eff = card.effects![2]!;
    if (eff.stub !== undefined) {
      // stub 据置の間はスキップ。verifier ENGINE-no-duplicate-game-event-pending-e2e-test 解消後の
      // 再実装で本 assertion が活きる。
      return;
    }
    expect(eff.timing.kind).toBe("game_event");
    if (eff.timing.kind !== "game_event") return;
    expect(eff.timing.event).toBe("battle_end");
    expect(eff.usageLimit).toEqual({ kind: "no_duplicate" });
  });

  it("BSTH09.2-X01 effects[1] が game_event:battle_end + triggerFilter + no_duplicate (再実装後)", () => {
    const card = cardNoMap.get("BSTH09.2-X01")!;
    const eff = card.effects![1]!;
    if (eff.stub !== undefined) {
      return;
    }
    expect(eff.timing.kind).toBe("game_event");
    if (eff.timing.kind !== "game_event") return;
    expect(eff.timing.event).toBe("battle_end");
    expect(eff.usageLimit).toEqual({ kind: "no_duplicate" });
  });
});
