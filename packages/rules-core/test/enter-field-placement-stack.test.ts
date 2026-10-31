import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, LegalAction } from "../src/index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createActionInputDecisionNode } from "../src/training-decision-surface";

const emptyTriggeredLookup = () => [];
const emptyFieldCardEffectLookup = () => [];

function createLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return (definitionId: string) => map.get(definitionId);
}

function createSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
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
  };
}

function createNexus(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "nexus",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

// P3-93 bug1: 独立コア管理ネクサス（創界神）。配置時にコアを置けない（08c:114）ため
// 維持コア選択 pending を立ててはならない。
function createGrandwalkerNexus(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "nexus",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as const,
      oracleConditions: [{ tribes: ["夜錆"] }],
    },
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function createMainState(
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
        { reserveNormalCoreCount: 3, countValue: 9 },
        { reserveNormalCoreCount: 3 },
      ],
    }),
    activePlayerId: "alice",
    step: "main",
  };
}

function passStackAsBob(
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions = emptyTriggeredLookup
) {
  const pass = getLegalActions({
    state,
    actingPlayerId: "bob",
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
  }).find((action) => action.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
  }).state;
}

describe("enter-field placement timing for normal play-card stacks", () => {
  it("opens the stack after summon cost payment and asks placement after the stack closes", () => {
    const spirit = createSpirit("TEST-SPIRIT");
    const getDefinition = createLookup([spirit]);
    const initial = createMainState(spirit, "spirit-1");
    const summon = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (action): action is Extract<LegalAction, { kind: "summon" }> =>
        action.kind === "summon"
    );
    expect(summon).toBeDefined();
    const opened = applyLegalAction({
      state: initial,
      action: summon!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;

    expect(opened.window).toBe("stack");
    expect(opened.stackWindow?.priorityPlayerId).toBe("bob");
    expect(opened.pendingEnterFieldPlacement).toBeNull();
    expect(
      opened.cardInstances.find((c) => c.instanceId === "spirit-1")?.zone
    ).toBe("in_use");
    expect(
      opened.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(2);

    const pending = passStackAsBob(opened, getDefinition);
    expect(pending.window).toBe("none");
    expect(pending.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "spirit-1"
    );
    expect(
      pending.cardInstances.find((c) => c.instanceId === "spirit-1")?.zone
    ).toBe("in_use");

    const resolvePlacement = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    expect(resolvePlacement).toMatchObject({
      sourceDefinitionId: "TEST-SPIRIT",
      sourceCardNo: "TEST-SPIRIT",
    });
    const resolved = applyLegalAction({
      state: pending,
      action: resolvePlacement!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    const card = resolved.cardInstances.find(
      (c) => c.instanceId === "spirit-1"
    );
    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(card?.zone).toBe("field");
    expect(card?.normalCoreCount).toBe(1);
    expect(
      resolved.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(1);
  });

  it("keeps place_nexus placement after the stack closes", () => {
    const nexus = createNexus("TEST-NEXUS");
    const getDefinition = createLookup([nexus]);
    const initial = createMainState(nexus, "nexus-1");
    const place = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (action): action is Extract<LegalAction, { kind: "place_nexus" }> =>
        action.kind === "place_nexus"
    );
    expect(place).toBeDefined();

    const opened = applyLegalAction({
      state: initial,
      action: place!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    expect(opened.window).toBe("stack");
    expect(
      opened.cardInstances.find((c) => c.instanceId === "nexus-1")?.zone
    ).toBe("in_use");

    const pending = passStackAsBob(opened, getDefinition);
    expect(pending.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "nexus-1"
    );

    const resolvePlacement = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const resolved = applyLegalAction({
      state: pending,
      action: resolvePlacement!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      enterFieldCorePlacements: [],
    }).state;

    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "nexus-1")?.zone
    ).toBe("field");
  });

  it("resolves a normal summon with its active trash-placement grant, and revalidates it at the pending choice", () => {
    const cbSpirit = {
      ...createSpirit("TEST-CB-SPIRIT-TRASH-PLACEMENT"),
      tribe: "CB",
    };
    const getDefinition = createLookup([cbSpirit]);
    const main = createMainState(cbSpirit, "cb-spirit-1");
    const initial: GameState = {
      ...main,
      activeContinuousEffects: [
        {
          effectId: "grant-trash-placement",
          sourceInstanceId: "grant-source",
          sourceDefinitionId: "TEST-GRANT-SOURCE",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: main.turnNumber,
          createdAtAttackId: null,
          modifierTag: "grant_summon_trash_core_placement",
          targetInstanceId: "alice",
          metadata: {
            filter: { category: ["spirit"], tribes: ["CB"] },
            amount: 1,
          },
        },
      ],
    };
    const summon = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (action): action is Extract<LegalAction, { kind: "summon" }> =>
        action.kind === "summon"
    );
    expect(summon).toBeDefined();

    const opened = applyLegalAction({
      state: initial,
      action: summon!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    const pending = passStackAsBob(opened, getDefinition);

    expect(pending.pendingEnterFieldPlacement).toMatchObject({
      sourceInstanceId: "cb-spirit-1",
      minimumCoreCount: 1,
    });
    expect(
      pending.cardInstances.find((card) => card.instanceId === "cb-spirit-1")
        ?.zone
    ).toBe("in_use");

    const resolvePlacement = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_enter_field_placement" }
      > => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();

    // The training surface exposes the live grant as exactly one selectable
    // trash core, rather than silently producing an unresolvable placement.
    const inputNode = createActionInputDecisionNode(
      pending,
      resolvePlacement!,
      {
        getCardDefinitionById: getDefinition,
      }
    );
    expect(inputNode?.choices).toContainEqual(
      expect.objectContaining({
        applyOptions: {
          enterFieldCorePlacements: [{ kind: "trash_normal", amount: 1 }],
        },
      })
    );
    expect(inputNode?.choices).not.toContainEqual(
      expect.objectContaining({
        applyOptions: {
          enterFieldCorePlacements: [{ kind: "trash_normal", amount: 2 }],
        },
      })
    );

    expect(() =>
      applyLegalAction({
        state: pending,
        action: resolvePlacement!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
        enterFieldCorePlacements: [{ kind: "trash_normal", amount: 2 }],
      })
    ).toThrow();

    // The grant is not a declaration-time entitlement: if a stack response
    // removed it, resolving the previously-created pending cannot spend trash.
    const withoutGrant: GameState = {
      ...pending,
      activeContinuousEffects: [],
    };
    expect(() =>
      applyLegalAction({
        state: withoutGrant,
        action: resolvePlacement!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
        enterFieldCorePlacements: [{ kind: "trash_normal", amount: 1 }],
      })
    ).toThrow();

    const resolved = applyLegalAction({
      state: pending,
      action: resolvePlacement!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      enterFieldCorePlacements: [{ kind: "trash_normal", amount: 1 }],
    }).state;
    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "cb-spirit-1")
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      resolved.players.find((player) => player.id === "alice")
        ?.trashNormalCoreCount
    ).toBe(0);
  });

  it("EDH-0041: uses remaining cores on the cost-payment waiting card after the stack", () => {
    const spirit = {
      ...createSpirit("TEST-SPIRIT-NO-PLACEMENT-CORE"),
      cost: 4,
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const paymentSource = {
      ...createSpirit("TEST-PAYMENT-SOURCE"),
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const responseAffectedSource = createSpirit(
      "TEST-RESPONSE-AFFECTED-SOURCE"
    );
    const getDefinition = createLookup([
      spirit,
      paymentSource,
      responseAffectedSource,
    ]);
    const main = createMainState(spirit, "spirit-no-placement-core");
    const initial = {
      ...main,
      players: main.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 2 }
          : player
      ),
      cardInstances: [
        ...main.cardInstances,
        createCardInstance(paymentSource, {
          instanceId: "payment-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
        createCardInstance(responseAffectedSource, {
          instanceId: "response-affected-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const summon = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
    }).find(
      (action): action is Extract<LegalAction, { kind: "summon" }> =>
        action.kind === "summon"
    );
    expect(summon).toBeDefined();

    // 03f: 支払いで待機に入っても残るコアは配置元に使える。
    const paymentSources = [
      { kind: "reserve" as const, amount: 2 },
      { kind: "card" as const, instanceId: "payment-source", amount: 2 },
    ];
    const inputNode = createActionInputDecisionNode(initial, summon!, {
      getCardDefinitionById: getDefinition,
    });
    expect(inputNode?.choices).toContainEqual(
      expect.objectContaining({ applyOptions: { paymentSources } })
    );
    const opened = applyLegalAction({
      state: initial,
      action: summon!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      paymentSources,
    }).state;
    expect(
      opened.cardInstances.find((c) => c.instanceId === "payment-source")
    ).toMatchObject({
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "vanish",
    });
    expect(
      opened.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(0);
    const pending = passStackAsBob(opened, getDefinition);
    const placement = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find((a) => a.kind === "resolve_pending_enter_field_placement");
    expect(placement).toBeDefined();
    const placements = [
      { kind: "card_normal" as const, instanceId: "payment-source", amount: 1 },
      {
        kind: "card_normal" as const,
        instanceId: "response-affected-source",
        amount: 1,
      },
    ];
    const choices = createActionInputDecisionNode(pending, placement!, {
      getCardDefinitionById: getDefinition,
    });
    expect(choices?.choices).toContainEqual(
      expect.objectContaining({
        applyOptions: { enterFieldCorePlacements: placements },
      })
    );
    const resolved = applyLegalAction({
      state: pending,
      action: placement!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      enterFieldCorePlacements: placements,
    }).state;
    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === "spirit-no-placement-core"
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 2 });
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "payment-source")
        ?.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === "alice")).toMatchObject({
      reserveNormalCoreCount: 0,
      trashNormalCoreCount: 4,
    });
  });

  it("rejects a Brave payment that already leaves neither a placement core nor a combine host", () => {
    const brave = {
      ...createSpirit("TEST-BRAVE-SBA-PAYMENT"),
      printedCategory: "brave" as const,
    };
    const paymentSource = createSpirit("TEST-BRAVE-SBA-PAYMENT-SOURCE");
    const getDefinition = createLookup([brave, paymentSource]);
    const main = createMainState(brave, "brave-sba-payment-target");
    const initial: GameState = {
      ...main,
      players: main.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 0 }
          : player
      ),
      cardInstances: [
        ...main.cardInstances,
        createCardInstance(paymentSource, {
          instanceId: "brave-sba-payment-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const summon = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
    }).find(
      (action): action is Extract<LegalAction, { kind: "summon" }> =>
        action.kind === "summon"
    );
    expect(summon).toBeDefined();

    const inputNode = createActionInputDecisionNode(initial, summon!, {
      getCardDefinitionById: getDefinition,
    });
    expect(inputNode?.choices ?? []).toHaveLength(0);
    expect(() =>
      applyLegalAction({
        state: initial,
        action: summon!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
        paymentSources: [
          { kind: "card", instanceId: "brave-sba-payment-source", amount: 1 },
        ],
      })
    ).toThrow("Hand play payment leaves no legal enter-field core placement");
    expect(
      initial.cardInstances.find(
        (c) => c.instanceId === "brave-sba-payment-target"
      )?.zone
    ).toBe("hand");
    expect(
      initial.cardInstances.find(
        (c) => c.instanceId === "brave-sba-payment-source"
      )?.normalCoreCount
    ).toBe(1);
  });

  it("withdraws declaration triggers only when the count-gated summon becomes illegal", () => {
    const spirit = {
      ...createSpirit("TEST-ROLLBACK-VANISH-TARGET"),
      printedCategory: "ultimate" as const,
      summonCondition: [
        { kind: "count_value" as const, player: "self" as const, min: 9 },
      ],
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const paymentSource = {
      ...createSpirit("TEST-ROLLBACK-VANISH-PAYMENT-SOURCE"),
      effects: [
        {
          timing: { kind: "card_event" as const, event: "vanish" as const },
          steps: [
            {
              action: {
                kind: "count_increase" as const,
                player: "self" as const,
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const responseSource = {
      ...createSpirit("TEST-ROLLBACK-VANISH-RESPONSE-SOURCE"),
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const privateVanishListener = {
      ...createSpirit("TEST-ROLLBACK-VANISH-PRIVATE-LISTENER"),
      effects: [
        {
          timing: {
            kind: "game_event" as const,
            event: "vanish" as const,
            player: "self" as const,
          },
          applicability: { zone: "hand" as const },
          executionMode: "optional" as const,
          steps: [
            {
              action: {
                kind: "count_increase" as const,
                player: "self" as const,
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const definitions = [
      spirit,
      paymentSource,
      responseSource,
      privateVanishListener,
    ];
    const getDefinition = createLookup(definitions);
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const main = createMainState(spirit, "rollback-vanish-target");
    const initial: GameState = {
      ...main,
      players: main.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 0 }
          : player
      ),
      cardInstances: [
        ...main.cardInstances,
        createCardInstance(privateVanishListener, {
          instanceId: "rollback-vanish-private-listener",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(paymentSource, {
          instanceId: "rollback-vanish-payment-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(responseSource, {
          instanceId: "rollback-vanish-response-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    };
    const summon = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
    }).find(
      (action): action is Extract<LegalAction, { kind: "summon" }> =>
        action.kind === "summon"
    );
    expect(summon).toBeDefined();

    const opened = applyLegalAction({
      state: initial,
      action: summon!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
      paymentSources: [
        {
          kind: "card",
          instanceId: "rollback-vanish-payment-source",
          amount: 1,
        },
      ],
    }).state;
    expect(opened.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "vanish",
        relatedInstanceId: "rollback-vanish-payment-source",
        exactGameEventKind: true,
      })
    );
    expect(
      opened.stackWindow?.pendingStackAction?.normalHandPlayRollback
        ?.declarationTriggeredEffectPendingIds
    ).toHaveLength(1);
    expect(opened.pendingPrivateDeclarations).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: "rollback-vanish-private-listener",
        eventKind: "vanish",
      })
    );
    expect(
      opened.stackWindow?.pendingStackAction?.normalHandPlayRollback
        ?.declarationPrivateDeclarationIds
    ).toHaveLength(1);

    const afterResponse: GameState = {
      ...opened,
      players: opened.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 8 } : p
      ),
      cardInstances: opened.cardInstances.map((card) =>
        card.instanceId === "rollback-vanish-response-source"
          ? { ...card, normalCoreCount: 0 }
          : card
      ),
    };
    const rolledBack = passStackAsBob(
      afterResponse,
      getDefinition,
      triggeredLookup
    );

    expect(
      rolledBack.pendingTriggeredEffects.some(
        (pendingEffect) =>
          pendingEffect.relatedInstanceId ===
            "rollback-vanish-payment-source" &&
          pendingEffect.eventKind === "vanish"
      )
    ).toBe(false);
    expect(
      rolledBack.pendingPrivateDeclarations.some(
        (declaration) =>
          declaration.sourceInstanceId === "rollback-vanish-private-listener"
      )
    ).toBe(false);
    expect(
      rolledBack.cardInstances.find(
        (card) => card.instanceId === "rollback-vanish-target"
      )?.zone
    ).toBe("hand");
  });

  it("refunds implicit soul payments when the response invalidates the summon condition", () => {
    const spirit = {
      ...createSpirit("TEST-IMPLICIT-SOUL-ROLLBACK"),
      printedCategory: "ultimate" as const,
      summonCondition: [
        { kind: "count_value" as const, player: "self" as const, min: 9 },
      ],
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const responseSource = {
      ...createSpirit("TEST-IMPLICIT-SOUL-RESPONSE-SOURCE"),
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const paymentSource = {
      ...createSpirit("TEST-IMPLICIT-SOUL-PAYMENT-SOURCE"),
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    };
    const getDefinition = createLookup([spirit, responseSource, paymentSource]);

    const runRollback = (
      paymentSources: readonly (
        | { kind: "reserve"; amount: number }
        | { kind: "card"; instanceId: string; amount: number }
      )[]
    ) => {
      const paysFromCard = paymentSources.some(
        (paymentSource) => paymentSource.kind === "card"
      );
      const main = createMainState(spirit, "implicit-soul-target");
      const initial: GameState = {
        ...main,
        players: main.players.map((player) =>
          player.id === "alice"
            ? {
                ...player,
                reserveNormalCoreCount: paysFromCard ? 0 : 1,
                reserveSoulCoreCount: paysFromCard ? 0 : 1,
              }
            : player
        ),
        cardInstances: [
          ...main.cardInstances,
          createCardInstance(responseSource, {
            instanceId: "implicit-soul-response-source",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
          }),
          ...(paysFromCard
            ? [
                createCardInstance(paymentSource, {
                  instanceId: "implicit-soul-payment-source",
                  ownerPlayerId: "alice",
                  controllerPlayerId: "alice",
                  zone: "field",
                  normalCoreCount: 1,
                  soulCoreCount: 1,
                }),
              ]
            : []),
        ],
      };
      const summon = getLegalActions({
        state: initial,
        actingPlayerId: "alice",
        getCardDefinitionById: getDefinition,
        getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
      }).find(
        (action): action is Extract<LegalAction, { kind: "summon" }> =>
          action.kind === "summon"
      );
      expect(summon).toBeDefined();
      const opened = applyLegalAction({
        state: initial,
        action: summon!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
        getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
        paymentSources,
      }).state;
      const afterResponse = {
        ...opened,
        players: opened.players.map((p) =>
          p.id === "alice" ? { ...p, countValue: 8 } : p
        ),
        cardInstances: opened.cardInstances.map((card) =>
          card.instanceId === "implicit-soul-response-source"
            ? { ...card, normalCoreCount: 0 }
            : card
        ),
      };
      return passStackAsBob(afterResponse, getDefinition);
    };

    const reserveRolledBack = runRollback([{ kind: "reserve", amount: 2 }]);
    const reservePlayer = reserveRolledBack.players.find(
      (player) => player.id === "alice"
    );
    expect(reservePlayer).toMatchObject({
      reserveNormalCoreCount: 1,
      reserveSoulCoreCount: 1,
      trashNormalCoreCount: 0,
      trashSoulCoreCount: 0,
    });

    const cardRolledBack = runRollback([
      { kind: "card", instanceId: "implicit-soul-payment-source", amount: 2 },
    ]);
    const cardPlayer = cardRolledBack.players.find(
      (player) => player.id === "alice"
    );
    expect(cardPlayer).toMatchObject({
      reserveNormalCoreCount: 0,
      reserveSoulCoreCount: 0,
      trashNormalCoreCount: 0,
      trashSoulCoreCount: 0,
    });
    expect(
      cardRolledBack.cardInstances.find(
        (card) => card.instanceId === "implicit-soul-payment-source"
      )
    ).toMatchObject({ normalCoreCount: 1, soulCoreCount: 1 });
  });

  it("refunds a forced-void payment when the response invalidates the summon condition", () => {
    const spirit = {
      ...createSpirit("TEST-FORCED-VOID-ROLLBACK-TARGET"),
      printedCategory: "ultimate" as const,
      summonCondition: [
        { kind: "count_value" as const, player: "self" as const, min: 9 },
      ],
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const forcedVoidPaymentSource: CardDefinition = {
      ...createSpirit("TEST-FORCED-VOID-ROLLBACK-SOURCE"),
      tokenIndependentCoreManagement: {
        redirectCoresToVoid: true,
        placementRestrictedToEnterField: false,
      },
    };
    const responseSource = {
      ...createSpirit("TEST-FORCED-VOID-ROLLBACK-RESPONSE"),
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
    };
    const getDefinition = createLookup([
      spirit,
      forcedVoidPaymentSource,
      responseSource,
    ]);
    const main = createMainState(spirit, "forced-void-rollback-target");
    const initial: GameState = {
      ...main,
      players: main.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              reserveNormalCoreCount: 0,
              voidNormalCoreCount: 0,
            }
          : player
      ),
      cardInstances: [
        ...main.cardInstances,
        createCardInstance(forcedVoidPaymentSource, {
          instanceId: "forced-void-payment-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(responseSource, {
          instanceId: "forced-void-response-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    };
    const summon = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
    }).find(
      (action): action is Extract<LegalAction, { kind: "summon" }> =>
        action.kind === "summon"
    );
    expect(summon).toBeDefined();

    const opened = applyLegalAction({
      state: initial,
      action: summon!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      getRegisteredFieldCardEffectActions: emptyFieldCardEffectLookup,
      paymentSources: [
        { kind: "card", instanceId: "forced-void-payment-source", amount: 1 },
      ],
    }).state;
    expect(
      opened.players.find((player) => player.id === "alice")
        ?.voidNormalCoreCount
    ).toBe(1);

    const afterResponse: GameState = {
      ...opened,
      players: opened.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 8 } : p
      ),
      cardInstances: opened.cardInstances.map((card) =>
        card.instanceId === "forced-void-response-source"
          ? { ...card, normalCoreCount: 0 }
          : card
      ),
    };
    const rolledBack = passStackAsBob(afterResponse, getDefinition);

    expect(
      rolledBack.cardInstances.find(
        (card) => card.instanceId === "forced-void-rollback-target"
      )?.zone
    ).toBe("hand");
    expect(
      rolledBack.players.find((player) => player.id === "alice")
        ?.voidNormalCoreCount
    ).toBe(0);
    expect(
      rolledBack.cardInstances.find(
        (card) => card.instanceId === "forced-void-payment-source"
      )
    ).toMatchObject({
      normalCoreCount: 1,
      pendingLeaveKind: null,
      pendingLeaveCause: null,
    });
  });

  it("does not open a placement pending for forbidden (grandwalker) nexus placement", () => {
    const nexus = createGrandwalkerNexus("TEST-GRANDWALKER");
    const getDefinition = createLookup([nexus]);
    const initial = createMainState(nexus, "gw-1");
    const place = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (action): action is Extract<LegalAction, { kind: "place_nexus" }> =>
        action.kind === "place_nexus"
    );
    expect(place).toBeDefined();

    const opened = applyLegalAction({
      state: initial,
      action: place!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    expect(opened.window).toBe("stack");

    // スタック窓クローズ後、配置時コア配置不可カードは維持コア選択 pending を立てず
    // 直接フィールドへ入る（GUI に無意味な維持コア選択 HUD を出さない）。
    const settled = passStackAsBob(opened, getDefinition);
    expect(settled.pendingEnterFieldPlacement).toBeNull();
    const card = settled.cardInstances.find((c) => c.instanceId === "gw-1");
    expect(card?.zone).toBe("field");
    expect(card?.normalCoreCount).toBe(0);

    // resolve_pending_enter_field_placement の legal action も生成されない。
    const placementAction = getLegalActions({
      state: settled,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(placementAction).toBeUndefined();
  });
});
