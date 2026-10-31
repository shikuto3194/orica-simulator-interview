/**
 * ENGINE-stack-activation-reactivation-trigger の第3配線点回帰テスト。
 *
 * magic-system.ts (マジック) / card-effect-system.ts (フィールドカード自身) の2経路には
 * フックしたが、grant_effect で付与された起動効果 (CE.metadata.grantedEffect) が
 * 【スタック】タイミング (chosenTiming==="stack") で解決される経路は
 * mechanic-trigger-handlers.ts の resolveDeferredGrantedActivatedEffectStack という
 * 第3の resolver で、当初の実装ではこちらにも queueStackEffectUsedTriggers が
 * 配線されておらず silent no-op だった (adversarial verifier round2 で refuted)。
 * 現状 mode:"stack" の grantedEffect を持つ shipped card は無いが、
 * legal-actions-availability.ts が grantedEffect.timing.mode==="stack" を明示的に
 * legal action 化しており到達可能な経路のため、他2経路と同じ扱いにした。
 */
import { describe, expect, it } from "vitest";
import { resolveDeferredGrantedActivatedEffectStack } from "../src/legal/mechanic-trigger-handlers";
import {
  buildTriggeredEffectLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../src/effect/structured-effect-registrations";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const GRANTEE: CardDefinition = {
  cardNo: "TEST-ENGINE-STACK-GRANTED-GRANTEE",
  name: "テスト被付与スピリット",
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
};

const LISTENER: CardDefinition = {
  cardNo: "TEST-ENGINE-STACK-GRANTED-LISTENER",
  name: "テストスタック観測スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["blue"],
  textLines: ["相手がスタック効果を発揮したとき、何もしない。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "game_event", player: "opponent", event: "stack" },
      executionMode: "optional",
      steps: [],
      textRef: [0],
    },
  ],
};

function getDef(id: string): CardDefinition | undefined {
  if (id === GRANTEE.cardNo) return GRANTEE;
  if (id === LISTENER.cardNo) return LISTENER;
  return undefined;
}

/** 被付与カード自身に何もしない stack 起動効果。 */
const GRANTED_STACK_EFFECT: Effect = {
  timing: { kind: "activated", mode: "stack" },
  executionMode: "optional",
  steps: [],
} as unknown as Effect;

function makeGrantCe(granteeInstanceId: string): ContinuousEffect {
  return {
    effectId: "ce:granted-stack-test",
    sourceInstanceId: granteeInstanceId,
    sourceDefinitionId: GRANTEE.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    modifierTag: "granted_effect",
    targetInstanceId: granteeInstanceId,
    metadata: { grantedEffect: GRANTED_STACK_EFFECT },
  } as ContinuousEffect;
}

describe("ENGINE-stack-activation-reactivation-trigger: grant_effect付与起動効果の【スタック】解決経路", () => {
  it("chosenTiming:'stack'で完全解決すると、相手の game_event:stack リスナーが public pending triggered effect として queue される", () => {
    const grantee = createCardInstance(GRANTEE, {
      instanceId: "grantee-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const listener = createCardInstance(LISTENER, {
      instanceId: "listener-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [grantee, listener],
    });
    const withCe: GameState = {
      ...state,
      activeContinuousEffects: [makeGrantCe(grantee.instanceId)],
    };

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([GRANTEE, LISTENER]);

    const activeStack: ActiveStack = {
      stackId: "stack:test-granted-stack",
      actionKind: "field_card_effect",
      chainId: "effect:test:granted-stack",
      actingPlayerId: ALICE,
      cardInstanceId: grantee.instanceId,
      cardDefinitionId: GRANTEE.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "stack",
      grantedEffectCeId: "ce:granted-stack-test",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    } as ActiveStack;

    const resolved = resolveDeferredGrantedActivatedEffectStack(
      withCe,
      activeStack,
      {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      } as Parameters<typeof resolveDeferredGrantedActivatedEffectStack>[2]
    );

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack" && p.actingPlayerId === BOB
    );
    expect(pending).toBeDefined();
  });

  it("chosenTiming:'flash'のときは誘発 queue されない", () => {
    const grantee = createCardInstance(GRANTEE, {
      instanceId: "grantee-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const listener = createCardInstance(LISTENER, {
      instanceId: "listener-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [grantee, listener],
    });
    const withCe: GameState = {
      ...state,
      activeContinuousEffects: [makeGrantCe(grantee.instanceId)],
    };

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([GRANTEE, LISTENER]);

    const activeStack: ActiveStack = {
      stackId: "stack:test-granted-flash",
      actionKind: "field_card_effect",
      chainId: "effect:test:granted-flash",
      actingPlayerId: ALICE,
      cardInstanceId: grantee.instanceId,
      cardDefinitionId: GRANTEE.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "flash",
      grantedEffectCeId: "ce:granted-stack-test",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    } as ActiveStack;

    const resolved = resolveDeferredGrantedActivatedEffectStack(
      withCe,
      activeStack,
      {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      } as Parameters<typeof resolveDeferredGrantedActivatedEffectStack>[2]
    );

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack"
    );
    expect(pending).toBeUndefined();
  });

  // P3-114: activationLabel:"none" (本文中でスタックタイミングを実行窓として使うだけの
  // 非スタック効果) は chosenTiming:"stack" であっても見出しラベルの【スタック】効果では
  // ないため誘発対象外。
  it("chosenTiming:'stack'でも activationLabel:'none'(本文中利用)のときは誘発 queue されない", () => {
    const grantee = createCardInstance(GRANTEE, {
      instanceId: "grantee-3",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const listener = createCardInstance(LISTENER, {
      instanceId: "listener-3",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [grantee, listener],
    });
    const withCe: GameState = {
      ...state,
      activeContinuousEffects: [makeGrantCe(grantee.instanceId)],
    };

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([GRANTEE, LISTENER]);

    const activeStack: ActiveStack = {
      stackId: "stack:test-granted-stack-none-label",
      actionKind: "field_card_effect",
      chainId: "effect:test:granted-stack-none-label",
      actingPlayerId: ALICE,
      cardInstanceId: grantee.instanceId,
      cardDefinitionId: GRANTEE.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "stack",
      activationLabel: "none",
      grantedEffectCeId: "ce:granted-stack-test",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    } as ActiveStack;

    const resolved = resolveDeferredGrantedActivatedEffectStack(
      withCe,
      activeStack,
      {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      } as Parameters<typeof resolveDeferredGrantedActivatedEffectStack>[2]
    );

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack"
    );
    expect(pending).toBeUndefined();
  });
});
