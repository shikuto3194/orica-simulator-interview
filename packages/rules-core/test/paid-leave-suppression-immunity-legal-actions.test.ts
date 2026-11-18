/**
 * engine-generic-effect-activation-causal-trigger cluster Step5:
 * `grant_paid_leave_suppression_immunity` CE を持つ host が誘発効果を発揮宣言したあと、
 * スタック窓後・対象選択前の pendingStepChoice で「対価 (countValue) を支払って、
 * それによってフィールドを離れるカードの離脱誘発効果 (destroy/vanish) を抑制する」
 * 選択を提示し、実際に適用すると相手の「破壊されたとき」誘発効果が発揮されなくなることを検証する。
 * BSGE01-R02【毒牙：モルター】の土台
 * (paid-prevention-immunity-legal-actions.test.ts と対の構造)。
 */
import { describe, expect, it } from "vitest";
import type { LegalAction } from "../src/index";
import type { CardDefinition, GameState } from "../src/model";
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
  cardNo: "PLS-HOST",
  name: "Paid Leave Suppression Host",
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
  tribe: "神喰・GE・1G",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "grant_paid_leave_suppression_immunity",
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
  cardNo: "PLS-ENEMY",
  name: "Enemy Spirit With Destroy Trigger",
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
  effects: [
    {
      timing: { kind: "card_event", event: "destroy" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const DEFS = [HOST_DEF, ENEMY_DEF];
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

function makeBaseState(hostCountValue: number): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
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
    ],
    playerOverrides: [
      { reserveNormalCoreCount: 3, countValue: hostCountValue },
      {},
    ],
  });
  return { ...base, step: "main", activePlayerId: ALICE };
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

/** enemy-1 の「破壊されたとき」誘発効果が pending として残っているか。 */
function hasEnemyDestroyTrigger(state: GameState): boolean {
  return state.pendingTriggeredEffects.some(
    (p) => p.eventKind === "destroy" && p.relatedInstanceId === "enemy-1"
  );
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
    (a) => a.payLeaveSuppressionCost !== true
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

describe("grant_paid_leave_suppression_immunity — stack 後 step choice 対価支払い", () => {
  it("countValue が対価以上あるとき、宣言 action は1件だけで、stack 後に支払い choice が提示される", () => {
    const summoned = summonHost(makeBaseState(1));
    const resolveActions = getSummonResolveActions(summoned);

    expect(resolveActions.length).toBe(1);
    expect(resolveActions[0]!.payLeaveSuppressionCost).not.toBe(true);

    const afterStack = declareAndCloseStack(summoned);
    expect(afterStack.pendingStepChoice).toMatchObject({
      sourceDefinitionId: "PLS-HOST",
      paidEffectModifierChoice: {
        kind: "paid_leave_suppression",
        cost: { resource: "count", amount: 1 },
        sourceInstanceId: "host-1",
        sourceDefinitionId: "PLS-HOST",
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

  it("支払う choice を適用すると countValue が減り、破壊された enemy の「破壊されたとき」誘発効果は発揮されない", () => {
    const afterStack = declareAndCloseStack(summonHost(makeBaseState(1)));
    const afterChoice = resolvePaidModifierChoice(afterStack, 1);
    const drained = resolveEnemyTargetIfPending(afterChoice);

    const alice = drained.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.zone).not.toBe("field");
    expect(hasEnemyDestroyTrigger(drained)).toBe(false);
  });

  it("支払わない choice を適用すると破壊された enemy の「破壊されたとき」誘発効果が発揮される", () => {
    const afterStack = declareAndCloseStack(summonHost(makeBaseState(1)));
    const afterChoice = resolvePaidModifierChoice(afterStack, 0);
    const drained = resolveEnemyTargetIfPending(afterChoice);

    const alice = drained.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(1);
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.zone).toBe("field");
    expect(enemy?.pendingLeaveKind).toBe("destroy");
    expect(hasEnemyDestroyTrigger(drained)).toBe(true);
  });
});

// 敵対的検証 (Step5 verifier round1) で発見: executeSuppressPendingLeaveEffects は
// 当初 kind==="destroy" のみを対象にしており、カード原文「フィールドを離れる…効果は
// 発揮されない」が本来含む vanish 由来の離脱誘発効果を見逃していた。回帰防止のため
// vanish 経由の抑制も直接検証する。
const VANISH_HOST_DEF: CardDefinition = {
  cardNo: "PLS-HOST-VANISH",
  name: "Paid Leave Suppression Host (vanish)",
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
  tribe: "神喰・GE・1G",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "grant_paid_leave_suppression_immunity",
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
            kind: "vanish",
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

const VANISH_ENEMY_DEF: CardDefinition = {
  cardNo: "PLS-ENEMY-VANISH",
  name: "Enemy Spirit With Vanish Trigger",
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
  effects: [
    {
      timing: { kind: "card_event", event: "vanish" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

const VANISH_DEFS = [VANISH_HOST_DEF, VANISH_ENEMY_DEF];
const vanishCardNoMap = new Map(VANISH_DEFS.map((d) => [d.cardNo, d]));
const getVanishDef = (id: string): CardDefinition | undefined =>
  vanishCardNoMap.get(id);
const vanishTriggeredLookup = buildTriggeredEffectLookup(VANISH_DEFS);

function makeVanishBaseState(hostCountValue: number): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(VANISH_HOST_DEF, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
      createCardInstance(VANISH_ENEMY_DEF, {
        instanceId: "enemy-1",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
    playerOverrides: [
      { reserveNormalCoreCount: 3, countValue: hostCountValue },
      {},
    ],
  });
  return { ...base, step: "main", activePlayerId: ALICE };
}

function summonVanishHost(state: GameState): GameState {
  return playSummonAsAction({
    state,
    actingPlayerId: ALICE,
    cardInstanceId: "host-1",
    paymentSources: [{ kind: "reserve", amount: 2 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).state;
}

function passOpponentToCloseVanishStack(state: GameState): GameState {
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
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).state;
}

function resolveVanishEnemyTargetIfPending(state: GameState): GameState {
  if (!state.pendingEffectTargetSelection) return state;
  const resolveTarget = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).find((a) => a.kind === "resolve_pending_effect_target");
  if (!resolveTarget) return state;
  return applyLegalAction({
    state,
    action: resolveTarget,
    targetInstanceIds: ["enemy-1"],
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).state;
}

function hasEnemyVanishTrigger(state: GameState): boolean {
  return state.pendingTriggeredEffects.some(
    (p) => p.eventKind === "vanish" && p.relatedInstanceId === "enemy-1"
  );
}

function getVanishSummonResolveActions(
  state: GameState
): ResolvePendingTriggeredEffectAction[] {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).filter(
    (a): a is ResolvePendingTriggeredEffectAction =>
      a.kind === "resolve_pending_triggered_effect" && a.eventKind === "summon"
  );
}

function declareBaseVanishSummonEffect(state: GameState): GameState {
  const baseAction = getVanishSummonResolveActions(state).find(
    (a) => a.payLeaveSuppressionCost !== true
  );
  expect(baseAction).toBeDefined();
  return applyLegalAction({
    state,
    action: baseAction!,
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).state;
}

function getVanishPendingStepChoiceActions(
  state: GameState
): ResolvePendingStepChoiceAction[] {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).filter(
    (a): a is ResolvePendingStepChoiceAction =>
      a.kind === "resolve_pending_step_choice"
  );
}

function resolveVanishPaidModifierChoice(
  state: GameState,
  choiceIndex: number
): GameState {
  const action = getVanishPendingStepChoiceActions(state).find(
    (a) => a.choiceIndex === choiceIndex
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getVanishDef,
    getRegisteredTriggeredEffectActions: vanishTriggeredLookup,
  }).state;
}

function declareAndCloseVanishStack(state: GameState): GameState {
  return passOpponentToCloseVanishStack(declareBaseVanishSummonEffect(state));
}

describe("grant_paid_leave_suppression_immunity — vanish 経由の離脱誘発効果も抑制する", () => {
  it("支払う choice を適用すると、消滅した enemy の「消滅したとき」誘発効果は発揮されない", () => {
    const afterStack = declareAndCloseVanishStack(
      summonVanishHost(makeVanishBaseState(1))
    );
    const afterChoice = resolveVanishPaidModifierChoice(afterStack, 1);
    const drained = resolveVanishEnemyTargetIfPending(afterChoice);

    const alice = drained.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.zone).not.toBe("field");
    expect(hasEnemyVanishTrigger(drained)).toBe(false);
  });

  it("支払わない choice を適用すると、消滅した enemy の「消滅したとき」誘発効果が発揮される", () => {
    const afterStack = declareAndCloseVanishStack(
      summonVanishHost(makeVanishBaseState(1))
    );
    const afterChoice = resolveVanishPaidModifierChoice(afterStack, 0);
    const drained = resolveVanishEnemyTargetIfPending(afterChoice);

    const alice = drained.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(1);
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    expect(enemy?.zone).toBe("field");
    expect(enemy?.pendingLeaveKind).toBe("vanish");
    expect(hasEnemyVanishTrigger(drained)).toBe(true);
  });
});
