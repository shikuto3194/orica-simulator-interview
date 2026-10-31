import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  CardDefinition,
  CardZone,
  GameState,
  LegalAction,
} from "@orica/rules-core";
import { applyPatch, type Operation } from "fast-json-patch";
import { ALL_CARDS } from "@orica/card-data";
import {
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getActAsSpiritMetadata,
  getLegalActions,
  getKnownDeckCards,
  initializeGame,
} from "@orica/rules-core";
import {
  requireRoomMember,
  sanitizeStateForViewer,
  sanitizeStateForSpectator,
  addSSEConnection,
  pruneExpiredSSEConnections,
  broadcastSSEStateUpdate,
  prepareViewerStateSyncPayloads,
  computeOpponentDisconnected,
  restoreHiddenStateForActor,
  sanitizeReplayPayload,
  sanitizeReplayEventForViewer,
  replayClaimVictoryEvent,
  replayCoreMoveEvent,
  replayPregameUpdateEvent,
  replayEvent,
  __resetSSEConnectionsForTest,
  __initializeGameApiLookupsForTest,
  executeAction,
  shouldRestartGameApiForHotUpdate,
  summarizeAction,
  summarizeState,
  authenticateRequest,
  isReplayRestoreCommitAuthorized,
  createRoomMutationRandomContext,
  runWithRoomMutationRandom,
  roomMutationRandomTrace,
  __setAuthVerifierForTest,
  __clearAuthCacheForTest,
} from "../server/game-api";

describe("replay restore commit authorization", () => {
  it("configured operator token の完全一致だけを許可する", () => {
    expect(
      isReplayRestoreCommitAuthorized("restore-secret", "restore-secret")
    ).toBe(true);
    expect(isReplayRestoreCommitAuthorized("wrong", "restore-secret")).toBe(
      false
    );
    expect(isReplayRestoreCommitAuthorized(undefined, "restore-secret")).toBe(
      false
    );
    expect(isReplayRestoreCommitAuthorized("restore-secret", "")).toBe(false);
    expect(
      isReplayRestoreCommitAuthorized(["restore-secret"], "restore-secret")
    ).toBe(false);
  });
});

function createLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return (definitionId: string) => map.get(definitionId);
}

function createPlayCardDefinition(
  cardNo: string,
  printedCategory: "spirit" | "nexus"
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory,
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs:
      printedCategory === "spirit"
        ? [{ level: 1, requiredCores: 1, bp: 1000 }]
        : [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function createMainStepState(
  definition: CardDefinition,
  instanceId: string
): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId,
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 3 },
        { reserveNormalCoreCount: 3 },
      ],
    }),
    activePlayerId: "alice",
    step: "main",
    pendingEnterFieldPlacement: null,
  };
}

function createCfUltimateDefinition(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 3, requiredCores: 1, bp: 3000 }],
    symbolColors: ["white"],
    textLines: [],
    keywordTags: [],
    tribe: "ＣＦ",
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function createZoneDiscountMagicDefinition(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    colors: ["white"],
    cost: 6,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "trash",
            filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
            min: 2,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { additionalCostValue: -3 },
              useCostPayment: {
                kind: "return_to_deck_top_bottom",
                sourceZone: "trash",
                count: 2,
                filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [1],
      },
    ],
  };
}

describe("gameApiPlugin hot update boundary", () => {
  it.each([
    "C:/dev/orica-simulator/packages/rules-core/src/core/cost-system.ts",
    "C:\\dev\\orica-simulator\\packages\\card-data\\src\\cards\\BSSA01.ts",
  ])("restarts the API runtime when engine/card data changes: %s", (file) => {
    expect(shouldRestartGameApiForHotUpdate(file)).toBe(true);
  });

  it.each([
    "C:/dev/orica-simulator/apps/playground-web/src/App.tsx",
    "C:/dev/orica-simulator/manual/ai-reference/README.md",
    "C:/dev/orica-simulator/packages/card-data/test/BSSA01.test.ts",
  ])("keeps normal HMR for unrelated changes: %s", (file) => {
    expect(shouldRestartGameApiForHotUpdate(file)).toBe(false);
  });
});

describe("state/action summaries: text_role under-card SSOT", () => {
  it("host summary keeps the under-card role and queued provider effect identity", async () => {
    const hostDefinition = createPlayCardDefinition("API-BE-HOST", "spirit");
    const providerDefinition: CardDefinition = {
      ...createPlayCardDefinition("BSGE01-R03", "spirit"),
      name: "橘 サクヤ",
      textLines: [
        "【雷鎚：ショット】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "このスピリットがアタックしたとき、自分のカウント-2することで、相手のライフのコア1個をトラッシュに置く。",
      ],
    };
    await __initializeGameApiLookupsForTest([
      hostDefinition,
      providerDefinition,
    ]);

    const hostCard = {
      ...createCardInstance(hostDefinition, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "under-1",
          role: "text_role" as const,
          roleTag: "バレットエディット",
        },
      ],
    };
    const providerCard = {
      ...createCardInstance(providerDefinition, {
        instanceId: "under-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: "host-1",
      zoneRoleName: "バレットエディット",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [hostCard, providerCard],
        playerOverrides: [{ count: 2 }, {}],
      }),
      battleImmediateEffects: [
        {
          promptId:
            "battle-immediate:attack-1:attack:host-1:under-1:BSGE01-R03:0",
          attackId: "attack-1",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "host-1",
          sourceDefinitionId: "API-BE-HOST",
          sourceEffectDefinitionId: "BSGE01-R03",
          sourceEffectInstanceId: "under-1",
          sourceCardNo: "API-BE-HOST",
          actingPlayerId: "alice",
          participantEntityId: "host-1",
          registrationIndex: 0,
          executionMode: "optional",
        },
      ],
    };

    const summary = summarizeState(state);
    const summarizedHost = summary.cards.find(
      (card) => card.instanceId === "host-1"
    );
    expect(summarizedHost?.underCards).toEqual([
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
        cardNo: "BSGE01-R03",
        name: "橘 サクヤ",
      },
    ]);
    expect(summary.battleImmediateEffects).toEqual([
      {
        promptId:
          "battle-immediate:attack-1:attack:host-1:under-1:BSGE01-R03:0",
        attackId: "attack-1",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "host-1",
        sourceDefinitionId: "API-BE-HOST",
        sourceEffectDefinitionId: "BSGE01-R03",
        sourceEffectInstanceId: "under-1",
        sourceCardNo: "API-BE-HOST",
        actingPlayerId: "alice",
        participantEntityId: "host-1",
        registrationIndex: 0,
        executionMode: "optional",
      },
    ]);
  });

  it("action summary keeps sourceEffect fields for under-card-provided effects", () => {
    const summary = summarizeAction({
      kind: "resolve_battle_immediate_effect",
      actionId: "resolve-bie-1",
      can: true,
      reason: "ok",
      actingPlayerId: "alice",
      promptId: "battle-immediate:attack-1:attack:host-1:under-1:BSGE01-R03:0",
      attackId: "attack-1",
      timing: "attack",
      sourceKind: "spirit",
      sourceInstanceId: "host-1",
      sourceDefinitionId: "API-BE-HOST",
      sourceEffectDefinitionId: "BSGE01-R03",
      sourceEffectInstanceId: "under-1",
      sourceCardNo: "API-BE-HOST",
      participantEntityId: "host-1",
      registrationIndex: 0,
      executionMode: "optional",
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    } as LegalAction);

    expect(summary).toMatchObject({
      actionId: "resolve-bie-1",
      kind: "resolve_battle_immediate_effect",
      sourceInstanceId: "host-1",
      sourceDefinitionId: "API-BE-HOST",
      sourceEffectDefinitionId: "BSGE01-R03",
      sourceEffectInstanceId: "under-1",
      promptId: "battle-immediate:attack-1:attack:host-1:under-1:BSGE01-R03:0",
      registrationIndex: 0,
      executionMode: "optional",
    });
  });
});

describe("executeAction: normal play-card actions", () => {
  it("routes summon through applyLegalAction and opens the stack before enter-field placement", async () => {
    const spirit = createPlayCardDefinition("API-STACK-SPIRIT", "spirit");
    await __initializeGameApiLookupsForTest([spirit]);
    const state = createMainStepState(spirit, "spirit-1");
    const getDefinition = createLookup([spirit]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (legalAction): legalAction is Extract<LegalAction, { kind: "summon" }> =>
        legalAction.kind === "summon"
    );
    expect(action).toBeDefined();

    const result = executeAction({
      state,
      actingPlayerId: "alice",
      action: action!,
      body: { paymentSources: [{ kind: "reserve", amount: 1 }] },
    });

    expect(result.state.window).toBe("stack");
    expect(result.state.stackWindow?.priorityPlayerId).toBe("bob");
    expect(result.state.pendingEnterFieldPlacement).toBeNull();
    expect(
      result.state.cardInstances.find((card) => card.instanceId === "spirit-1")
        ?.zone
    ).toBe("in_use");
  });

  it("routes place_nexus through applyLegalAction and opens the stack before enter-field placement", async () => {
    const nexus = createPlayCardDefinition("API-STACK-NEXUS", "nexus");
    await __initializeGameApiLookupsForTest([nexus]);
    const state = createMainStepState(nexus, "nexus-1");
    const getDefinition = createLookup([nexus]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (
        legalAction
      ): legalAction is Extract<LegalAction, { kind: "place_nexus" }> =>
        legalAction.kind === "place_nexus"
    );
    expect(action).toBeDefined();

    const result = executeAction({
      state,
      actingPlayerId: "alice",
      action: action!,
      body: { paymentSources: [{ kind: "reserve", amount: 1 }] },
    });

    expect(result.state.window).toBe("stack");
    expect(result.state.stackWindow?.priorityPlayerId).toBe("bob");
    expect(result.state.pendingEnterFieldPlacement).toBeNull();
    expect(
      result.state.cardInstances.find((card) => card.instanceId === "nexus-1")
        ?.zone
    ).toBe("in_use");
  });

  it("passes Q54 place_nexus declaration targets through the REST execution path", async () => {
    const guidedKeya = ALL_CARDS.find(
      (definition) => definition.cardNo === "BSLH01-X01"
    )!;
    const grandwalkerKeya = ALL_CARDS.find(
      (definition) => definition.cardNo === "BSLH01-X02"
    )!;
    const definitions = [guidedKeya, grandwalkerKeya];
    await __initializeGameApiLookupsForTest(definitions);
    const getDefinition = createLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
    };
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(guidedKeya, {
          instanceId: "api-guided-keya",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "nexus",
          normalCoreCount: 8,
        }),
        createCardInstance(grandwalkerKeya, {
          instanceId: "api-grandwalker-keya",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: "alice",
      step: "main",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      ...effectLookups,
    }).find(
      (
        legalAction
      ): legalAction is Extract<LegalAction, { kind: "place_nexus" }> =>
        legalAction.kind === "place_nexus" &&
        legalAction.reason === "legal_place_nexus_by_hand_permission"
    );
    expect(action).toMatchObject({
      candidateTargetInstanceIds: ["api-guided-keya"],
      requiredTargetCount: 1,
    });
    expect(summarizeAction(action!)).toMatchObject({
      targetMode: "manual",
      requiredTargetCount: 1,
      candidateTargetInstanceIds: ["api-guided-keya"],
    });

    const result = executeAction({
      state,
      actingPlayerId: "alice",
      action: action!,
      body: {
        targetInstanceIds: ["api-guided-keya"],
        paymentSources: [],
      },
    });

    expect(result.state.stackWindow?.pendingStackAction?.actionKind).toBe(
      "place_nexus"
    );
    expect(
      result.state.cardInstances.find(
        (card) => card.instanceId === "api-grandwalker-keya"
      )?.zone
    ).toBe("in_use");
    const guidedAfterDeclaration = result.state.cardInstances.find(
      (card) => card.instanceId === "api-guided-keya"
    );
    expect(
      guidedAfterDeclaration?.zone === "trash" ||
        result.state.pendingLeaveEntities.some(
          (pending) => pending.instanceId === "api-guided-keya"
        )
    ).toBe(true);
  });

  it("auto-pays use_magic zone_discount from the legal action finalCost", async () => {
    const magic = createZoneDiscountMagicDefinition("API-ZONE-DISCOUNT-MAGIC");
    const cfUltimate = createCfUltimateDefinition("API-CF-ULTIMATE");
    const definitions = [magic, cfUltimate];
    await __initializeGameApiLookupsForTest(definitions);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(magic, {
            instanceId: "zone-magic",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(cfUltimate, {
            instanceId: "trash-cf-a",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "trash",
          }),
          createCardInstance(cfUltimate, {
            instanceId: "trash-cf-b",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "trash",
          }),
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 6, handCount: 1, deckCount: 20 },
          { reserveNormalCoreCount: 3, deckCount: 20 },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "main_step",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: createLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
    }).find(
      (candidate): candidate is Extract<LegalAction, { kind: "use_magic" }> =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "zone-magic" &&
        candidate.costMode === "zone_discount"
    );
    expect(action).toBeDefined();
    expect(action?.finalCost).toBe(3);

    const result = executeAction({
      state,
      actingPlayerId: "alice",
      action: action!,
      body: { selectedZoneCardIds: ["trash-cf-a", "trash-cf-b"] },
    });

    expect(
      result.state.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(3);
    expect(
      result.state.cardInstances.find(
        (card) => card.instanceId === "zone-magic"
      )?.zone
    ).toBe("in_use");
    expect(
      result.state.cardInstances.find(
        (card) => card.instanceId === "trash-cf-a"
      )?.zone
    ).toBe("deck");
    expect(
      result.state.cardInstances.find(
        (card) => card.instanceId === "trash-cf-b"
      )?.zone
    ).toBe("deck");
  });
});

describe("executeAction: paidPreventionImmunityCardSelection passthrough (P3-128/ENGINE-paid-prevention-immunity-card-cost follow-up)", () => {
  // ENGINE-paid-prevention-immunity-card-cost Step3: `payPreventionImmunityCost` variant
  // (cost.resource: "card") で候補数が amount を超えるとき、player が選んだ部分集合を
  // `paidPreventionImmunityCardSelection` として渡す必要がある。REST 経由でこのフィールドを
  // 供給しても `extractApplyOptionsFromBody` の passthroughKeys allowlist に無いと
  // silently drop され、rules-core 側が "explicit paidPreventionImmunityCardSelection is
  // required" で throw する (adversarial verifier 2026-07-28 refute)。
  const CARD_COST_AMOUNT = 2;

  function hostDef(cardNo: string): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "鋼騎士",
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "grant_paid_prevention_immunity",
                target: { kind: "self" },
                cost: {
                  resource: "card",
                  amount: CARD_COST_AMOUNT,
                  zone: "trash",
                  filter: { tribes: ["鋼騎士"] },
                },
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            {
              action: {
                kind: "destroy",
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
    };
  }

  function enemyDef(cardNo: string): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
  }

  function fodderDef(cardNo: string): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "鋼騎士",
    };
  }

  it("候補数が amount を超えるとき、body の paidPreventionImmunityCardSelection が engine まで届き throw しない", async () => {
    const host = hostDef("API-PPICC-HOST");
    const enemy = enemyDef("API-PPICC-ENEMY");
    const fodder = fodderDef("API-PPICC-FODDER");
    const definitions = [host, enemy, fodder];
    await __initializeGameApiLookupsForTest(definitions);
    const getDefinition = createLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
    };

    const fodderCards = Array.from({ length: CARD_COST_AMOUNT + 1 }, (_, i) =>
      createCardInstance(fodder, {
        instanceId: `fodder-${i}`,
        ownerPlayerId: "alice",
        zone: "trash",
      })
    );
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(host, {
            instanceId: "host-1",
            ownerPlayerId: "alice",
            zone: "field",
            controllerPlayerId: "alice",
            normalCoreCount: 1,
          }),
          createCardInstance(enemy, {
            instanceId: "enemy-1",
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
          ...fodderCards,
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 3 },
          { reserveNormalCoreCount: 3 },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingEnterFieldPlacement: null,
    };

    // grant_paid_prevention_immunity は continuous CE なので、host が既に場にいる
    // baseState を legal-actions 経由で直接評価すれば summon 誘発 pending が既に
    // キューされる (executeAction の summon スタック配線を経由する必要はない —
    // 本テストの対象は payPreventionImmunityCost variant の REST passthrough)。
    // legal-actions は pendingTriggeredEffects を state から読むので、summon 誘発
    // pending を持つ state を getLegalActions で probe して見つからなければ、
    // 直接 summon action 経由で host を場に出す。
    const summonSource: GameState = {
      ...baseState,
      cardInstances: baseState.cardInstances.map((c) =>
        c.instanceId === "host-1" ? { ...c, zone: "hand" as const } : c
      ),
    };
    const summonAction = getLegalActions({
      state: summonSource,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      ...effectLookups,
    }).find(
      (a): a is Extract<LegalAction, { kind: "summon" }> => a.kind === "summon"
    );
    expect(summonAction).toBeDefined();

    let state = executeAction({
      state: summonSource,
      actingPlayerId: "alice",
      action: summonAction!,
      body: {
        paymentSources: [{ kind: "reserve", amount: 2 }],
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      },
    }).state;

    // summon は applyLegalAction 経由でスタック窓を開く。相手が pass_stack して閉じる。
    if (state.window === "stack" && state.stackWindow) {
      const passAction = getLegalActions({
        state,
        actingPlayerId: state.stackWindow.priorityPlayerId,
        getCardDefinitionById: getDefinition,
        ...effectLookups,
      }).find(
        (a): a is Extract<LegalAction, { kind: "pass_stack" }> =>
          a.kind === "pass_stack"
      );
      if (passAction) {
        state = executeAction({
          state,
          actingPlayerId: state.stackWindow.priorityPlayerId,
          action: passAction,
          body: {},
        }).state;
      }
    }

    const paidVariant = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        (a as { payPreventionImmunityCost?: true })
          .payPreventionImmunityCost === true
    );
    expect(paidVariant).toBeDefined();
    if (!paidVariant) throw new Error("unreachable");
    const candidates = (
      paidVariant as {
        paidPreventionImmunityCardCostCandidateInstanceIds?: string[];
      }
    ).paidPreventionImmunityCardCostCandidateInstanceIds;
    expect(candidates).toHaveLength(CARD_COST_AMOUNT + 1);
    const selection = candidates!.slice(0, CARD_COST_AMOUNT);

    const result = executeAction({
      state,
      actingPlayerId: "alice",
      action: paidVariant,
      body: { paidPreventionImmunityCardSelection: selection },
    });
    const removedFodder = result.state.cardInstances.filter(
      (c) =>
        c.definitionId === "API-PPICC-FODDER" && c.zone === "removed_from_game"
    );
    expect(removedFodder).toHaveLength(CARD_COST_AMOUNT);
  });
});

describe("executeAction: coreDistributionSoulCoreAllocations passthrough", () => {
  it("body の複数ソウルコア配分 map が applyLegalAction まで届き盤面へ反映される", async () => {
    const host = createPlayCardDefinition("API-CD-HOST", "spirit");
    const token = createPlayCardDefinition("API-CD-TOKEN", "spirit");
    const primary = createPlayCardDefinition("API-CD-PRIMARY", "spirit");
    const definitions = [host, token, primary];
    await __initializeGameApiLookupsForTest(definitions);
    const getDefinition = createLookup(definitions);

    const hostCard = createCardInstance(host, {
      instanceId: "cd-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const tokenA = createCardInstance(token, {
      instanceId: "cd-token-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      everHadCorePlaced: false,
    });
    const tokenB = createCardInstance(token, {
      instanceId: "cd-token-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      everHadCorePlaced: false,
    });
    const primarySoulCard = createCardInstance(primary, {
      instanceId: "cd-primary-soul",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [hostCard, tokenA, tokenB, primarySoulCard],
      playerOverrides: [
        {
          trashNormalCoreCount: 1,
          trashSoulCoreCount: 2,
          soulCoreLocation: {
            kind: "card",
            instanceId: "cd-primary-soul",
          },
        },
        { reserveNormalCoreCount: 3 },
      ],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: "alice",
      step: "main",
      pendingCoreDistribution: {
        pendingId: "cd-api-map",
        actingPlayerId: "alice",
        sourceInstanceId: "cd-host",
        sourceDefinitionId: "API-CD-HOST",
        candidates: [
          { instanceId: "cd-token-a", definitionId: "API-CD-TOKEN" },
          { instanceId: "cd-token-b", definitionId: "API-CD-TOKEN" },
        ],
        totalNormalCores: 1,
        hasSoulCore: true,
        totalSoulCores: 2,
        fromKind: "trash",
        minTotal: 1,
        mustPlaceSoulCore: true,
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "activated", mode: "main" },
        priorStateSnapshot: baseState,
      },
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (
        a
      ): a is Extract<
        LegalAction,
        { kind: "resolve_pending_core_distribution" }
      > => a.kind === "resolve_pending_core_distribution"
    );
    expect(action).toBeDefined();
    expect(action?.totalSoulCores).toBe(2);

    const result = executeAction({
      state,
      actingPlayerId: "alice",
      action: action!,
      body: {
        coreDistributionAllocations: { "cd-token-a": 1 },
        coreDistributionSoulCoreAllocations: {
          "cd-token-a": 1,
          "cd-token-b": 1,
        },
      },
    });

    expect(result.state.pendingCoreDistribution).toBeNull();
    const alice = result.state.players.find((p) => p.id === "alice")!;
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "cd-primary-soul",
    });
    const primaryAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "cd-primary-soul"
    )!;
    const tokenAAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "cd-token-a"
    )!;
    const tokenBAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "cd-token-b"
    )!;
    expect(primaryAfter.soulCoreCount).toBe(1);
    expect(tokenAAfter.normalCoreCount).toBe(2);
    expect(tokenAAfter.soulCoreCount).toBe(1);
    expect(tokenAAfter.everHadCorePlaced).toBe(true);
    expect(tokenBAfter.normalCoreCount).toBe(1);
    expect(tokenBAfter.soulCoreCount).toBe(1);
    expect(tokenBAfter.everHadCorePlaced).toBe(true);
  });

  it("any_movable body のソウルコア source map が applyLegalAction まで届き盤面へ反映される", async () => {
    const host = createPlayCardDefinition("API-CD2-HOST", "spirit");
    const token = createPlayCardDefinition("API-CD2-TOKEN", "spirit");
    const primary = createPlayCardDefinition("API-CD2-PRIMARY", "spirit");
    const definitions = [host, token, primary];
    await __initializeGameApiLookupsForTest(definitions);
    const getDefinition = createLookup(definitions);

    const hostCard = createCardInstance(host, {
      instanceId: "cd2-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const tokenA = createCardInstance(token, {
      instanceId: "cd2-token-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      everHadCorePlaced: false,
    });
    const tokenB = createCardInstance(token, {
      instanceId: "cd2-token-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      everHadCorePlaced: false,
    });
    const primarySoulCard = createCardInstance(primary, {
      instanceId: "cd2-primary-soul",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      soulCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [hostCard, tokenA, tokenB, primarySoulCard],
      playerOverrides: [
        {
          reserveSoulCoreCount: 1,
          soulCoreLocation: {
            kind: "card",
            instanceId: "cd2-primary-soul",
          },
        },
        { reserveNormalCoreCount: 3 },
      ],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: "alice",
      step: "main",
      pendingCoreDistribution: {
        pendingId: "cd-api-any-map",
        actingPlayerId: "alice",
        sourceInstanceId: "cd2-host",
        sourceDefinitionId: "API-CD2-HOST",
        candidates: [
          { instanceId: "cd2-token-a", definitionId: "API-CD2-TOKEN" },
          { instanceId: "cd2-token-b", definitionId: "API-CD2-TOKEN" },
        ],
        totalNormalCores: 0,
        hasSoulCore: true,
        totalSoulCores: 2,
        fromKind: "any_movable",
        allowedSources: [],
        sourceAvailable: {},
        soulSourceAvailable: {
          reserve: 1,
          "field:cd2-primary-soul": 1,
        },
        minTotal: 1,
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "activated", mode: "main" },
        priorStateSnapshot: baseState,
      },
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (
        a
      ): a is Extract<
        LegalAction,
        { kind: "resolve_pending_core_distribution" }
      > => a.kind === "resolve_pending_core_distribution"
    );
    expect(action).toBeDefined();
    expect(action?.soulSourceAvailable).toEqual({
      reserve: 1,
      "field:cd2-primary-soul": 1,
    });

    const result = executeAction({
      state,
      actingPlayerId: "alice",
      action: action!,
      body: {
        coreDistributionAllocations: {},
        coreDistributionSoulCoreAllocations: {
          "cd2-token-a": 1,
          "cd2-token-b": 1,
        },
        coreDistributionSoulCoreSourceAllocations: {
          reserve: 1,
          "field:cd2-primary-soul": 1,
        },
      },
    });

    const alice = result.state.players.find((p) => p.id === "alice")!;
    const primaryAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "cd2-primary-soul"
    )!;
    const tokenAAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "cd2-token-a"
    )!;
    const tokenBAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "cd2-token-b"
    )!;
    expect(result.state.pendingCoreDistribution).toBeNull();
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "cd2-token-b",
    });
    expect(primaryAfter.soulCoreCount).toBe(0);
    expect(tokenAAfter.soulCoreCount).toBe(1);
    expect(tokenAAfter.everHadCorePlaced).toBe(true);
    expect(tokenBAfter.soulCoreCount).toBe(1);
    expect(tokenBAfter.everHadCorePlaced).toBe(true);
  });
});

describe("replayCoreMoveEvent", () => {
  it("moves a vanished token back to the token pool after a manual core move", async () => {
    const token: CardDefinition = {
      ...createPlayCardDefinition("API-CM-TOKEN", "spirit"),
      keywordTags: ["token"],
      tokenIndependentCoreManagement: {
        redirectCoresToVoid: true,
        placementRestrictedToEnterField: true,
      },
    };
    await __initializeGameApiLookupsForTest([token]);
    const tokenCard = createCardInstance(token, {
      instanceId: "cm-token",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [tokenCard],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 0, voidNormalCoreCount: 0 },
          { id: "bob" },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "none",
    };

    const next = replayCoreMoveEvent(state, {
      coreMoveDrafts: [
        {
          kind: "normal",
          from: { kind: "card", instanceId: "cm-token" },
          to: { kind: "reserve", playerId: "alice" },
          amount: 1,
          purpose: "core_move",
        },
      ],
    });

    const tokenAfter = next.cardInstances.find(
      (card) => card.instanceId === "cm-token"
    );
    const alice = next.players.find((player) => player.id === "alice");
    expect(tokenAfter?.zone).toBe("removed_from_game");
    expect(tokenAfter?.normalCoreCount).toBe(0);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.voidNormalCoreCount).toBe(1);
  });

  it("rejects non-core_move purposes in replayed manual core moves", async () => {
    const token: CardDefinition = {
      ...createPlayCardDefinition("API-CM-TOKEN", "spirit"),
      keywordTags: ["token"],
      tokenIndependentCoreManagement: {
        redirectCoresToVoid: true,
        placementRestrictedToEnterField: true,
      },
    };
    await __initializeGameApiLookupsForTest([token]);
    const tokenCard = createCardInstance(token, {
      instanceId: "cm-token",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [tokenCard],
        playerOverrides: [
          { id: "alice", reserveNormalCoreCount: 0, voidNormalCoreCount: 0 },
          { id: "bob" },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "none",
    };

    expect(() =>
      replayCoreMoveEvent(state, {
        coreMoveDrafts: [
          {
            kind: "normal",
            from: { kind: "card", instanceId: "cm-token" },
            to: { kind: "reserve", playerId: "alice" },
            amount: 1,
            purpose: "placement",
          },
        ],
      })
    ).toThrow(/purpose must be core_move/);
  });
});

describe("requireRoomMember", () => {
  const aliceRoom = {
    players: [{ supabaseUserId: "alice-uuid" }, { supabaseUserId: "bob-uuid" }],
  };

  it("authenticatedUserId が null なら認証エラーを返す", () => {
    expect(requireRoomMember(aliceRoom, null)).toBe("Authentication required.");
  });

  it("authenticatedUserId が room.players に含まれない場合は 'Not a player in this room.' を返す", () => {
    expect(requireRoomMember(aliceRoom, "stranger-uuid")).toBe(
      "Not a player in this room."
    );
  });

  it("authenticatedUserId が room.players に含まれる場合は null を返す（OK）", () => {
    expect(requireRoomMember(aliceRoom, "alice-uuid")).toBeNull();
    expect(requireRoomMember(aliceRoom, "bob-uuid")).toBeNull();
  });

  it("空ルーム (players=[]) なら誰でも 'Not a player in this room.'", () => {
    expect(requireRoomMember({ players: [] }, "alice-uuid")).toBe(
      "Not a player in this room."
    );
  });

  it("authenticatedUserId が空文字でも認証エラー扱い", () => {
    expect(requireRoomMember(aliceRoom, "")).toBe("Authentication required.");
  });
});

describe("authenticateRequest", () => {
  function requestWithAuthorization(authorization?: string) {
    const headers: Record<string, string> = {};
    if (authorization !== undefined) headers.authorization = authorization;
    return { headers } as Parameters<typeof authenticateRequest>[0];
  }

  afterEach(() => {
    __setAuthVerifierForTest(null);
    __clearAuthCacheForTest();
  });

  it("Bearer token を検証し、短時間は同じ検証結果を再利用する", async () => {
    const verifier = vi.fn(async () => ({
      userId: "user-1",
      tokenExpiresAtMs: Date.now() + 60_000,
    }));
    __setAuthVerifierForTest(verifier);
    const req = requestWithAuthorization("Bearer token-a");

    expect(await authenticateRequest(req)).toBe("user-1");
    expect(await authenticateRequest(req)).toBe("user-1");

    expect(verifier).toHaveBeenCalledTimes(1);
    expect(verifier).toHaveBeenCalledWith("token-a");
  });

  it("Bearer token が無い/形式が違う場合は verifier を呼ばず null を返す", async () => {
    const verifier = vi.fn(async () => ({ userId: "user-1" }));
    __setAuthVerifierForTest(verifier);

    expect(await authenticateRequest(requestWithAuthorization())).toBeNull();
    expect(
      await authenticateRequest(requestWithAuthorization("Basic token-a"))
    ).toBeNull();

    expect(verifier).not.toHaveBeenCalled();
  });

  it("検証結果の token 期限が切れている場合は認証失敗扱いにする", async () => {
    const verifier = vi.fn(async () => ({
      userId: "user-1",
      tokenExpiresAtMs: Date.now() - 1,
    }));
    __setAuthVerifierForTest(verifier);

    expect(
      await authenticateRequest(requestWithAuthorization("Bearer token-a"))
    ).toBeNull();
    expect(verifier).toHaveBeenCalledTimes(1);
  });
});

describe("sanitizeStateForSpectator (P3-17 Phase 4)", () => {
  function makeCard(
    instanceId: string,
    zone: CardZone,
    definitionId = "BSTH05.5-001"
  ) {
    return {
      instanceId,
      definitionId,
      originalDefinitionId: definitionId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone,
      zoneRoleName: zone,
      normalCoreCount: 0,
      minimumRequiredCores: 0,
      exhaustState: "normal" as const,
      pendingLeaveKind: null,
      pendingLeaveCause: null,
      pendingLeaveChainId: null,
      deferZoneMoveUntilChainEnd: false,
      attachedToInstanceId: null,
      attachedChildrenIds: [],
      pendingLeaveLvSnapshot: null,
      adventSourceCardIds: [],
      divineTransformState: null,
      faceDown: false,
    };
  }

  function makeState(
    cardInstances: ReturnType<typeof makeCard>[],
    revealedBurstStates: Array<{
      playerId: string;
      cardInstanceId: string;
      checkId: string;
    }> = []
  ): GameState {
    return {
      turnNumber: 1,
      activePlayerId: "alice",
      playerOrder: ["alice", "bob"],
      step: "main",
      window: "none",
      players: [],
      cardInstances,
      battleEntities: [],
      activeAttack: null,
      stackWindow: null,
      preDeclarationStackWindow: null,
      battleResolutionGroup: null,
      battleImmediateEffects: [],
      burstSetPlayerIdsThisTurn: [],
      setBurstStates: [],
      revealedBurstStates,
      mirageSetStates: [],
      mirageSetPlayerIdsThisTurn: [],
      usedDivineSkillKeysThisTurn: [],
      pendingTriggeredEffects: [],
      pendingPrivateDeclarations: [],
      pendingBurstChecks: [],
      pendingLeaveEntities: [],
    } as unknown as GameState;
  }

  it("hand ゾーンの definitionId / originalDefinitionId を伏せる", () => {
    const state = makeState([makeCard("c1", "hand", "BSTH05.5-001")]);
    const sanitized = sanitizeStateForSpectator(state);
    expect(sanitized.cardInstances[0]?.definitionId).toBe("_hidden_card_");
    expect(sanitized.cardInstances[0]?.originalDefinitionId).toBe(
      "_hidden_card_"
    );
  });

  it("deck ゾーンは伏せる", () => {
    const state = makeState([makeCard("c1", "deck", "BSTH05.5-002")]);
    const sanitized = sanitizeStateForSpectator(state);
    expect(sanitized.cardInstances[0]?.definitionId).toBe("_hidden_card_");
  });

  it("mirage ゾーンは相手にも公開する (2026-05-29 裁定: 表向きセットは相手も閲覧可能)", () => {
    // 旧: mirage は controller_only で秘匿。新: 08c:62「表向きでセット」+ 表向き=相手可視。
    const state = makeState([makeCard("c2", "mirage", "BSTH05.5-003")]);
    const sanitized = sanitizeStateForSpectator(state);
    expect(sanitized.cardInstances[0]?.definitionId).toBe("BSTH05.5-003");
  });

  it("burst ゾーンは未公開なら伏せ、revealedBurstStates に含まれていれば公開", () => {
    const state = makeState(
      [
        makeCard("burst-hidden", "burst", "BSTH05.5-004"),
        makeCard("burst-revealed", "burst", "BSTH05.5-005"),
      ],
      [
        {
          playerId: "alice",
          cardInstanceId: "burst-revealed",
          checkId: "check1",
        },
      ]
    );
    const sanitized = sanitizeStateForSpectator(state);
    expect(sanitized.cardInstances[0]?.definitionId).toBe("_hidden_card_");
    expect(sanitized.cardInstances[1]?.definitionId).toBe("BSTH05.5-005");
  });

  it("face-up カード領域 (field / trash / removed_from_game / set_aside) は変更しない", () => {
    const state = makeState([
      makeCard("c1", "field", "BSTH05.5-101"),
      makeCard("c2", "trash", "BSTH05.5-102"),
      makeCard("c3", "removed_from_game", "BSTH05.5-103"),
      makeCard("c4", "set_aside", "BSTH05.5-104"),
      makeCard("c5", "revealed", "BSTH05.5-105"),
    ]);
    const sanitized = sanitizeStateForSpectator(state);
    expect(sanitized.cardInstances[0]?.definitionId).toBe("BSTH05.5-101");
    expect(sanitized.cardInstances[1]?.definitionId).toBe("BSTH05.5-102");
    expect(sanitized.cardInstances[2]?.definitionId).toBe("BSTH05.5-103");
    expect(sanitized.cardInstances[2]?.zone).toBe("removed_from_game");
    expect(sanitized.cardInstances[3]?.definitionId).toBe("BSTH05.5-104");
    expect(sanitized.cardInstances[4]?.definitionId).toBe("BSTH05.5-105");
  });

  it("元 state は変更されない (immutable)", () => {
    const state = makeState([makeCard("c1", "hand", "BSTH05.5-001")]);
    const sanitized = sanitizeStateForSpectator(state);
    expect(state.cardInstances[0]?.definitionId).toBe("BSTH05.5-001");
    expect(sanitized).not.toBe(state);
  });

  it("P3-47 F-1: field 上の faceDown カードは相手 viewer に対して伏せる", () => {
    const aliceFaceDown = {
      ...makeCard("alice-fd", "field", "BSTH01-X04"),
      faceDown: true,
    };
    const aliceFaceUp = makeCard("alice-fu", "field", "BSTH05.5-101");
    const state = makeState([aliceFaceDown, aliceFaceUp]);

    const fromBob = sanitizeStateForViewer(state, "bob");
    expect(fromBob.cardInstances[0]?.definitionId).toBe("_hidden_card_");
    expect(fromBob.cardInstances[0]?.originalDefinitionId).toBe(
      "_hidden_card_"
    );
    expect(fromBob.cardInstances[1]?.definitionId).toBe("BSTH05.5-101");

    const fromSpectator = sanitizeStateForSpectator(state);
    expect(fromSpectator.cardInstances[0]?.definitionId).toBe("_hidden_card_");
  });

  it("P3-47 F-1: field 上の faceDown カードでも owner viewer には見せる", () => {
    const aliceFaceDown = {
      ...makeCard("alice-fd", "field", "BSTH01-X04"),
      faceDown: true,
    };
    const state = makeState([aliceFaceDown]);

    const fromAlice = sanitizeStateForViewer(state, "alice");
    expect(fromAlice.cardInstances[0]?.definitionId).toBe("BSTH01-X04");
  });

  it("P3-47 F-1 Step 7: snapshot JSON round-trip 前後で sanitizer の mask 結果が一致する", () => {
    // 裏向き field カード + 通常 field カードの混在で、
    // JSON シリアライズ → デシリアライズ後も sanitizer の挙動が変わらないことを確認。
    const aliceFaceDown = {
      ...makeCard("alice-fd", "field", "BSTH01-X04"),
      faceDown: true,
    };
    const aliceFaceUp = makeCard("alice-fu", "field", "BSTH05.5-101");
    const state = makeState([aliceFaceDown, aliceFaceUp]);

    const beforeBob = sanitizeStateForViewer(state, "bob");
    const beforeAlice = sanitizeStateForViewer(state, "alice");
    const beforeSpec = sanitizeStateForSpectator(state);

    const roundTripped = JSON.parse(JSON.stringify(state)) as GameState;
    const afterBob = sanitizeStateForViewer(roundTripped, "bob");
    const afterAlice = sanitizeStateForViewer(roundTripped, "alice");
    const afterSpec = sanitizeStateForSpectator(roundTripped);

    // 相手 viewer: faceDown field カードの定義 ID は両者 mask 済
    expect(afterBob.cardInstances[0]?.definitionId).toBe(
      beforeBob.cardInstances[0]?.definitionId
    );
    expect(afterBob.cardInstances[0]?.definitionId).toBe("_hidden_card_");
    // owner viewer: 両者で実際の definitionId が見える
    expect(afterAlice.cardInstances[0]?.definitionId).toBe(
      beforeAlice.cardInstances[0]?.definitionId
    );
    expect(afterAlice.cardInstances[0]?.definitionId).toBe("BSTH01-X04");
    // 観戦者: 両者で mask
    expect(afterSpec.cardInstances[0]?.definitionId).toBe(
      beforeSpec.cardInstances[0]?.definitionId
    );
    // 表向きカードは round-trip でも変わらず可視
    expect(afterBob.cardInstances[1]?.definitionId).toBe("BSTH05.5-101");
    // round-trip 後も faceDown フラグが保持されていること
    expect(roundTripped.cardInstances[0]?.faceDown).toBe(true);
    expect(roundTripped.cardInstances[1]?.faceDown).toBe(false);
  });

  it("viewer 本人の非公開カードは見せ、相手の非公開カードだけ伏せる", () => {
    const aliceHand = makeCard("alice-hand", "hand", "BSTH05.5-A01");
    const bobHand = {
      ...makeCard("bob-hand", "hand", "BSTH05.5-B01"),
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    };
    const state = makeState([aliceHand, bobHand]);

    const sanitized = sanitizeStateForViewer(state, "alice");

    expect(sanitized.cardInstances[0]?.definitionId).toBe("BSTH05.5-A01");
    expect(sanitized.cardInstances[1]?.definitionId).toBe("_hidden_card_");
  });

  it("非公開カードを source にする activeContinuousEffects は相手 viewer に漏らさない", () => {
    const aliceMap = makeCard("alice-map", "hand", "BSES01-C04");
    const state = {
      ...makeState([aliceMap]),
      activeContinuousEffects: [
        {
          effectId: "ce-hidden-hand-defense",
          sourceInstanceId: "alice-map",
          sourceDefinitionId: "BSES01-C04",
          actingPlayerId: "alice",
          duration: { scope: "permanent" as const },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune" as const,
          targetInstanceId: "alice-map",
          provenance: { effectIndex: 0, stepIndex: 0 },
        },
      ],
    } as unknown as GameState;

    expect(
      sanitizeStateForViewer(state, "alice").activeContinuousEffects
    ).toHaveLength(1);
    expect(
      sanitizeStateForViewer(state, "bob").activeContinuousEffects
    ).toHaveLength(0);
    expect(
      sanitizeStateForSpectator(state).activeContinuousEffects
    ).toHaveLength(0);
  });

  it("相手 face-down clone: definitionId は伏せるが activeContinuousEffects (act_as_spirit) は残し、相手 viewer でも分身メタデータが取得できる", () => {
    // alice 場の裏向き token に act_as_spirit CE を注入し、bob 視点で sanitize
    // した state でも getActAsSpiritMetadata が機能することを確認する。
    // これは BunshinOnlyDetail (CardDetailModal の相手分身モード) の前提条件。
    const aliceHost = {
      ...makeCard("alice-host", "field", "BSTH01-X04"),
      normalCoreCount: 3,
    };
    const aliceBunshin = {
      ...makeCard("alice-bunshin", "field", "BSTH99-MAGIC"),
      normalCoreCount: 1,
      faceDown: true,
    };
    const state = {
      ...makeState([aliceHost, aliceBunshin]),
      activeContinuousEffects: [
        {
          effectId: "ce-act-as-spirit-1",
          sourceInstanceId: "alice-host",
          sourceDefinitionId: "BSTH01-X04",
          actingPlayerId: "alice",
          duration: { scope: "while_on_field" as const },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "act_as_spirit" as const,
          targetInstanceId: "alice-bunshin",
          metadata: {
            statBlueprint: {
              kind: "live_copy_from",
              sourceInstanceId: "alice-host",
              aspects: ["symbolColors", "tribes", "levelDefs", "currentLv"],
            },
            overrides: {
              cardName: "フランドール・スカーレット",
              levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
              keywords: ["cannot_combine"],
            },
          },
        },
      ],
    } as unknown as GameState;

    const fromBob = sanitizeStateForViewer(state, "bob");

    // alice の bunshin token は definitionId が伏せられる
    const sanitizedBunshin = fromBob.cardInstances.find(
      (c) => c.instanceId === "alice-bunshin"
    );
    expect(sanitizedBunshin?.definitionId).toBe("_hidden_card_");
    expect(sanitizedBunshin?.faceDown).toBe(true);
    expect(sanitizedBunshin?.normalCoreCount).toBe(1);

    // activeContinuousEffects は伏せず、metadata 経由で分身情報を取得できる
    expect(fromBob.activeContinuousEffects).toHaveLength(1);
    const meta = getActAsSpiritMetadata(fromBob, "alice-bunshin");
    expect(meta).toBeDefined();
    expect(meta?.overrides?.cardName).toBe("フランドール・スカーレット");
    expect(meta?.overrides?.keywords).toContain("cannot_combine");
  });

  it("pendingPrivateDeclarations は owner viewer にだけ残す", () => {
    const state = {
      ...makeState([makeCard("alice-hand", "hand", "BSTH05.5-A01")]),
      pendingPrivateDeclarations: [
        {
          declarationId: "decl-alice",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "alice-hand",
          sourceDefinitionId: "BSTH05.5-A01",
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "pending-alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:game-api:1613",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "start",
          window: "none",
        },
      ],
    } as unknown as GameState;

    expect(
      sanitizeStateForViewer(state, "alice").pendingPrivateDeclarations
    ).toHaveLength(1);
    expect(
      sanitizeStateForViewer(state, "bob").pendingPrivateDeclarations
    ).toHaveLength(0);
    expect(
      sanitizeStateForSpectator(state).pendingPrivateDeclarations
    ).toHaveLength(0);
  });
});

describe("broadcastSSEStateUpdate (P3-28 Phase 3 結合)", () => {
  beforeEach(() => {
    __resetSSEConnectionsForTest();
  });

  function makeCard(
    instanceId: string,
    ownerPlayerId: string,
    zone: "hand" | "field" | "deck",
    definitionId = "BSTH05.5-001"
  ) {
    return {
      instanceId,
      definitionId,
      originalDefinitionId: definitionId,
      ownerPlayerId,
      controllerPlayerId: ownerPlayerId,
      zone,
      zoneRoleName: zone,
      normalCoreCount: 0,
      minimumRequiredCores: 0,
      exhaustState: "normal" as const,
      pendingLeaveKind: null,
      pendingLeaveCause: null,
      pendingLeaveChainId: null,
      deferZoneMoveUntilChainEnd: false,
      attachedToInstanceId: null,
      attachedChildrenIds: [],
      pendingLeaveLvSnapshot: null,
      adventSourceCardIds: [],
      divineTransformState: null,
      faceDown: false,
    };
  }

  function makeState(): GameState {
    return {
      turnNumber: 1,
      activePlayerId: "alice",
      playerOrder: ["alice", "bob"],
      step: "start",
      window: "none",
      players: [],
      cardInstances: [
        makeCard("alice-hand", "alice", "hand", "BSTH01-M01"),
        makeCard("bob-hand", "bob", "hand", "BSTH05.5-B01"),
      ],
      battleEntities: [],
      activeAttack: null,
      stackWindow: null,
      preDeclarationStackWindow: null,
      battleResolutionGroup: null,
      battleImmediateEffects: [],
      burstSetPlayerIdsThisTurn: [],
      setBurstStates: [],
      revealedBurstStates: [],
      mirageSetStates: [],
      mirageSetPlayerIdsThisTurn: [],
      usedDivineSkillKeysThisTurn: [],
      pendingTriggeredEffects: [],
      pendingPrivateDeclarations: [
        {
          declarationId: "decl-alice",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "alice-hand",
          sourceDefinitionId: "BSTH01-M01",
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "pending-alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:game-api:1709",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "start",
          window: "none",
        },
      ],
      pendingBurstChecks: [],
      pendingLeaveEntities: [],
    } as unknown as GameState;
  }

  function parseSSEPayload(write: ReturnType<typeof vi.fn>) {
    const args = write.mock.calls[0]?.[0] as string;
    return parseSSEPayloadText(args);
  }

  function parseSSEPayloadText(args: string) {
    const dataMatch = args.match(/^event: state_update\ndata: (.+)\n\n$/);
    if (!dataMatch) throw new Error(`unexpected SSE chunk: ${args}`);
    return JSON.parse(dataMatch[1]!) as {
      version: number;
      baseVersion?: number;
      state?: GameState;
      patch?: unknown[];
    };
  }

  it("viewer 重複を除去し、alice / bob / spectator の3視点だけを事前計算する", () => {
    const prepared = prepareViewerStateSyncPayloads(makeState(), 7, [
      "alice",
      "alice",
      "bob",
      "bob",
      null,
      null,
    ]);

    expect(prepared.size).toBe(3);
    const alicePayload = prepared.get("alice")?.payload;
    const bobPayload = prepared.get("bob")?.payload;
    const spectatorPayload = prepared.get(null)?.payload;
    expect(alicePayload).toHaveProperty("state");
    expect(bobPayload).toHaveProperty("state");
    expect(spectatorPayload).toHaveProperty("state");
    if (
      !alicePayload ||
      !("state" in alicePayload) ||
      !bobPayload ||
      !("state" in bobPayload) ||
      !spectatorPayload ||
      !("state" in spectatorPayload)
    ) {
      throw new Error("expected full viewer states");
    }
    expect(
      alicePayload.state.cardInstances.find(
        (card) => card.instanceId === "alice-hand"
      )?.definitionId
    ).toBe("BSTH01-M01");
    expect(
      alicePayload.state.cardInstances.find(
        (card) => card.instanceId === "bob-hand"
      )?.definitionId
    ).toBe("_hidden_card_");
    expect(
      bobPayload.state.cardInstances.find(
        (card) => card.instanceId === "bob-hand"
      )?.definitionId
    ).toBe("BSTH05.5-B01");
    expect(
      spectatorPayload.state.cardInstances.every(
        (card) => card.zone !== "hand" || card.definitionId === "_hidden_card_"
      )
    ).toBe(true);
  });

  it("previousVersion と version が連番でなければ patch を作らず full state に落とす", () => {
    const previous = makeState();
    const next = makeState();
    next.turnNumber = 2;

    const prepared = prepareViewerStateSyncPayloads(
      next,
      12,
      ["alice"],
      previous,
      9
    );

    expect(prepared.get("alice")?.payload).toHaveProperty("state");
    expect(prepared.get("alice")?.payload).not.toHaveProperty("patch");
  });

  it("incremental 不要 viewer は連番でも patch を作らず full state にする", () => {
    const previous = makeState();
    const next = makeState();
    next.turnNumber = 2;

    const prepared = prepareViewerStateSyncPayloads(
      next,
      10,
      ["alice"],
      previous,
      9,
      new Set()
    );

    expect(prepared.get("alice")?.payload).toHaveProperty("state");
    expect(prepared.get("alice")?.payload).not.toHaveProperty("patch");
  });

  it("alice 視点 SSE は alice 手札と private declaration を見せる", () => {
    const aliceWrite = vi.fn();
    addSSEConnection("room-1", { write: aliceWrite }, true, "alice");
    broadcastSSEStateUpdate("room-1", 7, makeState());

    const payload = parseSSEPayload(aliceWrite);
    expect(payload.version).toBe(7);
    const aliceCard = payload.state?.cardInstances.find(
      (c) => c.instanceId === "alice-hand"
    );
    const bobCard = payload.state?.cardInstances.find(
      (c) => c.instanceId === "bob-hand"
    );
    expect(aliceCard?.definitionId).toBe("BSTH01-M01");
    expect(bobCard?.definitionId).toBe("_hidden_card_");
    expect(payload.state.pendingPrivateDeclarations).toHaveLength(1);
    expect(payload.state.pendingPrivateDeclarations[0]?.declarationId).toBe(
      "decl-alice"
    );
  });

  it("bob 視点 SSE は alice 手札と alice の private declaration を伏せる", () => {
    const bobWrite = vi.fn();
    addSSEConnection("room-1", { write: bobWrite }, true, "bob");
    broadcastSSEStateUpdate("room-1", 7, makeState());

    const payload = parseSSEPayload(bobWrite);
    const aliceCard = payload.state?.cardInstances.find(
      (c) => c.instanceId === "alice-hand"
    );
    const bobCard = payload.state?.cardInstances.find(
      (c) => c.instanceId === "bob-hand"
    );
    expect(aliceCard?.definitionId).toBe("_hidden_card_");
    expect(bobCard?.definitionId).toBe("BSTH05.5-B01");
    expect(payload.state.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("観戦者 (viewerPlayerId=null) SSE は両者の手札と全 private declaration を伏せる", () => {
    const spectatorWrite = vi.fn();
    addSSEConnection("room-1", { write: spectatorWrite }, false, null);
    broadcastSSEStateUpdate("room-1", 7, makeState());

    const payload = parseSSEPayload(spectatorWrite);
    expect(
      payload.state?.cardInstances.every(
        (c) => c.zone !== "hand" || c.definitionId === "_hidden_card_"
      )
    ).toBe(true);
    expect(payload.state.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("複数 viewer に対し各 viewerPlayerId 基準で sanitize される (HTTP /state/full と SSE で同じ経路)", () => {
    const aliceWrite = vi.fn();
    const bobWrite = vi.fn();
    const spectatorWrite = vi.fn();
    addSSEConnection("room-1", { write: aliceWrite }, true, "alice");
    addSSEConnection("room-1", { write: bobWrite }, true, "bob");
    addSSEConnection("room-1", { write: spectatorWrite }, false, null);

    broadcastSSEStateUpdate("room-1", 9, makeState());

    expect(
      parseSSEPayload(aliceWrite).state?.pendingPrivateDeclarations
    ).toHaveLength(1);
    expect(
      parseSSEPayload(bobWrite).state?.pendingPrivateDeclarations
    ).toHaveLength(0);
    expect(
      parseSSEPayload(spectatorWrite).state?.pendingPrivateDeclarations
    ).toHaveLength(0);
  });

  it("同一 viewer の複数接続へ同じ事前生成 frame を送る", () => {
    const aliceWrite1 = vi.fn();
    const aliceWrite2 = vi.fn();
    addSSEConnection("room-1", { write: aliceWrite1 }, true, "alice");
    addSSEConnection("room-1", { write: aliceWrite2 }, true, "alice");

    broadcastSSEStateUpdate("room-1", 7, makeState());

    expect(aliceWrite1).toHaveBeenCalledTimes(1);
    expect(aliceWrite2).toHaveBeenCalledTimes(1);
    expect(aliceWrite1.mock.calls[0]?.[0]).toBe(aliceWrite2.mock.calls[0]?.[0]);
  });

  it("prepared map に無い viewer は同じ viewer ID で再計算し、別視点 payload を流用しない", () => {
    const state = makeState();
    const prepared = prepareViewerStateSyncPayloads(state, 7, ["alice"]);
    const aliceWrite = vi.fn();
    const bobWrite = vi.fn();
    addSSEConnection("room-1", { write: aliceWrite }, true, "alice");
    addSSEConnection("room-1", { write: bobWrite }, true, "bob");

    broadcastSSEStateUpdate("room-1", 7, state, null, prepared);

    const bobPayload = parseSSEPayload(bobWrite);
    expect(
      bobPayload.state?.cardInstances.find(
        (card) => card.instanceId === "bob-hand"
      )?.definitionId
    ).toBe("BSTH05.5-B01");
    expect(
      bobPayload.state?.cardInstances.find(
        (card) => card.instanceId === "alice-hand"
      )?.definitionId
    ).toBe("_hidden_card_");
  });

  it("prepared map のキーと payload viewer が食い違う場合も再計算して秘匿を守る", () => {
    const state = makeState();
    const aliceSync = prepareViewerStateSyncPayloads(state, 7, ["alice"]).get(
      "alice"
    );
    if (!aliceSync) throw new Error("alice sync was not prepared");
    const poisoned = new Map([["bob", aliceSync]]);
    const bobWrite = vi.fn();
    addSSEConnection("room-1", { write: bobWrite }, true, "bob");

    broadcastSSEStateUpdate("room-1", 7, state, null, poisoned);

    const bobPayload = parseSSEPayload(bobWrite);
    expect(
      bobPayload.state?.cardInstances.find(
        (card) => card.instanceId === "bob-hand"
      )?.definitionId
    ).toBe("BSTH05.5-B01");
    expect(
      bobPayload.state?.cardInstances.find(
        (card) => card.instanceId === "alice-hand"
      )?.definitionId
    ).toBe("_hidden_card_");
  });

  it("prepared payload の version が古ければ現在 state から再計算する", () => {
    const staleState = makeState();
    staleState.cardInstances.find(
      (card) => card.instanceId === "bob-hand"
    )!.definitionId = "BSTH00-STALE";
    const stalePrepared = prepareViewerStateSyncPayloads(staleState, 6, [
      "bob",
    ]);
    const currentState = makeState();
    currentState.cardInstances.find(
      (card) => card.instanceId === "bob-hand"
    )!.definitionId = "BSTH00-CURRENT";
    const bobWrite = vi.fn();
    addSSEConnection("room-1", { write: bobWrite }, true, "bob");

    broadcastSSEStateUpdate("room-1", 7, currentState, null, stalePrepared);

    const bobPayload = parseSSEPayload(bobWrite);
    expect(
      bobPayload.state?.cardInstances.find(
        (card) => card.instanceId === "bob-hand"
      )?.definitionId
    ).toBe("BSTH00-CURRENT");
  });

  it("backpressure 中は中間 patch を積まず、drain 後に最新 full state だけを送る", () => {
    let drainListener: (() => void) | null = null;
    const write = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const writable = {
      write,
      once: vi.fn((eventName: string, listener: () => void) => {
        expect(eventName).toBe("drain");
        drainListener = listener;
        return writable;
      }),
    };
    addSSEConnection(
      "room-1",
      writable as unknown as Parameters<typeof addSSEConnection>[1],
      true,
      "alice"
    );

    const version9 = makeState();
    const version10 = makeState();
    version10.turnNumber = 10;
    broadcastSSEStateUpdate("room-1", 10, version10, version9);
    expect(write).toHaveBeenCalledTimes(1);

    const version11 = makeState();
    version11.turnNumber = 11;
    const version12 = makeState();
    version12.turnNumber = 12;
    broadcastSSEStateUpdate("room-1", 12, version12, version11);
    // DB 応答順が前後して古い broadcast が後着しても、最新 pending を巻き戻さない。
    broadcastSSEStateUpdate("room-1", 11, version11, version10);
    expect(write).toHaveBeenCalledTimes(1);

    expect(drainListener).not.toBeNull();
    (drainListener as () => void)();

    expect(write).toHaveBeenCalledTimes(2);
    const drainedPayload = parseSSEPayloadText(
      write.mock.calls[1]?.[0] as string
    );
    expect(drainedPayload.version).toBe(12);
    expect(drainedPayload.state?.turnNumber).toBe(12);
    expect(drainedPayload).not.toHaveProperty("patch");
    expect(drainedPayload).not.toHaveProperty("baseVersion");
    expect(write.mock.calls[1]?.[0] as string).not.toContain("BSTH05.5-B01");

    const version13 = makeState();
    version13.turnNumber = 13;
    broadcastSSEStateUpdate("room-1", 13, version13, version12);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("drain を監視できない接続が詰まったら除去し、以後の payload を蓄積しない", () => {
    const write = vi.fn().mockReturnValue(false);
    addSSEConnection("room-1", { write }, true, "alice");

    broadcastSSEStateUpdate("room-1", 7, makeState());
    broadcastSSEStateUpdate("room-1", 8, makeState());

    expect(write).toHaveBeenCalledTimes(1);
  });

  it("1接続の write 失敗を他 viewer の配信へ波及させない", () => {
    const aliceWrite = vi.fn(() => {
      throw new Error("socket closed");
    });
    const bobWrite = vi.fn();
    addSSEConnection("room-1", { write: aliceWrite }, true, "alice");
    addSSEConnection("room-1", { write: bobWrite }, true, "bob");

    broadcastSSEStateUpdate("room-1", 7, makeState());
    broadcastSSEStateUpdate("room-1", 8, makeState());

    expect(aliceWrite).toHaveBeenCalledTimes(1);
    expect(bobWrite).toHaveBeenCalledTimes(2);
  });

  it("viewer-safe patch は相手の非公開 definitionId を含めない", () => {
    const previous = makeState();
    const next = makeState();
    const bobPrevious = previous.cardInstances.find(
      (c) => c.instanceId === "bob-hand"
    )!;
    const bobNext = next.cardInstances.find(
      (c) => c.instanceId === "bob-hand"
    )!;
    bobPrevious.definitionId = "BSTH05.5-B01";
    bobNext.definitionId = "BSTH99-SECRET";

    const aliceWrite = vi.fn();
    const bobWrite = vi.fn();
    addSSEConnection("room-1", { write: aliceWrite }, true, "alice");
    addSSEConnection("room-1", { write: bobWrite }, true, "bob");

    broadcastSSEStateUpdate("room-1", 10, next, previous);

    const alicePayloadText = aliceWrite.mock.calls[0]?.[0] as string;
    const bobPayloadText = bobWrite.mock.calls[0]?.[0] as string;
    expect(alicePayloadText).not.toContain("BSTH99-SECRET");
    expect(bobPayloadText).toContain("BSTH99-SECRET");
    const alicePayload = parseSSEPayload(aliceWrite);
    expect(alicePayload.patch).toBeDefined();
    expect(alicePayload.baseVersion).toBe(9);
  });

  it("viewer-safe patch は自分の deck→hand カードの正体を復元する", () => {
    const previous = makeState();
    previous.cardInstances = [
      makeCard("alice-old", "alice", "hand", "ALICE-OLD"),
      makeCard("alice-new", "alice", "deck", "ALICE-NEW"),
      makeCard("bob-hand", "bob", "hand", "BOB-HAND"),
    ];
    const next = makeState();
    next.cardInstances = [
      makeCard("alice-old", "alice", "deck", "ALICE-OLD"),
      makeCard("alice-new", "alice", "hand", "ALICE-NEW"),
      makeCard("bob-hand", "bob", "hand", "BOB-HAND"),
    ];

    const prepared = prepareViewerStateSyncPayloads(
      next,
      10,
      ["alice"],
      previous,
      9,
      new Set(["alice"])
    ).get("alice");
    if (!prepared) throw new Error("alice sync was not prepared");
    expect(prepared.payload.patch).toBeDefined();
    expect(prepared.payload.baseVersion).toBe(9);

    const applied = applyPatch(
      structuredClone(sanitizeStateForViewer(previous, "alice")),
      prepared.payload.patch as Operation[],
      true,
      false
    ).newDocument as GameState;

    expect(
      applied.cardInstances.find((card) => card.instanceId === "alice-new")
    ).toMatchObject({
      zone: "hand",
      definitionId: "ALICE-NEW",
    });
    expect(
      applied.cardInstances.find((card) => card.instanceId === "alice-old")
    ).toMatchObject({
      zone: "deck",
      definitionId: "_hidden_card_",
    });
  });
});

describe("computeOpponentDisconnected (相手切断判定 / throttling 誤検知防止)", () => {
  const players = [
    { role: "alice", supabaseUserId: "uid-alice" },
    { role: "bob", supabaseUserId: "uid-bob" },
  ];
  const NOW = 1_000_000_000_000;
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  beforeEach(() => {
    __resetSSEConnectionsForTest();
  });

  it("自分自身 (requester) は判定対象から除外される", () => {
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      { "uid-alice": iso(0), "uid-bob": iso(0) },
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result).not.toHaveProperty("alice");
    expect(result).toHaveProperty("bob");
  });

  it("最終 heartbeat が 45 秒超過 かつ SSE 接続なし → 切断 (真陽性)", () => {
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      { "uid-alice": iso(0), "uid-bob": iso(60_000) },
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(true);
  });

  it("heartbeat が 45 秒超過でも lease 内の member SSE は接続中扱い", () => {
    // バックグラウンドタブで heartbeat が throttling され stale だが、
    // openWhenHidden の SSE は開いたまま → 切断と誤判定しない。
    addSSEConnection("room-1", { write: vi.fn() }, true, "bob", NOW);
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      { "uid-alice": iso(0), "uid-bob": iso(60_000) },
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(false);
  });

  it("half-open member SSE でも lease が切れたら stale heartbeat を採用する", () => {
    addSSEConnection("room-1", { write: vi.fn() }, true, "bob", NOW - 120_000);
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      { "uid-alice": iso(0), "uid-bob": iso(60_000) },
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(true);
  });

  it("期限切れ member SSE は registry から除去して response を閉じる", () => {
    const end = vi.fn();
    addSSEConnection(
      "room-1",
      { write: vi.fn(), end },
      true,
      "bob",
      NOW - 120_000
    );

    expect(pruneExpiredSSEConnections("room-1", NOW)).toBe(1);
    expect(end).toHaveBeenCalledOnce();
    expect(pruneExpiredSSEConnections("room-1", NOW)).toBe(0);
  });

  it("観戦者 SSE も transport lease 満了で除去して response を閉じる", () => {
    const end = vi.fn();
    addSSEConnection(
      "room-1",
      { write: vi.fn(), end },
      false,
      null,
      NOW - 180_000
    );

    expect(pruneExpiredSSEConnections("room-1", NOW)).toBe(1);
    expect(end).toHaveBeenCalledOnce();
  });

  it("観戦者 SSE (isMember=false) は生存シグナルにならない → stale なら切断", () => {
    addSSEConnection("room-1", { write: vi.fn() }, false, "bob");
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      { "uid-alice": iso(0), "uid-bob": iso(60_000) },
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(true);
  });

  it("別ルームの SSE 接続は当該ルームの判定に影響しない", () => {
    addSSEConnection("other-room", { write: vi.fn() }, true, "bob");
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      { "uid-alice": iso(0), "uid-bob": iso(60_000) },
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(true);
  });

  it("最終 heartbeat が 45 秒以内 → 接続中", () => {
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      { "uid-alice": iso(0), "uid-bob": iso(10_000) },
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(false);
  });

  it("heartbeat 履歴なし → connected フラグにフォールバック (true=接続中)", () => {
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      {},
      { "uid-alice": true, "uid-bob": true },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(false);
  });

  it("heartbeat 履歴なし かつ connected=false → 切断", () => {
    const result = computeOpponentDisconnected(
      "room-1",
      players,
      null,
      { "uid-alice": true, "uid-bob": false },
      "uid-alice",
      NOW
    );
    expect(result.bob).toBe(true);
  });
});

describe("restoreHiddenStateForActor (sanitize roundtrip 防止)", () => {
  function makeCard(
    instanceId: string,
    ownerPlayerId: string,
    zone: "hand" | "field" | "deck" | "mirage" | "burst" | "trash",
    definitionId: string,
    faceDown = false
  ) {
    return {
      instanceId,
      definitionId,
      originalDefinitionId: definitionId,
      ownerPlayerId,
      controllerPlayerId: ownerPlayerId,
      zone,
      zoneRoleName: zone,
      normalCoreCount: 0,
      minimumRequiredCores: 0,
      exhaustState: "normal" as const,
      pendingLeaveKind: null,
      pendingLeaveCause: null,
      pendingLeaveChainId: null,
      deferZoneMoveUntilChainEnd: false,
      attachedToInstanceId: null,
      attachedChildrenIds: [],
      pendingLeaveLvSnapshot: null,
      adventSourceCardIds: [],
      divineTransformState: null,
      faceDown,
    };
  }

  function makeState(
    cardInstances: ReturnType<typeof makeCard>[],
    pendingPrivateDeclarations: Array<{
      declarationId: string;
      ownerPlayerId: string;
      actingPlayerId: string;
    }> = [],
    pendingDeferredTriggeredEffects: Array<{
      pendingId: string;
      actingPlayerId: string;
    }> = []
  ): GameState {
    return {
      turnNumber: 1,
      activePlayerId: "alice",
      playerOrder: ["alice", "bob"],
      step: "main",
      window: "none",
      players: [],
      cardInstances,
      battleEntities: [],
      activeAttack: null,
      stackWindow: null,
      preDeclarationStackWindow: null,
      battleResolutionGroup: null,
      battleImmediateEffects: [],
      burstSetPlayerIdsThisTurn: [],
      setBurstStates: [],
      revealedBurstStates: [],
      mirageSetStates: [],
      mirageSetPlayerIdsThisTurn: [],
      usedDivineSkillKeysThisTurn: [],
      pendingTriggeredEffects: [],
      pendingPrivateDeclarations,
      pendingDeferredTriggeredEffects,
      pendingBurstChecks: [],
      pendingLeaveEntities: [],
    } as unknown as GameState;
  }

  it("alice push 時に bob の手札 definitionId / originalDefinitionId を previous state から復元する", () => {
    const previous = makeState([
      makeCard("alice-hand", "alice", "hand", "BSTH01-M01"),
      makeCard("bob-hand", "bob", "hand", "BSTH05.5-B01"),
    ]);
    // alice の view: bob 手札は _hidden_card_
    const incoming = makeState([
      makeCard("alice-hand", "alice", "hand", "BSTH01-M01"),
      makeCard("bob-hand", "bob", "hand", "_hidden_card_"),
    ]);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    const bobCard = restored.cardInstances.find(
      (c) => c.instanceId === "bob-hand"
    );
    expect(bobCard?.definitionId).toBe("BSTH05.5-B01");
    expect(bobCard?.originalDefinitionId).toBe("BSTH05.5-B01");
  });

  it("alice push 時に alice 自身の手札はそのまま保持される (alice の view では非サニタイズ)", () => {
    const previous = makeState([
      makeCard("alice-hand", "alice", "hand", "BSTH01-M01"),
    ]);
    const incoming = makeState([
      makeCard("alice-hand", "alice", "hand", "BSTH01-M01"),
    ]);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    const aliceCard = restored.cardInstances.find(
      (c) => c.instanceId === "alice-hand"
    );
    expect(aliceCard?.definitionId).toBe("BSTH01-M01");
  });

  it("deck / mirage / burst の hidden definitionId も復元する", () => {
    const previous = makeState([
      makeCard("bob-deck", "bob", "deck", "BSTH05.5-D01"),
      makeCard("bob-mirage", "bob", "mirage", "BSTH05.5-M01"),
      makeCard("bob-burst", "bob", "burst", "BSTH05.5-Bu01"),
    ]);
    const incoming = makeState([
      makeCard("bob-deck", "bob", "deck", "_hidden_card_"),
      makeCard("bob-mirage", "bob", "mirage", "_hidden_card_"),
      makeCard("bob-burst", "bob", "burst", "_hidden_card_"),
    ]);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    expect(
      restored.cardInstances.find((c) => c.instanceId === "bob-deck")
        ?.definitionId
    ).toBe("BSTH05.5-D01");
    expect(
      restored.cardInstances.find((c) => c.instanceId === "bob-mirage")
        ?.definitionId
    ).toBe("BSTH05.5-M01");
    expect(
      restored.cardInstances.find((c) => c.instanceId === "bob-burst")
        ?.definitionId
    ).toBe("BSTH05.5-Bu01");
  });

  it("P3-47 F-1: 相手 face-down field カードの definitionId も復元する", () => {
    const previous = makeState([
      makeCard("bob-fd", "bob", "field", "BSTH01-X04", true),
    ]);
    const incoming = makeState([
      makeCard("bob-fd", "bob", "field", "_hidden_card_", true),
    ]);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    expect(
      restored.cardInstances.find((c) => c.instanceId === "bob-fd")
        ?.definitionId
    ).toBe("BSTH01-X04");
  });

  it("bob の pendingPrivateDeclarations を alice push 時に previous から復元する", () => {
    const bobDecl = {
      declarationId: "decl-bob",
      ownerPlayerId: "bob",
      actingPlayerId: "bob",
      sourceInstanceId: "bob-hand",
      sourceDefinitionId: "BSTH05.5-B01",
    };
    const aliceDecl = {
      declarationId: "decl-alice",
      ownerPlayerId: "alice",
      actingPlayerId: "alice",
      sourceInstanceId: "alice-hand",
      sourceDefinitionId: "BSTH01-M01",
    };
    const previous = makeState([], [aliceDecl, bobDecl] as unknown as Array<{
      declarationId: string;
      ownerPlayerId: string;
      actingPlayerId: string;
    }>);
    // alice の view: bob の declaration はサニタイズで除外される
    const incoming = makeState([], [aliceDecl] as unknown as Array<{
      declarationId: string;
      ownerPlayerId: string;
      actingPlayerId: string;
    }>);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    expect(restored.pendingPrivateDeclarations).toHaveLength(2);
    expect(
      restored.pendingPrivateDeclarations.map((d) => d.declarationId).sort()
    ).toEqual(["decl-alice", "decl-bob"]);
  });

  it("alice push 時に alice 自身の declaration が既に incoming にあれば重複しない", () => {
    const aliceDecl = {
      declarationId: "decl-alice",
      ownerPlayerId: "alice",
      actingPlayerId: "alice",
    };
    const previous = makeState([], [aliceDecl] as unknown as Array<{
      declarationId: string;
      ownerPlayerId: string;
      actingPlayerId: string;
    }>);
    const incoming = makeState([], [aliceDecl] as unknown as Array<{
      declarationId: string;
      ownerPlayerId: string;
      actingPlayerId: string;
    }>);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    expect(restored.pendingPrivateDeclarations).toHaveLength(1);
  });

  it("alice の action が bob の新規 declaration を追加した場合 (incoming に含まれる) も保持する", () => {
    const previous = makeState([], []);
    const newBobDecl = {
      declarationId: "decl-bob-new",
      ownerPlayerId: "bob",
      actingPlayerId: "bob",
    };
    const incoming = makeState([], [newBobDecl] as unknown as Array<{
      declarationId: string;
      ownerPlayerId: string;
      actingPlayerId: string;
    }>);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    expect(restored.pendingPrivateDeclarations).toHaveLength(1);
    expect(restored.pendingPrivateDeclarations[0]?.declarationId).toBe(
      "decl-bob-new"
    );
  });

  it("bob の pendingDeferredTriggeredEffects も alice push 時に復元する", () => {
    const bobDeferred = { pendingId: "deferred-bob", actingPlayerId: "bob" };
    const previous = makeState([], [], [bobDeferred] as unknown as Array<{
      pendingId: string;
      actingPlayerId: string;
    }>);
    const incoming = makeState([], [], []);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    expect(restored.pendingDeferredTriggeredEffects).toHaveLength(1);
    expect(restored.pendingDeferredTriggeredEffects[0]?.pendingId).toBe(
      "deferred-bob"
    );
  });

  it("previous が null なら incoming をそのまま返す (ゲーム開始直後)", () => {
    const incoming = makeState([
      makeCard("alice-hand", "alice", "hand", "BSTH01-M01"),
    ]);
    const restored = restoreHiddenStateForActor(incoming, null, "alice");
    expect(restored).toEqual(incoming);
  });

  it("instanceId が previous に存在しないカードは _hidden_card_ のまま保持される (新規 token 等)", () => {
    const previous = makeState([]);
    const incoming = makeState([
      makeCard("new-token", "bob", "field", "_hidden_card_"),
    ]);

    const restored = restoreHiddenStateForActor(incoming, previous, "alice");

    expect(restored.cardInstances[0]?.definitionId).toBe("_hidden_card_");
  });

  it("両者 push でリングする (alice push 後の DB を bob が push) — 互いの隠匿情報を保持する", () => {
    // 初期 DB (engine.initializeGame 直後): 両者の手札が real
    const initialState = makeState([
      makeCard("alice-hand-1", "alice", "hand", "BSTH01-M01"),
      makeCard("bob-hand-1", "bob", "hand", "BSTH05.5-B01"),
    ]);
    // alice push: alice 視点で bob の手札は _hidden_card_
    const alicePush = makeState([
      makeCard("alice-hand-1", "alice", "hand", "BSTH01-M01"),
      makeCard("bob-hand-1", "bob", "hand", "_hidden_card_"),
    ]);
    const afterAlicePush = restoreHiddenStateForActor(
      alicePush,
      initialState,
      "alice"
    );
    expect(
      afterAlicePush.cardInstances.find((c) => c.instanceId === "bob-hand-1")
        ?.definitionId
    ).toBe("BSTH05.5-B01");

    // bob push: bob 視点で alice の手札は _hidden_card_
    const bobPush = makeState([
      makeCard("alice-hand-1", "alice", "hand", "_hidden_card_"),
      makeCard("bob-hand-1", "bob", "hand", "BSTH05.5-B01"),
    ]);
    const afterBobPush = restoreHiddenStateForActor(
      bobPush,
      afterAlicePush,
      "bob"
    );
    expect(
      afterBobPush.cardInstances.find((c) => c.instanceId === "alice-hand-1")
        ?.definitionId
    ).toBe("BSTH01-M01");
    expect(
      afterBobPush.cardInstances.find((c) => c.instanceId === "bob-hand-1")
        ?.definitionId
    ).toBe("BSTH05.5-B01");
  });

  it("actorPlayerId が null なら cardInstances のみ復元し pending は incoming のまま", () => {
    const aliceDecl = {
      declarationId: "decl-alice",
      ownerPlayerId: "alice",
      actingPlayerId: "alice",
    };
    const previous = makeState(
      [makeCard("bob-hand", "bob", "hand", "BSTH05.5-B01")],
      [aliceDecl] as unknown as Array<{
        declarationId: string;
        ownerPlayerId: string;
        actingPlayerId: string;
      }>
    );
    const incoming = makeState(
      [makeCard("bob-hand", "bob", "hand", "_hidden_card_")],
      []
    );

    const restored = restoreHiddenStateForActor(incoming, previous, null);

    expect(restored.cardInstances[0]?.definitionId).toBe("BSTH05.5-B01");
    expect(restored.pendingPrivateDeclarations).toHaveLength(0);
  });
});

describe("sanitizeReplayPayload (P3-64 Phase C)", () => {
  it("action endpoint: actionId / paymentSources / targetInstanceIds 等 dispatch 引数を保持", () => {
    const body = {
      actionId: "summon:c1",
      expectedVersion: 5,
      clientMutationId: "mut-1",
      serverAutoDrain: true,
      paymentSources: [{ kind: "reserve", amount: 2 }],
      targetInstanceIds: ["c2", "c3"],
      // P2-05: 同時アタック宣言の追加参加カード (attack action 専用 passthrough)
      additionalSourceInstanceIds: ["c4", "c5"],
      additionalAttackExhaustCostSourceInstanceIds: { c5: "c6" },
      payToActHandDiscardCardInstanceIds: ["h1"],
      payToActHandDiscardGateDecline: false,
      // ENGINE-paid-prevention-immunity-card-cost Step3 follow-up: passthroughKeys
      // (extractApplyOptionsFromBody) にはあるが ALLOWED_KEYS.action に無いと、room
      // action は live 実行こそ成功するが replay 保存 payload から落ち、replay/restore
      // 時に throw する (adversarial verifier 2026-07-28 round3 refute)。
      paidPreventionImmunityCardSelection: ["fodder-0", "fodder-1"],
      summonCostExcludeSelectedCardInstanceIds: ["trash-0", "trash-1"],
      summonCostCoreMoveSelectedCount: 3,
      summonCostCoreMoveDestination: { fieldCardInstanceId: "nexus-1" },
      summonCostCoreMoveAllocations: [
        { destination: "reserve", normalCount: 1 },
        {
          destination: { fieldCardInstanceId: "nexus-1" },
          normalCount: 1,
          soulCount: 1,
        },
      ],
      groupedSummonCostOverrideSelectedCardInstanceIds: ["trash-2"],
      lifeGainReplacementChoice: "replace",
      payToActCoreSourceContainerId: "field-1",
      payToActCoreKind: "soul",
      payToActCoreGateDecline: false,
      fieldMagicPreCostTriggerDecision: "trigger",
      countDecreaseSelection: 2,
      discardSetBurstCountSelection: 1,
      lifeCorePartitionChoice: { normalChosen: 1, soulChosen: 1 },
      coreSourceSoulCoreInstanceId: "field-soul-1",
      coreDistributionSoulCoreAllocations: { "cd-token-a": 1, "cd-token-b": 1 },
      coreDistributionSoulCoreSourceAllocations: {
        reserve: 1,
        "field:cd-primary-soul": 1,
      },
      skipOptionalEffect: false,
      somethingElse: "ignored", // allowlist 外
      state: { huge: "object" }, // state は除外
    };
    const out = sanitizeReplayPayload("action", body);
    expect(out.actionId).toBe("summon:c1");
    expect(out.expectedVersion).toBe(5);
    expect(out.clientMutationId).toBe("mut-1");
    expect(out.serverAutoDrain).toBe(true);
    expect(out.paymentSources).toEqual([{ kind: "reserve", amount: 2 }]);
    expect(out.targetInstanceIds).toEqual(["c2", "c3"]);
    expect(out.additionalSourceInstanceIds).toEqual(["c4", "c5"]);
    expect(out.additionalAttackExhaustCostSourceInstanceIds).toEqual({
      c5: "c6",
    });
    expect(out.payToActHandDiscardCardInstanceIds).toEqual(["h1"]);
    expect(out.payToActHandDiscardGateDecline).toBe(false);
    expect(out.paidPreventionImmunityCardSelection).toEqual([
      "fodder-0",
      "fodder-1",
    ]);
    expect(out.summonCostExcludeSelectedCardInstanceIds).toEqual([
      "trash-0",
      "trash-1",
    ]);
    expect(out.summonCostCoreMoveSelectedCount).toBe(3);
    expect(out.summonCostCoreMoveAllocations).toEqual(
      body.summonCostCoreMoveAllocations
    );
    expect(out.summonCostCoreMoveDestination).toEqual({
      fieldCardInstanceId: "nexus-1",
    });
    expect(out.groupedSummonCostOverrideSelectedCardInstanceIds).toEqual([
      "trash-2",
    ]);
    expect(out.lifeGainReplacementChoice).toBe("replace");
    expect(out.payToActCoreSourceContainerId).toBe("field-1");
    expect(out.payToActCoreKind).toBe("soul");
    expect(out.payToActCoreGateDecline).toBe(false);
    expect(out.fieldMagicPreCostTriggerDecision).toBe("trigger");
    expect(out.countDecreaseSelection).toBe(2);
    expect(out.discardSetBurstCountSelection).toBe(1);
    expect(out.lifeCorePartitionChoice).toEqual({
      normalChosen: 1,
      soulChosen: 1,
    });
    expect(out.coreSourceSoulCoreInstanceId).toBe("field-soul-1");
    expect(out.coreDistributionSoulCoreAllocations).toEqual({
      "cd-token-a": 1,
      "cd-token-b": 1,
    });
    expect(out.coreDistributionSoulCoreSourceAllocations).toEqual({
      reserve: 1,
      "field:cd-primary-soul": 1,
    });
    expect(out.skipOptionalEffect).toBe(false);
    expect(out).not.toHaveProperty("somethingElse");
    expect(out).not.toHaveProperty("state");
  });

  it("step endpoint: expectedVersion + retry metadata を抜き出す", () => {
    const out = sanitizeReplayPayload("step", {
      expectedVersion: 3,
      clientMutationId: "mut-step",
      serverAutoDrain: true,
      actionId: "ignored",
    });
    expect(out).toEqual({
      expectedVersion: 3,
      clientMutationId: "mut-step",
      serverAutoDrain: true,
    });
  });

  it("claim-victory endpoint: reason + expectedVersion を保持", () => {
    const out = sanitizeReplayPayload("claim-victory", {
      reason: "opponent_disconnect_timeout",
      expectedVersion: 7,
      clientMutationId: "mut-win",
      other: "x",
    });
    expect(out).toEqual({
      reason: "opponent_disconnect_timeout",
      expectedVersion: 7,
      clientMutationId: "mut-win",
    });
  });

  it("core-move endpoint: coreMoveDrafts を保持", () => {
    const drafts = [{ fromKind: "reserve", toInstanceId: "c1", amount: 1 }];
    const out = sanitizeReplayPayload("core-move", {
      coreMoveDrafts: drafts,
      expectedVersion: 9,
    });
    expect(out.coreMoveDrafts).toEqual(drafts);
    expect(out.expectedVersion).toBe(9);
  });

  it("brave-separation endpoint: actionId + separateCoreDistribution + braveInstanceId を保持", () => {
    const out = sanitizeReplayPayload("brave-separation", {
      actionId: "brave-sep:1",
      separateCoreDistribution: { c1: 1, c2: 2 },
      separationSoulCoreSource: "reserve",
      braveInstanceId: "brave-1",
      expectedVersion: 11,
    });
    expect(out.actionId).toBe("brave-sep:1");
    expect(out.separateCoreDistribution).toEqual({ c1: 1, c2: 2 });
    expect(out.separationSoulCoreSource).toBe("reserve");
    expect(out.braveInstanceId).toBe("brave-1");
    expect(out.expectedVersion).toBe(11);
  });

  it("pregame-update endpoint: preGame を保持し stateOverrides は保存しない", () => {
    const out = sanitizeReplayPayload("pregame-update", {
      preGame: { phase: "mulligan" },
      stateOverrides: { turnNumber: 0 },
      expectedVersion: 1,
    });
    expect(out.preGame).toEqual({ phase: "mulligan" });
    expect(out.stateOverrides).toBeUndefined();
    expect(out.expectedVersion).toBe(1);
  });

  it("replay-restore endpoint: checkpoint state だけを保持する", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });
    const out = sanitizeReplayPayload("replay-restore", {
      state,
      expectedVersion: 12,
      commit: true,
    });
    expect(out).toEqual({ state });
  });

  it("replay 内の pregame stateOverrides を viewer ごとに伏せる", () => {
    const definition = createPlayCardDefinition("REPLAY-SECRET", "spirit");
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "alice-hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(definition, {
          instanceId: "bob-deck",
          ownerPlayerId: "bob",
          zone: "deck",
        }),
      ],
    });
    const { preGame: _preGame, ...stateOverrides } = state;
    const event = {
      id: 1,
      room_id: "room-1",
      state_version: 1,
      acting_player_id: "alice",
      endpoint: "pregame-update" as const,
      payload: { preGame: { phase: "waiting_janken" }, stateOverrides },
      created_at: "2026-08-14T00:00:00.000Z",
    };

    const aliceView = sanitizeReplayEventForViewer(event, "alice");
    const bobView = sanitizeReplayEventForViewer(event, "bob");
    const spectatorView = sanitizeReplayEventForViewer(event, null);
    const aliceCards = (aliceView.payload?.stateOverrides as GameState)
      .cardInstances;
    expect(
      aliceCards.find((card) => card.instanceId === "alice-hand")
    ).toMatchObject({ definitionId: "REPLAY-SECRET" });
    expect(
      aliceCards.find((card) => card.instanceId === "bob-deck")
    ).toMatchObject({ definitionId: "_hidden_card_" });
    expect(aliceView.payload?.preGame).toEqual({
      phase: "waiting_janken",
    });
    expect(aliceView.payloadRedacted).toBe(false);
    expect(bobView).toMatchObject({ payload: null, payloadRedacted: true });
    expect(spectatorView).toMatchObject({
      payload: null,
      payloadRedacted: true,
    });
  });

  it("action の private card ID / deck order は入力者本人以外へ返さない", () => {
    const event = {
      id: 3,
      room_id: "room-1",
      state_version: 3,
      acting_player_id: "alice",
      endpoint: "action" as const,
      payload: {
        actionId: "resolve-deck-reveal",
        selectedDeckRevealCardIds: ["hidden-card-1"],
        deckRevealRemainderOrder: ["hidden-card-3", "hidden-card-2"],
      },
      created_at: "2026-08-14T00:00:02.000Z",
    };

    expect(sanitizeReplayEventForViewer(event, "alice").payload).toEqual(
      event.payload
    );
    expect(sanitizeReplayEventForViewer(event, "bob")).toMatchObject({
      payload: null,
      payloadRedacted: true,
    });
    expect(sanitizeReplayEventForViewer(event, null)).toMatchObject({
      payload: null,
      payloadRedacted: true,
    });
  });

  it("GameState 形でない replay state payload は公開レスポンスから落とす", () => {
    const event = {
      id: 2,
      room_id: "room-1",
      state_version: 2,
      acting_player_id: "alice",
      endpoint: "pregame-update" as const,
      payload: {
        preGame: { phase: "waiting_janken" },
        stateOverrides: { cardInstances: [{ definitionId: "SECRET" }] },
      },
      created_at: "2026-08-14T00:00:01.000Z",
    };

    expect(sanitizeReplayEventForViewer(event, "alice").payload).toEqual({
      preGame: { phase: "waiting_janken" },
    });
  });

  it("undefined value のキーは出力に含めない", () => {
    const out = sanitizeReplayPayload("action", {
      actionId: "summon:c1",
      paymentSources: undefined,
      expectedVersion: 5,
    });
    expect(out).not.toHaveProperty("paymentSources");
    expect(out.actionId).toBe("summon:c1");
    expect(out.expectedVersion).toBe(5);
  });

  it("空の body でも空オブジェクトを返す (例外 throw しない)", () => {
    expect(sanitizeReplayPayload("action", {})).toEqual({});
    expect(sanitizeReplayPayload("step", {})).toEqual({});
    expect(sanitizeReplayPayload("claim-victory", {})).toEqual({});
  });
});

describe("replayClaimVictoryEvent (P3-64 Phase C-5)", () => {
  function makeStateWithPlayers(
    gameResult: GameState["gameResult"] = null
  ): GameState {
    return {
      turnNumber: 1,
      activePlayerId: "alice",
      playerOrder: ["alice", "bob"],
      step: "main",
      window: "none",
      players: [
        { id: "alice", lifeNormalCoreCount: 5 },
        { id: "bob", lifeNormalCoreCount: 5 },
      ],
      cardInstances: [],
      battleEntities: [],
      activeAttack: null,
      gameResult,
    } as unknown as GameState;
  }

  it("winner=alice → gameResult に bob を losing player として記録", () => {
    const state = makeStateWithPlayers();
    const next = replayClaimVictoryEvent(state, "alice", {
      reason: "opponent_disconnect_timeout",
    });
    expect(next.gameResult).toEqual({
      kind: "player_loss",
      losingPlayerId: "bob",
      reason: "opponent_disconnect_timeout",
    });
  });

  it("reason 省略時はデフォルト 'opponent_disconnect_timeout' を使う", () => {
    const state = makeStateWithPlayers();
    const next = replayClaimVictoryEvent(state, "alice", {});
    expect(next.gameResult?.kind).toBe("player_loss");
    expect((next.gameResult as { reason: string }).reason).toBe(
      "opponent_disconnect_timeout"
    );
  });

  it("既に gameResult があれば例外 throw", () => {
    const state = makeStateWithPlayers({
      kind: "player_loss",
      losingPlayerId: "alice",
      reason: "life_zero",
    });
    expect(() => replayClaimVictoryEvent(state, "bob", {})).toThrow(
      /already ended/
    );
  });

  it("winner=bob のときは loser=alice", () => {
    const state = makeStateWithPlayers();
    const next = replayClaimVictoryEvent(state, "bob", {});
    expect((next.gameResult as { losingPlayerId: string }).losingPlayerId).toBe(
      "alice"
    );
  });
});

describe("replayPregameUpdateEvent (P3-64 Phase C-5)", () => {
  function makeStateWithPreGame(
    preGame: GameState["preGame"] | null = {
      phase: "janken",
      jankenHands: {},
      mulliganDone: {},
    } as unknown as GameState["preGame"]
  ): GameState {
    return {
      turnNumber: 0,
      activePlayerId: "alice",
      playerOrder: ["alice", "bob"],
      step: "pre_game",
      window: "none",
      players: [],
      cardInstances: [],
      battleEntities: [],
      preGame,
    } as unknown as GameState;
  }

  // ─── server-authoritative pregame (2026-06-19): phase はサーバ導出、
  //     入力は actor 自身の分のみ採用、じゃんけん勝敗もサーバ判定 ───

  it("契約提示: 選択後に手札を配り、両者確認までじゃんけんへ進めない", async () => {
    const normal = createPlayCardDefinition("API-CONTRACT-NORMAL", "spirit");
    const contract = {
      ...createPlayCardDefinition("API-CONTRACT-CX", "spirit"),
      keywordTags: ["contract"],
    } as CardDefinition;
    await __initializeGameApiLookupsForTest([normal, contract]);

    let state = initializeGame({
      decks: [
        [contract, ...Array(39).fill(normal)] as CardDefinition[],
        Array(40).fill(normal) as CardDefinition[],
      ],
      allowUnavailableDeckCards: true,
    });

    expect(state.preGame?.phase).toBe("waiting_contract");
    expect(state.players.find((p) => p.id === "alice")?.handCount).toBe(0);
    expect(
      state.players.find((p) => p.id === "alice")?.contractCardNo
    ).toBeNull();

    state = replayPregameUpdateEvent(
      state,
      { preGame: { contractPresentationChoices: { alice: true } } },
      "alice"
    );

    expect(state.preGame?.phase).toBe("contract_confirm");
    expect(state.players.find((p) => p.id === "alice")?.handCount).toBe(4);
    expect(state.players.find((p) => p.id === "alice")?.deckCount).toBe(36);
    expect(state.players.find((p) => p.id === "alice")?.contractCardNo).toBe(
      "API-CONTRACT-CX"
    );
    expect(
      state.cardInstances.some(
        (c) => c.definitionId === "API-CONTRACT-CX" && c.zone === "hand"
      )
    ).toBe(true);

    state = replayPregameUpdateEvent(
      state,
      { preGame: { jankenHands: { alice: "rock" }, jankenRound: 0 } },
      "alice"
    );
    expect(state.preGame?.phase).toBe("contract_confirm");
    expect(state.preGame?.jankenHands).toEqual({});

    state = replayPregameUpdateEvent(
      state,
      { preGame: { contractConfirmed: { alice: true } } },
      "alice"
    );
    expect(state.preGame?.phase).toBe("contract_confirm");

    state = replayPregameUpdateEvent(
      state,
      { preGame: { contractConfirmed: { bob: true } } },
      "bob"
    );
    expect(state.preGame?.phase).toBe("waiting_janken");
  });

  it("契約候補の cardNo は提示前は本人だけ、確認フェーズでは提示分だけ見える", async () => {
    const normal = createPlayCardDefinition(
      "API-CONTRACT-SAN-NORMAL",
      "spirit"
    );
    const contract = {
      ...createPlayCardDefinition("API-CONTRACT-SAN-CX", "spirit"),
      keywordTags: ["contract"],
    } as CardDefinition;
    await __initializeGameApiLookupsForTest([normal, contract]);

    let state = initializeGame({
      decks: [
        [contract, ...Array(39).fill(normal)] as CardDefinition[],
        Array(40).fill(normal) as CardDefinition[],
      ],
      allowUnavailableDeckCards: true,
    });
    expect(
      sanitizeStateForViewer(state, "alice").preGame?.contractCandidateCardNos
        ?.alice
    ).toBe("API-CONTRACT-SAN-CX");
    expect(
      sanitizeStateForViewer(state, "bob").preGame?.contractCandidateCardNos
        ?.alice
    ).toBeUndefined();

    state = replayPregameUpdateEvent(
      state,
      { preGame: { contractPresentationChoices: { alice: true } } },
      "alice"
    );
    expect(
      sanitizeStateForViewer(state, "bob").preGame?.contractCandidateCardNos
        ?.alice
    ).toBe("API-CONTRACT-SAN-CX");
  });

  it("クライアント送信 phase は信用せずサーバが導出する", () => {
    const state = makeOrderState({
      phase: "waiting_janken",
      jankenHands: { alice: "rock" },
      jankenRound: 0,
      jankenWinner: null,
      mulliganDone: {},
      firstPlayerId: null,
    });
    // クライアントが phase:"pregame_complete" を押し込んでも採用されない。
    const next = replayPregameUpdateEvent(
      state,
      { preGame: { phase: "pregame_complete" } },
      "alice"
    );
    expect(next.preGame?.phase).toBe("waiting_janken");
    expect(
      (next.preGame as unknown as { jankenHands: Record<string, string> })
        .jankenHands.alice
    ).toBe("rock");
  });

  it("じゃんけんの手は actor 自身の分のみ採用する (他人の手は無視)", () => {
    const state = makeOrderState({
      phase: "waiting_janken",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: null,
      mulliganDone: {},
      firstPlayerId: null,
    });
    // bob が alice の手も詰めて送っても、bob の分しか採用されない。
    const next = replayPregameUpdateEvent(
      state,
      {
        preGame: {
          jankenHands: { alice: "rock", bob: "paper" },
          jankenRound: 0,
        },
      },
      "bob"
    );
    expect(
      (next.preGame as unknown as { jankenHands: Record<string, string> })
        .jankenHands
    ).toEqual({ bob: "paper" });
    expect(next.preGame?.jankenWinner).toBeNull();
    expect(next.preGame?.phase).toBe("waiting_janken");
  });

  it("両者の手が揃うとサーバが勝敗を導出する (勝者 → waiting_order_pick)", () => {
    let state = makeOrderState({
      phase: "waiting_janken",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: null,
      mulliganDone: {},
      firstPlayerId: null,
    });
    state = replayPregameUpdateEvent(
      state,
      { preGame: { jankenHands: { alice: "rock" }, jankenRound: 0 } },
      "alice"
    );
    expect(state.preGame?.phase).toBe("waiting_janken");
    // bob: scissors → rock の勝ち = alice。
    state = replayPregameUpdateEvent(
      state,
      { preGame: { jankenHands: { bob: "scissors" }, jankenRound: 0 } },
      "bob"
    );
    expect(state.preGame?.jankenWinner).toBe("alice");
    expect(state.preGame?.phase).toBe("waiting_order_pick");
  });

  it("あいこはサーバが round++ し janken_resolved にする (手は表示用に保持)", () => {
    let state = makeOrderState({
      phase: "waiting_janken",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: null,
      mulliganDone: {},
      firstPlayerId: null,
    });
    state = replayPregameUpdateEvent(
      state,
      { preGame: { jankenHands: { alice: "rock" }, jankenRound: 0 } },
      "alice"
    );
    state = replayPregameUpdateEvent(
      state,
      { preGame: { jankenHands: { bob: "rock" }, jankenRound: 0 } },
      "bob"
    );
    expect(state.preGame?.phase).toBe("janken_resolved");
    expect(state.preGame?.jankenRound).toBe(1);
    expect(state.preGame?.jankenWinner).toBeNull();
    // 次ラウンドの手を出すと旧ラウンドの表示用の手はクリアされ新ラウンド開始。
    state = replayPregameUpdateEvent(
      state,
      { preGame: { jankenHands: { alice: "scissors" }, jankenRound: 1 } },
      "alice"
    );
    expect(
      (state.preGame as unknown as { jankenHands: Record<string, string> })
        .jankenHands
    ).toEqual({ alice: "scissors" });
    expect(state.preGame?.phase).toBe("waiting_janken");
  });

  it("旧ラウンドの遅延再送 (jankenRound 不一致) の手は破棄する", () => {
    const state = makeOrderState({
      phase: "janken_resolved",
      jankenHands: { alice: "rock", bob: "rock" },
      jankenRound: 1,
      jankenWinner: null,
      mulliganDone: {},
      firstPlayerId: null,
    });
    // round は既に 1。round0 の alice:rock が遅延再送されても無視する。
    const next = replayPregameUpdateEvent(
      state,
      { preGame: { jankenHands: { alice: "rock" }, jankenRound: 0 } },
      "alice"
    );
    expect(next.preGame?.jankenRound).toBe(1);
    expect(next.preGame?.phase).toBe("janken_resolved");
  });

  it("マリガンは actor 自身の分のみ・先後確定後に採用する", () => {
    const state = makeOrderState({
      phase: "order_decided",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: "alice",
      mulliganDone: {},
      firstPlayerId: "alice",
    });
    const next = replayPregameUpdateEvent(
      state,
      { preGame: { mulliganDone: { alice: true } } },
      "alice"
    );
    expect(
      (next.preGame as unknown as { mulliganDone: Record<string, boolean> })
        .mulliganDone
    ).toEqual({ alice: true });
    expect(next.preGame?.phase).toBe("waiting_mulligan_second");
  });

  it("マリガンは先後未確定だと採用しない", () => {
    const state = makeOrderState({
      phase: "waiting_order_pick",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: "alice",
      mulliganDone: {},
      firstPlayerId: null,
    });
    const next = replayPregameUpdateEvent(
      state,
      { preGame: { mulliganDone: { alice: true } } },
      "alice"
    );
    expect(
      (next.preGame as unknown as { mulliganDone: Record<string, boolean> })
        .mulliganDone
    ).toEqual({});
    expect(next.preGame?.phase).toBe("waiting_order_pick");
  });

  it("他人のマリガンは採用しない (actor スコープ)", () => {
    const state = makeOrderState({
      phase: "order_decided",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: "alice",
      mulliganDone: {},
      firstPlayerId: "alice",
    });
    // bob が alice のマリガンを詰めて送っても無視される。
    const next = replayPregameUpdateEvent(
      state,
      { preGame: { mulliganDone: { alice: true } } },
      "bob"
    );
    expect(
      (next.preGame as unknown as { mulliganDone: Record<string, boolean> })
        .mulliganDone
    ).toEqual({});
  });

  it("先後選択はじゃんけん勝者のリクエストでのみ採用する", () => {
    const state = makeOrderState({
      phase: "waiting_order_pick",
      jankenHands: {},
      jankenRound: 0,
      jankenWinner: "alice",
      mulliganDone: {},
      firstPlayerId: null,
    });
    // 敗者 bob が firstPlayerId を押し込んでも無視。
    const loserTry = replayPregameUpdateEvent(
      state,
      { preGame: { firstPlayerId: "bob" } },
      "bob"
    );
    expect(loserTry.preGame?.firstPlayerId).toBeNull();
    expect(loserTry.preGame?.phase).toBe("waiting_order_pick");
    // 勝者 alice の選択は採用 (bob を先攻に指名も可)。
    const winnerPick = replayPregameUpdateEvent(
      state,
      { preGame: { firstPlayerId: "bob" } },
      "alice"
    );
    expect(winnerPick.preGame?.firstPlayerId).toBe("bob");
    expect(winnerPick.preGame?.phase).toBe("order_decided");
    expect(winnerPick.activePlayerId).toBe("bob");
    expect(winnerPick.playerOrder).toEqual(["bob", "alice"]);
  });

  it("stateOverrides の preGame 外フィールドは無視する", () => {
    const state = makeStateWithPreGame();
    const next = replayPregameUpdateEvent(state, {
      preGame: {},
      stateOverrides: { turnNumber: 1, step: "start" },
    });
    expect(next.turnNumber).toBe(0);
    expect(next.step).toBe("pre_game");
  });

  it("マリガンは client 配置を無視し、server state 上で shuffle して4枚引く", () => {
    const aliceCards = Array.from({ length: 8 }, (_, index) => ({
      instanceId: `alice-${index + 1}`,
      definitionId: `ALICE-${index + 1}-REAL`,
      originalDefinitionId: `ALICE-${index + 1}-REAL`,
      ownerPlayerId: "alice",
      ...(index >= 4
        ? { deckKnowledge: { audience: "both", actorPlayerId: "alice" } }
        : {}),
      zone: index < 4 ? ("hand" as const) : ("deck" as const),
      zoneRoleName: `alice-${index < 4 ? "hand" : "deck"}-card`,
    }));
    const base = {
      ...makeStateWithPreGame({
        phase: "order_decided",
        jankenHands: {},
        jankenRound: 0,
        jankenWinner: "alice",
        mulliganDone: {},
        firstPlayerId: "alice",
      } as unknown as GameState["preGame"]),
      players: [
        { id: "alice", handCount: 4, deckCount: 4 },
        { id: "bob", handCount: 1, deckCount: 1 },
      ],
      cardInstances: [
        ...aliceCards,
        {
          instanceId: "bob-hand",
          definitionId: "BOB-HAND-REAL",
          originalDefinitionId: "BOB-HAND-REAL",
          ownerPlayerId: "bob",
          zone: "hand",
        },
        {
          instanceId: "bob-deck",
          definitionId: "BOB-DECK-REAL",
          originalDefinitionId: "BOB-DECK-REAL",
          ownerPlayerId: "bob",
          zone: "deck",
          deckKnowledge: { audience: "both", actorPlayerId: "bob" },
        },
      ],
      log: [],
    } as unknown as GameState;

    const randomContext = createRoomMutationRandomContext(0x12345678);
    const next = runWithRoomMutationRandom(randomContext, () =>
      replayPregameUpdateEvent(
        base,
        {
          preGame: { mulliganDone: { alice: true } },
          stateOverrides: {
            turnNumber: 99,
            step: "end",
            cardInstances: [],
          },
        },
        "alice"
      )
    );

    expect(next.turnNumber).toBe(0);
    expect(next.step).toBe("pre_game");
    expect(randomContext.drawCount).toBe(7);
    const nextAliceCards = next.cardInstances.filter(
      (card) => card.ownerPlayerId === "alice"
    );
    expect(nextAliceCards.filter((card) => card.zone === "hand")).toHaveLength(
      4
    );
    expect(nextAliceCards.filter((card) => card.zone === "deck")).toHaveLength(
      4
    );
    expect(
      nextAliceCards.every((card) => card.definitionId.endsWith("-REAL"))
    ).toBe(true);
    expect(
      next.cardInstances.find((card) => card.instanceId === "bob-hand")
        ?.definitionId
    ).toBe("BOB-HAND-REAL");
    expect(next.knownDeckCards).toBeUndefined();
    expect(getKnownDeckCards(next)).toEqual([
      {
        playerId: "bob",
        indexFromBottom: 0,
        definitionIdSnapshot: "BOB-DECK-REAL",
        audience: "both",
        actorPlayerId: "bob",
      },
    ]);
  });

  it("契約なし側の後攻マリガンは新規 true で必ず server deck から引き直す", () => {
    const aliceCards = [
      ...Array.from({ length: 4 }, (_, index) => ({
        instanceId: `alice-old-${index + 1}`,
        definitionId: `ALICE-OLD-${index + 1}`,
        originalDefinitionId: `ALICE-OLD-${index + 1}`,
        ownerPlayerId: "alice",
        zone: "hand" as const,
        zoneRoleName: "spirit-card",
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        instanceId: `alice-new-${index + 5}`,
        definitionId: `ALICE-NEW-${index + 5}`,
        originalDefinitionId: `ALICE-NEW-${index + 5}`,
        ownerPlayerId: "alice",
        zone: "deck" as const,
        zoneRoleName: "spirit-card",
      })),
    ];
    const base = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          ...aliceCards,
          {
            instanceId: "bob-hand",
            definitionId: "BOB-HAND",
            originalDefinitionId: "BOB-HAND",
            ownerPlayerId: "bob",
            zone: "hand",
          },
        ] as unknown as GameState["cardInstances"],
        playerOverrides: [
          { handCount: 4, deckCount: 4, contractCardNo: null },
          {
            handCount: 1,
            deckCount: 0,
            contractCardNo: "BOB-CONTRACT-CX",
          },
        ],
      }),
      turnNumber: 0,
      activePlayerId: "bob",
      playerOrder: ["bob", "alice"],
      step: "pre_game",
      preGame: {
        phase: "waiting_mulligan_second",
        jankenHands: {},
        jankenRound: 0,
        jankenWinner: "bob",
        firstPlayerId: "bob",
        mulliganDone: { bob: false },
      } as unknown as GameState["preGame"],
      log: [],
    } as unknown as GameState;
    const oldHandIds = aliceCards
      .filter((card) => card.zone === "hand")
      .map((card) => card.instanceId);

    const randomContext = createRoomMutationRandomContext(0xabcdef01);
    const next = runWithRoomMutationRandom(randomContext, () =>
      replayPregameUpdateEvent(
        base,
        { preGame: { mulliganDone: { alice: true } } },
        "alice"
      )
    );

    expect(next.preGame).toBeNull();
    expect(randomContext.drawCount).toBe(7);
    const nextAliceHandIds = next.cardInstances
      .filter((card) => card.ownerPlayerId === "alice" && card.zone === "hand")
      .map((card) => card.instanceId);
    expect(nextAliceHandIds).toEqual([
      "alice-new-7",
      "alice-new-8",
      "alice-new-6",
      "alice-new-5",
    ]);
    expect(nextAliceHandIds).not.toEqual(oldHandIds);
    expect(next.log.filter((entry) => entry === "mulligan:alice")).toHaveLength(
      1
    );
  });

  it("server乱数seedで liveマリガンと replay を完全一致させ、draw driftを拒否する", () => {
    const base = {
      ...makeStateWithPreGame({
        phase: "order_decided",
        jankenHands: {},
        jankenRound: 0,
        jankenWinner: "alice",
        mulliganDone: {},
        firstPlayerId: "alice",
      } as unknown as GameState["preGame"]),
      players: [
        { id: "alice", handCount: 4, deckCount: 4 },
        { id: "bob", handCount: 0, deckCount: 0 },
      ],
      cardInstances: Array.from({ length: 8 }, (_, index) => ({
        instanceId: `seed-card-${index + 1}`,
        definitionId: `SEED-${index + 1}`,
        originalDefinitionId: `SEED-${index + 1}`,
        ownerPlayerId: "alice",
        zone: index < 4 ? ("hand" as const) : ("deck" as const),
        zoneRoleName: `alice-${index < 4 ? "hand" : "deck"}-card`,
      })),
      log: [],
    } as unknown as GameState;
    const preGame = { mulliganDone: { alice: true } };
    const liveRandom = createRoomMutationRandomContext(0x5eed1234);
    const live = runWithRoomMutationRandom(liveRandom, () =>
      replayPregameUpdateEvent(base, { preGame }, "alice")
    );
    const event = {
      acting_player_id: "alice",
      endpoint: "pregame-update" as const,
      payload: {
        preGame,
        ...roomMutationRandomTrace(liveRandom),
      },
    };

    expect(replayEvent(base, event)).toEqual(live);
    expect(() =>
      replayEvent(base, {
        ...event,
        payload: {
          ...event.payload,
          randomDrawCount: liveRandom.drawCount + 1,
        },
      })
    ).toThrow(/random draw drift/);
  });

  it("乱数0回もtraceを記録し、後発の乱数利用をdriftとして拒否する", () => {
    const trace = roomMutationRandomTrace(createRoomMutationRandomContext());
    expect(trace).toEqual({ randomTraceVersion: 1, randomDrawCount: 0 });

    const base = {
      ...makeStateWithPreGame({
        phase: "order_decided",
        jankenHands: {},
        jankenRound: 0,
        jankenWinner: "alice",
        mulliganDone: {},
        firstPlayerId: "alice",
      } as unknown as GameState["preGame"]),
      players: [
        { id: "alice", handCount: 4, deckCount: 4 },
        { id: "bob", handCount: 0, deckCount: 0 },
      ],
      cardInstances: Array.from({ length: 8 }, (_, index) => ({
        instanceId: `trace-card-${index + 1}`,
        definitionId: `TRACE-${index + 1}`,
        originalDefinitionId: `TRACE-${index + 1}`,
        ownerPlayerId: "alice",
        zone: index < 4 ? ("hand" as const) : ("deck" as const),
        zoneRoleName: `alice-${index < 4 ? "hand" : "deck"}-card`,
      })),
      log: [],
    } as unknown as GameState;

    expect(() =>
      replayEvent(base, {
        acting_player_id: "alice",
        endpoint: "pregame-update",
        payload: {
          preGame: { mulliganDone: { alice: true } },
          ...trace,
        },
      })
    ).toThrow(/random draw drift/);
  });

  it("乱数traceのない旧イベントがshuffleへ到達したらfail closedする", () => {
    const base = {
      ...makeStateWithPreGame({
        phase: "order_decided",
        jankenHands: {},
        jankenRound: 0,
        jankenWinner: "alice",
        mulliganDone: {},
        firstPlayerId: "alice",
      } as unknown as GameState["preGame"]),
      players: [
        { id: "alice", handCount: 4, deckCount: 4 },
        { id: "bob", handCount: 0, deckCount: 0 },
      ],
      cardInstances: Array.from({ length: 8 }, (_, index) => ({
        instanceId: `legacy-card-${index + 1}`,
        definitionId: `LEGACY-${index + 1}`,
        originalDefinitionId: `LEGACY-${index + 1}`,
        ownerPlayerId: "alice",
        zone: index < 4 ? ("hand" as const) : ("deck" as const),
        zoneRoleName: `alice-${index < 4 ? "hand" : "deck"}-card`,
      })),
      log: [],
    } as unknown as GameState;

    expect(() =>
      replayEvent(base, {
        acting_player_id: "alice",
        endpoint: "pregame-update",
        payload: { preGame: { mulliganDone: { alice: true } } },
      })
    ).toThrow(/legacy random event requires a server checkpoint/);
  });

  it("body.preGame 欠落で例外", () => {
    const state = makeStateWithPreGame();
    expect(() => replayPregameUpdateEvent(state, {})).toThrow(
      /preGame missing/
    );
  });

  it("state.preGame が null なら例外", () => {
    const state = makeStateWithPreGame(null);
    expect(() =>
      replayPregameUpdateEvent(state, { preGame: { phase: "mulligan" } })
    ).toThrow(/preGame is null/);
  });

  it("pregame stateOverrides の hidden card は無視して authoritative state を保持する", () => {
    const base = {
      ...makeStateWithPreGame({
        phase: "order_decided",
        jankenHands: {},
        jankenRound: 0,
        jankenWinner: "alice",
        mulliganDone: {},
        firstPlayerId: "alice",
      } as unknown as GameState["preGame"]),
      players: [{ id: "alice" }, { id: "bob" }],
      cardInstances: [
        {
          instanceId: "bob-card-1",
          definitionId: "BSTH01-X01",
          originalDefinitionId: "BSTH01-X01",
          ownerPlayerId: "bob",
          zone: "hand",
        },
      ],
    } as unknown as GameState;
    // alice 視点の stateOverrides に相手の伏せカードがあっても、server は採用しない。
    const next = replayPregameUpdateEvent(
      base,
      {
        preGame: { mulliganDone: { alice: true } },
        stateOverrides: {
          cardInstances: [
            {
              instanceId: "bob-card-1",
              definitionId: "_hidden_card_",
              originalDefinitionId: "_hidden_card_",
              ownerPlayerId: "bob",
              zone: "hand",
            },
          ],
        },
      },
      "alice"
    );
    const restored = next.cardInstances.find(
      (c) => c.instanceId === "bob-card-1"
    );
    expect(restored?.definitionId).toBe("BSTH01-X01");
    expect(restored?.originalDefinitionId).toBe("BSTH01-X01");
  });

  // ─── サーバ権威ログ / 先後 / 二重マリガン防止 (orica-snapshot 2026-05-31) ───
  function makeOrderState(
    preGame: Record<string, unknown>,
    extra: Partial<GameState> = {}
  ): GameState {
    return {
      ...makeStateWithPreGame(preGame as unknown as GameState["preGame"]),
      players: [{ id: "alice" }, { id: "bob" }],
      playerOrder: ["alice", "bob"],
      activePlayerId: "alice",
      log: ["game:initialized:first:alice"],
      ...extra,
    } as unknown as GameState;
  }

  it("先後決定: firstPlayerId null→確定 で order と first_player_set ログをサーバ確定し、古い client overrides を無視する", () => {
    const state = makeOrderState({
      phase: "waiting_order_pick",
      jankenHands: {},
      jankenWinner: "bob",
      mulliganDone: {},
      firstPlayerId: null,
    });
    const next = replayPregameUpdateEvent(
      state,
      {
        preGame: { phase: "order_decided", firstPlayerId: "bob" },
        // クライアントが poll 未反映の古い (alice 先攻) order/log を送っても踏み潰されない
        stateOverrides: {
          playerOrder: ["alice", "bob"],
          activePlayerId: "alice",
          log: ["stale-client-log"],
        },
      },
      "bob"
    );
    expect(next.activePlayerId).toBe("bob");
    expect(next.playerOrder).toEqual(["bob", "alice"]);
    expect(next.log).toEqual([
      "game:initialized:first:alice",
      "game:first_player_set:bob",
    ]);
  });

  it("マリガン: 新規 true 確定で mulligan ログを1回だけ push する", () => {
    const state = makeOrderState({
      phase: "order_decided",
      jankenHands: {},
      jankenWinner: null,
      mulliganDone: {},
      firstPlayerId: "alice",
    });
    const next = replayPregameUpdateEvent(
      state,
      {
        preGame: {
          phase: "waiting_mulligan_second",
          mulliganDone: { alice: true },
        },
      },
      "alice"
    );
    expect(next.log.filter((l) => l === "mulligan:alice")).toHaveLength(1);
  });

  it("マリガン二重送信: 既に確定済みなら log を追加せず再シャッフル (cardInstances) も採用しない", () => {
    const base = makeOrderState(
      {
        phase: "waiting_mulligan_second",
        jankenHands: {},
        jankenWinner: null,
        mulliganDone: { alice: true },
        firstPlayerId: "alice",
      },
      {
        log: ["game:initialized:first:alice", "mulligan:alice"],
        cardInstances: [
          {
            instanceId: "a1",
            definitionId: "REAL",
            originalDefinitionId: "REAL",
            ownerPlayerId: "alice",
            zone: "hand",
          },
        ],
      } as unknown as Partial<GameState>
    );
    const next = replayPregameUpdateEvent(
      base,
      {
        preGame: { mulliganDone: { alice: true } },
        stateOverrides: {
          cardInstances: [
            {
              instanceId: "a1",
              definitionId: "OTHER",
              originalDefinitionId: "OTHER",
              ownerPlayerId: "alice",
              zone: "hand",
            },
          ],
        },
      },
      "alice"
    );
    // ログは重複しない
    expect(next.log.filter((l) => l === "mulligan:alice")).toHaveLength(1);
    // 2 回目の再シャッフル結果は採用されず base のカードが維持される
    expect(
      next.cardInstances.find((c) => c.instanceId === "a1")?.definitionId
    ).toBe("REAL");
  });

  // ─── 単調性ガード: 古い partial による先後/phase 巻き戻し防止 (orica-snapshot 2026-06-05) ───
  it("先後巻き戻し防止: firstPlayerId 確定後に古い partial が null を送っても据え置き、first_player_set ログを二重化しない", () => {
    // fresh: order 確定済み (alice 先攻、first_player_set:alice ログ済み)。
    const state = makeOrderState(
      {
        phase: "order_decided",
        jankenHands: {},
        jankenWinner: "alice",
        mulliganDone: {},
        firstPlayerId: "alice",
      },
      { log: ["game:initialized:first:alice", "game:first_player_set:alice"] }
    );
    // 敗者側の in-flight / 409 リトライが古い waiting_order_pick + firstPlayerId:null を再送。
    const next = replayPregameUpdateEvent(
      state,
      {
        preGame: {
          phase: "waiting_order_pick",
          firstPlayerId: null,
          jankenWinner: "alice",
        },
      },
      "bob"
    );
    // firstPlayerId は据え置き / phase も後退しない。
    expect(next.preGame?.firstPlayerId).toBe("alice");
    expect(next.preGame?.phase).toBe("order_decided");
    // first_player_set は1回だけ (null→確定の再遷移=二重ログを防ぐ)。
    expect(
      next.log.filter((l) => l === "game:first_player_set:alice")
    ).toHaveLength(1);
    // order (activePlayerId / playerOrder) も巻き戻らない。
    expect(next.activePlayerId).toBe("alice");
    expect(next.playerOrder).toEqual(["alice", "bob"]);
  });

  it("phase 後退拒否: 進んだ phase を古い partial が前フェーズへ巻き戻さない", () => {
    const state = makeOrderState({
      phase: "waiting_mulligan_second",
      jankenHands: {},
      jankenWinner: "alice",
      mulliganDone: { alice: false },
      firstPlayerId: "alice",
    });
    const next = replayPregameUpdateEvent(
      state,
      { preGame: { phase: "order_decided", firstPlayerId: "alice" } },
      "bob"
    );
    expect(next.preGame?.phase).toBe("waiting_mulligan_second");
  });

  // ─── 完了不変条件ガード: 先後未確定の pregame_complete で finalize しない
  //     (orica-snapshot 2026-06-19: 片側のマリガン無選択でゲーム開始) ───
  it("完了不変条件: firstPlayerId=null で pregame_complete が来ても finalize せず order pick へクランプする", () => {
    // order-decision update が未着で firstPlayerId=null のまま、mulligan update が
    // iAmFirstLocal=false フォールバックで pregame_complete を送る不正レース。
    const state = makeOrderState({
      phase: "waiting_order_pick",
      jankenHands: {},
      jankenWinner: "bob",
      mulliganDone: {},
      firstPlayerId: null,
    });
    const next = replayPregameUpdateEvent(
      state,
      {
        preGame: {
          phase: "pregame_complete",
          mulliganDone: { bob: false },
        },
      },
      "bob"
    );
    // finalize しない: preGame は残り、phase は回復可能な order pick へクランプ。
    expect(next.preGame).not.toBeNull();
    expect(next.preGame?.phase).toBe("waiting_order_pick");
    expect(next.preGame?.firstPlayerId).toBeNull();
    // 先後/マリガンの偽ログを足さない & 既定 order を init のまま維持。
    expect(next.log).toEqual(["game:initialized:first:alice"]);
    expect(next.activePlayerId).toBe("alice");
  });

  it("完了不変条件: 先後確定済みでも片方のマリガン未選択なら finalize しない", () => {
    const state = makeOrderState({
      phase: "waiting_mulligan_second",
      jankenHands: {},
      jankenWinner: "alice",
      mulliganDone: { alice: false },
      firstPlayerId: "alice",
    });
    // 後攻 bob 未選択のまま pregame_complete を送る。
    const next = replayPregameUpdateEvent(
      state,
      { preGame: { phase: "pregame_complete" } },
      "bob"
    );
    expect(next.preGame).not.toBeNull();
    expect(next.preGame?.phase).toBe("waiting_mulligan_second");
  });
});

describe("replayEvent dispatcher (P3-64 Phase C-5)", () => {
  function makeBaseState(): GameState {
    return {
      turnNumber: 1,
      activePlayerId: "alice",
      playerOrder: ["alice", "bob"],
      step: "main",
      window: "none",
      players: [
        { id: "alice", lifeNormalCoreCount: 5 },
        { id: "bob", lifeNormalCoreCount: 5 },
      ],
      cardInstances: [],
      battleEntities: [],
      gameResult: null,
    } as unknown as GameState;
  }

  it("endpoint=claim-victory → replayClaimVictoryEvent にルーティング", () => {
    const state = makeBaseState();
    const next = replayEvent(state, {
      acting_player_id: "alice",
      endpoint: "claim-victory",
      payload: { reason: "test_reason" },
    });
    expect(next.gameResult?.kind).toBe("player_loss");
    expect((next.gameResult as { losingPlayerId: string }).losingPlayerId).toBe(
      "bob"
    );
  });

  it("endpoint=pregame-update → replayPregameUpdateEvent にルーティング", () => {
    const state = {
      ...makeBaseState(),
      preGame: {
        phase: "janken",
        jankenHands: {},
        mulliganDone: {},
      },
    } as unknown as GameState;
    const next = replayEvent(state, {
      acting_player_id: "alice",
      endpoint: "pregame-update",
      payload: { preGame: { phase: "mulligan" } },
    });
    // ルーティングされ、phase はサーバ導出 (クライアント送信 phase は無視)。
    expect(next.preGame?.phase).toBe("waiting_janken");
  });

  it("endpoint=replay-restore → checkpoint state へ置き換える", () => {
    const restored = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });
    restored.turnNumber = 99;
    const next = replayEvent(makeBaseState(), {
      acting_player_id: "alice",
      endpoint: "replay-restore",
      payload: { state: restored },
    });
    expect(next.turnNumber).toBe(99);
  });

  it("endpoint=replay-restore の checkpoint state 欠落を拒否する", () => {
    expect(() =>
      replayEvent(makeBaseState(), {
        acting_player_id: "alice",
        endpoint: "replay-restore",
        payload: {},
      })
    ).toThrow("replay: restore state missing");
  });
});
