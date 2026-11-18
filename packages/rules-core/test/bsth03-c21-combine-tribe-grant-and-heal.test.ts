/**
 * BSTH03-C21「蓬莱の玉の枝」textLines[2-4] 検証:
 * 「【合体条件：コスト6以上＆アルティメット】【合体中】『自分のアタックステップ』
 * 系統：「幻想」と「想獣」/「魔影」を持つアルティメットとの合体中、このアルティメットは、
 * 系統：「蓬莱」を持ち、自分の黄/紫の効果でライフにコアを置いたとき、回復する。」
 *
 * - braveCondition: { categories: ["ultimate"], minCost: 6 } (合体条件)
 * - effects[2]: 合体中 + host tribes(幻想 AND (想獣 OR 魔影)) + 自分のアタックステップ
 *   timingScope で、host へ系統「蓬莱」を addTribes する continuous CE。
 * - effects[3]: 同条件下、自分の黄/紫の効果で core_placed_on_life したとき host が回復する
 *   game_event トリガー。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveTribes,
  getOverriddenProperties,
  rebuildContinuousEffectsFromField,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const triggerLookup = buildTriggeredEffectLookup(ALL_CARDS);

const ALICE = "alice";
const BOB = "bob";
const BRAVE = cardNoMap.get("BSTH03-C21")!;
// 自分のライフ増加のトリガー元 (yellow): 既存 precedent と同じカード
// (bsth03-c03-x02-tribe-tag-life-increase.test.ts と同型に流用)。
const C03 = cardNoMap.get("BSTH03-C03")!;
const c03LifeIncreaseEffect = C03.effects!.find(
  (effect) =>
    effect.timing.kind === "card_event" &&
    Array.isArray(effect.timing.event) &&
    effect.timing.event.includes("summon")
)!;

const fantasyBeastHost: CardDefinition = {
  cardNo: "TEST-FANTASY-BEAST-HOST",
  name: "テスト用幻想想獣アルティメット",
  printedCategory: "ultimate",
  colors: ["purple"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["purple", "ultimate_symbol"],
  textLines: [],
  tribe: "幻想・想獣",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const fantasyDemonHost: CardDefinition = {
  ...fantasyBeastHost,
  cardNo: "TEST-FANTASY-DEMON-HOST",
  tribe: "幻想・魔影",
};

const unrelatedHost: CardDefinition = {
  ...fantasyBeastHost,
  cardNo: "TEST-UNRELATED-HOST",
  tribe: "封魔",
};

const lookup = (id: string) =>
  getCardDefinitionById(id) ??
  [fantasyBeastHost, fantasyDemonHost, unrelatedHost].find(
    (d) => d.cardNo === id
  );

function drainStackWindow(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: () => [],
    }).find((a) => a.kind === "pass_stack");
    if (!pass) break;
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById: lookup,
    }).state;
  }
  return current;
}

describe("BSTH03-C21 蓬莱の玉の枝: 合体条件 / 合体中系統付与 / ライフコア回復トリガー", () => {
  it("card-data: braveCondition と effects[2]/[3] の宣言が textLines[2-4] を正しく表現する", () => {
    expect(BRAVE.braveCondition).toEqual({
      categories: ["ultimate"],
      minCost: 6,
    });

    const tribeGrantEffect = BRAVE.effects![2]!;
    expect(tribeGrantEffect.stub).toBeUndefined();
    expect(tribeGrantEffect.applicability).toEqual({ combined: true });
    expect(tribeGrantEffect.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    expect(tribeGrantEffect.steps[0]!.action).toEqual({
      kind: "override_properties",
      target: { kind: "self" },
      properties: { addTribes: ["蓬莱"] },
      duration: { scope: "permanent" },
    });

    const healEffect = BRAVE.effects![3]!;
    expect(healEffect.stub).toBeUndefined();
    expect(healEffect.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "core_placed_on_life",
    });
    expect(healEffect.condition).toContainEqual({
      kind: "trigger_source_player",
      player: "self",
    });
    expect(healEffect.condition).toContainEqual({
      kind: "trigger_colors",
      colors: ["yellow", "purple"],
    });
    expect(healEffect.steps[0]!.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
  });

  it("幻想+想獣アルティメットとの合体中・自分のアタックステップ中: hostへ系統「蓬莱」が付与される", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [
        createCardInstance(fantasyBeastHost, {
          instanceId: "host-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedChildrenIds: ["brave-1"],
        }),
        createCardInstance(BRAVE, {
          instanceId: "brave-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedToInstanceId: "host-1",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);

    const addTribesCe = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "host-1" &&
        ce.modifierTag === "override_properties"
    );
    expect(addTribesCe.length).toBeGreaterThan(0);

    const overridden = getOverriddenProperties(rebuilt, "host-1", lookup);
    expect(overridden?.addTribes).toContain("蓬莱");

    const hostCard = rebuilt.cardInstances.find(
      (c) => c.instanceId === "host-1"
    )!;
    expect(
      getEffectiveTribes(rebuilt, hostCard, fantasyBeastHost, lookup)
    ).toContain("蓬莱");
  });

  it("幻想+魔影アルティメットとの合体中でも同様に系統「蓬莱」が付与される", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [
        createCardInstance(fantasyDemonHost, {
          instanceId: "host-2",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedChildrenIds: ["brave-2"],
        }),
        createCardInstance(BRAVE, {
          instanceId: "brave-2",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedToInstanceId: "host-2",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const overridden = getOverriddenProperties(rebuilt, "host-2", lookup);
    expect(overridden?.addTribes).toContain("蓬莱");
  });

  it("系統が合致しないホスト(封魔のみ)との合体中は系統「蓬莱」が付与されない", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [
        createCardInstance(unrelatedHost, {
          instanceId: "host-3",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedChildrenIds: ["brave-3"],
        }),
        createCardInstance(BRAVE, {
          instanceId: "brave-3",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedToInstanceId: "host-3",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const overridden = getOverriddenProperties(rebuilt, "host-3", lookup);
    expect(overridden?.addTribes ?? []).not.toContain("蓬莱");
  });

  it("自分のアタックステップ以外(main)では timingScope により系統「蓬莱」は付与されない", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [
        createCardInstance(fantasyBeastHost, {
          instanceId: "host-4",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedChildrenIds: ["brave-4"],
        }),
        createCardInstance(BRAVE, {
          instanceId: "brave-4",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedToInstanceId: "host-4",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const overridden = getOverriddenProperties(rebuilt, "host-4", lookup);
    expect(overridden?.addTribes ?? []).not.toContain("蓬莱");
  });

  it("自分の黄色い効果 (BSTH03-C03) でライフにコアを置いたとき、合体中の host が回復する (E2E)", () => {
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(C03, {
            instanceId: "c03-1",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 2,
          }),
          createCardInstance(fantasyBeastHost, {
            instanceId: "host-5",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            attachedChildrenIds: ["brave-5"],
            exhaustState: "exhausted",
          }),
          createCardInstance(BRAVE, {
            instanceId: "brave-5",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            attachedToInstanceId: "host-5",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
    };

    const afterCause = executeEffect({
      chainId: "test:bsth03-c21-combine-tribe-grant-and-heal:302",
      state: before,
      effect: c03LifeIncreaseEffect,
      sourceInstanceId: "c03-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsth03-c21-combine-tribe-grant-and-heal:310",
      beforeState: before,
      afterState: afterCause,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      causedBySourceInstanceId: "c03-1",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "core_placed_on_life"
    );
    expect(pending).toBeDefined();

    const resolveAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();

    const resolved = applyLegalAction({
      state: queued,
      action: resolveAction!,
      getCardDefinitionById: lookup,
    }).state;
    const final = drainStackWindow(resolved);

    const host = final.cardInstances.find((c) => c.instanceId === "host-5")!;
    expect(host.exhaustState).toBe("recovered");
  });
});
