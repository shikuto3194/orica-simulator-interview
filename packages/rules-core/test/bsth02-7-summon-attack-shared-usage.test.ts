/**
 * 『召喚/アタック時』〔ターンに1回:同名〕型の使用回数共有検証（データ構造レベル）。
 *
 * 「召喚/アタック時」の単一効果を summon / attack の 2 つの別 effect に分けて表現すると、
 * usageLimit の effectLabel が `effect:${effectIndex}` で異なり（effect:1 vs effect:2）、
 * 「ターンに1回」が summon で1回・attack で1回の計2回使えてしまう
 * （legal-actions-shared.ts getStableEffectLabel: triggered / battle_immediate 両系統で
 *  同一 effectIndex なら usageLimit を共有する）。
 *
 * 正しくは単一 effect の `event: ["summon", "attack"]` で表現する（summon は triggered、
 * attack(自カードの『アタック時』) は battle-immediate 系統に登録されるが、同一 effectIndex の
 * ため getStableEffectLabel が同一ラベルを返し usageLimit が共有される）。
 * BSTS01-M01[7,8] と同じ event 配列パターン。
 *
 * 本テストは BSTH02.7-M01 / BSTH02.7-X03 の重複 effect 統合（2026-06-14）が、
 * summon-only + attack-only の重複ではなく単一 event 配列効果になっていることを保証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  executeEffectResistance,
  getLegalActions,
  recordEffectUsage,
  withSoulCoreLocation,
} from "../src/runtime";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import { getCombinedUnitBp } from "../src/battle/battle-shared";
import {
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
} from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src/runtime";

const X03_DESTROY_TRIGGER_CARD: CardDefinition = {
  cardNo: "TEST-X03-DESTROY-TRIGGER",
  name: "X03 破壊時誘発テストスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "destroy" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};

const X03_HIGH_BP_DESTROY_TRIGGER_CARD: CardDefinition = {
  ...X03_DESTROY_TRIGGER_CARD,
  cardNo: "TEST-X03-HIGH-BP-DESTROY-TRIGGER",
  name: "X03 高BP破壊時誘発テストスピリット",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 20000 }],
};

const X03_DESTROY_WATCHER_CARD: CardDefinition = {
  ...X03_DESTROY_TRIGGER_CARD,
  cardNo: "TEST-X03-DESTROY-WATCHER",
  name: "X03 破壊監視誘発テストスピリット",
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: "destroy",
        triggerFilter: { category: ["spirit"] },
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};

const X03_LEAVE_WATCHER_CARD: CardDefinition = {
  ...X03_DESTROY_TRIGGER_CARD,
  cardNo: "TEST-X03-LEAVE-WATCHER",
  name: "X03 離脱監視誘発テストスピリット",
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: "leave_field",
        exactEventKind: true,
        triggerFilter: { category: ["spirit"] },
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};

const X03_NON_GUIDED_NEXUS_CARD: CardDefinition = {
  cardNo: "TEST-X03-NON-GUIDED-NEXUS",
  name: "X03 非導界者ネクサステスト",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const TEST_CARDS = [
  ...ALL_CARDS,
  X03_DESTROY_TRIGGER_CARD,
  X03_HIGH_BP_DESTROY_TRIGGER_CARD,
  X03_DESTROY_WATCHER_CARD,
  X03_LEAVE_WATCHER_CARD,
  X03_NON_GUIDED_NEXUS_CARD,
];
const cardNoMap = new Map<string, CardDefinition>(
  TEST_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

/** timing.event を配列に正規化する（単数指定も配列に揃える）。 */
function eventsOf(effect: CardDefinition["effects"][number]): string[] {
  const t = effect.timing;
  if (t.kind !== "card_event") return [];
  return Array.isArray(t.event) ? [...t.event] : [t.event];
}

const ALICE = "alice";
const BOB = "bob";
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(TEST_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
};

function resolveStepOptional(
  state: GameState,
  choice: "execute" | "decline"
): GameState {
  const pending = state.pendingStepOptionalChoice;
  if (!pending) throw new Error("pendingStepOptionalChoice not found");
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_step_optional_choice",
      actionId: `pso-${pending.pendingId}:${choice}`,
      can: true,
      reason: "test",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      effectIndex: pending.effectIndex,
      stepIndex: pending.stepIndex,
      choice,
    },
    ...lookups,
  }).state;
}

function resolveCoreSourceAllocation(
  state: GameState,
  allocations: Record<string, number>,
  soulCoreSourceInstanceId?: string
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    ...lookups,
  }).find((a) => a.kind === "resolve_core_source_allocation");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    coreSourceAllocations: allocations,
    ...(soulCoreSourceInstanceId !== undefined
      ? { coreSourceSoulCoreInstanceId: soulCoreSourceInstanceId }
      : {}),
    ...lookups,
  }).state;
}

function resolveTriggeredForRelatedInstance(
  state: GameState,
  relatedInstanceId: string
): GameState {
  const pending = state.pendingTriggeredEffects.find(
    (entry) => entry.relatedInstanceId === relatedInstanceId
  );
  expect(pending).toBeDefined();
  const selectAction = getLegalActions({
    state,
    actingPlayerId: ALICE,
    ...lookups,
  }).find(
    (action) =>
      action.kind === "select_pending_to_resolve" &&
      action.pendingId === pending!.pendingId
  );
  const selected = selectAction
    ? applyLegalAction({
        state,
        action: selectAction,
        ...lookups,
      }).state
    : state;
  const resolveAction = getLegalActions({
    state: selected,
    actingPlayerId: BOB,
    ...lookups,
  }).find(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      action.pendingId === pending!.pendingId
  );
  expect(resolveAction).toBeDefined();
  const declared = applyLegalAction({
    state: selected,
    action: resolveAction!,
    ...lookups,
  }).state;
  let current = declared;
  for (let i = 0; i < 8 && current.stackWindow !== null; i++) {
    const passAction = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow.priorityPlayerId,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    if (!passAction) break;
    current = applyLegalAction({
      state: current,
      action: passAction,
      ...lookups,
    }).state;
  }
  return current;
}

function x03BpEffect(): {
  effect: NonNullable<CardDefinition["effects"]>[number];
  effectIndex: number;
} {
  const def = card("BSTH02.7-X03");
  const effectIndex = (def.effects ?? []).findIndex((e) => {
    const ev = eventsOf(e);
    return (
      ev.includes("summon") &&
      ev.includes("attack") &&
      e.usageLimit?.kind === "per_card_name"
    );
  });
  if (effectIndex < 0) throw new Error("BSTH02.7-X03 BP effect not found");
  return { effect: def.effects![effectIndex]!, effectIndex };
}

function startX03BpEffect(
  state: GameState,
  targetInstanceIds: string[],
  choiceIndex = 0
): GameState {
  const { effect, effectIndex } = x03BpEffect();
  return executeEffect({
    chainId: "test:bsth02-7-summon-attack-shared-usage:286",
    state,
    effect,
    effectIndex,
    sourceInstanceId: "x03",
    actingPlayerId: ALICE,
    targetInstanceIds,
    choiceIndex,
    ...lookups,
  });
}

function executeX03BpStep(
  state: GameState,
  targetInstanceIds: string[],
  choiceIndex = 0
): GameState {
  return resolveStepOptional(
    startX03BpEffect(state, targetInstanceIds, choiceIndex),
    "execute"
  );
}

function x03Board(enemyCardNo = "TEST-X03-DESTROY-TRIGGER"): GameState {
  const x03 = card("BSTH02.7-X03");
  const guided = card("BSTH02.7-CX01");
  const enemyDef = card(enemyCardNo);
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [{ countValue: 1 }, {}],
    cardInstances: [
      createCardInstance(x03, {
        instanceId: "x03",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(guided, {
        instanceId: "guided",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(enemyDef, {
        instanceId: "enemy-a",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(enemyDef, {
        instanceId: "enemy-b",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
}

function grantCannotLeaveField(
  state: GameState,
  instanceId: string
): GameState {
  return executeEffectResistance(
    state,
    BOB,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_leave_field",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    instanceId,
    getCardDefinitionById
  );
}

function grantCannotBeDestroyed(
  state: GameState,
  instanceId: string
): GameState {
  return executeEffectResistance(
    state,
    BOB,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_be_destroyed",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    instanceId,
    getCardDefinitionById
  );
}

function queueX03AttackEffectIndices(state: GameState): readonly number[] {
  const def = card("BSTH02.7-X03");
  const sourceCard = state.cardInstances.find((c) => c.instanceId === "x03")!;
  const result = queueRegisteredBattleImmediateEffects({
    state: { ...state, step: "attack", activePlayerId: ALICE, turnNumber: 2 },
    attackId: "attack-group:2:alice:battle-entity:x03",
    participantEntityId: "battle-entity:x03",
    actingPlayerId: ALICE,
    sourceCard,
    sourceDefinition: def,
    timing: "attack",
    ...lookups,
  });
  const registrations = lookups.getRegisteredBattleImmediateEffectActions(
    def.cardNo
  )!;
  return result.battleImmediateEffects.map(
    (prompt) => registrations[prompt.registrationIndex]!.effectIndex!
  );
}

describe("『召喚/アタック時』効果は単一 event 配列で usageLimit を共有する", () => {
  it("BSTH02.7-M01: 召喚/アタック時の send_to_deck は単一 event:[summon,attack] 効果", () => {
    const def = card("BSTH02.7-M01");
    const effects = def.effects ?? [];

    // summon と attack を両方含む単一効果がちょうど 1 つ。
    const merged = effects.filter((e) => {
      const ev = eventsOf(e);
      return ev.includes("summon") && ev.includes("attack");
    });
    expect(merged).toHaveLength(1);
    // ターンに1回:同名 を持ち、stub 注記が消えている。
    expect(merged[0]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(merged[0]!.stub).toBeUndefined();

    // attack-only / summon-only の重複が残っていない。
    const attackOnly = effects.filter((e) => {
      const ev = eventsOf(e);
      return ev.length === 1 && ev[0] === "attack";
    });
    expect(attackOnly).toHaveLength(0);
  });

  it("BSTH02.7-X03: BP-10000 / ボイド→ライフ はそれぞれ単一 event:[summon,attack] 効果（attack-only 重複なし）", () => {
    const def = card("BSTH02.7-X03");
    const effects = def.effects ?? [];

    const merged = effects.filter((e) => {
      const ev = eventsOf(e);
      return ev.includes("summon") && ev.includes("attack");
    });
    // 召喚/アタック時の効果は 2 つ（BP-10000、ボイド→ライフ）。
    expect(merged).toHaveLength(2);

    // attack-only 重複（旧バグ表現）が残っていない。
    const attackOnly = effects.filter((e) => {
      const ev = eventsOf(e);
      return ev.length === 1 && ev[0] === "attack";
    });
    expect(attackOnly).toHaveLength(0);
  });

  it("BSTH02.7: branch 内の既存変更カードを直接参照し、set-level coverage 対象から漏らさない", () => {
    const existingChangedCardNos = [
      "BSTH02.7-C01",
      "BSTH02.7-C03",
      "BSTH02.7-C04",
      "BSTH02.7-C05",
      "BSTH02.7-C06",
      "BSTH02.7-R01",
      "BSTH02.7-X01",
    ];

    for (const cardNo of existingChangedCardNos) {
      const def = card(cardNo);
      expect(def.cardNo).toBe(cardNo);
      expect(def.effects?.length ?? 0).toBeGreaterThan(0);
      expect(
        (def.effects ?? []).some(
          (effect) => effect.textRef !== undefined || effect.stub !== undefined
        )
      ).toBe(true);
    }
  });

  it("BSTH02.7-X03: BP効果は召喚時で使用済みなら同一ターンのアタック時 queue に載らない", () => {
    const { effectIndex } = x03BpEffect();
    const state = { ...x03Board(), step: "attack" as const, turnNumber: 2 };
    expect(queueX03AttackEffectIndices(state)).toContain(effectIndex);

    const afterSummonUsage: GameState = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: "x03",
        sourceDefinitionId: "BSTH02.7-X03",
        effectLabel: `effect:${effectIndex}`,
        duration: "turn",
      }),
    };
    expect(queueX03AttackEffectIndices(afterSummonUsage)).not.toContain(
      effectIndex
    );
  });

  it("BSTH02.7-X03: 界放BP効果は dynamic repeat と導界者コア抑止で stub なし", () => {
    const def = card("BSTH02.7-X03");
    const effect = (def.effects ?? []).find((e) => {
      const ev = eventsOf(e);
      return (
        ev.includes("summon") &&
        ev.includes("attack") &&
        e.usageLimit?.kind === "per_card_name"
      );
    });
    expect(effect).toBeDefined();
    expect(effect?.stub).toBeUndefined();

    const bpStep = effect!.steps[0]!;
    expect(bpStep.id).toBe("bp0");
    expect(bpStep.executionMode).toBe("optional");
    expect(bpStep.repeat).toEqual({
      additional: { source: { kind: "count_value", player: "self" } },
      optional: true,
    });

    const destroyBp0 = effect!.steps[1]!;
    expect(destroyBp0.id).toBe("destroy_bp0");
    expect(destroyBp0.executionMode).toBe("optional");
    expect(destroyBp0.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "bp0",
      result: "bp_became_zero",
      min: 1,
    });
    expect(destroyBp0.action).toMatchObject({
      kind: "destroy",
      target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
    });

    const guideChoice = effect!.steps[2]!;
    expect(guideChoice.id).toBe("guide_core");
    expect(guideChoice.executionMode).toBe("optional");
    expect(guideChoice.stepCondition).toBeUndefined();
    expect(guideChoice.action).toMatchObject({
      kind: "core_move",
      from: {
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          targetsGrandwalker: true,
          hasMechanic: ["guided"],
        },
      },
      to: { kind: "this_card" },
      amount: 1,
    });

    expect(effect!.steps[3]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "guide_core",
    });
    expect(effect!.steps[3]!.action).toMatchObject({
      kind: "suppress_pending_leave_effects",
      target: { kind: "ref", stepId: "destroy_bp0" },
      suppressDestroyedEffects: "destroyed_only",
    });
  });

  for (const count of [0, 1, 2]) {
    it(`[board] BSTH02.7-X03: N=${count}で基本1回+カウント分のBP修正を完走する`, () => {
      const base = x03Board("TEST-X03-HIGH-BP-DESTROY-TRIGGER");
      const targetIds = ["enemy-a", "enemy-b", "enemy-c"];
      const state: GameState = {
        ...base,
        players: base.players.map((player) =>
          player.id === ALICE ? { ...player, countValue: count } : player
        ),
        cardInstances: [
          ...base.cardInstances,
          createCardInstance(card("TEST-X03-HIGH-BP-DESTROY-TRIGGER"), {
            instanceId: "enemy-c",
            ownerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      const afterBp = executeX03BpStep(
        state,
        targetIds.slice(0, 1 + count),
        count
      );
      // 3体ともBP20000で始まり、基本分と追加分はそれぞれ別の対象へBP-10000。
      // BP0がないので破壊分岐は開かず、後続の任意コア移動を辞退して完走する。
      expect(afterBp.pendingStepOptionalChoice?.stepIndex).toBe(2);
      const final = resolveStepOptional(afterBp, "decline");
      for (const [index, id] of targetIds.entries()) {
        const instance = final.cardInstances.find(
          (entry) => entry.instanceId === id
        )!;
        expect(instance.zone).toBe("field");
        expect(
          getCombinedUnitBp(
            final,
            instance,
            card(instance.definitionId),
            getCardDefinitionById
          )
        ).toBe(index < 1 + count ? 10000 : 20000);
      }
      expect(final.pendingStepOptionalChoice).toBeNull();
      expect(final.pendingCoreSourceAllocation).toBeNull();
      expect(final.pendingLeaveEntities).toEqual([]);
      expect(
        final.cardInstances.find((entry) => entry.instanceId === "guided")!
          .normalCoreCount
      ).toBe(1);
      expect(
        final.players.find((player) => player.id === ALICE)!.countValue
      ).toBe(count);
    });
  }

  it("[board] BSTH02.7-X03: count repeat で2体をBP0破壊し、導界者コア移動で破壊時効果を抑止する", () => {
    const pendingBp = startX03BpEffect(x03Board(), ["enemy-a", "enemy-b"], 1);
    expect(pendingBp.pendingStepOptionalChoice?.stepIndex).toBe(0); // bp0
    const afterBp = resolveStepOptional(pendingBp, "execute");
    expect(afterBp.pendingStepOptionalChoice?.stepIndex).toBe(1); // destroy_bp0

    const afterDestroy = resolveStepOptional(afterBp, "execute");
    expect(afterDestroy.pendingStepOptionalChoice?.stepIndex).toBe(2); // guide_core
    expect(
      afterDestroy.pendingLeaveEntities.map((p) => p.instanceId).sort()
    ).toEqual(["enemy-a", "enemy-b"]);
    expect(
      afterDestroy.pendingLeaveEntities.every(
        (p) => p.suppressDestroyedEffects === undefined
      )
    ).toBe(true);

    const afterGuideChoice = resolveStepOptional(afterDestroy, "execute");
    const afterGuideCore =
      afterGuideChoice.pendingCoreSourceAllocation !== null
        ? resolveCoreSourceAllocation(afterGuideChoice, { guided: 1 })
        : afterGuideChoice;
    expect(afterGuideCore.pendingStepOptionalChoice).toBeNull();
    expect(
      afterGuideCore.log.some((entry) =>
        entry.includes(
          "effect:suppress-pending-leave-effects:enemy-a,enemy-b:destroyed_only"
        )
      )
    ).toBe(true);
    expect(
      afterGuideCore.cardInstances
        .filter((c) => c.instanceId === "enemy-a" || c.instanceId === "enemy-b")
        .map((c) => c.zone)
    ).toEqual(["trash", "trash"]);
    expect(
      afterGuideCore.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "destroy"
      )
    ).toHaveLength(0);
    expect(
      afterGuideCore.log.filter((entry) =>
        entry.startsWith("trigger:effect-suppressed:")
      )
    ).toHaveLength(2);
    const guided = afterGuideCore.cardInstances.find(
      (c) => c.instanceId === "guided"
    )!;
    const x03 = afterGuideCore.cardInstances.find(
      (c) => c.instanceId === "x03"
    )!;
    expect(guided.normalCoreCount).toBe(0);
    expect(x03.normalCoreCount).toBe(2);
  });

  it("[board] BSTH02.7-X03: BP0にならなかった対象では破壊任意ステップを開かない", () => {
    const afterBp = executeX03BpStep(
      x03Board("TEST-X03-HIGH-BP-DESTROY-TRIGGER"),
      ["enemy-a"]
    );
    expect(afterBp.pendingStepOptionalChoice?.stepIndex).toBe(2); // guide_core
    expect(afterBp.pendingLeaveEntities).toHaveLength(0);
    expect(afterBp.pendingTriggeredEffects).toHaveLength(0);
  });

  it("[board] BSTH02.7-X03: BP-10000を実行しなくても導界者コア移動だけを選べる", () => {
    const pendingBp = startX03BpEffect(x03Board(), ["enemy-a"]);
    expect(pendingBp.pendingStepOptionalChoice?.stepIndex).toBe(0); // bp0

    const afterDeclineBp = resolveStepOptional(pendingBp, "decline");
    expect(afterDeclineBp.pendingStepOptionalChoice?.stepIndex).toBe(2); // guide_core
    expect(afterDeclineBp.pendingLeaveEntities).toHaveLength(0);

    const afterGuideChoice = resolveStepOptional(afterDeclineBp, "execute");
    const afterGuideCore =
      afterGuideChoice.pendingCoreSourceAllocation !== null
        ? resolveCoreSourceAllocation(afterGuideChoice, { guided: 1 })
        : afterGuideChoice;

    expect(
      afterGuideCore.cardInstances.find((c) => c.instanceId === "enemy-a")?.zone
    ).toBe("field");
    expect(
      afterGuideCore.cardInstances.find((c) => c.instanceId === "guided")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      afterGuideCore.cardInstances.find((c) => c.instanceId === "x03")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      afterGuideCore.log.some((entry) =>
        entry.includes("effect:suppress-pending-leave-effects")
      )
    ).toBe(false);
  });

  it("[board] BSTH02.7-X03: 導界者コア移動をしない場合は破壊時効果を抑止しない", () => {
    const afterBp = executeX03BpStep(x03Board(), ["enemy-a", "enemy-b"], 1);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const afterDeclineGuide = resolveStepOptional(afterDestroy, "decline");
    expect(afterDeclineGuide.pendingStepOptionalChoice).toBeNull();
    expect(
      afterDeclineGuide.log.some((entry) =>
        entry.includes("effect:suppress-pending-leave-effects")
      )
    ).toBe(false);
    expect(
      afterDeclineGuide.cardInstances
        .filter((c) => c.instanceId === "enemy-a" || c.instanceId === "enemy-b")
        .map((c) => c.zone)
    ).toEqual(["field", "field"]);
    expect(
      afterDeclineGuide.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "destroy"
      )
    ).toHaveLength(2);
    expect(
      afterDeclineGuide.pendingTriggeredEffects.every(
        (pending) => pending.suppressedSourceInstanceIds === undefined
      )
    ).toBe(true);
  });

  it("[board] BSTH02.7-X03: 導界者にソウルコアだけがある場合もコア移動して破壊時効果を抑止する", () => {
    const base = x03Board();
    const guideWithoutSoul: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "guided"
          ? { ...cardInstance, normalCoreCount: 0 }
          : cardInstance
      ),
    };
    const soulOnlyGuide = withSoulCoreLocation(guideWithoutSoul, ALICE, {
      kind: "card",
      instanceId: "guided",
    });
    const afterBp = executeX03BpStep(soulOnlyGuide, ["enemy-a"]);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const afterGuideChoice = resolveStepOptional(afterDestroy, "execute");
    const afterGuideCore =
      afterGuideChoice.pendingCoreSourceAllocation !== null
        ? resolveCoreSourceAllocation(afterGuideChoice, { guided: 1 })
        : afterGuideChoice;

    expect(
      afterGuideCore.players.find((player) => player.id === ALICE)!
        .soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "x03" });
    expect(
      afterGuideCore.log.some((entry) =>
        entry.startsWith("trigger:effect-suppressed:")
      )
    ).toBe(true);
  });

  it("[board] BSTH02.7-X03: 導界者に通常コアとソウルコアがある場合はソウルコアを選べる", () => {
    const base = x03Board();
    const guidedWithSoul = withSoulCoreLocation(base, ALICE, {
      kind: "card",
      instanceId: "guided",
    });

    const afterBp = executeX03BpStep(guidedWithSoul, ["enemy-a"]);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const afterGuideChoice = resolveStepOptional(afterDestroy, "execute");
    expect(afterGuideChoice.pendingCoreSourceAllocation).not.toBeNull();
    expect(
      afterGuideChoice.pendingCoreSourceAllocation?.candidates
    ).toContainEqual(
      expect.objectContaining({
        instanceId: "guided",
        normalAvailable: 1,
        hasSoulCore: true,
      })
    );

    const afterGuideCore = resolveCoreSourceAllocation(
      afterGuideChoice,
      { guided: 0 },
      "guided"
    );

    expect(
      afterGuideCore.cardInstances.find((c) => c.instanceId === "guided")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterGuideCore.cardInstances.find((c) => c.instanceId === "x03")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterGuideCore.players.find((player) => player.id === ALICE)!
        .soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "x03" });
    expect(
      afterGuideCore.log.some((entry) =>
        entry.includes(
          "effect:suppress-pending-leave-effects:enemy-a:destroyed_only"
        )
      )
    ).toBe(true);
  });

  it("[board] BSTH02.7-X03: 導界者でないネクサスのコアは guide_core の候補にしない", () => {
    const base = x03Board();
    const nonGuidedOnly: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances.map((cardInstance) =>
          cardInstance.instanceId === "guided"
            ? { ...cardInstance, normalCoreCount: 0 }
            : cardInstance
        ),
        createCardInstance(card("TEST-X03-NON-GUIDED-NEXUS"), {
          instanceId: "non-guided",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const afterBp = executeX03BpStep(nonGuidedOnly, ["enemy-a"]);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const afterGuideChoice = resolveStepOptional(afterDestroy, "execute");

    expect(afterGuideChoice.pendingCoreSourceAllocation).toBeNull();
    expect(
      afterGuideChoice.cardInstances.find((c) => c.instanceId === "non-guided")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterGuideChoice.cardInstances.find((c) => c.instanceId === "x03")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterGuideChoice.log.some((entry) =>
        entry.includes("effect:suppress-pending-leave-effects")
      )
    ).toBe(false);
  });

  it("[board] BSTH02.7-X03: cannot_leave_field で阻止された破壊は導界者コア移動後の抑止でも貫通しない", () => {
    const state = grantCannotLeaveField(x03Board(), "enemy-a");
    const afterBp = executeX03BpStep(state, ["enemy-a"]);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    expect(afterDestroy.pendingStepOptionalChoice?.stepIndex).toBe(2);
    expect(afterDestroy.pendingLeaveEntities).toHaveLength(0);
    expect(
      afterDestroy.log.some((entry) =>
        entry.includes("effect:destroy:blocked-by-resistance:alice:enemy-a")
      )
    ).toBe(true);
    expect(
      afterDestroy.cardInstances.find((c) => c.instanceId === "enemy-a")?.zone
    ).toBe("field");

    const afterGuideChoice = resolveStepOptional(afterDestroy, "execute");
    const afterGuideCore =
      afterGuideChoice.pendingCoreSourceAllocation !== null
        ? resolveCoreSourceAllocation(afterGuideChoice, { guided: 1 })
        : afterGuideChoice;

    expect(
      afterGuideCore.log.some((entry) =>
        entry.includes(
          "effect:destroy:cannot-leave-field-pierced:alice:enemy-a"
        )
      )
    ).toBe(false);
    expect(
      afterGuideCore.log.some((entry) =>
        entry.includes(
          "effect:suppress-pending-leave-effects:enemy-a:destroyed_only"
        )
      )
    ).toBe(false);
    expect(
      afterGuideCore.cardInstances.find((c) => c.instanceId === "enemy-a")?.zone
    ).toBe("field");
    expect(
      afterGuideCore.pendingTriggeredEffects.some(
        (pending) => pending.relatedInstanceId === "enemy-a"
      )
    ).toBe(false);
  });

  it("[board] BSTH02.7-X03: BP0破壊を辞退しても導界者コア移動後の抑止で再破壊しない", () => {
    const afterBp = executeX03BpStep(x03Board(), ["enemy-a"]);
    const afterDeclineDestroy = resolveStepOptional(afterBp, "decline");
    expect(afterDeclineDestroy.pendingStepOptionalChoice?.stepIndex).toBe(2);
    const afterGuideChoice = resolveStepOptional(
      afterDeclineDestroy,
      "execute"
    );
    const afterGuideCore =
      afterGuideChoice.pendingCoreSourceAllocation !== null
        ? resolveCoreSourceAllocation(afterGuideChoice, { guided: 1 })
        : afterGuideChoice;

    expect(
      afterGuideCore.cardInstances.find((c) => c.instanceId === "enemy-a")?.zone
    ).toBe("field");
    expect(
      afterGuideCore.log.some((entry) =>
        entry.includes("effect:suppress-pending-leave-effects")
      )
    ).toBe(false);
  });

  it("[board] BSTH02.7-X03: 抑止済み queued destroy pending は解決しても破壊時効果を実行しない", () => {
    const afterBp = executeX03BpStep(x03Board(), ["enemy-a", "enemy-b"], 1);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const beforeGuide = { ...afterDestroy, pendingStepOptionalChoice: null };

    const unsuppressed = resolveTriggeredForRelatedInstance(
      beforeGuide,
      "enemy-a"
    );
    expect(
      unsuppressed.players.find((player) => player.id === BOB)!.countValue
    ).toBe(1);

    const suppressed = executeEffect({
      chainId: "test:bsth02-7-summon-attack-shared-usage:882",
      state: beforeGuide,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "suppress_pending_leave_effects",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 2,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
        ],
      },
      effectIndex: 0,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      targetInstanceIds: ["enemy-a", "enemy-b"],
      ...lookups,
    });
    expect(suppressed.pendingTriggeredEffects).toHaveLength(0);
    expect(
      suppressed.players.find((player) => player.id === BOB)!.countValue
    ).toBe(0);
    expect(
      suppressed.log.some((entry) =>
        entry.startsWith("trigger:effect-suppressed:")
      )
    ).toBe(true);
  });

  it("[board] BSTH02.7-X03: destroyed_only は破壊対象自身だけを抑止し、第三者の破壊監視は残す", () => {
    const base = x03Board();
    const watchedDestroy: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(card("TEST-X03-DESTROY-WATCHER"), {
          instanceId: "watcher",
          ownerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const afterBp = executeX03BpStep(watchedDestroy, ["enemy-a"]);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const afterGuideChoice = resolveStepOptional(afterDestroy, "execute");
    const afterGuideCore =
      afterGuideChoice.pendingCoreSourceAllocation !== null
        ? resolveCoreSourceAllocation(afterGuideChoice, { guided: 1 })
        : afterGuideChoice;

    const pending = afterGuideCore.pendingTriggeredEffects.find(
      (entry) => entry.relatedInstanceId === "enemy-a"
    );
    expect(pending).toBeDefined();
    expect(pending?.suppressedSourceInstanceIds).toContain("enemy-a");
    const selectWatcher = getLegalActions({
      state: afterGuideCore,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "select_pending_to_resolve" &&
        action.sourceInstanceId === "watcher"
    );
    expect(selectWatcher).toBeDefined();
    const selectedWatcher = applyLegalAction({
      state: afterGuideCore,
      action: selectWatcher!,
      ...lookups,
    }).state;
    expect(
      getLegalActions({
        state: selectedWatcher,
        actingPlayerId: BOB,
        ...lookups,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.pendingId === pending!.pendingId &&
          action.sourceInstanceId === "watcher"
      )
    ).toBe(true);
  });

  it("[board] BSTH02.7-X03: flush 後の leave_field 監視も production 経路で queue される", () => {
    const base = x03Board();
    const watchedLeave: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(card("TEST-X03-LEAVE-WATCHER"), {
          instanceId: "leave-watcher",
          ownerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const afterBp = executeX03BpStep(watchedLeave, ["enemy-a"]);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const afterGuideChoice = resolveStepOptional(afterDestroy, "execute");
    const afterGuideCore =
      afterGuideChoice.pendingCoreSourceAllocation !== null
        ? resolveCoreSourceAllocation(afterGuideChoice, { guided: 1 })
        : afterGuideChoice;

    const pending = afterGuideCore.pendingTriggeredEffects.find(
      (entry) =>
        entry.eventKind === "leave_field" &&
        entry.relatedInstanceId === "enemy-a"
    );
    expect(pending).toBeDefined();
    expect(pending?.suppressedSourceInstanceIds).toContain("enemy-a");
    expect(
      afterGuideCore.log.some((entry) =>
        entry.startsWith("pending-leave-flushed:destroy:enemy-a")
      )
    ).toBe(true);
  });

  it("[engine] suppress_pending_leave_effects all_opponent は queued trigger/burst を抑止し成功扱いになる", () => {
    const afterBp = executeX03BpStep(x03Board(), ["enemy-a"]);
    const afterDestroy = resolveStepOptional(afterBp, "execute");
    const pending = afterDestroy.pendingTriggeredEffects[0]!;
    const queued: GameState = {
      ...afterDestroy,
      pendingStepOptionalChoice: null,
      pendingLeaveEntities: [],
      pendingTriggeredEffects: [
        {
          ...pending,
          effectSuppressed: undefined,
          suppressedSourceInstanceIds: undefined,
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst-test",
          actingPlayerId: BOB,
          eventKind: "leave_field",
          event: { family: "leave_field", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:bsth02-7-summon-attack-shared-usage:1028",
          attackId: null,
          relatedPlayerId: BOB,
          relatedInstanceId: "enemy-a",
          amount: 0,
          step: "main",
          window: "main",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const suppressed = executeEffect({
      chainId: "test:bsth02-7-summon-attack-shared-usage:1046",
      state: queued,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "suppress",
            action: {
              kind: "suppress_pending_leave_effects",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              suppressDestroyedEffects: "all_opponent",
            },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            stepCondition: { kind: "ref_succeeded", stepId: "suppress" },
          },
        ],
      },
      effectIndex: 0,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      targetInstanceIds: ["enemy-a"],
      ...lookups,
    });

    expect(suppressed.pendingTriggeredEffects).toHaveLength(0);
    expect(suppressed.pendingBurstChecks[0]?.effectSuppressed).toBe(true);
    expect(
      suppressed.players.find((player) => player.id === ALICE)!.countValue
    ).toBe(2);
  });

  it("[engine] suppress_pending_leave_effects は target affect gate で destroy 耐性に阻止されない", () => {
    const queued: GameState = {
      ...grantCannotBeDestroyed(x03Board(), "enemy-a"),
      pendingLeaveEntities: [
        {
          instanceId: "enemy-a",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: "effect:destroy:alice:enemy-a",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "queued-destroy-resistant",
          actingPlayerId: BOB,
          eventKind: "destroy",
          source: "action_resolution",
          chainId: "test:bsth02-7-summon-attack-shared-usage:1099",
          attackId: null,
          relatedPlayerId: BOB,
          relatedInstanceId: "enemy-a",
          amount: null,
          step: "main",
          window: "main",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const suppressed = executeEffect({
      chainId: "test:bsth02-7-summon-attack-shared-usage:1116",
      state: queued,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "suppress",
            action: {
              kind: "suppress_pending_leave_effects",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            stepCondition: { kind: "ref_succeeded", stepId: "suppress" },
          },
        ],
      },
      effectIndex: 0,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      targetInstanceIds: ["enemy-a"],
      ...lookups,
    });

    expect(suppressed.pendingTriggeredEffects).toHaveLength(0);
    expect(
      suppressed.players.find((player) => player.id === ALICE)!.countValue
    ).toBe(2);
  });

  it("[engine] suppress_pending_leave_effects は resistance で阻止された pending leave を抑止対象にしない", () => {
    const queued: GameState = {
      ...x03Board(),
      pendingLeaveEntities: [
        {
          instanceId: "enemy-a",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: "effect:destroy:alice:enemy-a",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
          blockedByResistance: true,
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "queued-blocked-destroy",
          actingPlayerId: BOB,
          eventKind: "destroy",
          source: "action_resolution",
          chainId: "test:bsth02-7-summon-attack-shared-usage:1169",
          attackId: null,
          relatedPlayerId: BOB,
          relatedInstanceId: "enemy-a",
          amount: null,
          step: "main",
          window: "main",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const suppressed = executeEffect({
      chainId: "test:bsth02-7-summon-attack-shared-usage:1186",
      state: queued,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "suppress",
            action: {
              kind: "suppress_pending_leave_effects",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            stepCondition: { kind: "ref_succeeded", stepId: "suppress" },
          },
        ],
      },
      effectIndex: 0,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      targetInstanceIds: ["enemy-a"],
      ...lookups,
    });

    expect(
      suppressed.pendingLeaveEntities[0]?.suppressDestroyedEffects
    ).toBeUndefined();
    expect(
      suppressed.pendingTriggeredEffects[0]?.suppressedSourceInstanceIds
    ).toBeUndefined();
    expect(
      suppressed.players.find((player) => player.id === ALICE)!.countValue
    ).toBe(1);
  });
});
