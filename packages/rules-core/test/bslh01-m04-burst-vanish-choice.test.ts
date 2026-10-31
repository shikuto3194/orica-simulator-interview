import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSLH01-M04「[碧の軌跡]シャーリー・オルランド」effects[0]
 * 【バースト：相手によって自分のスピリットがフィールドを離れた後】:
 * 「このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずに
 * セットする。その後、相手のスピリット/アルティメット2体を消滅させる。消滅する対象の
 * コアすべてはリザーブに置かれる。」
 *
 * BSLH01-R05[0] (choice: summon(self,free) / quartz_set(self,free)) と同型パターン。
 * vanish はコアがリザーブに置かれる既定挙動（VanishAction コメント）でそのまま満たすため
 * coreDestination 等の追加フィールドは不要。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import type { BattleImmediateEffectLegalAction } from "../src/legal/legal-actions-types";
import { flushPendingLeaves } from "../src/state-based-actions";
import type {
  CardDefinition,
  GameState,
  PendingBurstCheck,
  PendingTriggeredEffect,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

const M04 = card("BSLH01-M04");
const UNSEAL_GRANDSTONE = card("BSTH001-転醒R01(A)");

function alice(state: GameState) {
  return state.players.find((p) => p.id === ALICE)!;
}
function bob(state: GameState) {
  return state.players.find((p) => p.id === BOB)!;
}

const hostDef: CardDefinition = {
  cardNo: "TEST-M04-QUARTZ-HOST",
  name: "テスト魂状態ホスト",
  printedCategory: "brave",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  quartzHostData: { slots: { left: 3, center: 1, right: 3 } },
};

const opponentSpirit: CardDefinition = {
  cardNo: "TEST-M04-OPPONENT-SPIRIT",
  name: "テスト相手スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "game_event", event: "increase_hand", player: "self" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 0 } },
      ],
    },
  ],
};

const defs = new Map<string, CardDefinition>([
  [hostDef.cardNo, hostDef],
  [opponentSpirit.cardNo, opponentSpirit],
]);
const getCardDefinitionById = (id: string) => defs.get(id) ?? getDef(id);
const burstLookup = buildBurstEffectLookup([M04]);
const burstActionOptions = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
    opponentSpirit,
  ]),
  getRegisteredBurstActions: burstLookup,
  getRegisteredFieldCardEffectActions: noLookup,
  getRegisteredHandActivatedEffectActions: noLookup,
  getRegisteredMagicActions: noLookup,
};

function buildState(options: { withHost: boolean }): GameState {
  const m04 = createCardInstance(M04, {
    instanceId: "m04-self",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const opp1 = createCardInstance(opponentSpirit, {
    instanceId: "opp-spirit-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 2,
  });
  const opp2 = createCardInstance(opponentSpirit, {
    instanceId: "opp-spirit-2",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const cardInstances = [m04, opp1, opp2];
  const soulStateInstanceIds: string[] = [];
  if (options.withHost) {
    const host = createCardInstance(hostDef, {
      instanceId: "m04-host",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    cardInstances.push(host);
    soulStateInstanceIds.push("m04-host");
  }
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [{ countValue: 0 }, {}],
  });
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, soulStateInstanceIds } : p
    ),
  };
}

function buildBurstChoiceState(): GameState {
  const m04 = createCardInstance(M04, {
    instanceId: "m04-burst",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "burst",
  });
  const host = createCardInstance(hostDef, {
    instanceId: "m04-host",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
  });
  const target1 = createCardInstance(opponentSpirit, {
    instanceId: "alice-spirit-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const target2 = createCardInstance(opponentSpirit, {
    instanceId: "alice-spirit-2",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const leftSpirit = createCardInstance(opponentSpirit, {
    instanceId: "bob-left-spirit",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "trash",
  });
  const pendingBurstCheck: PendingBurstCheck = {
    checkId: "burst:test:m04-choice",
    actingPlayerId: BOB,
    eventKind: "leave_field",
    event: {
      family: "leave_field",
      cause: "battle",
      validationMode: "snapshot_only",
    },
    source: "battle_resolution",
    chainId: "battle:test:m04-choice",
    attackId: "attack:test:m04-choice",
    relatedPlayerId: BOB,
    relatedInstanceId: "bob-left-spirit",
    amount: 0,
    step: "attack",
    window: "battle",
    resolvedBurstCardInstanceIds: [],
  };
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [m04, host, target1, target2, leftSpirit],
    playerOverrides: [{}, { countValue: 0 }],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "attack",
    window: "battle",
    setBurstStates: [{ playerId: BOB, cardInstanceId: "m04-burst" }],
    pendingBurstChecks: [pendingBurstCheck],
    players: base.players.map((player) =>
      player.id === BOB
        ? { ...player, soulStateInstanceIds: ["m04-host"] }
        : player
    ),
  };
}

function findM04BurstAction(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: BOB,
    ...burstActionOptions,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_burst_check" &&
      candidate.sourceInstanceId === "m04-burst" &&
      candidate.deferredChoiceIndexes?.includes(1)
  );
  expect(action).toBeDefined();
  return action!;
}

function passStack(state: GameState): GameState {
  const priorityPlayerId = state.stackWindow?.priorityPlayerId;
  expect(priorityPlayerId).toBeDefined();
  const action = getLegalActions({
    state,
    actingPlayerId: priorityPlayerId!,
    ...burstActionOptions,
  }).find((candidate) => candidate.kind === "pass_stack");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...burstActionOptions,
  }).state;
}

function pendingNoopTrigger(): PendingTriggeredEffect {
  return {
    pendingId: "trigger:test:remaining-before-burst-effect",
    actingPlayerId: ALICE,
    eventKind: "increase_hand",
    source: "battle_resolution",
    chainId: "battle:test:remaining-before-burst-effect",
    attackId: "attack:test:m04-choice",
    relatedPlayerId: ALICE,
    relatedInstanceId: null,
    amount: null,
    step: "attack",
    window: "battle",
    resolvedSourceInstanceIds: [],
  };
}

function pendingOptionalUnsealTrigger(): PendingTriggeredEffect {
  return {
    pendingId: "trigger:test:unseal-before-burst-effect",
    actingPlayerId: ALICE,
    eventKind: "unseal",
    event: { family: "action_after", actionKind: "attack" },
    source: "action_resolution",
    chainId: "battle:test:unseal-before-burst-effect",
    attackId: "attack:test:m04-choice",
    relatedPlayerId: ALICE,
    relatedInstanceId: "unseal-attacker",
    amount: null,
    step: "attack",
    window: "battle",
    resolvedSourceInstanceIds: [],
    mechanic: {
      kind: "unseal",
      grandstoneInstanceId: "unseal-grandstone",
      triggerEvent: "attack",
      triggerCardInstanceId: "unseal-attacker",
    },
  };
}

describe("BSLH01-M04 effects[0]: burst choice(summon/quartz_set free) + opponent vanish x2 (core to reserve)", () => {
  it("stub フィールドが解消されている", () => {
    expect(M04.effects![0]!.stub).toBeUndefined();
  });

  it("burst trigger は「相手によって自分のスピリットがフィールドを離れた後」を表す構造化 trigger", () => {
    expect(M04.effects![0]!.timing).toMatchObject({
      kind: "burst",
      trigger: { kind: "spirit_destroyed", player: "self" },
      triggerFilter: { category: ["spirit"] },
      cause: ["opponent_effect", "battle"],
    });
  });

  it("[board] choiceIndex 0: コストなし召喚→相手スピリット2体消滅、コアはリザーブへ", () => {
    const state = buildState({ withHost: false });
    const reserveBefore = bob(state).reserveNormalCoreCount;

    const after = flushPendingLeaves(
      executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-m04-burst-vanish-choice:320",
        state,
        effect: M04.effects![0]!,
        sourceInstanceId: "m04-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 0,
      }),
      getCardDefinitionById
    );

    const m04After = after.cardInstances.find(
      (c) => c.instanceId === "m04-self"
    )!;
    expect(m04After.zone).toBe("field");

    const opp1After = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit-1"
    )!;
    const opp2After = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit-2"
    )!;
    expect(opp1After.zone).toBe("trash");
    expect(opp2After.zone).toBe("trash");
    expect(opp1After.normalCoreCount).toBe(0);
    expect(opp2After.normalCoreCount).toBe(0);
    // 消滅した2体分のコア(2+1=3)は持ち主(相手=BOB)のリザーブへ。
    expect(bob(after).reserveNormalCoreCount).toBe(reserveBefore + 3);
  });

  it("[board] choiceIndex 1: 魂状態の対象にコストを支払わずにクォーツセットしても消滅は独立に成立する", () => {
    const state = buildState({ withHost: true });

    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bslh01-m04-burst-vanish-choice:355",
        state,
        effect: M04.effects![0]!,
        sourceInstanceId: "m04-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 1,
      }),
      getCardDefinitionById
    );

    const m04After = after.cardInstances.find(
      (c) => c.instanceId === "m04-self"
    )!;
    expect(m04After.zone).toBe("field");
    expect(m04After.zoneRoleName).toBe("quartz");
    expect(
      after.quartzSetStates.some(
        (q) =>
          q.quartzInstanceId === "m04-self" && q.hostInstanceId === "m04-host"
      )
    ).toBe(true);
    // free:true のため countCost は支払われず 0 のまま。
    expect(alice(after).countValue).toBe(0);

    const opp1After = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit-1"
    )!;
    const opp2After = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit-2"
    )!;
    expect(opp1After.zone).toBe("trash");
    expect(opp2After.zone).toBe("trash");
  });

  it("[stack] バースト発動後は残り誘発を待ってからバースト発揮宣言スタックへ進む", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    expect(declared.stackWindow?.burstWindowKind).toBe("activation");
    expect(declared.pendingStepChoice).toBeNull();

    const withRemainingTrigger: GameState = {
      ...declared,
      pendingTriggeredEffects: [pendingNoopTrigger()],
    };
    const delayed = passStack(withRemainingTrigger);

    expect(delayed.stackWindow).toBeNull();
    expect(delayed.pendingStepChoice).toBeNull();
    expect(
      delayed.pendingStackCascade?.remainingStacks[0]
        ?.burstEffectDeclarationPending
    ).toBe(true);

    const afterRemainingTrigger = resumeStackCascadeIfReady(
      {
        ...delayed,
        pendingTriggeredEffects: [],
      },
      burstActionOptions
    );

    expect(afterRemainingTrigger.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    expect(afterRemainingTrigger.pendingStepChoice).toBeNull();
  });

  it("[EDH-0022] after_triggers 中の :effect-decl バーストを自己待機させず解決する", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    const afterActivationStack = passStack(declared);
    expect(afterActivationStack.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    const burstCheck = afterActivationStack.pendingBurstChecks[0]!;
    const parentLeaveChainId = "battle:test";
    const withSameChainAfterTriggers: GameState = {
      ...afterActivationStack,
      cardInstances: afterActivationStack.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "m04-host"
          ? {
              ...cardInstance,
              pendingLeaveKind: "vanish",
              pendingLeaveCause: "effect_resolution",
              pendingLeaveChainId: parentLeaveChainId,
              deferZoneMoveUntilChainEnd: true,
            }
          : cardInstance
      ),
      pendingLeaveEntities: [
        {
          instanceId: "m04-host",
          kind: "vanish",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: parentLeaveChainId,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
          reactionChainIds: [burstCheck.chainId!],
        },
      ],
      pendingAfterTriggersContinuations: [
        {
          chainId: "test:bslh01-m04-burst-vanish-choice:467",
          continuationId: "after-triggers:edh-0022",
          waitChainId: burstCheck.chainId!,
          sourceDefinitionId: M04.cardNo,
          effectIndex: 0,
          // 解決後に drain されることを調べるための最小の継続。
          // 実際の after_triggers と同じく、通常バースト本体より先に継続を解決する。
          resumeEffectOverride: { timing: { kind: "continuous" }, steps: [] },
          sourceInstanceId: "m04-burst",
          actingPlayerId: BOB,
          resumeStepIndex: 0,
          stepContext: { results: {} },
        },
      ],
    };

    // 実際の effect-declaration window を pass して、選択済み burst と同じ
    // after_triggers が相互待機せずバースト本体の選択まで進むことを確認する。
    const resumed = passStack(withSameChainAfterTriggers);

    // バースト本体の選択へ到達している。pending check は効果解決完了時に消費するため、
    // この段階では残っていてよい。
    expect(resumed.pendingStepChoice?.sourceInstanceId).toBe("m04-burst");
    expect(resumed.pendingBurstChecks).toHaveLength(1);
    expect(resumed.pendingAfterTriggersContinuations).toHaveLength(0);
    // 親 chain の待機離脱・発揮後は通常バースト本体より先に完了する。
    expect(resumed.pendingLeaveEntities).toHaveLength(0);
    expect(resumed.pendingStackCascade).toBeNull();

    const choiceAction = getLegalActions({
      state: resumed,
      actingPlayerId: BOB,
      ...burstActionOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === 1
    );
    expect(choiceAction).toBeDefined();
    const afterChoice = applyLegalAction({
      state: resumed,
      action: choiceAction!,
      ...burstActionOptions,
    }).state;
    const drained = resumeStackCascadeIfReady(afterChoice, burstActionOptions);

    expect(drained.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(drained.pendingLeaveEntities).toHaveLength(0);
    expect(
      drained.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "m04-host"
      )?.zone
    ).toBe("trash");
    expect(drained.pendingStackCascade).toBeNull();
  });

  it("[EDH-0022] 同じ親 chain の無関係な待機離脱はバースト解決前の blocker に残す", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    const afterActivationStack = passStack(declared);
    const burstCheck = afterActivationStack.pendingBurstChecks[0]!;
    const parentLeaveChainId = "battle:test";
    const withSiblingLeave: GameState = {
      ...afterActivationStack,
      cardInstances: [
        ...afterActivationStack.cardInstances.map((cardInstance) =>
          cardInstance.instanceId === "m04-host"
            ? {
                ...cardInstance,
                pendingLeaveKind: "vanish",
                pendingLeaveCause: "effect_resolution",
                pendingLeaveChainId: parentLeaveChainId,
                deferZoneMoveUntilChainEnd: true,
              }
            : cardInstance
        ),
        createCardInstance(hostDef, {
          instanceId: "m04-unrelated-sibling",
          ownerPlayerId: ALICE,
          zone: "field",
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "effect_resolution",
          pendingLeaveChainId: parentLeaveChainId,
          deferZoneMoveUntilChainEnd: true,
        }),
      ],
      pendingLeaveEntities: [
        {
          instanceId: "m04-host",
          kind: "vanish",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: parentLeaveChainId,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
          reactionChainIds: [burstCheck.chainId!],
        },
        {
          instanceId: "m04-unrelated-sibling",
          kind: "vanish",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: parentLeaveChainId,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
          reactionChainIds: ["unrelated:reaction"],
        },
      ],
      // A global resolution keeps both leaves pending without introducing a
      // separate burst-effect blocker. The selected burst may ignore only
      // the leave whose reaction chain explicitly contains its own chain.
      effectQueueEntries: [
        {
          kind: "resolve",
          scope: "global",
          stage: "unrelated-sibling-leave",
          chainId: null,
        },
      ],
    };

    const blocked = passStack(withSiblingLeave);

    expect(blocked.pendingStepChoice).toBeNull();
    expect(blocked.stackWindow).toBeNull();
    expect(blocked.pendingLeaveEntities).toHaveLength(2);
    expect(blocked.pendingStackCascade?.remainingStacks[0]?.burstCheckId).toBe(
      burstCheck.checkId
    );
  });

  it("[stack] 最後の任意アタック時効果を辞退した後に待機バーストを自動で再開する", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    const delayed = passStack({
      ...declared,
      pendingTriggeredEffects: [pendingNoopTrigger()],
    });

    const promptId = "battle-immediate:test:optional-drain";
    const withLastBattleImmediate: GameState = {
      ...delayed,
      pendingTriggeredEffects: [],
      battleImmediateEffects: [
        {
          promptId,
          attackId: "attack:test:m04-choice",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "optional-battle-source",
          sourceDefinitionId: opponentSpirit.cardNo,
          sourceCardNo: opponentSpirit.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:test",
          registrationIndex: 0,
          executionMode: "optional",
        },
      ],
    };
    const skipAction: BattleImmediateEffectLegalAction = {
      kind: "resolve_battle_immediate_effect",
      actionId: `${promptId}:skip`,
      can: true,
      reason: "legal_battle_immediate_attack_effect_skip_only",
      actingPlayerId: ALICE,
      promptId,
      attackId: "attack:test:m04-choice",
      timing: "attack",
      sourceKind: "spirit",
      sourceInstanceId: "optional-battle-source",
      sourceDefinitionId: opponentSpirit.cardNo,
      sourceCardNo: opponentSpirit.cardNo,
      participantEntityId: "battle-entity:test",
      executionMode: "optional",
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: ["general"],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    };

    const afterSkip = applyLegalAction({
      state: withLastBattleImmediate,
      action: skipAction,
      skipOptionalEffect: true,
      ...burstActionOptions,
    }).state;

    expect(afterSkip.battleImmediateEffects).toHaveLength(0);
    expect(afterSkip.stackWindow?.burstWindowKind).toBe("effect_declaration");
    expect(afterSkip.pendingBurstChecks).toHaveLength(1);
  });

  it("[stack] 最後の任意解封を辞退した後にも待機バーストを自動で再開する", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    const delayed = passStack({
      ...declared,
      pendingTriggeredEffects: [pendingNoopTrigger()],
    });
    const withOptionalUnseal: GameState = {
      ...delayed,
      cardInstances: [
        ...delayed.cardInstances,
        createCardInstance(UNSEAL_GRANDSTONE, {
          instanceId: "unseal-grandstone",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        }),
      ],
      pendingTriggeredEffects: [pendingOptionalUnsealTrigger()],
    };
    const skipAction = getLegalActions({
      state: withOptionalUnseal,
      actingPlayerId: ALICE,
      ...burstActionOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.pendingId === "trigger:test:unseal-before-burst-effect"
    );
    expect(skipAction).toBeDefined();

    const afterSkip = applyLegalAction({
      state: withOptionalUnseal,
      action: skipAction!,
      skipOptionalEffect: true,
      ...burstActionOptions,
    }).state;

    expect(afterSkip.pendingTriggeredEffects).toHaveLength(0);
    expect(afterSkip.stackWindow?.burstWindowKind).toBe("effect_declaration");
    expect(afterSkip.pendingBurstChecks).toHaveLength(1);
  });

  it("[stack] 任意解封を受諾した場合は解封の宣言・解決後に待機バーストを再開する", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    const delayed = passStack({
      ...declared,
      pendingTriggeredEffects: [pendingNoopTrigger()],
    });
    const withOptionalUnseal: GameState = {
      ...delayed,
      cardInstances: [
        ...delayed.cardInstances,
        createCardInstance(UNSEAL_GRANDSTONE, {
          instanceId: "unseal-grandstone",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        }),
      ],
      pendingTriggeredEffects: [pendingOptionalUnsealTrigger()],
    };
    const acceptAction = getLegalActions({
      state: withOptionalUnseal,
      actingPlayerId: ALICE,
      ...burstActionOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.pendingId === "trigger:test:unseal-before-burst-effect"
    );
    expect(acceptAction).toBeDefined();

    const afterDeclaration = applyLegalAction({
      state: withOptionalUnseal,
      action: acceptAction!,
      ...burstActionOptions,
    }).state;
    expect(afterDeclaration.stackWindow?.burstWindowKind).not.toBe(
      "effect_declaration"
    );
    expect(afterDeclaration.pendingBurstChecks).toHaveLength(1);

    const afterUnsealResolution = passStack(afterDeclaration);
    expect(afterUnsealResolution.pendingTriggeredEffects).toHaveLength(0);
    expect(afterUnsealResolution.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    expect(afterUnsealResolution.pendingBurstChecks).toHaveLength(1);
  });

  it("[stack] 宣言前 / battle flash の応答窓が開いている間は待機バーストを再開しない", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    const delayed = passStack({
      ...declared,
      pendingTriggeredEffects: [pendingNoopTrigger()],
    });
    const readyToResume: GameState = {
      ...delayed,
      pendingTriggeredEffects: [],
    };
    const preDeclarationStackOpen: GameState = {
      ...readyToResume,
      window: "pre_declaration_stack",
      preDeclarationStackWindow: {
        kind: "attack",
        actingPlayerId: ALICE,
        sourceInstanceId: "alice-spirit-1",
        previousWindow: "attack",
        priorityPlayerId: BOB,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    };
    expect(
      resumeStackCascadeIfReady(preDeclarationStackOpen, burstActionOptions)
    ).toBe(preDeclarationStackOpen);

    const battleFlashSubStackOpen: GameState = {
      ...readyToResume,
      window: "stack_before_block",
      activeAttack: {
        attackId: "attack:test:response-window",
        primaryEntityId: "battle-entity:alice-spirit-1",
        participantEntityIds: ["battle-entity:alice-spirit-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:alice-spirit-1",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:alice-spirit-1"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: BOB,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: {
            stackId: "stack:test:unseal-battle-flash",
            actionKind: "triggered_effect",
            chainId: "trigger:test:unseal-battle-flash",
            actingPlayerId: ALICE,
            cardInstanceId: "unseal-grandstone",
            cardDefinitionId: UNSEAL_GRANDSTONE.cardNo,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        },
      },
    };
    expect(
      resumeStackCascadeIfReady(battleFlashSubStackOpen, burstActionOptions)
    ).toBe(battleFlashSubStackOpen);
  });

  it("[stack] バースト効果内 choice は発揮宣言スタック後に選び、pending check snapshot から再開できる", () => {
    const state = buildBurstChoiceState();
    const declared = applyLegalAction({
      state,
      action: findM04BurstAction(state),
      ...burstActionOptions,
    }).state;
    const afterActivationStack = passStack(declared);

    expect(afterActivationStack.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    expect(afterActivationStack.pendingStepChoice).toBeNull();

    const afterEffectDeclarationStack = passStack(afterActivationStack);

    expect(afterEffectDeclarationStack.stackWindow).toBeNull();
    expect(afterEffectDeclarationStack.pendingStepChoice).toMatchObject({
      actingPlayerId: BOB,
      choosingPlayerId: BOB,
    });
    expect(
      afterEffectDeclarationStack.pendingStepChoice?.deferredStack
        ?.burstPendingSnapshot?.checkId
    ).toBe("burst:test:m04-choice");

    const afterPendingCheckDropped: GameState = {
      ...afterEffectDeclarationStack,
      pendingBurstChecks: [],
    };
    const choiceAction = getLegalActions({
      state: afterPendingCheckDropped,
      actingPlayerId: BOB,
      ...burstActionOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === 1
    );
    expect(choiceAction).toBeDefined();

    const afterChoice = applyLegalAction({
      state: afterPendingCheckDropped,
      action: choiceAction!,
      ...burstActionOptions,
    }).state;

    // セット枝の後も位置選択を待つ。別のバーストでもR05と同じ継続を使う。
    expect(afterChoice.pendingStepChoice).not.toBeNull();
    expect(afterChoice.quartzSetStates).toHaveLength(0);
    const placement = getLegalActions({
      state: afterChoice,
      actingPlayerId: BOB,
      ...burstActionOptions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" &&
        a.choiceLabel.includes("中央")
    );
    expect(placement).toBeDefined();
    const afterPlacement = applyLegalAction({
      state: afterChoice,
      action: placement!,
      ...burstActionOptions,
    }).state;
    expect(afterPlacement.pendingStepChoice).toBeNull();
    expect(
      afterPlacement.quartzSetStates.find(
        (q) => q.quartzInstanceId === "m04-burst"
      )?.slot
    ).toBe("center");
    expect(afterChoice.log).toContain(
      "burst:pending-snapshot-restored:burst:test:m04-choice"
    );
  });
});
