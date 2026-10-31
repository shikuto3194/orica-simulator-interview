import { describe, expect, it } from "vitest";
import {
  appendPublicDisclosure,
  appendPublicDisclosuresForEffectStepTransition,
  appendPublicDisclosuresForStateTransition,
  applyLegalAction,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  sanitizeStateForViewer,
} from "../src";
import type { CardDefinition, Effect, GameState } from "../src";

const TEST_CARD: CardDefinition = {
  cardNo: "PUBLIC-DISCLOSURE-TEST",
  name: "公開情報テストカード",
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
};

const TEST_NEXUS: CardDefinition = {
  ...TEST_CARD,
  cardNo: "PUBLIC-DISCLOSURE-NEXUS",
  name: "公開情報テストネクサス",
  printedCategory: "nexus",
  levelDefs: [{ level: 1, requiredCores: 0 }],
};

const TEST_FREE_NEXUS: CardDefinition = {
  ...TEST_NEXUS,
  cardNo: "PUBLIC-DISCLOSURE-FREE-NEXUS",
  name: "公開情報テスト無料ネクサス",
  cost: 0,
};

const getDefinition = (id: string): CardDefinition | undefined =>
  id === TEST_CARD.cardNo
    ? TEST_CARD
    : id === TEST_NEXUS.cardNo
      ? TEST_NEXUS
      : id === TEST_FREE_NEXUS.cardNo
        ? TEST_FREE_NEXUS
        : undefined;

describe("public disclosures", () => {
  it("非公開ゾーンへ移った既知カードは過去の名前だけ残し、live instance の追跡を切る", () => {
    const card = createCardInstance(TEST_CARD, {
      instanceId: "alice-public-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state = appendPublicDisclosure(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card],
        }),
        log: ["debug:must-not-be-public"],
      },
      {
        turnNumber: 1,
        step: "main",
        actorPlayerId: "alice",
        audience: "both",
        kind: "picked",
        targets: [],
        results: [
          {
            kind: "card_move",
            instanceId: card.instanceId,
            from: "revealed",
            to: "hand",
            actionLabel: "add_to_hand",
          },
        ],
      }
    );

    const bobView = sanitizeStateForViewer(state, "bob");
    expect(bobView.log).toEqual([]);
    expect(bobView.publicDisclosures).toHaveLength(1);
    expect(
      bobView.cardInstances.find(
        (entry) => entry.instanceId === card.instanceId
      )?.definitionId
    ).toBe("_hidden_card_");
    expect(
      sanitizeStateForViewer(state, "alice").cardInstances.find(
        (entry) => entry.instanceId === card.instanceId
      )?.definitionId
    ).toBe("_hidden_card_");
    expect(bobView.publicDisclosures?.[0]?.results[0]).toEqual({
      kind: "card_move",
      definitionIdSnapshot: TEST_CARD.cardNo,
      from: "revealed",
      to: "hand",
      actionLabel: "add_to_hand",
    });

    const reappearedState = {
      ...state,
      cardInstances: state.cardInstances.map((entry) => ({
        ...entry,
        zone: "field" as const,
      })),
    };
    const bobViewAfterReappearing = sanitizeStateForViewer(
      reappearedState,
      "bob"
    );
    expect(
      bobViewAfterReappearing.publicDisclosures?.[0]?.results[0]
    ).not.toHaveProperty("instanceId");
    expect(
      bobViewAfterReappearing.publicDisclosures?.[0]?.results[0]
    ).toHaveProperty("definitionIdSnapshot", TEST_CARD.cardNo);
  });

  it("actor_only の disclosure は相手と観戦者へ配送しない", () => {
    const state = appendPublicDisclosure(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      {
        turnNumber: 1,
        step: "main",
        actorPlayerId: "alice",
        audience: "actor_only",
        kind: "deck_revealed",
        targets: [],
        results: [],
      }
    );

    expect(
      sanitizeStateForViewer(state, "alice").publicDisclosures
    ).toHaveLength(1);
    expect(sanitizeStateForViewer(state, "bob").publicDisclosures).toEqual([]);
    expect(sanitizeStateForViewer(state, null).publicDisclosures).toEqual([]);
  });

  it("self-only deck reveal は公開した本人だけにカード参照を配送する", () => {
    const deckCard = createCardInstance(TEST_CARD, {
      instanceId: "self-reveal-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [deckCard],
    });
    const after = {
      ...before,
      cardInstances: [
        {
          ...deckCard,
          zone: "revealed" as const,
          revealedTo: "self" as const,
          revealedByPlayerId: "alice",
        },
      ],
    };
    const result = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });

    expect(
      sanitizeStateForViewer(result, "alice").publicDisclosures
    ).toMatchObject([
      {
        kind: "deck_revealed",
        audience: "actor_only",
        targets: [{ instanceId: deckCard.instanceId }],
      },
    ]);
    expect(sanitizeStateForViewer(result, "bob").publicDisclosures).toEqual([]);
  });

  it("非公開ゾーン間の移動はカード素性を public disclosure に載せない", () => {
    const deckCard = createCardInstance(TEST_CARD, {
      instanceId: "private-draw-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [deckCard],
    });
    const after = {
      ...before,
      cardInstances: [{ ...deckCard, zone: "hand" as const }],
    };

    const result = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });

    expect(
      sanitizeStateForViewer(result, "bob").publicDisclosures
    ).toMatchObject([
      {
        results: [
          { kind: "hidden_card_move", count: 1, from: "deck", to: "hand" },
        ],
      },
    ]);
    expect(
      JSON.stringify(sanitizeStateForViewer(result, "bob").publicDisclosures)
    ).not.toContain(TEST_CARD.cardNo);
  });

  it("スタックを閉じた相手ではなく、解決されたスタックの使用者を actor にする", () => {
    const bobNexus = createCardInstance(TEST_FREE_NEXUS, {
      instanceId: "bob-free-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["bob", "alice"],
        cardInstances: [bobNexus],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      preGame: null,
      step: "main" as const,
    };

    const place = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: getDefinition,
    }).find(
      (action) =>
        action.kind === "place_nexus" &&
        action.sourceInstanceId === bobNexus.instanceId
    );
    expect(place).toBeDefined();

    const opened = applyLegalAction({
      state,
      action: place!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: () => [],
      enterFieldCorePlacements: [],
    }).state;
    expect(opened.window).toBe("stack");

    const pass = getLegalActions({
      state: opened,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: opened,
      action: pass!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === bobNexus.instanceId
      )?.zone
    ).toBe("field");

    expect(resolved.publicDisclosures).toMatchObject([
      {
        kind: "zone_moved",
        actorPlayerId: "bob",
        results: [
          {
            instanceId: bobNexus.instanceId,
            from: "in_use",
            to: "field",
            actionLabel: "place",
          },
        ],
      },
    ]);
  });

  it("公開オープンから手札へ加えた結果を sequence 順の picked record として残す", () => {
    const revealed = createCardInstance(TEST_CARD, {
      instanceId: "revealed-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
      revealedTo: "both",
      revealedByPlayerId: "alice",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [revealed],
    });
    const after = {
      ...before,
      cardInstances: [{ ...revealed, zone: "hand" as const }],
    };
    const result = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });

    expect(result.publicDisclosures).toMatchObject([
      {
        sequence: 1,
        kind: "picked",
        audience: "both",
        results: [
          {
            instanceId: "revealed-card",
            from: "revealed",
            to: "hand",
            actionLabel: "add_to_hand",
          },
        ],
      },
    ]);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("既に deck_revealed として記録済みのオープンを外側 action 差分で二重記録しない", () => {
    const deckCard = createCardInstance(TEST_CARD, {
      instanceId: "already-revealed-card",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [deckCard],
    });
    const afterWithoutDisclosure = {
      ...before,
      cardInstances: [
        {
          ...deckCard,
          zone: "revealed" as const,
          revealedTo: "both" as const,
          revealedByPlayerId: "bob",
        },
      ],
    };
    const after = appendPublicDisclosure(afterWithoutDisclosure, {
      turnNumber: 1,
      step: "main",
      actorPlayerId: "bob",
      audience: "both",
      kind: "deck_revealed",
      targets: [
        {
          kind: "card",
          instanceId: deckCard.instanceId,
          actionLabel: "reveal",
        },
      ],
      results: [],
    });

    const result = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });

    expect(result.publicDisclosures).toHaveLength(1);
    expect(result.publicDisclosures?.[0]).toMatchObject({
      kind: "deck_revealed",
      actorPlayerId: "bob",
      targets: [{ instanceId: deckCard.instanceId }],
    });
  });

  it("ミラージュセットとバレットエディットの公開移動に専用 label を付ける", () => {
    const source = createCardInstance(TEST_CARD, {
      instanceId: "label-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const handCard = createCardInstance(TEST_CARD, {
      instanceId: "label-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, handCard],
    });
    const afterBullet = {
      ...before,
      cardInstances: [
        source,
        {
          ...handCard,
          zone: "field" as const,
          attachedToInstanceId: source.instanceId,
          zoneRoleName: "bullet-edit",
        },
      ],
    };

    const bulletResult = appendPublicDisclosuresForEffectStepTransition({
      before,
      after: afterBullet,
      actorPlayerId: "alice",
      action: {
        kind: "bullet_edit",
        target: { kind: "self" },
      },
      sourceInstanceId: source.instanceId,
    });
    expect(bulletResult.publicDisclosures?.[0]?.results).toMatchObject([
      {
        instanceId: handCard.instanceId,
        from: "hand",
        to: "field",
        actionLabel: "bullet_edit_place",
      },
    ]);

    const revealed = {
      ...handCard,
      instanceId: "label-mirage",
      zone: "revealed" as const,
      revealedTo: "both" as const,
      revealedByPlayerId: "alice",
    };
    const beforeMirage = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [revealed],
    });
    const afterMirage = {
      ...beforeMirage,
      cardInstances: [{ ...revealed, zone: "mirage" as const }],
    };
    const mirageResult = appendPublicDisclosuresForStateTransition({
      before: beforeMirage,
      after: afterMirage,
      actorPlayerId: "alice",
    });
    expect(mirageResult.publicDisclosures?.[0]?.results).toMatchObject([
      {
        instanceId: "label-mirage",
        from: "revealed",
        to: "mirage",
        actionLabel: "mirage_set",
      },
    ]);
  });

  it("unseen:true の手札破棄はカード参照を含めず枚数と移動先だけを公開する", () => {
    const source = createCardInstance(TEST_CARD, {
      instanceId: "unseen-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const hiddenHand = createCardInstance(TEST_CARD, {
      instanceId: "unseen-hand-card",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, hiddenHand],
    });
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      executionMode: "mandatory",
      steps: [
        {
          action: {
            kind: "discard",
            player: "opponent",
            count: 1,
            unseen: true,
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:public-disclosure:507",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === hiddenHand.instanceId
      )?.zone
    ).toBe("trash");
    expect(result.publicDisclosures).toMatchObject([
      {
        kind: "hidden_card_action",
        actorPlayerId: "alice",
        audience: "both",
        results: [
          {
            kind: "hidden_card_move",
            count: 1,
            from: "hand",
            to: "trash",
            hiddenReason: "without_showing_contents",
            actionLabel: "discard",
          },
        ],
      },
    ]);
    expect(result.publicDisclosures?.[0]?.results[0]).not.toHaveProperty(
      "instanceId"
    );
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("複数ステップの移動結果を各対象へ結び、移動先とデッキ位置をラベル化する", () => {
    const source = createCardInstance(TEST_CARD, {
      instanceId: "multi-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const handTarget = createCardInstance(TEST_CARD, {
      instanceId: "move-to-hand-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const deckTarget = createCardInstance(TEST_NEXUS, {
      instanceId: "move-to-deck-top-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, handTarget, deckTarget],
    });
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      executionMode: "mandatory",
      steps: [
        {
          action: {
            kind: "move_card",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            from: { zone: "field", player: "opponent" },
            to: { zone: "hand", player: "opponent" },
            count: 1,
          },
        },
        {
          action: {
            kind: "move_card",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["nexus"] },
              count: 1,
            },
            from: { zone: "field", player: "opponent" },
            to: {
              zone: "deck",
              player: "opponent",
              position: "top",
            },
            count: 1,
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:public-disclosure:608",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(result.publicDisclosures).toMatchObject([
      {
        kind: "target_declared",
        targets: [
          {
            instanceId: handTarget.instanceId,
            actionLabel: "add_to_hand",
          },
        ],
        results: [
          {
            instanceId: handTarget.instanceId,
            from: "field",
            to: "hand",
            actionLabel: "add_to_hand",
          },
        ],
      },
      {
        kind: "target_declared",
        targets: [
          {
            instanceId: deckTarget.instanceId,
            actionLabel: "move_to_top",
          },
        ],
        results: [
          {
            instanceId: deckTarget.instanceId,
            from: "field",
            to: "deck",
            actionLabel: "move_to_top",
          },
        ],
      },
    ]);
  });

  it("公開済みカードのデッキ戻しは移動時点の上/下位置 snapshot を履歴に残す", () => {
    const existingTop = createCardInstance(TEST_CARD, {
      instanceId: "existing-deck-top",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const existingBottom = createCardInstance(TEST_NEXUS, {
      instanceId: "existing-deck-bottom",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const returnedTop1 = createCardInstance(TEST_CARD, {
      instanceId: "returned-deck-top-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "revealed",
    });
    const returnedTop2 = createCardInstance(TEST_NEXUS, {
      instanceId: "returned-deck-top-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "revealed",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [existingTop, existingBottom, returnedTop1, returnedTop2],
      playerOverrides: [{}, { deckCount: 2 }],
    });
    const after: GameState = {
      ...before,
      cardInstances: [
        { ...returnedTop1, zone: "deck" },
        { ...returnedTop2, zone: "deck" },
        existingTop,
        existingBottom,
      ],
      players: before.players.map((player) =>
        player.id === "bob" ? { ...player, deckCount: 4 } : player
      ),
    };

    const result = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });

    expect(result.publicDisclosures?.at(-1)?.results).toMatchObject([
      {
        instanceId: returnedTop1.instanceId,
        actionLabel: "move_to_top",
        deckPositionSnapshot: "top",
        deckIndexFromBottomSnapshot: 3,
        deckCountSnapshot: 4,
      },
      {
        instanceId: returnedTop2.instanceId,
        actionLabel: "move_to_top",
        deckPositionSnapshot: "top",
        deckIndexFromBottomSnapshot: 2,
        deckCountSnapshot: 4,
      },
    ]);
  });

  it("ライフ減少・ドロー・疲労を実差分つきで記録し、汎用 action も kind を失わない", () => {
    const source = createCardInstance(TEST_CARD, {
      instanceId: "semantic-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const target = createCardInstance(TEST_CARD, {
      instanceId: "semantic-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const deckCard = createCardInstance(TEST_CARD, {
      instanceId: "semantic-deck-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target, deckCard],
      playerOverrides: [{ deckCount: 1 }, {}],
    });
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      executionMode: "mandatory",
      steps: [
        { action: { kind: "life_damage", player: "opponent", amount: 1 } },
        { action: { kind: "draw", count: 1 } },
        {
          action: {
            kind: "exhaust",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
        { action: { kind: "noop", target: { kind: "self" } } },
      ],
    };

    const result = executeEffect({
      chainId: "test:public-disclosure:769",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(result.publicDisclosures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "state_changed",
          results: [
            expect.objectContaining({
              kind: "life_delta",
              playerId: "bob",
              amount: -1,
              actionLabel: "life_reduce",
            }),
          ],
        }),
        expect.objectContaining({
          kind: "state_changed",
          results: [
            expect.objectContaining({
              kind: "hand_delta",
              playerId: "alice",
              amount: 1,
              actionLabel: "draw",
            }),
          ],
        }),
        expect.objectContaining({
          kind: "target_declared",
          targets: [
            expect.objectContaining({
              instanceId: target.instanceId,
              actionLabel: "exhaust",
            }),
          ],
          results: [
            expect.objectContaining({
              kind: "exhaust_state",
              instanceId: target.instanceId,
              exhaustState: "exhausted",
            }),
          ],
        }),
        expect.objectContaining({
          kind: "target_declared",
          targets: [
            expect.objectContaining({
              instanceId: source.instanceId,
              actionLabel: "action_execute",
              actionKind: "noop",
            }),
          ],
        }),
      ])
    );
  });

  it("アタック・ブロック・バトル破壊・ライフ減少を戦闘イベントとして残す", () => {
    const attacker = createCardInstance(TEST_CARD, {
      instanceId: "battle-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const blocker = createCardInstance(TEST_CARD, {
      instanceId: "battle-blocker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const initial = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker, blocker],
      }),
      preGame: null,
      step: "attack" as const,
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId: "entity-attacker",
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["red" as const],
          attackState: "attacking" as const,
        },
        {
          entityId: "entity-blocker",
          memberInstanceIds: [blocker.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["red" as const],
          attackState: "idle" as const,
        },
      ],
    } satisfies GameState;
    const activeAttack = {
      attackId: "attack-public-log",
      primaryEntityId: "entity-attacker",
      participantEntityIds: ["entity-attacker"],
      groupMode: "single" as const,
      target: { kind: "player" as const, playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "entity-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["entity-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const attackLogged = appendPublicDisclosuresForStateTransition({
      before: initial,
      after: { ...initial, activeAttack },
      actorPlayerId: "bob",
    });
    expect(attackLogged.publicDisclosures?.at(-1)).toMatchObject({
      kind: "attack_declared",
      actorPlayerId: "alice",
      attackId: activeAttack.attackId,
      targets: [
        { instanceId: attacker.instanceId, actionLabel: "attack" },
        { playerId: "bob", actionLabel: "attack_target" },
      ],
    });

    const blockedState: GameState = {
      ...attackLogged,
      battleEntities: attackLogged.battleEntities.map((entity) =>
        entity.entityId === "entity-blocker"
          ? { ...entity, attackState: "blocking" }
          : entity
      ),
      activeAttack: {
        ...activeAttack,
        blockAssignments: [
          {
            participantEntityId: "entity-attacker",
            blockedByEntityIds: ["entity-blocker"],
          },
        ],
      },
    };
    const blockLogged = appendPublicDisclosuresForStateTransition({
      before: attackLogged,
      after: blockedState,
      actorPlayerId: "alice",
    });
    expect(blockLogged.publicDisclosures?.at(-1)).toMatchObject({
      kind: "block_declared",
      actorPlayerId: "bob",
      targets: [
        { instanceId: blocker.instanceId, actionLabel: "block" },
        { instanceId: attacker.instanceId, actionLabel: "block_target" },
      ],
    });

    const bobBefore = blockLogged.players.find(
      (player) => player.id === "bob"
    )!;
    const resolvedState: GameState = {
      ...blockLogged,
      players: blockLogged.players.map((player) =>
        player.id === "bob"
          ? { ...player, lifeNormalCoreCount: player.lifeNormalCoreCount - 1 }
          : player
      ),
      cardInstances: blockLogged.cardInstances.map((card) =>
        card.instanceId === blocker.instanceId
          ? { ...card, zone: "trash" as const }
          : card
      ),
      activeAttack: null,
      battleEntities: [],
    };
    expect(bobBefore.lifeNormalCoreCount).toBeGreaterThan(0);
    const battleLogged = appendPublicDisclosuresForStateTransition({
      before: {
        ...blockLogged,
        activeAttack: {
          ...blockLogged.activeAttack!,
          battleDestroyedRecords: [
            {
              instanceId: blocker.instanceId,
              definitionId: blocker.definitionId,
              ownerPlayerId: "bob",
              causePlayerId: "alice",
            },
          ],
        },
      },
      after: resolvedState,
      actorPlayerId: "bob",
    });
    expect(battleLogged.publicDisclosures?.at(-1)).toMatchObject({
      kind: "battle_resolved",
      actorPlayerId: "alice",
      attackId: activeAttack.attackId,
      results: expect.arrayContaining([
        expect.objectContaining({
          kind: "destroyed",
          instanceId: blocker.instanceId,
          actionLabel: "destroy",
        }),
        expect.objectContaining({
          kind: "life_delta",
          playerId: "bob",
          amount: -1,
        }),
      ]),
    });

    const unclassifiedLeave = appendPublicDisclosuresForStateTransition({
      before: blockLogged,
      after: resolvedState,
      actorPlayerId: "bob",
    });
    expect(
      unclassifiedLeave.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .find((result) => result.instanceId === blocker.instanceId)
    ).toMatchObject({ kind: "card_move", actionLabel: "move_to_trash" });
  });
});
