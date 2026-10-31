import { chooseRuleBraveCores } from "./helpers/rule-brave-choice-driver";
/**
 * BSFT01 (フェアリーテイル-ルーシィ・ハートフィリア-) サブバッチ1+2 の effects 検証テスト。
 *
 * サブバッチ1 (10枚): C01, C02, C03, C04, CX01, TR01, TR02, TR03, TR04, TR05。
 * サブバッチ2 (9枚): TR06(A)-TR13(A) 前面/背面 + X01。
 *   実装した忠実効果(サブバッチ2):
 *     - TR06 スタック exhaust(2体まで,attack,per_card_name) / TR07 フラッシュ exhaust(spirit/ult/nexus 1体)
 *       +ただちにバトル終了(end_battle)
 *     - TR08(B) Lv2-3 BP+3000 / TR09 スタック prevent_life_damage(self,battle,field_has ルーシィ gate)
 *     - TR10(B) 転醒時 prevent_battle(相手1体,attack,turn) / TR11 フラッシュ core_move(void→life,1,相手在場 gate)
 *     - TR12 メイン deck_reveal(3,光導brave pick→hand) / TR13 メイン deck_reveal(3破棄)+search_zone(trash 光導brave→hand)
 *     - X01 Lv4 アタック時 ネクサス破壊
 *   注: 各 TR back の flip 時カウント+1 はルール (08a §2 手順3、効果ではない) で
 *     executeRebirth が適用する。effects への count_increase 記載は二重計上のため禁止
 *     （rebirth-boilerplate-guard.test.ts）。
 *   needs-dsl park(サブバッチ2): 星霊衣 underlay全効果 / 疲労状態ブロック付与 /
 *     効果発揮抑制(blanket) / pay-to-attack ゲート / ライフ減少上限キャップ / 攻撃者単位ライフ抑止 /
 *     代替召喚(多ゾーン+ブレイヴ除外コスト) / スタック・煌臨抑止 restriction / 複数系統AND場存在制限。
 *
 * 以下はサブバッチ1の記録:
 *
 * 実装した忠実効果:
 *   - C03 配置時 デッキ上3枚トラッシュ（deck_reveal revealCount:3 picks:[] remainder:trash）
 *   - TR01 フラッシュ 自分の星霊/鍵効果への発生源系統ベース stack negate 耐性 CE
 *     + 転醒/合体許可窓
 *   - TR02 スタック effect_immunity（自分の「ルーシィ」1体・scope battle・アタックステップ限定・per_card_name）
 *   - TR03(B) Lv1-Lv3 カード名を「ルーシィ・ハートフィリア」として扱う（override_properties cardName）
 *   - TR04 フラッシュ 相手ネクサス3つまで破壊（destroy count {min:0,max:3}）＋相手創界神ネクサス全コアをボイド
 *   - TR04(B) Lv1-Lv3 アタック時 BP15000以下の相手1体破壊（destroy maxBp:15000）
 *   - TR05 スタック 自分の「ルーシィ」/光導スピリットへ相手起因離脱残置（grant_effect + stay_on_field）
 *   - TR05(B) Lv2-Lv3 self+「ルーシィ」へ離脱耐性（effect_resistance leave_field all）
 *   - TR01-TR05 front 転醒トリガー（rebirth action。flip 本体のみ。flip 時カウント+1 は
 *     executeRebirth がルールとして適用、effects 化禁止）
 *   - TR01(B) 転醒時 相手1体デッキ下（send_to_deck）
 *   - TR01(A) フラッシュ 鍵ブレイヴの効果メタ保護（grant_effect_source_prevention_immunity、
 *     sourceScope.tribes:["星霊","鍵"]+duration:turn。field_card_effect(flash/stack/main)
 *     宣言への isEffectSourceTribePreventionImmune 適用を新設、本カードが初出）
 *
 * 真に未実装で needs-dsl park（doc 引用済み、空 effects か stub）:
 *   - 鍵/星霊効果でのデッキオープン/トラッシュ行き時の自己回収（C02/C03[0]/C04）
 *   - C01[0] は swap 型 displacement（OPEN ruling、needs-ruling）
 *   - BP 比較破壊・動的 BP 修飾（C02 フラッシュ）/ 動的系統一致疲労（C01[5,6]）
 *   注: C01[2,3] フラッシュ「合体ブレイヴ floor(/2) 強制破壊＋カウント5以上で破壊対象の
 *     効果抑制」は実装済（DynamicCount divisor + combined/soulState filter + suppressDestroyedEffects）。
 *     「相手の効果で防げない」rider のみ未配線で partial stub。
 *   - 星霊衣 host-subcard 機構（CX01・全 TR back face、07_custom §6）
 *   - 鍵ブレイヴの効果スティール・効果コピー
 *   - 複数系統 AND の場存在数制限
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  resolveBpCompareDestroyAffect,
  resolveCardExhaustAffect,
  runStateBasedActions,
  queuePendingLeave,
  flushPendingLeaves,
} from "../src";
import type {
  ActiveAttack,
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  Effect,
  GameState,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import {
  evaluateCondition,
  evaluateConditionClause,
} from "../src/effect/structured-condition-eval";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getCurrentActorPlayerIds } from "../src/current-actor";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { maskPendingPromptsForViewer } from "../src/state-sanitize";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import {
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
} from "../src/battle/battle-availability";
import {
  confirmBlockDeclarationAsAction,
  executeBattleResolution,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src/battle/battle-actions";
import {
  getAvailableBraveCombineLegalActions,
  getAvailableBraveSeparateLegalActions,
  getAvailableBraveSwapLegalActions,
  getAvailableFieldCardEffectLegalActions,
} from "../src/legal/legal-actions-availability";
import {
  getApplicableAdditionalCostDelta,
  matchesCardFilter,
} from "../src/card/card-filter";
import {
  getEffectiveSoulStateIds,
  isSoulStateInheritingKeyBraveDefinition,
} from "../src/mechanics/magic-compatible-soul-state";
import {
  buildMagicLookup,
  buildBurstEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
  generateFieldCardEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import {
  canUseEffectByUsageLimit,
  getCandidateTargetInstanceIds,
  filterTargetsByPreventionLevel,
  recordEffectUsageIfLimited,
  recomputeContinuousEffects,
  executeReevaluationCheck,
} from "../src/legal/legal-actions-shared";
import { getPlayerLifeCoreCount } from "../src/core/core-system";
import { resolveStackCascade } from "../src/legal/stack-resolution-core";
import { createActionInputDecisionNode } from "../src/training-decision-surface";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.flatMap((c) =>
    c.backFace
      ? [[c.cardNo, c] as const, [c.backFace.cardNo, c.backFace] as const]
      : [[c.cardNo, c] as const]
  )
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];
const noFieldEffectLookup = () => [] as const;

function summonResponseStack(
  cardInstanceId: string,
  definitionId: string,
  actingPlayerId: string
): ActiveStack {
  return {
    stackId: `stack:summon:${cardInstanceId}`,
    actionKind: "triggered_effect",
    chainId: `trigger:summon:${cardInstanceId}`,
    actingPlayerId,
    cardInstanceId,
    cardDefinitionId: definitionId,
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    triggeredRegistrationIndex: 0,
    triggeredSourceCardNo: definitionId,
    triggeredSourceKind: "spirit",
    suppressionEffectDescriptor: {
      sourceDefinitionId: definitionId,
      sourceKind: "spirit",
      effectIndex: 0,
      timingKind: "card_event",
      eventAction: "summon",
    },
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

function fieldActionEffectIndexes(
  definition: CardDefinition,
  actions: readonly { registrationIndex: number }[]
): Array<number | undefined> {
  const registrations = generateFieldCardEffectRegistrations(definition);
  return actions.map(
    (action) => registrations[action.registrationIndex]?.effectIndex
  );
}

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined = getDef
): GameState {
  return executeEffect({
    chainId: "test:bsft01-cards:196",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

/**
 * BSFT01 TR系【転醒】許可窓 (bsft01-tr-rebirth-permission-window) の
 * executionMode:"optional" な rebirth ステップは、元効果本体のテスト観点では
 * 無関係な pendingStepOptionalChoice を残す。以降の legal action 列挙/SBA を
 * 妨げないよう、対象外の [board] テストでは辞退して baseline に戻す。
 */
function declineRebirthWindowIfPending(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined = getDef
): GameState {
  // bsft01-tr-rebirth-permission-window: rebirth_window (裏返す) を decline すると
  // combine_window (合体) が独立した optional ステップとして続けて pending になるため、
  // pendingStepOptionalChoice が無くなるまでループで decline する。
  let current = state;
  while (current.pendingStepOptionalChoice) {
    const pending = current.pendingStepOptionalChoice;
    current = applyLegalAction({
      state: current,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test-baseline",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
  }
  return current;
}

function grantedEffectPendings(state: GameState) {
  return state.pendingTriggeredEffects.filter(
    (pending) => pending.mechanic?.kind === "granted_effect"
  );
}

function resolveGrantedEffectPending(
  state: GameState,
  pendingId: string
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_triggered_effect" &&
      candidate.pendingId === pendingId
  );
  expect(action, `resolve action for ${pendingId}`).toBeDefined();

  let current = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    skipOptionalEffect: false,
  }).state;

  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const actingPlayerId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(pass, `pass_stack for ${actingPlayerId}`).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: getDef,
    }).state;
  }

  return current;
}

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

// BSFT01 同弾の汎用テスト用相手スピリット（front-face のみ ALL_CARDS に存在）。
// CX01 ルーシィ＝spirit, Lv1 BP2000（≤15000 なので TR04(B) BP破壊対象に合致）。
const ENEMY_CARD = "BSFT01-CX01";
const KEY_BRAVE_FRONT_CARD_NOS = [
  "BSFT01-TR01(A)",
  "BSFT01-TR02(A)",
  "BSFT01-TR03(A)",
  "BSFT01-TR04(A)",
  "BSFT01-TR05(A)",
  "BSFT01-TR06(A)",
  "BSFT01-TR07(A)",
  "BSFT01-TR08(A)",
  "BSFT01-TR09(A)",
  "BSFT01-TR10(A)",
  "BSFT01-TR11(A)",
  "BSFT01-TR12(A)",
  "BSFT01-TR13(A)",
] as const;

describe("BSFT01-CX01 星霊衣: 鍵カード/合体中鍵ブレイヴのマジック使用", () => {
  it("BSFT01-CX01 は合体中の BSFT01-TR12(A) を1コストのマジックとして使用し、宣言時に分離する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "cx01-key-magic-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR12(A)"), {
      instanceId: "tr12-key-magic-attached",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [keyBrave.instanceId];
    keyBrave.attachedToInstanceId = host.instanceId;

    const base = createEmptyGameState({
      cardInstances: [host, keyBrave],
      playerOverrides: [{ reserveNormalCoreCount: 3, countValue: 4 }, {}],
    });
    const before = rebuildContinuousEffectsFromField(
      {
        ...base,
        activePlayerId: ALICE,
        step: "main",
        window: "none",
      },
      getDef
    );
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const action = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredMagicActions: magicLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === keyBrave.instanceId &&
        candidate.sourceCardNo === "BSFT01-TR12(A)" &&
        candidate.timing === "main" &&
        candidate.costMode === "override"
    );

    expect(action).toMatchObject({
      kind: "use_magic",
      sourceCardNo: "BSFT01-TR12(A)",
      finalCost: 1,
      costOverrideSourceInstanceId: host.instanceId,
      costOverrideLimitGroupId: "BSFT01-CX01-key-magic-use",
    });
    if (!action || action.kind !== "use_magic") return;

    const after = applyLegalAction({
      state: before,
      action,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;

    const afterHost = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === host.instanceId
    )!;
    const afterBrave = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === keyBrave.instanceId
    )!;
    expect(afterBrave.zone).toBe("in_use");
    expect(afterBrave.attachedToInstanceId).toBeNull();
    expect(afterHost.attachedChildrenIds).not.toContain(keyBrave.instanceId);
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "override_properties" &&
          ce.targetInstanceId === keyBrave.instanceId &&
          (
            ce.metadata as {
              properties?: { keywords?: readonly string[] };
              source?: string;
            }
          ).source === "magic_combined_brave_no_recombine" &&
          (
            ce.metadata as { properties?: { keywords?: readonly string[] } }
          ).properties?.keywords?.includes("cannot_combine")
      )
    ).toBe(true);
    const recombined = executeBraveCombine(
      after,
      ALICE,
      keyBrave.instanceId,
      host.instanceId,
      getDef
    );
    expect(
      recombined.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === keyBrave.instanceId
      )?.zone
    ).toBe("in_use");
    expect(
      recombined.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === host.instanceId
      )?.attachedChildrenIds
    ).not.toContain(keyBrave.instanceId);
    expect(alice(after).reserveNormalCoreCount).toBe(2);
    expect(after.stackWindow?.pendingStackAction).toMatchObject({
      actionKind: "magic",
      cardInstanceId: keyBrave.instanceId,
      cardDefinitionId: "BSFT01-TR12(A)",
      chosenTiming: "main",
      magicActivationZone: "field",
    });
    expect(after.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: "BSFT01-CX01",
          groupId: "BSFT01-CX01-key-magic-use",
        }),
      ])
    );
  });

  it("BSFT01-CX01 の同名ターン制限はカウント4ごとに1回増える", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "cx01-key-magic-limit-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR12(A)"), {
      instanceId: "tr12-key-magic-limit-attached",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [keyBrave.instanceId];
    keyBrave.attachedToInstanceId = host.instanceId;

    const base = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          cardInstances: [host, keyBrave],
          playerOverrides: [{ reserveNormalCoreCount: 5, countValue: 4 }, {}],
        }),
        activePlayerId: ALICE,
        step: "main",
      },
      getDef
    );
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const usedOnce = recordEffectUsageIfLimited({
      state: base,
      sourceInstanceId: host.instanceId,
      sourceDefinitionId: "BSFT01-CX01",
      effectLabel: "cost_override:1",
      usageLimit: {
        kind: "per_card_name",
        duration: "turn",
        maxCount: 1,
        maxCountAdditionalDynamic: {
          source: { kind: "count_value", player: "self" },
          divisor: 4,
        },
      },
      groupId: "BSFT01-CX01-key-magic-use",
    });

    const count4Actions = getLegalActions({
      state: usedOnce,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredMagicActions: magicLookup,
    }).filter(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === keyBrave.instanceId &&
        candidate.costMode === "override"
    );
    expect(count4Actions.length).toBeGreaterThan(0);

    const usedTwice = recordEffectUsageIfLimited({
      state: usedOnce,
      sourceInstanceId: host.instanceId,
      sourceDefinitionId: "BSFT01-CX01",
      effectLabel: "cost_override:1",
      usageLimit: {
        kind: "per_card_name",
        duration: "turn",
        maxCount: 1,
        maxCountAdditionalDynamic: {
          source: { kind: "count_value", player: "self" },
          divisor: 4,
        },
      },
      groupId: "BSFT01-CX01-key-magic-use",
    });
    const count4AfterTwo = getLegalActions({
      state: usedTwice,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredMagicActions: magicLookup,
    }).filter(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === keyBrave.instanceId &&
        candidate.costMode === "override"
    );
    expect(count4AfterTwo).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 鍵ブレイヴ共通 — マジック互換 + スピリット状態の攻防不可・疲労しない
// ════════════════════════════════════════════════════════════════

describe("BSFT01 鍵ブレイヴ共通: スピリット状態制限", () => {
  const normalTestBrave: CardDefinition = {
    cardNo: "TEST-NORMAL-BRAVE",
    name: "通常ブレイヴ",
    printedCategory: "brave",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const tribeConditionTestBrave: CardDefinition = {
    ...normalTestBrave,
    cardNo: "TEST-TRIBE-CONDITION-BRAVE",
    name: "系統条件ブレイヴ",
    braveCondition: { tribes: ["光導"] },
  };
  const redCostTestBrave: CardDefinition = {
    ...normalTestBrave,
    cardNo: "TEST-RED-COST-BRAVE",
    name: "赤色コスト加算ブレイヴ",
    colors: ["red"],
    cost: 3,
    symbolColors: ["red"],
  };
  const nonKeyMagicCompatibleTestBrave: CardDefinition = {
    ...normalTestBrave,
    cardNo: "TEST-NON-KEY-MAGIC-COMPATIBLE-BRAVE",
    name: "非鍵マジック互換ブレイヴ",
    keywordTags: ["magic_compatible"],
    tribe: "光導",
  };
  const redCostInvalidConditionTestBrave: CardDefinition = {
    ...redCostTestBrave,
    cardNo: "TEST-RED-COST-INVALID-CONDITION-BRAVE",
    name: "赤色コスト加算条件喪失ブレイヴ",
    textLines: [
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された自分のスピリットに合体できる。",
    ],
    braveCondition: { tribes: ["光導"] },
  };
  const nonzeroInvalidConditionTestBrave: CardDefinition = {
    ...redCostInvalidConditionTestBrave,
    cardNo: "TEST-NONZERO-INVALID-CONDITION-BRAVE",
    name: "維持コア必要条件喪失ブレイヴ",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  };
  const colorCostConditionTestBrave: CardDefinition = {
    ...normalTestBrave,
    cardNo: "TEST-COLOR-COST-CONDITION-BRAVE",
    name: "色コスト条件ブレイヴ",
    textLines: [
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された自分のスピリットに合体できる。",
    ],
    keywordTags: ["brave_limit_exempt_lucy"],
    braveCondition: { colors: ["red"], minCost: 4 },
  };
  const summonTriggeredKeyBrave: CardDefinition = {
    ...normalTestBrave,
    cardNo: "TEST-SUMMON-TRIGGER-KEY-BRAVE",
    name: "召喚時誘発鍵ブレイヴ",
    colors: ["yellow"],
    tribe: "鍵",
    braveCondition: {
      categories: ["spirit"],
      cardNameContains: ["ルーシィ・ハートフィリア"],
    },
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  const selfColorCostConditionTestBrave: CardDefinition = {
    ...redCostTestBrave,
    cardNo: "TEST-SELF-COLOR-COST-CONDITION-BRAVE",
    name: "自身色コスト除外条件ブレイヴ",
    braveCondition: { colors: ["red"], minCost: 4 },
  };
  const nonLucyTestSpirit: CardDefinition = {
    cardNo: "TEST-NON-LUCY-SPIRIT",
    name: "通常スピリット",
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
  };
  const lucyTestUltimate: CardDefinition = {
    cardNo: "TEST-LUCY-ULTIMATE",
    name: "ルーシィ・ハートフィリア アルティメット",
    printedCategory: "ultimate",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 3, requiredCores: 1, bp: 5000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const lucyLevel2ContinuousTestSpirit: CardDefinition = {
    cardNo: "TEST-LUCY-LV2-CE-SPIRIT",
    name: "ルーシィ・ハートフィリア Lv2常時テスト",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 1000 },
      { level: 2, requiredCores: 2, bp: 3000 },
    ],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "all",
              duration: { scope: "while_on_field" },
            },
          },
        ],
      },
    ],
  };

  const testDefinitions = new Map(
    [
      normalTestBrave,
      tribeConditionTestBrave,
      redCostTestBrave,
      nonKeyMagicCompatibleTestBrave,
      redCostInvalidConditionTestBrave,
      nonzeroInvalidConditionTestBrave,
      colorCostConditionTestBrave,
      summonTriggeredKeyBrave,
      selfColorCostConditionTestBrave,
      nonLucyTestSpirit,
      lucyTestUltimate,
      lucyLevel2ContinuousTestSpirit,
    ].map((def) => [def.cardNo, def])
  );
  const getDefWithNormalBrave = (id: string): CardDefinition | undefined =>
    testDefinitions.get(id) ?? getDef(id);

  const lucyNameOverrideCE = (
    targetInstanceId: string
  ): GameState["activeContinuousEffects"][number] => ({
    effectId: `test-bsft01-tr03b-lucy-name-${targetInstanceId}`,
    sourceInstanceId: "bsft01-tr03b-source",
    sourceDefinitionId: "BSFT01-TR03(B)",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties",
    targetInstanceId,
    metadata: { properties: { cardName: "ルーシィ・ハートフィリア" } },
  });

  const addKodoTribeCE = (
    targetInstanceId: string
  ): GameState["activeContinuousEffects"][number] => ({
    effectId: `test-add-kodo-tribe-${targetInstanceId}`,
    sourceInstanceId: "bsft01-tr02-effective-tribe-source",
    sourceDefinitionId: "BSFT01-TR02(A)",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties",
    targetInstanceId,
    metadata: { properties: { addTribes: ["光導"] } },
  });

  it.each(KEY_BRAVE_FRONT_CARD_NOS)(
    "%s effect[0] は magic_compatible の ruleStrength effect_resistance(exhaust) + prevent_battle を持つ",
    (cardNo) => {
      const c = card(cardNo);
      const effect = c.effects![0]!;
      expect(c.keywordTags).toContain("magic_compatible");
      expect(effect.timing).toEqual({ kind: "continuous" });
      expect(effect.applicability).toEqual({
        combined: false,
        soulState: false,
      });
      expect(effect.stub).toBeUndefined();
      expect(effect.textRef).toEqual([0, 2]);

      const exhaust = effect.steps[0]!.action;
      expect(exhaust.kind).toBe("effect_resistance");
      if (exhaust.kind === "effect_resistance") {
        expect(exhaust.resistsOutcome).toBe("exhaust");
        expect(exhaust.source).toBe("all");
        expect(exhaust.duration).toEqual({ scope: "permanent" });
        expect(exhaust.ruleStrength).toBe(true);
      }

      const prevent = effect.steps[1]!.action;
      expect(prevent.kind).toBe("prevent_battle");
      if (prevent.kind === "prevent_battle") {
        expect(prevent.target).toEqual({ kind: "self" });
        expect(prevent.restriction).toEqual(["attack", "block"]);
        expect(prevent.duration).toEqual({ scope: "permanent" });
        expect(prevent.ruleStrength).toBe(true);
      }
    }
  );

  it("BSFT01-TR01(A) は非合体のスピリット状態で prevent_battle_both + cannot_be_exhausted を登録する", () => {
    const c = card("BSFT01-TR01(A)");
    const brave = createCardInstance(c, {
      instanceId: "key-brave-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const before = createEmptyGameState({ cardInstances: [brave] });
    const rebuilt = rebuildContinuousEffectsFromField(before, getDef);

    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "key-brave-spirit" &&
          ce.modifierTag === "prevent_battle_both"
      )
    ).toHaveLength(1);
    const exhaust = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "key-brave-spirit" &&
        ce.modifierTag === "cannot_be_exhausted"
    );
    expect(exhaust).toHaveLength(1);
    expect((exhaust[0]!.metadata as { source?: string }).source).toBe("all");
    expect(
      (exhaust[0]!.metadata as { ruleStrength?: boolean }).ruleStrength
    ).toBe(true);
  });

  it("BSFT01-TR01(A) はスピリット状態制限CEによりアタック/ブロック宣言できない", () => {
    const brave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-battle",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const attacker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-attacker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({ cardInstances: [brave, attacker] }),
        step: "attack",
        activePlayerId: ALICE,
        window: "none",
      },
      getDef
    );

    expect(
      getAttackDeclarationBlockReason({
        state: rebuilt,
        actingPlayerId: ALICE,
        sourceInstanceId: "key-brave-battle",
        getCardDefinitionById: getDef,
      })
    ).toBe("source_not_ready");

    const blockState: GameState = {
      ...rebuilt,
      activePlayerId: BOB,
      window: "declare_block",
      activeAttack: {
        attackId: "attack-against-alice",
        attackerPlayerId: BOB,
        target: { kind: "player", playerId: ALICE },
        participantEntityIds: ["be-lucy-attacker"],
        groupMode: "single",
        blockerCapacity: 1,
        blockAssignments: [
          {
            participantEntityId: "be-lucy-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["be-lucy-attacker"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-lucy-attacker",
          memberInstanceIds: ["lucy-attacker"],
          resolvedBp: 2000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
    };

    expect(
      getBlockDeclarationBlockReason({
        state: blockState,
        actingPlayerId: ALICE,
        sourceInstanceId: "key-brave-battle",
        participantEntityId: "be-lucy-attacker",
        getCardDefinitionById: getDef,
      })
    ).toBe("source_not_ready");
  });

  it("BSFT01-TR01(A) は合体中ならスピリット状態制限CEを登録しない", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["key-brave-combined"],
      normalCoreCount: 1,
    });
    const brave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-combined",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host",
    });
    const before = createEmptyGameState({ cardInstances: [host, brave] });
    const rebuilt = rebuildContinuousEffectsFromField(before, getDef);

    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "key-brave-combined" &&
          ce.sourceDefinitionId === "BSFT01-TR01(A)"
      )
    ).toHaveLength(0);
  });

  it("BSFT01-TR01(A) はスピリット状態CE登録後に合体するとCEを失効する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-transition",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-transition",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [host, brave] }),
      getDef
    );
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "key-brave-transition" &&
          ce.modifierTag === "cannot_be_exhausted"
      )
    ).toHaveLength(1);

    const combined = applyLegalAction({
      state: rebuilt,
      action: {
        kind: "brave_combine",
        actionId: "combine-key-brave-transition",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        braveInstanceId: "key-brave-transition",
        braveCardNo: "BSFT01-TR01(A)",
        targetInstanceId: "lucy-host-transition",
        targetCardNo: "BSFT01-CX01",
      },
      getCardDefinitionById: getDef,
    }).state;

    expect(
      combined.activeContinuousEffects.filter(
        (ce) => ce.targetInstanceId === "key-brave-transition"
      )
    ).toHaveLength(0);
    expect(
      combined.cardInstances.find(
        (c) => c.instanceId === "key-brave-transition"
      )!.attachedToInstanceId
    ).toBe("lucy-host-transition");
  });

  it("BSFT01-TR02(A) はルーシィの合体可能数に数えないため、付いた後も通常ブレイヴを合体できる", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-limit-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-limit-a"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-limit-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-limit-a",
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-limit-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, keyBrave, normalBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "TEST-NORMAL-BRAVE" &&
        action.targetCardNo === "BSFT01-CX01"
    );

    expect(combine).toBeDefined();
    const after = applyLegalAction({
      state,
      action: combine!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    const hostAfter = after.cardInstances.find(
      (c) => c.instanceId === "lucy-host-limit-a"
    )!;
    expect(hostAfter.attachedChildrenIds).toEqual([
      "key-brave-limit-a",
      "normal-brave-limit-a",
    ]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "normal-brave-limit-a")!
        .attachedToInstanceId
    ).toBe("lucy-host-limit-a");
  });

  it("BSFT01-TR02(A) 自身もルーシィの合体可能数に数えないため、通常ブレイヴが付いたルーシィに合体できる", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-limit-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["normal-brave-limit-b"],
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-limit-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-limit-b",
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-limit-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, normalBrave, keyBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "BSFT01-TR02(A)" &&
        action.targetCardNo === "BSFT01-CX01"
    );

    expect(combine).toBeDefined();
    const after = applyLegalAction({
      state,
      action: combine!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    const hostAfter = after.cardInstances.find(
      (c) => c.instanceId === "lucy-host-limit-b"
    )!;
    expect(hostAfter.attachedChildrenIds).toEqual([
      "normal-brave-limit-b",
      "key-brave-limit-b",
    ]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "key-brave-limit-b")!
        .attachedToInstanceId
    ).toBe("lucy-host-limit-b");
  });

  it("BSFT01-TR02(A) は BSFT01-TR03(B) の名称上書き後の有効カード名で合体条件と合体可能数除外を判定する", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "effective-lucy-host-limit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["normal-brave-effective-lucy"],
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-effective-lucy",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "effective-lucy-host-limit",
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-effective-lucy",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, normalBrave, keyBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
      activeContinuousEffects: [
        lucyNameOverrideCE("effective-lucy-host-limit"),
      ],
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "BSFT01-TR02(A)" &&
        action.targetCardNo === "TEST-NON-LUCY-SPIRIT"
    );

    expect(combine).toBeDefined();
    const after = applyLegalAction({
      state,
      action: combine!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "effective-lucy-host-limit"
      )!.attachedChildrenIds
    ).toEqual(["normal-brave-effective-lucy", "key-brave-effective-lucy"]);
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "key-brave-effective-lucy"
      )!.attachedToInstanceId
    ).toBe("effective-lucy-host-limit");
  });

  it("BSFT01-TR02(A) はカード名がルーシィでも ultimate には合体・片道 brave_swap できない", () => {
    const ultimateHost = createCardInstance(lucyTestUltimate, {
      instanceId: "lucy-ultimate-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const fromHost = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-spirit-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-on-spirit"],
    });
    const fieldKeyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const attachedKeyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-on-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-spirit-host",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [
          ultimateHost,
          fromHost,
          fieldKeyBrave,
          attachedKeyBrave,
        ],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveInstanceId === "key-brave-field" &&
        action.targetCardNo === "TEST-LUCY-ULTIMATE"
    );
    const swap = getAvailableBraveSwapLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveInstanceId === "key-brave-on-spirit" &&
        action.toHostInstanceId === "lucy-ultimate-host"
    );

    expect(combine).toBeUndefined();
    expect(swap).toBeUndefined();
  });

  it("BSFT01-TR02(A) は cardNameContains 条件を失った非ルーシィホストから state-based action で強制分離する", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "non-lucy-condition-lost-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
      attachedChildrenIds: ["key-brave-condition-lost"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-condition-lost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "non-lucy-condition-lost-host",
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({ cardInstances: [host, keyBrave] });

    const result = runStateBasedActions(state, getDefWithNormalBrave);
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "key-brave-condition-lost"
    );

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_forced_separation" &&
          check.instanceId === "key-brave-condition-lost"
      )
    ).toBe(true);
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "key-brave-condition-lost"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "key-brave-condition-lost"
      )!.exhaustState
    ).toBe("recovered");
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "non-lucy-condition-lost-host"
      )!.attachedChildrenIds
    ).toEqual([]);
  });

  it("BSFT01-TR02(A) の条件喪失 SBA はホストが離脱待機中なら残存/同行選択へ委ねる", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "non-lucy-pending-leave-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      attachedChildrenIds: ["key-brave-pending-leave-host"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-pending-leave-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "non-lucy-pending-leave-host",
    });
    const state = createEmptyGameState({ cardInstances: [host, keyBrave] });

    const result = runStateBasedActions(state, getDefWithNormalBrave);

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_forced_separation" &&
          check.instanceId === "key-brave-pending-leave-host"
      )
    ).toBe(false);
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "key-brave-pending-leave-host"
      )!.attachedToInstanceId
    ).toBe("non-lucy-pending-leave-host");
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "non-lucy-pending-leave-host"
      )!.attachedChildrenIds
    ).toEqual(["key-brave-pending-leave-host"]);
  });

  it("BSFT01-TR02(A) の共通合体条件判定は override_properties.addTribes 後の実効系統で候補化し、失うと分離する", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "effective-kodo-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(tribeConditionTestBrave, {
      instanceId: "tribe-condition-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ cardInstances: [host, brave] }),
      step: "main",
      activePlayerId: ALICE,
      activeContinuousEffects: [addKodoTribeCE("effective-kodo-host")],
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "TEST-TRIBE-CONDITION-BRAVE" &&
        action.targetCardNo === "TEST-NON-LUCY-SPIRIT"
    );
    expect(combine).toBeDefined();
    const combined = applyLegalAction({
      state,
      action: combine!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(
      combined.cardInstances.find(
        (c) => c.instanceId === "effective-kodo-host"
      )!.attachedChildrenIds
    ).toEqual(["tribe-condition-brave"]);

    const withoutOverride: GameState = {
      ...combined,
      activeContinuousEffects: [],
    };
    const result = runStateBasedActions(withoutOverride, getDefWithNormalBrave);
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "tribe-condition-brave"
    );
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "tribe-condition-brave"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "effective-kodo-host"
      )!.attachedChildrenIds
    ).toEqual([]);
  });

  it("BSFT01-TR02(A) の合体可能数除外で開く追加合体は、BSFT01-CX01 の合体済みブレイヴが足す色/コストも braveCondition に使う", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-color-cost-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["red-cost-brave"],
    });
    const redCostBrave = createCardInstance(redCostTestBrave, {
      instanceId: "red-cost-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-color-cost-host",
    });
    const conditionalBrave = createCardInstance(colorCostConditionTestBrave, {
      instanceId: "color-cost-condition-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, redCostBrave, conditionalBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "TEST-COLOR-COST-CONDITION-BRAVE" &&
        action.targetCardNo === "BSFT01-CX01"
    );

    expect(combine).toBeDefined();
    const after = applyLegalAction({
      state,
      action: combine!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "lucy-color-cost-host")!
        .attachedChildrenIds
    ).toEqual(["red-cost-brave", "color-cost-condition-brave"]);
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "color-cost-condition-brave"
      )!.attachedToInstanceId
    ).toBe("lucy-color-cost-host");
  });

  it("BSFT01-TR02(A) と同じ braveCondition 判定は、条件確認中のブレイヴ自身の色/コストを合体ユニット値から除外する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-self-exclude-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["self-color-cost-condition-brave"],
    });
    const selfConditionBrave = createCardInstance(
      selfColorCostConditionTestBrave,
      {
        instanceId: "self-color-cost-condition-brave",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "lucy-self-exclude-host",
      }
    );
    const state = createEmptyGameState({
      cardInstances: [host, selfConditionBrave],
    });

    const result = runStateBasedActions(state, getDefWithNormalBrave);
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "self-color-cost-condition-brave"
    );

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_forced_separation" &&
          check.instanceId === "self-color-cost-condition-brave"
      )
    ).toBe(true);
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "self-color-cost-condition-brave"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "lucy-self-exclude-host"
      )!.attachedChildrenIds
    ).toEqual([]);
  });

  it("BSFT01-TR02(A) と同じ brave_combine 経路で、疲労ブレイヴを合体すると合体先 BSFT01-CX01 は疲労する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-exhaust-combine-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const brave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-exhaust-combine",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...createEmptyGameState({ cardInstances: [host, brave] }),
      step: "main",
      activePlayerId: ALICE,
    };

    const after = applyLegalAction({
      state,
      action: {
        kind: "brave_combine",
        actionId: "combine-exhausted-key-brave",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        braveInstanceId: "key-brave-exhaust-combine",
        braveCardNo: "BSFT01-TR02(A)",
        targetInstanceId: "lucy-exhaust-combine-host",
        targetCardNo: "BSFT01-CX01",
      },
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;

    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "lucy-exhaust-combine-host"
      )!.exhaustState
    ).toBe("exhausted");
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "key-brave-exhaust-combine"
      )!.attachedToInstanceId
    ).toBe("lucy-exhaust-combine-host");
  });

  it("BSFT01-TR02(A) と同じ brave_combine 経路で、重疲労ブレイヴも疲労状態として BSFT01-CX01 に継承する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-heavy-exhaust-combine-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const brave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-heavy-exhaust-combine",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: "heavily_exhausted",
    });
    const state: GameState = {
      ...createEmptyGameState({ cardInstances: [host, brave] }),
      step: "main",
      activePlayerId: ALICE,
    };

    const after = applyLegalAction({
      state,
      action: {
        kind: "brave_combine",
        actionId: "combine-heavy-exhausted-key-brave",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        braveInstanceId: "key-brave-heavy-exhaust-combine",
        braveCardNo: "BSFT01-TR02(A)",
        targetInstanceId: "lucy-heavy-exhaust-combine-host",
        targetCardNo: "BSFT01-CX01",
      },
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;

    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "lucy-heavy-exhaust-combine-host"
      )!.exhaustState
    ).toBe("exhausted");
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "key-brave-heavy-exhaust-combine"
      )!.attachedToInstanceId
    ).toBe("lucy-heavy-exhaust-combine-host");
  });

  it("BSFT01-TR02(A) の合体可能数除外で同居した支援ブレイヴを分離すると、条件を失ったブレイヴも state-based action で強制分離する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-color-cost-separate-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
      attachedChildrenIds: [
        "red-cost-separate-brave",
        "color-cost-condition-separate-brave",
      ],
    });
    const redCostBrave = createCardInstance(redCostTestBrave, {
      instanceId: "red-cost-separate-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-color-cost-separate-host",
    });
    const conditionalBrave = createCardInstance(colorCostConditionTestBrave, {
      instanceId: "color-cost-condition-separate-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-color-cost-separate-host",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, redCostBrave, conditionalBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    let after = applyLegalAction({
      state,
      action: {
        kind: "brave_separate",
        actionId: "separate-red-cost-support",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        hostInstanceId: "lucy-color-cost-separate-host",
        braveInstanceId: "red-cost-separate-brave",
      },
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;

    after = chooseRuleBraveCores(
      after,
      getDefWithNormalBrave,
      "color-cost-condition-separate-brave"
    );

    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "red-cost-separate-brave"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "red-cost-separate-brave"
      )!.exhaustState
    ).toBe("exhausted");
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "color-cost-condition-separate-brave"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "lucy-color-cost-separate-host"
      )!.attachedChildrenIds
    ).toEqual([]);
  });

  it("BSFT01-TR02(A) と同居する色/コスト条件ブレイヴは、SBA で支援ブレイヴが外れた後も固定点まで強制分離される", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-sba-cascade-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "heavily_exhausted",
      attachedChildrenIds: [
        "red-invalid-condition-brave",
        "color-cost-dependent-brave",
      ],
    });
    const invalidSupport = createCardInstance(
      redCostInvalidConditionTestBrave,
      {
        instanceId: "red-invalid-condition-brave",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "lucy-sba-cascade-host",
        exhaustState: "exhausted",
      }
    );
    const dependent = createCardInstance(colorCostConditionTestBrave, {
      instanceId: "color-cost-dependent-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-sba-cascade-host",
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      cardInstances: [host, invalidSupport, dependent],
    });

    const result = runStateBasedActions(state, getDefWithNormalBrave);
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "red-invalid-condition-brave"
    );
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "color-cost-dependent-brave"
    );

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_forced_separation" &&
          check.instanceId === "red-invalid-condition-brave"
      )
    ).toBe(true);
    expect(result.state.pendingCoreDistribution).toBeNull();
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "red-invalid-condition-brave"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "red-invalid-condition-brave"
      )!.exhaustState
    ).toBe("recovered");
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "color-cost-dependent-brave"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "color-cost-dependent-brave"
      )!.exhaustState
    ).toBe("recovered");
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "lucy-sba-cascade-host"
      )!.attachedChildrenIds
    ).toEqual([]);
  });

  it("BSFT01-TR02(A) と同じ合体条件喪失 SBA は、アタック中 BattleEntity から分離ブレイヴを外して再計算する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-sba-battle-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["red-invalid-battle-brave"],
    });
    const invalidBrave = createCardInstance(redCostInvalidConditionTestBrave, {
      instanceId: "red-invalid-battle-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-sba-battle-host",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, invalidBrave],
      }),
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "sba-battle-attack",
        primaryEntityId: "be-sba-combined",
        participantEntityIds: ["be-sba-combined"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
      },
      battleEntities: [
        {
          entityId: "be-sba-combined",
          memberInstanceIds: [
            "lucy-sba-battle-host",
            "red-invalid-battle-brave",
          ],
          resolvedBp: 3000,
          resolvedSymbols: ["yellow", "red"],
          attackState: "attacking",
        },
      ],
    };

    const result = runStateBasedActions(state, getDefWithNormalBrave);
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "red-invalid-battle-brave"
    );

    expect(
      result.state.battleEntities.find(
        (entity) => entity.entityId === "be-sba-combined"
      )?.memberInstanceIds
    ).toEqual(["lucy-sba-battle-host"]);
    expect(
      result.state.battleEntities.find(
        (entity) => entity.entityId === "be-sba-combined"
      )?.resolvedSymbols
    ).toEqual(["guide"]);
  });

  it("BSFT01-TR02(A) と同じ合体条件喪失 SBA は、維持コアが必要なブレイヴへホストのコアを移し、残ったコア不足も同じ固定点で処理する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-sba-core-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
      attachedChildrenIds: ["nonzero-invalid-condition-brave"],
    });
    const brave = createCardInstance(nonzeroInvalidConditionTestBrave, {
      instanceId: "nonzero-invalid-condition-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-sba-core-host",
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });

    const result = runStateBasedActions(state, getDefWithNormalBrave);
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "nonzero-invalid-condition-brave",
      { "field:lucy-sba-core-host": 1 }
    );
    const hostAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "lucy-sba-core-host"
    )!;
    const braveAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "nonzero-invalid-condition-brave"
    )!;

    expect(
      result.checks.some(
        (check) =>
          check.kind === "brave_forced_separation" &&
          check.instanceId === "nonzero-invalid-condition-brave"
      )
    ).toBe(true);
    expect(braveAfter.attachedToInstanceId).toBeNull();
    expect(braveAfter.normalCoreCount).toBe(1);
    expect(braveAfter.exhaustState).toBe("recovered");
    expect(hostAfter.attachedChildrenIds).toEqual([]);
    expect(hostAfter.normalCoreCount).toBe(0);
    expect(hostAfter.zone).toBe("trash");
    expect(hostAfter.pendingLeaveKind).toBeNull();
    expect(result.state.pendingLeaveEntities).toHaveLength(0);
  });

  it("BSFT01-TR02(A) と同じ合体条件喪失 SBA は、複数ソースなら維持コア移動元を player choice にする", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-sba-reserve-core-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["nonzero-invalid-reserve-brave"],
    });
    const brave = createCardInstance(nonzeroInvalidConditionTestBrave, {
      instanceId: "nonzero-invalid-reserve-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-sba-reserve-core-host",
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });

    const result = runStateBasedActions(state, getDefWithNormalBrave);
    expect(result.state.pendingCoreDistribution).not.toBeNull();
    expect(result.state.pendingCoreDistribution?.fromKind).toBe("any_movable");
    expect(result.state.pendingCoreDistribution?.minTotal).toBe(0);
    expect(
      result.state.pendingCoreDistribution?.stateBasedBraveSeparation
    ).toEqual({
      hostInstanceId: "lucy-sba-reserve-core-host",
      braveInstanceId: "nonzero-invalid-reserve-brave",
    });
    expect(result.state.pendingCoreDistribution?.sourceAvailable).toEqual({
      reserve: 1,
      "field:lucy-sba-reserve-core-host": 1,
    });
    expect(
      result.state.cardInstances.find(
        (c) => c.instanceId === "nonzero-invalid-reserve-brave"
      )!.attachedToInstanceId
    ).toBe("lucy-sba-reserve-core-host");

    const distribution = getLegalActions({
      state: result.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(distribution).toBeDefined();

    const resolved = applyLegalAction({
      state: result.state,
      action: distribution!,
      coreDistributionAllocations: { "nonzero-invalid-reserve-brave": 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    const hostAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "lucy-sba-reserve-core-host"
    )!;
    const braveAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "nonzero-invalid-reserve-brave"
    )!;

    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(braveAfter.attachedToInstanceId).toBeNull();
    expect(braveAfter.normalCoreCount).toBe(1);
    expect(braveAfter.exhaustState).toBe("recovered");
    expect(hostAfter.normalCoreCount).toBe(1);
    expect(
      resolved.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(0);
    expect(hostAfter.pendingLeaveKind).toBeNull();
  });

  it("BSFT01-TR02(A) と同じ合体条件喪失 SBA は、維持コアが必要なブレイヴへ他のフィールドカードからもコアを移す", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-sba-field-core-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["nonzero-invalid-field-brave"],
    });
    const brave = createCardInstance(nonzeroInvalidConditionTestBrave, {
      instanceId: "nonzero-invalid-field-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-sba-field-core-host",
      exhaustState: "exhausted",
    });
    const source = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-sba-field-core-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      cardInstances: [host, brave, source],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });

    const result = runStateBasedActions(state, getDefWithNormalBrave);
    result.state = chooseRuleBraveCores(
      result.state,
      getDefWithNormalBrave,
      "nonzero-invalid-field-brave",
      { "field:lucy-sba-field-core-source": 1 }
    );
    const braveAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "nonzero-invalid-field-brave"
    )!;
    const sourceAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "lucy-sba-field-core-source"
    )!;

    expect(braveAfter.attachedToInstanceId).toBeNull();
    expect(braveAfter.normalCoreCount).toBe(1);
    expect(sourceAfter.normalCoreCount).toBe(0);
  });

  it("BSFT01-TR01(A) は合体可能数に数えない句がないため、付いた後は通常ブレイヴを追加合体できない", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-tr01-limit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-tr01-limit"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-tr01-limit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-tr01-limit",
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-tr01-limit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, keyBrave, normalBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "TEST-NORMAL-BRAVE" &&
        action.targetCardNo === "BSFT01-CX01"
    );

    expect(combine).toBeUndefined();
    expect(
      state.cardInstances.find((c) => c.instanceId === "lucy-host-tr01-limit")!
        .attachedChildrenIds
    ).toEqual(["key-brave-tr01-limit"]);
  });

  it("BSFT01-TR02(A) はルーシィ以外のホストでは合体可能数に数えない扱いにならない", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "non-lucy-host-limit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-non-lucy-limit"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-non-lucy-limit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "non-lucy-host-limit",
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-non-lucy-limit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, keyBrave, normalBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "TEST-NORMAL-BRAVE" &&
        action.targetCardNo === "TEST-NON-LUCY-SPIRIT"
    );

    expect(combine).toBeUndefined();
    expect(
      state.cardInstances.find((c) => c.instanceId === "non-lucy-host-limit")!
        .attachedChildrenIds
    ).toEqual(["key-brave-non-lucy-limit"]);
  });

  it("BSFT01-TR02(A) は空の非ルーシィホストへ通常合体できない", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "non-lucy-empty-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-non-lucy-condition",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, keyBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const combine = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveCardNo === "BSFT01-TR02(A)" &&
        action.targetCardNo === "TEST-NON-LUCY-SPIRIT"
    );

    expect(combine).toBeUndefined();
    expect(
      state.cardInstances.find(
        (c) => c.instanceId === "key-brave-non-lucy-condition"
      )!.attachedToInstanceId
    ).toBeNull();
  });

  it("BSFT01-TR02(A) が付いたルーシィは、召喚時直接合体でも通常ブレイヴの合体先候補になる", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-direct",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-direct"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-direct",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-direct",
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-direct",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, keyBrave, normalBrave],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      step: "main",
      activePlayerId: ALICE,
    };
    const triggeredLookup = buildTriggeredEffectLookup([
      card("BSFT01-CX01"),
      card("BSFT01-TR02(A)"),
      normalTestBrave,
    ]);
    const summon = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) =>
        action.kind === "summon" &&
        action.sourceInstanceId === "normal-brave-direct"
    );
    expect(summon).toBeDefined();
    const opened = applyLegalAction({
      state,
      action: summon!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    const pass = getLegalActions({
      state: opened,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: opened,
      action: pass!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;

    expect(
      afterPass.pendingBraveCombineChoice?.hostCandidateInstanceIds
    ).toContain("lucy-host-direct");

    const chooseHost = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) =>
        action.kind === "resolve_brave_combine_choice" &&
        action.chosenHostInstanceId === "lucy-host-direct"
    );
    expect(chooseHost).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterPass,
      action: chooseHost!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const resolvePlacement = getLegalActions({
      state: afterChoice,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const resolved = applyLegalAction({
      state: afterChoice,
      action: resolvePlacement!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      enterFieldCorePlacements: [],
    }).state;

    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === "normal-brave-direct"
      )!.attachedToInstanceId
    ).toBe("lucy-host-direct");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "lucy-host-direct")!
        .attachedChildrenIds
    ).toEqual(["key-brave-direct", "normal-brave-direct"]);
  });

  it("BSFT01-TR02(A) の召喚時直接合体はコア移動後に CE/SBA を再構築し、Lv2 化したホストの常時効果を登録する", () => {
    const host = createCardInstance(lucyLevel2ContinuousTestSpirit, {
      instanceId: "lucy-direct-rebuild-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-direct-rebuild",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, keyBrave],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      }),
      step: "main",
      activePlayerId: ALICE,
    };
    const triggeredLookup = buildTriggeredEffectLookup([
      lucyLevel2ContinuousTestSpirit,
      card("BSFT01-TR02(A)"),
    ]);
    const summon = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) =>
        action.kind === "summon" &&
        action.sourceInstanceId === "key-brave-direct-rebuild"
    );
    expect(summon).toBeDefined();
    const opened = applyLegalAction({
      state,
      action: summon!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 3 }],
    }).state;
    const pass = getLegalActions({
      state: opened,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: opened,
      action: pass!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(
      afterPass.pendingBraveCombineChoice?.hostCandidateInstanceIds
    ).toContain("lucy-direct-rebuild-host");

    const chooseHost = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) =>
        action.kind === "resolve_brave_combine_choice" &&
        action.chosenHostInstanceId === "lucy-direct-rebuild-host"
    );
    expect(chooseHost).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterPass,
      action: chooseHost!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const resolvePlacement = getLegalActions({
      state: afterChoice,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const resolved = applyLegalAction({
      state: afterChoice,
      action: resolvePlacement!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === "key-brave-direct-rebuild"
      )!.attachedToInstanceId
    ).toBe("lucy-direct-rebuild-host");
    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === "key-brave-direct-rebuild"
      )!.normalCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === "lucy-direct-rebuild-host"
      )!.normalCoreCount
    ).toBe(2);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.sourceDefinitionId === "TEST-LUCY-LV2-CE-SPIRIT" &&
          ce.targetInstanceId === "lucy-direct-rebuild-host" &&
          ce.modifierTag === "cannot_leave_field"
      )
    ).toBe(true);
    expect(
      resolved.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceDefinitionId === "BSFT01-TR02(A)" &&
          ce.modifierTag === "cannot_be_exhausted"
      )
    ).toHaveLength(0);
  });

  it("BSFT01-TR02(A) は召喚時直接合体でも非ルーシィホストを候補にしない", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "non-lucy-direct-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-direct-non-lucy",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [host, keyBrave],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      step: "main",
      activePlayerId: ALICE,
    };
    const triggeredLookup = buildTriggeredEffectLookup([
      card("BSFT01-TR02(A)"),
      nonLucyTestSpirit,
    ]);
    const summon = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find(
      (action) =>
        action.kind === "summon" &&
        action.sourceInstanceId === "key-brave-direct-non-lucy"
    );
    expect(summon).toBeDefined();
    const opened = applyLegalAction({
      state,
      action: summon!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      paymentSources: [{ kind: "reserve", amount: 3 }],
    }).state;
    const pass = getLegalActions({
      state: opened,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: opened,
      action: pass!,
      getCardDefinitionById: getDefWithNormalBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;

    expect(
      afterPass.pendingBraveCombineChoice?.hostCandidateInstanceIds ?? []
    ).not.toContain("non-lucy-direct-host");
  });

  it("BSFT01-TR02(A) は片道 brave_swap でもルーシィの合体可能数に数えず、swap 後もスピリット状態CEを登録しない", () => {
    const fromHost = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-swap-from",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-swap"],
    });
    const toHost = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-swap-to",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["normal-brave-swap"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-swap",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-swap-from",
      exhaustState: "exhausted",
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-swap",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-swap-to",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [fromHost, toHost, keyBrave, normalBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const swap = getAvailableBraveSwapLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveInstanceId === "key-brave-swap" &&
        action.toHostInstanceId === "lucy-host-swap-to"
    );
    expect(swap).toBeDefined();
    const after = applyLegalAction({
      state,
      action: swap!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;

    expect(
      after.cardInstances.find((c) => c.instanceId === "key-brave-swap")!
        .attachedToInstanceId
    ).toBe("lucy-host-swap-to");
    expect(
      after.cardInstances.find((c) => c.instanceId === "lucy-host-swap-from")!
        .attachedChildrenIds
    ).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "lucy-host-swap-to")!
        .attachedChildrenIds
    ).toEqual(["normal-brave-swap", "key-brave-swap"]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "lucy-host-swap-to")!
        .exhaustState
    ).toBe("exhausted");
    expect(
      after.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "key-brave-swap" &&
          ce.modifierTag === "cannot_be_exhausted"
      )
    ).toHaveLength(0);
  });

  it("BSFT01-TR02(A) は片道 brave_swap でも非ルーシィホストへ移れない", () => {
    const fromHost = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-swap-condition-from",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-swap-condition"],
    });
    const toHost = createCardInstance(nonLucyTestSpirit, {
      instanceId: "non-lucy-swap-condition-to",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "key-brave-swap-condition",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-swap-condition-from",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [fromHost, toHost, keyBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const swap = getAvailableBraveSwapLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveInstanceId === "key-brave-swap-condition" &&
        action.toHostInstanceId === "non-lucy-swap-condition-to"
    );

    expect(swap).toBeUndefined();
    expect(
      state.cardInstances.find(
        (c) => c.instanceId === "key-brave-swap-condition"
      )!.attachedToInstanceId
    ).toBe("lucy-host-swap-condition-from");
  });

  it("片道 brave_swap は移動元に残るブレイヴが合体条件を失う場合は候補に出ない", () => {
    const fromHost = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-swap-dependent-from",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["red-support-brave", "dependent-brave"],
    });
    const toHost = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-swap-dependent-to",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const redSupportBrave = createCardInstance(redCostTestBrave, {
      instanceId: "red-support-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-swap-dependent-from",
    });
    const dependentBrave = createCardInstance(colorCostConditionTestBrave, {
      instanceId: "dependent-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-host-swap-dependent-from",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [fromHost, toHost, redSupportBrave, dependentBrave],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const swap = getAvailableBraveSwapLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.braveInstanceId === "red-support-brave" &&
        action.toHostInstanceId === "lucy-host-swap-dependent-to"
    );

    expect(swap).toBeUndefined();
  });

  it("BSFT01-TR01(A) は合体解除でスピリット状態制限CEを再登録する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-separate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["key-brave-separate"],
    });
    const brave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-separate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "lucy-host-separate",
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [host, brave] }),
      getDef
    );
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "key-brave-separate" &&
          ce.sourceDefinitionId === "BSFT01-TR01(A)"
      )
    ).toHaveLength(0);

    const separated = applyLegalAction({
      state: rebuilt,
      action: {
        kind: "brave_separate",
        actionId: "separate-key-brave",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        hostInstanceId: "lucy-host-separate",
        braveInstanceId: "key-brave-separate",
      },
      getCardDefinitionById: getDef,
    }).state;

    expect(
      separated.cardInstances.find(
        (c) => c.instanceId === "key-brave-separate"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      separated.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "key-brave-separate" &&
          ce.modifierTag === "cannot_be_exhausted"
      )
    ).toHaveLength(1);
    expect(
      separated.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "key-brave-separate" &&
          ce.modifierTag === "prevent_battle_both"
      )
    ).toHaveLength(1);
  });

  it("BSFT01-CX01 の通常 brave_separate は reserve 0 でも自分フィールド上コアで維持コアを補填できる", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host-separate-field-core",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "heavily_exhausted",
      attachedChildrenIds: ["nonzero-separate-field-core-brave"],
    });
    const brave = createCardInstance(nonzeroInvalidConditionTestBrave, {
      instanceId: "nonzero-separate-field-core-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: "lucy-host-separate-field-core",
    });
    const source = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-separate-field-core-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [source, host, brave],
        playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
      }),
      step: "main",
      activePlayerId: ALICE,
    };

    const separate = getAvailableBraveSeparateLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.hostInstanceId === "lucy-host-separate-field-core" &&
        action.braveInstanceId === "nonzero-separate-field-core-brave"
    );
    expect(separate).toBeDefined();

    const after = applyLegalAction({
      state,
      action: separate!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;

    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "nonzero-separate-field-core-brave"
      )!.attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "nonzero-separate-field-core-brave"
      )!.normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "nonzero-separate-field-core-brave"
      )!.exhaustState
    ).toBe("recovered");
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "lucy-separate-field-core-source"
      )!.normalCoreCount
    ).toBe(0);
  });

  it("BSFT01-TR01(A) は魂状態ならスピリット状態制限CEを登録しない", () => {
    const brave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const before = createEmptyGameState({
      cardInstances: [brave],
      playerOverrides: [{ soulStateInstanceIds: ["key-brave-soul"] }, {}],
    });
    const rebuilt = rebuildContinuousEffectsFromField(before, getDef);

    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) => ce.targetInstanceId === "key-brave-soul"
      )
    ).toHaveLength(0);
  });

  it("BSFT01-TR01(A) は通常フィールド上ではマジックカテゴリとして扱わない", () => {
    const def = card("BSFT01-TR01(A)");
    const brave = createCardInstance(def, {
      instanceId: "key-brave-field-magic-category",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [brave] });

    expect(
      matchesCardFilter(brave, def, { category: ["magic"] }, { state })
    ).toBe(false);
    expect(
      matchesCardFilter(brave, def, { category: ["brave"] }, { state })
    ).toBe(true);
    expect(
      evaluateConditionClause(
        state,
        { kind: "field_has", player: "self", category: ["magic"] },
        brave.instanceId,
        ALICE,
        getDef
      )
    ).toBe(false);
  });

  it("BSFT01-TR01(A) は鍵ブレイヴとして魂状態継承対象になる", () => {
    expect(
      isSoulStateInheritingKeyBraveDefinition(card("BSFT01-TR01(A)"))
    ).toBe(true);
    expect(
      isSoulStateInheritingKeyBraveDefinition({
        cardNo: "TEST-NON-KEY-MAGIC-BRAVE",
        name: "非鍵マジック化ブレイヴ",
        printedCategory: "brave",
        colors: ["yellow"],
        cost: 1,
        reductionSymbols: [],
        levelDefs: [],
        symbolColors: [],
        textLines: [],
        tribe: "光導",
        keywordTags: ["magic_compatible"],
        rarity: "C",
        sourceUrls: [],
        sourceConfidence: "C",
      } as CardDefinition)
    ).toBe(false);
  });

  it("BSFT01-TR01(A) は合体先ルーシィが魂状態になると合体したまま魂状態を継承する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-inherit-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: ["key-brave-soul-inherit"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-soul-inherit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-soul-inherit-host",
      normalCoreCount: 1,
    });
    const queued = queuePendingLeave({
      state: createEmptyGameState({
        cardInstances: [host, keyBrave],
        playerOverrides: [
          {
            contractCardNo: "BSFT01-CX01",
            reserveNormalCoreCount: 0,
            soulCoreLocation: {
              kind: "card",
              instanceId: "key-brave-soul-inherit",
            },
          },
          {},
        ],
      }),
      instanceId: "lucy-soul-inherit-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-key-brave-soul-inherit",
    });
    const pending = flushPendingLeaves(queued, getDef);
    expect(pending.pendingBraveLeaveChoice?.braveInstanceIds).toEqual([
      "key-brave-soul-inherit",
    ]);
    expect(pending.pendingSoulStateReplacement?.cardInstanceId).toBe(
      "lucy-soul-inherit-host"
    );

    const inherit = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "inherit_soul_state"
    );
    expect(inherit).toBeDefined();

    const pendingSoul = applyLegalAction({
      state: pending,
      action: inherit!,
      getCardDefinitionById: getDef,
    }).state;
    expect(pendingSoul.pendingBraveLeaveChoice).toBeNull();

    const keep = getLegalActions({
      state: pendingSoul,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_soul_state_replacement" &&
        action.choice === "keep"
    );
    expect(keep).toBeDefined();

    const after = applyLegalAction({
      state: pendingSoul,
      action: keep!,
      getCardDefinitionById: getDef,
    }).state;
    const aliceAfter = alice(after);
    expect(aliceAfter.soulStateInstanceIds).toEqual(
      expect.arrayContaining(["lucy-soul-inherit-host"])
    );
    const effectiveSoulStateIds = getEffectiveSoulStateIds(after, getDef);
    expect([...effectiveSoulStateIds]).toEqual(
      expect.arrayContaining([
        "lucy-soul-inherit-host",
        "key-brave-soul-inherit",
      ])
    );
    expect(
      matchesCardFilter(
        after.cardInstances.find(
          (c) => c.instanceId === "key-brave-soul-inherit"
        )!,
        card("BSFT01-TR01(A)"),
        { soulState: "only" },
        { state: after, soulStateIds: effectiveSoulStateIds }
      )
    ).toBe(true);
    expect(
      matchesCardFilter(
        after.cardInstances.find(
          (c) => c.instanceId === "key-brave-soul-inherit"
        )!,
        card("BSFT01-TR01(A)"),
        { category: ["magic"], soulState: "only" },
        { state: after, soulStateIds: effectiveSoulStateIds }
      )
    ).toBe(false);
    expect(
      evaluateConditionClause(
        after,
        { kind: "self_soul_state" },
        "key-brave-soul-inherit",
        ALICE,
        getDef
      )
    ).toBe(true);
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: pendingSoul,
        afterState: after,
        source: "action_resolution",
        chainId: "bsft01-key-brave-soul-inherit",
        getCardDefinitionById: getDef,
      })
        .filter((event) => event.eventKind === "enter_soul_state")
        .map((event) => event.relatedInstanceId)
    ).toEqual(
      expect.arrayContaining([
        "lucy-soul-inherit-host",
        "key-brave-soul-inherit",
      ])
    );
    expect(
      matchesCardFilter(
        after.cardInstances.find(
          (c) => c.instanceId === "key-brave-soul-inherit"
        )!,
        card("BSFT01-TR01(A)"),
        {},
        { state: after, soulStateIds: effectiveSoulStateIds }
      )
    ).toBe(false);
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "key-brave-soul-inherit"
      )!.attachedToInstanceId
    ).toBe("lucy-soul-inherit-host");
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "lucy-soul-inherit-host"
      )!.attachedChildrenIds
    ).toEqual(["key-brave-soul-inherit"]);
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "lucy-soul-inherit-host"
      )!.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "key-brave-soul-inherit"
      )!.normalCoreCount
    ).toBe(0);
    expect(aliceAfter.reserveNormalCoreCount).toBe(3);
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("BSFT01-TR01(A) は非契約 soul_state 置換 CE でも合体状態で魂状態を継承する", () => {
    const host = createCardInstance(nonLucyTestSpirit, {
      instanceId: "non-contract-soul-ce-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["key-brave-non-contract-soul-ce"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-non-contract-soul-ce",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "non-contract-soul-ce-host",
    });
    const state = createEmptyGameState({
      cardInstances: [host, keyBrave],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.activeContinuousEffects = [
      {
        effectId: "ce-non-contract-soul-state",
        sourceInstanceId: "non-contract-soul-ce-host",
        sourceDefinitionId: "TEST-NON-LUCY-SPIRIT",
        actingPlayerId: ALICE,
        duration: { scope: "while_on_field" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "replace_field_exit",
        targetInstanceId: "non-contract-soul-ce-host",
        metadata: {
          trigger: "leave_field",
          replacement: { kind: "soul_state" },
        },
      } as ContinuousEffect,
    ];
    const queued = queuePendingLeave({
      state,
      instanceId: "non-contract-soul-ce-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-key-brave-non-contract-soul-ce",
    });

    const pending = flushPendingLeaves(queued, getDefWithNormalBrave);
    expect(pending.pendingBraveLeaveChoice?.braveInstanceIds).toEqual([
      "key-brave-non-contract-soul-ce",
    ]);
    expect(pending.pendingSoulStateReplacement?.cardInstanceId).toBe(
      "non-contract-soul-ce-host"
    );

    const inherit = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "inherit_soul_state"
    );
    expect(inherit).toBeDefined();

    const pendingSoul = applyLegalAction({
      state: pending,
      action: inherit!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(pendingSoul.pendingBraveLeaveChoice).toBeNull();

    const keep = getLegalActions({
      state: pendingSoul,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.kind === "resolve_soul_state_replacement" &&
        action.choice === "keep"
    );
    expect(keep).toBeDefined();

    const after = applyLegalAction({
      state: pendingSoul,
      action: keep!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(alice(after).soulStateInstanceIds).toEqual(
      expect.arrayContaining(["non-contract-soul-ce-host"])
    );
    expect([...getEffectiveSoulStateIds(after, getDefWithNormalBrave)]).toEqual(
      expect.arrayContaining([
        "non-contract-soul-ce-host",
        "key-brave-non-contract-soul-ce",
      ])
    );
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "key-brave-non-contract-soul-ce"
      )!.attachedToInstanceId
    ).toBe("non-contract-soul-ce-host");
  });

  it("BSFT01-TR01(A) は通常ブレイヴ混在時も自身だけ合体状態で魂状態を継承する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-inherit-mixed-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: [
        "key-brave-soul-inherit-mixed",
        "normal-brave-soul-inherit-mixed",
      ],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-soul-inherit-mixed",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-soul-inherit-mixed-host",
    });
    const normalBrave = createCardInstance(normalTestBrave, {
      instanceId: "normal-brave-soul-inherit-mixed",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-soul-inherit-mixed-host",
    });
    const queued = queuePendingLeave({
      state: createEmptyGameState({
        cardInstances: [host, keyBrave, normalBrave],
        playerOverrides: [
          { contractCardNo: "BSFT01-CX01", reserveNormalCoreCount: 0 },
          {},
        ],
      }),
      instanceId: "lucy-soul-inherit-mixed-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-key-brave-soul-inherit-mixed",
    });
    const pendingBraveChoice = flushPendingLeaves(
      queued,
      getDefWithNormalBrave
    );
    expect(
      pendingBraveChoice.pendingBraveLeaveChoice?.braveInstanceIds
    ).toEqual(["key-brave-soul-inherit-mixed"]);
    expect(pendingBraveChoice.pendingSoulStateReplacement?.cardInstanceId).toBe(
      "lucy-soul-inherit-mixed-host"
    );

    const inherit = getLegalActions({
      state: pendingBraveChoice,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "inherit_soul_state"
    );
    expect(inherit).toBeDefined();

    const pendingNormalBraveChoice = applyLegalAction({
      state: pendingBraveChoice,
      action: inherit!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(
      pendingNormalBraveChoice.pendingBraveLeaveChoice?.braveInstanceIds
    ).toEqual(["normal-brave-soul-inherit-mixed"]);

    const sendNormal = getLegalActions({
      state: pendingNormalBraveChoice,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "send_with_host"
    );
    expect(sendNormal).toBeDefined();

    const pendingSoul = applyLegalAction({
      state: pendingNormalBraveChoice,
      action: sendNormal!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(pendingSoul.pendingBraveLeaveChoice).toBeNull();
    expect(pendingSoul.pendingSoulStateReplacement?.cardInstanceId).toBe(
      "lucy-soul-inherit-mixed-host"
    );

    const keep = getLegalActions({
      state: pendingSoul,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNormalBrave,
    }).find(
      (action) =>
        action.kind === "resolve_soul_state_replacement" &&
        action.choice === "keep"
    );
    expect(keep).toBeDefined();

    const after = applyLegalAction({
      state: pendingSoul,
      action: keep!,
      getCardDefinitionById: getDefWithNormalBrave,
    }).state;
    expect(alice(after).soulStateInstanceIds).toEqual(
      expect.arrayContaining(["lucy-soul-inherit-mixed-host"])
    );
    expect([...getEffectiveSoulStateIds(after, getDefWithNormalBrave)]).toEqual(
      expect.arrayContaining([
        "lucy-soul-inherit-mixed-host",
        "key-brave-soul-inherit-mixed",
      ])
    );
    expect(alice(after).soulStateInstanceIds).not.toContain(
      "normal-brave-soul-inherit-mixed"
    );
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "key-brave-soul-inherit-mixed"
      )!.attachedToInstanceId
    ).toBe("lucy-soul-inherit-mixed-host");
    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "lucy-soul-inherit-mixed-host"
      )!.attachedChildrenIds
    ).toEqual(["key-brave-soul-inherit-mixed"]);
    const normalAfter = after.cardInstances.find(
      (c) => c.instanceId === "normal-brave-soul-inherit-mixed"
    )!;
    expect(normalAfter.attachedToInstanceId).toBeNull();
    expect(normalAfter.zone).toBe("trash");
  });

  it("BSFT01-TR01(A) は自身も同時に離脱予約された場合は魂状態置換で巻き取らない", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-inherit-dual-pending-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: ["key-brave-soul-inherit-dual-pending"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-soul-inherit-dual-pending",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-soul-inherit-dual-pending-host",
    });
    const hostQueued = queuePendingLeave({
      state: createEmptyGameState({
        cardInstances: [host, keyBrave],
        playerOverrides: [
          { contractCardNo: "BSFT01-CX01", reserveNormalCoreCount: 0 },
          {},
        ],
      }),
      instanceId: "lucy-soul-inherit-dual-pending-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-key-brave-dual-pending-host",
    });
    const bothQueued = queuePendingLeave({
      state: hostQueued,
      instanceId: "key-brave-soul-inherit-dual-pending",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-key-brave-dual-pending-brave",
    });

    const pending = flushPendingLeaves(bothQueued, getDef);
    expect(pending.pendingSoulStateReplacement?.cardInstanceId).toBe(
      "lucy-soul-inherit-dual-pending-host"
    );
    expect(
      pending.cardInstances.find(
        (c) => c.instanceId === "key-brave-soul-inherit-dual-pending"
      )!.zone
    ).toBe("trash");

    const keep = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_soul_state_replacement" &&
        action.choice === "keep"
    );
    expect(keep).toBeDefined();

    const afterKeep = applyLegalAction({
      state: pending,
      action: keep!,
      getCardDefinitionById: getDef,
    }).state;
    expect(afterKeep.pendingLeaveEntities).toHaveLength(0);
    expect(alice(afterKeep).soulStateInstanceIds).toEqual(
      expect.arrayContaining(["lucy-soul-inherit-dual-pending-host"])
    );
    expect(alice(afterKeep).soulStateInstanceIds).not.toContain(
      "key-brave-soul-inherit-dual-pending"
    );

    expect(
      afterKeep.cardInstances.find(
        (c) => c.instanceId === "key-brave-soul-inherit-dual-pending"
      )!.zone
    ).toBe("trash");
    expect(
      afterKeep.cardInstances.find(
        (c) => c.instanceId === "key-brave-soul-inherit-dual-pending"
      )!.attachedToInstanceId
    ).toBeNull();
  });

  it("BSFT01-TR01(A) は魂状態継承を選ぶとホストの魂状態置換 keep と不可分になる", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-force-keep-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: ["key-brave-soul-force-keep"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-soul-force-keep",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-soul-force-keep-host",
    });
    const queued = queuePendingLeave({
      state: createEmptyGameState({
        cardInstances: [host, keyBrave],
        playerOverrides: [
          { contractCardNo: "BSFT01-CX01", reserveNormalCoreCount: 0 },
          {},
        ],
      }),
      instanceId: "lucy-soul-force-keep-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-key-brave-soul-force-keep",
    });
    const pendingSoul = flushPendingLeaves(queued, getDef);
    expect(pendingSoul.pendingBraveLeaveChoice?.braveInstanceIds).toEqual([
      "key-brave-soul-force-keep",
    ]);
    const inherit = getLegalActions({
      state: pendingSoul,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "inherit_soul_state"
    );
    expect(inherit).toBeDefined();

    const pendingSoulOnly = applyLegalAction({
      state: pendingSoul,
      action: inherit!,
      getCardDefinitionById: getDef,
    }).state;
    expect(pendingSoulOnly.pendingBraveLeaveChoice).toBeNull();

    const soulChoices = getLegalActions({
      state: pendingSoulOnly,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    })
      .filter((action) => action.kind === "resolve_soul_state_replacement")
      .map((action) => action.choice);
    expect(soulChoices).toEqual(["keep"]);
  });

  it("BSFT01-TR01(A) は魂状態継承を選ばなければ魂状態置換 decline で通常離脱する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-decline-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: ["key-brave-soul-decline"],
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-soul-decline",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-soul-decline-host",
    });
    const queued = queuePendingLeave({
      state: createEmptyGameState({
        cardInstances: [host, keyBrave],
        playerOverrides: [
          { contractCardNo: "BSFT01-CX01", reserveNormalCoreCount: 0 },
          {},
        ],
      }),
      instanceId: "lucy-soul-decline-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-key-brave-soul-decline",
    });
    const pendingSoul = flushPendingLeaves(queued, getDef);
    const sendWithHost = getLegalActions({
      state: pendingSoul,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "send_with_host"
    );
    expect(sendWithHost).toBeDefined();

    const pendingSoulOnly = applyLegalAction({
      state: pendingSoul,
      action: sendWithHost!,
      getCardDefinitionById: getDef,
    }).state;
    expect(pendingSoulOnly.pendingBraveLeaveChoice).toBeNull();

    const decline = getLegalActions({
      state: pendingSoulOnly,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_soul_state_replacement" &&
        action.choice === "decline"
    );
    expect(decline).toBeDefined();

    const afterDecline = applyLegalAction({
      state: pendingSoulOnly,
      action: decline!,
      getCardDefinitionById: getDef,
    }).state;
    const afterSend = flushPendingLeaves(afterDecline, getDef);
    expect(afterSend.cardInstances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "lucy-soul-decline-host",
          zone: "trash",
        }),
        expect.objectContaining({
          instanceId: "key-brave-soul-decline",
          zone: "trash",
          attachedToInstanceId: null,
        }),
      ])
    );
    expect(alice(afterSend).soulStateInstanceIds).not.toContain(
      "key-brave-soul-decline"
    );
  });

  it("魂状態継承は非鍵の magic_compatible ブレイヴには広がらない", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-non-key-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["non-key-magic-compatible-brave"],
    });
    const nonKeyBrave = createCardInstance(nonKeyMagicCompatibleTestBrave, {
      instanceId: "non-key-magic-compatible-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-soul-non-key-host",
    });
    const queued = queuePendingLeave({
      state: createEmptyGameState({
        cardInstances: [host, nonKeyBrave],
        playerOverrides: [
          { contractCardNo: "BSFT01-CX01", reserveNormalCoreCount: 0 },
          {},
        ],
      }),
      instanceId: "lucy-soul-non-key-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "bsft01-non-key-magic-compatible",
    });

    const pendingBraveChoice = flushPendingLeaves(
      queued,
      getDefWithNormalBrave
    );
    expect(
      pendingBraveChoice.pendingBraveLeaveChoice?.braveInstanceIds
    ).toEqual(["non-key-magic-compatible-brave"]);
  });

  it("BSFT01-TR01(A) の疲労不可は ruleStrength なので防げない疲労にも貫通されない", () => {
    const c = card("BSFT01-TR01(A)");
    const brave = createCardInstance(c, {
      instanceId: "key-brave-exhaust",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const before = createEmptyGameState({ cardInstances: [brave] });
    const rebuilt = rebuildContinuousEffectsFromField(before, getDef);
    const target = rebuilt.cardInstances.find(
      (x) => x.instanceId === "key-brave-exhaust"
    )!;

    expect(
      resolveCardExhaustAffect(rebuilt, target, BOB, getDef, "none").kind
    ).toBe("blocked");
    expect(
      resolveCardExhaustAffect(rebuilt, target, BOB, getDef, "unpreventable")
        .kind
    ).toBe("blocked");
  });
});

// ════════════════════════════════════════════════════════════════
// C01 ウラノ・メトリア — 全効果 DSL ギャップ（empty）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-C01 ウラノ・メトリア", () => {
  const c = card("BSFT01-C01");

  it("3効果: [0]swap disposition(実装) / [2,3]フラッシュ動的floor破壊(実装) / [5,6]スタック同系統疲労(実装)", () => {
    expect(c.effects).toHaveLength(3);
    // [0] 鍵/星霊効果でオープン/トラッシュ行き時の手札入替（swap 型 disposition）。
    expect(c.effects![0]!.cardEventDisposition).toEqual({ kind: "swap" });
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![2]!.stub).toBeUndefined();
  });

  it("[5,6] スタック: exhaust(opponent, spirit/ultimate/nexus, tribesMatchRef:declared_blocker, exclude:blocking, count:2)", () => {
    const stack = c.effects![2]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("exhaust");
    if (action.kind !== "exhaust" || !("filter" in action.target)) {
      throw new Error("expected exhaust filter");
    }
    expect(action.target.player).toBe("opponent");
    expect(action.target.filter.category).toEqual([
      "spirit",
      "ultimate",
      "nexus",
    ]);
    expect(action.target.filter.tribesMatchRef).toBe("declared_blocker");
    expect(action.target.filter.exclude).toEqual({
      filterOr: [{ battleState: "blocking" }, { pendingDeclaration: "block" }],
    });
    expect(action.target.count).toBe(2);
  });

  it("[board] スタック候補列挙: ブロック宣言する相手と同じ系統を持つ他カードのみ候補になる（ブロッカー自身・別系統は除外）", () => {
    const stack = c.effects![2]!;
    const action = stack.steps[0]!.action;
    if (action.kind !== "exhaust" || !("filter" in action.target)) {
      throw new Error("expected exhaust filter");
    }
    const blocker = createCardInstance(card("BSFT01-TR01(B)"), {
      instanceId: "blocker-c01-tribes",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const sameTribe = createCardInstance(card("BSFT01-TR03(B)"), {
      instanceId: "same-tribe-c01",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const differentTribe = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "different-tribe-c01",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const attacker = createCardInstance(card("BSFT01-TR02(B)"), {
      instanceId: "attacker-c01-tribes",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        cardInstances: [blocker, sameTribe, differentTribe, attacker],
      }),
      step: "attack",
      activeAttack: {
        attackId: "attack-c01-tribes",
        primaryEntityId: "be-c01-attacker",
        participantEntityIds: ["be-c01-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "be-c01-attacker",
            blockedByEntityIds: ["be-c01-blocker"],
          },
        ],
        symbolResolutionOrder: ["be-c01-attacker"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-c01-attacker",
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
        {
          entityId: "be-c01-blocker",
          memberInstanceIds: [blocker.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: ["yellow"],
          attackState: "blocking",
        },
      ],
    };
    const candidates = getCandidateTargetInstanceIds(
      state,
      ALICE,
      {
        candidateTargetPlayerScope: "opponent",
        targetCardFilter: action.target.filter,
      },
      { getCardDefinitionById: getDef }
    );
    expect(candidates.sort()).toEqual([sameTribe.instanceId]);

    const after = executeEffect({
      chainId: "test:bsft01-cards:3568",
      state,
      effect: stack,
      sourceInstanceId: "attacker-c01-tribes",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: candidates,
    });
    expect(
      after.cardInstances.find((x) => x.instanceId === sameTribe.instanceId)
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      after.cardInstances.find((x) => x.instanceId === blocker.instanceId)
        ?.exhaustState
    ).not.toBe("exhausted");
    expect(
      after.cardInstances.find(
        (x) => x.instanceId === differentTribe.instanceId
      )?.exhaustState
    ).not.toBe("exhausted");
  });

  it("[2,3] フラッシュ: 合体ブレイヴ floor(/2) 体の強制破壊（count = DynamicCount divisor:2）", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    // count<=4 分岐 (素の破壊) の count を検査。
    const plain = flash.steps[0]!.action;
    if (plain.kind !== "destroy" || !("filter" in plain.target))
      throw new Error("expected destroy filter");
    expect(plain.target.filter.category).toEqual(["spirit", "ultimate"]);
    expect(plain.target.count).toMatchObject({
      source: {
        kind: "cards_in_zone",
        zone: "field",
        player: "self",
        filter: { category: ["brave"], combined: true, soulState: "include" },
      },
      divisor: 2,
    });
    // count>=5 分岐は破壊対象の効果抑制付き。
    const suppress = flash.steps[1]!.action;
    if (suppress.kind !== "destroy") throw new Error("expected destroy");
    expect(suppress.suppressDestroyedEffects).toBe("destroyed_only");
    // preventionLevel:'unpreventable' は count>=5 のときのみ適用される条件付き防止不可
    // (audit-bsft01 解消, ユーザー裁定 2026-06-19)。preventionLevelCondition で min:5 にゲート。
    expect(flash.preventionLevel).toBe("unpreventable");
    expect(flash.preventionLevelCondition).toEqual([
      { kind: "count_value", player: "self", min: 5 },
    ]);
  });

  it("[board] 合体ブレイヴ4つ(=floor 2体)のとき相手スピリット2体が破壊予約される", () => {
    // host スピリット + 合体中ブレイヴ4つ。「魂状態を含む」は filter.soulState:"include" を構造
    // テストで検証済（合体ブレイヴ数 = floor(4/2) = 2 を盤面で確認）。
    const host = createCardInstance(card(ENEMY_CARD), {
      instanceId: "host-c01",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const braveCard = card("BSFT01-TR01(A)");
    const braves = [0, 1, 2, 3].map((i) =>
      createCardInstance(braveCard, {
        instanceId: `brave-c01-${i}`,
        ownerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "host-c01",
      })
    );
    host.attachedChildrenIds = braves.map((b) => b.instanceId);
    const enemies = [0, 1, 2].map((i) =>
      createCardInstance(card(ENEMY_CARD), {
        instanceId: `enemy-c01-${i}`,
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    // count<5 分岐（素の破壊）を発火させるため、カウントは 0 のまま。
    const after = runEffect(
      createEmptyGameState({ cardInstances: [host, ...braves, ...enemies] }),
      c.effects![1]!,
      "host-c01"
    );
    const destroyedCount = after.cardInstances.filter(
      (x) => x.controllerPlayerId === BOB && x.pendingLeaveKind === "destroy"
    ).length;
    expect(destroyedCount).toBe(2); // floor(4 / 2)
  });
});

// ════════════════════════════════════════════════════════════════
// C02 ルーシィキック — [0] 自己回収を実装、残（BP比較破壊・動的BP修飾）は stub
// ════════════════════════════════════════════════════════════════

describe("BSFT01-C02 ルーシィキック", () => {
  const c = card("BSFT01-C02");
  it("[0] 鍵/星霊効果でのオープン/トラッシュ行き自己回収（trigger_tribes）を実装", () => {
    const recover = c.effects![0]!;
    expect(recover.timing).toEqual({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    expect(recover.condition).toContainEqual({
      kind: "trigger_tribes",
      tribes: ["鍵", "星霊"],
    });
    expect(recover.condition).toContainEqual({
      kind: "trigger_from_zone",
      zones: ["deck"],
    });
    expect(recover.executionMode).toBe("optional");
  });
  it("[2,3] フラッシュ BP比較破壊（comparer Pattern 2）＋合体ブレイヴ動的BP+2000 を実装", () => {
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    // step[0] = 「ルーシィ」を合体中ブレイヴ数×2000 で強化（bp_modify dynamicAmount）。
    expect(flash.steps[0]!.id).toBe("luchy_boost");
    expect(flash.steps[0]!.action.kind).toBe("bp_modify");
    // step[1] = comparer=ref で強化済「ルーシィ」を源に相手1体と BP 比較破壊。
    const cmp = flash.steps[1]!.action;
    expect(cmp.kind).toBe("bp_compare_destroy");
    expect((cmp as { comparer?: unknown }).comparer).toEqual({
      kind: "ref",
      stepId: "luchy_boost",
    });
  });
});

// ════════════════════════════════════════════════════════════════
// C03 星霊界 — swap / 配置時デッキ3枚トラッシュ / 手札破棄耐性 / Lv2メイン択一
// ════════════════════════════════════════════════════════════════

describe("BSFT01-C03 星霊界", () => {
  const c = card("BSFT01-C03");

  it("4効果: [0]swap自己入替 / [2,3]配置時deck_reveal / [5,6]手札破棄耐性 / [8,9]Lv2メイン択一", () => {
    expect(c.effects).toHaveLength(4);
    // [0] 鍵/星霊効果でのオープン/トラッシュ行き時の手札入替 (swap disposition)。
    // 「自分の」効果限定のため trigger_source_player:self を condition 先頭に持つ
    // (audit-bsft01 解消, 2026-06-20)。
    const swap = c.effects![0]!;
    expect(swap.cardEventDisposition).toEqual({ kind: "swap" });
    expect(swap.condition).toContainEqual({
      kind: "trigger_source_player",
      player: "self",
    });
    expect(swap.condition).toContainEqual({
      kind: "trigger_tribes",
      tribes: ["鍵", "星霊"],
    });
    const place = c.effects![1]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    expect(place.executionMode).toBe("optional");
    const action = place.steps[0]!.action;
    expect(action).toEqual({
      kind: "discard",
      fromZone: "deck",
      player: "self",
      count: 3,
    });
    const handGuard = c.effects![2]!;
    expect(handGuard.stub).toBeUndefined();
    expect(handGuard.steps[0]!.action.kind).toBe("prevent_hand_discard");
    const main = c.effects![3]!;
    expect(main.stub).toBeUndefined();
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    expect(main.applicability).toEqual({ level: { min: 2, max: 2 } });
    expect(main.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(main.steps[0]!.action).toEqual({ kind: "pay_cost", amount: 1 });
    expect(main.steps[1]!.connector).toBe("conditional_cost");
  });

  it("[board] 配置時: デッキ上3枚がトラッシュへ移る", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card(ENEMY_CARD), {
        instanceId: `deck-c03-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck],
      playerOverrides: [{ deckCount: 5 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "seirei-c03");
    // remainder="trash" かつ pick も任意効果も無いため、戻し順選択 pending を立てず
    // デッキ上3枚を直接トラッシュへ送る（P3-93: トラッシュ行きに置き順は無意味）。
    const stillDeck = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "deck"
    );
    const trashed = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "trash"
    );
    expect(stillDeck).toHaveLength(2); // 5 - 3 オープン
    expect(trashed).toHaveLength(3);
    expect(after.pendingDeckReveal).toBeNull(); // 順序選択 pending を出さない
    expect(alice(after).deckCount).toBe(2);
    expect(after.log.some((l) => l.includes("deck_reveal"))).toBe(false);
  });

  it("BSFT01-C03 Lv2メイン: 1コスト支払いから魂状態のBSFT01-CX01を無償召喚する", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-main",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const lucySoul = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-c03",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src, lucySoul],
      playerOverrides: [
        {
          reserveNormalCoreCount: 5,
          soulStateInstanceIds: ["lucy-soul-c03"],
        },
        {},
      ],
    });

    const after = executeEffect({
      chainId: "test:bsft01-cards:3803",
      state: before,
      effect: c.effects![3]!,
      sourceInstanceId: "seirei-c03-main",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      choiceIndex: 0,
    });

    expect(alice(after).soulStateInstanceIds).not.toContain("lucy-soul-c03");
    const lucy = after.cardInstances.find(
      (x) => x.instanceId === "lucy-soul-c03"
    )!;
    expect(lucy.zone).toBe("field");
    expect(lucy.zoneRoleName).toBe("spirit");
    expect(lucy.normalCoreCount).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(3);
    expect(after.log).toContain(
      "effect:summon:lucy-soul-c03:self:soul_state:cost=0:cores=1"
    );
  });

  it("BSFT01-C03 Lv2メイン: 複数魂状態候補では選択したルーシィだけを召喚する", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-main-selected",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const firstLucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-first",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const chosenLucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-chosen",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src, firstLucy, chosenLucy],
      playerOverrides: [
        {
          reserveNormalCoreCount: 5,
          soulStateInstanceIds: ["lucy-soul-first", "lucy-soul-chosen"],
        },
        {},
      ],
    });

    const after = executeEffect({
      chainId: "test:bsft01-cards:3858",
      state: before,
      effect: c.effects![3]!,
      sourceInstanceId: "seirei-c03-main-selected",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      choiceIndex: 0,
      targetInstanceIds: ["lucy-soul-chosen"],
    });

    expect(alice(after).soulStateInstanceIds).toContain("lucy-soul-first");
    expect(alice(after).soulStateInstanceIds).not.toContain("lucy-soul-chosen");
    expect(
      after.cardInstances.find((x) => x.instanceId === "lucy-soul-first")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((x) => x.instanceId === "lucy-soul-chosen")
        ?.zoneRoleName
    ).toBe("spirit");
  });

  it("BSFT01-C03 Lv2メイン: 維持コア未指定なら魂状態召喚後に配置pendingを出す", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-main-no-core",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const lucySoul = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-no-core",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src, lucySoul],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
          soulStateInstanceIds: ["lucy-soul-no-core"],
        },
        {},
      ],
    });

    const after = executeEffect({
      chainId: "test:bsft01-cards:3906",
      state: before,
      effect: c.effects![3]!,
      sourceInstanceId: "seirei-c03-main-no-core",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      choiceIndex: 0,
      targetInstanceIds: ["lucy-soul-no-core"],
    });

    expect(alice(after).soulStateInstanceIds).not.toContain(
      "lucy-soul-no-core"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "lucy-soul-no-core")
        ?.normalCoreCount
    ).toBe(0);
    expect(alice(after).reserveNormalCoreCount).toBe(0);
    expect(after.pendingMultiPlacement).toMatchObject({
      actingPlayerId: ALICE,
      sourceInstanceId: src.instanceId,
      targets: [
        {
          instanceId: "lucy-soul-no-core",
          minimumCoreCount: 1,
        },
      ],
    });
    expect(
      after.pendingMultiPlacement?.priorStateSnapshot?.players.find(
        (p) => p.id === ALICE
      )?.reserveNormalCoreCount
    ).toBe(1);
    expect(
      after.pendingMultiPlacement?.priorStateSnapshot?.players.find(
        (p) => p.id === ALICE
      )?.soulStateInstanceIds
    ).toContain("lucy-soul-no-core");
    expect(after.log).toContain(
      "effect:summon:lucy-soul-no-core:self:soul_state:pending-placement"
    );
  });

  it("BSFT01-C03 Lv2メイン: 明示維持コア配置のソース不足はコストごとrollbackする", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-main-bad-placement",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const lucySoul = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-bad-placement",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src, lucySoul],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
          soulStateInstanceIds: ["lucy-soul-bad-placement"],
        },
        {},
      ],
    });

    const after = executeEffect({
      chainId: "test:bsft01-cards:3975",
      state: before,
      effect: c.effects![3]!,
      sourceInstanceId: "seirei-c03-main-bad-placement",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 2 }],
      choiceIndex: 0,
      targetInstanceIds: ["lucy-soul-bad-placement"],
    });

    expect(alice(after).reserveNormalCoreCount).toBe(2);
    expect(alice(after).soulStateInstanceIds).toContain(
      "lucy-soul-bad-placement"
    );
    expect(
      after.cardInstances.find(
        (x) => x.instanceId === "lucy-soul-bad-placement"
      )?.normalCoreCount
    ).toBe(0);
    expect(after.log).toContain(
      "effect:conditional-cost-effect-failed:seirei-c03-main-bad-placement"
    );
  });

  it("BSFT01-C03 Lv2メイン: soulState only 候補列挙は通常フィールドのルーシィを除外する", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-candidates",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const fieldLucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-field-normal",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const soulLucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-soul-candidate",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      cardInstances: [src, fieldLucy, soulLucy],
      playerOverrides: [
        {
          reserveNormalCoreCount: 5,
          soulStateInstanceIds: ["lucy-soul-candidate"],
        },
        {},
      ],
    });
    const summon = c.effects![3]!.steps[1]!.action;
    if (summon.kind !== "summon" || summon.target.kind !== "from_zone") {
      throw new Error("unexpected BSFT01-C03 summon action shape");
    }

    const candidates = getCandidateTargetInstanceIds(
      state,
      ALICE,
      {
        actionKind: "summon",
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "acting_player",
        requiredTargetCount: 1,
        targetCardFilter: summon.target.filter,
      },
      {
        getCardDefinitionById: getDef,
        sourceInstanceId: "seirei-c03-candidates",
        sourceDefinition: c,
      }
    );

    expect(candidates).toEqual(["lucy-soul-candidate"]);
  });

  it("BSFT01-C03 Lv2メイン: 1コスト支払いからトラッシュの光導/鍵ブレイヴを手札に戻す", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-main-recover",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-c03",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const before = createEmptyGameState({
      cardInstances: [src, keyBrave],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });

    const after = executeEffect({
      chainId: "test:bsft01-cards:4074",
      state: before,
      effect: c.effects![3]!,
      sourceInstanceId: "seirei-c03-main-recover",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      choiceIndex: 1,
    });

    expect(alice(after).reserveNormalCoreCount).toBe(4);
    expect(
      after.cardInstances.find((x) => x.instanceId === "key-brave-c03")?.zone
    ).toBe("hand");
    expect(after.pendingZoneSelection).toBeNull();
  });

  it("BSFT01-C03 Lv2メイン: スタック後の択一でも盤面コアの支払い元選択を渡して回収する", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-stack-payment-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const keyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-stack-payment-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const lookup = {
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(ALL_CARDS),
    };
    const initial: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, keyBrave],
        playerOverrides: [
          {
            reserveNormalCoreCount: 0,
            reserveSoulCoreCount: 0,
            soulCoreLocation: { kind: "card", instanceId: src.instanceId },
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const fieldAction = getLegalActions({
      state: initial,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...lookup,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === src.instanceId
    );
    expect(fieldAction).toBeDefined();

    const declared = applyLegalAction({
      state: initial,
      action: fieldAction!,
      getCardDefinitionById: getDef,
      ...lookup,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      ...lookup,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const choicePending = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById: getDef,
      ...lookup,
    }).state;
    const searchChoice = getLegalActions({
      state: choicePending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...lookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(searchChoice).toMatchObject({ requiredPayCostAmount: 1 });

    const trainingInput = createActionInputDecisionNode(
      choicePending,
      searchChoice!,
      { getCardDefinitionById: getDef }
    );
    expect(trainingInput).toMatchObject({
      kind: "action_input",
      fields: ["deferPayCostSourceSelection"],
    });
    const deferPaymentInput = trainingInput?.choices.find(
      (choice) => choice.applyOptions?.deferPayCostSourceSelection === true
    );
    expect(deferPaymentInput?.applyOptions).toEqual({
      deferPayCostSourceSelection: true,
    });
    if (!deferPaymentInput?.applyOptions) {
      throw new Error("expected deferred stack payment training input");
    }

    const targetPending = applyLegalAction({
      state: choicePending,
      action: searchChoice!,
      ...deferPaymentInput.applyOptions,
      getCardDefinitionById: getDef,
      ...lookup,
    }).state;
    const targetAction = getLegalActions({
      state: targetPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...lookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    const paymentPending = applyLegalAction({
      state: targetPending,
      action: targetAction!,
      targetInstanceIds: [keyBrave.instanceId],
      getCardDefinitionById: getDef,
      ...lookup,
    }).state;
    // 支払元が1枚でもソウルコアがあるため、HUDで通常コアを選ぶ。
    expect(paymentPending.pendingCoreSourceAllocation).toMatchObject({
      requiredTotal: 1,
    });
    expect(
      paymentPending.cardInstances.find(
        (card) => card.instanceId === src.instanceId
      )?.normalCoreCount
    ).toBe(2);
    const paymentAction = getLegalActions({
      state: paymentPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...lookup,
    }).find((action) => action.kind === "resolve_core_source_allocation");
    expect(paymentAction).toBeDefined();
    const resolved = applyLegalAction({
      state: paymentPending,
      action: paymentAction!,
      coreSourceAllocations: { [src.instanceId]: 1 },
      getCardDefinitionById: getDef,
      ...lookup,
    }).state;
    expect(
      resolved.cardInstances.find((card) => card.instanceId === src.instanceId)
        ?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === keyBrave.instanceId
      )?.zone
    ).toBe("hand");
    expect(resolved.pendingCoreSourceAllocation).toBeNull();
  });

  it("BSFT01-C03 Lv2メイン: trash回収分岐は選択した光導/鍵ブレイヴ1枚だけを戻す", () => {
    const src = createCardInstance(c, {
      instanceId: "seirei-c03-main-recover-selected",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const firstBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "key-brave-first-c03",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const chosenBrave = createCardInstance(card("BSFT01-TR04(A)"), {
      instanceId: "key-brave-chosen-c03",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const before = createEmptyGameState({
      cardInstances: [src, firstBrave, chosenBrave],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });

    const after = executeEffect({
      chainId: "test:bsft01-cards:4264",
      state: before,
      effect: c.effects![3]!,
      sourceInstanceId: "seirei-c03-main-recover-selected",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      choiceIndex: 1,
      targetInstanceIds: ["key-brave-chosen-c03"],
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "key-brave-first-c03")
        ?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "key-brave-chosen-c03")
        ?.zone
    ).toBe("hand");
    expect(after.pendingZoneSelection).toBeNull();
  });

  it("BSFT01-C03 Lv2メイン: trash回収分岐は対象0ならconditional_cost候補として空撃ち不可", () => {
    const regs = generateFieldCardEffectRegistrations(c);
    const mainReg = regs.find((r) => r.effectIndex === 3);
    const recoverChoice = mainReg?.choices?.[1];
    expect(recoverChoice).toMatchObject({
      requiredTargetCount: 1,
      targetGatedByConditionalCost: true,
      candidateTargetZones: ["trash"],
      candidateTargetPlayerScope: "acting_player",
      targetCardFilter: {
        category: ["brave"],
        tribesRequired: ["光導", "鍵"],
      },
    });

    const src = createCardInstance(c, {
      instanceId: "seirei-c03-main-no-trash-target",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });

    const candidates = getCandidateTargetInstanceIds(
      before,
      ALICE,
      recoverChoice!,
      {
        getCardDefinitionById: getDef,
        sourceInstanceId: "seirei-c03-main-no-trash-target",
        sourceDefinition: c,
      }
    );

    expect(candidates).toEqual([]);

    const after = executeEffect({
      chainId: "test:bsft01-cards:4326",
      state: before,
      effect: c.effects![3]!,
      sourceInstanceId: "seirei-c03-main-no-trash-target",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      payCostPaymentSources: [{ kind: "reserve", amount: 1 }],
      choiceIndex: 1,
    });

    expect(alice(after).reserveNormalCoreCount).toBe(5);
    expect(after.log).toContain(
      "effect:conditional-cost-effect-failed:seirei-c03-main-no-trash-target"
    );
  });
});

// ════════════════════════════════════════════════════════════════
// C04 ハートフィリア財閥 — 自己回収 / 系統なしネクサス保護 / 鍵ブレイヴ召喚
// ════════════════════════════════════════════════════════════════

describe("BSFT01-C04 ハートフィリア財閥", () => {
  const c = card("BSFT01-C04");
  it("[0] 鍵/星霊自己回収＋手札5枚以下ゲート＋自分起因ガード（trigger_source_player + trigger_tribes + hand_count）を実装", () => {
    const recover = c.effects![0]!;
    expect(recover.timing).toEqual({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    // 「自分の」効果限定ガード (audit-bsft01 解消, 2026-06-20)。
    expect(recover.condition).toContainEqual({
      kind: "trigger_source_player",
      player: "self",
    });
    expect(recover.condition).toContainEqual({
      kind: "trigger_tribes",
      tribes: ["鍵", "星霊"],
    });
    expect(recover.condition).toContainEqual({
      kind: "hand_count",
      player: "self",
      max: 5,
    });
  });
  it("[2,3] 系統なしネクサスへ effect_immunity + grant_effect(stay_on_field) を付与する", () => {
    const effect = c.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.textRef).toEqual([2, 3]);

    const immunity = effect.steps[0]!.action;
    expect(immunity.kind).toBe("effect_immunity");
    if (immunity.kind === "effect_immunity") {
      expect(immunity.target).toEqual({
        kind: "filter",
        player: "self",
        count: "all",
        filter: { category: ["nexus"], noTribes: true },
      });
      expect(immunity.duration).toEqual({ scope: "while_on_field" });
      expect(immunity.sourcePlayerScope).toBeUndefined();
    }

    const grant = effect.steps[1]!.action;
    expect(grant.kind).toBe("grant_effect");
    if (grant.kind === "grant_effect") {
      expect(grant.target).toEqual({
        kind: "filter",
        player: "self",
        count: "all",
        filter: { category: ["nexus"], noTribes: true },
      });
      expect(grant.duration).toEqual({ scope: "while_on_field" });
      expect(grant.grantedEffect.timing).toEqual({
        kind: "card_event",
        event: "leave_field",
        cause: ["opponent_effect", "battle"],
      });
      expect(grant.grantedEffect.executionMode).toBe("optional");
      expect(grant.grantedEffect.steps[0]!.action).toEqual({
        kind: "stay_on_field",
        target: { kind: "self" },
      });
    }
  });
  it("[board] [2,3] BSFT01-C04 の常時保護は後から場に出た系統なしネクサスにも追従する", () => {
    const source = createCardInstance(c, {
      instanceId: "BSFT01-C04-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(c, {
      instanceId: "BSFT01-C04-target",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const registered = runEffect(
      createEmptyGameState({ cardInstances: [source] }),
      c.effects![1]!,
      "BSFT01-C04-source"
    );
    expect(
      registered.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.targetInstanceId === undefined &&
          ce.targetFilter?.noTribes === true
      )
    ).toBe(true);
    expect(
      registered.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === undefined &&
          ce.targetFilter?.noTribes === true
      )
    ).toBe(true);

    const granted: GameState = {
      ...registered,
      cardInstances: [...registered.cardInstances, target],
    };
    expect(
      isCardImmuneToOpponentEffect(
        granted,
        target,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      filterTargetsByPreventionLevel(granted, ["BSFT01-C04-target"], "none", {
        actingPlayerId: BOB,
        effectSource: { instance: source, definition: c },
        getCardDefinitionById: getDef,
      })
    ).toEqual([]);
    const coreMoveBlocked = executeEffect({
      chainId: "test:bsft01-cards:4469",
      state: granted,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "card_instance",
                instanceId: "BSFT01-C04-target",
              },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "BSFT01-C04-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const targetAfterCoreMove = coreMoveBlocked.cardInstances.find(
      (card) => card.instanceId === "BSFT01-C04-target"
    )!;
    expect(targetAfterCoreMove.normalCoreCount).toBe(1);
    expect(alice(coreMoveBlocked).reserveNormalCoreCount).toBe(
      alice(granted).reserveNormalCoreCount
    );
    const autoCoreMoveBlocked = executeEffect({
      chainId: "test:bsft01-cards:4499",
      state: granted,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: { category: ["nexus"] },
              },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "BSFT01-C04-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      autoCoreMoveBlocked.cardInstances.find(
        (card) => card.instanceId === "BSFT01-C04-target"
      )?.normalCoreCount
    ).toBe(1);
    expect(alice(autoCoreMoveBlocked).reserveNormalCoreCount).toBe(
      alice(granted).reserveNormalCoreCount
    );
    const fieldCardCoreMoveBlocked = executeEffect({
      chainId: "test:bsft01-cards:4531",
      state: granted,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "opponent",
                filter: { category: ["nexus"] },
              },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      },
      sourceInstanceId: "BSFT01-C04-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      fieldCardCoreMoveBlocked.cardInstances.find(
        (card) => card.instanceId === "BSFT01-C04-target"
      )?.normalCoreCount
    ).toBe(1);
    expect(alice(fieldCardCoreMoveBlocked).reserveNormalCoreCount).toBe(
      alice(granted).reserveNormalCoreCount
    );

    const highCoreTarget = createCardInstance(c, {
      instanceId: "BSFT01-C04-high-core-target",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const maxCoreCe: ContinuousEffect = {
      effectId: "BSFT01-C04-test-max-core-immunity",
      sourceInstanceId: "BSFT01-C04-source",
      sourceDefinitionId: "BSFT01-C04",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: granted.turnNumber,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetFilter: { player: "self", category: ["nexus"], maxCores: 1 },
    };
    const maxCoreState: GameState = {
      ...granted,
      cardInstances: [...granted.cardInstances, highCoreTarget],
      activeContinuousEffects: [maxCoreCe],
    };
    expect(
      isCardImmuneToOpponentEffect(
        maxCoreState,
        target,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        maxCoreState,
        highCoreTarget,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(false);

    const chainId = "BSFT01-C04-opponent-leave";
    const pendingLeave = queuePendingLeave({
      state: granted,
      instanceId: "BSFT01-C04-target",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      pendingLeave,
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "BSFT01-C04-target",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId,
        },
      ],
      getDef
    );
    const pending = grantedEffectPendings(queued)[0]!;
    const resolved = resolveGrantedEffectPending(queued, pending.pendingId);
    const targetAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "BSFT01-C04-target"
    )!;

    expect(targetAfter.zone).toBe("field");
    expect(targetAfter.exhaustState).toBe("exhausted");
    expect(targetAfter.pendingLeaveKind).toBeNull();
    expect(resolved.pendingLeaveEntities).toHaveLength(0);

    const removeChainId = "BSFT01-C04-opponent-remove-from-game";
    const queuedRemoveFromGame = queueGrantedEffectTriggersFromTriggerEvents(
      queuePendingLeave({
        state: granted,
        instanceId: "BSFT01-C04-target",
        kind: "remove_from_game",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: removeChainId,
      }),
      [
        {
          eventKind: "remove_from_game",
          relatedInstanceId: "BSFT01-C04-target",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId: removeChainId,
        },
      ],
      getDef
    );
    const removePendings = grantedEffectPendings(queuedRemoveFromGame);
    expect(removePendings).toHaveLength(1);
    expect(removePendings[0]!.relatedInstanceId).toBe("BSFT01-C04-target");

    const addTribeCe: ContinuousEffect = {
      effectId: "BSFT01-C04-test-add-tribe",
      sourceInstanceId: "BSFT01-C04-source",
      sourceDefinitionId: "BSFT01-C04",
      targetInstanceId: "BSFT01-C04-target",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: granted.turnNumber,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      metadata: { properties: { addTribes: ["導魔"] } },
    };
    const grantedWithEffectiveTribe: GameState = {
      ...granted,
      activeContinuousEffects: [...granted.activeContinuousEffects, addTribeCe],
    };
    expect(
      isCardImmuneToOpponentEffect(
        grantedWithEffectiveTribe,
        target,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(false);
    const queuedWithEffectiveTribe =
      queueGrantedEffectTriggersFromTriggerEvents(
        queuePendingLeave({
          state: grantedWithEffectiveTribe,
          instanceId: "BSFT01-C04-target",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "BSFT01-C04-opponent-leave-effective-tribe",
        }),
        [
          {
            eventKind: "destroy",
            relatedInstanceId: "BSFT01-C04-target",
            relatedPlayerId: ALICE,
            cause: "opponent_effect",
            chainId: "BSFT01-C04-opponent-leave-effective-tribe",
          },
        ],
        getDef
      );
    expect(grantedEffectPendings(queuedWithEffectiveTribe)).toHaveLength(0);
  });
  it("[5,6] Lv2 自分の「ルーシィ」アタック/ブロック時の手札鍵ブレイヴ コストなし召喚を game_event + from_zone summon で配線", () => {
    const trig = c.effects![2]!;
    expect(trig.stub).toBeUndefined();
    expect(trig.textRef).toEqual([5, 6]);
    expect(trig.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: ["attack", "block"],
      triggerFilter: { cardName: [{ contains: "ルーシィ" }] },
    });
    expect(trig.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(trig.executionMode).toBe("optional");
    expect(trig.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(trig.steps).toHaveLength(1);
    const action = trig.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.costModifier).toBe("free");
      if (action.target.kind === "from_zone") {
        expect(action.target.zone).toBe("hand");
        expect(action.target.count).toBe(1);
        expect(action.target.filter).toEqual({
          category: ["brave"],
          tribes: ["鍵"],
        });
      } else {
        throw new Error("expected from_zone target");
      }
    }
  });
  it("[5,6] triggered registration が pendingEffectTargetSelection 用 target metadata を伝搬する", () => {
    // ENGINE-from-zone-summon-target-selection (f52de8f3) で from_zone summon は
    // extractFieldTargetingFromAction 経由で requiredTargetCount / candidateTargetZones /
    // candidateTargetPlayerScope / targetCardFilter を registration へ載せる。これが無いと
    // legal-actions-availability が preSelectedIds 用 pending を作らず先頭一致 auto-select に
    // 落ちる (verifier 2026-06-22 lens 4 refute)。
    const lookup = buildTriggeredEffectLookup([c]);
    const regs = lookup("BSFT01-C04") ?? [];
    // [0] revealed/moved_to_trash と [5,6] attack/block の 2 triggered registration が登録される。
    const trig56 = regs.find(
      (r) => r.eventKind === "attack" && r.effectIndex === 2 // effects[2] = [5,6]
    );
    expect(trig56).toBeDefined();
    expect(trig56).toMatchObject({
      requiredTargetCount: 1,
      candidateTargetPlayerScope: "acting_player",
      candidateTargetZones: ["hand"],
      targetCardFilter: { category: ["brave"], tribes: ["鍵"] },
    });
    // block event 側も同じ metadata を持つ。
    const trig56Block = regs.find(
      (r) => r.eventKind === "block" && r.effectIndex === 2
    );
    expect(trig56Block).toBeDefined();
    expect(trig56Block).toMatchObject({
      requiredTargetCount: 1,
      candidateTargetZones: ["hand"],
      targetCardFilter: { category: ["brave"], tribes: ["鍵"] },
    });
  });
  it("[board] BSFT01-C04[5,6] effect summon は選んだ BSFT01-TR02(A) だけを出し、召喚時直接合体 pending から BSFT01-CX01 に合体できる", () => {
    // 2 枚の鍵ブレイヴが手札にあるとき、ENGINE-from-zone-summon-target-selection によって
    // プレイヤーが選択した方だけが召喚される (slice(0,count) 先頭一致 auto-select でない)。
    const c04 = createCardInstance(c, {
      instanceId: "c04-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2 (requiredCores=1)
    });
    const braveFirst = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "brave-first",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const braveChosen = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "brave-chosen",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-c04-combine-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [c04, braveFirst, braveChosen, lucy],
    });
    const after = executeEffect({
      chainId: "test:bsft01-cards:4806",
      state: base,
      effect: c.effects![2]!,
      sourceInstanceId: "c04-nexus",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["brave-chosen"],
    });
    const firstAfter = after.cardInstances.find(
      (x) => x.instanceId === "brave-first"
    )!;
    const chosenAfter = after.cardInstances.find(
      (x) => x.instanceId === "brave-chosen"
    )!;
    // 選択しなかったブレイヴは手札に残る。
    expect(firstAfter.zone).toBe("hand");
    // 選択したブレイヴだけがフィールドへ出る。
    expect(chosenAfter.zone).toBe("field");
    expect(after.pendingBraveCombineChoice).toMatchObject({
      braveInstanceId: "brave-chosen",
      hostCandidateInstanceIds: ["lucy-c04-combine-host"],
    });

    const combine = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (action) =>
        action.kind === "resolve_brave_combine_choice" &&
        action.chosenHostInstanceId === "lucy-c04-combine-host"
    );
    expect(combine).toBeDefined();

    const combined = applyLegalAction({
      state: after,
      action: combine!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(combined.pendingBraveCombineChoice).toBeNull();
    expect(
      combined.cardInstances.find((x) => x.instanceId === "brave-chosen")!
        .attachedToInstanceId
    ).toBe("lucy-c04-combine-host");
    expect(
      combined.cardInstances.find(
        (x) => x.instanceId === "lucy-c04-combine-host"
      )!.attachedChildrenIds
    ).toEqual(["brave-chosen"]);
  });

  it("[board] BSFT01-C04[5,6] effect summon 直接合体後もブレイヴ自身の召喚時効果を pending に積む", () => {
    const triggeredKeyBrave: CardDefinition = {
      cardNo: "TEST-C04-SUMMON-TRIGGER-KEY-BRAVE",
      name: "C04召喚時誘発鍵ブレイヴ",
      printedCategory: "brave",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "鍵",
      braveCondition: {
        categories: ["spirit"],
        cardNameContains: ["ルーシィ・ハートフィリア"],
      },
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const getDefWithTriggeredBrave = (
      id: string
    ): CardDefinition | undefined =>
      id === triggeredKeyBrave.cardNo ? triggeredKeyBrave : getDef(id);
    const c04 = createCardInstance(c, {
      instanceId: "c04-nexus-triggered-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const triggeredBrave = createCardInstance(triggeredKeyBrave, {
      instanceId: "triggered-key-brave",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-c04-trigger-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const triggeredLookup = buildTriggeredEffectLookup([
      ...ALL_CARDS,
      triggeredKeyBrave,
    ]);
    const after = executeEffect({
      chainId: "test:bsft01-cards:4913",
      state: createEmptyGameState({
        cardInstances: [c04, triggeredBrave, lucy],
      }),
      effect: c.effects![2]!,
      sourceInstanceId: "c04-nexus-triggered-brave",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithTriggeredBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      targetInstanceIds: ["triggered-key-brave"],
    });

    const combine = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithTriggeredBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "resolve_brave_combine_choice" &&
        action.chosenHostInstanceId === "lucy-c04-trigger-host"
    );
    expect(combine).toBeDefined();

    const combined = applyLegalAction({
      state: after,
      action: combine!,
      getCardDefinitionById: getDefWithTriggeredBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const summonPending = combined.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "summon" &&
        pending.relatedInstanceId === "triggered-key-brave"
    );
    expect(summonPending).toBeDefined();
    const pendingActions = getLegalActions({
      state: combined,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithTriggeredBrave,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(
      pendingActions.some(
        (action) =>
          (action.kind === "resolve_pending_triggered_effect" ||
            action.kind === "select_pending_to_resolve") &&
          action.pendingId === summonPending?.pendingId
      )
    ).toBe(true);
  });

  it("[board] BSFT01-C04[5,6] effect summon 直接合体後は CE/SBA 固定点で条件喪失ブレイヴを分離する", () => {
    const nameMaskingKeyBrave: CardDefinition = {
      cardNo: "TEST-C04-NAME-MASKING-KEY-BRAVE",
      name: "C04名称上書き鍵ブレイヴ",
      printedCategory: "brave",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "鍵",
      braveCondition: {
        categories: ["spirit"],
        cardNameContains: ["ルーシィ・ハートフィリア"],
      },
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { combined: true },
          steps: [
            {
              action: {
                kind: "override_properties",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {
                    category: ["spirit"],
                    cardName: { contains: "ルーシィ・ハートフィリア" },
                  },
                  count: "all",
                },
                properties: { cardName: "テスト非ルーシィ" },
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    };
    const getDefWithNameMaskingBrave = (
      id: string
    ): CardDefinition | undefined =>
      id === nameMaskingKeyBrave.cardNo ? nameMaskingKeyBrave : getDef(id);
    const c04 = createCardInstance(c, {
      instanceId: "c04-nexus-name-masking-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const incomingBrave = createCardInstance(nameMaskingKeyBrave, {
      instanceId: "name-masking-key-brave",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-c04-name-mask-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["existing-key-brave"],
    });
    const existingKeyBrave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "existing-key-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "lucy-c04-name-mask-host",
    });
    const after = executeEffect({
      chainId: "test:bsft01-cards:5039",
      state: createEmptyGameState({
        cardInstances: [c04, incomingBrave, lucy, existingKeyBrave],
      }),
      effect: c.effects![2]!,
      sourceInstanceId: "c04-nexus-name-masking-brave",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNameMaskingBrave,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["name-masking-key-brave"],
    });

    const combine = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithNameMaskingBrave,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (action) =>
        action.kind === "resolve_brave_combine_choice" &&
        action.chosenHostInstanceId === "lucy-c04-name-mask-host"
    );
    expect(combine).toBeDefined();

    let combined = applyLegalAction({
      state: after,
      action: combine!,
      getCardDefinitionById: getDefWithNameMaskingBrave,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    combined = chooseRuleBraveCores(
      combined,
      getDefWithNameMaskingBrave,
      "name-masking-key-brave"
    );
    combined = chooseRuleBraveCores(
      combined,
      getDefWithNameMaskingBrave,
      "existing-key-brave"
    );
    const hostAfter = combined.cardInstances.find(
      (x) => x.instanceId === "lucy-c04-name-mask-host"
    )!;
    const existingAfter = combined.cardInstances.find(
      (x) => x.instanceId === "existing-key-brave"
    )!;

    expect(hostAfter.attachedChildrenIds).not.toContain("existing-key-brave");
    expect(existingAfter.attachedToInstanceId).toBeNull();
  });

  it("[5,6] per_card_name turn-once: 1 回使用後、同ターン同名は不可・ターン経過でリセット", () => {
    // 〔ターンに1回:同名〕の usageLimit が正しく triggered registration に乗っていることを
    // canUseEffectByUsageLimit / recordEffectUsageIfLimited で検証する。誤払戻しが起きると
    // 1 ターンに 2 回鍵ブレイヴが出てしまうため、verifier 2026-06-23 lens 5 をカバーする。
    const trig = c.effects![2]!;
    const usageLimit = trig.usageLimit!;
    const definitionId = "BSFT01-C04";
    const sourceInstanceId = "c04-nexus";
    // getStableEffectLabel("triggered", 0, {effectIndex:2}) = "effect:2"。
    // effectIndex 付き registration では fallback prefix:index でなく effect:N に統一される
    // (legal-actions-shared.ts:2900-2902、triggered/battle_immediate で共通)。
    const effectLabel = "effect:2";
    let state = createEmptyGameState({});
    state = { ...state, turnNumber: 1 };
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
      })
    ).toBe(true);
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId,
      sourceDefinitionId: definitionId,
      effectLabel,
      usageLimit,
    });
    // 同ターン 2 回目は不可（per_card_name turn）。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
      })
    ).toBe(false);
    // 別個体 (同名) も per_card_name turn でブロックされる。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "c04-nexus-other",
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
      })
    ).toBe(false);
    // ターン経過でリセット。
    state = { ...state, turnNumber: 2 };
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
      })
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// CX01 ルーシィ・ハートフィリア — 条件付き召喚/鍵マジック化 + 星霊衣 partial 実装
// ════════════════════════════════════════════════════════════════

describe("BSFT01-CX01 ルーシィ・ハートフィリア", () => {
  const c = card("BSFT01-CX01");
  it("鍵カード使用後の魂状態召喚、鍵マジック化、星霊衣 S1/S4 を DSL action として持つ", () => {
    expect(c.effects).toHaveLength(6);
    // [0] 鍵カード使用後、軽減前コストを1に上書きして召喚
    expect(c.effects![0]!.textRef).toEqual([0]);
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.timing).toEqual({
      kind: "game_event",
      event: "card_used",
      player: "self",
      triggerSourceFilter: { tribes: ["鍵"] },
    });
    expect(c.effects![0]!.applicability).toEqual({ zone: "soul_state" });
    expect(c.effects![0]!.executionMode).toBe("optional");
    expect(c.effects![0]!.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: { override: 1 },
    });
    // [2,3] 鍵カード/ブレイヴのマジック化使用
    expect(c.effects![1]!.textRef).toEqual([2, 3]);
    expect(c.effects![1]!.stub).toBeUndefined();
    expect(c.effects![1]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
      maxCountAdditionalDynamic: {
        source: { kind: "count_value", player: "self" },
        divisor: 4,
      },
    });
    expect(c.effects![1]!.limitGroupId).toBe("BSFT01-CX01-key-magic-use");
    expect(c.effects![1]!.steps.map((step) => step.action.kind)).toEqual([
      "override_properties",
      "cost_modify",
    ]);
    // [5,6] 星霊衣 host-subcard: S1 配置 / S4 入替は
    // 【スピリット】Lv1-Lv2 / 【魂状態】の OR を effect 分割で配線済み。
    for (const effectIndex of [2, 3, 4, 5]) {
      expect(c.effects![effectIndex]!.timing).toEqual({
        kind: "activated",
        mode: "flash",
      });
      expect(c.effects![effectIndex]!.activationLabel).toBe("none");
    }
    expect(c.effects![2]!.textRef).toEqual([5, 6]);
    expect(c.effects![2]!.applicability).toEqual({
      level: { min: 1, max: 2 },
      soulState: false,
    });
    expect(c.effects![2]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "game",
      maxCount: 1,
      maxCountOverrides: [
        {
          when: [{ kind: "count_value", player: "self", min: 5 }],
          maxCount: 2,
        },
      ],
    });
    expect(c.effects![2]!.limitGroupId).toBe("BSFT01-CX01-star-garment-place");
    expect(c.effects![2]!.steps[0]!.action.kind).toBe("place_star_garment");
    expect(c.effects![2]!.steps[0]!.action.target).toMatchObject({
      filter: { category: ["brave"], soulState: "include" },
    });
    expect(c.effects![3]!.textRef).toEqual([5, 6]);
    expect(c.effects![3]!.applicability).toEqual({
      soulState: true,
    });
    expect(c.effects![3]!.usageLimit).toEqual(c.effects![2]!.usageLimit);
    expect(c.effects![3]!.limitGroupId).toBe(c.effects![2]!.limitGroupId);
    expect(c.effects![3]!.steps[0]!.action.kind).toBe("place_star_garment");
    expect(c.effects![3]!.steps[0]!.action.target).toMatchObject({
      filter: { category: ["brave"], soulState: "include" },
    });
    expect(c.effects![4]!.textRef).toEqual([6]);
    expect(c.effects![4]!.applicability).toEqual({
      level: { min: 1, max: 2 },
      soulState: false,
    });
    expect(c.effects![4]!.steps[0]!.action.kind).toBe("swap_star_garment");
    expect(c.effects![5]!.textRef).toEqual([6]);
    expect(c.effects![5]!.applicability).toEqual({
      soulState: true,
    });
    expect(c.effects![5]!.steps[0]!.action.kind).toBe("swap_star_garment");
    expect(c.keywordTags).toContain("contract");
    expect(c.keywordTags).toContain("star_garment");
    expect(c.keywordTags).toContain("soul_state");
  });

  it("[board] BSFT01-CX01[0]: 鍵カード使用後、魂状態からの効果召喚は追加コストも支払う", () => {
    const lucy = createCardInstance(c, {
      instanceId: "cx01-soul-permission",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      minimumRequiredCores: 0,
      attachedChildrenIds: ["cx01-soul-permission-key-brave"],
    });
    const inheritedKeyBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "cx01-soul-permission-key-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "cx01-soul-permission",
      normalCoreCount: 0,
      minimumRequiredCores: 0,
    });
    const keySpiritDefinition: CardDefinition = {
      cardNo: "TEST-KEY-SPIRIT",
      name: "テスト鍵スピリット",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["guide"],
      textLines: [],
      tribe: "鍵",
      keywordTags: [],
      rarity: "C",
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const lookup = (id: string): CardDefinition =>
      id === keySpiritDefinition.cardNo ? keySpiritDefinition : card(id);
    const handActivatedLookup = buildHandActivatedEffectLookup(ALL_CARDS);
    const keyUsageSource = createCardInstance(keySpiritDefinition, {
      instanceId: "used-key-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const opponentEffectSummonTax = createCardInstance(card("BSTH02-C02"), {
      instanceId: "cx01-opponent-effect-summon-tax",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState: GameState = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [
            lucy,
            inheritedKeyBrave,
            keyUsageSource,
            opponentEffectSummonTax,
          ],
          playerOverrides: [
            {
              deck: [],
              hand: [],
              handCount: 1,
              life: [],
              reserveNormalCoreCount: 6,
              trash: [],
              removedFromGame: [],
              setAside: [],
              burst: null,
              soulCore: null,
              countValue: 0,
              soulStateInstanceIds: ["cx01-soul-permission"],
            },
            {
              deck: [],
              hand: [],
              handCount: 0,
              life: [],
              reserve: [],
              trash: [],
              removedFromGame: [],
              setAside: [],
              burst: null,
              soulCore: null,
              countValue: 0,
              soulStateInstanceIds: [],
            },
          ],
        }),
        activePlayerId: ALICE,
        step: "main",
      },
      lookup
    );

    expect(
      getLegalActions({
        state: baseState,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredHandActivatedEffectActions: handActivatedLookup,
        getRegisteredBurstActions: () => undefined,
      }).some(
        (action) =>
          action.kind === "use_hand_card_effect" &&
          action.sourceInstanceId === "cx01-soul-permission"
      )
    ).toBe(false);

    const keySummonAction = getLegalActions({
      state: baseState,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (legalAction) =>
        legalAction.kind === "summon" &&
        legalAction.sourceInstanceId === "used-key-card"
    );
    expect(keySummonAction).toBeDefined();
    if (!keySummonAction || keySummonAction.kind !== "summon") {
      throw new Error("missing key summon action");
    }

    const afterKeyUseDeclared = applyLegalAction({
      state: baseState,
      action: keySummonAction,
      paymentSources: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;
    expect(afterKeyUseDeclared.flashCardUsageLog).toContainEqual(
      expect.objectContaining({
        playerId: ALICE,
        cardInstanceId: "used-key-card",
        cardDefinitionId: "TEST-KEY-SPIRIT",
        mode: "play",
        completion: "declared",
      })
    );
    const passKeySummonStack = getLegalActions({
      state: afterKeyUseDeclared,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    }).find((legalAction) => legalAction.kind === "pass_stack");
    expect(passKeySummonStack).toBeDefined();
    if (!passKeySummonStack) {
      throw new Error("missing key summon pass stack action");
    }
    const afterKeyUseStackResolved = applyLegalAction({
      state: afterKeyUseDeclared,
      action: passKeySummonStack,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(afterKeyUseStackResolved.flashCardUsageLog).toContainEqual(
      expect.objectContaining({
        playerId: ALICE,
        cardInstanceId: "used-key-card",
        cardDefinitionId: "TEST-KEY-SPIRIT",
        mode: "play",
        completion: "completed",
      })
    );
    expect(afterKeyUseStackResolved.pendingEnterFieldPlacement).toBeNull();
    expect(
      afterKeyUseStackResolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "used-key-card"
      )
    ).toMatchObject({
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const afterKeyUse = afterKeyUseStackResolved;
    const afterKeyUseMainWindow: GameState = {
      ...afterKeyUse,
      step: "main",
      window: "none",
      activePlayerId: ALICE,
    };
    const afterKeyUseLegalActions = getLegalActions({
      state: afterKeyUseMainWindow,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    });
    const action = afterKeyUseLegalActions.find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_triggered_effect" &&
        legalAction.sourceInstanceId === "cx01-soul-permission"
    );
    expect(
      action,
      JSON.stringify(afterKeyUseMainWindow.pendingTriggeredEffects)
    ).toBeDefined();
    if (!action || action.kind !== "resolve_pending_triggered_effect") {
      throw new Error("missing card_used triggered effect action");
    }
    expect(
      afterKeyUseLegalActions.some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "cx01-soul-permission"
      )
    ).toBe(false);

    const declared = applyLegalAction({
      state: afterKeyUseMainWindow,
      action,
      actingPlayerId: ALICE,
      skipOptionalEffect: false,
      deferPayCostSourceSelection: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: () => undefined,
    });
    expect(declared.state.window).toBe("stack");
    expect(declared.state.players[0]!.soulStateInstanceIds).toEqual([
      "cx01-soul-permission",
    ]);
    expect([...getEffectiveSoulStateIds(declared.state, lookup)]).toContain(
      "cx01-soul-permission-key-brave"
    );
    expect(
      declared.state.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "cx01-soul-permission-key-brave"
      )?.zone
    ).toBe("field");

    const passStack = getLegalActions({
      state: declared.state,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    }).find((legalAction) => legalAction.kind === "pass_stack");
    expect(passStack).toBeDefined();
    if (!passStack) throw new Error("missing pass stack action");

    const resolvedStack = applyLegalAction({
      state: declared.state,
      action: passStack,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: () => undefined,
    }).state;
    // 本文が指定する「コスト1」は同色の導シンボルで0まで軽減されるが、
    // 相手 BSTH02-C02 の「効果でスピリットを召喚するとき」追加3コストは残る。
    expect(resolvedStack.pendingEffectSummonCostPayment).toMatchObject({
      requiredCost: 3,
      summonTargetInstanceId: "cx01-soul-permission",
    });
    const summonPayment = getLegalActions({
      state: resolvedStack,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_effect_summon_cost_payment"
    );
    expect(summonPayment).toBeDefined();
    if (!summonPayment) throw new Error("missing soul-state summon payment");
    const afterCostPayment = applyLegalAction({
      state: resolvedStack,
      action: summonPayment,
      actingPlayerId: ALICE,
      summonPaymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(afterCostPayment.pendingEffectSummonCostPayment).toBeNull();
    expect(afterCostPayment.pendingMultiPlacement).toMatchObject({
      sourceInstanceId: "cx01-soul-permission",
    });
    const enterFieldPlacement = getLegalActions({
      state: afterCostPayment,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (legalAction) => legalAction.kind === "resolve_pending_multi_placement"
    );
    expect(enterFieldPlacement).toBeDefined();
    if (!enterFieldPlacement) throw new Error("missing soul-state placement");
    const finalState = applyLegalAction({
      state: afterCostPayment,
      action: enterFieldPlacement,
      actingPlayerId: ALICE,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "cx01-soul-permission",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions: handActivatedLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(finalState.pendingMultiPlacement).toBeNull();
    expect(finalState.players[0]!.soulStateInstanceIds).toEqual([]);
    expect([...getEffectiveSoulStateIds(finalState, lookup)]).not.toContain(
      "cx01-soul-permission-key-brave"
    );
    expect(
      finalState.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "cx01-soul-permission-key-brave"
      )?.zone
    ).toBe("field");
    const summoned = finalState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "cx01-soul-permission"
    );
    expect(summoned).toMatchObject({
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    expect(
      finalState.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "cx01-soul-permission-key-brave"
      )
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: "cx01-soul-permission",
    });
    // 鍵スピリットの最低Lv配置で 6→5、CX01 の追加コスト3と最低Lv配置1で 5→1。
    expect(finalState.players[0]!.reserveNormalCoreCount).toBe(1);
  });

  it("星霊衣の配置は個体ごとゲーム中1回で、同一個体の魂状態・スピリット状態で共有する", () => {
    const usageLimit = c.effects![2]!.usageLimit!;
    const groupId = c.effects![2]!.limitGroupId!;
    const definitionId = "BSFT01-CX01";
    const spiritEffectLabel = "spirit:0";
    const soulEffectLabel = "spirit:1";
    const aliceSourceInstanceId = "cx01-alice";
    const aliceOtherSourceInstanceId = "cx01-alice-other";
    const bobSourceInstanceId = "cx01-bob";
    const aliceSource = createCardInstance(c, {
      instanceId: aliceSourceInstanceId,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceOtherSource = createCardInstance(c, {
      instanceId: aliceOtherSourceInstanceId,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const bobSource = createCardInstance(c, {
      instanceId: bobSourceInstanceId,
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    let state = createEmptyGameState({
      cardInstances: [aliceSource, aliceOtherSource, bobSource],
    });

    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: aliceSourceInstanceId,
      sourceDefinitionId: definitionId,
      effectLabel: spiritEffectLabel,
      usageLimit,
      groupId,
    });

    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: aliceSourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel: soulEffectLabel,
        usageLimit,
        groupId,
      })
    ).toBe(false);
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: aliceOtherSourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel: soulEffectLabel,
        usageLimit,
        groupId,
      })
    ).toBe(true);
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: bobSourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel: soulEffectLabel,
        usageLimit,
        groupId,
      })
    ).toBe(true);
  });

  it("星霊衣の配置はカウント5以上なら個体ごとゲーム中2回まで使える", () => {
    const usageLimit = c.effects![2]!.usageLimit!;
    const groupId = c.effects![2]!.limitGroupId!;
    const definitionId = "BSFT01-CX01";
    const effectLabel = "spirit:0";
    const sourceInstanceId = "cx01-alice";
    const source = createCardInstance(c, {
      instanceId: sourceInstanceId,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      cardInstances: [source],
    });
    const count4State: GameState = {
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === ALICE ? { ...player, countValue: 4 } : player
      ),
    };
    const count5State: GameState = {
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === ALICE ? { ...player, countValue: 5 } : player
      ),
    };

    const usedOnceAtCount4 = recordEffectUsageIfLimited({
      state: count4State,
      sourceInstanceId,
      sourceDefinitionId: definitionId,
      effectLabel,
      usageLimit,
      groupId,
    });
    expect(
      canUseEffectByUsageLimit({
        state: usedOnceAtCount4,
        sourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
        groupId,
      })
    ).toBe(false);

    const usedOnceAtCount5 = recordEffectUsageIfLimited({
      state: count5State,
      sourceInstanceId,
      sourceDefinitionId: definitionId,
      effectLabel,
      usageLimit,
      groupId,
    });
    expect(
      canUseEffectByUsageLimit({
        state: usedOnceAtCount5,
        sourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
        groupId,
      })
    ).toBe(true);

    const usedTwiceAtCount5 = recordEffectUsageIfLimited({
      state: usedOnceAtCount5,
      sourceInstanceId,
      sourceDefinitionId: definitionId,
      effectLabel,
      usageLimit,
      groupId,
    });
    expect(
      canUseEffectByUsageLimit({
        state: usedTwiceAtCount5,
        sourceInstanceId,
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
        groupId,
      })
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// TR01 宝瓶宮の鍵 — front: 鍵nature/フラッシュ保護/rebirth-or-combine / back: 星霊衣/転醒時デッキ下
// （flip 時カウント+1 はルール: executeRebirth が適用、effects に持たない）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR01 宝瓶宮の鍵 / アクエリアス", () => {
  const c = card("BSFT01-TR01(A)");

  it("front 2効果: 鍵nature / フラッシュ無効化耐性 + nexus/ultimate 防止貫通 + rebirth_window + combine_window", () => {
    expect(c.effects).toHaveLength(2);
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.textRef).toEqual([4, 5, 7, 8]);

    const body = flash.steps[0]!;
    expect(body.id).toBe("flash_body");
    expect(body.action.kind).toBe("grant_effect_source_prevention_immunity");
    if (body.action.kind === "grant_effect_source_prevention_immunity") {
      expect(body.action.player).toBe("self");
      expect(body.action.sourceScope).toEqual({ tribes: ["星霊", "鍵"] });
      expect(body.action.appliesTo).toEqual(["stack_negate", "prevention"]);
      expect(body.action.preventionBypass).toEqual({
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus", "ultimate"] },
      });
      expect("targetLockBypass" in body.action).toBe(false);
      expect(body.action.duration).toEqual({ scope: "turn" });
    }

    const rebirth = flash.steps.find((s) => s.id === "rebirth_window")!;
    expect(rebirth.connector).toBe("after_triggers");
    expect(rebirth.stepCondition).toBeUndefined();
    expect(rebirth.condition).toEqual([
      { kind: "life_value", player: "self", min: 1 },
    ]);
    expect(rebirth.executionMode).toBe("optional");
    expect(rebirth.action.kind).toBe("rebirth");
    if (rebirth.action.kind === "rebirth") {
      expect(rebirth.action.separatesFromHost).toBe(true);
    }

    const combine = flash.steps.find((s) => s.id === "combine_window")!;
    expect(combine.action.kind).toBe("brave_combine_effect");
    if (combine.action.kind === "brave_combine_effect") {
      expect(combine.action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {
          category: ["spirit"],
          cardName: { contains: "ルーシィ・ハートフィリア" },
        },
        count: 1,
      });
    }
    expect(combine.stepCondition).toEqual({
      kind: "all",
      conditions: [
        { kind: "ref_executed", stepId: "rebirth_window", not: true },
      ],
    });
    expect(combine.condition).toEqual([
      { kind: "life_value", player: "self", min: 1 },
    ]);
    expect(
      flash.steps.some(
        (s) =>
          s.action.kind === "core_distribute" &&
          typeof s.action.to === "object" &&
          s.action.to !== null &&
          "kind" in s.action.to &&
          s.action.to.kind === "source_card"
      )
    ).toBe(false);
    expect(
      flash.steps.some(
        (s) =>
          s.action.kind === "core_distribute" &&
          s.stepCondition?.kind === "ref_succeeded" &&
          s.stepCondition.stepId === "combine_window" &&
          typeof s.action.to === "object" &&
          s.action.to !== null &&
          "kind" in s.action.to &&
          s.action.to.kind === "ref" &&
          s.action.to.stepId === "combine_window"
      )
    ).toBe(false);
    expect(
      flash.steps.filter((s) => s.action.kind === "core_distribute")
    ).toHaveLength(0);
  });

  it("[board] front フラッシュ保護: 自分の星霊/鍵効果を無効化されなくする CE を登録し、転醒許可窓を開く", () => {
    const brave = createCardInstance(c, {
      instanceId: "aquarius-key-tr01a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const fieldCoreSource = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-rebirth-core-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, fieldCoreSource],
      playerOverrides: [
        { lifeNormalCoreCount: 1, reserveNormalCoreCount: 0 },
        {},
      ],
    });

    const after = runEffect(before, c.effects![1]!, "aquarius-key-tr01a");
    const ce = after.activeContinuousEffects.find(
      (entry) => entry.modifierTag === "effect_source_prevention_immunity"
    )!;
    expect(ce).toBeDefined();
    expect(ce.targetInstanceId).toBe(ALICE);
    expect((ce.metadata as { tribes?: string[] }).tribes).toEqual([
      "星霊",
      "鍵",
    ]);
    expect(
      (ce.metadata as { appliesTo?: readonly string[] }).appliesTo
    ).toEqual(["stack_negate", "prevention"]);
    expect(
      (
        ce.metadata as {
          preventionBypass?: {
            kind: string;
            filter?: { categories?: readonly string[] };
          };
        }
      ).preventionBypass
    ).toEqual({
      kind: "preventing_effect_filter",
      filter: { categories: ["nexus", "ultimate"] },
    });
    expect(after.pendingStepOptionalChoice?.sourceInstanceId).toBe(
      "aquarius-key-tr01a"
    );
    expect(after.pendingStepOptionalChoice?.stepLabel).toBe("rebirth_window");
  });

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ send_to_deck を通す",
    (blockerDefinitionId, shouldPierce) => {
      const source = createCardInstance(c, {
        instanceId: `aquarius-key-tr01a-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const target = createCardInstance(card("BSFT01-CX01"), {
        instanceId: `protected-lucy-${blockerDefinitionId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, target],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          {},
        ],
      });
      const withGrant = runEffect(before, c.effects![1]!, source.instanceId);
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-send-to-deck-guard-${blockerDefinitionId}`,
            sourceInstanceId: `guard-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "cannot_be_sent_to_deck",
            targetInstanceId: target.instanceId,
            metadata: { source: "opponent_effect" },
          },
        ],
      };
      const sendToDeckEffect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
      };

      const after = executeEffect({
        chainId: "test:bsft01-cards:6002",
        state: protectedState,
        effect: sendToDeckEffect,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        targetInstanceIds: [target.instanceId],
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const finalState = shouldPierce
        ? flushPendingLeaves(after, getDef)
        : after;
      const afterTarget = finalState.cardInstances.find(
        (entry) => entry.instanceId === target.instanceId
      );
      expect(afterTarget?.zone).toBe(shouldPierce ? "deck" : "field");
      expect(
        after.log.some((entry) =>
          entry.includes(
            `effect:send_to_deck:blocked-by-resistance:${ALICE}:${target.instanceId}`
          )
        )
      ).toBe(!shouldPierce);
    }
  );

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ search_zone(trash→hand) を通す",
    (blockerDefinitionId, shouldPierce) => {
      const grantSource = createCardInstance(c, {
        instanceId: `aquarius-key-grant-trash-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const searchSource = createCardInstance(card("BSFT01-TR13(A)"), {
        instanceId: `crux-key-search-trash-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const trashTarget = createCardInstance(c, {
        instanceId: `trash-key-target-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [grantSource, searchSource, trashTarget],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          {},
        ],
      });
      const withGrant = runEffect(
        before,
        c.effects![1]!,
        grantSource.instanceId
      );
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-return-from-trash-guard-${blockerDefinitionId}`,
            sourceInstanceId: `trash-guard-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "cannot_be_bounced",
            targetInstanceId: trashTarget.instanceId,
            metadata: { source: "all" },
          },
        ],
      };
      const searchTrashEffect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { category: ["brave"], tribesRequired: ["光導", "鍵"] },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
      };

      const after = executeEffect({
        chainId: "test:bsft01-cards:6107",
        state: protectedState,
        effect: searchTrashEffect,
        sourceInstanceId: searchSource.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const afterTarget = after.cardInstances.find(
        (entry) => entry.instanceId === trashTarget.instanceId
      );
      expect(afterTarget?.zone).toBe(shouldPierce ? "hand" : "trash");
    }
  );

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ trash effect_immunity を通す",
    (blockerDefinitionId, shouldPierce) => {
      const grantSource = createCardInstance(c, {
        instanceId: `aquarius-key-grant-trash-immunity-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const searchSource = createCardInstance(card("BSFT01-TR13(A)"), {
        instanceId: `crux-key-search-trash-immunity-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const trashTarget = createCardInstance(c, {
        instanceId: `trash-key-immunity-target-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [grantSource, searchSource, trashTarget],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          {},
        ],
      });
      const withGrant = runEffect(
        before,
        c.effects![1]!,
        grantSource.instanceId
      );
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-trash-effect-immunity-${blockerDefinitionId}`,
            sourceInstanceId: `trash-immunity-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "defense_immune",
            targetInstanceId: trashTarget.instanceId,
            immunityPlayerScope: "any",
          },
        ],
      };
      const searchTrashEffect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { category: ["brave"], tribesRequired: ["光導", "鍵"] },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
      };

      const after = executeEffect({
        chainId: "test:bsft01-cards:6201",
        state: protectedState,
        effect: searchTrashEffect,
        sourceInstanceId: searchSource.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const afterTarget = after.cardInstances.find(
        (entry) => entry.instanceId === trashTarget.instanceId
      );
      expect(afterTarget?.zone).toBe(shouldPierce ? "hand" : "trash");
    }
  );

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ effect_immunity を通す",
    (blockerDefinitionId, shouldPierce) => {
      const source = createCardInstance(c, {
        instanceId: `aquarius-key-immunity-source-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const target = createCardInstance(card("BSFT01-CX01"), {
        instanceId: `immune-lucy-target-${blockerDefinitionId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, target],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          {},
        ],
      });
      const withGrant = runEffect(before, c.effects![1]!, source.instanceId);
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-defense-immune-${blockerDefinitionId}`,
            sourceInstanceId: `immunity-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "defense_immune",
            targetInstanceId: target.instanceId,
          },
        ],
      };
      const sendToDeckEffect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
      };

      const after = executeEffect({
        chainId: "test:bsft01-cards:6284",
        state: protectedState,
        effect: sendToDeckEffect,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        targetInstanceIds: [target.instanceId],
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const finalState = shouldPierce
        ? flushPendingLeaves(after, getDef)
        : after;
      const afterTarget = finalState.cardInstances.find(
        (entry) => entry.instanceId === target.instanceId
      );
      expect(afterTarget?.zone).toBe(shouldPierce ? "deck" : "field");
    }
  );

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ cannot_be_exhausted を通す",
    (blockerDefinitionId, shouldPierce) => {
      const source = createCardInstance(c, {
        instanceId: `aquarius-key-exhaust-source-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const target = createCardInstance(card("BSFT01-CX01"), {
        instanceId: `exhaust-lucy-target-${blockerDefinitionId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        exhaustState: "recovered",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, target],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          {},
        ],
      });
      const withGrant = runEffect(before, c.effects![1]!, source.instanceId);
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-cannot-exhaust-${blockerDefinitionId}`,
            sourceInstanceId: `exhaust-guard-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "cannot_be_exhausted",
            targetInstanceId: target.instanceId,
            metadata: { source: "opponent_effect" },
          },
        ],
      };
      const exhaustEffect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
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
        ],
      };

      const after = executeEffect({
        chainId: "test:bsft01-cards:6372",
        state: protectedState,
        effect: exhaustEffect,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        targetInstanceIds: [target.instanceId],
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const afterTarget = after.cardInstances.find(
        (entry) => entry.instanceId === target.instanceId
      );
      expect(afterTarget?.exhaustState).toBe(
        shouldPierce ? "exhausted" : "recovered"
      );
      expect(
        after.log.some((entry) =>
          entry.includes(
            `effect:exhaust:blocked-by-resistance:${ALICE}:${target.instanceId}`
          )
        )
      ).toBe(!shouldPierce);
    }
  );

  it.each([["BSFT01-C03"], ["BSFT01-X01"], ["BSFT01-CX01"]] as const)(
    "[board] BSFT01-TR01(A) の通常防止貫通は防止元 %s の target-lock 候補列挙を貫通しない",
    (blockerDefinitionId) => {
      const grantSource = createCardInstance(c, {
        instanceId: `aquarius-key-target-lock-grant-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const effectSource = createCardInstance(card("BSFT01-C02"), {
        instanceId: `lucy-kick-target-lock-source-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "in_use",
        zoneRoleName: "magic",
        normalCoreCount: 0,
      });
      const target = createCardInstance(card("BSDB01-C05"), {
        instanceId: `target-locked-spirit-${blockerDefinitionId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [grantSource, effectSource, target],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          {},
        ],
      });
      const withGrant = runEffect(
        before,
        c.effects![1]!,
        grantSource.instanceId
      );
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-target-lock-${blockerDefinitionId}`,
            sourceInstanceId: `target-lock-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "cannot_be_targeted",
            targetInstanceId: target.instanceId,
          },
        ],
      };

      // P3-105: 通常の「防げない」rider は target lock を貫通しない。
      const candidates = getCandidateTargetInstanceIds(
        protectedState,
        ALICE,
        {
          candidateTargetPlayerScope: "opponent",
          targetCardFilter: { category: ["spirit"] },
          targetCardFilterActionKind: "destroy",
        },
        {
          getCardDefinitionById: getDef,
          sourceInstanceId: effectSource.instanceId,
        }
      );
      expect(candidates).toEqual([]);
    }
  );

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ core minimum を通す",
    (blockerDefinitionId, shouldPierce) => {
      const grantSource = createCardInstance(c, {
        instanceId: `aquarius-key-core-grant-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const effectSource = createCardInstance(card("BSFT01-C02"), {
        instanceId: `lucy-kick-core-source-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "in_use",
        zoneRoleName: "magic",
        normalCoreCount: 0,
      });
      const target = createCardInstance(card("BSFT01-CX01"), {
        instanceId: `core-protected-lucy-${blockerDefinitionId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 2,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [grantSource, effectSource, target],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          { reserveNormalCoreCount: 0 },
        ],
      });
      const withGrant = runEffect(
        before,
        c.effects![1]!,
        grantSource.instanceId
      );
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-core-min-${blockerDefinitionId}`,
            sourceInstanceId: `core-min-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "cannot_reduce_cores_below",
            targetInstanceId: target.instanceId,
            metadata: { source: "opponent_effect", coreMinimum: 2 },
          },
        ],
      };
      const coreMoveEffect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      };

      const after = executeEffect({
        chainId: "test:bsft01-cards:6557",
        state: protectedState,
        effect: coreMoveEffect,
        sourceInstanceId: effectSource.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const afterTarget = after.cardInstances.find(
        (entry) => entry.instanceId === target.instanceId
      );
      expect(afterTarget?.normalCoreCount).toBe(shouldPierce ? 1 : 2);
    }
  );

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ bp_compare_destroy 耐性を通す",
    (blockerDefinitionId, shouldPierce) => {
      const grantSource = createCardInstance(c, {
        instanceId: `aquarius-key-bpc-grant-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const effectSource = createCardInstance(card("BSFT01-C02"), {
        instanceId: `lucy-kick-bpc-source-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "in_use",
        zoneRoleName: "magic",
        normalCoreCount: 0,
      });
      const comparer = createCardInstance(card("BSFT01-CX01"), {
        instanceId: `lucy-bpc-comparer-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 2,
      });
      const target = createCardInstance(card("BSDB01-C05"), {
        instanceId: `bpc-protected-target-${blockerDefinitionId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [grantSource, effectSource, comparer, target],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
          {},
        ],
      });
      const withGrant = runEffect(
        before,
        c.effects![1]!,
        grantSource.instanceId
      );
      const protectedState: GameState = {
        ...withGrant,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...withGrant.activeContinuousEffects,
          {
            effectId: `test-bsft01-tr01a-bpc-${blockerDefinitionId}`,
            sourceInstanceId: `bpc-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: withGrant.turnNumber,
            createdAtAttackId: null,
            modifierTag: "cannot_be_destroyed_by_bp_compare",
            targetInstanceId: target.instanceId,
            metadata: { source: "opponent_effect" },
          },
        ],
      };
      const bpCompareEffect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "bp_compare_destroy",
              comparer: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  cardName: [{ contains: "ルーシィ" }],
                },
                count: 1,
              },
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      };

      const after = executeEffect({
        chainId: "test:bsft01-cards:6669",
        state: protectedState,
        effect: bpCompareEffect,
        sourceInstanceId: effectSource.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        targetInstanceIds: [target.instanceId],
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const afterTarget = after.cardInstances.find(
        (entry) => entry.instanceId === target.instanceId
      );
      expect(afterTarget?.pendingLeaveKind).toBe(
        shouldPierce ? "destroy" : null
      );
    }
  );

  it("[board] front フラッシュ保護: ライフ0なら転醒/合体の許可窓を開かない", () => {
    const brave = createCardInstance(c, {
      instanceId: "aquarius-key-tr01a-life0",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-life0-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, lucy],
      playerOverrides: [
        {
          lifeNormalCoreCount: 0,
          reserveNormalCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const after = runEffect(before, c.effects![1]!, "aquarius-key-tr01a-life0");

    expect(after.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] front フラッシュ保護: 合体分岐後は合体先ホストへ任意コア配置 pending を開かない", () => {
    const brave = createCardInstance(c, {
      instanceId: "aquarius-key-tr01a-combine",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-combine-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, lucy],
      playerOverrides: [
        { lifeNormalCoreCount: 1, reserveNormalCoreCount: 1 },
        {},
      ],
    });

    const afterBody = runEffect(
      before,
      c.effects![1]!,
      "aquarius-key-tr01a-combine"
    );
    const rebirthPending = afterBody.pendingStepOptionalChoice!;
    const afterDeclineRebirth = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${rebirthPending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: rebirthPending.actingPlayerId,
        pendingId: rebirthPending.pendingId,
        sourceInstanceId: rebirthPending.sourceInstanceId,
        effectIndex: rebirthPending.effectIndex,
        stepIndex: rebirthPending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(afterDeclineRebirth.pendingStepOptionalChoice?.stepLabel).toBe(
      "combine_window"
    );

    const combinePending = afterDeclineRebirth.pendingStepOptionalChoice!;
    const afterCombine = applyLegalAction({
      state: afterDeclineRebirth,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${combinePending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: combinePending.actingPlayerId,
        pendingId: combinePending.pendingId,
        sourceInstanceId: combinePending.sourceInstanceId,
        effectIndex: combinePending.effectIndex,
        stepIndex: combinePending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(
      afterCombine.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "aquarius-key-tr01a-combine"
      )?.attachedToInstanceId
    ).toBe("lucy-combine-host");
    expect(afterCombine.pendingCoreDistribution).toBeNull();
    expect(afterCombine.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] front フラッシュ保護: cannot_combine の in_use 鍵ブレイヴは合体窓の候補を出さない", () => {
    const noCombineSource: CardDefinition = {
      ...c,
      keywordTags: [...(c.keywordTags ?? []), "cannot_combine"],
    };
    const getNoCombineDef = (id: string): CardDefinition | undefined =>
      id === noCombineSource.cardNo ? noCombineSource : getDef(id);
    const brave = createCardInstance(c, {
      instanceId: "aquarius-key-tr01a-no-recombine",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      zoneRoleName: "brave",
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-no-recombine-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const beforeBase = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, lucy],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });
    const before: GameState = beforeBase;

    const combineStep = c.effects![1]!.steps!.find(
      (step) => step.id === "combine_window"
    )!;
    if (combineStep.action.kind !== "brave_combine_effect") {
      throw new Error("combine_window must be brave_combine_effect");
    }
    expect(
      getCandidateTargetInstanceIds(
        before,
        ALICE,
        {
          candidateTargetPlayerScope: "acting_player",
          targetCardFilter: combineStep.action.target.filter,
          braveCombineHostOnly: true,
        },
        {
          getCardDefinitionById: getNoCombineDef,
          sourceInstanceId: "aquarius-key-tr01a-no-recombine",
          sourceDefinition: noCombineSource,
        }
      )
    ).toEqual([]);

    const after = runEffect(
      before,
      c.effects![1]!,
      "aquarius-key-tr01a-no-recombine",
      getNoCombineDef
    );
    expect(after.pendingStepOptionalChoice?.stepLabel).toBe("rebirth_window");

    const rebirthPending = after.pendingStepOptionalChoice!;
    const afterDeclineRebirth = applyLegalAction({
      state: after,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${rebirthPending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: rebirthPending.actingPlayerId,
        pendingId: rebirthPending.pendingId,
        sourceInstanceId: rebirthPending.sourceInstanceId,
        effectIndex: rebirthPending.effectIndex,
        stepIndex: rebirthPending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: getNoCombineDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(afterDeclineRebirth.pendingStepOptionalChoice?.stepLabel).toBe(
      "combine_window"
    );
    expect(afterDeclineRebirth.pendingStepOptionalChoice?.canExecute).toBe(
      false
    );
    expect(afterDeclineRebirth.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      afterDeclineRebirth.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "aquarius-key-tr01a-no-recombine"
      )?.attachedToInstanceId
    ).toBeNull();
  });

  it("[board] front フラッシュ保護: use_magic パイプラインでは転醒許可窓の解決前に in_use cleanup しない", () => {
    const brave = createCardInstance(c, {
      instanceId: "aquarius-key-pipeline",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const fieldCoreSource = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-pipeline-core-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredBurstActions: noTriggerLookup,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, fieldCoreSource],
        playerOverrides: [
          {
            handCount: 1,
            reserveNormalCoreCount: 5,
            lifeNormalCoreCount: 1,
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "main_step",
    };

    const useMagic = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "aquarius-key-pipeline"
    );
    expect(useMagic).toBeDefined();
    if (!useMagic || useMagic.kind !== "use_magic") return;

    const afterUse = applyLegalAction({
      state,
      action: useMagic,
      paymentSources: [{ kind: "reserve", amount: useMagic.finalCost }],
      ...lookups,
    }).state;
    expect(afterUse.stackWindow).not.toBeNull();

    const pass = getLegalActions({
      state: afterUse,
      actingPlayerId: BOB,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;
    expect(afterPass.pendingStepOptionalChoice?.stepLabel).toBe(
      "rebirth_window"
    );
    expect(
      afterPass.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "aquarius-key-pipeline"
      )?.zone
    ).toBe("in_use");

    const pending = afterPass.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: afterPass,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;
    const reborn = afterExecute.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "aquarius-key-pipeline"
    )!;
    expect(reborn.zone).toBe("in_use");
    expect(reborn.definitionId).toBe("BSFT01-TR01(A)");
    expect(afterExecute.pendingCoreDistribution).toMatchObject({
      fromKind: "any_movable",
      hasSoulCore: false,
      candidates: [
        { instanceId: "aquarius-key-pipeline", definitionId: "BSFT01-TR01(B)" },
      ],
      rollbackIfBelowMinTotal: {
        minTotal: 1,
        reason: "rebirth_minimum_core",
      },
    });
    expect(afterExecute.pendingCoreDistribution?.minTotal).toBe(1);
    const coreAction = getLegalActions({
      state: afterExecute,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(coreAction).toBeDefined();
    const afterCore = applyLegalAction({
      state: afterExecute,
      action: coreAction!,
      coreDistributionAllocations: { "aquarius-key-pipeline": 1 },
      coreDistributionSourceAllocations: {
        "field:lucy-pipeline-core-source": 1,
      },
      ...lookups,
    }).state;
    expect(afterCore.pendingCoreDistribution).toBeNull();
    expect(
      afterCore.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "aquarius-key-pipeline"
      )
    ).toMatchObject({
      zone: "field",
      definitionId: "BSFT01-TR01(B)",
    });
    expect(
      afterCore.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(1);
    expect(
      afterCore.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "aquarius-key-pipeline"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      afterCore.log.some((entry) =>
        entry.includes(
          "magic:trash:magic:1:player-1:main:aquarius-key-pipeline"
        )
      )
    ).toBe(false);
  });

  it("[engine] in_use の TR01(A) は最低Lv補填を自動移動せず、後続 core_distribute に委ねる", () => {
    const source = createCardInstance(c, {
      instanceId: "aquarius-in-use",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const fieldCoreSource = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-core-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, fieldCoreSource],
      playerOverrides: [{ reserveNormalCoreCount: 0, countValue: 0 }, {}],
    });

    const after = executeRebirth(
      before,
      ALICE,
      {
        kind: "rebirth",
        maxCount: Number.POSITIVE_INFINITY,
        triggerDescription: "test",
        separatesFromHost: true,
      },
      "aquarius-in-use",
      getDef,
      "test:bsft01-cards:7084"
    );

    const reborn = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "aquarius-in-use"
    )!;
    const coreSource = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "lucy-core-source"
    )!;
    expect(reborn.zone).toBe("field");
    expect(reborn.definitionId).toBe("BSFT01-TR01(B)");
    expect(reborn.normalCoreCount).toBe(0);
    expect(coreSource.normalCoreCount).toBe(1);
    expect(
      after.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(1);
    expect(after.log.some((entry) => entry.includes(":lv-deficit:"))).toBe(
      false
    );
  });

  it("[engine] in_use の TR01(A) はリザーブのソウルコアだけでも転醒後コア配置 pending を解決できる", () => {
    const source = createCardInstance(c, {
      instanceId: "aquarius-in-use-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          countValue: 0,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const afterBody = runEffect(before, c.effects![1]!, "aquarius-in-use-soul");
    const pending = afterBody.pendingStepOptionalChoice!;
    const afterRebirth = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(afterRebirth.pendingCoreDistribution).toMatchObject({
      fromKind: "any_movable",
      totalNormalCores: 0,
      hasSoulCore: true,
      candidates: [
        { instanceId: "aquarius-in-use-soul", definitionId: "BSFT01-TR01(B)" },
      ],
      rollbackIfBelowMinTotal: {
        minTotal: 1,
        reason: "rebirth_minimum_core",
      },
    });
    expect(afterRebirth.pendingCoreDistribution?.minTotal).toBe(1);
    const coreActions = getLegalActions({
      state: afterRebirth,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      coreActions.some(
        (action) => action.kind === "abort_pending_core_distribution"
      )
    ).toBe(false);
    const coreAction = coreActions.find(
      (action) => action.kind === "resolve_pending_core_distribution"
    );
    expect(coreAction).toBeDefined();

    const afterDecline = applyLegalAction({
      state: afterRebirth,
      action: coreAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      coreDistributionAllocations: {},
    }).state;
    expect(afterDecline.pendingCoreDistribution).toBeNull();
    expect(
      afterDecline.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "aquarius-in-use-soul"
      )
    ).toMatchObject({
      zone: "in_use",
      definitionId: "BSFT01-TR01(A)",
      normalCoreCount: 0,
    });
    expect(
      afterDecline.players.find((player) => player.id === ALICE)
    ).toMatchObject({
      countValue: 0,
      soulCoreLocation: { kind: "reserve" },
    });
    expect(
      afterDecline.log.some(
        (entry) =>
          entry.includes("rebirth-post-choice-cancelled") &&
          entry.includes("reason=rebirth_minimum_core:placed=0<1")
      )
    ).toBe(true);

    const afterCore = applyLegalAction({
      state: afterRebirth,
      action: coreAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      coreDistributionAllocations: {},
      coreDistributionSoulCoreInstanceId: "aquarius-in-use-soul",
    }).state;
    expect(afterCore.pendingCoreDistribution).toBeNull();
    expect(
      afterCore.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "aquarius-in-use-soul"
      )
    ).toMatchObject({
      zone: "field",
      definitionId: "BSFT01-TR01(B)",
    });
    expect(
      afterCore.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(1);
    expect(
      afterCore.players.find((player) => player.id === ALICE)
    ).toMatchObject({
      soulCoreLocation: {
        kind: "card",
        instanceId: "aquarius-in-use-soul",
      },
    });
  });

  it("[engine] in_use の TR01(A) は最低コアを補填できないと転醒後0コアで表になり、カウントは増やさない", () => {
    const source = createCardInstance(c, {
      instanceId: "aquarius-in-use-no-core",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
      playerOverrides: [{ reserveNormalCoreCount: 0, countValue: 0 }, {}],
    });

    const after = executeRebirth(
      before,
      ALICE,
      {
        kind: "rebirth",
        maxCount: Number.POSITIVE_INFINITY,
        triggerDescription: "test",
        allowPostRebirthCorePlacementForLvDeficit: true,
      },
      "aquarius-in-use-no-core",
      getDef,
      "test:bsft01-cards:7262"
    );

    const rebirthed = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "aquarius-in-use-no-core"
    )!;
    expect(rebirthed.zone).toBe("field");
    expect(rebirthed.definitionId).toBe("BSFT01-TR01(B)");
    expect(rebirthed.normalCoreCount).toBe(0);
    expect(
      after.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(0);
    expect(after.log).toContain(
      "effect:rebirth:aquarius-in-use-no-core:completion-deferred:min=1:current=0"
    );
  });

  it("[engine] in_use の TR01(A) は合体分岐で field に戻り、合体先へ付く", () => {
    const brave = createCardInstance(c, {
      instanceId: "aquarius-combine-in-use",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, host],
    });

    const after = executeBraveCombine(
      before,
      ALICE,
      "aquarius-combine-in-use",
      "lucy-host",
      getDef
    );
    const combinedBrave = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "aquarius-combine-in-use"
    )!;
    const combinedHost = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "lucy-host"
    )!;
    expect(brave.zoneRoleName).toBe("brave-card");
    expect(combinedBrave.zone).toBe("field");
    expect(combinedBrave.zoneRoleName).toBe("brave");
    expect(combinedBrave.attachedToInstanceId).toBe("lucy-host");
    expect(combinedHost.attachedChildrenIds).toContain(
      "aquarius-combine-in-use"
    );
  });

  it("[engine] executeBraveCombine は合体条件を満たさない host では no-op", () => {
    const brave = createCardInstance(c, {
      instanceId: "aquarius-combine-invalid-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const nonLucyHost = createCardInstance(card("BSAZ01-C01"), {
      instanceId: "non-lucy-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, nonLucyHost],
    });

    const after = executeBraveCombine(
      before,
      ALICE,
      "aquarius-combine-invalid-host",
      "non-lucy-host",
      getDef
    );

    expect(after.cardInstances).toEqual(before.cardInstances);
  });

  it("back 3効果: 星霊衣stub / 1体制限stub / 転醒時send_to_deck（boilerplate count+1 は持たない）", () => {
    const back = c.backFace!;
    expect(back.effects).toHaveLength(3);
    // flip ルール文 (textLines[0]) の count_increase 効果化は禁止 (二重計上)。
    expect(
      back.effects!.some((e) =>
        e.steps.some((s) => s.action.kind === "count_increase")
      )
    ).toBe(false);
    const deck = back.effects![2]!;
    const action = deck.steps[0]!.action;
    expect(action.kind).toBe("send_to_deck");
    if (action.kind === "send_to_deck") {
      expect(action.position).toBe("bottom");
      if ("filter" in action.target) {
        expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      }
    }
  });

  it("[board] back 転醒時 send_to_deck: 相手スピリット1体がデッキ下へ移る", () => {
    const back = c.backFace!;
    const src = createCardInstance(c, {
      instanceId: "aquarius-tr01b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemy = createCardInstance(card(ENEMY_CARD), {
      instanceId: "enemy-tr01b",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({ cardInstances: [src, enemy] });
    const after = runEffect(before, back.effects![2]!, "aquarius-tr01b");
    const enemyAfter = after.cardInstances.find(
      (x) => x.instanceId === "enemy-tr01b"
    )!;
    // send_to_deck は pendingLeaveKind を設定する。
    expect(enemyAfter.pendingLeaveKind).toBeDefined();
  });

  // 旧 [board] back 転醒時 count_increase テストは削除: flip 時カウント+1 はルールで
  // executeRebirth が適用する (autorun-w1-advent-rebirth-fidelity.test.ts で flip+解決の
  // 合計がちょうど 1 であることを検証)。boilerplate の効果化は guard が禁止。
});

// ════════════════════════════════════════════════════════════════
// TR02 時計座の鍵 — front: スタック effect_immunity（実装）/ back: count+1/各種stub
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR02 時計座の鍵 / ホロロギウム", () => {
  const c = card("BSFT01-TR02(A)");

  it("front スタック effect_immunity(「ルーシィ」1体, scope battle, attackStep, per_card_name)", () => {
    const stack = c.effects![1]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    expect(stack.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.duration).toEqual({ scope: "battle", nextBattleEnd: true });
      if ("filter" in action.target) {
        expect(action.target.filter.cardName).toEqual({ contains: "ルーシィ" });
      }
    }
  });

  it("[board] スタック effect_immunity: 対象「ルーシィ」に耐性が付く", () => {
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-tr02",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({ cardInstances: [lucy] });
    const after = runEffect(before, c.effects![1]!, "lucy-tr02");
    // effect_immunity は activeContinuousEffects に CE を登録する。
    expect(after.activeContinuousEffects.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════
// TR03 双児宮の鍵 — front: 効果スティール(borrow_card_event_effect+suppressBorrowedEffect)+rebirth（実装）
//   / back: count+1/cardName override/attack effect borrow（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR03 双児宮の鍵 / ジェミニ", () => {
  const c = card("BSFT01-TR03(A)");

  it("front スタック［ゲームに1回:同名］: stack_body=borrow_card_event_effect(summon,suppressBorrowedEffect:true)+rebirth_window/combine_window/core_distribute", () => {
    const stackEffect = c.effects![1]!;
    expect(stackEffect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stackEffect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    const stackBody = stackEffect.steps.find((s) => s.id === "stack_body")!;
    const action = stackBody.action;
    expect(action.kind).toBe("borrow_card_event_effect");
    if (action.kind !== "borrow_card_event_effect") throw new Error();
    expect(action.borrowEvents).toEqual(["summon"]);
    expect(action.suppressBorrowedEffect).toBe(true);
    expect(action.target.kind).toBe("filter");
    if (action.target.kind !== "filter") throw new Error();
    expect(action.target.player).toBe("opponent");
    expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
    expect(action.target.filter.hasCardEventEffect).toEqual(["summon"]);
    expect(stackEffect.steps.some((s) => s.action.kind === "rebirth")).toBe(
      true
    );
    expect(
      stackEffect.steps.some((s) => s.action.kind === "brave_combine_effect")
    ).toBe(true);
    expect(
      stackEffect.steps.filter((s) => s.action.kind === "core_distribute")
    ).toHaveLength(0);
  });

  it("[board] front stack_body: 応答中の召喚時効果だけを置換し、将来の効果を抑止しない", () => {
    const stackEffect = c.effects![1]!;
    const stackBody = stackEffect.steps.find((s) => s.id === "stack_body")!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(A)-STEAL-DONOR",
      name: "TR03(A) steal donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットの召喚時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(c, {
      instanceId: "tr03a-steal-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      exhaustState: "exhausted",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03a-steal-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    // stack_body だけを単独 step effect にして後続の rebirth 分岐から切り離して検証する
    // (TR02(A)/TR03(A) 同型の rebirth_window/combine_window は既存 primitive の再配線のみ)。
    const stackBodyOnlyEffect: Effect = {
      ...stackEffect,
      steps: [stackBody],
    };
    const after = executeEffect({
      chainId: "test:bsft01-cards:7531",
      state: createEmptyGameState({ cardInstances: [host, donor] }),
      effect: stackBodyOnlyEffect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
      pendingStackNegateCandidate: summonResponseStack(
        donor.instanceId,
        donorDef.cardNo,
        BOB
      ),
    });
    // 「自分の効果として発揮する」: 回復したのは借用元(donor)ではなく host。
    expect(
      after.cardInstances.find((x) => x.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("recovered");
    expect(
      after.cardInstances.find((x) => x.instanceId === donor.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
    // 「発揮させず」は今回の応答スタックだけに適用する。
    const suppressionCe = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === donor.instanceId
    );
    expect(suppressionCe).toBeUndefined();
    expect(after.pendingStackNegateRequests).toHaveLength(1);
    const later = executeEffect({
      chainId: "test:bsft01-cards:7565",
      state: { ...after, pendingStackNegateRequests: [] },
      effect: donorDef.effects![0]!,
      sourceInstanceId: donor.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      later.cardInstances.find((x) => x.instanceId === donor.instanceId)
        ?.exhaustState
    ).toBe("recovered");
  });

  it("[board] front stack_body: 借用元と借用者の離脱前後に永続的な抑止を残さない", () => {
    const stackEffect = c.effects![1]!;
    const stackBody = stackEffect.steps.find((s) => s.id === "stack_body")!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(A)-STEAL-DONOR-2",
      name: "TR03(A) steal donor 2",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットの召喚時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(c, {
      instanceId: "tr03a-steal-host-lifecycle",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03a-steal-donor-lifecycle",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const stackBodyOnlyEffect: Effect = {
      ...stackEffect,
      steps: [stackBody],
    };
    const afterBorrow = executeEffect({
      chainId: "test:bsft01-cards:7621",
      state: createEmptyGameState({ cardInstances: [host, donor] }),
      effect: stackBodyOnlyEffect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
      pendingStackNegateCandidate: summonResponseStack(
        donor.instanceId,
        donorDef.cardNo,
        BOB
      ),
    });
    const findSuppression = (s: GameState) =>
      s.activeContinuousEffects.find(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.targetInstanceId === donor.instanceId
      );
    expect(findSuppression(afterBorrow)).toBeUndefined();

    // host (借用者) がフィールドを離れても、donor がまだフィールドにいる間は抑止 CE は残る。
    const hostLeft: GameState = {
      ...afterBorrow,
      cardInstances: afterBorrow.cardInstances.map((c2) =>
        c2.instanceId === host.instanceId
          ? { ...c2, zone: "trash" as const }
          : c2
      ),
    };
    const afterHostLeftRecompute = recomputeContinuousEffects(hostLeft);
    expect(findSuppression(afterHostLeftRecompute)).toBeUndefined();

    // donor 自身がフィールドを離れれば抑止 CE も失効する。
    const donorLeft: GameState = {
      ...afterHostLeftRecompute,
      cardInstances: afterHostLeftRecompute.cardInstances.map((c2) =>
        c2.instanceId === donor.instanceId
          ? { ...c2, zone: "trash" as const }
          : c2
      ),
    };
    const afterDonorLeftRecompute = recomputeContinuousEffects(donorLeft);
    expect(findSuppression(afterDonorLeftRecompute)).toBeUndefined();
  });

  it("[board] front stack_body: 借用後も同じ効果と別の効果の自然発揮を許可する", () => {
    const stackEffect = c.effects![1]!;
    const stackBody = stackEffect.steps.find((s) => s.id === "stack_body")!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(A)-STEAL-DONOR-3",
      name: "TR03(A) steal donor 3",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットの召喚時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(c, {
      instanceId: "tr03a-steal-host-suppress-check",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03a-steal-donor-suppress-check",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const stackBodyOnlyEffect: Effect = {
      ...stackEffect,
      steps: [stackBody],
    };
    const after = executeEffect({
      chainId: "test:bsft01-cards:7710",
      state: createEmptyGameState({ cardInstances: [host, donor] }),
      effect: stackBodyOnlyEffect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
      pendingStackNegateCandidate: summonResponseStack(
        donor.instanceId,
        donorDef.cardNo,
        BOB
      ),
    });
    // 応答した1回以外は同じ召喚時効果も発揮できる。
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: donor.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: { effectIndex: 0 },
        getCardDefinitionById: getDefWithDonor,
      })
    ).toBe(true);
    // donor の別 effectIndex (1) は抑止対象外なので発揮できる。
    expect(
      executeReevaluationCheck({
        state: after,
        checkKind: "effect_suppression",
        sourceInstanceId: donor.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: { effectIndex: 1 },
        getCardDefinitionById: getDefWithDonor,
      })
    ).toBe(true);
  });

  it("back Lv1-Lv3 カード名を「ルーシィ・ハートフィリア」として扱う（override_properties）", () => {
    const back = c.backFace!;
    const ov = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "override_properties"
    )!;
    const action = ov.steps[0]!.action;
    if (action.kind === "override_properties") {
      expect(action.properties.cardName).toBe("ルーシィ・ハートフィリア");
    }
  });

  it("[board] back cardName override: CE が登録され名称が書き換わる", () => {
    const back = c.backFace!;
    const src = createCardInstance(c, {
      instanceId: "gemini-tr03b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const ov = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "override_properties"
    )!;
    const before = createEmptyGameState({ cardInstances: [src] });
    const after = runEffect(before, ov, "gemini-tr03b");
    expect(after.activeContinuousEffects.length).toBeGreaterThan(0);
  });

  it("back 星霊衣アタック時: 相手のアタック時効果を borrow_card_event_effect で借用する", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    expect(borrow.executionMode).toBe("optional");
    expect(borrow.timing).toEqual({ kind: "card_event", event: "attack" });
    const action = borrow.steps[0]!.action;
    expect(action.kind).toBe("borrow_card_event_effect");
    if (action.kind !== "borrow_card_event_effect") throw new Error();
    expect(action.borrowEvents).toEqual(["attack"]);
    expect(action.target.kind).toBe("filter");
    if (action.target.kind !== "filter") throw new Error();
    expect(action.target.player).toBe("opponent");
    expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
    expect(action.target.filter.hasCardEventEffect).toEqual(["attack"]);
  });

  it("[board] BSFT01-TR03(B): host下の星霊衣アタック時効果は battle immediate に queue される", () => {
    const back = c.backFace!;
    const host = {
      ...createCardInstance(card("BSFT01-CX01"), {
        instanceId: "tr03-under-queue-host",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "tr03-under-queue-under",
          role: "text_role",
          roleTag: "星霊衣",
        },
      ],
    };
    const under = createCardInstance(back, {
      instanceId: "tr03-under-queue-under",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: host.instanceId,
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({ cardInstances: [host, under] });
    const getBattleImmediate = buildBattleImmediateEffectLookup([back]);

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "tr03-under-queue-attack",
      participantEntityId: "tr03-under-queue-entity",
      actingPlayerId: ALICE,
      sourceCard: host,
      sourceDefinition: card("BSFT01-CX01"),
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: getBattleImmediate,
    });

    expect(queued.battleImmediateEffects).toContainEqual(
      expect.objectContaining({
        timing: "attack",
        sourceInstanceId: host.instanceId,
        sourceDefinitionId: host.definitionId,
        sourceEffectDefinitionId: back.cardNo,
        sourceEffectInstanceId: under.instanceId,
        sourceCardNo: back.cardNo,
        actingPlayerId: ALICE,
      })
    );
  });

  it("[board] BSFT01-TR03(B): 借用した相手アタック時の「このスピリット」効果は host を source として解決する", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-DONOR",
      name: "TR03 borrow donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const after = executeEffect({
      chainId: "test:bsft01-cards:7887",
      state: createEmptyGameState({ cardInstances: [host, donor] }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("recovered");
    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
  });

  it("[board] BSFT01-TR03(B): 借用元に複数のアタック時効果がある場合は効果1つを選択する", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-MULTI",
      name: "TR03 borrow multi donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "このスピリットを回復する。",
        "このスピリットを疲労させる。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 2],
          steps: [{ action: { kind: "exhaust", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-multi-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-multi-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const pendingState = executeEffect({
      chainId: "test:bsft01-cards:7957",
      state: createEmptyGameState({ cardInstances: [host, donor] }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(pendingState.pendingBorrowedEffectChoice).toMatchObject({
      actingPlayerId: ALICE,
      sourceInstanceId: host.instanceId,
      targetInstanceId: donor.instanceId,
      targetDefinitionId: donorDef.cardNo,
    });
    expect(pendingState.pendingBorrowedEffectChoice!.candidates).toEqual([
      { effectIndex: 0, textRef: [0, 1] },
      { effectIndex: 1, textRef: [0, 2] },
    ]);

    const actions = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const chooseCount = actions.find(
      (action) =>
        action.kind === "resolve_borrowed_effect_choice" &&
        action.borrowedEffectIndex === 1
    );
    expect(chooseCount).toBeDefined();
    const after = applyLegalAction({
      state: pendingState,
      action: chooseCount!,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(after.pendingBorrowedEffectChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:1:as:${host.instanceId}`
    );
  });

  it("[board] BSFT01-TR03(B): 借用した効果本体の対象が複数なら対象選択 pending を立てる", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-TARGET",
      name: "TR03 borrow target donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "相手のスピリット1体を疲労させる。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [
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
          ],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-target-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-target-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyA = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-target-enemy-a",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const enemyB = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-target-enemy-b",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const baseState = createEmptyGameState({
      cardInstances: [host, donor, enemyA, enemyB],
    });
    const enemyATargetLock: ContinuousEffect = {
      effectId: "tr03-borrow-target-enemy-a-target-lock",
      sourceInstanceId: enemyA.instanceId,
      sourceDefinitionId: donorDef.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "while_on_field" },
      createdAtTurn: baseState.turnNumber,
      createdAtAttackId: null,
      modifierTag: "cannot_be_targeted",
      targetInstanceId: enemyA.instanceId,
    };
    const enemyBForcedTargetInclusion: ContinuousEffect = {
      effectId: "tr03-borrow-target-enemy-b-forced-inclusion",
      sourceInstanceId: enemyB.instanceId,
      sourceDefinitionId: donorDef.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "while_on_field" },
      createdAtTurn: baseState.turnNumber,
      createdAtAttackId: null,
      modifierTag: "forced_target_inclusion",
      targetInstanceId: enemyB.instanceId,
    };
    const pendingState = executeEffect({
      chainId: "test:bsft01-cards:8097",
      state: {
        ...baseState,
        activeContinuousEffects: [
          enemyATargetLock,
          enemyBForcedTargetInclusion,
        ],
      },
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(pendingState.pendingBorrowedEffectTargetSelection).toMatchObject({
      actingPlayerId: ALICE,
      sourceInstanceId: host.instanceId,
      targetInstanceId: donor.instanceId,
      targetDefinitionId: donorDef.cardNo,
      borrowedEffectIndex: 0,
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(
      pendingState.pendingBorrowedEffectTargetSelection!.candidateInstanceIds
    ).toEqual([donor.instanceId, enemyB.instanceId]);
    expect(
      pendingState.cardInstances.find(
        (card) => card.instanceId === enemyA.instanceId
      )!.exhaustState
    ).toBe("recovered");
    expect(
      pendingState.cardInstances.find(
        (card) => card.instanceId === enemyB.instanceId
      )!.exhaustState
    ).toBe("recovered");

    const actions = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const chooseTarget = actions.find(
      (action) => action.kind === "resolve_borrowed_effect_target"
    );
    expect(chooseTarget).toBeDefined();
    expect(chooseTarget).toMatchObject({
      mandatoryTargetInstanceIds: [enemyB.instanceId],
    });
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: chooseTarget!,
        targetInstanceIds: [donor.instanceId],
        getCardDefinitionById: getDefWithDonor,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      })
    ).toThrow(/forced target inclusion/);
    const after = applyLegalAction({
      state: pendingState,
      action: chooseTarget!,
      targetInstanceIds: [enemyB.instanceId],
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === enemyA.instanceId)!
        .exhaustState
    ).toBe("recovered");
    expect(
      after.cardInstances.find((card) => card.instanceId === enemyB.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
  });

  it("[board] BSFT01-TR03(B): 借用効果の対象候補は前段step解決後の状態で作る", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-BOOST-TARGET",
      name: "TR03 borrow boost target donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "このスピリットをBP+6000し、相手のスピリット1体を破壊する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [
            {
              id: "boost_self",
              action: {
                kind: "bp_modify",
                target: { kind: "self" },
                amount: 6000,
                duration: { scope: "battle" },
              },
            },
            {
              id: "destroy_by_boosted_bp",
              targetSelectionTiming: "on_step",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit"],
                    maxBpSource: "self_effective_bp",
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const enemyDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-BP7000-ENEMY",
      name: "TR03 borrow BP7000 enemy",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
      symbolColors: ["red"],
      textLines: ["BSFT01-TR03(B) borrow BP7000 enemy"],
      effects: [],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-boost-target-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-boost-target-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(enemyDef, {
      instanceId: "tr03-borrow-boost-target-enemy",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const getDefWithSynthetic = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo
        ? donorDef
        : id === enemyDef.cardNo
          ? enemyDef
          : getDef(id);
    const pendingState = executeEffect({
      chainId: "test:bsft01-cards:8268",
      state: createEmptyGameState({ cardInstances: [host, donor, enemy] }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithSynthetic,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(
      pendingState.pendingBorrowedEffectTargetSelection?.candidateInstanceIds
    ).toContain(enemy.instanceId);

    const after = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_borrowed_effect_target",
        actingPlayerId: ALICE,
        pendingId: pendingState.pendingBorrowedEffectTargetSelection!.pendingId,
      },
      targetInstanceIds: [enemy.instanceId],
      getCardDefinitionById: getDefWithSynthetic,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === enemy.instanceId)!
    ).toMatchObject({ zone: "trash", pendingLeaveKind: null });
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
  });

  it("[board] BSFT01-TR03(B): usageLimit持ち借用効果は対象pending後のresumeで本体を実行する", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-USAGE-TARGET",
      name: "TR03 borrow usage target donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "相手のスピリット1体を疲労させる。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [
            {
              id: "usage_target_exhaust",
              targetSelectionTiming: "on_step",
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
          ],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-usage-target-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-usage-target-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-usage-target-enemy",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const pendingState = executeEffect({
      chainId: "test:bsft01-cards:8363",
      state: createEmptyGameState({ cardInstances: [host, donor, enemy] }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(pendingState.pendingBorrowedEffectTargetSelection).toMatchObject({
      actingPlayerId: ALICE,
      choosingPlayerId: ALICE,
      recordedUsage: expect.objectContaining({
        sourceInstanceId: host.instanceId,
      }),
    });

    const after = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_borrowed_effect_target",
        actingPlayerId: ALICE,
        pendingId: pendingState.pendingBorrowedEffectTargetSelection!.pendingId,
      },
      targetInstanceIds: [enemy.instanceId],
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === enemy.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(after.log).not.toContain(
      `borrow_card_event_effect:usage_limit_exhausted:${donorDef.cardNo}:0`
    );
  });

  it("[board] BSFT01-TR03(B): 借用効果本体のchooser='opponent'は相手が対象を選ぶ", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-OPPONENT-CHOOSER",
      name: "TR03 borrow opponent chooser donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "相手のスピリット1体を疲労させる。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [
            {
              id: "opponent_choose_exhaust",
              targetSelectionTiming: "on_step",
              chooser: "opponent",
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
          ],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-opponent-chooser-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-opponent-chooser-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-opponent-chooser-enemy",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const pendingState = executeEffect({
      chainId: "test:bsft01-cards:8463",
      state: createEmptyGameState({ cardInstances: [host, donor, enemy] }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(pendingState.pendingBorrowedEffectTargetSelection).toMatchObject({
      actingPlayerId: ALICE,
      choosingPlayerId: BOB,
    });
    expect(Array.from(getCurrentActorPlayerIds(pendingState))).toEqual([BOB]);
    expect(
      maskPendingPromptsForViewer(pendingState, ALICE)
        .pendingBorrowedEffectTargetSelection
    ).toBeNull();
    expect(
      maskPendingPromptsForViewer(pendingState, BOB)
        .pendingBorrowedEffectTargetSelection
    ).toMatchObject({ choosingPlayerId: BOB });

    const actionsForBob = getLegalActions({
      state: pendingState,
      actingPlayerId: BOB,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const chooseTarget = actionsForBob.find(
      (action) => action.kind === "resolve_borrowed_effect_target"
    );
    expect(chooseTarget).toMatchObject({ actingPlayerId: BOB });
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_borrowed_effect_target",
          actingPlayerId: ALICE,
          pendingId:
            pendingState.pendingBorrowedEffectTargetSelection!.pendingId,
        },
        targetInstanceIds: [enemy.instanceId],
        getCardDefinitionById: getDefWithDonor,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      })
    ).toThrow(/choosing player mismatch/);

    const after = applyLegalAction({
      state: pendingState,
      action: chooseTarget!,
      targetInstanceIds: [enemy.instanceId],
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === enemy.instanceId)!
        .exhaustState
    ).toBe("exhausted");
  });

  it("[board] BSFT01-TR03(B): 借用効果本体のresumeではeffect-level conditionを再評価しない", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-RESUME-CONDITION",
      name: "TR03 borrow resume condition donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "自分のスピリット1体を回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          condition: [{ kind: "self_state", state: "recovered" }],
          steps: [
            {
              id: "exhaust_donor_before_resume",
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
            {
              id: "condition_after_drop_target",
              targetSelectionTiming: "on_step",
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const allyDef: CardDefinition = {
      ...donorDef,
      cardNo: "BSFT01-TR03(B)-BORROW-RESUME-CONDITION-ALLY",
      name: "TR03 borrow resume condition ally",
      effects: [],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-resume-condition-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-resume-condition-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const allyA = createCardInstance(allyDef, {
      instanceId: "tr03-borrow-resume-condition-ally-a",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const allyB = createCardInstance(allyDef, {
      instanceId: "tr03-borrow-resume-condition-ally-b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo
        ? donorDef
        : id === allyDef.cardNo
          ? allyDef
          : getDef(id);
    const pendingState = executeEffect({
      chainId: "test:bsft01-cards:8620",
      state: createEmptyGameState({
        cardInstances: [host, donor, allyA, allyB],
      }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(pendingState.pendingBorrowedEffectTargetSelection).not.toBeNull();
    expect(
      pendingState.cardInstances.find(
        (card) => card.instanceId === donor.instanceId
      )!.exhaustState
    ).toBe("exhausted");

    const after = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_borrowed_effect_target",
        actingPlayerId: ALICE,
        pendingId: pendingState.pendingBorrowedEffectTargetSelection!.pendingId,
      },
      targetInstanceIds: [allyA.instanceId],
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(after.log).not.toContain(
      `borrow_card_event_effect:condition_unmet:${donorDef.cardNo}:0`
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === allyA.instanceId)!
        .exhaustState
    ).toBe("exhausted");
  });

  it("[board] BSFT01-TR03(B): 借用効果本体のcost budget対象選択を検証する", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-COST-BUDGET",
      name: "TR03 borrow cost budget donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "コスト合計まで相手のスピリットを疲労させる。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [
            {
              id: "cost_budget_exhaust",
              targetSelectionTiming: "on_step",
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                  budget: { metric: "cost", amount: 2 },
                },
              },
            },
          ],
        },
      ],
    };
    const cost1Def: CardDefinition = {
      ...donorDef,
      cardNo: "BSFT01-TR03(B)-BORROW-COST1",
      name: "TR03 borrow cost1 enemy",
      cost: 1,
      effects: [],
    };
    const cost2Def: CardDefinition = {
      ...donorDef,
      cardNo: "BSFT01-TR03(B)-BORROW-COST2",
      name: "TR03 borrow cost2 enemy",
      cost: 2,
      effects: [],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-cost-budget-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-cost-budget-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cost1 = createCardInstance(cost1Def, {
      instanceId: "tr03-borrow-cost-budget-cost1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const cost2 = createCardInstance(cost2Def, {
      instanceId: "tr03-borrow-cost-budget-cost2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const getDefWithSynthetic = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo
        ? donorDef
        : id === cost1Def.cardNo
          ? cost1Def
          : id === cost2Def.cardNo
            ? cost2Def
            : getDef(id);
    const pendingState = executeEffect({
      chainId: "test:bsft01-cards:8748",
      state: createEmptyGameState({
        cardInstances: [host, donor, cost1, cost2],
      }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithSynthetic,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(pendingState.pendingBorrowedEffectTargetSelection).toMatchObject({
      requiredTargetCount: 0,
      maxTargetCount: 2,
      costBudgetAmount: 2,
    });

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_borrowed_effect_target",
          actingPlayerId: ALICE,
          pendingId:
            pendingState.pendingBorrowedEffectTargetSelection!.pendingId,
        },
        targetInstanceIds: [cost1.instanceId, cost2.instanceId],
        getCardDefinitionById: getDefWithSynthetic,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      })
    ).toThrow(/cost total 3 exceeds budget 2/);

    const after = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_borrowed_effect_target",
        actingPlayerId: ALICE,
        pendingId: pendingState.pendingBorrowedEffectTargetSelection!.pendingId,
      },
      targetInstanceIds: [cost2.instanceId],
      getCardDefinitionById: getDefWithSynthetic,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === cost2.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(
      after.cardInstances.find((card) => card.instanceId === cost1.instanceId)!
        .exhaustState
    ).toBe("recovered");
  });

  it("[board] BSFT01-TR03(B): 借用元でLv条件未達のアタック時効果は候補にしない", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-LV2",
      name: "TR03 borrow Lv2 donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
      symbolColors: ["red"],
      textLines: [
        "Lv2『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          condition: [{ kind: "min_level", value: 2 }],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-lv-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donorLv1 = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-lv-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const baseState = createEmptyGameState({ cardInstances: [host, donorLv1] });
    expect(
      matchesCardFilter(
        donorLv1,
        donorDef,
        { hasCardEventEffect: ["attack"] },
        {
          state: baseState,
          evaluateCondition: (condition, sourceId, actingPlayerId) =>
            evaluateCondition(
              baseState,
              condition,
              sourceId,
              actingPlayerId,
              getDefWithDonor
            ),
        }
      )
    ).toBe(false);
    const after = executeEffect({
      chainId: "test:bsft01-cards:8867",
      state: baseState,
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donorLv1.instanceId],
    });
    expect(after.pendingBorrowedEffectChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(after.log).toContain(
      `borrow_card_event_effect:no_eligible_effect:${donorDef.cardNo}`
    );
  });

  it("[board] BSFT01-TR03(B): 条件付き借用元を自動target解決でも候補に残す", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-AUTO-CONDITION",
      name: "TR03 borrow auto condition donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          condition: [{ kind: "min_level", value: 2 }],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-auto-condition-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donorLv2 = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-auto-condition-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const after = executeEffect({
      chainId: "test:bsft01-cards:8932",
      state: createEmptyGameState({ cardInstances: [host, donorLv2] }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingBorrowedEffectChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("recovered");
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
  });

  it("[board] BSFT01-TR03(B): game_event実装でも原文が『このスピリットのアタック時』なら借用候補にする", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-GAME-EVENT-LABEL",
      name: "TR03 borrow game-event label donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "destroy",
            cause: "self_effect",
          },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-game-event-label-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-game-event-label-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const state = createEmptyGameState({ cardInstances: [host, donor] });

    const after = runEffect(state, borrow, host.instanceId, getDefWithDonor);

    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)
        ?.exhaustState
    ).toBe("recovered");
  });

  it("[board] BSFT01-TR03(B): 『このスピリットがアタックしたとき』は『このスピリットのアタック時』借用候補にしない", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-WHEN-ATTACKS",
      name: "TR03 borrow when attacks donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1 このスピリットがアタックしたとき",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-when-attacks-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-when-attacks-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const state = createEmptyGameState({ cardInstances: [host, donor] });

    const after = runEffect(state, borrow, host.instanceId, getDefWithDonor);

    expect(after.log).not.toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("[board] BSFT01-TR03(B): genericな『スピリット/アルティメットのアタック時』は借用候補にしない", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-GENERIC-ATTACK-TIME",
      name: "TR03 borrow generic attack-time donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『スピリット/アルティメットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-generic-attack-time-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-generic-attack-time-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const state = createEmptyGameState({ cardInstances: [host, donor] });

    const after = runEffect(state, borrow, host.instanceId, getDefWithDonor);

    expect(after.log).not.toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${host.instanceId}`
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("[board] BSFT01-TR03(B): applicability付き借用元は自動target解決でも donor Lv で絞る", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-AUTO-APPLICABILITY",
      name: "TR03 borrow auto applicability donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
      symbolColors: ["red"],
      textLines: [
        "Lv2『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          applicability: { level: { min: 2 } },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const hostLv1 = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-auto-applicability-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donorLv1 = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-auto-applicability-donor-lv1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donorLv2 = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-auto-applicability-donor-lv2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const after = executeEffect({
      chainId: "test:bsft01-cards:9170",
      state: createEmptyGameState({
        cardInstances: [hostLv1, donorLv1, donorLv2],
      }),
      effect: borrow,
      sourceInstanceId: hostLv1.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingBorrowedEffectChoice).toBeNull();
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === hostLv1.instanceId
      )!.exhaustState
    ).toBe("recovered");
    expect(after.log).toContain(
      `borrow_card_event_effect:executed:${donorDef.cardNo}:0:as:${hostLv1.instanceId}`
    );
  });

  it("[board] BSFT01-TR03(B): legal action候補列挙でも条件付き借用元を候補に残す", () => {
    const registration = {
      sourceKind: "spirit",
      eventKind: "attack",
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "opponent",
      targetCardFilter: {
        category: ["spirit"],
        hasCardEventEffect: ["attack"],
      },
      targetCardFilterActionKind: "exhaust",
    } satisfies import("../src/effect/trigger-system").RegisteredTriggeredEffectAction;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-LEGAL-CANDIDATE",
      name: "TR03 borrow legal candidate donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
      symbolColors: ["red"],
      textLines: [
        "Lv2『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          condition: [{ kind: "min_level", value: 2 }],
          applicability: { level: { min: 2 } },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-legal-candidate-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-legal-candidate-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const state: GameState = {
      ...createEmptyGameState({ cardInstances: [host, donor] }),
      step: "attack",
      window: "declare_attack",
      pendingTriggeredEffects: [
        {
          pendingId: "tr03-borrow-legal-candidate-pending",
          actingPlayerId: ALICE,
          eventKind: "attack",
          source: "action_resolution",
          chainId: "test:bsft01-cards:9250",
          attackId: null,
          relatedPlayerId: ALICE,
          relatedInstanceId: host.instanceId,
          amount: null,
          step: "attack",
          window: "declare_attack",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredTriggeredEffectActions: (cardNo) =>
        cardNo === host.definitionId ? [registration] : [],
    });
    const action = actions.find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === host.instanceId
    );
    expect(action).toMatchObject({
      requiredTargetCount: 1,
      candidateTargetInstanceIds: [donor.instanceId],
    });
  });

  it("[board] BSFT01-TR03(B): 未実装stub/空stepsのアタック時効果は借用候補にしない", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-STUB",
      name: "TR03 borrow stub donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          stub: "unimplemented",
        },
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          steps: [],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-stub-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-stub-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const baseState = createEmptyGameState({ cardInstances: [host, donor] });
    expect(
      matchesCardFilter(
        donor,
        donorDef,
        { hasCardEventEffect: ["attack"] },
        { state: baseState }
      )
    ).toBe(false);
    const after = executeEffect({
      chainId: "test:bsft01-cards:9343",
      state: baseState,
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(after.pendingBorrowedEffectChoice).toBeNull();
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(after.log).toContain(
      `borrow_card_event_effect:no_eligible_effect:${donorDef.cardNo}`
    );
  });

  it("[board] BSFT01-TR03(B): 借用元の使用回数制限をdonor effect単位で消費する", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-USAGE",
      name: "TR03 borrow usage donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-usage-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-usage-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const once = executeEffect({
      chainId: "test:bsft01-cards:9406",
      state: createEmptyGameState({ cardInstances: [host, donor] }),
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(
      once.cardInstances.find((card) => card.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("recovered");
    expect(once.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: "BSFT01-CX01",
          effectLabel: "effect:0",
          duration: "turn",
        }),
      ])
    );

    const exhaustedAgain: GameState = {
      ...once,
      cardInstances: once.cardInstances.map((card) =>
        card.instanceId === host.instanceId
          ? { ...card, exhaustState: "exhausted" }
          : card
      ),
    };
    const twice = executeEffect({
      chainId: "test:bsft01-cards:9438",
      state: exhaustedAgain,
      effect: borrow,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donor.instanceId],
    });
    expect(
      twice.cardInstances.find((card) => card.instanceId === host.instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(twice.log).toContain(
      `borrow_card_event_effect:no_eligible_effect:${donorDef.cardNo}`
    );
  });

  it("[board] BSFT01-TR03(B): 借用元で満たしたapplicability Lv条件は host に二重適用しない", () => {
    const back = c.backFace!;
    const borrow = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "borrow_card_event_effect"
    )!;
    const donorDef: CardDefinition = {
      cardNo: "BSFT01-TR03(B)-BORROW-HOST-LV2",
      name: "TR03 borrow host Lv2 donor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
      symbolColors: ["red"],
      textLines: [
        "Lv2『このスピリットのアタック時』",
        "このスピリットを回復する。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0, 1],
          applicability: { level: { min: 2 } },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const hostLv1 = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-host-lv-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const donorLv2 = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-host-lv-donor",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const getDefWithDonor = (id: string): CardDefinition | undefined =>
      id === donorDef.cardNo ? donorDef : getDef(id);
    const after = executeEffect({
      chainId: "test:bsft01-cards:9502",
      state: createEmptyGameState({ cardInstances: [hostLv1, donorLv2] }),
      effect: borrow,
      sourceInstanceId: hostLv1.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donorLv2.instanceId],
    });
    expect(after.pendingBorrowedEffectTargetSelection).toBeNull();
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === hostLv1.instanceId
      )!.exhaustState
    ).toBe("recovered");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === donorLv2.instanceId
      )!.exhaustState
    ).toBe("exhausted");

    const donorLv1 = createCardInstance(donorDef, {
      instanceId: "tr03-borrow-host-lv-donor-unmet",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const hostLv2 = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr03-borrow-host-lv-host-met",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const unmet = executeEffect({
      chainId: "test:bsft01-cards:9537",
      state: createEmptyGameState({ cardInstances: [hostLv2, donorLv1] }),
      effect: borrow,
      sourceInstanceId: hostLv2.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithDonor,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [donorLv1.instanceId],
    });
    expect(
      unmet.cardInstances.find(
        (card) => card.instanceId === hostLv2.instanceId
      )!.exhaustState
    ).toBe("exhausted");
    expect(unmet.log).toContain(
      `borrow_card_event_effect:no_eligible_effect:${donorDef.cardNo}`
    );
  });
});

// ════════════════════════════════════════════════════════════════
// TR04 人馬宮の鍵 — front: フラッシュ ネクサス破壊（実装）/ back: BP15000破壊（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR04 人馬宮の鍵 / サジタリウス", () => {
  const c = card("BSFT01-TR04(A)");

  it("front フラッシュ: 相手ネクサス3つまで破壊し、創界神ネクサスすべてのコアをボイドへ置く", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("destroy");
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.category).toEqual(["nexus"]);
      expect(action.target.count).toEqual({ min: 0, max: 3 });
    }
    const coreAction = flash.steps[1]!.action;
    expect(coreAction).toEqual({
      kind: "core_move",
      from: {
        kind: "field",
        player: "opponent",
        filter: {
          category: ["nexus"],
          targetsGrandwalker: "only",
        },
      },
      to: { kind: "void", player: "opponent" },
      amount: "all",
    });
    // 使用した本文が対象0でも、after_triggers で派生効果後に転醒を提示する。
    const rebirthWindow = flash.steps[2]!;
    expect(rebirthWindow.connector).toBe("after_triggers");
    expect(rebirthWindow.stepCondition).toBeUndefined();
    expect(rebirthWindow.executionMode).toBe("optional");
    expect(rebirthWindow.action).toEqual({
      kind: "rebirth",
      allowPostRebirthCorePlacementForLvDeficit: true,
      postRebirthChoice: {
        kind: "core_distribute",
        minimum: "back_face_lv",
      },
    });
    // combine_window: rebirth_window が不発のときのみ提示する合体分岐 (択一)。
    const combineWindow = flash.steps[3]!;
    expect(combineWindow.executionMode).toBe("optional");
    expect(combineWindow.action.kind).toBe("brave_combine_effect");
    expect(flash.steps.some((s) => s.action.kind === "core_distribute")).toBe(
      false
    );
    expect(flash.stub).toBeUndefined();
  });

  it("[board] back アタック時: BP15000以下の相手スピリットが破壊予約される (fixed count=1)", () => {
    const back = c.backFace!;
    const atk = back.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event?: unknown }).event === "attack" &&
        e.textRef?.[0] === 7
    )!;
    const d = atk.steps[0]!.action;
    if (d.kind !== "destroy" || !("filter" in d.target))
      throw new Error("expected destroy filter");
    expect(d.target.filter.maxBp).toBe(15000);

    const src = createCardInstance(c, {
      instanceId: "saggi-tr04b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemy = createCardInstance(card(ENEMY_CARD), {
      instanceId: "enemy-tr04b",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        { action: { kind: "destroy", target: { ...d.target, count: 1 } } },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemy] }),
      fixed,
      "saggi-tr04b"
    );
    const enemyAfter = after.cardInstances.find(
      (x) => x.instanceId === "enemy-tr04b"
    )!;
    expect(enemyAfter.pendingLeaveKind).toBe("destroy");
  });

  it("[board] front フラッシュ: 相手ネクサスを破壊予約し、創界神ネクサス全コアをボイドへ置く", () => {
    const source = createCardInstance(c, {
      instanceId: "tr04-flash-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-tr04",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const grandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "grandwalker-tr04",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const secondGrandwalker = createCardInstance(card("BSLH01-X02"), {
      instanceId: "grandwalker-tr04-second",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const flash = c.effects![1]!;
    const d = flash.steps[0]!.action;
    if (d.kind !== "destroy" || !("filter" in d.target))
      throw new Error("expected destroy filter");
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "destroy", target: { ...d.target, count: 1 } } },
        flash.steps[1]!,
      ],
    };
    const after = runEffect(
      createEmptyGameState({
        cardInstances: [source, enemyNexus, grandwalker, secondGrandwalker],
        startingVoidNormalCoreCount: 0,
      }),
      fixed,
      "tr04-flash-source"
    );
    const nexusAfter = after.cardInstances.find(
      (x) => x.instanceId === "nexus-tr04"
    )!;
    expect(nexusAfter.pendingLeaveKind).toBe("destroy");
    const grandwalkerAfter = after.cardInstances.find(
      (x) => x.instanceId === "grandwalker-tr04"
    )!;
    const secondGrandwalkerAfter = after.cardInstances.find(
      (x) => x.instanceId === "grandwalker-tr04-second"
    )!;
    expect(grandwalkerAfter.pendingLeaveKind).toBeNull();
    expect(grandwalkerAfter.normalCoreCount).toBe(0);
    expect(secondGrandwalkerAfter.pendingLeaveKind).toBeNull();
    expect(secondGrandwalkerAfter.normalCoreCount).toBe(0);
    expect(after.players.find((p) => p.id === BOB)?.voidNormalCoreCount).toBe(
      5
    );
  });

  it("[board] 手札から magic として積んだ TR04(A) は deferred 解決でも TR01(A) の防止貫通を維持する", () => {
    const grantSource = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "tr01-grant-for-tr04-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const magicSource = createCardInstance(c, {
      instanceId: "tr04-magic-deferred",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
      normalCoreCount: 0,
    });
    const targetNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "tr04-magic-protected-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const attacker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr04-magic-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const grantState = runEffect(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [grantSource, magicSource, targetNexus, attacker],
        playerOverrides: [
          { lifeNormalCoreCount: 0, reserveNormalCoreCount: 5 },
          {},
        ],
      }),
      card("BSFT01-TR01(A)").effects![1]!,
      grantSource.instanceId
    );
    const before = {
      ...grantState,
      pendingStepOptionalChoice: null,
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "flash_before_block" as const,
      activeContinuousEffects: [
        ...grantState.activeContinuousEffects,
        // ライフ0で防止貫通を検証する間は、ゲーム敗北を防止する。
        {
          effectId: "tr04-loss-immunity",
          sourceInstanceId: grantSource.instanceId,
          sourceDefinitionId: grantSource.definitionId,
          actingPlayerId: ALICE,
          targetInstanceId: ALICE,
          modifierTag: "immune_to_game_loss",
          duration: { scope: "turn" },
          createdAtTurn: grantState.turnNumber,
          createdAtAttackId: null,
        },
        {
          effectId: "test-tr04-magic-deferred-defense-immune",
          sourceInstanceId: "tr04-magic-defense-nexus-source",
          sourceDefinitionId: "BSFT01-C03",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: grantState.turnNumber,
          createdAtAttackId: null,
          modifierTag: "defense_immune" as const,
          targetInstanceId: targetNexus.instanceId,
        },
      ],
      activeAttack: {
        attackId: "attack-tr04-magic-deferred",
        primaryEntityId: "entity-tr04-magic-attacker",
        participantEntityIds: ["entity-tr04-magic-attacker"],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: ["entity-tr04-magic-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block" as const,
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
    };
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const action = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === magicSource.instanceId &&
        candidate.effectIndex === 1
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const declared = applyLegalAction({
      state: before,
      action,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      paymentSources:
        action.finalCost > 0
          ? [{ kind: "reserve", amount: action.finalCost }]
          : [],
    }).state;
    const pendingStack =
      declared.activeAttack?.flashWindowState?.pendingStackAction;
    expect(pendingStack?.preventionBypass).toEqual({
      kind: "preventing_effect_filter",
      filter: { categories: ["nexus", "ultimate"] },
    });
    if (!pendingStack) throw new Error("expected pending magic stack");

    const resolvingState: GameState = {
      ...declared,
      activeAttack: declared.activeAttack
        ? {
            ...declared.activeAttack,
            flashWindowState: declared.activeAttack.flashWindowState
              ? {
                  ...declared.activeAttack.flashWindowState,
                  pendingStackAction: null,
                }
              : null,
          }
        : null,
    };
    const pendingTargetState = resolveStackCascade(
      resolvingState,
      [pendingStack],
      {
        getCardDefinitionById: getDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(
      pendingTargetState.pendingEffectTargetSelection?.candidateInstanceIds
    ).toContain(targetNexus.instanceId);

    const targetAction = getLegalActions({
      state: pendingTargetState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    if (!targetAction) throw new Error("expected target selection action");

    const after = applyLegalAction({
      state: pendingTargetState,
      action: targetAction,
      targetInstanceIds: [targetNexus.instanceId],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;
    const targetAfter = after.cardInstances.find(
      (entry) => entry.instanceId === targetNexus.instanceId
    );
    expect(
      targetAfter?.pendingLeaveKind === "destroy" ||
        targetAfter?.zone === "trash"
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// TR05 金牛宮の鍵 — front: スタック離脱耐性（実装）/ back: 離脱耐性（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR05 金牛宮の鍵 / タウロス", () => {
  const c = card("BSFT01-TR05(A)");

  it("[regression] EDH-0183: stack 応答の転醒/合体 optional 後に選択済み burst を再開する", () => {
    const burstCard = card("BSTH09-M03");
    const stackMagic = createCardInstance(c, {
      instanceId: "edh-0183-stack-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const burstSource = createCardInstance(burstCard, {
      instanceId: "edh-0183-burst-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "burst",
    });
    const attacker = createCardInstance(card("BSTH02.7-TR02(A)"), {
      instanceId: "edh-0183-attacker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
    };
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [burstSource, stackMagic, attacker],
        playerOverrides: [
          { handCount: 0, reserveNormalCoreCount: 0 },
          { handCount: 1, reserveNormalCoreCount: 5 },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
      window: "declare_attack",
      setBurstStates: [
        { playerId: ALICE, cardInstanceId: burstSource.instanceId },
      ],
      pendingBurstChecks: [
        {
          checkId: "edh-0183-attack-after",
          actingPlayerId: ALICE,
          eventKind: "attack_after",
          event: {
            family: "action_after",
            actionKind: "attack",
            validationMode: "require_related_instance_on_field",
          },
          source: "action_resolution",
          chainId: "test:bsft01-cards:9951",
          attackId: "edh-0183-attack",
          relatedPlayerId: BOB,
          relatedInstanceId: "edh-0183-attacker",
          amount: 1,
          step: "attack",
          window: "declare_attack",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const burstAction = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_burst_check" &&
        action.sourceInstanceId === burstSource.instanceId
    );
    expect(burstAction).toBeDefined();
    state = applyLegalAction({ state, action: burstAction!, ...lookups }).state;

    const magicAction = getLegalActions({
      state,
      actingPlayerId: BOB,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === stackMagic.instanceId
    );
    expect(magicAction).toBeDefined();
    if (!magicAction || magicAction.kind !== "use_magic") return;
    state = applyLegalAction({
      state,
      action: magicAction,
      paymentSources: [{ kind: "reserve", amount: magicAction.finalCost }],
      ...lookups,
    }).state;

    const pass = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    state = applyLegalAction({ state, action: pass!, ...lookups }).state;
    expect(state.pendingStepOptionalChoice?.stepLabel).toBe("rebirth_window");
    // The response paid its final core from the attacking spirit. During a
    // battle, that leave remains deferred until the response stack is fully
    // resolved; this is the stranded state recorded by EDH-0183.
    state = {
      ...state,
      activeAttack: {
        attackId: "edh-0183-attack",
        primaryEntityId: "edh-0183-attacker-entity",
        participantEntityIds: ["edh-0183-attacker-entity"],
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [
          {
            participantEntityId: "edh-0183-attacker-entity",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["edh-0183-attacker-entity"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "edh-0183-attacker-entity",
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      cardInstances: state.cardInstances.map((instance) =>
        instance.instanceId === attacker.instanceId
          ? {
              ...instance,
              normalCoreCount: 0,
              pendingLeaveKind: "vanish",
              pendingLeaveCause: "cost_payment",
              pendingLeaveChainId: "magic:edh-0183-response",
              deferZoneMoveUntilChainEnd: true,
            }
          : instance
      ),
      pendingLeaveEntities: [
        {
          instanceId: attacker.instanceId,
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: "magic:edh-0183-response",
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    while (state.pendingStepOptionalChoice) {
      const pending = state.pendingStepOptionalChoice;
      state = applyLegalAction({
        state,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `edh-0183:${pending.pendingId}:decline`,
          can: true,
          reason: "EDH-0183 regression",
          actingPlayerId: pending.choosingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice: "decline",
        },
        ...lookups,
      }).state;
    }
    expect(state.pendingLeaveEntities).toHaveLength(0);
    expect(state.pendingStackCascade).toBeNull();
    expect(state.pendingBurstChecks).toHaveLength(0);
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(
      state.cardInstances.find(
        (card) => card.instanceId === attacker.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("front スタック grant_effect(「ルーシィ」/光導, leave_field opponent/battle, scope battle)", () => {
    const stack = c.effects![1]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("grant_effect");
    if (action.kind === "grant_effect") {
      expect(action.target.kind).toBe("filter");
      if (action.target.kind === "filter") {
        expect(action.target.filter).toEqual({
          filterOr: [
            {
              category: ["spirit"],
              cardName: { contains: "ルーシィ" },
            },
            { category: ["spirit"], tribes: ["光導"] },
          ],
        });
      }
      expect(action.duration).toEqual({ scope: "battle", nextBattleEnd: true });
      expect(action.grantedEffect.timing).toEqual({
        kind: "card_event",
        event: "leave_field",
        cause: ["opponent_effect", "battle"],
      });
      expect(action.grantedEffect.executionMode).toBe("optional");
      expect(action.grantedEffect.steps[0]!.action).toEqual({
        kind: "stay_on_field",
        target: { kind: "self" },
      });
    }
  });

  it("back Lv2-Lv3 effect_resistance(self+「ルーシィ」, leave_field, all)", () => {
    const back = c.backFace!;
    const res = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_resistance"
    )!;
    expect(res.condition).toContainEqual({ kind: "min_level", value: 2 });
    const action = res.steps[0]!.action;
    if (action.kind === "effect_resistance") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.source).toBe("all");
      expect(action.excludedCauses).toEqual(["battle"]);
    }
    const lucyAction = res.steps[1]!.action;
    if (lucyAction.kind === "effect_resistance") {
      expect(lucyAction.source).toBe("all");
      expect(lucyAction.excludedCauses).toEqual(["battle"]);
    }
    expect(res.stub).toBeUndefined();
  });

  it("[board] BSFT01-TR05(A): grant 後、相手起因 leave_field で同じ状態のまま残せる", () => {
    const source = createCardInstance(c, {
      instanceId: "BSFT01-TR05(A)-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "BSFT01-TR05(A)-lucy",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const before = createEmptyGameState({ cardInstances: [source, lucy] });
    const granted = declineRebirthWindowIfPending(
      runEffect(before, c.effects![1]!, "BSFT01-TR05(A)-source")
    );
    const dynamicGrant = granted.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(dynamicGrant).toMatchObject({
      modifierTag: "granted_effect",
      duration: { scope: "battle" },
      targetFilter: { player: "self" },
    });
    expect(dynamicGrant?.targetInstanceId).toBeUndefined();
    expect(dynamicGrant?.targetFilter?.filterOr).toHaveLength(2);
    expect(
      granted.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === "BSFT01-TR05(A)-lucy"
      )
    ).toBe(false);
    expect(
      granted.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === "BSFT01-TR05(A)-source"
      )
    ).toBe(false);

    const chainId = "BSFT01-TR05(A)-opponent-leave";
    const pendingLeave = queuePendingLeave({
      state: granted,
      instanceId: "BSFT01-TR05(A)-lucy",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      pendingLeave,
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "BSFT01-TR05(A)-lucy",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId,
        },
      ],
      getDef
    );
    const pending = grantedEffectPendings(queued)[0]!;
    expect(pending.relatedInstanceId).toBe("BSFT01-TR05(A)-lucy");

    const resolved = resolveGrantedEffectPending(queued, pending.pendingId);
    const lucyAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "BSFT01-TR05(A)-lucy"
    )!;
    expect(lucyAfter.zone).toBe("field");
    expect(lucyAfter.exhaustState).toBe("exhausted");
    expect(lucyAfter.pendingLeaveKind).toBeNull();
    expect(resolved.pendingLeaveEntities).toHaveLength(0);

    const removeChainId = "BSFT01-TR05(A)-opponent-remove-from-game";
    const queuedRemoveFromGame = queueGrantedEffectTriggersFromTriggerEvents(
      queuePendingLeave({
        state: granted,
        instanceId: "BSFT01-TR05(A)-lucy",
        kind: "remove_from_game",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: removeChainId,
      }),
      [
        {
          eventKind: "remove_from_game",
          relatedInstanceId: "BSFT01-TR05(A)-lucy",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId: removeChainId,
        },
      ],
      getDef
    );
    const removePendings = grantedEffectPendings(queuedRemoveFromGame);
    expect(removePendings).toHaveLength(1);
    expect(removePendings[0]!.relatedInstanceId).toBe("BSFT01-TR05(A)-lucy");

    const laterLucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "BSFT01-TR05(A)-later-lucy",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const laterState: GameState = {
      ...granted,
      cardInstances: [...granted.cardInstances, laterLucy],
    };
    const laterChainId = "BSFT01-TR05(A)-later-opponent-leave";
    const laterQueued = queueGrantedEffectTriggersFromTriggerEvents(
      queuePendingLeave({
        state: laterState,
        instanceId: "BSFT01-TR05(A)-later-lucy",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: laterChainId,
      }),
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "BSFT01-TR05(A)-later-lucy",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId: laterChainId,
        },
      ],
      getDef
    );
    const laterPendings = grantedEffectPendings(laterQueued);
    expect(laterPendings).toHaveLength(1);
    expect(laterPendings[0]!.relatedInstanceId).toBe(
      "BSFT01-TR05(A)-later-lucy"
    );
  });

  it("[board] BSFT01-TR05(A): 自分起因 leave_field では grant 残置が発火しない", () => {
    const source = createCardInstance(c, {
      instanceId: "BSFT01-TR05(A)-self-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "BSFT01-TR05(A)-self-lucy",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granted = declineRebirthWindowIfPending(
      runEffect(
        createEmptyGameState({ cardInstances: [source, lucy] }),
        c.effects![1]!,
        "BSFT01-TR05(A)-self-source"
      )
    );
    const chainId = "BSFT01-TR05(A)-self-leave";
    const pendingLeave = queuePendingLeave({
      state: granted,
      instanceId: "BSFT01-TR05(A)-self-lucy",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      chainId,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      pendingLeave,
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "BSFT01-TR05(A)-self-lucy",
          relatedPlayerId: ALICE,
          cause: "self_effect",
          chainId,
        },
      ],
      getDef
    );

    expect(grantedEffectPendings(queued)).toHaveLength(0);
    const flushed = flushPendingLeaves(queued, getDef);
    expect(
      flushed.cardInstances.find(
        (card) => card.instanceId === "BSFT01-TR05(A)-self-lucy"
      )?.zone
    ).toBe("trash");
  });

  it("[board] BSFT01-TR05(B): 効果離脱は止めるが BP比べによる battle 離脱は止めない", () => {
    const back = c.backFace!;
    const resistanceEffect = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_resistance"
    )!;
    const taurus = createCardInstance(back, {
      instanceId: "BSFT01-TR05(B)-taurus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const source = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "bob-source-tr05b",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({ cardInstances: [taurus, source] });
    const after = runEffect(before, resistanceEffect, taurus.instanceId);
    expect(resistanceEffect.steps[0]!.action).toMatchObject({
      kind: "effect_resistance",
      target: { kind: "self" },
      excludedCauses: ["battle"],
    });

    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "cannot_leave_field" &&
          ce.targetInstanceId === "BSFT01-TR05(B)-taurus" &&
          (
            ce.metadata as { excludedCauses?: string[] } | undefined
          )?.excludedCauses?.includes("battle")
      )
    ).toBe(true);
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "cannot_leave_field" &&
          ce.targetInstanceId === undefined &&
          ce.targetFilter?.cardName !== undefined &&
          (
            ce.metadata as { excludedCauses?: string[] } | undefined
          )?.excludedCauses?.includes("battle")
      )
    ).toBe(true);

    const effectDecision = resolveBpCompareDestroyAffect(
      after,
      taurus,
      BOB,
      getDef,
      "none",
      "effect"
    );
    expect(effectDecision.kind).toBe("blocked");

    const battleDecision = resolveBpCompareDestroyAffect(
      after,
      taurus,
      BOB,
      getDef,
      "none",
      "battle"
    );
    expect(battleDecision.kind).toBe("allowed");

    const depleted = {
      ...after,
      cardInstances: after.cardInstances.map((card) =>
        card.instanceId === "BSFT01-TR05(B)-taurus"
          ? { ...card, normalCoreCount: 0, soulCoreCount: 0 }
          : card
      ),
    };
    const sba = runStateBasedActions(depleted, getDef).state;
    expect(
      sba.cardInstances.find(
        (card) => card.instanceId === "BSFT01-TR05(B)-taurus"
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      sba.pendingLeaveEntities.find(
        (pl) => pl.instanceId === "BSFT01-TR05(B)-taurus"
      )
    ).toMatchObject({
      kind: "vanish",
      cause: "state_based_action",
      blockedByResistance: true,
    });

    const laterLucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "BSFT01-TR05(B)-later-lucy",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const laterOther = createCardInstance(card("BSDB01-C01"), {
      instanceId: "BSFT01-TR05(B)-later-other",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const afterLaterLucy = {
      ...after,
      cardInstances: [...after.cardInstances, laterLucy, laterOther],
    };
    expect(
      resolveBpCompareDestroyAffect(
        afterLaterLucy,
        laterLucy,
        BOB,
        getDef,
        "none",
        "effect"
      ).kind
    ).toBe("blocked");
    expect(
      resolveBpCompareDestroyAffect(
        afterLaterLucy,
        laterLucy,
        BOB,
        getDef,
        "none",
        "battle"
      ).kind
    ).toBe("allowed");
    expect(
      resolveBpCompareDestroyAffect(
        afterLaterLucy,
        laterOther,
        BOB,
        getDef,
        "none",
        "effect"
      ).kind
    ).toBe("allowed");

    const tr03Back = card("BSFT01-TR03(A)").backFace!;
    const treatedAsLucy = createCardInstance(tr03Back, {
      instanceId: "BSFT01-TR05(B)-treated-as-lucy",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nameOverride = tr03Back.effects!.find(
      (effect) => effect.steps[0]?.action.kind === "override_properties"
    )!;
    const afterNameOverride = runEffect(
      {
        ...after,
        cardInstances: [...after.cardInstances, treatedAsLucy],
      },
      nameOverride,
      treatedAsLucy.instanceId
    );
    expect(
      resolveBpCompareDestroyAffect(
        afterNameOverride,
        treatedAsLucy,
        BOB,
        getDef,
        "none",
        "effect"
      ).kind
    ).toBe("blocked");
  });

  it("[board] BSFT01-TR05(B): effect の bp_compare_destroy は bp_compare cause として離脱耐性で止まる", () => {
    const back = c.backFace!;
    const resistanceEffect = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_resistance"
    )!;
    const taurus = createCardInstance(back, {
      instanceId: "BSFT01-TR05(B)-bob-taurus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const source = createCardInstance(card("BSFT01-X01"), {
      instanceId: "BSFT01-TR05(B)-alice-x01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 5,
    });
    const protectedState = executeEffect({
      chainId: "test:bsft01-cards:10526",
      state: createEmptyGameState({ cardInstances: [taurus, source] }),
      effect: resistanceEffect,
      sourceInstanceId: taurus.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const compareEffect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bp_compare_destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: 1,
            },
          },
        },
      ],
    };
    const after = executeEffect({
      chainId: "test:bsft01-cards:10550",
      state: protectedState,
      effect: compareEffect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.find((x) => x.instanceId === taurus.instanceId)!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.pendingLeaveEntities.find(
        (pl) => pl.instanceId === taurus.instanceId
      )
    ).toMatchObject({
      kind: "destroy",
      cause: "bp_compare",
      causePlayerId: ALICE,
      blockedByResistance: true,
    });
  });

  it("[board] BSFT01-TR05(B): 実バトルの BP 比べ破壊は battle cause として離脱耐性を貫通する", () => {
    const back = c.backFace!;
    const resistanceEffect = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_resistance"
    )!;
    const taurus = createCardInstance(back, {
      instanceId: "BSFT01-TR05(B)-battle-taurus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const attacker = createCardInstance(card("BSFT01-X01"), {
      instanceId: "BSFT01-TR05(B)-battle-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 5,
    });
    const protectedState = executeEffect({
      chainId: "test:bsft01-cards:10593",
      state: createEmptyGameState({ cardInstances: [taurus, attacker] }),
      effect: resistanceEffect,
      sourceInstanceId: taurus.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const battleState: GameState = {
      ...protectedState,
      step: "attack",
      window: "battle_resolution",
      activePlayerId: ALICE,
      activeAttack: {
        attackId: "attack-tr05b-battle-cause",
        primaryEntityId: "be-tr05b-attacker",
        participantEntityIds: ["be-tr05b-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "be-tr05b-attacker",
            blockedByEntityIds: ["be-tr05b-taurus"],
          },
        ],
        symbolResolutionOrder: ["be-tr05b-attacker"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-tr05b-attacker",
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 20000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "be-tr05b-taurus",
          memberInstanceIds: [taurus.instanceId],
          resolvedBp: 10000,
          resolvedSymbols: ["guide"],
          attackState: "blocking",
        },
      ],
    };
    const after = executeBattleResolution({
      state: battleState,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => [],
    }).state;
    expect(
      after.cardInstances.find((x) => x.instanceId === taurus.instanceId)?.zone
    ).toBe("trash");
    expect(after.pendingLeaveEntities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: taurus.instanceId,
          blockedByResistance: true,
        }),
      ])
    );
    expect(after.log).toContain(
      "battle:resolution:bp-compare:attack-tr05b-battle-cause:be-tr05b-attacker:be-tr05b-taurus:20000:10000:blocker_destroyed"
    );
  });
});

// ════════════════════════════════════════════════════════════════
// TR06 巨蟹宮の鍵 — front: スタック exhaust（実装）/ back: count+1/各種stub
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR06 巨蟹宮の鍵 / キャンサー", () => {
  const c = card("BSFT01-TR06(A)");

  it("front 2効果: 鍵共通stub / スタックexhaust(2体まで,attack,per_card_name)+rebirth許可窓", () => {
    expect(c.effects).toHaveLength(2);
    const stack = c.effects![1]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    expect(stack.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("exhaust");
    if (action.kind === "exhaust" && "filter" in action.target) {
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.count).toEqual({ min: 0, max: 2 });
    }
    // 【転醒】許可窓 (bsft01-tr-rebirth-permission-window): stack_body 実行後の
    // optional rebirth ステップ。
    const rebirthWindow = stack.steps[1]!;
    expect(rebirthWindow.action).toEqual({
      kind: "rebirth",
      allowPostRebirthCorePlacementForLvDeficit: true,
      postRebirthChoice: {
        kind: "core_distribute",
        minimum: "back_face_lv",
      },
    });
    expect(rebirthWindow.executionMode).toBe("optional");
    // combine_window: rebirth_window が不発のときのみ提示する合体分岐 (択一)。
    const combineWindow = stack.steps[2]!;
    expect(combineWindow.executionMode).toBe("optional");
    expect(combineWindow.action.kind).toBe("brave_combine_effect");
    expect(stack.stub).toBeUndefined();
  });

  it("[board] スタック exhaust(count=1 固定): 相手1体が疲労する", () => {
    const src = createCardInstance(c, {
      instanceId: "cancer-tr06",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemy = createCardInstance(card(ENEMY_CARD), {
      instanceId: "enemy-tr06",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const stack = c.effects![1]!;
    const a = stack.steps[0]!.action;
    if (a.kind !== "exhaust" || !("filter" in a.target))
      throw new Error("expected exhaust filter");
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        { action: { kind: "exhaust", target: { ...a.target, count: 1 } } },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemy] }),
      fixed,
      "cancer-tr06"
    );
    const enemyAfter = after.cardInstances.find(
      (x) => x.instanceId === "enemy-tr06"
    )!;
    expect(enemyAfter.exhaustState).toBe("exhausted");
  });

  // 旧 [board] back 転醒時 count_increase テストは削除: flip 時カウント+1 はルールで
  // executeRebirth が適用する。boilerplate の効果化は rebirth-boilerplate-guard が禁止。
});

// ════════════════════════════════════════════════════════════════
// TR07 処女宮の鍵 — front: フラッシュ exhaust + end_battle
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR07 処女宮の鍵 / バルゴ", () => {
  const c = card("BSFT01-TR07(A)");
  const back = c.backFace!;
  const getDefWithBack = (id: string): CardDefinition | undefined =>
    id === back.cardNo ? back : getDef(id);

  it("front フラッシュ exhaust(spirit/ult/nexus 1体)・バトル終了", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("exhaust");
    if (action.kind === "exhaust" && "filter" in action.target) {
      expect(action.target.filter.category).toEqual([
        "spirit",
        "ultimate",
        "nexus",
      ]);
      expect(action.target.count).toBe(1);
    }
    expect(flash.steps[1]!.action.kind).toBe("end_battle");
    expect(flash.stub).toBeUndefined();
  });

  it("[board] フラッシュ: 相手ネクサスを疲労させ、アタックステップではなく現在のバトルだけを終了する", () => {
    const src = createCardInstance(c, {
      instanceId: "virgo-tr07",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-tr07",
      ownerPlayerId: BOB,
      zone: "field",
      exhaustState: "recovered",
    });
    const attacker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-attacker-tr07",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack-tr07-end-battle",
      primaryEntityId: "be-lucy-tr07",
      participantEntityIds: ["be-lucy-tr07"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-lucy-tr07", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-lucy-tr07"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const beforeDerived = runEffect(
      {
        ...createEmptyGameState({
          cardInstances: [src, enemyNexus, attacker],
        }),
        activePlayerId: ALICE,
        step: "attack",
        window: "flash_before_block",
        activeAttack,
        battleEntities: [
          {
            entityId: "be-lucy-tr07",
            memberInstanceIds: ["lucy-attacker-tr07"],
            resolvedBp: 3000,
            resolvedSymbols: ["yellow"],
            attackState: "attacking",
          },
        ],
      },
      c.effects![1]!,
      "virgo-tr07"
    );
    expect(beforeDerived.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "virgo-tr07",
    });
    expect(beforeDerived.activeAttack).toBeNull();

    const after = declineRebirthWindowIfPending(beforeDerived);
    const nexusAfter = after.cardInstances.find(
      (x) => x.instanceId === "nexus-tr07"
    )!;
    expect(nexusAfter.exhaustState).toBe("exhausted");
    expect(after.activeAttack).toBeNull();
    expect(after.step).toBe("attack");
    expect(after.window).toBe("none");
    expect(after.battlesEndedThisTurn).toBe(1);
    expect(after.log).toContain("battle:end:attack-tr07-end-battle");
    expect(after.log).not.toContain("effect:end_attack_step:player-1");
  });

  it("[board] フラッシュのバトル終了は battle_end deferred を発火し、battle_was_blocked を渡す", () => {
    const deferredRecoverDefinition: CardDefinition = {
      cardNo: "TEST-BATTLE-END-DEFERRAL",
      name: "battle_end deferred test",
      category: "spirit",
      color: "yellow",
      symbolColors: ["yellow"],
      cost: 0,
      levelDefs: [{ level: 1, cost: 0, bp: 1000 }],
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          condition: [{ kind: "battle_was_blocked" }],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          textRef: [0],
        },
      ],
    };
    const getDefWithDeferredTest = (id: string): CardDefinition | undefined =>
      id === deferredRecoverDefinition.cardNo
        ? deferredRecoverDefinition
        : getDefWithBack(id);
    const src = createCardInstance(c, {
      instanceId: "virgo-tr07-deferred",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const attacker = createCardInstance(deferredRecoverDefinition, {
      instanceId: "seireiou-tr07-deferred",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "blocker-tr07-deferred",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-tr07-deferred",
      ownerPlayerId: BOB,
      zone: "field",
      exhaustState: "recovered",
    });

    const attackId = "attack-tr07-end-battle-deferred";
    const beforeDerived = runEffect(
      {
        ...createEmptyGameState({
          cardInstances: [src, enemyNexus, attacker, blocker],
        }),
        activePlayerId: ALICE,
        step: "attack",
        window: "flash_after_block",
        activeAttack: {
          attackId,
          primaryEntityId: "be-seireiou-tr07",
          participantEntityIds: ["be-seireiou-tr07"],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [
            {
              participantEntityId: "be-seireiou-tr07",
              blockedByEntityIds: ["be-blocker-tr07"],
            },
          ],
          symbolResolutionOrder: ["be-seireiou-tr07"],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "be-seireiou-tr07",
            memberInstanceIds: ["seireiou-tr07-deferred"],
            resolvedBp: 30000,
            resolvedSymbols: ["guide"],
            attackState: "attacking",
          },
          {
            entityId: "be-blocker-tr07",
            memberInstanceIds: ["blocker-tr07-deferred"],
            resolvedBp: 3000,
            resolvedSymbols: ["yellow"],
            attackState: "blocking",
          },
        ],
        pendingBattleEndDeferrals: [
          {
            deferralId: "deferral-tr07-x01-recover",
            attackId,
            actingPlayerId: ALICE,
            sourceInstanceId: "seireiou-tr07-deferred",
            sourceDefinitionId: deferredRecoverDefinition.cardNo,
            effectIndex: 0,
          },
        ],
      },
      c.effects![1]!,
      "virgo-tr07-deferred",
      getDefWithDeferredTest
    );

    expect(beforeDerived.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "virgo-tr07-deferred",
    });
    expect(beforeDerived.pendingBattleEndDeferrals).toHaveLength(1);
    expect(beforeDerived.pendingImmediateBattleEnds).toHaveLength(1);
    expect(beforeDerived.log).not.toContain(
      `battle:end-deferral:fire:${attackId}:seireiou-tr07-deferred:0`
    );

    const after = declineRebirthWindowIfPending(
      beforeDerived,
      getDefWithDeferredTest
    );

    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.log).toContain(
      `battle:end-deferral:fire:${attackId}:seireiou-tr07-deferred:0`
    );
    expect(
      after.cardInstances.find(
        (x) => x.instanceId === "seireiou-tr07-deferred"
      )!.exhaustState
    ).toBe("recovered");
  });

  it("[board] immediate battle_end 後の optional deck_reveal 解決後に battle_end deferral を発火する", () => {
    const deferredRecoverDefinition: CardDefinition = {
      cardNo: "TEST-BATTLE-END-DECK-DEFERRAL",
      name: "battle_end deck pending deferral test",
      category: "spirit",
      color: "yellow",
      symbolColors: ["yellow"],
      cost: 0,
      levelDefs: [{ level: 1, cost: 0, bp: 1000 }],
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          condition: [{ kind: "battle_was_blocked" }],
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          textRef: [0],
        },
      ],
    };
    const immediateThenRevealDefinition: CardDefinition = {
      cardNo: "TEST-IMMEDIATE-END-BATTLE-THEN-DECK",
      name: "immediate end battle then deck reveal",
      category: "spirit",
      color: "yellow",
      symbolColors: ["yellow"],
      cost: 0,
      levelDefs: [{ level: 1, cost: 0, bp: 1000 }],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            { id: "end", action: { kind: "end_battle" } },
            {
              id: "reveal",
              executionMode: "optional",
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [
                  {
                    count: 1,
                    filter: {
                      category: ["brave"],
                      tribesRequired: ["光導", "鍵"],
                    },
                    destination: "hand",
                  },
                ],
                remainder: "trash",
              },
            },
          ],
        },
      ],
    };
    const getDefWithSynthetic = (id: string): CardDefinition | undefined =>
      id === deferredRecoverDefinition.cardNo
        ? deferredRecoverDefinition
        : id === immediateThenRevealDefinition.cardNo
          ? immediateThenRevealDefinition
          : getDefWithBack(id);
    const src = createCardInstance(immediateThenRevealDefinition, {
      instanceId: "end-then-reveal-source",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const attacker = createCardInstance(deferredRecoverDefinition, {
      instanceId: "end-then-reveal-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "end-then-reveal-blocker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const deckCard = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "end-then-reveal-pick",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const attackId = "attack-end-then-reveal";
    const before = {
      ...createEmptyGameState({
        cardInstances: [src, attacker, blocker, deckCard],
        playerOverrides: [{ deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "flash_after_block" as const,
      activeAttack: {
        attackId,
        primaryEntityId: "be-end-then-reveal-attacker",
        participantEntityIds: ["be-end-then-reveal-attacker"],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "be-end-then-reveal-attacker",
            blockedByEntityIds: ["be-end-then-reveal-blocker"],
          },
        ],
        symbolResolutionOrder: ["be-end-then-reveal-attacker"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-end-then-reveal-attacker",
          memberInstanceIds: ["end-then-reveal-attacker"],
          resolvedBp: 30000,
          resolvedSymbols: ["guide"],
          attackState: "attacking" as const,
        },
        {
          entityId: "be-end-then-reveal-blocker",
          memberInstanceIds: ["end-then-reveal-blocker"],
          resolvedBp: 3000,
          resolvedSymbols: ["yellow"],
          attackState: "blocking" as const,
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "deferral-end-then-reveal",
          attackId,
          actingPlayerId: ALICE,
          sourceInstanceId: "end-then-reveal-attacker",
          sourceDefinitionId: deferredRecoverDefinition.cardNo,
          effectIndex: 0,
        },
      ],
    };

    const afterEnd = runEffect(
      before,
      immediateThenRevealDefinition.effects![0]!,
      "end-then-reveal-source",
      getDefWithSynthetic
    );
    expect(afterEnd.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "end-then-reveal-source",
    });
    expect(afterEnd.pendingImmediateBattleEnds).toHaveLength(1);
    expect(afterEnd.pendingBattleEndDeferrals).toHaveLength(1);

    const pendingOptional = afterEnd.pendingStepOptionalChoice!;
    const afterExecuteOptional = applyLegalAction({
      state: afterEnd,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pendingOptional.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pendingOptional.actingPlayerId,
        pendingId: pendingOptional.pendingId,
        sourceInstanceId: pendingOptional.sourceInstanceId,
        effectIndex: pendingOptional.effectIndex,
        stepIndex: pendingOptional.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDefWithSynthetic,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(afterExecuteOptional.pendingDeckReveal).not.toBeNull();
    expect(afterExecuteOptional.pendingImmediateBattleEnds).toHaveLength(1);
    expect(afterExecuteOptional.log).not.toContain(
      `battle:end-deferral:fire:${attackId}:end-then-reveal-attacker:0`
    );

    const pickAction = getLegalActions({
      state: afterExecuteOptional,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithSynthetic,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterExecuteOptional,
      action: pickAction!,
      getCardDefinitionById: getDefWithSynthetic,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: ["end-then-reveal-pick"],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    expect(afterPick.pendingImmediateBattleEnds).toHaveLength(0);
    expect(afterPick.pendingBattleEndDeferrals).toHaveLength(0);
    expect(afterPick.log).toContain(
      `battle:end-deferral:fire:${attackId}:end-then-reveal-attacker:0`
    );
    expect(
      afterPick.cardInstances.find(
        (x) => x.instanceId === "end-then-reveal-attacker"
      )!.exhaustState
    ).toBe("recovered");
  });

  it("[board] battle_end deferral の deck_reveal pending 解決完了まで battle scope CE を失効しない", () => {
    const deferredDeckDefinition: CardDefinition = {
      cardNo: "TEST-BATTLE-END-DECK-PENDING-FINALIZE",
      name: "battle_end deck pending finalize test",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          condition: [{ kind: "battle_was_blocked" }],
          steps: [
            {
              id: "battle-end-reveal",
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [
                  {
                    count: 1,
                    filter: {
                      category: ["brave"],
                      tribesRequired: ["光導", "鍵"],
                    },
                    destination: "hand",
                  },
                ],
                remainder: "trash",
              },
            },
          ],
          textRef: [0],
        },
      ],
    };
    const getDefWithSynthetic = (id: string): CardDefinition | undefined =>
      id === deferredDeckDefinition.cardNo
        ? deferredDeckDefinition
        : getDefWithBack(id);
    const src = createCardInstance(c, {
      instanceId: "virgo-tr07-deferred-deck-finalize",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-tr07-deferred-deck-finalize",
      ownerPlayerId: BOB,
      zone: "field",
      exhaustState: "recovered",
    });
    const attacker = createCardInstance(deferredDeckDefinition, {
      instanceId: "attacker-tr07-deferred-deck-finalize",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "blocker-tr07-deferred-deck-finalize",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const deckCard = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "pick-tr07-deferred-deck-finalize",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const attackId = "attack-tr07-deferred-deck-finalize";
    const beforeBase = {
      ...createEmptyGameState({
        cardInstances: [src, enemyNexus, attacker, blocker, deckCard],
        playerOverrides: [{ deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "flash_after_block" as const,
      activeAttack: {
        attackId,
        primaryEntityId: "be-attacker-tr07-deferred-deck-finalize",
        participantEntityIds: ["be-attacker-tr07-deferred-deck-finalize"],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "be-attacker-tr07-deferred-deck-finalize",
            blockedByEntityIds: ["be-blocker-tr07-deferred-deck-finalize"],
          },
        ],
        symbolResolutionOrder: ["be-attacker-tr07-deferred-deck-finalize"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-attacker-tr07-deferred-deck-finalize",
          memberInstanceIds: ["attacker-tr07-deferred-deck-finalize"],
          resolvedBp: 1000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking" as const,
        },
        {
          entityId: "be-blocker-tr07-deferred-deck-finalize",
          memberInstanceIds: ["blocker-tr07-deferred-deck-finalize"],
          resolvedBp: 1000,
          resolvedSymbols: ["yellow"],
          attackState: "blocking" as const,
        },
      ],
      pendingBattleEndDeferrals: [
        {
          deferralId: "deferral-tr07-deferred-deck-finalize",
          attackId,
          actingPlayerId: ALICE,
          sourceInstanceId: "attacker-tr07-deferred-deck-finalize",
          sourceDefinitionId: deferredDeckDefinition.cardNo,
          effectIndex: 0,
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-tr07-deferred-deck-finalize",
          sourceInstanceId: "attacker-tr07-deferred-deck-finalize",
          sourceDefinitionId: deferredDeckDefinition.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "battle" },
          createdAtTurn: 1,
          createdAtAttackId: attackId,
          modifierTag: "defense_immune",
          targetInstanceId: "attacker-tr07-deferred-deck-finalize",
        },
      ],
    };
    expect(
      beforeBase.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "attacker-tr07-deferred-deck-finalize" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeDefined();

    const beforeDerived = runEffect(
      beforeBase,
      c.effects![1]!,
      "virgo-tr07-deferred-deck-finalize",
      getDefWithSynthetic
    );
    expect(beforeDerived.pendingImmediateBattleEnds).toHaveLength(1);

    const afterEnd = declineRebirthWindowIfPending(
      beforeDerived,
      getDefWithSynthetic
    );
    expect(afterEnd.pendingDeckReveal).not.toBeNull();
    expect(
      afterEnd.pendingDeckReveal!.continuation?.battleEndDeferralAttackId
    ).toBe(attackId);
    expect(afterEnd.pendingBattleEndFinalizeAttackIds).toContain(attackId);
    expect(
      afterEnd.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "attacker-tr07-deferred-deck-finalize" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeDefined();

    const pickAction = getLegalActions({
      state: afterEnd,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithSynthetic,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterEnd,
      action: pickAction!,
      getCardDefinitionById: getDefWithSynthetic,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: ["pick-tr07-deferred-deck-finalize"],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    expect(afterPick.pendingBattleEndFinalizeAttackIds).not.toContain(attackId);
    expect(
      afterPick.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "attacker-tr07-deferred-deck-finalize" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeUndefined();
  });

  it("[legal] ただちにバトル終了後も同一効果から派生する転醒 optional を提示する", () => {
    const src = createCardInstance(c, {
      instanceId: "virgo-tr07-order",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-tr07-order",
      ownerPlayerId: BOB,
      zone: "field",
      exhaustState: "recovered",
    });
    const attacker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-attacker-tr07-order",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const attackId = "attack-tr07-order";
    const beforeDerived = runEffect(
      {
        ...createEmptyGameState({
          cardInstances: [src, enemyNexus, attacker],
        }),
        activePlayerId: ALICE,
        step: "attack",
        window: "flash_before_block",
        activeAttack: {
          attackId,
          primaryEntityId: "be-lucy-tr07-order",
          participantEntityIds: ["be-lucy-tr07-order"],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [
            {
              participantEntityId: "be-lucy-tr07-order",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["be-lucy-tr07-order"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "be-lucy-tr07-order",
            memberInstanceIds: ["lucy-attacker-tr07-order"],
            resolvedBp: 3000,
            resolvedSymbols: ["yellow"],
            attackState: "attacking",
          },
        ],
      },
      c.effects![1]!,
      "virgo-tr07-order"
    );
    expect(beforeDerived.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "virgo-tr07-order",
    });
    expect(beforeDerived.activeAttack).toBeNull();

    const optionalActions = getLegalActions({
      state: beforeDerived,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      optionalActions.some(
        (action) => action.kind === "resolve_pending_step_optional_choice"
      )
    ).toBe(true);

    const after = declineRebirthWindowIfPending(beforeDerived);
    const battleEndedActions = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.activeAttack).toBeNull();
    expect(
      battleEndedActions.some(
        (action) => action.kind === "resolve_pending_step_optional_choice"
      )
    ).toBe(false);
  });

  it("[stack] ただちにバトル終了後の転醒 optional が開いたら後続 stack を退避して中断する", () => {
    const optionalFlashDef: CardDefinition = {
      cardNo: "TEST-TR07-CASCADE-OPTIONAL-FLASH",
      name: "stack cascade optional regression",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: ["フラッシュ：自分は1枚ドローできる。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "optional-draw",
              executionMode: "optional",
              action: { kind: "draw", count: 1 },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const mandatoryFlashDef: CardDefinition = {
      cardNo: "TEST-TR07-CASCADE-MANDATORY-FLASH",
      name: "stack cascade resumed effect",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: ["フラッシュ：自分は1枚ドローする。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ id: "mandatory-draw", action: { kind: "draw", count: 1 } }],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const fieldLookup = buildFieldCardEffectLookup([
      optionalFlashDef,
      mandatoryFlashDef,
    ]);
    const src = createCardInstance(optionalFlashDef, {
      instanceId: "optional-flash-source-tr07-cascade",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const resumedSrc = createCardInstance(mandatoryFlashDef, {
      instanceId: "mandatory-flash-source-tr07-cascade",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const getDefForCascade = (id: string): CardDefinition | undefined =>
      id === optionalFlashDef.cardNo
        ? optionalFlashDef
        : id === mandatoryFlashDef.cardNo
          ? mandatoryFlashDef
          : getDefWithBack(id);
    const makeStack = (
      stackId: string,
      sourceInstanceId: string,
      sourceDefinitionId: string
    ): ActiveStack => ({
      stackId,
      actionKind: "field_card_effect",
      chainId: "chain-tr07-cascade",
      actingPlayerId: ALICE,
      cardInstanceId: sourceInstanceId,
      cardDefinitionId: sourceDefinitionId,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      fieldEffectSourceKind: "spirit",
      fieldEffectRegistrationIndex: 0,
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    });
    const before = {
      ...createEmptyGameState({
        cardInstances: [src, resumedSrc],
        playerOverrides: [{ deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "stack" as const,
    };

    const after = resolveStackCascade(
      before,
      [
        makeStack(
          "stack-tr07-first",
          "optional-flash-source-tr07-cascade",
          optionalFlashDef.cardNo
        ),
        makeStack(
          "stack-tr07-second",
          "mandatory-flash-source-tr07-cascade",
          mandatoryFlashDef.cardNo
        ),
      ],
      {
        getCardDefinitionById: getDefForCascade,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(after.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "optional-flash-source-tr07-cascade",
      sourceDefinitionId: optionalFlashDef.cardNo,
    });
    expect(
      after.pendingStackCascade?.remainingStacks.map((s) => s.stackId)
    ).toEqual(["stack-tr07-second"]);

    const pending = after.pendingStepOptionalChoice!;
    const resumed = applyLegalAction({
      state: after,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: getDefForCascade,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(resumed.pendingStepOptionalChoice).toBeNull();
    expect(resumed.pendingStackCascade).toBeNull();
    expect(resumed.players.find((p) => p.id === ALICE)!.handCount).toBe(
      before.players.find((p) => p.id === ALICE)!.handCount + 1
    );
    expect(resumed.players.find((p) => p.id === ALICE)!.deckCount).toBe(0);
  });

  it("[stack] ただちにバトル終了確定後は通常の後続 stack cascade を再開しない", () => {
    const mandatoryFlashDef: CardDefinition = {
      cardNo: "TEST-TR07-END-BATTLE-CANCELS-CASCADE",
      name: "end battle canceled cascade regression",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: ["フラッシュ：自分は1枚ドローする。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ id: "mandatory-draw", action: { kind: "draw", count: 1 } }],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const fieldLookup = buildFieldCardEffectLookup([mandatoryFlashDef]);
    const getDefForCascade = (id: string): CardDefinition | undefined =>
      id === mandatoryFlashDef.cardNo ? mandatoryFlashDef : getDefWithBack(id);
    const src = createCardInstance(c, {
      instanceId: "virgo-tr07-cancel-cascade",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-tr07-cancel-cascade",
      ownerPlayerId: BOB,
      zone: "field",
      exhaustState: "recovered",
    });
    const attacker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "attacker-tr07-cancel-cascade",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const laterStackSource = createCardInstance(mandatoryFlashDef, {
      instanceId: "later-stack-tr07-cancel-cascade",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const attackId = "attack-tr07-cancel-cascade";
    const before = {
      ...createEmptyGameState({
        cardInstances: [src, enemyNexus, attacker, laterStackSource],
        playerOverrides: [{ deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "flash_before_block" as const,
      activeAttack: {
        attackId,
        primaryEntityId: "be-attacker-tr07-cancel-cascade",
        participantEntityIds: ["be-attacker-tr07-cancel-cascade"],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "be-attacker-tr07-cancel-cascade",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["be-attacker-tr07-cancel-cascade"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-attacker-tr07-cancel-cascade",
          memberInstanceIds: ["attacker-tr07-cancel-cascade"],
          resolvedBp: 1000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking" as const,
        },
      ],
      pendingStackCascade: {
        remainingStacks: [
          {
            stackId: "stack-tr07-canceled-after-end",
            actionKind: "field_card_effect",
            chainId: "chain-tr07-canceled-after-end",
            actingPlayerId: ALICE,
            cardInstanceId: "later-stack-tr07-cancel-cascade",
            cardDefinitionId: mandatoryFlashDef.cardNo,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            fieldEffectSourceKind: "spirit",
            fieldEffectRegistrationIndex: 0,
            chosenTiming: "flash",
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        ],
      },
    };

    const beforeDerived = runEffect(
      before,
      c.effects![1]!,
      "virgo-tr07-cancel-cascade",
      getDefForCascade
    );
    expect(beforeDerived.pendingImmediateBattleEnds).toHaveLength(1);
    expect(beforeDerived.pendingStackCascade?.remainingStacks).toHaveLength(1);

    let after = beforeDerived;
    while (after.pendingStepOptionalChoice) {
      const pending = after.pendingStepOptionalChoice;
      after = applyLegalAction({
        state: after,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${pending.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice: "decline",
        },
        getCardDefinitionById: getDefForCascade,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredBurstActions: () => undefined,
      }).state;
    }

    expect(after.pendingImmediateBattleEnds).toHaveLength(0);
    expect(after.pendingStackCascade).toBeNull();
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      before.players.find((p) => p.id === ALICE)!.handCount
    );
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      before.players.find((p) => p.id === ALICE)!.deckCount
    );
  });

  it("[board] engine-single-battle-end: フラッシュ発揮で進行中のバトルがBP比較/ライフダメージ無しで即終了する", () => {
    const src = createCardInstance(c, {
      instanceId: "virgo-tr07-end-battle",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-tr07-end-battle",
      ownerPlayerId: BOB,
      zone: "field",
      exhaustState: "recovered",
    });
    const opponentAttacker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "opp-attacker-tr07",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [src, enemyNexus, opponentAttacker],
        activeAttack: {
          attackId: "attack-tr07-end",
          primaryEntityId: "be-tr07-attacker",
          participantEntityIds: ["be-tr07-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [
            {
              participantEntityId: "be-tr07-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["be-tr07-attacker"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "be-tr07-attacker",
            memberInstanceIds: ["opp-attacker-tr07"],
            // 通常解決なら BP 比較 + ライフダメージが確実に発生する値だが、
            // end_single_battle はそれらを丸ごとスキップすることを検証する。
            resolvedBp: 9999999,
            resolvedSymbols: ["yellow", "yellow", "yellow"],
            attackState: "attacking",
          },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
    };
    const aliceLifeBefore = getPlayerLifeCoreCount(
      before.players.find((p) => p.id === ALICE)!
    );

    const after = runEffect(before, c.effects![1]!, "virgo-tr07-end-battle");

    expect(after.activeAttack).toBeNull();
    expect(after.battleResolutionGroup).toBeNull();
    expect(after.battlesEndedThisTurn).toBe(1);
    expect(
      getPlayerLifeCoreCount(after.players.find((p) => p.id === ALICE)!)
    ).toBe(aliceLifeBefore);
    // 同一フラッシュ内の疲労アクションも実行されている。
    expect(
      after.cardInstances.find((x) => x.instanceId === "nexus-tr07-end-battle")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("back 星霊衣アタック時: void→field/reserve split + conditional unblockable", () => {
    const attack = back.effects![0]!;
    expect(attack.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(attack.executionMode).toBe("optional");
    expect(attack.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(attack.stub).toBeUndefined();
    const move = attack.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "void", player: "self" });
      expect(move.amount).toBe(1);
      expect(
        move.splitDestinations?.destinations.map((d) => d.location)
      ).toEqual([
        { kind: "field", player: "self" },
        { kind: "reserve", player: "self" },
      ]);
    }
    const unblockable = attack.steps[1]!;
    expect(unblockable.connector).toBe("conditional_cost");
    expect(unblockable.action.kind).toBe("unblockable");
  });

  it("[board] back 星霊衣アタック時: reserve 選択後にこのバトル unblockable が登録される", () => {
    const src = createCardInstance(back, {
      instanceId: "virgo-tr07b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      startingVoidNormalCoreCount: 3,
      cardInstances: [src],
    });
    const reserveBefore = alice(base).reserveNormalCoreCount;
    const opened = executeEffect({
      chainId: "test:bsft01-cards:11895",
      state: base,
      effect: back.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "virgo-tr07b",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(opened.pendingCoreSplitSelection).not.toBeNull();

    const split = getLegalActions({
      state: opened,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_core_split");
    expect(split).toBeDefined();
    const resolved = applyLegalAction({
      state: opened,
      action: split!,
      coreSplitDistribution: [0, 1],
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(resolved.pendingCoreSplitSelection).toBeNull();
    expect(alice(resolved).reserveNormalCoreCount).toBe(reserveBefore + 1);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === "virgo-tr07b" &&
          ce.duration.scope === "battle"
      )
    ).toBe(true);
  });

  it("[board] back 星霊衣アタック時: field 選択は core distribution 後に unblockable へ resume する", () => {
    const src = createCardInstance(back, {
      instanceId: "virgo-tr07b-field",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const ally = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-tr07b-field",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const opened = executeEffect({
      chainId: "test:bsft01-cards:11946",
      state: createEmptyGameState({
        startingVoidNormalCoreCount: 3,
        cardInstances: [src, ally],
      }),
      effect: back.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "virgo-tr07b-field",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const split = getLegalActions({
      state: opened,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_core_split")!;
    const afterSplit = applyLegalAction({
      state: opened,
      action: split,
      coreSplitDistribution: [1, 0],
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(afterSplit.pendingCoreDistribution).not.toBeNull();
    expect(
      afterSplit.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "unblockable"
      )
    ).toBe(false);

    const distribution = getLegalActions({
      state: afterSplit,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(distribution).toBeDefined();
    const resolved = applyLegalAction({
      state: afterSplit,
      action: distribution!,
      coreDistributionAllocations: { "virgo-tr07b-field": 1 },
      getCardDefinitionById: getDefWithBack,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find((x) => x.instanceId === "virgo-tr07b-field")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === "virgo-tr07b-field"
      )
    ).toBe(true);

    const blocker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-blocker-tr07b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const blockState: GameState = {
      ...resolved,
      cardInstances: [...resolved.cardInstances, blocker],
      step: "attack",
      window: "declare_block",
      activePlayerId: ALICE,
      activeAttack: {
        attackId: "attack-tr07b-unblockable",
        primaryEntityId: "be-tr07b-attacker",
        participantEntityIds: ["be-tr07b-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "be-tr07b-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["be-tr07b-attacker"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-tr07b-attacker",
          memberInstanceIds: ["virgo-tr07b-field"],
          resolvedBp: 3000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
    };
    expect(
      getBlockDeclarationBlockReason({
        state: blockState,
        actingPlayerId: BOB,
        sourceInstanceId: "lucy-blocker-tr07b",
        participantEntityId: "be-tr07b-attacker",
        getCardDefinitionById: getDefWithBack,
      })
    ).toBe("attacker_unblockable");

    const unblockableEffect = resolved.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "unblockable" &&
        ce.targetInstanceId === "virgo-tr07b-field"
    );
    expect(unblockableEffect).toBeDefined();
    const tentativeBlockState = useBlockAsAction({
      state: {
        ...blockState,
        activeContinuousEffects: blockState.activeContinuousEffects.filter(
          (ce) => ce.effectId !== unblockableEffect!.effectId
        ),
      },
      actingPlayerId: BOB,
      sourceInstanceId: "lucy-blocker-tr07b",
      participantEntityId: "be-tr07b-attacker",
      getCardDefinitionById: getDefWithBack,
    });
    const afterLateUnblockable: GameState = {
      ...tentativeBlockState,
      activeContinuousEffects: [
        ...tentativeBlockState.activeContinuousEffects,
        unblockableEffect!,
      ],
    };
    const afterPass = usePassPreDeclarationStackAsAction({
      state: afterLateUnblockable,
      actingPlayerId: ALICE,
    });
    const cancelled = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getDefWithBack }
    );

    expect(cancelled.blockerEntityId).toBe("");
    expect(cancelled.state.window).toBe("declare_block");
    expect(
      cancelled.state.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toHaveLength(0);
    expect(
      cancelled.state.log.some((line) =>
        line.includes("legality-changed:attacker_unblockable")
      )
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// TR08 磨羯宮の鍵 — front: フラッシュ全stub / back: BP+3000（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR08 磨羯宮の鍵 / カプリコーン", () => {
  const c = card("BSFT01-TR08(A)");

  it("front フラッシュは「ルーシィ」すべてに疲労状態ブロック許可を付与", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.stub).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("allow_block_while_exhausted");
    if (action.kind === "allow_block_while_exhausted") {
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "self",
        count: "all",
      });
    }
  });

  it("back 星霊衣ブロック時 bounce + Lv2-Lv3 BP+3000", () => {
    const back = c.backFace!;
    const block = back.effects!.find((e) => e.timing.kind === "card_event");
    expect(block?.timing).toEqual({ kind: "card_event", event: "block" });
    expect(block?.stub).toBeUndefined();
    expect(block?.steps[0]?.action.kind).toBe("bounce");
    const bp = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "bp_modify"
    )!;
    expect(bp.condition).toContainEqual({ kind: "min_level", value: 2 });
    const action = bp.steps[0]!.action;
    if (action.kind === "bp_modify") {
      expect(action.amount).toBe(3000);
    }
  });

  it("[board] back BP+3000: BP 修飾 CE が登録される (condition 非依存で検証)", () => {
    const back = c.backFace!;
    const src = createCardInstance(c, {
      instanceId: "capri-tr08b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const bp = back.effects!.find(
      (e) => e.steps[0]?.action.kind === "bp_modify"
    )!;
    // Lv 条件を外して BP 修飾アクション本体の盤面効果を検証する。
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "continuous" },
      steps: bp.steps,
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src] }),
      fixed,
      "capri-tr08b"
    );
    expect(after.activeContinuousEffects.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════
// TR09 白羊宮の鍵 — front: スタック life_damage_interception attackerFilter（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR09 白羊宮の鍵 / アリエス", () => {
  const c = card("BSFT01-TR09(A)");

  it("front スタック life_damage_interception(self, battle, attackerFilter:[spirit,ultimate]) + field_has ルーシィ gate", () => {
    const stack = c.effects![1]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "ルーシィ" }],
      includeSoulState: true,
    });
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.player).toBe("self");
      expect(action.cause).toBe("any");
      expect(action.mode).toBe("replace");
      expect(action.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
      });
      expect(action.duration).toEqual({ scope: "battle", nextBattleEnd: true });
      expect(action.battleOnly).toBe(true);
    }
  });

  it("[board] front スタック: life_damage_interception CE が attackerFilter 付きで登録される (field_has ルーシィ 充足)", () => {
    const src = createCardInstance(c, {
      instanceId: "aries-tr09",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // 発揮ゲート「自分の「ルーシィ」がいる」を充足させる。
    const lucy = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "lucy-aries",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, lucy] }),
      c.effects![1]!,
      "aries-tr09"
    );
    const interception = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "life_damage_interception"
    );
    expect(interception).toBeDefined();
    expect(interception?.duration).toEqual({
      scope: "battle",
      nextBattleEnd: true,
    });
    expect(interception?.metadata?.attackerFilter).toEqual({
      category: ["spirit", "ultimate"],
    });
  });

  it("back 星霊衣ブロック時: 相手スピリット2体疲労 + BP+5000", () => {
    const back = c.backFace!;
    const block = back.effects!.find(
      (effect) => effect.timing.kind === "card_event"
    )!;
    expect(block.timing).toEqual({ kind: "card_event", event: "block" });
    expect(block.stub).toBeUndefined();
    expect(block.steps[0]!.action).toMatchObject({
      kind: "exhaust",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 2,
      },
    });
    expect(block.steps[1]!.action).toEqual({
      kind: "bp_modify",
      target: { kind: "self" },
      amount: 5000,
      duration: { scope: "battle" },
    });
  });
});

// ════════════════════════════════════════════════════════════════
// TR10 天蠍宮の鍵 — front: 効果抑制 / back: 転醒時 prevent_battle（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR10 天蠍宮の鍵 / スコーピオン", () => {
  const c = card("BSFT01-TR10(A)");

  it("BSFT01-TR10(A) front スタックは対象1体の全効果を次のバトル終了後まで抑止する", () => {
    const stack = c.effects![1]!;
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("suppress_effect");
    if (action.kind === "suppress_effect") {
      expect(action.effectFilter).toBeUndefined();
      expect(action.duration).toEqual({ scope: "battle", nextBattleEnd: true });
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      });
    }
    expect(stack.stub).toBeUndefined();
  });

  it("[board] BSFT01-TR10(A): スタック解決で対象カードに blanket effect_suppression CE が登録される", () => {
    const src = createCardInstance(c, {
      instanceId: "tr10-front",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemy = createCardInstance(card(ENEMY_CARD), {
      instanceId: "enemy-tr10-front",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemy] }),
      c.effects![1]!,
      "tr10-front"
    );
    const suppression = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "enemy-tr10-front"
    );
    expect(suppression).toBeDefined();
    expect(suppression?.metadata?.effectFilter).toBeUndefined();
    expect(suppression?.duration).toEqual({
      scope: "battle",
      nextBattleEnd: true,
    });
  });

  it.each([
    ["BSFT01-C03", true],
    ["BSFT01-X01", true],
    ["BSFT01-CX01", false],
  ] as const)(
    "[board] BSFT01-TR01(A) の防止貫通は防止元 %s が nexus/ultimate の場合だけ TR10(A) suppress_effect を通す",
    (blockerDefinitionId, shouldPierce) => {
      const grantSource = createCardInstance(card("BSFT01-TR01(A)"), {
        instanceId: `tr01-grant-for-tr10-suppress-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const suppressSource = createCardInstance(c, {
        instanceId: `tr10-suppress-source-${blockerDefinitionId}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const target = createCardInstance(card(ENEMY_CARD), {
        instanceId: `tr10-suppress-target-${blockerDefinitionId}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
      });
      const grantState = runEffect(
        createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [grantSource, suppressSource, target],
          playerOverrides: [
            { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
            {},
          ],
        }),
        card("BSFT01-TR01(A)").effects![1]!,
        grantSource.instanceId
      );
      const protectedState: GameState = {
        ...grantState,
        pendingStepOptionalChoice: null,
        activeContinuousEffects: [
          ...grantState.activeContinuousEffects,
          {
            effectId: `test-tr10-suppress-defense-immune-${blockerDefinitionId}`,
            sourceInstanceId: `tr10-suppress-immune-source-${blockerDefinitionId}`,
            sourceDefinitionId: blockerDefinitionId,
            actingPlayerId: BOB,
            duration: { scope: "permanent" },
            createdAtTurn: grantState.turnNumber,
            createdAtAttackId: null,
            modifierTag: "defense_immune",
            targetInstanceId: target.instanceId,
          },
        ],
      };

      const after = runEffect(
        protectedState,
        c.effects![1]!,
        suppressSource.instanceId
      );
      const suppression = after.activeContinuousEffects.find(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.targetInstanceId === target.instanceId
      );
      expect(Boolean(suppression)).toBe(shouldPierce);
    }
  );

  it("back Lv1-Lv3 転醒時 prevent_battle(相手1体, attack, turn)", () => {
    const back = c.backFace!;
    const pb = back.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.timing.event === "rebirth" &&
        e.steps[0]?.action.kind === "prevent_battle"
    )!;
    const action = pb.steps[0]!.action;
    if (action.kind === "prevent_battle") {
      expect(action.restriction).toEqual(["attack"]);
      expect(action.duration).toEqual({ scope: "turn" });
    }
  });

  it("[board] back 転醒時 prevent_battle: アタック制限 CE が登録される", () => {
    const back = c.backFace!;
    const src = createCardInstance(c, {
      instanceId: "scorpion-tr10b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemy = createCardInstance(card(ENEMY_CARD), {
      instanceId: "enemy-tr10b",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const pb = back.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.timing.event === "rebirth" &&
        e.steps[0]?.action.kind === "prevent_battle"
    )!;
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemy] }),
      pb,
      "scorpion-tr10b"
    );
    expect(after.activeContinuousEffects.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════
// TR11 獅子宮の鍵 — front: フラッシュ core_move void→life（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR11 獅子宮の鍵 / ロキ", () => {
  const c = card("BSFT01-TR11(A)");
  const back = card("BSFT01-TR11(B)");

  it("front フラッシュ core_move(void→life, 1) + 相手在場 gate + per_card_name", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(flash.condition).toContainEqual({
      kind: "field_has",
      player: "opponent",
      category: ["spirit", "ultimate"],
    });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.from).toEqual({ kind: "void", player: "self" });
      expect(action.to).toEqual({ kind: "life", player: "self" });
      expect(action.amount).toBe(1);
    }
  });

  it("[legal action] magic_compatible brave は手札から use_magic として使用できる", () => {
    const src = createCardInstance(c, {
      instanceId: "loki-tr11-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const enemy = createCardInstance(card(ENEMY_CARD), {
      instanceId: "enemy-tr11-magic-use",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const attacker = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "attacker-tr11-magic-use",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = {
      ...createEmptyGameState({
        cardInstances: [src, attacker, enemy],
        playerOverrides: [
          { reserveNormalCoreCount: 5, voidNormalCoreCount: 3 },
          {},
        ],
      }),
      step: "attack" as const,
      activePlayerId: ALICE,
      window: "flash_before_block" as const,
      activeAttack: {
        attackId: "attack-tr11-magic-use",
        primaryEntityId: "entity-attacker-tr11-magic-use",
        participantEntityIds: ["entity-attacker-tr11-magic-use"],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: ["entity-attacker-tr11-magic-use"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block" as const,
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
    };
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const action = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noFieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "loki-tr11-hand"
    );

    expect(action).toMatchObject({
      kind: "use_magic",
      sourceCardNo: "BSFT01-TR11(A)",
      sourceInstanceId: "loki-tr11-hand",
      timing: "flash",
    });
    if (!action || action.kind !== "use_magic") return;

    const after = applyLegalAction({
      state: before,
      action,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      paymentSources:
        action.finalCost > 0
          ? [{ kind: "reserve", amount: action.finalCost }]
          : [],
    }).state;
    expect(after.activeAttack?.flashWindowState?.pendingStackAction).toEqual(
      expect.objectContaining({
        actionKind: "magic",
        cardInstanceId: "loki-tr11-hand",
        cardDefinitionId: "BSFT01-TR11(A)",
        chosenTiming: "flash",
      })
    );
  });

  it("[board] フラッシュ: 相手在場で ボイドからライフへコア1個移動（ライフコア+1）", () => {
    const src = createCardInstance(c, {
      instanceId: "loki-tr11",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // 発揮ゲート「相手のスピリット/アルティメットがいる」を充足させる。
    const enemy = createCardInstance(card(ENEMY_CARD), {
      instanceId: "enemy-tr11",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, enemy],
      playerOverrides: [{ voidNormalCoreCount: 3, lifeNormalCoreCount: 3 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "loki-tr11");
    expect(alice(after).lifeNormalCoreCount).toBe(4);
    expect(alice(after).voidNormalCoreCount).toBe(2);
  });

  it("back [2,3] 星霊衣: 自分のアタックステップに相手手札使用コストをカウント3ごとに+1する", () => {
    const effect = back.effects![0]!;

    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.timingScope).toEqual({ player: "self", period: "attack" });
    expect(effect.usageLimit).toEqual({ kind: "no_duplicate" });

    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("cost_modify");
    if (action.kind === "cost_modify") {
      expect(action.player).toBe("opponent");
      expect(action.additionalPayment).toBe(true);
      expect(action.cardFilter).toEqual({ zone: ["hand"] });
      expect(action.modifier).toEqual({
        additionalCostValue: {
          source: { kind: "count_value", player: "self" },
          divisor: 3,
        },
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("[board] back 星霊衣: host 経由の追加コスト CE は相手手札だけに適用する", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr11-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    host.underCards = [
      { cardInstanceId: "tr11-under", role: "text_role", roleTag: "星霊衣" },
    ];

    const under = createCardInstance(back, {
      instanceId: "tr11-under",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "tr11-host";
    under.zoneRoleName = "star-garment";

    const before = {
      ...createEmptyGameState({
        cardInstances: [host, under],
        playerOverrides: [{ countValue: 6 }, {}],
      }),
      step: "attack" as const,
      activePlayerId: ALICE,
    };
    const after = rebuildContinuousEffectsFromField(before, getDef);
    const ce = after.activeContinuousEffects.find(
      (candidate) =>
        candidate.modifierTag === "additional_cost" &&
        candidate.provenance?.effectSourceDefinitionId === "BSFT01-TR11(B)"
    );

    expect(ce).toEqual(
      expect.objectContaining({
        sourceInstanceId: "tr11-host",
        sourceDefinitionId: "BSFT01-CX01",
        actingPlayerId: ALICE,
        modifierAmount: 2,
        modifierAmountDynamic: {
          source: { kind: "count_value", player: "self" },
          divisor: 3,
        },
        targetFilter: { player: "opponent", zone: ["hand"] },
        timingScope: { player: "self", period: "attack" },
        provenance: expect.objectContaining({
          effectIndex: 0,
          stepIndex: 0,
          effectSourceInstanceId: "tr11-under",
          effectSourceDefinitionId: "BSFT01-TR11(B)",
        }),
      })
    );
    expect(
      getApplicableAdditionalCostDelta(after, BOB, card("BSFT01-C03"), {
        cardZone: "hand",
        getCardDefinitionById: getDef,
      })
    ).toBe(2);
    const afterCountGain = {
      ...after,
      players: after.players.map((player) =>
        player.id === ALICE ? { ...player, countValue: 9 } : player
      ),
    };
    expect(
      getApplicableAdditionalCostDelta(
        afterCountGain,
        BOB,
        card("BSFT01-C03"),
        {
          cardZone: "hand",
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(3);
    const afterNonSourceProtectedCountGain = {
      ...after,
      players: after.players.map((player) =>
        player.id === ALICE
          ? { ...player, countValue: 9, protectedCounts: { 神喰: 3 } }
          : player
      ),
    };
    expect(
      getApplicableAdditionalCostDelta(
        afterNonSourceProtectedCountGain,
        BOB,
        card("BSFT01-C03"),
        {
          cardZone: "hand",
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(2);
    const afterSourceProtectedCountGain = {
      ...after,
      players: after.players.map((player) =>
        player.id === ALICE
          ? { ...player, countValue: 9, protectedCounts: { 星霊: 3 } }
          : player
      ),
    };
    expect(
      getApplicableAdditionalCostDelta(
        afterSourceProtectedCountGain,
        BOB,
        card("BSFT01-C03"),
        {
          cardZone: "hand",
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(3);
    expect(
      getApplicableAdditionalCostDelta(after, BOB, card("BSFT01-C03"), {
        cardZone: "field",
        getCardDefinitionById: getDef,
      })
    ).toBe(0);
  });

  it("[board] back 星霊衣: roleTag が星霊衣でない text_role では追加コスト CE を登録しない", () => {
    const host = createCardInstance(card("BSFT01-CX01"), {
      instanceId: "tr11-host-non-sg",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    host.underCards = [
      {
        cardInstanceId: "tr11-under-non-sg",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];

    const under = createCardInstance(back, {
      instanceId: "tr11-under-non-sg",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.attachedToInstanceId = "tr11-host-non-sg";
    under.zoneRoleName = "bullet-edit";

    const before = {
      ...createEmptyGameState({
        cardInstances: [host, under],
        playerOverrides: [{ countValue: 6 }, {}],
      }),
      step: "attack" as const,
      activePlayerId: ALICE,
    };
    const after = rebuildContinuousEffectsFromField(before, getDef);

    expect(
      after.activeContinuousEffects.some(
        (candidate) =>
          candidate.modifierTag === "additional_cost" &&
          candidate.provenance?.effectSourceDefinitionId === "BSFT01-TR11(B)"
      )
    ).toBe(false);
    expect(
      getApplicableAdditionalCostDelta(after, BOB, card("BSFT01-C03"), {
        cardZone: "hand",
        getCardDefinitionById: getDef,
      })
    ).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// TR12 仔犬座の鍵 — front: メイン deck_reveal pick（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR12 仔犬座の鍵 / ニコラ（ブルー）", () => {
  const c = card("BSFT01-TR12(A)");

  it("front メイン deck_reveal(3, pick 光導鍵brave→hand, remainder trash) — BSFT01-TR12(A) は tribesRequired:[光導,鍵] (AND)", () => {
    // 原文「系統：「光導」を持つ鍵ブレイヴカード1枚」= 光導 AND 鍵 (07b §63-71)。
    // SSOT: BSFT01.ts:2141 同型と一致。tribes:[光導] 単独だと既定 or で『鍵』を欠落させる。
    const main = c.effects![1]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    const action = main.steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind === "deck_reveal") {
      expect(action.revealCount).toBe(3);
      expect(action.remainder).toBe("trash");
      expect(action.picks[0]!.count).toBe(1);
      expect(action.picks[0]!.filter).toEqual({
        category: ["brave"],
        tribesRequired: ["光導", "鍵"],
      });
      expect(action.picks[0]!.destination).toBe("hand");
    }
  });

  it("[board] メイン: デッキ上3枚が revealed へ移り deckCount が減る", () => {
    const src = createCardInstance(c, {
      instanceId: "nicola-tr12",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card(ENEMY_CARD), {
        instanceId: `deck-tr12-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck],
      playerOverrides: [{ deckCount: 5 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "nicola-tr12");
    const revealed = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "revealed"
    );
    expect(revealed).toHaveLength(3);
    expect(alice(after).deckCount).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// TR13 南十字座の鍵 — front: メイン deck_reveal + search_zone（実装）
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR13 南十字座の鍵 / クルックス", () => {
  const c = card("BSFT01-TR13(A)");

  it("front メイン: デッキ破棄と光導鍵回収を終えてから破棄されたカードの効果を処理する", () => {
    // 原文「系統：「光導」を持つ鍵ブレイヴカード1枚」= 光導 AND 鍵 (07b §63-71)。
    // SSOT: BSFT01.ts:2141 同型と一致。tribes:[光導] 単独だと既定 or で『鍵』を欠落させる。
    const main = c.effects![1]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    // steps[2-4] は【転醒】許可窓 (bsft01-tr-rebirth-permission-window):
    // rebirth_window / combine_window (択一) + 転醒成功分岐の任意コア配置。
    expect(main.steps).toHaveLength(5);
    const a0 = main.steps[0]!.action;
    expect(a0).toEqual({
      kind: "discard",
      player: "self",
      fromZone: "deck",
      count: 3,
      deferMovedToTrashEffects: true,
    });
    const a1 = main.steps[1]!.action;
    expect(a1.kind).toBe("search_zone");
    if (a1.kind === "search_zone") {
      expect(a1.zone).toBe("trash");
      expect(a1.filter).toEqual({
        category: ["brave"],
        tribesRequired: ["光導", "鍵"],
      });
      expect(a1.destination).toBe("hand");
    }
    expect(main.steps[2]!.action).toEqual({
      kind: "process_moved_to_trash",
      source: { stepId: "discard_deck" },
    });
    expect(main.steps[3]!.action).toEqual({
      kind: "rebirth",
      allowPostRebirthCorePlacementForLvDeficit: true,
      postRebirthChoice: {
        kind: "core_distribute",
        minimum: "back_face_lv",
      },
    });
    expect(main.steps[4]!.action.kind).toBe("brave_combine_effect");
    expect(main.stub).toBeUndefined();
  });

  it("[board] メイン step0: デッキ上3枚が直接トラッシュへ移る", () => {
    const src = createCardInstance(c, {
      instanceId: "crux-tr13",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deck = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card(ENEMY_CARD), {
        instanceId: `deck-tr13-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck],
      playerOverrides: [{ deckCount: 4 }, {}],
    });
    const onlyDeckReveal: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "main" },
      steps: [c.effects![1]!.steps[0]!],
    };
    const after = runEffect(before, onlyDeckReveal, "crux-tr13");
    // remainder="trash"（pick・任意効果なし）→ 戻し順選択を出さず直接トラッシュへ。
    const trashed = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "trash"
    );
    expect(trashed).toHaveLength(3);
    expect(after.pendingDeckReveal).toBeNull();
    expect(alice(after).deckCount).toBe(1);
  });
});

describe("BSFT01 star_garment cannot-be-under metadata", () => {
  it("CX01 swap_star_garment は星霊衣 under-card が無いと legal action に出ない", () => {
    const cx01 = card("BSFT01-CX01");
    const host = createCardInstance(cx01, {
      instanceId: "cx01-host-no-under",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(card("BSFT01-TR03(A)"), {
      instanceId: "cx01-attached-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;

    const state = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const actions = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBurstActions: () => undefined,
      },
      "flash"
    ).filter((action) => action.sourceInstanceId === host.instanceId);

    expect(fieldActionEffectIndexes(cx01, actions)).toEqual([2]);
    expect(actions[0]!.candidateTargetInstanceIds).toEqual([brave.instanceId]);
  });

  it("CX01 魂状態側 place_star_garment は魂状態を継承した合体中鍵ブレイヴを候補にする", () => {
    const cx01 = card("BSFT01-CX01");
    const host = createCardInstance(cx01, {
      instanceId: "cx01-soul-place-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      attachedChildrenIds: ["cx01-soul-place-key-brave"],
    });
    const brave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "cx01-soul-place-key-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: host.instanceId,
    });
    const state = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [
        { countValue: 3, soulStateInstanceIds: [host.instanceId] },
        {},
      ],
    });

    const actions = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBurstActions: () => undefined,
      },
      "flash"
    ).filter((action) => action.sourceInstanceId === host.instanceId);

    expect(fieldActionEffectIndexes(cx01, actions)).toEqual([3]);
    expect(actions[0]!.candidateTargetInstanceIds).toEqual([brave.instanceId]);
  });

  it("CX01 swap_star_garment は stale な星霊衣 under-card entry では legal action に出ない", () => {
    const cx01 = card("BSFT01-CX01");
    const host = createCardInstance(cx01, {
      instanceId: "cx01-host-stale-under",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const staleUnder = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "cx01-stale-under",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    staleUnder.definitionId = "BSFT01-TR01(B)";
    staleUnder.zoneRoleName = "star-garment";
    staleUnder.attachedToInstanceId = null;
    const brave = createCardInstance(card("BSFT01-TR03(A)"), {
      instanceId: "cx01-attached-brave-stale-under",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    host.underCards = [
      {
        cardInstanceId: staleUnder.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    brave.attachedToInstanceId = host.instanceId;

    const state = createEmptyGameState({
      cardInstances: [host, staleUnder, brave],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const actions = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBurstActions: () => undefined,
      },
      "flash"
    ).filter((action) => action.sourceInstanceId === host.instanceId);

    expect(actions).toEqual([]);
  });

  it("CX01 星霊衣は通常スピリットでは Lv1-Lv2 のときだけ legal action に出る", () => {
    const cx01 = card("BSFT01-CX01");

    const buildState = (normalCoreCount: number) => {
      const host = createCardInstance(cx01, {
        instanceId: `cx01-host-lv-${normalCoreCount}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount,
      });
      const under = createCardInstance(card("BSFT01-TR01(A)"), {
        instanceId: `cx01-under-lv-${normalCoreCount}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      under.definitionId = "BSFT01-TR01(B)";
      under.zoneRoleName = "star-garment";
      under.attachedToInstanceId = host.instanceId;
      const brave = createCardInstance(card("BSFT01-TR03(A)"), {
        instanceId: `cx01-brave-lv-${normalCoreCount}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      host.attachedChildrenIds = [brave.instanceId];
      host.underCards = [
        {
          cardInstanceId: under.instanceId,
          role: "text_role",
          roleTag: "星霊衣",
        },
      ];
      brave.attachedToInstanceId = host.instanceId;

      return {
        host,
        state: createEmptyGameState({
          cardInstances: [host, under, brave],
          playerOverrides: [{ countValue: 3 }, {}],
        }),
      };
    };

    const getActions = (normalCoreCount: number) => {
      const { host, state } = buildState(normalCoreCount);
      return getAvailableFieldCardEffectLegalActions(
        {
          state,
          actingPlayerId: ALICE,
          getCardDefinitionById: getDef,
          getRegisteredFieldCardEffectActions:
            buildFieldCardEffectLookup(ALL_CARDS),
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(ALL_CARDS),
          getRegisteredBurstActions: () => undefined,
        },
        "flash"
      ).filter((action) => action.sourceInstanceId === host.instanceId);
    };

    expect(getActions(0)).toEqual([]);
    expect(fieldActionEffectIndexes(cx01, getActions(1))).toEqual([4]);
  });

  it("CX01 星霊衣は魂状態でも legal action に出る", () => {
    const cx01 = card("BSFT01-CX01");
    const host = createCardInstance(cx01, {
      instanceId: "cx01-soul-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const under = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "cx01-soul-under",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    under.definitionId = "BSFT01-TR01(B)";
    under.zoneRoleName = "star-garment";
    under.attachedToInstanceId = host.instanceId;
    const brave = createCardInstance(card("BSFT01-TR03(A)"), {
      instanceId: "cx01-soul-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    host.underCards = [
      {
        cardInstanceId: under.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    brave.attachedToInstanceId = host.instanceId;

    const state = createEmptyGameState({
      cardInstances: [host, under, brave],
      playerOverrides: [
        { countValue: 3, soulStateInstanceIds: [host.instanceId] },
        {},
      ],
    });
    const actions = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBurstActions: () => undefined,
      },
      "flash"
    ).filter((action) => action.sourceInstanceId === host.instanceId);

    expect(fieldActionEffectIndexes(cx01, actions)).toEqual([5]);
    expect(actions.map((action) => action.candidateTargetInstanceIds)).toEqual([
      [brave.instanceId],
    ]);
  });

  it.each(["BSFT01-TR02(A)", "BSFT01-TR12(A)", "BSFT01-TR13(A)"])(
    "%s は star_garment_cannot_be_under で CX01 星霊衣の legal target にならない",
    (cardNo) => {
      const cx01 = card("BSFT01-CX01");
      const host = createCardInstance(cx01, {
        instanceId: `cx01-host-${cardNo}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const brave = createCardInstance(card(cardNo), {
        instanceId: `cx01-brave-${cardNo}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      host.attachedChildrenIds = [brave.instanceId];
      brave.attachedToInstanceId = host.instanceId;

      const state = createEmptyGameState({
        cardInstances: [host, brave],
        playerOverrides: [{ countValue: 3 }, {}],
      });
      const actions = getAvailableFieldCardEffectLegalActions(
        {
          state,
          actingPlayerId: ALICE,
          getCardDefinitionById: getDef,
          getRegisteredFieldCardEffectActions:
            buildFieldCardEffectLookup(ALL_CARDS),
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(ALL_CARDS),
          getRegisteredBurstActions: () => undefined,
        },
        "flash"
      ).filter((action) => action.sourceInstanceId === host.instanceId);

      expect(actions).toEqual([]);
    }
  );

  it("BSFT01-TR02(B) star-garment-under-placement-exclusion: [board] 親A面を選んでもB面タグにより星霊衣の配置候補にならない", () => {
    const cx01 = card("BSFT01-CX01");
    const host = createCardInstance(cx01, {
      instanceId: "cx01-host-tr02-back-face",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 星霊衣では手札/フィールドの親 A 面を選択してから、B 面を表向きで
    // under-card に置く。そのため実行前の候補排除は親 A 面定義経由で検証する。
    const brave = createCardInstance(card("BSFT01-TR02(A)"), {
      instanceId: "cx01-brave-tr02-back-face",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;

    const state = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const actions = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(ALL_CARDS),
        getRegisteredBurstActions: () => undefined,
      },
      "flash"
    ).filter((action) => action.sourceInstanceId === host.instanceId);

    expect(actions).toEqual([]);
  });

  it("CX01 の星霊衣は実カード定義から place/swap action として実行できる", () => {
    const cx01 = card("BSFT01-CX01");
    const placeEffect = cx01.effects!.find((effect) =>
      effect.steps.some((step) => step.action.kind === "place_star_garment")
    )!;
    const swapEffect = cx01.effects!.find((effect) =>
      effect.steps.some((step) => step.action.kind === "swap_star_garment")
    )!;
    expect(placeEffect).toBeDefined();
    expect(swapEffect).toBeDefined();

    const host = createCardInstance(cx01, {
      instanceId: "cx01-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const firstBrave = createCardInstance(card("BSFT01-TR01(A)"), {
      instanceId: "cx01-first-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [firstBrave.instanceId];
    firstBrave.attachedToInstanceId = host.instanceId;

    const beforePlace = createEmptyGameState({
      cardInstances: [host, firstBrave],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const afterPlace = executeEffect({
      chainId: "test:bsft01-cards:13271",
      state: beforePlace,
      effect: placeEffect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const placedHost = afterPlace.cardInstances.find(
      (x) => x.instanceId === host.instanceId
    )!;
    const placedBrave = afterPlace.cardInstances.find(
      (x) => x.instanceId === firstBrave.instanceId
    )!;
    expect(placedHost.attachedChildrenIds).toEqual([]);
    expect(placedHost.underCards).toEqual([
      {
        cardInstanceId: firstBrave.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
    ]);
    expect(placedBrave.definitionId).toBe("BSFT01-TR01(B)");
    expect(placedBrave.zoneRoleName).toBe("star-garment");

    const secondBrave = createCardInstance(card("BSFT01-TR03(A)"), {
      instanceId: "cx01-second-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    secondBrave.attachedToInstanceId = host.instanceId;
    const beforeSwap: GameState = {
      ...afterPlace,
      cardInstances: [
        ...afterPlace.cardInstances.map((instance) =>
          instance.instanceId === host.instanceId
            ? { ...instance, attachedChildrenIds: [secondBrave.instanceId] }
            : instance
        ),
        secondBrave,
      ],
    };
    const afterSwap = executeEffect({
      chainId: "test:bsft01-cards:13314",
      state: beforeSwap,
      effect: swapEffect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const swappedHost = afterSwap.cardInstances.find(
      (x) => x.instanceId === host.instanceId
    )!;
    const firstAfterSwap = afterSwap.cardInstances.find(
      (x) => x.instanceId === firstBrave.instanceId
    )!;
    const secondAfterSwap = afterSwap.cardInstances.find(
      (x) => x.instanceId === secondBrave.instanceId
    )!;
    expect(swappedHost.attachedChildrenIds).toEqual([firstBrave.instanceId]);
    expect(swappedHost.underCards).toEqual([
      {
        cardInstanceId: secondBrave.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
    ]);
    expect(firstAfterSwap.definitionId).toBe("BSFT01-TR01(A)");
    expect(firstAfterSwap.zoneRoleName).toBe("brave");
    expect(secondAfterSwap.definitionId).toBe("BSFT01-TR03(B)");
    expect(secondAfterSwap.zoneRoleName).toBe("star-garment");
  });

  const placeStarGarmentEffect = {
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: {
          kind: "place_star_garment",
          target: {
            kind: "filter",
            player: "self",
            count: 1,
            filter: { category: ["brave"] },
          },
        },
      },
    ],
  } as NonNullable<CardDefinition["effects"]>[number];

  it.each(["BSFT01-TR02(A)", "BSFT01-TR12(A)", "BSFT01-TR13(A)"])(
    "%s は star_garment_cannot_be_under で place_star_garment を拒否する",
    (cardNo) => {
      const host = createCardInstance(card("BSFT01-CX01"), {
        instanceId: `host-${cardNo}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const brave = createCardInstance(card(cardNo), {
        instanceId: `brave-${cardNo}`,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      host.attachedChildrenIds = [brave.instanceId];
      brave.attachedToInstanceId = host.instanceId;

      const before = createEmptyGameState({ cardInstances: [host, brave] });
      const after = executeEffect({
        chainId: "test:bsft01-cards:13381",
        state: before,
        effect: placeStarGarmentEffect,
        sourceInstanceId: host.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });

      const hostAfter = after.cardInstances.find(
        (x) => x.instanceId === host.instanceId
      )!;
      const braveAfter = after.cardInstances.find(
        (x) => x.instanceId === brave.instanceId
      )!;
      expect(card(cardNo).backFace!.keywordTags).toContain(
        "star_garment_cannot_be_under"
      );
      expect(hostAfter.attachedChildrenIds).toEqual([brave.instanceId]);
      expect(hostAfter.underCards).toEqual([]);
      expect(braveAfter.definitionId).toBe(cardNo);
      expect(braveAfter.zoneRoleName).toBe("brave");
    }
  );
});

// ════════════════════════════════════════════════════════════════
// BSFT01-TR12(A)/TR13(A) 共通: 鍵ブレイヴ探索 filter の AND 連言（光導 AND 鍵）行動検証
//
// 原文「系統：「光導」を持つ鍵ブレイヴカード1枚」(07b §63-71 鍵ブレイヴ二面性)。
// 過去実装 tribes:[光導] は既定 or で単独要素扱い＝『鍵』を欠落させ、非鍵 光導 ブレイヴが
// 誤って候補化していた。matchesCardFilter SSOT に合体テスト用フィクスチャ（合成）の
// 「光導」だけを持つブレイヴ（鍵欠）を流し、tribesRequired:[光導,鍵] が排他に効くことを
// 行動レベルで確認する（実カードでは BSFT01 内に 光導-only brave が存在しないが、将来弾で
// 出現したときの retainer として ガード）。
// ════════════════════════════════════════════════════════════════

describe("BSFT01-TR12/TR13 鍵ブレイヴ探索 filter (AND 連言)", () => {
  // 合成: 鍵欠の 光導 ブレイヴ（filter 行動差分の証拠用フィクスチャ）。
  const guideOnlyBraveDef: CardDefinition = {
    cardNo: "TEST-GUIDE-ONLY-BRAVE",
    name: "test-guide-only-brave",
    printedCategory: "brave",
    colors: ["white"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "光導・星魂", // 光導 を持つが 鍵 を持たない
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const guideAndKeyBraveDef = card("BSFT01-TR01(A)"); // tribe: 鍵・光導

  const guideOnlyInstance = createCardInstance(guideOnlyBraveDef, {
    instanceId: "guide-only-1",
    ownerPlayerId: ALICE,
    zone: "trash",
  });
  const guideAndKeyInstance = createCardInstance(guideAndKeyBraveDef, {
    instanceId: "guide-and-key-1",
    ownerPlayerId: ALICE,
    zone: "trash",
  });

  it("BSFT01-TR12(A) pick filter: 鍵欠の 光導 brave は弾く / 鍵+光導 brave は通る", () => {
    const filter = (
      card("BSFT01-TR12(A)").effects![1]!.steps[0]!.action as {
        kind: "deck_reveal";
        picks: { filter: import("../src/dsl-types").CardFilter }[];
      }
    ).picks[0]!.filter;
    expect(
      matchesCardFilter(guideOnlyInstance, guideOnlyBraveDef, filter)
    ).toBe(false);
    expect(
      matchesCardFilter(guideAndKeyInstance, guideAndKeyBraveDef, filter)
    ).toBe(true);
  });

  it("BSFT01-TR13(A) search_zone filter: 鍵欠の 光導 brave は弾く / 鍵+光導 brave は通る", () => {
    const filter = (
      card("BSFT01-TR13(A)").effects![1]!.steps[1]!.action as {
        kind: "search_zone";
        filter: import("../src/dsl-types").CardFilter;
      }
    ).filter;
    expect(
      matchesCardFilter(guideOnlyInstance, guideOnlyBraveDef, filter)
    ).toBe(false);
    expect(
      matchesCardFilter(guideAndKeyInstance, guideAndKeyBraveDef, filter)
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// X01 星霊王 — Lv4 アタック時 ネクサス破壊（実装）/ 代替召喚・restriction stub
// ════════════════════════════════════════════════════════════════

describe("BSFT01-X01 星霊王", () => {
  const c = card("BSFT01-X01");

  it("4効果: [2]代替コスト召喚許可+除外支払い / [4,5]Lv3-4 restrict_stack+restrict_advent / [7,8]Lv4 ネクサス破壊・指定アタック・ブロック時回復", () => {
    expect(c.effects).toHaveLength(4);
    const permission = c.effects![0]!;
    expect(permission.timing).toEqual({ kind: "continuous" });
    expect(permission.timingScope).toEqual({
      player: "self",
      period: "main",
    });
    expect(permission.applicability).toEqual({ zone: ["hand", "trash"] });
    expect(permission.condition).toContainEqual({
      kind: "field_lacks",
      player: "self",
      category: ["ultimate"],
      cardName: "self",
    });
    expect(permission.steps).toHaveLength(1);
    expect(permission.steps[0]!.action).toEqual({
      kind: "summon",
      normalActionPermission: true,
      target: { kind: "self" },
    });

    const excludeCost = c.effects![1]!;
    expect(excludeCost.timing).toEqual({ kind: "continuous" });
    const excludeAction = excludeCost.steps[0]!.action;
    expect(excludeAction.kind).toBe("cost_modify");
    if (excludeAction.kind === "cost_modify") {
      expect(excludeAction.modifier).toEqual({ additionalCostValue: 0 });
      expect(excludeAction.useCostPayment).toEqual({
        kind: "exclude",
        fullCostPaid: true,
        sourceZone: "field",
        maxCount: 1,
        minCount: 1,
        normalActionPermissionEffectIndex: 0,
        filter: { category: ["brave"], combined: true, tribes: ["鍵"] },
      });
    }

    const restrict = c.effects![2]!;
    expect(restrict.condition).toContainEqual({
      kind: "min_level",
      value: 3,
    });
    expect(restrict.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    expect(restrict.steps).toHaveLength(2);
    const restrictAction = restrict.steps[0]!.action;
    expect(restrictAction.kind).toBe("restrict_stack");
    // duration は『自分のアタックステップ中』限定 (audit-bsft01 解消, 2026-06-20)。
    // while_on_field では timingScope 経由のゲートに依存し CE が purge されないため、
    // step:"attack" whose:"self" で CE 寿命も attack ステップ終了に揃える。
    if (restrictAction.kind === "restrict_stack") {
      expect(restrictAction.duration).toEqual({
        scope: "step",
        whose: "self",
        step: "attack",
      });
    }
    // 「【煌臨】できない」= restrict_advent (ENGINE-restrict-advent)。restrict_stack と同型。
    const restrictAdventAction = restrict.steps[1]!.action;
    expect(restrictAdventAction.kind).toBe("restrict_advent");
    if (restrictAdventAction.kind === "restrict_advent") {
      expect(restrictAdventAction.duration).toEqual({
        scope: "step",
        whose: "self",
        step: "attack",
      });
    }
    expect(restrict.stub).toBeUndefined();
    const atk = c.effects![3]!;
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(atk.condition).toContainEqual({ kind: "min_level", value: 4 });
    const action = atk.steps[0]!.action;
    expect(action.kind).toBe("destroy");
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.category).toEqual(["nexus"]);
      expect(action.target.count).toBe(1);
      expect(action.target.filter.targetsGrandwalker).toBe(true);
      expect(action.target.filter.targetsGrandstone).toBe(true);
    }

    expect(atk.steps[1]?.executionMode).toBe("optional");
    expect(atk.steps[1]?.action.kind).toBe("designate_attack");
    expect(atk.steps[2]?.deferTo).toBe("battle_end");
    expect(atk.steps[3]?.condition).toEqual([{ kind: "battle_was_blocked" }]);
    expect(atk.steps[3]?.executionMode).toBe("optional");
    expect(atk.steps[3]?.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
  });

  it("[board] Lv4 アタック時: 相手ネクサスが破壊予約される (fixed count=1)", () => {
    const src = createCardInstance(c, {
      instanceId: "seireiou-x01",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const enemyNexus = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-x01",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const d = c.effects![3]!.steps[0]!.action;
    if (d.kind !== "destroy" || !("filter" in d.target))
      throw new Error("expected destroy filter");
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        { action: { kind: "destroy", target: { ...d.target, count: 1 } } },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemyNexus] }),
      fixed,
      "seireiou-x01"
    );
    const nexusAfter = after.cardInstances.find(
      (x) => x.instanceId === "nexus-x01"
    )!;
    expect(nexusAfter.pendingLeaveKind).toBe("destroy");
  });

  it("[board] Lv4 アタック時: 現在のアタック先を指定し、同じ効果でバトル終了時回復を予約する", () => {
    const attackEffect = c.effects![3]!;
    const src = createCardInstance(c, {
      instanceId: "seireiou-x01-atk",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 2, // Lv4 (requiredCores:2) — min_level:4 条件を満たす
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-seireiou:1",
      primaryEntityId: "be-seireiou",
      participantEntityIds: ["be-seireiou"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-seireiou", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-seireiou"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const before: GameState = {
      ...createEmptyGameState({
        cardInstances: [
          src,
          createCardInstance(card(ENEMY_CARD), {
            instanceId: "designated-enemy",
            ownerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
            exhaustState: "exhausted",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-seireiou",
          resolvedBp: 30000,
          attackState: "attacking",
          resolvedSymbols: ["ultimate_symbol"],
          memberInstanceIds: ["seireiou-x01-atk"],
        },
      ],
    };

    let after = runEffect(before, attackEffect, "seireiou-x01-atk");
    for (let i = 0; i < 3 && after.pendingStepOptionalChoice; i++) {
      const accept = getLegalActions({
        state: after,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      );
      expect(accept).toBeDefined();
      after = applyLegalAction({
        state: after,
        action: accept!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).state;
    }

    // 進行中のバトル (declare_attack 窓、block 未確定) が破棄されず維持される。
    expect(after.activeAttack?.attackId).toBe(activeAttack.attackId);
    expect(after.activeAttack?.designatedTargetInstanceId).toBe(
      "designated-enemy"
    );
    expect(after.step).toBe("attack");
    expect(after.pendingAdditionalAttackGrants).toEqual([]);
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
  });
});
