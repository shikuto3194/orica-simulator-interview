/**
 * BSKB01 (星のカービィシリーズ-メタナイト編-) 煌臨カードの adventData 配線検証。
 *
 * BSKB01 は adventData を持つ初の実カード弾 (3 枚すべて【契約煌臨】)。
 * - BSKB01-C01 [メタナイトの逆襲]メタナイト  : contract / own_turn / C1以上
 * - BSKB01-M01 [銀河に願いを]メタナイト      : contract / both_attack_step / C5以上
 * - BSKB01-X01 [英雄を討ち倒し者]メタナイト   : contract / main_and_flash / C7以上
 *
 * 本テストの主眼は INTEGRATION: 実カードデータ (BSKB01-C01) を手札に、実カード
 * (BSKB01-C02 水兵ワドルディ, cost3 スピリット) をフィールド煌臨先に置き、
 * getLegalActions → declare_advent → applyLegalAction の production 経路で
 *   (1) 煌臨カードが煌臨先の上に重なる (overlay)
 *   (2) ソウルコアが soulCoreDest=trash へ消費される
 *   (3) 『煌臨時』(card_event:advent) が誘発し『召喚時』は誘発しない
 * ことを実データで確認する。
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
// 静的検証: 3 枚すべてが adventData を持ち、印字どおりの種別/タイミングである
// ---------------------------------------------------------------------------

describe("BSKB01 煌臨カード: adventData が印字どおり配線されている", () => {
  it.each([
    ["BSKB01-C01", "own_turn", 1],
    ["BSKB01-M01", "both_attack_step", 5],
    ["BSKB01-X01", "main_and_flash", 7],
  ] as const)(
    "%s は contract / %s / count>=%i の adventData を持つ",
    (no, timing, minCount) => {
      const c = card(no);
      expect(c.adventData).toBeDefined();
      const ad = c.adventData!;
      // すべて【契約煌臨】
      expect(ad.adventVariant).toBe("contract");
      expect(ad.adventTiming).toBe(timing);
      // スピリットなので soulCoreDest=trash (08a:24)
      expect(ad.soulCoreDest).toBe("trash");
      expect(ad.adventCondition.minCost).toBeUndefined();
      expect(ad.adventCondition.targetCategory).toEqual(["spirit"]);
      expect(ad.declareCondition).toEqual([
        { kind: "count_value", player: "self", min: minCount },
      ]);
    }
  );

  it("煌臨宣言の stub effect (activated flash) は削除済み (declare_advent 経路に移行)", () => {
    for (const no of ["BSKB01-C01", "BSKB01-M01", "BSKB01-X01"]) {
      const c = card(no);
      const declStub = (c.effects ?? []).find(
        (e) =>
          e.timing.kind === "activated" &&
          e.timing.mode === "flash" &&
          typeof e.stub === "string" &&
          e.stub.includes("契約煌臨宣言")
      );
      expect(declStub).toBeUndefined();
    }
  });

  it("『煌臨時』効果は card_event:advent で配線されている (NOT summon)", () => {
    const c = card("BSKB01-C01");
    const adventEffects = (c.effects ?? []).filter(
      (e) =>
        e.timing.kind === "card_event" &&
        (Array.isArray(e.timing.event)
          ? e.timing.event.includes("advent")
          : e.timing.event === "advent")
    );
    expect(adventEffects.length).toBeGreaterThan(0);
    // C01 は『召喚時』(summon) 効果を持たない
    const summonEffects = (c.effects ?? []).filter(
      (e) =>
        e.timing.kind === "card_event" &&
        (Array.isArray(e.timing.event)
          ? e.timing.event.includes("summon")
          : e.timing.event === "summon")
    );
    expect(summonEffects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// INTEGRATION: 実カードで declare_advent 経路を行使する
// ---------------------------------------------------------------------------

const ADVENT_NO = "BSKB01-C01"; // [メタナイトの逆襲]メタナイト (契約煌臨, C1以上, cardNames:「メタナイト」)
const HOST_NO = "BSKB01-CX01"; // [仮面の騎士]メタナイト (cost2 スピリット, 煌臨先)

/**
 * ALICE の手札に BSKB01-C01、フィールドに BSKB01-CX01 (煌臨先) を置く。
 * BSKB01-C01 は contract 煌臨。通常スピリット先も名前条件「メタナイト」
 * と C1以上を満たせば getContractAdventTargets の normalTargets 経由で煌臨できる。
 */
function buildState(
  opts: {
    soulCoreLocation?: PlayerState["soulCoreLocation"] | "none";
    countValue?: number;
  } = {}
): GameState {
  const host = createCardInstance(card(HOST_NO), {
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
    playerOverrides: [
      { handCount: 1, soulCoreLocation, countValue: opts.countValue ?? 1 },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [host, advent],
  };
}

function buildSoulStateAttackFlashState(
  adventNo: string,
  countValue: number
): GameState {
  const host = createCardInstance(card(HOST_NO), {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const advent = createCardInstance(card(adventNo), {
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
        soulCoreLocation: { kind: "reserve" },
        soulStateInstanceIds: ["host-1"],
        contractCardNo: HOST_NO,
        countValue,
      },
      {},
    ],
    cardInstances: [host, advent],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "attack",
    window: "flash_before_block",
    activeAttack: {
      attackId: "atk-1",
      primaryEntityId: "e-atk",
      participantEntityIds: ["e-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [],
      symbolResolutionOrder: [],
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

/**
 * P3-112: declare_advent は今やスタック窓を開く（apply 即時解決ではない）。
 * responder のパスで窓を閉じ、deferred 解決（ソウルコア消費＋重ね）まで進める。
 */
function passStackUntilClosed(
  state: GameState,
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getCardDefinitionByIdFn,
      ...extraOptions,
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find((a) => a.kind === "pass_stack");
    if (!pass) {
      throw new Error(`pass_stack for ${responderId} not found`);
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

describe("INTEGRATION: BSKB01-C01 を実データで煌臨させる (declare_advent 経路)", () => {
  it("メインステップで declare_advent が legal になり adventMode='contract'", () => {
    const state = buildState();
    const decl = findAdventDeclaration(state);
    expect(decl).toBeDefined();
    expect(decl!.adventMode).toBe("contract");
    expect(decl!.soulCoreDest).toBe("trash");
    // 名前「メタナイト」を含み C1以上を満たす通常スピリット先 host-1 が候補に含まれる
    expect(decl!.candidateTargetInstanceIds).toContain("host-1");
  });

  it("ソウルコアが無ければ declare_advent は出ない", () => {
    expect(
      findAdventDeclaration(buildState({ soulCoreLocation: "none" }))
    ).toBeUndefined();
  });

  it("BSKB01-M01 は C5以上なら cost2 の魂状態 BSKB01-CX01 に契約煌臨でき、C4ではできない", () => {
    const count5 = findAdventDeclaration(
      buildSoulStateAttackFlashState("BSKB01-M01", 5)
    );
    expect(count5).toBeDefined();
    expect(count5!.candidateTargetInstanceIds).toContain("host-1");

    const count4 = findAdventDeclaration(
      buildSoulStateAttackFlashState("BSKB01-M01", 4)
    );
    expect(count4).toBeUndefined();
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
    const afterStack = passStackUntilClosed(
      result.state,
      getCardDefinitionById,
      effectLookups
    );
    const targetAction = getLegalActions({
      state: afterStack,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    const newState = applyLegalAction({
      state: afterStack,
      action: targetAction!,
      targetInstanceIds: ["host-1"],
      getCardDefinitionById,
      ...effectLookups,
    }).state;

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
});
