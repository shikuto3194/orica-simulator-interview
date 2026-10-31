import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
/**
 * BSRK01-X01「逆刃刀」effects[0] (textRef[2,3,4]):
 *   engine-restrict-hand-gain-bsrk01-x01 cluster、新設プリミティブ hand_gain_prevention。
 *
 * 「【合体結誓：「緋村 剣心」が煌臨元の契約煌臨スピリット】〔ゲームに1回:同名〕対象と合体
 *  したとき、次の効果を発揮できる。相手は、相手の手札が4枚以下になるように破棄する。
 *  その後、次の自分のスタートステップまで、相手は、相手の効果で手札を増やせず、ライフに
 *  コアを置けない。」
 *
 * hand_gain_prevention: 対象プレイヤーに player-scoped CE を登録するだけの宣言 primitive。
 * 実消費は isHandGainPreventedByOwnEffect を共通 gate とし、効果の発揮者と手札を得る
 * プレイヤーが同じときの draw / 非交換 bounce / search_zone / search_deck / deck_reveal /
 * move_card を止める。相手の効果による手札戻しと純増しない hand_swap は許可する。
 *
 * effects[1] (【合体中】飛天御剣流マジック回収) は既存テスト (bsrk01-cards.test.ts) の
 * 対象外だが、既存 discard/search_zone primitive の再利用のため本ファイルでは検証しない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src/runtime";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/runtime";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X01 = cardNoMap.get("BSRK01-X01")!;
const C24 = cardNoMap.get("BSTH08.5-C24")!;

const ALICE = "alice";
const BOB = "bob";

// 実カード BSRK01-CX01「緋村 剣心」相当: 印字名に「緋村 剣心」を含むが adventData を
// 持たない通常召喚スピリット。単独でホストにしても combined_host_advent_source_card_name は
// false であるべき (adversarial verifier round1 refute の対象シナリオそのもの:
// 煌臨元を伴わずホスト自身の名前一致だけで誤発火していたバグ)。
const KENSHIN_PLAIN_SPIRIT: CardDefinition = {
  cardNo: "TEST-KENSHIN-PLAIN",
  name: "緋村 剣心",
  printedCategory: "spirit",
  colors: ["red", "white"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red", "white"],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// 実カード BSRK01-X02「[京都動乱編]緋村 剣心」相当: 「緋村 剣心」への契約煌臨
// (adventVariant:"contract") で場に出るホスト。
const KENSHIN_CONTRACT_ADVENT_HOST: CardDefinition = {
  cardNo: "TEST-KENSHIN-CONTRACT-HOST",
  name: "[京都動乱編]緋村 剣心",
  printedCategory: "spirit",
  colors: ["red", "white"],
  cost: 8,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 10000 }],
  symbolColors: ["red", "white"],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  adventData: {
    adventCondition: {
      cardNames: [{ contains: "緋村 剣心" }],
      targetCategory: ["spirit"],
    },
    adventTiming: "own_turn",
    soulCoreDest: "trash",
    adventVariant: "contract",
  },
  effects: [],
};

// 煌臨元は「緋村 剣心」名だが adventVariant が "normal" (通常煌臨) のホスト。
// requireContractAdventVariant:true が正しく機能することの対照群。
const KENSHIN_NORMAL_ADVENT_HOST: CardDefinition = {
  cardNo: "TEST-KENSHIN-NORMAL-HOST",
  name: "テスト通常煌臨ホスト",
  printedCategory: "spirit",
  colors: ["red", "white"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red", "white"],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  adventData: {
    adventCondition: {
      cardNames: [{ contains: "緋村 剣心" }],
      targetCategory: ["spirit"],
    },
    adventTiming: "own_turn",
    soulCoreDest: "trash",
    adventVariant: "normal",
  },
  effects: [],
};

// 名前が一致しないホスト（combined_host_advent_source_card_name が false になることの対照群）。
const OTHER_HOST: CardDefinition = {
  cardNo: "TEST-OTHER-HOST",
  name: "テスト無関係スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// resolveHandTrashSearchCandidates チョークポイント検証用: トラッシュ→手札の search_zone。
const TRASH_TO_HAND_SEARCHER: CardDefinition = {
  cardNo: "TEST-TRASH-TO-HAND",
  name: "test trash to hand searcher",
  printedCategory: "nexus",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            destination: "hand",
            count: 1,
          },
        },
      ],
    },
  ],
};

// structured-zone-ops.ts の deck 検索→手札ルート。手札増加禁止では選択待ちを積まず
// 完全 no-op になるため、effect_steps_resolved の発火有無を検証する。
const DECK_TO_HAND_SEARCHER: CardDefinition = {
  ...TRASH_TO_HAND_SEARCHER,
  cardNo: "TEST-DECK-TO-HAND",
  name: "test deck to hand searcher",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "deck",
            destination: "hand",
            count: 1,
          },
        },
      ],
    },
  ],
};

// deck-reveal-pick-candidates.ts チョークポイント検証用 (bsrk01-c02-hand-gain-cost-gate.test.ts
// の BOB_DECK_PEEK と同型)。
const DECK_PEEK: CardDefinition = {
  cardNo: "TEST-DECK-PEEK-X01",
  name: "test deck peek",
  printedCategory: "nexus",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 2,
            picks: [{ count: 1 }],
            remainder: "bottom",
          },
        },
      ],
    },
  ],
};

// Q29310 回帰用: 「ドロー/デッキ検索/手札移動効果を発揮したとき」の action-kind trigger。
const DRAW_AFTER_TRIGGER: CardDefinition = {
  ...OTHER_HOST,
  cardNo: "TEST-DRAW-AFTER-TRIGGER",
  name: "test draw after trigger",
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: "effect_steps_resolved",
        actionKinds: ["draw", "search_zone", "move_card"],
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};

const testCardMap = new Map<string, CardDefinition>(
  [
    KENSHIN_PLAIN_SPIRIT,
    KENSHIN_CONTRACT_ADVENT_HOST,
    KENSHIN_NORMAL_ADVENT_HOST,
    OTHER_HOST,
    TRASH_TO_HAND_SEARCHER,
    DECK_TO_HAND_SEARCHER,
    DECK_PEEK,
    DRAW_AFTER_TRIGGER,
  ].map((c) => [c.cardNo, c])
);
const getCardDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? testCardMap.get(id);

function findCombineOathEffect() {
  return X01.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "hand_gain_prevention")
  )!;
}

describe("BSRK01-X01 effects[0]: 合体結誓 (hand_gain_prevention 新設プリミティブ + combined_host_advent_source_card_name)", () => {
  it("effect 定義: card_event:brave_combined + combined_host_advent_source_card_name + ゲームに1回", () => {
    const effect = findCombineOathEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: "brave_combined",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(effect.condition).toEqual([
      {
        kind: "combined_host_advent_source_card_name",
        cardNames: [{ contains: "緋村 剣心" }],
        requireContractAdventVariant: true,
      },
    ]);
    expect(effect.steps).toHaveLength(3);
    expect(effect.steps.map((s) => s.action.kind)).toEqual([
      "discard",
      "restrict_core_placement",
      "hand_gain_prevention",
    ]);
  });

  // 「緋村 剣心」への契約煌臨で場に出たホスト（BSRK01-X02 相当）に合体した状態。
  function combinedState({
    ownerPlayerId = ALICE,
    adventSourceInstanceId = "kenshin-base",
    hostInstanceId = "kenshin-host",
    braveInstanceId = "sakabatou",
    attached = true,
  }: {
    ownerPlayerId?: string;
    adventSourceInstanceId?: string;
    hostInstanceId?: string;
    braveInstanceId?: string;
    attached?: boolean;
  } = {}): GameState {
    const adventSource = createCardInstance(KENSHIN_PLAIN_SPIRIT, {
      instanceId: adventSourceInstanceId,
      ownerPlayerId,
      controllerPlayerId: ownerPlayerId,
      zone: "field",
    });
    const host: GameState["cardInstances"][number] = {
      ...createCardInstance(KENSHIN_CONTRACT_ADVENT_HOST, {
        instanceId: hostInstanceId,
        ownerPlayerId,
        controllerPlayerId: ownerPlayerId,
        zone: "field",
      }),
      underCards: [
        { cardInstanceId: adventSourceInstanceId, role: "advent_source" },
      ],
      ...(attached ? { attachedChildrenIds: [braveInstanceId] } : {}),
    };
    const brave = createCardInstance(X01, {
      instanceId: braveInstanceId,
      ownerPlayerId,
      controllerPlayerId: ownerPlayerId,
      zone: "field",
      ...(attached ? { attachedToInstanceId: hostInstanceId } : {}),
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    return {
      ...base,
      activePlayerId: ownerPlayerId,
      step: "main",
      cardInstances: [adventSource, host, brave],
    };
  }

  it("ホストが「緋村 剣心」を煌臨元とする契約煌臨スピリットのとき、実行すると相手に2つの CE (restrict_core_placement_life / hand_gain_prevention) が登録される", () => {
    const state = combinedState();
    const effect = findCombineOathEffect();
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:348",
      state,
      effect,
      sourceInstanceId: "sakabatou",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });

    const lifeCE = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_core_placement_life"
    );
    expect(lifeCE).toBeDefined();
    expect(lifeCE!.targetInstanceId).toBe(BOB);
    expect(lifeCE!.duration).toEqual({
      scope: "step",
      step: "start",
      whose: "self",
    });

    const handGainCE = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "hand_gain_prevention"
    );
    expect(handGainCE).toBeDefined();
    expect(handGainCE!.targetInstanceId).toBe(BOB);
    expect(handGainCE!.duration).toEqual({
      scope: "step",
      step: "start",
      whose: "self",
    });

    // 手札破棄ステップも同一効果内で実行されている（bob の手札は既定4枚 = targetHandSize
    // 以下のため discard は no-op、盤面上は破棄カードが増えないことだけを確認する）。
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.handCount).toBeLessThanOrEqual(4);
  });

  it("盤面回帰: 相手の手札6枚を4枚まで破棄し、選択解決後に両方の禁止CEを登録する", () => {
    const effect = findCombineOathEffect();
    const bobHand = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(TRASH_TO_HAND_SEARCHER, {
        instanceId: `bob-hand-${index + 1}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "hand",
      })
    );
    const before = combinedState();
    const state: GameState = {
      ...before,
      players: before.players.map((player) =>
        player.id === BOB ? { ...player, handCount: bobHand.length } : player
      ),
      cardInstances: [...before.cardInstances, ...bobHand],
    };

    const pending = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:403",
      state,
      effect,
      sourceInstanceId: "sakabatou",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(pending.pendingZoneSelection).toMatchObject({
      actingPlayerId: BOB,
      targetPlayerId: BOB,
      sourceZone: "hand",
      destination: "trash",
      maxCount: 2,
      candidateCardInstanceIds: bobHand.map((card) => card.instanceId),
    });

    const selectDiscard = getLegalActions({
      state: pending,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(selectDiscard).toBeDefined();
    if (!selectDiscard) {
      throw new Error("missing BSRK01-X01 opponent hand discard selection");
    }
    const final = applyLegalAction({
      state: pending,
      action: selectDiscard,
      selectedZoneCardIds: ["bob-hand-1", "bob-hand-2"],
      getCardDefinitionById: getCardDef,
    }).state;

    expect(final.pendingZoneSelection).toBeNull();
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === BOB && card.zone === "hand"
      )
    ).toHaveLength(4);
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === BOB && card.zone === "trash"
      )
    ).toHaveLength(2);
    expect(final.players.find((player) => player.id === BOB)!.handCount).toBe(
      4
    );
    expect(
      final.activeContinuousEffects.map((effect) => effect.modifierTag)
    ).toEqual(
      expect.arrayContaining([
        "restrict_core_placement_life",
        "hand_gain_prevention",
      ])
    );
  });

  it("盤面回帰: 本番の brave_combined 経路で、同名の別個体はゲーム中の2回目を発揮できず、相手の同名は独立する", () => {
    const definitions = [...ALL_CARDS, ...testCardMap.values()];
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const legalOptions = {
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBurstActions: () => [],
    };
    const findX01Declaration = (
      state: GameState,
      actingPlayerId: string,
      braveInstanceId: string
    ) =>
      getLegalActions({ state, actingPlayerId, ...legalOptions }).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          (action.sourceEffectInstanceId ?? action.sourceInstanceId) ===
            braveInstanceId &&
          action.sourceCardNo === "BSRK01-X01" &&
          action.skipOnly !== true
      );
    const closeStackWindow = (state: GameState) => {
      let current = state;
      for (let guard = 0; current.stackWindow && guard < 4; guard += 1) {
        const pass = getLegalActions({
          state: current,
          actingPlayerId: current.stackWindow.priorityPlayerId,
          ...legalOptions,
        }).find((action) => action.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pass!,
          ...legalOptions,
        }).state;
      }
      expect(current.stackWindow).toBeNull();
      return current;
    };
    const resolvePendingBraveLeaveChoice = (state: GameState) => {
      expect(state.pendingBraveLeaveChoice).toEqual(
        expect.objectContaining({
          choosingPlayerId: ALICE,
          hostInstanceId: "kenshin-host",
          braveInstanceIds: ["sakabatou-first"],
        })
      );
      const keep = getLegalActions({
        state,
        actingPlayerId: ALICE,
        ...legalOptions,
      }).find(
        (action) =>
          action.kind === "resolve_brave_leave_choice" &&
          action.choice === "keep"
      );
      expect(keep).toBeDefined();
      if (!keep) {
        throw new Error("missing brave leave keep choice");
      }
      const resolved = applyLegalAction({
        state,
        action: keep,
        ...legalOptions,
      }).state;
      expect(resolved.pendingBraveLeaveChoice).toBeNull();
      return resolved;
    };

    const firstBefore = combinedState({
      braveInstanceId: "sakabatou-first",
      attached: false,
    });
    const firstAfter = combinedState({
      braveInstanceId: "sakabatou-first",
    });
    const firstQueued = collectAndQueueTriggerReactions({
      chainId: "test:bsrk01-x01-hand-gain-prevention:537",
      beforeState: firstBefore,
      afterState: recordSemanticTriggerEvent(firstAfter, {
        eventKind: "brave_combined",
        relatedInstanceId: firstAfter.cardInstances.find(
          (c) => c.attachedToInstanceId !== null
        )!.instanceId,
        triggerRelatedCombinedHostInstanceId: firstAfter.cardInstances.find(
          (c) => c.attachedToInstanceId !== null
        )!.attachedToInstanceId!,
      }),
      source: "action_resolution",
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    const firstDeclaration = findX01Declaration(
      firstQueued,
      ALICE,
      "sakabatou-first"
    );
    expect(firstDeclaration).toBeDefined();
    if (!firstDeclaration) {
      throw new Error("missing first BSRK01-X01 brave_combined declaration");
    }
    const firstDeclared = applyLegalAction({
      state: firstQueued,
      action: firstDeclaration,
      ...legalOptions,
    }).state;
    expect(firstDeclared.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: "sakabatou-first",
        sourceDefinitionId: "BSRK01-X01",
        effectLabel: "effect:0",
        duration: "game",
        playerId: ALICE,
      })
    );
    const firstResolved = resolvePendingBraveLeaveChoice(
      closeStackWindow(firstDeclared)
    );
    expect(
      firstResolved.activeContinuousEffects.map((effect) => effect.modifierTag)
    ).toEqual(
      expect.arrayContaining([
        "hand_gain_prevention",
        "restrict_core_placement_life",
      ])
    );

    const aliceSecondBefore = combinedState({
      adventSourceInstanceId: "kenshin-base-alice-second",
      hostInstanceId: "kenshin-host-alice-second",
      braveInstanceId: "sakabatou-alice-second",
      attached: false,
    });
    const aliceSecondAfter = combinedState({
      adventSourceInstanceId: "kenshin-base-alice-second",
      hostInstanceId: "kenshin-host-alice-second",
      braveInstanceId: "sakabatou-alice-second",
    });
    const aliceSecondBeforeState: GameState = {
      ...firstResolved,
      cardInstances: [
        ...firstResolved.cardInstances,
        ...aliceSecondBefore.cardInstances,
      ],
    };
    const aliceSecondAfterState: GameState = {
      ...aliceSecondBeforeState,
      cardInstances: [
        ...firstResolved.cardInstances,
        ...aliceSecondAfter.cardInstances,
      ],
    };
    const aliceSecondQueued = collectAndQueueTriggerReactions({
      chainId: "test:bsrk01-x01-hand-gain-prevention:605",
      beforeState: aliceSecondBeforeState,
      afterState: recordSemanticTriggerEvent(aliceSecondAfterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "sakabatou-alice-second",
        triggerRelatedCombinedHostInstanceId:
          aliceSecondAfterState.cardInstances.find(
            (c) => c.instanceId === "sakabatou-alice-second"
          )!.attachedToInstanceId!,
      }),
      source: "action_resolution",
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(aliceSecondQueued.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        actingPlayerId: ALICE,
        eventKind: "brave_combined",
        relatedInstanceId: "sakabatou-alice-second",
      })
    );
    expect(
      findX01Declaration(aliceSecondQueued, ALICE, "sakabatou-alice-second")
    ).toBeUndefined();
    const aliceSecondActions = getLegalActions({
      state: aliceSecondQueued,
      actingPlayerId: ALICE,
      ...legalOptions,
    });
    const aliceSecondSkipOnly = aliceSecondActions.find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        (action.sourceEffectInstanceId ?? action.sourceInstanceId) ===
          "sakabatou-alice-second" &&
        action.sourceCardNo === "BSRK01-X01" &&
        action.skipOnly === true
    );
    expect(aliceSecondSkipOnly).toBeDefined();
    if (!aliceSecondSkipOnly) {
      throw new Error("missing second BSRK01-X01 skip-only action");
    }
    const aliceSecondDrained = applyLegalAction({
      state: aliceSecondQueued,
      action: aliceSecondSkipOnly,
      ...legalOptions,
    }).state;
    expect(aliceSecondDrained.pendingTriggeredEffects).toHaveLength(0);
    expect(
      aliceSecondDrained.effectUsageRecords.filter(
        (record) =>
          record.sourceDefinitionId === "BSRK01-X01" &&
          record.effectLabel === "effect:0" &&
          record.playerId === ALICE &&
          record.duration === "game"
      )
    ).toHaveLength(1);

    const aliceThirdBefore = combinedState({
      adventSourceInstanceId: "kenshin-base-alice-third",
      hostInstanceId: "kenshin-host-alice-third",
      braveInstanceId: "sakabatou-alice-third",
      attached: false,
    });
    const aliceThirdAfter = combinedState({
      adventSourceInstanceId: "kenshin-base-alice-third",
      hostInstanceId: "kenshin-host-alice-third",
      braveInstanceId: "sakabatou-alice-third",
    });
    const aliceThirdBeforeState: GameState = {
      ...aliceSecondDrained,
      cardInstances: [
        ...aliceSecondDrained.cardInstances,
        ...aliceThirdBefore.cardInstances,
      ],
    };
    const aliceThirdAfterState: GameState = {
      ...aliceThirdBeforeState,
      cardInstances: [
        ...aliceSecondDrained.cardInstances,
        ...aliceThirdAfter.cardInstances,
      ],
    };
    const aliceThirdQueued = collectAndQueueTriggerReactions({
      chainId: "test:bsrk01-x01-hand-gain-prevention:682",
      beforeState: aliceThirdBeforeState,
      afterState: recordSemanticTriggerEvent(aliceThirdAfterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "sakabatou-alice-third",
        triggerRelatedCombinedHostInstanceId:
          aliceThirdAfterState.cardInstances.find(
            (c) => c.instanceId === "sakabatou-alice-third"
          )!.attachedToInstanceId!,
      }),
      source: "action_resolution",
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    expect(aliceThirdQueued.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        actingPlayerId: ALICE,
        eventKind: "brave_combined",
        relatedInstanceId: "sakabatou-alice-third",
      })
    );
    expect(
      findX01Declaration(aliceThirdQueued, ALICE, "sakabatou-alice-third")
    ).toBeUndefined();
    expect(
      getLegalActions({
        state: aliceThirdQueued,
        actingPlayerId: ALICE,
        ...legalOptions,
      }).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          (action.sourceEffectInstanceId ?? action.sourceInstanceId) ===
            "sakabatou-alice-third" &&
          action.sourceCardNo === "BSRK01-X01" &&
          action.skipOnly === true
      )
    ).toBeDefined();

    const bobBefore = combinedState({
      ownerPlayerId: BOB,
      adventSourceInstanceId: "kenshin-base-bob",
      hostInstanceId: "kenshin-host-bob",
      braveInstanceId: "sakabatou-bob",
      attached: false,
    });
    const bobAfter = combinedState({
      ownerPlayerId: BOB,
      adventSourceInstanceId: "kenshin-base-bob",
      hostInstanceId: "kenshin-host-bob",
      braveInstanceId: "sakabatou-bob",
    });
    // 他プレイヤーの使用履歴は残したまま、Bob 自身の新しい brave_combined
    // 盤面遷移を作る。per_card_name は playerId も照合するため、この履歴が Bob の
    // 同名カードの発揮を妨げないことを実際の pending 解決候補で検証する。
    const bobBeforeState: GameState = {
      ...bobBefore,
      effectUsageRecords: firstResolved.effectUsageRecords,
    };
    const bobAfterState: GameState = {
      ...bobBeforeState,
      cardInstances: bobAfter.cardInstances,
    };
    const bobQueued = collectAndQueueTriggerReactions({
      chainId: "test:bsrk01-x01-hand-gain-prevention:739",
      beforeState: bobBeforeState,
      afterState: recordSemanticTriggerEvent(bobAfterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "sakabatou-bob",
        triggerRelatedCombinedHostInstanceId: bobAfterState.cardInstances.find(
          (c) => c.instanceId === "sakabatou-bob"
        )!.attachedToInstanceId!,
      }),
      source: "action_resolution",
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    expect(findX01Declaration(bobQueued, BOB, "sakabatou-bob")).toBeDefined();
  });

  it("ホストが「緋村 剣心」を煌臨元とする契約煌臨スピリットのとき condition は true", () => {
    const state = combinedState();
    const effect = findCombineOathEffect();
    expect(
      evaluateCondition(
        state,
        effect.condition!,
        "sakabatou",
        ALICE,
        getCardDef
      )
    ).toBe(true);
  });

  it("regression: ホスト自身の印字名が「緋村 剣心」を含むだけで煌臨元を伴わないとき condition は false (adversarial verifier round1 refute の再発防止。BSRK01-CX01 相当を通常召喚しただけのホストに誤発火しない)", () => {
    const host = createCardInstance(KENSHIN_PLAIN_SPIRIT, {
      instanceId: "kenshin-plain-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const brave = createCardInstance(X01, {
      instanceId: "sakabatou-plain",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "kenshin-plain-host",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [host, brave],
    };
    const effect = findCombineOathEffect();
    expect(
      evaluateCondition(
        state,
        effect.condition!,
        "sakabatou-plain",
        ALICE,
        getCardDef
      )
    ).toBe(false);
  });

  it("煌臨元の名前が一致しないとき condition は false", () => {
    const otherSource = createCardInstance(OTHER_HOST, {
      instanceId: "other-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const host: GameState["cardInstances"][number] = {
      ...createCardInstance(KENSHIN_CONTRACT_ADVENT_HOST, {
        instanceId: "kenshin-host2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
      underCards: [{ cardInstanceId: "other-source", role: "advent_source" }],
    };
    const brave = createCardInstance(X01, {
      instanceId: "sakabatou3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "kenshin-host2",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [otherSource, host, brave],
    };
    const effect = findCombineOathEffect();
    expect(
      evaluateCondition(
        state,
        effect.condition!,
        "sakabatou3",
        ALICE,
        getCardDef
      )
    ).toBe(false);
  });

  it("煌臨元の名前は一致するがホストが契約煌臨 (adventVariant:contract) でないとき condition は false", () => {
    const adventSource = createCardInstance(KENSHIN_PLAIN_SPIRIT, {
      instanceId: "kenshin-base2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const host: GameState["cardInstances"][number] = {
      ...createCardInstance(KENSHIN_NORMAL_ADVENT_HOST, {
        instanceId: "kenshin-normal-host",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
      underCards: [{ cardInstanceId: "kenshin-base2", role: "advent_source" }],
    };
    const brave = createCardInstance(X01, {
      instanceId: "sakabatou4",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "kenshin-normal-host",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [adventSource, host, brave],
    };
    const effect = findCombineOathEffect();
    expect(
      evaluateCondition(
        state,
        effect.condition!,
        "sakabatou4",
        ALICE,
        getCardDef
      )
    ).toBe(false);
  });

  it("盤面回帰: 実カードのCE後は本人のドロー/バウンスを止め、相手の効果による手札戻し/ドローを許可する", () => {
    const bobDrawSource = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "bob-draw-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const bobBounceTarget = createCardInstance(OTHER_HOST, {
      instanceId: "bob-bounce-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const aliceBounceSource = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "alice-bounce-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const bobDeckCard = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "bob-deck-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
    });
    const before = combinedState();
    const initial: GameState = {
      ...before,
      players: before.players.map((player) =>
        player.id === BOB ? { ...player, handCount: 4, deckCount: 1 } : player
      ),
      cardInstances: [
        ...before.cardInstances,
        bobDrawSource,
        bobBounceTarget,
        aliceBounceSource,
        bobDeckCard,
      ],
    };
    const constrained = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:920",
      state: initial,
      effect: findCombineOathEffect(),
      sourceInstanceId: "sakabatou",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(
      constrained.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "hand_gain_prevention"
      )
    ).toBe(true);

    const afterOwnDraw = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:933",
      state: constrained,
      effect: {
        timing: { kind: "continuous" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      sourceInstanceId: "bob-draw-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      afterOwnDraw.players.find((player) => player.id === BOB)!
    ).toMatchObject({
      handCount: 4,
      deckCount: 1,
    });
    expect(
      afterOwnDraw.cardInstances.find(
        (card) => card.instanceId === "bob-deck-card"
      )?.zone
    ).toBe("deck");

    const afterOwnBounce = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:955",
      state: afterOwnDraw,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      },
      sourceInstanceId: "bob-draw-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      afterOwnBounce.cardInstances.find(
        (card) => card.instanceId === "bob-bounce-target"
      )?.zone
    ).toBe("field");
    expect(afterOwnBounce.pendingLeaveEntities).toEqual([]);

    const queuedOpponentBounce = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:984",
      state: afterOwnBounce,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bounce",
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
      sourceInstanceId: "alice-bounce-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(queuedOpponentBounce.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "bob-bounce-target",
        kind: "bounce",
        leaveDestination: { zone: "hand" },
      })
    );
    const afterOpponentBounce = flushPendingLeaves(
      queuedOpponentBounce,
      getCardDef
    );
    expect(
      afterOpponentBounce.cardInstances.find(
        (card) => card.instanceId === "bob-bounce-target"
      )?.zone
    ).toBe("hand");
    expect(
      afterOpponentBounce.players.find((player) => player.id === BOB)!.handCount
    ).toBe(5);

    const afterOpponentDraw = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1026",
      state: afterOpponentBounce,
      effect: {
        timing: { kind: "continuous" },
        steps: [{ action: { kind: "draw", player: "opponent", count: 1 } }],
      },
      sourceInstanceId: "alice-bounce-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(
      afterOpponentDraw.players.find((player) => player.id === BOB)!
    ).toMatchObject({
      handCount: 6,
      deckCount: 0,
    });
    expect(
      afterOpponentDraw.cardInstances.find(
        (card) => card.instanceId === "bob-deck-card"
      )?.zone
    ).toBe("hand");
  });
});

function handGainPreventionCE(targetPlayerId: string): ContinuousEffect {
  return {
    effectId: "ce-hand-gain-prevention-test",
    sourceInstanceId: "sakabatou",
    sourceDefinitionId: X01.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "step", step: "start", whose: "self" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "hand_gain_prevention",
    targetInstanceId: targetPlayerId,
  };
}

describe("hand_gain_prevention: resolveHandTrashSearchCandidates チョークポイント (search_zone trash→hand)", () => {
  it("CE が無ければトラッシュから手札に加えられる", () => {
    const searcher = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "searcher",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const trashCard = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "trash-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [searcher, trashCard],
    };
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1085",
      state,
      effect: TRASH_TO_HAND_SEARCHER.effects![0]!,
      sourceInstanceId: "searcher",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "trash-card")!.zone
    ).toBe("hand");
  });

  it("hand_gain_prevention CE (対象=bob) があると候補が0件になりトラッシュに留まる", () => {
    const searcher = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "searcher2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const trashCard = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "trash-card2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [searcher, trashCard],
      activeContinuousEffects: [handGainPreventionCE(BOB)],
    };
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1118",
      state,
      effect: TRASH_TO_HAND_SEARCHER.effects![0]!,
      sourceInstanceId: "searcher2",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "trash-card2")!.zone
    ).toBe("trash");
  });

  it("相手の効果が bob のトラッシュを手札へ戻す場合は、発揮者が異なるため許可する", () => {
    const aliceSearcher = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "alice-searcher",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const bobTrashCard = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "bob-trash-for-alice",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [aliceSearcher, bobTrashCard],
      activeContinuousEffects: [handGainPreventionCE(BOB)],
    };
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1151",
      state,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              player: "opponent",
              destination: "hand",
              count: 1,
            },
          },
        ],
      },
      sourceInstanceId: "alice-searcher",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "bob-trash-for-alice"
      )?.zone
    ).toBe("hand");
  });
});

describe("hand_gain_prevention: move_card 共通プリミティブ", () => {
  const returnFromTrash = {
    timing: { kind: "continuous" as const },
    steps: [
      {
        action: {
          kind: "move_card" as const,
          from: { zone: "trash" as const, player: "self" as const },
          to: { zone: "hand" as const },
          count: 1,
        },
      },
    ],
  };

  it("対象自身の移動を止め、相手の効果で対象の手札へ戻す移動は許可する", () => {
    const bobSource = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "bob-move-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const bobTrash = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "bob-move-trash",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const blocked = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1208",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [bobSource, bobTrash],
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: returnFromTrash,
      sourceInstanceId: "bob-move-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(
      blocked.cardInstances.find((card) => card.instanceId === "bob-move-trash")
        ?.zone
    ).toBe("trash");
    expect(blocked.log).toContain(
      "effect:move_card:blocked-by-hand-gain-prevention:bob:bob"
    );

    const aliceSource = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "alice-move-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const allowed = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1235",
      state: {
        ...base,
        activePlayerId: ALICE,
        step: "main",
        cardInstances: [aliceSource, bobTrash],
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "trash", player: "opponent" },
              to: { zone: "hand" },
              count: 1,
            },
          },
        ],
      },
      sourceInstanceId: "alice-move-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(
      allowed.cardInstances.find((card) => card.instanceId === "bob-move-trash")
        ?.zone
    ).toBe("hand");
  });

  it("禁止された move_card→hand は effect_steps_resolved の action-kind 通知を残さない", () => {
    const source = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "blocked-move-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const watcher = createCardInstance(DRAW_AFTER_TRIGGER, {
      instanceId: "blocked-move-watcher",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const trashCard = createCardInstance(DECK_PEEK, {
      instanceId: "blocked-move-trash-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1286",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [source, watcher, trashCard],
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: returnFromTrash,
      sourceInstanceId: "blocked-move-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...ALL_CARDS,
        ...testCardMap.values(),
      ]),
      getRegisteredBurstActions: () => [],
    });
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "blocked-move-trash-card"
      )?.zone
    ).toBe("trash");
    expect(
      after.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "effect_steps_resolved"
      )
    ).toEqual([]);
    expect(after.effectUsageRecords).toEqual([]);
  });
});

describe("hand_gain_prevention: action-kind trigger", () => {
  it("Q29310: 禁止中の『1枚ドローするだけ』は発揮済み通知・誘発候補・使用履歴を残さない", () => {
    const drawSource = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "draw-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const watcher = createCardInstance(DRAW_AFTER_TRIGGER, {
      instanceId: "draw-watcher",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const deckCard = createCardInstance(DECK_PEEK, {
      instanceId: "draw-deck-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1339",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [drawSource, watcher, deckCard],
        players: base.players.map((player) =>
          player.id === BOB ? { ...player, deckCount: 1 } : player
        ),
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      sourceInstanceId: "draw-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...ALL_CARDS,
        ...testCardMap.values(),
      ]),
      getRegisteredBurstActions: () => [],
    });
    expect(
      after.cardInstances.find((card) => card.instanceId === "draw-deck-card")
        ?.zone
    ).toBe("deck");
    expect(after.players.find((player) => player.id === BOB)).toMatchObject({
      // createEmptyGameState の既定手札4枚から変化しない。
      handCount: 4,
      deckCount: 1,
    });
    expect(
      after.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "effect_steps_resolved"
      )
    ).toEqual([]);
    expect(after.effectUsageRecords).toEqual([]);
  });

  it("Q12304/Q29310: 禁止中のデッキ検索→手札も発揮済み通知・誘発候補・使用履歴を残さない", () => {
    const searchSource = createCardInstance(DECK_TO_HAND_SEARCHER, {
      instanceId: "search-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const watcher = createCardInstance(DRAW_AFTER_TRIGGER, {
      instanceId: "search-watcher",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const deckCard = createCardInstance(DECK_PEEK, {
      instanceId: "search-deck-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1400",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [searchSource, watcher, deckCard],
        players: base.players.map((player) =>
          player.id === BOB ? { ...player, deckCount: 1 } : player
        ),
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: DECK_TO_HAND_SEARCHER.effects![0]!,
      sourceInstanceId: "search-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...ALL_CARDS,
        ...testCardMap.values(),
      ]),
      getRegisteredBurstActions: () => [],
    });
    expect(
      after.cardInstances.find((card) => card.instanceId === "search-deck-card")
        ?.zone
    ).toBe("deck");
    expect(after.players.find((player) => player.id === BOB)).toMatchObject({
      handCount: 4,
      deckCount: 1,
    });
    expect(
      after.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "effect_steps_resolved"
      )
    ).toEqual([]);
    expect(after.effectUsageRecords).toEqual([]);
  });

  it("Q29310: 禁止中のトラッシュ検索→手札も発揮済み通知・誘発候補・使用履歴を残さない", () => {
    const searchSource = createCardInstance(TRASH_TO_HAND_SEARCHER, {
      instanceId: "trash-search-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const watcher = createCardInstance(DRAW_AFTER_TRIGGER, {
      instanceId: "trash-search-watcher",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const trashCard = createCardInstance(DECK_PEEK, {
      instanceId: "trash-search-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const after = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1457",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [searchSource, watcher, trashCard],
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: TRASH_TO_HAND_SEARCHER.effects![0]!,
      sourceInstanceId: "trash-search-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...ALL_CARDS,
        ...testCardMap.values(),
      ]),
      getRegisteredBurstActions: () => [],
    });
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "trash-search-card"
      )?.zone
    ).toBe("trash");
    expect(after.log).toContain(
      "effect:return_from_trash:blocked-by-hand-gain-prevention:bob:bob"
    );
    expect(
      after.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "effect_steps_resolved"
      )
    ).toEqual([]);
    expect(after.effectUsageRecords).toEqual([]);
  });
});

describe("hand_gain_prevention: deck-reveal-pick-candidates.ts チョークポイント (deck_reveal pick)", () => {
  function revealState(hasCE: boolean): GameState {
    const peek = createCardInstance(DECK_PEEK, {
      instanceId: "peek",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const deckCards = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(DECK_PEEK, {
        instanceId: `deck-${i + 1}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      // hand_gain_cost_gate と異なりリザーブの多寡に関わらず完全ブロックされることを示すため
      // 潤沢なリザーブを与える。
      playerOverrides: [{}, { reserveNormalCoreCount: 10 }],
    });
    return {
      ...base,
      activePlayerId: BOB,
      step: "main",
      cardInstances: [peek, ...deckCards],
      activeContinuousEffects: hasCE ? [handGainPreventionCE(BOB)] : [],
    };
  }

  function reveal(state: GameState) {
    return executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1524",
      state,
      effect: DECK_PEEK.effects![0]!,
      sourceInstanceId: "peek",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
  }

  function getPickAction(state: GameState, actingPlayerId = BOB) {
    const actions = getLegalActions({
      state,
      actingPlayerId,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pick = actions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    );
    if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("resolve_pending_deck_reveal_pick action not found");
    }
    return pick;
  }

  it("CE が無ければリザーブ潤沢時に候補が出る (対照群)", () => {
    const afterReveal = reveal(revealState(false));
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds.sort()).toEqual(["deck-1", "deck-2"]);
  });

  it("hand_gain_prevention CE があるとリザーブが潤沢でも候補が0件になる (costGate と異なり支払い不能では回避できない完全禁止)", () => {
    const afterReveal = reveal(revealState(true));
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds).toEqual([]);
    expect(pick.canSkip).toBe(true);

    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: [],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    const bob = afterPick.state.players.find((p) => p.id === BOB)!;
    // 完全ブロックなので支払いも発生しない (リザーブ10のまま)。
    expect(bob.reserveNormalCoreCount).toBe(10);
  });

  it("hand_swap は純増しないため、CE 下でも pick 候補を維持する", () => {
    const bobHandCard = createCardInstance(DECK_PEEK, {
      instanceId: "bob-hand-card",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const base = revealState(true);
    const state: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, bobHandCard],
      players: base.players.map((player) =>
        player.id === BOB ? { ...player, handCount: 1 } : player
      ),
    };
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1589",
      state,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 2,
              picks: [{ count: 1, destination: "hand_swap" }],
              remainder: "bottom",
            },
          },
        ],
      },
      sourceInstanceId: "peek",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds.sort()).toEqual(["deck-1", "deck-2"]);
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-1"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]).state;
    expect(afterPick.pendingZoneSelection?.swapPickedInstanceId).toBe("deck-1");

    const swapAction = getLegalActions({
      state: afterPick,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]).find(
      (action) => action.kind === "resolve_pending_zone_selection"
    );
    expect(swapAction).toBeDefined();
    const afterSwap = applyLegalAction({
      state: afterPick,
      action: swapAction!,
      selectedZoneCardIds: ["bob-hand-card"],
      getCardDefinitionById: getCardDef,
    }).state;
    expect(
      afterSwap.players.find((player) => player.id === BOB)?.handCount
    ).toBe(1);
    expect(
      afterSwap.cardInstances.find((card) => card.instanceId === "deck-1")?.zone
    ).toBe("hand");
    expect(
      afterSwap.cardInstances.find(
        (card) => card.instanceId === "bob-hand-card"
      )?.zone
    ).toBe("deck");
    expect(afterSwap.pendingZoneSelection).toBeNull();
  });

  it("hand_or_set_aside_choice は CE 下でも手元を選べ、手札だけを拒否する", () => {
    const choiceEffect = {
      timing: { kind: "continuous" as const },
      steps: [
        {
          action: {
            kind: "deck_reveal" as const,
            revealCount: 2,
            picks: [
              { count: 1, destination: "hand_or_set_aside_choice" as const },
            ],
            remainder: "bottom" as const,
          },
        },
      ],
    };
    const before = revealState(true);
    const beforeHandCount = before.players.find(
      (player) => player.id === BOB
    )!.handCount;
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1667",
      state: before,
      effect: choiceEffect,
      sourceInstanceId: "peek",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    const pick = getPickAction(afterReveal);
    expect(pick.candidateCardInstanceIds.sort()).toEqual(["deck-1", "deck-2"]);

    const setAside = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-1"],
      deckRevealPickFreeDestination: "set_aside",
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]).state;
    expect(
      setAside.cardInstances.find((card) => card.instanceId === "deck-1")?.zone
    ).toBe("set_aside");
    expect(
      setAside.players.find((player) => player.id === BOB)?.handCount
    ).toBe(beforeHandCount);

    const handReveal = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1691",
      state: revealState(true),
      effect: choiceEffect,
      sourceInstanceId: "peek",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(() =>
      applyLegalAction({
        state: handReveal,
        action: getPickAction(handReveal),
        selectedDeckRevealCardIds: ["deck-1"],
        deckRevealPickFreeDestination: "hand",
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow(/blocked by hand_gain_prevention/);
  });

  it("alice が bob のデッキを公開した場合、bob 自身の禁止CEでは候補を止めない", () => {
    const alicePeek = createCardInstance(DECK_PEEK, {
      instanceId: "alice-peek",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const deckCards = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(DECK_PEEK, {
        instanceId: `opponent-deck-${i + 1}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "deck",
      })
    );
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [alicePeek, ...deckCards],
      activeContinuousEffects: [handGainPreventionCE(BOB)],
    };
    const bobHandCountBefore = state.players.find(
      (player) => player.id === BOB
    )!.handCount;
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1735",
      state,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              player: "opponent",
              revealCount: 2,
              picks: [{ count: 1 }],
              remainder: "bottom",
            },
          },
        ],
      },
      sourceInstanceId: "alice-peek",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const pick = getPickAction(afterReveal, ALICE);
    expect(pick.candidateCardInstanceIds.sort()).toEqual([
      "opponent-deck-1",
      "opponent-deck-2",
    ]);
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["opponent-deck-1"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]).state;
    expect(
      afterPick.cardInstances.find(
        (card) => card.instanceId === "opponent-deck-1"
      )?.zone
    ).toBe("hand");
    expect(
      afterPick.players.find((player) => player.id === BOB)?.handCount
    ).toBe(bobHandCountBefore + 1);
  });

  it("BSTH08.5-C24 のトラッシュ→手札/手元 per-card choice は手元だけを公開し、偽装手札入力を拒否する", () => {
    const source = createCardInstance(C24, {
      instanceId: "c24-x01-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const trashed = createCardInstance(C24, {
      instanceId: "c24-x01-trashed",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const afterEffect = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1790",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [source, trashed],
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: C24.accelData!.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    const action = getLegalActions({
      state: afterEffect,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]).find(
      (candidate) => candidate.kind === "resolve_pending_zone_selection"
    );
    if (!action || action.kind !== "resolve_pending_zone_selection") {
      throw new Error("missing C24 pending zone selection");
    }
    expect(action.perCardDestinationChoices).toEqual({
      "c24-x01-trashed": ["set_aside"],
    });

    const setAside = applyLegalAction({
      state: afterEffect,
      action,
      selectedZoneCardIds: ["c24-x01-trashed"],
      zoneSelectionDestinationByCardId: { "c24-x01-trashed": "set_aside" },
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]).state;
    expect(
      setAside.cardInstances.find(
        (card) => card.instanceId === "c24-x01-trashed"
      )?.zone
    ).toBe("set_aside");

    const blockedAttempt = executeEffect({
      chainId: "test:bsrk01-x01-hand-gain-prevention:1831",
      state: {
        ...base,
        activePlayerId: BOB,
        step: "main",
        cardInstances: [source, trashed],
        activeContinuousEffects: [handGainPreventionCE(BOB)],
      },
      effect: C24.accelData!.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    const blockedAction = getLegalActions({
      state: blockedAttempt,
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]).find(
      (candidate) => candidate.kind === "resolve_pending_zone_selection"
    );
    expect(() =>
      applyLegalAction({
        state: blockedAttempt,
        action: blockedAction!,
        selectedZoneCardIds: ["c24-x01-trashed"],
        zoneSelectionDestinationByCardId: {
          "c24-x01-trashed": "hand",
        },
        getCardDefinitionById: getCardDef,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow(/blocked by hand_gain_prevention/);
  });
});
