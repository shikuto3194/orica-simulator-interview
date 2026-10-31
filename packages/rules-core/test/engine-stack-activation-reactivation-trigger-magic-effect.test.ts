/**
 * P3-114 / ENGINE-stack-activation-reactivation-trigger の magic-system.ts
 * resolveDeferredMagicStack 経路回帰テスト。
 *
 * card-effect-system.ts / mechanic-trigger-handlers.ts と同じく、マジックの
 * 【スタック】キーワード効果 (見出しラベル位置の "stack") が完全解決した後に
 * 「相手がスタック効果を発揮したとき」誘発 (BSTH02.7-X01 effects[2] 等) を発火するが、
 * `activationLabel:"none"` (本文中でスタックタイミングを実行窓として使うだけの
 * 非スタック効果) はこの誘発の対象外 (03c:44-47 のフラッシュ側裁定と同型)。
 */
import { describe, expect, it } from "vitest";
import { resolveDeferredMagicStack } from "../src/mechanics/magic-system";
import {
  buildTriggeredEffectLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../src/effect/structured-effect-registrations";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { ActiveStack, CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const STACK_MAGIC: CardDefinition = {
  cardNo: "TEST-ENGINE-STACK-MAGIC-USER",
  name: "テストスタック使用マジック",
  printedCategory: "magic",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  textLines: ["スタック 何もしない。"],
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
} as CardDefinition;

const LISTENER: CardDefinition = {
  cardNo: "TEST-ENGINE-STACK-MAGIC-LISTENER",
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
  if (id === STACK_MAGIC.cardNo) return STACK_MAGIC;
  if (id === LISTENER.cardNo) return LISTENER;
  return undefined;
}

function makeActiveStack(
  instanceId: string,
  overrides: Partial<ActiveStack>
): ActiveStack {
  return {
    stackId: `stack:${instanceId}`,
    actionKind: "magic",
    chainId: `chain:${instanceId}`,
    actingPlayerId: ALICE,
    cardInstanceId: instanceId,
    cardDefinitionId: STACK_MAGIC.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    chosenTiming: "stack",
    magicEffectIndex: 0,
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
    ...overrides,
  } as ActiveStack;
}

describe("ENGINE-stack-activation-reactivation-trigger: magic【スタック】効果解決経路", () => {
  it("マジックの【スタック】キーワード効果 (mode:stack) が完全解決すると、相手の game_event:stack リスナーが public pending triggered effect として queue される", () => {
    const magicCard = createCardInstance(STACK_MAGIC, {
      instanceId: "magic-stack-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const listenerCard = createCardInstance(LISTENER, {
      instanceId: "listener-magic-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [magicCard, listenerCard],
    };

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([STACK_MAGIC, LISTENER]);

    const resolved = resolveDeferredMagicStack({
      state,
      activeStack: makeActiveStack("magic-stack-1", {}),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack" && p.actingPlayerId === BOB
    );
    expect(pending).toBeDefined();
  });

  // P3-114: activationLabel:"none" (本文中でスタックタイミングを実行窓として使うだけの
  // 非スタック効果、例: BSAZ02-TX01(A)「フラッシュ/スタックタイミングに裏返せる」型) は
  // chosenTiming:"stack" であっても見出しラベルの【スタック】効果ではないため誘発対象外。
  it("chosenTiming:'stack'でも activationLabel:'none'(本文中利用)のときは誘発 queue されない", () => {
    const magicCard = createCardInstance(STACK_MAGIC, {
      instanceId: "magic-stack-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const listenerCard = createCardInstance(LISTENER, {
      instanceId: "listener-magic-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [magicCard, listenerCard],
    };

    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([STACK_MAGIC, LISTENER]);

    const resolved = resolveDeferredMagicStack({
      state,
      activeStack: makeActiveStack("magic-stack-2", {
        activationLabel: "none",
      }),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = resolved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack"
    );
    expect(pending).toBeUndefined();
  });
});
