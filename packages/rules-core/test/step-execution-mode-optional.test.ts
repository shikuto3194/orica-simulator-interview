/**
 * `EffectStep.executionMode === "optional"` のステップ単位 execute / decline 選択テスト。
 *
 * 「前段は強制実行、後段は任意」effect (BSGE01-M03 effects[2] step1「戻せる」、
 * BSGE01-C06 effects[1] step2「戻せる」、BSFT01-TR10(B) effects[2] step1) を表現する。
 * effect 全体としては既に発揮中 (`effect.executionMode` は mandatory) のため、effect 単位の
 * 「発揮する/しない」窓 (effect-level optional) ではなく、step 単位の skip/execute 選択窓を開く。
 *
 * 検証:
 *   1. optional step 到達で pendingStepOptionalChoice が立ち、後続 step を保留する
 *   2. "execute" 解決 → 当該 step を実行 (後続 step も連鎖)
 *   3. "decline" 解決 → 当該 step のみ skip (次 step から再開)
 *
 * ルール正源: memory project_kuwaerareru_optional / 10_rules/03c §可能形語尾 /
 *   dsl-types.ts §EffectStep.executionMode。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src/runtime";
import type { CardDefinition, GameState } from "../src/runtime";

// 「自分は1枚引く。さらに、自分は1枚引ける。」型: step0 mandatory + step1 optional。
const optionalSecondDrawMagic: CardDefinition = {
  cardNo: "TEST-OPTIONAL-SECOND-DRAW",
  name: "テスト・任意 2 段ドロー",
  printedCategory: "magic",
  colors: ["white"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["メイン", "自分は1枚引く。さらに、自分は1枚引ける。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { id: "mandatory-draw", action: { kind: "draw", count: 1 } },
        {
          id: "optional-draw",
          executionMode: "optional",
          action: { kind: "draw", count: 1 },
          connector: "simultaneous",
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const filler: CardDefinition = {
  cardNo: "TEST-FILLER",
  name: "フィラー",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [optionalSecondDrawMagic, filler];
const map = new Map(defs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => map.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};

function baseState(handN: number, deckN: number): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ handCount: handN, deckCount: deckN }, {}],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(optionalSecondDrawMagic, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      ...Array.from({ length: handN }, (_, i) =>
        createCardInstance(filler, {
          instanceId: `hand-${i}`,
          ownerPlayerId: "alice",
          zone: "hand",
        })
      ),
      ...Array.from({ length: deckN }, (_, i) =>
        createCardInstance(filler, {
          instanceId: `deck-${i}`,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      ),
    ],
  };
}

function runEffect(state: GameState): GameState {
  return executeEffect({
    chainId: "test:step-execution-mode-optional:115",
    state,
    effect: optionalSecondDrawMagic.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "magic-1",
    actingPlayerId: "alice",
    ...lookups,
  });
}

function handCount(state: GameState, player = "alice"): number {
  return state.players.find((p) => p.id === player)!.handCount;
}

function deckCount(state: GameState, player = "alice"): number {
  return state.players.find((p) => p.id === player)!.deckCount;
}

describe("pendingStepOptionalChoice: step.executionMode='optional'", () => {
  it("optional step 到達で pending が立ち後続 step を保留する", () => {
    const baseHand = handCount(baseState(3, 10));
    const baseDeck = deckCount(baseState(3, 10));
    const after = runEffect(baseState(3, 10));
    const pending = after.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    expect(pending!.effectIndex).toBe(0);
    expect(pending!.stepIndex).toBe(1);
    expect(pending!.sourceInstanceId).toBe("magic-1");
    expect(pending!.continuation.stepIndex).toBe(1);
    // step0 (mandatory draw 1) は実行済み: 手札 +1, デッキ -1。
    expect(handCount(after)).toBe(baseHand + 1);
    expect(deckCount(after)).toBe(baseDeck - 1);
  });

  it("getAvailableLegalActions が resolve_pending_step_optional_choice を提示する", () => {
    const after = runEffect(baseState(3, 10));
    const actions = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      ...lookups,
    });
    const psoc = actions.find(
      (a) => a.kind === "resolve_pending_step_optional_choice"
    );
    expect(psoc).toBeDefined();
    expect(psoc!.actingPlayerId).toBe("alice");
  });

  it("execute 解決 → 任意 step を実行 (合計 2 枚ドロー)", () => {
    const baseHand = handCount(baseState(3, 10));
    const baseDeck = deckCount(baseState(3, 10));
    const pendingState = runEffect(baseState(3, 10));
    const psoc = pendingState.pendingStepOptionalChoice!;
    const resolved = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    expect(resolved.pendingStepOptionalChoice ?? null).toBeNull();
    // step0 (+1) + step1 (+1) = 合計 +2 ドロー、デッキ -2。
    expect(handCount(resolved)).toBe(baseHand + 2);
    expect(deckCount(resolved)).toBe(baseDeck - 2);
  });

  it("decline 解決 → 任意 step のみ skip (合計 1 枚ドロー)", () => {
    const baseHand = handCount(baseState(3, 10));
    const baseDeck = deckCount(baseState(3, 10));
    const pendingState = runEffect(baseState(3, 10));
    const psoc = pendingState.pendingStepOptionalChoice!;
    const resolved = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "decline",
      },
      ...lookups,
    }).state;
    expect(resolved.pendingStepOptionalChoice ?? null).toBeNull();
    // step0 だけ実行済み: ドロー +1, デッキ -1。
    expect(handCount(resolved)).toBe(baseHand + 1);
    expect(deckCount(resolved)).toBe(baseDeck - 1);
  });

  it("decline 解決 → 後続 conditional_result step も skip する (失敗 stepResult 記録)", () => {
    // 「自分は1枚引く（任意）。その後、引いたなら相手の…する。」型の正源テスト。
    // optional step を decline したとき、次 step (connector: conditional_result) が
    // 前段不成立で skip されることを verify。
    const conditionalAfterOptional: CardDefinition = {
      cardNo: "TEST-OPTIONAL-THEN-COND-RESULT",
      name: "テスト・任意→条件結果",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "メイン",
        "自分は1枚引ける。引いたなら、さらに自分は2枚引く。",
      ],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "opt-draw",
              executionMode: "optional",
              action: { kind: "draw", count: 1 },
            },
            {
              action: { kind: "draw", count: 2 },
              connector: "conditional_result",
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const declDefs = [conditionalAfterOptional, filler];
    const declMap = new Map(declDefs.map((d) => [d.cardNo, d]));
    const declGetDef = (id: string) => declMap.get(id);
    const declLookups = {
      getCardDefinitionById: declGetDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(declDefs),
    };
    const baseDecl: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ handCount: 0, deckCount: 10 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(conditionalAfterOptional, {
          instanceId: "decl-magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        ...Array.from({ length: 10 }, (_, i) =>
          createCardInstance(filler, {
            instanceId: `decl-deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    };
    const pending = executeEffect({
      chainId: "test:step-execution-mode-optional:283",
      state: baseDecl,
      effect: conditionalAfterOptional.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "decl-magic",
      actingPlayerId: "alice",
      ...declLookups,
    });
    expect(pending.pendingStepOptionalChoice).not.toBeNull();
    const psoc = pending.pendingStepOptionalChoice!;
    const resolved = applyLegalAction({
      state: pending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "decline",
      },
      ...declLookups,
    }).state;
    // 当該 step は declined (実行されない)、conditional_result の後続 step も skip。
    // よって手札変化なし、デッキは初期 10 のまま。
    expect(resolved.pendingStepOptionalChoice ?? null).toBeNull();
    expect(handCount(resolved, "alice")).toBe(0);
    expect(deckCount(resolved, "alice")).toBe(10);
    expect(
      resolved.log.some((l) => l.includes("effect:step-optional-declined"))
    ).toBe(true);
  });

  it("effect-level optional 発揮後に唯一の payload optional step は辞退できない", () => {
    const optionalEffectOnly: CardDefinition = {
      cardNo: "TEST-EFFECT-OPTIONAL-ONLY-OPTIONAL-STEP",
      name: "テスト・二重任意防止",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["自分は1枚引ける。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [
            {
              executionMode: "optional",
              action: { kind: "draw", count: 1 },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = [optionalEffectOnly, filler];
    const localMap = new Map(localDefs.map((d) => [d.cardNo, d]));
    const localLookups = {
      getCardDefinitionById: (id: string) => localMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(localDefs),
    };
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: 3 }, {}],
      }),
      cardInstances: [
        createCardInstance(optionalEffectOnly, {
          instanceId: "effect-optional-only",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        ...Array.from({ length: 3 }, (_, i) =>
          createCardInstance(filler, {
            instanceId: `effect-optional-deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    };
    const pendingState = executeEffect({
      chainId: "test:step-execution-mode-optional:373",
      state: base,
      effect: optionalEffectOnly.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "effect-optional-only",
      actingPlayerId: "alice",
      ...localLookups,
    });
    const psoc = pendingState.pendingStepOptionalChoice!;
    expect(psoc.canDecline).toBe(false);
    const choices = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...localLookups,
    })
      .filter((a) => a.kind === "resolve_pending_step_optional_choice")
      .map((a) => a.choice);
    expect(choices).toEqual(["execute"]);
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${psoc.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: psoc.actingPlayerId,
          pendingId: psoc.pendingId,
          sourceInstanceId: psoc.sourceInstanceId,
          effectIndex: psoc.effectIndex,
          stepIndex: psoc.stepIndex,
          choice: "decline",
        },
        ...localLookups,
      })
    ).toThrow(/decline is not available/);
  });

  it("effect-level optional かつ全 step optional のカード定義は許すが実行時の全辞退はできない", () => {
    const optionalEffectAllOptional: CardDefinition = {
      cardNo: "TEST-EFFECT-OPTIONAL-ALL-STEPS-OPTIONAL",
      name: "テスト・全任意 step",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["自分は1枚引ける。さらに、自分は1枚引ける。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [
            {
              executionMode: "optional",
              action: { kind: "draw", count: 1 },
            },
            {
              executionMode: "optional",
              action: { kind: "draw", count: 1 },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = [optionalEffectAllOptional, filler];
    const localMap = new Map(localDefs.map((d) => [d.cardNo, d]));
    const localLookups = {
      getCardDefinitionById: (id: string) => localMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(localDefs),
    };
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: 4 }, {}],
      }),
      cardInstances: [
        createCardInstance(optionalEffectAllOptional, {
          instanceId: "effect-all-optional",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        ...Array.from({ length: 4 }, (_, i) =>
          createCardInstance(filler, {
            instanceId: `effect-all-optional-deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    };
    const firstPendingState = executeEffect({
      chainId: "test:step-execution-mode-optional:469",
      state: base,
      effect: optionalEffectAllOptional.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "effect-all-optional",
      actingPlayerId: "alice",
      ...localLookups,
    });
    const first = firstPendingState.pendingStepOptionalChoice!;
    expect(first.stepIndex).toBe(0);
    expect(first.canDecline).toBe(true);
    const firstChoices = getLegalActions({
      state: firstPendingState,
      actingPlayerId: "alice",
      ...localLookups,
    })
      .filter((a) => a.kind === "resolve_pending_step_optional_choice")
      .map((a) => a.choice);
    expect(firstChoices).toEqual(["execute", "decline"]);

    const secondPendingState = applyLegalAction({
      state: firstPendingState,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${first.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: first.actingPlayerId,
        pendingId: first.pendingId,
        sourceInstanceId: first.sourceInstanceId,
        effectIndex: first.effectIndex,
        stepIndex: first.stepIndex,
        choice: "decline",
      },
      ...localLookups,
    }).state;
    const second = secondPendingState.pendingStepOptionalChoice!;
    expect(second.stepIndex).toBe(1);
    expect(second.canDecline).toBe(false);
    const secondChoices = getLegalActions({
      state: secondPendingState,
      actingPlayerId: "alice",
      ...localLookups,
    })
      .filter((a) => a.kind === "resolve_pending_step_optional_choice")
      .map((a) => a.choice);
    expect(secondChoices).toEqual(["execute"]);
    expect(() =>
      applyLegalAction({
        state: secondPendingState,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${second.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: second.actingPlayerId,
          pendingId: second.pendingId,
          sourceInstanceId: second.sourceInstanceId,
          effectIndex: second.effectIndex,
          stepIndex: second.stepIndex,
          choice: "decline",
        },
        ...localLookups,
      })
    ).toThrow(/decline is not available/);
  });

  it("choiceのnoopに印字上の0指定があれば、全辞退ガードでも候補を残す", () => {
    const before = baseState(0, 2);
    const pending = executeEffect({
      chainId: "optional-choice-zero",
      state: before,
      effect: {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: { min: 0, max: 1 },
              },
            },
            choice: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
      effectIndex: 0,
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      promptUnresolvedChoice: true,
      ...lookups,
    });
    const choices = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).filter((action) => action.kind === "resolve_pending_step_choice");
    expect(choices.map((action) => action.choiceIndex)).toEqual([0, 1]);
    const after = applyLegalAction({
      state: pending,
      action: choices[0]!,
      ...lookups,
    }).state;
    expect(after.pendingStepChoice).toBeNull();
    expect(after.players[0]!.handCount).toBe(0);
    expect(after.players[0]!.deckCount).toBe(2);
  });

  it.each([0, 1])(
    "継続choiceの条件がcount=%iで不成立なら自動不発、成立時だけ本文を提示する",
    (countValue) => {
      const definition: CardDefinition = {
        ...optionalSecondDrawMagic,
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            executionMode: "optional",
            steps: [
              { executionMode: "optional", action: { kind: "draw", count: 1 } },
              {
                action: { kind: "noop" },
                choice: [
                  {
                    condition: [
                      { kind: "count_value", player: "self", min: 1 },
                    ],
                    action: { kind: "draw", count: 1 },
                  },
                ],
              },
            ],
          },
        ],
      };
      const localLookups = {
        ...lookups,
        getCardDefinitionById: (id: string) =>
          id === definition.cardNo ? definition : getCardDefinitionById(id),
      };
      const before = baseState(0, 2);
      const first = executeEffect({
        chainId: `choice-condition:${countValue}`,
        state: {
          ...before,
          players: before.players.map((player) =>
            player.id === "alice" ? { ...player, countValue } : player
          ),
        },
        effect: definition.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "magic-1",
        actingPlayerId: "alice",
        promptUnresolvedChoice: true,
        ...localLookups,
      });
      const decline = getLegalActions({
        state: first,
        actingPlayerId: "alice",
        ...localLookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_step_optional_choice" &&
          action.choice === "decline"
      );
      expect(decline).toBeDefined();
      let after = applyLegalAction({
        state: first,
        action: decline!,
        ...localLookups,
      }).state;
      if (countValue === 0) {
        expect(after.pendingStepChoice).toBeNull();
        expect(after.players[0]!.handCount).toBe(0);
        expect(after.players[0]!.deckCount).toBe(2);
      } else {
        const choices = getLegalActions({
          state: after,
          actingPlayerId: "alice",
          ...localLookups,
        }).filter((action) => action.kind === "resolve_pending_step_choice");
        expect(choices.map((action) => action.choiceIndex)).toEqual([1]);
        after = applyLegalAction({
          state: after,
          action: choices[0]!,
          ...localLookups,
        }).state;
        expect(after.pendingStepChoice).toBeNull();
        expect(after.players[0]!.handCount).toBe(1);
        expect(after.players[0]!.deckCount).toBe(1);
      }
    }
  );

  it("effect-level optional でも『N体まで』の 0 指定は辞退できる", () => {
    const optionalUpToEffect: CardDefinition = {
      cardNo: "TEST-EFFECT-OPTIONAL-UP-TO-ZERO",
      name: "テスト・まで型0指定",
      printedCategory: "magic",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体までを破壊できる。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [
            {
              executionMode: "optional",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 1 },
                },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = [optionalUpToEffect, filler];
    const localMap = new Map(localDefs.map((d) => [d.cardNo, d]));
    const localLookups = {
      getCardDefinitionById: (id: string) => localMap.get(id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(localDefs),
    };
    const base: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [
        createCardInstance(optionalUpToEffect, {
          instanceId: "effect-optional-up-to",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };
    const pendingState = executeEffect({
      chainId: "test:step-execution-mode-optional:588",
      state: base,
      effect: optionalUpToEffect.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "effect-optional-up-to",
      actingPlayerId: "alice",
      ...localLookups,
    });
    const psoc = pendingState.pendingStepOptionalChoice!;
    expect(psoc.canDecline).toBe(true);
    const choices = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...localLookups,
    })
      .filter((a) => a.kind === "resolve_pending_step_optional_choice")
      .map((a) => a.choice);
    expect(choices).toContain("decline");
  });

  it("execute / decline 以外の choice は throw する", () => {
    const pendingState = runEffect(baseState(3, 10));
    const psoc = pendingState.pendingStepOptionalChoice!;
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${psoc.pendingId}:invalid`,
          can: true,
          reason: "test",
          actingPlayerId: psoc.actingPlayerId,
          pendingId: psoc.pendingId,
          sourceInstanceId: psoc.sourceInstanceId,
          effectIndex: psoc.effectIndex,
          stepIndex: psoc.stepIndex,
          choice: "invalid" as unknown as "execute",
        },
        ...lookups,
      })
    ).toThrow(/action\.choice/);
  });
});
