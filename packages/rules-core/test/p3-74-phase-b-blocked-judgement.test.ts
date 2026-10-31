/**
 * P3-74 Phase B: cannot_leave_field 耐性で阻止された対象も pendingLeave に
 * `blockedByResistance:true` で積み、内包 conditional_result から破壊判定を参照可能にする。
 *
 * Q16/Q17/Q18 準拠:
 *   Q16: 美鈴の「離れない」は破壊効果を「受ける」(破壊判定は成立、フィールドに残る)。
 *   Q17: 内包 (悟空型) 「破壊する。破壊したとき、X する」は美鈴のみ破壊しても X 発動。
 *   Q18: 別効果 triggered card_destroyed は美鈴 (常時) 残留時には発火しない。
 *
 * 検証項目:
 *   1. executeDestroy(blocked) で pendingLeave に blockedByResistance:true で積まれる。
 *   2. card.pendingLeaveKind は触られない (フィールドに残る)。
 *   3. didNonCardActionChangeState("destroy") は length 増加で true → stepSucceeded=true。
 *   4. flushPendingLeaves で blocked entries が zone 移動なしで除去される。
 *   5. collectAndQueueTriggerReactions で card_destroyed event が emit されない。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  collectGameStateInvariantIssues,
  executeDestroy,
  executeEffectResistance,
  getLegalActions,
  applyLegalAction,
  runStateBasedActions,
} from "../src";
import { flushPendingLeaves } from "../src/state-based-actions";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string, tribes: string[]): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: tribes.join("・"),
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const 美鈴Def = spiritDef("KMS-1", ["幻想", "紅魔"]);
const SBA消滅誘発Def: CardDefinition = {
  ...spiritDef("SBA-VANISH-1", ["テスト"]),
  effects: [
    {
      timing: { kind: "game_event", event: "leave_field", player: "self" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};

function getCardDef(id: string): CardDefinition | undefined {
  if (id === "KMS-1") return 美鈴Def;
  if (id === "SBA-VANISH-1") return SBA消滅誘発Def;
  return undefined;
}

function makeState(cards: CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: cards,
  };
}

function fieldSpirit(
  instanceId: string,
  defId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(getCardDef(defId)!, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

/** 美鈴型: 常時「離れない」効果を持つスピリット (alice 側) */
function setupCannotLeaveFieldSpirit(): GameState {
  const target = fieldSpirit("s1", "KMS-1", ALICE);
  let state = makeState([target]);
  state = executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_leave_field",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    "s1",
    getCardDef
  );
  return state;
}

describe("P3-74 Phase B: 阻止された対象も pendingLeave に blockedByResistance で積む (Q16/Q17)", () => {
  it("executeDestroy(blocked): pendingLeaveEntities に blockedByResistance:true で積まれる", () => {
    const state = setupCannotLeaveFieldSpirit();
    expect(state.pendingLeaveEntities.length).toBe(0);

    const after = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined, // suppressDestroyedEffects 無し → 阻止される
      "none"
    );

    expect(after.pendingLeaveEntities.length).toBe(1);
    const entry = after.pendingLeaveEntities[0]!;
    expect(entry.instanceId).toBe("s1");
    expect(entry.kind).toBe("destroy");
    expect(entry.blockedByResistance).toBe(true);
  });

  it("executeDestroy(blocked): card.pendingLeaveKind は null のまま (フィールドに残る)", () => {
    const state = setupCannotLeaveFieldSpirit();

    const after = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "none"
    );

    const card = after.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(card.pendingLeaveKind).toBeNull();
    expect(card.pendingLeaveChainId).toBeNull();
    expect(card.zone).toBe("field");
  });

  it("SBA のコア不足消滅が阻止されたときも、marker と card pending state を非対称にしない", () => {
    const target = {
      ...fieldSpirit("sba-blocked", "KMS-1", ALICE),
      normalCoreCount: 0,
    };
    let state = makeState([target]);
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_leave_field",
        source: "all",
        duration: { scope: "permanent" },
      },
      "sba-blocked",
      getCardDef
    );

    const queued = runStateBasedActions(state, getCardDef).state;
    // 同じ SBA が marker flush 前に再評価されても、blocked marker は通常の leave と
    // 同一視されない。ここで card 側を pending に戻すと、後の marker flush で
    // card_pending_leave_without_entity になる。
    const repeated = runStateBasedActions(queued, getCardDef).state;
    const card = repeated.cardInstances.find(
      (instance) => instance.instanceId === "sba-blocked"
    )!;
    expect(card.zone).toBe("field");
    expect(card.pendingLeaveKind).toBeNull();
    expect(card.pendingLeaveCause).toBeNull();
    expect(card.pendingLeaveChainId).toBeNull();
    expect(repeated.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "sba-blocked",
        kind: "vanish",
        blockedByResistance: true,
      })
    );
    expect(collectGameStateInvariantIssues(repeated)).toEqual([]);

    // blocked marker と card 側の leave が同居する hybrid は、flush が marker だけを
    // 消して card_pending_leave_without_entity を残す壊れた状態なので検出する。
    const malformedHybrid = {
      ...repeated,
      cardInstances: repeated.cardInstances.map((instance) =>
        instance.instanceId === "sba-blocked"
          ? {
              ...instance,
              pendingLeaveKind: "vanish" as const,
              pendingLeaveCause: "state_based_action" as const,
              pendingLeaveChainId: "malformed-blocked-marker",
            }
          : instance
      ),
    };
    expect(collectGameStateInvariantIssues(malformedHybrid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "pending_leave_card_state_mismatch",
        }),
      ])
    );

    // 耐性の失効後は、同じ marker を通常の pending leave に置換する。
    const afterResistanceExpiry = runStateBasedActions(
      { ...repeated, activeContinuousEffects: [] },
      getCardDef
    ).state;
    expect(
      afterResistanceExpiry.cardInstances.find(
        (instance) => instance.instanceId === "sba-blocked"
      )?.pendingLeaveKind
    ).toBe("vanish");
    const resumedLeave = afterResistanceExpiry.pendingLeaveEntities.find(
      (pending) => pending.instanceId === "sba-blocked"
    );
    expect(resumedLeave).toMatchObject({
      instanceId: "sba-blocked",
      kind: "vanish",
    });
    expect(resumedLeave).not.toHaveProperty("blockedByResistance");

    const flushed = flushPendingLeaves(afterResistanceExpiry, getCardDef);
    expect(
      flushed.pendingLeaveEntities.some(
        (pending) => pending.instanceId === "sba-blocked"
      )
    ).toBe(false);
    expect(
      flushed.cardInstances.find(
        (instance) => instance.instanceId === "sba-blocked"
      )
    ).toMatchObject({
      zone: "trash",
      pendingLeaveKind: null,
      pendingLeaveCause: null,
      pendingLeaveChainId: null,
    });
    expect(collectGameStateInvariantIssues(flushed)).toEqual([]);
  });

  it("耐性失効で marker が実消滅待機に変わると、flush 前に消滅誘発を収集する", () => {
    const target = {
      ...fieldSpirit("sba-vanish-trigger", "KMS-1", ALICE),
      normalCoreCount: 0,
    };
    const observer = fieldSpirit("sba-vanish-observer", "SBA-VANISH-1", ALICE);
    let state = makeState([target, observer]);
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_leave_field",
        source: "all",
        duration: { scope: "permanent" },
      },
      "sba-vanish-trigger",
      getCardDef
    );

    const blockedMarker = runStateBasedActions(state, getCardDef).state;
    const physicalPending = runStateBasedActions(
      { ...blockedMarker, activeContinuousEffects: [] },
      getCardDef
    ).state;
    const triggeredLookup = buildTriggeredEffectLookup([SBA消滅誘発Def]);
    const legalActionLookups = {
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredHandCardEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: () => [],
    } as const;
    const collected = collectAndQueueTriggerReactions({
      beforeState: blockedMarker,
      afterState: physicalPending,
      source: "action_resolution",
      chainId: "sba-vanish-trigger",
      ...legalActionLookups,
    });

    expect(collected.pendingTriggeredEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "vanish",
          relatedInstanceId: "sba-vanish-trigger",
          preFlushLeaveEvent: true,
          registeredLeaveFieldPreFlushSourceKeys: expect.arrayContaining([
            "sba-vanish-observer#0",
          ]),
        }),
      ])
    );
    expect(
      collected.cardInstances.find(
        (instance) => instance.instanceId === "sba-vanish-trigger"
      )?.zone
    ).toBe("field");

    // production と同じ legal-action 経路で pre-flush 誘発を解決してから実移動する。
    let settled = collected;
    for (let guard = 0; guard < 8; guard++) {
      let progressed = false;
      for (const playerId of [ALICE, BOB]) {
        const action = getLegalActions({
          state: settled,
          actingPlayerId: playerId,
          ...legalActionLookups,
        }).find(
          (candidate) =>
            candidate.kind === "resolve_pending_triggered_effect" ||
            candidate.kind === "select_pending_to_resolve" ||
            candidate.kind === "pass_stack"
        );
        if (!action) continue;
        settled = applyLegalAction({
          state: settled,
          action,
          ...legalActionLookups,
        }).state;
        progressed = true;
        break;
      }
      if (!progressed) break;
    }

    const flushed = flushPendingLeaves(settled, getCardDef);
    expect(
      flushed.cardInstances.find(
        (instance) => instance.instanceId === "sba-vanish-trigger"
      )?.zone
    ).toBe("trash");
  });

  it("Q17 step result 経路: pendingLeaveEntities.length 増加 → didNonCardActionChangeState=true", () => {
    const state = setupCannotLeaveFieldSpirit();
    const before = state.pendingLeaveEntities.length;

    const after = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "none"
    );
    const post = after.pendingLeaveEntities.length;

    // didNonCardActionChangeState("destroy") の判定式:
    //   pre.pendingLeaveEntities.length !== post.length
    // これが true → stepSucceeded=true → conditional_result 連結ステップが実行される (Q17)
    expect(before !== post).toBe(true);
  });

  it("flushPendingLeaves: blockedByResistance エントリは zone 移動なしで除去される", () => {
    const state = setupCannotLeaveFieldSpirit();

    const queued = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "none"
    );
    expect(queued.pendingLeaveEntities.length).toBe(1);

    const flushed = flushPendingLeaves(queued, getCardDef);

    // entries は除去
    expect(flushed.pendingLeaveEntities.length).toBe(0);
    // card は field に残る
    const card = flushed.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(card.zone).toBe("field");
    expect(card.pendingLeaveKind).toBeNull();
    // 解決ログが残る
    expect(
      flushed.log.some((l) =>
        l.startsWith("pending-leave-blocked-flushed:destroy:s1")
      )
    ).toBe(true);
  });

  it("Q18 維持: collectAndQueueTriggerReactions で blockedByResistance には card_destroyed event を emit しない", () => {
    const state = setupCannotLeaveFieldSpirit();

    const queued = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "none"
    );

    const result = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: queued,
      source: "action_resolution",
      chainId: "test-chain",
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    // pendingTriggeredEffects に destroy event が一切積まれていないこと
    const destroyEvents = result.pendingTriggeredEffects.filter(
      (eff) => eff.relatedInstanceId === "s1"
    );
    expect(destroyEvents.length).toBe(0);
  });

  it("Q19 貫通経路: suppressDestroyedEffects 付きは blockedByResistance ではなく通常の destroy 待機", () => {
    const state = setupCannotLeaveFieldSpirit();

    const after = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only", // Phase A: cannot_leave_field を貫通
      "none"
    );

    expect(after.pendingLeaveEntities.length).toBe(1);
    const entry = after.pendingLeaveEntities[0]!;
    expect(entry.blockedByResistance).toBeUndefined();
    expect(entry.suppressDestroyedEffects).toBe("destroyed_only");

    const card = after.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(card.pendingLeaveKind).toBe("destroy");
  });

  it("Q19 貫通経路 + flush: 美鈴が実際に trash へ移動", () => {
    const state = setupCannotLeaveFieldSpirit();

    const queued = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    const flushed = flushPendingLeaves(queued, getCardDef);

    const card = flushed.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(card.zone).toBe("trash");
  });
});

// ============================================================
// エンドツーエンド: executeEffect 経由で内包 conditional_result の動作を検証
// ============================================================

const レミリアDef = spiritDef("REM-1", ["幻想", "紅魔"]);
const 悟空Def = spiritDef("GOK-1", ["七龍神"]);

function getCardDefE2E(id: string): CardDefinition | undefined {
  if (id === "KMS-1") return 美鈴Def;
  if (id === "REM-1") return レミリアDef;
  if (id === "GOK-1") return 悟空Def;
  return undefined;
}

function fieldSpiritE2E(
  instanceId: string,
  defId: string,
  controllerPlayerId: string,
  exhaustState: "recovered" | "exhausted" = "recovered"
): CardInstance {
  return {
    ...createCardInstance(getCardDefE2E(defId)!, {
      instanceId,
      ownerPlayerId: controllerPlayerId,
      controllerPlayerId,
      zone: "field",
      normalCoreCount: 1,
    }),
    exhaustState,
  };
}

describe("P3-74 Phase B E2E: Q17 内包 conditional_result が破壊判定を参照", () => {
  it("レミリア型 (内包 + suppressDestroyedEffects): 美鈴 trash + レミリア recover", () => {
    // 美鈴 (alice 側, cannot_leave_field 常時) + レミリア (bob 側, アタック後で exhausted)
    const 美鈴 = fieldSpiritE2E("misuzu-1", "KMS-1", ALICE);
    const レミリア = fieldSpiritE2E("rem-1", "REM-1", BOB, "exhausted");
    let state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [美鈴, レミリア],
    };
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_leave_field",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "misuzu-1",
      getCardDefE2E
    );

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"], maxBp: 20000 },
            },
            suppressDestroyedEffects: "destroyed_only",
          },
        },
        {
          connector: "conditional_result",
          action: { kind: "recover", target: { kind: "self" } },
        },
      ],
    };

    const rawResult = executeEffect({
      chainId: "test:p3-74-phase-b-blocked-judgement:561",
      state,
      effect,
      sourceInstanceId: "rem-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDefE2E,
    });
    // executeEffect は低レベル executor で chain 境界 flush を行わないため、テストで明示 flush。
    const result = flushPendingLeaves(rawResult, getCardDefE2E);

    // 美鈴 は trash へ (Q19 貫通)
    const misuzuAfter = result.cardInstances.find(
      (c) => c.instanceId === "misuzu-1"
    )!;
    expect(misuzuAfter.zone).toBe("trash");
    // レミリアは recovered (Q17 内包 conditional_result 成立)
    const remAfter = result.cardInstances.find(
      (c) => c.instanceId === "rem-1"
    )!;
    expect(remAfter.exhaustState).toBe("recovered");
  });

  it("悟空型 (内包, suppressDestroyedEffects 無し): 美鈴 残留 + 内包 conditional_result の count_increase 成立 (Q17)", () => {
    // 美鈴 (alice 側, cannot_leave_field 常時) + 悟空 (bob 側)
    const 美鈴 = fieldSpiritE2E("misuzu-2", "KMS-1", ALICE);
    const 悟空 = fieldSpiritE2E("gok-1", "GOK-1", BOB);
    let state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [美鈴, 悟空],
    };
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_leave_field",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "misuzu-2",
      getCardDefE2E
    );

    // 悟空型: destroy + conditional_result count_increase (= ライフコア配置のスタンドイン)
    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "conditional_result",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:p3-74-phase-b-blocked-judgement:627",
      state,
      effect,
      sourceInstanceId: "gok-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDefE2E,
    });

    // 美鈴 はフィールドに残る (Q16: 「離れない」常時で残留)
    const misuzuAfter = result.cardInstances.find(
      (c) => c.instanceId === "misuzu-2"
    )!;
    expect(misuzuAfter.zone).toBe("field");
    expect(misuzuAfter.pendingLeaveKind).toBeNull();
    // 内包 conditional_result の count_increase は成立 (Q17)
    const bobPlayer = result.players.find((p) => p.id === BOB)!;
    expect(bobPlayer.countValue).toBe(1);
  });

  it("悟空型 + 内包: blockedByResistance エントリは flush で除去される (残留物なし)", () => {
    const 美鈴 = fieldSpiritE2E("misuzu-3", "KMS-1", ALICE);
    const 悟空 = fieldSpiritE2E("gok-2", "GOK-1", BOB);
    let state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [美鈴, 悟空],
    };
    state = executeEffectResistance(
      state,
      ALICE,
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_leave_field",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "misuzu-3",
      getCardDefE2E
    );

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "conditional_result",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const rawResult = executeEffect({
      chainId: "test:p3-74-phase-b-blocked-judgement:688",
      state,
      effect,
      sourceInstanceId: "gok-2",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDefE2E,
    });
    const result = flushPendingLeaves(rawResult, getCardDefE2E);

    // pendingLeaveEntities に blockedByResistance エントリが残っていないこと
    expect(result.pendingLeaveEntities.length).toBe(0);
    // ログに解決マーカーがある
    expect(
      result.log.some((l) =>
        l.startsWith("pending-leave-blocked-flushed:destroy:misuzu-3")
      )
    ).toBe(true);
    // 美鈴 はフィールドに残る
    const misuzuAfter = result.cardInstances.find(
      (c) => c.instanceId === "misuzu-3"
    )!;
    expect(misuzuAfter.zone).toBe("field");
  });
});
