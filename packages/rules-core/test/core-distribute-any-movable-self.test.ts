/**
 * P3-47 F-5: core_distribute mode="player_choice" + from="any_movable_self" のテスト。
 *
 * 自分の通常移動可能な全ゾーン (reserve / trash / life / 自分 field カード) を
 * ソースとする multi-source 配分。`PendingCoreDistribution.allowedSources` /
 * `sourceAvailable` を正しく構築し、apply で `coreDistributionSourceAllocations`
 * を per-source 減算に反映するか検証する。
 *
 * - reserve / trash / life / 自分 field カードを allowedSources に正しく列挙
 * - 創界神ネクサス (grandwalkerData) は field source から除外
 * - sourceAvailable 合計 = totalNormalCores
 * - apply の per-source 減算: reserve / trash / life player counter + field card
 *   normalCoreCount に正しく反映される
 * - sourceAllocations 合計 ≠ recipient 合計 → エラー
 * - 不正なソースキー → エラー
 * - sourceAllocation > sourceAvailable → エラー
 * - mode≠"player_choice" → no-op (any_movable_self は player_choice 専用)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffectTag,
  GameState,
  GrandwalkerData,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "紅魔",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 0,
  });
  return { ...base, ...overrides };
}

function makeState(
  cards: CardInstance[],
  aliceCounters: {
    reserve?: number;
    trash?: number;
    life?: number;
  } = {}
): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
  return {
    ...state,
    // ライフを配分元から除外するライフ0の盤面は、敗北防止下で配分を検証する。
    activeContinuousEffects:
      aliceCounters.life === 0
        ? [
            {
              effectId: "distribution-fixture-loss-immunity",
              sourceInstanceId: cards[0]?.instanceId ?? "fixture",
              sourceDefinitionId: cards[0]?.definitionId ?? "TEST-001",
              actingPlayerId: "alice",
              targetInstanceId: "alice",
              modifierTag: "immune_to_game_loss",
              duration: { scope: "turn" },
              createdAtTurn: state.turnNumber,
              createdAtAttackId: null,
            },
          ]
        : [],
    players: state.players.map((p) =>
      p.id === "alice"
        ? {
            ...p,
            reserveNormalCoreCount: aliceCounters.reserve ?? 0,
            trashNormalCoreCount: aliceCounters.trash ?? 0,
            lifeNormalCoreCount: aliceCounters.life ?? 5,
          }
        : p
    ),
  };
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

const grandwalkerStub: GrandwalkerData = {
  kind: "grandwalker",
  oracleTriggerKinds: ["summon"] as const,
  oracleConditions: [],
};

const playerChoiceFromAnyMovable: Effect = {
  timing: { kind: "phase", step: "main", subPhase: "start" },
  steps: [
    {
      action: {
        kind: "core_distribute",
        from: { kind: "any_movable_self" },
        to: {
          kind: "filter",
          player: "self",
          filter: { tribes: ["token"] },
          count: "all",
        },
        amount: "all",
        mode: "player_choice",
        minTotal: 1,
      },
    },
  ],
};

describe("P3-47 F-5: core_distribute from=any_movable_self", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("reserve / trash / life / 自分 field カードを allowedSources に列挙し、合計を totalNormalCores に反映", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const fieldDef = makeDef({ cardNo: "FLD" });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(fieldDef);
    const host = makeInstance(hostDef, {
      instanceId: "host",
      normalCoreCount: 2,
    });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const tok2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const tok3 = makeInstance(tokenDef, { instanceId: "tok3" });
    const fieldCard = makeInstance(fieldDef, {
      instanceId: "fld",
      normalCoreCount: 3,
    });
    const state = makeState([host, tok1, tok2, tok3, fieldCard], {
      reserve: 4,
      trash: 1,
      life: 5,
    });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:173",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    const pending = result.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("any_movable");
    expect(pending.minTotal).toBe(1);
    // reserve(4) + trash(1) + life(5) + host(2) + fld(3) = 15
    expect(pending.totalNormalCores).toBe(15);
    expect(pending.allowedSources).toBeDefined();
    const sourceKeys = (pending.allowedSources ?? []).map((s) =>
      s.kind === "field" ? `field:${s.instanceId}` : s.kind
    );
    expect(sourceKeys.sort()).toEqual(
      ["field:fld", "field:host", "life", "reserve", "trash"].sort()
    );
    expect(pending.sourceAvailable).toEqual({
      reserve: 4,
      trash: 1,
      life: 5,
      "field:host": 2,
      "field:fld": 3,
    });
    expect(pending.targetTotalSelection).toEqual({
      mode: "target_totals_then_core_owner_sources",
      targetChooserPlayerId: "alice",
      sourceOwnerPlayerId: "alice",
    });
  });

  it("創界神ネクサスは field source から除外", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const grandwalkerDef = makeDef({
      cardNo: "GW",
      printedCategory: "nexus",
      grandwalkerData: grandwalkerStub,
    });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(grandwalkerDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const gw = makeInstance(grandwalkerDef, {
      instanceId: "gw",
      normalCoreCount: 5,
    });
    const state = makeState([host, tok1, gw], { reserve: 2 });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:227",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const pending = result.pendingCoreDistribution!;
    const sourceKeys = (pending.allowedSources ?? []).map((s) =>
      s.kind === "field" ? `field:${s.instanceId}` : s.kind
    );
    expect(sourceKeys).not.toContain("field:gw");
    // reserve(2) + life(5) のみ (trash=0, host コア 0)
    expect(pending.totalNormalCores).toBe(7);
  });

  it("相手の field カードはソース対象外", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const enemyDef = makeDef({ cardNo: "ENEMY" });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(enemyDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const enemy = createCardInstance(enemyDef, {
      ownerPlayerId: "bob",
      zone: "field",
      cores: 4,
    });
    const state = makeState([host, tok1, enemy], { reserve: 1 });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:260",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const pending = result.pendingCoreDistribution!;
    const sourceKeys = (pending.allowedSources ?? []).map((s) =>
      s.kind === "field" ? `field:${s.instanceId}` : s.kind
    );
    expect(sourceKeys).not.toContain(`field:${enemy.instanceId}`);
  });

  it("apply で per-source 減算: reserve / trash / life / field カードに正しく反映", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, {
      instanceId: "host",
      normalCoreCount: 3,
    });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const tok2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const tok3 = makeInstance(tokenDef, { instanceId: "tok3" });
    const state = makeState([host, tok1, tok2, tok3], {
      reserve: 2,
      trash: 1,
      life: 4,
    });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:293",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    // reserve=2 + trash=1 + life=1 + field:host=2 = 6 → tok1=2, tok2=2, tok3=2
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { tok1: 2, tok2: 2, tok3: 2 },
      coreDistributionSourceAllocations: {
        reserve: 2,
        trash: 1,
        life: 1,
        "field:host": 2,
      },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const alice = applied.state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.lifeNormalCoreCount).toBe(3); // 4 - 1
    const hostAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "host"
    )!;
    expect(hostAfter.normalCoreCount).toBe(1); // 3 - 2
    expect(hostAfter.everHadCorePlaced).toBe(false);
    for (const id of ["tok1", "tok2", "tok3"]) {
      const token = applied.state.cardInstances.find(
        (c) => c.instanceId === id
      )!;
      expect(token.normalCoreCount).toBe(2);
      expect(token.everHadCorePlaced).toBe(true);
    }
  });

  it("二段階選択では維持する候補を対象開示せず、実際に置く候補だけを開示する", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const responderDef = makeDef({
      cardNo: "RESPONDER",
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "targeted",
            player: "self",
            cause: ["self_effect"],
          },
          executionMode: "optional",
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
    });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(responderDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const retained = makeInstance(tokenDef, {
      instanceId: "retained",
      normalCoreCount: 1,
    });
    const placed = makeInstance(tokenDef, { instanceId: "placed" });
    const responder = makeInstance(responderDef, { instanceId: "responder" });
    const triggeredLookup = buildTriggeredEffectLookup([responderDef]);
    const pendingState = executeEffect({
      chainId: "test:core-distribute-any-movable-self:374",
      state: makeState([host, retained, placed, responder], {
        reserve: 1,
        trash: 0,
      }),
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const firstAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    if (
      !firstAction ||
      firstAction.kind !== "resolve_pending_core_distribution"
    ) {
      throw new Error("expected target-total choice");
    }

    const sourceChoiceState = applyLegalAction({
      state: pendingState,
      action: firstAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      coreDistributionAllocations: { retained: 1, placed: 1 },
    }).state;
    expect(sourceChoiceState.pendingCoreDistribution).not.toBeNull();
    expect(sourceChoiceState.pendingTargetedDisclosureContinuation).toBeNull();

    const sourceAction = getLegalActions({
      state: sourceChoiceState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    if (
      !sourceAction ||
      sourceAction.kind !== "resolve_pending_core_distribution"
    ) {
      throw new Error("expected physical source choice");
    }
    const disclosed = applyLegalAction({
      state: sourceChoiceState,
      action: sourceAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      coreDistributionAllocations: { placed: 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;
    expect(
      disclosed.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["placed"]);
    expect(disclosed.pendingTriggeredEffects).toHaveLength(1);
  });

  it("二段階選択後の対象 redirect は置き換え先へ物理配分を確定する", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const retained = makeInstance(tokenDef, {
      instanceId: "retained",
      normalCoreCount: 1,
    });
    const placed = makeInstance(tokenDef, { instanceId: "placed" });
    const replacement = makeInstance(tokenDef, { instanceId: "replacement" });
    const pendingState = executeEffect({
      chainId: "test:core-distribute-any-movable-self:446",
      state: makeState([host, retained, placed, replacement], {
        reserve: 1,
        trash: 0,
      }),
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const firstAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    if (
      !firstAction ||
      firstAction.kind !== "resolve_pending_core_distribution"
    ) {
      throw new Error("expected target-total choice");
    }
    const sourceChoiceState = applyLegalAction({
      state: pendingState,
      action: firstAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { retained: 1, placed: 1 },
    }).state;
    const redirectReadyState: GameState = {
      ...sourceChoiceState,
      activeContinuousEffects: [
        {
          effectId: "redirect-placed",
          sourceInstanceId: "host",
          sourceDefinitionId: hostDef.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "redirect_effect_target" as ContinuousEffectTag,
          metadata: {
            triggerCondition: {
              sourcePlayerRef: "any",
              protectedTargetKind: "instances",
              protectedInstanceIds: ["placed"],
            },
            redirectCandidateSource: {
              kind: "explicit",
              instanceIds: ["replacement"],
            },
            optional: true,
          },
        },
      ],
      pendingCoreDistribution: {
        ...sourceChoiceState.pendingCoreDistribution!,
        targetInterruption: {
          ...sourceChoiceState.pendingCoreDistribution!.targetInterruption!,
          targetedDisclosureResolved: true,
        },
      },
    };
    const sourceAction = getLegalActions({
      state: redirectReadyState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    if (
      !sourceAction ||
      sourceAction.kind !== "resolve_pending_core_distribution"
    ) {
      throw new Error("expected physical source choice");
    }
    const redirectPrompt = applyLegalAction({
      state: redirectReadyState,
      action: sourceAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { placed: 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;
    const redirectAction = getLegalActions({
      state: redirectPrompt,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "confirm_target_redirect");
    if (!redirectAction || redirectAction.kind !== "confirm_target_redirect") {
      throw new Error("expected target redirect confirmation");
    }
    const redirected = applyLegalAction({
      state: redirectPrompt,
      action: redirectAction,
      getCardDefinitionById: getDef,
      redirectTargetReplacementInstanceId: "replacement",
    }).state;
    expect(redirected.pendingCoreDistribution).toBeNull();
    expect(
      redirected.cardInstances.find((card) => card.instanceId === "placed")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      redirected.cardInstances.find((card) => card.instanceId === "replacement")
        ?.normalCoreCount
    ).toBe(1);
  });

  it("sourceAllocations 合計 ≠ recipient 合計 → エラー", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, tok1], { reserve: 3, life: 2 });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:559",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { tok1: 2 },
        coreDistributionSourceAllocations: { reserve: 3 }, // 3 ≠ 2
      })
    ).toThrow(/source total .* does not match recipient total/);
  });

  it("不正なソースキー (allowedSources にない) → エラー", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, tok1], { reserve: 3 });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:596",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { tok1: 1 },
        coreDistributionSourceAllocations: { "field:host": 1 }, // host にコア 0
      })
    ).toThrow(/not in allowedSources/);
  });

  it("sourceAllocation が sourceAvailable を超過 → エラー", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, tok1], { reserve: 2 });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:633",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { tok1: 5 },
        coreDistributionSourceAllocations: { reserve: 5 }, // 5 > 2
      })
    ).toThrow(/exceeds available 2/);
  });

  it("field source と recipient が同一カードだけなら no-op なので pending を生成しない", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, {
      instanceId: "tok1",
      normalCoreCount: 1,
    });
    const state = makeState([host, tok1], {
      reserve: 0,
      trash: 0,
      life: 0,
    });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:677",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(result.pendingCoreDistribution).toBeNull();

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(
      actions.some((a) => a.kind === "resolve_pending_core_distribution")
    ).toBe(false);
  });

  it("field 上のソウルコア source と recipient が同一カードだけなら pending を生成しない", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, {
      instanceId: "tok1",
      soulCoreCount: 1,
    });
    const base = makeState([host, tok1], {
      reserve: 0,
      trash: 0,
      life: 0,
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulCoreLocation: { kind: "card", instanceId: "tok1" } }
          : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:720",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
  });

  it("field 上のソウルコアは同一カードへ配置指定できない", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, {
      instanceId: "tok1",
      soulCoreCount: 1,
    });
    const tok2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const base = makeState([host, tok1, tok2], {
      reserve: 1,
      trash: 0,
      life: 0,
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulCoreLocation: { kind: "card", instanceId: "tok1" } }
          : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:756",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.hasSoulCore).toBe(true);

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: {},
        coreDistributionSoulCoreInstanceId: "tok1",
      })
    ).toThrow(/cannot satisfy soul recipient allocations/);
  });

  it("mode='even' (player_choice 以外) で from=any_movable_self は no-op", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, tok1], { reserve: 3 });

    const evenEffect: Effect = {
      timing: { kind: "phase", step: "main", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "any_movable_self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: 2,
            // mode 省略 = "even"
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:815",
      state,
      effect: evenEffect,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(3);
    expect(
      result.cardInstances.find((c) => c.instanceId === "tok1")!.normalCoreCount
    ).toBe(0);
  });

  // フランドール【フォーオブアカインド】: ソウルコアがトラッシュにある状態で
  // 「自分のコア1個以上をそれらのカードに置く」。トラッシュのソウルコアも「自分のコア」
  // としてカード(疑似スピリット)に置ける (06_core-system.md:36,75-79)。
  // 旧バグ: builder が hasSoulCore=false 固定 + 完了が any_movable のソウル配置を例外で拒否し、
  // GUI でトラッシュのソウルコアを掴めなかった。
  function withSoulInTrash(state: GameState): GameState {
    return {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulCoreLocation: { kind: "trash" as const } }
          : p
      ),
    };
  }

  it("トラッシュのソウルコアがあれば pending.hasSoulCore=true になる", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = withSoulInTrash(
      makeState([host, tok1], { reserve: 3, trash: 2, life: 0 })
    );

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:858",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const pending = result.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("any_movable");
    expect(pending.hasSoulCore).toBe(true);
    expect(pending.totalSoulCores).toBe(1);
    expect(pending.soulSourceAvailable).toEqual({ trash: 1 });
  });

  it("トラッシュのソウルコアを候補カードに置ける (通常コアと併用)", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = withSoulInTrash(
      makeState([host, tok1], { reserve: 2, trash: 0, life: 0 })
    );

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:884",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { tok1: 2 },
      coreDistributionSourceAllocations: { reserve: 2 },
      coreDistributionSoulCoreInstanceId: "tok1",
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const alice = applied.state.players.find((p) => p.id === "alice")!;
    // ソウルコアは候補カードへ移動。
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "tok1",
    });
    expect(
      applied.state.cardInstances.find((c) => c.instanceId === "tok1")!
        .normalCoreCount
    ).toBe(2);
    expect(
      applied.state.cardInstances.find((c) => c.instanceId === "tok1")!
        .everHadCorePlaced
    ).toBe(true);
  });

  it("ソウルコアのみ (通常コア0) でも minTotal=1 を満たして配置できる", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    // 通常コアは 0 だがトラッシュにソウルコアがある → ソウル単独で minTotal=1 を満たす。
    const state = withSoulInTrash(
      makeState([host, tok1], { reserve: 0, trash: 0, life: 0 })
    );

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:938",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    // 通常コア 0 でも soul があるため pending が立つ。
    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.hasSoulCore).toBe(true);

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: {},
      coreDistributionSoulCoreInstanceId: "tok1",
    });
    const alice = applied.state.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "tok1",
    });
    const tok1After = applied.state.cardInstances.find(
      (c) => c.instanceId === "tok1"
    )!;
    expect(tok1After.normalCoreCount).toBe(0);
    expect(tok1After.everHadCorePlaced).toBe(true);
  });

  it("複数ソウルコアを any_movable の source 別に取得して候補カードへ配分できる", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const sourceDef = makeDef({ cardNo: "SRC" });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(sourceDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, {
      instanceId: "tok1",
      everHadCorePlaced: false,
    });
    const tok2 = makeInstance(tokenDef, {
      instanceId: "tok2",
      everHadCorePlaced: false,
    });
    const fieldSource = makeInstance(sourceDef, {
      instanceId: "field-source",
      soulCoreCount: 1,
    });
    const base = makeState([host, tok1, tok2, fieldSource], {
      reserve: 0,
      trash: 0,
      life: 0,
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveSoulCoreCount: 2,
              soulCoreLocation: {
                kind: "card" as const,
                instanceId: "field-source",
              },
            }
          : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:1017",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const pending = result.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("any_movable");
    expect(pending.totalNormalCores).toBe(0);
    expect(pending.hasSoulCore).toBe(true);
    expect(pending.totalSoulCores).toBe(3);
    expect(pending.soulSourceAvailable).toEqual({
      reserve: 2,
      "field:field-source": 1,
    });

    const cdAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    if (!cdAction || cdAction.kind !== "resolve_pending_core_distribution") {
      throw new Error("expected core distribution action");
    }
    expect(cdAction.totalSoulCores).toBe(3);
    expect(cdAction.soulSourceAvailable).toEqual({
      reserve: 2,
      "field:field-source": 1,
    });

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: {},
      coreDistributionSoulCoreAllocations: { tok1: 2, tok2: 1 },
      coreDistributionSoulCoreSourceAllocations: {
        reserve: 2,
        "field:field-source": 1,
      },
    });

    const alice = applied.state.players.find((p) => p.id === "alice")!;
    const srcAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "field-source"
    )!;
    const tok1After = applied.state.cardInstances.find(
      (c) => c.instanceId === "tok1"
    )!;
    const tok2After = applied.state.cardInstances.find(
      (c) => c.instanceId === "tok2"
    )!;
    expect(applied.state.pendingCoreDistribution).toBeNull();
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "tok2",
    });
    expect(srcAfter.soulCoreCount).toBe(0);
    expect(tok1After.soulCoreCount).toBe(2);
    expect(tok1After.everHadCorePlaced).toBe(true);
    expect(tok2After.soulCoreCount).toBe(1);
    expect(tok2After.everHadCorePlaced).toBe(true);
  });

  it("利用可能合計 < minTotal (any_movable 全合計でも不足) → pending 生成せず", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const tok1 = makeInstance(tokenDef, { instanceId: "tok1" });
    // reserve=0, trash=0, life=0, field=0 → 全合計 0 < minTotal=1
    const state = makeState([host, tok1], {
      reserve: 0,
      trash: 0,
      life: 0,
    });

    const result = executeEffect({
      chainId: "test:core-distribute-any-movable-self:1098",
      state,
      effect: playerChoiceFromAnyMovable,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
  });
});
