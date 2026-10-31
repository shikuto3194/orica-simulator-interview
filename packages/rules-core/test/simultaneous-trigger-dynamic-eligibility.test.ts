import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  advanceStep,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
  type Condition,
  type ContinuousEffect,
  sanitizeStateForViewer,
  sanitizeStateForSpectator,
  maskPendingPromptsForViewer,
} from "../src";
import {
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  pruneIllegalPendingTriggeredEffects,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const mamizou = definitions.find((d) => d.cardNo === "BSTH09.2-転醒R01(A)")!;
function dependencies(defs = definitions) {
  return {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(defs),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
}
type Deps = ReturnType<typeof dependencies>;
const sourceChoices = (state: GameState, deps: Deps) =>
  state.pendingTriggeredEffects.flatMap((pendingEffect) =>
    getAvailableTriggeredEffectSourceChoices({ state, pendingEffect, ...deps })
  );
function act(
  state: GameState,
  deps: Deps,
  predicate: (a: LegalAction) => boolean,
  extra = {}
) {
  const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
  const action = actions.find(predicate);
  expect(
    action,
    JSON.stringify({ actions, log: state.log.slice(-10) })
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...deps, ...extra }).state;
}
function passStacks(state: GameState, deps: Deps) {
  for (let n = 0; state.stackWindow && n < 12; n++)
    state = act(state, deps, (a) => a.kind === "pass_stack");
  expect(state.stackWindow).toBeNull();
  return state;
}
function resolve(
  state: GameState,
  deps: Deps,
  source: string,
  effectIndex?: number,
  skip = false
) {
  const matches = (a: LegalAction) =>
    a.sourceInstanceId === source &&
    (effectIndex === undefined ||
      (a.sourceDefinitionId !== undefined &&
        a.registrationIndex !== undefined &&
        deps.getRegisteredTriggeredEffectActions(a.sourceDefinitionId)?.[
          a.registrationIndex
        ]?.effectIndex === effectIndex) ||
      (a.kind === "resolve_battle_immediate_effect" && effectIndex === 0));
  state = act(
    state,
    deps,
    (a) =>
      matches(a) &&
      (a.kind === "resolve_battle_immediate_effect" ||
        a.kind === "resolve_pending_triggered_effect" ||
        a.kind === "select_pending_to_resolve"),
    { skipOptionalEffect: skip }
  );
  return passStacks(state, deps);
}
function attack(count = 0) {
  const deps = dependencies();
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: count, voidNormalCoreCount: 20 }, {}],
      cardInstances: [
        createCardInstance(mamizou, {
          instanceId: "mamizou",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    }),
    step: "attack",
    window: "none",
    turnNumber: 3,
  };
  state = act(
    state,
    deps,
    (a) => a.kind === "attack" && a.sourceInstanceId === "mamizou"
  );
  for (let n = 0; state.preDeclarationStackWindow && n < 12; n++)
    state = act(state, deps, (a) => a.kind === "pass_pre_declaration_stack");
  return { state, deps };
}

describe("Q30857: 同時誘発中の動的発揮資格と過去イベントの境界", () => {
  it.each([0, 3])(
    "実カード: count=%s、Lv1攻撃のコア+1後だけ疲労転醒でき、B面になる",
    (count) => {
      const { state: initial, deps } = attack(count);
      expect(sourceChoices(initial, deps)).toHaveLength(0);
      expect(initial.cardInstances[0]!.normalCoreCount).toBe(2);
      expect(
        getLegalActions({
          state: initial,
          actingPlayerId: "alice",
          ...deps,
        }).some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" ||
            a.kind === "select_pending_to_resolve"
        )
      ).toBe(false);
      const restored = JSON.parse(JSON.stringify(initial)) as GameState;
      let state = resolve(restored, deps, "mamizou", 0);
      expect(state.cardInstances[0]!.normalCoreCount).toBe(3);
      expect(
        sourceChoices(state, deps).some(
          (s) =>
            s.sourceCard.instanceId === "mamizou" &&
            s.actionRegistration.effectIndex === 2
        )
      ).toBe(true);
      state = resolve(state, deps, "mamizou", 2);
      expect(state.cardInstances[0]!.definitionId).toBe("BSTH09.2-転醒R01(B)");
      expect(state.players[0]!.countValue).toBe(count + 1);
      for (let n = 0; state.pendingTriggeredEffects.length && n < 6; n++)
        state = resolve(state, deps, "mamizou");
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    }
  );
  it("コア配置を辞退して同時誘発群を終えた後のLv上昇は疲労を復活させない", () => {
    const { state: initial, deps } = attack();
    let state = resolve(initial, deps, "mamizou", 0, true);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) => ({
        ...c,
        normalCoreCount: 3,
      })),
    };
    state = pruneIllegalPendingTriggeredEffects({ state, ...deps });
    expect(sourceChoices(state, deps)).toHaveLength(0);
    expect(state.cardInstances[0]!.definitionId).toBe(mamizou.cardNo);
  });
  it("同時誘発中でもカウント条件未達なら転醒しない", () => {
    const { state: initial, deps } = attack(4);
    const state = resolve(initial, deps, "mamizou", 0);
    expect(state.cardInstances[0]!.normalCoreCount).toBe(3);
    expect(sourceChoices(state, deps)).toHaveLength(0);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
});

function verifierFixture(
  condition: Condition,
  privateReady = false,
  extraPrivate = false,
  initialColor?: ContinuousEffect,
  timingFilter?: { colors: readonly ("red" | "purple")[] },
  groupId: string | null = "review-group"
) {
  const observer: CardDefinition = {
    cardNo: "TEST-REVIEW-OBSERVER",
    name: "反証観測者",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 1000 },
      { level: 2, requiredCores: 3, bp: 3000 },
    ],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "exhaust",
          player: "self",
          ...(timingFilter ? { triggerFilter: timingFilter } : {}),
        },
        executionMode: "optional",
        condition,
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      },
    ],
  };
  const ready: CardDefinition = {
    ...observer,
    cardNo: "TEST-REVIEW-READY",
    name: "反証先行効果",
    effects: [
      {
        ...observer.effects![0]!,
        condition: undefined,
        applicability: { zone: privateReady ? "hand" : "field" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "card_instance", instanceId: "observed" },
              amount: 1,
            },
          },
        ],
      },
    ],
  };
  const deps = dependencies([observer, ready]);
  const raw: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 20 },
        {},
      ],
      cardInstances: [
        createCardInstance(observer, {
          instanceId: "observed",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(ready, {
          instanceId: "ready",
          ownerPlayerId: "alice",
          zone: privateReady ? "hand" : "field",
          normalCoreCount: privateReady ? 0 : 1,
        }),
      ],
    }),
    step: "main",
    turnNumber: 3,
    activeContinuousEffects: initialColor ? [initialColor] : [],
  };
  if (extraPrivate)
    raw.cardInstances.push(
      createCardInstance(ready, {
        instanceId: "ready2",
        ownerPlayerId: "alice",
        zone: "hand",
        normalCoreCount: 0,
      })
    );
  const state = queuePendingReactionsFromTriggerEvents(
    raw,
    [
      {
        eventKind: "exhaust",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "review",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "observed",
        amount: null,
      },
    ],
    groupId ?? undefined,
    deps
  );
  return { state, deps };
}

describe("敵対的反証: 静的OR分岐と非公開申告の群継続", () => {
  it("群IDなしでも既に発揮可能な登録のイベント判定を保存し、実解決する", () => {
    const { state: initial, deps } = verifierFixture(
      [{ kind: "trigger_colors", colors: ["red"] }],
      false,
      false,
      undefined,
      undefined,
      null
    );
    expect(
      sourceChoices(initial, deps).map((s) => s.sourceCard.instanceId)
    ).toEqual(["observed", "ready"]);
    const state = resolve(initial, deps, "observed");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(state.players[0]!.voidNormalCoreCount).toBe(18);
  });
  it("群IDなしのイベントへ未成立登録を追加せず、後のコア配置で復活させない", () => {
    const { state: initial, deps } = verifierFixture(
      [{ kind: "min_level", value: 2 }],
      false,
      false,
      undefined,
      undefined,
      null
    );
    const state = resolve(initial, deps, "ready");
    expect(
      state.cardInstances.find((c) => c.instanceId === "observed")!
        .normalCoreCount
    ).toBe(3);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(0);
  });
  it.each(["missing", "invalid-array"])(
    "観測表のイベント値%sは現在値で補完せず、保存復元後も終端まで安全に進む",
    (mode) => {
      const { state: initial, deps } = verifierFixture(
        mode === "missing"
          ? [
              {
                kind: "any_of",
                groups: [
                  [{ kind: "min_level", value: 3 }],
                  [{ kind: "trigger_colors", colors: ["purple"] }],
                ],
              },
            ]
          : [{ kind: "trigger_colors", colors: ["red"] }]
      );
      const state = JSON.parse(JSON.stringify(initial)) as GameState;
      for (const pending of state.pendingTriggeredEffects) {
        const record = Object.values(pending.timingSourceRegistrations!).find(
          (r) => r.sourceInstanceId === "observed"
        )!;
        if (mode === "missing") delete record.eventConditionResults;
        else
          record.eventConditionResults = [true] as unknown as Record<
            string,
            boolean
          >;
      }
      state.activeContinuousEffects = [
        {
          effectId: "late-purple",
          sourceInstanceId: "ready",
          sourceDefinitionId: "TEST-REVIEW-READY",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 3,
          createdAtAttackId: null,
          modifierTag: "treat_as_color",
          modifierSymbol: ["purple"],
          targetInstanceId: "observed",
        },
      ];
      expect(
        sourceChoices(state, deps).map((s) => s.sourceCard.instanceId)
      ).toEqual(["ready"]);
      const done = resolve(
        JSON.parse(JSON.stringify(state)) as GameState,
        deps,
        "ready"
      );
      expect(done.pendingTriggeredEffects).toHaveLength(0);
      expect(done.players[0]!.reserveNormalCoreCount).toBe(0);
      expect(done.players[0]!.voidNormalCoreCount).toBe(19);
    }
  );
  it("対象filterの収集時一致は主語の後の色変更で再判定せず、Lv資格を現在状態で満たす", () => {
    const { state: initial, deps } = verifierFixture(
      [{ kind: "min_level", value: 2 }],
      false,
      false,
      {
        effectId: "initial-filter-purple",
        sourceInstanceId: "ready",
        sourceDefinitionId: "TEST-REVIEW-READY",
        actingPlayerId: "alice",
        duration: { scope: "turn" },
        createdAtTurn: 3,
        createdAtAttackId: null,
        modifierTag: "treat_as_color",
        modifierSymbol: ["purple"],
        targetInstanceId: "observed",
      },
      { colors: ["purple"] }
    );
    let state = resolve(
      { ...initial, activeContinuousEffects: [] },
      deps,
      "ready"
    );
    expect(
      sourceChoices(state, deps).map((s) => s.sourceCard.instanceId)
    ).toEqual(["observed"]);
    state = resolve(state, deps, "observed");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
  it("元のイベント述語がtrueなら現在の色変更で取消さず、Lv上昇後にスタック実解決も完走する", () => {
    const { state: initial, deps } = verifierFixture(
      [
        { kind: "trigger_colors", colors: ["purple"] },
        { kind: "min_level", value: 2 },
      ],
      false,
      false,
      {
        effectId: "initial-purple",
        sourceInstanceId: "ready",
        sourceDefinitionId: "TEST-REVIEW-READY",
        actingPlayerId: "alice",
        duration: { scope: "turn" },
        createdAtTurn: 3,
        createdAtAttackId: null,
        modifierTag: "treat_as_color",
        modifierSymbol: ["purple"],
        targetInstanceId: "observed",
      }
    );
    let state = resolve(
      { ...initial, activeContinuousEffects: [] },
      deps,
      "ready"
    );
    expect(
      sourceChoices(state, deps).map((s) => s.sourceCard.instanceId)
    ).toEqual(["observed"]);
    const declared = act(
      state,
      deps,
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "observed"
    );
    const original = JSON.stringify(declared);
    for (const view of [
      sanitizeStateForViewer(declared, "alice"),
      sanitizeStateForViewer(declared, "bob"),
      sanitizeStateForSpectator(declared),
      maskPendingPromptsForViewer(declared, "alice"),
    ])
      expect(JSON.stringify(view)).not.toContain("eventConditionResults");
    expect(JSON.stringify(declared)).toBe(original);
    state = act(
      JSON.parse(original) as GameState,
      deps,
      (a) => a.kind === "pass_stack"
    );
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(state.players[0]!.voidNormalCoreCount).toBe(17);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
  it("非公開観測元が申告前に手札を離れたら、空の同時誘発群を終える", () => {
    const { state: initial, deps } = verifierFixture(
      [{ kind: "min_level", value: 2 }],
      true
    );
    const state = pruneIllegalPendingTriggeredEffects({
      state: {
        ...initial,
        cardInstances: initial.cardInstances.map((c) =>
          c.instanceId === "ready" ? { ...c, zone: "deck" as const } : c
        ),
      },
      ...deps,
    });
    expect(state.pendingPrivateDeclarations).toHaveLength(0);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(state.players[0]!.voidNormalCoreCount).toBe(20);
  });
  it("兄弟の非公開申告が残る間のdeferred宣言を保持し、最後の辞退から公開候補の実解決へつなぐ", () => {
    const { state: initial, deps } = verifierFixture(
      [{ kind: "min_level", value: 2 }],
      true,
      true
    );
    expect(initial.pendingPrivateDeclarations).toHaveLength(2);
    let state = act(
      initial,
      deps,
      (a) =>
        a.kind === "declare_private_triggered_effect" &&
        a.sourceInstanceId === "ready"
    );
    expect(state.pendingDeferredTriggeredEffects).toHaveLength(1);
    expect(state.pendingTriggeredEffects).toHaveLength(1);
    state = act(
      state,
      deps,
      (a) =>
        a.kind === "skip_private_triggered_effect" &&
        a.sourceInstanceId === "ready2"
    );
    state = resolve(state, deps, "ready");
    expect(
      sourceChoices(state, deps).map((s) => s.sourceCard.instanceId)
    ).toEqual(["observed"]);
    state = resolve(state, deps, "observed");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(state.players[0]!.voidNormalCoreCount).toBe(17);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(state.pendingPrivateDeclarations).toHaveLength(0);
    expect(state.pendingDeferredTriggeredEffects).toHaveLength(0);
  });
  it("動的Lv分岐と不一致イベント分岐のORは、後の色追加だけで発揮せず終端まで合法に進む", () => {
    const { state: initial, deps } = verifierFixture([
      {
        kind: "any_of",
        groups: [
          [{ kind: "min_level", value: 3 }],
          [{ kind: "trigger_colors", colors: ["purple"] }],
        ],
      },
    ]);
    expect(
      sourceChoices(initial, deps).map((s) => s.sourceCard.instanceId)
    ).toEqual(["ready"]);
    const color: ContinuousEffect = {
      effectId: "review-purple",
      sourceInstanceId: "ready",
      sourceDefinitionId: "TEST-REVIEW-READY",
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 3,
      createdAtAttackId: null,
      modifierTag: "treat_as_color",
      modifierSymbol: ["purple"],
      targetInstanceId: "observed",
    };
    const colored = JSON.parse(
      JSON.stringify({ ...initial, activeContinuousEffects: [color] })
    ) as GameState;
    expect(
      sourceChoices(colored, deps).map((s) => s.sourceCard.instanceId)
    ).toEqual(["ready"]);
    const state = resolve(colored, deps, "ready");
    expect(
      state.cardInstances.find((c) => c.instanceId === "observed")
        ?.normalCoreCount
    ).toBe(3);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(0);
    expect(state.players[0]!.voidNormalCoreCount).toBe(19);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
  it("混在ORの動的Lv分岐は、元のイベント分岐が不成立でもコア配置後に1回完走する", () => {
    const { state: initial, deps } = verifierFixture([
      {
        kind: "any_of",
        groups: [
          [{ kind: "min_level", value: 2 }],
          [{ kind: "trigger_colors", colors: ["purple"] }],
        ],
      },
    ]);
    let state = resolve(
      JSON.parse(JSON.stringify(initial)) as GameState,
      deps,
      "ready"
    );
    expect(
      sourceChoices(state, deps).map((s) => s.sourceCard.instanceId)
    ).toEqual(["observed"]);
    state = resolve(state, deps, "observed");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(state.players[0]!.voidNormalCoreCount).toBe(17);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
  it.each([false, true])(
    "手札誘発の解決/辞退(%s)まで公開観測を保持し、群終了後は復活しない",
    (skip) => {
      const { state: initial, deps } = verifierFixture(
        [{ kind: "min_level", value: 2 }],
        true
      );
      expect(initial.pendingTriggeredEffects).toHaveLength(1);
      expect(sourceChoices(initial, deps)).toHaveLength(0);
      expect(initial.pendingPrivateDeclarations).toHaveLength(1);
      let state = act(
        JSON.parse(JSON.stringify(initial)) as GameState,
        deps,
        (a) =>
          a.sourceInstanceId === "ready" &&
          a.kind ===
            (skip
              ? "skip_private_triggered_effect"
              : "declare_private_triggered_effect")
      );
      if (!skip) {
        state = resolve(state, deps, "ready");
        expect(
          state.cardInstances.find((c) => c.instanceId === "observed")
            ?.normalCoreCount
        ).toBe(3);
        expect(
          sourceChoices(state, deps).map((s) => s.sourceCard.instanceId)
        ).toEqual(["observed"]);
        state = resolve(state, deps, "observed");
      }
      expect(state.players[0]!.reserveNormalCoreCount).toBe(skip ? 0 : 2);
      expect(state.players[0]!.voidNormalCoreCount).toBe(skip ? 20 : 17);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingPrivateDeclarations).toHaveLength(0);
      expect(state.pendingDeferredTriggeredEffects).toHaveLength(0);
      state = {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "observed" ? { ...c, normalCoreCount: 3 } : c
        ),
      };
      expect(
        sourceChoices(
          pruneIllegalPendingTriggeredEffects({ state, ...deps }),
          deps
        )
      ).toHaveLength(0);
    }
  );
});

function genericFixture(useApplicability = false, eventCondition = false) {
  const observer: CardDefinition = {
    cardNo: "TEST-DYNAMIC-OBSERVER",
    name: "汎用同時誘発",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 1000 },
      { level: 2, requiredCores: 3, bp: 3000 },
    ],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "exhaust",
          player: "self",
          triggerFilter: { category: ["spirit"] },
        },
        executionMode: "optional",
        ...(eventCondition
          ? {
              condition: [
                {
                  kind: "any_of" as const,
                  groups: [
                    [
                      {
                        kind: "trigger_colors" as const,
                        colors: ["purple" as const],
                      },
                      { kind: "min_level" as const, value: 2 },
                    ],
                    [
                      {
                        kind: "trigger_colors" as const,
                        colors: ["yellow" as const],
                      },
                      { kind: "min_level" as const, value: 2 },
                    ],
                  ],
                },
              ],
            }
          : useApplicability
            ? { applicability: { level: { min: 2 } } }
            : { condition: [{ kind: "min_level" as const, value: 2 }] }),
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      },
      {
        timing: { kind: "game_event", event: "exhaust", player: "self" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
      },
    ],
  };
  const late = { ...observer, cardNo: "TEST-LATE-OBSERVER", name: "後入場" };
  const mismatch = {
    ...observer,
    cardNo: "TEST-MISMATCH",
    name: "対象不一致",
    effects: [
      {
        ...observer.effects![0]!,
        timing: {
          kind: "game_event" as const,
          event: "exhaust" as const,
          triggerFilter: { category: ["ultimate" as const] },
        },
      },
    ],
  };
  const deps = dependencies([observer, late, mismatch]);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 20 },
        {},
      ],
      cardInstances: [
        createCardInstance(observer, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(late, {
          instanceId: "late",
          ownerPlayerId: "alice",
          zone: "hand",
          normalCoreCount: 0,
        }),
        createCardInstance(mismatch, {
          instanceId: "mismatch",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    }),
    step: "main",
    turnNumber: 3,
  };
  const queued = queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        eventKind: "exhaust",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "test-dynamic",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "observer",
        amount: null,
      },
    ],
    "test-dynamic-group",
    deps
  );
  return { state: queued, deps };
}

describe("汎用観測登録の契約", () => {
  it("最後の発揮可能な効果を辞退したら未成立観測を残さず、通常進行へ戻る", () => {
    const { state: initial, deps } = genericFixture();
    const state = resolve(initial, deps, "observer", 1, true);
    expect(
      state.cardInstances.find((card) => card.instanceId === "observer")!
        .normalCoreCount
    ).toBe(2);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(
      advanceStep(
        state,
        deps.getCardDefinitionById,
        deps.getRegisteredTriggeredEffectActions,
        deps.getRegisteredBurstActions
      ).step
    ).toBe("attack");
  });
  it("完了解決のflush guard snapshotを未解決の同時誘発と数えない", () => {
    const { state: initial, deps } = genericFixture();
    const declared = act(
      initial,
      deps,
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "observer"
    );
    const stack = declared.stackWindow!.pendingStackAction!;
    const state = {
      ...initial,
      pendingTriggeredEffects: initial.pendingTriggeredEffects.map(
        (pending) => ({
          ...pending,
          resolvedSourceRegistrationKeys: ["observer#1"],
        })
      ),
      pendingStackCascadeFlushGuardStacks: [stack],
    };
    expect(
      pruneIllegalPendingTriggeredEffects({ state, ...deps })
        .pendingTriggeredEffects
    ).toHaveLength(0);
  });
  it("ORに含まれるイベント条件が当初不一致なら、群中に主語の色/Lvが変わっても観測元を追加しない", () => {
    const { state: initial, deps: originalDeps } = genericFixture(false, true);
    const source = originalDeps.getCardDefinitionById("TEST-DYNAMIC-OBSERVER")!;
    const deps = dependencies([
      { ...source, colors: ["purple"] },
      originalDeps.getCardDefinitionById("TEST-MISMATCH")!,
      originalDeps.getCardDefinitionById("TEST-LATE-OBSERVER")!,
    ]);
    const state = {
      ...initial,
      cardInstances: initial.cardInstances.map((card) =>
        card.instanceId === "observer" ? { ...card, normalCoreCount: 3 } : card
      ),
    };
    expect(
      sourceChoices(state, deps).map(
        (choice) => choice.actionRegistration.effectIndex
      )
    ).toEqual([1]);
  });
  it("一度資格を得た未宣言登録が資格を失ったら、群が続いていても回復で再提示しない", () => {
    const { state: initial, deps } = genericFixture();
    const withCores = (state: GameState, cores: number) => ({
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "observer"
          ? { ...card, normalCoreCount: cores }
          : card
      ),
    });
    let state = pruneIllegalPendingTriggeredEffects({
      state: withCores(initial, 3),
      ...deps,
    });
    expect(
      sourceChoices(state, deps).map((s) => s.actionRegistration.effectIndex)
    ).toEqual([0, 1]);
    state = pruneIllegalPendingTriggeredEffects({
      state: withCores(state, 2),
      ...deps,
    });
    state = withCores(state, 3);
    expect(
      sourceChoices(state, deps).map((s) => s.actionRegistration.effectIndex)
    ).toEqual([1]);
  });
  it("公開の観測表に手札の任意申告の定義を含めず、申告経路は維持する", () => {
    const { state: initial, deps: originalDeps } = genericFixture();
    const publicDef = originalDeps.getCardDefinitionById(
      "TEST-DYNAMIC-OBSERVER"
    )!;
    const secret: CardDefinition = {
      ...publicDef,
      cardNo: "TEST-SECRET-HAND",
      name: "秘密の手札",
      effects: [{ ...publicDef.effects![1]!, applicability: { zone: "hand" } }],
    };
    const defs = [
      publicDef,
      secret,
      originalDeps.getCardDefinitionById("TEST-MISMATCH")!,
      originalDeps.getCardDefinitionById("TEST-LATE-OBSERVER")!,
    ];
    const deps = dependencies(defs);
    const state = {
      ...initial,
      pendingTriggeredEffects: [],
      cardInstances: [
        ...initial.cardInstances,
        createCardInstance(secret, {
          instanceId: "secret",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          eventKind: "exhaust",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test-secret",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "observer",
          amount: null,
        },
      ],
      "test-secret-group",
      deps
    );
    expect(
      queued.pendingPrivateDeclarations.some(
        (p) => p.sourceInstanceId === "secret"
      )
    ).toBe(true);
    expect(
      queued.pendingTriggeredEffects.every(
        (p) =>
          !JSON.stringify(p.timingSourceRegistrations).includes(secret.cardNo)
      )
    ).toBe(true);
  });
  it.each([false, true])(
    "condition/applicability(%s)は同じ疲労群中に再評価し、既存登録だけ1回発揮",
    (applicability) => {
      const { state: initial, deps } = genericFixture(applicability);
      expect(
        sourceChoices(initial, deps).map(
          (s) => s.actionRegistration.effectIndex
        )
      ).toEqual([1]);
      let state = resolve(initial, deps, "observer", 1);
      state = {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "late"
            ? {
                ...c,
                zone: "field" as const,
                normalCoreCount: 3,
                fieldInstanceGeneration: 1,
              }
            : c.instanceId === "mismatch"
              ? { ...c, normalCoreCount: 3 }
              : c
        ),
      };
      expect(
        sourceChoices(state, deps).map((s) => [
          s.sourceCard.instanceId,
          s.actionRegistration.effectIndex,
        ])
      ).toEqual([["observer", 0]]);
      state = resolve(state, deps, "observer", 0);
      expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
      expect(state.players[0]!.voidNormalCoreCount).toBe(17);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(sourceChoices(state, deps)).toHaveLength(0);
    }
  );
  it.each(["reenter", "new-face"])(
    "イベント後の%sは既存instanceIdでも過去イベントを観測しない",
    (mode) => {
      const { state: initial, deps } = genericFixture();
      const state = {
        ...initial,
        cardInstances: initial.cardInstances.map((c) =>
          c.instanceId === "observer"
            ? {
                ...c,
                normalCoreCount: 3,
                ...(mode === "reenter"
                  ? { fieldInstanceGeneration: 1 }
                  : { definitionId: "TEST-LATE-OBSERVER" }),
              }
            : c
        ),
      };
      expect(sourceChoices(state, deps)).toHaveLength(0);
      expect(
        pruneIllegalPendingTriggeredEffects({ state, ...deps })
          .pendingTriggeredEffects
      ).toHaveLength(0);
    }
  );
});
