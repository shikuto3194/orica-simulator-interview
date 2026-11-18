/**
 * ENGINE-stack-activation-reactivation-trigger の第2配線点回帰テスト。
 *
 * magic-system.ts resolveDeferredMagicStack (マジックのスタック効果) にはフックしたが、
 * スピリット/ネクサス/ブレイヴ自身の【スタック】キーワード効果 (timing.kind:"activated",
 * mode:"stack") は card-effect-system.ts resolveDeferredFieldEffectStack という別の
 * resolver で解決されるため、当初の実装ではこちらに queueStackEffectUsedTriggers が
 * 配線されておらず、相手がスピリット/ネクサス側の【スタック】効果を発揮しても
 * 「相手がスタック効果を発揮したとき」型の誘発 (BSTH02.7-X01 effects[1] 等) が
 * 発火しない silent no-op だった (adversarial verifier round1 で refuted)。
 * resolveDeferredFieldEffectStack にも同じ chosenTiming==="stack" ガードで
 * queueStackEffectUsedTriggers を呼ぶよう修正した。
 */
import { describe, expect, it } from "vitest";
import { resolveDeferredFieldEffectStack } from "../src/card/card-effect-system";
import {
  buildTriggeredEffectLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../src/effect/structured-effect-registrations";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { ActiveStack, CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const STACK_USER: CardDefinition = {
  cardNo: "TEST-ENGINE-STACK-FIELD-USER",
  name: "テストスタック使用スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: ["スタック『相手のバトル中』何もしない。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [],
      textRef: [0],
    },
  ],
};

const LISTENER: CardDefinition = {
  cardNo: "TEST-ENGINE-STACK-FIELD-LISTENER",
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
  if (id === STACK_USER.cardNo) return STACK_USER;
  if (id === LISTENER.cardNo) return LISTENER;
  return undefined;
}

describe("ENGINE-stack-activation-reactivation-trigger: field-card【スタック】効果解決経路", () => {
  it("スピリットの【スタック】キーワード効果 (mode:stack) が完全解決すると、相手の game_event:stack リスナーが public pending triggered effect として queue される", () => {
    const stackUserCard = createCardInstance(STACK_USER, {
      instanceId: "stack-user-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const listenerCard = createCardInstance(LISTENER, {
      instanceId: "listener-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [stackUserCard, listenerCard],
    });

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([STACK_USER, LISTENER]);

    const activeStack: ActiveStack = {
      stackId: "stack:test-field-stack",
      actionKind: "field_card_effect",
      chainId: "effect:test:field-stack",
      actingPlayerId: ALICE,
      cardInstanceId: stackUserCard.instanceId,
      cardDefinitionId: STACK_USER.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      fieldEffectSourceKind: "spirit",
      chosenTiming: "stack",
      fieldEffectRegistrationIndex: 0,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    } as ActiveStack;

    const resolved = resolveDeferredFieldEffectStack({
      state,
      activeStack,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
      targetEffectIndex: 0,
    });

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack" && p.actingPlayerId === BOB
    );
    expect(pending).toBeDefined();
  });

  it("chosenTiming が'stack'以外 (main) のときは誘発 queue されない", () => {
    const stackUserCard = createCardInstance(STACK_USER, {
      instanceId: "stack-user-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const listenerCard = createCardInstance(LISTENER, {
      instanceId: "listener-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [stackUserCard, listenerCard],
    });

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([STACK_USER, LISTENER]);

    const activeStack: ActiveStack = {
      stackId: "stack:test-field-main",
      actionKind: "field_card_effect",
      chainId: "effect:test:field-main",
      actingPlayerId: ALICE,
      cardInstanceId: stackUserCard.instanceId,
      cardDefinitionId: STACK_USER.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      fieldEffectSourceKind: "spirit",
      chosenTiming: "main",
      fieldEffectRegistrationIndex: 0,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    } as ActiveStack;

    const resolved = resolveDeferredFieldEffectStack({
      state,
      activeStack,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
      targetEffectIndex: 0,
    });

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack"
    );
    expect(pending).toBeUndefined();
  });

  // P3-114: activationLabel:"none" (本文中でスタックタイミングを実行窓として使うだけの
  // 非スタック効果、例: BSAZ02-TX01(A)「フラッシュ/スタックタイミングに裏返せる」型) は
  // chosenTiming:"stack" であっても見出しラベルの【スタック】効果ではないため誘発対象外。
  it("chosenTiming:'stack'でも activationLabel:'none'(本文中利用)のときは誘発 queue されない", () => {
    const stackUserCard = createCardInstance(STACK_USER, {
      instanceId: "stack-user-3",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const listenerCard = createCardInstance(LISTENER, {
      instanceId: "listener-3",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [stackUserCard, listenerCard],
    });

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([STACK_USER, LISTENER]);

    const activeStack: ActiveStack = {
      stackId: "stack:test-field-stack-none-label",
      actionKind: "field_card_effect",
      chainId: "effect:test:field-stack-none-label",
      actingPlayerId: ALICE,
      cardInstanceId: stackUserCard.instanceId,
      cardDefinitionId: STACK_USER.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      fieldEffectSourceKind: "spirit",
      chosenTiming: "stack",
      activationLabel: "none",
      fieldEffectRegistrationIndex: 0,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    } as ActiveStack;

    const resolved = resolveDeferredFieldEffectStack({
      state,
      activeStack,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
      targetEffectIndex: 0,
    });

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack"
    );
    expect(pending).toBeUndefined();
  });
});
