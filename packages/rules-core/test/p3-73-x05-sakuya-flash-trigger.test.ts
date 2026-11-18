import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * P3-73 A1+A2+A3: BSTH01-X05「十六夜 咲夜」フラッシュ無効化の誘発化。
 *
 * カード本文 (textLines[2]):
 *   『自分のアタックステップ』中、相手が手札/手元のフラッシュ効果を使用したとき、
 *   自分の創界神ネクサス/導界者ネクサスがなく、自分がゲーム開始時に契約カードを
 *   提示していなければ、その効果発揮前に手札にあるこのカードをコストを支払わずに
 *   召喚することで、その効果を無効にする。
 *
 * この増分で検証するのは「誘発が非公開キュー (pendingPrivateDeclarations) に乗る」まで。
 * negate の実効化 (A4) / スタック順序 (A5) は別増分。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  advanceStep,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queueFlashUsedTriggers,
} from "../src";
import type {
  ActiveStack,
  CardDefinition,
  GameState,
  StackWindow,
  Zone,
} from "../src";
import {
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";

const 咲夜 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X05")!;
const 手元フラッシュ実カード = ALL_CARDS.find(
  (c) => c.cardNo === "BSTH08.5-R13"
)!;

// 相手が使用するフラッシュマジックの最小定義 (relatedInstance 用)。
const フラッシュマジック: CardDefinition = {
  cardNo: "P3-73-FLASH-MAGIC",
  name: "P3-73 フラッシュマジック",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const 手札フラッシュ効果: CardDefinition = {
  cardNo: "P3-73-HAND-FLASH-EFFECT",
  name: "P3-73 手札フラッシュ効果",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      applicability: { zone: "hand" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};

const アクセルフラッシュ効果: CardDefinition = {
  cardNo: "P3-73-ACCEL-FLASH-EFFECT",
  name: "P3-73 アクセルフラッシュ効果",
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
  effects: [],
  accelData: {
    timing: "flash",
    cost: 0,
    reduction: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  },
};

const チェンジフラッシュ効果: CardDefinition = {
  cardNo: "P3-73-CHANGE-FLASH-EFFECT",
  name: "P3-73 チェンジフラッシュ効果",
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
  tribe: "戦士",
  effects: [],
  changeData: {
    cost: 0,
    reduction: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
    swapCondition: { tribes: ["戦士"], maxCost: 5 },
  },
};

const 創界神: CardDefinition = {
  ...フラッシュマジック,
  cardNo: "P3-73-SOUKAISHIN",
  printedCategory: "nexus",
  tribe: "創界神",
};

const lookup = (() => {
  const map = new Map<string, CardDefinition>([
    [咲夜.cardNo, 咲夜],
    [手元フラッシュ実カード.cardNo, 手元フラッシュ実カード],
    [フラッシュマジック.cardNo, フラッシュマジック],
    [手札フラッシュ効果.cardNo, 手札フラッシュ効果],
    [アクセルフラッシュ効果.cardNo, アクセルフラッシュ効果],
    [チェンジフラッシュ効果.cardNo, チェンジフラッシュ効果],
    [創界神.cardNo, 創界神],
  ]);
  return (definitionId: string) => map.get(definitionId);
})();
const triggerLookup = buildTriggeredEffectLookup([
  咲夜,
  手元フラッシュ実カード,
  フラッシュマジック,
  手札フラッシュ効果,
  アクセルフラッシュ効果,
  チェンジフラッシュ効果,
  創界神,
]);
const handLookup = buildHandActivatedEffectLookup([
  咲夜,
  手元フラッシュ実カード,
  フラッシュマジック,
  手札フラッシュ効果,
  アクセルフラッシュ効果,
  チェンジフラッシュ効果,
  創界神,
]);

/** alice 手札に咲夜、bob 手札にフラッシュマジックを置いた基本盤面。 */
function makeState(
  overrides: Partial<Pick<GameState, "step" | "activePlayerId">>
): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(咲夜, {
        instanceId: "sakuya-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(フラッシュマジック, {
        instanceId: "bob-flash-1",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
      createCardInstance(手札フラッシュ効果, {
        instanceId: "bob-hand-flash-1",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
    ],
    playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
  });
  return { ...base, ...overrides };
}

function fireBobFlash(state: GameState, flashSourceFromZone?: Zone): GameState {
  return queueFlashUsedTriggers({
    chainId: "test:p3-73-x05-sakuya-flash-trigger:201",
    state,
    flashSourceInstanceId: "bob-flash-1",
    userPlayerId: "bob",
    ...(flashSourceFromZone !== undefined ? { flashSourceFromZone } : {}),
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggerLookup,
    getRegisteredBurstActions: () => undefined,
  });
}

function moveBobFlashSource(state: GameState, zone: Zone): GameState {
  return {
    ...state,
    cardInstances: state.cardInstances.map((card) =>
      card.instanceId === "bob-flash-1" ? { ...card, zone } : card
    ),
  };
}

function makeBattleFlashState(
  cardInstances: GameState["cardInstances"]
): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances,
    playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
    battleEntities: [
      {
        entityId: "battle-entity:alice-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 1000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack:p3-73-flash-action",
      primaryEntityId: "battle-entity:alice-attacker",
      participantEntityIds: ["battle-entity:alice-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:alice-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:alice-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "bob",
        pendingStackAction: null,
      },
    },
  });
  return {
    ...base,
    step: "attack",
    activePlayerId: "alice",
    window: "flash_before_block",
  };
}

describe("P3-73 X05 咲夜 flash-used triggered effect", () => {
  it("自分のアタックステップ中に相手がフラッシュを使うと、手札の咲夜が非公開キューに乗る", () => {
    const state = makeState({ step: "attack", activePlayerId: "alice" });
    const next = fireBobFlash(state);

    expect(next.pendingTriggeredEffects).toHaveLength(0);
    expect(next.pendingPrivateDeclarations).toHaveLength(1);
    expect(next.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "sakuya-1",
      sourceDefinitionId: "BSTH01-X05",
      sourceZone: "hand",
      eventKind: "flash",
    });

    // 所有者 (alice) にだけ declare/skip が出る。相手 (bob) には何も出ない。
    const aliceActions = getLegalActions({
      state: next,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const bobActions = getLegalActions({
      state: next,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(aliceActions.map((a) => a.kind)).toEqual([
      "declare_private_triggered_effect",
      "skip_private_triggered_effect",
    ]);
    expect(bobActions).toEqual([]);
  });

  it("手元のフラッシュ使用には反応し、手札/手元以外のフラッシュ使用には反応しない", () => {
    const base = makeState({ step: "attack", activePlayerId: "alice" });

    const fromSetAside = fireBobFlash(
      moveBobFlashSource(base, "set_aside"),
      "set_aside"
    );
    expect(fromSetAside.pendingPrivateDeclarations).toHaveLength(1);

    const fromField = fireBobFlash(moveBobFlashSource(base, "field"), "field");
    expect(fromField.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("手札の activated flash 効果を使用した経路でも flash-used event が積まれる", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(咲夜, {
          instanceId: "sakuya-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(手札フラッシュ効果, {
          instanceId: "bob-hand-flash-1",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
      battleEntities: [
        {
          entityId: "battle-entity:alice-attacker",
          memberInstanceIds: ["alice-attacker"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack:p3-73-hand-flash",
        primaryEntityId: "battle-entity:alice-attacker",
        participantEntityIds: ["battle-entity:alice-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:alice-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:alice-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "bob",
          pendingStackAction: null,
        },
      },
    });
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: "alice",
      window: "flash_before_block",
    };

    const action = {
      kind: "use_hand_card_effect" as const,
      actionId: "test-use-hand-flash",
      registrationIndex: 0,
      effectIndex: 0,
      chosenTiming: "flash" as const,
      can: true as const,
      reason: "test_hand_flash",
      actingPlayerId: "bob",
      sourceInstanceId: "bob-hand-flash-1",
      sourceDefinitionId: 手札フラッシュ効果.cardNo,
      sourceCardNo: 手札フラッシュ効果.cardNo,
      targetMode: "none" as const,
      requiredTargetCount: 0,
      targetEffectFilterTags: ["general"] as const,
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    };

    const applied = applyLegalAction({
      state,
      action,
      getCardDefinitionById: lookup,
      getRegisteredHandActivatedEffectActions: handLookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(applied.pendingPrivateDeclarations).toHaveLength(1);
    expect(applied.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "sakuya-1",
      eventKind: "flash",
      relatedInstanceId: "bob-hand-flash-1",
      fromZone: "hand",
    });
  });

  it("手元の activated flash 実カードを legal action 経路で使用しても flash-used event が積まれる", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(咲夜, {
          instanceId: "sakuya-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(手元フラッシュ実カード, {
          instanceId: "bob-set-aside-flash-1",
          ownerPlayerId: "bob",
          zone: "set_aside",
        }),
      ],
      playerOverrides: [
        { deckCount: 5 },
        { deckCount: 5, reserveNormalCoreCount: 2 },
      ],
      battleEntities: [
        {
          entityId: "battle-entity:alice-attacker",
          memberInstanceIds: ["alice-attacker"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack:p3-73-set-aside-flash",
        primaryEntityId: "battle-entity:alice-attacker",
        participantEntityIds: ["battle-entity:alice-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:alice-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:alice-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "bob",
          pendingStackAction: null,
        },
      },
    });
    const state: GameState = {
      ...base,
      step: "attack",
      activePlayerId: "alice",
      window: "flash_before_block",
    };

    const action = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredHandActivatedEffectActions: handLookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "bob-set-aside-flash-1" &&
        candidate.sourceCardNo === "BSTH08.5-R13"
    );

    expect(action).toMatchObject({
      kind: "use_hand_card_effect",
      chosenTiming: "flash",
      sourceCardNo: "BSTH08.5-R13",
    });
    if (!action || action.kind !== "use_hand_card_effect") {
      throw new Error("expected set-aside hand activated flash legal action");
    }

    const applied = applyLegalAction({
      state,
      action,
      getCardDefinitionById: lookup,
      getRegisteredHandActivatedEffectActions: handLookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(applied.pendingPrivateDeclarations).toHaveLength(1);
    expect(applied.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "sakuya-1",
      eventKind: "flash",
      relatedInstanceId: "bob-set-aside-flash-1",
      fromZone: "set_aside",
    });
  });

  it("手札のアクセルを legal action 経路で使用しても flash-used event が積まれる", () => {
    const state = makeBattleFlashState([
      createCardInstance(咲夜, {
        instanceId: "sakuya-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(アクセルフラッシュ効果, {
        instanceId: "bob-accel-flash-1",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
    ]);

    const action = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (candidate) =>
        candidate.kind === "use_accel" &&
        candidate.sourceInstanceId === "bob-accel-flash-1"
    );
    expect(action).toMatchObject({
      kind: "use_accel",
      timing: "flash",
      sourceCardNo: "P3-73-ACCEL-FLASH-EFFECT",
    });

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(applied.pendingPrivateDeclarations).toHaveLength(1);
    expect(applied.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "sakuya-1",
      eventKind: "flash",
      relatedInstanceId: "bob-accel-flash-1",
      fromZone: "hand",
    });

    // P3-115 監査: use_accel は自分の宣言窓を開く (opens_own_window) kind。
    // bob の宣言に対して alice (相手) が応答できるスタック窓が実際に開くこと。
    expect(applied.window).toBe("stack_before_block");
    expect(applied.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );
  });

  it("手札のチェンジを legal action 経路で使用しても flash-used event が積まれる", () => {
    const state = makeBattleFlashState([
      createCardInstance(咲夜, {
        instanceId: "sakuya-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(チェンジフラッシュ効果, {
        instanceId: "bob-change-flash-1",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
    ]);

    const action = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (candidate) =>
        candidate.kind === "use_change" &&
        candidate.sourceInstanceId === "bob-change-flash-1"
    );
    expect(action).toMatchObject({
      kind: "use_change",
      sourceCardNo: "P3-73-CHANGE-FLASH-EFFECT",
    });

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(applied.pendingPrivateDeclarations).toHaveLength(1);
    expect(applied.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "sakuya-1",
      eventKind: "flash",
      relatedInstanceId: "bob-change-flash-1",
      fromZone: "hand",
    });

    // P3-115 監査: use_change は自分の宣言窓を開く (opens_own_window) kind。
    // bob の宣言に対して alice (相手) が応答できるスタック窓が実際に開くこと。
    expect(applied.window).toBe("stack_before_block");
    expect(applied.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );
  });

  it("相手のアタックステップ (active=bob) では timingScope『自分の』により誘発しない", () => {
    const state = makeState({ step: "attack", activePlayerId: "bob" });
    const next = fireBobFlash(state);
    expect(next.pendingPrivateDeclarations).toHaveLength(0);
    expect(next.pendingTriggeredEffects).toHaveLength(0);
  });

  it("自分のメインステップ (period != attack) では誘発しない", () => {
    const state = makeState({ step: "main", activePlayerId: "alice" });
    const next = fireBobFlash(state);
    expect(next.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("自分 (alice) がフラッシュを使った場合は player:opponent フィルタで誘発しない", () => {
    const state = makeState({ step: "attack", activePlayerId: "alice" });
    const next = queueFlashUsedTriggers({
      chainId: "test:p3-73-x05-sakuya-flash-trigger:641",
      state,
      flashSourceInstanceId: "bob-flash-1",
      userPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    });
    expect(next.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("自分の創界神ネクサスがあると condition (field_lacks) 不成立で誘発しない", () => {
    const state = makeState({ step: "attack", activePlayerId: "alice" });
    // alice フィールドに創界神系統のダミーを置く。
    const withSoukaishin: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(創界神, {
          instanceId: "soukaishin-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const lookupWithSoul = (definitionId: string) =>
      definitionId === 創界神.cardNo ? 創界神 : lookup(definitionId);
    const next = queueFlashUsedTriggers({
      chainId: "test:p3-73-x05-sakuya-flash-trigger:669",
      state: withSoukaishin,
      flashSourceInstanceId: "bob-flash-1",
      userPlayerId: "bob",
      getCardDefinitionById: lookupWithSoul,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: () => undefined,
    });
    expect(next.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("queue 後に condition が崩れた private declaration は surface せず direct apply でも発揮しない", () => {
    const queued = fireBobFlash(
      makeState({ step: "attack", activePlayerId: "alice" })
    );
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);
    const declaration = queued.pendingPrivateDeclarations[0]!;

    const declareBeforeConditionChange = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declareBeforeConditionChange).toBeDefined();

    const withSoukaishin: GameState = {
      ...queued,
      cardInstances: [
        ...queued.cardInstances,
        createCardInstance(創界神, {
          instanceId: "soukaishin-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const availableAfterConditionChange = getLegalActions({
      state: withSoukaishin,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(
      availableAfterConditionChange.some(
        (action) => action.kind === "declare_private_triggered_effect"
      )
    ).toBe(false);
    expect(
      availableAfterConditionChange.some(
        (action) => action.kind === "skip_private_triggered_effect"
      )
    ).toBe(true);

    const applied = applyLegalAction({
      state: withSoukaishin,
      action: declareBeforeConditionChange!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;
    expect(applied.pendingPrivateDeclarations).toHaveLength(0);
    expect(applied.pendingTriggeredEffects).toHaveLength(0);
    expect(applied.log).toContain(
      `trigger:private-declaration:condition-unmet:${declaration.declarationId}`
    );
  });

  it("A4: 宣言では保留フラッシュを無効化せず、窓後の召喚成功で無効化し後続要求を残さない", () => {
    // 相手フラッシュ (bob-flash-1) が stackWindow の pendingStackAction として保留中の状況で、
    // 宣言だけでは無効化しない。応答窓後に維持コアを置き、召喚が成功して初めて無効化する。
    const bobMagicStack: ActiveStack = {
      stackId: "stack:bob-magic",
      actionKind: "magic",
      chainId: "chain:bob-magic",
      actingPlayerId: "bob",
      cardInstanceId: "bob-flash-1",
      cardDefinitionId: "P3-73-FLASH-MAGIC",
      chosenTiming: "flash",
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const stackWindow: StackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: bobMagicStack,
    };
    const base: GameState = {
      ...makeState({ step: "attack", activePlayerId: "alice" }),
      window: "stack",
      stackWindow,
      cardInstances: makeState({
        step: "attack",
        activePlayerId: "alice",
      }).cardInstances.map((card) =>
        card.instanceId === "bob-flash-1"
          ? { ...card, zone: "in_use" as const }
          : card
      ),
    };
    const queued = fireBobFlash(base, "hand");
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);

    const lookups = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    };

    // 案X: 相手フラッシュが応答窓 (stackWindow) にいる間は咲夜の declare は deferred。
    // alice はまず自分のスタックタイミングをパス (pass_stack) する。
    expect(
      getLegalActions({
        state: queued,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "declare_private_triggered_effect")
    ).toBeUndefined();
    const passStack = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterPass = applyLegalAction({
      state: queued,
      action: passStack!,
      ...lookups,
    }).state;

    // 窓クローズ後の発揮前チェックポイントで初めて declare が surface する。
    const declareAction = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "declare_private_triggered_effect");
    expect(declareAction).toBeDefined();
    if (
      !declareAction ||
      declareAction.kind !== "declare_private_triggered_effect"
    ) {
      throw new Error("missing declare action");
    }

    const declared = applyLegalAction({
      state: afterPass,
      action: declareAction,
      ...lookups,
    }).state;

    // 発揮宣言は対価支払いではない。対象は未解決のまま、nullify ログもない。
    expect(
      declared.cardInstances.find((c) => c.instanceId === "bob-flash-1")?.zone
    ).toBe("in_use");
    expect(declared.log.some((l) => l.startsWith("magic:nullified:"))).toBe(
      false
    );
    // 咲夜自体は公開 pendingTriggeredEffects に乗る (後で summon + negate を解決)
    expect(declared.pendingTriggeredEffects).toHaveLength(1);
    expect(declared.pendingTriggeredEffects[0]?.declaredSourceInstanceId).toBe(
      "sakuya-1"
    );
    // BSAZ01-C03 等が既に end_attack_step を予約したあと、発揮前に無効化された
    // フラッシュへ咲夜の one-shot negate が到達する実障害の形を作る。
    const declaredWithPendingAttackEnd: GameState = {
      ...declared,
      pendingAttackStepEndFinalizations: [
        {
          pendingId: "attack-step-end:24:0",
          actingPlayerId: "bob",
          sourceInstanceId: "battle-entity:card-40",
          createdAtTurn: 24,
        },
      ],
    };

    // 元フラッシュを保留したまま召喚を解決し、one-shot negate request を
    // 後続 action へ残さない。残ると、無関係な
    // end_attack_step finalization まで blocker になり進行不能になる。
    const resolveSakuya = getLegalActions({
      state: declaredWithPendingAttackEnd,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_triggered_effect");
    expect(resolveSakuya).toBeDefined();
    let settled = applyLegalAction({
      state: declaredWithPendingAttackEnd,
      action: resolveSakuya!,
      ...lookups,
    }).state;
    for (let guard = 0; guard < 4 && settled.stackWindow !== null; guard += 1) {
      const pass = getLegalActions({
        state: settled,
        actingPlayerId: settled.stackWindow.priorityPlayerId,
        ...lookups,
      }).find(
        (action) =>
          action.kind === "pass_stack" || action.kind === "pass_battle_flash"
      );
      expect(pass).toBeDefined();
      settled = applyLegalAction({
        state: settled,
        action: pass!,
        ...lookups,
      }).state;
    }
    settled = finishCoreChoices(settled, lookup, lookups);
    expect(
      settled.cardInstances.find((card) => card.instanceId === "sakuya-1")?.zone
    ).toBe("field");
    expect(
      settled.cardInstances.find((card) => card.instanceId === "bob-flash-1")
        ?.zone
    ).toBe("trash");
    expect(
      settled.log.some((line) => line.startsWith("magic:nullified:"))
    ).toBe(true);
    // 咲夜の召喚で通常の burst check も発生するため、通常どおり不発を選ぶ。
    // これが最後の正規 pending を drain した action で attack-step finalization が
    // one-shot negate の残骸に妨げられず確定する。
    for (
      let guard = 0;
      guard < 4 && settled.pendingBurstChecks.length > 0;
      guard += 1
    ) {
      const pendingBurst = settled.pendingBurstChecks[0]!;
      settled = applyLegalAction({
        state: settled,
        action: {
          chainId: "test:p3-73-x05-sakuya-flash-trigger:885",
          kind: "decline_pending_burst_check",
          actionId: `decline:${pendingBurst.checkId}`,
          can: true,
          reason: "test",
          actingPlayerId: pendingBurst.actingPlayerId,
          checkId: pendingBurst.checkId,
          eventKind: pendingBurst.eventKind,
          relatedPlayerId: pendingBurst.relatedPlayerId,
        },
        ...lookups,
      }).state;
    }
    expect(settled.pendingTriggeredEffects).toHaveLength(0);
    expect(settled.pendingStackNegateRequests).toHaveLength(0);
    expect(settled.pendingBurstChecks).toHaveLength(0);
    expect(settled.pendingAttackStepEndFinalizations).toHaveLength(0);
    expect(settled.step).toBe("end");
    expect(() => advanceStep(settled, lookup, triggerLookup)).not.toThrow();
  });

  it("A4: negatePreventionLevel:unpreventable の相手フラッシュには declare を出さない", () => {
    const bobMagicStack: ActiveStack = {
      stackId: "stack:bob-magic-unpreventable",
      actionKind: "magic",
      chainId: "chain:bob-magic-unpreventable",
      actingPlayerId: "bob",
      cardInstanceId: "bob-flash-1",
      cardDefinitionId: "P3-73-FLASH-MAGIC",
      chosenTiming: "flash",
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
      negatePreventionLevel: "unpreventable",
    };
    const stackWindow: StackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: bobMagicStack,
    };
    const queued = fireBobFlash({
      ...makeState({ step: "attack", activePlayerId: "alice" }),
      window: "stack",
      stackWindow,
    });
    const lookups = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    };
    const passStack = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterPass = applyLegalAction({
      state: queued,
      action: passStack!,
      ...lookups,
    }).state;

    const actionKinds = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).map((a) => a.kind);
    expect(actionKinds).not.toContain("declare_private_triggered_effect");
    expect(actionKinds).toContain("skip_private_triggered_effect");
  });
});
