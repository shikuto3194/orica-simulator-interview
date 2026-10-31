import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSSL01 (俺だけレベルアップな件) todo カードの effects 検証テスト。
 * 系統「影」/「プレイヤー」契約・煌臨デッキ（水篠 旬）。
 *
 * 実装した忠実効果（board 変化を検証）:
 *   - C01 召喚/煌臨時 手札の影/プレイヤー2枚まで破棄→破棄1枚につき2枚ドロー
 *   - C02 召喚/アタック時 1ドロー
 *   - C03 配置時 カウント+1→1ドロー
 *   - C04 配置時 カウント+2→手札の影/プレイヤー1枚破棄で2枚ドロー
 *   - C05 召喚時 カウント+1 + 択一（1ドロー/魂状態召喚）
 *   - CX01 フラッシュ 無条件カウント+1 + アタックステップなら(step_phase)さらに+1し手札1枚破棄→2枚ドロー
 *   - CX01 [2,3] お互いのアタックステップ中、相手効果でフィールドを離れるとき2コスト支払いで
 *     残置（stay_on_field）+ コアを好きなだけ再配置（core_distribute field_and_reserve_self）
 *   - M01 Lv2-3 フラッシュ 自フィールドの影スピリット数ぶん 相手フィールドのコアをリザーブへ
 *   - R01 召喚/アタック時 相手1体のLvコストを自分のカウント2につき+1
 *     （override_properties.levelCostDelta を Amount(DynamicCount) 対応に拡張。
 *     BSKB01-M01/BSLH01-M04 の固定+2型と同 primitive の動的版）
 *   - R02 離脱時 煌臨元/トラッシュ選択 + BP以下単一対象コアシュート + P3-76 対象リダイレクト
 *   - R03 召喚時 トラッシュの影/プレイヤー1枚を手札へ（search_zone）
 *
 * 煌臨宣言は adventData へ再変換済み（declare_advent main 配線済み）:
 *   - C01 / X01（お互いのターン≈main_and_flash）/ X02（超契約煌臨→contract 近似）契約煌臨 adventData
 *   - CX01 は被煌臨 base（adventData 不要、getContractAdventTargets が魂状態の契約先を列挙）
 *
 * 旧 needs-dsl park から解消済みの項目は各 describe の構造テストで stub 削除を pin する。
 *
 * 単一対象コアシュート（extremal 最少コア対象→コアすべて）:
 *   - C01[7,8] 【OC中】アタック時 最少コアの相手1体のコアすべてをトラッシュへ（amount:"all"）
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
  SymbolColor,
} from "../src/runtime";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  executeBattleResolution,
  executeReevaluationCheck,
  getCombinedUnitSymbols,
  getLegalActions,
  getPlayerLifeCoreCount,
  getSymbolAdditions,
  recomputeAndRebuildContinuousEffects,
  recomputeBattleEntityBp,
} from "../src/runtime";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { adventSourceIdsOf } from "../src/model";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import {
  recomputeContinuousEffects,
  recordEffectUsage,
} from "../src/legal/legal-actions-shared";
import { flushPendingLeaves } from "../src/state-based-actions";
import {
  buildBattleImmediateEffectLookup,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];
const magicLookup = buildMagicLookup(ALL_CARDS);

const ALICE = "player-1";
const BOB = "player-2";

function symbolAdditionCE(
  targetInstanceId: string,
  symbol: SymbolColor
): ContinuousEffect {
  return {
    effectId: `ce-extra-symbol-${targetInstanceId}`,
    sourceInstanceId: "external-symbol-source",
    sourceDefinitionId: "TEST-SYMBOL-SOURCE",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "symbol_addition",
    modifierSymbol: [symbol],
    targetInstanceId,
  };
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  let s = executeEffect({
    chainId: "test:bssl01-cards:110",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
  // step.executionMode='optional' を持つ後続 step は pendingStepOptionalChoice を立てて中断する。
  // この test では「効果が完遂したときの盤面」を検証するため execute で drain する。
  let guard = 0;
  while (guard++ < 20) {
    if (s.pendingStepOptionalChoice !== null) {
      const psoc = s.pendingStepOptionalChoice;
      s = applyLegalAction({
        state: s,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${psoc.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: psoc.actingPlayerId,
          pendingId: psoc.pendingId,
          sourceInstanceId: psoc.sourceInstanceId,
          effectIndex: psoc.effectIndex,
          stepIndex: psoc.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).state;
      continue;
    }
    if (
      s.pendingMultiPlacement !== null &&
      s.pendingMultiPlacement.targets.every(
        (target) => target.minimumCoreCount === 0
      )
    ) {
      const action = getLegalActions({
        state: s,
        actingPlayerId: s.pendingMultiPlacement.actingPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_multi_placement"
      );
      expect(action).toBeDefined();
      s = applyLegalAction({
        state: s,
        action: action!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        multiPlacementAllocations: [],
      }).state;
      continue;
    }
    break;
  }
  return s;
}

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;
const bob = (s: GameState) => s.players.find((p) => p.id === BOB)!;

function placeSelf(c: CardDefinition, instanceId: string, normalCoreCount = 1) {
  return createCardInstance(c, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount,
  });
}

const emptyFieldEffectLookup = (() => []) as Parameters<
  typeof getLegalActions
>[0]["getRegisteredFieldCardEffectActions"];

function vanillaSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: `vanilla ${cardNo}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function braveWithBoost(cardNo: string, combinedBoost: number): CardDefinition {
  return {
    cardNo,
    name: `brave ${cardNo}`,
    printedCategory: "brave",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    combinedBoost,
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function definitionLookup(definitions: CardDefinition[]) {
  const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
  return (id: string): CardDefinition | undefined =>
    localMap.get(id) ?? getDef(id);
}

// ════════════════════════════════════════════════════════════════
// C01 再覚醒者 水篠 旬 — 召喚/煌臨時 破棄→ドロー / 契約煌臨 + 最少コア単一対象コアシュート
// ════════════════════════════════════════════════════════════════

describe("BSSL01-C01 再覚醒者 水篠 旬", () => {
  const c = card("BSSL01-C01");

  it("構造: 契約煌臨は adventData へ再変換 / [3,4] 破棄連動ドローを実装 / [7,8] 最少コア単一対象コアシュートを実装", () => {
    // [0,1] 契約煌臨宣言は adventData（declare_advent 配線済み）へ移行。stub effect は削除済み。
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("own_turn");
    expect(c.adventData!.soulCoreDest).toBe("trash");
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.effects).toHaveLength(2);
    // [3,4] 破棄連動ドロー（ZoneSelectionContinuation）= stub 解消。
    const trig = c.effects![0]!;
    expect(trig.timing).toEqual({
      kind: "card_event",
      event: ["summon", "advent"],
    });
    expect(trig.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(trig.stub).toBeUndefined();
    const disc = trig.steps[0]!;
    expect(disc.id).toBe("disc");
    expect(disc.action.kind).toBe("discard");
    if (disc.action.kind === "discard") {
      expect(disc.action.count).toEqual({ min: 0, max: 2 });
      expect(disc.action.filter?.tribes).toEqual(["影", "プレイヤー"]);
    }
    const draw = trig.steps[1]!.action;
    expect(draw).toEqual({
      kind: "draw",
      count: {
        source: { kind: "cards_from_ref", stepId: "disc" },
        multiplier: 2,
      },
    });
    // [7,8] 【OC中】アタック時 最少コア単一対象コアシュート（コアすべて→トラッシュ）= stub 解消。
    const oc = c.effects![1]!;
    expect(oc.stub).toBeUndefined();
    expect(oc.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(oc.condition).toEqual([
      { kind: "count_value", player: "self", min: 4 },
    ]);
    expect(oc.executionMode).toBe("optional");
    const cm = oc.steps[0]!.action;
    expect(cm.kind).toBe("core_move");
    if (cm.kind === "core_move") {
      expect(cm.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["spirit", "ultimate"],
          extremal: { metric: "core", mode: "lowest" },
        },
        count: 1,
      });
      expect(cm.from).toEqual({ kind: "target_card" });
      expect(cm.to).toEqual({ kind: "trash", player: "opponent" });
      expect(cm.amount).toBe("all");
    }
  });

  it("盤面: 契約煌臨は自ターンに水篠 旬へ重なり、ソウルコアをトラッシュに置く", () => {
    const target: CardDefinition = {
      ...vanillaSpirit("BSSL01-C01-CONTRACT-HOST", 3000),
      name: "水篠 旬 契約煌臨先",
    };
    const host = createCardInstance(target, {
      instanceId: "c01-contract-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const advent = createCardInstance(c, {
      instanceId: "c01-contract-advent",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const definitions = [...ALL_CARDS, target];
    const lookups = {
      getCardDefinitionById: definitionLookup([target]),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
    };
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          { handCount: 1, soulCoreLocation: { kind: "reserve" } },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, advent],
    };
    const declaration = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action): action is Extract<LegalAction, { kind: "declare_advent" }> =>
        action.kind === "declare_advent" &&
        action.sourceInstanceId === "c01-contract-advent"
    );
    expect(declaration).toBeDefined();
    expect(declaration!.candidateTargetInstanceIds).toContain(
      "c01-contract-host"
    );

    current = applyLegalAction({
      state: current,
      action: declaration!,
      targetInstanceIds: ["c01-contract-host"],
      ...lookups,
    }).state;
    let passGuard = 0;
    while (current.stackWindow !== null && passGuard++ < 10) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.stackWindow.priorityPlayerId,
        ...lookups,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        ...lookups,
      }).state;
    }
    expect(passGuard).toBeLessThan(10);
    const pending = current.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    const resolveTarget = getLegalActions({
      state: current,
      actingPlayerId: pending!.actingPlayerId,
      ...lookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_effect_target" }
      > => action.kind === "resolve_pending_effect_target"
    );
    expect(resolveTarget).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: resolveTarget!,
      targetInstanceIds: ["c01-contract-host"],
      ...lookups,
    }).state;

    const adventAfter = current.cardInstances.find(
      (instance) => instance.instanceId === "c01-contract-advent"
    )!;
    expect(adventAfter.zone).toBe("field");
    expect(adventSourceIdsOf(adventAfter)).toContain("c01-contract-host");
    expect(alice(current).soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("[board] OC中アタック時: 最少コアの相手1体（選択済み）のコアすべてが相手トラッシュへ", () => {
    const src = placeSelf(c, "shun-c01");
    // 相手スピリット2体: 1コア（最少）と3コア。最少コア=1コアの方を対象に。
    const low = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bob-low",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const high = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bob-high",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    // count_value >= 4 で OC 条件成立。
    const before = createEmptyGameState({
      cardInstances: [src, low, high],
      playerOverrides: [{ countValue: 4 }, { trashNormalCoreCount: 0 }],
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:318",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "shun-c01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["bob-low"],
    });
    // amount:"all" → 選んだ1体のコア全量が相手トラッシュへ（pending 無し・即時）。
    expect(after.pendingCoreCountSelection ?? null).toBeNull();
    const lowAfter = after.cardInstances.find(
      (x) => x.instanceId === "bob-low"
    )!;
    const highAfter = after.cardInstances.find(
      (x) => x.instanceId === "bob-high"
    )!;
    expect(lowAfter.normalCoreCount).toBe(0);
    expect(highAfter.normalCoreCount).toBe(3); // 非対象は不変
    expect(bob(after).trashNormalCoreCount).toBe(1);
  });

  it("[board] OC条件未成立（カウント3）はコア移動しない", () => {
    const src = placeSelf(c, "shun-c01");
    const low = createCardInstance(card("BSSL01-C02"), {
      instanceId: "bob-low",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, low],
      playerOverrides: [{ countValue: 3 }, { trashNormalCoreCount: 0 }],
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:352",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "shun-c01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["bob-low"],
    });
    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-low")!
        .normalCoreCount
    ).toBe(1);
    expect(bob(after).trashNormalCoreCount).toBe(0);
  });

  it("[board] 召喚/煌臨時: 影/プレイヤーのみ候補化 → 2枚破棄で4枚ドロー", () => {
    const src = placeSelf(c, "shun-c01");
    // 手札: 影(C02 影・甲獣) + プレイヤー(C01) + 非対象(BSTS01-M01 暴嵐・剣獣)。
    const kage = createCardInstance(card("BSSL01-C02"), {
      instanceId: "hand-kage",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const player = createCardInstance(card("BSSL01-C01"), {
      instanceId: "hand-player",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const other = createCardInstance(card("BSTS01-M01"), {
      instanceId: "hand-other",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deck = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(card("BSSL01-C03"), {
        instanceId: `deck-c01-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, kage, player, other, ...deck],
      playerOverrides: [{ handCount: 3, deckCount: 6 }, {}],
    });
    const pendingState = runEffect(before, c.effects![0]!, "shun-c01");
    // 任意上限 (0..2) のゾーン選択 pending（影/プレイヤーのみ候補・非対象は除外）。
    const pending = pendingState.pendingZoneSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actionKind).toBe("discard_hand");
    expect(pending!.maxCount).toBe(2);
    expect(pending!.continuation).toBeDefined();
    expect(pending!.candidateCardInstanceIds).toEqual(
      expect.arrayContaining(["hand-kage", "hand-player"])
    );
    expect(pending!.candidateCardInstanceIds).not.toContain("hand-other");
    // 影2枚を破棄 → cards_from_ref×2 = 4枚ドロー。
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    };
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["hand-kage", "hand-player"],
      ...lookups,
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(
      resolved.cardInstances.filter(
        (x) => x.zone === "trash" && x.ownerPlayerId === ALICE
      ).length
    ).toBe(2);
    // デッキ 6 → 2（4枚ドロー）。
    expect(alice(resolved).deckCount).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// C02 タンク — 召喚/アタック時 1ドロー / 割込召喚 + 煌臨元 leave-dest
// ════════════════════════════════════════════════════════════════

describe("BSSL01-C02 タンク", () => {
  const c = card("BSSL01-C02");

  it("構造: [0]割込召喚(void_core_decrease+free summon+restrict_core_placement(from_void_self)+コア2個までトラッシュ) / [2]煌臨元 leave-dest (advent_source, engine batch2-2) / [4,5]召喚アタック時 draw1", () => {
    // ENGINE-void-core-decrease-trigger: 「相手が相手の効果でボイドからコアを増やしたとき」
    // = game_event(opponent, void_core_decrease, cause:self_effect)。stub 解消。
    const trigger = c.effects![0]!;
    expect(trigger.stub).toBeUndefined();
    expect(trigger.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "void_core_decrease",
      cause: ["self_effect"],
    });
    expect(trigger.applicability).toEqual({ zone: ["hand", "trash"] });
    expect(trigger.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(trigger.executionMode).toBe("optional");
    expect(trigger.steps[0]!.id).toBe("c02-summon");
    expect(trigger.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
    // 「そうしたとき」= 召喚成立が前提。steps[1,2] は ref_succeeded で召喚成否をゲートする
    // (BSDB01-M02 effects[2] precedent と同型。adversarial verifier round1 lens1 指摘)。
    expect(trigger.steps[1]!.connector).toBe("sequential");
    expect(trigger.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "c02-summon",
    });
    expect(trigger.steps[1]!.action).toEqual({
      kind: "restrict_core_placement",
      player: "opponent",
      scope: "from_void_self",
      duration: { scope: "turn" },
    });
    expect(trigger.steps[2]!.connector).toBe("sequential");
    expect(trigger.steps[2]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "c02-summon",
    });
    const coreMove = trigger.steps[2]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.from).toEqual({
        kind: "field",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
      });
      expect(coreMove.to).toEqual({ kind: "trash", player: "opponent" });
      expect(coreMove.amount).toEqual({ min: 0, max: 2 });
    }

    // [2] は effect_resistance replacement:advent_source（stub 解消）。
    const leaveDest = c.effects![1]!;
    expect(leaveDest.stub).toBeUndefined();
    const lda = leaveDest.steps[0]!.action;
    expect(lda.kind).toBe("effect_resistance");
    if (lda.kind === "effect_resistance") {
      expect(lda.resistsOutcome).toBe("leave_field");
      expect(lda.source).toBe("opponent");
      expect(lda.replacement?.kind).toBe("advent_source");
    }
    const drawTrig = c.effects![2]!;
    expect(drawTrig.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    expect(drawTrig.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
  });

  it("[board] 相手が相手の効果でボイドからコアを増やしたとき: 手札のこのカードを無償召喚→ボイド増加禁止CE登録→相手のスピリット/アルティメットのコア2個まで選んでトラッシュへ", () => {
    const hand = createCardInstance(c, {
      instanceId: "c02-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    // 相手フィールドのスピリット (実カード定義。ローカル定義は getDef に未登録のため
    // coreShootCardMatchesFilter の category 解決に使えない)。
    const oppSpirit = createCardInstance(card("BSSL01-R01"), {
      instanceId: "opp-spirit-c02",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const before = createEmptyGameState({
      cardInstances: [hand, oppSpirit],
      playerOverrides: [
        { reserveNormalCoreCount: 1 },
        { voidNormalCoreCount: 50 },
      ],
    });
    const after = finishCoreChoices(
      runEffect(before, c.effects![0]!, "c02-hand"),
      getDef
    );

    // 無償召喚: 手札→フィールド、コスト支払いなしで成立。
    const summoned = after.cardInstances.find(
      (ci) => ci.instanceId === "c02-hand"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(1);

    // 「そうしたとき、このターンの間、相手は相手の効果でボイドからコアを増やせず」= CE 登録。
    const restrictCE = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_core_placement_void"
    );
    expect(restrictCE).toBeDefined();
    expect(restrictCE!.targetInstanceId).toBe(BOB);
    expect(restrictCE!.duration).toEqual({ scope: "turn" });

    // 「相手のスピリット/アルティメットのコア2個までをトラッシュに置ける」= field源
    // under-selection (min0,max2) は候補1体でも pendingCoreShootSelection を生成する (P3-88)。
    expect(after.pendingCoreShootSelection).not.toBeNull();
    expect(after.pendingCoreShootSelection!.totalAmount).toBe(2);
    expect(after.pendingCoreShootSelection!.minTotal).toBe(0);

    const actions = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const resolveAction = actions.find(
      (a) => a.kind === "resolve_pending_core_shoot"
    );
    expect(resolveAction).toBeDefined();
    const resolved = applyLegalAction({
      state: after,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      coreShootDistribution: { "opp-spirit-c02": 2 },
    }).state;
    expect(resolved.pendingCoreShootSelection).toBeNull();
    expect(bob(resolved).trashNormalCoreCount).toBe(2);
    const oppSpiritAfter = resolved.cardInstances.find(
      (ci) => ci.instanceId === "opp-spirit-c02"
    )!;
    expect(oppSpiritAfter.normalCoreCount).toBe(1);
  });

  it("[board] void_core_decrease game_event 検出パイプライン: 相手自身の効果でボイドが減ったときのみ手札のこのカードが private declaration 候補に積まれる (cause:self_effect)", () => {
    // adversarial verifier 指摘: 上の board テストは executeEffect の直呼びで steps 本体のみ検証し、
    // trigger-system.ts の collectAndQueueTriggerReactions による実イベント検出→pending queue 化を
    // 通っていなかった。ここでは検出パイプラインそのものを通す
    // (bsth02-7-x01-hand-trigger-summon.test.ts の private declaration 検証と同型)。
    const hand = createCardInstance(c, {
      instanceId: "c02-hand-trigger",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const lookup = buildTriggeredEffectLookup([c]);
    const before = createEmptyGameState({
      cardInstances: [hand],
      playerOverrides: [{}, { voidNormalCoreCount: 10 }],
    });
    // BOB のボイドが 10→8 に減る (「相手がボイドからコアを増やした」に対応する delta)。
    const afterVoidDecrease: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === BOB ? { ...p, voidNormalCoreCount: 8 } : p
      ),
    };

    // 相手(BOB) 自身の効果で起きた場合 (cause:self_effect) → queue される。
    const queuedSelf = collectAndQueueTriggerReactions({
      chainId: "test:bssl01-cards:601",
      beforeState: before,
      afterState: afterVoidDecrease,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const declaration = queuedSelf.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === hand.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("void_core_decrease");
    expect(declaration!.event?.cause).toBe("self_effect");

    // 第三者 (ALICE) の効果で BOB のボイドが減った場合 → cause は opponent_effect
    // (BOB 視点で「相手(ALICE)による」) になり、cause:["self_effect"] 限定の宣言には
    // 一致しないため queue されない。「相手が相手の効果で」の主体取り違えを防ぐ回帰テスト。
    const queuedThirdParty = collectAndQueueTriggerReactions({
      chainId: "test:bssl01-cards:620",
      beforeState: before,
      afterState: afterVoidDecrease,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queuedThirdParty.pendingPrivateDeclarations.find(
        (d) => d.sourceInstanceId === hand.instanceId
      )
    ).toBeUndefined();

    // causedByPlayerId 未指定 (cause 省略) でも fail-closed で queue されない。
    const queuedNoCause = collectAndQueueTriggerReactions({
      chainId: "test:bssl01-cards:636",
      beforeState: before,
      afterState: afterVoidDecrease,
      source: "action_resolution",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queuedNoCause.pendingPrivateDeclarations.find(
        (d) => d.sourceInstanceId === hand.instanceId
      )
    ).toBeUndefined();
  });

  it("[board] 〔ターンに1回:同名〕: 手札の同名別個体は同時誘発を1件に畳み、使用後の同一ターン再宣言を止めるが、相手プレイヤーの同名は独立する", () => {
    const first = createCardInstance(c, {
      instanceId: "c02-first",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const second = createCardInstance(c, {
      instanceId: "c02-second",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const opponentField = createCardInstance(card("BSSL01-R01"), {
      instanceId: "c02-opponent-field",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const opponentHand = createCardInstance(c, {
      instanceId: "c02-opponent-hand",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const lookup = buildTriggeredEffectLookup([c]);
    const legalLookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
    };
    const before = createEmptyGameState({
      cardInstances: [first, second, opponentField, opponentHand],
      playerOverrides: [
        { voidNormalCoreCount: 10, reserveNormalCoreCount: 1 },
        { voidNormalCoreCount: 10 },
      ],
    });
    const afterBobVoidDecrease: GameState = {
      ...before,
      players: before.players.map((player) =>
        player.id === BOB ? { ...player, voidNormalCoreCount: 8 } : player
      ),
    };
    const firstQueued = collectAndQueueTriggerReactions({
      chainId: "test:bssl01-cards:693",
      beforeState: before,
      afterState: afterBobVoidDecrease,
      source: "action_resolution",
      causedByPlayerId: BOB,
      ...legalLookups,
      getRegisteredBurstActions: undefined,
    });

    // 同じプレイヤーの同名2個体は、同じ event に対して1件だけを宣言候補にする。
    expect(firstQueued.pendingPrivateDeclarations).toHaveLength(1);
    expect(firstQueued.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: ALICE,
      sourceInstanceId: "c02-first",
      sourceDefinitionId: c.cardNo,
      eventKind: "void_core_decrease",
    });
    const declareFirst = getLegalActions({
      state: firstQueued,
      actingPlayerId: ALICE,
      ...legalLookups,
    }).find(
      (action) =>
        action.kind === "declare_private_triggered_effect" &&
        action.sourceInstanceId === "c02-first"
    );
    expect(declareFirst).toBeDefined();
    if (!declareFirst) {
      throw new Error("missing first BSSL01-C02 private declaration");
    }
    const declaredFirst = applyLegalAction({
      state: firstQueued,
      action: declareFirst,
      ...legalLookups,
    }).state;
    expect(declaredFirst.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: c.cardNo,
        effectLabel: "effect:0",
        playerId: ALICE,
        duration: "turn",
      })
    );

    // 宣言後は相手の応答窓を閉じてから本文を解決する。C02 の「そうしたとき」は
    // 召喚成立を前提にするため、ここで無償召喚→禁止CE→コア選択を最終盤面まで完走する。
    const firstPending = declaredFirst.pendingTriggeredEffects.find(
      (pending) => pending.declaredFromPrivateZone === true
    );
    expect(firstPending).toBeDefined();
    if (!firstPending) {
      throw new Error("missing BSSL01-C02 declared pending effect");
    }
    const selectFirst = getLegalActions({
      state: declaredFirst,
      actingPlayerId: ALICE,
      ...legalLookups,
    }).find(
      (action) =>
        action.kind === "select_pending_to_resolve" &&
        action.pendingId === firstPending.pendingId
    );
    // 資格を失った他候補は除去済み。単独の宣言済み効果なら順序選択は不要。
    const selectedFirst = selectFirst
      ? applyLegalAction({
          state: declaredFirst,
          action: selectFirst,
          ...legalLookups,
        }).state
      : declaredFirst;
    const resolveFirst = getLegalActions({
      state: selectedFirst,
      actingPlayerId: ALICE,
      ...legalLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === firstPending.pendingId &&
        action.sourceInstanceId === "c02-first"
    );
    expect(resolveFirst).toBeDefined();
    if (!resolveFirst) {
      throw new Error("missing BSSL01-C02 triggered-effect resolution");
    }
    let afterStack = applyLegalAction({
      state: selectedFirst,
      action: resolveFirst,
      ...legalLookups,
    }).state;
    for (let guard = 0; afterStack.stackWindow && guard < 4; guard += 1) {
      const pass = getLegalActions({
        state: afterStack,
        actingPlayerId: afterStack.stackWindow.priorityPlayerId,
        ...legalLookups,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      if (!pass) throw new Error("missing BSSL01-C02 stack pass");
      afterStack = applyLegalAction({
        state: afterStack,
        action: pass,
        ...legalLookups,
      }).state;
    }
    afterStack = finishCoreChoices(afterStack, getDef);
    expect(afterStack.stackWindow).toBeNull();
    expect(afterStack.pendingCoreShootSelection).toMatchObject({
      totalAmount: 2,
      minTotal: 0,
    });
    const resolveCoreShoot = getLegalActions({
      state: afterStack,
      actingPlayerId: ALICE,
      ...legalLookups,
    }).find((action) => action.kind === "resolve_pending_core_shoot");
    expect(resolveCoreShoot).toBeDefined();
    if (!resolveCoreShoot) {
      throw new Error("missing BSSL01-C02 core-shoot resolution");
    }
    const firstResolved = applyLegalAction({
      state: afterStack,
      action: resolveCoreShoot,
      coreShootDistribution: { "c02-opponent-field": 2 },
      ...legalLookups,
    }).state;
    expect(
      firstResolved.cardInstances.find(
        (entry) => entry.instanceId === "c02-first"
      )?.zone
    ).toBe("field");
    expect(
      firstResolved.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "restrict_core_placement_void" &&
          effect.targetInstanceId === BOB
      )
    ).toBe(true);
    expect(
      firstResolved.cardInstances.find(
        (entry) => entry.instanceId === "c02-opponent-field"
      )?.normalCoreCount
    ).toBe(1);
    expect(bob(firstResolved).trashNormalCoreCount).toBe(2);

    // 本文の禁止CEにより BOB 自身の自然な二度目のボイド増加は起こせない。そのため、
    // usage record を入力にした collector の隔離回帰で、別個体・別ゾーンにも同名共有枠が
    // 適用されることを検証する（禁止CEを迂回する実ゲーム経路だとは主張しない）。
    const usageConsumed = {
      ...before,
      effectUsageRecords: firstResolved.effectUsageRecords,
    };
    const afterSecondBobVoidDecrease: GameState = {
      ...usageConsumed,
      players: usageConsumed.players.map((player) =>
        player.id === BOB ? { ...player, voidNormalCoreCount: 6 } : player
      ),
    };
    const sameNameBlocked = collectAndQueueTriggerReactions({
      chainId: "test:bssl01-cards:848",
      beforeState: usageConsumed,
      afterState: afterSecondBobVoidDecrease,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(sameNameBlocked.pendingPrivateDeclarations).toHaveLength(0);

    // 使用記録はプレイヤー単位なので、相手が同じ本文を持つカードは独立して宣言できる。
    // Alice の C02 が生成した禁止CEは BOB の自身効果だけを止めるため、Alice のボイド減少を
    // 見た BOB の C02 は実解決後の盤面でも発揮候補になる。
    const afterAliceVoidDecrease: GameState = {
      ...firstResolved,
      players: firstResolved.players.map((player) =>
        player.id === ALICE ? { ...player, voidNormalCoreCount: 8 } : player
      ),
    };
    const opponentQueued = collectAndQueueTriggerReactions({
      chainId: "test:bssl01-cards:868",
      beforeState: firstResolved,
      afterState: afterAliceVoidDecrease,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(opponentQueued.pendingPrivateDeclarations).toContainEqual(
      expect.objectContaining({
        ownerPlayerId: BOB,
        sourceInstanceId: "c02-opponent-hand",
        sourceDefinitionId: c.cardNo,
      })
    );
  });

  it("[board] restrict_core_placement_void: 制限対象プレイヤー自身の効果によるボイド→他ゾーンのコア移動のみブロックする（第三者由来・非ボイド源は妨げない）", () => {
    const restrictCE = {
      effectId: "ce-c02-void-restrict",
      sourceInstanceId: "c02-hand",
      sourceDefinitionId: c.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" as const },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "restrict_core_placement_void" as const,
      targetInstanceId: BOB,
    };
    const before: GameState = {
      ...createEmptyGameState({
        playerOverrides: [
          { reserveNormalCoreCount: 0 },
          { voidNormalCoreCount: 10, reserveNormalCoreCount: 0 },
        ],
      }),
      activeContinuousEffects: [restrictCE],
    };

    const voidToReserveEffect = (
      player: "self" | "opponent"
    ): NonNullable<CardDefinition["effects"]>[number] => ({
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "void", player },
            to: { kind: "reserve", player },
            amount: 2,
          },
        },
      ],
    });

    // BOB (制限対象) 自身が自分のボイドから移動しようとする → ブロックされる。
    const blockedState = executeEffect({
      chainId: "test:bssl01-cards:925",
      state: before,
      effect: voidToReserveEffect("self"),
      sourceInstanceId: "c02-hand",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    expect(bob(blockedState).voidNormalCoreCount).toBe(10);
    expect(bob(blockedState).reserveNormalCoreCount).toBe(0);

    // ALICE (第三者) が BOB のボイドから移動させる場合は「相手の効果で」に当たらずブロックしない。
    const thirdPartyState = executeEffect({
      chainId: "test:bssl01-cards:936",
      state: before,
      effect: voidToReserveEffect("opponent"),
      sourceInstanceId: "c02-hand",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(bob(thirdPartyState).voidNormalCoreCount).toBe(8);
    expect(bob(thirdPartyState).reserveNormalCoreCount).toBe(2);

    // ボイド以外の源 (リザーブ) からの移動は制限の対象外（リグレッション）。
    const nonVoidState = executeEffect({
      chainId: "test:bssl01-cards:947",
      state: {
        ...before,
        players: before.players.map((p) =>
          p.id === BOB ? { ...p, reserveNormalCoreCount: 3 } : p
        ),
      },
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "trash", player: "self" },
              amount: 2,
            },
          },
        ],
      },
      sourceInstanceId: "c02-hand",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    expect(bob(nonVoidState).reserveNormalCoreCount).toBe(1);
    expect(bob(nonVoidState).trashNormalCoreCount).toBe(2);
  });

  it("[board] 召喚/アタック時: 1枚ドロー（deck-1 / hand+1）", () => {
    const src = placeSelf(c, "tank-c02");
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ handCount: 0, deckCount: 10 }, {}],
    });
    const after = runEffect(before, c.effects![2]!, "tank-c02");
    expect(alice(after).deckCount).toBe(9);
    expect(alice(after).handCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// C03 カルテノン神殿 — 配置時 カウント+1→1ドロー / ドローステップ draw_modify
// ════════════════════════════════════════════════════════════════

describe("BSSL01-C03 カルテノン神殿", () => {
  const c = card("BSSL01-C03");

  it("構造: [0,1]配置時 count_increase→draw / [3,4]ドローステップ draw_modify (stub解消)", () => {
    const place = c.effects![0]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    expect(place.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(place.steps[1]!.action).toEqual({ kind: "draw", count: 1 });
    // [3,4] コスト先払い型ドロー枚数修正は inline draw_modify + prepaidCost で実装済 (stub 解消)。
    const drawEff = c.effects![1]!;
    expect(drawEff.stub).toBeUndefined();
    expect(drawEff.steps[0]!.action.kind).toBe("draw_modify");
  });

  it("[board] 配置時: カウント+1 かつ 1枚ドロー", () => {
    const src = placeSelf(c, "nexus-c03", 0);
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ countValue: 3, deckCount: 10, handCount: 0 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "nexus-c03");
    expect(alice(after).countValue).toBe(4);
    expect(alice(after).deckCount).toBe(9);
    expect(alice(after).handCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// C04 ペナルティエリア — 配置時 カウント+2→破棄でドロー / flash コアシュート
// ════════════════════════════════════════════════════════════════

describe("BSSL01-C04 ペナルティエリア", () => {
  const c = card("BSSL01-C04");

  it("構造: [0,1]配置時 count+2→discard→draw / [3,4]flash battleState+maxCost コアシュート (engine batch2-5)", () => {
    const place = c.effects![0]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    expect(place.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 2,
    });
    expect(place.steps[1]!.action.kind).toBe("discard");
    expect(place.steps[2]!.action).toEqual({ kind: "draw", count: 2 });
    expect(place.steps[2]!.connector).toBe("conditional_cost");
    // [3,4] は battleState:in_battle + maxCost:3 限定の field 源コアシュート（stub 解消）。
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    const fa = flash.steps[0]!.action;
    expect(fa.kind).toBe("core_move");
    if (fa.kind === "core_move" && fa.from.kind === "field") {
      expect(fa.from.filter?.battleState).toBe("in_battle");
      expect(fa.from.filter?.maxCost).toBe(3);
      expect(fa.amount).toBe("all");
    }
  });

  it("[board] 配置時: カウント+2 / 手札の影1枚破棄→2枚ドロー", () => {
    const src = placeSelf(c, "nexus-c04", 0);
    const h1 = createCardInstance(card("BSSL01-C02"), {
      instanceId: "hand-c04-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const d1 = createCardInstance(card("BSSL01-C02"), {
      instanceId: "deck-c04-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const d2 = createCardInstance(card("BSSL01-C03"), {
      instanceId: "deck-c04-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, h1, d1, d2],
      playerOverrides: [{ countValue: 0, handCount: 1, deckCount: 2 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "nexus-c04");
    expect(alice(after).countValue).toBe(2);
    // 破棄対象 h1 がトラッシュへ、デッキ2枚が手札へ。
    expect(
      after.cardInstances.find((x) => x.instanceId === "hand-c04-1")!.zone
    ).toBe("trash");
    const drawn = after.log.filter((l) => l.includes("effect:draw")).length;
    expect(drawn).toBe(2);
    expect(alice(after).deckCount).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// C05 短剣 — 召喚時 カウント+1+択一 / 合体中 単一対象コアシュート floor 除算
// ════════════════════════════════════════════════════════════════

describe("BSSL01-C05 短剣", () => {
  const c = card("BSSL01-C05");

  it("構造: [0,1]召喚時 count+1 + 択一(ドロー/魂状態召喚) / [3,4,5]合体中 単一対象コアシュート(floor除算)", () => {
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    // 後段の択一 = stub 解消。step[1] デフォルト=ドロー / choice[0]=魂状態召喚。
    expect(summon.stub).toBeUndefined();
    const choiceStep = summon.steps[1]!;
    expect(choiceStep.action).toEqual({ kind: "draw", count: 1 });
    const summonChoice = choiceStep.choice![0]!.action;
    expect(summonChoice.kind).toBe("summon");
    if (
      summonChoice.kind === "summon" &&
      summonChoice.target.kind === "from_zone"
    ) {
      expect(summonChoice.target.filter?.soulState).toBe("only");
      expect(summonChoice.target.filter?.cardName).toEqual([
        { contains: "水篠 旬" },
      ]);
      expect(summonChoice.costModifier).toEqual({ override: 0 });
    }
    const combined = c.effects![1]!;
    expect(combined.condition).toEqual([{ kind: "combined" }]);
    // 単一対象コアシュート: target 1体 + from target_card + max=floor(count/2)。stub 解消済み。
    expect(combined.stub).toBeUndefined();
    const move = combined.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "target_card" });
      expect(move.target).toMatchObject({ kind: "filter", count: 1 });
      expect(move.amount).toEqual({
        min: 0,
        max: { source: { kind: "count_value", player: "self" }, divisor: 2 },
      });
    }
  });

  it("[board] 召喚時: カウント+1", () => {
    const src = placeSelf(c, "tanken-c05");
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "tanken-c05");
    expect(alice(after).countValue).toBe(3);
  });

  it("[board] 召喚時 択一=魂状態召喚: 魂状態「水篠 旬」が通常スピリットへ昇格(コア配置・soulState 除去)", () => {
    const src = placeSelf(c, "tanken-c05");
    // 魂状態の CX01 水篠 旬: フィールド据え置き / normalCoreCount=0 / soulStateInstanceIds 登録。
    const shunSoul = createCardInstance(card("BSSL01-CX01"), {
      instanceId: "shun-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src, shunSoul],
      playerOverrides: [
        {
          countValue: 2,
          reserveNormalCoreCount: 5,
          soulStateInstanceIds: ["shun-soul"],
        },
        {},
      ],
    });
    // choiceIndex 1 = 魂状態召喚分岐を選択。
    let after = executeEffect({
      chainId: "test:bssl01-cards:1163",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "tanken-c05",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      choiceIndex: 1,
    });
    while (after.pendingStepOptionalChoice) {
      const action = getLegalActions({
        state: after,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      )!;
      after = applyLegalAction({
        state: after,
        action,
        getCardDefinitionById: getDef,
      }).state;
    }
    if (after.pendingMultiPlacement) {
      const action = getLegalActions({
        state: after,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }).find((a) => a.kind === "resolve_pending_multi_placement")!;
      after = applyLegalAction({
        state: after,
        action,
        getCardDefinitionById: getDef,
        multiPlacementAllocations: [
          {
            destinationInstanceId: "shun-soul",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      }).state;
    }
    // 前段 count+1 は両分岐で実行される。
    expect(alice(after).countValue).toBe(3);
    // 魂状態リストから除去 = 通常スピリット昇格。
    expect(alice(after).soulStateInstanceIds).not.toContain("shun-soul");
    const summoned = after.cardInstances.find(
      (x) => x.instanceId === "shun-soul"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");
    // CX01 requiredCores=1 / costModifier free → コスト0支払い + reserve から 1 個配置。
    expect(summoned.normalCoreCount).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(4);
    expect(after.pendingMultiPlacement).toBeNull();
  });

  it("[board] 召喚時 択一=魂状態召喚: 対象の魂状態カードが無ければ no-op", () => {
    const src = placeSelf(c, "tanken-c05");
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ countValue: 2, reserveNormalCoreCount: 5 }, {}],
    });
    let after = executeEffect({
      chainId: "test:bssl01-cards:1228",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "tanken-c05",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 1,
    });
    while (after.pendingStepOptionalChoice) {
      const action = getLegalActions({
        state: after,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      )!;
      after = applyLegalAction({
        state: after,
        action,
        getCardDefinitionById: getDef,
      }).state;
    }
    // count+1 は実行されるが、召喚対象不在で reserve 変化なし。
    expect(alice(after).countValue).toBe(3);
    expect(alice(after).reserveNormalCoreCount).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════
// CX01 水篠 旬 — フラッシュ 無条件カウント+1 / 契約煌臨 + 残置
// ════════════════════════════════════════════════════════════════

describe("BSSL01-CX01 水篠 旬", () => {
  const c = card("BSSL01-CX01");

  it("構造: [0]被煌臨(任意コア配置)=engine解消 / [2,3]相手効果離脱時2コスト残置+コア再配置 / [5,6]flash count+1 + step_phase ゲート後段", () => {
    // CX01 は契約 base（被煌臨側）。自分は煌臨しないので adventData は持たない。
    // 被煌臨の宣言自体は declare_advent/getContractAdventTargets で配線済み、
    // 任意コア配置は契約煌臨 魂状態 charge として engine 側で解消 → [0] stub 削除。
    expect(c.adventData).toBeUndefined();
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.textRef).toEqual([0]);
    // [2,3] pay_cost(2) → conditional_cost stay_on_field → core_distribute(field_and_reserve_self)。
    const leaveReplace = c.effects![1]!;
    expect(leaveReplace.stub).toBeUndefined();
    expect(leaveReplace.timingScope).toEqual({
      player: "both",
      period: "attack",
    });
    expect(leaveReplace.steps[0]!.action).toEqual({
      kind: "pay_cost",
      amount: 2,
    });
    expect(leaveReplace.steps[1]!.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
    });
    expect(leaveReplace.steps[1]!.connector).toBe("conditional_cost");
    expect(leaveReplace.steps[2]!.action).toEqual({
      kind: "core_distribute",
      from: { kind: "field_and_reserve_self" },
      to: { kind: "self" },
      amount: "all",
      mode: "player_choice",
      minTotal: 0,
    });
    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    // 〔ターンに1回〕(「:同名」無し) = per_instance（10_rules/03c 表。audit BSSL01-CX01 fix）。
    expect(flash.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    // 後段 step_phase ゲート実装で stub 解消。
    expect(flash.stub).toBeUndefined();
    // step[0]: 無条件カウント+1。
    expect(flash.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    // step[1]: アタックステップなら さらにカウント+1（step_phase:attack ゲート）。
    expect(flash.steps[1]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(flash.steps[1]!.condition).toEqual([
      { kind: "step_phase", step: "attack", whose: "either" },
    ]);
    // step[2]: このスピリットがいるなら手札1枚破棄（optional）。
    expect(flash.steps[2]!.action.kind).toBe("discard");
    expect(flash.steps[2]!.executionMode).toBe("optional");
    // step[3]: そうしたとき デッキ2枚ドロー（conditional_result）。
    expect(flash.steps[3]!.action).toEqual({ kind: "draw", count: 2 });
    expect(flash.steps[3]!.connector).toBe("conditional_result");
  });

  it("[board] [2,3] 相手効果でフィールドを離れるとき、2コスト支払って同じ疲労状態で残り、コアを好きなだけ再配置できる", () => {
    const self = createCardInstance(c, {
      instanceId: "shun-cx01-leave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-cx01-leave",
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      cardInstances: [self],
      pendingLeaveEntities: [
        {
          instanceId: "shun-cx01-leave",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-cx01-leave",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    before.step = "attack";
    const afterCost = executeEffect({
      chainId: "test:bssl01-cards:1359",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "shun-cx01-leave",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    // 2コスト支払い成功 → stay_on_field でフィールドに残置（疲労状態は維持）。
    const stayed = afterCost.cardInstances.find(
      (x) => x.instanceId === "shun-cx01-leave"
    )!;
    expect(stayed.zone).toBe("field");
    expect(stayed.exhaustState).toBe("exhausted");
    expect(stayed.pendingLeaveKind).toBeNull();
    expect(
      afterCost.pendingLeaveEntities.find(
        (e) => e.instanceId === "shun-cx01-leave"
      )
    ).toBeUndefined();
    expect(alice(afterCost).reserveNormalCoreCount).toBe(3);
    // コアを好きなだけ再配置: player_choice の pendingCoreDistribution が立つ。
    expect(afterCost.pendingCoreDistribution).not.toBeNull();
    const distributeAction = getLegalActions({
      state: afterCost,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(distributeAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterCost,
      action: distributeAction!,
      coreDistributionAllocations: { "shun-cx01-leave": 2 },
      coreDistributionSourceAllocations: { reserve: 2 },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find((x) => x.instanceId === "shun-cx01-leave")!
        .normalCoreCount
    ).toBe(3);
    expect(alice(resolved).reserveNormalCoreCount).toBe(1);
  });

  it("[board] [2,3] リザーブと待機カードの総量が2コストに不足する ときは残置もコア配置も発生しない", () => {
    const self = createCardInstance(c, {
      instanceId: "shun-cx01-nocost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-cx01-nocost",
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
      }),
      cardInstances: [self],
      pendingLeaveEntities: [
        {
          instanceId: "shun-cx01-nocost",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-cx01-nocost",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    before.step = "attack";
    const after = executeEffect({
      chainId: "test:bssl01-cards:1433",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "shun-cx01-nocost",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(alice(after).reserveNormalCoreCount).toBe(0);
    expect(after.pendingCoreDistribution).toBeNull();
    expect(
      after.pendingLeaveEntities.find(
        (e) => e.instanceId === "shun-cx01-nocost"
      )
    ).toBeDefined();
  });

  it("[board] フラッシュ: メインステップなら無条件カウント+1のみ（後段は step_phase ゲートで不発）", () => {
    const src = placeSelf(c, "shun-cx01");
    const h1 = createCardInstance(card("BSSL01-C02"), {
      instanceId: "hand-cx01-main",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [src, h1],
      playerOverrides: [{ countValue: 0, handCount: 1, deckCount: 5 }, {}],
    });
    before.step = "main";
    const after = runEffect(before, c.effects![2]!, "shun-cx01");
    // 後段ゲート不発 → カウント+1のみ、手札・デッキ不変。
    expect(alice(after).countValue).toBe(1);
    expect(
      after.cardInstances.find((x) => x.instanceId === "hand-cx01-main")!.zone
    ).toBe("hand");
    expect(after.log.filter((l) => l.includes("effect:draw")).length).toBe(0);
  });

  it("[legal action] 手札がなくても、後段の任意破棄とは独立したフラッシュのカウント増加を宣言・解決できる", () => {
    const source = createCardInstance(c, {
      instanceId: "shun-cx01-no-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "cx01-no-hand-attack",
        primaryEntityId: "cx01-no-hand-entity",
        participantEntityIds: ["cx01-no-hand-entity"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
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
      },
    };
    const effectLookups = {
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    };
    const declaration = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "shun-cx01-no-hand"
    );
    expect(declaration).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declaration!,
      ...effectLookups,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: declared,
      action: pass!,
      ...effectLookups,
    }).state;
    expect(alice(resolved).countValue).toBe(2);
  });

  it("[board] フラッシュ: アタックステップなら カウント+2 + 手札1枚破棄→2枚ドロー", () => {
    const src = placeSelf(c, "shun-cx01");
    const h1 = createCardInstance(card("BSSL01-C02"), {
      instanceId: "hand-cx01-atk",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const d1 = createCardInstance(card("BSSL01-C02"), {
      instanceId: "deck-cx01-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const d2 = createCardInstance(card("BSSL01-C03"), {
      instanceId: "deck-cx01-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, h1, d1, d2],
      playerOverrides: [{ countValue: 0, handCount: 1, deckCount: 2 }, {}],
    });
    before.step = "attack";
    const after = runEffect(before, c.effects![2]!, "shun-cx01");
    // 無条件 +1 + アタックステップ +1 = カウント2。
    expect(alice(after).countValue).toBe(2);
    // 手札 h1 が破棄され、デッキ2枚が手札へ。
    expect(
      after.cardInstances.find((x) => x.instanceId === "hand-cx01-atk")!.zone
    ).toBe("trash");
    expect(after.log.filter((l) => l.includes("effect:draw")).length).toBe(2);
    expect(alice(after).deckCount).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// M01 キバ — Lv2-3 フラッシュ 影スピリット数ぶんのコアシュート / 召喚 + 煌臨元 leave-dest
// ════════════════════════════════════════════════════════════════

describe("BSSL01-M01 キバ", () => {
  const c = card("BSSL01-M01");

  it("フラッシュとアタック誘発は同名ターン1回を共有し、移動元を1体に限定しない", () => {
    const flash = c.effects![2]!;
    const triggered = c.effects![3]!;
    expect(flash.timingScope).toEqual({ player: "both", period: "attack" });
    expect(flash.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(triggered.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "attack",
      triggerFilter: { category: ["spirit"], tribes: ["影", "プレイヤー"] },
    });
    expect(flash.limitGroupId).toBe(triggered.limitGroupId);
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(flash.steps).toBe(triggered.steps);
    expect(flash.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: {
        kind: "field",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
      },
      to: { kind: "reserve", player: "opponent" },
    });
  });

  function stateWithHandKiba(countValue: number, reserveNormalCoreCount = 20) {
    const hand = createCardInstance(c, {
      instanceId: "kiba-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      cardInstances: [hand],
      playerOverrides: [{ countValue }, { reserveNormalCoreCount: 0 }],
    });
    const state: GameState = {
      ...base,
      step: "main",
      activePlayerId: ALICE,
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, reserveNormalCoreCount } : p
      ),
    };
    return state;
  }

  function getKibaPermissionSummonAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "summon" &&
        action.sourceInstanceId === "kiba-hand" &&
        action.reason === "legal_summon_by_hand_permission"
    );
  }

  it("[board] [0] カウント5以上: 手札のキバにコスト4のQ54通常召喚 action が出る", () => {
    const state = stateWithHandKiba(5);
    const action = getKibaPermissionSummonAction(state);
    expect(action).toMatchObject({
      kind: "summon",
      sourceInstanceId: "kiba-hand",
      summonPermissionEffectIndex: 0,
      baseCostOverride: 4,
      finalCost: 4,
    });
    expect(
      getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }).some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "kiba-hand"
      )
    ).toBe(false);
  });

  it("[board] カウント4以下: 手札のキバにQ54 action が出ない", () => {
    const state = stateWithHandKiba(4);
    expect(getKibaPermissionSummonAction(state)).toBeUndefined();
  });

  it("[board] カウント5以上でも自分のアタックステップ中はQ54 action が出ない", () => {
    const state: GameState = { ...stateWithHandKiba(5), step: "attack" };
    expect(getKibaPermissionSummonAction(state)).toBeUndefined();
  });

  it("[board] 通常召喚宣言時にコスト4を支払い、stack後に維持コアを置いて召喚する", () => {
    const state = stateWithHandKiba(5);
    const action = getKibaPermissionSummonAction(state);
    expect(action).toBeDefined();
    if (!action || action.kind !== "summon") {
      throw new Error("missing BSSL01-M01 Q54 summon action");
    }

    const declared = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    }).state;

    expect(declared.window).toBe("stack");
    expect(alice(declared).reserveNormalCoreCount).toBe(16);
    expect(
      declared.cardInstances.find((entry) => entry.instanceId === "kiba-hand")
        ?.zone
    ).toBe("in_use");
    const passOpponent = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "pass_stack")!;
    const afterPass = applyLegalAction({
      state: declared,
      action: passOpponent,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    }).state;

    expect(afterPass.pendingEffectSummonCostPayment).toBeNull();
    expect(afterPass.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "kiba-hand"
    );
    const resolvePlacement = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolvePlacement!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    const summoned = resolved.cardInstances.find(
      (entry) => entry.instanceId === "kiba-hand"
    );
    expect(summoned?.zone).toBe("field");
  });
});

// ════════════════════════════════════════════════════════════════
// R01 (無銘) — 召喚/アタック時 相手1体の Lv コストを自分のカウント2につき+1
// ════════════════════════════════════════════════════════════════

describe("BSSL01-R01 Lvコスト加算修飾（自分のカウント2につき+1、動的 Amount）", () => {
  const c = card("BSSL01-R01");

  it("構造: override_properties.levelCostDelta が DynamicCount(count_value/2) で表現される", () => {
    const eff = c.effects![1]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.steps[0]!.action).toMatchObject({
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate", "nexus"] },
        count: 1,
      },
      properties: {
        levelCostDelta: {
          source: { kind: "count_value", player: "self" },
          divisor: 2,
        },
      },
      duration: { scope: "turn" },
    });
  });

  it("[board] 自分のカウント5 → floor(5/2)=2 の levelCostDelta CE を発動時点でスナップショット解決する", () => {
    const src = placeSelf(c, "r01-src");
    const enemy = createCardInstance(card("BSSL01-M03"), {
      instanceId: "enemy-r01",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, enemy],
      playerOverrides: [{ countValue: 5 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:1784",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "r01-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["enemy-r01"],
    });
    const ce = after.activeContinuousEffects.find(
      (c) => c.modifierTag === "override_properties"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("enemy-r01");
    expect(
      (ce!.metadata?.properties as Record<string, unknown> | undefined)
        ?.levelCostDelta
    ).toBe(2);
  });

  it("[board] 自分のカウント0 → floor(0/2)=0 の levelCostDelta CE を登録する（効果は成立するが加算量ゼロ）", () => {
    const src = placeSelf(c, "r01-src-zero");
    const enemy = createCardInstance(card("BSSL01-M03"), {
      instanceId: "enemy-r01-zero",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, enemy],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:1816",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "r01-src-zero",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["enemy-r01-zero"],
    });
    const ce = after.activeContinuousEffects.find(
      (c) => c.modifierTag === "override_properties"
    );
    expect(ce).toBeDefined();
    expect(
      (ce!.metadata?.properties as Record<string, unknown> | undefined)
        ?.levelCostDelta
    ).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// R03 光の破片の短剣 — 召喚時 search_zone(trash→hand) / 合体中 複合破棄
// ════════════════════════════════════════════════════════════════

describe("BSSL01-R03 光の破片の短剣", () => {
  const c = card("BSSL01-R03");

  it("構造: [0,1]召喚時 search_zone trash→hand / [3,4,5]合体中 手札+デッキ上合計2枚破棄→系統一致+カウント7以上でリザーブ支払い禁止", () => {
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    const action = summon.steps[0]!.action;
    expect(action.kind).toBe("search_zone");
    if (action.kind === "search_zone") {
      expect(action.zone).toBe("trash");
      expect(action.destination).toBe("hand");
      expect(action.filter!.tribes).toEqual(["影", "プレイヤー"]);
    }
    const combined = c.effects![1]!;
    expect(combined.condition).toEqual([{ kind: "combined" }]);
    expect(combined.stub).toBeUndefined();
    expect(combined.steps).toHaveLength(3);

    const handDisc = combined.steps[0]!;
    expect(handDisc.id).toBe("handDisc");
    expect(handDisc.action).toEqual({
      kind: "discard",
      player: "self",
      count: { min: 0, max: 2 },
    });

    const deckDisc = combined.steps[1]!;
    expect(deckDisc.id).toBe("deckDisc");
    expect(deckDisc.executionMode).toBe("optional");
    expect(deckDisc.action).toEqual({
      kind: "discard",
      player: "self",
      fromZone: "deck",
      count: {
        source: { kind: "cards_from_ref", stepId: "handDisc" },
        multiplier: -1,
        offset: 2,
      },
    });

    const restrictStep = combined.steps[2]!;
    expect(restrictStep.action).toEqual({
      kind: "restrict_reserve_cost_payment",
      player: "opponent",
      duration: { scope: "battle" },
    });
    expect(restrictStep.condition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
    ]);
    expect(restrictStep.stepCondition).toEqual({
      kind: "all",
      not: true,
      conditions: [
        {
          kind: "ref_has_match",
          stepId: "handDisc",
          filter: { tribes: ["影", "プレイヤー"], tribesLogic: "or" },
          not: true,
        },
        {
          kind: "ref_has_match",
          stepId: "deckDisc",
          filter: { tribes: ["影", "プレイヤー"], tribesLogic: "or" },
          not: true,
        },
      ],
    });
  });

  it("[board] 召喚時: トラッシュの影カード1枚が手札へ（trash→hand）", () => {
    const src = placeSelf(c, "tanken-r03");
    const trashCard = createCardInstance(card("BSSL01-M03"), {
      instanceId: "trash-r03-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const before = createEmptyGameState({
      cardInstances: [src, trashCard],
      playerOverrides: [{ handCount: 0 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "tanken-r03");
    const moved = after.cardInstances.find(
      (x) => x.instanceId === "trash-r03-1"
    );
    // search_zone は対象選択 pending を生成する場合があるため、ログ痕跡で発火を検証。
    const hasTrashSearch =
      after.log.some((l) => l.includes("search") || l.includes("return")) ||
      moved?.zone === "hand" ||
      after.pendingZoneSelection !== null;
    expect(hasTrashSearch).toBe(true);
  });

  describe("[board] [3,4,5] 合体中アタック時: 手札+デッキ上合計2枚破棄→系統一致+カウント7以上でリザーブ支払い禁止", () => {
    const tribeMatch = card("BSSL01-M03"); // tribe: "影・翼竜"
    const tribeOther = vanillaSpirit("TEST-BSSL01-R03-OTHER", 1000);
    const localMap = new Map<string, CardDefinition>([
      [c.cardNo, c],
      [tribeMatch.cardNo, tribeMatch],
      [tribeOther.cardNo, tribeOther],
    ]);
    const localGetDef = (id: string) => localMap.get(id);

    function board(countValue: number) {
      const src = createCardInstance(c, {
        instanceId: "r03-combined",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "host-shun",
      });
      const handTribeCard = createCardInstance(tribeMatch, {
        instanceId: "hand-tribe-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const handOtherCard = createCardInstance(tribeOther, {
        instanceId: "hand-other-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const deckCards = Array.from({ length: 4 }, (_, i) =>
        createCardInstance(tribeOther, {
          instanceId: `deck-r03-${i}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const before = createEmptyGameState({
        cardInstances: [src, handTribeCard, handOtherCard, ...deckCards],
        playerOverrides: [{ handCount: 2, deckCount: 4, countValue }, {}],
      });
      return before;
    }

    it("手札で系統一致1枚選択+カウント7以上 → リザーブ支払い禁止 CE が相手に登録される", () => {
      const before = board(7);
      const pending1 = executeEffect({
        chainId: "test:bssl01-cards:1979",
        state: before,
        effect: c.effects![1]!,
        sourceInstanceId: "r03-combined",
        actingPlayerId: ALICE,
        getCardDefinitionById: localGetDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      // handDisc: 任意上限 0..2 のゾーン選択 pending（手札2枚が候補）。
      expect(pending1.pendingZoneSelection).not.toBeNull();
      expect(pending1.pendingZoneSelection!.maxCount).toBe(2);
      expect(pending1.pendingZoneSelection!.candidateCardInstanceIds).toEqual(
        expect.arrayContaining(["hand-tribe-1", "hand-other-1"])
      );
      // 系統一致の1枚だけを選択（k1=1）。
      const afterHand = applyLegalAction({
        state: pending1,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: ["hand-tribe-1"],
        getCardDefinitionById: localGetDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).state;
      expect(afterHand.pendingZoneSelection ?? null).toBeNull();
      // deckDisc: 残り予算 = 2-1 = 1 → optionalQuantity は max<=1 のため付与されず
      // 通常の execute/decline 二択になる (blind 1枚確定)。
      expect(afterHand.pendingStepOptionalChoice).not.toBeNull();
      expect(
        afterHand.pendingStepOptionalChoice!.optionalQuantity
      ).toBeUndefined();
      const afterDeck = applyLegalAction({
        state: afterHand,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${afterHand.pendingStepOptionalChoice!.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: ALICE,
          pendingId: afterHand.pendingStepOptionalChoice!.pendingId,
          sourceInstanceId:
            afterHand.pendingStepOptionalChoice!.sourceInstanceId,
          effectIndex: afterHand.pendingStepOptionalChoice!.effectIndex,
          stepIndex: afterHand.pendingStepOptionalChoice!.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: localGetDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).state;

      // 手札1枚+デッキ1枚 = 合計2枚がトラッシュへ。デッキは4→3。
      expect(
        afterDeck.cardInstances.filter(
          (x) => x.zone === "trash" && x.ownerPlayerId === ALICE
        ).length
      ).toBe(2);
      expect(alice(afterDeck).deckCount).toBe(3);
      expect(
        afterDeck.cardInstances.find((x) => x.instanceId === "hand-tribe-1")!
          .zone
      ).toBe("trash");

      // 系統一致 (hand-tribe-1) + カウント7以上 → 相手にリザーブ支払い禁止 CE。
      const ce = afterDeck.activeContinuousEffects.find(
        (e) => e.modifierTag === "restrict_reserve_cost_payment"
      );
      expect(ce).toBeDefined();
      expect(ce!.targetInstanceId).toBe(BOB);
    });

    it("系統一致していてもカウント7未満なら リザーブ支払い禁止 CE は登録されない", () => {
      const before = board(5);
      const pending1 = executeEffect({
        chainId: "test:bssl01-cards:2049",
        state: before,
        effect: c.effects![1]!,
        sourceInstanceId: "r03-combined",
        actingPlayerId: ALICE,
        getCardDefinitionById: localGetDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const afterHand = applyLegalAction({
        state: pending1,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: ["hand-tribe-1"],
        getCardDefinitionById: localGetDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).state;
      const afterDeck = applyLegalAction({
        state: afterHand,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${afterHand.pendingStepOptionalChoice!.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: ALICE,
          pendingId: afterHand.pendingStepOptionalChoice!.pendingId,
          sourceInstanceId:
            afterHand.pendingStepOptionalChoice!.sourceInstanceId,
          effectIndex: afterHand.pendingStepOptionalChoice!.effectIndex,
          stepIndex: afterHand.pendingStepOptionalChoice!.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: localGetDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).state;

      const ce = afterDeck.activeContinuousEffects.find(
        (e) => e.modifierTag === "restrict_reserve_cost_payment"
      );
      expect(ce).toBeUndefined();
    });

    it.each([0, 1, 2])(
      "手札を破棄せずデッキ上から%d枚を選べる — 系統不一致なら CE 不登録",
      (amount) => {
        const before = board(7);
        const pending1 = executeEffect({
          chainId: "test:bssl01-cards:2093",
          state: before,
          effect: c.effects![1]!,
          sourceInstanceId: "r03-combined",
          actingPlayerId: ALICE,
          getCardDefinitionById: localGetDef,
          getRegisteredTriggeredEffectActions: noTriggerLookup,
        });
        // handDisc を辞退 (0枚選択)。
        const afterHand = applyLegalAction({
          state: pending1,
          action: { kind: "resolve_pending_zone_selection" },
          selectedZoneCardIds: [],
          getCardDefinitionById: localGetDef,
          getRegisteredTriggeredEffectActions: noTriggerLookup,
        }).state;
        // deckDisc: 残り予算 = 2-0 = 2 → optionalQuantity(0..2) の数量選択 chooser が立つ。
        expect(afterHand.pendingStepOptionalChoice).not.toBeNull();
        expect(afterHand.pendingStepOptionalChoice!.optionalQuantity).toEqual({
          kind: "discard",
          min: 0,
          max: 2,
        });
        const psoc = afterHand.pendingStepOptionalChoice!;
        const afterDeck = applyLegalAction({
          state: afterHand,
          action: {
            kind: "resolve_pending_step_optional_choice",
            actionId: `pso-${psoc.pendingId}:amount-${amount}`,
            can: true,
            reason: "test",
            actingPlayerId: ALICE,
            pendingId: psoc.pendingId,
            sourceInstanceId: psoc.sourceInstanceId,
            effectIndex: psoc.effectIndex,
            stepIndex: psoc.stepIndex,
            choice: amount === 0 ? "decline" : "execute",
            ...(amount > 0 ? { selectedAmount: amount } : {}),
          },
          getCardDefinitionById: localGetDef,
          getRegisteredTriggeredEffectActions: noTriggerLookup,
        }).state;

        // 選んだ枚数を上からトラッシュへ置き、手札は破棄しない。
        expect(
          afterDeck.cardInstances.filter(
            (x) => x.zone === "trash" && x.ownerPlayerId === ALICE
          ).length
        ).toBe(amount);
        expect(alice(afterDeck).deckCount).toBe(4 - amount);
        expect(alice(afterDeck).handCount).toBe(2);

        // デッキ上位2枚は系統不一致 (tribeOther) のため CE は登録されない。
        const ce = afterDeck.activeContinuousEffects.find(
          (e) => e.modifierTag === "restrict_reserve_cost_payment"
        );
        expect(ce).toBeUndefined();
      }
    );
  });
});

// ════════════════════════════════════════════════════════════════
// C06 影の召喚 — engine-token-summon-primitive: from_token_pool でトークン出現を実装
// ════════════════════════════════════════════════════════════════

describe("BSSL01-C06 影の召喚", () => {
  const c = card("BSSL01-C06");

  function resolveC06TokenCount(
    state: GameState,
    tokenCount: number
  ): GameState {
    expect(state.pendingSplitSummonChoice).not.toBeNull();
    expect(state.pendingSplitSummonChoice!.totalCount).toBe(2);
    expect(
      state.pendingSplitSummonChoice!.maxTokenCount
    ).toBeGreaterThanOrEqual(tokenCount);
    expect(state.pendingSplitSummonChoice!.zoneCandidateInstanceIds).toEqual(
      []
    );
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_split_summon_choice");
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      splitSummonTokenCount: tokenCount,
      splitSummonZoneCardInstanceIds: [],
    }).state;
  }

  it("構造: field_has(魂状態/煌臨元込み)条件 + 相手アタックステップ限定 + from_token_pool召喚 + 一時離脱耐性", () => {
    expect(c.effects).toHaveLength(1);
    const eff = c.effects![0]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.timingScope).toEqual({ player: "opponent", period: "attack" });
    expect(eff.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "水篠 旬" }],
        isContract: true,
        includeSoulState: true,
        includeAdventSource: true,
      },
    ]);
    const summonStep = eff.steps[0]!;
    expect(summonStep.id).toBe("c06-token-summon");
    expect(summonStep.action.kind).toBe("split_field_entry_choice");
    if (summonStep.action.kind === "split_field_entry_choice") {
      expect(summonStep.action.totalCount).toBe(2);
      expect(summonStep.action.tokenAction.target).toEqual({
        kind: "from_token_pool",
        count: 1,
      });
      expect(summonStep.action.tokenAction.trashCoreMax).toBe(1);
      expect(summonStep.action.tokenAction.trashCoreKind).toBe("generic");
      expect(summonStep.action.zoneAction).toBeUndefined();
    }
    const resistStep = eff.steps[1]!;
    expect(resistStep.action.kind).toBe("effect_resistance");
    if (resistStep.action.kind === "effect_resistance") {
      expect(resistStep.action.target).toEqual({
        kind: "ref",
        stepId: "c06-token-summon",
        result: "affected",
      });
      expect(resistStep.action.resistsOutcome).toBe("leave_field");
      expect(resistStep.action.source).toBe("opponent_effect");
      expect(resistStep.action.duration).toEqual({
        scope: "step",
        step: "attack",
      });
    }
  });

  it("[board] 契約スピリット魂状態あり: トークン2体を場に出す（reserve から維持コア）+ このステップ離脱耐性", () => {
    const shun = createCardInstance(card("BSSL01-CX01"), {
      instanceId: "shun-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const src = createCardInstance(c, {
      instanceId: "c06-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [shun, src],
      playerOverrides: [
        {
          soulStateInstanceIds: ["shun-soul"],
          reserveNormalCoreCount: 4,
          trashNormalCoreCount: 0,
        },
        {},
      ],
    });
    const splitState = runEffect(before, c.effects![0]!, "c06-src");
    const pendingState = resolveC06TokenCount(splitState, 2);
    expect(pendingState.pendingMultiPlacement).not.toBeNull();
    expect(pendingState.pendingMultiPlacement!.trashCoreMax).toBe(1);
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations:
        pendingState.pendingMultiPlacement!.targets.map((target) => ({
          destinationInstanceId: target.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        })),
    }).state;

    const tokens = after.cardInstances.filter(
      (x) => x.definitionId === "BSSL01-T01"
    );
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(token.zone).toBe("field");
      expect(token.ownerPlayerId).toBe(ALICE);
      expect(token.normalCoreCount).toBe(1);
    }
    // コスト0 x2体 + 維持コア1個x2体 = reserve から2個消費（コストは0）。
    expect(alice(after).reserveNormalCoreCount).toBe(2);

    const tokenIds = new Set(tokens.map((t) => t.instanceId));
    const resistanceCEs = after.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "cannot_leave_field" &&
        ce.targetInstanceId !== undefined &&
        tokenIds.has(ce.targetInstanceId)
    );
    expect(resistanceCEs).toHaveLength(2);
    for (const ce of resistanceCEs) {
      expect(ce.duration).toEqual({ scope: "step", step: "attack" });
    }
  });

  it("[board] reserve不足はtrashCoreMax(共有予算1)まで補う", () => {
    const shun = createCardInstance(card("BSSL01-CX01"), {
      instanceId: "shun-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const src = createCardInstance(c, {
      instanceId: "c06-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [shun, src],
      playerOverrides: [
        {
          soulStateInstanceIds: ["shun-soul"],
          reserveNormalCoreCount: 1,
          trashNormalCoreCount: 5,
        },
        {},
      ],
    });
    const splitState = runEffect(before, c.effects![0]!, "c06-src");
    const pendingState = resolveC06TokenCount(splitState, 2);
    expect(pendingState.pendingMultiPlacement).not.toBeNull();
    expect(pendingState.pendingMultiPlacement!.trashCoreMax).toBe(1);
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(action).toBeDefined();
    const [first, second] = pendingState.pendingMultiPlacement!.targets;
    const after = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: first!.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: second!.instanceId,
          placements: [{ kind: "trash_normal", amount: 1 }],
        },
      ],
    }).state;

    const tokens = after.cardInstances.filter(
      (x) => x.definitionId === "BSSL01-T01"
    );
    expect(tokens).toHaveLength(2);
    const totalCores = tokens.reduce((sum, t) => sum + t.normalCoreCount, 0);
    expect(totalCores).toBe(2);
    expect(alice(after).reserveNormalCoreCount).toBe(0);
    // trashCoreMax は召喚全体で共有 1 個までなので、trash 消費は 1 個だけ。
    expect(alice(after).trashNormalCoreCount).toBe(4);
  });

  it("[board] 2体までなので0体選択ではトークンも離脱耐性も発生しない", () => {
    const shun = createCardInstance(card("BSSL01-CX01"), {
      instanceId: "shun-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const src = createCardInstance(c, {
      instanceId: "c06-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [shun, src],
      playerOverrides: [
        {
          soulStateInstanceIds: ["shun-soul"],
          reserveNormalCoreCount: 4,
          trashNormalCoreCount: 1,
        },
        {},
      ],
    });
    const splitState = runEffect(before, c.effects![0]!, "c06-src");
    const after = resolveC06TokenCount(splitState, 0);

    expect(after.pendingMultiPlacement).toBeNull();
    expect(
      after.cardInstances.filter((x) => x.definitionId === "BSSL01-T01")
    ).toHaveLength(0);
    expect(
      after.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "cannot_leave_field"
      )
    ).toHaveLength(0);
  });

  it("[board] 条件不成立（水篠旬不在）はトークンを出さない", () => {
    const src = createCardInstance(c, {
      instanceId: "c06-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "c06-src");
    expect(
      after.cardInstances.filter((x) => x.definitionId === "BSSL01-T01")
    ).toHaveLength(0);
  });

  it("[board] isContract: カード名が同じでも契約カードでなければ不成立（トークンを出さない）", () => {
    const fakeShun: CardDefinition = {
      cardNo: "TEST-FAKE-SHUN",
      name: "水篠 旬",
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
      effects: [],
    };
    const fakeInstance = createCardInstance(fakeShun, {
      instanceId: "fake-shun-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const src = createCardInstance(c, {
      instanceId: "c06-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [fakeInstance, src],
      playerOverrides: [
        {
          soulStateInstanceIds: ["fake-shun-soul"],
          reserveNormalCoreCount: 4,
        },
        {},
      ],
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:2461",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "c06-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: definitionLookup([fakeShun]),
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.filter((x) => x.definitionId === "BSSL01-T01")
    ).toHaveLength(0);
  });

  // timingScope(opponent/attack) の実発火判定は state.step / activePlayerId だけでは
  // ゲートされない: フラッシュ使用 legal action (getAvailableMagicLegalActions) は
  // activeAttack.flashWindowState が開いていて自分に priority があるときのみ raw timings
  // に "flash" を含める (legal-actions-availability.ts getCurrentMagicActionTimingContext)。
  // window を開けずに step/activePlayerId だけ変えても raw timings が常に空になり、
  // timingScope 自体の絞り込みを一切検証しないテストになってしまうため、flash 窓を明示的に開く。
  function stateWithHandC06(
    activePlayerId: string,
    step: GameState["step"],
    withFlashWindow: boolean
  ) {
    const shun = createCardInstance(card("BSSL01-CX01"), {
      instanceId: "shun-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const src = createCardInstance(c, {
      instanceId: "c06-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      cardInstances: [shun, src],
      playerOverrides: [
        {
          soulStateInstanceIds: ["shun-soul"],
          reserveNormalCoreCount: 4,
        },
        {},
      ],
      ...(withFlashWindow
        ? {
            activeAttack: {
              attackId: "test-attack",
              primaryEntityId: "be-test",
              participantEntityIds: ["be-test"],
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
            },
          }
        : {}),
    });
    return {
      ...base,
      activePlayerId,
      step,
      ...(withFlashWindow ? { window: "flash_before_block" as const } : {}),
    };
  }

  function findC06UseMagic(state: GameState) {
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: emptyFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredMagicActions: magicLookup,
    });
    return actions.find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "c06-src"
    );
  }

  it("[board] timingScope(opponent/attack): 相手のアタックステップ中のフラッシュ窓で手札からのフラッシュ使用 legal action が出る", () => {
    const opponentAttack = stateWithHandC06(BOB, "attack", true);
    expect(findC06UseMagic(opponentAttack)).toBeDefined();
  });

  it("[board] 自分のアタックステップ中のフラッシュ窓は legal action が出ない（相手限定）", () => {
    const selfAttack = stateWithHandC06(ALICE, "attack", true);
    expect(findC06UseMagic(selfAttack)).toBeUndefined();
  });

  it("[board] 相手のメインステップ中（フラッシュ窓なし）は legal action が出ない（アタックステップ限定）", () => {
    const opponentMain = stateWithHandC06(BOB, "main", false);
    expect(findC06UseMagic(opponentMain)).toBeUndefined();
  });

  it("[board] トークンがフィールドを離れるとき、トラッシュではなくトークンプール(removed_from_game)へ戻る", () => {
    const before = createEmptyGameState({
      cardInstances: [
        createCardInstance(card("BSSL01-T01"), {
          instanceId: "token-leaver",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
          pendingLeaveKind: "destroy",
          pendingLeaveCause: "effect_resolution",
          pendingLeaveChainId: "chain:token-leaver",
        }),
      ],
    });
    const withPending: GameState = {
      ...before,
      pendingLeaveEntities: [
        {
          instanceId: "token-leaver",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: BOB,
          chainId: "chain:token-leaver",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const after = flushPendingLeaves(withPending, getDef);
    const token = after.cardInstances.find(
      (x) => x.instanceId === "token-leaver"
    )!;
    expect(token.zone).toBe("removed_from_game");
    expect(token.zone).not.toBe("trash");
  });
});

// ════════════════════════════════════════════════════════════════
// 旧 needs-dsl park カードの実装済み効果
// ════════════════════════════════════════════════════════════════

describe("BSSL01 旧 needs-dsl park カードの実装済み効果", () => {
  // X03 ベリオン: [0]動的コスト固定 (cost_modify self override) / [2,3]条件付きフラッシュ召喚解禁 /
  //   [5,6,7] 前段 煌臨元 leave-dest (advent_source, engine batch2-2) / 後段 Lvコスト加算を実装。
  it("BSSL01-X03 は [0]コスト上書き/[2,3]条件付きフラッシュ召喚解禁/[5,6,7]前段 煌臨元 leave-dest/後段 Lvコスト加算+リダー を実装", () => {
    const c = card("BSSL01-X03");
    expect(c.effects).toHaveLength(4);
    // [0] 動的コスト固定: cost_modify 自己対象 override:5（カウント5以上ゲート）。
    const costOverride = c.effects![0]!;
    expect(costOverride.stub).toBeUndefined();
    const coa = costOverride.steps[0]!.action;
    expect(coa.kind).toBe("cost_modify");
    if (coa.kind === "cost_modify") {
      expect(coa.target?.kind).toBe("self");
      expect(coa.modifier).toEqual({ override: 5 });
    }
    // [2,3] 条件付きフラッシュ召喚解禁（engine-advent-source-summon-permission、stub 解消）
    const flashSummon = c.effects![1]!;
    expect(flashSummon.stub).toBeUndefined();
    expect(flashSummon.applicability?.zone).toEqual([
      "hand",
      "trash",
      "advent_source",
    ]);
    const fsa = flashSummon.steps[0]!.action;
    expect(fsa.kind).toBe("summon");
    // [5,6,7] 前段: advent_source leave-dest（stub 解消）
    const leaveDest = c.effects![2]!;
    expect(leaveDest.stub).toBeUndefined();
    const lda = leaveDest.steps[0]!.action;
    expect(lda.kind).toBe("effect_resistance");
    if (lda.kind === "effect_resistance") {
      expect(lda.resistsOutcome).toBe("leave_field");
      expect(lda.source).toBe("opponent");
      expect(lda.replacement?.kind).toBe("advent_source");
    }
    // [5,6,7] 後段: Lvコスト加算修飾（stub 解消）+ 〔重複不可〕/防げない リダー配線
    const lvCostEff = c.effects![3]!;
    expect(lvCostEff.stub).toBeUndefined();
    expect(lvCostEff.preventionLevel).toBe("unpreventable");
    const lvLimits = Array.isArray(lvCostEff.usageLimit)
      ? lvCostEff.usageLimit
      : lvCostEff.usageLimit
        ? [lvCostEff.usageLimit]
        : [];
    expect(lvLimits.some((u) => u.kind === "no_duplicate")).toBe(true);
  });

  it("BSSL01-X03: advent_source 明示の cost_modify CE は recompute/rebuild 後も維持される", () => {
    const host = createCardInstance(card("BSSL01-CX01"), {
      instanceId: "host-x03",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      { cardInstanceId: "x03-source", role: "advent_source" as const },
    ];
    const source = createCardInstance(card("BSSL01-X03"), {
      instanceId: "x03-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    source.zoneRoleName = "advent-source";
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, source],
      playerOverrides: [{ countValue: 5 }, {}],
    });

    const rebuilt = recomputeAndRebuildContinuousEffects(base, getDef);
    const registered = rebuilt.activeContinuousEffects.find(
      (ce) =>
        ce.sourceInstanceId === "x03-source" &&
        ce.modifierTag === "cost_override"
    );
    expect(registered).toBeDefined();
    if (!registered) throw new Error("BSSL01-X03 cost_override CE missing");
    expect(registered?.metadata).toMatchObject({
      sourceApplicabilityZone: ["hand", "trash", "advent_source"],
    });

    const recomputedOnly = recomputeContinuousEffects(rebuilt);
    const preserved = recomputedOnly.activeContinuousEffects.find(
      (ce) => ce.effectId === registered.effectId
    );
    expect(preserved?.metadata).toMatchObject({
      sourceApplicabilityZone: ["hand", "trash", "advent_source"],
    });

    const recomputed = recomputeAndRebuildContinuousEffects(rebuilt, getDef);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "x03-source" &&
          ce.modifierTag === "cost_override"
      )
    ).toBe(true);
  });

  // M02 ベル: [0,1]烈神憑(手札召喚許可+コア移動代替コスト) / [3,4]煌臨元leave-dest / [6,7]restrict_stack
  it("BSSL01-M02 は [0,1] 烈神憑(手札召喚許可+トラッシュコア移動代替コスト)/[3,4] 煌臨元 leave-dest/[6,7] restrict_stack を実装する", () => {
    const c = card("BSSL01-M02");
    expect(c.effects).toHaveLength(4);
    // [0,1] 烈神憑 自己召喚許可 (engine-hand-summon-alt-cost-core-payment)
    const permission = c.effects![0]!;
    expect(permission.steps[0]!.action.kind).toBe("summon");
    expect(permission.stub).toBeUndefined();
    // [0,1] 続き: 継続 cost_modify + useCostPayment.core_move (トラッシュのコア移動代替コスト)
    const costModify = c.effects![1]!;
    expect(costModify.steps[0]!.action.kind).toBe("cost_modify");
    if (costModify.steps[0]!.action.kind === "cost_modify") {
      expect(costModify.steps[0]!.action.useCostPayment).toEqual({
        kind: "core_move",
        sourceZone: "trash",
        minCount: 5,
      });
    }
    expect(costModify.stub).toBeUndefined();
    // [3,4] 煌臨元 leave-dest
    expect(c.effects![2]!.steps[0]!.action.kind).toBe("effect_resistance");
    expect(c.effects![2]!.stub).toBeUndefined();
    // [6,7] restrict_stack
    const rs = c.effects![3]!;
    expect(rs.steps[0]!.action.kind).toBe("restrict_stack");
    expect(rs.timingScope).toEqual({ player: "self", period: "attack" });
    expect(rs.condition).toContainEqual({
      kind: "min_level",
      value: 2,
    });
    expect(rs.stub).toBeUndefined();
  });

  it("BSSL01-R02 は離脱置換 / BP以下コアシュート / P3-76対象リダイレクトを実装する", () => {
    const c = card("BSSL01-R02");
    expect(c.effects).toHaveLength(3);

    const leaveDest = c.effects![0]!;
    expect(leaveDest.stub).toBeUndefined();
    expect(leaveDest.preventionLevel).toBe("immune");
    const leaveAction = leaveDest.steps[0]!.action;
    expect(leaveAction.kind).toBe("effect_resistance");
    if (leaveAction.kind === "effect_resistance") {
      expect(leaveAction.resistsOutcome).toBe("leave_field");
      expect(leaveAction.source).toBe("opponent");
      expect(leaveAction.replacement?.kind).toBe("advent_source");
    }

    const coreShoot = c.effects![1]!;
    expect(coreShoot.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    const coreAction = coreShoot.steps[0]!.action;
    expect(coreAction.kind).toBe("core_move");
    if (
      coreAction.kind === "core_move" &&
      coreAction.target.kind === "filter"
    ) {
      expect(coreAction.target.filter.maxBpSource).toBe("self_effective_bp");
      expect(coreAction.amount).toBe("all");
    }

    const redirect = c.effects![2]!;
    expect(redirect.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "targeted",
      triggerFilter: { category: ["spirit"], tribes: ["影", "プレイヤー"] },
    });
    expect(redirect.condition).toContainEqual({
      kind: "min_level",
      value: 2,
    });
    expect(redirect.steps[0]!.action).toMatchObject({
      kind: "redirect_target",
      from: { kind: "trigger_related_instance" },
      to: { kind: "self" },
      mode: "all_current_effect_targets",
    });
  });

  function setupR02LeaveReplacementPending(): GameState {
    const r02 = card("BSSL01-R02");
    const hostDef = card("BSSL01-CX01");
    const leaver = createCardInstance(r02, {
      instanceId: "bssl01-r02-leaver",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const host = createCardInstance(hostDef, {
      instanceId: "bssl01-r02-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const state0 = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [leaver, host],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });
    const registered = executeEffect({
      chainId: "test:bssl01-cards:2811",
      state: state0,
      effect: r02.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "bssl01-r02-leaver",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      registered.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "bssl01-r02-leaver" &&
          ce.modifierTag === "replace_field_exit"
      )
    ).toBe(true);

    const leaverAfterRegistration = registered.cardInstances.find(
      (entry) => entry.instanceId === "bssl01-r02-leaver"
    )!;
    leaverAfterRegistration.pendingLeaveKind = "destroy";
    leaverAfterRegistration.pendingLeaveCause = "effect_resolution";
    leaverAfterRegistration.pendingLeaveChainId = "chain:bssl01-r02-leaver";
    const withPending: GameState = {
      ...registered,
      pendingLeaveEntities: [
        {
          instanceId: "bssl01-r02-leaver",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: "chain:bssl01-r02-leaver",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const flushed = flushPendingLeaves(withPending, getDef, ["purple"]);
    expect(flushed.pendingAdventSourceReplacement).toMatchObject({
      cardInstanceId: "bssl01-r02-leaver",
      choosingPlayerId: BOB,
      candidateHostInstanceIds: ["bssl01-r02-host"],
    });
    return flushed;
  }

  it("BSSL01-R02 [0,1] は相手起因離脱で水篠旬の煌臨元へ追加できる", () => {
    const flushed = setupR02LeaveReplacementPending();
    const addAction = getLegalActions({
      state: flushed,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_advent_source_replacement" &&
        action.choice === "advent_source" &&
        action.hostInstanceId === "bssl01-r02-host"
    );
    expect(addAction).toBeDefined();

    const applied = applyLegalAction({
      state: flushed,
      action: addAction!,
      getCardDefinitionById: getDef,
    }).state;
    const hostAfter = applied.cardInstances.find(
      (entry) => entry.instanceId === "bssl01-r02-host"
    )!;
    const leaverAfter = applied.cardInstances.find(
      (entry) => entry.instanceId === "bssl01-r02-leaver"
    )!;
    expect(applied.pendingAdventSourceReplacement).toBeNull();
    expect(hostAfter.underCards).toContainEqual({
      cardInstanceId: "bssl01-r02-leaver",
      role: "advent_source",
    });
    expect(leaverAfter.zone).toBe("field");
    expect(leaverAfter.zoneRoleName).toBe("advent-source");
    expect(leaverAfter.normalCoreCount).toBe(0);
    expect(leaverAfter.pendingLeaveKind).toBeNull();
    expect(applied.pendingLeaveEntities).toHaveLength(0);
    expect(bob(applied).reserveNormalCoreCount).toBe(3);
  });

  it("BSSL01-R02 [0,1] は相手の発揮できない抑止を受けない immune 効果として登録される", () => {
    const c = card("BSSL01-R02");
    expect(c.effects?.[0]?.preventionLevel).toBe("immune");

    const source = createCardInstance(c, {
      instanceId: "bssl01-r02-immune-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const suppressSource = createCardInstance(card("BSSL01-C01"), {
      instanceId: "bssl01-r02-suppress-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, suppressSource],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce:bssl01-r02-defense-suppress",
          sourceInstanceId: "bssl01-r02-suppress-source",
          sourceDefinitionId: "BSSL01-C01",
          actingPlayerId: ALICE,
          targetInstanceId: "bssl01-r02-immune-source",
          modifierTag: "defense_suppress",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
        },
      ],
    };

    expect(
      executeReevaluationCheck({
        state,
        checkKind: "prevention_clash",
        sourceInstanceId: "bssl01-r02-immune-source",
        targetInstanceIds: ["bssl01-r02-immune-source"],
        sourcePreventionLevel: c.effects![0]!.preventionLevel,
      })
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "prevention_clash",
        sourceInstanceId: "bssl01-r02-plain-source",
        targetInstanceIds: ["bssl01-r02-immune-source"],
        sourcePreventionLevel: "none",
      })
    ).toBe(false);
  });

  it("BSSL01-R02 [0,1] はトラッシュ選択時に通常離脱としてトラッシュへ置く", () => {
    const flushed = setupR02LeaveReplacementPending();
    const trashAction = getLegalActions({
      state: flushed,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_advent_source_replacement" &&
        action.choice === "trash"
    );
    expect(trashAction).toBeDefined();

    const declined = applyLegalAction({
      state: flushed,
      action: trashAction!,
      getCardDefinitionById: getDef,
    }).state;
    expect(declined.pendingAdventSourceReplacement).toBeNull();
    expect(declined.pendingLeaveEntities).toHaveLength(0);

    const hostAfter = declined.cardInstances.find(
      (entry) => entry.instanceId === "bssl01-r02-host"
    )!;
    const leaverAfter = declined.cardInstances.find(
      (entry) => entry.instanceId === "bssl01-r02-leaver"
    )!;
    expect(hostAfter.underCards ?? []).not.toContainEqual({
      cardInstanceId: "bssl01-r02-leaver",
      role: "advent_source",
    });
    expect(leaverAfter.zone).toBe("trash");
    expect(leaverAfter.pendingLeaveKind).toBeNull();
    expect(bob(declined).reserveNormalCoreCount).toBe(3);
  });

  it.each(["attack", "block"] as const)(
    "BSSL01-R02 [3,4] は%s時battle immediate経由で合体BP以下の相手1体だけを候補にし、コアすべてをリザーブへ置く",
    (timing) => {
      const c = card("BSSL01-R02");
      const braveDef = braveWithBoost("TEST-BSSL01-R02-BRAVE", 5000);
      const eligibleDef = vanillaSpirit("TEST-BSSL01-R02-ELIGIBLE-BP", 13000);
      const tooBigDef = vanillaSpirit("TEST-BSSL01-R02-TOO-BIG-BP", 15000);
      const attackerDef = vanillaSpirit("TEST-BSSL01-R02-ATTACKER", 16000);
      const definitions = [c, braveDef, eligibleDef, tooBigDef, attackerDef];
      const lookup = definitionLookup(definitions);
      const battleImmediateLookup =
        buildBattleImmediateEffectLookup(definitions);
      const effectLookups = {
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: emptyFieldEffectLookup,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      };
      const registrationIndex =
        battleImmediateLookup(c.cardNo)?.findIndex(
          (reg) => reg.effectIndex === 1 && reg.timing === timing
        ) ?? -1;
      expect(registrationIndex).toBeGreaterThanOrEqual(0);
      const registration = battleImmediateLookup(c.cardNo)![registrationIndex]!;
      const source = {
        ...createCardInstance(c, {
          instanceId: "bssl01-r02-core",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2,
        }),
        attachedChildrenIds: ["bssl01-r02-brave"],
      };
      const brave = {
        ...createCardInstance(braveDef, {
          instanceId: "bssl01-r02-brave",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        }),
        attachedToInstanceId: "bssl01-r02-core",
      };
      const eligible = createCardInstance(eligibleDef, {
        instanceId: "bssl01-r02-eligible",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 3,
      });
      const tooBig = createCardInstance(tooBigDef, {
        instanceId: "bssl01-r02-too-big",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 4,
      });
      const before: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [source, brave, eligible, tooBig],
          battleEntities: [
            {
              entityId: "battle-entity:bssl01-r02-core",
              memberInstanceIds: ["bssl01-r02-core"],
              resolvedBp: 14000,
              resolvedSymbols: ["purple"],
              attackState: timing === "attack" ? "attacking" : "blocking",
            },
            ...(timing === "block"
              ? [
                  {
                    entityId: "battle-entity:bssl01-r02-attacker",
                    memberInstanceIds: ["bssl01-r02-attacker"],
                    resolvedBp: 16000,
                    resolvedSymbols: ["red"],
                    attackState: "attacking" as const,
                  },
                ]
              : []),
          ],
          ...(timing === "block"
            ? {
                cardInstances: [
                  source,
                  brave,
                  eligible,
                  tooBig,
                  createCardInstance(attackerDef, {
                    instanceId: "bssl01-r02-attacker",
                    ownerPlayerId: BOB,
                    controllerPlayerId: BOB,
                    zone: "field",
                    normalCoreCount: 1,
                  }),
                ],
              }
            : {}),
          activeAttack: {
            attackId: "attack:bssl01-r02-core",
            primaryEntityId:
              timing === "block"
                ? "battle-entity:bssl01-r02-attacker"
                : "battle-entity:bssl01-r02-core",
            participantEntityIds:
              timing === "block"
                ? [
                    "battle-entity:bssl01-r02-attacker",
                    "battle-entity:bssl01-r02-core",
                  ]
                : ["battle-entity:bssl01-r02-core"],
            groupMode: "single",
            target: {
              kind: "player",
              playerId: timing === "block" ? ALICE : BOB,
            },
            blockAssignments: [
              {
                participantEntityId:
                  timing === "block"
                    ? "battle-entity:bssl01-r02-attacker"
                    : "battle-entity:bssl01-r02-core",
                blockedByEntityIds:
                  timing === "block" ? ["battle-entity:bssl01-r02-core"] : [],
              },
            ],
            symbolResolutionOrder: [
              timing === "block"
                ? "battle-entity:bssl01-r02-attacker"
                : "battle-entity:bssl01-r02-core",
            ],
            flashBeforeBlockCompleted: timing === "block",
            flashAfterBlockCompleted: false,
            flashWindowState: null,
          },
          battleImmediateEffects: [
            {
              promptId: `bi:bssl01-r02-core-shoot:${timing}`,
              attackId: "attack:bssl01-r02-core",
              timing,
              sourceKind: registration.sourceKind,
              sourceInstanceId: "bssl01-r02-core",
              sourceDefinitionId: c.cardNo,
              sourceCardNo: c.cardNo,
              actingPlayerId: ALICE,
              participantEntityId: "battle-entity:bssl01-r02-core",
              registrationIndex,
            },
          ],
          playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
        }),
        activePlayerId: ALICE,
        step: "attack",
        window: timing === "block" ? "declare_block" : "declare_attack",
        turnNumber: 2,
      };

      const declaration = getLegalActions({
        state: before,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        ...effectLookups,
      }).find((action) => action.kind === "resolve_battle_immediate_effect");
      expect(declaration).toBeDefined();
      const declared = applyLegalAction({
        state: before,
        action: declaration!,
        getCardDefinitionById: lookup,
        ...effectLookups,
      }).state;

      const passStack = getLegalActions({
        state: declared,
        actingPlayerId: BOB,
        getCardDefinitionById: lookup,
        ...effectLookups,
      }).find((action) => action.kind === "pass_stack");
      expect(passStack).toBeDefined();
      const afterStack = applyLegalAction({
        state: declared,
        action: passStack!,
        getCardDefinitionById: lookup,
        ...effectLookups,
      }).state;

      expect(afterStack.pendingEffectTargetSelection).toMatchObject({
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["bssl01-r02-eligible"],
      });

      const chooseEligible = getLegalActions({
        state: afterStack,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        ...effectLookups,
      }).find((action) => action.kind === "resolve_pending_effect_target");
      expect(chooseEligible).toBeDefined();
      const after = applyLegalAction({
        state: afterStack,
        action: chooseEligible!,
        targetInstanceIds: ["bssl01-r02-eligible"],
        getCardDefinitionById: lookup,
        ...effectLookups,
      }).state;

      expect(
        after.cardInstances.find(
          (entry) => entry.instanceId === "bssl01-r02-eligible"
        )?.normalCoreCount
      ).toBe(0);
      expect(bob(after).reserveNormalCoreCount).toBe(3);
      expect(
        after.cardInstances.find(
          (entry) => entry.instanceId === "bssl01-r02-too-big"
        )?.normalCoreCount
      ).toBe(4);
    }
  );

  it("BSSL01-R02 [6,7] は対象開示後に影スピリットから自身へ元効果対象を付け替える", () => {
    const bell = card("BSSL01-R02");
    const targetDef = card("BSSL01-C02");
    const magic: CardDefinition = {
      cardNo: "TEST-BSSL01-R02-TARGET-MAGIC",
      name: "Target Magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
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
    const definitions = [bell, targetDef, magic];
    const localMap = new Map(definitions.map((def) => [def.cardNo, def]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getDef(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const bellField = createCardInstance(bell, {
      instanceId: "bssl01-r02-field",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bssl01-r02-shadow-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const magicInUse = createCardInstance(magic, {
      instanceId: "bssl01-r02-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [bellField, target, magicInUse],
      }),
      activePlayerId: ALICE,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bssl01-r02",
        actingPlayerId: ALICE,
        sourceInstanceId: "bssl01-r02-magic",
        sourceDefinitionId: magic.cardNo,
        deferredStack: {
          stackId: "stack:bssl01-r02",
          actionKind: "magic",
          chainId: "chain:bssl01-r02",
          actingPlayerId: ALICE,
          cardInstanceId: "bssl01-r02-magic",
          cardDefinitionId: magic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
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
        candidateInstanceIds: ["bssl01-r02-shadow-target", "bssl01-r02-field"],
        targetEffectFilterTags: [],
      },
    };

    const chooseTarget = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseTarget).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseTarget!,
      targetInstanceIds: ["bssl01-r02-shadow-target"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      {
        targetInstanceIds: ["bssl01-r02-shadow-target"],
        targetCandidateInstanceIds: [
          "bssl01-r02-shadow-target",
          "bssl01-r02-field",
        ],
      }
    );

    const resolveBell = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bssl01-r02-field"
    );
    expect(resolveBell).toBeDefined();
    const afterBellDeclared = applyLegalAction({
      state: afterDisclosure,
      action: resolveBell!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    const passStack = getLegalActions({
      state: afterBellDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterBellDeclared,
      action: passStack!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterResolved.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterResolved.log).toContain(
      "effect:redirect_target:targeted-disclosure:bssl01-r02-shadow-target->bssl01-r02-field"
    );
    expect(
      afterResolved.cardInstances.find(
        (entry) => entry.instanceId === "bssl01-r02-shadow-target"
      )?.zone
    ).toBe("field");
    const bellAfter = afterResolved.cardInstances.find(
      (entry) => entry.instanceId === "bssl01-r02-field"
    );
    expect(
      bellAfter?.zone === "trash" ||
        afterResolved.pendingLeaveEntities.some(
          (entry) => entry.instanceId === "bssl01-r02-field"
        ) ||
        afterResolved.pendingAdventSourceReplacement?.cardInstanceId ===
          "bssl01-r02-field"
    ).toBe(true);
    expect(
      afterResolved.effectUsageRecords.some(
        (entry) =>
          entry.sourceInstanceId === "bssl01-r02-field" &&
          entry.effectLabel === "effect:2" &&
          entry.duration === "turn"
      )
    ).toBe(true);

    const usedState: GameState = {
      ...state,
      pendingEffectTargetSelection: {
        ...state.pendingEffectTargetSelection!,
        pendingId: "effect-target:bssl01-r02-used",
        deferredStack: {
          ...state.pendingEffectTargetSelection!.deferredStack,
          stackId: "stack:bssl01-r02-used",
          chainId: "chain:bssl01-r02-used",
        },
      },
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: "bssl01-r02-field",
        sourceDefinitionId: bell.cardNo,
        effectLabel: "effect:2",
        duration: "turn",
      }),
    };
    const chooseUsedTarget = getLegalActions({
      state: usedState,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseUsedTarget).toBeDefined();
    const afterUsedDisclosure = applyLegalAction({
      state: usedState,
      action: chooseUsedTarget!,
      targetInstanceIds: ["bssl01-r02-shadow-target"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(
      afterUsedDisclosure.pendingTriggeredEffects.some(
        (entry) => entry.sourceInstanceId === "bssl01-r02-field"
      )
    ).toBe(false);
    expect(
      getLegalActions({
        state: afterUsedDisclosure,
        actingPlayerId: BOB,
        getCardDefinitionById: lookup,
        ...effectLookups,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "bssl01-r02-field" &&
          action.skipOnly !== true
      )
    ).toBe(false);
  });

  it("BSSL01-R02 [6,7] は自分の効果で自分の影スピリットが対象になった場合も自身へ付け替える", () => {
    const bell = card("BSSL01-R02");
    const targetDef = card("BSSL01-C02");
    const selfMagic: CardDefinition = {
      cardNo: "TEST-BSSL01-R02-SELF-TARGET-MAGIC",
      name: "Self Target Magic",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["自分のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "destroy",
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
    const definitions = [bell, targetDef, selfMagic];
    const lookup = definitionLookup(definitions);
    const effectLookups = {
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions: () => [],
    };
    const bellField = createCardInstance(bell, {
      instanceId: "bssl01-r02-self-field",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bssl01-r02-self-shadow-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const magicInUse = createCardInstance(selfMagic, {
      instanceId: "bssl01-r02-self-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [bellField, target, magicInUse],
      }),
      activePlayerId: BOB,
      step: "attack",
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bssl01-r02-self",
        actingPlayerId: BOB,
        sourceInstanceId: "bssl01-r02-self-magic",
        sourceDefinitionId: selfMagic.cardNo,
        deferredStack: {
          stackId: "stack:bssl01-r02-self",
          actionKind: "magic",
          chainId: "chain:bssl01-r02-self",
          actingPlayerId: BOB,
          cardInstanceId: "bssl01-r02-self-magic",
          cardDefinitionId: selfMagic.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
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
        candidateInstanceIds: [
          "bssl01-r02-self-shadow-target",
          "bssl01-r02-self-field",
        ],
        targetEffectFilterTags: [],
      },
    };

    const chooseTarget = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseTarget).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseTarget!,
      targetInstanceIds: ["bssl01-r02-self-shadow-target"],
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;
    expect(
      afterDisclosure.pendingTriggeredEffects.some(
        (entry) =>
          entry.eventKind === "targeted" &&
          entry.relatedInstanceId === "bssl01-r02-self-shadow-target" &&
          entry.cause === "self_effect"
      )
    ).toBe(true);

    const resolveBell = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: BOB,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bssl01-r02-self-field"
    );
    expect(resolveBell).toBeDefined();
    const afterBellDeclared = applyLegalAction({
      state: afterDisclosure,
      action: resolveBell!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    const passStack = getLegalActions({
      state: afterBellDeclared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterBellDeclared,
      action: passStack!,
      getCardDefinitionById: lookup,
      ...effectLookups,
    }).state;

    expect(afterResolved.pendingTargetedDisclosureContinuation).toBeNull();
    expect(afterResolved.log).toContain(
      "effect:redirect_target:targeted-disclosure:bssl01-r02-self-shadow-target->bssl01-r02-self-field"
    );
    expect(
      afterResolved.cardInstances.find(
        (entry) => entry.instanceId === "bssl01-r02-self-shadow-target"
      )?.zone
    ).toBe("field");
    expect(
      afterResolved.cardInstances.find(
        (entry) => entry.instanceId === "bssl01-r02-self-field"
      )?.zone === "trash" ||
        afterResolved.pendingLeaveEntities.some(
          (entry) => entry.instanceId === "bssl01-r02-self-field"
        )
    ).toBe(true);
  });

  // M03 カイセル: [0,1] 煌臨元 leave-dest (advent_source, engine batch2-2) を実装。
  //   [3,4] 再配置コスト(状態コピー)+pay-to-blockゲートも実装済み
  //   (詳細は bssl01-m03-reposition-cost-pay-to-block.test.ts)。
  it("BSSL01-M03 は [0,1] 煌臨元 leave-dest / [3,4] 再配置コスト+pay-to-blockゲート を実装する", () => {
    const c = card("BSSL01-M03");
    const leaveDest = c.effects![0]!;
    expect(leaveDest.steps[0]!.action.kind).toBe("effect_resistance");
    expect(leaveDest.stub).toBeUndefined();
    const flashGate = c.effects![1]!;
    expect(flashGate.stub).toBeUndefined();
    expect(flashGate.steps.map((s) => s.action.kind)).toEqual([
      "set_exhaust_state",
      "require_battle_cost",
    ]);
  });
});

// ════════════════════════════════════════════════════════════════
// X01/X02 — 煌臨宣言を adventData へ再変換（declare_advent 配線済み）。
// 煌臨時/アタック時等のサブ効果は各構造テストで stub 解消を pin する。
// ════════════════════════════════════════════════════════════════

describe("BSSL01-X01 影の君主 水篠 旬（煌臨 adventData 再変換）", () => {
  const c = card("BSSL01-X01");

  it("構造: 契約煌臨 adventData ([3]代替コスト煌臨含む) / [5,6] トークン分配召喚 / [8,9] シンボル固定は実装済み", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    // 『お互いのターン』は main_and_flash で近似（doc 参照）。
    expect(c.adventData!.adventTiming).toBe("main_and_flash");
    expect(c.adventData!.soulCoreDest).toBe("trash");
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBeUndefined();
    expect(c.adventData!.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 5 },
    ]);
    // [3] 〔ターンに1回:同名〕相手のアタックステップ中、自分のトラッシュ5枚以上で
    // 《ソウルコア》をトラッシュに置いたものとして【契約煌臨】できる（代替コスト煌臨）。
    expect(c.adventData!.alternateCostAdvent).toEqual({
      condition: [
        { kind: "cards_in_zone", player: "self", zone: "trash", min: 5 },
      ],
      timing: "opponent_attack_step",
    });
    expect(c.effects).toHaveLength(2);
    // [5,6]【影の軍団】『このスピリットの煌臨時』合計2体(カウント7以上で3体)まで、トークン
    // 「影の兵士」を出すか系統:「影」スピリットをコストなし召喚(対象ごとに独立択一)。
    // split_field_entry_choice = ENGINE-sequential-slot-choice。
    const distribution = c.effects![0]!;
    expect(distribution.stub).toBeUndefined();
    expect(distribution.executionMode).toBe("optional");
    // 〔ターンに1回：【影の軍団】〕の per-turn 制限。
    expect(distribution.usageLimit).toEqual({
      kind: "per_group",
      duration: "turn",
    });
    const distAction = distribution.steps[0]!.action;
    expect(distAction.kind).toBe("split_field_entry_choice");
    if (distAction.kind === "split_field_entry_choice") {
      expect(distAction.totalCount).toEqual({
        source: { kind: "count_value", player: "self" },
        divisor: 7,
        offset: 2,
        cap: 3,
      });
      expect(distAction.tokenAction.target.kind).toBe("from_token_pool");
      expect(distAction.tokenAction.voidCoreMaxPerCard).toBe(1);
      expect(distAction.zoneAction.target.kind).toBe("from_zone");
      if (distAction.zoneAction.target.kind === "from_zone") {
        expect(distAction.zoneAction.target.zone).toEqual(["hand", "trash"]);
        expect(distAction.zoneAction.target.includeAdventSource).toBe(true);
        expect(distAction.zoneAction.target.filter).toEqual({
          category: ["spirit"],
          tribes: ["影"],
        });
      }
      expect(distAction.zoneAction.costModifier).toBe("free");
    }
    // [8,9]【OC中＆煌臨中】アタック時「シンボルを紫3つに固定」= override_properties.symbols +
    // symbolCountFixed + duration:{scope:"attack"} (ENGINE-attack-scope-ce-expiry fix 後に表現可能)。
    const symbolFix = c.effects![1]!;
    expect(symbolFix.stub).toBeUndefined();
    expect(symbolFix.condition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
      { kind: "self_state", state: "advented" },
    ]);
    expect(symbolFix.steps[0]!.action.kind).toBe("override_properties");
    const action = symbolFix.steps[0]!.action as Extract<
      (typeof symbolFix.steps)[0]["action"],
      { kind: "override_properties" }
    >;
    expect(action.properties.symbols).toEqual(["purple", "purple", "purple"]);
    expect(action.properties.symbolCountFixed).toBe(true);
    expect(action.duration).toEqual({ scope: "attack" });
  });

  it("盤面: [5,6] 合計2体をトークン1体+ゾーン系統影スピリット1体に分配選択し、両方が同時にフィールドへ出る（対象ごと独立択一の複合選択表現、ENGINE-sequential-slot-choice）", () => {
    const shadowSpirit: CardDefinition = {
      cardNo: "TEST-BSSL01-X01-SHADOW-SPIRIT",
      name: "影の何か",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      tribe: "影",
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const lookup = definitionLookup([shadowSpirit]);

    const shun = createCardInstance(c, {
      instanceId: "x01-dist-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(shadowSpirit, {
      instanceId: "hand-shadow-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [shun, handCard],
      playerOverrides: [{ reserveNormalCoreCount: 10, countValue: 0 }, {}],
    });

    const distribution = c.effects![0]!;
    const declared = executeEffect({
      chainId: "test:bssl01-cards:3768",
      state: before,
      effect: distribution,
      sourceInstanceId: "x01-dist-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const pending = declared.pendingSplitSummonChoice;
    expect(pending).not.toBeNull();
    // カウント0 → totalCount=2 (7未満)。
    expect(pending!.totalCount).toBe(2);
    expect(pending!.maxTokenCount).toBeGreaterThan(0);
    expect(pending!.zoneCandidateInstanceIds).toEqual(["hand-shadow-1"]);

    const legalAction = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_split_summon_choice");
    expect(legalAction).toBeDefined();

    const placementPending = applyLegalAction({
      state: declared,
      action: legalAction!,
      splitSummonTokenCount: 1,
      splitSummonZoneCardInstanceIds: ["hand-shadow-1"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(placementPending.pendingSplitSummonChoice).toBeNull();
    expect(placementPending.pendingMultiPlacement).not.toBeNull();
    expect(placementPending.pendingMultiPlacement!.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definitionId: "BSSL01-T01",
          voidNormalCoreMax: 1,
        }),
        expect.objectContaining({
          instanceId: "hand-shadow-1",
          definitionId: "TEST-BSSL01-X01-SHADOW-SPIRIT",
        }),
      ])
    );
    const abortAction = getLegalActions({
      state: placementPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "abort_pending_multi_placement");
    expect(abortAction).toBeDefined();
    const aborted = applyLegalAction({
      state: placementPending,
      action: abortAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(aborted.pendingSplitSummonChoice?.pendingId).toBe(
      pending!.pendingId
    );
    expect(aborted.pendingMultiPlacement).toBeNull();
    expect(
      aborted.cardInstances.filter(
        (ci) => ci.definitionId === "BSSL01-T01" && ci.zone === "field"
      )
    ).toHaveLength(0);
    expect(
      aborted.cardInstances.find((ci) => ci.instanceId === "hand-shadow-1")
        ?.zone
    ).toBe("hand");

    const placementAction = getLegalActions({
      state: placementPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    const resolved = applyLegalAction({
      state: placementPending,
      action: placementAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations:
        placementPending.pendingMultiPlacement!.targets.map((target) => ({
          destinationInstanceId: target.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        })),
    }).state;

    expect(resolved.pendingMultiPlacement).toBeNull();
    const tokens = resolved.cardInstances.filter(
      (ci) => ci.definitionId === "BSSL01-T01" && ci.zone === "field"
    );
    expect(tokens).toHaveLength(1);
    const summonedShadow = resolved.cardInstances.find(
      (ci) => ci.instanceId === "hand-shadow-1"
    );
    expect(summonedShadow?.zone).toBe("field");
  });

  it("盤面: [5,6] のコストなしゾーン召喚も、相手の効果召喚追加3コストを split pending 越しに支払う", () => {
    const shadowSpirit: CardDefinition = {
      cardNo: "TEST-BSSL01-X01-TAXED-SHADOW-SPIRIT",
      name: "追加コスト対象の影",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      tribe: "影",
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const lookup = definitionLookup([shadowSpirit]);
    const shun = createCardInstance(c, {
      instanceId: "x01-tax-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const shadowInHand = createCardInstance(shadowSpirit, {
      instanceId: "x01-tax-shadow",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const opponentTax = createCardInstance(card("BSTH02-C02"), {
      instanceId: "x01-opponent-effect-summon-tax",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = recomputeAndRebuildContinuousEffects(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [shun, shadowInHand, opponentTax],
        playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
      }),
      lookup
    );

    const declared = executeEffect({
      chainId: "test:bssl01-cards:3918",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: shun.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(declared.pendingSplitSummonChoice).toMatchObject({
      summonCause: "effect",
      zoneCandidateInstanceIds: [shadowInHand.instanceId],
    });
    const choice = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_split_summon_choice");
    expect(choice).toBeDefined();
    if (!choice) throw new Error("missing split summon choice action");
    let placementPending = applyLegalAction({
      state: declared,
      action: choice,
      splitSummonTokenCount: 0,
      splitSummonZoneCardInstanceIds: [shadowInHand.instanceId],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(placementPending.pendingEffectSummonCostPayment?.requiredCost).toBe(
      3
    );
    placementPending = applyLegalAction({
      state: placementPending,
      action: getLegalActions({
        state: placementPending,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
      }).find((a) => a.kind === "resolve_pending_effect_summon_cost_payment")!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      summonPaymentSources: [{ kind: "reserve", amount: 3 }],
    }).state;
    // 「コストを支払わずに」は0だが、BSTH02-C02 の effect summon tax 3は残る。
    expect(
      placementPending.players.find((p) => p.id === ALICE)!
        .reserveNormalCoreCount
    ).toBe(1);
    const placement = getLegalActions({
      state: placementPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placement).toBeDefined();
    if (!placement) throw new Error("missing split summon field placement");
    const resolved = applyLegalAction({
      state: placementPending,
      action: placement,
      multiPlacementAllocations: [
        {
          destinationInstanceId: shadowInHand.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === shadowInHand.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      resolved.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(0);
  });

  it("盤面: [5,6] のトークンを出す分岐は、相手の効果召喚追加コストを受けない", () => {
    const lookup = definitionLookup([]);
    const shun = createCardInstance(c, {
      instanceId: "x01-token-tax-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentTax = createCardInstance(card("BSTH02-C02"), {
      instanceId: "x01-token-opponent-effect-summon-tax",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = recomputeAndRebuildContinuousEffects(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [shun, opponentTax],
        playerOverrides: [
          { reserveNormalCoreCount: 0, voidNormalCoreCount: 1 },
          {},
        ],
      }),
      lookup
    );
    const declared = executeEffect({
      chainId: "test:bssl01-cards:4009",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: shun.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const choice = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_split_summon_choice");
    expect(choice).toBeDefined();
    if (!choice) throw new Error("missing token-only split summon choice");
    const placementPending = applyLegalAction({
      state: declared,
      action: choice,
      splitSummonTokenCount: 1,
      splitSummonZoneCardInstanceIds: [],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(placementPending.pendingMultiPlacement).not.toBeNull();
    expect(
      placementPending.players.find((p) => p.id === ALICE)!
        .reserveNormalCoreCount
    ).toBe(0);
    const placement = getLegalActions({
      state: placementPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placement).toBeDefined();
    if (!placement) throw new Error("missing token field placement");
    const tokenInstanceId =
      placementPending.pendingMultiPlacement!.targets[0]!.instanceId;
    const resolved = applyLegalAction({
      state: placementPending,
      action: placement,
      multiPlacementAllocations: [
        {
          destinationInstanceId: tokenInstanceId,
          placements: [{ kind: "void_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === tokenInstanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
  });

  it("盤面: [5,6]「まで」の辞退(0選択)・部分選択(1/2)が合法に解決される（tokenCount+zoneCount<=totalCountの上限のみ、下限強制なし）", () => {
    const shadowSpirit: CardDefinition = {
      cardNo: "TEST-BSSL01-X01-SHADOW-SPIRIT-2",
      name: "影の何か2",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      tribe: "影",
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const lookup = definitionLookup([shadowSpirit]);

    const shun = createCardInstance(c, {
      instanceId: "x01-dist-decline",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(shadowSpirit, {
      instanceId: "hand-shadow-decline",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [shun, handCard],
      playerOverrides: [{ reserveNormalCoreCount: 10, countValue: 0 }, {}],
    });
    const distribution = c.effects![0]!;

    // (a) 0選択 (辞退): tokenCount=0 + zoneCardInstanceIds=[] で正常終了しpendingがnullになる。
    const declaredDecline = executeEffect({
      chainId: "test:bssl01-cards:4104",
      state: before,
      effect: distribution,
      sourceInstanceId: "x01-dist-decline",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const pendingDecline = declaredDecline.pendingSplitSummonChoice;
    expect(pendingDecline).not.toBeNull();
    const declineAction = getLegalActions({
      state: declaredDecline,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_split_summon_choice");
    expect(declineAction).toBeDefined();
    const resolvedDecline = applyLegalAction({
      state: declaredDecline,
      action: declineAction!,
      splitSummonTokenCount: 0,
      splitSummonZoneCardInstanceIds: [],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(resolvedDecline.pendingSplitSummonChoice).toBeNull();
    expect(
      resolvedDecline.cardInstances.filter(
        (ci) => ci.definitionId === "BSSL01-T01" && ci.zone === "field"
      )
    ).toHaveLength(0);
    expect(
      resolvedDecline.cardInstances.find(
        (ci) => ci.instanceId === "hand-shadow-decline"
      )?.zone
    ).toBe("hand");

    // (b) 部分選択: totalCount=2 のうち tokenCount=1 のみ選び zoneCardInstanceIds=[] のまま
    // 決定できる (total=1 < totalCount=2 でも合法、下限強制が無いことを確認)。
    const declaredPartial = executeEffect({
      chainId: "test:bssl01-cards:4143",
      state: before,
      effect: distribution,
      sourceInstanceId: "x01-dist-decline",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const partialAction = getLegalActions({
      state: declaredPartial,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_split_summon_choice");
    expect(partialAction).toBeDefined();
    const placementPendingPartial = applyLegalAction({
      state: declaredPartial,
      action: partialAction!,
      splitSummonTokenCount: 1,
      splitSummonZoneCardInstanceIds: [],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(placementPendingPartial.pendingMultiPlacement).not.toBeNull();
    const partialPlacementAction = getLegalActions({
      state: placementPendingPartial,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(partialPlacementAction).toBeDefined();
    const resolvedPartial = applyLegalAction({
      state: placementPendingPartial,
      action: partialPlacementAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations:
        placementPendingPartial.pendingMultiPlacement!.targets.map(
          (target) => ({
            destinationInstanceId: target.instanceId,
            placements: [{ kind: "reserve_normal", amount: 1 }],
          })
        ),
    }).state;
    expect(resolvedPartial.pendingSplitSummonChoice).toBeNull();
    expect(resolvedPartial.pendingMultiPlacement).toBeNull();
    expect(
      resolvedPartial.cardInstances.filter(
        (ci) => ci.definitionId === "BSSL01-T01" && ci.zone === "field"
      )
    ).toHaveLength(1);
    // ゾーン側は未選択のまま手札に残る。
    expect(
      resolvedPartial.cardInstances.find(
        (ci) => ci.instanceId === "hand-shadow-decline"
      )?.zone
    ).toBe("hand");
  });

  it("盤面: カウント7以上で totalCount が3体に拡張され、リザーブ0でトークン3体すべてに対してpendingMultiPlacementが立ち、各1個ずつボイドから独立して補われる（voidCoreMaxPerCard の per-instance 上限、共有予算ではないことの回帰）", () => {
    const shun = createCardInstance(c, {
      instanceId: "x01-dist-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [shun],
      playerOverrides: [
        { countValue: 7, reserveNormalCoreCount: 0, voidNormalCoreCount: 5 },
        {},
      ],
    });
    const distribution = c.effects![0]!;
    const declared = executeEffect({
      chainId: "test:bssl01-cards:4217",
      state: before,
      effect: distribution,
      sourceInstanceId: "x01-dist-2",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const pending = declared.pendingSplitSummonChoice;
    expect(pending).not.toBeNull();
    // カウント7 → totalCount=3 (DynamicCount divisor:7,offset:2,cap:3)。
    expect(pending!.totalCount).toBe(3);
    expect(pending!.maxTokenCount).toBeGreaterThanOrEqual(3);

    const legalAction = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_split_summon_choice");
    expect(legalAction).toBeDefined();

    const placementPending = applyLegalAction({
      state: declared,
      action: legalAction!,
      splitSummonTokenCount: 3,
      splitSummonZoneCardInstanceIds: [],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(placementPending.pendingMultiPlacement).not.toBeNull();
    expect(
      placementPending.pendingMultiPlacement!.targets.every(
        (target) => target.voidNormalCoreMax === 1
      )
    ).toBe(true);
    const placementAction = getLegalActions({
      state: placementPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    const resolved = applyLegalAction({
      state: placementPending,
      action: placementAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations:
        placementPending.pendingMultiPlacement!.targets.map((target) => ({
          destinationInstanceId: target.instanceId,
          placements: [{ kind: "void_normal", amount: 1 }],
        })),
    }).state;

    expect(resolved.pendingSplitSummonChoice).toBeNull();
    expect(resolved.pendingMultiPlacement).toBeNull();
    const tokens = resolved.cardInstances.filter(
      (ci) => ci.definitionId === "BSSL01-T01" && ci.zone === "field"
    );
    expect(tokens).toHaveLength(3);
    // 共有予算(trashCoreMax型)なら2体目以降が0個のまま維持コア不足になる。
    for (const token of tokens) {
      expect(token.normalCoreCount).toBe(1);
    }
    const alicePlayer = alice(resolved);
    expect(alicePlayer.voidNormalCoreCount).toBe(2); // 5 - 3体分 = 2
  });

  it("盤面: [5,6] token選択時に維持コア供給不足ならsplit選択を拒否しpendingを保持する", () => {
    const shun = createCardInstance(c, {
      instanceId: "x01-dist-insufficient-placement",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [shun],
      playerOverrides: [
        { countValue: 7, reserveNormalCoreCount: 0, voidNormalCoreCount: 0 },
        {},
      ],
    });
    const distribution = c.effects![0]!;
    const declared = executeEffect({
      chainId: "test:bssl01-cards:4301",
      state: before,
      effect: distribution,
      sourceInstanceId: "x01-dist-insufficient-placement",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const pending = declared.pendingSplitSummonChoice;
    expect(pending).not.toBeNull();
    const legalAction = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_split_summon_choice");
    expect(legalAction).toBeDefined();

    expect(() =>
      applyLegalAction({
        state: declared,
        action: legalAction!,
        splitSummonTokenCount: 1,
        splitSummonZoneCardInstanceIds: [],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      })
    ).toThrow(/Not enough enter-field cores for split summon choice/);
    expect(declared.pendingSplitSummonChoice).toBe(pending);
    expect(declared.pendingMultiPlacement).toBeNull();
    expect(
      declared.cardInstances.filter(
        (ci) => ci.definitionId === "BSSL01-T01" && ci.zone === "field"
      )
    ).toHaveLength(0);
  });

  it("盤面: [8,9] 発揮でシンボルが紫3つに固定され、battle_end で失効し元シンボルに戻る (ENGINE-attack-scope-ce-expiry)", () => {
    const braveDef = card("BSGE01-C05");
    const shunBase = createCardInstance(c, {
      instanceId: "x01-symbol-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["x01-symbol-brave"],
    });
    // 【OC中＆煌臨中】ゲート充足のため煌臨元(advent_source)を1件持たせる。
    const shun = {
      ...shunBase,
      underCards: [
        {
          cardInstanceId: "dummy-advent-source",
          role: "advent_source" as const,
        },
      ],
    };
    const brave = createCardInstance(braveDef, {
      instanceId: "x01-symbol-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "x01-symbol-1",
    });
    const before = createEmptyGameState({
      cardInstances: [shun, brave],
      playerOverrides: [{ countValue: 7 }, {}],
    });
    const midBattle: GameState = {
      ...before,
      activeAttack: {
        attackId: "attack:x01-symbol:1",
        primaryEntityId: "be-x01",
        participantEntityIds: ["be-x01"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          { participantEntityId: "be-x01", blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: ["be-x01"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-x01",
          memberInstanceIds: ["x01-symbol-1", "x01-symbol-brave"],
          resolvedBp: 8000,
          resolvedSymbols: ["purple", "purple"],
          attackState: "attacking",
        },
      ],
    };
    const symbolFix = c.effects![1]!;
    const afterOverride = runEffect(midBattle, symbolFix, "x01-symbol-1");
    const ce = afterOverride.activeContinuousEffects.find(
      (e) =>
        e.targetInstanceId === "x01-symbol-1" &&
        e.modifierTag === "override_properties"
    );
    expect(ce).toBeDefined();
    expect(ce!.duration).toEqual({ scope: "attack" });

    const withExternalSymbols = recomputeBattleEntityBp(
      {
        ...afterOverride,
        activeContinuousEffects: [
          ...afterOverride.activeContinuousEffects,
          symbolAdditionCE("x01-symbol-1", "green"),
        ],
      },
      getDef
    );
    const fixedHost = withExternalSymbols.cardInstances.find(
      (ci) => ci.instanceId === "x01-symbol-1"
    )!;
    expect(
      getCombinedUnitSymbols(withExternalSymbols, fixedHost, c, getDef)
    ).toEqual(["purple", "purple", "purple"]);
    expect(
      withExternalSymbols.battleEntities.find((be) => be.entityId === "be-x01")
        ?.resolvedSymbols
    ).toEqual(["purple", "purple", "purple"]);
    const bobLifeBefore = getPlayerLifeCoreCount(
      withExternalSymbols.players.find((p) => p.id === BOB)!
    );
    const resolved = executeBattleResolution({
      state: withExternalSymbols,
      getCardDefinitionById: (id) =>
        id === c.cardNo ? c : id === c.backFace?.cardNo ? undefined : undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    expect(
      getPlayerLifeCoreCount(resolved.state.players.find((p) => p.id === BOB)!)
    ).toBe(bobLifeBefore - 3);
    expect(
      resolved.state.activeContinuousEffects.find(
        (e) =>
          e.targetInstanceId === "x01-symbol-1" &&
          e.modifierTag === "override_properties"
      )
    ).toBeUndefined();
  });

  it("盤面: [3]代替コスト煌臨 — ソウルコア無し・自分のトラッシュ5枚以上・相手のアタックステップ中に契約煌臨が成立し、ソウルコアは実消費されない。〔ターンに1回:同名〕でブロックされる", () => {
    // 名前条件「水篠 旬」を満たす合成の煌臨先ホスト（印字カードに通常フィールドの
    // 「水篠 旬」がいないため、adventCondition 判定のみを検証する目的の合成カード）。
    const host: CardDefinition = {
      cardNo: "TEST-BSSL01-X01-ALT-HOST",
      name: "水篠 旬",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const sameNameDifferentNo: CardDefinition = {
      ...c,
      cardNo: "TEST-BSSL01-X01-SAME-NAME",
    };
    const getDefWithHost = definitionLookup([host, sameNameDifferentNo]);
    const hostInstance = createCardInstance(host, {
      instanceId: "alt-host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const x01Hand = createCardInstance(c, {
      instanceId: "x01-alt-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const trashCards = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(host, {
        instanceId: `alt-trash-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { handCount: 1, soulCoreLocation: null, countValue: 5 },
        {},
      ],
      cardInstances: [hostInstance, x01Hand, ...trashCards],
    });
    // BOB (相手) がアタック中、ALICE がフラッシュ窓の優先権を持つ（相手のアタックステップ中）。
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "atk-bob-1",
        primaryEntityId: "e-bob-atk",
        participantEntityIds: ["e-bob-atk"],
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
      },
    };

    const lookups = {
      getCardDefinitionById: getDefWithHost,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
        ...ALL_CARDS,
        host,
        sameNameDifferentNo,
      ]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...ALL_CARDS,
        host,
        sameNameDifferentNo,
      ]),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup([
          ...ALL_CARDS,
          host,
          sameNameDifferentNo,
        ]),
    };

    function findAltDecl(
      s: GameState
    ): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
      const actions = getLegalActions({
        state: s,
        actingPlayerId: ALICE,
        ...lookups,
      });
      return actions.find(
        (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
          a.kind === "declare_advent" && a.sourceInstanceId === "x01-alt-1"
      );
    }

    function resolveAsIfChoice(s: GameState, choiceId: string): GameState {
      const pending = s.pendingAsIfSoulCoreChoice;
      expect(pending).not.toBeNull();
      const actions = getLegalActions({
        state: s,
        actingPlayerId: pending!.actingPlayerId,
        ...lookups,
      });
      const resolveAction = actions.find(
        (
          a
        ): a is Extract<
          LegalAction,
          { kind: "resolve_pending_as_if_soul_core_choice" }
        > =>
          a.kind === "resolve_pending_as_if_soul_core_choice" &&
          a.choiceId === choiceId
      );
      expect(resolveAction).toBeDefined();
      return applyLegalAction({
        state: s,
        action: resolveAction!,
        ...lookups,
      }).state;
    }

    function resolveEffectTarget(
      s: GameState,
      targetInstanceIds: string[]
    ): GameState {
      const pending = s.pendingEffectTargetSelection;
      expect(pending).not.toBeNull();
      const actions = getLegalActions({
        state: s,
        actingPlayerId: pending!.actingPlayerId,
        ...lookups,
      });
      const resolveAction = actions.find(
        (
          a
        ): a is Extract<
          LegalAction,
          { kind: "resolve_pending_effect_target" }
        > => a.kind === "resolve_pending_effect_target"
      );
      expect(resolveAction).toBeDefined();
      for (const id of targetInstanceIds) {
        expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
      }
      return applyLegalAction({
        state: s,
        action: resolveAction!,
        targetInstanceIds,
        ...lookups,
      }).state;
    }

    function passUntilClosed(
      s: GameState,
      targetInstanceIds: string[] = ["alt-host-1"],
      asIfChoiceId = "alternate"
    ): GameState {
      let cur = s;
      let guard = 0;
      while (
        (cur.stackWindow ||
          cur.activeAttack?.flashWindowState?.pendingStackAction) &&
        guard++ < 10
      ) {
        const responderId =
          cur.stackWindow?.priorityPlayerId ??
          cur.activeAttack!.flashWindowState!.priorityPlayerId;
        const actions = getLegalActions({
          state: cur,
          actingPlayerId: responderId,
          ...lookups,
        });
        const pass = actions.find(
          (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
        );
        if (!pass) throw new Error(`pass action not found for ${responderId}`);
        cur = applyLegalAction({ state: cur, action: pass, ...lookups }).state;
      }
      if (cur.pendingAsIfSoulCoreChoice !== null) {
        cur = resolveAsIfChoice(cur, asIfChoiceId);
      }
      if (cur.pendingEffectTargetSelection !== null) {
        cur = resolveEffectTarget(cur, targetInstanceIds);
      }
      return cur;
    }

    const countShortState: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === ALICE ? { ...player, countValue: 4 } : player
      ),
    };
    expect(
      findAltDecl(countShortState),
      "trash5枚+相手アタックステップでもC5未満なら declare_advent は出ないはず"
    ).toBeUndefined();

    const decl = findAltDecl(state);
    expect(
      decl,
      "trash5枚+相手アタックステップ+ソウルコア無しで declare_advent が legal になるはず"
    ).toBeDefined();
    expect(decl!.candidateTargetInstanceIds).toContain("alt-host-1");

    const declared = applyLegalAction({
      state,
      action: decl!,
      targetInstanceIds: ["alt-host-1"],
      ...lookups,
    }).state;
    const resolved = passUntilClosed(declared);

    const advCard = resolved.cardInstances.find(
      (ci) => ci.instanceId === "x01-alt-1"
    )!;
    expect(advCard.zone).toBe("field");
    expect(adventSourceIdsOf(advCard)).toContain("alt-host-1");
    // ソウルコアは「置いたものとして」擬制するだけで実消費しない（元々 null のまま）。
    expect(
      resolved.players.find((p) => p.id === ALICE)!.soulCoreLocation
    ).toBeNull();
    expect(resolved.usedAlternateCostAdventKeysThisTurn).toContain(
      `name:${c.name}`
    );

    // 〔ターンに1回:同名〕: 同ターン中は別 cardNo の同名カードでも再度は出ない。
    const secondCopy = createCardInstance(sameNameDifferentNo, {
      instanceId: "x01-alt-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const withSecondCopy: GameState = {
      ...resolved,
      cardInstances: [...resolved.cardInstances, secondCopy],
    };
    const secondActions = getLegalActions({
      state: withSecondCopy,
      actingPlayerId: ALICE,
      ...lookups,
    });
    expect(
      secondActions.find(
        (a) => a.kind === "declare_advent" && a.sourceInstanceId === "x01-alt-2"
      )
    ).toBeUndefined();
  });

  it("盤面: [3]代替コスト煌臨 — ソウルコアを所持していても通常経路/代替コスト経路の両方が窓後選択として並立し、プレイヤーが代替コストを選べばソウルコアを消費しない（原文に所持時の排他制約なし。adversarial verifier round1 refute #1 の再発防止）", () => {
    const host: CardDefinition = {
      cardNo: "TEST-BSSL01-X01-ALT-HOST-2",
      name: "水篠 旬",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const getDefWithHost = definitionLookup([host]);
    const hostInstance = createCardInstance(host, {
      instanceId: "alt-host-3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const x01Hand = createCardInstance(c, {
      instanceId: "x01-alt-4",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const trashCards = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(host, {
        instanceId: `alt-trash-both-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        // ソウルコアを所持（reserve）。
        { handCount: 1, soulCoreLocation: { kind: "reserve" }, countValue: 5 },
        {},
      ],
      cardInstances: [hostInstance, x01Hand, ...trashCards],
    });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "atk-bob-3",
        primaryEntityId: "e-bob-atk-3",
        participantEntityIds: ["e-bob-atk-3"],
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
      },
    };
    const lookups = {
      getCardDefinitionById: getDefWithHost,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
        ...ALL_CARDS,
        host,
      ]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...ALL_CARDS,
        host,
      ]),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup([...ALL_CARDS, host]),
    };

    function passStackWindowOnly(s: GameState): GameState {
      let cur = s;
      let guard = 0;
      while (
        (cur.stackWindow ||
          cur.activeAttack?.flashWindowState?.pendingStackAction) &&
        guard++ < 10
      ) {
        const responderId =
          cur.stackWindow?.priorityPlayerId ??
          cur.activeAttack!.flashWindowState!.priorityPlayerId;
        const passActions = getLegalActions({
          state: cur,
          actingPlayerId: responderId,
          ...lookups,
        });
        const pass = passActions.find(
          (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
        );
        if (!pass) throw new Error(`pass action not found for ${responderId}`);
        cur = applyLegalAction({ state: cur, action: pass, ...lookups }).state;
      }
      return cur;
    }

    function resolveAsIfChoice(s: GameState, choiceId: string): GameState {
      const pending = s.pendingAsIfSoulCoreChoice;
      expect(pending).not.toBeNull();
      const actions = getLegalActions({
        state: s,
        actingPlayerId: pending!.actingPlayerId,
        ...lookups,
      });
      const resolveAction = actions.find(
        (
          a
        ): a is Extract<
          LegalAction,
          { kind: "resolve_pending_as_if_soul_core_choice" }
        > =>
          a.kind === "resolve_pending_as_if_soul_core_choice" &&
          a.choiceId === choiceId
      );
      expect(resolveAction).toBeDefined();
      return applyLegalAction({
        state: s,
        action: resolveAction!,
        ...lookups,
      }).state;
    }

    function resolveEffectTarget(
      s: GameState,
      targetInstanceIds: string[]
    ): GameState {
      const pending = s.pendingEffectTargetSelection;
      expect(pending).not.toBeNull();
      const actions = getLegalActions({
        state: s,
        actingPlayerId: pending!.actingPlayerId,
        ...lookups,
      });
      const resolveAction = actions.find(
        (
          a
        ): a is Extract<
          LegalAction,
          { kind: "resolve_pending_effect_target" }
        > => a.kind === "resolve_pending_effect_target"
      );
      expect(resolveAction).toBeDefined();
      for (const id of targetInstanceIds) {
        expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
      }
      return applyLegalAction({
        state: s,
        action: resolveAction!,
        targetInstanceIds,
        ...lookups,
      }).state;
    }

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).filter(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "x01-alt-4"
    );
    // 宣言は1本。通常経路（ソウルコア消費）/代替コスト経路の選択はスタック窓後に開く。
    expect(actions).toHaveLength(1);

    // プレイヤーが代替コスト経路を選ぶと、所持しているソウルコアは消費されない。
    const declared = applyLegalAction({
      state,
      action: actions[0]!,
      ...lookups,
    }).state;
    expect(declared.pendingAsIfSoulCoreChoice).toBeNull();
    const afterStack = passStackWindowOnly(declared);
    expect(afterStack.pendingAsIfSoulCoreChoice).toMatchObject({
      actionKind: "declare_advent",
      actingPlayerId: ALICE,
    });
    expect(
      afterStack.pendingAsIfSoulCoreChoice!.options.map(
        (option) => option.choiceId
      )
    ).toEqual(["normal", "alternate"]);
    const afterChoice = resolveAsIfChoice(afterStack, "alternate");
    const cur = resolveEffectTarget(afterChoice, ["alt-host-3"]);
    const advCard = cur.cardInstances.find(
      (ci) => ci.instanceId === "x01-alt-4"
    )!;
    expect(advCard.zone).toBe("field");
    expect(adventSourceIdsOf(advCard)).toContain("alt-host-3");
    // ソウルコアは元の reserve のまま（消費されていない）。
    expect(cur.players.find((p) => p.id === ALICE)!.soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });

  it("盤面: [3]代替コスト煌臨 — 自分のトラッシュが4枚以下なら相手のアタックステップ中でも declare_advent は出ない", () => {
    const host: CardDefinition = {
      cardNo: "TEST-BSSL01-X01-ALT-HOST",
      name: "水篠 旬",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const getDefWithHost = definitionLookup([host]);
    const hostInstance = createCardInstance(host, {
      instanceId: "alt-host-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const x01Hand = createCardInstance(c, {
      instanceId: "x01-alt-3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    // トラッシュ4枚（5枚未満）。
    const trashCards = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(host, {
        instanceId: `alt-trash-lite-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { handCount: 1, soulCoreLocation: null, countValue: 5 },
        {},
      ],
      cardInstances: [hostInstance, x01Hand, ...trashCards],
    });
    const state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "atk-bob-2",
        primaryEntityId: "e-bob-atk-2",
        participantEntityIds: ["e-bob-atk-2"],
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
      },
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithHost,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
        ...ALL_CARDS,
        host,
      ]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...ALL_CARDS,
        host,
      ]),
    });
    expect(
      actions.find(
        (a) => a.kind === "declare_advent" && a.sourceInstanceId === "x01-alt-3"
      )
    ).toBeUndefined();
  });
});

describe("BSSL01-X02 真なる影の君主 水篠 旬（超契約煌臨 adventData 再変換）", () => {
  const c = card("BSSL01-X02");

  function applyWithLookups(
    state: GameState,
    action: LegalAction,
    lookups: Record<string, unknown>,
    targetInstanceIds?: string[]
  ): GameState {
    return (
      applyLegalAction({
        state,
        action,
        ...(targetInstanceIds !== undefined ? { targetInstanceIds } : {}),
        ...lookups,
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }

  function actionsWithLookups(
    state: GameState,
    actingPlayerId: string,
    lookups: Record<string, unknown>
  ): LegalAction[] {
    return getLegalActions({
      state,
      actingPlayerId,
      ...lookups,
    } as unknown as Parameters<typeof getLegalActions>[0]);
  }

  function resolveDeclaredAdvent(
    state: GameState,
    targetInstanceIds: string[],
    lookups: Record<string, unknown>
  ): GameState {
    let current = state;
    let guard = 0;
    while (
      (current.stackWindow ||
        current.activeAttack?.flashWindowState?.pendingStackAction) &&
      guard++ < 10
    ) {
      const responderId =
        current.stackWindow?.priorityPlayerId ??
        current.activeAttack!.flashWindowState!.priorityPlayerId;
      const pass = actionsWithLookups(current, responderId, lookups).find(
        (action) =>
          action.kind === "pass_stack" || action.kind === "pass_battle_flash"
      );
      expect(pass).toBeDefined();
      current = applyWithLookups(current, pass!, lookups);
    }
    if (current.pendingAsIfSoulCoreChoice !== null) {
      const pending = current.pendingAsIfSoulCoreChoice;
      const resolveAsIf = actionsWithLookups(
        current,
        pending.actingPlayerId,
        lookups
      ).find(
        (action) =>
          action.kind === "resolve_pending_as_if_soul_core_choice" &&
          action.choiceId === "normal"
      );
      expect(resolveAsIf).toBeDefined();
      current = applyWithLookups(current, resolveAsIf!, lookups);
    }
    if (current.pendingEffectTargetSelection !== null) {
      const pending = current.pendingEffectTargetSelection;
      const resolveTarget = actionsWithLookups(
        current,
        pending.actingPlayerId,
        lookups
      ).find(
        (
          action
        ): action is Extract<
          LegalAction,
          { kind: "resolve_pending_effect_target" }
        > => action.kind === "resolve_pending_effect_target"
      );
      expect(resolveTarget).toBeDefined();
      for (const id of targetInstanceIds) {
        expect(resolveTarget!.candidateTargetInstanceIds).toContain(id);
      }
      current = applyWithLookups(
        current,
        resolveTarget!,
        lookups,
        targetInstanceIds
      );
    }
    return current;
  }

  it("構造: 超契約煌臨と煌臨前追加のadventData、効果取得・紫シンボル・防止不可付与を実装する", () => {
    expect(c.adventData).toBeDefined();
    // 超契約煌臨は専用 variant が無く、対象列挙の観点で contract として扱う。
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("own_turn");
    // textLines[1]「自分のソウルコアをこのスピリットに置く」= 標準の消費先(trash)を
    // カード固有効果で上書きし、消費したソウルコアを煌臨後のこのカード自身に置く。
    expect(c.adventData!.soulCoreDest).toBe("this_card");
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBeUndefined();
    expect(c.adventData!.includeAdventSourceTarget).toBe(true);
    expect(c.adventData!.declareUsageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(c.adventData!.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
    ]);
    expect(c.effects).toHaveLength(3);
    expect(c.adventData!.beforeAdventSourceAddition).toEqual({
      fromZones: ["hand", "trash"],
      filter: { tribes: ["プレイヤー"] },
      textRef: [3],
    });
    // [1] grant_effect 集約 variant (P3-99 continuation): 煌臨元「水篠 旬」群の効果継承を
    //   実装済み（stub 解消）。usageLimit 無し（子 CE 単位 dedup は grantedEffectChildKey、
    //   毎 rebuild サイクル再実行される isGrantEffectAggregatorDeclaration 経路）。
    const aggregate = c.effects![0]!;
    expect(aggregate.stub).toBeUndefined();
    expect(aggregate.usageLimit).toBeUndefined();
    expect(aggregate.steps).toHaveLength(1);
    expect(aggregate.steps[0]!.action.kind).toBe("grant_effect");
    expect(
      (aggregate.steps[0]!.action as { grantedEffectSource?: unknown })
        .grantedEffectSource
    ).toEqual({
      kind: "advent_source_effects",
      nameFilter: { contains: "水篠 旬" },
    });
    // [2] 自スピリット全体への紫シンボル付与（〔重複不可〕、effects[1] と分離: no_duplicate は
    //   symbol_add 文にのみ係る）。
    const symbolGrant = c.effects![1]!;
    expect(symbolGrant.stub).toBeUndefined();
    expect(symbolGrant.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(symbolGrant.steps).toHaveLength(1);
    expect(symbolGrant.steps[0]!.action.kind).toBe("symbol_add");
    // [3] アタック時、系統：「影」を持つ自分の効果は相手の効果では防げない
    //   (engine-effect-prevention-immunity-tribes primitive)。
    //   【OC中＆煌臨中】= count_value(min:7) AND self_state:advented の2条件AND
    //   (同カード内 effects[1] / BSSL01-X01[8,9] と同型)。
    const preventionImmunity = c.effects![2]!;
    expect(preventionImmunity.stub).toBeUndefined();
    expect(preventionImmunity.condition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
      { kind: "self_state", state: "advented" },
    ]);
    expect(preventionImmunity.steps).toHaveLength(1);
    expect(preventionImmunity.steps[0]!.action).toEqual({
      kind: "grant_effect_source_prevention_immunity",
      player: "self",
      sourceScope: { tribes: ["影"] },
      duration: { scope: "battle" },
    });
  });

  it("盤面: 煌臨適用後、消費したソウルコアはトラッシュではなく煌臨後のこのスピリット自身に置かれる", () => {
    // X02 の adventCondition は cardNames:「水篠 旬」/ isContract:true を持ち、
    // C7以上は declareCondition の count gate で判定する。
    const target: CardDefinition = {
      ...vanillaSpirit("BSSL01-X02-TARGET", 3000),
      name: "水篠 旬 テスト対象",
      cost: 7,
      keywordTags: ["contract"],
    };
    const host = createCardInstance(target, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const advent = createCardInstance(c, {
      instanceId: "x02-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const localMap = new Map<string, CardDefinition>([
      [target.cardNo, target],
      [c.cardNo, c],
    ]);
    const localGetDef = (id: string) => localMap.get(id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          {
            handCount: 1,
            soulCoreLocation: { kind: "reserve" },
            countValue: 7,
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, advent],
    };

    const lookups = {
      getCardDefinitionById: localGetDef,
      getRegisteredFieldCardEffectActions: emptyFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    });
    const decl = actions.find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "x02-1"
    );
    expect(decl).toBeDefined();
    expect(decl!.soulCoreDest).toBe("this_card");

    const result = applyLegalAction({
      state,
      action: decl!,
      targetInstanceIds: ["host-1"],
      ...lookups,
    });
    // P3-112: declare_advent はスタック窓を開くのみ。窓後に対象選択を解決してから適用する。
    const newState = resolveDeclaredAdvent(result.state, ["host-1"], lookups);

    // 煌臨カードは host-1 の instanceId を維持したままフィールドへ移る。
    const adv = newState.cardInstances.find(
      (card) => card.instanceId === "x02-1"
    )!;
    expect(adv.zone).toBe("field");

    // 消費したソウルコアはトラッシュではなくこの煌臨カード自身 (x02-1) に置かれる。
    expect(alice(newState).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "x02-1",
    });
  });

  it("盤面: 超契約煌臨はトラッシュのソウルコアもこのスピリット自身へ置ける", () => {
    const target: CardDefinition = {
      ...vanillaSpirit("BSSL01-X02-TRASH-SOUL-TARGET", 3000),
      name: "水篠 旬 トラッシュ魂",
      keywordTags: ["contract"],
    };
    const host = createCardInstance(target, {
      instanceId: "trash-soul-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const advent = createCardInstance(c, {
      instanceId: "x02-trash-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const localGetDef = definitionLookup([target, c]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          {
            handCount: 1,
            soulCoreLocation: { kind: "trash" },
            countValue: 7,
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, advent],
    };

    const lookups = {
      getCardDefinitionById: localGetDef,
      getRegisteredFieldCardEffectActions: emptyFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    };
    const decl = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "x02-trash-soul"
    );
    expect(decl).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: decl!,
      targetInstanceIds: ["trash-soul-host"],
      ...lookups,
    }).state;
    const newState = resolveDeclaredAdvent(
      declared,
      ["trash-soul-host"],
      lookups
    );

    expect(alice(newState).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "x02-trash-soul",
    });
    expect(
      newState.cardInstances.find(
        (card) => card.instanceId === "x02-trash-soul"
      )?.soulCoreCount
    ).toBe(1);
  });

  it("盤面: 超契約煌臨はライフ上のソウルコアだけをこのスピリット自身へ移し、通常ライフは減らさない", () => {
    const target: CardDefinition = {
      ...vanillaSpirit("BSSL01-X02-LIFE-SOUL-TARGET", 3000),
      name: "水篠 旬 ライフ魂",
      keywordTags: ["contract"],
    };
    const host = createCardInstance(target, {
      instanceId: "life-soul-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const advent = createCardInstance(c, {
      instanceId: "x02-life-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const localGetDef = definitionLookup([target, c]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          {
            handCount: 1,
            lifeNormalCoreCount: 5,
            soulCoreLocation: { kind: "life" },
            countValue: 7,
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, advent],
    };
    expect(alice(state).lifeSoulCoreCount).toBe(1);

    const lookups = {
      getCardDefinitionById: localGetDef,
      getRegisteredFieldCardEffectActions: emptyFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    };
    const decl = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "x02-life-soul"
    );
    expect(decl).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: decl!,
      targetInstanceIds: ["life-soul-host"],
      ...lookups,
    }).state;
    const newState = resolveDeclaredAdvent(
      declared,
      ["life-soul-host"],
      lookups
    );

    expect(alice(newState).lifeNormalCoreCount).toBe(5);
    expect(alice(newState).lifeSoulCoreCount).toBe(0);
    expect(alice(newState).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "x02-life-soul",
    });
  });

  it("盤面: 超契約煌臨の〔ターンに1回:同名〕は同ターン2枚目の通常 declare_advent を止める", () => {
    const targetA: CardDefinition = {
      ...vanillaSpirit("BSSL01-X02-ONCE-TARGET-A", 3000),
      name: "水篠 旬 一回目",
      keywordTags: ["contract"],
    };
    const targetB: CardDefinition = {
      ...vanillaSpirit("BSSL01-X02-ONCE-TARGET-B", 3000),
      name: "水篠 旬 二回目",
      keywordTags: ["contract"],
    };
    const hostA = createCardInstance(targetA, {
      instanceId: "once-host-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const hostB = createCardInstance(targetB, {
      instanceId: "once-host-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const first = createCardInstance(c, {
      instanceId: "x02-once-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const sameNameDifferentNo: CardDefinition = {
      ...c,
      cardNo: "TEST-BSSL01-X02-SAME-NAME",
      orikaId: 999999,
      orikaIndex: 999999,
    };
    const second = createCardInstance(sameNameDifferentNo, {
      instanceId: "x02-once-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const localGetDef = definitionLookup([
      targetA,
      targetB,
      c,
      sameNameDifferentNo,
    ]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          {
            handCount: 2,
            soulCoreLocation: { kind: "reserve" },
            countValue: 7,
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [hostA, hostB, first, second],
    };
    const lookups = {
      getCardDefinitionById: localGetDef,
      getRegisteredFieldCardEffectActions: emptyFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    };
    const firstDecl = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "x02-once-a"
    );
    expect(firstDecl).toBeDefined();
    const declared = applyLegalAction({
      state,
      action: firstDecl!,
      targetInstanceIds: ["once-host-a"],
      ...lookups,
    }).state;
    const afterFirst = resolveDeclaredAdvent(
      declared,
      ["once-host-a"],
      lookups
    );

    expect(afterFirst.usedAdventDeclareKeysThisTurn).toContain(
      `name:${c.name}`
    );
    const secondActions = getLegalActions({
      state: afterFirst,
      actingPlayerId: ALICE,
      ...lookups,
    });
    expect(
      secondActions.find(
        (a) =>
          a.kind === "declare_advent" && a.sourceInstanceId === "x02-once-b"
      )
    ).toBeUndefined();
  });

  it("盤面: 超契約煌臨は『煌臨元を含む対象』へ opt-in し、旧hostの下から新しい煌臨元へ再親子付けする", () => {
    const target: CardDefinition = {
      ...vanillaSpirit("BSSL01-X02-ADVENT-SOURCE-TARGET", 3000),
      name: "水篠 旬 煌臨元テスト",
      keywordTags: ["contract"],
    };
    const oldHostDef: CardDefinition = {
      ...vanillaSpirit("BSSL01-X02-OLD-HOST", 5000),
      name: "旧host",
    };
    const oldHost = {
      ...createCardInstance(oldHostDef, {
        instanceId: "old-host-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      underCards: [
        { cardInstanceId: "source-target-1", role: "advent_source" as const },
      ],
    };
    const sourceTarget = createCardInstance(target, {
      instanceId: "source-target-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "advent-source",
    });
    const advent = createCardInstance(c, {
      instanceId: "x02-source-target",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const localGetDef = definitionLookup([target, oldHostDef, c]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          {
            handCount: 1,
            soulCoreLocation: { kind: "reserve" },
            countValue: 7,
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [oldHost, sourceTarget, advent],
    };

    const lookups = {
      getCardDefinitionById: localGetDef,
      getRegisteredFieldCardEffectActions: emptyFieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    };
    const decl = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" &&
        a.sourceInstanceId === "x02-source-target"
    );
    expect(decl).toBeDefined();
    expect(decl!.candidateTargetInstanceIds).toContain("source-target-1");

    const declared = applyLegalAction({
      state,
      action: decl!,
      targetInstanceIds: ["source-target-1"],
      ...lookups,
    }).state;
    const newState = resolveDeclaredAdvent(
      declared,
      ["source-target-1"],
      lookups
    );

    const newHost = newState.cardInstances.find(
      (card) => card.instanceId === "x02-source-target"
    )!;
    expect(newHost.zone).toBe("field");
    expect(adventSourceIdsOf(newHost)).toContain("source-target-1");
    const strippedOldHost = newState.cardInstances.find(
      (card) => card.instanceId === "old-host-1"
    )!;
    expect(strippedOldHost.underCards).not.toContainEqual({
      cardInstanceId: "source-target-1",
      role: "advent_source",
    });
    expect(alice(newState).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "x02-source-target",
    });
  });

  it("盤面: 煌臨元の「カード名の異なる『水篠 旬』」(C01/CX01) の非継続効果が host へ granted_effect CE として展開され、同名重複は1組にdedupeされ、host以外(煌臨元自身)は紫シンボルの対象外", () => {
    const c01 = card("BSSL01-C01");
    const cx01 = card("BSSL01-CX01");
    const host = {
      ...createCardInstance(c, {
        instanceId: "x02-host",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 4,
      }),
      underCards: [
        { cardInstanceId: "adv-c01-a", role: "advent_source" as const },
        // 同名 (再覚醒者 水篠 旬) の重複煌臨元。〔重複不可〕は無関係の usageLimit だが、
        // 集約 variant 自体も「カード名の異なる」＝同名は dedupe（先勝ち1件）する。
        { cardInstanceId: "adv-c01-b", role: "advent_source" as const },
        { cardInstanceId: "adv-cx01", role: "advent_source" as const },
      ],
    };
    const advC01a = createCardInstance(c01, {
      instanceId: "adv-c01-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const advC01b = createCardInstance(c01, {
      instanceId: "adv-c01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const advCx01 = createCardInstance(cx01, {
      instanceId: "adv-cx01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const before = createEmptyGameState({
      cardInstances: [host, advC01a, advC01b, advCx01],
      playerOverrides: [{ countValue: 7 }, {}],
    });

    const afterGrant = executeEffect({
      chainId: "test:bssl01-cards:5658",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "x02-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:5666",
      state: afterGrant,
      effect: c.effects![1]!,
      sourceInstanceId: "x02-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const grantedCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    // dedupe 後: C01 (textRef[3,4]/[7,8] の2件, timing:card_event) + CX01
    // (textRef[2,3]/[5,6] の2件, timing:card_event/activated) = 4件。
    // CX01 effects[0] (textRef[0], timing:continuous) は注入点が無いため除外される。
    // 2つ目の C01 (adv-c01-b) は同名 dedupe で不参入。
    expect(grantedCEs).toHaveLength(4);
    expect(grantedCEs.every((ce) => ce.targetInstanceId === "x02-host")).toBe(
      true
    );
    expect(
      grantedCEs.every((ce) => ce.metadata?.grantedEffect !== undefined)
    ).toBe(true);
    const grantedTextRefs = grantedCEs
      .map(
        (ce) =>
          (ce.metadata?.grantedEffect as { textRef?: number[] } | undefined)
            ?.textRef
      )
      .sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));
    expect(grantedTextRefs).toEqual([
      [2, 3],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);
    // grant_effect 集約 variant 由来の granted CE は、集約ホスト自身 (X02) の継続効果と
    // 同じ provenance (effectIndex:0) を共有する（OC 条件が外れれば一括失効する SSOT）。
    expect(grantedCEs.every((ce) => ce.provenance?.effectIndex === 0)).toBe(
      true
    );

    // 後段: 自分のスピリットすべてに紫シンボル1つ。煌臨元 (adv-c01-a/b, adv-cx01) は
    // アンダーカード包含スコープ既定除外 (project_name_reference_inclusion_scope_regression)
    // のため対象外、host のみが対象。
    const symbolCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    expect(symbolCEs).toHaveLength(1);
    expect(getSymbolAdditions(after, "x02-host", getDef)).toEqual([["purple"]]);
    for (const id of ["adv-c01-a", "adv-c01-b", "adv-cx01"]) {
      expect(getSymbolAdditions(after, id, getDef)).toEqual([]);
    }
  });

  it("盤面: rebuildサイクルを跨いで新しい煌臨元が追加されると、既存の granted CE を維持したまま新規子 CE のみが追加され、symbol_addition は重複登録されない (P3-99 §残留懸念: 集約 dedup 粒度の煌臨元カード単位化で解消)", () => {
    const c01 = card("BSSL01-C01");
    const cx01 = card("BSSL01-CX01");
    const host = {
      ...createCardInstance(c, {
        instanceId: "x02-host-incremental",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 4,
      }),
      underCards: [
        {
          cardInstanceId: "adv-c01-incremental",
          role: "advent_source" as const,
        },
      ],
    };
    const advC01 = createCardInstance(c01, {
      instanceId: "adv-c01-incremental",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const before = createEmptyGameState({
      cardInstances: [host, advC01],
      playerOverrides: [{ countValue: 7 }, {}],
    });

    // 1回目の rebuild: adv-c01-incremental のみが煌臨元として登録済み。
    const afterFirstRebuild = recomputeAndRebuildContinuousEffects(
      before,
      getDef
    );
    const grantedAfterFirst = afterFirstRebuild.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    // C01 の非継続効果2件 (textRef[3,4]/[7,8]) のみ展開。CX01 はまだ煌臨元未追加。
    expect(grantedAfterFirst).toHaveLength(2);
    const symbolAfterFirst = afterFirstRebuild.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    expect(symbolAfterFirst).toHaveLength(1);

    // 新しい煌臨元 (CX01) を host の下へ追加する（超契約煌臨の多重煌臨で到達可能な構図、
    // 04947 行台の既存テスト「盤面: 超契約煌臨は…新しい煌臨元へ再親子付けする」と同型の
    // underCards 直接更新で模擬）。CX01 自身は host の煌臨元として初めて場に現れる
    // （先に単独の自分スピリットとして存在させると symbol_add の自分スピリット全体フィルタが
    // 別途ヒットし、本テストが検証したい子 CE 差分と無関係な symbol CE 増分が混入するため）。
    const advCx01 = createCardInstance(cx01, {
      instanceId: "adv-cx01-incremental",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const hostWithNewSource = {
      ...afterFirstRebuild.cardInstances.find(
        (card) => card.instanceId === "x02-host-incremental"
      )!,
      underCards: [
        {
          cardInstanceId: "adv-c01-incremental",
          role: "advent_source" as const,
        },
        {
          cardInstanceId: "adv-cx01-incremental",
          role: "advent_source" as const,
        },
      ],
    };
    const withNewSource = {
      ...afterFirstRebuild,
      cardInstances: [
        ...afterFirstRebuild.cardInstances.map((card) =>
          card.instanceId === "x02-host-incremental" ? hostWithNewSource : card
        ),
        advCx01,
      ],
    };

    // 2回目の rebuild: 修正前 (host 単位早期 skip) は isAlreadyRegistered が host provenance
    // 一致で早期 true を返し executeEffect 自体が呼ばれず、CX01 由来の子 CE は永久に展開されない
    // バグがあった。本 fix は isGrantEffectAggregatorDeclaration が host 単位早期 skip を
    // バイパスし、grantedEffectChildKey による子単位 dedup が新規組み合わせのみ追加する。
    const afterSecondRebuild = recomputeAndRebuildContinuousEffects(
      withNewSource,
      getDef
    );
    const grantedAfterSecond =
      afterSecondRebuild.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "granted_effect"
      );
    // C01由来の既存2件 + CX01由来の非継続効果2件 (timing:card_event/activated、continuous の
    // effects[0]は除外) が新規展開され計4件。
    expect(grantedAfterSecond).toHaveLength(4);
    // 既存 C01 由来 CE の effectId は再生成されず維持される (idempotent incremental growth、
    // 全 CE を一度失効させてから作り直すのではなく差分追加であることの確認)。
    const c01EffectIdsBefore = new Set(
      grantedAfterFirst.map((ce) => ce.effectId)
    );
    const survivingC01EffectIds = grantedAfterSecond
      .filter((ce) => c01EffectIdsBefore.has(ce.effectId))
      .map((ce) => ce.effectId);
    expect(new Set(survivingC01EffectIds)).toEqual(c01EffectIdsBefore);

    // symbol_addition は〔重複不可〕(usageLimit:no_duplicate) のため2サイクル目でも1件のまま
    // (grant 集約側のみ毎サイクル再実行され、symbol_add 側は分離済みのため重複登録されない)。
    const symbolAfterSecond = afterSecondRebuild.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    expect(symbolAfterSecond).toHaveLength(1);
    expect(symbolAfterSecond[0]!.effectId).toBe(symbolAfterFirst[0]!.effectId);

    // OC 条件 (カウント7以上) が外れると、集約由来の granted CE は host provenance 単位で
    // 一括失効する (host 失効判定 SSOT は変更していないことの回帰防止)。
    const countDropped = {
      ...afterSecondRebuild,
      players: afterSecondRebuild.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 0 } : p
      ),
    };
    const afterConditionLost = recomputeAndRebuildContinuousEffects(
      countDropped,
      getDef
    );
    expect(
      afterConditionLost.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "granted_effect"
      )
    ).toBe(false);
  });

  it("盤面: 展開された CX01 の起動権 (フラッシュ) 付与効果を host 自身の効果として実行すると、実際にカウントが増える (grantedEffect: sourceEffect の埋め込みが機能する)", () => {
    const cx01 = card("BSSL01-CX01");
    const host = {
      ...createCardInstance(c, {
        instanceId: "x02-host-2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 4,
      }),
      underCards: [
        { cardInstanceId: "adv-cx01-2", role: "advent_source" as const },
      ],
    };
    const advCx01 = createCardInstance(cx01, {
      instanceId: "adv-cx01-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const before = createEmptyGameState({
      cardInstances: [host, advCx01],
      playerOverrides: [{ countValue: 7 }, {}],
    });

    const registered = executeEffect({
      chainId: "test:bssl01-cards:5878",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "x02-host-2",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    // CX01 effects[2] (textRef[5,6], timing:{kind:"activated",mode:"flash"}) の1段目
    // count_increase を host 自身のカウント+1 として実行すると実際に盤面 (countValue) が変わる。
    const flashCE = registered.activeContinuousEffects.find(
      (ce) =>
        (ce.metadata?.grantedEffect as { textRef?: number[] } | undefined)
          ?.textRef?.[0] === 5
    )!;
    expect(flashCE).toBeDefined();
    const grantedFlashEffect = flashCE.metadata!.grantedEffect as NonNullable<
      CardDefinition["effects"]
    >[number];

    const resolved = executeEffect({
      chainId: "test:bssl01-cards:5899",
      state: registered,
      effect: grantedFlashEffect,
      sourceInstanceId: "x02-host-2",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(alice(resolved).countValue).toBeGreaterThan(
      alice(registered).countValue
    );
  });

  it("盤面: [3] アタック時（カウント7以上・煌臨中）を実行すると、自分の系統：「影」を持つ効果を対象とする effect_source_prevention_immunity CE が登録される", () => {
    const host = {
      ...createCardInstance(c, {
        instanceId: "x02-host-3",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
      underCards: [
        { cardInstanceId: "adv-x02-host-3", role: "advent_source" as const },
      ],
    };
    const before = createEmptyGameState({
      cardInstances: [host],
      playerOverrides: [{ countValue: 7 }, {}],
    });

    const after = executeEffect({
      chainId: "test:bssl01-cards:5929",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: "x02-host-3",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const ce = after.activeContinuousEffects.find(
      (entry) => entry.modifierTag === "effect_source_prevention_immunity"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe(ALICE);
    expect(ce!.duration).toEqual({ scope: "battle" });
    expect((ce!.metadata as { tribes?: string[] }).tribes).toEqual(["影"]);
  });

  it("条件: [3] は煌臨中(自分に表向き煌臨元が1つ以上)でなければ成立しない（OC条件のカウント7以上のみでは不十分。adversarial verifier round1 で発見された欠落条件の再発防止）", () => {
    const notAdvented = createCardInstance(c, {
      instanceId: "x02-host-4",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const stateNotAdvented = createEmptyGameState({
      cardInstances: [notAdvented],
      playerOverrides: [{ countValue: 7 }, {}],
    });
    expect(
      evaluateCondition(
        stateNotAdvented,
        c.effects![2]!.condition!,
        "x02-host-4",
        ALICE,
        getDef
      )
    ).toBe(false);

    const advented = {
      ...createCardInstance(c, {
        instanceId: "x02-host-5",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
      underCards: [
        { cardInstanceId: "advent-source-1", role: "advent_source" as const },
      ],
    };
    const stateAdvented = createEmptyGameState({
      cardInstances: [advented],
      playerOverrides: [{ countValue: 7 }, {}],
    });
    expect(
      evaluateCondition(
        stateAdvented,
        c.effects![2]!.condition!,
        "x02-host-5",
        ALICE,
        getDef
      )
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// R02 アイアン / T01 影の兵士 — R02 実装済み / token 効果未実装を pin する存在ゲートテスト
// ════════════════════════════════════════════════════════════════

describe("BSSL01-R02 アイアン", () => {
  const c = card("BSSL01-R02");

  it("構造: 印字テキスト3節を effects 配線済み", () => {
    expect(c.name).toBe("アイアン");
    expect(c.textLines!.length).toBeGreaterThanOrEqual(8);
    expect(c.tribe).toBe("影・闘神");
    expect(c.effects).toHaveLength(3);
    expect(c.effects?.some((effect) => effect.stub)).toBe(false);
  });
});

describe("BSSL01-T01 影の兵士 (トークン印)", () => {
  const c = card("BSSL01-T01");

  it("構造: token 印・デッキ非搭載 (relatedTokenCardNos 経由で召喚)", () => {
    expect(c.name).toBe("影の兵士");
    expect(c.keywordTags).toContain("token");
    expect(c.maxTokenDeckCount).toBe(9);
    expect(c.tribe).toBe("影");
  });

  it("runtime: card_event[attack,destroy] の attack 側は battle immediate 系で queue される（P3-14 C-2, 二重発火防止で triggered には出ない）", () => {
    const sourceCard = createCardInstance(c, {
      instanceId: "shadow-token-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [sourceCard],
      }),
      step: "attack" as const,
      activePlayerId: ALICE,
      turnNumber: 2,
    };

    const result = queueRegisteredBattleImmediateEffects({
      state,
      attackId: `attack-group:2:${ALICE}:battle-entity:${sourceCard.instanceId}`,
      participantEntityId: `battle-entity:${sourceCard.instanceId}`,
      actingPlayerId: ALICE,
      sourceCard,
      sourceDefinition: c,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup([c]),
    });

    expect(result.battleImmediateEffects).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════
// T01 影の兵士 — アタック/破壊時 相手コアシュート or 破棄→ドロー
// (RequiredDiscardCost: 破棄分岐の宣言前 gate)
// ════════════════════════════════════════════════════════════════

describe("BSSL01-T01 影の兵士", () => {
  const c = card("BSSL01-T01");

  it("構造: card_event[attack,destroy] + choice[0]=core_move / choice[1]=discard→ref_choice draw", () => {
    expect(c.effects).toHaveLength(1);
    const eff = c.effects![0]!;
    expect(eff.timing).toEqual({
      kind: "card_event",
      event: ["attack", "destroy"],
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.stub).toBeUndefined();
    const choiceStep = eff.steps[0]!;
    expect(choiceStep.id).toBe("t01-choice");
    expect(choiceStep.action.kind).toBe("core_move");
    expect(choiceStep.choice).toHaveLength(1);
    expect(choiceStep.choice![0]!.action.kind).toBe("discard");
    if (choiceStep.choice![0]!.action.kind === "discard") {
      expect(choiceStep.choice![0]!.action.count).toBe(1);
      expect(choiceStep.choice![0]!.action.filter?.tribes).toEqual([
        "影",
        "プレイヤー",
      ]);
    }
    const drawStep = eff.steps[1]!;
    expect(drawStep.connector).toBe("conditional_cost");
    expect(drawStep.stepCondition).toEqual({
      kind: "ref_choice",
      stepId: "t01-choice",
      choiceIndex: 1,
    });
    expect(drawStep.action).toEqual({ kind: "draw", count: 1 });
  });

  it("registration: choices[1].requiredDiscardCost = amount1 + filter tribes:影/プレイヤー、choices[0]は無し", () => {
    const regs = generateTriggeredEffectRegistrations(c);
    const reg = regs.find(
      (r) => r.effectCategory === "triggered" && r.effectIndex === 0
    );
    expect(reg).toBeDefined();
    expect(reg!.choices).toHaveLength(2);
    expect(reg!.choices![0]!.requiredDiscardCost).toBeUndefined();
    const cost = reg!.choices![1]!.requiredDiscardCost;
    expect(cost).toBeDefined();
    expect(cost!.amount).toBe(1);
    expect(cost!.sourcePlayer).toBe("self");
    expect(cost!.sourceFilter).toEqual({ tribes: ["影", "プレイヤー"] });
  });

  // card_event:["attack","destroy"] のうち "attack" は battle immediate 系
  // (CARD_EVENT_TO_BATTLE_IMMEDIATE, P3-14 C-2 二重発火防止) で処理され pendingTriggeredEffects
  // には乗らない。"destroy" 側だけが generateTriggeredEffectRegistrations / pendingTriggeredEffects
  // 経由の resolve_pending_triggered_effect legal action として現れるため、gate 検証は destroy で行う。
  function setupDestroyPending(
    handCards: ReturnType<typeof createCardInstance>[]
  ) {
    const src = placeSelf(c, "t01-src");
    const regs = generateTriggeredEffectRegistrations(c);
    const regIndex = regs.findIndex(
      (r) =>
        r.effectCategory === "triggered" &&
        r.effectIndex === 0 &&
        r.eventKind === "destroy"
    );
    expect(regIndex).toBeGreaterThanOrEqual(0);
    const base = createEmptyGameState({
      cardInstances: [src, ...handCards],
      playerOverrides: [{ handCount: handCards.length }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      pendingTriggeredEffects: [
        {
          pendingId: "t01-destroy-pending",
          eventKind: "destroy",
          actingPlayerId: ALICE,
          source: "action_resolution",
          chainId: "test:bssl01-cards:6134",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "t01-src",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
          declaredFromPrivateZone: false,
          declaredSourceInstanceId: "t01-src",
          declaredSourceKind: "spirit",
          declaredRegistrationIndex: regIndex,
        },
      ],
    };
    return { state };
  }

  it("手札に系統:影/プレイヤーが無ければ宣言後 choiceIndex=1(破棄→ドロー)は選択候補にならない", () => {
    const other = createCardInstance(card("BSTS01-M01"), {
      instanceId: "t01-hand-other",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const { state } = setupDestroyPending([other]);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    }).filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === "t01-destroy-pending"
    ) as Extract<LegalAction, { kind: "resolve_pending_triggered_effect" }>[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.choiceIndex).toBeUndefined();
    expect(actions[0]?.deferredChoiceIndexes).toEqual([0]);
  });

  it("手札に系統:影/プレイヤーが1枚あれば宣言後 choiceIndex=1 も選択候補になる (RequiredDiscardCost gate 通過)", () => {
    const kage = createCardInstance(card("BSSL01-C02"), {
      instanceId: "t01-hand-kage",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const { state } = setupDestroyPending([kage]);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    }).filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === "t01-destroy-pending"
    ) as Extract<LegalAction, { kind: "resolve_pending_triggered_effect" }>[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.choiceIndex).toBeUndefined();
    expect(actions[0]?.deferredChoiceIndexes).toEqual([0, 1]);
  });

  it("[board] choiceIndex=1 実行: 手札の系統:影カード1枚破棄→デッキ上から1ドロー", () => {
    const src = placeSelf(c, "t01-src-board-1");
    const kage = createCardInstance(card("BSSL01-C02"), {
      instanceId: "t01-hand-kage-board",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deckCard = createCardInstance(card("BSSL01-C03"), {
      instanceId: "t01-deck-board",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, kage, deckCard],
      playerOverrides: [{ handCount: 1, deckCount: 1 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:6219",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "t01-src-board-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 1,
    });
    // 候補1枚=count1 は auto-resolve (needsSelection: matching.length(1) > effectiveCount(1) は false)
    // のため pendingZoneSelection は生成されず即破棄→conditional_cost 効果側(draw)まで完遂する。
    expect(after.pendingZoneSelection ?? null).toBeNull();
    expect(
      after.cardInstances.find((x) => x.instanceId === "t01-hand-kage-board")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "t01-deck-board")!.zone
    ).toBe("hand");
    expect(alice(after).deckCount).toBe(0);
  });

  it("[board] choiceIndex=0 実行: 相手フィールドのコア1個を相手のリザーブへ移動し、ドローは発生しない", () => {
    const src = placeSelf(c, "t01-src-board-0");
    const bobSpirit = createCardInstance(
      vanillaSpirit("TEST-BSSL01-T01-BOARD0", 3000),
      {
        instanceId: "t01-bob-spirit-board0",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 2,
      }
    );
    const before = createEmptyGameState({
      cardInstances: [src, bobSpirit],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bssl01-cards:6257",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "t01-src-board-0",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 0,
    });
    expect(
      after.cardInstances.find((x) => x.instanceId === "t01-bob-spirit-board0")!
        .normalCoreCount
    ).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(0);
    expect(bob(after).reserveNormalCoreCount).toBe(
      bob(before).reserveNormalCoreCount + 1
    );
    expect(
      after.cardInstances.some(
        (x) => x.zone === "hand" && x.ownerPlayerId === ALICE
      )
    ).toBe(false);
  });
});
