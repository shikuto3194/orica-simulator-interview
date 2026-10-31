/**
 * ENGINE-paid-prevention-immunity-card-cost Step2/3:
 * `grant_paid_prevention_immunity` の `cost.resource: "card"` variant
 * (BSKB01-X01「自分のトラッシュにある系統：「鋼騎士」を持つカード3枚を除外することで、
 * この効果は相手の効果では防げない」型) の legal-actions 層 afford 判定 + 支払い実行を検証する。
 *
 * Step3: 候補数が amount と一致するとき (選択不要、全候補確定除外) に加え、候補数が
 * amount を超えるとき (player がどの候補を除外するか選ぶ必要がある) も variant を offer
 * する。候補一覧は action の `paidPreventionImmunityCardCostCandidateInstanceIds` に
 * 載り、apply 時に `paidPreventionImmunityCardSelection` (候補の部分集合、
 * length===amount) を渡して確定する。省略/不正選択はエラーにする。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  playSummonAsAction,
  getLegalActions,
  applyLegalAction,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

const ALICE = "alice";
const BOB = "bob";

const CARD_COST_AMOUNT = 2;

const HOST_DEF: CardDefinition = {
  cardNo: "PPICC-HOST",
  name: "Paid Prevention Card Cost Host",
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
} as unknown as CardDefinition;

// ENGINE-paid-prevention-immunity-card-cost Step4: scope.effectIndex を持つ host。
// BSKB01-X01「この効果は相手の効果では防げない」= 直前の特定アビリティ1つのみ、を
// 模した最小フィクスチャ。effects[0]/effects[1] はともに summon 誘発だが、
// grant_paid_prevention_immunity は scope.effectIndex:0 で effects[0] のみに限定する。
const SCOPED_HOST_DEF: CardDefinition = {
  cardNo: "PPICC-SCOPED-HOST",
  name: "Paid Prevention Scoped Host",
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
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
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
            scope: { effectIndex: 0 },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    },
  ],
} as unknown as CardDefinition;

const ENEMY_DEF: CardDefinition = {
  cardNo: "PPICC-ENEMY",
  name: "Enemy Spirit",
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
} as unknown as CardDefinition;

const TRASH_FODDER_DEF: CardDefinition = {
  cardNo: "PPICC-FODDER",
  name: "鋼騎士のトラッシュ要員",
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
} as unknown as CardDefinition;

const OTHER_TRIBE_FODDER_DEF: CardDefinition = {
  cardNo: "PPICC-OTHER",
  name: "無関係トラッシュ要員",
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
  tribe: "無関係",
} as unknown as CardDefinition;

// cost.zone: "field" 用フィクスチャ (round1 verifier 反証: field 対価は
// executeRemoveFromGame 経由でないと cannot_be_removed_from_game 耐性をバイパスする)。
// host 自身は候補フィルタ (tribes:["鋼騎士"]) に自己一致しないよう別系統にする。
const FIELD_HOST_DEF: CardDefinition = {
  cardNo: "PPICC-FIELD-HOST",
  name: "Paid Prevention Field Cost Host",
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
  tribe: "無関係",
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
              amount: 1,
              zone: "field",
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
} as unknown as CardDefinition;

const FIELD_CANDIDATE_DEF: CardDefinition = {
  cardNo: "PPICC-FIELD-CANDIDATE",
  name: "鋼騎士のフィールド要員",
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
} as unknown as CardDefinition;

const DEFS = [
  HOST_DEF,
  SCOPED_HOST_DEF,
  ENEMY_DEF,
  TRASH_FODDER_DEF,
  OTHER_TRIBE_FODDER_DEF,
  FIELD_HOST_DEF,
  FIELD_CANDIDATE_DEF,
];
const cardNoMap = new Map(DEFS.map((d) => [d.cardNo, d]));
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(DEFS);

function passOpponentToCloseTriggeredStack(state: GameState): GameState {
  if (state.window !== "stack" || !state.stackWindow) {
    return state;
  }
  const opponentId = state.stackWindow.priorityPlayerId;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${opponentId}`,
      can: true,
      reason: "test_close",
      actingPlayerId: opponentId,
    },
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function resolveEnemyTargetIfPending(state: GameState): GameState {
  if (!state.pendingEffectTargetSelection) return state;
  const resolveTarget = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).find((a) => a.kind === "resolve_pending_effect_target");
  if (!resolveTarget) return state;
  return applyLegalAction({
    state,
    action: resolveTarget,
    targetInstanceIds: ["enemy-1"],
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function makeBaseState(
  trashFodderCount: number,
  wrongTribeCount = 0
): GameState {
  const fodderCards = Array.from({ length: trashFodderCount }, (_, i) =>
    createCardInstance(TRASH_FODDER_DEF, {
      instanceId: `fodder-${i}`,
      ownerPlayerId: ALICE,
      zone: "trash",
    })
  );
  const wrongTribeCards = Array.from({ length: wrongTribeCount }, (_, i) =>
    createCardInstance(OTHER_TRIBE_FODDER_DEF, {
      instanceId: `other-fodder-${i}`,
      ownerPlayerId: ALICE,
      zone: "trash",
    })
  );

  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(HOST_DEF, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
      createCardInstance(ENEMY_DEF, {
        instanceId: "enemy-1",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
      ...fodderCards,
      ...wrongTribeCards,
    ],
    playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      {
        effectId: "test-cannot_be_destroyed-enemy-1",
        sourceInstanceId: "test-source",
        sourceDefinitionId: "test",
        actingPlayerId: BOB,
        duration: { scope: "permanent" },
        createdAtTurn: 0,
        createdAtAttackId: null,
        modifierTag: "cannot_be_destroyed",
        targetInstanceId: "enemy-1",
        metadata: { source: "opponent_effect" },
      } as unknown as GameState["activeContinuousEffects"][number],
    ],
  };
}

function summonHost(state: GameState): GameState {
  return playSummonAsAction({
    state,
    actingPlayerId: ALICE,
    cardInstanceId: "host-1",
    paymentSources: [{ kind: "reserve", amount: 2 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function findPaidVariant(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.eventKind === "summon" &&
      a.payPreventionImmunityCost === true
  );
}

describe("grant_paid_prevention_immunity (resource: card) — legal-actions 宣言時対価支払い", () => {
  it("トラッシュの一致候補数が amount と一致するとき、支払う variant が提示される", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT));
    expect(findPaidVariant(summoned)).toBeDefined();
  });

  it("トラッシュの一致候補数が amount 未満のとき、支払う variant は提示されない", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT - 1));
    expect(findPaidVariant(summoned)).toBeUndefined();
  });

  it("トラッシュの一致候補数が amount を超えるとき、支払う variant が候補一覧付きで提示される", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT + 1));
    const paidVariant = findPaidVariant(summoned);
    expect(paidVariant).toBeDefined();
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (card) variant");
    }
    expect(paidVariant.paidPreventionImmunityCardCostAmount).toBe(
      CARD_COST_AMOUNT
    );
    expect(
      paidVariant.paidPreventionImmunityCardCostCandidateInstanceIds
    ).toHaveLength(CARD_COST_AMOUNT + 1);
  });

  it("候補数が amount を超えるとき、選択未指定で適用するとエラーになる", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT + 1));
    const paidVariant = findPaidVariant(summoned);
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (card) variant");
    }
    expect(() =>
      applyLegalAction({
        state: summoned,
        action: paidVariant,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toThrow(/explicit paidPreventionImmunityCardSelection is required/);
  });

  it("候補数が amount を超えるとき、選択枚数が amount と不一致だとエラーになる", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT + 1));
    const paidVariant = findPaidVariant(summoned);
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (card) variant");
    }
    const candidates =
      paidVariant.paidPreventionImmunityCardCostCandidateInstanceIds ?? [];
    expect(() =>
      applyLegalAction({
        state: summoned,
        action: paidVariant,
        paidPreventionImmunityCardSelection: candidates.slice(
          0,
          CARD_COST_AMOUNT - 1
        ),
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toThrow(/does not match required amount/);
  });

  it("候補数が amount を超えるとき、候補外のカードを選択するとエラーになる", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT + 1));
    const paidVariant = findPaidVariant(summoned);
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (card) variant");
    }
    const candidates =
      paidVariant.paidPreventionImmunityCardCostCandidateInstanceIds ?? [];
    expect(() =>
      applyLegalAction({
        state: summoned,
        action: paidVariant,
        // "enemy-1" はトラッシュ候補ではない (相手フィールドのカード)。
        paidPreventionImmunityCardSelection: [
          ...candidates.slice(0, CARD_COST_AMOUNT - 1),
          "enemy-1",
        ],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toThrow(/selected card is not a candidate: enemy-1/);
  });

  it("候補数が amount を超えるとき、player が選んだ amount 枚だけが除外される", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT + 1));
    const paidVariant = findPaidVariant(summoned);
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (card) variant");
    }
    const candidates =
      paidVariant.paidPreventionImmunityCardCostCandidateInstanceIds ?? [];
    const selection = candidates.slice(0, CARD_COST_AMOUNT);

    const applied = applyLegalAction({
      state: summoned,
      action: paidVariant,
      paidPreventionImmunityCardSelection: selection,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const removedFodder = applied.state.cardInstances.filter(
      (c) => c.definitionId === "PPICC-FODDER" && c.zone === "removed_from_game"
    );
    expect(removedFodder.map((c) => c.instanceId).sort()).toEqual(
      [...selection].sort()
    );
    const remainingFodder = applied.state.cardInstances.filter(
      (c) => c.definitionId === "PPICC-FODDER" && c.zone === "trash"
    );
    expect(remainingFodder).toHaveLength(1);
  });

  it("系統が一致しないカードは候補に数えない (無関係カードのみでは提示されない)", () => {
    const summoned = summonHost(makeBaseState(0, CARD_COST_AMOUNT));
    expect(findPaidVariant(summoned)).toBeUndefined();
  });

  it("支払う variant を適用すると、一致候補カードが removed_from_game へ移動し、cannot_be_destroyed を貫通して破壊される", () => {
    const summoned = summonHost(makeBaseState(CARD_COST_AMOUNT));
    const paidVariant = findPaidVariant(summoned);
    expect(paidVariant).toBeDefined();
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (card) variant");
    }

    const applied = applyLegalAction({
      state: summoned,
      action: paidVariant,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const removedFodder = applied.state.cardInstances.filter(
      (c) => c.definitionId === "PPICC-FODDER"
    );
    expect(removedFodder).toHaveLength(CARD_COST_AMOUNT);
    expect(removedFodder.every((c) => c.zone === "removed_from_game")).toBe(
      true
    );

    const drained = resolveEnemyTargetIfPending(
      passOpponentToCloseTriggeredStack(applied.state)
    );
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    const enemyLeftField =
      !enemy ||
      enemy.zone !== "field" ||
      drained.pendingLeaveEntities.some(
        (e) => e.instanceId === "enemy-1" && !e.blockedByResistance
      );
    expect(enemyLeftField).toBe(true);
  });
});

describe("grant_paid_prevention_immunity (resource: card, zone: field) — フィールド対価は executeRemoveFromGame 経由", () => {
  function makeFieldBaseState(candidateResistant: boolean): GameState {
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(FIELD_HOST_DEF, {
          instanceId: "field-host-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(FIELD_CANDIDATE_DEF, {
          instanceId: "field-candidate-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(ENEMY_DEF, {
          instanceId: "enemy-1",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });
    return {
      ...base,
      step: "main",
      activePlayerId: ALICE,
      activeContinuousEffects: candidateResistant
        ? [
            ...base.activeContinuousEffects,
            {
              effectId: "test-cannot_be_removed_from_game-field-candidate-1",
              sourceInstanceId: "test-source",
              sourceDefinitionId: "test",
              actingPlayerId: ALICE,
              duration: { scope: "permanent" },
              createdAtTurn: 0,
              createdAtAttackId: null,
              modifierTag: "cannot_be_removed_from_game",
              targetInstanceId: "field-candidate-1",
              metadata: { source: "all" },
            } as unknown as GameState["activeContinuousEffects"][number],
          ]
        : base.activeContinuousEffects,
    };
  }

  function summonFieldHost(state: GameState): GameState {
    return playSummonAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "field-host-1",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }

  function findFieldPaidVariant(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon" &&
        a.payPreventionImmunityCost === true
    );
  }

  it("耐性の無いフィールド候補は、対価支払いで removed_from_game へ移動する", () => {
    const summoned = summonFieldHost(makeFieldBaseState(false));
    const paidVariant = findFieldPaidVariant(summoned);
    expect(paidVariant).toBeDefined();
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (field) variant");
    }

    const applied = applyLegalAction({
      state: summoned,
      action: paidVariant,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const candidate = applied.state.cardInstances.find(
      (c) => c.instanceId === "field-candidate-1"
    );
    expect(candidate?.zone).toBe("removed_from_game");
  });

  it("cannot_be_removed_from_game 耐性を持つフィールド候補は、対価支払いで除外されない (executeRemoveFromGame の耐性ゲートが効く)", () => {
    const summoned = summonFieldHost(makeFieldBaseState(true));
    const paidVariant = findFieldPaidVariant(summoned);
    expect(paidVariant).toBeDefined();
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (field) variant");
    }

    const applied = applyLegalAction({
      state: summoned,
      action: paidVariant,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const candidate = applied.state.cardInstances.find(
      (c) => c.instanceId === "field-candidate-1"
    );
    expect(candidate?.zone).toBe("field");
  });
});

describe("grant_paid_prevention_immunity scope.effectIndex — 単一 effect スコープ (ENGINE-paid-prevention-immunity-card-cost Step4)", () => {
  function summonScopedHost(state: GameState): GameState {
    return playSummonAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "scoped-host-1",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }

  function makeScopedBaseState(trashFodderCount: number): GameState {
    const fodderCards = Array.from({ length: trashFodderCount }, (_, i) =>
      createCardInstance(TRASH_FODDER_DEF, {
        instanceId: `scoped-fodder-${i}`,
        ownerPlayerId: ALICE,
        zone: "trash",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(SCOPED_HOST_DEF, {
          instanceId: "scoped-host-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(ENEMY_DEF, {
          instanceId: "enemy-1",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
        ...fodderCards,
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });
    return {
      ...base,
      step: "main",
      activePlayerId: ALICE,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        {
          effectId: "test-cannot_be_destroyed-scoped-enemy-1",
          sourceInstanceId: "test-source",
          sourceDefinitionId: "test",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 0,
          createdAtAttackId: null,
          modifierTag: "cannot_be_destroyed",
          targetInstanceId: "enemy-1",
          metadata: { source: "opponent_effect" },
        } as unknown as GameState["activeContinuousEffects"][number],
      ],
    };
  }

  it("effects[0] (destroy) の pending には対価支払い variant が提示される", () => {
    const summoned = summonScopedHost(makeScopedBaseState(CARD_COST_AMOUNT));
    const variants = getLegalActions({
      state: summoned,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon" &&
        a.payPreventionImmunityCost === true
    );
    expect(variants).toHaveLength(1);
    if (variants[0]?.kind !== "resolve_pending_triggered_effect") {
      throw new Error("expected resolve_pending_triggered_effect");
    }
    expect(variants[0].registrationIndex).toBe(0);
  });

  it("effects[1] (count_increase、無関係な同時誘発) の pending には対価支払い variant が提示されない", () => {
    const summoned = summonScopedHost(makeScopedBaseState(CARD_COST_AMOUNT));
    const allSummonPending = getLegalActions({
      state: summoned,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon"
    );
    // registrationIndex:1 (count_increase) の variant 群には payPreventionImmunityCost が無い。
    const registrationIndex1Variants = allSummonPending.filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.registrationIndex === 1
    );
    expect(registrationIndex1Variants.length).toBeGreaterThan(0);
    expect(
      registrationIndex1Variants.every(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.payPreventionImmunityCost !== true
      )
    ).toBe(true);
  });

  it("effects[0] の支払い variant を apply すると、対価カードが除外され、cannot_be_destroyed を貫通して破壊される (apply 側 effectIndex 配線)", () => {
    const summoned = summonScopedHost(makeScopedBaseState(CARD_COST_AMOUNT));
    const paidVariant = getLegalActions({
      state: summoned,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon" &&
        a.payPreventionImmunityCost === true
    );
    if (
      !paidVariant ||
      paidVariant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected paid prevention immunity (scoped) variant");
    }
    expect(paidVariant.registrationIndex).toBe(0);

    const applied = applyLegalAction({
      state: summoned,
      action: paidVariant,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const removedFodder = applied.state.cardInstances.filter(
      (c) => c.definitionId === "PPICC-FODDER" && c.zone === "removed_from_game"
    );
    expect(removedFodder).toHaveLength(CARD_COST_AMOUNT);

    const drained = resolveEnemyTargetIfPending(
      passOpponentToCloseTriggeredStack(applied.state)
    );
    const enemy = drained.cardInstances.find((c) => c.instanceId === "enemy-1");
    const enemyLeftField =
      !enemy ||
      enemy.zone !== "field" ||
      drained.pendingLeaveEntities.some(
        (e) => e.instanceId === "enemy-1" && !e.blockedByResistance
      );
    expect(enemyLeftField).toBe(true);
  });

  it("scope 不一致の effectIndex (effects[1]) へ payPreventionImmunityCost:true を強制指定しても、apply 側は対価を支払わない", () => {
    const summoned = summonScopedHost(makeScopedBaseState(CARD_COST_AMOUNT));
    const unpaidEffect1Variant = getLegalActions({
      state: summoned,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "summon" &&
        a.registrationIndex === 1
    );
    if (
      !unpaidEffect1Variant ||
      unpaidEffect1Variant.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected effects[1] (count_increase) pending variant");
    }
    expect(unpaidEffect1Variant.payPreventionImmunityCost).not.toBe(true);

    // クライアントが payPreventionImmunityCost:true を無理に付与しても、apply 側は
    // effects[1] の registrationIndex に一致する scope 付き CE が無いため
    // (getPaidPreventionImmunityCost が scope 不一致で null を返す)、対価は支払われない。
    const forcedAction = {
      ...unpaidEffect1Variant,
      payPreventionImmunityCost: true as const,
    };
    const applied = applyLegalAction({
      state: summoned,
      action: forcedAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const removedFodder = applied.state.cardInstances.filter(
      (c) => c.definitionId === "PPICC-FODDER" && c.zone === "removed_from_game"
    );
    expect(removedFodder).toHaveLength(0);
  });
});
