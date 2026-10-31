/**
 * P3-62 end-to-end: BSTH01-R21「紅魔館」のターンに1回フラッシュ効果で
 * 「ことで」コスト atomic 化 + 発揮不能 refund を検証する。
 *
 * カード text:
 *   「ターンに1回、このネクサスを疲労させることで、
 *    BP5000以下のスピリット/BP1000以下のアルティメット1体を破壊する。」
 *
 * 効果 DSL 構造:
 *   step 0 (cost):  set_exhaust_state self → exhausted
 *   step 1 (effect): destroy filter (opp spirit ≤ 5000 / ult ≤ 1000), count: 1,
 *                    connector: "conditional_cost"
 *
 * シナリオ (P3-62 ケース 4):
 *   1. alice が 紅魔館 flash を宣言。target は bob の BP5000 スピリット。
 *      この時点で legal-action 列挙は通り (P3-61 の事前 condition gating でも生存)、
 *      activeStack.recordedUsage に nexus:0 が積まれる。
 *   2. 宣言直後に target スピリットがフィールドから消える (テスト上は直接 state を
 *      書き換えて再現)。実カード相互作用では 相手フラッシュによる退去等で発生する。
 *   3. pass で stack 解決 → destroy 不発 → conditional_cost 双方向 atomic で
 *      cost (set_exhaust_state) も巻き戻る。
 *
 * 確認項目:
 *   - 紅魔館 nexus は exhaustState=recovered (cost 適用されていない)
 *   - effectUsageRecords に nexus:0 のエントリが残っていない (refund 済)
 *
 * 比較対象: target が消えなければ destroy 成立し、nexus は疲労、usageLimit 消費。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

// 紅魔館の timingScope (`お互いのアタックステップ`) を外して main step で起動可能にする。
// engine の usageLimit / conditional_cost 経路を end-to-end で踏ませる目的のため、
// step 制約は本テストの趣旨外。
const 紅魔館原本 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-R21")!;
const 紅魔館: CardDefinition = {
  ...紅魔館原本,
  effects: 紅魔館原本.effects?.map((e, i) =>
    i === 0 ? { ...e, timingScope: undefined } : e
  ),
};

// 対象に使う相手スピリットは BP5000 の実カードを採用 (filter にマッチ)。
const 小型スピリット = ALL_CARDS.find(
  (c) =>
    c.printedCategory === "spirit" &&
    (c.levelDefs?.[0]?.bp ?? Infinity) <= 5000 &&
    (c.levelDefs?.[0]?.bp ?? 0) > 0
)!;

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
cardNoMap.set(紅魔館.cardNo, 紅魔館);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const TEST_CARDS = ALL_CARDS.map((c) =>
  c.cardNo === 紅魔館.cardNo ? 紅魔館 : c
);

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
};

function buildScenario(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const koumakan = createCardInstance(紅魔館, {
    instanceId: "koumakan-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "recovered",
  });
  const oppSpirit = createCardInstance(小型スピリット, {
    instanceId: "opp-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [koumakan, oppSpirit],
  };
}

function findKoumakanFlash(
  state: GameState
): Extract<LegalAction, { kind: "use_field_card_effect" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    ...effectLookups,
  });
  const action = actions.find(
    (a): a is Extract<LegalAction, { kind: "use_field_card_effect" }> =>
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === "koumakan-1" &&
      a.registrationIndex === 0 &&
      (a.timing === "flash" || a.timing === "stack")
  );
  if (!action) {
    throw new Error("expected use_field_card_effect for koumakan to be legal");
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

describe("P3-62 end-to-end (BSTH01-R21 紅魔館): conditional_cost 双方向 atomic", () => {
  it("宣言後に target が消失 → destroy 不発: nexus 疲労せず、usageLimit refund (P3-62 ケース 4)", () => {
    const initial = buildScenario();
    const action = findKoumakanFlash(initial);

    const declareResult = applyLegalAction({
      state: initial,
      action,
      targetInstanceIds: ["opp-1"],
      getCardDefinitionById,
      ...effectLookups,
    });

    // 宣言時に recordedUsage が activeStack に積まれる。
    const stack = declareResult.state.stackWindow?.pendingStackAction;
    expect(stack).toBeDefined();
    expect(stack?.recordedUsage).toBeDefined();
    expect(stack?.recordedUsage?.effectLabel).toBe("nexus:0");
    // 宣言時に usageLimit を 1 件記録している
    const declaredRecords = declareResult.state.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "koumakan-1" && r.effectLabel === "nexus:0"
    );
    expect(declaredRecords).toHaveLength(1);

    // 宣言直後に target が消える状況をシミュレート (相手フラッシュ等で退去した想定)。
    // テスト上は直接 state を書き換えて opp-1 を取り除く。
    // (engine の deferred 解決時の合法性再評価 → 効果不発 → P3-62 refund を踏むため)
    const stateWithoutTarget: GameState = {
      ...declareResult.state,
      cardInstances: declareResult.state.cardInstances.map((c) =>
        c.instanceId === "opp-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const resolved = passUntilStackClosed(stateWithoutTarget);

    // P3-62 ケース 4 双方向 atomic: cost (set_exhaust_state) も effect も発揮不能。
    // 紅魔館は exhausted ではない (rollback) — destroy 不発 → cost rollback。
    const koumakanAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "koumakan-1"
    )!;
    expect(koumakanAfter.exhaustState).toBe("recovered");

    // usageLimit (ターンに1回) は消費されない
    const usageRecordsForKoumakan = resolved.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "koumakan-1" && r.effectLabel === "nexus:0"
    );
    expect(usageRecordsForKoumakan).toHaveLength(0);
  });

  it("対象が場に残ったまま解決 → 正常パス: nexus 疲労 + usageLimit 1件消費", () => {
    const initial = buildScenario();
    const action = findKoumakanFlash(initial);

    const declareResult = applyLegalAction({
      state: initial,
      action,
      targetInstanceIds: ["opp-1"],
      getCardDefinitionById,
      ...effectLookups,
    });

    const resolved = passUntilStackClosed(declareResult.state);

    // 紅魔館は exhausted (cost 支払い済)
    const koumakanAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "koumakan-1"
    )!;
    expect(koumakanAfter.exhaustState).toBe("exhausted");

    // usageLimit (ターンに1回) は消費される
    const usageRecordsForKoumakan = resolved.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "koumakan-1" && r.effectLabel === "nexus:0"
    );
    expect(usageRecordsForKoumakan).toHaveLength(1);
  });
});
