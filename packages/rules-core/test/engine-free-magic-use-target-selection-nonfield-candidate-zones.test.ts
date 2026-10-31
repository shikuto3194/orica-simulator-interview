/**
 * ENGINE-free-magic-use-target-selection-nonfield-candidate-zones
 *
 * use_magic_without_cost (無償使用) が組む synthetic ActiveStack は、対象選択が
 * 必要な場合に resolveDeferredStackForFreeMagicUse (種別非依存の
 * resolveDeferredStackAction) 経由で legality re-check (getDeferredMagicMissingTargets)
 * を通る。この re-check は activeStack.candidateTargetZones を参照するが、修正前は
 * synthetic ActiveStack 側にこのフィールドが一切設定されず、常定 DEFAULT_CANDIDATE_TARGET_ZONES
 * (=["field"]) にフォールバックしていた。BSAZ01-C03「いつか見た流星」effects[1] の
 * exclude-cards ステップは zone:["hand","set_aside","field"] を候補に持つため、
 * hand/set_aside から除外対象を選ぶと対象選択自体は候補提示されるのに legality re-check で
 * 「missing target」判定され magic:effect-fizzled になっていた
 * (engine-leave-field-free-use-stay-on-field-flush-gate.test.ts はこの既知ギャップを
 * field ゾーンのフィラーで回避していた)。
 *
 * magic-system.ts の syntheticStack 構築が getRegisteredMagicActions 経由で
 * magicTiming に一致する RegisteredMagicAction.candidateTargetZones を引き継ぐよう
 * 修正した。本テストは手札のフィラーを exclude 対象に選び、fizzle せず正しく
 * removed_from_game へ移動することを確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
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
    cardNo: "TEST-NONFIELD-ZONE-DESTROY-SRC",
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
    cardNo: "TEST-NONFIELD-ZONE-LEAVING-SPIRIT",
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

describe("BSAZ01-C03 いつか見た流星 (e2e): 無償使用の synthetic ActiveStack が hand/set_aside 対象で fizzle しない", () => {
  it("除外対象を手札のフィラーから選んでも missing-target で fizzle せず removed_from_game へ移動する", () => {
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
    const fillerDef: CardDefinition = {
      cardNo: "TEST-NONFIELD-ZONE-FILLER",
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
    // 修正前は fizzle 回避のため field ゾーンのフィラーが必須だった箇所を、
    // 本テストでは意図的に hand ゾーンにして非field候補ゾーンの解決を検証する。
    const fillers = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(fillerDef, {
        instanceId: `filler-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
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

    const afterLeave = queuePendingLeave({
      state: before,
      instanceId: leavingSpirit.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:nonfield-zone",
      causePlayerId: BOB,
      causedByEffectSourceInstanceId: destroySource.instanceId,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterLeave,
      source: "action_resolution",
      chainId: "test-chain:nonfield-zone",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });

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

    // 修正前はここで synthetic ActiveStack.candidateTargetZones が未設定のまま
    // DEFAULT_CANDIDATE_TARGET_ZONES(=["field"]) にフォールバックし、hand ゾーンの
    // フィラーが候補から漏れて legality re-check が missing-target と判定していた。
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

    // fizzle していれば magic:effect-fizzled ログが残り、除外は起きない。
    expect(final.log.some((l) => l.includes("effect-fizzled"))).toBe(false);
    expect(
      final.cardInstances.find((c) => c.instanceId === c03Hand.instanceId)?.zone
    ).toBe("trash");
    expect(
      fillers.every(
        (f) =>
          final.cardInstances.find((c) => c.instanceId === f.instanceId)
            ?.zone === "removed_from_game"
      )
    ).toBe(true);
  });
});
