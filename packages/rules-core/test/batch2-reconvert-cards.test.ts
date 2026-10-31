/**
 * Engine batch2 再変換カードの盤面変化テスト。
 *
 * 対象（main @ 276b942 の新能力で再変換したカードの effects）:
 * - コアシュート対象限定 (core_move from {kind:"field", filter, minRemainingPerCandidate?}):
 *     BSTS01-M03 [3,4] / BSSL01-C04 [3,4] / BSTH04-転醒R02(B) [5,6]
 * - 煌臨元 leave-dest (effect_resistance replacement: advent_source):
 *     BSSL01-C02 [2] / BSSL01-M03 [0,1] / BSSL01-R01 [0,1] / BSSL01-M01 [2,3]
 * - blanket suppress_effect (effectFilter 省略) + 複数対象 prevent_battle:
 *     BSSA01-転醒X02(A) [4,5]
 *
 * すべて production の CardDefinition.effects を ALL_CARDS から引き、executeEffect で実行する。
 * pending（coreshoot 選択 / advent_source 置換）は最終盤面まで解決してから assert する。
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import {
  buildTriggeredEffectLookup,
  createEmptyGameState,
  createCardInstance,
  flushPendingLeaves,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import { adventSourceIdsOf } from "../src/model";
import type {
  BattleEntity,
  CardDefinition,
  CardInstance,
  GameState,
} from "../src";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => {
  // instanceId の definitionId は cardNo と一致させて作るので cardNo lookup でよい。
  return cardNoMap.get(id);
};

function card(cardNo: string): CardDefinition {
  const def = cardNoMap.get(cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def;
}

/** effects から textRef を含む 1 effect を取得（複数候補は先頭、stub 除外可）。 */
function effectByTextRef(
  def: CardDefinition,
  ref: number[],
  opts: { nonStub?: boolean } = {}
): Effect {
  const matches = (def.effects ?? []).filter(
    (e) =>
      e.textRef &&
      e.textRef.length === ref.length &&
      e.textRef.every((v, i) => v === ref[i]) &&
      (!opts.nonStub || e.stub === undefined)
  );
  if (matches.length === 0)
    throw new Error(`no effect with textRef [${ref}] in ${def.cardNo}`);
  return matches[0]!;
}

function inst(
  def: CardDefinition,
  instanceId: string,
  owner: string,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    controllerPlayerId: owner,
    zone: "field",
    ...overrides,
  });
}

function cores(state: GameState, id: string): number {
  return state.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount;
}
function trash(state: GameState, player: string): number {
  return state.players.find((p) => p.id === player)!.trashNormalCoreCount;
}
function reserve(state: GameState, player: string): number {
  return state.players.find((p) => p.id === player)!.reserveNormalCoreCount;
}
function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function runEffect(
  effect: Effect,
  cardInstances: CardInstance[],
  sourceInstanceId: string,
  battleEntities: BattleEntity[] = []
): GameState {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    battleEntities,
  });
  return executeEffect({
    chainId: "test:batch2-reconvert-cards:110",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

describe("BSTH01-R11 星符「サテライトイリュージョン」", () => {
  const def = card("BSTH01-R11");
  const effect = effectByTextRef(def, [2, 3], { nonStub: true });

  it("幻想かつ導魔/楽族アタック時に相手全体BP-2000を最大6回 retrigger し、白の効果では防げない (P3-140)", () => {
    const step = effect.steps[0]!;
    expect(step.action).toMatchObject({
      kind: "bp_modify",
      amount: -2000,
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: "all",
      },
      duration: { scope: "turn" },
    });
    expect(step.retrigger).toEqual({
      event: "attack",
      triggerPlayer: "self",
      triggerFilter: {
        category: ["spirit"],
        tribesRequired: ["幻想"],
        tribes: ["導魔", "楽族"],
      },
      maxCount: 6,
      duration: { scope: "turn" },
    });
    expect(effect.preventionRestriction).toEqual({
      notPreventableByColors: ["white"],
      colorMatchMode: "exact",
    });
  });
});

// ════════════════════════════════════════════════════════════════
// コアシュート対象限定
// ════════════════════════════════════════════════════════════════

describe("BSTS01-M03 [2,3]: spirit/ult 限定コアシュート 3個", () => {
  const def = card("BSTS01-M03");
  const effect = effectByTextRef(def, [2, 3], { nonStub: true });

  it("相手の spirit からコア3個をトラッシュへ、nexus は不変（単一候補で自動解決）", () => {
    const src = inst(def, "src", ALICE, { normalCoreCount: 2 });
    // 条件 field_has(self, ultimate, リムル) を満たすためアルティメット「リムル」を場に置く。
    // BSTS01-X02 ［覚醒魔王］リムル=テンペスト が ultimate。
    const rimuru = card("BSTS01-X02");
    const opSp = inst(card("BSSL01-C02"), "opSp", BOB, { normalCoreCount: 3 });
    // ネクサスはフィルタ外。
    const opNx = inst(card("BSSL01-C03"), "opNx", BOB, { normalCoreCount: 3 });
    // リムル（アルティメット）。
    const ult = inst(rimuru, "ult", ALICE, { normalCoreCount: 1 });
    const after = runEffect(effect, [src, opSp, opNx, ult], "src");
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "opSp")).toBe(0); // spirit から 3 個
    expect(cores(after, "opNx")).toBe(3); // nexus 不変
    expect(trash(after, BOB)).toBe(3);
  });

  it("条件未達（リムル不在）なら効果不発で盤面不変", () => {
    const src = inst(def, "src", ALICE, { normalCoreCount: 2 });
    const opSp = inst(card("BSSL01-C02"), "opSp", BOB, { normalCoreCount: 3 });
    const after = runEffect(effect, [src, opSp], "src");
    expect(cores(after, "opSp")).toBe(3);
    expect(trash(after, BOB)).toBe(0);
  });
});

describe("BSSL01-C04 [3,4]: battleState+maxCost 限定コアシュート(コアすべて)", () => {
  const def = card("BSSL01-C04");
  const effect = effectByTextRef(def, [3, 4], { nonStub: true });

  function setup(opCost: number, opCores: number) {
    // ネクサス自身は Lv2 (min_level:2)。requiredCores Lv2=1 → コア1で Lv2。
    const src = inst(def, "src", ALICE, { normalCoreCount: 1 });
    const opDef =
      opCost <= 3
        ? card("BSSL01-C02") /* cost3 */
        : card("BSSL01-M01"); /*cost7*/
    const op = inst(opDef, "op", BOB, { normalCoreCount: opCores });
    const entities: BattleEntity[] = [
      {
        entityId: "be-op",
        memberInstanceIds: ["op"],
        resolvedBp: 5000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ];
    return { src, op, entities };
  }

  it("バトル中 cost3 の相手のコアすべてをトラッシュへ", () => {
    const s = setup(3, 4);
    const after = runEffect(effect, [s.src, s.op], "src", s.entities);
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "op")).toBe(0);
    expect(trash(after, BOB)).toBe(4);
  });

  it("cost7（maxCost:3 外）はフィルタで除外され盤面不変", () => {
    const s = setup(7, 4);
    const after = runEffect(effect, [s.src, s.op], "src", s.entities);
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "op")).toBe(4);
    expect(trash(after, BOB)).toBe(0);
  });

  it("Lv1（min_level:2 未達）なら不発", () => {
    const s = setup(3, 4);
    const lowSrc = inst(def, "src", ALICE, { normalCoreCount: 0 }); // Lv1
    const after = runEffect(effect, [lowSrc, s.op], "src", s.entities);
    expect(cores(after, "op")).toBe(4);
  });
});

describe("BSTH04-転醒R02(B) [5,6]: アタック宣言中のコアシュート + 0個にできない", () => {
  // 裏面 (B) は ALL_CARDS に cardNo 直引きで存在しない。(A) の backFace から取得。
  const backDef = card("BSTH04-転醒R02(A)").backFace!;
  const effect = effectByTextRef(backDef, [5, 6], { nonStub: true });
  // 裏面 def を含む getDef（src の definitionId 解決用）。
  const getDefB = (id: string): CardDefinition | undefined =>
    id === backDef.cardNo ? backDef : getDef(id);

  function setup(opCores: number) {
    const src = inst(backDef, "src", ALICE, { normalCoreCount: 1 });
    const op = inst(card("BSSL01-C02"), "op", BOB, {
      normalCoreCount: opCores,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, op],
    });
    return {
      ...state,
      preDeclarationStackWindow: {
        kind: "attack",
        sourceInstanceId: "op",
        actingPlayerId: BOB,
      },
    } as GameState;
  }

  it("アタック宣言中スピリットのコア1個をトラッシュへ（コア2→1、残数下限1を維持）", () => {
    const after = executeEffect({
      chainId: "test:batch2-reconvert-cards:264",
      state: setup(2),
      effect,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefB,
    });
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "op")).toBe(1);
    expect(trash(after, BOB)).toBe(1);
  });

  it("コア1個のアタックスピリットは候補外（0個にできない）で不変", () => {
    const after = executeEffect({
      chainId: "test:batch2-reconvert-cards:277",
      state: setup(1),
      effect,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefB,
    });
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "op")).toBe(1);
    expect(trash(after, BOB)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 煌臨元 leave-dest (advent_source 置換)
// ════════════════════════════════════════════════════════════════

/**
 * 共通: leave-dest 効果を executeEffect で CE 登録 → 相手起因の destroy pendingLeave を立て
 * flushPendingLeaves → pendingAdventSourceReplacement を最終盤面まで解決する。
 */
function runAdventSourceLeaveDest(opts: {
  leaverDef: CardDefinition;
  effect: Effect;
}): {
  resolved: GameState;
  flushed: GameState;
} {
  const leaver = inst(opts.leaverDef, "leaver", ALICE, {
    normalCoreCount: 3,
  });
  // host = 自分の「水篠 旬」(BSSL01-CX01)。
  const host = inst(card("BSSL01-CX01"), "host", ALICE, {
    normalCoreCount: 2,
  });
  const state0 = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [leaver, host],
    playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
  });
  // leave-dest CE を登録。
  const registered = executeEffect({
    chainId: "test:batch2-reconvert-cards:318",
    state: state0,
    effect: opts.effect,
    sourceInstanceId: "leaver",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
  expect(
    registered.activeContinuousEffects.some(
      (ce) => ce.modifierTag === "replace_field_exit"
    )
  ).toBe(true);

  // 相手 (BOB) 起因の destroy pendingLeave。
  const leaverCard = getCard(registered, "leaver");
  leaverCard.pendingLeaveKind = "destroy";
  leaverCard.pendingLeaveCause = "effect_resolution";
  leaverCard.pendingLeaveChainId = "chain-leaver";
  const withPending: GameState = {
    ...registered,
    pendingLeaveEntities: [
      {
        instanceId: "leaver",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: "chain-leaver",
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      },
    ],
  };

  const flushed = flushPendingLeaves(withPending, getDef, ["purple"]);
  return { resolved: registered, flushed };
}

describe("BSSL01-C02 [2]: 相手起因離脱 → 水篠 旬の煌臨元へ追加", () => {
  const def = card("BSSL01-C02");
  const effect = effectByTextRef(def, [2], { nonStub: true });

  it("CE登録 → flush で pendingAdventSourceReplacement → 煌臨元追加で解決", () => {
    const { flushed } = runAdventSourceLeaveDest({ leaverDef: def, effect });
    expect(flushed.pendingAdventSourceReplacement).not.toBeNull();
    expect(flushed.pendingAdventSourceReplacement!.cardInstanceId).toBe(
      "leaver"
    );
    expect(
      flushed.pendingAdventSourceReplacement!.candidateHostInstanceIds
    ).toEqual(["host"]);
    // legal-actions 経路で「煌臨元へ追加」を選択し最終盤面まで解決。
    const actions = getLegalActions({
      state: flushed,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const add = actions.find(
      (a) =>
        a.kind === "resolve_advent_source_replacement" &&
        (a as { choice?: string }).choice === "advent_source"
    )!;
    expect(add).toBeDefined();
    const applied = applyLegalAction({
      state: flushed,
      action: add,
      getCardDefinitionById: getDef,
    }).state;
    expect(applied.pendingAdventSourceReplacement).toBeNull();
    expect(adventSourceIdsOf(getCard(applied, "host"))).toContain("leaver");
    expect(getCard(applied, "leaver").zoneRoleName).toBe("advent-source");
    expect(getCard(applied, "leaver").zone).not.toBe("trash");
    // コアはリザーブへ退避（3個）。
    expect(reserve(applied, ALICE)).toBe(3);
  });
});

describe("BSSL01-M03 [0,1] / BSSL01-R01 [0,1] / BSSL01-M01 [2,3]: 同じ煌臨元 leave-dest", () => {
  for (const [cardNo, ref] of [
    ["BSSL01-M03", [0, 1]],
    ["BSSL01-R01", [0, 1]],
    ["BSSL01-M01", [2, 3]],
  ] as const) {
    it(`${cardNo} ${ref}: 相手起因離脱で host の煌臨元へ追加できる`, () => {
      const def = card(cardNo);
      const effect = effectByTextRef(def, [...ref], { nonStub: true });
      const { flushed } = runAdventSourceLeaveDest({ leaverDef: def, effect });
      expect(flushed.pendingAdventSourceReplacement).not.toBeNull();
      const actions = getLegalActions({
        state: flushed,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });
      const add = actions.find(
        (a) =>
          a.kind === "resolve_advent_source_replacement" &&
          (a as { choice?: string }).choice === "advent_source"
      )!;
      const applied = applyLegalAction({
        state: flushed,
        action: add,
        getCardDefinitionById: getDef,
      }).state;
      expect(adventSourceIdsOf(getCard(applied, "host"))).toContain("leaver");
      expect(getCard(applied, "leaver").zone).not.toBe("trash");
    });
  }

  it("自分起因の離脱では置換が発火せず通常トラッシュへ (BSSL01-M03)", () => {
    const def = card("BSSL01-M03");
    const effect = effectByTextRef(def, [0, 1], { nonStub: true });
    const leaver = inst(def, "leaver", ALICE, { normalCoreCount: 3 });
    const host = inst(card("BSSL01-CX01"), "host", ALICE, {
      normalCoreCount: 2,
    });
    const state0 = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [leaver, host],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    const registered = executeEffect({
      chainId: "test:batch2-reconvert-cards:437",
      state: state0,
      effect,
      sourceInstanceId: "leaver",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const lc = getCard(registered, "leaver");
    lc.pendingLeaveKind = "destroy";
    lc.pendingLeaveChainId = "chain-leaver";
    const withPending: GameState = {
      ...registered,
      pendingLeaveEntities: [
        {
          instanceId: "leaver",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: ALICE, // 自分起因
          chainId: "chain-leaver",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const flushed = flushPendingLeaves(withPending, getDef, ["purple"]);
    expect(flushed.pendingAdventSourceReplacement).toBeNull();
    expect(getCard(flushed, "leaver").zone).toBe("trash");
    expect(adventSourceIdsOf(getCard(flushed, "host"))).not.toContain("leaver");
  });
});

// ════════════════════════════════════════════════════════════════
// blanket suppress_effect + 複数対象 prevent_battle
// ════════════════════════════════════════════════════════════════

describe("BSSA01-転醒X02(A) [4,5]: 相手2体を block不可 + 全効果抑止", () => {
  const def = card("BSSA01-転醒X02(A)");
  const effect = effectByTextRef(def, [4, 5], { nonStub: true });

  function setup() {
    // source = この brave。host 側の夜錆合体スピリット条件を満たすように正向きに attach する。
    const src = inst(def, "src", ALICE, {
      normalCoreCount: 1,
      attachedToInstanceId: "host",
    });
    const dummyHost = inst(card("BSSA01-C03"), "host", ALICE, {
      normalCoreCount: 1,
      attachedChildrenIds: ["src"],
    });
    // 相手 cost7以下 spirit 2 体 + cost7超 1 体（フィルタ外）。
    const op1 = inst(card("BSSL01-C02"), "op1", BOB, { normalCoreCount: 2 }); // cost3
    const op2 = inst(card("BSSL01-C04"), "op2", BOB, { normalCoreCount: 1 }); // C04 は nexus → spirit でない
    const opSpirit2 = inst(card("BSSL01-M03"), "op3", BOB, {
      normalCoreCount: 2,
    }); // cost6 spirit
    const opHigh = inst(card("BSSL01-M01"), "opHigh", BOB, {
      normalCoreCount: 2,
    }); // cost7 spirit (<=7 → 対象になりうる)
    return { src, dummyHost, op1, op2, opSpirit2, opHigh };
  }

  it("combined 条件成立時、対象2体に prevent_battle(block) と blanket suppress_effect の CE が登録される", () => {
    const s = setup();
    const after = runEffect(
      effect,
      [s.src, s.dummyHost, s.op1, s.op2, s.opSpirit2, s.opHigh],
      "src"
    );
    const preventCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "prevent_battle_block"
    );
    const suppressCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "effect_suppression"
    );
    // 2 体ぶん（spirit のみ。nexus C04 は対象外）。
    expect(preventCEs.length).toBe(2);
    expect(suppressCEs.length).toBe(2);
    // prevent と suppress は同じ 2 体を指す。
    const preventTargets = new Set(preventCEs.map((ce) => ce.targetInstanceId));
    const suppressTargets = new Set(
      suppressCEs.map((ce) => ce.targetInstanceId)
    );
    expect([...suppressTargets].sort()).toEqual([...preventTargets].sort());
    // 対象は spirit のみ（nexus op2 は含まれない）。
    expect(preventTargets.has("op2")).toBe(false);
    // blanket: effectFilter を持たない（metadata なし or effectFilter 未設定）。
    for (const ce of suppressCEs) {
      const md = ce.metadata as { effectFilter?: unknown } | undefined;
      expect(md?.effectFilter).toBeUndefined();
    }
  });

  it("combined でない（attach なし）なら効果不発で CE 登録なし", () => {
    const uncombinedSource = inst(def, "src", ALICE, {
      normalCoreCount: 1,
    });
    const attackerDef: CardDefinition = {
      cardNo: "TEST-BSSA01-X02-ATTACKER",
      name: "Test BSSA01 X02 Attacker",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["white"],
      textLines: [],
      tribe: "夜錆",
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const attackerBraveDef: CardDefinition = {
      cardNo: "TEST-BSSA01-X02-ATTACKER-BRAVE",
      name: "Test BSSA01 X02 Attacker Brave",
      printedCategory: "brave",
      colors: ["white"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const attacker = {
      ...inst(attackerDef, "attacker", ALICE, { normalCoreCount: 1 }),
      attachedChildrenIds: ["attacker-brave"],
    };
    const attackerBrave = {
      ...inst(attackerBraveDef, "attacker-brave", ALICE, {
        normalCoreCount: 1,
      }),
      attachedToInstanceId: "attacker",
    };
    const lookup = (id: string): CardDefinition | undefined =>
      id === attackerDef.cardNo
        ? attackerDef
        : id === attackerBraveDef.cardNo
          ? attackerBraveDef
          : getDef(id);
    const triggeredLookup = buildTriggeredEffectLookup([
      def,
      attackerDef,
      attackerBraveDef,
    ]);
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [uncombinedSource, attacker, attackerBrave],
    });
    const queued = queuePendingReactionsFromTriggerEvents(
      {
        ...state,
        activePlayerId: ALICE,
        step: "attack",
      },
      [
        {
          actingPlayerId: ALICE,
          eventKind: "attack",
          source: "action_resolution",
          chainId: "test:batch2-reconvert-cards:594",
          attackId: "attack-1",
          relatedPlayerId: ALICE,
          relatedInstanceId: "attacker",
          amount: null,
          step: "attack",
        },
      ],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: undefined,
      }
    );
    const sourceActions = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "src"
    );
    expect(sourceActions).toHaveLength(0);
  });
});
