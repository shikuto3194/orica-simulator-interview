/**
 * P3-170 V13 / I13 / I14 / I15: 数量(実量の集計)・観測・宣言事実を共通の使用会計に載せる契約テスト。
 *
 *   V13 観測3回のうち発揮1回、実ライフ減少2、フィルタ外1
 *     → 観測3/use1を区別。数量は実量のみ、対象外は枠外。複数producerで二重加算なし。
 *
 * 実カード(BSLH01-C05 / BSGE01-C17 / BSTH08-C01 / BSTH08.5-C21 / BSTH03-C04 / BSLH01-C12)の
 * 盤面を使う。本文に裁定が無い量の基準は「現行の挙動」を保存して固定し、変える場合は理由を記録する
 * (issues/archive/P3-170 の履歴 H7 と、open-questions.md「使用会計」の各項目)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  ContinuousEffect,
  GameState,
  SymbolColor,
} from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  executeBattleResolution,
  getUnblockedLifeDamage,
} from "../src/battle/battle-actions";
import {
  getPlayerLifeCoreCount,
  resolveLifeDamage,
  resolvePendingLifeDamageDiscardChoice,
} from "../src/core/core-system";
import { pruneEffectAccounting } from "../src/effect/effect-usage-accounting";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import { matchesCardFilter } from "../src/card/card-filter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import { queuePendingLeave } from "../src/state-based-actions";
import { captureNormalHandPlayDeclarationRollbackDelta } from "../src/play/play-card-resolution";
import { recordEffectOccurrence } from "../src/effect/effect-occurrence-gate";
import { restorePendingSchedulingAfterRollback } from "../src/effect/pending-resolution-policy";
import { setQuartz } from "../src/mechanics/quartz-system";
import { collectAfterPhysicalLeave } from "./physical-leave-test-helper";
import {
  listEffectUsage,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";
import {
  bpThresholdCappedLifeReduction,
  cappedLifeReduction,
  effectCauseLifeReduction,
  filteredCappedLifeReduction,
  gimmickDeclarationCount,
  listOccurrenceTallies,
  occurrenceTallyOf,
  seedCappedLifeReduction,
  seedEffectCauseLifeReduction,
  seedGimmickDeclarations,
  symbolAdditionRestrictedCount,
} from "./helpers/quantity-usage-fixture";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};

const ALICE = "alice";
const BOB = "bob";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-QTY",
    name: "テスト",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

/** 「相手のライフのコアN個をリザーブに置く」効果を持つスピリット。textLines の有無で効果記述の有無が決まる。 */
function lifeDamageSource(
  cardNo: string,
  amount: number,
  withEffectText: boolean
): CardDefinition {
  return makeDef({
    cardNo,
    name: cardNo,
    textLines: withEffectText ? ["メイン 相手のライフのコアを減らす。"] : [],
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "life_damage", player: "opponent", amount } },
        ],
        textRef: [0],
      },
    ],
  });
}

const EFFECT_TEXT_SOURCE = lifeDamageSource("QTY-EFFECT-TEXT-SRC", 2, true);
const NO_TEXT_SOURCE = lifeDamageSource("QTY-NO-TEXT-SRC", 1, false);

const definitionTable = new Map<string, CardDefinition>([
  ...cardNoMap,
  [EFFECT_TEXT_SOURCE.cardNo, EFFECT_TEXT_SOURCE],
  [NO_TEXT_SOURCE.cardNo, NO_TEXT_SOURCE],
]);
const getDef = (id: string): CardDefinition | undefined =>
  definitionTable.get(id);

function run(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string,
  chainId = "test:effect-usage-quantities:run"
): GameState {
  return executeEffect({
    chainId,
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

const lifeOf = (state: GameState, playerId: string): number =>
  getPlayerLifeCoreCount(state.players.find((p) => p.id === playerId)!);

function boardWith(
  cards: ReturnType<typeof createCardInstance>[],
  life = 5
): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: cards,
    playerOverrides: [
      { lifeNormalCoreCount: life, reserveNormalCoreCount: 0 },
      { lifeNormalCoreCount: life, reserveNormalCoreCount: 0 },
    ],
  });
}

function lifeCapCEs(state: GameState): ContinuousEffect[] {
  return state.activeContinuousEffects.filter(
    (ce) => ce.modifierTag === "life_damage_interception"
  );
}

// ---------------------------------------------------------------
// 観測 (I15) と使用 (use) の区別
// ---------------------------------------------------------------

describe("V13: 観測3回のうち発揮1回 — 観測(observation)と使用(use)を区別する [BSLH01-C05]", () => {
  const c05Def = card("BSLH01-C05");
  const host = makeDef({
    cardNo: "HOST-C05-QTY",
    name: "ENIGMA host",
    printedCategory: "brave",
    quartzHostData: {
      slots: { left: 3, center: 1, right: 3 },
      inheritsSetQuartzEffects: true,
    },
  });
  const cbSource = makeDef({
    cardNo: "CB-SRC-QTY",
    name: "CBスピリット",
    tribe: "CB",
  });
  const leaver = makeDef({ cardNo: "LEAVER-QTY", name: "離脱対象" });
  const defs = new Map<string, CardDefinition>([
    [host.cardNo, host],
    [c05Def.cardNo, c05Def],
    [cbSource.cardNo, cbSource],
    [leaver.cardNo, leaver],
  ]);
  const getD = (id: string): CardDefinition | undefined => defs.get(id);
  const lookup = buildTriggeredEffectLookup([c05Def]);

  function board(): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const cards = [
      createCardInstance(host, {
        ownerPlayerId: ALICE,
        zone: "field",
        instanceId: "host-c05",
      }),
      createCardInstance(c05Def, {
        ownerPlayerId: ALICE,
        zone: "hand",
        instanceId: "c05",
      }),
      createCardInstance(cbSource, {
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        instanceId: "cb-source",
      }),
      ...[1, 2, 3].map((n) =>
        createCardInstance(leaver, {
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          instanceId: `opp-leaver-${n}`,
        })
      ),
    ];
    const state: GameState = {
      ...base,
      cardInstances: cards,
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host-c05"] } : p
      ),
    };
    return setQuartz(
      state,
      {
        quartzInstanceId: "c05",
        hostInstanceId: "host-c05",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getD
    )!;
  }

  function fireLeave(state: GameState, instanceId: string): GameState {
    const waiting = queuePendingLeave({
      state,
      instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      chainId: `test-chain:v13-leave-${instanceId}`,
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: "cb-source",
    });
    return collectAfterPhysicalLeave({
      beforeState: state,
      afterState: waiting,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  const queued = (state: GameState): number =>
    state.pendingTriggeredEffects.length +
    state.pendingPrivateDeclarations.length;

  it("3回観測しても発揮は2回目の1件だけ。観測は measure=observation、使用(use)の枠は作らない", () => {
    let state = board();
    state = fireLeave(state, "opp-leaver-1");
    expect(queued(state)).toBe(0);
    expect(occurrenceTallyOf(state, "c05")?.count).toBe(1);

    state = fireLeave(state, "opp-leaver-2");
    const queuedAtSecond = queued(state);
    expect(queuedAtSecond).toBe(1);
    expect(occurrenceTallyOf(state, "c05")?.count).toBe(2);

    state = fireLeave(state, "opp-leaver-3");
    // 3回目も観測としては数えるが、新たな発揮(キュー)は増えない。
    expect(queued(state)).toBe(queuedAtSecond);
    expect(occurrenceTallyOf(state, "c05")?.count).toBe(3);

    // 観測3回に対して、使用(use)の枠は1つも作られていない。
    expect(listEffectUsage(state)).toEqual([]);
    expect(
      state.effectAccounting.buckets.every((b) => b.measure === "observation")
    ).toBe(true);
  });

  it("発揮1回(use)を記録しても観測3回の枠とは別。観測は発揮可否・使用回数で増減しない", () => {
    let state = board();
    for (const id of ["opp-leaver-1", "opp-leaver-2", "opp-leaver-3"]) {
      state = fireLeave(state, id);
    }
    // 発揮された1回を、この効果の使用回数(〔ターンに1回〕相当)として記録する。
    const used = seedEffectUsage(state, {
      sourceInstanceId: "c05",
      sourceDefinitionId: "BSLH01-C05",
      effectLabel: "effect:2",
      usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
    });
    expect(listEffectUsage(used).map((e) => e.amount)).toEqual([1]);
    expect(occurrenceTallyOf(used, "c05")?.count).toBe(3);
    // 観測と使用は別 measure の枠で、互いの量を変えない。
    expect(
      used.effectAccounting.buckets.map((b) => [b.measure, b.amount]).sort()
    ).toEqual([
      ["observation", 3],
      ["use", 1],
    ]);
  });

  it("ターンが進むと観測は整理され、次ターンは1回目から数え直す", () => {
    let state = board();
    state = fireLeave(state, "opp-leaver-1");
    state = fireLeave(state, "opp-leaver-2");
    expect(occurrenceTallyOf(state, "c05")?.count).toBe(2);
    const next = pruneEffectAccounting({
      ...state,
      turnNumber: state.turnNumber + 1,
    });
    expect(listOccurrenceTallies(next)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// ライフ減少の実量 — フィルタ付き turn_cap (I13 / I14)
// ---------------------------------------------------------------

describe("V13: 実ライフ減少2・対象外1 — 数量は実量のみ、フィルタ外は枠外 [BSGE01-C17]", () => {
  const c17 = card("BSGE01-C17");

  function board() {
    const source = createCardInstance(c17, {
      instanceId: "alice-c17",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const matched = createCardInstance(EFFECT_TEXT_SOURCE, {
      instanceId: "bob-effect-text",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const unmatched = createCardInstance(NO_TEXT_SOURCE, {
      instanceId: "bob-no-text",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    let state = boardWith([source, matched, unmatched]);
    state = run(state, c17.effects![1]!, source.instanceId, ALICE);
    const ce = lifeCapCEs(state).find(
      (c) => c.sourceInstanceId === source.instanceId
    )!;
    return { state, ce, source, matched, unmatched };
  }

  it("一致する効果ライフ減少は上限でクランプした実量だけ計上し、フィルタ外の減少はその枠を消費しない", () => {
    const { state: initial, ce, matched, unmatched } = board();
    let state = initial;

    // 1) 一致(効果記述あり)の2点: 上限1でクランプされ、実際に減るのは1。
    state = run(
      state,
      EFFECT_TEXT_SOURCE.effects![0]!,
      matched.instanceId,
      BOB
    );
    expect(lifeOf(state, ALICE)).toBe(4);
    expect(filteredCappedLifeReduction(state, ALICE, ce)).toBe(1);
    expect(effectCauseLifeReduction(state, ALICE)).toBe(1);

    // 2) もう一度一致: 上限到達済みで実ライフ減少は0。枠にも効果原因にも0を足さない。
    state = run(
      state,
      EFFECT_TEXT_SOURCE.effects![0]!,
      matched.instanceId,
      BOB
    );
    expect(lifeOf(state, ALICE)).toBe(4);
    expect(filteredCappedLifeReduction(state, ALICE, ce)).toBe(1);
    expect(effectCauseLifeReduction(state, ALICE)).toBe(1);

    // 3) フィルタ外(効果記述なし): 上限の対象外なので通常どおり減り、フィルタ付き枠は消費しない。
    state = run(state, NO_TEXT_SOURCE.effects![0]!, unmatched.instanceId, BOB);
    expect(lifeOf(state, ALICE)).toBe(3);
    expect(filteredCappedLifeReduction(state, ALICE, ce)).toBe(1);

    // 実ライフ減少は合計2。効果原因の累積は実量の合計(2)で、フィルタ付き枠(1)と二重加算しない。
    expect(5 - lifeOf(state, ALICE)).toBe(2);
    expect(effectCauseLifeReduction(state, ALICE)).toBe(2);
    // 無印 turn_cap(全体)は無いので全体の枠は記録されない。
    expect(cappedLifeReduction(state, ALICE)).toBe(0);
  });

  it("CE の effectId が保存復元・再構築で変わっても、能力ID(効果元+構造path)の枠は引き継がれる", () => {
    const { state: initial, ce, matched } = board();
    let state = run(
      initial,
      EFFECT_TEXT_SOURCE.effects![0]!,
      matched.instanceId,
      BOB
    );
    expect(filteredCappedLifeReduction(state, ALICE, ce)).toBe(1);

    // 保存→復元を模す: JSON往復し、CE の effectId を別の値(連番カウンタが復元で同期しない状況)にする。
    const restored: GameState = JSON.parse(JSON.stringify(state));
    const renamed = restored.activeContinuousEffects.map((c) =>
      c.effectId === ce.effectId ? { ...c, effectId: "restored-ce-9999" } : c
    );
    state = { ...restored, activeContinuousEffects: renamed };
    const rebuiltCe = lifeCapCEs(state).find(
      (c) => c.sourceInstanceId === ce.sourceInstanceId
    )!;
    expect(rebuiltCe.effectId).not.toBe(ce.effectId);

    expect(filteredCappedLifeReduction(state, ALICE, rebuiltCe)).toBe(1);
    // 上限(1)は引き継がれた累積で判定される: 以降の一致する減少は0。
    state = run(
      state,
      EFFECT_TEXT_SOURCE.effects![0]!,
      matched.instanceId,
      BOB
    );
    expect(lifeOf(state, ALICE)).toBe(4);
  });

  it("別の発揮元(別個体)の同じ効果は別の枠。同じ減少でも各枠が一度ずつ実量を記録し、二重にならない", () => {
    const sourceA = createCardInstance(c17, {
      instanceId: "alice-c17-a",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const sourceB = createCardInstance(c17, {
      instanceId: "alice-c17-b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const matched = createCardInstance(EFFECT_TEXT_SOURCE, {
      instanceId: "bob-effect-text",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    let state = boardWith([sourceA, sourceB, matched]);
    for (const s of [sourceA, sourceB]) {
      state = run(state, c17.effects![1]!, s.instanceId, ALICE);
    }
    const [ceA, ceB] = [sourceA, sourceB].map(
      (s) => lifeCapCEs(state).find((c) => c.sourceInstanceId === s.instanceId)!
    );
    state = run(
      state,
      EFFECT_TEXT_SOURCE.effects![0]!,
      matched.instanceId,
      BOB
    );
    expect(lifeOf(state, ALICE)).toBe(4);
    expect(filteredCappedLifeReduction(state, ALICE, ceA!)).toBe(1);
    expect(filteredCappedLifeReduction(state, ALICE, ceB!)).toBe(1);
    // 同じ減少(実量1)は効果原因の枠へ一度だけ。2枠に載ったからといって2にならない。
    expect(effectCauseLifeReduction(state, ALICE)).toBe(1);
  });
});

// ---------------------------------------------------------------
// ライフ減少の実量 — バトル(全体・BP閾値の複数枠) (I14)
// ---------------------------------------------------------------

describe("V13: バトルのライフ減少は確定点一つで各枠に一度だけ計上する [BSTH08-C01 + BSTH08.5-C21]", () => {
  const c01 = card("BSTH08-C01");
  const c21 = card("BSTH08.5-C21");

  function withBattle(
    state: GameState,
    attackers: {
      entityId: string;
      leaderId: string;
      symbols: number;
      bp: number;
    }[],
    attackId: string,
    prebuiltGroup = false
  ): GameState {
    const toSymbols = (n: number): SymbolColor[] =>
      Array.from({ length: n }, () => "red" as SymbolColor);
    const battleEntities: BattleEntity[] = attackers.map((a) => ({
      entityId: a.entityId,
      memberInstanceIds: [a.leaderId],
      resolvedBp: a.bp,
      resolvedSymbols: toSymbols(a.symbols),
      attackState: "attacking",
    }));
    const group: BattleResolutionGroup = {
      attackId,
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      symbolResolutionOrder: attackers.map((a) => a.entityId),
      participantSnapshots: attackers.map((a) => ({
        entityId: a.entityId,
        memberInstanceIds: [a.leaderId],
        resolvedBp: a.bp,
        resolvedSymbols: toSymbols(a.symbols),
        blockedBy: [],
      })),
    };
    return {
      ...state,
      activePlayerId: BOB,
      activeAttack: {
        attackId,
        primaryEntityId: attackers[0]!.entityId,
        participantEntityIds: attackers.map((a) => a.entityId),
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: attackers.map((a) => ({
          participantEntityId: a.entityId,
          blockedByEntityIds: [],
        })),
        symbolResolutionOrder: attackers.map((a) => a.entityId),
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities,
      // executeBattleResolution は解決グループを自分で組む。単独の照会だけ事前に組んだ群を使う。
      battleResolutionGroup: prebuiltGroup ? group : null,
    };
  }

  function resolveBattle(state: GameState): GameState {
    return executeBattleResolution({
      state,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    }).state;
  }

  function board(): GameState {
    const c01Card = createCardInstance(c01, {
      instanceId: "alice-c01",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const c21Card = createCardInstance(c21, {
      instanceId: "alice-c21",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const low = createCardInstance(card("BSSA01-C04"), {
      instanceId: "bob-low-bp",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const high = createCardInstance(card("BSSA01-C04"), {
      instanceId: "bob-high-bp",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = boardWith([c01Card, c21Card, low, high], 8);
    state = run(state, c21.effects![0]!, c21Card.instanceId, ALICE);
    state = run(state, c01.effects![2]!, c01Card.instanceId, ALICE);
    return state;
  }

  it("BP閾値以下のアタック: 全体(turn_cap)とBP閾値の枠が、同じ実量1を各一度だけ記録する", () => {
    let state = board();
    state = resolveBattle(
      withBattle(
        state,
        [{ entityId: "e1", leaderId: "bob-low-bp", symbols: 3, bp: 5000 }],
        "v13-atk-1"
      )
    );
    expect(lifeOf(state, ALICE)).toBe(7);
    expect(cappedLifeReduction(state, ALICE)).toBe(1);
    expect(bpThresholdCappedLifeReduction(state, ALICE)).toBe(1);
    // バトルは効果原因ではない。
    expect(effectCauseLifeReduction(state, ALICE)).toBe(0);
  });

  it("BP閾値超えのアタック: 閾値の枠は消費しない(枠外)。全体の枠だけが上限到達後の0を保つ", () => {
    let state = board();
    // 閾値内(BP5000)で全体上限(1)に到達。
    state = resolveBattle(
      withBattle(
        state,
        [{ entityId: "e1", leaderId: "bob-low-bp", symbols: 3, bp: 5000 }],
        "v13-atk-1"
      )
    );
    expect(cappedLifeReduction(state, ALICE)).toBe(1);
    expect(bpThresholdCappedLifeReduction(state, ALICE)).toBe(1);
    // 閾値超え(BP8000)は閾値の対象外。全体上限に到達済みなので実際には減らず、枠も増えない。
    state = resolveBattle(
      withBattle(
        state,
        [{ entityId: "e2", leaderId: "bob-high-bp", symbols: 3, bp: 8000 }],
        "v13-atk-2"
      )
    );
    expect(lifeOf(state, ALICE)).toBe(7);
    expect(cappedLifeReduction(state, ALICE)).toBe(1);
    expect(bpThresholdCappedLifeReduction(state, ALICE)).toBe(1);
  });

  it("H7(現行挙動の固定): 全体上限が先に到達済みでも、BP閾値の枠は『閾値内の予定量』を実減少0のまま加算する", () => {
    // 現行はBP閾値の累積を無条件(実際に減った分ではなく getUnblockedLifeDamage の予定量)で加算する。
    // 裁定が無いため変更せず、事実として固定する(過大計上の疑い H7)。
    let state = board();
    state = seedCappedLifeReduction(state, ALICE, 1);
    state = resolveBattle(
      withBattle(
        state,
        [{ entityId: "e1", leaderId: "bob-low-bp", symbols: 3, bp: 5000 }],
        "v13-atk-h6"
      )
    );
    // 全体上限(1)に到達済みなので実際には1も減らない。
    expect(lifeOf(state, ALICE)).toBe(8);
    expect(cappedLifeReduction(state, ALICE)).toBe(1);
    // それでもBP閾値の枠は1を加算する(現行)。
    expect(bpThresholdCappedLifeReduction(state, ALICE)).toBe(1);
  });

  it("getUnblockedLifeDamage は状態を変えず、確定点(executeBattleResolution)で一度だけ計上する", () => {
    const attackers = [
      { entityId: "e1", leaderId: "bob-low-bp", symbols: 3, bp: 5000 },
    ];
    const state = withBattle(board(), attackers, "v13-atk-pure");
    // 照会に渡した state の会計は、照会の前後で変わらない (照会は計上しない)。
    const probe = withBattle(board(), attackers, "v13-atk-pure", true);
    const probeBefore = JSON.stringify(probe.effectAccounting);
    const dmg = getUnblockedLifeDamage(probe, getDef);
    expect(dmg?.bpThresholdCapConsumed).toBe(1);
    expect(JSON.stringify(probe.effectAccounting)).toBe(probeBefore);
    expect(bpThresholdCappedLifeReduction(probe, ALICE)).toBe(0);
    expect(bpThresholdCappedLifeReduction(state, ALICE)).toBe(0);
    const resolved = resolveBattle(state);
    expect(bpThresholdCappedLifeReduction(resolved, ALICE)).toBe(1);
    // 確定点で計上されるのは1回分 (全体上限の枠 + BP閾値の枠の2つ)。
    expect(
      resolved.effectAccounting.buckets.filter((b) => b.measure === "amount")
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------
// 効果原因の累積 (turnThreshold) と宣言コストゲート
// ---------------------------------------------------------------

describe("V13: 効果原因・宣言事実は取消の対象にならない事実/実量で、使用(use)とは別の枠 [BSLH01-C12]", () => {
  const c12 = card("BSLH01-C12");

  function gateBoard(): GameState {
    const src = createCardInstance(c12, {
      instanceId: "alice-c12",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const base = boardWith([src]);
    return rebuildContinuousEffectsFromField(base, getDef);
  }

  it("宣言(pay)で宣言事実が+1、〔ターンに1回〕のuseも+1。別measureの枠で、ライフは軽減分だけ守られる", () => {
    const pending = resolveLifeDamage(
      gateBoard(),
      ALICE,
      1,
      [],
      { cause: "battle", actingPlayerId: BOB },
      getDef
    );
    expect(pending.pendingLifeDamageDiscardChoice).not.toBeNull();
    const paid = resolvePendingLifeDamageDiscardChoice(pending, "pay");
    expect(lifeOf(paid, ALICE)).toBe(5);
    expect(gimmickDeclarationCount(paid, ALICE)).toBe(1);
    expect(gimmickDeclarationCount(paid, BOB)).toBe(0);

    const measures = paid.effectAccounting.buckets.map((b) => [
      b.measure,
      b.amount,
    ]);
    expect(measures.sort()).toEqual([
      ["fact", 1],
      ["use", 1],
    ]);
    // 宣言事実は取消の対象にならない(receipt を残さない)。use だけが取消できる receipt を持つ。
    const factKeys = new Set(
      paid.effectAccounting.buckets
        .filter((b) => b.measure === "fact")
        .map((b) => b.key)
    );
    expect(
      paid.effectAccounting.operations.every((op) =>
        op.deltas.every((d) => !factKeys.has(d.bucketKey))
      )
    ).toBe(true);
  });

  it("宣言事実は CardFilter.declaredThisTurn と declaration_count_this_turn の共通の照会元。次のターンは0に戻る", () => {
    const unit = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const base = boardWith([unit]);
    const filterOn = (state: GameState, declared: boolean) =>
      matchesCardFilter(
        unit,
        getDef(unit.definitionId)!,
        { declaredThisTurn: declared },
        { state }
      );
    expect(filterOn(base, false)).toBe(true);
    expect(filterOn(base, true)).toBe(false);

    const declared = seedGimmickDeclarations(base, BOB, 2);
    expect(filterOn(declared, true)).toBe(true);
    expect(filterOn(declared, false)).toBe(false);
    expect(gimmickDeclarationCount(declared, BOB)).toBe(2);
    expect(
      evaluateCondition(
        declared,
        [{ kind: "life_value", player: "self", min: 0 }],
        unit.instanceId,
        BOB,
        getDef
      )
    ).toBe(true);

    const nextTurn = pruneEffectAccounting({
      ...declared,
      turnNumber: declared.turnNumber + 1,
    });
    expect(gimmickDeclarationCount(nextTurn, BOB)).toBe(0);
    expect(filterOn(nextTurn, false)).toBe(true);
  });

  it("効果原因の累積(turnThreshold)は turnNumber が進むと整理される", () => {
    const state = seedEffectCauseLifeReduction(boardWith([]), ALICE, 3);
    expect(effectCauseLifeReduction(state, ALICE)).toBe(3);
    const next = pruneEffectAccounting({
      ...state,
      turnNumber: state.turnNumber + 1,
    });
    expect(effectCauseLifeReduction(next, ALICE)).toBe(0);
  });
});

// ---------------------------------------------------------------
// シンボル追加の制限 (I13)
// ---------------------------------------------------------------

describe("V13: シンボル追加制限は付与した数量だけを記録し、ブロックした試行は枠外 [BSTH03-C04]", () => {
  const c04 = card("BSTH03-C04");
  const symbolAdd = (
    count: number
  ): NonNullable<CardDefinition["effects"]>[number] => ({
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: {
          kind: "symbol_add",
          target: { kind: "self" },
          symbol: "red",
          count,
          duration: { scope: "while_on_field" },
        },
      },
    ],
  });
  // BSTH03-C04 effects[2] と同型 (相手のメインステップ中、スピリット/アルティメットの効果による追加を maxTotal まで)。
  const restrict = (
    maxTotal: number
  ): NonNullable<CardDefinition["effects"]>[number] => ({
    timing: { kind: "continuous" },
    timingScope: { player: "opponent", period: "main" },
    steps: [
      {
        action: {
          kind: "restrict_symbol_addition",
          player: "opponent",
          maxTotal,
          sourceFilter: { category: ["spirit", "ultimate"] },
          duration: { scope: "while_on_field" },
        },
      },
    ],
  });

  function board() {
    const owner = createCardInstance(c04, {
      instanceId: "riggle-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const spirit = createCardInstance(c04, {
      instanceId: "bob-spirit-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    let state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [owner, spirit],
    };
    state = run(state, restrict(3), owner.instanceId, ALICE);
    const ce = state.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "restrict_symbol_addition" &&
        c.targetInstanceId === BOB
    )!;
    return { state, ce, spirit };
  }

  it("通った追加の数量(対象数×count)を累積し、上限を超える追加はブロックされ数量に入らない", () => {
    const { state: initial, ce, spirit } = board();
    let state = initial;
    state = run(state, symbolAdd(2), spirit.instanceId, BOB);
    expect(symbolAdditionRestrictedCount(state, BOB, ce)).toBe(2);
    // 2+2 > 3: ブロック。付与されないので数量は2のまま。
    state = run(state, symbolAdd(2), spirit.instanceId, BOB);
    expect(state.log.at(-1)).toContain("blocked-by-restrict_symbol_addition");
    expect(symbolAdditionRestrictedCount(state, BOB, ce)).toBe(2);
    // 2+1 = 3 は通る。
    state = run(state, symbolAdd(1), spirit.instanceId, BOB);
    expect(symbolAdditionRestrictedCount(state, BOB, ce)).toBe(3);
    // 制限を受けるのは BOB(制限対象)だけ。ALICE の枠は無い。
    expect(symbolAdditionRestrictedCount(state, ALICE, ce)).toBe(0);
  });

  it("CE の effectId が復元で変わっても累積が引き継がれ、上限を巻き戻さない", () => {
    const { state: initial, ce, spirit } = board();
    let state = run(initial, symbolAdd(2), spirit.instanceId, BOB);
    const restored: GameState = JSON.parse(JSON.stringify(state));
    state = {
      ...restored,
      activeContinuousEffects: restored.activeContinuousEffects.map((c) =>
        c.effectId === ce.effectId ? { ...c, effectId: "restored-ce-1" } : c
      ),
    };
    state = run(state, symbolAdd(2), spirit.instanceId, BOB);
    // 累積2のまま 2+2>3 としてブロックされる(effectId が変わっても枠はリセットされない)。
    expect(state.log.at(-1)).toContain("blocked-by-restrict_symbol_addition");
    expect(symbolAdditionRestrictedCount(state, BOB, ce)).toBe(2);
  });
});

// ---------------------------------------------------------------
// 裁定が無く現行挙動を固定する懸念 (open-questions.md「使用会計」の数量枠の基準の項目)
// ---------------------------------------------------------------

describe("現行挙動の固定(裁定待ち): life_reduced_this_turn の参照元", () => {
  it("life_reduced_this_turn は全体 turn_cap の累積を読む。turn_cap CE を経由しない減少(forcedUnpreventable)では偽のまま", () => {
    const c01 = card("BSTH08-C01");
    const src = createCardInstance(c01, {
      instanceId: "alice-c01-h8",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = boardWith([src]);
    state = run(state, c01.effects![2]!, src.instanceId, ALICE);
    const clause = [
      { kind: "life_reduced_this_turn", player: "self" },
    ] as const;
    const reduced = (s: GameState) =>
      evaluateCondition(s, [...clause], src.instanceId, ALICE, getDef);
    expect(reduced(state)).toBe(false);

    // turn_cap を経由しない実減少(免疫由来の forcedUnpreventable)。ライフは実際に減る。
    const bypass = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "battle", actingPlayerId: BOB, forcedUnpreventable: true },
      getDef
    );
    expect(lifeOf(bypass, ALICE)).toBe(4);
    expect(cappedLifeReduction(bypass, ALICE)).toBe(0);
    expect(reduced(bypass)).toBe(false);

    // turn_cap を経由した実減少では真。
    const viaCap = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "battle", actingPlayerId: BOB },
      getDef
    );
    expect(lifeOf(viaCap, ALICE)).toBe(4);
    expect(cappedLifeReduction(viaCap, ALICE)).toBe(1);
    expect(reduced(viaCap)).toBe(true);
  });
});

describe("現行挙動の固定(裁定待ち、H7 を含む): 効果起因のライフ減少 [BSTH08.5-C21]", () => {
  it("BSTH08.5-C21 の battleOnly 未指定: BP閾値付き CE は battleOnly を持たないため、BP6000以下のスピリットの『効果』によるライフ減少も全防止する。阻止された原量が効果原因の累積に載る", () => {
    // 本文は「BP6000以下のアタックでは〜」(アタック限定)。効果起因まで防ぐのは疑わしい挙動だが、
    // 裁定が無いため直さず現行を固定する(根拠: 10_rules/05b、dsl-types.ts attackerBpTurnCap の doc)。
    const c21 = card("BSTH08.5-C21");
    const c21Card = createCardInstance(c21, {
      instanceId: "alice-c21-h5",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const lowBpSource = createCardInstance(EFFECT_TEXT_SOURCE, {
      instanceId: "bob-low-bp-effect",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    let state = boardWith([c21Card, lowBpSource], 8);
    state = run(state, c21.effects![0]!, c21Card.instanceId, ALICE);
    state = run(
      state,
      EFFECT_TEXT_SOURCE.effects![0]!,
      lowBpSource.instanceId,
      BOB
    );
    // 効果で2点減るはずが、全防止(replace)されて減らない。
    expect(lifeOf(state, ALICE)).toBe(8);
    expect(state.log.at(-1)).toBe(
      "effect:life_damage_interception:replace:alice:2"
    );
    // 完全置換の分岐は、減っていない原量(2)を効果原因の累積に載せる(現行)。BP閾値/全体の枠は動かない。
    expect(effectCauseLifeReduction(state, ALICE)).toBe(2);
    expect(bpThresholdCappedLifeReduction(state, ALICE)).toBe(0);
    expect(cappedLifeReduction(state, ALICE)).toBe(0);
  });
});

describe("宣言取消: 取消の対象は観測(と使用)のreceiptだけで、確定した実量・宣言事実は戻さない", () => {
  it("宣言中に増えた 観測 / 実量 / 宣言事実 のうち、宣言取消が戻す操作は観測の receipt のみ", () => {
    const before = boardWith([]);
    let after = recordEffectOccurrence({
      state: before,
      sourceInstanceId: "q-src",
      sourceDefinitionId: "Q-DEF",
      effectLabel: "effect:0",
      duration: "turn",
      playerId: ALICE,
    });
    after = seedCappedLifeReduction(after, ALICE, 2);
    after = seedEffectCauseLifeReduction(after, ALICE, 2);
    after = seedGimmickDeclarations(after, ALICE, 1);

    const delta = captureNormalHandPlayDeclarationRollbackDelta({
      beforeState: before,
      afterState: after,
    });
    const ids = delta.declarationUsageOperationIds ?? [];
    expect(ids).toHaveLength(1);
    const operation = after.effectAccounting.operations.find(
      (op) => op.operationId === ids[0]
    )!;
    const touched = after.effectAccounting.buckets.filter((b) =>
      operation.deltas.some((d) => d.bucketKey === b.key)
    );
    expect(touched.map((b) => b.measure)).toEqual(["observation"]);
    // 実量・宣言事実の枠は receipt を持たない(取消で巻き込まれない)。
    const amountAndFact = after.effectAccounting.buckets.filter(
      (b) => b.measure === "amount" || b.measure === "fact"
    );
    expect(amountAndFact.length).toBeGreaterThan(0);
    expect(
      after.effectAccounting.operations.every((op) =>
        op.deltas.every((d) =>
          amountAndFact.every((b) => b.key !== d.bucketKey)
        )
      )
    ).toBe(true);
  });
});

describe("取消用 snapshot への巻き戻し: 観測した出来事は戻さず、実量・使用は盤面と一緒に戻す", () => {
  it("N回目観測の tally は誘発待機列と同じく巻き戻しで失われない。実量と使用回数は snapshot の値に戻る", () => {
    const snapshot = boardWith([]);
    let current = recordEffectOccurrence({
      state: snapshot,
      sourceInstanceId: "q-src",
      sourceDefinitionId: "Q-DEF",
      effectLabel: "effect:0",
      duration: "turn",
      playerId: ALICE,
    });
    current = seedCappedLifeReduction(current, ALICE, 2);
    current = seedEffectUsage(current, {
      sourceInstanceId: "q-src",
      sourceDefinitionId: "Q-DEF",
      effectLabel: "effect:1",
      playerId: ALICE,
      usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
    });
    const restored = restorePendingSchedulingAfterRollback(snapshot, current);
    expect(occurrenceTallyOf(restored, "q-src")?.count).toBe(1);
    expect(cappedLifeReduction(restored, ALICE)).toBe(0);
    expect(listEffectUsage(restored)).toEqual([]);
  });
});
