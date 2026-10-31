import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSES01-T01「M1A4 ジャガーノート」textLines[4]。
 *
 * 「このスピリットのブレイヴは分離できず、このスピリットがフィールドを離れるとき、
 * フィールドに残せない。」
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  collectGameStateInvariantIssues,
  collectTriggerEventsFromStateDelta,
  createCardInstance,
  createEmptyGameState,
  executeBounce,
  executeMoveCardPrimitive,
  flushPendingLeaves,
  getLegalActions,
  runStateBasedActions,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeSendToDeck } from "../src/effect/structured-zone-ops";
import type { CardDefinition, Effect, GameState } from "../src";

const ALICE = "player-1";
const BOB = "player-2";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const NON_TOKEN_HOST: CardDefinition = {
  cardNo: "TEST-BSES01-T01-NON-TOKEN-HOST",
  name: "テストM1A4 ジャガーノート",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 4,
  reductionSymbols: ["white"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "動器",
  sourceUrls: [],
  sourceConfidence: "C",
};
const NON_MATCHING_HOST: CardDefinition = {
  ...NON_TOKEN_HOST,
  cardNo: "TEST-BSES01-T01-NON-MATCHING-HOST",
  name: "テスト別スピリット",
  tribe: "動器",
};

function card(no: string): CardDefinition {
  const found = cardNoMap.get(no);
  if (!found) throw new Error(`card not found: ${no}`);
  return found;
}

const getDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ??
  (id === NON_TOKEN_HOST.cardNo
    ? NON_TOKEN_HOST
    : id === NON_MATCHING_HOST.cardNo
      ? NON_MATCHING_HOST
      : undefined);
const noTriggerLookup = () => [];

const T01 = card("BSES01-T01");
const C02 = card("BSES01-C02");
const M02 = card("BSES01-M02");

function lockEffect(): Effect {
  const effect = T01.effects![1]!;
  if (effect.steps[0]?.action.kind !== "prevent_brave_separation") {
    throw new Error("BSES01-T01 prevent_brave_separation effect not found");
  }
  return effect;
}

function makeLockedBoard(): GameState {
  const host = {
    ...createCardInstance(T01, {
      instanceId: "juggernaut-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    }),
    attachedChildrenIds: ["eighty-six-brave"],
  };
  const otherHost = createCardInstance(T01, {
    instanceId: "juggernaut-other",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const brave = {
    ...createCardInstance(C02, {
      instanceId: "eighty-six-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    }),
    attachedToInstanceId: "juggernaut-host",
  };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, otherHost, brave],
      playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
    }),
    activePlayerId: ALICE,
    step: "main",
  };

  return executeEffect({
    chainId: "test:bses01-t01-brave-separation-lock:119",
    state,
    effect: lockEffect(),
    sourceInstanceId: "juggernaut-host",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

function makeLockedNonTokenBoard(
  hostInstanceId: string,
  braveInstanceId: string,
  hostCoreCount = 2,
  braveCoreCount = 0
): GameState {
  const host = {
    ...createCardInstance(NON_TOKEN_HOST, {
      instanceId: hostInstanceId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: hostCoreCount,
    }),
    attachedChildrenIds: [braveInstanceId],
  };
  const brave = {
    ...createCardInstance(C02, {
      instanceId: braveInstanceId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: braveCoreCount,
    }),
    attachedToInstanceId: hostInstanceId,
  };
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, brave],
  });
  return executeEffect({
    chainId: "test:bses01-t01-brave-separation-lock:160",
    state,
    effect: lockEffect(),
    sourceInstanceId: hostInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

function eventKindsFor(
  beforeState: GameState,
  afterState: GameState,
  instanceId: string
) {
  return collectTriggerEventsFromStateDelta({
    beforeState,
    afterState,
    source: "action_resolution",
    chainId: "test",
    causedByPlayerId: ALICE,
    getCardDefinitionById: getDef,
  })
    .filter((event) => event.relatedInstanceId === instanceId)
    .map((event) => event.eventKind);
}

describe("BSES01-T01 brave separation lock", () => {
  it("関連ブレイヴの召喚宣言で pre-cost 配置された直後にも分離不可 CE を登録する", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(M02, {
            instanceId: "eighty-six-brave-in-hand",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "hand",
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 8 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const summon = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
    }).find(
      (action) =>
        action.kind === "summon" &&
        action.sourceInstanceId === "eighty-six-brave-in-hand"
    );
    expect(summon).toBeDefined();

    const afterDeclaration = finishCoreChoices(
      applyLegalAction({
        state,
        action: summon!,
        paymentSources: [{ kind: "reserve", amount: 3 }],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredFieldCardEffectActions: noTriggerLookup,
      }).state,
      getDef
    );
    const token = afterDeclaration.cardInstances.find(
      (card) => card.definitionId === "BSES01-T01"
    );
    expect(token).toBeDefined();
    expect(
      afterDeclaration.activeContinuousEffects.some(
        (effect) =>
          effect.sourceInstanceId === token!.instanceId &&
          effect.modifierTag === "prevent_brave_separation" &&
          effect.provenance?.effectIndex === 1
      )
    ).toBe(true);
    expect(
      collectGameStateInvariantIssues(afterDeclaration, {
        getCardDefinitionById: getDef,
      }).filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("基本分離と交換の候補を出さず、直接 apply されても合体状態を維持する", () => {
    const locked = makeLockedBoard();
    const legalActions = getLegalActions({
      state: locked,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
    });

    expect(legalActions.some((a) => a.kind === "brave_separate")).toBe(false);
    expect(legalActions.some((a) => a.kind === "brave_swap")).toBe(false);

    const afterSeparate = applyLegalAction({
      state: locked,
      action: {
        kind: "brave_separate",
        actionId: "forged:separate",
        can: true,
        reason: "forged",
        actingPlayerId: ALICE,
        hostInstanceId: "juggernaut-host",
        braveInstanceId: "eighty-six-brave",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
    }).state;
    expect(
      afterSeparate.cardInstances.find(
        (c) => c.instanceId === "eighty-six-brave"
      )!.attachedToInstanceId
    ).toBe("juggernaut-host");

    const afterSwap = applyLegalAction({
      state: locked,
      action: {
        kind: "brave_swap",
        actionId: "forged:swap",
        can: true,
        reason: "forged",
        actingPlayerId: ALICE,
        fromHostInstanceId: "juggernaut-host",
        braveInstanceId: "eighty-six-brave",
        toHostInstanceId: "juggernaut-other",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noTriggerLookup,
    }).state;
    expect(
      afterSwap.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!
        .attachedToInstanceId
    ).toBe("juggernaut-host");
    expect(
      afterSwap.cardInstances.find((c) => c.instanceId === "juggernaut-host")!
        .attachedChildrenIds
    ).toContain("eighty-six-brave");
  });

  it("brave_separate_effect の事前選択経路でも分離しない", () => {
    const locked = makeLockedBoard();
    const separateEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "brave_separate_effect",
            target: {
              kind: "filter",
              player: "self",
              filter: { category: ["brave"] },
              count: 1,
            },
          },
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:324",
      state: locked,
      effect: separateEffect,
      sourceInstanceId: "juggernaut-host",
      actingPlayerId: ALICE,
      targetInstanceIds: ["eighty-six-brave"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const brave = after.cardInstances.find(
      (c) => c.instanceId === "eighty-six-brave"
    )!;
    expect(brave.attachedToInstanceId).toBe("juggernaut-host");
    expect(
      after.cardInstances.find((c) => c.instanceId === "juggernaut-host")!
        .attachedChildrenIds
    ).toContain("eighty-six-brave");
  });

  it("token ホストが bounce されると合体ブレイヴもトークンプール代替先へ同伴移動する", () => {
    const locked = makeLockedBoard();
    const handBefore = locked.players.find((p) => p.id === ALICE)!.handCount;

    const queued = executeBounce(
      locked,
      BOB,
      {
        kind: "bounce",
        target: { player: "opponent", category: ["spirit"], count: 1 },
      },
      getDef,
      "bob-source",
      ["juggernaut-host"]
    );
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "juggernaut-host"
    );
    const after = flushPendingLeaves(queued, getDef);

    const host = after.cardInstances.find(
      (c) => c.instanceId === "juggernaut-host"
    )!;
    const brave = after.cardInstances.find(
      (c) => c.instanceId === "eighty-six-brave"
    )!;
    expect(host.zone).toBe("removed_from_game");
    expect(brave.zone).toBe(host.zone);
    expect(brave.attachedToInstanceId).toBeNull();
    expect(host.attachedChildrenIds).toEqual([]);
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      handBefore
    );
  });

  it("同一 bounce が token host と合体ブレイヴを対象にしてもブレイヴを direct 移動しない", () => {
    const locked = makeLockedBoard();
    const handBefore = locked.players.find((p) => p.id === ALICE)!.handCount;

    const queued = executeBounce(
      locked,
      BOB,
      {
        kind: "bounce",
        target: {
          player: "opponent",
          category: ["spirit", "brave"],
          count: 2,
        },
      },
      getDef,
      "bob-source",
      ["juggernaut-host", "eighty-six-brave"]
    );

    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "juggernaut-host"
    );
    expect(
      queued.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!
        .zone
    ).toBe("field");
    expect(queued.players.find((p) => p.id === ALICE)!.handCount).toBe(
      handBefore
    );

    const after = flushPendingLeaves(queued, getDef);

    expect(
      after.cardInstances.find((c) => c.instanceId === "juggernaut-host")!.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!.zone
    ).toBe("removed_from_game");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      handBefore
    );
  });

  it("prevent_brave_separation host の bounce は pending leave 化だけでも ref_succeeded 後続を通す", () => {
    const locked = makeLockedBoard();

    const result = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:426",
      state: locked,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "bounce_locked_host",
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
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "bounce_locked_host",
            },
          },
        ],
      },
      sourceInstanceId: "bob-source",
      actingPlayerId: BOB,
      targetInstanceIds: ["juggernaut-host"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(result.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "juggernaut-host"
    );
    expect(result.players.find((p) => p.id === BOB)!.countValue).toBe(1);
  });

  it("非 token host の bounce ではブレイヴも手札へ同伴移動する", () => {
    const host = {
      ...createCardInstance(NON_TOKEN_HOST, {
        instanceId: "non-token-host",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      attachedChildrenIds: ["non-token-brave"],
    };
    const brave = {
      ...createCardInstance(C02, {
        instanceId: "non-token-brave",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
      }),
      attachedToInstanceId: "non-token-host",
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, brave],
    });
    const locked = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:491",
      state,
      effect: lockEffect(),
      sourceInstanceId: "non-token-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const handBefore = locked.players.find((p) => p.id === ALICE)!.handCount;

    const queued = executeBounce(
      locked,
      BOB,
      {
        kind: "bounce",
        target: { player: "opponent", category: ["spirit"], count: 1 },
      },
      getDef,
      "bob-source",
      ["non-token-host"]
    );
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "non-token-host"
    );
    const after = flushPendingLeaves(queued, getDef);

    expect(
      after.cardInstances.find((c) => c.instanceId === "non-token-host")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "non-token-brave")!.zone
    ).toBe("hand");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      handBefore + 2
    );
  });

  it("非 token host の move_card 直接移動でもブレイヴを同じ手札へ同伴移動する", () => {
    const host = {
      ...createCardInstance(NON_TOKEN_HOST, {
        instanceId: "move-card-host",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      attachedChildrenIds: ["move-card-brave"],
    };
    const brave = {
      ...createCardInstance(C02, {
        instanceId: "move-card-brave",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
      }),
      attachedToInstanceId: "move-card-host",
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, brave],
    });
    const locked = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:553",
      state,
      effect: lockEffect(),
      sourceInstanceId: "move-card-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const handBefore = locked.players.find((p) => p.id === ALICE)!.handCount;

    const queued = executeMoveCardPrimitive({
      state: locked,
      actingPlayerId: ALICE,
      sourceInstanceId: "move-card-host",
      getCardDefinitionById: getDef,
      action: {
        kind: "move_card",
        target: { kind: "self" },
        from: { zone: "field", player: "self" },
        to: { zone: "hand" },
        count: 1,
      },
    });
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "move-card-host"
    );
    const after = flushPendingLeaves(queued, getDef);

    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-host")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-brave")!.zone
    ).toBe("hand");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      handBefore + 2
    );
  });

  it("同一 move_card が token host と合体ブレイヴを deck 対象にしてもブレイヴを個別移動しない", () => {
    const locked = makeLockedBoard();
    const deckBefore = locked.players.find((p) => p.id === ALICE)!.deckCount;

    const queued = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:596",
      state: locked,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "brave"] },
                count: 2,
              },
              from: { zone: "field", player: "opponent" },
              to: { zone: "deck", position: "bottom" },
              count: 2,
            },
          },
        ],
      },
      sourceInstanceId: "bob-source",
      actingPlayerId: BOB,
      targetInstanceIds: ["juggernaut-host", "eighty-six-brave"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "juggernaut-host"
    );
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).not.toContain(
      "eighty-six-brave"
    );
    expect(
      queued.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!
        .zone
    ).toBe("field");
    expect(queued.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      deckBefore
    );

    const after = flushPendingLeaves(queued, getDef);

    expect(
      after.cardInstances.find((c) => c.instanceId === "juggernaut-host")!.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!.zone
    ).toBe("removed_from_game");
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      deckBefore
    );
  });

  it("同一 send_to_deck が token host と合体ブレイヴを対象にしてもブレイヴを個別 pending にしない", () => {
    const locked = makeLockedBoard();
    const deckBefore = locked.players.find((p) => p.id === ALICE)!.deckCount;

    const queued = executeSendToDeck(
      locked,
      BOB,
      {
        kind: "send_to_deck",
        target: {
          player: "opponent",
          category: ["spirit", "brave"],
          count: 2,
        },
        position: "bottom",
      },
      getDef,
      "bob-source",
      ["juggernaut-host", "eighty-six-brave"]
    );

    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "juggernaut-host"
    );
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).not.toContain(
      "eighty-six-brave"
    );
    expect(
      queued.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!
        .zone
    ).toBe("field");
    expect(queued.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      deckBefore
    );

    const after = flushPendingLeaves(queued, getDef);

    expect(
      after.cardInstances.find((c) => c.instanceId === "juggernaut-host")!.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!.zone
    ).toBe("removed_from_game");
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      deckBefore
    );
  });

  it("非 token host の move_self 場離脱でもブレイヴを同じ手札へ同伴移動する", () => {
    const host = {
      ...createCardInstance(NON_TOKEN_HOST, {
        instanceId: "move-self-host",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      attachedChildrenIds: ["move-self-brave"],
    };
    const brave = {
      ...createCardInstance(C02, {
        instanceId: "move-self-brave",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
      }),
      attachedToInstanceId: "move-self-host",
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, brave],
    });
    const locked = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:724",
      state,
      effect: lockEffect(),
      sourceInstanceId: "move-self-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const handBefore = locked.players.find((p) => p.id === ALICE)!.handCount;

    const queued = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:734",
      state: locked,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
      },
      sourceInstanceId: "move-self-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toContain(
      "move-self-host"
    );
    const after = flushPendingLeaves(queued, getDef);

    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-host")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-brave")!.zone
    ).toBe("hand");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      handBefore + 2
    );
  });

  it("非 token host の move_card field→trash は破壊扱いにせずブレイヴだけ同伴移動する", () => {
    const locked = makeLockedNonTokenBoard(
      "move-card-trash-host",
      "move-card-trash-brave",
      2,
      1
    );
    const reserveBefore = locked.players.find(
      (p) => p.id === ALICE
    )!.reserveNormalCoreCount;

    const queued = executeMoveCardPrimitive({
      state: locked,
      actingPlayerId: ALICE,
      sourceInstanceId: "move-card-trash-host",
      getCardDefinitionById: getDef,
      action: {
        kind: "move_card",
        target: { kind: "self" },
        from: { zone: "field", player: "self" },
        to: { zone: "trash" },
        count: 1,
      },
    });

    expect(queued.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: "move-card-trash-host",
        kind: "bounce",
        leaveDestination: { zone: "trash" },
      }),
    ]);
    const after = flushPendingLeaves(queued, getDef);
    expect(after.pendingLeaveEntities).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-trash-host")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-trash-brave")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-trash-brave")!
        .attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-trash-host")!
        .attachedChildrenIds
    ).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-trash-host")!
        .normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-card-trash-brave")!
        .normalCoreCount
    ).toBe(0);
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(reserveBefore + 3);

    const hostEvents = eventKindsFor(locked, after, "move-card-trash-host");
    expect(hostEvents).toContain("leave_field");
    expect(hostEvents).not.toContain("destroy");
  });

  it("token host の move_card field→trash はトークンプール代替先へブレイヴごと移動する", () => {
    const locked = makeLockedBoard();
    const reserveBefore = locked.players.find(
      (p) => p.id === ALICE
    )!.reserveNormalCoreCount;

    const queued = executeMoveCardPrimitive({
      state: locked,
      actingPlayerId: ALICE,
      sourceInstanceId: "juggernaut-host",
      getCardDefinitionById: getDef,
      action: {
        kind: "move_card",
        target: { kind: "self" },
        from: { zone: "field", player: "self" },
        to: { zone: "trash" },
        count: 1,
      },
    });

    expect(queued.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: "juggernaut-host",
        kind: "bounce",
        leaveDestination: { zone: "trash" },
      }),
    ]);
    const after = flushPendingLeaves(queued, getDef);
    expect(after.pendingLeaveEntities).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "juggernaut-host")!.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eighty-six-brave")!
        .attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "juggernaut-host")!
        .attachedChildrenIds
    ).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "juggernaut-host")!
        .normalCoreCount
    ).toBe(0);
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(reserveBefore + 3);

    const hostEvents = eventKindsFor(locked, after, "juggernaut-host");
    expect(hostEvents).toContain("leave_field");
    expect(hostEvents).not.toContain("destroy");
  });

  it("非 token host の move_self field→trash も破壊扱いにせずブレイヴだけ同伴移動する", () => {
    const locked = makeLockedNonTokenBoard(
      "move-self-trash-host",
      "move-self-trash-brave",
      2,
      1
    );
    const reserveBefore = locked.players.find(
      (p) => p.id === ALICE
    )!.reserveNormalCoreCount;

    const pending = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:895",
      state: locked,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "move_self", destination: "trash" } }],
      },
      sourceInstanceId: "move-self-trash-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const after = flushPendingLeaves(pending, getDef);
    expect(after.pendingLeaveEntities).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-trash-host")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-trash-brave")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-trash-brave")!
        .attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-trash-host")!
        .attachedChildrenIds
    ).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-trash-host")!
        .normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((c) => c.instanceId === "move-self-trash-brave")!
        .normalCoreCount
    ).toBe(0);
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(reserveBefore + 3);

    const hostEvents = eventKindsFor(locked, after, "move-self-trash-host");
    expect(hostEvents).toContain("leave_field");
    expect(hostEvents).not.toContain("destroy");
  });

  it("コア不足消滅の SBA vanish でもブレイヴ残存選択を出さず同伴移動する", () => {
    const locked = makeLockedNonTokenBoard(
      "core-deficit-host",
      "core-deficit-brave",
      1,
      0
    );
    const depleted: GameState = {
      ...locked,
      cardInstances: locked.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "core-deficit-host"
          ? { ...cardInstance, normalCoreCount: 0 }
          : cardInstance
      ),
    };

    const result = runStateBasedActions(depleted, getDef);

    expect(
      result.checks.some(
        (check) =>
          check.kind === "vanish_due_to_core_deficit" &&
          check.instanceId === "core-deficit-host"
      )
    ).toBe(true);
    const pendingLeave = result.state.pendingLeaveEntities.find(
      (pending) => pending.instanceId === "core-deficit-host"
    );
    expect(pendingLeave?.forceBraveSendWithHost).toBe(true);
    expect(result.state.pendingBraveLeaveChoice).toBeNull();

    const after = flushPendingLeaves(result.state, getDef);

    expect(after.pendingBraveLeaveChoice).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "core-deficit-host")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "core-deficit-brave")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "core-deficit-brave")!
        .attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "core-deficit-host")!
        .attachedChildrenIds
    ).toEqual([]);
  });

  it("アーツゲート喪失の SBA vanish でもブレイヴ残存選択を出さず同伴移動する", () => {
    const artsHost = {
      ...createCardInstance(card("BSLH01-T07"), {
        instanceId: "arts-gate-host",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "arts",
        normalCoreCount: 0,
      }),
      attachedChildrenIds: ["arts-gate-brave"],
    };
    const brave = {
      ...createCardInstance(C02, {
        instanceId: "arts-gate-brave",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
      }),
      attachedToInstanceId: "arts-gate-host",
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [artsHost, brave],
    });
    const locked = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:1019",
      state,
      effect: lockEffect(),
      sourceInstanceId: "arts-gate-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const result = runStateBasedActions(locked, getDef);

    expect(
      result.checks.some(
        (check) =>
          check.kind === "vanish_due_to_arts_gate_lost" &&
          check.instanceId === "arts-gate-host"
      )
    ).toBe(true);
    const pendingLeave = result.state.pendingLeaveEntities.find(
      (pending) => pending.instanceId === "arts-gate-host"
    );
    expect(pendingLeave?.forceBraveSendWithHost).toBe(true);
    expect(result.state.pendingBraveLeaveChoice).toBeNull();

    const after = flushPendingLeaves(result.state, getDef);

    expect(after.pendingBraveLeaveChoice).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "arts-gate-host")!.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((c) => c.instanceId === "arts-gate-brave")!.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((c) => c.instanceId === "arts-gate-brave")!
        .attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "arts-gate-host")!
        .attachedChildrenIds
    ).toEqual([]);
  });

  it("合体条件喪失による自動分離も prevent_brave_separation で止める", () => {
    const host = {
      ...createCardInstance(NON_MATCHING_HOST, {
        instanceId: "condition-lost-host",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      attachedChildrenIds: ["condition-lost-brave"],
    };
    const brave = {
      ...createCardInstance(C02, {
        instanceId: "condition-lost-brave",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
      }),
      attachedToInstanceId: "condition-lost-host",
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, brave],
    });
    const locked = executeEffect({
      chainId: "test:bses01-t01-brave-separation-lock:1087",
      state,
      effect: lockEffect(),
      sourceInstanceId: "condition-lost-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const result = runStateBasedActions(locked, getDef);

    expect(
      result.checks.some((check) => check.kind === "brave_forced_separation")
    ).toBe(false);
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "condition-lost-brave"
      )!.attachedToInstanceId
    ).toBe("condition-lost-host");
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "condition-lost-host"
      )!.attachedChildrenIds
    ).toContain("condition-lost-brave");
  });
});
