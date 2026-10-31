/**
 * ENGINE-divine-skill-stack-timing-variant:
 * DivineSkillTiming に "flash_or_stack" variant を追加し、isDivineSkillTimingMatch がその
 * variant のときのみスタック応答窓中も神技を legal 化する (BSTH11-X01「【神技：2～6】Lv2：
 * フラッシュ/スタック」型)。
 *
 * 裁定 2026-08-04 (needs-ruling.jsonl BSTH11-X01 kind:"gap"、ruling-researcher信頼度A):
 * 「フラッシュ/スタック」併記はタイミング二重指定（フラッシュ本体ループでの能動起動に加え、
 * 相手行動へのスタック応答窓でも起動宣言できる）。通常 activated 効果 (BSTH11-C05 precedent)
 * は mode:"flash"/mode:"stack" の2 effect 分割で表現するが、神技は専用の DivineSkillTiming
 * 型を使うため単一 variant として表現する。
 *
 * 既存の "flash" 単独 variant がスタック応答窓中は従来どおり除外されたままであることも
 * 回帰確認する (isDivineSkillTimingMatch の他分岐に影響しないこと)。
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import { executeEffect } from "../src/effect/effect-interpreter";
import type {
  ActiveAttack,
  ActiveStack,
  CardDefinition,
  DivineSkillTiming,
  Effect,
  GameState,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

function makeNexus(timing: DivineSkillTiming): CardDefinition {
  return {
    cardNo: `TEST-DIVINE-SKILL-STACK-TIMING-${JSON.stringify(timing)}`,
    name: "テスト創界神(神技タイミング)",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 2,
          timing,
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: { kind: "count_increase", player: "self", amount: 1 },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

const FLASH_NEXUS = makeNexus("flash");
const FLASH_OR_STACK_NEXUS = makeNexus("flash_or_stack");
const defs = [FLASH_NEXUS, FLASH_OR_STACK_NEXUS];
const defMap = new Map(defs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => defMap.get(id);

function baseCardInstances(def: CardDefinition) {
  return [
    createCardInstance(def, {
      instanceId: "nexus-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    }),
  ];
}

/** bob アタック中、before_block フラッシュ本体ループで alice が優先権を持つ状態。 */
function buildFlashBodyState(def: CardDefinition): GameState {
  const activeAttack: ActiveAttack = {
    attackId: "atk-1",
    primaryEntityId: "e-attacker",
    participantEntityIds: ["e-attacker"],
    groupMode: "single",
    target: { kind: "player", playerId: ALICE },
    blockAssignments: [],
    symbolResolutionOrder: [],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: {
      kind: "before_block",
      priorityPlayerId: ALICE,
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: ALICE,
      pendingStackAction: null,
    },
  };
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: baseCardInstances(def),
    activeAttack,
    battleEntities: [
      {
        entityId: "e-attacker",
        memberInstanceIds: ["bob-attacker"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
  });
  return {
    ...base,
    step: "attack",
    activePlayerId: BOB,
    window: "flash_before_block",
  };
}

/** bob の未知のスタック行動へ alice が応答優先権を持つスタック窓の状態。 */
function buildStackResponseState(def: CardDefinition): GameState {
  const bobPendingStack: ActiveStack = {
    stackId: "stack:bob-dummy",
    actionKind: "magic",
    chainId: "chain:bob-dummy",
    actingPlayerId: BOB,
    cardInstanceId: "bob-dummy-magic",
    cardDefinitionId: "BOB-DUMMY-MAGIC",
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: baseCardInstances(def),
  });
  return {
    ...base,
    step: "main",
    activePlayerId: BOB,
    window: "stack",
    stackWindow: {
      priorityPlayerId: ALICE,
      consecutivePassCount: 0,
      actingPlayerId: BOB,
      previousWindow: "main",
      stackResponseSourcePlayerId: BOB,
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: bobPendingStack,
    },
  };
}

describe("ENGINE-divine-skill-stack-timing-variant: 神技タイミングのフラッシュ/スタック二重指定", () => {
  it("flash_or_stack: フラッシュ本体ループ中は legal", () => {
    const state = buildFlashBodyState(FLASH_OR_STACK_NEXUS);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
  });

  it("flash_or_stack: スタック応答窓中(応答優先権あり)も legal", () => {
    const state = buildStackResponseState(FLASH_OR_STACK_NEXUS);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
  });

  it("回帰: flash 単独 variant はスタック応答窓中では従来どおり除外される", () => {
    const state = buildStackResponseState(FLASH_NEXUS);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(0);
  });

  it("回帰: flash 単独 variant はフラッシュ本体ループ中は従来どおり legal", () => {
    const state = buildFlashBodyState(FLASH_NEXUS);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
  });

  it("flash_or_stack: 応答優先権を持たない側には legal action が出ない", () => {
    const state = buildStackResponseState(FLASH_OR_STACK_NEXUS);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(0);
  });

  /** BOB 発の restrict_stack(player:"opponent") を alice へ登録する (p3-75-restrict-stack.test.ts runEffect と同型)。 */
  function withAliceRestrictedFromStack(state: GameState): GameState {
    const restrictEffect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "restrict_stack",
            player: "opponent",
            duration: { scope: "turn" },
          },
        },
      ],
    };
    return executeEffect({
      chainId: "test:engine-divine-skill-stack-timing-variant:231",
      state,
      effect: restrictEffect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: BOB,
      getCardDefinitionById,
    });
  }

  it("敵対的検証2026-08-04 lens3 修正確認: restrict_stack CE があるスタック応答窓では flash_or_stack のスタック側も除外される(通常 magic stack 経路 getCurrentMagicActionTimings と同じ filterRestrictedTimings を通す)", () => {
    const state = withAliceRestrictedFromStack(
      buildStackResponseState(FLASH_OR_STACK_NEXUS)
    );
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(0);
  });

  it("敵対的検証2026-08-04 lens3 修正確認: restrict_stack CE が無ければ従来どおり flash_or_stack のスタック側は legal", () => {
    const state = buildStackResponseState(FLASH_OR_STACK_NEXUS);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
  });

  /** BOB 発の restrict_stack(player:"opponent", targetScope:"effect_source") を
   * alice へ登録する（BSSL01-M02/BSTH04-転醒R02(A) 型、創界神ネクサス明記なし読点なし文言）。 */
  function withAliceEffectSourceRestrictedFromStack(
    state: GameState
  ): GameState {
    const restrictEffect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "restrict_stack",
            player: "opponent",
            duration: { scope: "turn" },
            targetScope: "effect_source",
          },
        },
      ],
    };
    return executeEffect({
      chainId: "test:engine-divine-skill-stack-timing-variant:280",
      state,
      effect: restrictEffect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: BOB,
      getCardDefinitionById,
    });
  }

  it("P3-148: 創界神ネクサス明記なしの restrict_stack(effect_source) 下でも、自己免疫テキストを持たない創界神ネクサスの神技はスタックタイミングで発揮できる (matchesCardFilter 既定除外の合流)", () => {
    const state = withAliceEffectSourceRestrictedFromStack(
      buildStackResponseState(FLASH_OR_STACK_NEXUS)
    );
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
  });
});
