/**
 * P3-75: 常駐・条件付き negate(opponent_burst) の実効化。
 *
 * BSTH09.2-転醒R03(B)「Lv1-Lv3『自分のアタックステップ』自分のカウント2以上のとき、
 * 相手のバースト効果を無効にする」を表現する継続無効化の検証。
 *
 * - 発動条件 (カウント2以上) は effect.condition (recompute add/remove) で動的に add/remove。
 * - 発動スコープ (自分のアタックステップ) は CE.timingScope を消費時 isCEActiveForScope で評価。
 * - duration: while_on_field (常駐、ターン満了で消えない)。
 *
 * 後方互換: timingScope 無しの negate(opponent_burst) (BSTH07「このターンの間」) は常に有効。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  isBurstEffectNullifiedByOpponent,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, GameState, RegisteredBurstAction } from "../src";

const cardMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardMap.get(id);

/** BSTH09.2-転醒R03(B) と同型の常駐・条件付きバースト無効化スピリット。 */
const NEGATOR: CardDefinition = {
  cardNo: "TEST-COND-BURST-NEGATOR",
  name: "TEST-COND-BURST-NEGATOR",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["red"],
  textLines: [
    "『自分のアタックステップ』自分のカウント2以上のとき、相手のバースト効果を無効にする。",
  ],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  tribe: "起幻",
  effects: [
    {
      timing: { kind: "continuous" },
      timingScope: { player: "self", period: "attack" },
      condition: [{ kind: "count_value", player: "self", min: 2 }],
      steps: [
        {
          action: {
            kind: "negate",
            negateTarget: "opponent_burst",
            duration: { scope: "while_on_field" },
          },
        },
      ],
    },
  ],
};

const LOW_COST_BURST: CardDefinition = {
  cardNo: "TEST-BURST-COST6",
  name: "TEST-BURST-COST6",
  printedCategory: "magic",
  colors: ["red"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["【バースト：自分のライフ減少後】"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const HIGH_COST_BURST: CardDefinition = {
  ...LOW_COST_BURST,
  cardNo: "TEST-BURST-COST7",
  name: "TEST-BURST-COST7",
  cost: 7,
};

/** 印字5だが additional_cost でコスト7として扱うバースト。 */
const TAXED_COST_BURST: CardDefinition = {
  ...LOW_COST_BURST,
  cardNo: "TEST-BURST-COST5-TAXED-TO7",
  name: "TEST-BURST-COST5-TAXED-TO7",
  cost: 5,
};

const KIGEN_ATTACKER: CardDefinition = {
  cardNo: "TEST-KIGEN-ATTACKER",
  name: "TEST-KIGEN-ATTACKER",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: ["系統：「起幻」を持つスピリット。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  tribe: "起幻",
  effects: [],
};

const lookup = (id: string) =>
  id === NEGATOR.cardNo
    ? NEGATOR
    : id === LOW_COST_BURST.cardNo
      ? LOW_COST_BURST
      : id === HIGH_COST_BURST.cardNo
        ? HIGH_COST_BURST
        : id === TAXED_COST_BURST.cardNo
          ? TAXED_COST_BURST
          : id === KIGEN_ATTACKER.cardNo
            ? KIGEN_ATTACKER
            : getCardDefinitionById(id);

const getRegisteredBurstActions = (
  cardNo: string
): readonly RegisteredBurstAction[] | undefined =>
  cardNo === LOW_COST_BURST.cardNo ||
  cardNo === HIGH_COST_BURST.cardNo ||
  cardNo === TAXED_COST_BURST.cardNo
    ? [{ sourceKind: "magic", eventKind: "reduce_life" }]
    : undefined;

const getHandWrittenEffectResolver = (cardNo: string) =>
  cardNo === LOW_COST_BURST.cardNo ||
  cardNo === HIGH_COST_BURST.cardNo ||
  cardNo === TAXED_COST_BURST.cardNo
    ? (state: GameState) => ({
        ...state,
        log: [...state.log, `test-burst-resolved:${cardNo}`],
      })
    : undefined;

function scenario(opts: {
  countValue: number;
  activePlayerId: string;
  step: GameState["step"];
}): GameState {
  const base = createEmptyGameState({ playerIds: ["bob", "alice"] });
  return {
    ...base,
    activePlayerId: opts.activePlayerId,
    step: opts.step,
    players: base.players.map((p) =>
      p.id === "bob" ? { ...p, countValue: opts.countValue } : p
    ),
    cardInstances: [
      createCardInstance(NEGATOR, {
        instanceId: "negator",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

function hasNegateCE(state: GameState): boolean {
  return state.activeContinuousEffects.some(
    (c) =>
      c.modifierTag === "negate_opponent_burst" && c.actingPlayerId === "bob"
  );
}

function bsth09FrontTargetFilterScenario(
  burstDef: CardDefinition,
  burstInstanceId: string
): GameState {
  const front = getCardDefinitionById("BSTH09.2-転醒R03(A)")!;
  const base = createEmptyGameState({ playerIds: ["bob", "alice"] });
  return recomputeAndRebuildContinuousEffects(
    {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [
        createCardInstance(front, {
          instanceId: "gensokyo",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(KIGEN_ATTACKER, {
          instanceId: "kigen-attacker",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(burstDef, {
          instanceId: burstInstanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      battleEntities: [
        {
          entityId: "battle-kigen-attacker",
          memberInstanceIds: ["kigen-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: burstInstanceId }],
      pendingBurstChecks: [
        {
          checkId: `burst-check-${burstInstanceId}`,
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          event: { family: "life", validationMode: "snapshot_only" },
          source: "action_resolution",
          chainId: "test:p3-75-continuous-conditional-negate-burst:205",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    },
    lookup
  );
}

function resolveOnlyBurst(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions,
  }).find((a) => a.kind === "resolve_pending_burst_check");
  expect(action).toBeDefined();
  let current = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver,
  }).state;
  while (current.window === "stack" && current.stackWindow !== null) {
    const passAction = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow.priorityPlayerId,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions,
    }).find((a) => a.kind === "pass_stack") ?? {
      kind: "pass_stack" as const,
      actionId: `pass:${current.stackWindow.priorityPlayerId}`,
      can: true as const,
      reason: "test_close",
      actingPlayerId: current.stackWindow.priorityPlayerId,
    };
    current = applyLegalAction({
      state: current,
      action: passAction,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;
  }
  return current;
}

describe("P3-75: 常駐・条件付き negate(opponent_burst)", () => {
  it("カウント2以上 ∧ 自分のアタックステップ → CE 登録 ∧ 相手バースト無効", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({ countValue: 2, activePlayerId: "bob", step: "attack" }),
      lookup
    );
    expect(hasNegateCE(state)).toBe(true);
    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst", "alice")
    ).toBe(true);
  });

  it("カウント1 → effect.condition 不成立で CE 未登録 ∧ 無効化されない", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({ countValue: 1, activePlayerId: "bob", step: "attack" }),
      lookup
    );
    expect(hasNegateCE(state)).toBe(false);
    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst", "alice")
    ).toBe(false);
  });

  it("カウント2以上でも自分のアタックステップ外 (相手ターン) → timingScope 不活性で無効化されない", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({ countValue: 2, activePlayerId: "alice", step: "attack" }),
      lookup
    );
    // CE 自体は登録される (condition 成立) が、timingScope (自分のアタック) が不活性。
    expect(hasNegateCE(state)).toBe(true);
    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst", "alice")
    ).toBe(false);
  });

  it("カウント2以上・自分ターンでもアタックステップでない (main) → 無効化されない", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({ countValue: 2, activePlayerId: "bob", step: "main" }),
      lookup
    );
    expect(hasNegateCE(state)).toBe(true);
    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst", "alice")
    ).toBe(false);
  });

  it("カウントが 2→1 に減ると recompute で CE が除去される", () => {
    const active = recomputeAndRebuildContinuousEffects(
      scenario({ countValue: 2, activePlayerId: "bob", step: "attack" }),
      lookup
    );
    expect(hasNegateCE(active)).toBe(true);

    const dropped = recomputeAndRebuildContinuousEffects(
      {
        ...active,
        players: active.players.map((p) =>
          p.id === "bob" ? { ...p, countValue: 1 } : p
        ),
      },
      lookup
    );
    expect(hasNegateCE(dropped)).toBe(false);
  });

  it("targetFilter 付き opponent_burst は条件に合うバーストだけ無効化する", () => {
    const low = createCardInstance(LOW_COST_BURST, {
      instanceId: "alice-burst-cost6",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const high = createCardInstance(HIGH_COST_BURST, {
      instanceId: "alice-burst-cost7",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["bob", "alice"],
        cardInstances: [low, high],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-filtered-burst-negate",
          sourceInstanceId: "negator",
          sourceDefinitionId: NEGATOR.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "negate_opponent_burst",
          forceLevel: "prohibition",
          metadata: {
            burstSuppressKind: "nullify",
            targetFilter: { maxCost: 6 },
          },
        },
      ],
    };

    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst-cost6", "alice", {
        getCardDefinitionById: lookup,
      })
    ).toBe(true);
    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst-cost7", "alice", {
        getCardDefinitionById: lookup,
      })
    ).toBe(false);
  });

  it("BSTH09.2(A) の DSL 由来 targetFilter は pending burst 解決でコスト6以下だけ効果不発にする", () => {
    const lowState = bsth09FrontTargetFilterScenario(
      LOW_COST_BURST,
      "alice-burst-cost6"
    );
    const ce = lowState.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "negate_opponent_burst" &&
        c.sourceDefinitionId === "BSTH09.2-転醒R03(A)"
    );
    expect(ce?.metadata).toMatchObject({
      burstSuppressKind: "nullify",
      targetFilter: { maxCost: 6 },
    });

    const lowResolved = resolveOnlyBurst(lowState);
    expect(
      lowResolved.log.some((l) =>
        l.includes("burst:effect-suppressed:burst-check-alice-burst-cost6")
      )
    ).toBe(true);
    expect(lowResolved.log.some((l) => l.includes("test-burst-resolved"))).toBe(
      false
    );

    const highResolved = resolveOnlyBurst(
      bsth09FrontTargetFilterScenario(HIGH_COST_BURST, "alice-burst-cost7")
    );
    expect(
      highResolved.log.some((l) =>
        l.includes("burst:effect-suppressed:burst-check-alice-burst-cost7")
      )
    ).toBe(false);
    expect(
      highResolved.log.some((l) =>
        l.includes(`test-burst-resolved:${HIGH_COST_BURST.cardNo}`)
      )
    ).toBe(true);
  });

  it("BSTH09.2(A) のコスト6以下判定は additional_cost を含む候補コストで照合する", () => {
    const base = bsth09FrontTargetFilterScenario(
      TAXED_COST_BURST,
      "alice-burst-cost5-taxed-to7"
    );
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        {
          effectId: "ce-burst-additional-cost-seven",
          sourceInstanceId: "test-cost-source",
          sourceDefinitionId: "TEST-COST-SOURCE",
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "additional_cost",
          targetInstanceId: "alice-burst-cost5-taxed-to7",
          modifierAmount: 7,
          metadata: {},
        },
      ],
    };

    expect(
      isBurstEffectNullifiedByOpponent(
        state,
        "alice-burst-cost5-taxed-to7",
        "alice",
        { getCardDefinitionById: lookup }
      )
    ).toBe(true);

    const resolved = resolveOnlyBurst(state);
    expect(
      resolved.log.some((l) =>
        l.includes(
          "burst:effect-suppressed:burst-check-alice-burst-cost5-taxed-to7"
        )
      )
    ).toBe(true);
    expect(
      resolved.log.some((l) =>
        l.includes(`test-burst-resolved:${TAXED_COST_BURST.cardNo}`)
      )
    ).toBe(false);
  });

  it("cannot_activate 判定では nullify CE による効果無効を発動不可として扱わない", () => {
    const low = createCardInstance(LOW_COST_BURST, {
      instanceId: "alice-burst-cost6",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["bob", "alice"],
        cardInstances: [low],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-unmatched-cannot-activate",
          sourceInstanceId: "negator-a",
          sourceDefinitionId: NEGATOR.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "negate_opponent_burst",
          forceLevel: "prohibition",
          metadata: {
            burstSuppressKind: "cannot_activate",
            targetFilter: { maxCost: 0 },
          },
        },
        {
          effectId: "ce-matched-nullify",
          sourceInstanceId: "negator-b",
          sourceDefinitionId: NEGATOR.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "negate_opponent_burst",
          forceLevel: "prohibition",
          metadata: {
            burstSuppressKind: "nullify",
            targetFilter: { maxCost: 6 },
          },
        },
      ],
    };

    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst-cost6", "alice", {
        getCardDefinitionById: lookup,
        requiredBurstSuppressKind: "cannot_activate",
      })
    ).toBe(false);
    expect(
      isBurstEffectNullifiedByOpponent(state, "alice-burst-cost6", "alice", {
        getCardDefinitionById: lookup,
      })
    ).toBe(true);
  });

  it("card-data: BSTH09.2-転醒R03(B) [5,6] が stub 無しで negate(opponent_burst) を持つ", () => {
    const front = getCardDefinitionById("BSTH09.2-転醒R03(A)")!;
    const back = front.backFace!;
    const eff = (back.effects ?? []).find(
      (e) => e.textRef?.[0] === 5 && e.textRef?.[1] === 6
    )!;
    expect(eff.stub).toBeUndefined();
    expect(
      eff.steps.some(
        (s) =>
          s.action.kind === "negate" &&
          s.action.negateTarget === "opponent_burst"
      )
    ).toBe(true);
  });

  it("card-data: BSTH09.2-転醒R03(A) [6,7] はコスト6以下バースト限定 negate を持つ", () => {
    const front = getCardDefinitionById("BSTH09.2-転醒R03(A)")!;
    const eff = (front.effects ?? []).find(
      (e) => e.textRef?.[0] === 6 && e.textRef?.[1] === 7
    )!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timingScope).toEqual({ player: "self", period: "attack" });
    expect(eff.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      category: ["spirit", "ultimate"],
      tribes: ["起幻"],
      battleState: "attacking",
    });
    const negate = eff.steps[0]!.action;
    expect(negate).toMatchObject({
      kind: "negate",
      negateTarget: "opponent_burst",
      targetFilter: { maxCost: 6 },
      duration: { scope: "while_on_field" },
    });
  });

  it("card-data: BSTH07-転醒X01(A) [0] の negate(opponent_burst) stub は除去済み", () => {
    const def = getCardDefinitionById("BSTH07-転醒X01(A)")!;
    const eff = (def.effects ?? []).find(
      (e) => e.textRef?.[0] === 0 && e.textRef?.[1] === 1
    )!;
    expect(eff.stub).toBeUndefined();
  });
});
