/**
 * ENGINE-leave-field-free-use-stay-on-field-flush-gate
 *
 * BSAZ01-C03「いつか見た流星」は「無償使用トリガー effect (effects[0]、
 * steps:[use_magic_without_cost] のみ)」と「除外/閾値分岐フラッシュ本体
 * (effects[1]、別 effectIndex、mode:"flash")」が分かれている。3枚以上除外の
 * stay_on_field(trigger_related_instance) はフラッシュ本体側にあり、
 * 三者観測 game_event(leave_field) の主語 Y (離脱したスピリット/アルティメット) を
 * 別 effectIndex の発揮解決まで引き継ぐ必要がある。
 *
 * このファイルは e2e (queuePendingLeave → collectAndQueueTriggerReactions →
 * declare_private_triggered_effect → resolve_pending_triggered_effect →
 * pass_stack → resolve_pending_effect_target) で以下を検証する:
 * 1) flush-gate: 登録された private declaration が
 *    registeredLeaveFieldStayOnFieldSourceKeys を持ち、離脱スピリットの
 *    物理 flush が本カードの解決完了まで延期される
 *    (getRegisteredLeaveFieldStayOnFieldSourceKeys の cross-effectIndex 拡張)。
 * 2) triggerRelatedInstanceId 引き継ぎ: 別 effectIndex (flash 本体) の
 *    stay_on_field(trigger_related_instance) が離脱スピリット自身を正しく解決し、
 *    疲労状態でフィールドに残す (magic-system.ts の
 *    ActiveStack.magicTriggerRelatedInstanceId(s) 経由の伝播)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { flushPendingLeaves } from "../src/state-based-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { applyLegalAction, getLegalActions } from "../src";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "alice";
const BOB = "bob";

function makeDestroySourceDef(): CardDefinition {
  return {
    cardNo: "TEST-FLUSH-GATE-DESTROY-SRC",
    name: "テスト破壊発生源",
    printedCategory: "ultimate",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeLeavingSpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-FLUSH-GATE-LEAVING-SPIRIT",
    name: "テスト離脱スピリット",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("BSAZ01-C03 いつか見た流星 (e2e): 三者観測 leave_field → 無償使用 → 別effectIndexのstay_on_field", () => {
  it("離脱スピリットが3枚以上除外の閾値を満たすと、flush-gateで物理flushが延期され、疲労状態でフィールドに残る", () => {
    const C03 = card("BSAZ01-C03");
    const destroySourceDef = makeDestroySourceDef();
    const leavingSpiritDef = makeLeavingSpiritDef();

    const c03Hand = createCardInstance(C03, {
      instanceId: "c03-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const destroySource = createCardInstance(destroySourceDef, {
      instanceId: "destroy-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const leavingSpirit = createCardInstance(leavingSpiritDef, {
      instanceId: "leaving-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 除外用フィラー (自分のフィールド、3枚選んで3枚以上の閾値を満たす)。
    // field ゾーンを使うのは本テストの検証対象 (trigger_related_instance 引き継ぎ) を
    // フィラーのゾーン選択から独立させるため。hand/set_aside ゾーンの除外候補は
    // ENGINE-free-magic-use-target-selection-nonfield-candidate-zones 解消により
    // synthetic ActiveStack 経路でも fizzle しなくなったことを
    // engine-free-magic-use-target-selection-nonfield-candidate-zones.test.ts で検証済み。
    const fillerDef: CardDefinition = {
      cardNo: "TEST-FLUSH-GATE-FILLER",
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
    const fillers = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(fillerDef, {
        instanceId: `filler-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      })
    );

    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [c03Hand, destroySource, leavingSpirit, ...fillers],
    });
    const getDef = (id: string): CardDefinition | undefined =>
      id === C03.cardNo
        ? C03
        : id === destroySourceDef.cardNo
          ? destroySourceDef
          : id === leavingSpiritDef.cardNo
            ? leavingSpiritDef
            : id === fillerDef.cardNo
              ? fillerDef
              : undefined;
    const triggerLookup = buildTriggeredEffectLookup([C03]);
    const magicLookup = buildMagicLookup([C03]);
    const effectLookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    };

    // 相手の効果 (destroy-source) で自分のスピリットが破壊 → 離脱待機。
    const afterLeave = queuePendingLeave({
      state: before,
      instanceId: leavingSpirit.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:flush-gate",
      causePlayerId: BOB,
      causedByEffectSourceInstanceId: destroySource.instanceId,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterLeave,
      source: "action_resolution",
      chainId: "test-chain:flush-gate",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = queued.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === c03Hand.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("destroy");
    // flush-gate: cross-effectIndex 拡張により、無償使用トリガー effect
    // (use_magic_without_cost のみ) でも sibling flash effect の
    // stay_on_field(trigger_related_instance) を検知して登録される。
    expect(
      declaration!.registeredLeaveFieldStayOnFieldSourceKeys?.length
    ).toBeGreaterThan(0);

    // flush-gate が働いていれば、この時点で SBA を回しても離脱スピリットは
    // まだフィールド上 (pendingLeave 未 flush) のまま。
    const stillPending = flushPendingLeaves(queued, getDef);
    const leavingBeforeResolve = stillPending.cardInstances.find(
      (c) => c.instanceId === leavingSpirit.instanceId
    )!;
    expect(leavingBeforeResolve.zone).toBe("field");
    expect(leavingBeforeResolve.pendingLeaveKind).not.toBeNull();

    let ready = queued;
    while (ready.pendingBurstChecks.length > 0) {
      const actingPlayerId = ready.pendingBurstChecks[0]!.actingPlayerId;
      const burstCheckAction = getLegalActions({
        state: ready,
        actingPlayerId,
        ...effectLookups,
      }).find(
        (a) =>
          a.kind === "resolve_pending_burst_check" ||
          a.kind === "decline_pending_burst_check"
      );
      expect(burstCheckAction).toBeDefined();
      ready = applyLegalAction({
        state: ready,
        action: burstCheckAction!,
        ...effectLookups,
      }).state;
    }

    // 誘発を宣言 → 解決 (P3-34: 解決前に必ずスタック窓が開く)。
    const declareAction = getLegalActions({
      state: ready,
      actingPlayerId: ALICE,
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "declare_private_triggered_effect" &&
        a.sourceInstanceId === c03Hand.instanceId
    );
    expect(declareAction).toBeDefined();
    const declared = applyLegalAction({
      state: ready,
      action: declareAction!,
      ...effectLookups,
    }).state;

    const resolveAction = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === c03Hand.instanceId
    );
    expect(resolveAction).toBeDefined();
    const declaredOnStack = applyLegalAction({
      state: declared,
      action: resolveAction!,
      ...effectLookups,
    }).state;

    let resolved = declaredOnStack;
    for (let i = 0; i < 8 && resolved.stackWindow !== null; i++) {
      const priority = resolved.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: resolved,
        actingPlayerId: priority,
        ...effectLookups,
      }).find((a) => a.kind === "pass_stack");
      if (!pass) break;
      resolved = applyLegalAction({
        state: resolved,
        action: pass,
        ...effectLookups,
      }).state;
    }

    // exclude-cards の対象選択 (0..13 任意選択)。3枚のフィラーを選んで3枚以上の閾値を満たす
    // (候補プールには離脱中の leaving-spirit 自身 (zone:"field"、自分のカード) も含まれうるが、
    // このテストでは意図的にフィラー3枚だけを選ぶ)。
    expect(resolved.pendingEffectTargetSelection).not.toBeNull();
    const pending = resolved.pendingEffectTargetSelection!;
    const candidateIdSet = new Set(pending.candidateInstanceIds);
    expect(fillers.every((f) => candidateIdSet.has(f.instanceId))).toBe(true);

    const targetAction = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      ...effectLookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    const final = applyLegalAction({
      state: resolved,
      action: targetAction!,
      targetInstanceIds: fillers.map((f) => f.instanceId),
      ...effectLookups,
    }).state;

    // 無償使用: 手札から使用 → トラッシュへ。
    expect(
      final.cardInstances.find((c) => c.instanceId === c03Hand.instanceId)?.zone
    ).toBe("trash");
    expect(final.log.some((l) => l.includes("magic:without-cost:"))).toBe(true);
    // 除外された3枚のフィラーは removed_from_game へ。
    expect(
      fillers.every(
        (f) =>
          final.cardInstances.find((c) => c.instanceId === f.instanceId)
            ?.zone === "removed_from_game"
      )
    ).toBe(true);

    // triggerRelatedInstanceId 引き継ぎ: 離脱スピリットが疲労状態でフィールドに残る
    // (flush されずに stay_on_field(trigger_related_instance) が正しい対象を解決)。
    const leavingAfter = final.cardInstances.find(
      (c) => c.instanceId === leavingSpirit.instanceId
    )!;
    expect(leavingAfter.zone).toBe("field");
    expect(leavingAfter.exhaustState).toBe("exhausted");
    expect(leavingAfter.pendingLeaveKind).toBeNull();
    expect(
      final.pendingLeaveEntities.some(
        (pl) => pl.instanceId === leavingSpirit.instanceId
      )
    ).toBe(false);
  });
});
