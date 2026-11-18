/**
 * FIDELITY 再変換テスト (autorun w1): 新エンジン能力で再変換した煌臨/転醒カードの回帰防止。
 *
 * 対象:
 *  - 煌臨 adventData 宣言の再変換 (declare_advent 配線済み):
 *      BSAZ01-X01 / BSAZ01-X02 (通常煌臨), BSTH01-XX02 (通常煌臨, tribes 博麗 + minCost6),
 *      BSTH02-X05 (通常煌臨, tribes 幻想 + minCost5), BSTH02-XX01 (通常煌臨, tribes 幻想)
 *  - 転醒 flip のカウント+1 (BSSA01-転醒X01(B) / X02(B) / X03(B) / X04(B)):
 *      『この面に裏返ったとき、フィールドに残り、カウント+1する』は
 *      ルール (08a §2 手順3、効果ではない) であり executeRebirth が適用する。
 *      effects に boilerplate を持たないこと (二重計上回帰防止) と、
 *      flip + 誘発解決後にカウントが「ちょうど 1」であることを検証する。
 *      純正に印字された『転醒時』効果 (X02(B)/X03(B) の stub) のみ pending 化される。
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
  executeBattleResolution,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
  getLegalActions,
  getStrongestDefenseLevel,
  rebuildContinuousEffectsFromField,
} from "../src";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
} from "../src/effect/trigger-system";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { adventSourceIdsOf } from "../src/model";
import type {
  ActiveAttack,
  CardDefinition,
  CardInstance,
  GameState,
  LegalAction,
  PlayerState,
  RebirthAction,
} from "../src";

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
// 静的検証: 再変換した煌臨カードが印字どおりの adventData を持つ
// ---------------------------------------------------------------------------

describe("FIDELITY: 再変換した煌臨カードの adventData", () => {
  it.each([
    ["BSAZ01-X01", "both_attack_step", undefined, undefined, "スレイプニール"],
    ["BSAZ01-X02", "own_turn", undefined, undefined, "スレイプニール"],
    ["BSTH01-XX02", "own_turn", 6, "博麗", undefined],
    ["BSTH02-X05", "both_attack_step", 5, "幻想", undefined],
    ["BSTH02-XX01", "both_attack_step", undefined, "幻想", undefined],
  ] as const)(
    "%s は normal 煌臨 / timing=%s / minCost=%s / tribe=%s / name=%s",
    (no, timing, minCost, tribe, cardName) => {
      const ad = card(no).adventData;
      expect(ad, `${no} must have adventData`).toBeDefined();
      expect(ad!.adventVariant ?? "normal").toBe("normal");
      expect(ad!.adventTiming).toBe(timing);
      // スピリットなのでソウルコアはトラッシュへ (08a:24)
      expect(ad!.soulCoreDest).toBe("trash");
      expect(ad!.adventCondition.targetCategory).toEqual(["spirit"]);
      if (minCost === undefined) {
        expect(ad!.adventCondition.minCost).toBeUndefined();
      } else {
        expect(ad!.adventCondition.minCost).toBe(minCost);
      }
      if (tribe === undefined) {
        expect(ad!.adventCondition.tribes).toBeUndefined();
      } else {
        expect(ad!.adventCondition.tribes).toEqual([tribe]);
      }
      if (cardName === undefined) {
        expect(ad!.adventCondition.cardNames).toBeUndefined();
      } else {
        expect(ad!.adventCondition.cardNames).toContainEqual({
          contains: cardName,
        });
      }
    }
  );

  it("煌臨宣言の stub effect (煌臨メカニクス未対応) は削除済み", () => {
    for (const no of [
      "BSAZ01-X01",
      "BSAZ01-X02",
      "BSTH01-XX02",
      "BSTH02-X05",
      "BSTH02-XX01",
    ]) {
      const c = card(no);
      const declStub = (c.effects ?? []).find(
        (e) =>
          typeof e.stub === "string" &&
          (e.stub.includes("煌臨システムへの個別配線は未対応") ||
            e.stub.includes("煌臨メカニクス未対応") ||
            e.stub.includes("煌臨メカニズム"))
      );
      expect(declStub, `${no} に旧 煌臨宣言 stub が残っている`).toBeUndefined();
    }
  });

  it("『煌臨/アタック時』効果は card_event に advent を含む (BSTH02-X05/XX01)", () => {
    for (const no of ["BSTH02-X05", "BSTH02-XX01"]) {
      const adventTimed = (card(no).effects ?? []).filter(
        (e) =>
          e.timing.kind === "card_event" &&
          (Array.isArray(e.timing.event)
            ? e.timing.event.includes("advent")
            : e.timing.event === "advent")
      );
      expect(
        adventTimed.length,
        `${no} に advent timing 効果が無い`
      ).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// INTEGRATION: 通常煌臨 (own_turn) を実データで declare_advent → 適用
// BSAZ01-X02 [最終決戦]スレイプニール (normal, own_turn)
// 煌臨先: BSAZ01 の cost3 以上の通常スピリット
// ---------------------------------------------------------------------------

const ADVENT_NO = "BSAZ01-X02";

function findSpiritHost(): string {
  // BSAZ01-X02 の煌臨条件 (cardNames:「スレイプニール」) を満たすフィールドスピリットを
  // 煌臨先に使う。スレイプニール系スピリットはトラッシュ起点煌臨 (C01/C02) を含め
  // 全て adventData を持つようになったので「advent でないもの」では絞れない。
  // 煌臨先は単に同名のフィールドスピリットであればよい (advent カード自身も対象になり得る)。
  const host = ALL_CARDS.find(
    (c) =>
      c.cardNo.startsWith("BSAZ01-") &&
      c.printedCategory === "spirit" &&
      c.name.includes("スレイプニール") &&
      c.cardNo !== ADVENT_NO &&
      !c.isDoubleSided
  );
  if (!host) throw new Error("BSAZ01 spirit host not found");
  return host.cardNo;
}

function findNonSleipnirSpiritHost(): string {
  const host = ALL_CARDS.find(
    (c) =>
      c.printedCategory === "spirit" &&
      !c.name.includes("スレイプニール") &&
      !c.isDoubleSided
  );
  if (!host) throw new Error("non-Sleipnir spirit host not found");
  return host.cardNo;
}

function buildAdventState(
  opts: {
    hostNo?: string;
    soulCoreLocation?: PlayerState["soulCoreLocation"] | "none";
  } = {}
): { state: GameState; hostNo: string } {
  const hostNo = opts.hostNo ?? findSpiritHost();
  const host = createCardInstance(card(hostNo), {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const advent = createCardInstance(card(ADVENT_NO), {
    instanceId: "advent-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const soulCoreLocation =
    opts.soulCoreLocation === "none"
      ? null
      : (opts.soulCoreLocation ?? ({ kind: "reserve" } as const));
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [{ handCount: 1, soulCoreLocation, countValue: 0 }, {}],
  });
  return {
    state: {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, advent],
    },
    hostNo,
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

describe("INTEGRATION: BSAZ01-X02 通常煌臨を実データで宣言・適用する", () => {
  it("自分のメインステップで declare_advent が legal で adventMode='normal'", () => {
    const { state } = buildAdventState();
    const decl = findAdventDeclaration(state);
    expect(decl).toBeDefined();
    expect(decl!.adventMode).toBe("normal");
    expect(decl!.soulCoreDest).toBe("trash");
    expect(decl!.candidateTargetInstanceIds).toContain("host-1");
  });

  it("名前条件『スレイプニール』を満たさないスピリットは煌臨先に出ない", () => {
    const { state } = buildAdventState({
      hostNo: findNonSleipnirSpiritHost(),
    });
    expect(findAdventDeclaration(state)).toBeUndefined();
  });

  it("『自分のターン』なので相手ターンのフラッシュ/スタック窓では declare_advent が出ない", () => {
    const { state } = buildAdventState();
    const opponentTurnFlash: GameState = {
      ...state,
      activePlayerId: BOB,
      step: "attack",
      window: "flash_before_block",
    };
    expect(findAdventDeclaration(opponentTurnFlash)).toBeUndefined();
  });

  it("ソウルコアが無ければ declare_advent は出ない", () => {
    const { state } = buildAdventState({ soulCoreLocation: "none" });
    expect(findAdventDeclaration(state)).toBeUndefined();
  });

  it("適用後: overlay + ソウルコア trash 消費 + 手札減", () => {
    const { state } = buildAdventState();
    const decl = findAdventDeclaration(state)!;
    const result = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["host-1"],
      getCardDefinitionById,
      ...effectLookups,
    });
    // P3-112: 発揮宣言はスタック窓を開くのみ。相手のパス (pending 消化) で deferred 解決へ進める。
    const newState = drainAllPendings(result.state, {
      getCardDefinitionById,
      ...effectLookups,
    });

    const adv = getCard(newState, "advent-1");
    expect(adv.zone).toBe("field");
    expect(adv.zoneRoleName).toBe("spirit");
    expect(adventSourceIdsOf(adv)).toContain("host-1");
    expect(getCard(newState, "host-1").zoneRoleName).toBe("advent-source");

    expect(getPlayer(newState, ALICE).soulCoreLocation).toEqual({
      kind: "trash",
    });
    expect(getPlayer(newState, ALICE).handCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 転醒 B 面: flip のカウント+1 はルール (executeRebirth)。boilerplate は効果化しない。
// ---------------------------------------------------------------------------

function buildProductionLookups(defs: readonly CardDefinition[]) {
  const expanded = expandCardDefinitionsWithBackFaces(defs);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  return {
    getCardDefinitionById: (id: string) => map.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(expanded),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(expanded),
  };
}

function flipToBack(frontNo: string, backNo: string, withAdventSource = false) {
  const lookups = buildProductionLookups(ALL_CARDS);
  const front = lookups.getCardDefinitionById(frontNo);
  expect(front, `${frontNo} must resolve`).toBeDefined();
  expect(front!.isDoubleSided).toBe(true);
  expect(front!.backFace?.cardNo).toBe(backNo);

  const inst = createCardInstance(front!, {
    instanceId: "tr-1",
    ownerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 3,
  });
  if (withAdventSource) {
    inst.underCards = [
      { cardInstanceId: "advent-src-1", role: "advent_source" },
    ];
  }
  const cardInstances = [inst];
  if (withAdventSource) {
    cardInstances.push(
      createCardInstance(front!, {
        instanceId: "advent-src-1",
        ownerPlayerId: "alice",
        zone: "field",
      })
    );
  }
  const before: GameState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances,
  });
  // A 面 rebirth は maxCount:5 (カウント5以下)。countValue=0 なので条件成立。
  const action: RebirthAction = {
    kind: "rebirth",
    maxCount: 5,
    triggerDescription: "",
  };
  const after = executeRebirth(
    before,
    "alice",
    action,
    "tr-1",
    lookups.getCardDefinitionById,
    "test:autorun-w1-advent-rebirth-fidelity:360"
  );
  return { before, after, lookups };
}

describe("FIDELITY: BSSA01 転醒 flip — カウント+1 はルール、boilerplate は効果化しない", () => {
  // 期待 pending 数: 純正に印字された『転醒時』効果を持つ B 面のみ 1 件。
  //   X01(B)/X04(B): 前面テキスト内の「合体するか、コア1個を置いてスピリット状態にする」
  //   post-choice は A 面【転醒】内蔵処理であり、B 面 card_event:"rebirth" ではない → 0 件。
  //   X02(B): [2,3]『このブレイヴの転醒時』(stub) / X03(B): [2,3]『転醒/アタック時』
  //   (【煌臨中】ゲート要、2026-07-11実装済のため flipToBack に煌臨元を付与して検証)
  //   → 1 件 (boilerplate の count_increase は queue されない)。
  it.each([
    ["BSSA01-転醒X01(A)", "BSSA01-転醒X01(B)", 0, false],
    ["BSSA01-転醒X02(A)", "BSSA01-転醒X02(B)", 1, false],
    ["BSSA01-転醒X03(A)", "BSSA01-転醒X03(B)", 1, true],
    ["BSSA01-転醒X04(A)", "BSSA01-転醒X04(B)", 0, false],
  ] as const)(
    "%s を裏返すと flip 時点でカウント+1 (ルール) / 純正転醒時効果のみ %i 件 queue",
    (frontNo, backNo, expectedPendings, withAdventSource) => {
      const { before, after, lookups } = flipToBack(
        frontNo,
        backNo,
        withAdventSource
      );

      // flip 成立 + カウント+1 (executeRebirth がルールとして適用。効果解決前に確定)
      const flipped = after.cardInstances.find((c) => c.instanceId === "tr-1")!;
      expect(flipped.definitionId).toBe(backNo);
      expect(flipped.zone).toBe("field");
      expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);

      // delta から rebirth イベント 1 件
      const events = collectTriggerEventsFromStateDelta({
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        chainId: null,
        attackId: null,
        getCardDefinitionById: lookups.getCardDefinitionById,
      });
      expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(1);

      // 純正『転醒時』効果を持つ B 面のみ pending triggered effect が queue される。
      // boilerplate (flip ルール文) は効果ではないため queue 対象が存在しない。
      const queued = collectAndQueueTriggerReactions({
        chainId: "test:autorun-w1-advent-rebirth-fidelity:410",
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        getCardDefinitionById: lookups.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          lookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: undefined,
      });
      const rebirthPendings = queued.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "rebirth"
      );
      expect(rebirthPendings.length).toBe(expectedPendings);
      if (expectedPendings > 0) {
        expect(rebirthPendings[0]!.relatedInstanceId).toBe("tr-1");
      }
    }
  );

  it("BSTH09.2-転醒R03(B): 親 A 面の rebirth で B 面へ裏返り、定型 count + B面転醒時効果を最終盤面まで解決する", () => {
    const frontNo = "BSTH09.2-転醒R03(A)";
    const backNo = "BSTH09.2-転醒R03(B)";
    const lookups = buildProductionLookups(ALL_CARDS);
    const front = lookups.getCardDefinitionById(frontNo)!;
    expect(front.backFace?.cardNo).toBe(backNo);

    const rebirth = front.effects
      ?.flatMap((effect) => effect.steps)
      .map((step) => step.action)
      .find((action): action is RebirthAction => action.kind === "rebirth");
    expect(
      rebirth,
      "parent A face must carry the rebirth action"
    ).toBeDefined();
    expect(front.backFace?.textLines[0]).toBe(
      "この面に裏返ったとき、フィールドに残り、カウント1する。"
    );
    // needs-ruling.jsonl BSTH09.2-転醒R03(A), user confirmation 2026-08-01:
    // 「カウント1する」は定型文の +1 脱落なので default = increment_1 を使う。
    expect(rebirth?.countBonusMode).toBeUndefined();

    const source = createCardInstance(front, {
      instanceId: "ryujin-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 3,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ countValue: 2, deckCount: 3, handCount: 0 }, {}],
      cardInstances: [source],
    });
    const flipped = executeRebirth(
      before,
      ALICE,
      rebirth!,
      source.instanceId,
      lookups.getCardDefinitionById,
      "test:autorun-w1-advent-rebirth-fidelity:464"
    );

    const flippedSource = flipped.cardInstances.find(
      (instance) => instance.instanceId === source.instanceId
    )!;
    expect(flippedSource.definitionId).toBe(backNo);
    expect(flippedSource.zone).toBe("field");
    expect(flippedSource.zoneRoleName).toBe("spirit");
    expect(
      flipped.players.find((player) => player.id === ALICE)!.countValue
    ).toBe(3);

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:autorun-w1-advent-rebirth-fidelity:482",
      beforeState: before,
      afterState: flipped,
      source: "action_resolution",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queued.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "rebirth"
      )
    ).toHaveLength(1);

    // 共通 drain は配分先を選べない pendingCoreDistribution の手前で止まる。
    // production と同じ legal action に実際の配分先を渡して、B面の「置き→ドロー」まで進める。
    const awaitingDistribution = drainAllPendings(queued, lookups);
    expect(awaitingDistribution.pendingCoreDistribution).not.toBeNull();
    const resolveDistribution = getLegalActions({
      state: awaitingDistribution,
      actingPlayerId: ALICE,
      ...lookupArgs(lookups),
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(resolveDistribution).toBeDefined();
    const final = applyLegalAction({
      state: awaitingDistribution,
      action: resolveDistribution!,
      coreDistributionAllocations: { [source.instanceId]: 1 },
      ...lookupArgs(lookups),
    }).state;
    const finalSource = final.cardInstances.find(
      (instance) => instance.instanceId === source.instanceId
    )!;
    const finalAlice = final.players.find((player) => player.id === ALICE)!;
    expect(final.pendingCoreDistribution).toBeNull();
    expect(finalSource.normalCoreCount).toBe(4);
    expect(finalAlice.countValue).toBe(3);
    expect(finalAlice.handCount).toBe(1);
    expect(finalAlice.deckCount).toBe(2);
  });

  it("各 B 面定義は boilerplate 由来の count_increase rebirth 効果を持たない", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    for (const backNo of [
      "BSSA01-転醒X01(B)",
      "BSSA01-転醒X02(B)",
      "BSSA01-転醒X03(B)",
      "BSSA01-転醒X04(B)",
    ]) {
      const backDef = lookups.getCardDefinitionById(backNo)!;
      expect(
        backDef,
        `${backNo} must resolve via back-face expansion`
      ).toBeDefined();
      const rebirthCountEffect = (backDef.effects ?? []).find(
        (e) =>
          e.timing.kind === "card_event" &&
          (Array.isArray(e.timing.event)
            ? e.timing.event.includes("rebirth")
            : e.timing.event === "rebirth") &&
          e.steps.some((s) => s.action.kind === "count_increase")
      );
      expect(
        rebirthCountEffect,
        `${backNo} に boilerplate 由来の count_increase rebirth 効果が残っている — ` +
          "flip のカウント+1 は executeRebirth (ルール) が適用するため二重計上になる"
      ).toBeUndefined();
    }
  });

  it("REGRESSION: X02(B) flip 後に queue された転醒時 pending を全解決してもカウントはちょうど 1 (二重計上しない)", () => {
    // 旧バグ: boilerplate を card_event:"rebirth" の count_increase 効果として
    // 持っていたため、ルール +1 (executeRebirth) → pending 解決でさらに +1 の計 2 になっていた。
    const { before, after, lookups } = flipToBack(
      "BSSA01-転醒X02(A)",
      "BSSA01-転醒X02(B)"
    );
    let cur = collectAndQueueTriggerReactions({
      chainId: "test:autorun-w1-advent-rebirth-fidelity:560",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    expect(
      cur.pendingTriggeredEffects.filter((p) => p.eventKind === "rebirth")
        .length
    ).toBe(1);

    // production と同じ legal action 経路で pending を全解決する。
    for (
      let guard = 0;
      guard < 20 && cur.pendingTriggeredEffects.length > 0;
      guard++
    ) {
      let progressed = false;
      for (const pid of [ALICE, BOB]) {
        const actions = getLegalActions({
          state: cur,
          actingPlayerId: pid,
          getCardDefinitionById: lookups.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            lookups.getRegisteredTriggeredEffectActions,
          getRegisteredFieldCardEffectActions:
            lookups.getRegisteredFieldCardEffectActions,
          getRegisteredBattleImmediateEffectActions:
            lookups.getRegisteredBattleImmediateEffectActions,
        });
        const act =
          actions.find((a) => a.kind === "resolve_pending_triggered_effect") ??
          actions.find((a) => a.kind === "resolve_pending_effect_target") ??
          actions.find((a) => a.kind === "select_pending_to_resolve") ??
          actions.find((a) => a.kind === "pass_stack");
        if (!act) continue;
        cur = applyLegalAction({
          state: cur,
          action: act,
          getCardDefinitionById: lookups.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            lookups.getRegisteredTriggeredEffectActions,
          getRegisteredFieldCardEffectActions:
            lookups.getRegisteredFieldCardEffectActions,
          getRegisteredBattleImmediateEffectActions:
            lookups.getRegisteredBattleImmediateEffectActions,
        }).state;
        progressed = true;
        break;
      }
      if (!progressed) break;
    }

    // pending を消化し切り、カウントは flip のルール +1 のみ = ちょうど 1。
    expect(cur.pendingTriggeredEffects.length).toBe(0);
    expect(cur.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AUDIT 2026-06-10: BSTH 転醒 B 面の純正効果を production 経路で最終盤面まで解決する。
// 各効果につき最低 1 件の盤面変化テスト。pending は getLegalActions/applyLegalAction で
// 全消化してから FINAL 盤面を assert する (pre-resolution assert は二重計上バグを見逃す)。
// ---------------------------------------------------------------------------

type ProductionLookups = ReturnType<typeof buildProductionLookups>;

function lookupArgs(lookups: ProductionLookups) {
  return {
    getCardDefinitionById: lookups.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      lookups.getRegisteredTriggeredEffectActions,
    getRegisteredFieldCardEffectActions:
      lookups.getRegisteredFieldCardEffectActions,
    getRegisteredBattleImmediateEffectActions:
      lookups.getRegisteredBattleImmediateEffectActions,
  };
}

/**
 * pending triggered effect / 対象選択 / スタック窓を production の legal action で
 * 全消化する。対象選択が必要なアクションは候補先頭から requiredTargetCount 件を渡す。
 */
function drainAllPendings(
  start: GameState,
  lookups: ProductionLookups
): GameState {
  let cur = start;
  for (let guard = 0; guard < 60; guard++) {
    let progressed = false;
    for (const pid of [ALICE, BOB]) {
      const actions = getLegalActions({
        state: cur,
        actingPlayerId: pid,
        ...lookupArgs(lookups),
      });
      const act =
        actions.find((a) => a.kind === "decline_pending_burst_check") ??
        actions.find((a) => a.kind === "resolve_pending_burst_check") ??
        actions.find((a) => a.kind === "resolve_pending_triggered_effect") ??
        // 自カードの『アタック時』は battle immediate 系で queue される
        actions.find((a) => a.kind === "resolve_battle_immediate_effect") ??
        actions.find((a) => a.kind === "resolve_pending_effect_target") ??
        actions.find(
          (a) =>
            a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === "execute"
        ) ??
        actions.find((a) => a.kind === "resolve_pending_multi_placement") ??
        actions.find((a) => a.kind === "select_pending_to_resolve") ??
        actions.find((a) => a.kind === "pass_stack") ??
        actions.find((a) => a.kind === "pass_pre_declaration_stack");
      if (!act) continue;
      const sel = act as {
        candidateTargetInstanceIds?: string[];
        requiredTargetCount?: number;
      };
      const targetInstanceIds =
        sel.requiredTargetCount &&
        sel.requiredTargetCount > 0 &&
        sel.candidateTargetInstanceIds &&
        sel.candidateTargetInstanceIds.length > 0
          ? sel.candidateTargetInstanceIds.slice(0, sel.requiredTargetCount)
          : undefined;
      cur = applyLegalAction({
        state: cur,
        action: act,
        ...(targetInstanceIds ? { targetInstanceIds } : {}),
        ...(act.kind === "resolve_pending_multi_placement"
          ? {
              multiPlacementAllocations: act.targets.map((target) => ({
                destinationInstanceId: target.instanceId,
                placements:
                  target.minimumCoreCount > 0
                    ? [
                        {
                          kind: "reserve_normal" as const,
                          amount: target.minimumCoreCount,
                        },
                      ]
                    : [],
              })),
            }
          : {}),
        ...lookupArgs(lookups),
      }).state;
      progressed = true;
      break;
    }
    if (!progressed) break;
  }
  return cur;
}

/** A 面を場に置き executeRebirth で裏返し、転醒誘発を queue した状態を返す。 */
function flipAudit(opts: {
  frontNo: string;
  backNo: string;
  flipCores?: number;
  exhaustState?: CardInstance["exhaustState"];
  extraCards?: (lookups: ProductionLookups) => CardInstance[];
  alice?: Partial<PlayerState>;
  bob?: Partial<PlayerState>;
}) {
  const lookups = buildProductionLookups(ALL_CARDS);
  const front = lookups.getCardDefinitionById(opts.frontNo);
  expect(front, `${opts.frontNo} must resolve`).toBeDefined();
  expect(front!.backFace?.cardNo).toBe(opts.backNo);
  const inst = createCardInstance(front!, {
    instanceId: "tr-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: front!.printedCategory === "nexus" ? "nexus" : "spirit",
    normalCoreCount: opts.flipCores ?? 3,
    ...(opts.exhaustState ? { exhaustState: opts.exhaustState } : {}),
  });
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [opts.alice ?? {}, opts.bob ?? {}],
      cardInstances: [inst, ...(opts.extraCards?.(lookups) ?? [])],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
  const action: RebirthAction = {
    kind: "rebirth",
    maxCount: 99,
    triggerDescription: "",
  };
  const after = executeRebirth(
    before,
    ALICE,
    action,
    "tr-1",
    lookups.getCardDefinitionById,
    "test:autorun-w1-advent-rebirth-fidelity:749"
  );
  const flipped = after.cardInstances.find((c) => c.instanceId === "tr-1")!;
  expect(flipped.definitionId).toBe(opts.backNo);
  const queued = collectAndQueueTriggerReactions({
    chainId: "test:autorun-w1-advent-rebirth-fidelity:758",
    beforeState: before,
    afterState: after,
    source: "action_resolution",
    getCardDefinitionById: lookups.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      lookups.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: undefined,
  });
  return { state: queued, lookups };
}

/** 相手フィールド用の実カード instance を作る小ヘルパー。 */
function fieldSpirit(
  lookups: ProductionLookups,
  cardNo: string,
  instanceId: string,
  ownerPlayerId: string,
  normalCoreCount = 1
): CardInstance {
  const def = lookups.getCardDefinitionById(cardNo);
  expect(def, `${cardNo} must resolve`).toBeDefined();
  return createCardInstance(def!, {
    instanceId,
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount,
  });
}

function cardById(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

describe("AUDIT: BSTH 転醒 B 面 — 『転醒時』純正効果の最終盤面 (production 解決)", () => {
  it("BSTH001-転醒R01(B) 玄爺: 転醒時(optional)で相手スピリット1体が破壊されトラッシュへ / count=1", () => {
    const { state, lookups } = flipAudit({
      frontNo: "BSTH001-転醒R01(A)",
      backNo: "BSTH001-転醒R01(B)",
      extraCards: (l) => [fieldSpirit(l, "BSTH04-C01", "opp-1", BOB)],
    });
    const final = drainAllPendings(state, lookups);
    expect(final.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(final, "opp-1").zone).toBe("trash");
    expect(cardById(final, "tr-1").zone).toBe("field");
    expect(final.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });

  it("BSTH04-転醒R02(B) 彼岸 (mis-copy 修正後): 転醒時にトラッシュの冥主コスト5以下スピリットを召喚し、対象外はトラッシュに残る", () => {
    const { state, lookups } = flipAudit({
      frontNo: "BSTH04-転醒R02(A)",
      backNo: "BSTH04-転醒R02(B)",
      // 召喚時コア配置 (リザーブ→最低Lvコア) の原資
      alice: { reserveNormalCoreCount: 2 },
      extraCards: (l) => {
        // BSTH04-C01 [花映塚]チルノ: spirit / cost3 / 起幻・幻想・冥主 → 召喚対象。
        // BSTH01-X03 レミリア: spirit / cost8 / 夜族 → tribes/maxCost 不一致で残留。
        const match = createCardInstance(
          l.getCardDefinitionById("BSTH04-C01")!,
          {
            instanceId: "trash-match",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "trash",
          }
        );
        const noMatch = createCardInstance(
          l.getCardDefinitionById("BSTH01-X03")!,
          {
            instanceId: "trash-nomatch",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "trash",
          }
        );
        return [match, noMatch];
      },
    });
    const final = drainAllPendings(state, lookups);
    expect(final.pendingTriggeredEffects.length).toBe(0);
    const summoned = cardById(final, "trash-match");
    expect(summoned.zone).toBe("field");
    // 正規召喚パイプライン: リザーブから最低 Lv コアが置かれ SBA コア不足消滅しない
    expect(summoned.normalCoreCount).toBeGreaterThanOrEqual(1);
    expect(cardById(final, "trash-nomatch").zone).toBe("trash");
    expect(final.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
    // 旧 mis-copy (表面『配置時』BP-5000) が残っていないこと: B 面定義に bp_modify は無い。
    const backDef = lookups.getCardDefinitionById("BSTH04-転醒R02(B)")!;
    const kinds = (backDef.effects ?? []).flatMap((e) =>
      e.steps.map((s) => s.action.kind)
    );
    expect(kinds).not.toContain("bp_modify");
    expect(kinds).toContain("summon");
  });

  it("BSTH06-転醒R01(B) 地霊殿: 転醒時の破壊対象は本来のシンボル1つのスピリットのみ (2シンボルは残る)", () => {
    const { state, lookups } = flipAudit({
      frontNo: "BSTH06-転醒R01(A)",
      backNo: "BSTH06-転醒R01(B)",
      extraCards: (l) => [
        // BSTH04-C01: symbolColors ["purple"] = 1 → 候補。
        fieldSpirit(l, "BSTH04-C01", "opp-single", BOB),
        // BSTH07-転醒X01(B) 封獣 ぬえ: symbolColors ["red","blue"] = 2 → 対象外。
        fieldSpirit(l, "BSTH07-転醒X01(B)", "opp-double", BOB),
      ],
    });
    const final = drainAllPendings(state, lookups);
    expect(final.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(final, "opp-single").zone).toBe("trash");
    expect(cardById(final, "opp-double").zone).toBe("field");
    expect(final.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });

  it("BSTH06-転醒X01(B) 霊烏路 空: 転醒時に自分以外のスピリット/アルティメットすべてを破壊 (自身は残る)", () => {
    const { state, lookups } = flipAudit({
      frontNo: "BSTH06-転醒X01(A)",
      backNo: "BSTH06-転醒X01(B)",
      extraCards: (l) => [
        fieldSpirit(l, "BSTH04-C01", "own-other", ALICE),
        fieldSpirit(l, "BSTH01-X03", "opp-1", BOB),
      ],
    });
    const final = drainAllPendings(state, lookups);
    expect(final.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(final, "own-other").zone).toBe("trash");
    expect(cardById(final, "opp-1").zone).toBe("trash");
    expect(cardById(final, "tr-1").zone).toBe("field");
    expect(final.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });

  it("BSTH07-転醒R01(B) 命蓮寺 (stub 除去): 転醒時の破壊対象は本来コスト6以下のみ (コスト8は残る)", () => {
    const { state, lookups } = flipAudit({
      frontNo: "BSTH07-転醒R01(A)",
      backNo: "BSTH07-転醒R01(B)",
      extraCards: (l) => [
        // cost3 → 候補 / cost8 → 対象外。
        fieldSpirit(l, "BSTH04-C01", "opp-cheap", BOB),
        fieldSpirit(l, "BSTH01-X03", "opp-big", BOB),
      ],
    });
    const final = drainAllPendings(state, lookups);
    expect(final.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(final, "opp-cheap").zone).toBe("trash");
    expect(cardById(final, "opp-big").zone).toBe("field");
    expect(final.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });

  it("BSTH09.2-転醒R01(B) マミゾウ: 転醒時に相手スピリット1体が重疲労 (リフレッシュ1回では回復しない定義)", () => {
    const { state, lookups } = flipAudit({
      frontNo: "BSTH09.2-転醒R01(A)",
      backNo: "BSTH09.2-転醒R01(B)",
      extraCards: (l) => [fieldSpirit(l, "BSTH04-C01", "opp-1", BOB)],
    });
    const final = drainAllPendings(state, lookups);
    expect(final.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(final, "opp-1").exhaustState).toBe("heavily_exhausted");
    expect(cardById(final, "opp-1").zone).toBe("field");
    expect(final.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });

  it("BSTH04-転醒R01(B) 金龍: 転醒時にトラッシュコア2個→このスピリット + ボイド→ライフ+1 + 回復 (conditional_result/ref_succeeded 連鎖)", () => {
    const { state, lookups } = flipAudit({
      frontNo: "BSTH04-転醒R01(A)",
      backNo: "BSTH04-転醒R01(B)",
      exhaustState: "exhausted",
      alice: { trashNormalCoreCount: 2, voidNormalCoreCount: 3 },
    });
    const final = drainAllPendings(state, lookups);
    expect(final.pendingTriggeredEffects.length).toBe(0);
    const kinryu = cardById(final, "tr-1");
    // flip 保持 3 + トラッシュ 2 = 5 コア
    expect(kinryu.normalCoreCount).toBe(5);
    const alice = final.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(0);
    // 転醒 count+1 とライフ+1 はどちらもボイドから置く (ボイド 3 → 1)
    expect(alice.lifeNormalCoreCount).toBe(6);
    expect(alice.voidNormalCoreCount).toBe(1);
    // そうしたとき → 回復
    expect(kinryu.exhaustState).toBe("recovered");
    expect(alice.countValue).toBe(1);
  });

  it("BSTH04-転醒R01(B) 金龍 [2,3]: stub 除去 — 回復ステップの〔ターンに1回〕は step.usageLimit で強制（インタプリタ消費済み: step-usage-limit.test.ts）", () => {
    const back = ALL_CARDS.find(
      (c) => c.cardNo === "BSTH04-転醒R01(A)"
    )!.backFace!;
    const effect = back.effects![0]!;
    // stale stub（「EffectStep.usageLimit がインタプリタ未消費」）は解消済み。
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["rebirth", "attack"],
    });
    // 回復ステップは〔ターンに1回〕= per_instance turn の usageLimit を保持する。
    const recoverStep = effect.steps.find((s) => s.action.kind === "recover")!;
    expect(recoverStep.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(recoverStep.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "kinryu-trash-cores",
    });
  });

  it("BSTH04-転醒R01(B) 金龍 [2,3]: 同一ターンの2回目でもコア移動とライフ増加は行い、回復だけを止める", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const back = lookups.getCardDefinitionById("BSTH04-転醒R01(B)")!;
    const source = createCardInstance(back, {
      instanceId: "kinryu-once-per-turn",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 3,
      exhaustState: "exhausted",
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          {
            trashNormalCoreCount: 4,
            voidNormalCoreCount: 2,
            lifeNormalCoreCount: 5,
          },
          {},
        ],
        cardInstances: [source],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
    };
    const execute = (state: GameState) =>
      executeEffect({
        chainId: "test:autorun-w1-advent-rebirth-fidelity:994",
        state,
        effect: back.effects![0]!,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        effectIndex: 0,
        ...lookupArgs(lookups),
      });

    const afterFirst = drainAllPendings(execute(before), lookups);
    expect(cardById(afterFirst, source.instanceId).normalCoreCount).toBe(5);
    expect(
      afterFirst.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
    ).toBe(6);
    expect(cardById(afterFirst, source.instanceId).exhaustState).toBe(
      "recovered"
    );

    const exhaustedAgain: GameState = {
      ...afterFirst,
      cardInstances: afterFirst.cardInstances.map((instance) =>
        instance.instanceId === source.instanceId
          ? { ...instance, exhaustState: "exhausted" as const }
          : instance
      ),
    };
    const afterSecond = execute(exhaustedAgain);
    // 「ターンに1回」は回復 step のみを制限する。前段の成功による2コア移動と
    // ボイド→ライフは2回目にも本文どおり解決される。
    expect(cardById(afterSecond, source.instanceId).normalCoreCount).toBe(7);
    expect(
      afterSecond.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
    ).toBe(7);
    expect(
      afterSecond.players.find((p) => p.id === ALICE)!.trashNormalCoreCount
    ).toBe(0);
    expect(
      afterSecond.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
    ).toBe(0);
    expect(cardById(afterSecond, source.instanceId).exhaustState).toBe(
      "exhausted"
    );
  });
});

// ---------------------------------------------------------------------------
// AUDIT: 『アタック時』効果 — production の attack 宣言から誘発・解決して最終盤面を assert
// ---------------------------------------------------------------------------

function declareAttackAndDrain(opts: {
  attackerNo: string;
  attackerCores: number;
  extraCards?: (lookups: ProductionLookups) => CardInstance[];
  alice?: Partial<PlayerState>;
  bob?: Partial<PlayerState>;
}) {
  const lookups = buildProductionLookups(ALL_CARDS);
  const def = lookups.getCardDefinitionById(opts.attackerNo);
  expect(def, `${opts.attackerNo} must resolve`).toBeDefined();
  const attacker = createCardInstance(def!, {
    instanceId: "tr-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: opts.attackerCores,
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [opts.alice ?? {}, opts.bob ?? {}],
    cardInstances: [attacker, ...(opts.extraCards?.(lookups) ?? [])],
  });
  let state: GameState = {
    ...base,
    turnNumber: 2,
    activePlayerId: ALICE,
    step: "attack",
  };
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    ...lookupArgs(lookups),
  });
  const attack = actions.find(
    (a): a is Extract<LegalAction, { kind: "attack" }> =>
      a.kind === "attack" && a.sourceInstanceId === "tr-1"
  );
  expect(attack, `${opts.attackerNo} の attack action が legal`).toBeDefined();
  state = applyLegalAction({
    state,
    action: attack!,
    ...lookupArgs(lookups),
  }).state;
  // アタック宣言は pre_declaration_stack 窓を開く。両者パスで宣言確定 (疲労+誘発 queue)。
  for (
    let guard = 0;
    guard < 6 && state.preDeclarationStackWindow !== null;
    guard++
  ) {
    let passed = false;
    for (const pid of [ALICE, BOB]) {
      const acts = getLegalActions({
        state,
        actingPlayerId: pid,
        ...lookupArgs(lookups),
      });
      const pass = acts.find((a) => a.kind === "pass_pre_declaration_stack");
      if (!pass) continue;
      state = applyLegalAction({
        state,
        action: pass,
        ...lookupArgs(lookups),
      }).state;
      passed = true;
      break;
    }
    if (!passed) break;
  }
  // 宣言確定でアタッカーが疲労していること (前提確認 — 回復効果はまだ未解決)
  expect(cardById(state, "tr-1").exhaustState).toBe("exhausted");
  const drained = drainAllPendings(state, lookups);
  return { state: drained, lookups };
}

describe("AUDIT: BSTH 転醒 B 面 — 『アタック時』純正効果の最終盤面 (production attack 宣言)", () => {
  it("BSTH002-転醒X01(B) 魅魔: 紫/白セット中のアタック時、ターンに1回回復する (Lv2)", () => {
    // 転醒済み B 面 (魅魔) を直接フィールドに置いてアタックさせる。
    const { state } = declareAttackAndDrain({
      attackerNo: "BSTH002-転醒X01(B)",
      attackerCores: 3, // Lv2 (requiredCores 3)
      extraCards: (l) => [
        // 紫カードをバーストセット (field_has zone:burst colors purple/white)
        createCardInstance(l.getCardDefinitionById("BSTH04-C01")!, {
          instanceId: "set-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "burst",
        }),
      ],
    });
    expect(state.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(state, "tr-1").exhaustState).toBe("recovered");
  });

  it("BSTH06-転醒X01(B) 空: アタック時、ターンに1回回復する (Lv2)", () => {
    const { state } = declareAttackAndDrain({
      attackerNo: "BSTH06-転醒X01(B)",
      attackerCores: 3, // Lv2 (requiredCores 3)
    });
    expect(state.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(state, "tr-1").exhaustState).toBe("recovered");
    expect(state.activeAttack).not.toBeNull();
  });

  it("BSTH07-転醒X02(B) 寅丸 星: アタック時、ターンに1回回復する (Lv2)", () => {
    const { state } = declareAttackAndDrain({
      attackerNo: "BSTH07-転醒X02(B)",
      attackerCores: 3, // Lv2 (requiredCores 3)
    });
    expect(state.pendingTriggeredEffects.length).toBe(0);
    expect(cardById(state, "tr-1").exhaustState).toBe("recovered");
  });

  it("BSTH07-転醒X01(B) 封獣 ぬえ: アタック時 Lv2 でブロックされない CE (duration: battle) が登録される", () => {
    const { state } = declareAttackAndDrain({
      attackerNo: "BSTH07-転醒X01(B)",
      attackerCores: 3, // Lv2 (requiredCores 3)
    });
    expect(state.pendingTriggeredEffects.length).toBe(0);
    const unblockable = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "unblockable" && ce.targetInstanceId === "tr-1"
    );
    expect(unblockable).toHaveLength(1);
  });

  it("BSTH001-転醒R02(B) 幽幻魔眼: アタック時→バトル終了時にターン1回回復 (deferredTo:battle_end)", () => {
    const { state, lookups } = declareAttackAndDrain({
      attackerNo: "BSTH001-転醒R02(B)",
      attackerCores: 3, // Lv2 (requiredCores 3)
    });
    // 解決時点では予約のみ (まだ回復しない)
    expect(state.pendingBattleEndDeferrals.length).toBe(1);
    expect(cardById(state, "tr-1").exhaustState).toBe("exhausted");
    // バトル解決完了で予約が発火し回復する
    const resolved = executeBattleResolution({
      state,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const final = drainAllPendings(resolved.state, lookups);
    expect(final.pendingBattleEndDeferrals.length).toBe(0);
    expect(cardById(final, "tr-1").exhaustState).toBe("recovered");
  });

  it("BSTH09.2-転醒R01(B) マミゾウ: アタック時に相手1体重疲労 + Lv3 バトル終了時回復の両効果が解決される", () => {
    const { state, lookups } = declareAttackAndDrain({
      attackerNo: "BSTH09.2-転醒R01(B)",
      attackerCores: 4, // Lv3 (requiredCores 4)
      extraCards: (l) => [fieldSpirit(l, "BSTH04-C01", "opp-1", BOB)],
    });
    // [2,3] 重疲労は即時解決済み / [8,9] はバトル終了時へ予約
    expect(cardById(state, "opp-1").exhaustState).toBe("heavily_exhausted");
    expect(state.pendingBattleEndDeferrals.length).toBe(1);
    const resolved = executeBattleResolution({
      state,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const final = drainAllPendings(resolved.state, lookups);
    expect(final.pendingBattleEndDeferrals.length).toBe(0);
    expect(cardById(final, "tr-1").exhaustState).toBe("recovered");
  });
});

// ---------------------------------------------------------------------------
// AUDIT: continuous 効果 (CE rebuild) / スタック起動効果
// ---------------------------------------------------------------------------

describe("AUDIT: BSTH 転醒 B 面 — continuous / スタック効果の盤面反映", () => {
  it("BSTH001-転醒R03(B) エリス: 疲労状態のときのみ『相手の効果を受けない』(Lv2)", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const def = lookups.getCardDefinitionById("BSTH001-転醒R03(B)")!;
    const exhausted = createCardInstance(def, {
      instanceId: "eris-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2, // Lv2 (requiredCores 2)
      exhaustState: "exhausted",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [exhausted],
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      base,
      lookups.getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(rebuilt, "eris-1")).toBe("immune");

    // 回復状態では耐性なし
    const recoveredState: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((c) =>
        c.instanceId === "eris-1"
          ? { ...c, exhaustState: "recovered" as const }
          : c
      ),
    };
    const rebuiltRecovered = rebuildContinuousEffectsFromField(
      recoveredState,
      lookups.getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(rebuiltRecovered, "eris-1")).toBe("none");
  });

  it("BSTH002-転醒X01(B) 魅魔: Lv3 で白シンボル1つ追加の CE が登録され、Lv1 では登録されない", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const def = lookups.getCardDefinitionById("BSTH002-転醒X01(B)")!;
    const lv3 = createCardInstance(def, {
      instanceId: "mima-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 4, // Lv3 (requiredCores 4)
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [lv3],
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      base,
      lookups.getCardDefinitionById
    );
    const adds = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" && ce.targetInstanceId === "mima-1"
    );
    expect(adds).toHaveLength(1);
    expect(adds[0]!.modifierSymbol).toEqual(["white"]);

    // Lv1 (1 コア) では条件不成立で登録されない
    const lv1State: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((c) =>
        c.instanceId === "mima-1" ? { ...c, normalCoreCount: 1 } : c
      ),
    };
    const rebuiltLv1 = rebuildContinuousEffectsFromField(
      lv1State,
      lookups.getCardDefinitionById
    );
    expect(
      rebuiltLv1.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "symbol_addition" &&
          ce.targetInstanceId === "mima-1"
      )
    ).toHaveLength(0);
  });

  it("BSTH002-転醒R01(B) 現世: スタック効果でブロック宣言中の相手スピリットを手札に戻す", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const backDef = lookups.getCardDefinitionById("BSTH002-転醒R01(B)")!;
    const stackEffect = (backDef.effects ?? []).find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "stack"
    );
    expect(stackEffect, "現世(B) の stack 効果が存在する").toBeDefined();

    const nexus = createCardInstance(backDef, {
      instanceId: "utsushiyo-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const attacker = fieldSpirit(lookups, "BSTH04-C01", "atk-1", ALICE, 1);
    const blocker = createCardInstance(
      lookups.getCardDefinitionById("BSTH01-X03")!,
      {
        instanceId: "blk-1",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
        exhaustState: "exhausted", // ブロックで疲労済み
      }
    );
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-1:1",
      primaryEntityId: "be-1",
      participantEntityIds: ["be-1"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: ["be-2"] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, attacker, blocker],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-1",
          resolvedBp: 2000,
          attackState: "attacking",
          resolvedSymbols: ["purple"],
          memberInstanceIds: ["atk-1"],
        },
        {
          entityId: "be-2",
          resolvedBp: 8000,
          attackState: "blocking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["blk-1"],
        },
      ],
    };

    const effectIndex = (backDef.effects ?? []).indexOf(stackEffect!);
    const after = executeEffect({
      chainId: "test:autorun-w1-advent-rebirth-fidelity:1370",
      state,
      effect: stackEffect!,
      sourceInstanceId: "utsushiyo-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      effectIndex,
    });
    const final = drainAllPendings(
      flushPendingLeaves(after, lookups.getCardDefinitionById),
      lookups
    );
    // ブロック宣言スピリットのみ手札へ戻る (バウンス)。アタッカーは場に残る。
    expect(cardById(final, "blk-1").zone).toBe("hand");
    expect(cardById(final, "atk-1").zone).toBe("field");
  });
});

// ---------------------------------------------------------------------------
// FIDELITY (autorun w1, stale declare_advent 再変換 2026-06-10):
// 契約煌臨カードの adventData 静的検証 + production declare_advent → 最終盤面。
// 対象: BSSL01-C01 / X01 / X02 (契約/超契約煌臨), BSTS01-X02 (既存)。
// 契約 base (BSSL01-CX01 / BSTS01-CX01 / BSDB01-CX01) は被煌臨側で adventData を持たない。
// ---------------------------------------------------------------------------

describe("FIDELITY: BSSL01 契約煌臨カードの adventData (declare_advent 再変換)", () => {
  it.each([
    ["BSSL01-C01", "own_turn", "trash", undefined],
    ["BSSL01-X01", "main_and_flash", "trash", 5], // お互いのターン ≈ main_and_flash
    // 超契約煌臨 → contract 近似。textLines[1]「自分のソウルコアをこのスピリットに
    // 置く」= カード固有効果で標準消費先(trash)を上書きし this_card へ。
    ["BSSL01-X02", "own_turn", "this_card", 7],
  ] as const)(
    "%s は contract 煌臨 / timing=%s / soulCoreDest=%s / targetCategory=[spirit] / count>=%s",
    (no, timing, soulCoreDest, minCount) => {
      const ad = card(no).adventData;
      expect(ad, `${no} must have adventData`).toBeDefined();
      expect(ad!.adventVariant).toBe("contract");
      expect(ad!.adventTiming).toBe(timing);
      expect(ad!.soulCoreDest).toBe(soulCoreDest);
      expect(ad!.adventCondition.targetCategory).toEqual(["spirit"]);
      // 名前条件「水篠 旬」は AdventCondition.cardNames で表現（engine-drain 型 SSOT 適用）。
      expect(ad!.adventCondition.cardNames).toContainEqual({
        contains: "水篠 旬",
      });
      expect(ad!.adventCondition.minCost).toBeUndefined();
      expect(ad!.includeAdventSourceTarget).toBe(
        no === "BSSL01-X02" ? true : undefined
      );
      expect(ad!.declareUsageLimit).toEqual(
        no === "BSSL01-X02"
          ? { kind: "per_card_name", duration: "turn" }
          : undefined
      );
      if (minCount === undefined) {
        expect(ad!.declareCondition).toBeUndefined();
      } else {
        expect(ad!.declareCondition).toEqual([
          { kind: "count_value", player: "self", min: minCount },
        ]);
      }
    }
  );

  it("契約 base (CX01) は被煌臨側で adventData を持たない", () => {
    for (const no of ["BSSL01-CX01", "BSTS01-CX01", "BSDB01-CX01"]) {
      expect(
        card(no).adventData,
        `${no} は base なので adventData なし`
      ).toBeUndefined();
    }
  });

  it("再変換したカードに旧『declare_advent main 未配線』stub が残っていない", () => {
    // 注: X01[3] の代替コスト煌臨 stub は declare_advent を説明文で参照するが、これは正当な
    //     残置ギャップ。撤去対象は「main 未配線(P3-89)」という旧アノテーションのみ。
    for (const no of ["BSSL01-C01", "BSSL01-X01", "BSSL01-X02"]) {
      const declStub = (card(no).effects ?? []).find(
        (e) =>
          typeof e.stub === "string" &&
          (e.stub.includes("declare_advent main 未配線") ||
            e.stub.includes("declare_advent main 未merge"))
      );
      expect(
        declStub,
        `${no} に旧 declare_advent stub が残っている`
      ).toBeUndefined();
    }
  });
});

// 契約 base をフィールドに置き、契約煌臨カードを手札に持つ production state。
// hostSoulState=true: base を魂状態に (契約煌臨の魂状態先候補を検証)。
// hostSoulState=false: base を通常スピリットに (コアを継承し SBA 消滅しない最終盤面検証)。
function buildContractAdventState(opts: {
  adventNo: string;
  baseNo: string;
  hostSoulState?: boolean;
  hostCores?: number;
}): { state: GameState; lookups: ProductionLookups } {
  const lookups = buildProductionLookups(ALL_CARDS);
  const soulState = opts.hostSoulState ?? true;
  const base = createCardInstance(lookups.getCardDefinitionById(opts.baseNo)!, {
    instanceId: "base-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
    // 魂状態は通常コア0でも可。通常先は煌臨カードがコアを継承するためコアを持たせる。
    normalCoreCount: soulState ? 0 : (opts.hostCores ?? 3),
  });
  const advent = createCardInstance(
    lookups.getCardDefinitionById(opts.adventNo)!,
    {
      instanceId: "advent-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    }
  );
  const start = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation: { kind: "reserve" },
        countValue: 0,
        soulStateInstanceIds: soulState ? ["base-1"] : [],
        contractCardNo: opts.baseNo,
      },
      {},
    ],
    cardInstances: [base, advent],
  });
  return {
    state: { ...start, activePlayerId: ALICE, step: "main", window: "none" },
    lookups,
  };
}

describe("INTEGRATION: BSSL01-C01 契約煌臨を production 経路で宣言・解決し最終盤面を assert", () => {
  it("自分のメインで declare_advent が legal / adventMode='contract' / 魂状態の契約 base が候補", () => {
    const { state, lookups } = buildContractAdventState({
      adventNo: "BSSL01-C01",
      baseNo: "BSSL01-CX01",
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookupArgs(lookups),
    });
    const decl = actions.find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
    );
    expect(decl).toBeDefined();
    expect(decl!.adventMode).toBe("contract");
    expect(decl!.soulCoreDest).toBe("trash");
    expect(decl!.candidateTargetInstanceIds).toContain("base-1");
  });

  it("適用 + pending 全解決後の最終盤面: overlay(コア継承) + ソウルコア trash + 煌臨元化 + 手札減", () => {
    // 通常スピリット先 (コア3) に契約煌臨 → 煌臨カードがコアを継承し SBA 消滅しない。
    const { state, lookups } = buildContractAdventState({
      adventNo: "BSSL01-C01",
      baseNo: "BSSL01-CX01",
      hostSoulState: false,
      hostCores: 3,
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookupArgs(lookups),
    });
    const decl = actions.find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
    )!;
    expect(decl.adventMode).toBe("contract");
    const applied = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["base-1"],
      ...lookupArgs(lookups),
    }).state;
    // production と同じく pending (煌臨時 等) を最終盤面まで消化する。
    const final = drainAllPendings(applied, lookups);

    // 煌臨カードはフィールドに移り base-1 を煌臨元に持ち、コアを継承して場に残る
    const adv = cardById(final, "advent-1");
    expect(adv.zone).toBe("field");
    expect(adv.zoneRoleName).toBe("spirit");
    expect(adventSourceIdsOf(adv)).toContain("base-1");
    expect(adv.normalCoreCount).toBe(3);
    // base-1 は煌臨元になる
    expect(cardById(final, "base-1").zoneRoleName).toBe("advent-source");
    const alice = final.players.find((p) => p.id === ALICE)!;
    // 契約煌臨: ソウルコアは soulCoreDest=trash へ
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(alice.handCount).toBe(0);
    // 煌臨時の未対応サブ効果 ([3,4] ranged discard) は stub のため pending を残さず消化済み
    expect(final.pendingTriggeredEffects.length).toBe(0);
  });

  it("ソウルコアが無ければ declare_advent は出ない (契約 base があっても)", () => {
    const { state, lookups } = buildContractAdventState({
      adventNo: "BSSL01-C01",
      baseNo: "BSSL01-CX01",
    });
    const noSoul: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, soulCoreLocation: null } : p
      ),
    };
    const actions = getLegalActions({
      state: noSoul,
      actingPlayerId: ALICE,
      ...lookupArgs(lookups),
    });
    expect(
      actions.some(
        (a) => a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
      )
    ).toBe(false);
  });
});
