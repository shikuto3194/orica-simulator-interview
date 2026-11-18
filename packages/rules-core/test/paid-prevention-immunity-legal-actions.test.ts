/**
 * ENGINE-bsge01-r04-paid-prevention-immunity Step 2:
 * `grant_paid_prevention_immunity` CE を持つ host が誘発効果を発揮宣言したあと、
 * スタック窓後・対象選択前の pendingStepChoice で「対価 (countValue) を支払って
 * unpreventable にする」選択を提示し、実際に適用すると相手の cannot_be_destroyed
 * 耐性を貫通することを検証する。
 * BSGE01-R02/R04【毒牙／呪縛：モルター】の土台。
 */
import { describe, expect, it } from "vitest";
import type { LegalAction } from "../src/index";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import {
  playSummonAsAction,
  getLegalActions,
  applyLegalAction,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

const ALICE = "alice";
const BOB = "bob";

const HOST_DEF: CardDefinition = {
  cardNo: "PPI-HOST",
  name: "Paid Prevention Host",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  // BSGE01-R04 と同じく「神喰」を持つ想定（保護カウントの床テストで使用）。
  tribe: "神喰・GE・1G",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "grant_paid_prevention_immunity",
            target: { kind: "self" },
            cost: { resource: "count", amount: 1 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    },
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    },
  ],
} as unknown as CardDefinition;

const ENEMY_DEF: CardDefinition = {
  cardNo: "PPI-ENEMY",
  name: "Enemy Spirit",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as unknown as CardDefinition;

const COUNT_DECREASE_LISTENER_DEF: CardDefinition = {
  cardNo: "PPI-COUNT-DECREASE-LISTENER",
  name: "Count Decrease Listener",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "game_event", event: "count_decrease", player: "self" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const DEFS = [HOST_DEF, ENEMY_DEF, COUNT_DECREASE_LISTENER_DEF];
const cardNoMap = new Map(DEFS.map((d) => [d.cardNo, d]));
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(DEFS);
type ResolvePendingTriggeredEffectAction = Extract<
  LegalAction,
  { kind: "resolve_pending_triggered_effect" }
>;
type ResolvePendingStepChoiceAction = Extract<
  LegalAction,
  { kind: "resolve_pending_step_choice" }
>;

/** 相手起因の cannot_be_destroyed 耐性 CE を対象 instance に直接付与する。 */
function cannotBeDestroyedCE(
  targetInstanceId: string,
  ownerPlayerId: string
): ContinuousEffect {
  return {
    effectId: `test-cannot_be_destroyed-${targetInstanceId}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

/** 誘発効果宣言のスタック窓を相手 pass で閉じ、解決まで進める。 */
function passOpponentToCloseTriggeredStack(state: GameState): GameState {
  if (state.window !== "stack" || !state.stackWindow) {
    return state;
  }
  const opponentId = state.stackWindow.priorityPlayerId;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${opponentId}`,
      can: true,
      reason: "test_close",
      actingPlayerId: opponentId,
    },
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

/**
 * スタック窓クローズ後の対象選択 (destroy target: opponent filter, count 1) を
 * enemy-1 で確定する。対象選択が発生しない場合は no-op。
 */
function resolveEnemyTargetIfPending(state: GameState): GameState {
  if (!state.pendingEffectTargetSelection) return state;
  const resolveTarget = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).find((a) => a.kind === "resolve_pending_effect_target");
  if (!resolveTarget) return state;
  return applyLegalAction({
    state,
    action: resolveTarget,
    targetInstanceIds: ["enemy-1"],
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function makeBaseState(
  hostCountValue: number,
  protectedCounts?: Record<string, number>,
  includeCountDecreaseListener = false
): GameState {
  const cardInstances = [
    createCardInstance(HOST_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    }),
    createCardInstance(ENEMY_DEF, {
      instanceId: "enemy-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    }),
  ];
  if (includeCountDecreaseListener) {
    cardInstances.push(
      createCardInstance(COUNT_DECREASE_LISTENER_DEF, {
        instanceId: "count-listener-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      })
    );
  }
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [
      {
        reserveNormalCoreCount: 3,
        countValue: hostCountValue,
        ...(protectedCounts ? { protectedCounts } : {}),
      },
      {},
    ],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      cannotBeDestroyedCE("enemy-1", BOB),
    ],
  };
}

function summonHost(state: GameState): GameState {
  return playSummonAsAction({
    state,
    actingPlayerId: ALICE,
    cardInstanceId: "host-1",
    paymentSources: [{ kind: "reserve", amount: 2 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function getSummonResolveActions(
  state: GameState
): ResolvePendingTriggeredEffectAction[] {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).filter(
    (a): a is ResolvePendingTriggeredEffectAction =>
      a.kind === "resolve_pending_triggered_effect" && a.eventKind === "summon"
  );
}

function declareBaseSummonEffect(state: GameState): GameState {
  const baseAction = getSummonResolveActions(state).find(
    (a) => a.payPreventionImmunityCost !== true
  );
  expect(baseAction).toBeDefined();
  return applyLegalAction({
    state,
    action: baseAction!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function getPendingStepChoiceActions(
  state: GameState
): ResolvePendingStepChoiceAction[] {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).filter(
    (a): a is ResolvePendingStepChoiceAction =>
      a.kind === "resolve_pending_step_choice"
  );
}

function resolvePaidModifierChoice(
  state: GameState,
  choiceIndex: number
): GameState {
  const action = getPendingStepChoiceActions(state).find(
    (a) => a.choiceIndex === choiceIndex
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function declareAndCloseStack(state: GameState): GameState {
  return passOpponentToCloseTriggeredStack(declareBaseSummonEffect(state));
}

describe("grant_paid_prevention_immunity — stack 後 step choice 対価支払い", () => {
  it("countValue が対価以上あるとき、宣言 action は1件だけで、stack 後に支払い choice が提示される", () => {
    const summoned = summonHost(makeBaseState(1));
    const resolveActions = getSummonResolveActions(summoned);

    expect(resolveActions.length).toBe(1);
    expect(resolveActions[0]!.payPreventionImmunityCost).not.toBe(true);

    const afterStack = declareAndCloseStack(summoned);
    expect(afterStack.pendingStepChoice).toMatchObject({
      sourceDefinitionId: "PPI-HOST",
      paidEffectModifierChoice: {
        kind: "paid_prevention_immunity",
        cost: { resource: "count", amount: 1 },
        sourceInstanceId: "host-1",
        sourceDefinitionId: "PPI-HOST",
      },
    });
    expect(
      getPendingStepChoiceActions(afterStack).map((a) => a.choiceLabel)
    ).toEqual(["支払わない", "支払う"]);
  });

  it("countValue が不足しているとき、支払い choice は提示されない", () => {
    const afterStack = declareAndCloseStack(summonHost(makeBaseState(0)));
    expect(afterStack.pendingStepChoice).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
  });

  it("countValue が host 自身の系統 (神喰) の保護カウントのみのとき、支払い choice が提示され実際に減算される", () => {
    const afterStack = declareAndCloseStack(
      summonHost(makeBaseState(1, { 神喰: 1 }))
    );
    expect(
      afterStack.pendingStepChoice?.paidEffectModifierChoice
    ).toMatchObject({ kind: "paid_prevention_immunity" });

    const afterChoice = resolvePaidModifierChoice(afterStack, 1);
    const alice = afterChoice.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
  });

  it("countValue が host 自身の系統ではない保護カウントのみのとき、支払い choice は提示されない", () => {
    const afterStack = declareAndCloseStack(
      summonHost(makeBaseState(1, { 幻想: 1 }))
    );
    expect(afterStack.pendingStepChoice).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
  });

  it("支払いの count_decrease は対象選択前に誘発せず、元効果の解決完了時に同じ誘発束へ合流する", () => {
    const afterStack = declareAndCloseStack(
      summonHost(makeBaseState(1, undefined, true))
    );
    const afterChoice = resolvePaidModifierChoice(afterStack, 1);

    expect(
      afterChoice.pendingTriggeredEffects.some(
        (pending) => pending.eventKind === "count_decrease"
      )
    ).toBe(false);
    expect(afterChoice.pendingEffectTargetSelection).not.toBeNull();

    const drained = resolveEnemyTargetIfPending(afterChoice);
    const countDecreaseTriggers = drained.pendingTriggeredEffects.filter(
      (pending) => pending.eventKind === "count_decrease"
    );
    expect(countDecreaseTriggers).toHaveLength(1);
    expect(countDecreaseTriggers[0]).toMatchObject({
      relatedPlayerId: ALICE,
      relatedInstanceId: "host-1",
      amount: 1,
    });
  });

  it("支払う choice を適用すると countValue が減り、cannot_be_destroyed を貫通して破壊される", () => {
    const afterStack = declareAndCloseStack(summonHost(makeBaseState(1)));
    const afterChoice = resolvePaidModifierChoice(afterStack, 1);
    const drained = resolveEnemyTargetIfPending(afterChoice);

    const alice = drained.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    const enemyLeftField =
      !enemy ||
      enemy.zone !== "field" ||
      drained.pendingLeaveEntities.some(
        (e) => e.instanceId === "enemy-1" && !e.blockedByResistance
      );
    expect(enemyLeftField).toBe(true);
  });

  it("支払わない choice を適用すると cannot_be_destroyed に阻まれ相手は残存する", () => {
    const afterStack = declareAndCloseStack(summonHost(makeBaseState(1)));
    const afterChoice = resolvePaidModifierChoice(afterStack, 0);
    const drained = resolveEnemyTargetIfPending(afterChoice);

    const alice = drained.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(1);
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.zone).toBe("field");
  });
});
