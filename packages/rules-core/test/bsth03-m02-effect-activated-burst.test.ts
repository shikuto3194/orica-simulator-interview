/**
 * BSTH03-M02 [永夜抄]八雲 紫 —
 *   【バースト：相手の『このスピリット/アルティメットの召喚時』発揮後】
 *
 * effect[0] は effect_activated burst (activatedTimings:["summon"] +
 * triggerFilter:{ category:["spirit","ultimate"] })。相手が「スピリット/アルティメット
 * の召喚時」効果を発揮し終えた直後に alice の M02 バーストチェックが積まれることを
 * 実カードで確認する（旧 stub 注記「バースト条件: 相手の召喚時効果発揮後。」の解消検証）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/runtime";
import type { CardDefinition, GameState, LegalAction } from "../src/runtime";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const m02 = card("BSTH03-M02");

// bob 側の「召喚時」発揮役（count_decrease を持つ汎用テストカード）。
const activatorCard: CardDefinition = {
  cardNo: "M02-TEST-ACTIVATOR",
  name: "召喚時持ちスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      applicability: { zone: "field" },
      steps: [
        { action: { kind: "count_decrease", player: "self", amount: 1 } },
      ],
    },
  ],
};

const TEST_CARDS = [activatorCard, m02];
const lookupMap = new Map(TEST_CARDS.map((c) => [c.cardNo, c]));
const getDef = (id: string) => lookupMap.get(id) ?? getCardDefinitionById(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(TEST_CARDS),
};

function buildScenario(): GameState {
  const activator = createCardInstance(activatorCard, {
    instanceId: "activator-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const m02Burst = createCardInstance(m02, {
    instanceId: "m02-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{}, { countValue: 5 }],
  });
  return {
    ...base,
    activePlayerId: "bob",
    step: "main",
    cardInstances: [activator, m02Burst],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "m02-1" }],
    pendingTriggeredEffects: [
      {
        pendingId: "activation-pending-1",
        eventKind: "summon",
        actingPlayerId: "bob",
        source: "action_resolution",
        chainId: "test:bsth03-m02-effect-activated-burst:103",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "activator-1",
        amount: null,
        step: "main",
        window: "default",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}

function findDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "resolve_pending_triggered_effect" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: getDef,
    ...effectLookups,
  });
  const action = actions.find(
    (
      a
    ): a is Extract<
      LegalAction,
      { kind: "resolve_pending_triggered_effect" }
    > =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === "activator-1"
  );
  if (!action) throw new Error("expected resolve_pending_triggered_effect");
  return action;
}

function passUntilStackClosed(state: GameState): GameState {
  let cur = state;
  for (let i = 0; i < 12 && cur.stackWindow !== null; i++) {
    const priority = cur.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: cur,
      actingPlayerId: priority,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    const pass = actions.find((a) => a.kind === "pass_stack");
    if (!pass) break;
    cur = applyLegalAction({
      state: cur,
      action: pass,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
  }
  return cur;
}

describe("BSTH03-M02 八雲 紫 — effect_activated バースト", () => {
  it("構造: effect[0] は effect_activated burst (summon / spirit・ultimate filter)・stub なし", () => {
    const burst = m02.effects![0]!;
    expect(burst.stub).toBeUndefined();
    expect(burst.timing.kind).toBe("burst");
    if (burst.timing.kind === "burst") {
      expect(burst.timing.trigger).toMatchObject({
        kind: "effect_activated",
        player: "opponent",
        activatedTimings: ["summon"],
      });
      expect(burst.timing.triggerFilter).toEqual({
        category: ["spirit", "ultimate"],
      });
    }
    const coreMove = burst.steps[0]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.from).toEqual({ kind: "void", player: "self" });
      expect(coreMove.to).toEqual({ kind: "reserve", player: "self" });
      expect(coreMove.amount).toBe(2);
    }
    const summonStep = burst.steps[1]!;
    expect(summonStep.connector).toBe("sequential");
    expect(summonStep.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
  });

  it("相手の召喚時効果発揮後、alice の M02 バーストチェックが積まれる", () => {
    const initial = buildScenario();
    const decl = findDeclaration(initial);
    const declared = applyLegalAction({
      state: initial,
      action: decl,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    const resolved = passUntilStackClosed(declared.state);
    const activationChecks = resolved.pendingBurstChecks.filter(
      (c) => c.eventKind === "effect_activated"
    );
    expect(activationChecks).toHaveLength(1);
    expect(activationChecks[0]!.actingPlayerId).toBe("alice");
    expect(activationChecks[0]!.relatedPlayerId).toBe("bob");
    expect(activationChecks[0]!.relatedInstanceId).toBe("activator-1");
  });

  it("[board] アタック時バウンスは毎回発揮し、カウント2以上の回復だけが個体ごとターン1回", () => {
    const bounceEffect = m02.effects![1]!;
    const recoverEffect = m02.effects![2]!;
    // 原文の「ターンに1回」は後段の「このアルティメットは回復する」にだけ掛かる。
    // 親 effect へ昇格すると、本文にないバウンス回数制限を加えてしまう。
    expect(bounceEffect.usageLimit).toBeUndefined();
    expect(recoverEffect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });

    const source = createCardInstance(m02, {
      instanceId: "m02-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv3
      exhaustState: "exhausted",
    });
    const firstTarget = createCardInstance(activatorCard, {
      instanceId: "bounce-target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const secondTarget = createCardInstance(activatorCard, {
      instanceId: "bounce-target-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 7,
      cardInstances: [source, firstTarget, secondTarget],
    };

    const afterFirstBouncePending = executeEffect({
      chainId: "test:bsth03-m02-effect-activated-burst:260",
      state: before,
      effect: bounceEffect,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: [firstTarget.instanceId],
    });
    const afterFirstBounce = flushPendingLeaves(
      afterFirstBouncePending,
      getDef
    );
    const afterSecondBouncePending = executeEffect({
      chainId: "test:bsth03-m02-effect-activated-burst:273",
      state: afterFirstBounce,
      effect: bounceEffect,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: [secondTarget.instanceId],
    });
    const afterSecondBounce = flushPendingLeaves(
      afterSecondBouncePending,
      getDef
    );
    expect(
      afterSecondBounce.cardInstances.find(
        (instance) => instance.instanceId === firstTarget.instanceId
      )!.zone
    ).toBe("hand");
    expect(
      afterSecondBounce.cardInstances.find(
        (instance) => instance.instanceId === secondTarget.instanceId
      )!.zone
    ).toBe("hand");

    const afterRecover = executeEffect({
      chainId: "test:bsth03-m02-effect-activated-burst:297",
      state: afterSecondBounce,
      effect: recoverEffect,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(
      afterRecover.cardInstances.find(
        (instance) => instance.instanceId === source.instanceId
      )!.exhaustState
    ).toBe("recovered");

    // 宣言時に記録される effect:2 の個体ターン制限だけが、次の回復を止める。
    // effect:1（バウンス）には使用記録が無く、同一ターンに別対象へ再発揮できる。
    const afterUsage = recordEffectUsageIfLimited({
      state: afterRecover,
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: m02.cardNo,
      playerId: "alice",
      effectLabel: "effect:2",
      usageLimit: recoverEffect.usageLimit,
    });
    expect(
      canUseEffectByUsageLimit({
        state: afterUsage,
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: m02.cardNo,
        playerId: "alice",
        effectLabel: "effect:2",
        usageLimit: recoverEffect.usageLimit,
      })
    ).toBe(false);
    expect(
      afterUsage.effectUsageRecords.some(
        (record) => record.effectLabel === "effect:1"
      )
    ).toBe(false);
  });
});
