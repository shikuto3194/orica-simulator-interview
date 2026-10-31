/**
 * BSDB01-CX01【真バディ：「孫悟空」/「ベジータ」】: host 側 (被煌臨側) 同時2体煌臨。
 *
 * 「魂状態/煌臨元を含むこのカードには、対象を右左に1体ずつ【契約煌臨】できる。このとき、
 * このカードが魂状態/煌臨元なら煌臨するカードに自分のフィールド/リザーブのコアを好きなだけ
 * 置く。また、〔ターンに1回:同名〕自分は、《ソウルコア》をトラッシュに置いたものとして
 * 【契約煌臨】できる」を hostDualAdventGrant (model.ts) + mechanics/host-dual-advent.ts で表現。
 *
 * 裁定確定 (2026-07-13、issues/P3-117、公式【バディ】base裁定との突き合わせ後ユーザー確認):
 * 1宣言=1体。host は2枚の occupant を並行/分岐で保持する (host→A、host→B の分岐。
 * host→A→B の直列チェーンではない)。片方が離れても host は魂状態に戻らない。
 *
 * needs-dsl.w1.jsonl: BSDB01-CX01 [0,1] 真バディ。
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
  getAdventTargets,
  getLegalActions,
} from "../src/runtime";
import {
  flushPendingLeaves,
  queuePendingLeave,
} from "../src/state-based-actions";
import type {
  AdventData,
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
} from "../src/runtime";
import { adventSourceIdsOf } from "../src/model";
import { adventFlashPosition } from "./advent-flash-position";

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

const HOST_NO = "BSDB01-CX01"; // 孫悟空＆ベジータ (真バディ)
const GOKU_NO = "BSDB01-C01"; // 孫悟空
const VEGETA_NO = "BSDB01-C02"; // ベジータ
const SOURCE_NO = "BSDB01-C05"; // コア供給用の通常スピリット (hostDualAdventGrant/adventData を持たない)

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}
function getPlayer(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

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
  if (current.activeAttack?.flashWindowState?.pendingStackAction) {
    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.activeAttack.flashWindowState.priorityPlayerId,
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "pass_battle_flash")!;
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

function resolvePendingAsIfSoulCoreChoice(
  state: GameState,
  useAlternateCost: boolean
): GameState {
  const pending = state.pendingAsIfSoulCoreChoice;
  if (!pending) return state;
  const choiceId =
    pending.options.find(
      (choice) =>
        choice.useAlternateCost === useAlternateCost &&
        choice.proxySourceInstanceId
    )?.choiceId ?? (useAlternateCost ? "alternate" : "normal");
  const resolveAction = getLegalActions({
    state,
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  }).find(
    (
      a
    ): a is Extract<
      LegalAction,
      { kind: "resolve_pending_as_if_soul_core_choice" }
    > =>
      a.kind === "resolve_pending_as_if_soul_core_choice" &&
      a.choiceId === choiceId
  );
  expect(resolveAction).toBeDefined();
  return applyLegalAction({
    state,
    action: resolveAction!,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
}

function passStackAndResolveTarget(
  state: GameState,
  targetInstanceIds: string[],
  useAlternateCost = false
): GameState {
  const afterStack = passStackUntilClosed(state);
  const afterChoice = resolvePendingAsIfSoulCoreChoice(
    afterStack,
    useAlternateCost
  );
  return resolvePendingEffectTarget(afterChoice, targetInstanceIds);
}

function findHostDualAdventDeclaration(
  state: GameState,
  actingPlayerId: string,
  _useAlternateCost: boolean,
  sourceInstanceId?: string
): Extract<LegalAction, { kind: "declare_advent" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
  const decl = actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" &&
      a.candidateTargetInstanceIds.includes("host-1") &&
      (!sourceInstanceId || a.sourceInstanceId === sourceInstanceId)
  );
  if (!decl) throw new Error("declare_host_dual_advent not found");
  return decl;
}

function declareHostDualAdvent(
  state: GameState,
  actingPlayerId: string,
  targetInstanceId: string,
  useAlternateCost: boolean
): GameState {
  const decl = findHostDualAdventDeclaration(
    state,
    actingPlayerId,
    useAlternateCost,
    targetInstanceId
  );
  expect(decl.candidateTargetInstanceIds).toContain("host-1");
  const declared = applyLegalAction({
    state,
    action: decl,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
  // P3-115 再発防止invariant: declare_host_dual_advent は opens_own_window に分類されており、
  // 宣言直後にスタック窓が開いていなければならない (join_active_attack と同型の欠落を防ぐ)。
  expect(declared.stackWindow).not.toBeNull();
  return passStackAndResolveTarget(declared, ["host-1"], useAlternateCost);
}

/**
 * host が既に煌臨元/魂状態だった場合の宣言は pendingCoreDistribution を残す
 * (hostCoreDistributionOnAdvent)。この pending が残っている間は他の legal action が
 * 一切提示されない (legal-actions.ts:524) ため、直後に反対側スロットを宣言したいテストは
 * 明示的にこれを片付ける。0個配置だと (host 側で reset された 0 コアを引き継いだ)
 * occupant がコア不足で消滅してしまうため、source-1 (normalCoreCount:3) から1個だけ
 * 配置する (テスト内容と無関係な最小限の配置)。
 */
function abortPendingCoreDistributionIfAny(
  state: GameState,
  actingPlayerId: string
): GameState {
  if (!state.pendingCoreDistribution) return state;
  const pending = state.pendingCoreDistribution;
  const recipientId = pending.candidates[0]!.instanceId;
  const resolveAction = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  }).find((a) => a.kind === "resolve_pending_core_distribution");
  if (!resolveAction)
    throw new Error("resolve_pending_core_distribution not found");
  return applyLegalAction({
    state,
    action: resolveAction,
    coreDistributionAllocations: { [recipientId]: 1 },
    coreDistributionSourceAllocations: { "field:source-1": 1 },
    getCardDefinitionById,
    ...effectLookups,
  }).state;
}

/** ALICE のフィールドに孫悟空(hand)/ベジータ(hand)/コア source を、host を指定状態で置く。 */
function buildState(hostMode: "soul_state" | "field"): GameState {
  const host = createCardInstance(card(HOST_NO), {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: hostMode === "soul_state" ? 0 : 1,
  });
  const source = createCardInstance(card(SOURCE_NO), {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 3,
  });
  const goku = createCardInstance(card(GOKU_NO), {
    instanceId: "goku-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const vegeta = createCardInstance(card(VEGETA_NO), {
    instanceId: "vegeta-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        handCount: 2,
        soulCoreLocation: { kind: "reserve" },
        reserveNormalCoreCount: 2,
        soulStateInstanceIds: hostMode === "soul_state" ? ["host-1"] : [],
        contractCardNo: HOST_NO,
        countValue: 0,
      },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [host, source, goku, vegeta],
  };
}

describe("BSDB01-CX01【真バディ】host 側同時2体煌臨 (分岐構造)", () => {
  it("魂状態の host へ1体目(孫悟空)を契約煌臨: ソウルコア消費・pendingCoreDistribution 生成", () => {
    const state = buildState("soul_state");
    const decl = findHostDualAdventDeclaration(state, ALICE, false);
    // 両スロットとも空なので孫悟空/ベジータ双方が候補に載る (単一選択)。
    expect(decl.sourceInstanceId).toBe("goku-1");
    expect(decl.candidateTargetInstanceIds).toEqual(["host-1"]);
    expect(
      findHostDualAdventDeclaration(state, ALICE, false, "vegeta-1")
        .candidateTargetInstanceIds
    ).toEqual(["host-1"]);
    expect(decl.requiredTargetCount).toBe(1);

    const newState = declareHostDualAdvent(state, ALICE, "goku-1", false);

    const goku = getCard(newState, "goku-1");
    expect(goku.zone).toBe("field");
    expect(adventSourceIdsOf(goku)).toEqual(["host-1"]);

    // 魂状態が解除される
    expect(getPlayer(newState, ALICE).soulStateInstanceIds).not.toContain(
      "host-1"
    );
    // ソウルコアを実消費 (reserve → trash)
    expect(getPlayer(newState, ALICE).soulCoreLocation).toEqual({
      kind: "trash",
    });
    // host が魂状態だったので pendingCoreDistribution(any_movable) が立つ
    const pending = newState.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.fromKind).toBe("any_movable");
    expect(pending!.candidates.map((c) => c.instanceId)).toEqual(["goku-1"]);
  });

  it("ソウルコアだけの host に置いたものとして煌臨し、使用済みなら宣言を出さない", () => {
    const base = buildState("field");
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === ALICE
          ? {
              ...player,
              soulCoreLocation: { kind: "card", instanceId: "host-1" },
              reserveSoulCoreCount: 0,
            }
          : player
      ),
      cardInstances: base.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "host-1"
          ? { ...cardInstance, normalCoreCount: 0, soulCoreCount: 1 }
          : cardInstance
      ),
    };

    const declared = applyLegalAction({
      state,
      action: findHostDualAdventDeclaration(state, ALICE, true),
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const afterStack = passStackUntilClosed(declared);
    // 実消費では消滅するため、擬制経路だけを自動選択する。
    expect(afterStack.pendingAsIfSoulCoreChoice).toBeNull();
    const resolved = resolvePendingEffectTarget(afterStack, ["host-1"]);
    expect(getCard(resolved, "goku-1")).toMatchObject({
      zone: "field",
      normalCoreCount: 0,
      soulCoreCount: 1,
      underCards: [{ cardInstanceId: "host-1", role: "advent_source" }],
    });
    expect(getCard(resolved, "host-1").soulCoreCount).toBe(0);
    expect(getPlayer(resolved, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "goku-1",
    });
    expect(resolved.usedAlternateCostAdventKeysThisTurn).toContain(
      "name:" + card(HOST_NO).name
    );
    expect(resolved.pendingEffectTargetSelection).toBeNull();
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(resolved.pendingLeaveEntities).toEqual([]);
    const usedState = {
      ...state,
      usedAlternateCostAdventKeysThisTurn: [
        "name:" + card(HOST_NO).name,
        "name:" + card(HOST_NO).name,
      ],
    };
    const actions = getLegalActions({
      state: usedState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "declare_advent" &&
          action.candidateTargetInstanceIds.includes("host-1")
      )
    ).toBe(false);
  });

  it("両スロットを別々の宣言で埋める: host→孫悟空、host→ベジータの分岐 (直列チェーンではない)", () => {
    const state = buildState("field");

    const afterGoku = declareHostDualAdvent(state, ALICE, "goku-1", false);
    // 反対側 (ベジータ) はまだ空なので、2枚目の宣言も host に対して独立に発揮できる。
    // ソウルコアはプレイヤー1個の単一資源で1枚目 (通常経路) が既に消費済みなので、
    // 2枚目は代替コスト経路 (useAlternateCost:true) で確認する。
    const decl2 = findHostDualAdventDeclaration(afterGoku, ALICE, true);
    expect(decl2.sourceInstanceId).toBe("vegeta-1");
    expect(decl2.candidateTargetInstanceIds).toEqual(["host-1"]);

    const afterVegeta = declareHostDualAdvent(
      afterGoku,
      ALICE,
      "vegeta-1",
      true
    );

    // 孫悟空・ベジータはそれぞれ独立に host を煌臨元として持つ (分岐構造)。
    const goku = getCard(afterVegeta, "goku-1");
    const vegeta = getCard(afterVegeta, "vegeta-1");
    expect(goku.zone).toBe("field");
    expect(vegeta.zone).toBe("field");
    expect(adventSourceIdsOf(goku)).toEqual(["host-1"]);
    expect(adventSourceIdsOf(vegeta)).toEqual(["host-1"]);
    // 孫悟空の下にベジータが連結される直列チェーンにはならない。
    expect(adventSourceIdsOf(goku)).not.toContain("vegeta-1");
    expect(adventSourceIdsOf(vegeta)).not.toContain("goku-1");

    // 2枚目 (ベジータ) 宣言時点で host は既に孫悟空の煌臨元なので pendingCoreDistribution
    // が残る。これを片付けないと他の legal action が一切提示されない。
    const settled = abortPendingCoreDistributionIfAny(afterVegeta, ALICE);

    // 両スロットが埋まったので、この host はもう declare_host_dual_advent を emit しない。
    const actions = getLegalActions({
      state: settled,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    });
    expect(
      actions.some(
        (a) =>
          a.kind === "declare_advent" &&
          a.candidateTargetInstanceIds.includes("host-1")
      )
    ).toBe(false);
  });

  it("2枚目の宣言 (反対側スロットが既に埋まっている): host が既に煌臨元なので pendingCoreDistribution が生成される", () => {
    const state = buildState("field"); // host は通常フィールド現在面から開始
    const afterGoku = declareHostDualAdvent(state, ALICE, "goku-1", false);
    // 1枚目 (通常フィールド現在面からの宣言) ではコア配置は発生しない。
    expect(afterGoku.pendingCoreDistribution).toBeNull();

    // ソウルコアは1枚目で既に消費済みなので、2枚目は代替コスト経路で宣言する。
    const afterVegeta = declareHostDualAdvent(
      afterGoku,
      ALICE,
      "vegeta-1",
      true
    );
    // 2枚目の宣言時点で host は既に孫悟空の煌臨元 (=「魂状態/煌臨元」) なので発生する。
    const pending = afterVegeta.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.candidates.map((c) => c.instanceId)).toEqual(["vegeta-1"]);
  });

  it("同名カードは既に埋まったスロットを再度満たせない (孫悟空を2枚目に選べない)", () => {
    const state = buildState("field");
    const secondGoku = createCardInstance(card(GOKU_NO), {
      instanceId: "goku-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const withSecondGoku: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, secondGoku],
    };
    const afterGoku = declareHostDualAdvent(
      withSecondGoku,
      ALICE,
      "goku-1",
      false
    );

    // ソウルコアは1枚目で既に消費済みなので代替コスト経路で確認する。
    const decl2 = findHostDualAdventDeclaration(afterGoku, ALICE, true);
    // slot0 (孫悟空) は埋まっているので goku-2 は候補から外れ、ベジータのみ残る。
    expect(decl2.sourceInstanceId).toBe("vegeta-1");
    expect(decl2.candidateTargetInstanceIds).toEqual(["host-1"]);
  });

  it("使用制限はhostではなく手札から煌臨する候補カードへ適用する", () => {
    const restrictGokuAdvent: ContinuousEffect = {
      effectId: "ce-restrict-goku-advent",
      sourceInstanceId: "host-1",
      sourceDefinitionId: HOST_NO,
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "restrict_use",
      targetInstanceId: ALICE,
      metadata: {
        filter: { cardName: { exact: card(GOKU_NO).name } },
        restrictedKinds: ["advent"],
      },
    };
    const state: GameState = {
      ...buildState("field"),
      activeContinuousEffects: [restrictGokuAdvent],
    };

    const decl = findHostDualAdventDeclaration(state, ALICE, false);
    expect(decl.sourceInstanceId).toBe("vegeta-1");
    expect(decl.candidateTargetInstanceIds).toEqual(["host-1"]);
  });

  it("片方 (孫悟空) が単独でフィールドを離れても host は魂状態に戻らずベジータの煌臨元として残る", () => {
    const state = buildState("field");
    const afterGoku = declareHostDualAdvent(state, ALICE, "goku-1", false);
    // ソウルコアは1枚目で既に消費済みなので、2枚目は代替コスト経路で宣言する。
    const afterVegeta = declareHostDualAdvent(
      afterGoku,
      ALICE,
      "vegeta-1",
      true
    );
    // 2枚目宣言時点の pendingCoreDistribution を片付けないと
    // (hasOutstandingEffectResolutionContinuation により) SBA が離脱を flush しない。
    const settled = abortPendingCoreDistributionIfAny(afterVegeta, ALICE);

    // 孫悟空をトラッシュへ破壊する (state-based-actions の一括移動対象にする)。
    const destroyed = queuePendingLeave({
      state: settled,
      instanceId: "goku-1",
      kind: "destroy",
      cause: "self_effect",
      chainId: "test-chain",
    });
    const afterSba = flushPendingLeaves(destroyed, getCardDefinitionById);

    expect(getCard(afterSba, "goku-1").zone).toBe("trash");
    // host はベジータの煌臨元として場に残る (道連れにならない)。
    const vegeta = getCard(afterSba, "vegeta-1");
    expect(vegeta.zone).toBe("field");
    expect(adventSourceIdsOf(vegeta)).toEqual(["host-1"]);
    const host = getCard(afterSba, "host-1");
    expect(host.zone).toBe("field");
    expect(getPlayer(afterSba, ALICE).soulStateInstanceIds).not.toContain(
      "host-1"
    );
  });

  it("両方 (孫悟空・ベジータ) がフィールドを離れると host も道連れになる", () => {
    const state = buildState("field");
    const afterGoku = declareHostDualAdvent(state, ALICE, "goku-1", false);
    // ソウルコアは1枚目で既に消費済みなので、2枚目は代替コスト経路で宣言する。
    const afterVegeta = declareHostDualAdvent(
      afterGoku,
      ALICE,
      "vegeta-1",
      true
    );
    const settled = abortPendingCoreDistributionIfAny(afterVegeta, ALICE);

    const gokuLeaving = queuePendingLeave({
      state: settled,
      instanceId: "goku-1",
      kind: "destroy",
      cause: "self_effect",
      chainId: "test-chain",
    });
    const bothLeaving = queuePendingLeave({
      state: gokuLeaving,
      instanceId: "vegeta-1",
      kind: "destroy",
      cause: "self_effect",
      chainId: "test-chain",
    });
    const afterSba = flushPendingLeaves(bothLeaving, getCardDefinitionById);

    expect(getCard(afterSba, "goku-1").zone).toBe("trash");
    expect(getCard(afterSba, "vegeta-1").zone).toBe("trash");
    // 最後の occupant も離れたので host は道連れでトラッシュへ。
    expect(getCard(afterSba, "host-1").zone).toBe("trash");
  });

  it("他カードの煌臨元だった host: その関係を保ったまま新しい分岐 (孫悟空) を並行して受け入れる", () => {
    const base = buildState("field");
    // host-1 を別カード (other-1) の煌臨元として登録する (煌臨元状態を模擬)。
    const otherTop = {
      ...createCardInstance(card(SOURCE_NO), {
        instanceId: "other-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        { cardInstanceId: "host-1", role: "advent_source" as const },
      ],
    };
    const state: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, otherTop],
    };

    const newState = declareHostDualAdvent(state, ALICE, "goku-1", false);

    // other-1 は引き続き host-1 を煌臨元として持つ (分岐、切り離されない)。
    expect(adventSourceIdsOf(getCard(newState, "other-1"))).toContain("host-1");
    // 孫悟空も独立して host-1 を煌臨元として持つ (並行分岐)。
    expect(adventSourceIdsOf(getCard(newState, "goku-1"))).toEqual(["host-1"]);
  });

  it("代替コスト経路: ソウルコアを消費せず単体で契約煌臨できる (〔ターンに1回:同名〕は常時の許可元で共有)", () => {
    const state: GameState = {
      ...buildState("soul_state"),
      players: buildState("soul_state").players.map((p) =>
        p.id === ALICE ? { ...p, soulCoreLocation: null } : p
      ),
    };
    const newState = declareHostDualAdvent(state, ALICE, "goku-1", true);

    const goku = getCard(newState, "goku-1");
    expect(adventSourceIdsOf(goku)).toEqual(["host-1"]);
    // ソウルコアは null のまま (擬制消費、実消費なし)
    expect(getPlayer(newState, ALICE).soulCoreLocation).toBeNull();
    // 〔ターンに1回:同名〕は許可元の孫悟空＆ベジータで共有する。
    expect(newState.usedAlternateCostAdventKeysThisTurn).toContain(
      `name:${card(HOST_NO).name}`
    );
    expect(newState.usedAlternateCostAdventKeysThisTurn).not.toContain(
      `name:${card(GOKU_NO).name}`
    );

    // host は魂状態から開始したため、1枚目の宣言 (孫悟空) でも pendingCoreDistribution が
    // 立つ。片付けないと反対側スロットの宣言可否を確認できない。
    const settled = abortPendingCoreDistributionIfAny(newState, ALICE);

    // 常時許可は使用済みで実支払い用ソウルコアも無いため、別名のベジータも宣言不可。
    expect(
      getLegalActions({
        state: settled,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        ...effectLookups,
      }).some(
        (action) =>
          action.kind === "declare_advent" &&
          action.candidateTargetInstanceIds.includes("host-1")
      )
    ).toBe(false);
  });
});

describe("BSDB01-CX01【真バディ】host+スタックへの第三者アクセス制限 (exclusive-lock)", () => {
  // 「重なったカードを含むこれらには対象以外を合体/煌臨/入れ替えできない」の煌臨側。
  // hostDualAdventGrant.exclusiveToSlots (model.ts) + isExcludedByHostExclusiveLock
  // (advent-system.ts) が getAdventTargets 系の候補列挙で host+タワーを保護する。
  // この判定は各カードの (フラット化された) underCards を都度参照するため、分岐構造への
  // 再設計 (issues/P3-117) の影響を受けない (per-candidate-tower の判定であり、
  // host が1つか2つの occupant を持つかに依存しない)。
  const genericAdventData: AdventData = {
    adventCondition: { targetCategory: ["spirit"] },
    adventTiming: "main_and_flash",
    soulCoreDest: "trash",
  };

  it("host (CX01) 単体: 孫悟空/ベジータ以外の煌臨カードは候補から除外され、孫悟空/ベジータは除外されない", () => {
    const state = buildState("field");

    const thirdPartyTargets = getAdventTargets(
      state,
      ALICE,
      genericAdventData,
      getCardDefinitionById,
      card(SOURCE_NO)
    );
    expect(thirdPartyTargets.some((t) => t.instanceId === "host-1")).toBe(
      false
    );

    const gokuTargets = getAdventTargets(
      state,
      ALICE,
      genericAdventData,
      getCardDefinitionById,
      card(GOKU_NO)
    );
    expect(gokuTargets.some((t) => t.instanceId === "host-1")).toBe(true);

    const vegetaTargets = getAdventTargets(
      state,
      ALICE,
      genericAdventData,
      getCardDefinitionById,
      card(VEGETA_NO)
    );
    expect(vegetaTargets.some((t) => t.instanceId === "host-1")).toBe(true);
  });

  it("host が (片方の枝で) 重なった後: その枝の occupant も含めて第三者からの煌臨候補が除外される", () => {
    const base = buildState("field");
    const afterGoku = declareHostDualAdvent(base, ALICE, "goku-1", false);

    const thirdPartyTargets = getAdventTargets(
      afterGoku,
      ALICE,
      genericAdventData,
      getCardDefinitionById,
      card(SOURCE_NO)
    );
    // goku-1 (host を煌臨元とする枝の top) も host+タワーの一部なので候補から除外される。
    expect(thirdPartyTargets.some((t) => t.instanceId === "goku-1")).toBe(
      false
    );

    const vegetaTargets = getAdventTargets(
      afterGoku,
      ALICE,
      genericAdventData,
      getCardDefinitionById,
      card(VEGETA_NO)
    );
    expect(vegetaTargets.some((t) => t.instanceId === "goku-1")).toBe(true);
  });

  it("adventCardDef 未指定 (呼び出し元が煌臨カードを特定できない経路) は安全側に倒し host を除外する", () => {
    const state = buildState("field");
    const targets = getAdventTargets(
      state,
      ALICE,
      genericAdventData,
      getCardDefinitionById
    );
    expect(targets.some((t) => t.instanceId === "host-1")).toBe(false);
  });
});

describe("BSSG01-M01【host側煌臨許可付与】1スロット・通常経路無効・ターン制限無し", () => {
  // needs-ruling.jsonl cardNo BSSG01-M01/M02 裁定確定 (2026-07-25、案A): 原文通り実装。
  // 通常(ソウルコア消費)経路は生成しない(normalPathDisabled)、〔ターンに1回:同名〕は
  // 明記が無いため課さない(alternateCost.turnLimitDisabled)。HostDualAdventGrant.slots
  // の可変長一般化 (1スロットのみ) の検証を兼ねる。
  const M01_NO = "BSSG01-M01"; // 暁 切歌「イガリマ-XV-」(host)
  const AKATSUKI_NO = "BSSG01-M03"; // 印字煌臨を持つ暁 切歌。C01には煌臨を付与しない。

  function buildM01State(): GameState {
    const host = createCardInstance(card(M01_NO), {
      instanceId: "m01-host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const akatsuki = createCardInstance(card(AKATSUKI_NO), {
      instanceId: "akatsuki-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          reserveNormalCoreCount: 2,
        },
        {},
      ],
    });
    return adventFlashPosition({
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, akatsuki],
    });
  }

  function findM01Declaration(
    state: GameState,
    _useAlternateCost: boolean
  ): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    });
    return actions.find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "akatsuki-1"
    );
  }

  it("印字煌臨の通常支払いと常時効果の擬制支払いを窓後に選べる", () => {
    const state = buildM01State();
    const decl = findM01Declaration(state, false);
    expect(decl).toBeDefined();
    const declared = applyLegalAction({
      state,
      action: decl!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const afterStack = passStackUntilClosed(declared);
    expect(
      afterStack.pendingAsIfSoulCoreChoice?.options
        .map((option) => option.useAlternateCost)
        .sort()
    ).toEqual([false, true]);
    expect(afterStack.pendingEffectTargetSelection).toBeNull();
  });

  it("代替コスト経路 (擬制消費) は emit され、ソウルコアを消費せず契約煌臨できる", () => {
    const state = buildM01State();
    const decl = findM01Declaration(state, true);
    expect(decl).toBeDefined();
    expect(decl!.candidateTargetInstanceIds).toEqual(["m01-host-1"]);

    const declared = applyLegalAction({
      state,
      action: decl!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(
      declared.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();
    const newState = passStackAndResolveTarget(declared, ["m01-host-1"], true);

    const akatsuki = getCard(newState, "akatsuki-1");
    expect(adventSourceIdsOf(akatsuki)).toEqual(["m01-host-1"]);
    // ソウルコアは reserve のまま (擬制消費、実消費なし)。
    expect(getPlayer(newState, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    // 〔ターンに1回:同名〕gate は課されない(turnLimitDisabled)ため記録されない。
    expect(newState.usedAlternateCostAdventKeysThisTurn).not.toContain(
      `name:${card(AKATSUKI_NO).name}`
    );
  });
});
