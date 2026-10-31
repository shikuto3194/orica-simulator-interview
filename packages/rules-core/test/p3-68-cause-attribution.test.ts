/**
 * P3-68: burst cause 帰属の取りこぼし修正の検証。
 *
 * ギャップ 2: core-deficit vanish の causePlayerId 帰属
 *   → deriveTriggerEventCauseFromPendingLeave が state_based でも causePlayerId 帰属時は
 *     opponent_effect を返す + runStateBasedActions が causedByPlayerId を vanish に伝搬。
 * ギャップ 1: hand_increase の grower-relative cause
 *   → collectTriggerEventsFromStateDelta が increase_hand に grower-relative cause を付与 +
 *     getAvailableBurstSourceChoices が cause:[self_effect] で「相手の効果によって」を絞る +
 *     generateBurstRegistrations が timing.cause を伝搬。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  deriveTriggerEventCauseFromPendingLeave,
  collectTriggerEventsFromStateDelta,
  runStateBasedActions,
  getAvailableBurstSourceChoices,
  generateBurstRegistrations,
  matchesTriggerEvent,
} from "../src";
import type {
  BurstTrigger,
  CardDefinition,
  GameState,
  PendingBurstCheck,
  RegisteredBurstAction,
} from "../src";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

// ============================================================
// ギャップ 2: leave cause 導出 (core-deficit vanish の causePlayerId)
// ============================================================

describe("deriveTriggerEventCauseFromPendingLeave: state_based + causePlayerId [P3-68]", () => {
  it("state_based_action + causePlayerId が相手 → opponent_effect (相手コア奪取消滅)", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "state_based_action", causePlayerId: "bob" },
        "alice"
      )
    ).toBe("opponent_effect");
  });

  it("state_based_action + causePlayerId が所有者自身 → state_based_self (自分のコア移動)", () => {
    // ENGINE-trigger-cause-self-state-based-exclude: 自分帰属の state-based vanish を
    // 独立した cause に分けることで、「自分による消滅では発揮されない」型 triggerFilter
    // (BSES01-R03 effects[4] 等) が matcher で state_based のみ許可しても誤発火しない。
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "state_based_action", causePlayerId: "alice" },
        "alice"
      )
    ).toBe("state_based_self");
  });

  it("state_based_action + causePlayerId=null → state_based (従来挙動維持)", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "state_based_action", causePlayerId: null },
        "alice"
      )
    ).toBe("state_based");
  });

  it("battle 由来は causePlayerId に関係なく battle", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "battle", causePlayerId: "bob" },
        "alice"
      )
    ).toBe("battle");
  });

  it("bp_compare + causePlayerId が相手 → opponent_bp_compare (効果扱いには潰さない)", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "bp_compare", causePlayerId: "bob" },
        "alice"
      )
    ).toBe("opponent_bp_compare");
  });

  it("bp_compare + causePlayerId が所有者自身 → self_bp_compare", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "bp_compare", causePlayerId: "alice" },
        "alice"
      )
    ).toBe("self_bp_compare");
  });

  it("bp_compare + causePlayerId=null → bp_compare (帰属不明の互換 cause)", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "bp_compare", causePlayerId: null },
        "alice"
      )
    ).toBe("bp_compare");
  });

  it("Timing.cause:'bp_compare' は opponent/self_bp_compare も受ける", () => {
    expect(
      matchesTriggerEvent(
        { family: "leave_field", causeKind: "destroy", cause: "bp_compare" },
        {
          family: "leave_field",
          causeKind: "destroy",
          cause: "opponent_bp_compare",
          validationMode: "snapshot_only",
        }
      )
    ).toBe(true);
    expect(
      matchesTriggerEvent(
        {
          family: "leave_field",
          causeKind: "destroy",
          cause: "opponent_bp_compare",
        },
        {
          family: "leave_field",
          causeKind: "destroy",
          cause: "self_bp_compare",
          validationMode: "snapshot_only",
        }
      )
    ).toBe(false);
  });

  it("既存の『相手によって』cause ペアは opponent_bp_compare も受ける", () => {
    expect(
      matchesTriggerEvent(
        {
          family: "leave_field",
          causeKind: "destroy",
          cause: ["opponent_effect", "battle"],
        },
        {
          family: "leave_field",
          causeKind: "destroy",
          cause: "opponent_bp_compare",
          validationMode: "snapshot_only",
        }
      )
    ).toBe(true);
  });

  it("effect_resolution + 相手 → opponent_effect / 自分 → self_effect (従来挙動)", () => {
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "effect_resolution", causePlayerId: "bob" },
        "alice"
      )
    ).toBe("opponent_effect");
    expect(
      deriveTriggerEventCauseFromPendingLeave(
        { cause: "effect_resolution", causePlayerId: "alice" },
        "alice"
      )
    ).toBe("self_effect");
  });
});

describe("Timing.triggerCausedBy: battle の直接加害者を listener 基準で絞る", () => {
  const observerDef: CardDefinition = {
    cardNo: "TEST-TRIGGER-CAUSED-BY",
    name: "trigger caused by observer",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple"],
    levelDefs: [{ level: 1, requiredCores: 1 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "reduce_life",
          cause: ["opponent_effect", "battle"],
          triggerCausedBy: "opponent",
        },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  const lookup = buildTriggeredEffectLookup([observerDef]);
  const getDef = (id: string) =>
    id === observerDef.cardNo ? observerDef : undefined;

  function choices(causedByPlayerId: string) {
    const observer = createCardInstance(observerDef, {
      instanceId: "caused-by-observer",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [observer],
      }),
      step: "attack",
      window: "battle_resolution",
    };
    return getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: {
        pendingId: "trigger-caused-by",
        actingPlayerId: "alice",
        eventKind: "reduce_life",
        event: {
          family: "life",
          cause: "battle",
          validationMode: "snapshot_only",
        },
        source: "battle_resolution",
        chainId: "battle-test",
        attackId: "attack-test",
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "battle_resolution",
        resolvedSourceInstanceIds: [],
        cause: "battle",
        causedByPlayerId,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
  }

  it("相手のアタック由来なら候補に含む", () => {
    expect(choices("bob")).toHaveLength(1);
  });

  it("自己アタック由来なら候補に含まない", () => {
    expect(choices("alice")).toHaveLength(0);
  });
});

describe("runStateBasedActions: core-deficit vanish へ causedByPlayerId 伝搬 [P3-68]", () => {
  function stateWithDeficientSpirit(): GameState {
    // Lv1 に必要なコアが無い (コア0) スピリットを field に置く。
    const spiritDef: CardDefinition = {
      cardNo: "TEST-DEFICIT",
      name: "deficit spirit",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const spirit = createCardInstance(spiritDef, {
      instanceId: "deficit-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    return { ...base, cardInstances: [spirit] };
  }

  it("causedByPlayerId 指定 → vanish の causePlayerId に伝搬", () => {
    const result = runStateBasedActions(
      stateWithDeficientSpirit(),
      undefined,
      "bob"
    );
    const vanish = result.state.pendingLeaveEntities.find(
      (pl) => pl.instanceId === "deficit-1"
    );
    expect(vanish?.kind).toBe("vanish");
    expect(vanish?.cause).toBe("state_based_action");
    expect(vanish?.causePlayerId).toBe("bob");
  });

  it("causedByPlayerId 未指定 → causePlayerId=null (従来挙動)", () => {
    const result = runStateBasedActions(stateWithDeficientSpirit());
    const vanish = result.state.pendingLeaveEntities.find(
      (pl) => pl.instanceId === "deficit-1"
    );
    expect(vanish?.causePlayerId).toBeNull();
  });
});

// ============================================================
// ギャップ 1: hand_increase の grower-relative cause
// ============================================================

describe("collectTriggerEventsFromStateDelta: increase_hand cause [P3-68]", () => {
  function deltaWithHandIncrease(causedByPlayerId?: string | null) {
    const before = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const after: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === "bob" ? { ...p, handCount: p.handCount + 1 } : p
      ),
    };
    return collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      ...(causedByPlayerId !== undefined ? { causedByPlayerId } : {}),
    }).filter((e) => e.eventKind === "increase_hand");
  }

  it("手札が増えたプレイヤー自身が起因 → self_effect", () => {
    const events = deltaWithHandIncrease("bob");
    expect(events).toHaveLength(1);
    expect(events[0]!.cause).toBe("self_effect");
  });

  it("別プレイヤー起因 (相手のバウンス等) → opponent_effect", () => {
    const events = deltaWithHandIncrease("alice");
    expect(events[0]!.cause).toBe("opponent_effect");
  });

  it("causedByPlayerId 未指定 → 効果由来とは推定しない", () => {
    const events = deltaWithHandIncrease(undefined);
    expect(events[0]!.cause).toBe("state_based");
  });
});

describe("generateBurstRegistrations: hand_increase の明示 cause 伝搬 [P3-68]", () => {
  function handBurstCard(): CardDefinition {
    const trigger: BurstTrigger = { kind: "hand_increase", player: "opponent" };
    return {
      cardNo: "TEST-HAND-BURST",
      name: "hand burst",
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
          timing: { kind: "burst", trigger, cause: ["self_effect"] },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
  }

  it("timing.cause=[self_effect] を registration に伝搬", () => {
    const regs = generateBurstRegistrations(handBurstCard());
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("hand_increase");
    expect(regs[0]!.whose).toBe("opponent");
    expect(regs[0]!.cause).toEqual(["self_effect"]);
  });
});

describe("getAvailableBurstSourceChoices: hand_increase cause フィルタ [P3-68]", () => {
  const burstSpirit: CardDefinition = {
    cardNo: "TEST-HAND-BURST-SRC",
    name: "hand burst src",
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
    effects: [],
  };
  const defMap = new Map<string, CardDefinition>([
    [burstSpirit.cardNo, burstSpirit],
  ]);

  // 「相手の効果によって相手の手札が増えた後」相当。
  const reg: RegisteredBurstAction = {
    sourceKind: "spirit",
    eventKind: "hand_increase",
    whose: "opponent",
    cause: ["self_effect"],
  };

  function buildState(): GameState {
    const burstSource = createCardInstance(burstSpirit, {
      instanceId: "burst-src",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    return {
      ...base,
      cardInstances: [burstSource],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "burst-src" }],
    };
  }

  function handCheck(
    cause: "self_effect" | "opponent_effect"
  ): PendingBurstCheck {
    return {
      checkId: "check-1",
      actingPlayerId: "alice",
      eventKind: "hand_increase",
      source: "action_resolution",
      chainId: "test:p3-68-cause-attribution:420",
      attackId: null,
      relatedPlayerId: "bob", // 相手 (bob) の手札が増えた
      amount: 1,
      step: "main",
      window: "main_step",
      resolvedBurstCardInstanceIds: [],
      event: {
        family: "hand_increase",
        validationMode: "snapshot_only",
        cause,
      },
    };
  }

  function choices(check: PendingBurstCheck) {
    return getAvailableBurstSourceChoices({
      state: buildState(),
      pendingBurstCheck: check,
      getCardDefinitionById: (id) => defMap.get(id),
      getRegisteredBurstActions: (cardNo) =>
        cardNo === burstSpirit.cardNo ? [reg] : undefined,
    });
  }

  it("相手が自分の効果で手札を増やした (self_effect) → 発動候補に含まれる", () => {
    expect(choices(handCheck("self_effect"))).toHaveLength(1);
  });

  it("所有者のバウンス等で相手手札が増えた (opponent_effect) → cause で除外", () => {
    expect(choices(handCheck("opponent_effect"))).toHaveLength(0);
  });
});
