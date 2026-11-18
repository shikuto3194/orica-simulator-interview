/**
 * 離脱置換: 煌臨元への追加 (or トラッシュ) — engine batch2-2。
 *
 * 検証対象: FieldExitReplacement の `advent_source` 変種。
 *   「このスピリットが相手によって離れるとき、自分の『水篠 旬』の煌臨元に追加するか、
 *    トラッシュに置く」(BSSL01-C02/M01/M03/X03 ほか) の汎用機構。
 *
 * ルール根拠: 08a_advent-rebirth-contract.md
 *   L34「下に表向きで重なる。表向き煌臨元≧1枚 → 【煌臨中】」
 *   L36「フィールド離脱時、煌臨元も全て同じ場所に移動」(本機構はその逆操作)
 *   L168「PendingLeaveEntity.causePlayerId — 相手起因判定」
 *
 * 機構: flushPendingLeaves 内 checkAdventSourceReplacement が
 *   pendingAdventSourceReplacement を立て当該カードを除外 → resolveAdventSourceReplacement で
 *   「煌臨元へ追加 (host.adventSourceCardIds へ) / トラッシュ」を解決。
 *   全ケースで pending を最終盤面まで解決してから assert する。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  flushPendingLeaves,
  resolveAdventSourceReplacement,
  getLegalActions,
  collectGameStateInvariantIssues,
  collectTriggerEventsFromStateDelta,
} from "../src";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { adventSourceIdsOf } from "../src/model";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
  PendingLeaveEntity,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";

// ── 定義ヘルパー ─────────────────────────────────────────

function spiritDef(cardNo: string, name: string): CardDefinition {
  return {
    cardNo,
    name,
    printedCategory: "spirit",
    printedColors: ["purple"],
    symbolColors: ["purple"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    textLines: [],
    images: {},
    tribe: "影",
  } as CardDefinition;
}

// 離脱して煌臨元になり得る側 (BSSL01-C02「タンク」相当)。
const LEAVER_DEF = spiritDef("TEST-LEAVER", "タンク");
// 煌臨元の追加先 (BSSL01-C01「水篠 旬」相当)。
const HOST_DEF = spiritDef("TEST-HOST", "水篠 旬");

const defMap = new Map<string, CardDefinition>([
  [LEAVER_DEF.cardNo, LEAVER_DEF],
  [HOST_DEF.cardNo, HOST_DEF],
]);
const getDef = (id: string): CardDefinition | undefined => defMap.get(id);

// ── インスタンス / CE / pending ヘルパー ─────────────────

function leaverCard(
  instanceId: string,
  cores = 3,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(LEAVER_DEF, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    pendingLeaveKind: "destroy",
    pendingLeaveCause: "effect_resolution",
    pendingLeaveChainId: `chain-${instanceId}`,
    ...opts,
  });
}

function hostCard(instanceId: string, cores = 2): CardInstance {
  return createCardInstance(HOST_DEF, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
}

/** advent_source 置換の CE を生成 (structured-effect-interpreter が積む形と同じ metadata)。 */
function adventSourceReplacementCE(
  targetInstanceId: string,
  opts: { source?: "opponent_effect" | "opponent" | "all" } = {}
): ContinuousEffect {
  return {
    effectId: `ce-advent-source-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: LEAVER_DEF.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "replace_field_exit",
    targetInstanceId,
    metadata: {
      trigger: "leave_field",
      source: opts.source ?? "opponent",
      replacement: {
        kind: "advent_source",
        target: { cardName: { contains: "水篠 旬" } },
        orTrash: true,
      },
    } as unknown as Record<string, unknown>,
  };
}

function pendingDestroy(
  instanceId: string,
  causePlayerId: string | null = BOB
): PendingLeaveEntity {
  return {
    instanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

function pendingBattleDestroy(
  instanceId: string,
  causePlayerId: string | null = null
): PendingLeaveEntity {
  return {
    instanceId,
    kind: "destroy",
    cause: "battle",
    causePlayerId,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

const getCard = (s: GameState, id: string): CardInstance =>
  s.cardInstances.find((c) => c.instanceId === id)!;
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

// ════════════════════════════════════════════════════════════════
// 相手起因離脱 → 煌臨元へ追加
// ════════════════════════════════════════════════════════════════

describe("advent_source 離脱置換: 煌臨元への追加", () => {
  it("相手起因離脱で pending を立て、選択で host の煌臨元に追加される (off-field 化 + host.adventSourceCardIds)", () => {
    const leaver = leaverCard("leaver", 3);
    const host = hostCard("host", 2);
    const state = createEmptyGameState({
      cardInstances: [leaver, host],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [pendingDestroy("leaver", BOB)];
    state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];

    // flush は当該カードをトラッシュに流さず pending を立てる。
    const afterFlush = flushPendingLeaves(state, getDef, ["purple"]);
    expect(afterFlush.pendingAdventSourceReplacement).not.toBeNull();
    expect(afterFlush.pendingAdventSourceReplacement!.cardInstanceId).toBe(
      "leaver"
    );
    expect(
      afterFlush.pendingAdventSourceReplacement!.candidateHostInstanceIds
    ).toEqual(["host"]);
    // まだトラッシュへ行っていない (フィールドに残置)。
    expect(getCard(afterFlush, "leaver").zone).toBe("field");

    // 「煌臨元へ追加」を選択 → 最終盤面まで解決。
    const resolved = resolveAdventSourceReplacement(
      afterFlush,
      "advent_source",
      "host"
    );

    // pending は解消。
    expect(resolved.pendingAdventSourceReplacement).toBeNull();
    // 離脱カードは host の煌臨元に積まれる (= フィールド上だが advent-source role)。
    const leaverAfter = getCard(resolved, "leaver");
    expect(adventSourceIdsOf(getCard(resolved, "host"))).toContain("leaver");
    expect(leaverAfter.zoneRoleName).toBe("advent-source");
    expect(leaverAfter.zone).toBe("field");
    expect(leaverAfter.faceDown).toBe(false);
    expect(leaverAfter.normalCoreCount).toBe(0);
    // pendingLeave は除去済み (= もうフィールドを離れない)。
    expect(leaverAfter.pendingLeaveKind).toBeNull();
    expect(resolved.pendingLeaveEntities).toHaveLength(0);
    // 離脱カードのコアはリザーブへ退避 (3 個)。
    expect(alice(resolved).reserveNormalCoreCount).toBe(3);
    // トラッシュには行っていない。
    expect(leaverAfter.zone).not.toBe("trash");
  });

  it("「トラッシュ」を選択すると次回 flush で通常通りトラッシュへ流れる", () => {
    const leaver = leaverCard("leaver", 3);
    const host = hostCard("host", 2);
    const state = createEmptyGameState({
      cardInstances: [leaver, host],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [pendingDestroy("leaver", BOB)];
    state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];

    const afterFlush = flushPendingLeaves(state, getDef, ["purple"]);
    expect(afterFlush.pendingAdventSourceReplacement).not.toBeNull();

    // トラッシュ選択 → pending 解消、pendingLeave は残る。
    const declined = resolveAdventSourceReplacement(afterFlush, "trash");
    expect(declined.pendingAdventSourceReplacement).toBeNull();
    expect(declined.pendingLeaveEntities).toHaveLength(1);

    // 再 flush で通常トラッシュへ。
    const afterSecond = flushPendingLeaves(declined, getDef, ["purple"]);
    const leaverAfter = getCard(afterSecond, "leaver");
    expect(leaverAfter.zone).toBe("trash");
    expect(leaverAfter.pendingLeaveKind).toBeNull();
    expect(adventSourceIdsOf(getCard(afterSecond, "host"))).not.toContain(
      "leaver"
    );
    // コアはリザーブへ。
    expect(alice(afterSecond).reserveNormalCoreCount).toBe(3);
  });

  it("追加先 host が不在でも trash-only 置換を提示し、元の離脱先ではなくトラッシュへ置く", () => {
    const leaver = leaverCard("leaver", 3, {
      pendingLeaveKind: "remove_from_game",
    });
    const state = createEmptyGameState({
      cardInstances: [leaver],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [
      {
        ...pendingDestroy("leaver", BOB),
        kind: "remove_from_game",
      },
    ];
    state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];

    const afterFlush = flushPendingLeaves(state, getDef, ["purple"]);
    expect(afterFlush.pendingAdventSourceReplacement).toMatchObject({
      cardInstanceId: "leaver",
      candidateHostInstanceIds: [],
    });
    expect(getCard(afterFlush, "leaver").zone).toBe("field");

    const actions = getLegalActions({
      state: afterFlush,
      actingPlayerId: ALICE,
      ...noLookups,
    }).filter((a) => a.kind === "resolve_advent_source_replacement");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      choice: "trash",
      candidateHostInstanceIds: [],
    });

    const applied = applyLegalAction({
      state: afterFlush,
      action: actions[0]!,
      ...noLookups,
    }).state;
    expect(
      collectGameStateInvariantIssues(applied)
        .map((issue) => issue.code)
        .filter((code) => code === "pending_leave_card_state_mismatch")
    ).toEqual([]);
    const afterSecond = flushPendingLeaves(applied, getDef, ["purple"]);
    const events = collectTriggerEventsFromStateDelta({
      beforeState: applied,
      afterState: afterSecond,
      source: "action_resolution",
    });
    const leaverAfter = getCard(afterSecond, "leaver");
    expect(leaverAfter.zone).toBe("trash");
    expect(leaverAfter.zone).not.toBe("removed_from_game");
    expect(leaverAfter.pendingLeaveKind).toBeNull();
    expect(events.map((event) => event.eventKind)).not.toContain("destroy");
    expect(alice(afterSecond).reserveNormalCoreCount).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════
// 相手起因ゲート / 追加先不在のフォールバック
// ════════════════════════════════════════════════════════════════

describe("advent_source 離脱置換: ゲートとフォールバック", () => {
  it("自分起因の離脱 (causePlayerId=controller) では置換が発火せず通常トラッシュへ", () => {
    const leaver = leaverCard("leaver", 3);
    const host = hostCard("host", 2);
    const state = createEmptyGameState({
      cardInstances: [leaver, host],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    // 自分 (ALICE) 起因の離脱。
    state.pendingLeaveEntities = [pendingDestroy("leaver", ALICE)];
    state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];

    const after = flushPendingLeaves(state, getDef, ["purple"]);
    // pending は立たず、即トラッシュへ。
    expect(after.pendingAdventSourceReplacement).toBeNull();
    expect(getCard(after, "leaver").zone).toBe("trash");
    expect(adventSourceIdsOf(getCard(after, "host"))).not.toContain("leaver");
  });

  it("source=opponent_effect はバトル破壊を捕捉しない", () => {
    const leaver = leaverCard("leaver", 3, {
      pendingLeaveCause: "battle",
    });
    const host = hostCard("host", 2);
    const state = createEmptyGameState({
      cardInstances: [leaver, host],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [pendingBattleDestroy("leaver", BOB)];
    state.activeContinuousEffects = [
      adventSourceReplacementCE("leaver", { source: "opponent_effect" }),
    ];

    const after = flushPendingLeaves(state, getDef, ["purple"]);

    expect(after.pendingAdventSourceReplacement).toBeNull();
    expect(getCard(after, "leaver").zone).toBe("trash");
    expect(adventSourceIdsOf(getCard(after, "host"))).not.toContain("leaver");
  });

  it("source=opponent は相手によるバトル破壊を捕捉する", () => {
    const leaver = leaverCard("leaver", 3, {
      pendingLeaveCause: "battle",
    });
    const host = hostCard("host", 2);
    const state = createEmptyGameState({
      cardInstances: [leaver, host],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [pendingBattleDestroy("leaver")];
    state.activeContinuousEffects = [
      adventSourceReplacementCE("leaver", { source: "opponent" }),
    ];

    const after = flushPendingLeaves(state, getDef, ["purple"]);

    expect(after.pendingAdventSourceReplacement).toMatchObject({
      cardInstanceId: "leaver",
      candidateHostInstanceIds: ["host"],
    });
    expect(getCard(after, "leaver").zone).toBe("field");
  });

  it("追加先スピリット (水篠 旬) が不在なら trash-only pending を立てる", () => {
    const leaver = leaverCard("leaver", 3);
    // host を置かない。
    const state = createEmptyGameState({
      cardInstances: [leaver],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [pendingDestroy("leaver", BOB)];
    state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];

    const after = flushPendingLeaves(state, getDef, ["purple"]);
    expect(after.pendingAdventSourceReplacement).toMatchObject({
      cardInstanceId: "leaver",
      candidateHostInstanceIds: [],
    });
    expect(getCard(after, "leaver").zone).toBe("field");
  });

  it("相手フィールドの同名スピリットは追加先にならない (自分のもののみ)", () => {
    const leaver = leaverCard("leaver", 3);
    // 同名だが相手 (BOB) 所有の host。
    const enemyHost = createCardInstance(HOST_DEF, {
      instanceId: "enemy-host",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      cardInstances: [leaver, enemyHost],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [pendingDestroy("leaver", BOB)];
    state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];

    const after = flushPendingLeaves(state, getDef, ["purple"]);
    // 自分の追加先が無い → 相手 host は候補に入れず trash-only pending。
    expect(after.pendingAdventSourceReplacement).toMatchObject({
      cardInstanceId: "leaver",
      candidateHostInstanceIds: [],
    });
    expect(getCard(after, "leaver").zone).toBe("field");
  });

  it("魂状態と煌臨元の同名カードは、明示 scope なしでは追加先 host 候補にしない", () => {
    const leaver = leaverCard("leaver", 3);
    const soulHost = hostCard("soul-host", 0);
    const underHost = hostCard("under-host", 0);
    const container = leaverCard("container", 2);
    container.underCards = [
      { cardInstanceId: "under-host", role: "advent_source" as const },
    ];
    const state = createEmptyGameState({
      cardInstances: [leaver, soulHost, underHost, container],
      playerOverrides: [{ soulStateInstanceIds: ["soul-host"] }, {}],
    });
    state.pendingLeaveEntities = [pendingDestroy("leaver", BOB)];
    state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];

    const after = flushPendingLeaves(state, getDef, ["purple"]);

    expect(after.pendingAdventSourceReplacement).toMatchObject({
      cardInstanceId: "leaver",
      candidateHostInstanceIds: [],
    });
    expect(getCard(after, "leaver").zone).toBe("field");
  });
});

// ════════════════════════════════════════════════════════════════
// legal-actions 配線 (engine batch2-3): pendingAdventSourceReplacement を
// 本番経路 getLegalActions / applyLegalAction で最終盤面まで解決する。
// これがないとコントローラーに合法手が無く deadlock する (batch2-2 の gap)。
// ════════════════════════════════════════════════════════════════

const noLookups = { getCardDefinitionById: getDef } as const;

/** flushPendingLeaves で pendingAdventSourceReplacement を立てた state を返す共通 setup。 */
function withSingleHostPending(): GameState {
  const leaver = leaverCard("leaver", 3);
  const host = hostCard("host", 2);
  const state = createEmptyGameState({
    cardInstances: [leaver, host],
    playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
  });
  state.pendingLeaveEntities = [pendingDestroy("leaver", BOB)];
  state.activeContinuousEffects = [adventSourceReplacementCE("leaver")];
  const afterFlush = flushPendingLeaves(state, getDef, ["purple"]);
  expect(afterFlush.pendingAdventSourceReplacement).not.toBeNull();
  return afterFlush;
}

describe("advent_source 離脱置換: legal-actions 配線で解決 (deadlock 解消)", () => {
  it("(1) 選択プレイヤーに resolve_advent_source_replacement が host 候補つきで提示される", () => {
    const state = withSingleHostPending();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const resolveActions = actions.filter(
      (a) => a.kind === "resolve_advent_source_replacement"
    );
    // advent_source(host1 つ) + trash = 2 アクション。
    expect(resolveActions).toHaveLength(2);

    const addAction = resolveActions.find(
      (a) => (a as { choice?: string }).choice === "advent_source"
    );
    expect(addAction).toBeDefined();
    expect(addAction).toMatchObject({
      kind: "resolve_advent_source_replacement",
      actingPlayerId: ALICE,
      cardInstanceId: "leaver",
      choice: "advent_source",
      hostInstanceId: "host",
      candidateHostInstanceIds: ["host"],
    });

    const trashAction = resolveActions.find(
      (a) => (a as { choice?: string }).choice === "trash"
    );
    expect(trashAction).toBeDefined();
    expect((trashAction as { hostInstanceId?: string }).hostInstanceId).toBe(
      undefined
    );
    // pending がある限り常に解決手が存在する (= no deadlock)。
    expect(resolveActions.length).toBeGreaterThan(0);
  });

  it("(2) choice=advent_source + host を適用すると煌臨元へ追加され pending が解消する", () => {
    const state = withSingleHostPending();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const addAction = actions.find(
      (a) =>
        a.kind === "resolve_advent_source_replacement" &&
        (a as { choice?: string }).choice === "advent_source"
    )!;
    const applied = applyLegalAction({
      state,
      action: addAction,
      ...noLookups,
    });

    expect(applied.state.pendingAdventSourceReplacement).toBeNull();
    const leaverAfter = getCard(applied.state, "leaver");
    // host の煌臨元に積まれフィールドを離れた (off field = advent-source role)。
    expect(adventSourceIdsOf(getCard(applied.state, "host"))).toContain(
      "leaver"
    );
    expect(leaverAfter.zoneRoleName).toBe("advent-source");
    expect(leaverAfter.zone).not.toBe("trash");
    expect(leaverAfter.pendingLeaveKind).toBeNull();
    expect(applied.state.pendingLeaveEntities).toHaveLength(0);
    // コアはリザーブへ退避。
    expect(alice(applied.state).reserveNormalCoreCount).toBe(3);
  });

  it("(3) choice=trash を適用するとカードはトラッシュへ流れ pending が解消する", () => {
    const state = withSingleHostPending();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const trashAction = actions.find(
      (a) =>
        a.kind === "resolve_advent_source_replacement" &&
        (a as { choice?: string }).choice === "trash"
    )!;
    const applied = applyLegalAction({
      state,
      action: trashAction,
      ...noLookups,
    });

    // pending は解消し、applyLegalAction の安定点 flush で通常トラッシュへ流れる。
    expect(applied.state.pendingAdventSourceReplacement).toBeNull();
    expect(applied.state.pendingLeaveEntities).toHaveLength(0);
    const leaverAfter = getCard(applied.state, "leaver");
    expect(leaverAfter.zone).toBe("trash");
    expect(adventSourceIdsOf(getCard(applied.state, "host"))).not.toContain(
      "leaver"
    );
  });

  it("(3b) choice=advent_source の attach 失敗 fallback は再提示せずトラッシュへ流す", () => {
    const pending = withSingleHostPending();
    const staleHostState: GameState = {
      ...pending,
      cardInstances: pending.cardInstances.map((card) =>
        card.instanceId === "host" ? { ...card, zone: "trash" } : card
      ),
    };
    const addAction = getLegalActions({
      state: staleHostState,
      actingPlayerId: ALICE,
      ...noLookups,
    }).find(
      (a) =>
        a.kind === "resolve_advent_source_replacement" &&
        (a as { choice?: string }).choice === "advent_source"
    )!;
    const applied = applyLegalAction({
      state: staleHostState,
      action: addAction,
      ...noLookups,
    });

    expect(applied.state.pendingAdventSourceReplacement).toBeNull();
    expect(applied.state.pendingLeaveEntities).toHaveLength(0);
    const leaverAfter = getCard(applied.state, "leaver");
    expect(leaverAfter.zone).toBe("trash");
    expect(leaverAfter.pendingLeaveKind).toBeNull();
    expect(
      applied.state.log.some((entry) =>
        entry.startsWith("advent-source-replacement:trash-fallback:leaver")
      )
    ).toBe(true);
  });

  it("(4) 選択プレイヤーでない相手には resolve_advent_source_replacement が出ない", () => {
    const state = withSingleHostPending();
    const bobActions = getLegalActions({
      state,
      actingPlayerId: BOB,
      ...noLookups,
    });
    expect(
      bobActions.filter((a) => a.kind === "resolve_advent_source_replacement")
    ).toHaveLength(0);
    // prompt resolver gate により相手には一切のアクションが返らない。
    expect(bobActions).toHaveLength(0);
  });

  it("(5) 複数 host: 候補リストが全 host を保持し、選んだ host のみ受け取る", () => {
    const leaver = leaverCard("leaver", 3);
    const hostA = hostCard("host-a", 2);
    const hostB = hostCard("host-b", 1);
    const state0 = createEmptyGameState({
      cardInstances: [leaver, hostA, hostB],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state0.pendingLeaveEntities = [pendingDestroy("leaver", BOB)];
    state0.activeContinuousEffects = [adventSourceReplacementCE("leaver")];
    const state = flushPendingLeaves(state0, getDef, ["purple"]);
    expect(
      state.pendingAdventSourceReplacement!.candidateHostInstanceIds.sort()
    ).toEqual(["host-a", "host-b"]);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const addActions = actions.filter(
      (a) =>
        a.kind === "resolve_advent_source_replacement" &&
        (a as { choice?: string }).choice === "advent_source"
    );
    // host ごとに 1 アクション (= 2)。各 action は候補リスト全体を保持。
    expect(addActions).toHaveLength(2);
    for (const a of addActions) {
      expect(
        (a as { candidateHostInstanceIds: string[] }).candidateHostInstanceIds
          .slice()
          .sort()
      ).toEqual(["host-a", "host-b"]);
    }

    // host-b を選択 → host-b のみ leaver を受け取る。
    const pickB = addActions.find(
      (a) => (a as { hostInstanceId?: string }).hostInstanceId === "host-b"
    )!;
    const applied = applyLegalAction({ state, action: pickB, ...noLookups });
    expect(applied.state.pendingAdventSourceReplacement).toBeNull();
    expect(adventSourceIdsOf(getCard(applied.state, "host-b"))).toContain(
      "leaver"
    );
    expect(adventSourceIdsOf(getCard(applied.state, "host-a"))).not.toContain(
      "leaver"
    );
  });
});

describe("複数体の煌臨元置換を順に選択する", () => {
  it.each(
    [false, true].flatMap((twoPlayers) =>
      (["advent_source", "trash"] as const).flatMap((first) =>
        (["advent_source", "trash"] as const).map((second) => ({
          twoPlayers,
          first,
          second,
        }))
      )
    )
  )("両者=$twoPlayers 選択=$first/$second", ({ twoPlayers, first, second }) => {
    const secondOwner = twoPlayers ? BOB : ALICE;
    let state = createEmptyGameState({
      cardInstances: [
        leaverCard("one"),
        leaverCard("two", 3, {
          ownerPlayerId: secondOwner,
          controllerPlayerId: secondOwner,
        }),
        hostCard("host-one"),
        {
          ...hostCard("host-two"),
          ownerPlayerId: secondOwner,
          controllerPlayerId: secondOwner,
        },
      ],
    });
    state.activeContinuousEffects = [
      adventSourceReplacementCE("one"),
      { ...adventSourceReplacementCE("two"), actingPlayerId: secondOwner },
    ];
    state.pendingLeaveEntities = [
      pendingDestroy("one"),
      pendingDestroy("two", twoPlayers ? ALICE : BOB),
    ];
    state = flushPendingLeaves(state, getDef);
    expect(state.pendingLeaveEntities).toHaveLength(2);
    state = flushPendingLeaves(state, getDef);
    expect(state.pendingLeaveEntities).toHaveLength(2);
    for (const [index, choice] of [first, second].entries()) {
      const id = index === 0 ? "one" : "two";
      const owner = index === 0 ? ALICE : secondOwner;
      expect(state.pendingAdventSourceReplacement?.cardInstanceId).toBe(id);
      const action = getLegalActions({
        state,
        actingPlayerId: owner,
        ...noLookups,
      }).find(
        (a) =>
          a.can &&
          a.kind === "resolve_advent_source_replacement" &&
          a.choice === choice
      );
      expect(action).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...noLookups }).state;
      expect(getCard(state, id).zoneRoleName === "advent-source").toBe(
        choice === "advent_source"
      );
      if (choice === "trash") expect(getCard(state, id).zone).toBe("trash");
      if (index === 0)
        expect(getCard(state, "two")).toMatchObject({
          zone: "field",
          normalCoreCount: 3,
          pendingLeaveKind: "destroy",
        });
    }
    expect(state.pendingLeaveEntities).toEqual([]);
    expect(state.pendingAdventSourceReplacement).toBeNull();
  });
});
