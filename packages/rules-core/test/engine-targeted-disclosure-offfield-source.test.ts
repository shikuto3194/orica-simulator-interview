/**
 * ENGINE-targeted-disclosure-offfield-source: P3-76 targeted disclosure
 * (queueTargetedDisclosureForPendingEffectTarget, effect-target-handlers.ts) は
 * 従来 target card.zone==="field" のときのみ発火し、フィールド以外(手札/魂状態/
 * トラッシュ等)で発揮中の自カードを対象化しても取りこぼしていた
 * (needs-dsl.audit BSLH01-T14「フィールド以外で発揮中の自分の系統CBスピリットを
 * 対象とした相手の効果すべてを無効にする」)。
 *
 * P3-86 案X で導入済みの isInstanceInOpenResponseWindow (read-only, 開いている
 * 応答窓の保留 ActiveStack 鎖に instanceId が含まれるか) を SSOT として流用し、
 * 「フィールド外で自身の効果が発揮中 (= 応答窓の保留 ActiveStack 鎖に自身の
 * instanceId が乗っている)」の場合にも disclosure/targeted 誘発を通す
 * (native-effect-front-helpers.ts の queueTargetedDisclosureForStep と
 * trigger-system.ts の require_related_instance_on_field ゲート両方の拡張が必要。
 * effect-target-handlers.ts の queueTargetedDisclosureForPendingEffectTarget、
 * effect-resolution.ts の queueHandWrittenTargetedDisclosureForResolver
 * (hand-written resolver 経路) も同型ゲートを持つため同時に拡張した。
 * adversarial verifier round1 で queueHandWrittenTargetedDisclosureForResolver
 * の見落としを refute され、round2 でこのテストケースを追加して修正・確認した)。
 */
import { expect, it } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeRedirectTarget } from "../src/effect/native-ce-registration-handlers";
import { resolveTargets } from "../src/effect/native-target-resolution";
import { runActionMainResolution } from "../src/effect/effect-resolution";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { resumeTargetedDisclosureIfReady } from "../src/legal/stack-resolution-core";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
  PendingTriggeredEffect,
  TargetedDisclosureContinuation,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テスト",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

// BSLH01-T14 型の反応リスナー相当 (簡略化: 実際の無効化ではなく count_increase で
// 「targeted 誘発が発火したか」だけを検証する)。
const listenerDef = makeDef({
  cardNo: "OFFFIELD-LISTENER",
  name: "テスト反応リスナー",
  printedCategory: "magic",
  cost: 0,
  levelDefs: [],
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: "targeted",
        triggerFilter: { tribes: ["CB"] },
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
});

const cbSpiritDef = makeDef({
  cardNo: "OFFFIELD-CB-SPIRIT",
  name: "CB スピリットテスト",
  tribe: "CB",
});

const attackerMagicDef = makeDef({
  cardNo: "OFFFIELD-ATTACKER-MAGIC",
  name: "TEST 対象化カード",
  printedCategory: "magic",
  cost: 0,
  levelDefs: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          id: "target-select",
          action: {
            kind: "noop",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { cardName: { exact: "CB スピリットテスト" } },
              count: 1,
            },
          },
        },
      ],
    },
  ],
});

const defs: Record<string, CardDefinition> = {
  [listenerDef.cardNo]: listenerDef,
  [cbSpiritDef.cardNo]: cbSpiritDef,
  [attackerMagicDef.cardNo]: attackerMagicDef,
};
const getD = (id: string): CardDefinition | undefined => defs[id];
const lookup = buildTriggeredEffectLookup([listenerDef]);

// off-field-cb 自身の効果が現在応答窓で発揮中 (= 宣言済み・未解決) であることを表す
// 保留 ActiveStack。BOB の対象化効果とは別の ActiveStack。
const offFieldActivation: ActiveStack = {
  stackId: "stack:off-field-cb-activation",
  actionKind: "hand_card_effect",
  chainId: "chain:off-field-cb-activation",
  actingPlayerId: ALICE,
  cardInstanceId: "off-field-cb",
  cardDefinitionId: cbSpiritDef.cardNo,
  targetInstanceIds: [],
  targetEffectFilterTags: ["general"],
  chosenTiming: "flash",
  previousResponseSourcePlayerId: null,
  previousPendingStackAction: null,
};

function baseState(includeOpenResponseWindow: boolean): GameState {
  const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const listener = createCardInstance(listenerDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "listener",
  });
  const cbSpirit = createCardInstance(cbSpiritDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
    instanceId: "off-field-cb",
  });
  const attackerMagic = createCardInstance(attackerMagicDef, {
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "in_use",
    instanceId: "attacker-magic",
  });
  return {
    ...b,
    cardInstances: [listener, cbSpirit, attackerMagic],
    ...(includeOpenResponseWindow
      ? {
          stackWindow: {
            actingPlayerId: ALICE,
            previousWindow: "main",
            priorityPlayerId: BOB,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: ALICE,
            subStackEverOpened: false,
            burstWindowKind: null,
            pendingStackAction: offFieldActivation,
          },
        }
      : {}),
  };
}

it("フィールド以外(手札)で発揮中の自 CB スピリットが対象化されたとき、targeted 誘発が発火する", () => {
  const state = baseState(true);

  const disclosure = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:185",
    state,
    effect: attackerMagicDef.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "attacker-magic",
    actingPlayerId: BOB,
    getCardDefinitionById: getD,
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredBurstActions: () => [],
    targetInstanceIds: ["off-field-cb"],
    targetStepId: "target-select",
    effectActionKind: "magic",
  });

  expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
    sourceDefinitionId: attackerMagicDef.cardNo,
    sourceInstanceId: "attacker-magic",
    targetInstanceIds: ["off-field-cb"],
  });
  expect(
    disclosure.pendingTriggeredEffects.some(
      (p) =>
        p.eventKind === "targeted" && p.relatedInstanceId === "off-field-cb"
    )
  ).toBe(true);
});

it("応答窓が開いておらず発揮中でもない(単に手札にある)場合は targeted 誘発が発火しない", () => {
  const state = baseState(false);

  const disclosure = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:215",
    state,
    effect: attackerMagicDef.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "attacker-magic",
    actingPlayerId: BOB,
    getCardDefinitionById: getD,
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredBurstActions: () => [],
    targetInstanceIds: ["off-field-cb"],
    targetStepId: "target-select",
    effectActionKind: "magic",
  });

  expect(disclosure.pendingTargetedDisclosureContinuation).toBeNull();
  expect(
    disclosure.pendingTriggeredEffects.some(
      (p) =>
        p.eventKind === "targeted" && p.relatedInstanceId === "off-field-cb"
    )
  ).toBe(false);
});

// queueHandWrittenTargetedDisclosureForResolver (effect-resolution.ts) は
// executeEffect (DSL steps) とは別の call site (getHandWrittenEffectResolver
// 経路、runActionMainResolution 経由) で同型の field-only ゲートを持つ。
// 見落としを防ぐため独立に確認する。
it("hand-written resolver 経由でも、フィールド以外で発揮中の対象なら targeted 誘発が発火する", () => {
  const state = baseState(true);
  const attackerMagic = state.cardInstances.find(
    (c) => c.instanceId === "attacker-magic"
  )!;

  const afterDisclosure = runActionMainResolution({
    state,
    chainId: "chain:hand-written-off-field",
    startLogs: [],
    endLogs: [],
    context: {
      chainId: "chain:hand-written-off-field",
      resolutionKind: "magic_action",
      actingPlayerId: BOB,
      sourceKind: "field",
      sourceCard: attackerMagic,
      sourceDefinition: attackerMagicDef,
      targetInstanceIds: ["off-field-cb"],
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      effectActionKind: "magic",
    },
    getHandWrittenEffectResolver: () => (current: GameState) => current,
  });

  expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject({
    sourceInstanceId: "attacker-magic",
    targetInstanceIds: ["off-field-cb"],
  });
  expect(
    afterDisclosure.pendingTriggeredEffects.some(
      (p) =>
        p.eventKind === "targeted" && p.relatedInstanceId === "off-field-cb"
    )
  ).toBe(true);
});

// BSLH01-T14 型リスナー (condition:trigger_related_instance_off_field 付き)。
// disclosure gate 自体は on-field 対象化でも通常どおり同じ event:"targeted" を
// 発火するため (BSLH01-C01/R06 型カードのため必要)、T14 のような「フィールド以外で
// 発揮中の…」限定カードはカード側の condition で絞り込む必要がある
// (adversarial verifier round1 lens1 指摘: over-trigger 修正)。
const offFieldOnlyListenerDef = makeDef({
  cardNo: "OFFFIELD-ONLY-LISTENER",
  name: "テスト反応リスナー(off-field限定)",
  printedCategory: "magic",
  cost: 0,
  levelDefs: [],
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: "targeted",
        triggerFilter: { tribes: ["CB"] },
      },
      condition: [{ kind: "trigger_related_instance_off_field" }],
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
});
const offFieldOnlyDefs: Record<string, CardDefinition> = {
  ...defs,
  [offFieldOnlyListenerDef.cardNo]: offFieldOnlyListenerDef,
};
const getD3 = (id: string): CardDefinition | undefined => offFieldOnlyDefs[id];
const offFieldOnlyLookup = buildTriggeredEffectLookup([
  offFieldOnlyListenerDef,
]);

function offFieldOnlyState(cbSpiritZone: "hand" | "field"): GameState {
  const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const listener = createCardInstance(offFieldOnlyListenerDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "listener",
  });
  const cbSpirit = createCardInstance(cbSpiritDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: cbSpiritZone,
    instanceId: "off-field-cb",
    ...(cbSpiritZone === "field" ? { normalCoreCount: 1 } : {}),
  });
  const attackerMagic = createCardInstance(attackerMagicDef, {
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "in_use",
    instanceId: "attacker-magic",
  });
  return {
    ...b,
    activePlayerId: BOB,
    step: "attack",
    cardInstances: [listener, cbSpirit, attackerMagic],
    ...(cbSpiritZone === "hand"
      ? {
          window: "stack",
          stackWindow: {
            actingPlayerId: ALICE,
            previousWindow: "main",
            priorityPlayerId: BOB,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: ALICE,
            subStackEverOpened: false,
            burstWindowKind: null,
            pendingStackAction: offFieldActivation,
          },
        }
      : {}),
  };
}

it("condition:trigger_related_instance_off_field を持つリスナーは、フィールド以外で発揮中の対象化で発火する", () => {
  const state = offFieldOnlyState("hand");

  const disclosure = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:363",
    state,
    effect: attackerMagicDef.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "attacker-magic",
    actingPlayerId: BOB,
    getCardDefinitionById: getD3,
    getRegisteredTriggeredEffectActions: offFieldOnlyLookup,
    getRegisteredBurstActions: () => [],
    targetInstanceIds: ["off-field-cb"],
    targetStepId: "target-select",
    effectActionKind: "magic",
  });

  expect(
    disclosure.pendingTriggeredEffects.some(
      (p) =>
        p.eventKind === "targeted" && p.relatedInstanceId === "off-field-cb"
    )
  ).toBe(true);
});

it("condition:trigger_related_instance_off_field を持つリスナーは、通常のフィールド上対象化では発火しない (過剰発火防止)", () => {
  const state = offFieldOnlyState("field");

  const disclosure = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:388",
    state,
    effect: attackerMagicDef.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "attacker-magic",
    actingPlayerId: BOB,
    getCardDefinitionById: getD3,
    getRegisteredTriggeredEffectActions: offFieldOnlyLookup,
    getRegisteredBurstActions: () => [],
    targetInstanceIds: ["off-field-cb"],
    targetStepId: "target-select",
    effectActionKind: "magic",
  });

  // disclosure gate 自体 (zone==="field") は通常どおり発火するが、リスナー側の
  // condition が false のため、この特定リスナーはトリガーされない。
  expect(
    disclosure.pendingTriggeredEffects.some(
      (p) =>
        p.eventKind === "targeted" && p.relatedInstanceId === "off-field-cb"
    )
  ).toBe(false);
});

// BSLH01-T14 negate 側: disclosure 応答 (game_event:"targeted" 誘発) の negate
// ステップは resolveStackCascade の workingStacks 巡回に乗らず
// pendingTriggeredEffects 経由で解決するため、resumeTargetedDisclosureIfReady が
// deferredStack 解決再開の直前に既存 pendingStackNegateRequests/
// applyPendingStackNegateRequests (SSOT) へ通す形で対応した
// (stack-resolution-core.ts)。対象化した側 (BOB) の triggered_effect スタックが
// 実際に無効化され、その DSL step (count_increase、対象選択なしの単純な観測可能
// action) が実行されないことを検証する (対象化自体の disclosure gate は既存 3 テストで
// 別途検証済みのため、ここでは negate 側の isNullified 伝播だけを対象化選択の複雑さ
// なしに検証する)。
const negateAttackerDef = makeDef({
  cardNo: "OFFFIELD-NEGATE-ATTACKER",
  name: "TEST 対象化スピリット(negate)",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
});

function negateTestSetup() {
  const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const cbSpirit = createCardInstance(cbSpiritDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
    instanceId: "off-field-cb",
  });
  const attacker = createCardInstance(negateAttackerDef, {
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    instanceId: "attacker",
    normalCoreCount: 1,
  });
  const state: GameState = {
    ...b,
    cardInstances: [cbSpirit, attacker],
  };
  const attackerStack: ActiveStack = {
    stackId: "stack:attacker-targeted-cb",
    actionKind: "triggered_effect",
    chainId: "chain:attacker-targeted-cb",
    actingPlayerId: BOB,
    cardInstanceId: "attacker",
    cardDefinitionId: negateAttackerDef.cardNo,
    targetInstanceIds: ["off-field-cb"],
    targetStepId: "__step_0",
    targetEffectFilterTags: [],
    triggeredPendingSnapshot: {
      pendingId: "p-attacker-targeted-cb",
      actingPlayerId: BOB,
      eventKind: "summon",
      source: "action_resolution",
      chainId: "chain:attacker-targeted-cb",
      attackId: null,
      relatedPlayerId: BOB,
      relatedInstanceId: "attacker",
      amount: null,
      step: state.step,
      window: state.window,
      resolvedSourceInstanceIds: [],
    } satisfies PendingTriggeredEffect,
    triggeredRegistrationIndex: 0,
    triggeredSourceCardNo: negateAttackerDef.cardNo,
    triggeredSourceKind: "spirit",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const continuation: TargetedDisclosureContinuation = {
    chainId: "test:engine-targeted-disclosure-offfield-source:484",
    pendingId: "targeted-disclosure:attacker-targeted-cb",
    sourceDefinitionId: negateAttackerDef.cardNo,
    effectIndex: 0,
    sourceInstanceId: "attacker",
    actingPlayerId: BOB,
    resumeStepIndex: 0,
    stepContext: { results: {} },
    targetInstanceIds: ["off-field-cb"],
    targetStepId: "__active_stack_target__",
    remainingStacks: [],
    deferredStackResolution: { deferredStack: attackerStack },
  };
  const lookup = buildTriggeredEffectLookup([negateAttackerDef]);
  const options = {
    getCardDefinitionById: getD,
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandCardEffectActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
  };
  return { state, continuation, options };
}

const negateDefs: Record<string, CardDefinition> = {
  ...defs,
  [negateAttackerDef.cardNo]: negateAttackerDef,
};
const getD2 = (id: string): CardDefinition | undefined => negateDefs[id];

it("targeted disclosure 応答の negate ステップが、対象化した側の ActiveStack を無効化する", () => {
  const { state, continuation, options } = negateTestSetup();
  const stateWithDisclosure: GameState = {
    ...state,
    pendingTargetedDisclosureContinuation: continuation,
    pendingStackNegateRequests: [
      {
        requestId: "req:offfield-t14-negate",
        actingPlayerId: ALICE,
        sourceInstanceId: "listener",
        negateTarget: "effect",
        createdAtStep: state.step,
        createdAtTurn: state.turnNumber,
      },
    ],
  };

  const result = resumeTargetedDisclosureIfReady(stateWithDisclosure, {
    ...options,
    getCardDefinitionById: getD2,
  });

  expect(
    result.log.some((entry) =>
      entry.startsWith("effect:nullified:chain:attacker-targeted-cb:")
    )
  ).toBe(true);
  expect(
    result.log.some((entry) => entry.startsWith("effect:count_increase:"))
  ).toBe(false);
  expect(result.pendingStackNegateRequests).toHaveLength(0);
});

it("targeted disclosure 応答に negate request が無ければ、対象化した側の ActiveStack は通常通り解決する", () => {
  const { state, continuation, options } = negateTestSetup();
  const stateWithDisclosure: GameState = {
    ...state,
    pendingTargetedDisclosureContinuation: continuation,
  };

  const result = resumeTargetedDisclosureIfReady(stateWithDisclosure, {
    ...options,
    getCardDefinitionById: getD2,
  });

  expect(
    result.log.some((entry) => entry.startsWith("effect:count_increase:"))
  ).toBe(true);
  expect(
    result.log.some((entry) => entry.startsWith("effect:nullified:"))
  ).toBe(false);
});

// negateTarget:"effect" は targetEffectTiming 未指定時、magic actionKind に対して
// stackMatchesNegateTarget (stack-negate.ts) 側で一般 cascade スキャンでは不一致に
// なる契約 (P3-75, 同一マジック内の複数タイミング効果からどれを指すか一意に決まらない
// ため)。resumeTargetedDisclosureIfReady はここに限り candidateStack (=開示元の
// magic ActiveStack) 自身の確定済み chosenTiming をローカルに補って一致させる
// (inferredMagicTiming probe/reconcile 分岐、adversarial verifier round1 lens5 指摘:
// この分岐がどのテストからも実行されていなかったのを追加で検証する)。
const negateMagicAttackerDef = makeDef({
  cardNo: "OFFFIELD-NEGATE-MAGIC-ATTACKER",
  name: "TEST 対象化マジック(negate)",
  printedCategory: "magic",
  cost: 0,
  levelDefs: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
});

function negateMagicTestSetup() {
  const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const attackerMagic = createCardInstance(negateMagicAttackerDef, {
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "in_use",
    instanceId: "attacker-magic-negate",
  });
  const state: GameState = {
    ...b,
    cardInstances: [attackerMagic],
  };
  const candidateStack: ActiveStack = {
    stackId: "stack:attacker-magic-negate",
    actionKind: "magic",
    chainId: "chain:attacker-magic-negate",
    actingPlayerId: BOB,
    cardInstanceId: "attacker-magic-negate",
    cardDefinitionId: negateMagicAttackerDef.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    chosenTiming: "flash",
    magicEffectIndex: 0,
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const continuation: TargetedDisclosureContinuation = {
    chainId: "test:engine-targeted-disclosure-offfield-source:617",
    pendingId: "targeted-disclosure:attacker-magic-negate",
    sourceDefinitionId: negateMagicAttackerDef.cardNo,
    effectIndex: 0,
    sourceInstanceId: "attacker-magic-negate",
    actingPlayerId: BOB,
    resumeStepIndex: 0,
    stepContext: { results: {} },
    targetInstanceIds: [],
    targetStepId: "__active_stack_target__",
    remainingStacks: [],
    deferredStackResolution: { deferredStack: candidateStack },
  };
  const options = {
    getCardDefinitionById: (id: string): CardDefinition | undefined =>
      id === negateMagicAttackerDef.cardNo ? negateMagicAttackerDef : undefined,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([]),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandCardEffectActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
  };
  return { state, continuation, options };
}

it("targetEffectTiming 未指定の negate request でも、disclosure 応答が magic candidateStack の chosenTiming を補って無効化する", () => {
  const { state, continuation, options } = negateMagicTestSetup();
  const stateWithDisclosure: GameState = {
    ...state,
    pendingTargetedDisclosureContinuation: continuation,
    pendingStackNegateRequests: [
      {
        requestId: "req:offfield-t14-negate-magic",
        actingPlayerId: ALICE,
        sourceInstanceId: "listener",
        negateTarget: "effect",
        createdAtStep: state.step,
        createdAtTurn: state.turnNumber,
      },
    ],
  };

  const result = resumeTargetedDisclosureIfReady(stateWithDisclosure, options);

  expect(
    result.log.some((entry) =>
      entry.startsWith("magic:nullified:chain:attacker-magic-negate:")
    )
  ).toBe(true);
  expect(
    result.log.some((entry) => entry.startsWith("effect:count_increase:"))
  ).toBe(false);
  expect(result.pendingStackNegateRequests).toHaveLength(0);
});

it("targetEffectTiming 未指定の negate request は、消費後も他の pending request の targetEffectTiming を汚染しない", () => {
  const { state, continuation, options } = negateMagicTestSetup();
  // colors:["blue"] は negateMagicAttackerDef (makeDef 既定 colors:["red"]) に一致しない
  // targetFilter。duration 付き (継続監視、非単発消費) のため、一致しなければ次回に
  // 持ち越されて残る。これで probe 注入が実際に元へ復元されたかを検証できる
  // (一致して消費されるだけの request では検証にならない)。
  const unrelatedRequest = {
    requestId: "req:unrelated-duration-scoped",
    actingPlayerId: ALICE,
    sourceInstanceId: "other-source",
    negateTarget: "effect" as const,
    targetFilter: { colors: ["blue" as const] },
    createdAtStep: state.step,
    createdAtTurn: state.turnNumber,
    duration: { scope: "step" as const },
  };
  const stateWithDisclosure: GameState = {
    ...state,
    pendingTargetedDisclosureContinuation: continuation,
    pendingStackNegateRequests: [unrelatedRequest],
  };

  const result = resumeTargetedDisclosureIfReady(stateWithDisclosure, options);

  const remaining = result.pendingStackNegateRequests.find(
    (r) => r.requestId === unrelatedRequest.requestId
  );
  expect(remaining).toBeDefined();
  expect(remaining!.targetEffectTiming).toBeUndefined();
});

const sourceCardResumeHostDef = makeDef({
  cardNo: "OFFFIELD-SOURCE-CARD-RESUME-HOST",
  name: "TEST source_card resume host",
});

const sourceCardResumeTextDef = makeDef({
  cardNo: "OFFFIELD-SOURCE-CARD-RESUME-TEXT",
  name: "TEST source_card resume text",
  printedCategory: "nexus",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { kind: "source_card" },
          },
        },
      ],
    },
  ],
});

it("targeted disclosure resume は source_card 参照の明示 override を executeEffect へ戻す", () => {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const host = createCardInstance(sourceCardResumeHostDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "resume-host",
    normalCoreCount: 1,
  });
  const textSource = createCardInstance(sourceCardResumeTextDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "resume-text-source",
    normalCoreCount: 1,
  });
  const state: GameState = {
    ...base,
    cardInstances: [host, textSource],
  };
  const continuation: TargetedDisclosureContinuation = {
    chainId: "test:engine-targeted-disclosure-offfield-source:747",
    pendingId: "targeted-disclosure:source-card-resume",
    sourceDefinitionId: sourceCardResumeTextDef.cardNo,
    effectIndex: 0,
    sourceInstanceId: "resume-host",
    effectSourceInstanceId: "resume-text-source",
    effectSourceDefinitionId: sourceCardResumeTextDef.cardNo,
    sourceCardReferenceInstanceId: "resume-text-source",
    actingPlayerId: ALICE,
    resumeStepIndex: 0,
    stepContext: { results: {} },
    targetInstanceIds: [],
    targetStepId: "__active_stack_target__",
    remainingStacks: [],
  };
  const defMap: Record<string, CardDefinition> = {
    [sourceCardResumeHostDef.cardNo]: sourceCardResumeHostDef,
    [sourceCardResumeTextDef.cardNo]: sourceCardResumeTextDef,
  };

  const result = resumeTargetedDisclosureIfReady(
    {
      ...state,
      pendingTargetedDisclosureContinuation: continuation,
    },
    {
      getCardDefinitionById: (id) => defMap[id],
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        sourceCardResumeTextDef,
      ]),
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredHandCardEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: () => [],
    }
  );

  const hostAfter = result.cardInstances.find(
    (card) => card.instanceId === "resume-host"
  );
  const textSourceAfter = result.cardInstances.find(
    (card) => card.instanceId === "resume-text-source"
  );
  expect(hostAfter?.zone).toBe("field");
  expect(hostAfter?.pendingLeaveKind).toBeNull();
  expect(textSourceAfter).toBeDefined();
  expect(
    textSourceAfter?.pendingLeaveKind === "destroy" ||
      textSourceAfter?.zone === "trash"
  ).toBe(true);
  expect(result.log).toContain("effect:destroy:player-1:resume-text-source");
  expect(result.log).not.toContain("effect:destroy:player-1:resume-host");
});

// adversarial verifier round2 lens2 指摘: condition:trigger_related_instance_off_field
// (round1 で追加) は宣言時 listing 段階 (trigger-system.ts の
// getAvailableTriggeredEffectSourceChoices、TriggerContext.relatedInstanceZone) では
// 正しく評価されるが、実プレイの解決実行時 (executeEffect の Condition 再評価
// ブロック、!isResume 時に実行) は options.triggerFromZone 等と同じ独立した
// triggerContext を構築しており、ExecuteEffectOptions.triggerRelatedInstanceZone が
// 注入されなければ常に fail-closed で発火しないという退化バグがあった
// (over-firing 修正のはずが total non-firing に退化)。resumeTargetedDisclosureIfReady
// を直接呼ぶ上記ユニットテストはこの再評価ブロックの分岐を通らないため検出できな
// かった (options.triggerRelatedInstanceZone を渡さない executeEffect 経由ではない)。
// ここでは executeEffect の condition 再評価ブロックを直接対象化し、
// options.triggerRelatedInstanceZone の有無で結果が変わることを確認する
// (legal-actions-apply.ts / stack-resolution-core.ts の各 sourceBackedResolver は
// これと同じ options フィールドへ pendingEffect.relatedInstanceId の現在ゾーンを
// 注入する形で fix 済み)。
const offFieldConditionEffect = {
  timing: { kind: "continuous" as const },
  condition: [{ kind: "trigger_related_instance_off_field" as const }],
  steps: [
    {
      action: {
        kind: "count_increase" as const,
        player: "self" as const,
        amount: 1,
      },
    },
  ],
};

it("executeEffect の condition 再評価は options.triggerRelatedInstanceZone が無いと fail-closed で発火しない (修正前の退化を再現)", () => {
  const state = offFieldOnlyState("hand");

  const result = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:833",
    state,
    effect: offFieldConditionEffect,
    sourceInstanceId: "listener",
    actingPlayerId: ALICE,
    getCardDefinitionById: getD3,
    getRegisteredTriggeredEffectActions: offFieldOnlyLookup,
    // triggerRelatedInstanceZone 未指定 (旧 legal-actions-apply.ts / stack-resolution-core.ts
    // の状態を再現)。
  });

  expect(
    result.log.some((entry) => entry.startsWith("effect:condition-unmet:"))
  ).toBe(true);
  expect(
    result.log.some((entry) => entry.startsWith("effect:count_increase:"))
  ).toBe(false);
});

it("executeEffect の condition 再評価は options.triggerRelatedInstanceZone を渡すと、フィールド以外の対象で正しく成立する", () => {
  const state = offFieldOnlyState("hand");

  const result = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:855",
    state,
    effect: offFieldConditionEffect,
    sourceInstanceId: "listener",
    actingPlayerId: ALICE,
    getCardDefinitionById: getD3,
    getRegisteredTriggeredEffectActions: offFieldOnlyLookup,
    // legal-actions-apply.ts / stack-resolution-core.ts の各 sourceBackedResolver が
    // pendingEffect.relatedInstanceId (= off-field-cb, zone:"hand") から都度導出する値。
    triggerRelatedInstanceZone: "hand",
  });

  expect(
    result.log.some((entry) => entry.startsWith("effect:count_increase:"))
  ).toBe(true);
  expect(
    result.log.some((entry) => entry.startsWith("effect:condition-unmet:"))
  ).toBe(false);
});

it("executeEffect の condition 再評価は options.triggerRelatedInstanceZone が field なら不成立のまま (過剰発火防止が解決時にも効く)", () => {
  const state = offFieldOnlyState("field");

  const result = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:878",
    state,
    effect: offFieldConditionEffect,
    sourceInstanceId: "listener",
    actingPlayerId: ALICE,
    getCardDefinitionById: getD3,
    getRegisteredTriggeredEffectActions: offFieldOnlyLookup,
    triggerRelatedInstanceZone: "field",
  });

  expect(
    result.log.some((entry) => entry.startsWith("effect:condition-unmet:"))
  ).toBe(true);
  expect(
    result.log.some((entry) => entry.startsWith("effect:count_increase:"))
  ).toBe(false);
});

// P3-130: queue 時点 (窓が開いている) と declare 時点 (resolve_pending_triggered_effect
// の宣言可否判定、P3-34 により窓クローズ後にしか呼ばれない) の両方から
// getAvailableTriggeredEffectSourceChoices が呼ばれる。isInstanceInOpenResponseWindow を
// 都度re-deriveすると、declare 時点は窓が必ず閉じているため恒久的に false になり、
// 実カード + 実 legal action パイプラインでは宣言候補が一切現れない到達不能バグがあった。
// relatedInstanceOffFieldActivating の queue時スナップショットで declare 時点でも
// 宣言候補として現れることを確認する。
it("P3-130: 応答窓クローズ後 (declare-time) でも、queue 時にスナップショットされた off-field 対象の宣言候補が消えない", () => {
  const state = baseState(true);

  const disclosure = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:906",
    state,
    effect: attackerMagicDef.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "attacker-magic",
    actingPlayerId: BOB,
    getCardDefinitionById: getD,
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredBurstActions: () => [],
    targetInstanceIds: ["off-field-cb"],
    targetStepId: "target-select",
    effectActionKind: "magic",
  });

  const queuedPendingEffect = disclosure.pendingTriggeredEffects.find(
    (p) => p.eventKind === "targeted" && p.relatedInstanceId === "off-field-cb"
  );
  expect(queuedPendingEffect).toBeDefined();
  // queue 時点でスナップショットされている (window はまだ開いている)。
  expect(queuedPendingEffect?.relatedInstanceOffFieldActivating).toBe(true);

  // P3-34: resolve_pending_triggered_effect が declare 可能になる時点では、
  // stack window は既にクローズしている (両者パス後)。
  const declareTimeState: GameState = {
    ...disclosure,
    stackWindow: null,
  };

  const choicesWithSnapshot = getAvailableTriggeredEffectSourceChoices({
    state: declareTimeState,
    pendingEffect: queuedPendingEffect!,
    getCardDefinitionById: getD,
    getRegisteredTriggeredEffectActions: lookup,
  });
  expect(
    choicesWithSnapshot.some(
      (choice) => choice.sourceCard.instanceId === "listener"
    )
  ).toBe(true);

  // 回帰ガード: スナップショットが無い (修正前相当) pendingEffect だと、
  // 窓クローズ後は同じ現在状態でも宣言候補が消える (P3-130 が発見した実際のバグ)。
  const pendingEffectWithoutSnapshot = {
    ...queuedPendingEffect!,
    relatedInstanceOffFieldActivating: undefined,
  };
  const choicesWithoutSnapshot = getAvailableTriggeredEffectSourceChoices({
    state: declareTimeState,
    pendingEffect: pendingEffectWithoutSnapshot,
    getCardDefinitionById: getD,
    getRegisteredTriggeredEffectActions: lookup,
  });
  expect(
    choicesWithoutSnapshot.some(
      (choice) => choice.sourceCard.instanceId === "listener"
    )
  ).toBe(false);
});

const resumeTargetMagicDef = makeDef({
  cardNo: "TARGETED-DISCLOSURE-RESUME-MAGIC",
  name: "対象開示再開テストマジック",
  printedCategory: "magic",
  cost: 0,
  levelDefs: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          id: "chosen-target",
          action: {
            kind: "send_to_deck",
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
});

const resumeTargetDef = makeDef({
  cardNo: "TARGETED-DISCLOSURE-RESUME-TARGET",
  name: "対象開示再開テスト対象",
});

function resumeTargetedMagicState(options: {
  targetZone: "field" | "hand";
  targetGetsCannotBeTargeted?: boolean;
}): {
  state: GameState;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
} {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const magic = createCardInstance(resumeTargetMagicDef, {
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "in_use",
    instanceId: "resume-target-magic",
  });
  const target = createCardInstance(resumeTargetDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: options.targetZone,
    instanceId: "resume-target",
    ...(options.targetZone === "field" ? { normalCoreCount: 1 } : {}),
  });
  const targetLock: ContinuousEffect[] = options.targetGetsCannotBeTargeted
    ? [
        {
          effectId: "ce:target-lock-gained-during-response",
          sourceInstanceId: "resume-target",
          sourceDefinitionId: resumeTargetDef.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "cannot_be_targeted" as ContinuousEffectTag,
          targetInstanceId: "resume-target",
          metadata: { source: "opponent_effect" },
        },
      ]
    : [];
  const deferredStack: ActiveStack = {
    stackId: "stack:targeted-disclosure-resume-magic",
    actionKind: "magic",
    chainId: "chain:targeted-disclosure-resume-magic",
    actingPlayerId: BOB,
    cardInstanceId: "resume-target-magic",
    cardDefinitionId: resumeTargetMagicDef.cardNo,
    targetInstanceIds: ["resume-target"],
    targetStepId: "chosen-target",
    candidateTargetZones: ["field"],
    targetEffectFilterTags: ["general"],
    chosenTiming: "flash",
    magicEffectIndex: 0,
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const continuation: TargetedDisclosureContinuation = {
    chainId: "test:engine-targeted-disclosure-offfield-source:1050",
    pendingId: "targeted-disclosure:resume-magic",
    sourceDefinitionId: resumeTargetMagicDef.cardNo,
    effectIndex: 0,
    sourceInstanceId: "resume-target-magic",
    actingPlayerId: BOB,
    resumeStepIndex: 0,
    stepContext: { results: {} },
    targetInstanceIds: ["resume-target"],
    targetZonesByInstanceId: { "resume-target": "field" },
    targetStepId: "chosen-target",
    remainingStacks: [],
    deferredStackResolution: { deferredStack },
  };
  const defs: Record<string, CardDefinition> = {
    [resumeTargetMagicDef.cardNo]: resumeTargetMagicDef,
    [resumeTargetDef.cardNo]: resumeTargetDef,
  };
  return {
    state: {
      ...base,
      cardInstances: [magic, target],
      activeContinuousEffects: targetLock,
      pendingTargetedDisclosureContinuation: continuation,
    },
    getCardDefinitionById: (id) => defs[id],
  };
}

function resumeTargetedMagicContinuation(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
) {
  return resumeTargetedDisclosureIfReady(state, {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([]),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandCardEffectActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
  });
}

it("targeted disclosure 後に得た cannot_be_targeted は、宣言済み magic TargetRef の再取得を妨げない", () => {
  const { state, getCardDefinitionById } = resumeTargetedMagicState({
    targetZone: "field",
    targetGetsCannotBeTargeted: true,
  });

  const directResume = executeEffect({
    chainId: "test:engine-targeted-disclosure-offfield-source:1099",
    state: { ...state, pendingTargetedDisclosureContinuation: null },
    effect: resumeTargetMagicDef.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "resume-target-magic",
    actingPlayerId: BOB,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([]),
    getRegisteredBurstActions: () => [],
    targetInstanceIds: ["resume-target"],
    targetStepId: "chosen-target",
    targetSelectionResolved: true,
    preservePreSelectedTargetRefs: true,
    skipTargetedDisclosureAtStartStep: true,
    skipTargetedDisclosureStepId: "chosen-target",
    effectActionKind: "magic",
  });
  expect(
    resolveTargets(
      resumeTargetMagicDef.effects![0]!.steps![0]!.action,
      state,
      BOB,
      "resume-target-magic",
      getCardDefinitionById,
      { results: {} },
      ["resume-target"],
      resumeTargetMagicDef,
      undefined,
      undefined,
      undefined,
      true,
      0,
      "chosen-target",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    )
  ).toEqual(["resume-target"]);
  expect(
    directResume.pendingLeaveEntities.some(
      (pending) => pending.instanceId === "resume-target"
    )
  ).toBe(true);

  const result = resumeTargetedMagicContinuation(state, getCardDefinitionById);

  expect(result.log.join("\n")).toContain(
    "effect:send_to_deck:player-2:resume-target"
  );
  expect(
    result.cardInstances.find((card) => card.instanceId === "resume-target")
      ?.zone
  ).toBe("deck");
  expect(result.pendingTargetedDisclosureContinuation).toBeNull();
});

it("targeted disclosure 後に対象が選択時 zone を離れた場合、元の magic はその instance を処理しない", () => {
  const { state, getCardDefinitionById } = resumeTargetedMagicState({
    targetZone: "hand",
  });

  const result = resumeTargetedMagicContinuation(state, getCardDefinitionById);

  expect(
    result.cardInstances.find((card) => card.instanceId === "resume-target")
      ?.zone
  ).toBe("hand");
  expect(result.pendingTargetedDisclosureContinuation).toBeNull();
});

it("通常 effect の targeted disclosure 再開でも、対象が選択時 zone を離れたら処理しない", () => {
  const { state, getCardDefinitionById } = resumeTargetedMagicState({
    targetZone: "hand",
  });
  const continuation = state.pendingTargetedDisclosureContinuation!;
  const {
    deferredStackResolution: _deferredStackResolution,
    ...normalContinuation
  } = continuation;

  const result = resumeTargetedMagicContinuation(
    {
      ...state,
      pendingTargetedDisclosureContinuation: normalContinuation,
    },
    getCardDefinitionById
  );

  expect(
    result.cardInstances.find((card) => card.instanceId === "resume-target")
      ?.zone
  ).toBe("hand");
  expect(result.pendingTargetedDisclosureContinuation).toBeNull();
});

const resumeTargetDivineDef = makeDef({
  cardNo: "TARGETED-DISCLOSURE-RESUME-DIVINE",
  name: "対象開示再開テスト神技",
  printedCategory: "nexus",
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
    divineSkills: [
      {
        label: "divine_skill",
        coreCost: 0,
        timing: "flash",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                id: "chosen-target",
                action: {
                  kind: "send_to_deck",
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
      },
    ],
  },
});

it("神技の targeted disclosure 再開でも、後から得た target lock で宣言済み TargetRef を落とさない", () => {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const source = createCardInstance(resumeTargetDivineDef, {
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    instanceId: "resume-target-divine",
  });
  const target = createCardInstance(resumeTargetDef, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "resume-target-divine-target",
    normalCoreCount: 1,
  });
  const deferredStack: ActiveStack = {
    stackId: "stack:targeted-disclosure-resume-divine",
    actionKind: "divine_skill",
    chainId: "chain:targeted-disclosure-resume-divine",
    actingPlayerId: BOB,
    cardInstanceId: source.instanceId,
    cardDefinitionId: resumeTargetDivineDef.cardNo,
    targetInstanceIds: [target.instanceId],
    targetStepId: "chosen-target",
    candidateTargetZones: ["field"],
    targetEffectFilterTags: ["general"],
    divineSkillIndex: 0,
    divineSkillCoreCost: 0,
    divineSkillLabel: "divine_skill",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const defs: Record<string, CardDefinition> = {
    [resumeTargetDivineDef.cardNo]: resumeTargetDivineDef,
    [resumeTargetDef.cardNo]: resumeTargetDef,
  };

  const result = resumeTargetedMagicContinuation(
    {
      ...base,
      cardInstances: [source, target],
      activeContinuousEffects: [
        {
          effectId: "ce:divine-target-lock-gained-during-response",
          sourceInstanceId: target.instanceId,
          sourceDefinitionId: resumeTargetDef.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "cannot_be_targeted" as ContinuousEffectTag,
          targetInstanceId: target.instanceId,
          metadata: { source: "opponent_effect" },
        },
      ],
      pendingTargetedDisclosureContinuation: {
        chainId: "test:engine-targeted-disclosure-offfield-source:1290",
        pendingId: "targeted-disclosure:resume-divine",
        sourceDefinitionId: resumeTargetDivineDef.cardNo,
        effectIndex: 0,
        sourceInstanceId: source.instanceId,
        actingPlayerId: BOB,
        resumeStepIndex: 0,
        stepContext: { results: {} },
        targetInstanceIds: [target.instanceId],
        targetZonesByInstanceId: { [target.instanceId]: "field" },
        targetStepId: "chosen-target",
        remainingStacks: [],
        deferredStackResolution: { deferredStack },
      },
    },
    (id) => defs[id]
  );

  expect(
    result.cardInstances.find((card) => card.instanceId === target.instanceId)
      ?.zone
  ).toBe("deck");
});

it("redirect 後も残る対象は、targeted disclosure 開始時の zone snapshot を保持する", () => {
  const redirectA = makeDef({ cardNo: "REDIRECT-SNAPSHOT-A", name: "A" });
  const redirectB = makeDef({ cardNo: "REDIRECT-SNAPSHOT-B", name: "B" });
  const redirectC = makeDef({ cardNo: "REDIRECT-SNAPSHOT-C", name: "C" });
  const magic = createCardInstance(resumeTargetMagicDef, {
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "in_use",
    instanceId: "redirect-snapshot-magic",
  });
  const a = createCardInstance(redirectA, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "redirect-snapshot-a",
  });
  const b = createCardInstance(redirectB, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
    instanceId: "redirect-snapshot-b",
  });
  const c = createCardInstance(redirectC, {
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    instanceId: "redirect-snapshot-c",
  });
  const defs: Record<string, CardDefinition> = {
    [resumeTargetMagicDef.cardNo]: resumeTargetMagicDef,
    [redirectA.cardNo]: redirectA,
    [redirectB.cardNo]: redirectB,
    [redirectC.cardNo]: redirectC,
  };
  const beforeRedirect: GameState = {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: [magic, a, b, c],
    pendingTargetedDisclosureContinuation: {
      chainId: "test:engine-targeted-disclosure-offfield-source:1351",
      pendingId: "targeted-disclosure:redirect-snapshot",
      sourceDefinitionId: resumeTargetMagicDef.cardNo,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: BOB,
      resumeStepIndex: 0,
      stepContext: { results: {} },
      targetInstanceIds: [a.instanceId, b.instanceId],
      targetCandidateInstanceIds: [a.instanceId, b.instanceId, c.instanceId],
      targetZonesByInstanceId: {
        [a.instanceId]: "field",
        [b.instanceId]: "field",
      },
      targetStepId: "chosen-target",
      remainingStacks: [],
      deferredStackResolution: {
        deferredStack: {
          stackId: "stack:targeted-disclosure-redirect-snapshot",
          actionKind: "magic",
          chainId: "chain:targeted-disclosure-redirect-snapshot",
          actingPlayerId: BOB,
          cardInstanceId: magic.instanceId,
          cardDefinitionId: resumeTargetMagicDef.cardNo,
          targetInstanceIds: [a.instanceId, b.instanceId],
          targetStepId: "chosen-target",
          candidateTargetZones: ["field"],
          targetEffectFilterTags: ["general"],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
      },
    },
  };
  const redirected = executeRedirectTarget(
    {
      kind: "redirect_target",
      from: {
        kind: "filter",
        player: "opponent",
        filter: { cardName: { exact: "A" } },
        count: 1,
      },
      to: {
        kind: "filter",
        player: "opponent",
        filter: { cardName: { exact: "C" } },
        count: 1,
      },
      mode: "matching",
    },
    beforeRedirect,
    BOB,
    magic.instanceId,
    (id) => defs[id],
    { results: {} }
  );

  expect(
    redirected.pendingTargetedDisclosureContinuation?.targetInstanceIds
  ).toEqual([c.instanceId, b.instanceId]);
  expect(
    redirected.pendingTargetedDisclosureContinuation?.targetZonesByInstanceId
  ).toEqual({ [c.instanceId]: "field", [b.instanceId]: "field" });

  const resumed = resumeTargetedMagicContinuation(redirected, (id) => defs[id]);
  expect(
    resumed.cardInstances.find((card) => card.instanceId === c.instanceId)?.zone
  ).toBe("deck");
  expect(
    resumed.cardInstances.find((card) => card.instanceId === b.instanceId)?.zone
  ).toBe("hand");
});
