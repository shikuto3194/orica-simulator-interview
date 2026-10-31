/**
 * P3-67 routing 一般化: queueReactionsInternal の per-player + prune 検証。
 *
 * 汎用 burst check は「イベント当事者 (subject) の単一 check」ではなく、
 * 各プレイヤーを候補 owner として作り getAvailableBurstSourceChoices で prune する。
 * これにより:
 *  - whose:opponent の burst が「相手の」イベントを拾える (opponent-routing)。
 *  - responder 不在の check は積まれない (空 pass プロンプト解消)。
 *  - whose:self は subject 側でのみ残る (従来挙動)。
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src/model";

function burstCardDef(
  cardNo: string,
  trigger: import("../src/model").BurstTrigger
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: ["burst"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "burst", trigger },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ],
  };
}

const oppSummonBurst = burstCardDef("BURST-OPP-SUMMON", {
  kind: "opponent_summon",
});
const selfLifeBurst = burstCardDef("BURST-SELF-LIFE", {
  kind: "life_decrease",
  player: "self",
});
const oppHandBurst = burstCardDef("BURST-OPP-HAND", {
  kind: "hand_increase",
  player: "opponent",
});
const oppAttackStepBurst = burstCardDef("BURST-OPP-ATTACK-STEP", {
  kind: "step_timing",
  player: "opponent",
  step: "attack",
  subPhase: "start",
});
const summonedSpirit: CardDefinition = {
  cardNo: "SUMMONED-SP",
  name: "summoned",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const ALL = [
  oppSummonBurst,
  selfLifeBurst,
  oppHandBurst,
  oppAttackStepBurst,
  summonedSpirit,
];
const defMap = new Map(ALL.map((c) => [c.cardNo, c]));
const lookups = {
  getCardDefinitionById: (id: string) => defMap.get(id),
  getRegisteredTriggeredEffectActions: () => undefined,
  getRegisteredBurstActions: buildBurstEffectLookup(ALL),
};

/** alice が burstDef を burst zone にセットした状態。bob 側に被召喚スピリットも置ける。 */
function stateWithAliceBurst(
  burstDef: CardDefinition,
  extra: GameState["cardInstances"] = []
): GameState {
  const burstCard = createCardInstance(burstDef, {
    instanceId: "alice-burst",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "bob",
    step: "main",
    cardInstances: [burstCard, ...extra],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "alice-burst" }],
  };
}

describe("opponent-routing: 相手が召喚した後 (whose:opponent)", () => {
  it("bob の召喚で alice の opponent_summon burst check が積まれる (owner=alice)", () => {
    const bobSpirit = createCardInstance(summonedSpirit, {
      instanceId: "bob-sp",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const state = stateWithAliceBurst(oppSummonBurst, [bobSpirit]);
    const summonEvent: CollectedTriggerEvent = {
      actingPlayerId: "bob",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:burst-routing-per-player:123",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: "bob-sp",
      amount: null,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [summonEvent],
      undefined,
      lookups
    );
    const checks = result.pendingBurstChecks.filter(
      (c) => c.eventKind === "summon"
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.actingPlayerId).toBe("alice");
    expect(checks[0]!.relatedPlayerId).toBe("bob");
  });
});

describe("opponent-routing: 相手の手札が増えた後 (hand_increase, whose:opponent)", () => {
  it("bob の手札増加で alice の hand_increase burst check が積まれる (owner=alice)", () => {
    const state = stateWithAliceBurst(oppHandBurst);
    const event: CollectedTriggerEvent = {
      actingPlayerId: "bob",
      eventKind: "increase_hand",
      source: "action_resolution",
      chainId: "test:burst-routing-per-player:151",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: null,
      amount: 2,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      lookups
    );
    const checks = result.pendingBurstChecks.filter(
      (c) => c.eventKind === "hand_increase"
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.actingPlayerId).toBe("alice");
    expect(checks[0]!.relatedPlayerId).toBe("bob");
  });

  it("alice 自身の手札増加では alice の whose:opponent burst は発火しない", () => {
    const state = stateWithAliceBurst(oppHandBurst);
    const event: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "increase_hand",
      source: "action_resolution",
      chainId: "test:burst-routing-per-player:177",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: 2,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      lookups
    );
    expect(result.pendingBurstChecks).toHaveLength(0);
  });
});

describe("step_timing: 相手のアタックステップ開始後 (whose:opponent + step/subPhase matcher)", () => {
  function startStepEvent(
    step: import("../src/model").Step,
    subPhase: "start" | "end"
  ): CollectedTriggerEvent {
    return {
      actingPlayerId: "bob",
      eventKind: subPhase === "end" ? "end_step" : "start_step",
      source: "step_transition",
      chainId: "test:burst-routing-per-player:202",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: null,
      amount: null,
      step,
      subPhase,
    };
  }

  it("bob のアタックステップ開始 → alice の step_timing burst check (owner=alice)", () => {
    const state = stateWithAliceBurst(oppAttackStepBurst);
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [startStepEvent("attack", "start")],
      undefined,
      lookups
    );
    const checks = result.pendingBurstChecks.filter(
      (c) => c.eventKind === "step_timing"
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.actingPlayerId).toBe("alice");
  });

  it("別ステップ (core) 開始では matcher 不一致で発火しない", () => {
    const state = stateWithAliceBurst(oppAttackStepBurst);
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [startStepEvent("core", "start")],
      undefined,
      lookups
    );
    expect(result.pendingBurstChecks).toHaveLength(0);
  });

  it("アタックステップ終了 (subPhase=end) では発火しない", () => {
    const state = stateWithAliceBurst(oppAttackStepBurst);
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [startStepEvent("attack", "end")],
      undefined,
      lookups
    );
    expect(result.pendingBurstChecks).toHaveLength(0);
  });
});

describe("whose:self は subject 側でのみ残る", () => {
  it("alice のライフ減少 → alice の reduce_life burst check (owner=alice)", () => {
    const state = stateWithAliceBurst(selfLifeBurst);
    const event: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "reduce_life",
      source: "action_resolution",
      chainId: "test:burst-routing-per-player:257",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: 1,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      lookups
    );
    const checks = result.pendingBurstChecks.filter(
      (c) => c.eventKind === "reduce_life"
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.actingPlayerId).toBe("alice");
  });

  it("bob のライフ減少 → alice の whose:self burst は発火しない (prune)", () => {
    const state = stateWithAliceBurst(selfLifeBurst);
    const event: CollectedTriggerEvent = {
      actingPlayerId: "bob",
      eventKind: "reduce_life",
      source: "action_resolution",
      chainId: "test:burst-routing-per-player:282",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: null,
      amount: 1,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      lookups
    );
    expect(result.pendingBurstChecks).toHaveLength(0);
  });
});

describe("responder 不在は積まれない (空 pass プロンプト解消)", () => {
  it("burst 未セット → reduce_life で burst check 0 件", () => {
    const state = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
    };
    const event: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "reduce_life",
      source: "action_resolution",
      chainId: "test:burst-routing-per-player:309",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: 1,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      lookups
    );
    expect(result.pendingBurstChecks).toHaveLength(0);
  });
});
