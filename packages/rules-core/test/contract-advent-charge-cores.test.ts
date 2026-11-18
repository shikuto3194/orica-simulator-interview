/**
 * 契約煌臨で「魂状態」へ煌臨したときの任意コア配置 (08a:180)。
 *
 * ルール正源: manual/ai-reference/10_rules/08a_advent-rebirth-contract.md L180
 *   「魂状態に煌臨した場合、フィールド/リザーブからコアを好きなだけ置ける」
 *
 * 魂状態化時に上のコアはリザーブへ移動済みなので、契約煌臨の解決直後に
 * pendingCoreDistribution (fromKind:"any_movable") を生成し、プレイヤーが
 * フィールド/リザーブから煌臨スピリットへコアを好きなだけ置けるようにする。
 *
 * 実カード: BSKB01-CX01 ([仮面の騎士]メタナイト, 契約) を魂状態で場に置き、
 * BSKB01-C01 ([メタナイトの逆襲]メタナイト, 契約煌臨) を手札から契約煌臨する。
 *
 * 同型カード (本プリミティブで stub 解消): BSTS01-CX01 リムル=テンペスト /
 * BSSL01-CX01 水篠 旬 / BSKB01-CX01 [仮面の騎士]メタナイト。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
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
import { adventSourceIdsOf } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

const ADVENT_NO = "BSKB01-C01"; // 契約煌臨カード (C1以上)
const CONTRACT_NO = "BSKB01-CX01"; // 契約カード ([仮面の騎士]メタナイト)
const SOURCE_NO = "BSKB01-C02"; // コア供給用の通常スピリット (フィールド source)

/**
 * ALICE のフィールドに魂状態の CONTRACT_NO、別スピリット(コア source)、
 * 手札に ADVENT_NO を置く。リザーブにも通常コアを置く。
 */
function buildState(db = false): GameState {
  const contractNo = db ? "BSDB01-CX01" : CONTRACT_NO;
  const contract = createCardInstance(card(contractNo), {
    instanceId: "contract-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0, // 魂状態 = 上のコアはリザーブへ移動済み
  });
  const source = createCardInstance(card(db ? "BSDB01-C08" : SOURCE_NO), {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: db ? 4 : 3,
    soulCoreCount: db ? 1 : 0,
  });
  const advent = createCardInstance(card(db ? "BSDB01-R01" : ADVENT_NO), {
    instanceId: "advent-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation: db
          ? { kind: "card", instanceId: "source-1" }
          : { kind: "reserve" },
        reserveNormalCoreCount: db ? 0 : 2,
        soulStateInstanceIds: ["contract-1"],
        contractCardNo: contractNo,
        countValue: db ? 6 : 1,
      },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [contract, source, advent],
  };
}

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}
function getPlayer(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

/**
 * P3-112: declare_advent は今やスタック窓を開く（apply 即時解決ではない）。
 * responder のパスで窓を閉じ、deferred 解決（ソウルコア消費＋重ね＋任意コア配置 pending 生成）
 * まで進める。
 */
function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "pass_stack");
    if (!pass) {
      throw new Error(`pass_stack for ${responderId} not found`);
    }
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return current;
}

function resolvePendingEffectTarget(
  state: GameState,
  targetInstanceIds: string[]
): GameState {
  const pending = state.pendingEffectTargetSelection;
  expect(pending).not.toBeNull();
  const resolveAction = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  }).find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_effect_target" }> =>
      a.kind === "resolve_pending_effect_target"
  );
  expect(resolveAction).toBeDefined();
  for (const id of targetInstanceIds) {
    expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
  }
  return applyLegalAction({
    state,
    action: resolveAction!,
    targetInstanceIds,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
}

function passStackAndResolveTarget(
  state: GameState,
  targetInstanceIds: string[],
  alternate = false
): GameState {
  let afterStack = passStackUntilClosed(state);
  const choice = afterStack.pendingAsIfSoulCoreChoice;
  if (choice) {
    const normal = choice.options.find(
      (option) => option.useAlternateCost === alternate
    )!;
    const action = getLegalActions({
      state: afterStack,
      actingPlayerId: choice.actingPlayerId,
      getCardDefinitionById,
      ...effectLookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_as_if_soul_core_choice" &&
        candidate.choiceId === normal.choiceId
    )!;
    afterStack = applyLegalAction({
      state: afterStack,
      action,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return resolvePendingEffectTarget(afterStack, targetInstanceIds);
}

function findContractAdventDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "declare_advent" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    ...effectLookups,
  });
  const decl = actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" &&
      a.sourceInstanceId === "advent-1" &&
      a.candidateTargetInstanceIds.includes("contract-1")
  );
  if (!decl)
    throw new Error("contract advent declaration onto soul state not found");
  return decl;
}

describe("契約煌臨 魂状態への煌臨: 任意コア配置 (08a:180)", () => {
  it.each([
    [1, false],
    [0, false],
    [1, true],
    [0, true],
  ] as const)(
    "BSDB01: リザーブ0でC08からR01へ%d個配置できる（代替コスト=%s）",
    (amount, alternate) => {
      const state = buildState(true);
      const afterAdvent = passStackAndResolveTarget(
        applyLegalAction({
          state,
          action: findContractAdventDeclaration(state),
          getCardDefinitionById,
          ...effectLookups,
        }).state,
        ["contract-1"],
        alternate
      );
      const pending = afterAdvent.pendingCoreDistribution!;
      expect(pending.fromKind).toBe("any_movable");
      expect(pending.allowedSources).toContainEqual({
        kind: "field",
        instanceId: "source-1",
      });
      expect(pending.sourceAvailable?.["field:source-1"]).toBe(4);
      expect(pending.sourceAvailable?.reserve).toBe(0);
      expect(getCard(afterAdvent, "source-1").soulCoreCount).toBe(
        alternate ? 1 : 0
      );
      const action = getLegalActions({
        state: afterAdvent,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        ...effectLookups,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_core_distribution"
      )!;
      const after = applyLegalAction({
        state: afterAdvent,
        action,
        getCardDefinitionById,
        ...effectLookups,
        coreDistributionAllocations: amount ? { "advent-1": amount } : {},
        coreDistributionSourceAllocations: amount
          ? { "field:source-1": amount }
          : {},
      }).state;
      expect(after.pendingCoreDistribution).toBeNull();
      expect(getCard(after, "source-1")).toMatchObject({
        zone: "field",
        normalCoreCount: 4 - amount,
      });
      expect(getCard(after, "advent-1")).toMatchObject({
        zone: amount ? "field" : "trash",
        normalCoreCount: amount,
      });
      expect(getPlayer(after, ALICE).reserveNormalCoreCount).toBe(0);
    }
  );
  it("魂状態への契約煌臨後に pendingCoreDistribution(any_movable) が生成される", () => {
    const state = buildState();
    const decl = findContractAdventDeclaration(state);

    const result = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    const newState = passStackAndResolveTarget(result.state, ["contract-1"]);

    // 煌臨カードがフィールドに重なり、魂状態が解除される
    const adv = getCard(newState, "advent-1");
    expect(adv.zone).toBe("field");
    expect(adventSourceIdsOf(adv)).toContain("contract-1");
    expect(getPlayer(newState, ALICE).soulStateInstanceIds).not.toContain(
      "contract-1"
    );

    // 任意コア配置 pending が立つ (GUI ピッカーがコア配置先=煌臨スピリットを表示する)
    const pending = newState.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.fromKind).toBe("any_movable");
    expect(pending!.actingPlayerId).toBe(ALICE);
    // 配置先は煌臨スピリット (advent-1) のみ
    expect(pending!.candidates.map((c) => c.instanceId)).toEqual(["advent-1"]);
    // ソース: リザーブ(2) + フィールドの source-1(3) = 計 5
    expect(pending!.totalNormalCores).toBe(5);
    expect(pending!.sourceAvailable?.["reserve"]).toBe(2);
    expect(pending!.sourceAvailable?.["field:source-1"]).toBe(3);
    // 任意配置 = 最小0 (0個も可)
    expect(pending!.minTotal ?? 0).toBe(0);
  });

  it("pending を解決するとリザーブ/フィールドのコアが煌臨スピリットへ移る", () => {
    const state = buildState();
    const decl = findContractAdventDeclaration(state);
    const declared = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const afterAdvent = passStackAndResolveTarget(declared, ["contract-1"]);

    const pending = afterAdvent.pendingCoreDistribution!;
    const resolveAction = getLegalActions({
      state: afterAdvent,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();

    // リザーブから2個 + source-1 から1個 = 計3個を煌臨スピリットへ配置
    const resolved = applyLegalAction({
      state: afterAdvent,
      action: resolveAction!,
      getCardDefinitionById,
      coreDistributionAllocations: { "advent-1": 3 },
      coreDistributionSourceAllocations: {
        reserve: 2,
        "field:source-1": 1,
      },
      ...effectLookups,
    });

    expect(resolved.state.pendingCoreDistribution).toBeNull();
    // 煌臨スピリットへ 3個 置かれた (魂状態の 0個 から +3)
    expect(getCard(resolved.state, "advent-1").normalCoreCount).toBe(3);
    // リザーブ 2→0、source-1 3→2
    expect(getPlayer(resolved.state, ALICE).reserveNormalCoreCount).toBe(0);
    expect(getCard(resolved.state, "source-1").normalCoreCount).toBe(2);
    // pending を浪費した pendingId が再生成されないこと (1回限り)
    expect(pending.pendingId).toMatch(/^advent-charge-/);
  });
});
