/**
 * ENGINE-brave-combine-nexus-host alternatives: BSTH003-C31/M02 の
 * 「【合体条件：導魔＆コスト5以上】(スピリット) or【合体条件：導魔＆導界者ネクサス】」
 * 二択合体条件 + ホスト種別限定効果 (combined_host_category) + 軽減シンボル色限定免除
 * (treat_as waivesReductionRequirement + waiverColors) の stub 解消検証。
 *
 * 「導界者ネクサス」= grandwalkerData.kind:"guided" を持つネクサス
 * （実例: [導界者]魅魔 tribe:"導界者・導魔"）。
 * BraveCondition.alternatives (OR) が新設プリミティブ。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import {
  getAvailableBraveCombineLegalActions,
  getAvailableBraveSwapLegalActions,
  getValidBraveCombineHosts,
} from "../src/legal/legal-actions-availability";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { canExecuteOptionalStep } from "../src/effect/native-effect-front-helpers";
import { collectStateBasedActions } from "../src/state-based-actions";
import {
  maskPendingPromptsForViewer,
  sanitizeStateForViewer,
} from "../src/state-sanitize";
import { resolveStackCascade } from "../src/legal/stack-resolution-core";
import { createStepExecutionContext } from "../src/step-execution-context";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
  PendingCoreDistribution,
  PendingStepOptionalChoice,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

const C31 = cardNoMap.get("BSTH003-C31")!; // 魔法使い達の杖
const C32 = cardNoMap.get("BSTH003-C32")!; // ミミちゃん
const M01 = cardNoMap.get("BSTH003-M01")!; // メルラン・プリズムリバー
const M02 = cardNoMap.get("BSTH003-M02")!; // 可能性空間移動船

const ALICE = "alice";
const BOB = "bob";

// 「導界者ネクサス」= 系統「導界者」を持つネクサス。実カード [導界者]魅魔 (tribe:"導界者・導魔") 同型。
const doukaishaNexusDef: CardDefinition = {
  cardNo: "TEST-DOUKAISHA-NEXUS",
  name: "テスト導界者ネクサス",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  grandwalkerData: {
    kind: "guided",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
  tribe: "導界者・導魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

// 秘封系統の導界者ネクサス (BSTH003-M02 alternatives 2件目の検証用)。
const hifuuNexusDef: CardDefinition = {
  ...doukaishaNexusDef,
  cardNo: "TEST-HIFUU-NEXUS",
  tribe: "導界者・秘封",
};

// 「導魔」を持たないネクサス（比較対照: alt 条件不成立のはず）。
const plainNexusDef: CardDefinition = {
  ...doukaishaNexusDef,
  cardNo: "TEST-PLAIN-NEXUS",
  tribe: "導界者",
};

const doumaOnlyHighCostNexusDef: CardDefinition = {
  ...doukaishaNexusDef,
  cardNo: "TEST-DOMA-ONLY-HIGH-COST-NEXUS",
  name: "テスト導魔のみ高コストネクサス",
  cost: 5,
  tribe: "導魔",
};

const tribalOnlyDoukaishaNexusDef: CardDefinition = {
  cardNo: "TEST-TRIBAL-ONLY-DOUKAISHA-NEXUS",
  name: "テスト通常ネクサス(導界者・導魔)",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "導界者・導魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const spiritHostDef: CardDefinition = {
  cardNo: "TEST-SPIRIT-HOST-DOMA",
  name: "テスト導魔スピリット",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "導魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const nonDoumaSpiritHostDef: CardDefinition = {
  ...spiritHostDef,
  cardNo: "TEST-SPIRIT-HOST-NON-DOMA",
  name: "テスト非導魔スピリット",
  tribe: "幻想",
};

const ultimateHostDef: CardDefinition = {
  ...spiritHostDef,
  cardNo: "TEST-ULTIMATE-HOST-DOMA",
  name: "テスト導魔アルティメット",
  printedCategory: "ultimate",
};

// 召喚対象: 系統「導魔」を持ち、軽減シンボルが赤/黄/青の3枠 (赤黄2枠まで免除対象、青は対象外)。
const summonTargetMixedColors: CardDefinition = {
  cardNo: "TEST-SUMMON-TARGET-MIXED",
  name: "テスト導魔カード(混色)",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red", "yellow", "blue"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "導魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const unrelatedTargetDef: CardDefinition = {
  ...summonTargetMixedColors,
  cardNo: "TEST-SUMMON-TARGET-UNRELATED",
  tribe: "幻想",
};

const normalBraveDef: CardDefinition = {
  cardNo: "TEST-NORMAL-BRAVE",
  name: "テスト通常ブレイヴ",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "導魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const tribeOnlyNexusCompatibleBraveDef: CardDefinition = {
  ...normalBraveDef,
  cardNo: "TEST-TRIBE-ONLY-NEXUS-COMPATIBLE-BRAVE",
  name: "テスト通常ネクサス合体ブレイヴ",
  braveCondition: {
    categories: ["nexus"],
    tribes: ["導魔", "導界者"],
    tribesLogic: "and",
  },
};

const testDefs = [
  doukaishaNexusDef,
  hifuuNexusDef,
  plainNexusDef,
  doumaOnlyHighCostNexusDef,
  tribalOnlyDoukaishaNexusDef,
  spiritHostDef,
  nonDoumaSpiritHostDef,
  ultimateHostDef,
  summonTargetMixedColors,
  unrelatedTargetDef,
  normalBraveDef,
  tribeOnlyNexusCompatibleBraveDef,
];
const mergedDefMap = new Map<string, CardDefinition>([
  ...cardNoMap,
  ...testDefs.map((d): [string, CardDefinition] => [d.cardNo, d]),
]);
const getCardDefinitionById = (id: string) => mergedDefMap.get(id);
const m01EffectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
    ...ALL_CARDS,
    ...testDefs,
  ]),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
    ...ALL_CARDS,
    ...testDefs,
  ]),
};

const overridePropertiesCE = (
  targetInstanceId: string,
  properties: Record<string, unknown>
): ContinuousEffect => ({
  effectId: `test-bsth003-override-${targetInstanceId}`,
  sourceInstanceId: "test-bsth003-override-source",
  sourceDefinitionId: "TEST-OVERRIDE-SOURCE",
  actingPlayerId: ALICE,
  duration: { scope: "turn" },
  createdAtTurn: 1,
  createdAtAttackId: null,
  modifierTag: "override_properties",
  targetInstanceId,
  metadata: { properties },
});

const actAsSpiritCE = (targetInstanceId: string): ContinuousEffect => ({
  effectId: `test-bsth003-act-as-spirit-${targetInstanceId}`,
  sourceInstanceId: "test-bsth003-act-as-spirit-source",
  sourceDefinitionId: "TEST-ACT-AS-SPIRIT-SOURCE",
  actingPlayerId: ALICE,
  duration: { scope: "turn" },
  createdAtTurn: 1,
  createdAtAttackId: null,
  modifierTag: "act_as_spirit",
  targetInstanceId,
  metadata: {},
});

function buildStateWithBraveAttachedTo(
  braveDef: CardDefinition,
  hostDef: CardDefinition
): { state: GameState; brave: string; host: string } {
  const host = createCardInstance(hostDef, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: hostDef.printedCategory === "nexus" ? "nexus" : "spirit",
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "brave",
    attachedToInstanceId: host.instanceId,
  });
  const hostWithChild = { ...host, attachedChildrenIds: [brave.instanceId] };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostWithChild, brave],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
  return { state, brave: brave.instanceId, host: host.instanceId };
}

function buildBraveSwapStateToNexus(
  braveDef: CardDefinition,
  toHostDef: CardDefinition
): { state: GameState; brave: string; fromHost: string; toHost: string } {
  const fromHost = createCardInstance(spiritHostDef, {
    instanceId: "swap-from-spirit",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 1,
    attachedChildrenIds: ["swap-brave"],
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "swap-brave",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "brave",
    attachedToInstanceId: fromHost.instanceId,
  });
  const toHost = createCardInstance(toHostDef, {
    instanceId: "swap-to-nexus",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "nexus",
  });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [fromHost, brave, toHost],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
  return {
    state,
    brave: brave.instanceId,
    fromHost: fromHost.instanceId,
    toHost: toHost.instanceId,
  };
}

function buildM01FlashBeforeBlockState(sourceIsAttacking: boolean): GameState {
  const m01 = createCardInstance(M01, {
    instanceId: "m01-source",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 3,
  });
  const otherAttacker = createCardInstance(spiritHostDef, {
    instanceId: "other-attacker",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 1,
  });
  const bobTarget = createCardInstance(
    { ...spiritHostDef, cardNo: "TEST-BSTH003-M01-BOB-TARGET" },
    {
      instanceId: "bob-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    }
  );
  const attackerInstanceId = sourceIsAttacking
    ? m01.instanceId
    : otherAttacker.instanceId;
  const attackerEntityId = `battle-entity:${attackerInstanceId}`;
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01, otherAttacker, bobTarget],
      battleEntities: [
        {
          entityId: attackerEntityId,
          memberInstanceIds: [attackerInstanceId],
          resolvedBp: 8000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: `attack-group:1:${ALICE}:${attackerEntityId}`,
        primaryEntityId: attackerEntityId,
        participantEntityIds: [attackerEntityId],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: attackerEntityId,
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: [attackerEntityId],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
    }),
    activePlayerId: ALICE,
    step: "attack",
    window: "flash_before_block",
  };
}

function findM01FlashAction(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    ...m01EffectLookups,
  }).find(
    (
      action
    ): action is Extract<LegalAction, { kind: "use_field_card_effect" }> =>
      action.kind === "use_field_card_effect" &&
      action.sourceCardNo === "BSTH003-M01" &&
      action.sourceInstanceId === "m01-source" &&
      action.timing === "flash"
  );
}

describe("BSTH003-M01 フラッシュ『このスピリットのアタック時』", () => {
  it("effect 定義は Lv2 以上かつ自身がアタック中の条件を持つ", () => {
    const effect = M01.effects![1]!;

    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "in_battle", state: "attacking" },
    ]);
  });

  it("別のスピリットのバトル中には use_field_card_effect が提示されない", () => {
    const state = buildM01FlashBeforeBlockState(false);

    expect(findM01FlashAction(state)).toBeUndefined();
  });

  it("BSTH003-M01 自身のアタック中なら use_field_card_effect が提示される", () => {
    const state = buildM01FlashBeforeBlockState(true);

    const action = findM01FlashAction(state);

    expect(action).toBeDefined();
    expect(action?.candidateTargetInstanceIds).toEqual(["bob-target"]);
  });
});

describe("BSTH003-C31 braveCondition.alternatives: 導界者ネクサスへの合体候補", () => {
  it("getAvailableBraveCombineLegalActions が導界者ネクサスをホスト候補に含める", () => {
    const brave = createCardInstance(C31, {
      instanceId: "c31-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doukaishaNexusDef, {
      instanceId: "nexus-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      actions.some(
        (a) =>
          a.braveInstanceId === brave.instanceId &&
          a.targetInstanceId === nexus.instanceId
      )
    ).toBe(true);
    const hosts = getValidBraveCombineHosts(
      state,
      C31,
      ALICE,
      getCardDefinitionById,
      brave.instanceId
    );
    expect(hosts.some((h) => h.instanceId === nexus.instanceId)).toBe(true);
  });

  it("導魔系統を持たないネクサス(導界者のみ)は候補から除外される (AND判定)", () => {
    const brave = createCardInstance(C31, {
      instanceId: "c31-2",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(plainNexusDef, {
      instanceId: "nexus-plain",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions.some((a) => a.targetInstanceId === nexus.instanceId)).toBe(
      false
    );
  });

  it("導魔かつコスト5以上でも導界者でないネクサスは通常枝で候補にしない", () => {
    const brave = createCardInstance(C31, {
      instanceId: "c31-doma-only-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doumaOnlyHighCostNexusDef, {
      instanceId: "nexus-doma-only-c31",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const hosts = getValidBraveCombineHosts(
      state,
      C31,
      ALICE,
      getCardDefinitionById,
      brave.instanceId
    );
    expect(hosts.some((h) => h.instanceId === nexus.instanceId)).toBe(false);
  });

  it("act_as_spirit中の導魔ネクサスでも、導界者でなければ通常枝で候補にしない", () => {
    const brave = createCardInstance(C31, {
      instanceId: "c31-act-as-spirit-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doumaOnlyHighCostNexusDef, {
      instanceId: "nexus-act-as-spirit-c31",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [actAsSpiritCE(nexus.instanceId)],
    };
    const hosts = getValidBraveCombineHosts(
      state,
      C31,
      ALICE,
      getCardDefinitionById,
      brave.instanceId
    );
    expect(hosts.some((h) => h.instanceId === nexus.instanceId)).toBe(false);
  });

  it("[board] executeBraveCombine で導界者ネクサスへ実際に合体できる", () => {
    const brave = createCardInstance(C31, {
      instanceId: "c31-3",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doukaishaNexusDef, {
      instanceId: "nexus-3",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const next = executeBraveCombine(
      state,
      ALICE,
      brave.instanceId,
      nexus.instanceId,
      getCardDefinitionById
    );
    const nexusAfter = next.cardInstances.find(
      (c) => c.instanceId === nexus.instanceId
    )!;
    const braveAfter = next.cardInstances.find(
      (c) => c.instanceId === brave.instanceId
    )!;
    expect(nexusAfter.attachedChildrenIds).toContain(brave.instanceId);
    expect(braveAfter.attachedToInstanceId).toBe(nexus.instanceId);
  });

  it("act_as_spirit中の導界者ネクサスに合体してもSBAで条件喪失分離しない", () => {
    const brave = createCardInstance(C31, {
      instanceId: "c31-attached-act-as-doukaisha",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: "nexus-act-as-doukaisha",
    });
    const nexus = createCardInstance(doukaishaNexusDef, {
      instanceId: "nexus-act-as-doukaisha",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      attachedChildrenIds: [brave.instanceId],
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, brave],
      }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [actAsSpiritCE(nexus.instanceId)],
    };

    const checks = collectStateBasedActions(state, getCardDefinitionById);

    expect(
      checks.some(
        (c) =>
          c.kind === "brave_forced_separation" &&
          c.instanceId === brave.instanceId
      )
    ).toBe(false);
  });
});

describe("BSTH003-C31/C32/M02 brave_swap: 導界者ネクサスへの交換候補", () => {
  it.each([
    ["BSTH003-C31", C31, doukaishaNexusDef],
    ["BSTH003-C32", C32, doukaishaNexusDef],
    ["BSTH003-M02", M02, hifuuNexusDef],
  ] as const)(
    "%s は導界者ネクサスを交換先候補に含める",
    (_label, braveDef, toHostDef) => {
      const { state, brave, fromHost, toHost } = buildBraveSwapStateToNexus(
        braveDef,
        toHostDef
      );

      const actions = getAvailableBraveSwapLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      });

      expect(
        actions.some(
          (a) =>
            a.braveInstanceId === brave &&
            a.fromHostInstanceId === fromHost &&
            a.toHostInstanceId === toHost
        )
      ).toBe(true);
    }
  );
});

describe("BSTH003-C31/C32/M02 braveCondition: 通常枝はスピリット限定", () => {
  it.each([
    ["BSTH003-C31", C31],
    ["BSTH003-C32", C32],
    ["BSTH003-M02", M02],
  ] as const)(
    "%s は導魔かつコスト5以上でもアルティメットを候補にしない",
    (_label, braveDef) => {
      const brave = createCardInstance(braveDef, {
        instanceId: "spirit-only-brave",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 1,
      });
      const ultimate = createCardInstance(ultimateHostDef, {
        instanceId: "ultimate-host",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "ultimate",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [brave, ultimate],
        }),
        activePlayerId: ALICE,
        step: "main",
      };

      const actions = getAvailableBraveCombineLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      });

      expect(
        actions.some(
          (a) =>
            a.braveInstanceId === brave.instanceId &&
            a.targetInstanceId === ultimate.instanceId
        )
      ).toBe(false);
    }
  );

  it.each([
    ["BSTH003-C31", C31],
    ["BSTH003-C32", C32],
    ["BSTH003-M02", M02],
  ] as const)(
    "%s は系統だけ導界者・導魔の通常ネクサスを導界者ネクサス候補にしない",
    (_label, braveDef) => {
      const brave = createCardInstance(braveDef, {
        instanceId: "guided-only-brave",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 1,
      });
      const nexus = createCardInstance(tribalOnlyDoukaishaNexusDef, {
        instanceId: "tribal-only-doukaisha-nexus",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "nexus",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [brave, nexus],
        }),
        activePlayerId: ALICE,
        step: "main",
      };

      const actions = getAvailableBraveCombineLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      });

      expect(
        actions.some(
          (a) =>
            a.braveInstanceId === brave.instanceId &&
            a.targetInstanceId === nexus.instanceId
        )
      ).toBe(false);
    }
  );
});

describe("BSTH003-C31 effects[1] ネクサス合体中: 軽減シンボル赤/黄2つまで免除 (combined_host_category + waiverColors)", () => {
  it("導界者ネクサスに合体中: 導魔カード召喚時、赤/黄枠2つは免除・青枠は免除されない", () => {
    const { state } = buildStateWithBraveAttachedTo(C31, doukaishaNexusDef);
    const reduction = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: summonTargetMixedColors,
      getCardDefinitionById,
    });
    // 赤/黄2枠は waiverColors 免除、青1枠は供給元が無いため軽減されない。
    expect(reduction.totalReduction).toBe(2);
    expect(reduction.reducedCost).toBe(summonTargetMixedColors.cost - 2);
  });

  it("スピリットに合体中(導魔＆コスト5以上): ネクサス合体中効果は発揮しない (combined_host_category ゲート)", () => {
    const { state } = buildStateWithBraveAttachedTo(C31, spiritHostDef);
    const reduction = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: summonTargetMixedColors,
      getCardDefinitionById,
    });
    // C31 自身の黄シンボルは通常軽減に使えるが、ネクサス合体中の赤/黄 waiver は出ない。
    expect(reduction.totalReduction).toBe(1);
    expect(
      reduction.reductionBreakdown.find((entry) => entry.color === "yellow")
        ?.applied
    ).toBe(1);
  });

  it("導界者ネクサスに合体中でも、対象外の系統カードには免除が適用されない", () => {
    const { state } = buildStateWithBraveAttachedTo(C31, doukaishaNexusDef);
    const reduction = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: unrelatedTargetDef,
      getCardDefinitionById,
    });
    // 対象外の系統なので waiver は出ず、C31 自身の黄シンボルによる通常軽減だけ。
    expect(reduction.totalReduction).toBe(1);
    expect(
      reduction.reductionBreakdown.find((entry) => entry.color === "yellow")
        ?.applied
    ).toBe(1);
  });
});

describe("BSTH003-C32 braveLimitExemption: 導魔 host の合体可能体数に数えない", () => {
  it("導魔かつコスト5以上でも導界者でないネクサスはC32の合体候補にしない", () => {
    const c32 = createCardInstance(C32, {
      instanceId: "c32-doma-only-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doumaOnlyHighCostNexusDef, {
      instanceId: "nexus-doma-only-c32",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [c32, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(actions.some((a) => a.targetInstanceId === nexus.instanceId)).toBe(
      false
    );
  });

  it("act_as_spirit中の導魔ネクサスでも、導界者でなければC32の合体候補にしない", () => {
    const c32 = createCardInstance(C32, {
      instanceId: "c32-act-as-spirit-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doumaOnlyHighCostNexusDef, {
      instanceId: "nexus-act-as-spirit-c32",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [c32, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [actAsSpiritCE(nexus.instanceId)],
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(actions.some((a) => a.targetInstanceId === nexus.instanceId)).toBe(
      false
    );
  });

  it("BSTH003-C32 が導魔スピリットに付いた後も通常ブレイヴを合体できる", () => {
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-host-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: ["c32-attached-spirit"],
    });
    const c32 = createCardInstance(C32, {
      instanceId: "c32-attached-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    const normal = createCardInstance(normalBraveDef, {
      instanceId: "normal-after-c32-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32, normal],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(
      actions.some(
        (a) =>
          a.braveInstanceId === normal.instanceId &&
          a.targetInstanceId === host.instanceId
      )
    ).toBe(true);
  });

  it("BSTH003-C32 自身も導界者ネクサスの既存通常ブレイヴ数に阻まれない", () => {
    const nexus = createCardInstance(doukaishaNexusDef, {
      instanceId: "c32-host-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      attachedChildrenIds: ["normal-before-c32-nexus"],
    });
    const normal = createCardInstance(normalBraveDef, {
      instanceId: "normal-before-c32-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: nexus.instanceId,
    });
    const c32 = createCardInstance(C32, {
      instanceId: "c32-incoming-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, normal, c32],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(
      actions.some(
        (a) =>
          a.braveInstanceId === c32.instanceId &&
          a.targetInstanceId === nexus.instanceId
      )
    ).toBe(true);
  });

  it("BSTH003-C32 が導界者ネクサスに付いた後も追加ブレイヴを合体できる", () => {
    const nexus = createCardInstance(doukaishaNexusDef, {
      instanceId: "c32-attached-guided-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      attachedChildrenIds: ["c32-attached-guided"],
    });
    const c32 = createCardInstance(C32, {
      instanceId: "c32-attached-guided",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: nexus.instanceId,
    });
    const incoming = createCardInstance(tribeOnlyNexusCompatibleBraveDef, {
      instanceId: "incoming-after-c32-guided",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, c32, incoming],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(
      actions.some(
        (a) =>
          a.braveInstanceId === incoming.instanceId &&
          a.targetInstanceId === nexus.instanceId
      )
    ).toBe(true);
  });

  it("系統だけ導界者・導魔の通常ネクサスではC32は合体可能体数に数えられる", () => {
    const nexus = createCardInstance(tribalOnlyDoukaishaNexusDef, {
      instanceId: "c32-attached-tribal-only-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      attachedChildrenIds: ["c32-attached-tribal-only"],
    });
    const c32 = createCardInstance(C32, {
      instanceId: "c32-attached-tribal-only",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: nexus.instanceId,
    });
    const incoming = createCardInstance(tribeOnlyNexusCompatibleBraveDef, {
      instanceId: "incoming-after-c32-tribal-only",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, c32, incoming],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(
      actions.some(
        (a) =>
          a.braveInstanceId === incoming.instanceId &&
          a.targetInstanceId === nexus.instanceId
      )
    ).toBe(false);
  });

  it("host が導魔を実効付与された場合、C32 は印字非導魔 host でも合体可能体数に数えない", () => {
    const host = createCardInstance(nonDoumaSpiritHostDef, {
      instanceId: "c32-host-added-doma",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: ["c32-attached-added-doma"],
    });
    const c32 = createCardInstance(C32, {
      instanceId: "c32-attached-added-doma",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    const normal = createCardInstance(normalBraveDef, {
      instanceId: "normal-after-added-doma",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32, normal],
      }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [
        overridePropertiesCE(host.instanceId, { addTribes: ["導魔"] }),
      ],
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(
      actions.some(
        (a) =>
          a.braveInstanceId === normal.instanceId &&
          a.targetInstanceId === host.instanceId
      )
    ).toBe(true);
  });

  it("host から導魔が実効剥奪された場合、C32 は合体可能体数に数えて追加合体を塞ぐ", () => {
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-host-removed-doma",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: ["c32-attached-removed-doma"],
    });
    const c32 = createCardInstance(C32, {
      instanceId: "c32-attached-removed-doma",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    const normal = createCardInstance(normalBraveDef, {
      instanceId: "normal-after-removed-doma",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32, normal],
      }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [
        overridePropertiesCE(host.instanceId, { tribes: [] }),
      ],
    };

    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    expect(
      actions.some(
        (a) =>
          a.braveInstanceId === normal.instanceId &&
          a.targetInstanceId === host.instanceId
      )
    ).toBe(false);
  });
});

describe("BSTH003-C32 effects[1]: 対象化時の手札防御合体", () => {
  const effect = C32.effects![1]!;

  function makeOpponentDestroyMagic(): CardDefinition {
    return {
      cardNo: "TEST-C32-OPPONENT-DESTROY-MAGIC",
      name: "テストC32対象破壊マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy-host",
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

  function makeOpponentNexusDestroyMagic(): CardDefinition {
    return {
      cardNo: "TEST-C32-OPPONENT-NEXUS-DESTROY-MAGIC",
      name: "テストC32対象ネクサス破壊マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のネクサス1つを破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy-nexus-host",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["nexus"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
  }

  function makeOpponentBpMinusMagic(): CardDefinition {
    return {
      cardNo: "TEST-C32-OPPONENT-BP-MINUS-MAGIC",
      name: "テストC32対象BP低下マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体をBP-5000する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "bp-minus-host",
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
                amount: -5000,
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    };
  }

  function makeOpponentHandWrittenBpMinusMagic(): CardDefinition {
    return {
      cardNo: "TEST-C32-OPPONENT-HAND-WRITTEN-BP-MINUS-MAGIC",
      name: "テストC32手書き対象BP低下マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体をBP-5000する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
  }

  function makeHandWrittenBpMinusResolver(cardNo: string) {
    return (
      state: GameState,
      context: {
        targetInstanceIds: string[];
        sourceCard: { instanceId: string };
        sourceDefinition: { cardNo: string };
        actingPlayerId: string;
      }
    ): GameState => {
      const targetInstanceId = context.targetInstanceIds[0];
      if (!targetInstanceId) return state;
      const effect: ContinuousEffect = {
        effectId: "hw-c32-bp-minus",
        sourceInstanceId: context.sourceCard.instanceId,
        sourceDefinitionId: context.sourceDefinition.cardNo,
        actingPlayerId: context.actingPlayerId,
        duration: { scope: "turn" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: state.activeAttack?.attackId ?? null,
        modifierTag: "bp_modifier",
        modifierAmount: -5000,
        targetInstanceId,
      };
      return {
        ...state,
        activeContinuousEffects: [...state.activeContinuousEffects, effect],
        log: [
          ...state.log,
          `hand-written:c32-bp-minus:resolved:${targetInstanceId}:${cardNo}`,
        ],
      };
    };
  }

  function resolveC32DefenseAgainstBpMinus(options: {
    c32ChoiceIndex: number;
  }): GameState {
    const magicDef = makeOpponentBpMinusMagic();
    const definitions = [...ALL_CARDS, ...testDefs, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-bp-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-bp-defense",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-c32-bp-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      activePlayerId: BOB,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:c32-bp",
        actingPlayerId: BOB,
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: magicDef.cardNo,
        deferredStack: {
          stackId: "stack:c32-bp",
          actionKind: "magic",
          chainId: "chain:c32-bp",
          actingPlayerId: BOB,
          cardInstanceId: magic.instanceId,
          cardDefinitionId: magicDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: ["bp_modify"],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        targetStepId: "bp-minus-host",
        candidateInstanceIds: [host.instanceId],
        targetEffectFilterTags: ["bp_modify"],
      },
    };

    const chooseHost = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseHost).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseHost!,
      targetInstanceIds: [host.instanceId],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const c32Response = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === c32Hand.instanceId &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(options.c32ChoiceIndex)
    );
    expect(c32Response).toBeDefined();
    const afterC32 = applyLegalAction({
      state: afterPrivateDeclared,
      action: c32Response!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const passStack = getLegalActions({
      state: afterC32,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterC32,
      action: passStack!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const chooseBranch = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === options.c32ChoiceIndex
    );
    expect(chooseBranch).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterStackPassed,
      action: chooseBranch!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const resolvePlacement = getLegalActions({
      state: afterResolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    return applyLegalAction({
      state: afterResolved,
      action: resolvePlacement!,
      enterFieldCorePlacements: [],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
  }

  it("effect 定義: targeted(opponent_effect) から直接合体し、成功時に無効/受けない選択 + 相手起因離脱耐性を付ける", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: "hand" });
    expect(effect.executionMode).toBe("optional");
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "targeted",
      triggerFilter: {
        filterOr: [
          { category: ["spirit"], tribes: ["導魔"], minCost: 5 },
          {
            category: ["nexus"],
            tribes: ["導魔", "導界者"],
            tribesLogic: "and",
            targetsGrandwalker: "only",
            grandwalkerKind: "guided",
          },
        ],
      },
      cause: ["opponent_effect"],
    });
    expect(effect.steps).toHaveLength(3);
    expect(effect.steps[0]!.action).toEqual({
      kind: "brave_combine_effect",
      asSummon: true,
      target: { kind: "trigger_related_instance" },
    });
    expect(effect.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "mimi-defensive-combine",
    });
    expect(effect.steps[1]!.label).toBe("無効にする");
    expect(effect.steps[1]!.action).toEqual({
      kind: "negate",
      negateTarget: "effect",
      targetController: "opponent",
    });
    expect(effect.steps[1]!.choice?.[0]?.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "trigger_related_instance" },
      duration: { scope: "current_effect" },
    });
    expect(effect.steps[2]!.action).toEqual({
      kind: "effect_resistance",
      target: { kind: "trigger_related_instance" },
      resistsOutcome: "leave_field",
      source: "opponent",
      duration: { scope: "turn" },
    });
  });

  it("[board] 導界者ネクサス対象化でも手札のC32が private declaration から直接合体できる", () => {
    const magicDef = makeOpponentNexusDestroyMagic();
    const definitions = [...ALL_CARDS, ...testDefs, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(doukaishaNexusDef, {
      instanceId: "c32-guided-target-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-guided-defense",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-c32-guided-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      activePlayerId: BOB,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:c32-guided",
        actingPlayerId: BOB,
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: magicDef.cardNo,
        deferredStack: {
          stackId: "stack:c32-guided",
          actionKind: "magic",
          chainId: "chain:c32-guided",
          actingPlayerId: BOB,
          cardInstanceId: magic.instanceId,
          cardDefinitionId: magicDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: ["destroy"],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        targetStepId: "destroy-nexus-host",
        candidateInstanceIds: [host.instanceId],
        targetEffectFilterTags: ["destroy"],
      },
    };

    const chooseHost = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseHost).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseHost!,
      targetInstanceIds: [host.instanceId],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      afterDisclosure.pendingPrivateDeclarations.some(
        (declaration) => declaration.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(true);

    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const c32Response = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === c32Hand.instanceId &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(1)
    );
    expect(c32Response).toBeDefined();
    const afterC32 = applyLegalAction({
      state: afterPrivateDeclared,
      action: c32Response!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const passStack = getLegalActions({
      state: afterC32,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterC32,
      action: passStack!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const chooseBranch = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(chooseBranch).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterStackPassed,
      action: chooseBranch!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(afterResolved.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      c32Hand.instanceId
    );
    expect(
      afterResolved.pendingEnterFieldPlacement?.effectBraveCombineAsSummon
        ?.hostInstanceId
    ).toBe(host.instanceId);
  });

  it("[board] negate が対象stackに効かない場合でもC32の受けない分岐は宣言・選択できる", () => {
    const magicDef = makeOpponentDestroyMagic();
    const definitions = [...ALL_CARDS, ...testDefs, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-negate-immune-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-negate-immune",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-c32-negate-immune-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      activePlayerId: BOB,
      step: "attack",
      activeContinuousEffects: [
        {
          effectId: "ce-c32-negate-target-immune",
          sourceInstanceId: "ce-c32-negate-target-immune-source",
          sourceDefinitionId: "TEST-C32-NEGATE-TARGET-IMMUNE-SOURCE",
          actingPlayerId: BOB,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: magic.instanceId,
        },
      ],
      pendingEffectTargetSelection: {
        pendingId: "effect-target:c32-negate-immune",
        actingPlayerId: BOB,
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: magicDef.cardNo,
        deferredStack: {
          stackId: "stack:c32-negate-immune",
          actionKind: "magic",
          chainId: "chain:c32-negate-immune",
          actingPlayerId: BOB,
          cardInstanceId: magic.instanceId,
          cardDefinitionId: magicDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: ["destroy"],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        targetStepId: "destroy-host",
        candidateInstanceIds: [host.instanceId],
        targetEffectFilterTags: ["destroy"],
      },
    };

    const chooseHost = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseHost).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseHost!,
      targetInstanceIds: [host.instanceId],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "declare_private_triggered_effect" &&
        action.sourceInstanceId === c32Hand.instanceId
    );
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const responseActions = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });

    const response = responseActions.find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === c32Hand.instanceId &&
        action.skipOnly !== true
    );
    expect(response).toBeDefined();
    expect(response?.choiceIndex).toBeUndefined();
    expect(response?.deferredChoiceIndexes).toEqual([1]);
  });

  it("[engine] asSummon pending は provenance 由来の効果元 identity を保持する", () => {
    const providerDef: CardDefinition = {
      ...spiritHostDef,
      cardNo: "TEST-C32-EFFECT-PROVIDER",
      name: "テストC32効果提供元",
      effects: [
        { timing: { kind: "continuous" }, steps: [], textRef: [] },
        effect,
      ],
    };
    const definitions = [...ALL_CARDS, ...testDefs, providerDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-provenance-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-provenance",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const provider = createCardInstance(providerDef, {
      instanceId: "c32-effect-provider",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, c32Hand, provider],
    });

    const pendingState = executeEffect({
      chainId: "test:bsth003-brave-condition-alternatives-nexus:1923",
      state,
      effect,
      effectIndex: 1,
      sourceInstanceId: c32Hand.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      triggerRelatedInstanceId: host.instanceId,
      effectSourceInstanceId: provider.instanceId,
      effectSourceDefinitionId: providerDef.cardNo,
    });

    const combine =
      pendingState.pendingEnterFieldPlacement?.effectBraveCombineAsSummon;
    expect(combine?.effectSourceInstanceId).toBe(provider.instanceId);
    expect(combine?.effectSourceDefinitionId).toBe(providerDef.cardNo);
    expect(combine?.continuation?.sourceDefinitionId).toBe(providerDef.cardNo);
    expect(combine?.continuation?.effectSourceInstanceId).toBe(
      provider.instanceId
    );
    expect(combine?.continuation?.effectSourceDefinitionId).toBe(
      providerDef.cardNo
    );
  });

  it("[board] 相手効果対象化への private declaration から手札のC32が合体し、受けない分岐で元破壊を防ぐ", () => {
    const magicDef = makeOpponentDestroyMagic();
    const definitions = [...ALL_CARDS, ...testDefs, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };

    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-target-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-defense",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-c32-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      activePlayerId: BOB,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:c32",
        actingPlayerId: BOB,
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: magicDef.cardNo,
        deferredStack: {
          stackId: "stack:c32",
          actionKind: "magic",
          chainId: "chain:c32",
          actingPlayerId: BOB,
          cardInstanceId: magic.instanceId,
          cardDefinitionId: magicDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: ["destroy"],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        targetStepId: "destroy-host",
        candidateInstanceIds: [host.instanceId],
        targetEffectFilterTags: ["destroy"],
      },
    };

    const chooseHost = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseHost).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseHost!,
      targetInstanceIds: [host.instanceId],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const privateDeclaration = afterDisclosure.pendingPrivateDeclarations.find(
      (declaration) => declaration.sourceInstanceId === c32Hand.instanceId
    );
    expect(privateDeclaration).toBeDefined();

    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const c32Response = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === c32Hand.instanceId &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(1)
    );
    expect(c32Response).toBeDefined();
    const afterC32 = applyLegalAction({
      state: afterPrivateDeclared,
      action: c32Response!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const passStack = getLegalActions({
      state: afterC32,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterC32,
      action: passStack!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const chooseBranch = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(chooseBranch).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterStackPassed,
      action: chooseBranch!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(afterResolved.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      c32Hand.instanceId
    );
    expect(afterResolved.pendingEnterFieldPlacement?.minimumCoreCount).toBe(0);
    expect(
      "effectResolutionBeforeState" in
        afterResolved.pendingEnterFieldPlacement!.effectBraveCombineAsSummon!
    ).toBe(true);
    const rawCombineContinuation =
      afterResolved.pendingEnterFieldPlacement!.effectBraveCombineAsSummon!
        .continuation!;
    const rawNestedDisclosure =
      rawCombineContinuation.targetedDisclosureContinuation!;
    expect(rawNestedDisclosure).toBeDefined();
    expect(rawNestedDisclosure).toHaveProperty("effectResolutionBeforeState");
    const leakyStepContext = {
      ...rawNestedDisclosure.stepContext,
      pendingConditionalCostRollback: {
        originalState: afterDisclosure,
        sourceInstanceId: c32Hand.instanceId,
        alternativeStepIds: ["leak-step"],
        failureLogEntries: [],
      },
      results: {
        ...rawNestedDisclosure.stepContext.results,
        "leak-step": {
          stepId: "leak-step",
          affectedCardInstanceIds: [],
          succeeded: true,
          stateSnapshot: afterDisclosure,
        },
      },
    };
    const leakyCoreDistributionPending = {
      pendingId: "leak-core-distribution",
      actingPlayerId: ALICE,
      sourceInstanceId: c32Hand.instanceId,
      sourceDefinitionId: C32.cardNo,
      priorStateSnapshot: afterDisclosure,
      continuation: {
        chainId: "test:bsth003-brave-condition-alternatives-nexus:2151",
        sourceDefinitionId: C32.cardNo,
        effectIndex: 1,
        sourceInstanceId: c32Hand.instanceId,
        actingPlayerId: ALICE,
        resumeStepIndex: 1,
        stepContext: leakyStepContext,
      },
      targetInterruption: {
        chainId: "test:bsth003-brave-condition-alternatives-nexus:2159",
        sourceDefinitionId: C32.cardNo,
        effectIndex: 1,
        sourceInstanceId: c32Hand.instanceId,
        actingPlayerId: ALICE,
        stepIndex: 1,
        stepContext: leakyStepContext,
        targetStepId: "leak-target",
        effectResolutionBeforeState: afterDisclosure,
      },
    } as PendingCoreDistribution;
    const stateWithNestedSnapshots: GameState = {
      ...afterResolved,
      pendingEnterFieldPlacement: {
        ...afterResolved.pendingEnterFieldPlacement!,
        effectBraveCombineAsSummon: {
          ...afterResolved.pendingEnterFieldPlacement!
            .effectBraveCombineAsSummon!,
          continuation: {
            ...rawCombineContinuation,
            targetedDisclosureContinuation: {
              ...rawNestedDisclosure,
              stepContext: leakyStepContext,
              coreDistributionPending: leakyCoreDistributionPending,
            },
          },
        },
      },
    };
    const leakyStepOptionalChoice: PendingStepOptionalChoice = {
      pendingId: "leak-step-optional",
      actingPlayerId: ALICE,
      choosingPlayerId: ALICE,
      sourceInstanceId: c32Hand.instanceId,
      sourceDefinitionId: C32.cardNo,
      effectIndex: 1,
      stepIndex: 1,
      continuation: {
        chainId: "test:bsth003-brave-condition-alternatives-nexus:2196",
        sourceDefinitionId: C32.cardNo,
        effectIndex: 1,
        sourceInstanceId: c32Hand.instanceId,
        actingPlayerId: ALICE,
        stepIndex: 1,
        stepContext: leakyStepContext,
        targetedDisclosureContinuation: {
          ...rawNestedDisclosure,
          stepContext: leakyStepContext,
          coreDistributionPending: leakyCoreDistributionPending,
        },
      },
    };
    const stateWithStepOptionalDisclosure: GameState = {
      ...afterResolved,
      pendingStepOptionalChoice: leakyStepOptionalChoice,
    };
    const leakyZoneContinuation = {
      chainId: "test:bsth003-brave-condition-alternatives-nexus:2214",
      sourceDefinitionId: C32.cardNo,
      effectIndex: 1,
      sourceInstanceId: c32Hand.instanceId,
      actingPlayerId: ALICE,
      resumeStepIndex: 1,
      recordStepId: "leak-step",
      stepContext: leakyStepContext,
      targetedDisclosureContinuation: {
        ...rawNestedDisclosure,
        stepContext: leakyStepContext,
      },
    };
    const leakyMultiPlacementContinuation = {
      chainId: "test:bsth003-brave-condition-alternatives-nexus:2227",
      sourceDefinitionId: C32.cardNo,
      effectIndex: 1,
      sourceInstanceId: c32Hand.instanceId,
      actingPlayerId: ALICE,
      resumeStepIndex: 1,
      stepContext: leakyStepContext,
      targetedDisclosureContinuation: {
        ...rawNestedDisclosure,
        stepContext: leakyStepContext,
      },
    };
    const stateWithTopLevelPendingSnapshots = {
      ...afterResolved,
      pendingEnterFieldPlacement: null,
      pendingDeckReveal: {
        pendingId: "leak-deck-reveal",
        actingPlayerId: ALICE,
        sourceInstanceId: c32Hand.instanceId,
        sourceDefinitionId: C32.cardNo,
        revealedCardInstanceIds: [],
        originalRevealedCardInstanceIds: [],
        picks: [],
        remainder: "bottom",
        phase: "picking",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        priorStateSnapshot: afterDisclosure,
        continuation: leakyZoneContinuation,
      },
      pendingZoneSelection: {
        pendingId: "leak-zone-selection",
        actingPlayerId: ALICE,
        sourceInstanceId: c32Hand.instanceId,
        sourceDefinitionId: C32.cardNo,
        actionKind: "return_from_trash",
        sourceZone: "trash",
        candidateCardInstanceIds: [],
        maxCount: 1,
        destination: "hand",
        remainingActions: [],
        effectTiming: effect.timing,
        priorStateSnapshot: afterDisclosure,
        continuation: leakyZoneContinuation,
      },
      pendingDeckRevealSwapChain: [
        {
          pendingId: "leak-deck-reveal-swap-chain",
          actingPlayerId: ALICE,
          sourceInstanceId: c32Hand.instanceId,
          sourceDefinitionId: C32.cardNo,
          actionKind: "return_from_trash",
          sourceZone: "trash",
          candidateCardInstanceIds: [],
          maxCount: 1,
          destination: "hand",
          remainingActions: [],
          effectTiming: effect.timing,
          priorStateSnapshot: afterDisclosure,
          continuation: leakyZoneContinuation,
        },
      ],
      pendingCoreCountSelection: {
        pendingId: "leak-core-count-selection",
        actingPlayerId: ALICE,
        priorStateSnapshot: afterDisclosure,
        continuation: leakyZoneContinuation,
      },
      pendingCountSelection: {
        pendingId: "leak-count-selection",
        actingPlayerId: ALICE,
        priorStateSnapshot: afterDisclosure,
        continuation: leakyZoneContinuation,
      },
      pendingDiscardSetBurstCountSelection: {
        pendingId: "leak-discard-count-selection",
        actingPlayerId: ALICE,
        priorStateSnapshot: afterDisclosure,
        continuation: leakyZoneContinuation,
      },
      pendingMultiPlacement: {
        pendingId: "leak-multi-placement",
        actingPlayerId: ALICE,
        sourceInstanceId: c32Hand.instanceId,
        sourceDefinitionId: C32.cardNo,
        targets: [],
        effectTiming: effect.timing,
        priorStateSnapshot: afterDisclosure,
        continuation: leakyMultiPlacementContinuation,
      },
    } as unknown as GameState;
    const aliceDisplayCombine = sanitizeStateForViewer(afterResolved, ALICE)
      .pendingEnterFieldPlacement?.effectBraveCombineAsSummon as
      | Record<string, unknown>
      | undefined;
    expect(aliceDisplayCombine).toBeDefined();
    expect(aliceDisplayCombine).not.toHaveProperty(
      "effectResolutionBeforeState"
    );
    const aliceDisplayNestedDisclosure = (
      aliceDisplayCombine?.continuation as Record<string, unknown> | undefined
    )?.targetedDisclosureContinuation as Record<string, unknown> | undefined;
    expect(aliceDisplayNestedDisclosure).toBeDefined();
    expect(aliceDisplayNestedDisclosure).not.toHaveProperty(
      "effectResolutionBeforeState"
    );
    const aliceDisplayLeakyCombine = sanitizeStateForViewer(
      stateWithNestedSnapshots,
      ALICE
    ).pendingEnterFieldPlacement?.effectBraveCombineAsSummon as
      | Record<string, unknown>
      | undefined;
    const aliceDisplayLeakyNestedDisclosure = (
      aliceDisplayLeakyCombine?.continuation as
        | Record<string, unknown>
        | undefined
    )?.targetedDisclosureContinuation as Record<string, unknown> | undefined;
    const aliceDisplayLeakyStepContext =
      aliceDisplayLeakyNestedDisclosure?.stepContext as
        | Record<string, unknown>
        | undefined;
    expect(aliceDisplayLeakyStepContext).not.toHaveProperty(
      "pendingConditionalCostRollback"
    );
    const aliceDisplayLeakyResults = aliceDisplayLeakyStepContext?.results as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(aliceDisplayLeakyResults?.["leak-step"]).not.toHaveProperty(
      "stateSnapshot"
    );
    const aliceDisplayLeakyCoreDistribution =
      aliceDisplayLeakyNestedDisclosure?.coreDistributionPending as
        | Record<string, unknown>
        | undefined;
    expect(aliceDisplayLeakyCoreDistribution).not.toHaveProperty(
      "priorStateSnapshot"
    );
    const aliceDisplayLeakyCoreContinuation =
      aliceDisplayLeakyCoreDistribution?.continuation as
        | Record<string, unknown>
        | undefined;
    const aliceDisplayLeakyCoreStepContext =
      aliceDisplayLeakyCoreContinuation?.stepContext as
        | Record<string, unknown>
        | undefined;
    expect(aliceDisplayLeakyCoreStepContext).not.toHaveProperty(
      "pendingConditionalCostRollback"
    );
    const aliceDisplayLeakyCoreTargetInterruption =
      aliceDisplayLeakyCoreDistribution?.targetInterruption as
        | Record<string, unknown>
        | undefined;
    expect(aliceDisplayLeakyCoreTargetInterruption).not.toHaveProperty(
      "effectResolutionBeforeState"
    );
    const aliceDisplayLeakyCoreTargetStepContext =
      aliceDisplayLeakyCoreTargetInterruption?.stepContext as
        | Record<string, unknown>
        | undefined;
    expect(aliceDisplayLeakyCoreTargetStepContext).not.toHaveProperty(
      "pendingConditionalCostRollback"
    );
    const aliceDisplayLeakyCoreTargetResults =
      aliceDisplayLeakyCoreTargetStepContext?.results as
        | Record<string, Record<string, unknown>>
        | undefined;
    expect(
      aliceDisplayLeakyCoreTargetResults?.["leak-step"]
    ).not.toHaveProperty("stateSnapshot");
    const aliceDisplayStepOptionalDisclosure = sanitizeStateForViewer(
      stateWithStepOptionalDisclosure,
      ALICE
    ).pendingStepOptionalChoice?.continuation.targetedDisclosureContinuation as
      | Record<string, unknown>
      | undefined;
    expect(aliceDisplayStepOptionalDisclosure).toBeDefined();
    expect(aliceDisplayStepOptionalDisclosure).not.toHaveProperty(
      "effectResolutionBeforeState"
    );
    const aliceDisplayStepOptionalContext =
      aliceDisplayStepOptionalDisclosure?.stepContext as
        | Record<string, unknown>
        | undefined;
    expect(aliceDisplayStepOptionalContext).not.toHaveProperty(
      "pendingConditionalCostRollback"
    );
    const aliceDisplayStepOptionalResults =
      aliceDisplayStepOptionalContext?.results as
        | Record<string, Record<string, unknown>>
        | undefined;
    expect(aliceDisplayStepOptionalResults?.["leak-step"]).not.toHaveProperty(
      "stateSnapshot"
    );
    const aliceTopLevelPending = sanitizeStateForViewer(
      stateWithTopLevelPendingSnapshots,
      ALICE
    );
    for (const pending of [
      aliceTopLevelPending.pendingDeckReveal,
      aliceTopLevelPending.pendingZoneSelection,
      aliceTopLevelPending.pendingDeckRevealSwapChain[0],
      aliceTopLevelPending.pendingCoreCountSelection,
      aliceTopLevelPending.pendingCountSelection,
      aliceTopLevelPending.pendingDiscardSetBurstCountSelection,
      aliceTopLevelPending.pendingMultiPlacement,
    ] as Array<Record<string, unknown> | null>) {
      expect(pending).toBeDefined();
      expect(pending).not.toHaveProperty("priorStateSnapshot");
      const continuation = pending?.continuation as
        | Record<string, unknown>
        | undefined;
      const continuationStepContext = continuation?.stepContext as
        | Record<string, unknown>
        | undefined;
      expect(continuationStepContext).not.toHaveProperty(
        "pendingConditionalCostRollback"
      );
      const continuationResults = continuationStepContext?.results as
        | Record<string, Record<string, unknown>>
        | undefined;
      expect(continuationResults?.["leak-step"]).not.toHaveProperty(
        "stateSnapshot"
      );
      expect(
        continuation?.targetedDisclosureContinuation as
          | Record<string, unknown>
          | undefined
      ).not.toHaveProperty("effectResolutionBeforeState");
    }
    expect(
      sanitizeStateForViewer(stateWithTopLevelPendingSnapshots, BOB)
        .pendingDeckReveal
    ).toBeNull();
    expect(
      sanitizeStateForViewer(stateWithTopLevelPendingSnapshots, BOB)
        .pendingZoneSelection
    ).toBeNull();
    expect(
      sanitizeStateForViewer(stateWithTopLevelPendingSnapshots, BOB)
        .pendingDeckRevealSwapChain
    ).toHaveLength(0);
    expect(
      sanitizeStateForViewer(stateWithTopLevelPendingSnapshots, BOB)
        .pendingMultiPlacement
    ).toBeNull();
    expect(
      sanitizeStateForViewer(afterResolved, BOB).pendingEnterFieldPlacement
    ).toBeNull();
    expect(
      maskPendingPromptsForViewer(
        sanitizeStateForViewer(afterResolved, BOB),
        BOB
      ).pendingEnterFieldPlacement
    ).toBeNull();
    const resolvePlacement = getLegalActions({
      state: afterResolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const afterPlacement = applyLegalAction({
      state: afterResolved,
      action: resolvePlacement!,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(afterPlacement.players.find((p) => p.id === ALICE)?.handCount).toBe(
      0
    );
    expect(afterPlacement.log).toContain(
      "effect:summon:c32-hand-defense:direct-combine:from=hand:cost=0"
    );
    expect(afterPlacement.log).toContain(
      "brave:combine:effect:1:alice:c32-hand-defense:c32-target-host:cores:1"
    );
    expect(afterPlacement.pendingTargetedDisclosureContinuation).toBeNull();

    const c32After = afterPlacement.cardInstances.find(
      (card) => card.instanceId === c32Hand.instanceId
    );
    const hostAfter = afterPlacement.cardInstances.find(
      (card) => card.instanceId === host.instanceId
    );
    expect(c32After?.zone).toBe("field");
    expect(c32After?.attachedToInstanceId).toBe(host.instanceId);
    expect(hostAfter?.attachedChildrenIds).toContain(c32Hand.instanceId);
    expect(hostAfter?.normalCoreCount).toBe(2);
    expect(hostAfter?.zone).toBe("field");
    expect(hostAfter?.pendingLeaveKind).toBeNull();
    expect(
      afterPlacement.pendingLeaveEntities.some(
        (entry) => entry.instanceId === host.instanceId
      )
    ).toBe(false);
    expect(
      afterPlacement.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "cannot_leave_field" &&
          ce.targetInstanceId === host.instanceId &&
          ce.metadata?.source === "opponent"
      )
    ).toBe(true);
  });

  it("[board] 受けない分岐は非離脱の元BP低下効果を受けない", () => {
    const result = resolveC32DefenseAgainstBpMinus({ c32ChoiceIndex: 1 });

    expect(result.log).toContain(
      "effect:summon:c32-hand-bp-defense:direct-combine:from=hand:cost=0"
    );
    expect(result.log).toContain(
      "effect:effect_immunity:registered:c32-bp-host:current_effect"
    );
    expect(
      result.log.some((line) =>
        line.startsWith("effect:bp_modify:registered:c32-bp-host:-5000")
      )
    ).toBe(false);
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.targetInstanceId === "c32-bp-host"
      )
    ).toBe(false);
    expect(
      result.cardInstances.find((card) => card.instanceId === "c32-bp-host")
        ?.zone
    ).toBe("field");
  });

  it("[board] 無効にする分岐は元BP低下スタックをnullifiedにする", () => {
    const result = resolveC32DefenseAgainstBpMinus({ c32ChoiceIndex: 0 });

    expect(result.log).toContain(
      "effect:summon:c32-hand-bp-defense:direct-combine:from=hand:cost=0"
    );
    expect(
      result.log.some(
        (line) =>
          line.includes("effect:negate:") && line.includes("stack:c32-bp")
      )
    ).toBe(true);
    expect(
      result.log.some((line) =>
        line.startsWith("effect:bp_modify:registered:c32-bp-host:-5000")
      )
    ).toBe(false);
    expect(result.pendingStackNegateRequests).toHaveLength(0);
  });

  it("[board] 無効にする分岐はhand-written対象開示再開でも元効果resolverを実行しない", () => {
    const magicDef = makeOpponentHandWrittenBpMinusMagic();
    const definitions = [...ALL_CARDS, ...testDefs, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === magicDef.cardNo
        ? makeHandWrittenBpMinusResolver(cardNo)
        : undefined;
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
      getHandWrittenEffectResolver,
    };
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-hand-written-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-written-defense",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-c32-hand-written-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      activePlayerId: BOB,
      step: "attack",
    };
    const stack: ActiveStack = {
      stackId: "stack:c32-hand-written-bp",
      actionKind: "magic",
      chainId: "chain:c32-hand-written-bp",
      actingPlayerId: BOB,
      cardInstanceId: magic.instanceId,
      cardDefinitionId: magicDef.cardNo,
      targetInstanceIds: [host.instanceId],
      targetSelectionResolved: true,
      targetStepId: "hand-written-bp-minus-host",
      targetEffectFilterTags: ["bp_modify"],
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const afterDisclosure = resolveStackCascade(state, [stack], {
      getCardDefinitionById: getDef,
      ...effectLookups,
      getRegisteredBurstActions: () => [],
    });
    expect(
      afterDisclosure.pendingTargetedDisclosureContinuation
        ?.handWrittenResolution
    ).toBeDefined();
    expect(
      afterDisclosure.pendingTargetedDisclosureContinuation
        ?.negateIdentitySnapshot?.stackId
    ).toBe(stack.stackId);
    expect(
      afterDisclosure.pendingPrivateDeclarations.some(
        (declaration) => declaration.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(true);

    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const c32Response = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === c32Hand.instanceId &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(0)
    );
    expect(c32Response).toBeDefined();
    const afterC32 = applyLegalAction({
      state: afterPrivateDeclared,
      action: c32Response!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const passStack = getLegalActions({
      state: afterC32,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterC32,
      action: passStack!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const chooseBranch = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 0
    );
    expect(chooseBranch).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterStackPassed,
      action: chooseBranch!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const resolvePlacement = getLegalActions({
      state: afterResolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const result = applyLegalAction({
      state: afterResolved,
      action: resolvePlacement!,
      enterFieldCorePlacements: [],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(result.log).toContain(
      "effect:summon:c32-hand-written-defense:direct-combine:from=hand:cost=0"
    );
    expect(result.log).toContain(
      `effect:negate:pending-stack:effect:${stack.stackId}`
    );
    expect(
      result.log.some(
        (line) =>
          line.startsWith("effect:negate:targeted-disclosure-hand-written:") &&
          line.includes("chain:c32-hand-written-bp")
      )
    ).toBe(true);
    expect(
      result.log.some((line) =>
        line.startsWith("hand-written:c32-bp-minus:resolved:")
      )
    ).toBe(false);
    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.effectId === "hw-c32-bp-minus"
      )
    ).toBe(false);
    expect(result.pendingStackNegateRequests).toHaveLength(0);
    expect(result.pendingTargetedDisclosureContinuation).toBeNull();
  });

  it("[board] 手札からの直接合体召喚はC32自身の召喚時効果をpendingに積む", () => {
    const magicDef = makeOpponentDestroyMagic();
    const c32WithSummonTrigger: CardDefinition = {
      ...C32,
      cardNo: "TEST-C32-WITH-SUMMON-TRIGGER",
      effects: [
        C32.effects![0]!,
        C32.effects![1]!,
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [],
        },
      ],
    };
    const definitions = [
      ...ALL_CARDS,
      ...testDefs,
      magicDef,
      c32WithSummonTrigger,
    ];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };

    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-summon-trigger-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(c32WithSummonTrigger, {
      instanceId: "c32-hand-summon-trigger",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-c32-summon-trigger-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      activePlayerId: BOB,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:c32-summon-trigger",
        actingPlayerId: BOB,
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: magicDef.cardNo,
        deferredStack: {
          stackId: "stack:c32-summon-trigger",
          actionKind: "magic",
          chainId: "chain:c32-summon-trigger",
          actingPlayerId: BOB,
          cardInstanceId: magic.instanceId,
          cardDefinitionId: magicDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: ["destroy"],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        targetStepId: "destroy-host",
        candidateInstanceIds: [host.instanceId],
        targetEffectFilterTags: ["destroy"],
      },
    };

    const chooseHost = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseHost).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseHost!,
      targetInstanceIds: [host.instanceId],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const c32Response = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === c32Hand.instanceId &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(1)
    );
    expect(c32Response).toBeDefined();
    const afterC32 = applyLegalAction({
      state: afterPrivateDeclared,
      action: c32Response!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const passStack = getLegalActions({
      state: afterC32,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterC32,
      action: passStack!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const chooseBranch = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(chooseBranch).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterStackPassed,
      action: chooseBranch!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(afterResolved.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      c32Hand.instanceId
    );
    expect(afterResolved.pendingEnterFieldPlacement?.minimumCoreCount).toBe(0);
    const resolvePlacement = getLegalActions({
      state: afterResolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const afterPlacement = applyLegalAction({
      state: afterResolved,
      action: resolvePlacement!,
      enterFieldCorePlacements: [],
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(afterPlacement.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "summon",
        relatedInstanceId: c32Hand.instanceId,
        fromZone: "hand",
      })
    );
    expect(
      getLegalActions({
        state: afterPlacement,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        ...effectLookups,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(true);
    expect(afterPlacement.log).toContain(
      "effect:summon:c32-hand-summon-trigger:direct-combine:from=hand:cost=0"
    );
  });

  it("[board] 低コスト導魔スピリットの対象化はC32のprivate declarationを積まない", () => {
    const magicDef = makeOpponentDestroyMagic();
    const lowCostDoumaSpirit: CardDefinition = {
      ...spiritHostDef,
      cardNo: "TEST-C32-LOW-COST-DOMA",
      cost: 4,
    };
    const definitions = [...ALL_CARDS, lowCostDoumaSpirit, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const lookup = buildTriggeredEffectLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(lowCostDoumaSpirit, {
      instanceId: "c32-low-cost-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-low-cost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-low-cost-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, c32Hand, magic],
    });

    const disclosure = executeEffect({
      chainId: "test:bsth003-brave-condition-alternatives-nexus:3039",
      state: baseState,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      targetInstanceIds: [host.instanceId],
      targetStepId: "destroy-host",
      effectActionKind: "magic",
    });

    const privateDeclaration = disclosure.pendingPrivateDeclarations.find(
      (declaration) => declaration.sourceInstanceId === c32Hand.instanceId
    );
    expect(privateDeclaration).toBeUndefined();
    const privateActions = getLegalActions({
      state: disclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    expect(
      privateActions.some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);
    expect(
      privateActions.some(
        (action) =>
          action.kind === "skip_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);

    const stepCtx = createStepExecutionContext(disclosure);
    stepCtx.sourceInstanceId = c32Hand.instanceId;
    stepCtx.triggerRelatedInstanceId = host.instanceId;
    expect(
      canExecuteOptionalStep({
        action: effect.steps[0]!.action!,
        state: disclosure,
        actingPlayerId: ALICE,
        sourceInstanceId: c32Hand.instanceId,
        sourceDefinition: C32,
        getCardDefinitionById: getDef,
        stepCtx,
      })
    ).toBe(false);
    const attempted = executeEffect({
      chainId: "test:bsth003-brave-condition-alternatives-nexus:3091",
      state: disclosure,
      effect,
      effectIndex: 1,
      sourceInstanceId: c32Hand.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      triggerRelatedInstanceId: host.instanceId,
    });
    expect(
      attempted.log.some((entry) =>
        entry.includes(
          "effect:summon:c32-hand-low-cost:direct-combine:from=hand"
        )
      )
    ).toBe(false);
    expect(
      attempted.log.some(
        (entry) =>
          entry.includes("brave:combine:effect:") &&
          entry.includes(":c32-hand-low-cost:")
      )
    ).toBe(false);
    expect(
      attempted.cardInstances.find(
        (card) => card.instanceId === c32Hand.instanceId
      )?.zone
    ).toBe("hand");
    expect(
      attempted.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "cannot_leave_field" &&
          ce.targetInstanceId === host.instanceId
      )
    ).toBe(false);
  });

  it("[board] 合体中コスト5の導魔スピリット対象化はC32のprivate declarationを積む", () => {
    const magicDef = makeOpponentDestroyMagic();
    const lowCostDoumaSpirit: CardDefinition = {
      ...spiritHostDef,
      cardNo: "TEST-C32-COMBINED-COST-DOMA",
      cost: 4,
    };
    const costOneBrave: CardDefinition = {
      ...normalBraveDef,
      cardNo: "TEST-C32-COST-ONE-BRAVE",
      cost: 1,
    };
    const definitions = [
      ...ALL_CARDS,
      lowCostDoumaSpirit,
      costOneBrave,
      magicDef,
    ];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const lookup = buildTriggeredEffectLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(lowCostDoumaSpirit, {
      instanceId: "c32-combined-cost-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: ["c32-cost-one-brave"],
    });
    const attachedBrave = createCardInstance(costOneBrave, {
      instanceId: "c32-cost-one-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-combined-cost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-combined-cost-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, attachedBrave, c32Hand, magic],
    });

    const disclosure = executeEffect({
      chainId: "test:bsth003-brave-condition-alternatives-nexus:3192",
      state: baseState,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      targetInstanceIds: [host.instanceId],
      targetStepId: "destroy-host",
      effectActionKind: "magic",
    });

    expect(
      disclosure.pendingPrivateDeclarations.some(
        (declaration) => declaration.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(true);
    expect(
      getLegalActions({
        state: disclosure,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        ...effectLookups,
      }).some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(true);
  });

  it("[board] 実効コスト5の導魔スピリット対象化はC32のprivate declarationを積む", () => {
    const magicDef = makeOpponentDestroyMagic();
    const effectiveCostDoumaSpirit: CardDefinition = {
      ...spiritHostDef,
      cardNo: "TEST-C32-EFFECTIVE-COST-DOMA",
      cost: 4,
    };
    const definitions = [...ALL_CARDS, effectiveCostDoumaSpirit, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const lookup = buildTriggeredEffectLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(effectiveCostDoumaSpirit, {
      instanceId: "c32-effective-cost-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-effective-cost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-effective-cost-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const costOverride: ContinuousEffect = {
      effectId: "ce-c32-effective-cost",
      sourceInstanceId: "cost-source",
      sourceDefinitionId: "TEST-COST-SOURCE",
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: host.instanceId,
      metadata: { properties: { cost: 5 } },
    };
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
      }),
      activeContinuousEffects: [costOverride],
    };

    const disclosure = executeEffect({
      chainId: "test:bsth003-brave-condition-alternatives-nexus:3282",
      state: baseState,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      targetInstanceIds: [host.instanceId],
      targetStepId: "destroy-host",
      effectActionKind: "magic",
    });

    expect(
      disclosure.pendingPrivateDeclarations.some(
        (declaration) => declaration.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(true);
    expect(
      getLegalActions({
        state: disclosure,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        ...effectLookups,
      }).some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(true);
  });

  it("[board] asSummon の直接合体は召喚制限時に optional step 実行不可になる", () => {
    const magicDef = makeOpponentDestroyMagic();
    const definitions = [...ALL_CARDS, ...testDefs, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const lookup = buildTriggeredEffectLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-restricted-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(C32, {
      instanceId: "c32-hand-restricted",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-restricted-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, c32Hand, magic],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-c32-restrict-summon",
          sourceInstanceId: "restriction-source",
          sourceDefinitionId: "TEST-RESTRICT-SOURCE",
          actingPlayerId: BOB,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "restrict_use",
          targetInstanceId: ALICE,
          metadata: {
            filter: { category: ["brave"] },
            restrictedKinds: ["summon"],
          },
        },
      ],
    };
    const disclosure = executeEffect({
      chainId: "test:bsth003-brave-condition-alternatives-nexus:3370",
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      targetInstanceIds: [host.instanceId],
      targetStepId: "destroy-host",
      effectActionKind: "magic",
    });
    const privateActions = getLegalActions({
      state: disclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    expect(
      privateActions.some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);
    expect(
      privateActions.some(
        (action) =>
          action.kind === "skip_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);

    expect(
      disclosure.pendingPrivateDeclarations.some(
        (pending) => pending.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);

    const stepCtx = createStepExecutionContext(disclosure);
    stepCtx.sourceInstanceId = c32Hand.instanceId;
    stepCtx.triggerRelatedInstanceId = host.instanceId;

    expect(
      canExecuteOptionalStep({
        action: effect.steps[0]!.action!,
        state: disclosure,
        actingPlayerId: ALICE,
        sourceInstanceId: c32Hand.instanceId,
        sourceDefinition: C32,
        getCardDefinitionById: getDef,
        stepCtx,
      })
    ).toBe(false);
  });

  it("[board] asSummon の直接合体は転召対象不在なら optional step 実行不可になる", () => {
    const tenshoC32Def: CardDefinition = {
      ...C32,
      cardNo: "TEST-C32-TENSHO-AS-SUMMON",
      name: "テスト転召C32",
      tenshoSummon: {
        targetFilter: { category: ["spirit"], tribes: ["存在しない"] },
        minCores: 1,
        destination: "void",
      },
    };
    const magicDef = makeOpponentDestroyMagic();
    const definitions = [...ALL_CARDS, ...testDefs, tenshoC32Def, magicDef];
    const localDefMap = new Map<string, CardDefinition>(
      definitions.map((def) => [def.cardNo, def])
    );
    const getDef = (id: string): CardDefinition | undefined =>
      localDefMap.get(id);
    const lookup = buildTriggeredEffectLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => [],
    };
    const host = createCardInstance(spiritHostDef, {
      instanceId: "c32-tensho-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const c32Hand = createCardInstance(tenshoC32Def, {
      instanceId: "c32-hand-tensho",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bob-tensho-target-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, c32Hand, magic],
    });
    const disclosure = executeEffect({
      chainId: "test:bsth003-brave-condition-alternatives-nexus:3473",
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      targetInstanceIds: [host.instanceId],
      targetStepId: "destroy-host",
      effectActionKind: "magic",
    });
    const privateActions = getLegalActions({
      state: disclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    expect(
      privateActions.some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);
    expect(
      privateActions.some(
        (action) =>
          action.kind === "skip_private_triggered_effect" &&
          action.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);

    expect(
      disclosure.pendingPrivateDeclarations.some(
        (pending) => pending.sourceInstanceId === c32Hand.instanceId
      )
    ).toBe(false);

    const stepCtx = createStepExecutionContext(disclosure);
    stepCtx.sourceInstanceId = c32Hand.instanceId;
    stepCtx.triggerRelatedInstanceId = host.instanceId;

    expect(
      canExecuteOptionalStep({
        action: effect.steps[0]!.action!,
        state: disclosure,
        actingPlayerId: ALICE,
        sourceInstanceId: c32Hand.instanceId,
        sourceDefinition: tenshoC32Def,
        getCardDefinitionById: getDef,
        stepCtx,
      })
    ).toBe(false);
  });
});

describe("BSTH003-M02 braveCondition.alternatives: OR-of-AND (導魔/秘封 いずれか ＆ 導界者)", () => {
  it("導魔系統の導界者ネクサスへ合体できる", () => {
    const brave = createCardInstance(M02, {
      instanceId: "m02-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doukaishaNexusDef, {
      instanceId: "m02-nexus-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions.some((a) => a.targetInstanceId === nexus.instanceId)).toBe(
      true
    );
  });

  it("秘封系統の導界者ネクサスへも合体できる (alternatives 2件目)", () => {
    const brave = createCardInstance(M02, {
      instanceId: "m02-2",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const hifuuNexus = createCardInstance(hifuuNexusDef, {
      instanceId: "m02-nexus-2",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, hifuuNexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      actions.some((a) => a.targetInstanceId === hifuuNexus.instanceId)
    ).toBe(true);
  });

  it("導魔/秘封どちらも持たない導界者ネクサスへは合体できない", () => {
    const brave = createCardInstance(M02, {
      instanceId: "m02-3",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(plainNexusDef, {
      instanceId: "m02-nexus-3",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions.some((a) => a.targetInstanceId === nexus.instanceId)).toBe(
      false
    );
  });

  it("導魔/秘封かつコスト5以上でも導界者でないネクサスは通常枝で候補にしない", () => {
    const brave = createCardInstance(M02, {
      instanceId: "m02-doma-only-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doumaOnlyHighCostNexusDef, {
      instanceId: "nexus-doma-only-m02",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions.some((a) => a.targetInstanceId === nexus.instanceId)).toBe(
      false
    );
  });

  it("act_as_spirit中の導魔ネクサスでも、導界者でなければM02の通常枝で候補にしない", () => {
    const brave = createCardInstance(M02, {
      instanceId: "m02-act-as-spirit-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(doumaOnlyHighCostNexusDef, {
      instanceId: "nexus-act-as-spirit-m02",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [actAsSpiritCE(nexus.instanceId)],
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions.some((a) => a.targetInstanceId === nexus.instanceId)).toBe(
      false
    );
  });
});
