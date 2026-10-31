import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  ContinuousEffect,
  EffectCoreLocation,
  GameState,
} from "../src";
import type { Effect } from "../src/dsl-types";

const SOURCE_DEF: CardDefinition = {
  cardNo: "TEST-EXPLICIT-SOUL-SOURCE",
  name: "明示ソウルコア移動源",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>([
  [SOURCE_DEF.cardNo, SOURCE_DEF],
  ["BS57-011", SOURCE_DEF],
]);

function getDef(cardNo: string): CardDefinition | undefined {
  return defs.get(cardNo);
}

function sourceCard(instanceId: string, normalCoreCount = 0) {
  return createCardInstance(SOURCE_DEF, {
    instanceId,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount,
  });
}

function coreMoveEffect(
  from: EffectCoreLocation,
  to: EffectCoreLocation,
  amount: 1 | "all" = 1
): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "core_move",
          from,
          to,
          amount,
          effectKind: "explicit_soul_core",
        },
      },
    ],
  };
}

function coreMoveThenCountEffect(
  from: EffectCoreLocation,
  to: EffectCoreLocation
): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        id: "move-explicit-soul",
        action: {
          kind: "core_move",
          from,
          to,
          amount: 1,
          effectKind: "explicit_soul_core",
        },
      },
      {
        action: { kind: "count_increase", player: "self", amount: 1 },
        stepCondition: {
          kind: "ref_succeeded",
          stepId: "move-explicit-soul",
        },
      },
    ],
  };
}

function soulCoreSelfEffectImmunityCE(): ContinuousEffect {
  return {
    effectId: "test-soul-core-effect-immunity",
    sourceInstanceId: "bs57-source",
    sourceDefinitionId: "BS57-011",
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "soul_core_effect_immunity",
    targetInstanceId: "alice",
    metadata: { sourcePlayerScope: "self" },
  };
}

function cardEffectImmunityCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: "test-card-effect-immunity",
    sourceInstanceId: "alice-immunity-source",
    sourceDefinitionId: SOURCE_DEF.cardNo,
    actingPlayerId: "alice",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
  };
}

function coreMinimumCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: "test-core-minimum",
    sourceInstanceId: "core-min-source",
    sourceDefinitionId: SOURCE_DEF.cardNo,
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cannot_reduce_cores_below",
    targetInstanceId,
    metadata: { source: "all", coreMinimum: 1 },
  };
}

function lifeTurnCapCE(): ContinuousEffect {
  return {
    effectId: "test-life-turn-cap",
    sourceInstanceId: "alice-cap-source",
    sourceDefinitionId: SOURCE_DEF.cardNo,
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "life_damage_interception",
    targetInstanceId: "alice",
    metadata: { cause: "any", mode: "turn_cap", cap: 1 },
  };
}

function lifeDiscardGateCE(sourceInstanceId: string): ContinuousEffect {
  return {
    effectId: "test-life-discard-gate",
    sourceInstanceId,
    sourceDefinitionId: SOURCE_DEF.cardNo,
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "life_damage_interception",
    targetInstanceId: "alice",
    metadata: {
      cause: "any",
      mode: "replace",
      discardCostGate: { zones: ["hand"] },
    },
  };
}

function execute(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId: "test:explicit-soul-core-move-gate:181",
    state,
    effect,
    sourceInstanceId: "source-1",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

describe("explicit_soul_core core_move gate", () => {
  it("field(includeReserve)→trash はリザーブのソウルコアだけを動かし通常コアを動かさない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [sourceCard("source-1")],
      playerOverrides: [
        {
          reserveNormalCoreCount: 3,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "field", player: "self", includeReserve: true },
        { kind: "trash", player: "self" }
      )
    );

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(alice.reserveNormalCoreCount).toBe(3);
    expect(alice.trashNormalCoreCount).toBe(0);
  });

  it("Q8962型耐性中の field(includeReserve)→trash はソウルコアも通常コアも動かさない", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [sourceCard("source-1")],
        playerOverrides: [
          {
            reserveNormalCoreCount: 3,
            soulCoreLocation: { kind: "reserve" },
          },
          {},
        ],
      }),
      activeContinuousEffects: [soulCoreSelfEffectImmunityCE()],
    };

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "field", player: "self", includeReserve: true },
        { kind: "trash", player: "self" }
      )
    );

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(alice.reserveNormalCoreCount).toBe(3);
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(
      result.log.some((l) => l.includes("blocked-by-soul-core-immunity"))
    ).toBe(true);
  });

  it("recomputeContinuousEffects 後も Q8962型の player-scoped CE は保持される", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [sourceCard("source-1")],
        playerOverrides: [
          {
            reserveNormalCoreCount: 3,
            soulCoreLocation: { kind: "reserve" },
          },
          {},
        ],
      }),
      activeContinuousEffects: [soulCoreSelfEffectImmunityCE()],
    };

    const recomputed = recomputeContinuousEffects(state);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "soul_core_effect_immunity"
      )
    ).toBe(true);

    const result = execute(
      recomputed,
      coreMoveEffect(
        { kind: "reserve", player: "self" },
        { kind: "trash", player: "self" }
      )
    );

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(
      result.log.some((l) => l.includes("blocked-by-soul-core-immunity"))
    ).toBe(true);
  });

  it("Q8962型耐性中の life→trash は通常ライフコアへフォールバックしない", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [sourceCard("source-1")],
        playerOverrides: [
          {
            lifeNormalCoreCount: 3,
            soulCoreLocation: { kind: "life" },
          },
          {},
        ],
      }),
      activeContinuousEffects: [soulCoreSelfEffectImmunityCE()],
    };

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "life", player: "self" },
        { kind: "trash", player: "self" }
      )
    );

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({ kind: "life" });
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(alice.trashNormalCoreCount).toBe(0);
  });

  it("field→trash にソウルコアが無ければ通常コアも動かさない", () => {
    const target = sourceCard("field-normal-source", 2);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [sourceCard("source-1"), target],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "field", player: "self" },
        { kind: "trash", player: "self" }
      )
    );

    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "field-normal-source"
    )!;
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(targetAfter.normalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(0);
  });

  it("Q8964: ソウルコアが載るカードが耐性付与効果を受けないなら移動できる", () => {
    const target = sourceCard("field-soul-source", 1);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [sourceCard("source-1"), target],
        playerOverrides: [
          {
            soulCoreLocation: {
              kind: "card",
              instanceId: "field-soul-source",
            },
          },
          {},
        ],
      }),
      activeContinuousEffects: [
        soulCoreSelfEffectImmunityCE(),
        cardEffectImmunityCE("field-soul-source"),
      ],
    };

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "field", player: "self" },
        { kind: "trash", player: "self" }
      )
    );

    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "field-soul-source"
    )!;
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(targetAfter.soulCoreCount).toBe(0);
    expect(targetAfter.normalCoreCount).toBe(1);
  });

  it("reserve→this_card は count-only の追加ソウルを動かし primary pointer を温存する", () => {
    const primary = sourceCard("primary-soul-card", 1);
    const destination = sourceCard("source-1", 1);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [primary, destination],
      playerOverrides: [
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: "primary-soul-card",
          },
          reserveSoulCoreCount: 1,
        },
        {},
      ],
    });

    const result = execute(
      state,
      coreMoveEffect({ kind: "reserve", player: "self" }, { kind: "this_card" })
    );

    const primaryAfter = result.cardInstances.find(
      (c) => c.instanceId === "primary-soul-card"
    )!;
    const destinationAfter = result.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "primary-soul-card",
    });
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(primaryAfter.soulCoreCount).toBe(1);
    expect(destinationAfter.soulCoreCount).toBe(1);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("reserve→this_card は宛先カードの owner が違っても controller が自分なら置ける", () => {
    const destination = createCardInstance(SOURCE_DEF, {
      instanceId: "source-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [destination],
      playerOverrides: [
        {
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const result = execute(
      state,
      coreMoveEffect({ kind: "reserve", player: "self" }, { kind: "this_card" })
    );

    const destinationAfter = result.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(destinationAfter.soulCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "source-1",
    });
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("reserve→this_card amount:all は count-only の追加ソウルを全数動かす", () => {
    const primary = sourceCard("primary-soul-card", 1);
    const destination = sourceCard("source-1", 1);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [primary, destination],
      playerOverrides: [
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: "primary-soul-card",
          },
          reserveSoulCoreCount: 2,
        },
        {},
      ],
    });

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "reserve", player: "self" },
        { kind: "this_card" },
        "all"
      )
    );

    const alice = result.players.find((p) => p.id === "alice")!;
    const destinationAfter = result.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "primary-soul-card",
    });
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(destinationAfter.soulCoreCount).toBe(2);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("field→this_card amount:all は cannot_reduce_cores_below の下限分を残す", () => {
    const source = sourceCard("field-soul-source", 0);
    source.soulCoreCount = 2;
    const destination = sourceCard("source-1", 1);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, destination],
        playerOverrides: [
          {
            soulCoreLocation: {
              kind: "card",
              instanceId: "field-soul-source",
            },
          },
          {},
        ],
      }),
      activeContinuousEffects: [coreMinimumCE("field-soul-source")],
    };

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "field", player: "self" },
        { kind: "this_card" },
        "all"
      )
    );

    const sourceAfter = result.cardInstances.find(
      (c) => c.instanceId === "field-soul-source"
    )!;
    const destinationAfter = result.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    expect(sourceAfter.soulCoreCount).toBe(1);
    expect(destinationAfter.soulCoreCount).toBe(1);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("life→this_card amount:all は life_damage_interception の turn_cap を通る", () => {
    const destination = sourceCard("source-1", 1);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [destination],
        playerOverrides: [
          {
            soulCoreLocation: { kind: "reserve" },
            reserveSoulCoreCount: 1,
            lifeSoulCoreCount: 2,
          },
          {},
        ],
      }),
      activeContinuousEffects: [lifeTurnCapCE()],
    };

    const result = execute(
      state,
      coreMoveEffect(
        { kind: "life", player: "self" },
        { kind: "this_card" },
        "all"
      )
    );

    const alice = result.players.find((p) => p.id === "alice")!;
    const destinationAfter = result.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    expect(alice.lifeSoulCoreCount).toBe(1);
    expect(destinationAfter.soulCoreCount).toBe(1);
    expect(result.log).toContain(
      "effect:life_damage_interception:turn_cap:alice:cap=1:cumulative=0:blocked=1"
    );
    expect(result.lifeReductionCappedThisTurn?.alice).toBe(1);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("count-only の追加ソウル移動は ref_succeeded から成功として参照できる", () => {
    const primary = sourceCard("primary-soul-card", 1);
    const destination = sourceCard("source-1", 1);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [primary, destination],
      playerOverrides: [
        {
          countValue: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "primary-soul-card",
          },
          reserveSoulCoreCount: 1,
        },
        {},
      ],
    });

    const result = execute(
      state,
      coreMoveThenCountEffect(
        { kind: "reserve", player: "self" },
        { kind: "this_card" }
      )
    );

    const alice = result.players.find((p) => p.id === "alice")!;
    const destinationAfter = result.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    expect(alice.countValue).toBe(1);
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(destinationAfter.soulCoreCount).toBe(1);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("life_damage_discard pending を挟んだ explicit_soul_core も ref_succeeded から成功として参照できる", () => {
    const destination = sourceCard("source-1", 1);
    const discardGateCard = createCardInstance(SOURCE_DEF, {
      instanceId: "life-discard-gate-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [destination, discardGateCard],
        playerOverrides: [
          {
            countValue: 0,
            soulCoreLocation: { kind: "reserve" },
            reserveSoulCoreCount: 1,
            lifeSoulCoreCount: 1,
          },
          {},
        ],
      }),
      activeContinuousEffects: [lifeDiscardGateCE(discardGateCard.instanceId)],
    };

    const pending = execute(
      state,
      coreMoveThenCountEffect(
        { kind: "life", player: "self" },
        { kind: "this_card" }
      )
    );
    expect(pending.pendingLifeDamageDiscardChoice).not.toBeNull();

    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_life_damage_discard_choice")!;
    const result = applyLegalAction({
      state: pending,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      lifeDamageDiscardChoice: "decline",
    }).state;

    const alice = result.players.find((p) => p.id === "alice")!;
    const destinationAfter = result.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;
    expect(alice.countValue).toBe(1);
    expect(alice.lifeSoulCoreCount).toBe(0);
    expect(destinationAfter.soulCoreCount).toBe(1);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });
});
