import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type Step,
} from "../src";
import {
  executeGrantExtraSteps,
  executeGrantExtraTurn,
  executeSkipNextTurn,
  finalizePendingEndFinalizations,
} from "../src/effect/structured-state-grants";

const dummy: CardDefinition = {
  cardNo: "extra-flow",
  name: "extra flow",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
const sagume = ALL_CARDS.find((c) => c.cardNo === "BSTH10-X03")!;
const ultimate = ALL_CARDS.find((c) => c.cardNo === "BSTH10-X02")!;
const listener: CardDefinition = {
  ...dummy,
  cardNo: "step-listener",
  effects: [
    {
      timing: { kind: "phase", step: "start", subPhase: "end", whose: "self" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const startListener: CardDefinition = {
  ...listener,
  cardNo: "turn-listener",
  effects: [
    {
      timing: { kind: "phase", step: "start", whose: "self" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const coreListener: CardDefinition = {
  ...listener,
  cardNo: "core-listener",
  effects: [
    {
      timing: { kind: "phase", step: "core", whose: "self" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const definitions = [
  dummy,
  sagume,
  ultimate,
  listener,
  startListener,
  coreListener,
];
const lookup = (id: string) => definitions.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
function base(step: Step = "start", owner = "alice"): GameState {
  const decks = ["alice", "bob"].flatMap((player) =>
    Array.from({ length: 10 }, (_, i) =>
      createCardInstance(dummy, {
        instanceId: `${player}-deck-${i}`,
        ownerPlayerId: player,
        zone: "deck",
      })
    )
  );
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: decks,
      playerOverrides: [
        { handCount: 0, deckCount: 10, voidNormalCoreCount: 10 },
        { handCount: 0, deckCount: 10, voidNormalCoreCount: 10 },
      ],
    }),
    step,
    window: "none",
    turnNumber: 3,
    activePlayerId: owner,
  };
}
function add(state: GameState, def: CardDefinition, cores = 1) {
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances,
      createCardInstance(def, {
        instanceId: def.cardNo,
        ownerPlayerId: state.activePlayerId,
        zone: "field",
        normalCoreCount: cores,
      }),
    ],
  };
}
function drain(state: GameState) {
  for (let i = 0; i < 30; i++) {
    const action = state.playerOrder
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...options })
      )
      .find((a) =>
        [
          "resolve_pending_triggered_effect",
          "pass_stack",
          "select_pending_to_resolve",
        ].includes(a.kind)
      );
    if (!action) return state;
    state = applyLegalAction({ state, action, ...options }).state;
  }
  throw new Error("unresolved reactions");
}
const advance = (state: GameState) =>
  advanceStep(
    state,
    lookup,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
const grant = (state: GameState, steps: Step[]) =>
  executeGrantExtraSteps(state, state.activePlayerId, {
    kind: "grant_extra_steps",
    steps,
  });
const force = (state: GameState, kind: "end_attack_step" | "end_turn") =>
  finalizePendingEndFinalizations(
    executeEffect({
      state,
      ...options,
      actingPlayerId: state.activePlayerId,
      sourceInstanceId: "n/a",
      chainId: `force:${kind}`,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind } }],
      },
    }),
    lookup,
    undefined,
    options
  );
function finishTurn(state: GameState) {
  const turn = state.turnNumber;
  for (let i = 0; i < 25 && state.turnNumber === turn; i++)
    state = advance(drain(state));
  return state;
}

describe("追加ステップは元の進行を保存する", () => {
  it.each(["alice", "bob"])(
    "サグメ実効果: %sの全ステップを最後まで行う",
    (owner) => {
      let state = add(add(base("start", owner), sagume, 5), ultimate);
      state = executeEffect({
        state,
        ...options,
        actingPlayerId: owner,
        sourceInstanceId: sagume.cardNo,
        chainId: "sagume",
        effect: sagume.effects![0]!,
      });
      const steps = [state.step];
      for (let i = 0; i < 7; i++) {
        state = advance(drain(state));
        steps.push(state.step);
      }
      expect(steps).toEqual([
        "start",
        "attack",
        "core",
        "draw",
        "refresh",
        "main",
        "attack",
        "end",
      ]);
      expect(state.turnNumber).toBe(3);
      expect(state.players.find((p) => p.id === owner)!.handCount).toBe(1);
    }
  );
  it("終了時誘発の解決待ちでは予約を消費しない", () => {
    let state = grant(add(base(), listener), ["attack"]);
    state = advance(state);
    expect(state.step).toBe("start");
    expect(state.window).toBe("step_end");
    expect(state.pendingExtraSteps).toEqual(["attack"]);
    state = advance(drain(state));
    expect(state.step).toBe("attack");
    expect(advance(state).step).toBe("core");
  });
  it("同じ境界の重複予約は1回、追加中の挿入は残りの前に実行", () => {
    let state = grant(grant(base(), ["attack"]), ["attack"]);
    state = advance(state);
    state = grant(state, ["draw", "refresh"]);
    const steps = [];
    for (let i = 0; i < 3; i++) {
      state = advance(state);
      steps.push(state.step);
    }
    expect(steps).toEqual(["draw", "refresh", "core"]);
  });
  it("効果で追加アタックを終了してもコアへ戻り、通常アタックは残る", () => {
    let state = force(advance(grant(base(), ["attack"])), "end_attack_step");
    expect(state.step).toBe("core");
    for (let i = 0; i < 4; i++) state = advance(state);
    expect(state.step).toBe("attack");
  });
  it("ターン強制終了は残りの追加ステップを破棄する", () => {
    const state = force(
      advance(grant(base(), ["attack", "refresh"])),
      "end_turn"
    );
    expect(state.window).toBe("end_step_cleanup");
    expect(state.stepContinuation).toEqual([]);
    expect(advance(state).activePlayerId).toBe("bob");
  });
  it("連続アタックは別ステップだが同じターン: step制限だけを初期化", () => {
    const record = {
      sourceInstanceId: "src",
      sourceDefinitionId: dummy.cardNo,
      effectLabel: "limit",
      turnNumber: 3,
      step: "attack" as const,
      count: 1,
    };
    const state = advance(
      grant(
        {
          ...base("attack"),
          battlesEndedThisAttackStep: 2,
          battlesEndedThisTurn: 4,
          effectUsageRecords: [
            { ...record, duration: "step" },
            { ...record, duration: "turn" },
          ],
        },
        ["attack"]
      )
    );
    expect(state.step).toBe("attack");
    expect(state.battlesEndedThisAttackStep).toBe(0);
    expect(state.battlesEndedThisTurn).toBe(4);
    expect(state.effectUsageRecords.map((r) => r.duration)).toEqual(["turn"]);
  });
  it("エンド後の追加アタック・エンドも同じターン内で実行", () => {
    let state = grant({ ...base("end"), window: "end_step_effects" }, [
      "attack",
      "end",
    ]);
    state = advance(state);
    expect(state.window).toBe("step_end");
    state = advance(state);
    expect(state.step).toBe("attack");
    expect(state.turnNumber).toBe(3);
    state = advance(state);
    expect(state.step).toBe("end");
    state = finishTurn(state);
    expect(state.turnNumber).toBe(4);
    expect(state.activePlayerId).toBe("bob");
  });
});

describe("追加ターンも共通の開始・復帰処理を使う", () => {
  it("同じ次ターンのスキップは2回分に累積しない", () => {
    const action = { kind: "skip_next_turn" as const };
    let state = executeSkipNextTurn(base("end"), "alice", action);
    state = executeSkipNextTurn(state, "alice", action);
    expect(state.pendingTurnSkips).toEqual(["bob"]);
    state = finishTurn(state);
    expect(state.activePlayerId).toBe("alice");
    state = finishTurn(state);
    expect(state.activePlayerId).toBe("bob");
  });
  it("効果で追加アタックを終えた復帰先でも開始時効果を1回だけキューする", () => {
    const state = force(
      advance(grant(add(base(), coreListener), ["attack"])),
      "end_attack_step"
    );
    expect(state.step).toBe("core");
    expect(
      state.pendingTriggeredEffects.filter((p) => p.event?.step === "core")
    ).toHaveLength(1);
    expect(drain(state).players[0]!.handCount).toBe(1);
  });
  it("通常の追加ターンは現ターンを終えてから1回、所有者変更後も本来の番へ戻る", () => {
    let state = base("main");
    const action = {
      kind: "grant_extra_turn" as const,
      player: "opponent" as const,
    };
    state = executeGrantExtraTurn(state, "alice", action, options);
    state = executeGrantExtraTurn(state, "alice", action, options);
    expect(state.step).toBe("main");
    state = finishTurn(state);
    expect([state.activePlayerId, state.turnNumber]).toEqual(["bob", 4]);
    state = finishTurn(state);
    expect([state.activePlayerId, state.turnNumber]).toEqual(["bob", 5]);
  });
  it("追加ターン中の次の追加ターン、ターンスキップも本来の順序へ復帰", () => {
    let state = { ...base("end"), pendingTurnSkips: ["bob"] };
    const action = { kind: "grant_extra_turn" as const };
    state = executeGrantExtraTurn(state, "alice", action, options);
    state = finishTurn(state);
    state = executeGrantExtraTurn(state, "alice", action, options);
    state = finishTurn(state);
    expect(state.activePlayerId).toBe("alice");
    state = finishTurn(state);
    expect(state.activePlayerId).toBe("alice");
    expect(state.pendingTurnSkips).toEqual([]);
    expect(state.extraTurnState).toBeNull();
  });
  it("追加ターンの開始時効果を発揮し、0枚デッキでは開始時に敗北", () => {
    const initial = add(base("attack"), startListener);
    const action = {
      kind: "grant_extra_turn" as const,
      returnPoint: "previous_attack_battle" as const,
    };
    const state = executeGrantExtraTurn(initial, "alice", action, options);
    expect(
      state.pendingTriggeredEffects.some((p) => p.event?.step === "start")
    ).toBe(true);
    const empty = {
      ...base("attack"),
      players: base().players.map((p) => ({ ...p, deckCount: 0 })),
    };
    expect(
      executeGrantExtraTurn(empty, "alice", action, options).gameResult
    ).toMatchObject({ reason: "deck_out", losingPlayerId: "alice" });
  });
  it("追加ステップ中断中のターンは予約・回数制限を隔離して復元する", () => {
    const before = {
      ...advance(grant(base(), ["attack"])),
      usedDivineSkillKeysThisTurn: ["used"],
      battlesEndedThisTurn: 2,
      effectLifeReductionThisTurn: { alice: 1 },
    };
    let state = executeGrantExtraTurn(
      before,
      "bob",
      {
        kind: "grant_extra_turn",
        returnPoint: "previous_attack_battle",
        skipSteps: ["core", "attack"],
      },
      options
    );
    expect(state.stepContinuation).toEqual([]);
    expect(state.usedDivineSkillKeysThisTurn).toEqual([]);
    state = finishTurn(state);
    expect(state.activePlayerId).toBe("alice");
    expect(state.usedDivineSkillKeysThisTurn).toEqual(["used"]);
    expect(state.battlesEndedThisTurn).toBe(2);
    expect(advance(state).step).toBe("core");
  });
  it("追加ターンで禁止されたステップは挿入予約でも実行しない", () => {
    let state = executeGrantExtraTurn(
      base("attack"),
      "bob",
      {
        kind: "grant_extra_turn",
        returnPoint: "previous_attack_battle",
        skipSteps: ["core", "attack"],
      },
      options
    );
    state = advance(grant(state, ["attack"]));
    expect(state.step).toBe("draw");
  });
  it("中断元のこのターン効果と使用回数は追加ターンに漏れず、復帰後も有効", () => {
    const record = {
      sourceInstanceId: dummy.cardNo,
      sourceDefinitionId: dummy.cardNo,
      effectLabel: "used",
      duration: "turn" as const,
      turnNumber: 3,
      step: "attack" as const,
      count: 1,
    };
    const before = {
      ...add(base("attack"), dummy),
      effectUsageRecords: [record],
      activeContinuousEffects: [
        {
          effectId: "original-turn",
          sourceInstanceId: dummy.cardNo,
          sourceDefinitionId: dummy.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "turn" as const },
          createdAtTurn: 3,
          createdAtAttackId: null,
          modifierTag: "bp_modifier" as const,
        },
      ],
    };
    let state = executeGrantExtraTurn(
      before,
      "bob",
      { kind: "grant_extra_turn", returnPoint: "previous_attack_battle" },
      options
    );
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.effectId === "original-turn"
      )
    ).toBe(false);
    expect(state.effectUsageRecords).toEqual([]);
    state = finishTurn(state);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.effectId === "original-turn"
      )
    ).toBe(true);
    expect(state.effectUsageRecords).toEqual([record]);
    expect(state.turnNumber).toBe(3);
    state = finishTurn(state);
    expect(state.turnNumber).toBe(5);
  });
  it("エンド後に追加したステップを終えるまでこのターン効果を保持する", () => {
    let state = grant(
      {
        ...add(base("end"), dummy),
        window: "end_step_effects",
        activeContinuousEffects: [
          {
            effectId: "through-extra-step",
            sourceInstanceId: dummy.cardNo,
            sourceDefinitionId: dummy.cardNo,
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: 3,
            createdAtAttackId: null,
            modifierTag: "bp_modifier",
          },
        ],
      },
      ["attack", "end"]
    );
    state = advance(advance(state));
    expect(state.step).toBe("attack");
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.effectId === "through-extra-step"
      )
    ).toBe(true);
    state = finishTurn(state);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.effectId === "through-extra-step"
      )
    ).toBe(false);
  });
});
