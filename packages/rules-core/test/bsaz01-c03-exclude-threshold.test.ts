/**
 * BSAZ01-C03「いつか見た流星」
 *
 * effects[0]: 〔ターンに1回：同名〕手札にあるこのカードは、自分のスピリット/アルティメットが
 *   フィールドを離れるとき、コストを支払わずに使用できる (conditional-free-magic-use-on-event、
 *   BSAZ02-C15 同型、cause 限定なし)。
 * effects[1]: フラッシュ。自分の手札/手元/フィールドのカード13枚までを除外し、除外枚数の
 *   閾値 (2枚以上/3枚以上/10枚以上) で段階効果を発揮する。除外は TargetSpec.kind:"filter" の
 *   zone: Zone[] (hand/set_aside/field 合算候補プール) + count:{min:0,max:13} で表現し、
 *   実除外枚数を ref_count で後続 step のゲートに使う。3枚以上は stay_on_field
 *   (trigger_related_instance) で表現し、離脱スピリット/アルティメットの主語 Y を
 *   effects[0](use_magic_without_cost) から別 effectIndex(このflash本体) まで引き継ぐ
 *   (ENGINE-leave-field-free-use-stay-on-field-flush-gate 解消、実行時 e2e は
 *   engine-leave-field-free-use-stay-on-field-flush-gate.test.ts 参照)。
 *   13枚以上は同じ effects[1] 内で usage-gate-13 (noop+target:{kind:"ref",stepId:"exclude-cards"}、
 *   〔ゲームに1回：同名〕の usageLimit を一元消費する gate) → end_turn (相手のターンを終了する、gate 成功に加え
 *   turn_player:opponent を要求) → discard(fromZone:"deck", targetHandSize:1) (自分のデッキを
 *   1枚になるように破棄する、gate 成功のみ要求) → skip_next_turn(player:"opponent") (相手は
 *   次のターンを行えない、新設 primitive、ENGINE-opponent-turn-skip、gate 成功のみ要求) の
 *   4 step で表現する (cluster engine-bsaz01-c03-opponent-turn-skip、裁定 needs-ruling.jsonl
 *   BSAZ01-C03 案B採用 2026-08-04: 「その後」は独立した段階効果、usageLimit は gate 1本に
 *   集約して end_turn の後出しを防ぐ)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect as executeEffectRaw } from "../src/effect/effect-interpreter";
import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
import { applyLegalAction } from "../src";
import { flushPendingLeaves } from "../src/state-based-actions";
import type { ActiveAttack, CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const noLookup = () => [];

function executeEffect(
  options: Parameters<typeof executeEffectRaw>[0]
): GameState {
  return acceptOptionalSteps(
    executeEffectRaw(options),
    options.getCardDefinitionById!
  );
}

const ALICE = "alice";
const BOB = "bob";
const LEAVING_SPIRIT_ID = "alice-leaving-spirit";

const C03 = card("BSAZ01-C03");
const freeUseEffect = C03.effects!.find((e) => e.timing.kind === "game_event")!;
const flashEffect = C03.effects!.find(
  (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
)!;

const fillerDef: CardDefinition = {
  cardNo: "TEST-BSAZ01-C03-FILLER",
  name: "テストフィラー",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const opponentSpiritDef: CardDefinition = {
  cardNo: "TEST-BSAZ01-C03-OPPONENT-SPIRIT",
  name: "テスト相手スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>([
  [fillerDef.cardNo, fillerDef],
  [opponentSpiritDef.cardNo, opponentSpiritDef],
]);
const getDef = (id: string): CardDefinition | undefined =>
  defs.get(id) ?? getCardDefinitionById(id);

function fillerCard(
  instanceId: string,
  zone: "hand" | "set_aside" | "field" | "deck"
) {
  return createCardInstance(fillerDef, {
    instanceId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone,
  });
}

function buildState(): GameState {
  const source = createCardInstance(C03, {
    instanceId: "c03-source",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "in_use",
  });
  // 除外候補: hand 5枚 + set_aside 3枚 + field 5枚 = 自分のカード13枚 (13枚以上枝の検証用、
  // 既存 0/2/3/10 枚テストは candidateIds の先頭 N 件 slice のため影響を受けない)。
  const ownCandidates = [
    ...Array.from({ length: 5 }, (_, i) =>
      fillerCard(`alice-hand-${i}`, "hand")
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      fillerCard(`alice-set-aside-${i}`, "set_aside")
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      fillerCard(`alice-field-${i}`, "field")
    ),
  ];
  // 13枚以上枝の discard(fromZone:"deck", targetHandSize:1) 検証用デッキ (4枚 → 1枚残し3枚破棄)。
  const aliceDeck = Array.from({ length: 4 }, (_, i) =>
    fillerCard(`alice-deck-${i}`, "deck")
  );
  const bobSpiritA = createCardInstance(opponentSpiritDef, {
    instanceId: "bob-spirit-a",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const bobSpiritB = createCardInstance(opponentSpiritDef, {
    instanceId: "bob-spirit-b",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  // 離脱中のスピリット (三者観測 game_event(leave_field) の主語 Y)。flush-gate が保持する
  // 想定に合わせ pendingLeaveKind を残したまま zone:"field" に置く (実プレイでは物理 flush が
  // 本カードのフラッシュ本体解決完了まで延期される、ENGINE-leave-field-free-use-stay-on-field-flush-gate)。
  const leavingSpirit = createCardInstance(opponentSpiritDef, {
    instanceId: LEAVING_SPIRIT_ID,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "recovered",
    pendingLeaveKind: "destroy",
    pendingLeaveCause: "self_effect",
    pendingLeaveChainId: "leaving-spirit-chain",
  });

  const activeAttack: ActiveAttack = {
    attackId: "attack:be-1:1",
    primaryEntityId: "be-1",
    participantEntityIds: ["be-1"],
    groupMode: "single",
    target: { kind: "player", playerId: BOB },
    blockAssignments: [{ participantEntityId: "be-1", blockedByEntityIds: [] }],
    symbolResolutionOrder: ["be-1"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        source,
        ...ownCandidates,
        ...aliceDeck,
        bobSpiritA,
        bobSpiritB,
        leavingSpirit,
      ],
      playerOverrides: [{ handCount: 5, deckCount: aliceDeck.length }, {}],
    }),
    turnNumber: 2,
    activePlayerId: ALICE,
    step: "attack",
    window: "declare_attack",
    pendingLeaveEntities: [
      {
        instanceId: leavingSpirit.instanceId,
        kind: "destroy",
        cause: "self_effect",
        causePlayerId: ALICE,
        chainId: "leaving-spirit-chain",
        deferZoneMoveUntilChainEnd: false,
      },
    ],
    activeAttack,
    battleEntities: [
      {
        entityId: "be-1",
        resolvedBp: 4000,
        attackState: "attacking",
        resolvedSymbols: ["red"],
        memberInstanceIds: ["alice-field-0"],
      },
    ],
  };
}

function resolveWithExcludeCount(
  count: number,
  activePlayerId: string = ALICE
): GameState {
  const state = { ...buildState(), activePlayerId };
  const candidateIds = [
    ...Array.from({ length: 5 }, (_, i) => `alice-hand-${i}`),
    ...Array.from({ length: 3 }, (_, i) => `alice-set-aside-${i}`),
    ...Array.from({ length: 5 }, (_, i) => `alice-field-${i}`),
  ];
  const selected = candidateIds.slice(0, count);
  const resolved = executeEffect({
    chainId: "test:bsaz01-c03-exclude-threshold:229",
    state,
    effect: flashEffect,
    sourceInstanceId: "c03-source",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noLookup,
    targetInstanceIds: selected,
    targetStepId: "exclude-cards",
    targetSelectionResolved: true,
    // 三者観測 game_event(leave_field) の主語 Y。実プレイでは effects[0]
    // (use_magic_without_cost) からこの別 effectIndex(flash 本体) まで
    // magic-system.ts が引き継ぐ (ENGINE-leave-field-free-use-stay-on-field-flush-gate)。
    triggerRelatedInstanceId: LEAVING_SPIRIT_ID,
  });
  return flushPendingLeaves(resolved, getDef);
}

describe("BSAZ01-C03 いつか見た流星", () => {
  it.each([1, 4])(
    "13枚除外しても、デッキ%i枚からの破棄を行わなければ次ターンスキップを得ない",
    (deckCount) => {
      let state = buildState();
      state = {
        ...state,
        cardInstances: state.cardInstances.filter(
          (c) =>
            !c.instanceId.startsWith("alice-deck-") ||
            Number(c.instanceId.slice(-1)) < deckCount
        ),
        players: state.players.map((p) =>
          p.id === ALICE ? { ...p, deckCount } : p
        ),
      };
      const targets = state.cardInstances
        .filter((c) => /^alice-(hand|set-aside|field)-/.test(c.instanceId))
        .map((c) => c.instanceId);
      const pending = executeEffectRaw({
        chainId: "test:bsaz01-c03-exclude-threshold:266",
        state,
        effect: flashEffect,
        sourceInstanceId: "c03-source",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noLookup,
        targetInstanceIds: targets,
        targetStepId: "exclude-cards",
        targetSelectionResolved: true,
        triggerRelatedInstanceId: LEAVING_SPIRIT_ID,
      });
      expect(pending.pendingStepOptionalChoice).not.toBeNull();
      const choice = pending.pendingStepOptionalChoice!;
      const after = applyLegalAction({
        state: pending,
        action: {
          kind: "resolve_pending_step_optional_choice",
          pendingId: choice.pendingId,
          actingPlayerId: ALICE,
          choice: "decline",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noLookup,
      }).state;
      expect(after.pendingTurnSkips ?? []).toHaveLength(0);
      expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(
        deckCount
      );
    }
  );
  it("effects[0] は自分のスピリット/アルティメット離脱時の手札からの無償使用トリガー(cause限定なし)", () => {
    expect(freeUseEffect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      triggerFilter: { category: ["spirit", "ultimate"] },
    });
    expect(freeUseEffect.applicability).toEqual({ zone: "hand" });
    expect(freeUseEffect.executionMode).toBe("optional");
    expect(freeUseEffect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(freeUseEffect.steps).toEqual([
      { action: { kind: "use_magic_without_cost", magicTiming: "flash" } },
    ]);
  });

  it("effects[1] フラッシュ本体は手札/手元/フィールド合算13枚まで除外するstepと閾値ゲートを持つ", () => {
    expect(flashEffect.timing).toEqual({ kind: "activated", mode: "flash" });
    const excludeStep = flashEffect.steps[0]!;
    expect(excludeStep.id).toBe("exclude-cards");
    expect(excludeStep.action).toEqual({
      kind: "remove_from_game",
      target: {
        kind: "filter",
        player: "self",
        zone: ["hand", "set_aside", "field"],
        filter: {},
        count: { min: 0, max: 13 },
      },
    });

    const twoPlusStep = flashEffect.steps.find(
      (s) => s.action.kind === "end_attack_step"
    )!;
    expect(twoPlusStep.stepCondition).toMatchObject({
      kind: "ref_count",
      stepId: "exclude-cards",
      min: 2,
    });
    expect(twoPlusStep.deferTo).toBe("battle_end");

    const tenPlusStep = flashEffect.steps.find(
      (s) => s.action.kind === "destroy"
    )!;
    expect(tenPlusStep.stepCondition).toMatchObject({
      kind: "ref_count",
      stepId: "exclude-cards",
      min: 10,
    });
    expect(tenPlusStep.action).toMatchObject({
      kind: "destroy",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: "all",
      },
    });

    const threePlusStep = flashEffect.steps.find(
      (s) => s.action.kind === "stay_on_field"
    )!;
    expect(threePlusStep.stepCondition).toMatchObject({
      kind: "ref_count",
      stepId: "exclude-cards",
      min: 3,
    });
    expect(threePlusStep.action).toMatchObject({
      kind: "stay_on_field",
      target: { kind: "trigger_related_instance", includePendingLeave: true },
      newExhaustState: "exhausted",
    });

    // 案B: usageLimit を一元消費する gate step (noop+target:{kind:"ref",stepId:"exclude-cards"})。
    const gateStep = flashEffect.steps.find((s) => s.id === "usage-gate-13")!;
    expect(gateStep.stepCondition).toMatchObject({
      kind: "ref_count",
      stepId: "exclude-cards",
      min: 13,
    });
    expect(gateStep.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(gateStep.action).toEqual({
      kind: "noop",
      target: { kind: "ref", stepId: "exclude-cards" },
    });

    const thirteenPlusSteps = flashEffect.steps.filter(
      (s) =>
        s.action.kind === "end_turn" ||
        s.action.kind === "skip_next_turn" ||
        (s.action.kind === "discard" && s.action.fromZone === "deck")
    );
    expect(thirteenPlusSteps).toHaveLength(3);
    for (const step of thirteenPlusSteps) {
      // gate の成否だけを見る (usageLimit は step 個別に持たず gate 1本へ集約、
      // ユーザー指摘の「分裂使用状態」防止)。
      expect(step.stepCondition).toEqual({
        kind: "ref_succeeded",
        stepId: "usage-gate-13",
      });
      expect(step.usageLimit).toBeUndefined();
    }
    expect(thirteenPlusSteps.map((s) => s.action.kind)).toEqual([
      "end_turn",
      "discard",
      "skip_next_turn",
    ]);
    // 「相手のターンを終了する」前提: end_turn だけが turn_player:opponent を要求する
    // (adversarial verifier round1 lens1 指摘の是正)。discard/skip_next_turn は
    // ターン終了の成否と独立し、後段の任意コスト支払いを選べる。
    const endTurnStep = thirteenPlusSteps.find(
      (s) => s.action.kind === "end_turn"
    )!;
    expect(endTurnStep.condition).toEqual([
      { kind: "turn_player", player: "opponent" },
    ]);
    const discardStep = thirteenPlusSteps.find(
      (s) => s.action.kind === "discard"
    )!;
    expect(discardStep.condition).toBeUndefined();
    expect(discardStep.action).toMatchObject({
      kind: "discard",
      player: "self",
      fromZone: "deck",
      targetHandSize: 1,
    });
    const skipStep = thirteenPlusSteps.find(
      (s) => s.action.kind === "skip_next_turn"
    )!;
    expect(skipStep.condition).toBeUndefined();
    expect(skipStep.action).toEqual({
      kind: "skip_next_turn",
      player: "opponent",
    });

    // deferTo:"battle_end" step は即時実行が必要な13枚以上枝より後ろ (配列末尾) に置く。
    expect(flashEffect.steps[flashEffect.steps.length - 1]).toBe(twoPlusStep);
  });

  it("effects は stub 無しに揃っている (13枚以上も effects[1] 内で解消済み)", () => {
    expect(C03.effects).toHaveLength(2);
    expect(freeUseEffect.stub).toBeUndefined();
    expect(flashEffect.stub).toBeUndefined();
  });

  it("[board] 除外0枚 (2枚未満): 段階効果は一切発揮されない", () => {
    const after = resolveWithExcludeCount(0);
    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === BOB && c.zone === "field"
      )
    ).toHaveLength(2);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "removed_from_game"
      )
    ).toHaveLength(0);
    // 3枚未満: stay_on_field 不発。離脱スピリットは通常どおり flush されトラッシュへ。
    const leavingAfter = after.cardInstances.find(
      (c) => c.instanceId === LEAVING_SPIRIT_ID
    )!;
    expect(leavingAfter.zone).toBe("trash");
    expect(leavingAfter.pendingLeaveKind).toBeNull();
  });

  it("[board] 除外3枚: 離脱スピリットが疲労状態でフィールドに残る (stay_on_field(trigger_related_instance))", () => {
    const after = resolveWithExcludeCount(3);
    const leavingAfter = after.cardInstances.find(
      (c) => c.instanceId === LEAVING_SPIRIT_ID
    )!;
    expect(leavingAfter.zone).toBe("field");
    expect(leavingAfter.exhaustState).toBe("exhausted");
    expect(leavingAfter.pendingLeaveKind).toBeNull();
    expect(
      after.pendingLeaveEntities.some(
        (pl) => pl.instanceId === LEAVING_SPIRIT_ID
      )
    ).toBe(false);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "removed_from_game"
      )
    ).toHaveLength(3);
    // EDH-0002: 手札から除外した3枚は、実カードのゾーン移動と handCount を同時に更新する。
    expect(after.players.find((player) => player.id === ALICE)?.handCount).toBe(
      2
    );
  });

  it("[board] 除外2枚: このバトル終了時アタックステップ終了が予約されるが、相手は破壊されない", () => {
    const after = resolveWithExcludeCount(2);
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
    expect(after.pendingBattleEndDeferrals[0]).toEqual(
      expect.objectContaining({
        attackId: "attack:be-1:1",
        sourceInstanceId: "c03-source",
      })
    );
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === BOB && c.zone === "field"
      )
    ).toHaveLength(2);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "removed_from_game"
      )
    ).toHaveLength(2);
  });

  it("[board] 除外10枚: バトル終了時アタックステップ終了の予約に加え、相手のスピリット/アルティメットすべてを破壊する", () => {
    const after = resolveWithExcludeCount(10);
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === BOB && c.zone === "field"
      )
    ).toHaveLength(0);
    expect(
      after.cardInstances
        .filter(
          (c) =>
            c.instanceId === "bob-spirit-a" || c.instanceId === "bob-spirit-b"
        )
        .every((c) => c.zone === "trash")
    ).toBe(true);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "removed_from_game"
      )
    ).toHaveLength(10);
    // 10枚以上は3枚以上枝も同時に満たすため、離脱スピリットも疲労状態で残る。
    // 除外対象カード自身 (10枚) には影響しない (別 instance)。
    const leavingAfter = after.cardInstances.find(
      (c) => c.instanceId === LEAVING_SPIRIT_ID
    )!;
    expect(leavingAfter.zone).toBe("field");
    expect(leavingAfter.exhaustState).toBe("exhausted");
  });

  it("[board] 除外13枚 (相手のターン中): 相手のターンを飛ばす予約をし、自分のデッキを1枚になるように破棄する", () => {
    // condition:[{kind:"turn_player", player:"opponent"}] が要求する前提 (現在進行中の
    // ターンが相手=BOB) を満たす。実プレイでは本カードが相手アタックステップ中の
    // フラッシュ即応として使われる主要ケースに相当。
    const after = resolveWithExcludeCount(13, BOB);
    // 「その後、自分のデッキを1枚になるように破棄する」: discard(fromZone:"deck",
    // targetHandSize:1) で4枚→1枚に (3枚がトラッシュへ)。
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "deck"
      )
    ).toHaveLength(1);
    expect(
      after.cardInstances.filter(
        (c) =>
          c.ownerPlayerId === ALICE &&
          c.zone === "trash" &&
          c.instanceId.startsWith("alice-deck-")
      )
    ).toHaveLength(3);
    // 「相手は次のターンを行えない」: skip_next_turn(player:"opponent") が
    // pendingTurnSkips へ BOB を積む (新設 ENGINE-opponent-turn-skip primitive)。
    expect(after.pendingTurnSkips).toEqual([BOB]);
    // 13枚以上は10枚以上/3枚以上/2枚以上も同時に満たすため、それらの効果も発揮される。
    expect(
      after.cardInstances
        .filter(
          (c) =>
            c.instanceId === "bob-spirit-a" || c.instanceId === "bob-spirit-b"
        )
        .every((c) => c.zone === "trash")
    ).toBe(true);
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
  });

  it("[board] 除外13枚 (自分のターン中): end_turn不発でも任意コストを支払い次ターンを飛ばせる", () => {
    // 裁定 (needs-ruling.jsonl BSAZ01-C03、案B採用): 「その後」は因果依存ではなく独立した
    // 段階効果として読む。「相手のターンを終了する」の適用対象が存在しない (現在進行中の
    // ターンが自分) ときは end_turn だけ turn_player:opponent 条件で不発になるが、
    // 後段はターン終了の成否と独立。テストヘルパーで任意コストを受諾する。
    const after = resolveWithExcludeCount(13, ALICE);
    // end_turn は不発 (自分のターンを誤って終了させない)。
    expect(after.log.some((l) => l.startsWith("effect:end_turn:"))).toBe(false);
    // 任意コスト支払いが成立し、次ターンを飛ばす。
    expect(after.pendingTurnSkips).toEqual([BOB]);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "deck"
      )
    ).toHaveLength(1);
    expect(
      after.cardInstances.filter(
        (c) =>
          c.ownerPlayerId === ALICE &&
          c.zone === "trash" &&
          c.instanceId.startsWith("alice-deck-")
      )
    ).toHaveLength(3);
    // 10枚以上/3枚以上/2枚以上は turn_player 条件を持たないため、同時にこれらの閾値を
    // 満たしても引き続き発揮される (13枚以上枝の end_turn 不発とは独立)。
    expect(
      after.cardInstances
        .filter(
          (c) =>
            c.instanceId === "bob-spirit-a" || c.instanceId === "bob-spirit-b"
        )
        .every((c) => c.zone === "trash")
    ).toBe(true);
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
  });

  it("[usage] usageLimitはgate 1本に集約され、自分ターン活性化でdiscard/skip_next_turn消費後、後の相手ターン活性化でend_turnだけ後出しできない", () => {
    // ユーザー指摘 (2026-08-04): 3 step 独立 usageLimit のままだと、自分ターン活性化で
    // discard/skip_next_turn だけ消費され、後の相手ターン活性化で end_turn だけ発揮される
    // 分裂使用状態が起こり得る。usage-gate-13 に usageLimit を一元化したことで、
    // 一度でも13枚以上除外して発揮した時点でゲーム中1回を使い切ることを検証する。
    const round1State = { ...buildState(), activePlayerId: ALICE };
    const round1Ids = [
      ...Array.from({ length: 5 }, (_, i) => `alice-hand-${i}`),
      ...Array.from({ length: 3 }, (_, i) => `alice-set-aside-${i}`),
      ...Array.from({ length: 5 }, (_, i) => `alice-field-${i}`),
    ];
    const afterRound1 = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsaz01-c03-exclude-threshold:626",
        state: round1State,
        effect: flashEffect,
        sourceInstanceId: "c03-source",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noLookup,
        targetInstanceIds: round1Ids,
        targetStepId: "exclude-cards",
        targetSelectionResolved: true,
        triggerRelatedInstanceId: LEAVING_SPIRIT_ID,
      }),
      getDef
    );
    expect(afterRound1.pendingTurnSkips).toEqual([BOB]);
    expect(afterRound1.log.some((l) => l.startsWith("effect:end_turn:"))).toBe(
      false
    );

    // Round2: 相手ターンで新たに13枚除外できる候補があっても、gate の usageLimit は
    // 既に消費済みなので end_turn は後出しできない (discard/skip_next_turn も再発揮しない)。
    const round2Candidates = [
      ...Array.from({ length: 5 }, (_, i) =>
        fillerCard(`alice-hand2-${i}`, "hand")
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        fillerCard(`alice-set-aside2-${i}`, "set_aside")
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        fillerCard(`alice-field2-${i}`, "field")
      ),
    ];
    const round2Ids = round2Candidates.map((c) => c.instanceId);
    const round2State = {
      ...afterRound1,
      activePlayerId: BOB,
      cardInstances: [...afterRound1.cardInstances, ...round2Candidates],
    };
    const afterRound2 = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsaz01-c03-exclude-threshold:665",
        state: round2State,
        effect: flashEffect,
        sourceInstanceId: "c03-source",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noLookup,
        targetInstanceIds: round2Ids,
        targetStepId: "exclude-cards",
        targetSelectionResolved: true,
        triggerRelatedInstanceId: LEAVING_SPIRIT_ID,
      }),
      getDef
    );
    // end_turn は usageLimit 消費済みのため後出しできない。
    expect(afterRound2.log.some((l) => l.startsWith("effect:end_turn:"))).toBe(
      false
    );
    // discard/skip_next_turn も同じ gate 経由のため再発揮されない (round1 のまま変化しない)。
    expect(afterRound2.pendingTurnSkips).toEqual([BOB]);
    expect(
      afterRound2.cardInstances.filter(
        (c) => c.ownerPlayerId === ALICE && c.zone === "deck"
      )
    ).toHaveLength(1);
  });
});
