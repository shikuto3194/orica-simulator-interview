/**
 * P3-62 end-to-end (triggered_effect 経路): conditional_cost 双方向 atomic +
 * usageLimit refund の deferred resolve plumbing を verify する。
 *
 * 既存 e2e:
 *   - magic / field_card_effect 経路は `p3-62-koumakan-end-to-end.test.ts`
 *     (BSTH01-R21 紅魔館) で担保済み。
 *
 * 本テストの目的:
 *   - triggered (card_event) の宣言 → stack window 待機 → defer resolve 経路でも
 *     recordedUsage が正しく activeStack に積まれ、対象消失時に
 *     - conditional_cost cost step が rollback され
 *     - usageLimit (turn) が refund される
 *     ことを確認する。
 *   - 実カード BSTH01-XX02 博麗霊夢【解放：Lv4】は card_event/attack triggered で
 *     conditional_cost を持つ実例 (issue 参照) だが、attack flow 構築コスト高のため、
 *     最小要件を満たす synthetic card で plumbing 検証に絞る。
 *
 * 構造: synthetic triggered card (card_event/summon, usageLimit per_instance/turn,
 *   steps: count_decrease cost ▶ destroy filter opp spirit) を 1 effect だけ持つ
 *   spirit として登録。pendingTriggeredEffects に summon イベントを inject して
 *   resolve_pending_triggered_effect から経路を踏ませる。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const triggerCard: CardDefinition = {
  cardNo: "P3-62-TRIG-TEST",
  name: "P3-62 triggered conditional_cost テスト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      applicability: { zone: "field" },
      usageLimit: { kind: "per_instance", duration: "turn" },
      steps: [
        {
          id: "cost",
          action: { kind: "count_decrease", player: "self", amount: 1 },
        },
        {
          id: "effect",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
          connector: "conditional_cost",
        },
      ],
    },
  ],
};

const targetSpirit: CardDefinition = {
  cardNo: "P3-62-TRIG-TARGET",
  name: "P3-62 ターゲット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const cardNoMap = new Map<string, CardDefinition>([
  [triggerCard.cardNo, triggerCard],
  [targetSpirit.cardNo, targetSpirit],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const TEST_CARDS = [triggerCard, targetSpirit];
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
};

function buildScenario(): GameState {
  const triggerSrc = createCardInstance(triggerCard, {
    instanceId: "trig-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const oppSpirit = createCardInstance(targetSpirit, {
    instanceId: "opp-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ countValue: 5 }],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [triggerSrc, oppSpirit],
    pendingTriggeredEffects: [
      {
        pendingId: "p3-62-trig-pending-1",
        eventKind: "summon",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "test:p3-62-triggered-end-to-end:131",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "trig-1",
        amount: null,
        step: "main",
        window: "default",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}

function findTriggerDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "resolve_pending_triggered_effect" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    ...effectLookups,
  });
  const action = actions.find(
    (
      a
    ): a is Extract<
      LegalAction,
      { kind: "resolve_pending_triggered_effect" }
    > =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.pendingId === "p3-62-trig-pending-1" &&
      a.sourceInstanceId === "trig-1"
  );
  if (!action) {
    throw new Error(
      "expected resolve_pending_triggered_effect for trig-1 to be legal"
    );
  }
  return action;
}

function passUntilStackClosed(state: GameState): GameState {
  let cur = state;
  for (let i = 0; i < 8 && cur.stackWindow !== null; i++) {
    const priority = cur.stackWindow.priorityPlayerId;
    const turn = getLegalActions({
      state: cur,
      actingPlayerId: priority,
      getCardDefinitionById,
      ...effectLookups,
    });
    const pass = turn.find((a) => a.kind === "pass_stack");
    if (!pass) break;
    cur = applyLegalAction({
      state: cur,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return cur;
}

describe("P3-62 end-to-end (triggered_effect): conditional_cost 双方向 atomic + usageLimit refund", () => {
  it("通常解決: 宣言で recordedUsage 積載 → bob pass → cost (count) 支払い + destroy 成立 + usageLimit 1件消費", () => {
    const initial = buildScenario();
    const decl = findTriggerDeclaration(initial);

    const declared = applyLegalAction({
      state: initial,
      action: decl,
      targetInstanceIds: ["opp-1"],
      getCardDefinitionById,
      ...effectLookups,
    });

    // 宣言時に recordedUsage が activeStack に積まれる
    const pendingStack = declared.state.stackWindow?.pendingStackAction;
    expect(pendingStack).toBeDefined();
    expect(pendingStack?.actionKind).toBe("triggered_effect");
    expect(pendingStack?.recordedUsage).toBeDefined();
    // 効果ラベル: registration.effectIndex=0 → "effect:0"
    expect(pendingStack?.recordedUsage?.effectLabel).toBe("effect:0");

    // 宣言時に usageLimit を 1 件記録
    const declaredRecords = declared.state.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "trig-1" && r.effectLabel === "effect:0"
    );
    expect(declaredRecords).toHaveLength(1);

    // count は cost step がまだ実行されていないので 5 のまま
    expect(
      declared.state.players.find((p) => p.id === "alice")!.countValue
    ).toBe(5);

    const resolved = passUntilStackClosed(declared.state);

    // cost paid: count が 5 → 4
    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(4);

    // destroy 成立: target は trash
    const target = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-1"
    )!;
    expect(target.zone).toBe("trash");

    // usageLimit 1 件消費 (refund されていない)
    const usageRecords = resolved.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "trig-1" && r.effectLabel === "effect:0"
    );
    expect(usageRecords).toHaveLength(1);
  });

  it("宣言後に target が消失 → defer resolve 時に destroy 不発: cost rollback (count 不変) + usageLimit refund (ケース 4)", () => {
    const initial = buildScenario();
    const decl = findTriggerDeclaration(initial);

    const declared = applyLegalAction({
      state: initial,
      action: decl,
      targetInstanceIds: ["opp-1"],
      getCardDefinitionById,
      ...effectLookups,
    });

    // 宣言時の状態確認
    expect(
      declared.state.stackWindow?.pendingStackAction?.recordedUsage
    ).toBeDefined();
    const declaredRecords = declared.state.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "trig-1" && r.effectLabel === "effect:0"
    );
    expect(declaredRecords).toHaveLength(1);

    // 宣言後に target spirit を場から取り除く (相手フラッシュによる退去を simulate)
    const stateWithoutTarget: GameState = {
      ...declared.state,
      cardInstances: declared.state.cardInstances.map((c) =>
        c.instanceId === "opp-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const resolved = passUntilStackClosed(stateWithoutTarget);

    // P3-62 ケース 4 双方向 atomic: cost (count_decrease) が rollback され count 不変
    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(5);

    // usageLimit refund: レコード除去
    const usageRecords = resolved.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "trig-1" && r.effectLabel === "effect:0"
    );
    expect(usageRecords).toHaveLength(0);

    // ログ: conditional-cost-effect-failed が積まれる
    expect(
      resolved.log.some((l) =>
        l.startsWith("effect:conditional-cost-effect-failed:")
      )
    ).toBe(true);
  });
});
