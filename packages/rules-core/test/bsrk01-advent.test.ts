/**
 * BSRK01 (るろうに剣心) 煌臨カードの adventData 配線検証。
 *
 * BSRK01 の【契約煌臨】4 枚 (すべて「緋村 剣心」契約スピリット) を adventData へ変換:
 * - BSRK01-C04 [黒笠編]緋村 剣心   : contract / own_turn / count gate なし
 * - BSRK01-M01 [最後の修行]緋村 剣心 : contract / both_attack_step / C4以上
 * - BSRK01-R03 [御庭番衆編]緋村 剣心 : contract / both_attack_step / C2以上
 * - BSRK01-X02 [京都動乱編]緋村 剣心 : contract / own_turn / C8以上
 *
 * 本テストの主眼は INTEGRATION: 実カードデータ (BSRK01-C04) を手札に、実カード
 * (BSRK01-CX01 緋村 剣心, cost2 スピリット) をフィールド煌臨先に置き、
 * getLegalActions → declare_advent → applyLegalAction の production 経路で
 *   (1) 煌臨カードが煌臨先の上に重なる (overlay)
 *   (2) ソウルコアが soulCoreDest=trash へ消費される
 *   (3) 『煌臨時』(card_event:advent) が誘発し『召喚時』(summon) は誘発しない
 * ことを実データで確認する。C04 は『煌臨時』ボイド→リザーブ core_move を持ち
 * 『召喚時』を持たないため、advent/summon の弁別がきれいに観測できる。
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
import type {
  CardDefinition,
  GameState,
  LegalAction,
  PlayerState,
} from "../src";
import { executeAdvent } from "../src/mechanics/advent-system";
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

// ---------------------------------------------------------------------------
// INTEGRATION: 実カードで declare_advent 経路を行使する
// ---------------------------------------------------------------------------

const ADVENT_NO = "BSRK01-C04"; // [黒笠編]緋村 剣心 (契約煌臨, minCost なし)
const HOST_NO = "BSRK01-CX01"; // 緋村 剣心 (cost2 スピリット, 煌臨先)
const SOURCE_NO = "BSRK01-C02"; // 任意コア配置のフィールド側供給元

/**
 * ALICE の手札に BSRK01-C04、フィールドに BSRK01-CX01 (煌臨先) を置く。
 * BSRK01-C04 は contract 煌臨。HOST はコアを載せた通常スピリット (魂状態ではない)
 * なので getContractAdventTargets の normalTargets 経由で煌臨できる。
 */
function buildState(
  opts: {
    adventNo?: string;
    hostNo?: string;
    countValue?: number;
    soulCoreLocation?: PlayerState["soulCoreLocation"] | "none";
    soulStateHost?: boolean;
  } = {}
): GameState {
  const hostNo = opts.hostNo ?? HOST_NO;
  const adventNo = opts.adventNo ?? ADVENT_NO;
  const host = createCardInstance(card(hostNo), {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: opts.soulStateHost === true ? 0 : 2,
  });
  const advent = createCardInstance(card(adventNo), {
    instanceId: "advent-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const source = createCardInstance(card(SOURCE_NO), {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 3,
  });
  const soulCoreLocation =
    opts.soulCoreLocation === "none"
      ? null
      : (opts.soulCoreLocation ?? ({ kind: "reserve" } as const));
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation,
        countValue: opts.countValue ?? 0,
        reserveNormalCoreCount: opts.soulStateHost === true ? 2 : undefined,
        soulStateInstanceIds: opts.soulStateHost === true ? ["host-1"] : [],
        contractCardNo: opts.soulStateHost === true ? hostNo : undefined,
      },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances:
      opts.soulStateHost === true ? [host, source, advent] : [host, advent],
  };
}

function asOpponentBattleFlash(state: GameState): GameState {
  return {
    ...state,
    activePlayerId: BOB,
    step: "attack",
    window: "flash_before_block",
    activeAttack: {
      attackId: "attack-1",
      primaryEntityId: "bob-attacker",
      participantEntityIds: ["bob-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [],
      symbolResolutionOrder: ["bob-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    },
  };
}

function findAdventDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    ...effectLookups,
  });
  return actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
  );
}

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}
function getPlayer(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

function resolvePendingEffectTarget(
  state: GameState,
  targetInstanceIds: string[],
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: state.pendingEffectTargetSelection!.actingPlayerId,
    getCardDefinitionById: getCardDefinitionByIdFn,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const resolveAction = actions.find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_effect_target" }> =>
      a.kind === "resolve_pending_effect_target"
  );
  expect(resolveAction).toBeDefined();
  for (const id of targetInstanceIds) {
    expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
  }
  return (
    applyLegalAction({
      state,
      action: resolveAction!,
      targetInstanceIds,
      getCardDefinitionById: getCardDefinitionByIdFn,
      ...extraOptions,
    } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
  ).state;
}

function resolvePendingAsIfSoulCoreChoice(
  state: GameState,
  choiceId: string,
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const pending = state.pendingAsIfSoulCoreChoice;
  expect(pending).not.toBeNull();
  const actions = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById: getCardDefinitionByIdFn,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const resolveAction = actions.find(
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
  return (
    applyLegalAction({
      state,
      action: resolveAction!,
      getCardDefinitionById: getCardDefinitionByIdFn,
      ...extraOptions,
    } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
  ).state;
}

/**
 * P3-112: declare_advent は今やスタック窓を開く（apply 即時解決ではない）。
 * responder のパスで窓を閉じ、deferred 解決（ソウルコア消費＋重ね）まで進める。
 */
function passStackWindowOnly(
  state: GameState,
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  let current = state;
  let guard = 0;
  while (
    (current.stackWindow ||
      current.activeAttack?.flashWindowState?.pendingStackAction) &&
    guard++ < 10
  ) {
    const responderId =
      current.stackWindow?.priorityPlayerId ??
      current.activeAttack!.flashWindowState!.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getCardDefinitionByIdFn,
      ...extraOptions,
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find(
      (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
    );
    if (!pass) {
      throw new Error(
        `pass_stack/pass_battle_flash for ${responderId} not found`
      );
    }
    current = (
      applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById: getCardDefinitionByIdFn,
        ...extraOptions,
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }
  return current;
}

function passStackUntilClosed(
  state: GameState,
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {},
  targetInstanceIds: string[] = ["host-1"],
  asIfChoiceId = "alternate"
): GameState {
  let current = passStackWindowOnly(
    state,
    getCardDefinitionByIdFn,
    extraOptions
  );
  if (current.pendingAsIfSoulCoreChoice !== null) {
    current = resolvePendingAsIfSoulCoreChoice(
      current,
      asIfChoiceId,
      getCardDefinitionByIdFn,
      extraOptions
    );
  }
  if (current.pendingEffectTargetSelection !== null) {
    current = resolvePendingEffectTarget(
      current,
      targetInstanceIds,
      getCardDefinitionByIdFn,
      extraOptions
    );
  }
  return current;
}

describe("INTEGRATION: BSRK01-C04 を実データで煌臨させる (declare_advent 経路)", () => {
  it("メインステップで declare_advent が legal になり adventMode='contract'", () => {
    const state = buildState();
    const decl = findAdventDeclaration(state);
    expect(decl).toBeDefined();
    expect(decl!.adventMode).toBe("contract");
    expect(decl!.soulCoreDest).toBe("trash");
    // cost2 の通常スピリット先 host-1 が候補に含まれる (minCost 印字なし)
    expect(decl!.candidateTargetInstanceIds).toContain("host-1");
  });

  it("ソウルコアが無ければ declare_advent は出ない", () => {
    expect(
      findAdventDeclaration(buildState({ soulCoreLocation: "none" }))
    ).toBeUndefined();
  });

  it("BSRK01-C04 / BSRK01-X02 は相手ターンのフラッシュ窓では契約煌臨できない", () => {
    for (const adventNo of ["BSRK01-C04", "BSRK01-X02"]) {
      const state = asOpponentBattleFlash(
        buildState({ adventNo, hostNo: "BSRK01-X02", countValue: 8 })
      );
      expect(findAdventDeclaration(state)).toBeUndefined();
    }
  });

  it("BSRK01-M01 / BSRK01-R03 / BSRK01-X02 の Cn以上は declareCondition count gate で判定される", () => {
    const m01Below = asOpponentBattleFlash(
      buildState({ adventNo: "BSRK01-M01", countValue: 3 })
    );
    const m01At = asOpponentBattleFlash(
      buildState({ adventNo: "BSRK01-M01", countValue: 4 })
    );
    expect(findAdventDeclaration(m01Below)).toBeUndefined();
    expect(findAdventDeclaration(m01At)).toBeDefined();

    const r03Below = asOpponentBattleFlash(
      buildState({ adventNo: "BSRK01-R03", countValue: 1 })
    );
    const r03At = asOpponentBattleFlash(
      buildState({ adventNo: "BSRK01-R03", countValue: 2 })
    );
    expect(findAdventDeclaration(r03Below)).toBeUndefined();
    expect(findAdventDeclaration(r03At)).toBeDefined();

    expect(
      findAdventDeclaration(
        buildState({ adventNo: "BSRK01-X02", countValue: 7 })
      )
    ).toBeUndefined();
    expect(
      findAdventDeclaration(
        buildState({ adventNo: "BSRK01-X02", countValue: 8 })
      )
    ).toBeDefined();
  });

  it("適用後: overlay + ソウルコア trash 消費 + 『煌臨時』誘発 (『召喚時』は不発)", () => {
    const state = buildState();
    const decl = findAdventDeclaration(state)!;

    const result = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["host-1"],
      getCardDefinitionById,
      ...effectLookups,
    });
    const newState = passStackUntilClosed(
      result.state,
      getCardDefinitionById,
      effectLookups
    );

    // (1) overlay: 煌臨カードがフィールドに移り host-1 を煌臨元に持つ
    const adv = getCard(newState, "advent-1");
    expect(adv.zone).toBe("field");
    expect(adv.zoneRoleName).toBe("spirit");
    expect(adventSourceIdsOf(adv)).toContain("host-1");
    // 煌臨先は煌臨元になる
    expect(getCard(newState, "host-1").zoneRoleName).toBe("advent-source");

    // (2) ソウルコア消費 (soulCoreDest=trash) + 手札減
    expect(getPlayer(newState, ALICE).soulCoreLocation).toEqual({
      kind: "trash",
    });
    expect(getPlayer(newState, ALICE).handCount).toBe(0);

    // (3) 『煌臨時』(card_event:advent) が誘発し『召喚時』(summon) は誘発しない
    //     C04 の『煌臨時』はボイド→リザーブの core_move (1 効果)。
    const advPendings = newState.pendingTriggeredEffects.filter(
      (p) => p.relatedInstanceId === "advent-1"
    );
    expect(advPendings.length).toBeGreaterThan(0);
    expect(advPendings.every((p) => p.eventKind === "advent")).toBe(true);
    expect(
      newState.pendingTriggeredEffects.some(
        (p) => p.eventKind === "summon" && p.relatedInstanceId === "advent-1"
      )
    ).toBe(false);
  });

  it("BSRK01-CX01 の魂状態に BSRK01-C04 を契約煌臨すると任意コア配置 pending が生成される", () => {
    const state = buildState({ soulStateHost: true });
    const decl = findAdventDeclaration(state)!;
    expect(decl.adventMode).toBe("contract");
    expect(decl.candidateTargetInstanceIds).toContain("host-1");

    const result = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["host-1"],
      getCardDefinitionById,
      ...effectLookups,
    });
    const newState = passStackUntilClosed(
      result.state,
      getCardDefinitionById,
      effectLookups
    );

    const adv = getCard(newState, "advent-1");
    expect(adv.zone).toBe("field");
    expect(adventSourceIdsOf(adv)).toContain("host-1");
    expect(getPlayer(newState, ALICE).soulStateInstanceIds).not.toContain(
      "host-1"
    );

    const pending = newState.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.fromKind).toBe("any_movable");
    expect(pending!.actingPlayerId).toBe(ALICE);
    expect(pending!.candidates.map((c) => c.instanceId)).toEqual(["advent-1"]);
    expect(pending!.totalNormalCores).toBe(5);
    expect(pending!.sourceAvailable?.["reserve"]).toBe(2);
    expect(pending!.sourceAvailable?.["field:source-1"]).toBe(3);
    expect(pending!.minTotal ?? 0).toBe(0);
  });

  it("BSRK01-X02 は魂状態の BSRK01-CX01 に count7 では不可、count8 では契約煌臨できる", () => {
    const below = buildState({
      adventNo: "BSRK01-X02",
      countValue: 7,
      soulStateHost: true,
    });
    expect(findAdventDeclaration(below)).toBeUndefined();

    const after = executeAdvent(
      below,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "host-1",
        adventData: card("BSRK01-X02").adventData!,
        isContractAdvent: true,
      },
      getCardDefinitionById
    );
    expect(after).toBe(below);
    expect(after.log).toContain("advent:advent-1:declare-condition-not-met");

    const at = buildState({
      adventNo: "BSRK01-X02",
      countValue: 8,
      soulStateHost: true,
    });
    const decl = findAdventDeclaration(at)!;
    expect(decl.adventMode).toBe("contract");
    expect(decl.candidateTargetInstanceIds).toContain("host-1");
  });
});

describe("BSRK01-M01 [3]代替コスト煌臨 — 相手のアタックステップで自分のカウント6以上ならソウルコア無しで契約煌臨できる", () => {
  it("カウント6未満・ソウルコア無しでは相手のアタックステップ中でも declare_advent は出ない", () => {
    const state = asOpponentBattleFlash(
      buildState({
        adventNo: "BSRK01-M01",
        countValue: 5,
        soulCoreLocation: "none",
      })
    );
    expect(findAdventDeclaration(state)).toBeUndefined();
  });

  it("カウント6以上・ソウルコア無しで相手のアタックステップ中に declare_advent が legal になる", () => {
    const state = asOpponentBattleFlash(
      buildState({
        adventNo: "BSRK01-M01",
        countValue: 6,
        soulCoreLocation: "none",
      })
    );
    const decl = findAdventDeclaration(state);
    expect(decl).toBeDefined();
    expect(decl!.candidateTargetInstanceIds).toContain("host-1");
  });

  it("適用後: ソウルコアは実消費されず(元々null)、overlay成立、usedAlternateCostAdventKeysThisTurnに記録され、同ターン中は同名の別インスタンスでも代替コスト経路が再度出ない", () => {
    const state = asOpponentBattleFlash(
      buildState({
        adventNo: "BSRK01-M01",
        countValue: 6,
        soulCoreLocation: "none",
      })
    );
    const decl = findAdventDeclaration(state)!;
    const result = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["host-1"],
      getCardDefinitionById,
      ...effectLookups,
    });
    const newState = passStackUntilClosed(
      result.state,
      getCardDefinitionById,
      effectLookups
    );

    const adv = getCard(newState, "advent-1");
    expect(adv.zone).toBe("field");
    expect(adventSourceIdsOf(adv)).toContain("host-1");
    expect(getPlayer(newState, ALICE).soulCoreLocation).toBeNull();
    expect(newState.usedAlternateCostAdventKeysThisTurn).toContain(
      `name:${card("BSRK01-M01").name}`
    );

    const secondCopy = createCardInstance(card("BSRK01-M01"), {
      instanceId: "advent-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const withSecondCopy: GameState = {
      ...newState,
      cardInstances: [...newState.cardInstances, secondCopy],
    };
    const secondActions = getLegalActions({
      state: withSecondCopy,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    });
    expect(
      secondActions.find(
        (a) => a.kind === "declare_advent" && a.sourceInstanceId === "advent-2"
      )
    ).toBeUndefined();
  });

  it("ソウルコアを所持していても、相手のアタックステップ+カウント6以上では窓後に通常経路と代替コスト経路が並立する", () => {
    const state = asOpponentBattleFlash(
      buildState({
        adventNo: "BSRK01-M01",
        countValue: 6,
        soulCoreLocation: { kind: "reserve" },
      })
    );
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    }).filter(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
    );
    expect(actions).toHaveLength(1);

    const declared = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(declared.pendingAsIfSoulCoreChoice).toBeNull();

    const afterStack = passStackWindowOnly(
      declared,
      getCardDefinitionById,
      effectLookups
    );
    expect(afterStack.pendingAsIfSoulCoreChoice).toMatchObject({
      actionKind: "declare_advent",
      actingPlayerId: ALICE,
    });
    expect(
      afterStack.pendingAsIfSoulCoreChoice!.options.map(
        (option) => option.choiceId
      )
    ).toEqual(["normal", "alternate"]);

    const afterChoice = resolvePendingAsIfSoulCoreChoice(
      afterStack,
      "normal",
      getCardDefinitionById,
      effectLookups
    );
    const resolved = resolvePendingEffectTarget(
      afterChoice,
      ["host-1"],
      getCardDefinitionById,
      effectLookups
    );
    expect(resolved.pendingAsIfSoulCoreChoice).toBeNull();
    expect(getCard(resolved, "advent-1").zone).toBe("field");
  });
});
