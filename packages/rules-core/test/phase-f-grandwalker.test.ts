import { describe, it, expect } from "vitest";
import {
  buildTriggeredEffectLookup,
  createEmptyGameState,
  createCardInstance,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
} from "../src";
import {
  isGrandwalkerOrGuidedNexus,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type GrandwalkerData,
  type PlayerState,
  type TriggeredMechanic,
} from "../src/model";
import { getEnterFieldCorePlacementRule } from "../src/zone/enter-field-placement-policy";
import {
  matchesOracleCondition,
  matchesAnyOracleCondition,
  checkAndQueueOracleChoices,
  checkAndQueueOracleChoicesForTriggerBatch,
  checkAndQueuePlacementOracle,
  resolvePlacementOracleMechanic,
  wouldQueueOracleChoices,
} from "../src/mechanics/oracle-system";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { matchesCardFilter } from "../src/card/card-filter";
import {
  evaluateCondition,
  executeDestroy,
  executeDivineTransform,
} from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  isBattleCapableCategory,
  getEffectiveBp,
  getEffectiveSymbols,
} from "../src/battle/battle-shared";
import { ALL_CARDS } from "../../card-data/src/generated-index";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

/** P3-92: 誘発キューから oracle mechanic pending を取り出す。 */
function oraclePendings(state: GameState): Array<{
  pendingId: string;
  mechanic: Extract<TriggeredMechanic, { kind: "oracle" }>;
}> {
  return state.pendingTriggeredEffects.flatMap((p) =>
    p.mechanic?.kind === "oracle"
      ? [
          {
            pendingId: p.pendingId,
            mechanic: p.mechanic as Extract<
              TriggeredMechanic,
              { kind: "oracle" }
            >,
          },
        ]
      : []
  );
}

/**
 * oracle mechanic pending を legal action 経由で解決する（accept=false で辞退）。
 * 受諾=発揮宣言はスタック窓を開く（02:186）ため、responder のパスで窓を閉じて
 * deferred 解決まで進める。辞退は窓を開かず同期（02:199）。
 */
function resolveOracleMechanicPending(
  state: GameState,
  pendingId: string,
  accept: boolean
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
  const action = actions.find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" && a.pendingId === pendingId
  );
  expect(action, `resolve action for ${pendingId}`).toBeDefined();
  const result = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getCardDef,
    ...(accept ? {} : { skipOptionalEffect: true }),
  });
  const applied = (result as { state: GameState }).state;
  if (!accept) {
    expect(applied.stackWindow).toBeNull();
    return applied;
  }
  expect(applied.stackWindow).not.toBeNull();
  return passStackUntilClosed(applied);
}

/** 開いたスタック窓を responder のパスで閉じ、deferred 解決まで進める。
 *  triggeredLookup を渡すと finalize 経由の collectAndQueueTriggerReactions に流す。 */
function passStackUntilClosed(
  state: GameState,
  triggeredLookup?: (
    cardNo: string
  ) => readonly import("../src").RegisteredTriggeredEffectAction[] | undefined
): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getCardDef,
      // スタック窓中の能動選択肢列挙が field 効果 lookup を要求するため空 stub を渡す
      getRegisteredFieldCardEffectActions: () => [],
      ...(triggeredLookup
        ? { getRegisteredTriggeredEffectActions: triggeredLookup }
        : {}),
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find((a) => a.kind === "pass_stack");
    expect(pass, `pass_stack for ${responderId}`).toBeDefined();
    current = (
      applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getCardDef,
        ...(triggeredLookup
          ? { getRegisteredTriggeredEffectActions: triggeredLookup }
          : {}),
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

function resolveRebirthPostChoiceCorePlacement(
  state: GameState,
  instanceId: string,
  options: {
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
    triggeredLookup?: (
      cardNo: string
    ) =>
      | readonly import("../src").RegisteredTriggeredEffectAction[]
      | undefined;
    amount?: number;
  } = {}
): GameState {
  const getDefinition = options.getCardDefinitionById ?? getCardDef;
  let current = state;

  if (current.pendingStoneFlipCombine !== null) {
    const pending = current.pendingStoneFlipCombine;
    expect(pending.braveInstanceId).toBe(instanceId);
    const actions = getLegalActions({
      state: current,
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById: getDefinition,
      getRegisteredFieldCardEffectActions: () => [],
      ...(options.triggeredLookup
        ? { getRegisteredTriggeredEffectActions: options.triggeredLookup }
        : {}),
    } as Parameters<typeof getLegalActions>[0]);
    const coreRoute = actions.find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.braveInstanceId === instanceId &&
        a.chosenHostInstanceId === null
    );
    expect(coreRoute, `core route for ${instanceId}`).toBeDefined();
    current = (
      applyLegalAction({
        state: current,
        action: coreRoute!,
        getCardDefinitionById: getDefinition,
        ...(options.triggeredLookup
          ? { getRegisteredTriggeredEffectActions: options.triggeredLookup }
          : {}),
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }

  const pending = current.pendingCoreDistribution;
  expect(pending, `core distribution for ${instanceId}`).not.toBeNull();
  expect(pending!.candidates.map((c) => c.instanceId)).toContain(instanceId);
  const amount = Math.max(options.amount ?? 1, pending!.minTotal ?? 0);
  const actions = getLegalActions({
    state: current,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById: getDefinition,
    ...(options.triggeredLookup
      ? { getRegisteredTriggeredEffectActions: options.triggeredLookup }
      : {}),
  } as Parameters<typeof getLegalActions>[0]);
  const resolve = actions.find(
    (a) => a.kind === "resolve_pending_core_distribution"
  );
  expect(resolve, `resolve core distribution for ${instanceId}`).toBeDefined();

  return (
    applyLegalAction({
      state: current,
      action: resolve!,
      getCardDefinitionById: getDefinition,
      coreDistributionAllocations: { [instanceId]: amount },
      ...(pending!.fromKind === "any_movable"
        ? { coreDistributionSourceAllocations: { reserve: amount } }
        : {}),
      ...(options.triggeredLookup
        ? { getRegisteredTriggeredEffectActions: options.triggeredLookup }
        : {}),
    } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
  ).state;
}

function grandwalkerNexusDef(
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo: "GW-001",
    name: "[創界神]テスト",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 3, bp: 0 },
    ],
    symbolColors: ["god"],
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
    sourceConfidence: "A",
    ...overrides,
  } as CardDefinition;
}

function guidedNexusDef(
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo: "GN-001",
    name: "[導界者]テスト",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: ["guide"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["guide"],
    textLines: [],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as const,
      oracleConditions: [
        { tribes: ["CB"], categories: ["spirit"], minCost: 3 },
      ],
    },
    sourceUrls: [],
    sourceConfidence: "A",
    ...overrides,
  } as CardDefinition;
}

function normalNexusDef(): CardDefinition {
  return {
    cardNo: "NEXUS-001",
    name: "Normal Nexus",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

function spiritDef(): CardDefinition {
  return {
    cardNo: "SP-001",
    name: "Test Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 神託条件にマッチする系統「夜錆」スピリット */
function oracleMatchSpiritDef(): CardDefinition {
  return {
    cardNo: "OMS-001",
    name: "夜錆スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "夜錆",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 神託条件にマッチしない系統のスピリット */
function oracleNonMatchSpiritDef(): CardDefinition {
  return {
    cardNo: "ONM-001",
    name: "無関係スピリット",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    tribe: "異合",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 導託条件にマッチする系統「CB」コスト3+スピリット */
function guidedOracleMatchSpiritDef(): CardDefinition {
  return {
    cardNo: "GOM-001",
    name: "CBスピリット",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "CB",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 導託条件の minCost 不足スピリット */
function guidedOracleLowCostSpiritDef(): CardDefinition {
  return {
    cardNo: "GLC-001",
    name: "CBスピリット低コスト",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "CB",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 神技付き創界神ネクサス */
function grandwalkerWithSkillsDef(): CardDefinition {
  return {
    cardNo: "GWS-001",
    name: "[創界神]神技テスト",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["god"],
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
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 2,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
        },
        {
          label: "divine_skill",
          coreCost: 4,
          timing: "flash",
          minLevel: 2,
        },
        {
          label: "divine_release",
          coreCost: 3,
          timing: "main",
        },
      ],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 転神付き創界神ネクサス（アシハラ系統） */
function grandwalkerWithTransformDef(): CardDefinition {
  return {
    cardNo: "GWT-001",
    name: "[創界神]転神テスト",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 2,
    reductionSymbols: ["green"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as const,
      oracleConditions: [{ tribes: ["アシハラ"] }],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 5,
          timing: { step: "attack", whose: "own" },
          minLevel: 1,
          maxLevel: 2,
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "divine_transform",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        category: ["nexus"],
                        tribes: ["アシハラ"],
                        targetsGrandwalker: true,
                      },
                      count: "all",
                    },
                    bpByLevel: [
                      { level: 1, bp: 3000 },
                      { level: 2, bp: 5000 },
                    ],
                    protectedFromNonGrandwalker: true,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "創界神・アシハラ",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/**
 * 自分自身の創界石コア（normalCoreCount）をボイドに送る発揮コスト + 自分自身を vanish する
 * 神技付き創界神ネクサス。ENGINE-external-rebirth-finalize の検証用に、deferred 解決後の
 * finalizeEffectResolution で pending leave が flush されることを単体で観測する。
 */
function grandwalkerWithSelfVanishSkillDef(): CardDefinition {
  return {
    cardNo: "GWSV-001",
    name: "[創界神]自己消滅神技テスト",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["god"],
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
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 1,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "vanish",
                    target: {
                      kind: "self",
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/**
 * 外部転醒 primitive を発揮する神技付き創界神ネクサス（rebirth.target / hasMechanic filter /
 * forceTriggerCondition）。BSSA01-XX01 神技4 の構造を縮約した形で、divine_skill stack →
 * 対象選択 → executeRebirth → finalizeEffectResolution の経路を踏ませる。
 */
function grandwalkerWithExternalRebirthSkillDef(): CardDefinition {
  return {
    cardNo: "GWER-001",
    name: "[創界神]外部転醒神技テスト",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["god"],
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
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 1,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              executionMode: "optional",
              steps: [
                {
                  action: {
                    kind: "rebirth",
                    maxCount: 5,
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        category: ["spirit", "brave", "nexus"],
                        hasMechanic: ["rebirth"],
                      },
                      count: 1,
                    },
                    forceTriggerCondition: true,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 対象選択を要する神技付き創界神ネクサス（vanish 相手スピリット1体）。 */
function grandwalkerWithTargetSkillDef(): CardDefinition {
  return {
    cardNo: "GWTS-001",
    name: "[創界神]対象神技テスト",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["god"],
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
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 2,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "vanish",
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
        },
      ],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
defMap.set("GW-001", grandwalkerNexusDef());
defMap.set("GWTS-001", grandwalkerWithTargetSkillDef());
defMap.set("GWSV-001", grandwalkerWithSelfVanishSkillDef());
defMap.set("GWER-001", grandwalkerWithExternalRebirthSkillDef());
defMap.set("GN-001", guidedNexusDef());
defMap.set("GWS-001", grandwalkerWithSkillsDef());
defMap.set("GWT-001", grandwalkerWithTransformDef());
defMap.set("NEXUS-001", normalNexusDef());
defMap.set("SP-001", spiritDef());
defMap.set("OMS-001", oracleMatchSpiritDef());
defMap.set("ONM-001", oracleNonMatchSpiritDef());
defMap.set("GOM-001", guidedOracleMatchSpiritDef());
defMap.set("GLC-001", guidedOracleLowCostSpiritDef());

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id) ?? REAL_DEF_MAP.get(id);
}

function fieldCard(
  instanceId: string,
  definitionId: string,
  owner = ALICE,
  cores = 0,
  opts: Partial<CardInstance> = {}
): CardInstance {
  const def = defMap.get(definitionId)!;
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createEmptyGameState({
      playerOverrides: [
        { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
        { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
      ],
    }),
    step: "main",
    window: "none",
    ...overrides,
  };
}

function additionalCostEffect(
  targetInstanceId: string,
  amount: number
): GameState["activeContinuousEffects"][number] {
  return {
    effectId: `test-additional-cost-${targetInstanceId}`,
    sourceInstanceId: "test-additional-cost-source",
    sourceDefinitionId: "TEST-ADDITIONAL-COST",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    targetInstanceId,
    modifierAmount: amount,
    metadata: {},
  };
}

// ── F-1: 創界神ネクサス基盤 ──────────────────────────────

describe("F-1: 創界神ネクサス基盤 (Grandwalker Nexus Foundation)", () => {
  // ── isGrandwalkerOrGuidedNexus ──

  describe("isGrandwalkerOrGuidedNexus", () => {
    it("創界神ネクサスを正しく識別する", () => {
      expect(isGrandwalkerOrGuidedNexus(grandwalkerNexusDef())).toBe(true);
    });

    it("導界者ネクサスを正しく識別する", () => {
      expect(isGrandwalkerOrGuidedNexus(guidedNexusDef())).toBe(true);
    });

    it("通常ネクサスは false", () => {
      expect(isGrandwalkerOrGuidedNexus(normalNexusDef())).toBe(false);
    });

    it("スピリットは false", () => {
      expect(isGrandwalkerOrGuidedNexus(spiritDef())).toBe(false);
    });

    it("grandwalkerData が undefined の場合 false", () => {
      expect(isGrandwalkerOrGuidedNexus({ grandwalkerData: undefined })).toBe(
        false
      );
    });
  });

  // ── 配置時コア不可 ──

  describe("配置時コア不可 (enter_field_core_placement_forbidden)", () => {
    it("創界神ネクサスの配置ルールは forbidden", () => {
      const rule = getEnterFieldCorePlacementRule(grandwalkerNexusDef());
      expect(rule).toBe("forbidden");
    });

    it("導界者ネクサスの配置ルールは forbidden", () => {
      const rule = getEnterFieldCorePlacementRule(guidedNexusDef());
      expect(rule).toBe("forbidden");
    });

    it("通常ネクサスの配置ルールは optional", () => {
      const rule = getEnterFieldCorePlacementRule(normalNexusDef());
      expect(rule).toBe("optional");
    });
  });

  // ── フィールド離脱時コア→ボイド ──

  describe("フィールド離脱時コア→ボイド", () => {
    it("創界神ネクサス破壊時、コアはボイドに移動する（リザーブではない）", () => {
      const gwCard = fieldCard("gw1", "GW-001", ALICE, 5, {
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-1",
      });
      const state = makeState({ cardInstances: [gwCard] });
      state.pendingLeaveEntities = [
        {
          instanceId: "gw1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain-1",
          deferZoneMoveUntilChainEnd: false,
        },
      ];

      const aliceBefore = getPlayer(state, ALICE);
      const voidBefore = aliceBefore.voidNormalCoreCount;
      const reserveBefore = aliceBefore.reserveNormalCoreCount;

      const next = flushPendingLeaves(state, getCardDef);

      const aliceAfter = getPlayer(next, ALICE);
      // コアはボイドに移動
      expect(aliceAfter.voidNormalCoreCount).toBe(voidBefore + 5);
      // リザーブは変化なし
      expect(aliceAfter.reserveNormalCoreCount).toBe(reserveBefore);
      // カードはトラッシュに移動
      expect(getCard(next, "gw1").zone).toBe("trash");
      expect(getCard(next, "gw1").normalCoreCount).toBe(0);
    });

    it("導界者ネクサス破壊時、コアはボイドに移動する", () => {
      const gnCard = fieldCard("gn1", "GN-001", ALICE, 3, {
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-2",
      });
      const state = makeState({ cardInstances: [gnCard] });
      state.pendingLeaveEntities = [
        {
          instanceId: "gn1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain-2",
          deferZoneMoveUntilChainEnd: false,
        },
      ];

      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;

      const next = flushPendingLeaves(state, getCardDef);

      expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore + 3);
      expect(getCard(next, "gn1").zone).toBe("trash");
    });

    it("通常ネクサス破壊時、コアはリザーブに移動する（従来通り）", () => {
      const nexusCard = fieldCard("n1", "NEXUS-001", ALICE, 4, {
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-3",
      });
      const state = makeState({ cardInstances: [nexusCard] });
      state.pendingLeaveEntities = [
        {
          instanceId: "n1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain-3",
          deferZoneMoveUntilChainEnd: false,
        },
      ];

      const reserveBefore = getPlayer(state, ALICE).reserveNormalCoreCount;
      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;

      const next = flushPendingLeaves(state, getCardDef);

      // コアはリザーブに移動（従来動作）
      expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(
        reserveBefore + 4
      );
      // ボイドは変化なし
      expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore);
    });

    it("スピリット破壊時、コアはリザーブに移動する（従来通り）", () => {
      const sp = fieldCard("sp1", "SP-001", ALICE, 2, {
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-4",
      });
      const state = makeState({ cardInstances: [sp] });
      state.pendingLeaveEntities = [
        {
          instanceId: "sp1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain-4",
          deferZoneMoveUntilChainEnd: false,
        },
      ];

      const reserveBefore = getPlayer(state, ALICE).reserveNormalCoreCount;

      const next = flushPendingLeaves(state, getCardDef);

      expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(
        reserveBefore + 2
      );
    });

    it("創界神ネクサスのバウンス時もコアはボイドに移動する", () => {
      const gwCard = fieldCard("gw2", "GW-001", ALICE, 4, {
        pendingLeaveKind: "bounce",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-5",
      });
      const state = makeState({ cardInstances: [gwCard] });
      state.pendingLeaveEntities = [
        {
          instanceId: "gw2",
          kind: "bounce",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain-5",
          deferZoneMoveUntilChainEnd: false,
        },
      ];

      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;

      const next = flushPendingLeaves(state, getCardDef);

      expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore + 4);
    });

    it("既存の leaveFieldCoreDestinationOverride がある場合はそちらを優先する", () => {
      const gwCard = fieldCard("gw3", "GW-001", ALICE, 3, {
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-6",
      });
      const state = makeState({ cardInstances: [gwCard] });
      state.pendingLeaveEntities = [
        {
          instanceId: "gw3",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain-6",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: {
            normalCoreDestination: { kind: "trash", playerId: ALICE },
          },
        },
      ];

      const trashBefore = getPlayer(state, ALICE).trashNormalCoreCount;

      const next = flushPendingLeaves(state, getCardDef);

      // 明示的なオーバーライドがある場合はそちらを使用
      expect(getPlayer(next, ALICE).trashNormalCoreCount).toBe(trashBefore + 3);
    });

    it("コア 0 個の創界神ネクサス破壊時、ボイドは変化なし", () => {
      const gwCard = fieldCard("gw4", "GW-001", ALICE, 0, {
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "chain-7",
      });
      const state = makeState({ cardInstances: [gwCard] });
      state.pendingLeaveEntities = [
        {
          instanceId: "gw4",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain-7",
          deferZoneMoveUntilChainEnd: false,
        },
      ];

      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
      const reserveBefore = getPlayer(state, ALICE).reserveNormalCoreCount;

      const next = flushPendingLeaves(state, getCardDef);

      expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore);
      expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(reserveBefore);
      expect(getCard(next, "gw4").zone).toBe("trash");
    });
  });

  // ── GrandwalkerData 型構造 ──

  describe("GrandwalkerData 型構造", () => {
    it("創界神の oracleConditions を正しく保持する", () => {
      const def = grandwalkerNexusDef();
      expect(def.grandwalkerData).toBeDefined();
      expect(def.grandwalkerData!.kind).toBe("grandwalker");
      expect(def.grandwalkerData!.oracleConditions).toHaveLength(1);
      expect(def.grandwalkerData!.oracleConditions[0]!.tribes).toEqual([
        "夜錆",
      ]);
    });

    it("導界者の oracleConditions にカテゴリとコスト条件を持てる", () => {
      const def = guidedNexusDef();
      expect(def.grandwalkerData!.kind).toBe("guided");
      const cond = def.grandwalkerData!.oracleConditions[0]!;
      expect(cond.tribes).toEqual(["CB"]);
      expect(cond.categories).toEqual(["spirit"]);
      expect(cond.minCost).toBe(3);
    });

    it("複数の oracleConditions を持てる", () => {
      const def = grandwalkerNexusDef({
        grandwalkerData: {
          kind: "grandwalker",
          oracleTriggerKinds: [
            "summon",
            "advent",
            "place",
            "use_magic",
            "use_accel",
          ] as const,
          oracleConditions: [
            { tribes: ["夜錆"] },
            { tribes: ["夜錆"], categories: ["nexus"] },
          ],
        },
      });
      expect(def.grandwalkerData!.oracleConditions).toHaveLength(2);
    });
  });
});

// ── F-2: 創界神サブシステム（神託） ──────────────────────

describe("F-2: 神託 (Oracle) サブシステム", () => {
  // ── matchesOracleCondition ──

  describe("matchesOracleCondition", () => {
    it("系統が一致すればマッチする", () => {
      const result = matchesOracleCondition(oracleMatchSpiritDef(), {
        tribes: ["夜錆"],
      });
      expect(result).toBe(true);
    });

    it("系統が一致しなければマッチしない", () => {
      const result = matchesOracleCondition(oracleNonMatchSpiritDef(), {
        tribes: ["夜錆"],
      });
      expect(result).toBe(false);
    });

    it("カテゴリ制限がある場合、カテゴリも一致が必要", () => {
      const spiritResult = matchesOracleCondition(
        guidedOracleMatchSpiritDef(),
        { tribes: ["CB"], categories: ["spirit"] }
      );
      expect(spiritResult).toBe(true);

      const nexusDef = normalNexusDef();
      const nexusResult = matchesOracleCondition(
        { ...nexusDef, tribe: "CB" } as CardDefinition,
        { tribes: ["CB"], categories: ["spirit"] }
      );
      expect(nexusResult).toBe(false);
    });

    it("minCost 制限がある場合、コストも一致が必要", () => {
      const high = matchesOracleCondition(
        guidedOracleMatchSpiritDef(), // cost: 3
        { tribes: ["CB"], minCost: 3 }
      );
      expect(high).toBe(true);

      const low = matchesOracleCondition(
        guidedOracleLowCostSpiritDef(), // cost: 2
        { tribes: ["CB"], minCost: 3 }
      );
      expect(low).toBe(false);
    });

    it("minCost 制限は実効文脈では additional_cost CE のコストも一致候補にする", () => {
      const lowDef = guidedOracleLowCostSpiritDef(); // printed cost: 2
      const lowSpirit = createCardInstance(lowDef, {
        instanceId: "spirit-low-additional-cost",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({
        cardInstances: [lowSpirit],
        activeContinuousEffects: [
          additionalCostEffect("spirit-low-additional-cost", 3),
        ],
      });

      expect(
        matchesOracleCondition(lowDef, {
          tribes: ["CB"],
          categories: ["spirit"],
          minCost: 3,
        })
      ).toBe(false);
      expect(
        matchesOracleCondition(
          lowDef,
          { tribes: ["CB"], categories: ["spirit"], minCost: 3 },
          { state, card: lowSpirit }
        )
      ).toBe(true);
    });

    it("tribe がないカードはマッチしない", () => {
      const result = matchesOracleCondition(
        spiritDef(), // tribe undefined
        { tribes: ["夜錆"] }
      );
      expect(result).toBe(false);
    });

    // ── hasMechanic / tribes optional 拡張（四季映姫・幽々子の「転醒ネクサス」表現） ──

    it("hasMechanic=['rebirth'] が isDoubleSided ネクサスにマッチする", () => {
      const rebirthNexus: CardDefinition = {
        ...normalNexusDef(),
        cardNo: "REB-NX-1",
        isDoubleSided: true,
      };
      const result = matchesOracleCondition(rebirthNexus, {
        hasMechanic: ["rebirth"],
        categories: ["nexus"],
      });
      expect(result).toBe(true);
    });

    it("hasMechanic=['rebirth'] が backFace を持つカードにマッチする", () => {
      const backFaceNexus: CardDefinition = {
        ...normalNexusDef(),
        cardNo: "REB-NX-2",
        backFace: {
          name: "B面",
          printedCategory: "spirit",
        } as CardDefinition["backFace"],
      };
      const result = matchesOracleCondition(backFaceNexus, {
        hasMechanic: ["rebirth"],
        categories: ["nexus"],
      });
      expect(result).toBe(true);
    });

    it("hasMechanic=['rebirth'] は通常ネクサスにマッチしない", () => {
      const result = matchesOracleCondition(normalNexusDef(), {
        hasMechanic: ["rebirth"],
        categories: ["nexus"],
      });
      expect(result).toBe(false);
    });

    it("tribes 省略時は系統チェックがスキップされ、hasMechanic 等の他条件のみで判定する", () => {
      const rebirthNexus: CardDefinition = {
        ...normalNexusDef(),
        cardNo: "REB-NX-3",
        tribe: undefined as unknown as string, // tribe 無し
        isDoubleSided: true,
      };
      const result = matchesOracleCondition(rebirthNexus, {
        hasMechanic: ["rebirth"],
        categories: ["nexus"],
      });
      expect(result).toBe(true);
    });

    it("〔幻想＆コスト3以上〕条件: 幻想スピリットでコスト3以上はマッチ", () => {
      const fantasySpirit: CardDefinition = {
        ...spiritDef(),
        cardNo: "GENSO-1",
        tribe: "幻想",
        cost: 3,
      };
      const result = matchesOracleCondition(fantasySpirit, {
        tribes: ["幻想"],
        minCost: 3,
      });
      expect(result).toBe(true);
    });

    it("〔幻想＆コスト3以上〕条件: 幻想スピリットでもコスト2はマッチしない", () => {
      const fantasySpirit: CardDefinition = {
        ...spiritDef(),
        cardNo: "GENSO-2",
        tribe: "幻想",
        cost: 2,
      };
      const result = matchesOracleCondition(fantasySpirit, {
        tribes: ["幻想"],
        minCost: 3,
      });
      expect(result).toBe(false);
    });

    it("複数 OracleCondition (OR): 幻想コスト3以上 OR 転醒ネクサスのいずれかにマッチ", () => {
      const fantasySpirit: CardDefinition = {
        ...spiritDef(),
        cardNo: "GENSO-3",
        tribe: "幻想",
        cost: 5,
      };
      const rebirthNexus: CardDefinition = {
        ...normalNexusDef(),
        cardNo: "REB-NX-4",
        cost: 1,
        isDoubleSided: true,
      };
      const conditions = {
        kind: "guided" as const,
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [
          { tribes: ["幻想"], minCost: 3 },
          { hasMechanic: ["rebirth" as const], categories: ["nexus" as const] },
        ],
      };
      expect(matchesAnyOracleCondition(fantasySpirit, conditions)).toBe(true);
      expect(matchesAnyOracleCondition(rebirthNexus, conditions)).toBe(true);

      // どちらにも該当しない通常スピリット
      const normalSpirit: CardDefinition = {
        ...spiritDef(),
        cardNo: "NORM-1",
        tribe: "妖精",
        cost: 2,
      };
      expect(matchesAnyOracleCondition(normalSpirit, conditions)).toBe(false);
    });
  });

  // ── matchesAnyOracleCondition ──

  describe("matchesAnyOracleCondition", () => {
    it("複数の条件のいずれかにマッチすれば true", () => {
      const gwData: GrandwalkerData = {
        kind: "grandwalker",
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [{ tribes: ["異合"] }, { tribes: ["夜錆"] }],
      };
      expect(matchesAnyOracleCondition(oracleMatchSpiritDef(), gwData)).toBe(
        true
      );
      expect(matchesAnyOracleCondition(oracleNonMatchSpiritDef(), gwData)).toBe(
        true
      );
    });

    it("どの条件にもマッチしなければ false", () => {
      const gwData: GrandwalkerData = {
        kind: "grandwalker",
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [{ tribes: ["天霊"] }],
      };
      expect(matchesAnyOracleCondition(oracleMatchSpiritDef(), gwData)).toBe(
        false
      );
    });
  });

  // ── checkAndQueueOracleChoices ──

  describe("checkAndQueueOracleChoices", () => {
    it("マッチするスピリット召喚時に創界神への神託選択がキューイングされる", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({
        cardInstances: [gw, spirit],
      });

      const result = checkAndQueueOracleChoices(
        state,
        "spirit-1",
        "summon",
        getCardDef,
        "test:phase-f-grandwalker:1276"
      );
      const oracles = oraclePendings(result);
      expect(oracles).toHaveLength(1);
      expect(oracles[0]!.mechanic.grandwalkerInstanceId).toBe("gw-1");
      expect(oracles[0]!.mechanic.triggerCardInstanceId).toBe("spirit-1");
      expect(oracles[0]!.mechanic.triggerKind).toBe("summon");
    });

    it("同じ効果で2体同時召喚されたとき神託は各創界神系ネクサス1回だけキューイングされる", () => {
      const gw1 = fieldCard("gw-1", "GW-001", ALICE, 0);
      const gw2 = fieldCard("gw-2", "GW-001", ALICE, 0);
      const spiritA = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-a",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const spiritB = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-b",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({
        cardInstances: [gw1, gw2, spiritA, spiritB],
      });

      const result = checkAndQueueOracleChoicesForTriggerBatch(
        state,
        [
          {
            chainId: "test:phase-f-grandwalker:1311",
            triggerCardInstanceId: "spirit-a",
            triggerKind: "summon",
          },
          {
            chainId: "test:phase-f-grandwalker:1312",
            triggerCardInstanceId: "spirit-b",
            triggerKind: "summon",
          },
        ],
        getCardDef,
        "test:phase-f-grandwalker:1308"
      );
      const oracles = oraclePendings(result);
      expect(oracles).toHaveLength(2);
      expect(
        new Set(
          oracles.map((pending) => pending.mechanic.grandwalkerInstanceId)
        )
      ).toEqual(new Set(["gw-1", "gw-2"]));
    });

    it("マッチしないスピリット召喚時はキューイングされない", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleNonMatchSpiritDef(), {
        instanceId: "spirit-2",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({
        cardInstances: [gw, spirit],
      });

      const result = checkAndQueueOracleChoices(
        state,
        "spirit-2",
        "summon",
        getCardDef,
        "test:phase-f-grandwalker:1337"
      );
      expect(oraclePendings(result)).toHaveLength(0);
    });

    it("ボイドにコアがなければキューイングされない", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({
        cardInstances: [gw, spirit],
      });
      // ボイドコアを 0 にする
      const stateNoVoid = {
        ...state,
        players: state.players.map((p) =>
          p.id === ALICE ? { ...p, voidNormalCoreCount: 0 } : p
        ),
      };

      const result = checkAndQueueOracleChoices(
        stateNoVoid,
        "spirit-1",
        "summon",
        getCardDef,
        "test:phase-f-grandwalker:1365"
      );
      expect(oraclePendings(result)).toHaveLength(0);
    });

    it("相手の創界神にはキューイングされない", () => {
      const gw = fieldCard("gw-bob", "GW-001", BOB, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({
        cardInstances: [gw, spirit],
      });

      const result = checkAndQueueOracleChoices(
        state,
        "spirit-1",
        "summon",
        getCardDef,
        "test:phase-f-grandwalker:1386"
      );
      expect(oraclePendings(result)).toHaveLength(0);
    });

    it("導託の minCost 条件を正しく適用する", () => {
      const gn = fieldCard("gn-1", "GN-001", ALICE, 0);
      // コスト3 → マッチ
      const matchSpirit = createCardInstance(guidedOracleMatchSpiritDef(), {
        instanceId: "spirit-match",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state1 = makeState({ cardInstances: [gn, matchSpirit] });
      expect(
        oraclePendings(
          checkAndQueueOracleChoices(
            state1,
            "spirit-match",
            "summon",
            getCardDef,
            "test:phase-f-grandwalker:1407"
          )
        )
      ).toHaveLength(1);

      // コスト2 → 不一致
      const lowSpirit = createCardInstance(guidedOracleLowCostSpiritDef(), {
        instanceId: "spirit-low",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state2 = makeState({ cardInstances: [gn, lowSpirit] });
      expect(
        oraclePendings(
          checkAndQueueOracleChoices(
            state2,
            "spirit-low",
            "summon",
            getCardDef,
            "test:phase-f-grandwalker:1426"
          )
        )
      ).toHaveLength(0);

      // 印字コスト2でも「コスト3としても扱う」CE があれば導託対象。
      const state3 = makeState({
        cardInstances: [gn, lowSpirit],
        activeContinuousEffects: [additionalCostEffect("spirit-low", 3)],
      });
      expect(
        oraclePendings(
          checkAndQueueOracleChoices(
            state3,
            "spirit-low",
            "summon",
            getCardDef,
            "test:phase-f-grandwalker:1437"
          )
        )
      ).toHaveLength(1);
    });
  });

  // ── wouldQueueOracleChoices (BSTH02-C01 effects[0]「導託していないとき」の SSOT) ──

  describe("wouldQueueOracleChoices", () => {
    it("checkAndQueueOracleChoices と同じ判定 (マッチ+ボイドコアあり → true)", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({ cardInstances: [gw, spirit] });

      expect(
        wouldQueueOracleChoices(state, "spirit-1", "summon", getCardDef)
      ).toBe(true);
      // 副作用なし判定 = pendingTriggeredEffects は変化しない。
      expect(oraclePendings(state)).toHaveLength(0);
    });

    it("マッチしないスピリットは false", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleNonMatchSpiritDef(), {
        instanceId: "spirit-2",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({ cardInstances: [gw, spirit] });

      expect(
        wouldQueueOracleChoices(state, "spirit-2", "summon", getCardDef)
      ).toBe(false);
    });

    it("創界神/導界者ネクサスが場に無ければ false (導託していない = 判定通過)", () => {
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({ cardInstances: [spirit] });

      expect(
        wouldQueueOracleChoices(state, "spirit-1", "summon", getCardDef)
      ).toBe(false);
    });

    it("ボイドコアが無ければ false (神託は不発)", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({ cardInstances: [gw, spirit] });
      const stateNoVoid = {
        ...state,
        players: state.players.map((p) =>
          p.id === ALICE ? { ...p, voidNormalCoreCount: 0 } : p
        ),
      };

      expect(
        wouldQueueOracleChoices(stateNoVoid, "spirit-1", "summon", getCardDef)
      ).toBe(false);
    });
  });

  // ── ConditionClause "oracle_would_trigger" (evaluateCondition 経由) ──

  describe("evaluateCondition: oracle_would_trigger", () => {
    it("negate:true は「発火しない」ときに true (導託していないとき)", () => {
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      // 導界者/創界神ネクサスが場に無い → 神託は発火し得ない → negate:true で true
      const state = makeState({ cardInstances: [spirit] });
      expect(
        evaluateCondition(
          state,
          [
            {
              kind: "oracle_would_trigger",
              triggerKind: "summon",
              negate: true,
            },
          ],
          "spirit-1",
          ALICE,
          getCardDef
        )
      ).toBe(true);
    });

    it("negate:true は「発火する」ときに false (導託しているので効果不発)", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      const state = makeState({ cardInstances: [gw, spirit] });
      expect(
        evaluateCondition(
          state,
          [
            {
              kind: "oracle_would_trigger",
              triggerKind: "summon",
              negate: true,
            },
          ],
          "spirit-1",
          ALICE,
          getCardDef
        )
      ).toBe(false);
    });
  });

  // ── 神託 mechanic の解決 (P3-92: 誘発キュー経由) ──

  describe("resolveOracleMechanic (legal action 経由)", () => {
    it("accept=true でボイドから創界神にコア+1 される", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      let state = makeState({ cardInstances: [gw, spirit] });

      // キューイング
      state = checkAndQueueOracleChoices(
        state,
        "spirit-1",
        "summon",
        getCardDef,
        "test:phase-f-grandwalker:1584"
      );
      expect(oraclePendings(state)).toHaveLength(1);
      const pendingId = oraclePendings(state)[0]!.pendingId;

      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
      state = resolveOracleMechanicPending(state, pendingId, true);

      expect(oraclePendings(state)).toHaveLength(0);
      expect(getCard(state, "gw-1").normalCoreCount).toBe(1);
      expect(getPlayer(state, ALICE).voidNormalCoreCount).toBe(voidBefore - 1);
    });

    it("accept=false でコアは移動しない", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const spirit = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "spirit-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      });
      let state = makeState({ cardInstances: [gw, spirit] });
      state = checkAndQueueOracleChoices(
        state,
        "spirit-1",
        "summon",
        getCardDef,
        "test:phase-f-grandwalker:1610"
      );
      const pendingId = oraclePendings(state)[0]!.pendingId;

      state = resolveOracleMechanicPending(state, pendingId, false);

      expect(oraclePendings(state)).toHaveLength(0);
      expect(getCard(state, "gw-1").normalCoreCount).toBe(0);
    });
  });

  // ── 配置時神託 (Placement Oracle) ──

  describe("配置時神託 (Placement Oracle)", () => {
    it("配置時にデッキ上3枚をオープンし、マッチ分のコアが追加される", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      // デッキに3枚: マッチ2枚 + 非マッチ1枚
      const deck1 = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "deck-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const deck2 = createCardInstance(oracleNonMatchSpiritDef(), {
        instanceId: "deck-2",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const deck3 = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "deck-3",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      let state = makeState({
        cardInstances: [gw, deck1, deck2, deck3],
        players: [
          { ...makeState().players[0]!, deckCount: 3 },
          makeState().players[1]!,
        ],
      });

      // 発火: mechanic 誘発として誘発キューに積まれる（スタック窓を開く発揮宣言型）
      state = checkAndQueuePlacementOracle(
        state,
        "gw-1",
        getCardDef,
        "test:phase-f-grandwalker:1655"
      );
      const queued = state.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "placement_oracle"
      );
      expect(queued).toHaveLength(1);

      // 発揮（窓クローズ後の解決）: デッキ上3枚をトラッシュ + マッチ分コアを強制配置
      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
      state = resolvePlacementOracleMechanic(
        state,
        { kind: "placement_oracle", grandwalkerInstanceId: "gw-1" },
        getCardDef
      );
      // 3枚ともトラッシュへ
      expect(getCard(state, "deck-1").zone).toBe("trash");
      expect(getCard(state, "deck-2").zone).toBe("trash");
      expect(getCard(state, "deck-3").zone).toBe("trash");
      expect(getPlayer(state, ALICE).deckCount).toBe(0);
      // マッチ2枚 → コア+2（強制。置く/置かないの選択は無い）
      expect(getCard(state, "gw-1").normalCoreCount).toBe(2);
      expect(getPlayer(state, ALICE).voidNormalCoreCount).toBe(voidBefore - 2);
    });

    it("マッチが無ければコアは置かれず3枚トラッシュのみ", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const deck1 = createCardInstance(oracleNonMatchSpiritDef(), {
        instanceId: "deck-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      let state = makeState({
        cardInstances: [gw, deck1],
        players: [
          { ...makeState().players[0]!, deckCount: 1 },
          makeState().players[1]!,
        ],
      });
      state = checkAndQueuePlacementOracle(
        state,
        "gw-1",
        getCardDef,
        "test:phase-f-grandwalker:1692"
      );
      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
      state = resolvePlacementOracleMechanic(
        state,
        { kind: "placement_oracle", grandwalkerInstanceId: "gw-1" },
        getCardDef
      );
      expect(getCard(state, "deck-1").zone).toBe("trash");
      expect(getCard(state, "gw-1").normalCoreCount).toBe(0);
      expect(getPlayer(state, ALICE).voidNormalCoreCount).toBe(voidBefore);
    });

    it("配置時導託のマッチ数は additional_cost CE の実効コストも見る", () => {
      const gn = fieldCard("gn-1", "GN-001", ALICE, 0);
      const deck1 = createCardInstance(guidedOracleLowCostSpiritDef(), {
        instanceId: "deck-low-cost",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      let state = makeState({
        cardInstances: [gn, deck1],
        players: [
          { ...makeState().players[0]!, deckCount: 1 },
          makeState().players[1]!,
        ],
        activeContinuousEffects: [additionalCostEffect("deck-low-cost", 3)],
      });

      state = checkAndQueuePlacementOracle(
        state,
        "gn-1",
        getCardDef,
        "test:phase-f-grandwalker:1720"
      );
      const queued = state.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "placement_oracle"
      );
      expect(queued).toHaveLength(1);

      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
      state = resolvePlacementOracleMechanic(
        state,
        { kind: "placement_oracle", grandwalkerInstanceId: "gn-1" },
        getCardDef
      );

      expect(getCard(state, "deck-low-cost").zone).toBe("trash");
      expect(getCard(state, "gn-1").normalCoreCount).toBe(1);
      expect(getPlayer(state, ALICE).voidNormalCoreCount).toBe(voidBefore - 1);
    });

    it("同名カードがフィールドにいる場合、配置時神託は発火しない", () => {
      const gw1 = fieldCard("gw-1", "GW-001", ALICE, 0);
      const gw2 = fieldCard("gw-2", "GW-001", ALICE, 0); // 同名
      const deck = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "deck-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const state = makeState({
        cardInstances: [gw1, gw2, deck],
        players: [
          { ...makeState().players[0]!, deckCount: 1 },
          makeState().players[1]!,
        ],
      });

      const result = checkAndQueuePlacementOracle(
        state,
        "gw-2",
        getCardDef,
        "test:phase-f-grandwalker:1754"
      );
      expect(
        result.pendingTriggeredEffects.filter(
          (p) => p.mechanic?.kind === "placement_oracle"
        )
      ).toHaveLength(0);
    });

    it("デッキが0枚の場合、配置時神託は発火しない", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const state = makeState({
        cardInstances: [gw],
      });

      const result = checkAndQueuePlacementOracle(
        state,
        "gw-1",
        getCardDef,
        "test:phase-f-grandwalker:1768"
      );
      expect(
        result.pendingTriggeredEffects.filter(
          (p) => p.mechanic?.kind === "placement_oracle"
        )
      ).toHaveLength(0);
    });

    it("デッキが3枚未満の場合、ある分だけトラッシュしマッチ分コアを置く", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const deck1 = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "deck-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      let state = makeState({
        cardInstances: [gw, deck1],
        players: [
          { ...makeState().players[0]!, deckCount: 1 },
          makeState().players[1]!,
        ],
      });

      state = checkAndQueuePlacementOracle(
        state,
        "gw-1",
        getCardDef,
        "test:phase-f-grandwalker:1791"
      );
      state = resolvePlacementOracleMechanic(
        state,
        { kind: "placement_oracle", grandwalkerInstanceId: "gw-1" },
        getCardDef
      );
      // 1枚トラッシュ + マッチ1枚 → コア+1
      expect(getCard(state, "deck-1").zone).toBe("trash");
      expect(getPlayer(state, ALICE).deckCount).toBe(0);
      expect(getCard(state, "gw-1").normalCoreCount).toBe(1);
    });

    it("legal-action 経由: 発揮する→スタック窓→デッキ3枚トラッシュ+コア強制配置", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const deck1 = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "deck-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const deck2 = createCardInstance(oracleNonMatchSpiritDef(), {
        instanceId: "deck-2",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const deck3 = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "deck-3",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      let state = makeState({
        cardInstances: [gw, deck1, deck2, deck3],
        players: [
          { ...makeState().players[0]!, deckCount: 3 },
          makeState().players[1]!,
        ],
      });

      // 配置 → mechanic 誘発キュー
      state = checkAndQueuePlacementOracle(
        state,
        "gw-1",
        getCardDef,
        "test:phase-f-grandwalker:1829"
      );
      const pendingId = state.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "placement_oracle"
      )!.pendingId;

      // 発揮する → スタック窓が開き、パスでクローズ後にデッキ3枚トラッシュ+コア強制配置
      state = resolveOracleMechanicPending(state, pendingId, true);
      expect(getCard(state, "deck-1").zone).toBe("trash");
      expect(getCard(state, "deck-2").zone).toBe("trash");
      expect(getCard(state, "deck-3").zone).toBe("trash");
      // マッチ2枚 → コア+2（効果内の強制ステップ。追加の選択は無い）
      expect(getCard(state, "gw-1").normalCoreCount).toBe(2);
    });

    it("legal-action 経由: 発揮しないとデッキは温存される", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 0);
      const deck1 = createCardInstance(oracleMatchSpiritDef(), {
        instanceId: "deck-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      let state = makeState({
        cardInstances: [gw, deck1],
        players: [
          { ...makeState().players[0]!, deckCount: 1 },
          makeState().players[1]!,
        ],
      });
      state = checkAndQueuePlacementOracle(
        state,
        "gw-1",
        getCardDef,
        "test:phase-f-grandwalker:1857"
      );
      const pendingId = state.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "placement_oracle"
      )!.pendingId;
      state = resolveOracleMechanicPending(state, pendingId, false);
      expect(getCard(state, "deck-1").zone).toBe("deck");
      expect(getCard(state, "gw-1").normalCoreCount).toBe(0);
    });
  });
});

// ── F-2 追加: 神技/界放/神域/対象判定 ────────────────────────

describe("F-2: 神技/界放 (Divine Skill / Divine Release)", () => {
  function makeLegalActionsOptions(state: GameState) {
    return {
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    };
  }

  describe("getAvailableDivineSkillLegalActions", () => {
    it("メインステップで Lv1 神技が使用可能", () => {
      const gw = fieldCard("gw-1", "GWS-001", ALICE, 3); // 3コア = Lv1
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      // skill[0]: main, Lv1-Lv2, cost 2 → 使用可（3 >= 2）
      // skill[1]: flash, Lv2 → 不可（Lv1）
      // skill[2]: main, cost 3 → 使用可（3 >= 3）
      expect(actions).toHaveLength(2);
      expect(actions[0]!.skillIndex).toBe(0);
      expect(actions[0]!.label).toBe("divine_skill");
      expect(actions[0]!.coreCost).toBe(2);
      expect(actions[1]!.skillIndex).toBe(2);
      expect(actions[1]!.label).toBe("divine_release");
    });

    it("コア不足の場合は使用不可", () => {
      const gw = fieldCard("gw-1", "GWS-001", ALICE, 1); // 1コア < 2必要
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      expect(actions).toHaveLength(0);
    });

    it("Lv 条件を満たさない場合は使用不可", () => {
      // skill[0] は maxLevel:2 なので Lv2 以下で使用可
      // Lv2 には 4 コア必要
      const gw = fieldCard("gw-1", "GWS-001", ALICE, 5); // 5コア = Lv2
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      // skill[0]: main, Lv1-Lv2, cost 2 → 使用可
      // skill[1]: flash, Lv2+ → 自分のメインでも使用可
      // skill[2]: main, cost 3 → 使用可
      expect(actions.map((action) => action.skillIndex)).toEqual([0, 1, 2]);
    });

    it("ターン制限 (once) で2回目は使用不可", () => {
      const gw = fieldCard("gw-1", "GWS-001", ALICE, 5);
      const state = makeState({
        cardInstances: [gw],
        usedDivineSkillKeysThisTurn: ["gw-1:0"], // skill[0] 使用済み
      });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      // skill[0] は once で使用済み → 除外
      // skill[1] は flash・Lv2 → 自分のメインでも使用可
      // skill[2] は turnLimit なし → 使用可
      expect(actions.map((action) => action.skillIndex)).toEqual([1, 2]);
    });

    it("相手の創界神は使用できない", () => {
      const gw = fieldCard("gw-1", "GWS-001", BOB, 5);
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      expect(actions).toHaveLength(0);
    });

    it("フィールド外の創界神は使用できない", () => {
      const gw = createCardInstance(grandwalkerWithSkillsDef(), {
        instanceId: "gw-1",
        ownerPlayerId: ALICE,
        zone: "hand",
        normalCoreCount: 5,
      });
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      expect(actions).toHaveLength(0);
    });

    it("divineSkills のない創界神からは何も返さない", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 5);
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      expect(actions).toHaveLength(0);
    });
  });

  describe("applyDivineSkillAction (発揮宣言→スタック窓→コア消費)", () => {
    it("神技発揮宣言でスタック窓が開き、コア消費は窓クローズ後に行われる", () => {
      const gw = fieldCard("gw-1", "GWS-001", ALICE, 5);
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      const skillAction = actions.find((a) => a.skillIndex === 0)!;

      const result = applyLegalAction({
        state,
        action: skillAction,
        getCardDefinitionById: getCardDef,
      });

      let newState = (result as { state: GameState }).state;
      // 発揮宣言でスタック窓が開く。コア（発揮コスト＝効果文内）はまだ動かない。
      expect(newState.stackWindow).not.toBeNull();
      expect(
        newState.stackWindow!.pendingStackAction!.suppressionEffectDescriptor
      ).toMatchObject({
        sourceDefinitionId: "GWS-001",
        sourceKind: "nexus",
        effectIndex: 0,
        effectLabels: ["divine_skill"],
        keywords: ["divine_skill"],
        timingKind: "activated",
        activatedMode: "main",
      });
      expect(getCard(newState, "gw-1").normalCoreCount).toBe(5);

      // 窓クローズ後の deferred 解決でコア→ボイド。
      newState = passStackUntilClosed(newState);
      expect(getCard(newState, "gw-1").normalCoreCount).toBe(3); // 5 - 2
      const alice = getPlayer(newState, ALICE);
      expect(alice.voidNormalCoreCount).toBe(102); // 100 + 2
    });

    it("ターン制限キーが記録される", () => {
      const gw = fieldCard("gw-1", "GWS-001", ALICE, 5);
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      const skillAction = actions.find((a) => a.skillIndex === 0)!;

      const result = applyLegalAction({
        state,
        action: skillAction,
        getCardDefinitionById: getCardDef,
      });

      const newState = (result as { state: GameState }).state;
      expect(newState.usedDivineSkillKeysThisTurn).toContain("gw-1:0");
    });

    it("界放もコア消費で実行される", () => {
      const gw = fieldCard("gw-1", "GWS-001", ALICE, 5);
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      const releaseAction = actions.find((a) => a.label === "divine_release")!;

      const result = applyLegalAction({
        state,
        action: releaseAction,
        getCardDefinitionById: getCardDef,
      });

      let newState = (result as { state: GameState }).state;
      newState = passStackUntilClosed(newState);
      expect(getCard(newState, "gw-1").normalCoreCount).toBe(2); // 5 - 3
    });

    it("対象を要する神技本体は窓クローズ後にプレイヤー対象選択を立てる（機械選択しない）", () => {
      const gw = fieldCard("gw-1", "GWTS-001", ALICE, 4); // Lv2
      const e1 = fieldCard("enemy-1", "SP-001", BOB, 1);
      const e2 = fieldCard("enemy-2", "SP-001", BOB, 1);
      const state = makeState({ cardInstances: [gw, e1, e2] });

      const actions = getAvailableDivineSkillLegalActions(
        makeLegalActionsOptions(state)
      );
      const skillAction = actions.find((a) => a.sourceInstanceId === "gw-1")!;
      expect(skillAction).toBeDefined();

      let s = (
        applyLegalAction({
          state,
          action: skillAction,
          getCardDefinitionById: getCardDef,
        }) as { state: GameState }
      ).state;
      s = passStackUntilClosed(s);

      // 候補2体 → 機械選択せず pendingEffectTargetSelection を立てる。
      expect(s.pendingEffectTargetSelection).not.toBeNull();
      expect(
        s.pendingEffectTargetSelection!.candidateInstanceIds.sort()
      ).toEqual(["enemy-1", "enemy-2"]);
      expect(s.pendingEffectTargetSelection!.requiredTargetCount).toBe(1);
      // まだ誰も消滅していない。
      expect(s.pendingLeaveEntities ?? []).toHaveLength(0);

      // enemy-2 を選択 → 効果解決後の finalize で pendingLeave を flush し enemy-2 のみ
      // トラッシュへ移動。enemy-1 は場に残る。
      // (ENGINE-external-rebirth-finalize: resolveDeferredDivineSkillStack に
      // finalizeEffectResolution を追加した結果、通常 magic/rebirth 経路と同じく
      // chain 終端で pending leave を flush する。旧来は pendingLeaveEntities が
      // 残ったまま deferred 解決が終了し、後段 SBA / トリガー収集が漏れていた。)
      const resolveActions = getLegalActions({
        state: s,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });
      const resolve = resolveActions.find(
        (a) => a.kind === "resolve_pending_effect_target"
      );
      expect(resolve, "resolve_pending_effect_target").toBeDefined();
      const after = (
        applyLegalAction({
          state: s,
          action: resolve!,
          targetInstanceIds: ["enemy-2"],
          getCardDefinitionById: getCardDef,
        }) as { state: GameState }
      ).state;
      expect(after.pendingLeaveEntities ?? []).toHaveLength(0);
      const enemy1 = after.cardInstances.find(
        (c) => c.instanceId === "enemy-1"
      );
      const enemy2 = after.cardInstances.find(
        (c) => c.instanceId === "enemy-2"
      );
      expect(enemy1?.zone).toBe("field");
      expect(enemy2?.zone).toBe("trash");
    });

    it("ENGINE-external-rebirth-finalize: 神技の deferred 解決で rebirth.target → post choice 確定後に flip + countValue+1 + finalize の三点を踏む", () => {
      // BSSA01-XX01 神技4 の縮約: GWER-001 (rebirth.target hasMechanic:["rebirth"] +
      // forceTriggerCondition) を使い、divine_skill stack → 対象選択 → postRebirthChoice
      // → executeRebirth → finalize までの完全経路を踏む。対象は実カード BSSA01-転醒X01(A)。
      // finalize 不在では count+1 が反映されず flip 後の SBA / 二次トリガー収集が漏れる。
      const realTarget = ALL_CARDS.find(
        (c) => c.cardNo === "BSSA01-転醒X01(A)"
      )!;
      expect(realTarget).toBeDefined();
      const gw = fieldCard("gw-1", "GWER-001", ALICE, 5);
      const target = createCardInstance(realTarget, {
        instanceId: "yoru-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...makeState({ cardInstances: [gw, target] }),
        players: [
          {
            ...makeState().players[0]!,
            countValue: 7,
          },
          makeState().players[1]!,
        ],
      };
      const noTriggeredLookup = () => [];
      const options = {
        ...makeLegalActionsOptions(state),
        getRegisteredTriggeredEffectActions: noTriggeredLookup,
      };

      const actions = getAvailableDivineSkillLegalActions(options);
      const skillAction = actions.find((a) => a.sourceInstanceId === "gw-1")!;
      expect(skillAction).toBeDefined();

      let s = (
        applyLegalAction({
          state,
          action: skillAction,
          getCardDefinitionById: getCardDef,
          getRegisteredTriggeredEffectActions: noTriggeredLookup,
        }) as { state: GameState }
      ).state;
      s = passStackUntilClosed(s, noTriggeredLookup);

      // 対象選択 pending を立てて中断する (rebirth.target / hasMechanic:["rebirth"])。
      expect(s.pendingEffectTargetSelection).not.toBeNull();
      expect(s.pendingEffectTargetSelection!.candidateInstanceIds).toContain(
        "yoru-1"
      );

      const resolveActions = getLegalActions({
        state: s,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
        getRegisteredTriggeredEffectActions: noTriggeredLookup,
      });
      const resolve = resolveActions.find(
        (a) => a.kind === "resolve_pending_effect_target"
      );
      expect(resolve, "resolve_pending_effect_target").toBeDefined();
      const afterTarget = (
        applyLegalAction({
          state: s,
          action: resolve!,
          targetInstanceIds: ["yoru-1"],
          getCardDefinitionById: getCardDef,
          getRegisteredTriggeredEffectActions: noTriggeredLookup,
        }) as { state: GameState }
      ).state;
      expect(afterTarget.pendingStoneFlipCombine).not.toBeNull();
      expect(
        afterTarget.cardInstances.find((c) => c.instanceId === "yoru-1")
          ?.definitionId
      ).toBe("BSSA01-転醒X01(A)");

      const finalized = resolveRebirthPostChoiceCorePlacement(
        afterTarget,
        "yoru-1"
      );

      // 1) post choice 確定後に flip 成立: definitionId が背面に切り替わる。
      const flipped = finalized.cardInstances.find(
        (c) => c.instanceId === "yoru-1"
      );
      expect(flipped?.definitionId).toBe("BSSA01-転醒X01(B)");
      // 2) executeRebirth の副作用 countValue+1 が反映される。
      expect(finalized.players[0]!.countValue).toBeGreaterThan(7);
      // 3) finalize が走り pending leave が残らない (rebirth 自体は leave を生まないが、
      //    SBA / CE recompute / pending-leave flush の経路が完走することを観測)。
      expect(finalized.pendingLeaveEntities ?? []).toHaveLength(0);
    });

    it("ENGINE-external-rebirth-finalize: divine_skill rebirth で B 面の card_event:rebirth トリガーが finalize 経由で収集される (BSFT01-TR01)", () => {
      // 真の finalize 寄与点: rebirth 後の collectAndQueueTriggerReactions が B 面の
      // 『このスピリットの転醒時』効果を pendingTriggeredEffects へ積むこと。
      // finalize 不在では executeRebirth で flip するだけで B 面の card_event:rebirth が
      // 一切観測されない（B 面が新規発揮可能なトリガーを持つカードが silent skip される）。
      // 対象: BSFT01-TR01(A) (front, hasMechanic:["rebirth"]) → 裏返ると BSFT01-TR01(B) で
      // 『転醒時』相手のスピリット/アルティメット 1 体をデッキの下に戻す効果が登録済。
      const realTarget = ALL_CARDS.find((c) => c.cardNo === "BSFT01-TR01(A)")!;
      expect(realTarget).toBeDefined();
      const opponentSpirit = ALL_CARDS.find((c) => c.cardNo === "BSFT01-C01")!;
      expect(opponentSpirit).toBeDefined();

      const gw = fieldCard("gw-1", "GWER-001", ALICE, 5);
      const target = createCardInstance(realTarget, {
        instanceId: "kagi-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const enemy = createCardInstance(opponentSpirit, {
        instanceId: "enemy-1",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...makeState({ cardInstances: [gw, target, enemy] }),
        players: [
          {
            ...makeState().players[0]!,
            countValue: 1,
            // ライフ 1 以上ゲートを満たす（GWER-001 は forceTriggerCondition で
            // count gate を skip するが、target 側の rebirth ゲートは別管理）。
          },
          makeState().players[1]!,
        ],
      };
      // 実 card-data の triggered registration lookup を流し込み、finalize の
      // collectAndQueueTriggerReactions が B 面 (BSFT01-TR01(B)) の card_event:rebirth
      // を引けるようにする (これが無いと engine 側で finalize は走るが「該当 registration
      // 無し」で trigger が無視される)。
      // ALL_CARDS は表面のみ → backFace 合成定義まで含めて lookup を構築する（SSOT
      // expandCardDefinitionsWithBackFaces 経由）。これが無いと flip 後の BSFT01-TR01(B)
      // に対する registration lookup も definition lookup も undefined になり、
      // card_event:rebirth トリガーが silent miss する
      // （[[project_backface_definition_id_lookup_gap]] と同型の罠）。
      const expandedDefs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
      const expandedDefMap = new Map(expandedDefs.map((d) => [d.cardNo, d]));
      const getDefWithBack = (id: string): CardDefinition | undefined =>
        defMap.get(id) ?? expandedDefMap.get(id);
      const triggeredLookup: (
        cardNo: string
      ) =>
        | readonly import("../src").RegisteredTriggeredEffectAction[]
        | undefined = buildTriggeredEffectLookup(expandedDefs);
      const options = {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDefWithBack,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      };

      const actions = getAvailableDivineSkillLegalActions(options);
      const skillAction = actions.find((a) => a.sourceInstanceId === "gw-1")!;
      expect(skillAction).toBeDefined();

      let s = (
        applyLegalAction({
          state,
          action: skillAction,
          getCardDefinitionById: getDefWithBack,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
      ).state;
      // passStackUntilClosed は内部で getCardDef (back face 非対応) を直接使うため、
      // ここはローカルで stack 窓を回す。
      let guard = 0;
      while (s.stackWindow && guard++ < 10) {
        const responderId = s.stackWindow.priorityPlayerId;
        const passActions = getLegalActions({
          state: s,
          actingPlayerId: responderId,
          getCardDefinitionById: getDefWithBack,
          getRegisteredFieldCardEffectActions: () => [],
          getRegisteredTriggeredEffectActions: triggeredLookup,
        } as unknown as Parameters<typeof getLegalActions>[0]);
        const pass = passActions.find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        s = (
          applyLegalAction({
            state: s,
            action: pass!,
            getCardDefinitionById: getDefWithBack,
            getRegisteredTriggeredEffectActions: triggeredLookup,
          } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
        ).state;
      }
      expect(s.stackWindow).toBeNull();

      // 対象選択候補に kagi-1 (hasMechanic:["rebirth"] 一致) が並ぶ。enemy-1 は self 側
      // フィルタで候補外。
      expect(s.pendingEffectTargetSelection).not.toBeNull();
      expect(s.pendingEffectTargetSelection!.candidateInstanceIds).toContain(
        "kagi-1"
      );

      const resolveActions = getLegalActions({
        state: s,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDefWithBack,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      } as Parameters<typeof getLegalActions>[0]);
      const resolve = resolveActions.find(
        (a) => a.kind === "resolve_pending_effect_target"
      );
      expect(resolve).toBeDefined();
      const afterTarget = (
        applyLegalAction({
          state: s,
          action: resolve!,
          targetInstanceIds: ["kagi-1"],
          getCardDefinitionById: getDefWithBack,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
      ).state;
      expect(afterTarget.pendingCoreDistribution).not.toBeNull();
      expect(
        afterTarget.cardInstances.find((c) => c.instanceId === "kagi-1")
          ?.definitionId
      ).toBe("BSFT01-TR01(A)");

      // (1) BSFT01-TR01(A) は「このとき」任意コア配置を内蔵するため、
      //     対象選択直後はまだ A 面で pendingCoreDistribution を開く。
      const virtual = afterTarget.cardInstances.find(
        (c) => c.instanceId === "kagi-1"
      );
      expect(virtual?.definitionId).toBe("BSFT01-TR01(A)");
      expect(afterTarget.pendingCoreDistribution).toMatchObject({
        actingPlayerId: ALICE,
      });

      const coreResolve = getLegalActions({
        state: afterTarget,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDefWithBack,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      } as Parameters<typeof getLegalActions>[0]).find(
        (a) => a.kind === "resolve_pending_core_distribution"
      );
      expect(coreResolve).toBeDefined();
      const after = (
        applyLegalAction({
          state: afterTarget,
          action: coreResolve!,
          getCardDefinitionById: getDefWithBack,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          coreDistributionAllocations: {},
          coreDistributionSourceAllocations: {},
        } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
      ).state;

      // (2) post choice 確定後に flip 成立
      const flipped = after.cardInstances.find(
        (c) => c.instanceId === "kagi-1"
      );
      expect(flipped?.definitionId).toBe("BSFT01-TR01(B)");

      // (3) finalize 経由で B 面の card_event:rebirth トリガーが pendingTriggeredEffects へ
      //     積まれる。finalize 不在ではこの pending は生成されず、silent skip となる
      //     （BSFT01-TR01(B) の send_to_deck 効果が無視される）。
      const rebirthPending = after.pendingTriggeredEffects.find(
        (p) =>
          p.eventKind === "rebirth" &&
          (p.relatedInstanceId === "kagi-1" ||
            p.resolvedSourceInstanceIds.includes("kagi-1"))
      );
      expect(rebirthPending, "pending rebirth trigger on kagi-1").toBeDefined();
    });

    it("ENGINE-external-rebirth-finalize: 神技の deferred 解決で finalize が走り pending leave を flush する（対象選択なし self vanish）", () => {
      // 神技 effects に vanish self を持つ創界神。発揮宣言 → スタック窓クローズ → deferred
      // 解決で executeEffect が pendingLeave を積む → finalizeEffectResolution が
      // flushPendingLeaves を呼んで自身をボイドへ送る (creator: createur が leave_field を伴う
      // 連鎖を main 経路と同型に閉じる)。/
      // 旧実装は executeEffect 後の finalize を欠いていたため、pendingLeave が残ったまま
      // 解決窓が閉じ、SBA / 二次トリガー収集 / leave flush の全てが drop していた。
      const gw = fieldCard("gw-1", "GWSV-001", ALICE, 5);
      const state = makeState({ cardInstances: [gw] });
      const options = makeLegalActionsOptions(state);

      const actions = getAvailableDivineSkillLegalActions(options);
      const skillAction = actions.find((a) => a.sourceInstanceId === "gw-1")!;
      expect(skillAction).toBeDefined();

      let s = (
        applyLegalAction({
          state,
          action: skillAction,
          getCardDefinitionById: getCardDef,
        }) as { state: GameState }
      ).state;
      s = passStackUntilClosed(s);

      // self vanish → finalize 経由で pendingLeaveEntities が flush される。
      expect(s.pendingLeaveEntities ?? []).toHaveLength(0);
      // 自身は場から離脱 (vanish 既定 = トラッシュ)。flush せず pending のままだと
      // zone は依然 "field" のまま残るため、本 assert が finalize 不在の早期捕捉になる。
      const after = s.cardInstances.find((c) => c.instanceId === "gw-1");
      expect(after?.zone).not.toBe("field");
      expect(after?.zone).toBe("trash");
    });
  });
});

describe("F-2: 神域 (Divine Domain) — grandwalker_core_count 条件", () => {
  it("コア数が min 以上のとき条件成立", () => {
    const gw = fieldCard("gw-1", "GW-001", ALICE, 5);
    const state = makeState({ cardInstances: [gw] });

    const result = evaluateCondition(
      state,
      [{ kind: "grandwalker_core_count", min: 3 }],
      "gw-1",
      ALICE,
      getCardDef
    );
    expect(result).toBe(true);
  });

  it("コア数が min 未満のとき条件不成立", () => {
    const gw = fieldCard("gw-1", "GW-001", ALICE, 2);
    const state = makeState({ cardInstances: [gw] });

    const result = evaluateCondition(
      state,
      [{ kind: "grandwalker_core_count", min: 3 }],
      "gw-1",
      ALICE,
      getCardDef
    );
    expect(result).toBe(false);
  });

  it("コア数が max 以下のとき条件成立", () => {
    const gw = fieldCard("gw-1", "GW-001", ALICE, 3);
    const state = makeState({ cardInstances: [gw] });

    const result = evaluateCondition(
      state,
      [{ kind: "grandwalker_core_count", max: 5 }],
      "gw-1",
      ALICE,
      getCardDef
    );
    expect(result).toBe(true);
  });

  it("min と max の両方を指定した範囲チェック", () => {
    const gw = fieldCard("gw-1", "GW-001", ALICE, 4);
    const state = makeState({ cardInstances: [gw] });

    expect(
      evaluateCondition(
        state,
        [{ kind: "grandwalker_core_count", min: 3, max: 5 }],
        "gw-1",
        ALICE,
        getCardDef
      )
    ).toBe(true);

    const gw2 = fieldCard("gw-2", "GW-001", ALICE, 6);
    const state2 = makeState({ cardInstances: [gw2] });
    expect(
      evaluateCondition(
        state2,
        [{ kind: "grandwalker_core_count", min: 3, max: 5 }],
        "gw-2",
        ALICE,
        getCardDef
      )
    ).toBe(false);
  });
});

describe("F-2: 対象判定フィルタ (Grandwalker Target Protection)", () => {
  it("通常の CardFilter はフィールド上の創界神ネクサスを対象にしない", () => {
    const gwCard = fieldCard("gw-1", "GW-001", ALICE, 3);
    const gwDef = grandwalkerNexusDef();
    const filter = { category: ["nexus" as const] };

    const result = matchesCardFilter(gwCard, gwDef, filter);
    expect(result).toBe(false);
  });

  it("targetsGrandwalker: true なら創界神ネクサスを対象にできる", () => {
    const gwCard = fieldCard("gw-1", "GW-001", ALICE, 3);
    const gwDef = grandwalkerNexusDef();
    const filter = { category: ["nexus" as const], targetsGrandwalker: true };

    const result = matchesCardFilter(gwCard, gwDef, filter);
    expect(result).toBe(true);
  });

  it("通常のネクサスは targetsGrandwalker なしでも対象になる", () => {
    const nexusCard = fieldCard("n-1", "NEXUS-001", ALICE, 1);
    const nexusDef = normalNexusDef();
    const filter = { category: ["nexus" as const] };

    const result = matchesCardFilter(nexusCard, nexusDef, filter);
    expect(result).toBe(true);
  });

  it("フィールド外（手札等）の創界神カードは通常フィルタで対象になる", () => {
    const gwCard = createCardInstance(grandwalkerNexusDef(), {
      instanceId: "gw-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const gwDef = grandwalkerNexusDef();
    const filter = { category: ["nexus" as const] };

    const result = matchesCardFilter(gwCard, gwDef, filter);
    expect(result).toBe(true);
  });

  it("導界者ネクサスも通常の CardFilter では対象外", () => {
    const gnCard = fieldCard("gn-1", "GN-001", ALICE, 3);
    const gnDef = guidedNexusDef();
    const filter = { category: ["nexus" as const] };

    const result = matchesCardFilter(gnCard, gnDef, filter);
    expect(result).toBe(false);
  });

  it("デッキ/トラッシュの創界神カードは通常フィルタで対象になる", () => {
    const gwDeckCard = createCardInstance(grandwalkerNexusDef(), {
      instanceId: "gw-deck",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const gwTrashCard = createCardInstance(grandwalkerNexusDef(), {
      instanceId: "gw-trash",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const gwDef = grandwalkerNexusDef();
    const filter = { category: ["nexus" as const] };

    expect(matchesCardFilter(gwDeckCard, gwDef, filter)).toBe(true);
    expect(matchesCardFilter(gwTrashCard, gwDef, filter)).toBe(true);
  });
});

// ── F-2: 転神（Divine Transformation） ──────────────────────

describe("F-2: 転神 (Divine Transformation)", () => {
  // ── executeDivineTransform (direct unit tests) ──

  describe("divine_transform アクション実行", () => {
    it("対象の創界神ネクサスに divineTransformState を設定する", () => {
      const gw = fieldCard("gw-1", "GWT-001", ALICE, 6);
      const state = makeState({
        cardInstances: [gw],
        step: "attack",
        window: "none",
      });

      const result = executeDivineTransform(
        state,
        ALICE,
        {
          kind: "divine_transform",
          target: {
            player: "self",
            category: ["nexus"],
            tribes: ["アシハラ"],
            includeGrandwalker: true,
            count: -1,
          },
          bpByLevel: [
            { level: 1, bp: 3000 },
            { level: 2, bp: 5000 },
          ],
          protectedFromNonGrandwalker: true,
        },
        getCardDef,
        "gw-1"
      );

      const updatedGw = getCard(result, "gw-1");
      expect(updatedGw.divineTransformState).not.toBeNull();
      expect(updatedGw.divineTransformState!.bpByLevel).toEqual([
        { level: 1, bp: 3000 },
        { level: 2, bp: 5000 },
      ]);
      expect(updatedGw.divineTransformState!.protectedFromNonGrandwalker).toBe(
        true
      );
    });

    it("tribe 不一致の創界神は転神対象外", () => {
      const gw = fieldCard("gw-1", "GW-001", ALICE, 5); // 夜錆系、アシハラではない
      const state = makeState({
        cardInstances: [gw],
        step: "attack",
        window: "none",
      });

      const result = executeDivineTransform(
        state,
        ALICE,
        {
          kind: "divine_transform",
          target: {
            player: "self",
            category: ["nexus"],
            tribes: ["アシハラ"],
            includeGrandwalker: true,
            count: -1,
          },
          bpByLevel: [{ level: 1, bp: 3000 }],
        },
        getCardDef,
        "gw-1"
      );

      const updatedGw = getCard(result, "gw-1");
      expect(updatedGw.divineTransformState).toBeNull();
    });
  });

  // ── isBattleCapableCategory ──

  describe("転神状態のバトル能力", () => {
    it("転神状態のネクサスはバトル可能", () => {
      const def = grandwalkerWithTransformDef();
      const card = createCardInstance(def, {
        instanceId: "gw-1",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      // 転神前: ネクサスはバトル不可
      expect(isBattleCapableCategory(def, card)).toBe(false);

      // 転神後: バトル可能
      const transformed = {
        ...card,
        divineTransformState: {
          bpByLevel: [{ level: 1, bp: 3000 }],
          protectedFromNonGrandwalker: true,
        },
      };
      expect(isBattleCapableCategory(def, transformed)).toBe(true);
    });
  });

  // ── BP 計算 ──

  describe("転神状態の BP 計算", () => {
    it("Lv1 (コア0) で divineTransformState の BP を使用する", () => {
      const def = grandwalkerWithTransformDef();
      const card = createCardInstance(def, {
        instanceId: "gw-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const transformed = {
        ...card,
        divineTransformState: {
          bpByLevel: [
            { level: 1, bp: 3000 },
            { level: 2, bp: 5000 },
          ],
          protectedFromNonGrandwalker: true,
        },
      };
      const state = makeState({ cardInstances: [transformed] });
      const bp = getEffectiveBp(state, transformed, def, getCardDef);
      expect(bp).toBe(3000);
    });

    it("Lv2 (コア4+) でレベルに応じた BP を返す", () => {
      const def = grandwalkerWithTransformDef();
      const card = createCardInstance(def, {
        instanceId: "gw-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 5,
      });
      const transformed = {
        ...card,
        divineTransformState: {
          bpByLevel: [
            { level: 1, bp: 3000 },
            { level: 2, bp: 5000 },
          ],
          protectedFromNonGrandwalker: true,
        },
      };
      const state = makeState({ cardInstances: [transformed] });
      const bp = getEffectiveBp(state, transformed, def, getCardDef);
      expect(bp).toBe(5000);
    });

    it("divineTransformState がなければ通常の BP (0) を返す", () => {
      const def = grandwalkerWithTransformDef();
      const card = createCardInstance(def, {
        instanceId: "gw-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 5,
      });
      const state = makeState({ cardInstances: [card] });
      // ネクサスの levelDefs にはBP=0
      const bp = getEffectiveBp(state, card, def, getCardDef);
      expect(bp).toBe(0);
    });
  });

  // ── シンボル ──

  describe("転神状態のシンボル", () => {
    it("divineTransformState.symbols があればそれを使用する", () => {
      const def = grandwalkerWithTransformDef();
      const card = createCardInstance(def, {
        instanceId: "gw-1",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const transformed = {
        ...card,
        divineTransformState: {
          bpByLevel: [{ level: 1, bp: 3000 }],
          symbols: ["red" as const],
          protectedFromNonGrandwalker: true,
        },
      };
      const state = makeState({ cardInstances: [transformed] });
      const symbols = getEffectiveSymbols(state, transformed, def, getCardDef);
      expect(symbols).toEqual(["red"]);
    });

    it("divineTransformState.symbols がなければカード本来のシンボルを使用する", () => {
      const def = grandwalkerWithTransformDef();
      const card = createCardInstance(def, {
        instanceId: "gw-1",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const transformed = {
        ...card,
        divineTransformState: {
          bpByLevel: [{ level: 1, bp: 3000 }],
          protectedFromNonGrandwalker: true,
        },
      };
      const state = makeState({ cardInstances: [transformed] });
      const symbols = getEffectiveSymbols(state, transformed, def, getCardDef);
      expect(symbols).toEqual(["green"]); // カード本来の色
    });
  });

  // ── 破壊保護 ──

  describe("protectedFromNonGrandwalker 破壊保護", () => {
    it("includeGrandwalker=true の破壊効果なら転神状態の創界神も破壊される", () => {
      const gw = fieldCard("gw-1", "GWT-001", ALICE, 0);
      const transformedGw = {
        ...gw,
        divineTransformState: {
          bpByLevel: [{ level: 1, bp: 3000 }],
          protectedFromNonGrandwalker: true,
        },
      };
      const state = makeState({
        cardInstances: [transformedGw],
      });

      // includeGrandwalker=true の破壊効果（創界神対象）
      const result = executeDestroy(
        state,
        ALICE,
        {
          player: "self",
          category: ["nexus"],
          includeGrandwalker: true,
          count: -1,
        },
        getCardDef,
        "other-card"
      );

      const gwCard = getCard(result, "gw-1");
      expect(gwCard.pendingLeaveKind).toBe("destroy");
    });

    it("includeGrandwalker=false の破壊は転神状態の創界神を対象にできない", () => {
      const gw = fieldCard("gw-1", "GWT-001", ALICE, 0);
      const transformedGw = {
        ...gw,
        divineTransformState: {
          bpByLevel: [{ level: 1, bp: 3000 }],
          protectedFromNonGrandwalker: true,
        },
      };
      const spirit = fieldCard("sp-1", "SP-001", ALICE, 1, {
        zoneRoleName: "spirit" as const,
      });
      const state = makeState({
        cardInstances: [transformedGw, spirit],
      });

      // 全カードを破壊しようとする効果（includeGrandwalker 未指定 = false）
      const result = executeDestroy(
        state,
        ALICE,
        {
          player: "self",
          count: -1,
        },
        getCardDef,
        "other-card"
      );

      // 転神状態の創界神は保護される（collectTargetCardCandidates が grandwalker を除外）
      const gwCard = getCard(result, "gw-1");
      expect(gwCard.pendingLeaveKind).toBeNull();
      // 通常スピリットは破壊される
      const spCard = getCard(result, "sp-1");
      expect(spCard.pendingLeaveKind).toBe("destroy");
    });
  });

  // ── 神技起動 → 転神実行の統合テスト ──

  describe("神技起動による転神実行 (統合テスト)", () => {
    it("use_divine_skill アクションで転神効果が実行される", () => {
      const gw = fieldCard("gw-1", "GWT-001", ALICE, 6);
      const state = makeState({
        cardInstances: [gw],
        activePlayerId: ALICE,
        step: "attack",
        window: "flash_before_block",
      });

      const result = applyLegalAction({
        state,
        action: {
          kind: "use_divine_skill",
          sourceInstanceId: "gw-1",
          sourceDefinitionId: "GWT-001",
          sourceCardNo: "GWT-001",
          skillIndex: 0,
          coreCost: 5,
          availableCores: 6,
          label: "divine_skill",
        },
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 発揮宣言でスタック窓が開く（コア消費・転神は窓クローズ後）。
      expect(result.state.stackWindow).not.toBeNull();
      const finalState = passStackUntilClosed(result.state);

      const updatedGw = getCard(finalState, "gw-1");
      // コア消費: 6 - 5 = 1
      expect(updatedGw.normalCoreCount).toBe(1);
      // 転神状態が設定されている
      expect(updatedGw.divineTransformState).not.toBeNull();
      expect(updatedGw.divineTransformState!.bpByLevel).toEqual([
        { level: 1, bp: 3000 },
        { level: 2, bp: 5000 },
      ]);
      expect(updatedGw.divineTransformState!.protectedFromNonGrandwalker).toBe(
        true
      );
    });

    it("コア不足で神技起動できない場合、getAvailableDivineSkillLegalActions が空を返す", () => {
      const gw = fieldCard("gw-1", "GWT-001", ALICE, 3); // コスト5に対し3個
      const state = makeState({
        cardInstances: [gw],
        activePlayerId: ALICE,
        step: "attack",
        window: "flash_before_block",
      });

      const actions = getAvailableDivineSkillLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
        getRegisteredFieldCardEffectActions: () => undefined,
      });
      expect(actions.length).toBe(0);
    });
  });
});

// ── F-3: 導界者ネクサス / 導シンボル条件分離 ──────────────────

describe("F-3: 導界者ネクサス条件分離 (Guided Nexus Condition Distinction)", () => {
  // ── field_has grandwalkerKind ──

  describe("field_has — grandwalkerKind フィルタ", () => {
    it("grandwalkerKind: 'grandwalker' は創界神のみカウント（導界者を含まない）", () => {
      // フィールドに導界者のみ → false
      const gnCard = fieldCard("gn-1", "GN-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({
        cardInstances: [gnCard, spiritCard],
      });
      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        grandwalkerKind: "grandwalker" as const,
      };
      const result = evaluateCondition(
        state,
        [clause],
        spiritCard.instanceId,
        ALICE,
        getCardDef
      );
      expect(result).toBe(false);
    });

    it("grandwalkerKind: 'grandwalker' は創界神がフィールドにあれば true", () => {
      const gwCard = fieldCard("gw-1", "GW-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({
        cardInstances: [gwCard, spiritCard],
      });
      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        grandwalkerKind: "grandwalker" as const,
      };
      const result = evaluateCondition(
        state,
        [clause],
        spiritCard.instanceId,
        ALICE,
        getCardDef
      );
      expect(result).toBe(true);
    });

    it("grandwalkerKind: 'guided' は導界者のみカウント（創界神を含まない）", () => {
      const gwCard = fieldCard("gw-1", "GW-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({
        cardInstances: [gwCard, spiritCard],
      });
      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        grandwalkerKind: "guided" as const,
      };
      const result = evaluateCondition(
        state,
        [clause],
        spiritCard.instanceId,
        ALICE,
        getCardDef
      );
      expect(result).toBe(false);
    });

    it("grandwalkerKind: 'guided' は導界者がフィールドにあれば true", () => {
      const gnCard = fieldCard("gn-1", "GN-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({
        cardInstances: [gnCard, spiritCard],
      });
      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        grandwalkerKind: "guided" as const,
      };
      const result = evaluateCondition(
        state,
        [clause],
        spiritCard.instanceId,
        ALICE,
        getCardDef
      );
      expect(result).toBe(true);
    });

    it("grandwalkerKind: 'any' は創界神・導界者どちらでも true", () => {
      // 創界神のみ
      const gwCard = fieldCard("gw-1", "GW-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const stateGW = makeState({ cardInstances: [gwCard, spiritCard] });

      // 導界者のみ
      const gnCard = fieldCard("gn-1", "GN-001", ALICE, 3);
      const stateGN = makeState({ cardInstances: [gnCard, spiritCard] });

      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        grandwalkerKind: "any" as const,
      };
      expect(
        evaluateCondition(
          stateGW,
          [clause],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          stateGN,
          [clause],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(true);
    });

    it("grandwalkerKind: 'any' は通常ネクサスでは false", () => {
      const nexusCard = fieldCard("n-1", "NEXUS-001", ALICE, 1);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({ cardInstances: [nexusCard, spiritCard] });
      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        grandwalkerKind: "any" as const,
      };
      expect(
        evaluateCondition(
          state,
          [clause],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(false);
    });

    it("grandwalkerKind は他のフィルタ（category）と組み合わせ可能", () => {
      const gwCard = fieldCard("gw-1", "GW-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({ cardInstances: [gwCard, spiritCard] });

      // category: nexus + grandwalkerKind: grandwalker → true（創界神ネクサス）
      const clause1 = {
        kind: "field_has" as const,
        player: "self" as const,
        category: ["nexus" as const],
        grandwalkerKind: "grandwalker" as const,
      };
      expect(
        evaluateCondition(
          state,
          [clause1],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(true);

      // category: spirit + grandwalkerKind: grandwalker → false（スピリットは創界神ではない）
      const clause2 = {
        kind: "field_has" as const,
        player: "self" as const,
        category: ["spirit" as const],
        grandwalkerKind: "grandwalker" as const,
      };
      expect(
        evaluateCondition(
          state,
          [clause2],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(false);
    });

    it("相手フィールドの判定にも対応する", () => {
      const gnCard = fieldCard("gn-1", "GN-001", BOB, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({ cardInstances: [gnCard, spiritCard] });

      const clause = {
        kind: "field_has" as const,
        player: "opponent" as const,
        grandwalkerKind: "guided" as const,
      };
      expect(
        evaluateCondition(
          state,
          [clause],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(true);
    });
  });

  // ── field_lacks grandwalkerKind ──

  describe("field_lacks — grandwalkerKind フィルタ", () => {
    it("field_lacks grandwalkerKind: 'grandwalker' — 導界者しかいなければ true", () => {
      const gnCard = fieldCard("gn-1", "GN-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({ cardInstances: [gnCard, spiritCard] });

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        grandwalkerKind: "grandwalker" as const,
      };
      expect(
        evaluateCondition(
          state,
          [clause],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(true);
    });

    it("field_lacks grandwalkerKind: 'grandwalker' — 創界神がいれば false", () => {
      const gwCard = fieldCard("gw-1", "GW-001", ALICE, 3);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({ cardInstances: [gwCard, spiritCard] });

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        grandwalkerKind: "grandwalker" as const,
      };
      expect(
        evaluateCondition(
          state,
          [clause],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(false);
    });

    it("field_lacks grandwalkerKind: 'any' — どちらもいなければ true", () => {
      const nexusCard = fieldCard("n-1", "NEXUS-001", ALICE, 1);
      const spiritCard = fieldCard("sp-1", "SP-001", ALICE, 1);
      const state = makeState({ cardInstances: [nexusCard, spiritCard] });

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        grandwalkerKind: "any" as const,
      };
      expect(
        evaluateCondition(
          state,
          [clause],
          spiritCard.instanceId,
          ALICE,
          getCardDef
        )
      ).toBe(true);
    });
  });

  // ── 対象判定の統一確認 ──

  describe("対象判定: targetsGrandwalker は両方をカバーする", () => {
    it("targetsGrandwalker: true は導界者も対象にできる", () => {
      const gnCard = fieldCard("gn-1", "GN-001", ALICE, 3);
      const gnDef = guidedNexusDef();
      const filter = { category: ["nexus" as const], targetsGrandwalker: true };

      expect(matchesCardFilter(gnCard, gnDef, filter)).toBe(true);
    });

    it("targetsGrandwalker なしでは導界者もフィールドで対象外", () => {
      const gnCard = fieldCard("gn-1", "GN-001", ALICE, 3);
      const gnDef = guidedNexusDef();
      const filter = { category: ["nexus" as const] };

      expect(matchesCardFilter(gnCard, gnDef, filter)).toBe(false);
    });
  });

  // ── 導シンボルの基本検証 ──

  describe("導シンボル (guide symbol) 型定義", () => {
    it("導界者ネクサスの symbolColors は guide", () => {
      const gnDef = guidedNexusDef();
      expect(gnDef.symbolColors).toContain("guide");
      expect(gnDef.symbolColors).not.toContain("god");
    });

    it("創界神ネクサスの symbolColors は god", () => {
      const gwDef = grandwalkerNexusDef();
      expect(gwDef.symbolColors).toContain("god");
      expect(gwDef.symbolColors).not.toContain("guide");
    });

    it("導界者の reductionSymbols は guide", () => {
      const gnDef = guidedNexusDef();
      expect(gnDef.reductionSymbols).toContain("guide");
    });
  });

  // ── 導技ラベル ──

  describe("DivineSkillEntry ラベル区分", () => {
    it("guided_skill ラベルを受け付ける", () => {
      const def = guidedNexusDef({
        grandwalkerData: {
          kind: "guided",
          oracleTriggerKinds: [
            "summon",
            "advent",
            "place",
            "use_magic",
            "use_accel",
          ] as const,
          oracleConditions: [
            { tribes: ["CB"], categories: ["spirit"], minCost: 3 },
          ],
          divineSkills: [
            {
              label: "guided_skill",
              coreCost: 2,
              timing: "main",
              minLevel: 1,
            },
          ],
        },
      });
      expect(def.grandwalkerData!.divineSkills![0].label).toBe("guided_skill");
    });
  });
});

// ── 実カード grandwalkerData 定義検証（導界者ネクサス変換タスク対象 4 枚） ──

describe("実カード grandwalkerData (BSTH01/02/02.7/03 導界者ネクサス)", () => {
  const realCardMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
  const realDef = (cardNo: string) => {
    const def = realCardMap.get(cardNo);
    if (!def) throw new Error(`card not found: ${cardNo}`);
    return def;
  };
  const getRealCardDefinitionById = (id: string) => realCardMap.get(id);
  const realTriggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

  describe("BSTH01-XX01 [導界者]八雲 紫", () => {
    const card = realDef("BSTH01-XX01");

    it("grandwalkerData: kind=guided / 導託〔幻想〕〔幻想＆アルティメット/ブレイヴ〕〔賢者＆ネクサス〕", () => {
      const gw = card.grandwalkerData!;
      expect(gw.kind).toBe("guided");
      expect(gw.placementOracle).toBeUndefined(); // 標準の配置時神託（3枚）
      expect(gw.oracleConditions).toEqual([
        { tribes: ["幻想"], categories: ["spirit"] },
        { tribes: ["幻想"], categories: ["ultimate", "brave"] },
        { tribes: ["賢者"], categories: ["nexus"] },
      ]);
      expect(card.keywordTags).toContain("guided_nexus");
      expect(card.keywordTags).toContain(
        "enter_field_core_placement_forbidden"
      );
    });

    it("導託マッチ: 幻想スピリットは対象、賢者ネクサス(自身)も対象", () => {
      const gw = card.grandwalkerData!;
      // BSTH02-X02 西行寺 幽々子 = 幻想・冥主 スピリット
      expect(matchesAnyOracleCondition(realDef("BSTH02-X02"), gw)).toBe(true);
      // BSTH02.7-C02 = 幻想・動玩 スピリット
      expect(matchesAnyOracleCondition(realDef("BSTH02.7-C02"), gw)).toBe(true);
      // 自身 = 導界者・賢者 ネクサス →〔賢者＆ネクサス〕に一致
      expect(matchesAnyOracleCondition(card, gw)).toBe(true);
      // BSTH02-X01 西行妖 = 導界者・冥主 ネクサス → どの条件にも非一致
      expect(matchesAnyOracleCondition(realDef("BSTH02-X01"), gw)).toBe(false);
    });

    it("effects: シンボル + 導域 の2件（導技は divineSkills へ移管）", () => {
      // 本体ルール/導託 stub は削除済み。導技=神技扱いで divineSkills へ移管したため
      // effects[] は continuous（シンボル treat_as）と 導域（unblockable）の2件。
      expect(card.effects).toHaveLength(2);
      expect(card.effects!.some((e) => e.timing.kind === "activated")).toBe(
        false
      );
      // 導技は divineSkills(coreCost:2, ターン2回) + deck_reveal 本体。
      const skill = card.grandwalkerData!.divineSkills![0]!;
      expect(skill.coreCost).toBe(2);
      expect(skill.timing).toBe("main");
      expect(skill.maxUsesPerTurn).toBe(2);
      expect(skill.effects![0]!.steps[0]!.action.kind).toBe("deck_reveal");
    });
  });

  describe("BSTH02-X01 西行妖", () => {
    const card = realDef("BSTH02-X01");

    it("grandwalkerData: kind=guided / 導託〔幻想＆冥主＆コスト5以上〕= tribesLogic AND で表現", () => {
      const gw = card.grandwalkerData!;
      expect(gw.kind).toBe("guided");
      expect(gw.oracleConditions).toEqual([
        {
          tribes: ["幻想", "冥主"],
          tribesLogic: "and",
          categories: ["spirit"],
          minCost: 5,
        },
      ]);
      expect(gw.placementOracle).toBeUndefined();
    });

    it("導託マッチ (tribesLogic AND): 幻想・冥主コスト7は対象、片系統のみ/低コストは対象外", () => {
      const gw = card.grandwalkerData!;
      // BSTH02-X02 西行寺 幽々子 = 幻想・冥主 コスト7 スピリット → AND 成立
      expect(matchesAnyOracleCondition(realDef("BSTH02-X02"), gw)).toBe(true);
      // BSTH02.7-C02 = 幻想・動玩 スピリット（冥主なし）→ AND 不成立
      expect(matchesAnyOracleCondition(realDef("BSTH02.7-C02"), gw)).toBe(
        false
      );
      // 自身（導界者・冥主 ネクサス）→ 幻想なし + spirit 限定で不成立
      expect(matchesAnyOracleCondition(card, gw)).toBe(false);
    });

    it("配置時神託は誘発任意効果としてキュー→発揮でデッキ上3枚をトラッシュ", () => {
      const nexus = createCardInstance(card, {
        instanceId: "saigyou-1",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const deckCard = createCardInstance(realDef("BSTH02-X02"), {
        instanceId: "deck-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const state = makeState({ cardInstances: [nexus, deckCard] });
      const queued = checkAndQueuePlacementOracle(
        state,
        "saigyou-1",
        getRealCardDefinitionById,
        "test:phase-f-grandwalker:3350"
      );
      expect(
        queued.pendingTriggeredEffects.filter(
          (p) => p.mechanic?.kind === "placement_oracle"
        )
      ).toHaveLength(1);

      const after = resolvePlacementOracleMechanic(
        queued,
        { kind: "placement_oracle", grandwalkerInstanceId: "saigyou-1" },
        getRealCardDefinitionById
      );
      // デッキ1枚トラッシュ。幽々子 (幻想・冥主 コスト7) は導託対象 → コア+1 を強制配置
      expect(getCard(after, "deck-1").zone).toBe("trash");
      expect(getCard(after, "saigyou-1").normalCoreCount).toBe(1);
    });

    it("導域:1 は各ステップ開始時 + 3条件 + 対象コア選択(choice) + 消滅数補充の steps で表現済み(stub解消)", () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(8))!;
      expect(domain.timing).toEqual({
        kind: "phase",
        whose: "either",
        subPhase: "start",
      });
      expect(domain.condition).toEqual([
        { kind: "grandwalker_core_count", min: 1 },
        {
          kind: "field_has",
          player: "either",
          sumAcrossPlayers: true,
          cardNames: [{ contains: "西行妖" }],
          minCount: 1,
          maxCount: 1,
        },
        {
          kind: "field_core_sum_both_players",
          min: 5,
          excludeGrandwalker: true,
          excludeGrandstone: true,
        },
      ]);
      expect(domain.stub).toBeUndefined();
      expect(domain.steps).toHaveLength(2);
      const shoot = domain.steps[0]!;
      expect(shoot.id).toBe("x01-void-shoot");
      expect(shoot.choice).toBeUndefined();
      expect(shoot.action).toMatchObject({
        kind: "core_move",
        from: { kind: "union" },
        to: { kind: "void" },
        amount: 1,
      });
      const fill = domain.steps[1]!;
      expect(fill.stepCondition).toEqual({
        kind: "ref_leave_established",
        stepId: "x01-void-shoot",
        leaveKind: "vanish",
      });
      expect(fill.action).toEqual({
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "this_card" },
        amount: {
          source: {
            kind: "cards_from_ref",
            stepId: "x01-void-shoot",
            establishedLeaveKind: "vanish",
          },
        },
      });
    });

    it("対象コアフィルタ: 創界神ネクサスは対象・導界者ネクサス(西行妖以外)も対象・通常カードは対象(創界神を含む共通候補、P3-134回帰確認)", () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(8))!;
      const filter =
        domain.steps[0]!.action.kind === "core_move" &&
        domain.steps[0]!.action.from.kind === "union"
          ? (
              domain.steps[0]!.action.from.sources[0] as {
                filter?: import("../src/dsl-types").CardFilter;
              }
            ).filter
          : undefined;
      expect(filter).toBeDefined();
      // BSTH03-X02「[導界者]八意 永琳」= 導界者ネクサス(kind:"guided")。[P3-134修正 2026-08-02]
      // qa-002 (external-qa/qaData.js)「導界者ネクサスは創界神ネクサス対象のコア移動系効果を
      // 受ける」により、原文が「創界神ネクサス」とだけ書いていても導界者ネクサスは対象に含む
      // (targetsGrandwalker:true(boolean)では grandwalkerKind が無視され誤って対象になる、
      // card-filter.ts:293 admitsAsGrandwalkerOnlyTarget の "only" 判定が唯一の入口。
      // grandwalkerKind は絞らず既定"any"のまま)。
      const guidedNexus = createCardInstance(realDef("BSTH03-X02"), {
        instanceId: "guided-nexus-other",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      expect(
        matchesCardFilter(guidedNexus, realDef("BSTH03-X02"), filter!, {
          cardZone: "field",
        })
      ).toBe(true);
      // BSLH01 の創界神ネクサス(kind:"grandwalker")は対象。
      const grandwalkerCardNo = ALL_CARDS.find(
        (c) => c.grandwalkerData?.kind === "grandwalker"
      )!.cardNo;
      const grandwalkerNexus = createCardInstance(realDef(grandwalkerCardNo), {
        instanceId: "grandwalker-nexus",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      expect(
        matchesCardFilter(
          grandwalkerNexus,
          realDef(grandwalkerCardNo),
          filter!,
          { cardZone: "field" }
        )
      ).toBe(true);
      // 通常カード(BSTH02-X02 幽々子、grandwalkerData 無し)は対象。
      const ordinary = createCardInstance(realDef("BSTH02-X02"), {
        instanceId: "ordinary-spirit",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      expect(
        matchesCardFilter(ordinary, realDef("BSTH02-X02"), filter!, {
          cardZone: "field",
        })
      ).toBe(true);
    });

    it("実行: 自分のリザーブから対象コア1個を共通候補から選びボイドに置く", () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(8))!;
      const saigyou = createCardInstance(card, {
        instanceId: "saigyou-shoot",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state = makeState({ cardInstances: [saigyou] });
      let after = executeEffect({
        chainId: "test:phase-f-grandwalker:3496",
        state,
        effect: domain,
        effectIndex: card.effects!.indexOf(domain),
        sourceInstanceId: "saigyou-shoot",
        actingPlayerId: ALICE,
        getCardDefinitionById: getRealCardDefinitionById,
        getRegisteredTriggeredEffectActions: realTriggeredLookup,
      });
      expect(after.pendingStepChoice).toBeNull();
      const allocation = getLegalActions({
        state: after,
        actingPlayerId: ALICE,
        getCardDefinitionById: getRealCardDefinitionById,
      }).find((a) => a.kind === "resolve_core_source_allocation")!;
      after = applyLegalAction({
        state: after,
        action: allocation,
        getCardDefinitionById: getRealCardDefinitionById,
        getRegisteredTriggeredEffectActions: realTriggeredLookup,
        coreSourceAllocations: { [`reserve:${ALICE}`]: 1 },
      }).state;
      const alicePlayer = after.players.find((p) => p.id === ALICE)!;
      expect(alicePlayer.reserveNormalCoreCount).toBe(9);
      expect(alicePlayer.voidNormalCoreCount).toBe(101);
      // 西行妖自身はコア不変(コアシュートの対象にしていない)。
      expect(
        after.cardInstances.find((c) => c.instanceId === "saigyou-shoot")!
          .normalCoreCount
      ).toBe(1);
    });

    it("実行: 自分のフィールドの対象コア除去でスピリットが消滅したら、消滅数分だけボイドから西行妖にコアを補充する", () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(8))!;
      const saigyou = createCardInstance(card, {
        instanceId: "saigyou-vanish",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      // BSTH02-X02 [幽々子]の最低Lv(Lv1)requiredCores=1。コア1個→0個で維持不能=消滅。
      // 西行妖(excludeSelf で対象外)以外の唯一の候補なので count:1 が一意に自動解決する。
      const vanishTarget = createCardInstance(realDef("BSTH02-X02"), {
        instanceId: "vanish-target",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state = makeState({ cardInstances: [saigyou, vanishTarget] });
      let after = executeEffect({
        chainId: "test:phase-f-grandwalker:3545",
        state,
        effect: domain,
        effectIndex: card.effects!.indexOf(domain),
        sourceInstanceId: "saigyou-vanish",
        actingPlayerId: ALICE,
        getCardDefinitionById: getRealCardDefinitionById,
        getRegisteredTriggeredEffectActions: realTriggeredLookup,
      });
      expect(after.pendingStepChoice).toBeNull();
      const allocation = getLegalActions({
        state: after,
        actingPlayerId: ALICE,
        getCardDefinitionById: getRealCardDefinitionById,
      }).find((a) => a.kind === "resolve_core_source_allocation")!;
      after = applyLegalAction({
        state: after,
        action: allocation,
        getCardDefinitionById: getRealCardDefinitionById,
        getRegisteredTriggeredEffectActions: realTriggeredLookup,
        coreSourceAllocations: { ["vanish-target"]: 1 },
      }).state;
      const vanished = after.cardInstances.find(
        (c) => c.instanceId === "vanish-target"
      )!;
      expect(vanished.zone).not.toBe("field");
      const saigyouAfter = after.cardInstances.find(
        (c) => c.instanceId === "saigyou-vanish"
      )!;
      // 消滅1体分、ボイドから西行妖へコア+1 (元の1個 + 補充1個 = 2個)。
      expect(saigyouAfter.normalCoreCount).toBe(2);
    });

    it("「西行妖」が2体以上場にいるときは【導域:1】が成立しない (field_has minCount/maxCount 一意性ゲート)", () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(8))!;
      const saigyou1 = createCardInstance(card, {
        instanceId: "saigyou-dup-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const saigyou2 = createCardInstance(card, {
        instanceId: "saigyou-dup-2",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const state = makeState({
        cardInstances: [saigyou1, saigyou2],
      });
      expect(
        evaluateCondition(
          state,
          domain.condition!,
          "saigyou-dup-1",
          ALICE,
          getRealCardDefinitionById
        )
      ).toBe(false);
    });

    it('自分1体+相手1体(合計2体)のときも【導域:1】が成立しない (sumAcrossPlayers 回帰確認、field_has.player:"either" 単独のOR判定では誤ってtrueになる)', () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(8))!;
      const saigyouSelf = createCardInstance(card, {
        instanceId: "saigyou-self-1v1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const saigyouOpponent = createCardInstance(card, {
        instanceId: "saigyou-opp-1v1",
        ownerPlayerId: BOB,
        zone: "field",
      });
      const state = makeState({
        cardInstances: [saigyouSelf, saigyouOpponent],
      });
      expect(
        evaluateCondition(
          state,
          domain.condition!,
          "saigyou-self-1v1",
          ALICE,
          getRealCardDefinitionById
        )
      ).toBe(false);
    });

    it("「西行妖」がちょうど1体・コア条件も充足のとき【導域:1】が成立する (肯定ケース)", () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(8))!;
      const saigyou = createCardInstance(card, {
        instanceId: "saigyou-solo",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      // makeState 既定は両者 reserveNormalCoreCount:10 (>= field_core_sum_both_players の min:5) で
      // 自分/相手とも合算コア条件を満たす。
      const state = makeState({ cardInstances: [saigyou] });
      expect(
        evaluateCondition(
          state,
          domain.condition!,
          "saigyou-solo",
          ALICE,
          getRealCardDefinitionById
        )
      ).toBe(true);
    });
  });

  describe("BSTH02.7-CX01 ［魔導と叡智の契約者］アリス・マーガトロイド", () => {
    const card = realDef("BSTH02.7-CX01");

    it("grandwalkerData: kind=guided / 導託〔動玩/四道/導魔＆コスト3以上〕〔転醒ネクサス〕", () => {
      const gw = card.grandwalkerData!;
      expect(gw.kind).toBe("guided");
      expect(gw.oracleExecutionMode).toBe("optional");
      expect(gw.placementOracle).toEqual({
        sameNameGate: false,
        turnLimit: "per_card_name",
      });
      expect(gw.oracleConditions).toEqual([
        {
          tribes: ["動玩", "四道", "導魔"],
          minCost: 3,
          categories: ["spirit", "nexus"],
        },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ]);
    });

    it("導託マッチ: 動玩コスト5スピリットは対象、幻想・冥主スピリットは対象外", () => {
      const gw = card.grandwalkerData!;
      expect(matchesAnyOracleCondition(realDef("BSTH02.7-C02"), gw)).toBe(true);
      expect(matchesAnyOracleCondition(realDef("BSTH02-X02"), gw)).toBe(false);
    });

    it.each([
      ["summon", "BSTH02.7-C02", false],
      ["summon", "BSTH02.7-C02", true],
      ["place", "BSTH02.7-TR01(A)", false],
      ["place", "BSTH02.7-TR01(A)", true],
    ] as const)(
      "BSTH02.7-CX01 通常導託は任意: %s / %s / 辞退=%s",
      (triggerKind, cardNo, skip) => {
        const matchDef = realDef(cardNo);
        const nexus = createCardInstance(card, {
          instanceId: "alice-cx01",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        });
        const summoned = createCardInstance(matchDef, {
          instanceId: "alice-match-spirit",
          ownerPlayerId: ALICE,
          zone: "field",
        });
        const state0 = makeState({ cardInstances: [nexus, summoned] });
        const state1 = checkAndQueueOracleChoices(
          state0,
          "alice-match-spirit",
          triggerKind,
          getCardDef,
          "test:phase-f-grandwalker:3696"
        );
        const pending = oraclePendings(state1).find(
          (p) => p.mechanic.grandwalkerInstanceId === "alice-cx01"
        );
        expect(pending).toBeDefined();

        const actions = getLegalActions({
          state: state1,
          actingPlayerId: ALICE,
          getCardDefinitionById: getCardDef,
        });
        const action = actions.find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.pendingId === pending!.pendingId
        );
        expect(action).toBeDefined();
        expect(action!.executionMode).toBe("optional");

        const voidBefore = getPlayer(state1, ALICE).voidNormalCoreCount;
        const declared = (
          applyLegalAction({
            state: state1,
            action: action!,
            getCardDefinitionById: getCardDef,
            skipOptionalEffect: skip,
          }) as { state: GameState }
        ).state;
        if (skip) expect(declared.stackWindow).toBeNull();
        else expect(declared.stackWindow).not.toBeNull();

        const resolved = passStackUntilClosed(declared);
        expect(getCard(resolved, "alice-cx01").normalCoreCount).toBe(
          skip ? 0 : 1
        );
        expect(getPlayer(resolved, ALICE).voidNormalCoreCount).toBe(
          voidBefore - (skip ? 0 : 1)
        );
        expect(oraclePendings(resolved)).toHaveLength(0);
      }
    );

    it("【復活】= 魂状態限定 activated main + place(self) + ターンに1回:同名", () => {
      const revive = card.effects![0]!;
      expect(revive.timing).toEqual({ kind: "activated", mode: "main" });
      expect(revive.applicability).toEqual({ soulState: true });
      expect(revive.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
      });
      const action = revive.steps[0]!.action;
      expect(action.kind).toBe("place");
      if (action.kind === "place") {
        expect(action.target).toEqual({ kind: "self" });
      }
    });

    it("【契約技：3/4】= divineSkills（4個=回復 / 3個=二択移動後に黄ならデッキ下ドロー）", () => {
      // 契約技=神技扱い → grandwalkerData.divineSkills へ移管。コアコストはエンジン側。
      const skills = card.grandwalkerData!.divineSkills!;
      expect(skills).toHaveLength(2);
      const skill4 = skills.find((s) => s.coreCost === 4)!;
      expect(skill4.timing).toBe("flash");
      expect(skill4.turnLimit).toBe("once");
      expect(skill4.effects![0]!.steps[0]!.action.kind).toBe("recover");
      const skill3 = skills.find((s) => s.coreCost === 3)!;
      expect(skill3.timing).toBe("flash");
      expect(skill3.effects).toHaveLength(1);
      const [move, draw] = skill3.effects![0]!.steps;
      expect(move!.action.kind).toBe("move_card");
      expect(move!.choice).toHaveLength(1);
      expect(draw!.action).toEqual({
        kind: "draw",
        count: 1,
        position: "bottom",
      });
      expect(draw!.stepCondition).toEqual({
        kind: "ref_has_color",
        stepId: "contract3-move",
        colors: ["yellow"],
      });
      // effects[] 側に activated/flash の契約技は残っていない（残るは【復活】main のみ）。
      expect(
        card.effects!.some(
          (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
        )
      ).toBe(false);
    });
  });

  describe("BSTH03-X02 [導界者]八意 永琳", () => {
    const card = realDef("BSTH03-X02");

    it("grandwalkerData: kind=guided / 導託〔想獣／魔影＆コスト3以上〕〔想獣／魔影＆アルティメット〕", () => {
      const gw = card.grandwalkerData!;
      expect(gw.kind).toBe("guided");
      expect(gw.placementOracle).toBeUndefined();
      expect(gw.oracleConditions).toEqual([
        { tribes: ["想獣", "魔影"], categories: ["spirit"], minCost: 3 },
        { tribes: ["想獣", "魔影"], categories: ["ultimate"] },
      ]);
    });

    it("導託マッチ: 魔影アルティメットは対象、幻想・冥主スピリットは対象外", () => {
      const gw = card.grandwalkerData!;
      // BSTH03-M07 = 幻想・魔影・冥主 アルティメット
      expect(matchesAnyOracleCondition(realDef("BSTH03-M07"), gw)).toBe(true);
      expect(matchesAnyOracleCondition(realDef("BSTH02-X02"), gw)).toBe(false);
    });

    it("シンボル黄/紫/究極 treat_as + フィールド離脱耐性 effect_resistance(source:all) + 配置コスト下限 cost_modify(floor:1)", () => {
      const symbols = card.effects![0]!;
      const kinds = symbols.steps.map((s) => s.action.kind);
      expect(kinds).toEqual([
        "treat_as",
        "treat_as",
        "treat_as",
        "effect_resistance",
        "cost_modify",
      ]);
      const ultimate = symbols.steps[2]!.action;
      if (ultimate.kind === "treat_as") {
        expect(ultimate.asColor).toBe("ultimate_symbol");
      }
      const resistance = symbols.steps[3]!.action;
      expect(resistance.kind).toBe("effect_resistance");
      if (resistance.kind === "effect_resistance") {
        expect(resistance.target).toEqual({ kind: "self" });
        expect(resistance.source).toBe("all");
        expect(resistance.resistsOutcome).toBe("leave_field");
      }
      // 「このカードの配置コスト0にならない」= コスト軽減下限 floor:1。
      const costFloor = symbols.steps[4]!.action;
      expect(costFloor.kind).toBe("cost_modify");
      if (costFloor.kind === "cost_modify") {
        expect(costFloor.target).toEqual({ kind: "self" });
        expect(costFloor.modifier).toEqual({ floor: 1 });
      }
    });

    it("導域: engine-effect-tribe-tag-life-increase-trigger でライフ増加検知 (core_placed_on_life) + 系統タグフィルタ (trigger_tribes) を表現し、stub が外れている", () => {
      const domain = card.effects!.find((e) => (e.textRef ?? []).includes(11))!;
      expect(domain.timing).toEqual({
        kind: "game_event",
        player: "self",
        event: "core_placed_on_life",
      });
      expect(domain.condition).toEqual([
        { kind: "min_level", value: 2 },
        { kind: "trigger_source_player", player: "self" },
        { kind: "trigger_tribes", tribes: ["蓬莱"] },
      ]);
      expect(domain.usageLimit).toEqual({ kind: "no_duplicate" });
      expect(domain.steps).toHaveLength(1);
      expect(domain.steps[0]!.action).toEqual({
        kind: "core_move",
        from: { kind: "life", player: "opponent" },
        to: { kind: "reserve", player: "opponent" },
        amount: 1,
      });
      expect(domain.stub).toBeUndefined();
    });
  });
});

// ── F-real: 実カードの神託/導託は grandwalkerData が engine 表現する ──────────
//
// 実カードの【神託】/【導託】(召喚/煌臨/配置時コア+1・配置時デッキ3枚トラッシュ→対象毎コア) は
// effects[] に DSL 効果を持たず、grandwalkerData + keywordTags のみで engine が表現する。
// 過去これらカードには「導界者システムはタスクBで対応」等の placeholder stub が残っていたが、
// oracle-system（checkAndQueueOracleChoices / checkAndQueuePlacementOracle, effect-resolution
// 774/785 で配線済み）が data 駆動で表現するため stub を撤去した。本テストは撤去後も実カードの
// grandwalkerData で両 oracle 経路が実際に発火することを盤面で保証する（stale stub 再付与の回帰防止）。

/** 実カード def を ALL_CARDS から引く map（cardNo→def）。 */
const REAL_DEF_MAP = new Map<string, CardDefinition>();
for (const c of ALL_CARDS) REAL_DEF_MAP.set(c.cardNo, c);

/** oracleConditions[0]（系統ベース）にマッチする合成スピリット def を作る。 */
function oracleMatchSpiritForCondition(
  cond: { tribes?: string[]; categories?: string[]; minCost?: number },
  cardNo: string
): CardDefinition {
  const tribe = cond.tribes?.[0] ?? "夜錆";
  const category = (cond.categories?.[0] ??
    "spirit") as CardDefinition["printedCategory"];
  const cost = Math.max(cond.minCost ?? 1, 3);
  return {
    cardNo,
    name: `match-${cardNo}`,
    printedCategory: category,
    colors: ["yellow"],
    cost,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe,
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

describe.each([
  ["BSLH01-X01", "guided"],
  ["BSLH01-X02", "grandwalker"],
  ["BSSA01-XX01", "grandwalker"],
  ["BSTH003-X01", "guided"],
  ["BSTH003-X03", "guided"],
  ["BSTH04-X01", "guided"],
  ["BSTH04-XX01", "guided"],
  ["BSTH05-X01", "grandwalker"],
  ["BSTH05-X02", "grandwalker"],
] as const)(
  "F-real: %s の oracle は grandwalkerData で発火する",
  (cardNo, expectedKind) => {
    const nexusDef = REAL_DEF_MAP.get(cardNo)!;

    it("def が存在し grandwalkerData.kind が一致、oracle 対象条件 stub を持たない", () => {
      expect(nexusDef).toBeDefined();
      expect(nexusDef.grandwalkerData?.kind).toBe(expectedKind);
      const oracleStubs = (nexusDef.effects ?? []).filter(
        (e) =>
          typeof e.stub === "string" &&
          /導託|神託|導界者ネクサス|創界神ネクサス対象/.test(e.stub)
      );
      expect(oracleStubs).toHaveLength(0);
    });

    it("配置時 oracle: checkAndQueuePlacementOracle が発火しデッキ3枚トラッシュ→マッチ分コアを置く", () => {
      const cond = nexusDef.grandwalkerData!.oracleConditions[0]!;
      const matchDef = oracleMatchSpiritForCondition(cond, `TM-${cardNo}`);
      const getDef = (id: string): CardDefinition | undefined =>
        id === matchDef.cardNo ? matchDef : REAL_DEF_MAP.get(id);

      const nexus = createCardInstance(nexusDef, {
        instanceId: "gw-real",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const deck = [0, 1, 2].map((i) =>
        createCardInstance(matchDef, {
          instanceId: `deck-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
        })
      );
      let state = makeState({
        cardInstances: [nexus, ...deck],
        players: [
          { ...makeState().players[0]!, deckCount: 3 },
          makeState().players[1]!,
        ],
      });

      state = checkAndQueuePlacementOracle(
        state,
        "gw-real",
        getDef,
        "test:phase-f-grandwalker:3954"
      );
      const queued = state.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "placement_oracle"
      );
      expect(queued).toHaveLength(1);

      const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
      state = resolvePlacementOracleMechanic(
        state,
        { kind: "placement_oracle", grandwalkerInstanceId: "gw-real" },
        getDef
      );
      expect(getCard(state, "deck-0").zone).toBe("trash");
      expect(getCard(state, "deck-1").zone).toBe("trash");
      expect(getCard(state, "deck-2").zone).toBe("trash");
      // マッチ3枚 → コア+3（強制配置）
      expect(getCard(state, "gw-real").normalCoreCount).toBe(3);
      expect(getPlayer(state, ALICE).voidNormalCoreCount).toBe(voidBefore - 3);
    });

    it("召喚時 oracle: マッチスピリット召喚で checkAndQueueOracleChoices が発火する", () => {
      const cond = nexusDef.grandwalkerData!.oracleConditions[0]!;
      const matchDef = oracleMatchSpiritForCondition(cond, `TM-${cardNo}`);
      const getDef = (id: string): CardDefinition | undefined =>
        id === matchDef.cardNo ? matchDef : REAL_DEF_MAP.get(id);

      const nexus = createCardInstance(nexusDef, {
        instanceId: "gw-real",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const summoned = createCardInstance(matchDef, {
        instanceId: "sp-1",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const state0 = makeState({ cardInstances: [nexus, summoned] });
      const state = checkAndQueueOracleChoices(
        state0,
        "sp-1",
        "summon",
        getDef,
        "test:phase-f-grandwalker:3992"
      );
      const oracleQueued = state.pendingTriggeredEffects.filter(
        (p) =>
          p.mechanic?.kind === "oracle" &&
          p.mechanic.grandwalkerInstanceId === "gw-real"
      );
      expect(oracleQueued).toHaveLength(1);
    });
  }
);

describe("EDH-0002-01: 神託後の継続効果再評価", () => {
  it("BSTH003-X03 が導託で Lv2 になった直後にアタックステップ終了禁止 CE を登録する", () => {
    const nexus = REAL_DEF_MAP.get("BSTH003-X03")!;
    const oracleCondition = nexus.grandwalkerData!.oracleConditions[0]!;
    const matchingSpirit = oracleMatchSpiritForCondition(
      oracleCondition,
      "EDH-X03-ORACLE-MATCH"
    );
    const getDefinition = (id: string): CardDefinition | undefined =>
      id === matchingSpirit.cardNo ? matchingSpirit : getCardDef(id);
    const nexusInstance = createCardInstance(nexus, {
      instanceId: "edh-x03-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const summonedSpirit = createCardInstance(matchingSpirit, {
      instanceId: "edh-x03-summoned-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = makeState({
      cardInstances: [nexusInstance, summonedSpirit],
    });

    state = checkAndQueueOracleChoices(
      state,
      summonedSpirit.instanceId,
      "summon",
      getDefinition,
      "test:phase-f-grandwalker:4033"
    );
    const pending = oraclePendings(state);
    expect(pending).toHaveLength(1);

    state = resolveOracleMechanicPending(state, pending[0]!.pendingId, true);

    expect(getCard(state, nexusInstance.instanceId).normalCoreCount).toBe(1);
    expect(state.activeContinuousEffects).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: nexusInstance.instanceId,
        sourceDefinitionId: "BSTH003-X03",
        modifierTag: "restrict_end_attack_step",
        targetInstanceId: BOB,
        provenance: expect.objectContaining({ effectIndex: 1 }),
      })
    );
  });
});

it("F-real: BSLH01-X01 の召喚/煌臨導託は辞退後なら同ステップで再度キューできる", () => {
  const nexusDef = REAL_DEF_MAP.get("BSLH01-X01")!;
  const cond = nexusDef.grandwalkerData!.oracleConditions[0]!;
  const matchDef = oracleMatchSpiritForCondition(cond, "TM-BSLH01-X01");
  const getDef = (id: string): CardDefinition | undefined =>
    id === matchDef.cardNo ? matchDef : REAL_DEF_MAP.get(id);
  const nexus = createCardInstance(nexusDef, {
    instanceId: "x01-guided",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const summonedA = createCardInstance(matchDef, {
    instanceId: "sp-a",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const summonedB = createCardInstance(matchDef, {
    instanceId: "sp-b",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const state0 = makeState({ cardInstances: [nexus, summonedA, summonedB] });
  const state1 = checkAndQueueOracleChoices(
    state0,
    "sp-a",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4079"
  );
  const firstQueued = oraclePendings(state1).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(firstQueued).toHaveLength(1);

  const declined = resolveOracleMechanicPending(
    state1,
    firstQueued[0]!.pendingId,
    false
  );
  const state2 = checkAndQueueOracleChoices(
    declined,
    "sp-b",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4090"
  );

  const oracleQueued = oraclePendings(state2).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(oracleQueued).toHaveLength(1);
  expect(oracleQueued[0]!.mechanic.triggerCardInstanceId).toBe("sp-b");
});

it("F-real: BSLH01-X01 の召喚/煌臨導託は未解決pendingをstep_once予約として扱う", () => {
  const nexusDef = REAL_DEF_MAP.get("BSLH01-X01")!;
  const cond = nexusDef.grandwalkerData!.oracleConditions[0]!;
  const matchDef = oracleMatchSpiritForCondition(cond, "TM-BSLH01-X01");
  const getDef = (id: string): CardDefinition | undefined =>
    id === matchDef.cardNo ? matchDef : REAL_DEF_MAP.get(id);
  const nexus = createCardInstance(nexusDef, {
    instanceId: "x01-guided",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const summonedA = createCardInstance(matchDef, {
    instanceId: "sp-a",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const summonedB = createCardInstance(matchDef, {
    instanceId: "sp-b",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const state0 = makeState({ cardInstances: [nexus, summonedA, summonedB] });
  const state1 = checkAndQueueOracleChoices(
    state0,
    "sp-a",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4122"
  );
  const state2 = checkAndQueueOracleChoices(
    state1,
    "sp-b",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4123"
  );

  const oracleQueued = oraclePendings(state2).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(oracleQueued).toHaveLength(1);
  expect(oracleQueued[0]!.mechanic.triggerCardInstanceId).toBe("sp-a");
});

it("F-real: BSLH01-X01 の召喚/煌臨導託は受諾宣言後のactive stackをstep_once予約として扱う", () => {
  const nexusDef = REAL_DEF_MAP.get("BSLH01-X01")!;
  const cond = nexusDef.grandwalkerData!.oracleConditions[0]!;
  const matchDef = oracleMatchSpiritForCondition(cond, "TM-BSLH01-X01");
  const getDef = (id: string): CardDefinition | undefined =>
    id === matchDef.cardNo ? matchDef : REAL_DEF_MAP.get(id);
  const nexus = createCardInstance(nexusDef, {
    instanceId: "x01-guided",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const summonedA = createCardInstance(matchDef, {
    instanceId: "sp-a",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const summonedB = createCardInstance(matchDef, {
    instanceId: "sp-b",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const state0 = makeState({ cardInstances: [nexus, summonedA, summonedB] });
  const state1 = checkAndQueueOracleChoices(
    state0,
    "sp-a",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4155"
  );
  const firstQueued = oraclePendings(state1).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(firstQueued).toHaveLength(1);
  const actions = getLegalActions({
    state: state1,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
  const resolve = actions.find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.pendingId === firstQueued[0]!.pendingId
  );
  expect(resolve).toBeDefined();
  const declared = (
    applyLegalAction({
      state: state1,
      action: resolve!,
      getCardDefinitionById: getDef,
    }) as { state: GameState }
  ).state;
  expect(declared.stackWindow).not.toBeNull();
  expect(oraclePendings(declared)).toHaveLength(0);

  const state2 = checkAndQueueOracleChoices(
    declared,
    "sp-b",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4181"
  );
  const oracleQueued = oraclePendings(state2).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(oracleQueued).toHaveLength(0);
});

it("F-real: BSLH01-X01 の召喚/煌臨導託は受諾後なら同ステップで再キューしない", () => {
  const nexusDef = REAL_DEF_MAP.get("BSLH01-X01")!;
  const cond = nexusDef.grandwalkerData!.oracleConditions[0]!;
  const matchDef = oracleMatchSpiritForCondition(cond, "TM-BSLH01-X01");
  const getDef = (id: string): CardDefinition | undefined =>
    id === matchDef.cardNo ? matchDef : REAL_DEF_MAP.get(id);
  const nexus = createCardInstance(nexusDef, {
    instanceId: "x01-guided",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const summonedA = createCardInstance(matchDef, {
    instanceId: "sp-a",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const summonedB = createCardInstance(matchDef, {
    instanceId: "sp-b",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const state0 = makeState({ cardInstances: [nexus, summonedA, summonedB] });
  const state1 = checkAndQueueOracleChoices(
    state0,
    "sp-a",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4211"
  );
  const firstQueued = oraclePendings(state1).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(firstQueued).toHaveLength(1);

  const accepted = resolveOracleMechanicPending(
    state1,
    firstQueued[0]!.pendingId,
    true
  );
  expect(getCard(accepted, "x01-guided").normalCoreCount).toBe(1);
  const state2 = checkAndQueueOracleChoices(
    accepted,
    "sp-b",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4223"
  );

  const oracleQueued = oraclePendings(state2).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(oracleQueued).toHaveLength(0);
});

it("F-real: BSLH01-X01 の召喚/煌臨導託はボイド枯渇で不発ならステップ1回を消費しない", () => {
  const nexusDef = REAL_DEF_MAP.get("BSLH01-X01")!;
  const cond = nexusDef.grandwalkerData!.oracleConditions[0]!;
  const matchDef = oracleMatchSpiritForCondition(cond, "TM-BSLH01-X01");
  const getDef = (id: string): CardDefinition | undefined =>
    id === matchDef.cardNo ? matchDef : REAL_DEF_MAP.get(id);
  const nexus = createCardInstance(nexusDef, {
    instanceId: "x01-guided",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const summonedA = createCardInstance(matchDef, {
    instanceId: "sp-a",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const summonedB = createCardInstance(matchDef, {
    instanceId: "sp-b",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const state0 = makeState({ cardInstances: [nexus, summonedA, summonedB] });
  const state1 = checkAndQueueOracleChoices(
    state0,
    "sp-a",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4254"
  );
  const firstQueued = oraclePendings(state1).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(firstQueued).toHaveLength(1);

  const starved = {
    ...state1,
    players: state1.players.map((p) =>
      p.id === ALICE ? { ...p, voidNormalCoreCount: 0 } : p
    ),
  };
  const noCore = resolveOracleMechanicPending(
    starved,
    firstQueued[0]!.pendingId,
    true
  );
  expect(getCard(noCore, "x01-guided").normalCoreCount).toBe(0);
  expect(
    noCore.effectUsageRecords.some(
      (r) =>
        r.sourceInstanceId === "x01-guided" &&
        r.effectLabel === "oracle:summon_advent"
    )
  ).toBe(false);

  const replenished = {
    ...noCore,
    players: noCore.players.map((p) =>
      p.id === ALICE ? { ...p, voidNormalCoreCount: 1 } : p
    ),
  };
  const state2 = checkAndQueueOracleChoices(
    replenished,
    "sp-b",
    "summon",
    getDef,
    "test:phase-f-grandwalker:4286"
  );
  const oracleQueued = oraclePendings(state2).filter(
    (p) => p.mechanic.grandwalkerInstanceId === "x01-guided"
  );
  expect(oracleQueued).toHaveLength(1);
  expect(oracleQueued[0]!.mechanic.triggerCardInstanceId).toBe("sp-b");
});
