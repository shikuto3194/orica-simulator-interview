import { applyActionAndChooseEntryCores } from "./helpers/choose-effect-entry-cores";
/**
 * BSTH03-C31 "永遠亭" effects[1]:
 * 自分の黄/紫効果でデッキからオープンされたか、トラッシュに置かれたこのカードは
 * コストを支払わずに配置できる。
 *
 * 07b の確定済み観測裁定に従い、同構文は card_event(revealed/moved_to_trash) と
 * trigger_from_zone:deck を組み合わせる。よって両イベントとも deck 起点だけを受ける。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type ContinuousEffect,
  type DeckRevealPick,
  type GameState,
} from "../src";
import {
  findMovedToTrashAutoEffect,
  findRevealedEffect,
  materializeDeferredTrashOptionalAdds,
  processMovedToTrashEffects,
  type TriggerContext,
} from "../src/effect/structured-effect-interpreter";
import { executeDiscardHand } from "../src/effect/structured-zone-ops";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggers = () => [];

const ALICE = "alice";
const BOB = "bob";
const EIENTEI = cardNoMap.get("BSTH03-C31")!;
const SOURCE = cardNoMap.get("BSTH03-C02")!;
const NON_YELLOW_PURPLE_SOURCE = cardNoMap.get("BSAZ02-C06")!;
const PICK_TARGET = cardNoMap.get("BSTH03-X02")!;
const EFFECT_SOURCE_ID = "effect-source";

function setup(zone: "revealed" | "trash"): {
  state: GameState;
  cardId: string;
} {
  const self = createCardInstance(EIENTEI, {
    instanceId: `eientei-${zone}`,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone,
  });
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [self],
  });
  return { state, cardId: self.instanceId };
}

function restrictUseCE(
  targetPlayerId: string,
  filter: Record<string, unknown>,
  restrictedKinds: string[]
): ContinuousEffect {
  return {
    effectId: `ce-restrict-use-${targetPlayerId}`,
    sourceInstanceId: "restrict-source",
    sourceDefinitionId: SOURCE.cardNo,
    actingPlayerId: BOB,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "restrict_use",
    targetInstanceId: targetPlayerId,
    metadata: { filter, restrictedKinds },
  };
}

function treatSourceAsColorCE(color: "yellow" | "purple"): ContinuousEffect {
  return {
    effectId: `ce-source-as-${color}`,
    sourceInstanceId: EFFECT_SOURCE_ID,
    sourceDefinitionId: SOURCE.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "treat_as_color",
    modifierSymbol: [color as never],
    targetInstanceId: EFFECT_SOURCE_ID,
  };
}

function setupDeckReveal(options?: {
  sourceDef?: CardDefinition;
  activeContinuousEffects?: ContinuousEffect[];
  additionalDeckCards?: Array<{
    definition: CardDefinition;
    instanceId: string;
  }>;
  picks?: DeckRevealPick[];
  revealCount?: number;
  remainder?: "bottom" | "trash";
  reserveNormalCoreCount?: number;
}) {
  const sourceDef = options?.sourceDef ?? SOURCE;
  const source = createCardInstance(sourceDef, {
    instanceId: EFFECT_SOURCE_ID,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 1,
  });
  const target = createCardInstance(EIENTEI, {
    instanceId: "eientei-deck",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const additionalDeckCards =
    options?.additionalDeckCards?.map(({ definition, instanceId }) =>
      createCardInstance(definition, {
        instanceId,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    ) ?? [];
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [source, target, ...additionalDeckCards],
  });
  const state: GameState = {
    ...base,
    activeContinuousEffects: options?.activeContinuousEffects ?? [],
    players: base.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            deckCount: 1 + additionalDeckCards.length,
            reserveNormalCoreCount: options?.reserveNormalCoreCount ?? 0,
          }
        : p
    ),
  };
  const afterReveal = executeEffect({
    chainId: "test:bsth03-c31-self-placement:149",
    state,
    sourceInstanceId: source.instanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: options?.revealCount ?? 1,
            picks: options?.picks ?? [],
            remainder: options?.remainder ?? "bottom",
          },
        },
      ],
    },
  });
  return { afterReveal, cardId: target.instanceId };
}

describe("BSTH03-C31 effects[1] deck-origin self placement", () => {
  const effect = EIENTEI.effects![1]!;

  it("effect definition is an optional card_event field disposition gated by self yellow/purple deck source", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
      { kind: "trigger_colors", colors: ["yellow", "purple"] },
      { kind: "trigger_from_zone", zones: ["deck"] },
      { kind: "trigger_physical_from_zone", zones: ["deck"] },
    ]);
    expect(effect.cardEventDisposition).toEqual({
      kind: "move",
      destination: "field",
    });
  });

  it("revealed branch offers field placement for own yellow/purple deck-origin effect only", () => {
    const { state, cardId } = setup("revealed");
    const ok: TriggerContext = {
      sourceColors: ["yellow"],
      sourcePlayerId: ALICE,
      fromZone: "deck",
    };

    expect(
      findRevealedEffect(state, cardId, EIENTEI, getDef, ok)
    ).toMatchObject({
      executionMode: "optional",
      disposition: { kind: "move", destination: "field" },
    });
    expect(
      findRevealedEffect(state, cardId, EIENTEI, getDef, {
        ...ok,
        sourceColors: ["blue"],
      })
    ).toBeUndefined();
    expect(
      findRevealedEffect(state, cardId, EIENTEI, getDef, {
        ...ok,
        sourcePlayerId: BOB,
      })
    ).toBeUndefined();
    expect(
      findRevealedEffect(state, cardId, EIENTEI, getDef, {
        ...ok,
        fromZone: "hand",
      })
    ).toBeUndefined();
  });

  it("deck_reveal origin resolves revealed_choice into real field placement without stale revealed cards", () => {
    const { afterReveal, cardId } = setupDeckReveal({
      reserveNormalCoreCount: 4,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.phase).toBe("revealed_choice");

    const action = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(action).toBeDefined();
    expect(action.candidateCardInstanceIds).toContain(cardId);

    const { state: accepted } = applyActionAndChooseEntryCores({
      state: afterReveal,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      selectedDeckRevealCardIds: [cardId],
    });

    const acceptedCard = accepted.cardInstances.find(
      (c) => c.instanceId === cardId
    )!;
    expect(accepted.pendingDeckReveal).toBeNull();
    expect(acceptedCard.zone).toBe("field");
    expect(acceptedCard.zoneRoleName).toBe("nexus");
    expect(
      accepted.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(4);
    expect(accepted.cardInstances.some((c) => c.zone === "revealed")).toBe(
      false
    );
    expect(accepted.log).toContain(
      `effect:field_place:deck_reveal:${ALICE}:${cardId}`
    );
    expect(
      accepted.activeContinuousEffects.map((ce) => ({
        sourceInstanceId: ce.sourceInstanceId,
        modifierTag: ce.modifierTag,
        modifierSymbol: ce.modifierSymbol,
      }))
    ).toContainEqual({
      sourceInstanceId: cardId,
      modifierTag: "treat_as_symbol",
      modifierSymbol: ["purple"],
    });
  });

  it("does not re-offer self placement when an opened card is later discarded", () => {
    const { afterReveal, cardId } = setupDeckReveal({
      reserveNormalCoreCount: 4,
      remainder: "trash",
    });
    const action = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_deck_reveal_pick"
    )!;

    const { state: declined } = applyLegalAction({
      state: afterReveal,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      selectedDeckRevealCardIds: [],
    });

    // Q16858: 「デッキからオープンされた後に破棄された」移動元は revealed。
    // deck 起点の moved_to_trash 自己配置を再び候補化してはいけない。
    expect(declined.pendingDeckReveal).toBeNull();
    expect(declined.pendingTrashOptionalAdds).toHaveLength(0);
    expect(
      declined.cardInstances.find((card) => card.instanceId === cardId)!.zone
    ).toBe("trash");
  });

  it("keeps accepted field placement pending until remaining deck_reveal picks finalize", () => {
    const pickTargetId = "pick-target-nexus";
    const { afterReveal, cardId } = setupDeckReveal({
      additionalDeckCards: [
        { definition: PICK_TARGET, instanceId: pickTargetId },
      ],
      revealCount: 2,
      picks: [{ count: 1, filter: { category: ["nexus"] }, mandatory: true }],
      remainder: "trash",
    });

    const revealedChoiceAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;

    const { state: acceptedChoice } = applyActionAndChooseEntryCores({
      state: afterReveal,
      action: revealedChoiceAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      selectedDeckRevealCardIds: [cardId],
    });

    const deferredCard = acceptedChoice.cardInstances.find(
      (c) => c.instanceId === cardId
    )!;
    expect(acceptedChoice.pendingDeckReveal).not.toBeNull();
    expect(acceptedChoice.pendingDeckReveal!.phase).toBe("picking");
    expect(deferredCard.zone).toBe("revealed");
    expect(acceptedChoice.pendingDeckReveal!.pickedCardInstanceIds).toContain(
      cardId
    );
    expect(
      acceptedChoice.pendingDeckReveal!.pickedDestinationByInstance?.[cardId]
    ).toBe("field");
    expect(
      acceptedChoice.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === cardId && ce.modifierTag === "treat_as_symbol"
      )
    ).toBe(false);

    const pickAction = getLegalActions({
      state: acceptedChoice,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(pickAction.candidateCardInstanceIds).toEqual([pickTargetId]);

    const { state: finalized } = applyActionAndChooseEntryCores({
      state: acceptedChoice,
      action: pickAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      selectedDeckRevealCardIds: [pickTargetId],
    });

    const placedCard = finalized.cardInstances.find(
      (c) => c.instanceId === cardId
    )!;
    const pickedCard = finalized.cardInstances.find(
      (c) => c.instanceId === pickTargetId
    )!;
    expect(finalized.pendingDeckReveal).toBeNull();
    expect(placedCard.zone).toBe("field");
    expect(placedCard.zoneRoleName).toBe("nexus");
    expect(pickedCard.zone).toBe("hand");
    expect(finalized.log).toContain(
      `deck_reveal:finalize:${ALICE}:picked=2:remainder=0:trash`
    );
    expect(finalized.log).toContain(
      `effect:field_place:deck_reveal:${ALICE}:${cardId}`
    );
    expect(
      finalized.activeContinuousEffects.map((ce) => ({
        sourceInstanceId: ce.sourceInstanceId,
        modifierTag: ce.modifierTag,
        modifierSymbol: ce.modifierSymbol,
      }))
    ).toContainEqual({
      sourceInstanceId: cardId,
      modifierTag: "treat_as_symbol",
      modifierSymbol: ["purple"],
    });
  });

  it("deck_reveal branch uses effective source colors, not printed source colors", () => {
    const { afterReveal, cardId } = setupDeckReveal({
      sourceDef: NON_YELLOW_PURPLE_SOURCE,
      activeContinuousEffects: [treatSourceAsColorCE("yellow")],
    });
    expect(NON_YELLOW_PURPLE_SOURCE.colors).not.toContain("yellow");
    expect(NON_YELLOW_PURPLE_SOURCE.colors).not.toContain("purple");

    const action = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;

    expect(action).toBeDefined();
    expect(action.candidateCardInstanceIds).toContain(cardId);
  });

  it("deck_reveal revealed_choice excludes field placement candidates blocked by restrict_use", () => {
    const { afterReveal, cardId } = setupDeckReveal();
    const restricted: GameState = {
      ...afterReveal,
      activeContinuousEffects: [
        ...afterReveal.activeContinuousEffects,
        restrictUseCE(ALICE, { category: ["nexus"] }, ["place_nexus"]),
      ],
    };

    const action = getLegalActions({
      state: restricted,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(action).toBeDefined();
    expect(action.candidateCardInstanceIds).not.toContain(cardId);
    expect(action.maxPickCount).toBe(0);
    expect(() =>
      applyLegalAction({
        state: restricted,
        action,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggers,
        selectedDeckRevealCardIds: [cardId],
      })
    ).toThrow(/Invalid deck reveal revealed choice candidate/);
  });

  it("moved_to_trash branch defers optional field placement without immediate zone move", () => {
    const { state, cardId } = setup("trash");
    const result = processMovedToTrashEffects(state, [cardId], getDef, {
      sourceColors: ["purple"],
      sourcePlayerId: ALICE,
      fromZone: "deck",
    });

    expect(
      result.cardInstances.find((c) => c.instanceId === cardId)!.zone
    ).toBe("trash");
    expect(result.pendingDeckReveal).toBeNull();
    expect(result.pendingTrashOptionalAdds).toHaveLength(1);
    expect(result.pendingTrashOptionalAdds[0]!.instanceIds).toContain(cardId);
    expect(
      result.pendingTrashOptionalAdds[0]!.dispositionByInstanceId?.[cardId]
    ).toEqual({ kind: "move", destination: "field" });
  });

  it("materialize exposes a trash-origin revealed_choice whose accept destination is field", () => {
    const { state, cardId } = setup("trash");
    const pendingState = materializeDeferredTrashOptionalAdds(
      processMovedToTrashEffects(state, [cardId], getDef, {
        sourceColors: ["purple"],
        sourcePlayerId: ALICE,
        fromZone: "deck",
      })
    );

    expect(pendingState.pendingTrashOptionalAdds).toHaveLength(0);
    const pending = pendingState.pendingDeckReveal;
    expect(pending).not.toBeNull();
    expect(pending!.origin).toBe("trash");
    expect(pending!.revealedAutoAddCandidateIds).toContain(cardId);
    expect(pending!.revealedDispositionMap?.[cardId]).toEqual({
      kind: "move",
      destination: "field",
    });
  });

  it("accepting the optional choice places it on the field, while declining leaves it in trash", () => {
    const { state, cardId } = setup("trash");
    const pendingState = materializeDeferredTrashOptionalAdds(
      processMovedToTrashEffects(state, [cardId], getDef, {
        sourceColors: ["yellow"],
        sourcePlayerId: ALICE,
        fromZone: "deck",
      })
    );
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(action).toBeDefined();
    const baseHand = pendingState.players.find(
      (p) => p.id === ALICE
    )!.handCount;

    const { state: accepted } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      selectedDeckRevealCardIds: [cardId],
    });

    expect(accepted.pendingDeckReveal).toBeNull();
    const acceptedCard = accepted.cardInstances.find(
      (c) => c.instanceId === cardId
    )!;
    expect(acceptedCard.zone).toBe("field");
    expect(acceptedCard.zoneRoleName).toBe("nexus");
    expect(accepted.log).toContain(
      `effect:field_place:deck_reveal:${ALICE}:${cardId}`
    );
    expect(accepted.players.find((p) => p.id === ALICE)!.handCount).toBe(
      baseHand
    );

    const declinedPendingState = materializeDeferredTrashOptionalAdds(
      processMovedToTrashEffects(state, [cardId], getDef, {
        sourceColors: ["yellow"],
        sourcePlayerId: ALICE,
        fromZone: "deck",
      })
    );
    const declinedAction = getLegalActions({
      state: declinedPendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;

    const { state: declined } = applyLegalAction({
      state: declinedPendingState,
      action: declinedAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      selectedDeckRevealCardIds: [],
    });

    expect(declined.pendingDeckReveal).toBeNull();
    expect(
      declined.cardInstances.find((c) => c.instanceId === cardId)!.zone
    ).toBe("trash");
  });

  it.each(["hand", "field"] as const)(
    "moved_to_trash from %s does not create a placement choice outside the deck-origin scope",
    (fromZone) => {
      const { state, cardId } = setup("trash");
      const result = processMovedToTrashEffects(state, [cardId], getDef, {
        sourceColors: ["yellow"],
        sourcePlayerId: ALICE,
        fromZone,
      });

      expect(result.pendingTrashOptionalAdds).toHaveLength(0);
      expect(
        result.cardInstances.find((c) => c.instanceId === cardId)!.zone
      ).toBe("trash");
    }
  );

  it("deck discard branch uses effective source colors for moved_to_trash triggers", () => {
    const source = createCardInstance(NON_YELLOW_PURPLE_SOURCE, {
      instanceId: EFFECT_SOURCE_ID,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const target = createCardInstance(EIENTEI, {
      instanceId: "eientei-deck-discard",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, target],
    });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [treatSourceAsColorCE("yellow")],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, deckCount: 1 } : p
      ),
    };

    const discarded = executeDiscardHand(
      state,
      ALICE,
      {
        kind: "discard_hand",
        count: 1,
        fromZone: "deck",
      },
      getDef,
      source.instanceId
    );

    expect(
      discarded.cardInstances.find((c) => c.instanceId === target.instanceId)!
        .zone
    ).toBe("trash");
    expect(discarded.pendingTrashOptionalAdds).toHaveLength(1);
    expect(discarded.pendingTrashOptionalAdds[0]!.instanceIds).toContain(
      target.instanceId
    );
    expect(
      discarded.pendingTrashOptionalAdds[0]!.dispositionByInstanceId?.[
        target.instanceId
      ]
    ).toEqual({ kind: "move", destination: "field" });
  });

  it("moved_to_trash branch rejects different colors, opponent source, and non-deck origins", () => {
    const { state, cardId } = setup("trash");
    const ok: TriggerContext = {
      sourceColors: ["yellow"],
      sourcePlayerId: ALICE,
      fromZone: "deck",
    };

    expect(
      findMovedToTrashAutoEffect(state, cardId, EIENTEI, getDef, ok)
    ).toBeDefined();
    expect(
      findMovedToTrashAutoEffect(state, cardId, EIENTEI, getDef, {
        ...ok,
        sourceColors: ["blue"],
      })
    ).toBeUndefined();
    expect(
      findMovedToTrashAutoEffect(state, cardId, EIENTEI, getDef, {
        ...ok,
        sourcePlayerId: BOB,
      })
    ).toBeUndefined();
    expect(
      findMovedToTrashAutoEffect(state, cardId, EIENTEI, getDef, {
        ...ok,
        fromZone: "field",
      })
    ).toBeUndefined();
    expect(
      findMovedToTrashAutoEffect(state, cardId, EIENTEI, getDef, {
        ...ok,
        fromZone: "hand",
      })
    ).toBeUndefined();
  });
});
