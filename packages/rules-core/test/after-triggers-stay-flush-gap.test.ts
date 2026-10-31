/**
 * 「離れるとき残せる」(stay_on_field) × after_triggers 同期 flush の順序ギャップ検証。
 *
 * ルール (10_rules/04):
 *  - L15「『フィールドを離れるとき』効果は離脱理由に関わらず共通で参照される」
 *  - L56「待機状態に入った後に新たに発揮できるのは、待機(離脱)に関連する効果のみ」
 *  - L129-140「待機状態になっても直ちに移動せず、離脱によって発生した効果と派生効果の
 *    解決を終えた後に移動する」
 *
 * つまり消滅待機中の「離れるとき残せる」(triggered) は、実移動(flush)より前に
 * 解決窓を与えられねばならない。
 *
 * しかし flush ゲート canFlushPendingLeaveEntity は、同一 chain の pendingTriggeredEffects を
 * 待つのは deferZoneMoveUntilChainEnd:true のときだけ (P3-84)。コア不足消滅は defer:false で
 * 生成される (state-based-actions.ts:260-270) ため、同一 chain に「離れるとき残せる」が
 * キュー済みでも同期 flush が先行する = 救済窓を奪う。
 *
 * 本テストは flush ゲートが defer=false でも登録済み stay_on_field source だけを待つことを
 * pin する（無関係な count+1/draw 等の leave_field 反応は待たない）。
 *
 * 2026-07-02 engine-claude lane 調査 (ENGINE-grant-effect-pre-flush-window):
 * defer 非依存・登録済み反応全般を対象にした一般修正を試行したが、通常の登録済み
 * card_event 誘発 (残置とは無関係な count+1/draw 等) まで同一 instanceId/chain 参照だけで
 * 巻き込み、既存の「破壊 → 誘発 → この効果発揮後ドロー」順序 (P3-84 統合) を含む 9 件を
 * 回帰させた (design-flaw と判定・revert)。scope を `mechanic.kind === "granted_effect"`
 * (grant_effect 経由の残置選択専用) に縮小して着地させた
 * (`hasPendingGrantedEffectLeaveReactionForLeaver`, state-based-actions.ts)。
 * 本テストが指す「登録済み stay_on_field 効果」の gap は P3-97 で解消対象。
 */
import { describe, it, expect } from "vitest";
import {
  applyLegalAction,
  createEmptyGameState,
  createCardInstance,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  CollectedTriggerEvent,
  GameState,
  PendingLeaveEntity,
  PendingTriggeredEffect,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  resolveStackCascade,
  resumeTargetedDisclosureIfReady,
} from "../src/legal/stack-resolution-core";

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(): CardDefinition {
  return {
    cardNo: "TEST-STAY",
    name: "Test",
    printedCategory: "spirit",
    colors: ["red"],
    printedColors: ["red"],
    cost: 3,
    symbolColors: ["red"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "星竜",
  } as CardDefinition;
}

const getDef = (_: string): CardDefinition | undefined => dummyDef();

function vanishPendingCard(): CardInstance {
  // コア不足消滅で待機に入った相手スピリット (まだ field 上)
  return createCardInstance(dummyDef(), {
    instanceId: "victim",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 0,
    pendingLeaveKind: "vanish",
    pendingLeaveCause: "effect_resolution",
    pendingLeaveChainId: "chain-coreshoot",
  });
}

function vanishPending(defer: boolean): PendingLeaveEntity {
  return {
    instanceId: "victim",
    kind: "vanish",
    cause: "effect_resolution",
    causePlayerId: ALICE, // 相手(ALICE)起因の離脱
    chainId: "chain-coreshoot",
    deferZoneMoveUntilChainEnd: defer,
    leaveFieldCoreDestinationOverride: null,
  };
}

// 「相手によってフィールドを離れるとき、残せる」= leave_field 系の triggered 効果が
// 同一 chain にキュー済み (collectAndQueueTriggerReactions が pending 入りで emit)。
function queuedStayTrigger(): PendingTriggeredEffect {
  return {
    pendingId: "stay-victim",
    actingPlayerId: BOB,
    eventKind: "vanish",
    source: "action_resolution",
    chainId: "chain-coreshoot",
    attackId: null,
    relatedPlayerId: BOB,
    relatedInstanceId: "victim",
    amount: null,
    step: "main",
    window: "none",
    resolvedSourceInstanceIds: [],
    registeredLeaveFieldStayOnFieldSourceKeys: ["victim#0"],
  } as PendingTriggeredEffect;
}

function queuedNonStayTrigger(): PendingTriggeredEffect {
  return {
    ...queuedStayTrigger(),
    pendingId: "draw-victim",
    registeredLeaveFieldStayOnFieldSourceKeys: undefined,
  } as PendingTriggeredEffect;
}

function setup(defer: boolean): GameState {
  const state = createEmptyGameState({
    cardInstances: [vanishPendingCard()],
    playerOverrides: [{}, {}],
  });
  state.pendingLeaveEntities = [vanishPending(defer)];
  state.pendingTriggeredEffects = [queuedStayTrigger()];
  // effectQueue は空 = 解決中チェーン無し (gate #1/#3 は通過する)
  return state;
}

function setupNonStay(defer: boolean): GameState {
  const state = setup(defer);
  state.pendingTriggeredEffects = [queuedNonStayTrigger()];
  return state;
}

const cardOf = (s: GameState) =>
  s.cardInstances.find((c) => c.instanceId === "victim")!;

function stayOnLeaveDef(
  cause?: "opponent_effect" | "battle" | readonly ["opponent_effect", "battle"],
  includeNonStayEffect = false,
  useNoTargetStay = false,
  includeMovedToTrashSourceGate = false
): CardDefinition {
  const effects: CardDefinition["effects"] = [
    {
      timing: {
        kind: "card_event",
        event: "leave_field",
        ...(cause !== undefined ? { cause } : {}),
      },
      executionMode: "optional",
      steps: [
        {
          action: {
            kind: "stay_on_field",
            target: useNoTargetStay
              ? {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["ultimate"] },
                  count: 1,
                }
              : { kind: "self" },
          },
        },
      ],
    },
  ];
  if (includeNonStayEffect) {
    effects.push({
      timing: {
        kind: "card_event",
        event: "leave_field",
      },
      executionMode: "optional",
      steps: [
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    });
  }
  if (includeMovedToTrashSourceGate) {
    effects.push({
      timing: { kind: "card_event", event: "moved_to_trash" },
      cardEventDisposition: { kind: "move", destination: "hand" },
      condition: [
        { kind: "trigger_colors", colors: ["red"] },
        { kind: "trigger_source_category", include: ["spirit"] },
        { kind: "trigger_from_zone", zones: ["field"] },
      ],
      executionMode: "mandatory",
      steps: [{ action: { kind: "move_self", destination: "hand" } }],
    });
  }
  return {
    ...dummyDef(),
    cardNo: "TEST-P3-97-STAY",
    name: "P3-97 stay",
    effects,
  } as CardDefinition;
}

function p397SourceDef(
  printedCategory: CardDefinition["printedCategory"] = "spirit"
): CardDefinition {
  return {
    ...dummyDef(),
    cardNo: "TEST-P3-97-SRC",
    name: "P3-97 source",
    printedCategory,
  };
}

function p397CoreShootSourceDef(
  printedCategory: CardDefinition["printedCategory"] = "spirit"
): CardDefinition {
  return {
    ...p397SourceDef(printedCategory),
    effects: [
      {
        timing: { kind: "card_event", event: "leave_field" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
              from: { kind: "target_card" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      },
    ],
  } as CardDefinition;
}

function lookupFor(defs: readonly CardDefinition[]) {
  const byId = new Map(defs.map((def) => [def.cardNo, def]));
  return {
    getCardDefinitionById: (id: string) => byId.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  };
}

const legalStubs = {
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredHandCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
} as const;

function driveTriggeredStayToQuiescence(
  state: GameState,
  defs: readonly CardDefinition[]
): GameState {
  const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
    lookupFor(defs);
  let cur = state;
  for (let i = 0; i < 40; i++) {
    let progressed = false;
    for (const pid of [BOB, ALICE]) {
      const actions = getLegalActions({
        state: cur,
        actingPlayerId: pid,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      });
      const action =
        actions.find((a) => a.kind === "select_pending_to_resolve") ??
        actions.find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "victim"
        ) ??
        actions.find((a) => a.kind === "pass_stack");
      if (!action) continue;
      cur = applyLegalAction({
        state: cur,
        action,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }).state;
      progressed = true;
      break;
    }
    if (!progressed) break;
  }
  return cur;
}

function p397Board(
  options: {
    stayCause?:
      | "opponent_effect"
      | "battle"
      | readonly ["opponent_effect", "battle"];
    includeVictimNonStayEffect?: boolean;
    useNoTargetStay?: boolean;
    includeVictimMovedToTrashSourceGate?: boolean;
    sourcePrintedCategory?: CardDefinition["printedCategory"];
    sourceActAsSpirit?: boolean;
    victimPrintedCategory?: CardDefinition["printedCategory"];
  } = {}
): { state: GameState; defs: CardDefinition[] } {
  const sourceDef = p397SourceDef(options.sourcePrintedCategory);
  const victimDef = {
    ...stayOnLeaveDef(
      options.stayCause,
      options.includeVictimNonStayEffect,
      options.useNoTargetStay,
      options.includeVictimMovedToTrashSourceGate
    ),
    printedCategory: options.victimPrintedCategory ?? "spirit",
  } as CardDefinition;
  const source = createCardInstance(sourceDef, {
    instanceId: "src",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const victim = createCardInstance(victimDef, {
    instanceId: "victim",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [source, victim],
  });
  return {
    defs: [sourceDef, victimDef],
    state: options.sourceActAsSpirit
      ? {
          ...state,
          activeContinuousEffects: [
            ...state.activeContinuousEffects,
            {
              effectId: "ce-p397-source-act-as-spirit",
              sourceInstanceId: "src",
              sourceDefinitionId: sourceDef.cardNo,
              actingPlayerId: ALICE,
              duration: { scope: "permanent" },
              createdAtTurn: 1,
              createdAtAttackId: null,
              modifierTag: "act_as_spirit",
              targetInstanceId: "src",
              metadata: {},
            },
          ],
        }
      : state,
  };
}

function destroyVictimWithAfterTriggers(
  state: GameState,
  defs: readonly CardDefinition[]
): GameState {
  const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
    lookupFor(defs);
  return executeEffect({
    chainId: "test:after-triggers-stay-flush-gap:385",
    state,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    effect: {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
  });
}

function coreShootVictimWithAfterTriggers(
  state: GameState,
  defs: readonly CardDefinition[]
): GameState {
  const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
    lookupFor(defs);
  return executeEffect({
    chainId: "test:after-triggers-stay-flush-gap:420",
    state,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    effect: {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: 1,
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
  });
}

function selectVictimStay(
  state: GameState,
  defs: readonly CardDefinition[]
): GameState {
  const lookups = { ...lookupFor(defs), ...legalStubs };
  const select = getLegalActions({
    state,
    actingPlayerId: ALICE,
    ...lookups,
  }).find(
    (a) =>
      a.kind === "select_pending_to_resolve" &&
      a.sourceInstanceId === "victim" &&
      a.registrationIndex === 0
  );
  return select
    ? applyLegalAction({ state, action: select, ...lookups }).state
    : state;
}

function declareVictimStayStack(
  state: GameState,
  defs: readonly CardDefinition[]
): GameState {
  state = selectVictimStay(state, defs);
  const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
    lookupFor(defs);
  const declareStayAction = getLegalActions({
    state,
    actingPlayerId: BOB,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    ...legalStubs,
  }).find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === "victim"
  );
  expect(declareStayAction).toBeDefined();
  return applyLegalAction({
    state,
    action: declareStayAction!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    ...legalStubs,
  }).state;
}

describe("after_triggers flush × 同一chain の離脱関連 triggered (離れるとき残せる)", () => {
  it("defer=true: 同一chain に未解決の triggered があれば flush を保留する (P3-84 で保護済み)", () => {
    const flushed = flushPendingLeaves(setup(true), getDef);
    // victim はまだ field に残る = 「離れるとき残せる」に解決窓を与えられる
    expect(cardOf(flushed).zone).toBe("field");
    expect(flushed.pendingLeaveEntities).toHaveLength(1);
  });

  it("defer=false (コア不足消滅): 登録済み stay_on_field source が未解決なら flush を保留する", () => {
    const flushed = flushPendingLeaves(setup(false), getDef);
    expect(cardOf(flushed).zone).toBe("field");
    expect(flushed.pendingLeaveEntities).toHaveLength(1);
  });

  it("defer=false: stay_on_field source でない leave_field 反応だけなら従来どおり flush する", () => {
    const flushed = flushPendingLeaves(setupNonStay(false), getDef);
    expect(cardOf(flushed).zone).toBe("trash");
    expect(flushed.pendingLeaveEntities).toHaveLength(0);
  });
});

describe("P3-97 registered stay_on_field pre-flush window", () => {
  it("opponent effect leave: after_triggers で stay_on_field を queue し、resolve 後に field 残置する", () => {
    const { state, defs } = p397Board();
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);

    const afterDestroy = executeEffect({
      chainId: "test:after-triggers-stay-flush-gap:527",
      state,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
            },
          },
          {
            connector: "after_triggers",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
      },
    });

    expect(cardOf(afterDestroy).zone).toBe("field");
    expect(cardOf(afterDestroy).pendingLeaveKind).toBe("destroy");
    expect(afterDestroy.pendingLeaveEntities).toHaveLength(1);
    expect(afterDestroy.pendingTriggeredEffects).toHaveLength(1);
    expect(
      afterDestroy.pendingTriggeredEffects[0]
        ?.registeredLeaveFieldStayOnFieldSourceKeys
    ).toEqual(["victim#0"]);

    const final = driveTriggeredStayToQuiescence(afterDestroy, defs);
    expect(cardOf(final).zone).toBe("field");
    expect(cardOf(final).pendingLeaveKind).toBeNull();
    expect(final.pendingLeaveEntities).toHaveLength(0);
    expect(
      final.log.some((entry) =>
        entry.includes("effect:stay_on_field:victim:keep")
      )
    ).toBe(true);
  });

  it("opponent effect leave: stay_on_field 発揮宣言後の stack 窓中も flush を保留する", () => {
    const { state, defs } = p397Board();
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);

    const afterDestroy = executeEffect({
      chainId: "test:after-triggers-stay-flush-gap:580",
      state,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
            },
          },
          {
            connector: "after_triggers",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
      },
    });
    const declareStayAction = getLegalActions({
      state: afterDestroy,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "victim"
    );
    expect(declareStayAction).toBeDefined();

    const declared = applyLegalAction({
      state: afterDestroy,
      action: declareStayAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).state;

    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );
    expect(declared.pendingTriggeredEffects).toHaveLength(0);

    const flushedDuringStackWindow = flushPendingLeaves(
      declared,
      getCardDefinitionById
    );
    expect(cardOf(flushedDuringStackWindow).zone).toBe("field");
    expect(cardOf(flushedDuringStackWindow).pendingLeaveKind).toBe("destroy");
    expect(flushedDuringStackWindow.pendingLeaveEntities).toHaveLength(1);

    const final = driveTriggeredStayToQuiescence(declared, defs);
    expect(cardOf(final).zone).toBe("field");
    expect(cardOf(final).pendingLeaveKind).toBeNull();
    expect(final.pendingLeaveEntities).toHaveLength(0);
  });

  it("opponent effect leave: stack cascade 解決中の未解決 stay_on_field stack も flush を保留する", () => {
    const { state, defs } = p397Board();
    const { getCardDefinitionById } = lookupFor(defs);
    const afterDestroy = destroyVictimWithAfterTriggers(state, defs);
    const declared = declareVictimStayStack(afterDestroy, defs);
    const stayStack = declared.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const hiddenCascadeState: GameState = {
      ...declared,
      stackWindow: null,
      pendingStackCascade: null,
      pendingStackCascadeFlushGuardStacks: [stayStack as ActiveStack],
    };
    const flushedDuringCascade = flushPendingLeaves(
      hiddenCascadeState,
      getCardDefinitionById
    );

    expect(cardOf(flushedDuringCascade).zone).toBe("field");
    expect(cardOf(flushedDuringCascade).pendingLeaveKind).toBe("destroy");
    expect(flushedDuringCascade.pendingLeaveEntities).toHaveLength(1);
  });

  it("opponent effect leave: nullified stay_on_field stack 後は pendingLeave を flush する", () => {
    const { state, defs } = p397Board();
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const afterDestroy = destroyVictimWithAfterTriggers(state, defs);
    const declared = declareVictimStayStack(afterDestroy, defs);
    const stayStack = declared.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNullified = resolveStackCascade(
      {
        ...declared,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [{ ...(stayStack as ActiveStack), isNullified: true }],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNullified).zone).toBe("trash");
    expect(cardOf(afterNullified).pendingLeaveKind).toBeNull();
    expect(afterNullified.pendingLeaveEntities).toHaveLength(0);
    expect(afterNullified.pendingTriggeredEffects).toHaveLength(0);
    expect(
      afterNullified.log.some((entry) => entry.includes("effect:nullified"))
    ).toBe(true);
  });

  it("opponent effect leave: stay_on_field stack が no-target なら guard 解除後に pendingLeave を flush する", () => {
    const { state, defs } = p397Board({ useNoTargetStay: true });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const afterDestroy = destroyVictimWithAfterTriggers(state, defs);
    const declared = declareVictimStayStack(afterDestroy, defs);
    const stayStack = declared.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNoTarget = resolveStackCascade(
      {
        ...declared,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNoTarget).zone).toBe("trash");
    expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
    expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(afterNoTarget.pendingTriggeredEffects).toHaveLength(0);
  });

  it("opponent effect leave: no-target 後の delayed flush は moved_to_trash source 条件を保持する", () => {
    const { state, defs } = p397Board({
      useNoTargetStay: true,
      includeVictimMovedToTrashSourceGate: true,
    });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const afterDestroy = destroyVictimWithAfterTriggers(state, defs);
    const declared = declareVictimStayStack(afterDestroy, defs);
    const stayStack = declared.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNoTarget = resolveStackCascade(
      {
        ...declared,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNoTarget).zone).toBe("hand");
    expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
    expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterNoTarget.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(true);
  });

  it("opponent core deficit vanish: no-target delayed flush でも moved_to_trash source 条件を保持する", () => {
    const { state, defs } = p397Board({
      useNoTargetStay: true,
      includeVictimMovedToTrashSourceGate: true,
    });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const afterCoreShoot = coreShootVictimWithAfterTriggers(state, defs);
    expect(cardOf(afterCoreShoot).zone).toBe("field");
    expect(cardOf(afterCoreShoot).pendingLeaveKind).toBe("vanish");
    expect(afterCoreShoot.pendingLeaveEntities).toHaveLength(1);
    expect(
      afterCoreShoot.pendingLeaveEntities[0]?.causedByEffectSourceInstanceId
    ).toBe("src");

    const declared = declareVictimStayStack(afterCoreShoot, defs);
    const stayStack = declared.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNoTarget = resolveStackCascade(
      {
        ...declared,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNoTarget).zone).toBe("hand");
    expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
    expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterNoTarget.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(true);
  });

  it("opponent core deficit vanish: delayed flush の source category は印字カテゴリで評価する", () => {
    const { state, defs } = p397Board({
      useNoTargetStay: true,
      includeVictimMovedToTrashSourceGate: true,
      sourcePrintedCategory: "magic",
      sourceActAsSpirit: true,
    });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const afterCoreShoot = coreShootVictimWithAfterTriggers(state, defs);
    expect(
      afterCoreShoot.pendingLeaveEntities[0]?.causedByEffectSourceInstanceId
    ).toBe("src");

    const declared = declareVictimStayStack(afterCoreShoot, defs);
    const stayStack = declared.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNoTarget = resolveStackCascade(
      {
        ...declared,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNoTarget).zone).toBe("trash");
    expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
    expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterNoTarget.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(false);
  });

  it("同期 stay_on_field no-target flush も pendingLeave の source category を保持する", () => {
    const { state, defs } = p397Board({
      useNoTargetStay: true,
      includeVictimMovedToTrashSourceGate: true,
    });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const afterCoreShoot = coreShootVictimWithAfterTriggers(state, defs);
    expect(
      afterCoreShoot.pendingLeaveEntities[0]?.causedByEffectSourceInstanceId
    ).toBe("src");
    const syncStayAction = getLegalActions({
      state: afterCoreShoot,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "victim"
    );
    expect(syncStayAction).toBeDefined();

    const afterSyncNoTarget = applyLegalAction({
      state: afterCoreShoot,
      action: syncStayAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getPendingTriggeredEffectResolver: () => (currentState) => currentState,
      ...legalStubs,
    }).state;

    expect(cardOf(afterSyncNoTarget).zone).toBe("hand");
    expect(cardOf(afterSyncNoTarget).pendingLeaveKind).toBeNull();
    expect(afterSyncNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterSyncNoTarget.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(true);
  });

  it("triggered stack 解決中の core deficit vanish も delayed flush source 条件を保持する", () => {
    const sourceDef = p397CoreShootSourceDef();
    const victimDef = {
      ...stayOnLeaveDef(undefined, false, true, true),
      printedCategory: "spirit",
    } as CardDefinition;
    const source = createCardInstance(sourceDef, {
      instanceId: "src",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const victim = createCardInstance(victimDef, {
      instanceId: "victim",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, victim],
    });
    const defs = [sourceDef, victimDef];
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const sourcePending: PendingTriggeredEffect = {
      pendingId: "p397-source-core-shoot",
      actingPlayerId: ALICE,
      eventKind: "destroy",
      source: "action_resolution",
      chainId: "chain-src-leave",
      attackId: null,
      relatedPlayerId: ALICE,
      relatedInstanceId: "src",
      amount: null,
      step: state.step,
      window: state.window,
      resolvedSourceInstanceIds: [],
    };
    const sourceStack: ActiveStack = {
      stackId: "stack:p397-source-core-shoot",
      actionKind: "triggered_effect",
      chainId: "trigger:p397-source-core-shoot",
      actingPlayerId: ALICE,
      cardInstanceId: "src",
      cardDefinitionId: sourceDef.cardNo,
      targetInstanceIds: ["victim"],
      targetEffectFilterTags: [],
      triggeredPendingSnapshot: sourcePending,
      triggeredRegistrationIndex: 0,
      triggeredSourceCardNo: sourceDef.cardNo,
      triggeredSourceKind: "spirit",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const afterSourceStack = resolveStackCascade(state, [sourceStack], {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    });

    expect(cardOf(afterSourceStack).zone).toBe("field");
    expect(cardOf(afterSourceStack).pendingLeaveKind).toBe("vanish");
    expect(
      afterSourceStack.pendingLeaveEntities[0]?.causedByEffectSourceInstanceId
    ).toBe("src");

    const declaredStay = declareVictimStayStack(afterSourceStack, defs);
    const stayStack = declaredStay.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNoTarget = resolveStackCascade(
      {
        ...declaredStay,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNoTarget).zone).toBe("hand");
    expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
    expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterNoTarget.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(true);
  });

  it("同期 resolve_pending_triggered_effect の core deficit vanish も delayed flush source 条件を保持する", () => {
    const sourceDef = p397SourceDef();
    const victimDef = {
      ...stayOnLeaveDef(undefined, false, true, true),
      printedCategory: "spirit",
    } as CardDefinition;
    const source = createCardInstance(sourceDef, {
      instanceId: "src",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const victim = createCardInstance(victimDef, {
      instanceId: "victim",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, victim],
    });
    const sourcePending: PendingTriggeredEffect = {
      pendingId: "p397-sync-core-shoot",
      actingPlayerId: ALICE,
      eventKind: "destroy",
      source: "action_resolution",
      chainId: "chain-sync-trigger",
      attackId: null,
      relatedPlayerId: ALICE,
      relatedInstanceId: "src",
      amount: null,
      step: baseState.step,
      window: baseState.window,
      resolvedSourceInstanceIds: [],
    };
    const state: GameState = {
      ...baseState,
      pendingTriggeredEffects: [sourcePending],
    };
    const defs = [sourceDef, victimDef];
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);

    const afterSyncResolve = applyLegalAction({
      state,
      action: {
        chainId: "test:after-triggers-stay-flush-gap:1038",
        kind: "resolve_pending_triggered_effect",
        actionId: "resolve-p397-sync-core-shoot",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        pendingId: sourcePending.pendingId,
        eventKind: sourcePending.eventKind,
        executionMode: "optional",
        sourceKind: "spirit",
        sourceInstanceId: "src",
        sourceDefinitionId: sourceDef.cardNo,
        sourceCardNo: sourceDef.cardNo,
        registrationIndex: 0,
        targetMode: "none",
        requiredTargetCount: 0,
        targetEffectFilterTags: [],
        candidateTargetInstanceIds: [],
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      resolvePendingTriggeredEffect: (currentState) => ({
        ...currentState,
        cardInstances: currentState.cardInstances.map((card) =>
          card.instanceId === "victim" ? { ...card, normalCoreCount: 0 } : card
        ),
      }),
      ...legalStubs,
    }).state;

    expect(cardOf(afterSyncResolve).zone).toBe("field");
    expect(cardOf(afterSyncResolve).pendingLeaveKind).toBe("vanish");
    expect(
      afterSyncResolve.pendingLeaveEntities[0]?.causedByEffectSourceInstanceId
    ).toBe("src");

    const declaredStay = declareVictimStayStack(afterSyncResolve, defs);
    const stayStack = declaredStay.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNoTarget = resolveStackCascade(
      {
        ...declaredStay,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNoTarget).zone).toBe("hand");
    expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
    expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterNoTarget.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(true);
  });

  it("targeted disclosure 再開後の core deficit vanish も delayed flush source 条件を保持する", () => {
    const sourceDef = p397CoreShootSourceDef();
    const victimDef = {
      ...stayOnLeaveDef(undefined, false, true, true),
      printedCategory: "spirit",
    } as CardDefinition;
    const source = createCardInstance(sourceDef, {
      instanceId: "src",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const victim = createCardInstance(victimDef, {
      instanceId: "victim",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, victim],
    });
    const state: GameState = {
      ...baseState,
      pendingTargetedDisclosureContinuation: {
        chainId: "test:after-triggers-stay-flush-gap:1128",
        pendingId: "targeted-disclosure:p397-core-shoot",
        sourceDefinitionId: sourceDef.cardNo,
        effectIndex: 0,
        sourceInstanceId: "src",
        actingPlayerId: ALICE,
        resumeStepIndex: 0,
        stepContext: { results: {} },
        targetInstanceIds: ["victim"],
        targetStepId: "__step_0",
        remainingStacks: [],
        effectResolutionBeforeState: baseState,
      },
    };
    const defs = [sourceDef, victimDef];
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);

    const afterResume = resumeTargetedDisclosureIfReady(state, {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    });

    expect(afterResume.pendingTargetedDisclosureContinuation).toBeNull();
    expect(cardOf(afterResume).zone).toBe("field");
    expect(cardOf(afterResume).pendingLeaveKind).toBe("vanish");
    expect(
      afterResume.pendingLeaveEntities[0]?.causedByEffectSourceInstanceId
    ).toBe("src");

    const declaredStay = declareVictimStayStack(afterResume, defs);
    const stayStack = declaredStay.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterNoTarget = resolveStackCascade(
      {
        ...declaredStay,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterNoTarget).zone).toBe("hand");
    expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
    expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterNoTarget.log.some((entry) =>
        entry.startsWith("moved_to_trash:add_to_hand:")
      )
    ).toBe(true);
  });

  it.each([undefined, "hand-written:attack"])(
    "hand-written targeted disclosure 再開後の core deficit vanish も原因を保持する: %s",
    (battleEndDeferralAttackId) => {
      const hostDef = {
        ...dummyDef(),
        cardNo: "TEST-P3-97-HOST",
        name: "P3-97 host",
        printedCategory: "nexus",
        colors: ["blue"],
        printedColors: ["blue"],
        symbolColors: ["blue"],
      } as CardDefinition;
      const sourceDef = p397SourceDef();
      const victimDef = {
        ...stayOnLeaveDef(undefined, false, true, true),
        printedCategory: "spirit",
      } as CardDefinition;
      const host = createCardInstance(hostDef, {
        instanceId: "host",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const source = createCardInstance(sourceDef, {
        instanceId: "src",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const victim = createCardInstance(victimDef, {
        instanceId: "victim",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const baseState = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, source, victim],
      });
      const state: GameState = {
        ...baseState,
        pendingTargetedDisclosureContinuation: {
          chainId: "test:after-triggers-stay-flush-gap:1226",
          pendingId: "targeted-disclosure:p397-hand-written-core-shoot",
          sourceDefinitionId: hostDef.cardNo,
          effectIndex: 0,
          sourceInstanceId: "host",
          effectSourceInstanceId: "src",
          effectSourceDefinitionId: sourceDef.cardNo,
          actingPlayerId: ALICE,
          resumeStepIndex: 0,
          stepContext: { results: {} },
          targetInstanceIds: ["victim"],
          targetStepId: "__hand_written__",
          remainingStacks: [],
          effectResolutionBeforeState: baseState,
          handWrittenResolution: {
            chainId: "chain:p397-hand-written-core-shoot",
            resolutionKind: "field_card_effect_action",
            sourceKind: "nexus",
            sourceCard: host,
            targetInstanceIds: ["victim"],
            targetStepId: "__hand_written__",
            endLogs: [],
            effectActionKind: "field_card_effect",
          },
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        },
      };
      const defs = [hostDef, sourceDef, victimDef];
      const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
        lookupFor(defs);
      const getHandWrittenEffectResolver = (cardNo: string) =>
        cardNo === hostDef.cardNo
          ? (
              current: GameState,
              context: { effectSourceInstanceId?: string }
            ) => ({
              ...current,
              cardInstances: current.cardInstances.map((card) =>
                card.instanceId === "victim"
                  ? { ...card, normalCoreCount: 0 }
                  : card
              ),
              log: [
                ...current.log,
                `hand-written:effect-source:${context.effectSourceInstanceId ?? "none"}`,
              ],
            })
          : undefined;

      const afterResume = resumeTargetedDisclosureIfReady(state, {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getHandWrittenEffectResolver,
        ...legalStubs,
      });

      expect(afterResume.log).toContain("hand-written:effect-source:src");
      expect(
        [
          ...afterResume.pendingTriggeredEffects,
          ...afterResume.pendingDeferredTriggeredEffects,
        ].some((p) => p.chainId.includes("chain:p397-hand-written-core-shoot")),
        JSON.stringify({
          pending: afterResume.pendingTriggeredEffects,
          deferred: afterResume.pendingDeferredTriggeredEffects,
          log: afterResume.log,
        })
      ).toBe(true);
      expect(cardOf(afterResume).zone).toBe("field");
      expect(cardOf(afterResume).pendingLeaveKind).toBe("vanish");
      expect(
        afterResume.pendingLeaveEntities[0]?.causedByEffectSourceInstanceId
      ).toBe("src");

      const declaredStay = declareVictimStayStack(afterResume, defs);
      const stayStack = declaredStay.stackWindow?.pendingStackAction;
      expect(stayStack).toBeDefined();

      const afterNoTarget = resolveStackCascade(
        {
          ...declaredStay,
          stackWindow: null,
          pendingStackCascade: null,
        },
        [stayStack as ActiveStack],
        {
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          ...legalStubs,
        }
      );

      expect(cardOf(afterNoTarget).zone).toBe("hand");
      expect(cardOf(afterNoTarget).pendingLeaveKind).toBeNull();
      expect(afterNoTarget.pendingLeaveEntities).toHaveLength(0);
      expect(
        afterNoTarget.log.some((entry) =>
          entry.startsWith("moved_to_trash:add_to_hand:")
        )
      ).toBe(true);
    }
  );

  it("opponent effect leave: filter target の stay_on_field は pendingLeave 対象だけを選ぶ", () => {
    const { state, defs } = p397Board({
      useNoTargetStay: true,
      victimPrintedCategory: "ultimate",
    });
    const bystanderDef = {
      ...dummyDef(),
      cardNo: "TEST-P3-97-BYSTANDER",
      printedCategory: "ultimate",
    } as CardDefinition;
    const bystander = createCardInstance(bystanderDef, {
      instanceId: "bystander",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const source = state.cardInstances.find(
      (card) => card.instanceId === "src"
    )!;
    const victim = cardOf(state);
    const pendingBattleDestroy: PendingLeaveEntity = {
      instanceId: "victim",
      kind: "destroy",
      cause: "battle",
      causePlayerId: ALICE,
      chainId: "chain-battle-filter",
      deferZoneMoveUntilChainEnd: false,
      leaveFieldCoreDestinationOverride: null,
    };
    const pendingState: GameState = {
      ...state,
      cardInstances: [
        source,
        bystander,
        {
          ...victim,
          pendingLeaveKind: "destroy",
          pendingLeaveCause: "battle",
          pendingLeaveChainId: "chain-battle-filter",
        },
      ],
      pendingLeaveEntities: [pendingBattleDestroy],
    };
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor([...defs, bystanderDef]);
    const queued = queuePendingReactionsFromTriggerEvents(
      pendingState,
      [
        {
          actingPlayerId: BOB,
          eventKind: "destroy",
          source: "battle_resolution",
          chainId: "chain-battle-filter",
          attackId: null,
          relatedPlayerId: BOB,
          relatedInstanceId: "victim",
          amount: null,
          cause: "battle",
        },
      ],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: () => undefined,
      }
    );

    const final = driveTriggeredStayToQuiescence(queued, [
      ...defs,
      bystanderDef,
    ]);

    expect(cardOf(final).zone).toBe("field");
    expect(cardOf(final).pendingLeaveKind).toBeNull();
    expect(final.pendingLeaveEntities).toHaveLength(0);
    expect(
      final.cardInstances.find((card) => card.instanceId === "bystander")?.zone
    ).toBe("field");
    expect(
      final.log.some((entry) =>
        entry.includes("effect:stay_on_field:victim:keep")
      )
    ).toBe(true);
  });

  it("opponent effect leave: queued stay_on_field を辞退したら pendingLeave を即 flush する", () => {
    const { state, defs } = p397Board();
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);

    const afterDestroy = executeEffect({
      chainId: "test:after-triggers-stay-flush-gap:1407",
      state,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
            },
          },
          {
            connector: "after_triggers",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
      },
    });

    let selected = afterDestroy;
    const selectAction = getLegalActions({
      state: selected,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).find((a) => a.kind === "select_pending_to_resolve");
    if (selectAction) {
      selected = applyLegalAction({
        state: selected,
        action: selectAction,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }).state;
    }
    const skipAction = getLegalActions({
      state: selected,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "victim"
    );
    expect(skipAction).toBeDefined();

    const skipped = applyLegalAction({
      state: selected,
      action: skipAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      skipOptionalEffect: true,
      ...legalStubs,
    }).state;

    expect(cardOf(skipped).zone).toBe("trash");
    expect(cardOf(skipped).pendingLeaveKind).toBeNull();
    expect(skipped.pendingLeaveEntities).toHaveLength(0);
    expect(skipped.pendingTriggeredEffects).toHaveLength(0);
  });

  it("opponent effect leave: stay_on_field 成功後は同一離脱の non-stay source を requeue しない", () => {
    const { state, defs } = p397Board({ includeVictimNonStayEffect: true });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const afterDestroy = destroyVictimWithAfterTriggers(state, defs);
    expect(
      afterDestroy.pendingTriggeredEffects[0]
        ?.registeredLeaveFieldStayOnFieldSourceKeys
    ).toEqual(["victim#0"]);

    const declared = declareVictimStayStack(afterDestroy, defs);
    const stayStack = declared.stackWindow?.pendingStackAction;
    expect(stayStack).toBeDefined();

    const afterStay = resolveStackCascade(
      {
        ...declared,
        stackWindow: null,
        pendingStackCascade: null,
      },
      [stayStack as ActiveStack],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...legalStubs,
      }
    );

    expect(cardOf(afterStay).zone).toBe("field");
    expect(cardOf(afterStay).pendingLeaveKind).toBeNull();
    expect(afterStay.pendingLeaveEntities).toHaveLength(0);
    expect(afterStay.pendingTriggeredEffects).toHaveLength(0);
    expect(
      afterStay.log.some((entry) => entry.startsWith("trigger:requeued:"))
    ).toBe(false);
  });

  it("opponent effect leave: skipOnly drain でも stay_on_field 辞退後に pendingLeave を flush する", () => {
    const { state, defs } = p397Board();
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);

    const afterDestroy = executeEffect({
      chainId: "test:after-triggers-stay-flush-gap:1522",
      state,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
            },
          },
          {
            connector: "after_triggers",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
      },
    });
    const legalAction = getLegalActions({
      state: afterDestroy,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "victim"
    );
    expect(legalAction).toBeDefined();
    const skipOnlyAction = {
      ...legalAction!,
      skipOnly: true,
      sourceInstanceId: undefined,
      sourceDefinitionId: undefined,
      sourceEffectInstanceId: undefined,
      sourceEffectDefinitionId: undefined,
      sourceCardNo: undefined,
      registrationIndex: undefined,
    };

    const skipped = applyLegalAction({
      state: afterDestroy,
      action: skipOnlyAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).state;

    expect(cardOf(skipped).zone).toBe("trash");
    expect(cardOf(skipped).pendingLeaveKind).toBeNull();
    expect(skipped.pendingLeaveEntities).toHaveLength(0);
    expect(skipped.pendingTriggeredEffects).toHaveLength(0);
  });

  it("opponent effect leave: stay_on_field 辞退後に non-stay source も解決してから flush する", () => {
    const { state, defs } = p397Board({ includeVictimNonStayEffect: true });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);

    const afterDestroy = executeEffect({
      chainId: "test:after-triggers-stay-flush-gap:1591",
      state,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
            },
          },
          {
            connector: "after_triggers",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
      },
    });
    expect(
      afterDestroy.pendingTriggeredEffects[0]
        ?.registeredLeaveFieldStayOnFieldSourceKeys
    ).toEqual(["victim#0"]);

    const selected = selectVictimStay(afterDestroy, defs);
    const skipStayAction = getLegalActions({
      state: selected,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...legalStubs,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "victim"
    );
    expect(skipStayAction).toBeDefined();

    const skipped = applyLegalAction({
      state: selected,
      action: skipStayAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      skipOptionalEffect: true,
      ...legalStubs,
    }).state;

    expect(cardOf(skipped).zone).toBe("field");
    expect(cardOf(skipped).pendingLeaveKind).toBe("destroy");
    expect(skipped.pendingLeaveEntities).toHaveLength(1);
    expect(skipped.pendingTriggeredEffects).toHaveLength(1);
    expect(
      skipped.pendingTriggeredEffects[0]?.resolvedSourceRegistrationKeys
    ).toContain("victim#0");
    const final = driveTriggeredStayToQuiescence(skipped, defs);
    expect(cardOf(final).zone).toBe("trash");
    expect(final.pendingLeaveEntities).toHaveLength(0);
  });

  it("battle leave: battle cause の leave_field stay_on_field trigger も flush 前に resolve できる", () => {
    const { state, defs } = p397Board({
      stayCause: ["opponent_effect", "battle"],
    });
    const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
      lookupFor(defs);
    const victim = cardOf(state);
    const pendingBattleDestroy: PendingLeaveEntity = {
      instanceId: "victim",
      kind: "destroy",
      cause: "battle",
      causePlayerId: ALICE,
      chainId: "chain-battle",
      deferZoneMoveUntilChainEnd: false,
      leaveFieldCoreDestinationOverride: null,
    };
    const pendingState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "victim"
          ? {
              ...victim,
              pendingLeaveKind: "destroy",
              pendingLeaveCause: "battle",
              pendingLeaveChainId: "chain-battle",
            }
          : card
      ),
      pendingLeaveEntities: [pendingBattleDestroy],
    };
    const battleEvent: CollectedTriggerEvent = {
      actingPlayerId: BOB,
      eventKind: "destroy",
      source: "battle_resolution",
      chainId: "chain-battle",
      attackId: null,
      relatedPlayerId: BOB,
      relatedInstanceId: "victim",
      amount: null,
      cause: "battle",
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      pendingState,
      [battleEvent],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: () => undefined,
      }
    );
    const flushedBeforeResolve = flushPendingLeaves(
      queued,
      getCardDefinitionById
    );

    expect(cardOf(flushedBeforeResolve).zone).toBe("field");
    expect(flushedBeforeResolve.pendingLeaveEntities).toHaveLength(1);
    expect(
      flushedBeforeResolve.pendingTriggeredEffects[0]
        ?.registeredLeaveFieldStayOnFieldSourceKeys
    ).toEqual(["victim#0"]);

    const final = driveTriggeredStayToQuiescence(flushedBeforeResolve, defs);
    expect(cardOf(final).zone).toBe("field");
    expect(cardOf(final).pendingLeaveKind).toBeNull();
    expect(final.pendingLeaveEntities).toHaveLength(0);
  });
});
