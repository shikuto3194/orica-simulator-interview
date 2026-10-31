/**
 * BSTS01 (転生したらスライムだった件) todo カード 13枚の effects 検証テスト。
 *
 * 実装した忠実効果:
 *   - 「青としても扱う」treat_as appliesToCard（C02/C03/M01/M02/M03/X03）
 *   - C01 契約煌臨 adventData / 召喚煌臨時 2ドロー→手札5枚以下に破棄(targetHandSize) /
 *         OC トラッシュから青ネクサスをコストなし配置（search_zone destination:field）
 *   - C02 召喚時 void→this_card / void→trash + 相手起因離脱時 trash→reserve(《ソウルコア》以外)
 *   - C03 召喚時デッキ上3枚を見て上/下へ並べ替え（deck_reveal picks:[] player_choice）
 *   - C06 ミラージュセット / セット中メインで相手手札2枚を見る / メイン 3ドロー→手札5枚以下に破棄（targetHandSize）
 *   - M01 召喚/アタック時 相手手元カード除外 + 条件付き void→this 2 / バースト attack_after + 召喚
 *   - M02 召喚/アタック時 spirit/ult+nexus 破壊(発揮させない) / 自効果離脱時 相手ライフ→リザーブ
 *   - M03 条件 field_has(ultimate リムル) ゲート（コア除去本体は field_card 源未対応で stub）
 *   - R02 hand_increase バースト / 召喚時 2ドロー→1破棄(固定) / フラッシュ・スタック回復(limitGroup共有)
 *   - R03 フラッシュ vanish(コア→リザーブ既定) + 発揮抑止 + ブレイヴ残存不可
 *   - X01 契約煌臨 adventData / [3,4]カウント連動 動的上限破壊(count_value/2)+per-target 報酬(cards_from_ref)
 *   - X02 契約煌臨 adventData / 煌臨時 life+soul 除外の全通常コア集約→暴嵐召喚 / アタック時 創界神含む2つまで破壊 / X03 leave_field バースト 重疲労2+デッキ下+召喚
 *
 * 新エンジン能力で再変換した項目（旧 stub の解消）:
 *   - 煌臨宣言 declare_advent 配線済み → C01/X01/X02 に adventData（08a / Phase C）
 *   - discard targetHandSize 配線済み → C01[3,4]/C06[5,6] の「5枚以下になるよう破棄」を表現
 *   - トラッシュ→フィールド配置（search_zone destination:field）配線済み → C01[6,7,8]
 *
 * 真に未実装で needs-dsl park（doc 引用済み、空 effects か stub）:
 *   - カウント増加量メタ修飾（C03[5,6]）
 *   （CX01[5,6,7]「リムルの効果でカウント増→ドロー→破棄」は requireTriggerSelf 自己ソース帰属
 *   + self_state.in_advent_source 継続ゲートで着地・2026-06-22）
 *   （CX01[2,3,4]「召喚以外で系統暴嵐をカウント+1」は excludeTriggerSelf 自己除外で着地・2026-06-15）
 *   （X02[3]《召喚条件：魂状態を含む…》は declarative summonCondition で着地・2026-06-13）
 *   （X01[3,4] DynamicCount 動的*上限*レンジは既存 primitive で着地・2026-06-14）
 *   - field→set_aside 移動（M01「手元に置く」）/ field_card coreshoot 源（M03[3,4]）
 *   - pay-to-act gating（M03[6,7]）/ 条件付き無償使用（R03）
 *   - 自身バースト発揮（X03[6,7]）
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
  SummonAction,
} from "../src";
import {
  createEmptyGameState,
  createCardInstance,
  initializeGame,
} from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { placeCardFromZoneToField } from "../src/effect/structured-effect-interpreter";
import { executeSummonOther } from "../src/effect/structured-summon";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import {
  generateFieldCardEffectRegistrations,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import {
  canSummonUltimate,
  canUseEffectByUsageLimit,
  getStableEffectLabel,
  isCardUseRestricted,
  recordEffectUsage,
  recomputeContinuousEffects,
} from "../src/legal/legal-actions-shared";
import { matchesCardFilter } from "../src/card/card-filter";
import { evaluateCondition } from "../src";
import { collectAndQueueTriggerReactions, flushPendingLeaves } from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";

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
const fieldEffectLookup = (cardNo: string) => {
  const def = cardNoMap.get(cardNo);
  return def ? generateFieldCardEffectRegistrations(def) : [];
};

const ALICE = "player-1";
const BOB = "player-2";

// BSTS01-C01[6,7,8] のトラッシュ→フィールド配置テスト用の純青ネクサス（星霊界）。
const BLUE_NEXUS_NO = "BSFT01-C03";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  let s = executeEffect({
    chainId: "test:bsts01-cards:98",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
  while (s.pendingStepOptionalChoice !== null) {
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
  }
  return s;
}

/** A burst self-summon must waive card cost but still place its Lv1 core. */
function resolveFreeBurstSelfSummon(
  definition: CardDefinition,
  burst: NonNullable<CardDefinition["effects"]>[number],
  summonStepIndex: number,
  instanceId: string
): GameState {
  const source = createCardInstance(definition, {
    instanceId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "burst",
  });
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [source],
    // All three cards cost more than one. One core can therefore pay only
    // the separate Lv1 placement, never a normal summon cost.
    playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
  });
  return executeEffectWithChosenMinimumCores({
    chainId: `test:bsts01-cards:free-burst-summon:${instanceId}`,
    state,
    effect: { ...burst, steps: [burst.steps[summonStepIndex]!] },
    sourceInstanceId: instanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;
const bob = (s: GameState) => s.players.find((p) => p.id === BOB)!;
const treatAsBlue = {
  kind: "treat_as",
  appliesToCard: true,
  aspects: ["symbol", "reduction_symbol"],
  asColor: "blue",
} as const;

// ════════════════════════════════════════════════════════════════
// C01 リムル=テンペスト(C) — 煌臨宣言 stub(P3-89) / 5枚破棄 needs-dsl / OC トラッシュ配置は配線
// ════════════════════════════════════════════════════════════════

describe("BSTS01-C01 ［受け継いだ想い］リムル=テンペスト", () => {
  const c = card("BSTS01-C01");

  it("契約煌臨 adventData が配線されている（own_turn / contract / soulCoreDest=trash）", () => {
    expect(c.adventData).toBeDefined();
    const ad = c.adventData!;
    expect(ad.adventVariant).toBe("contract");
    expect(ad.adventTiming).toBe("own_turn");
    expect(ad.soulCoreDest).toBe("trash");
    expect(ad.adventCondition.targetCategory).toEqual(["spirit"]);
  });

  it("[3,4]召喚/煌臨時 2ドロー→手札5枚以下に破棄 / [6,7,8]OC トラッシュ青ネクサスをフィールド配置", () => {
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({
      kind: "card_event",
      event: ["summon", "advent"],
    });
    expect(summon.executionMode).toBe("optional");
    expect(summon.steps[0]!.action).toEqual({ kind: "draw", count: 2 });
    expect(summon.steps[0]!.executionMode).toBeUndefined();
    expect(summon.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: -1,
      targetHandSize: 5,
    });
    const place = c.effects![1]!;
    expect(place.timing).toEqual({ kind: "activated", mode: "main" });
    expect(place.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 4,
    });
    expect(place.steps[0]!.action).toEqual({
      kind: "search_zone",
      zone: "trash",
      filter: { category: ["nexus"], colors: ["blue"] },
      count: 1,
      mandatory: true,
      destination: "field",
    });
  });

  it("[board] 召喚/煌臨時: 2ドロー後、手札5枚以下に破棄（maxCount=2 の選択待ちが立つ）", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru-c01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // デッキ上に2枚（ドロー用）。手札は既に5枚 → 2ドローで7枚 → targetHandSize:5 で2枚破棄。
    const deck = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(card("BSTS01-C02"), {
        instanceId: `deck-c01-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const hand = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C02"), {
        instanceId: `hand-c01-${i}`,
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck, ...hand],
      playerOverrides: [{ deckCount: 2, handCount: 5 }, {}],
    });
    const after = runEffect(before, c.effects![0]!, "rimuru-c01");
    // デッキは2枚ドローで0枚に。
    const deckLeft = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "deck"
    );
    expect(deckLeft).toHaveLength(0);
    // 7枚から5枚へ = 2枚破棄の選択待ち（どの2枚を捨てるかはプレイヤー選択）。
    expect(after.pendingZoneSelection).toBeDefined();
    expect(after.pendingZoneSelection!.actionKind).toBe("discard_hand");
    expect(after.pendingZoneSelection!.maxCount).toBe(2);
  });

  it("[board] OC効果: トラッシュの青ネクサスがフィールドへ配置される（手札に戻らない）", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru-c01b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // トラッシュに純青ネクサス（星霊界）。
    const nexus = createCardInstance(card(BLUE_NEXUS_NO), {
      instanceId: "trash-nexus-c01",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const handBefore = alice(
      createEmptyGameState({ cardInstances: [src, nexus] })
    ).handCount;
    const before = createEmptyGameState({
      cardInstances: [src, nexus],
      playerOverrides: [{ countValue: 4 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "rimuru-c01b");
    const placed = after.cardInstances.find(
      (x) => x.instanceId === "trash-nexus-c01"
    )!;
    // フィールドへ配置（手札に戻っていない＝handCount 不変）。
    expect(placed.zone).toBe("field");
    expect(alice(after).handCount).toBe(handBefore);
  });
});

// ════════════════════════════════════════════════════════════════
// C02 リグル — treat_as / 召喚時コア配置 / 相手起因離脱時 trash→reserve
// ════════════════════════════════════════════════════════════════

describe("BSTS01-C02 ［警備隊隊長］リグル", () => {
  const c = card("BSTS01-C02");

  it("treat_as青 / 召喚時 void→this+void→trash / leave_field(opponent) trash→reserve3", () => {
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);
    const summon = c.effects![1]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "this_card" },
      amount: 1,
    });
    expect(summon.steps[1]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "trash", player: "self" },
      amount: 1,
    });
    const leave = c.effects![2]!;
    expect(leave.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leave.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
  });

  it("[board] 召喚時: ボイドからコア1個がこのスピリットへ、1個がトラッシュへ移る", () => {
    const src = createCardInstance(c, {
      instanceId: "rigur-c02",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [
        { voidNormalCoreCount: 5, trashNormalCoreCount: 0 },
        {},
      ],
    });
    const after = runEffect(before, c.effects![1]!, "rigur-c02");
    // ボイドから2個離れた（this_card へ1 + trash へ1）。
    expect(alice(after).voidNormalCoreCount).toBe(3);
    expect(alice(after).trashNormalCoreCount).toBe(1);
    const onCard = after.cardInstances.find(
      (x) => x.instanceId === "rigur-c02"
    )!;
    expect(onCard.normalCoreCount).toBe(2); // 1 + void から1
  });

  it("[board] 相手起因離脱時: トラッシュの非ソウルコア3個がリザーブへ移り、ソウルコアはトラッシュに残る", () => {
    const src = createCardInstance(c, {
      instanceId: "rigur-c02b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [
        {
          trashNormalCoreCount: 4,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "trash" },
        },
        {},
      ],
    });
    const after = runEffect(before, c.effects![2]!, "rigur-c02b");
    expect(alice(after).trashNormalCoreCount).toBe(1); // 4 - 3
    expect(alice(after).reserveNormalCoreCount).toBe(3);
    // 《ソウルコア》以外: ソウルコアは選択候補に入らずトラッシュに残る。
    expect(alice(after).soulCoreLocation).toEqual({ kind: "trash" });
  });
});

describe("BSTS01-C04 ゴブタ", () => {
  const c = card("BSTS01-C04");
  it("treat_as青 / 召喚時2ドロー後2破棄 / Lv2アタック・ブロック時に剣獣を軽減全充足召喚", () => {
    expect(c.effects).toHaveLength(3);
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);

    const summon = c.effects![1]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.executionMode).toBe("optional");
    expect(summon.steps[0]!.action).toEqual({ kind: "draw", count: 2 });
    expect(summon.steps[0]!.executionMode).toBeUndefined();
    expect(summon.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: 2,
    });
    expect(summon.steps[1]!.connector).toBe("conditional_result");

    const callBeast = c.effects![2]!;
    expect(callBeast.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(callBeast.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const action = callBeast.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon" && action.target.kind === "from_zone") {
      expect(action.target.zone).toBe("hand");
      expect(action.target.filter).toEqual({
        category: ["spirit"],
        tribes: ["剣獣"],
      });
      expect(action.costModifier).toBe("full_reduction");
    }
  });
});

describe("BSTS01-C05 ジュラ・テンペスト連邦国", () => {
  const c = card("BSTS01-C05");
  it("相手トラッシュ制限 / 手札耐性(zone免疫) / 配置時に契約リムルをコストなし召喚", () => {
    expect(c.effects).toHaveLength(3);
    const trashLock = c.effects![0]!;
    expect(trashLock.stub).toBeUndefined();
    const trashImmunity = trashLock.steps[0]!.action;
    expect(trashImmunity).toEqual({
      kind: "effect_immunity",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {},
        count: "all",
        zone: ["trash"],
      },
      sourcePlayerScope: "self",
      duration: { scope: "while_on_field" },
    });
    const trashRestrict = trashLock.steps[1]!.action;
    expect(trashRestrict).toEqual({
      kind: "restrict_use",
      player: "opponent",
      filter: { zone: ["trash"] },
      duration: { scope: "while_on_field" },
    });

    const place = c.effects![1]!;
    expect(place.stub).toBeUndefined();
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    const trashStep = place.steps[0]!;
    const action = trashStep.action;
    if (action.kind === "summon" && action.target.kind === "from_zone") {
      expect(action.target.zone).toBe("trash");
      expect(action.target.includeSoulState).toBe(true);
      expect(action.target.filter).toMatchObject({
        cardName: { contains: "リムル=テンペスト" },
        isContract: true,
      });
      expect(action.target.filter?.soulState).toBeUndefined();
      expect(action.costModifier).toBe("free");
    } else {
      throw new Error("BSTS01-C05 effects[1] step0 must summon from trash");
    }

    expect(trashStep.choice).toBeUndefined();

    const lv2 = c.effects![2]!;
    expect(lv2.stub).toBeUndefined();
    expect(lv2.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "hand_count", player: "self", max: 5 },
    ]);
    const immunityAction = lv2.steps[0]!.action;
    expect(immunityAction.kind).toBe("effect_immunity");
    if (immunityAction.kind === "effect_immunity") {
      expect(immunityAction.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand"],
      });
      expect(immunityAction.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("Lv2 + 手札5枚以下: 自分の手札は相手起因効果に免疫成立", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 5 }, {}],
    });
    const self = createCardInstance(c, {
      instanceId: "jura-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2 (requiredCores:1)
    });
    const handCard = createCardInstance(c, {
      instanceId: "alice-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      cardInstances: [self, handCard],
    };
    const lv2 = c.effects![2]!;
    const next = executeEffect({
      chainId: "test:bsts01-cards:465",
      state,
      effect: lv2,
      sourceInstanceId: "jura-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const hand = next.cardInstances.find(
      (ci) => ci.instanceId === "alice-hand-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(next, hand, "bob", "none", undefined, getDef)
    ).toBe(true);
  });

  it("BSTS01-C05 Lv1-Lv2: 相手トラッシュのカードは相手自身の効果を受けず、その効果を使えない", () => {
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
    });
    const source = createCardInstance(c, {
      instanceId: "jura-trash-lock",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const bobTrash = createCardInstance(card("BSTS01-C06"), {
      instanceId: "bob-trash-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const bobHand = createCardInstance(card("BSTS01-C06"), {
      instanceId: "bob-hand-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      cardInstances: [source, bobTrash, bobHand],
    };

    const next = executeEffect({
      chainId: "test:bsts01-cards:508",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "jura-trash-lock",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const trashCard = next.cardInstances.find(
      (ci) => ci.instanceId === "bob-trash-magic"
    )!;
    const handCard = next.cardInstances.find(
      (ci) => ci.instanceId === "bob-hand-magic"
    )!;
    const restrictCe = next.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe?.metadata?.filter).toEqual({ zone: ["trash"] });
    expect(
      matchesCardFilter(
        handCard,
        card("BSTS01-C06"),
        { zone: ["trash"] },
        {
          cardZone: handCard.zone,
        }
      )
    ).toBe(false);

    expect(
      isCardImmuneToOpponentEffect(
        next,
        trashCard,
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardUseRestricted(next, BOB, trashCard, card("BSTS01-C06"), getDef)
    ).toBe(true);
    expect(
      isCardUseRestricted(next, BOB, handCard, card("BSTS01-C06"), getDef)
    ).toBe(false);
  });

  it("配置時 choiceIndex 0: トラッシュの契約リムルをコストなし召喚する", () => {
    const source = createCardInstance(c, {
      instanceId: "jura-place-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const rimuruTrash = createCardInstance(card("BSTS01-CX01"), {
      instanceId: "rimuru-trash-c05",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
    });
    const decoyTrash = createCardInstance(card("BSTS01-C04"), {
      instanceId: "gobuta-trash-c05",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [source, decoyTrash, rimuruTrash],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });

    const after = executeEffect({
      chainId: "test:bsts01-cards:581",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "jura-place-trash",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      choiceIndex: 0,
    });

    const summoned = after.cardInstances.find(
      (x) => x.instanceId === "rimuru-trash-c05"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");
    expect(summoned.normalCoreCount).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(4);
    expect(alice(after).soulStateInstanceIds).not.toContain("rimuru-trash-c05");
    const decoy = after.cardInstances.find(
      (x) => x.instanceId === "gobuta-trash-c05"
    )!;
    expect(decoy.zone).toBe("trash");
  });

  it("配置時 choiceIndex 1: 魂状態の契約リムルだけを通常スピリットへ昇格する", () => {
    const source = createCardInstance(c, {
      instanceId: "jura-place-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const rimuruSoul = createCardInstance(card("BSTS01-CX01"), {
      instanceId: "rimuru-soul-c05",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const rimuruNormal = createCardInstance(card("BSTS01-CX01"), {
      instanceId: "rimuru-normal-c05",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [source, rimuruSoul, rimuruNormal],
      playerOverrides: [
        {
          reserveNormalCoreCount: 5,
          soulStateInstanceIds: ["rimuru-soul-c05"],
        },
        {},
      ],
    });

    const after = executeEffect({
      chainId: "test:bsts01-cards:639",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "jura-place-soul",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      choiceIndex: 1,
    });

    expect(alice(after).soulStateInstanceIds).not.toContain("rimuru-soul-c05");
    const summoned = after.cardInstances.find(
      (x) => x.instanceId === "rimuru-soul-c05"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");
    expect(summoned.normalCoreCount).toBe(1);
    const normal = after.cardInstances.find(
      (x) => x.instanceId === "rimuru-normal-c05"
    )!;
    expect(normal.normalCoreCount).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(4);
    expect(after.log).toContain(
      "effect:summon:rimuru-soul-c05:self:soul_state:cost=0:cores=1"
    );
  });
});

describe("BSTS01-R01 ［姫巫女］シュナ", () => {
  const c = card("BSTS01-R01");
  it("treat_as青 / 呪鬼・暴嵐への相手効果 core_below_min/bounce/send_to_deck/destroy 耐性", () => {
    expect(c.effects).toHaveLength(4);
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);

    const core = c.effects![1]!.steps[0]!.action;
    expect(core.kind).toBe("effect_resistance");
    if (core.kind === "effect_resistance") {
      expect(core.resistsOutcome).toBe("core_below_min");
      expect(core.coreMinimum).toBe(1);
      if ("filter" in core.target) {
        // category は filterOr の各枝内へ複製する。matchesCardFilter の filterOr 分岐は
        // outer sibling の category を読まないため、枝ごとに複製しないと呪鬼/暴嵐の
        // 非spirit/ultimateカードまで対象化してしまう (BSTH004-X03 で発見した同型バグ)。
        expect(core.target.filter.filterOr).toEqual([
          { category: ["spirit", "ultimate"], tribes: ["呪鬼"] },
          { category: ["spirit", "ultimate"], tribes: ["暴嵐"] },
        ]);
        expect(core.target.filter.category).toBeUndefined();
      }
    }

    const bounce = c.effects![2]!;
    expect(bounce.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(bounce.steps[0]!.action).toMatchObject({
      kind: "effect_resistance",
      resistsOutcome: ["bounce", "send_to_deck"],
      source: "opponent_effect",
    });

    const destroy = c.effects![3]!;
    expect(destroy.condition).toEqual([{ kind: "min_level", value: 3 }]);
    expect(destroy.steps[0]!.action).toMatchObject({
      kind: "effect_resistance",
      resistsOutcome: "destroy",
      source: "opponent_effect",
    });
  });

  it("[実挙動] 呪鬼/暴嵐でも非spirit/ultimate(ネクサス)は耐性filterの対象外", () => {
    const core = c.effects![1]!.steps[0]!.action;
    if (core.kind !== "effect_resistance" || !("filter" in core.target)) {
      throw new Error("effect_resistance target が filter 形式ではない");
    }
    const filter = core.target.filter;

    const kuchikiSpiritDef: CardDefinition = {
      cardNo: "TEST-KUCHIKI-SPIRIT",
      name: "テスト呪鬼スピリット",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "呪鬼",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const kuchikiNexusDef: CardDefinition = {
      cardNo: "TEST-KUCHIKI-NEXUS",
      name: "テスト呪鬼ネクサス",
      printedCategory: "nexus",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "呪鬼",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const makeInstance = (def: CardDefinition, instanceId: string) =>
      createCardInstance(def, {
        instanceId,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });

    expect(
      matchesCardFilter(
        makeInstance(kuchikiSpiritDef, "ks-1"),
        kuchikiSpiritDef,
        filter
      )
    ).toBe(true);
    expect(
      matchesCardFilter(
        makeInstance(kuchikiNexusDef, "kn-1"),
        kuchikiNexusDef,
        filter
      )
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// C03 リグルド — treat_as / 召喚時デッキ3枚並べ替え / カウント増加量メタ修飾 needs-dsl
// ════════════════════════════════════════════════════════════════

describe("BSTS01-C03 ［行政担当］リグルド", () => {
  const c = card("BSTS01-C03");

  it("treat_as青 / 召喚時 deck_reveal(3, picks:[], player_choice) / メタ修飾[5,6]は count_gain_modifier 継続効果", () => {
    expect(c.effects).toHaveLength(3);
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);
    const summon = c.effects![1]!;
    const action = summon.steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind === "deck_reveal") {
      expect(action.revealCount).toBe(3);
      expect(action.picks).toEqual([]);
      expect(action.remainder).toBe("top_bottom_split");
    }
    // [5,6]〔ターンに1回:同名〕カウント増加量メタ修飾 = count_gain_modifier 継続効果。
    // executeCountIncrease がそのターン最初の自分の count+ 1件へ +1（10_rules/08a §カウント＋ メタ修飾）。
    const meta = c.effects![2]!;
    expect(meta.timing.kind).toBe("continuous");
    expect(meta.textRef).toEqual([5, 6]);
    expect(meta.stub).toBeUndefined();
    const metaAction = meta.steps[0]!.action;
    expect(metaAction.kind).toBe("count_gain_modifier");
    if (metaAction.kind === "count_gain_modifier") {
      expect(metaAction.player).toBe("self");
      expect(metaAction.amount).toBe(1);
    }
  });

  it("[board] 召喚時 deck_reveal がデッキ上3枚を閲覧対象に取り pending を生成する", () => {
    const src = createCardInstance(c, {
      instanceId: "rigurd-c03",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C02"), {
        instanceId: `deck-c03-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck],
      playerOverrides: [{ deckCount: 5 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "rigurd-c03");
    // deck_reveal は閲覧/並べ替えの pending を生成する（盤面ログに痕跡）。
    const revealedLog = after.log.some((l) => l.includes("deck_reveal"));
    expect(revealedLog).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// C06 大賢者 — ミラージュ + セット中手札確認 + 5枚破棄
// ════════════════════════════════════════════════════════════════

describe("BSTS01-C06 ユニークスキル『大賢者』", () => {
  const c = card("BSTS01-C06");

  it("BSTS01-C06 は mirageData とセット中メイン / 通常メインを分けて表現する", () => {
    expect(c.mirageData).toEqual({ cost: 2, reduction: [] });
    const setMain = c.effects![0]!;
    expect(setMain.timing).toEqual({ kind: "activated", mode: "main" });
    expect(setMain.applicability).toEqual({ zone: "mirage_set" });
    expect(setMain.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(setMain.executionMode).toBe("optional");
    expect(setMain.steps[0]!.action).toEqual({
      kind: "reveal_hand",
      player: "opponent",
      revealTo: "self",
      count: 2,
    });

    const main = c.effects![1]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    expect(main.steps[0]!.action).toEqual({ kind: "draw", count: 3 });
    expect(main.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: -1,
      targetHandSize: 5,
    });
  });

  it("BSTS01-C06 [board] セット中メインはミラージュゾーンから legal action になり、手札では出ない", () => {
    const mirage = createCardInstance(c, {
      instanceId: "daikenja-mirage",
      ownerPlayerId: ALICE,
      zone: "mirage",
    });
    const inHand = createCardInstance(c, {
      instanceId: "daikenja-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({
        cardInstances: [mirage, inHand],
        mirageSetStates: [
          { playerId: ALICE, cardInstanceId: "daikenja-mirage" },
        ],
      }),
      step: "main" as const,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: noTriggerLookup,
    });

    const c06Actions = actions.filter(
      (a) =>
        a.kind === "use_field_card_effect" && a.sourceCardNo === "BSTS01-C06"
    );
    expect(c06Actions).toHaveLength(1);
    expect(c06Actions[0]!.sourceInstanceId).toBe("daikenja-mirage");
    expect(c06Actions[0]!.registrationIndex).toBe(0);

    const declared = applyLegalAction({
      state,
      action: c06Actions[0]!,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: noTriggerLookup,
    });
    expect(declared.state.stackWindow?.pendingStackAction).toMatchObject({
      cardInstanceId: "daikenja-mirage",
      fieldEffectSourceKind: "magic",
      fieldEffectRegistrationIndex: 0,
    });
    expect(declared.state.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: "daikenja-mirage",
        sourceDefinitionId: "BSTS01-C06",
        effectLabel: "magic:0",
        duration: "turn",
      })
    );
  });

  it("BSTS01-C06 [board] セット中メインは相手手札を2枚だけ見る", () => {
    const magic = createCardInstance(c, {
      instanceId: "daikenja-c06-set",
      ownerPlayerId: ALICE,
      zone: "mirage",
    });
    const opponentHand = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(card("BSTS01-C02"), {
        instanceId: `bob-hand-c06-${i}`,
        ownerPlayerId: BOB,
        zone: "hand",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [magic, ...opponentHand],
      playerOverrides: [{}, { handCount: 3 }],
    });
    const after = runEffect(before, c.effects![0]!, "daikenja-c06-set");
    const revealLog = after.log.find((l) =>
      l.includes("effect:reveal_hand:player-2")
    );
    expect(revealLog).toBe(
      "effect:reveal_hand:player-2:revealTo=self:count=2:ids=bob-hand-c06-0,bob-hand-c06-1"
    );
  });

  it("[board] メイン: 3ドロー後、手札5枚以下に破棄（4枚→3ドローで7枚→maxCount=2 の選択待ち）", () => {
    // マジック本体は使用解決中（手札にはない）。pending の sourceDefinitionId 解決用に存在のみ。
    const magic = createCardInstance(c, {
      instanceId: "daikenja-c06",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const deck = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(card("BSTS01-C02"), {
        instanceId: `deck-c06-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const hand = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSTS01-C02"), {
        instanceId: `hand-c06-${i}`,
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [magic, ...deck, ...hand],
      playerOverrides: [{ deckCount: 3, handCount: 4 }, {}],
    });
    const after = runEffect(before, c.effects![1]!, "daikenja-c06");
    // デッキ3枚ドロー → 0枚に。
    const deckLeft = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "deck"
    );
    expect(deckLeft).toHaveLength(0);
    // 4 + 3 = 7 → down-to-5 = 2枚破棄の選択待ち。
    expect(after.pendingZoneSelection).toBeDefined();
    expect(after.pendingZoneSelection!.actionKind).toBe("discard_hand");
    expect(after.pendingZoneSelection!.maxCount).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// CX01 リムル=テンペスト(CX) — 契約カード。煌臨元ゲート + 自効果トリガー needs-dsl で empty
// ════════════════════════════════════════════════════════════════

describe("BSTS01-CX01 リムル=テンペスト", () => {
  const c = card("BSTS01-CX01");

  function buildRimuruContractState(): GameState {
    return initializeGame({
      playerIds: [ALICE, BOB],
      decks: [
        [c, ...Array(39).fill(card("BSTS01-M01"))],
        Array(40).fill(card("BSTH08-X02")),
      ],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });
  }

  function asMainWithCards(
    state: GameState,
    cards: GameState["cardInstances"]
  ): GameState {
    return {
      ...state,
      step: "main",
      window: "main_step",
      activePlayerId: ALICE,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, reserveNormalCoreCount: 20 } : p
      ),
      cardInstances: [...state.cardInstances, ...cards],
    };
  }

  it("adventData なし（契約・魂状態タグは保持）。[0] 被煌臨任意コア配置=engine 解消 / [2] errata / [4,5,6] 着地 / [7,8] 着地（requireTriggerSelf + in_advent_source）", () => {
    expect(c.adventData).toBeUndefined();
    expect(c.keywordTags).toContain("contract");
    expect(c.keywordTags).toContain("soul_state");
    expect(c.effects).toHaveLength(5);
    // [0] 被煌臨任意コア配置は engine 側 (契約煌臨 魂状態 charge) で解消 → stub 削除。
    expect(c.effects![0]!.steps).toEqual([]);
    expect(c.effects![0]!.stub).toBeUndefined();
    // [2] errata: game_start で非暴嵐の召喚/配置/煌臨を permanent に制限。
    expect(c.effects![1]!.stub).toBeUndefined();
    expect(c.effects![1]!.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "game_start",
    });
    expect(c.effects![1]!.condition).toEqual([
      { kind: "owns_contract_card", player: "self" },
    ]);
    expect(c.effects![1]!.steps).toEqual([
      {
        action: {
          kind: "restrict_use",
          player: "self",
          filter: { exclude: { tribes: ["暴嵐"] } },
          restrictedKinds: ["summon", "place_nexus", "advent", "put_on_field"],
          duration: { scope: "permanent" },
        },
      },
    ]);
    // [7,8] 着地: requireTriggerSelf + 状態別条件 + draw/discard targetHandSize:5。
    expect(c.effects![3]!.stub).toBeUndefined();
    expect(c.effects![4]!.stub).toBeUndefined();
    // [0] 被煌臨マーカー (textRef 帰属のみ) は continuous。
    expect(c.effects![0]!.timing).toEqual({ kind: "continuous" });
    // [4,5,6] 着地: excludeTriggerSelf 自己除外で「このスピリットの召喚以外で」を表現。
    expect(c.effects![2]!.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: ["summon", "advent", "place"],
      triggerFilter: { tribes: ["暴嵐"] },
      excludeTriggerSelf: true,
    });
    expect(c.effects![2]!.stub).toBeUndefined();
    expect(c.effects![2]!.steps).toEqual([
      { action: { kind: "count_increase", player: "self", amount: 1 } },
    ]);
    expect(c.effects![2]!.usageLimit).toEqual({ kind: "no_duplicate" });
    // [7,8] 着地: requireTriggerSelf:true で count_increase の発生源が自カード自身のときだけ反応。
    expect(c.effects![3]!.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "count_increase",
      requireTriggerSelf: true,
    });
    expect(c.effects![3]!.timingScope).toEqual({
      player: "self",
      period: "turn",
    });
    expect(c.effects![3]!.applicability?.zone).toBe("advent_source");
    expect(c.effects![3]!.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(c.effects![3]!.executionMode).toBe("optional");
    expect(c.effects![3]!.steps).toEqual([
      { action: { kind: "draw", player: "self", count: 1 } },
      {
        action: {
          kind: "discard",
          player: "self",
          count: -1,
          targetHandSize: 5,
        },
      },
    ]);
    // [7,8] 【スピリット】Lv1-Lv2 版も同じ誘発/処理で、on_field + min_level で発揮する。
    expect(c.effects![4]!.timing).toEqual(c.effects![3]!.timing);
    expect(c.effects![4]!.timingScope).toEqual({
      player: "self",
      period: "turn",
    });
    expect(c.effects![4]!.condition).toEqual([
      { kind: "self_state", state: "on_field" },
      { kind: "min_level", value: 1 },
    ]);
    expect(c.effects![4]!.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(c.effects![4]!.executionMode).toBe("optional");
    expect(c.effects![4]!.steps).toEqual(c.effects![3]!.steps);
  });

  it.each([false, true])(
    "煌臨元専用のドロー効果は通常スピリット時に発揮しない（煌臨元=%s）",
    (inSource) => {
      const source = createCardInstance(card("BSTS01-CX01"), {
        instanceId: "rimuru-source",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: inSource ? 0 : 1,
      });
      const host = createCardInstance(card("BSTS01-X01"), {
        instanceId: "rimuru-host",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      if (inSource)
        host.underCards = [
          { cardInstanceId: source.instanceId, role: "advent_source" },
        ];
      const deck = createCardInstance(card("BSTS01-C01"), {
        instanceId: "draw-card",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, host, deck],
      });
      const result = executeEffect({
        chainId: "test:rimuru-source-zone",
        state,
        effect: card("BSTS01-CX01").effects![3]!,
        effectIndex: 3,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });
      expect(
        result.cardInstances.find(
          (instance) => instance.instanceId === deck.instanceId
        )?.zone
      ).toBe(inSource ? "hand" : "deck");
    }
  );

  it("ゲーム開始時: 自分のBSTS01-CX01契約だけが非暴嵐使用制限を登録する", () => {
    const state = buildRimuruContractState();
    const restrictions = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_use"
    );

    expect(restrictions).toHaveLength(1);
    expect(restrictions[0]!.targetInstanceId).toBe(ALICE);
    expect(restrictions[0]!.sourceDefinitionId).toBe("BSTS01-CX01");
    expect(restrictions[0]!.duration).toEqual({ scope: "permanent" });

    const noContractState = initializeGame({
      playerIds: [ALICE, BOB],
      decks: [
        Array(40).fill(card("BSTS01-M01")),
        Array(40).fill(card("BSTH08-X02")),
      ],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });
    expect(
      noContractState.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_use"
      )
    ).toBe(false);
  });

  it("ゲーム開始時: 同一契約カードを複数枚採用しても非暴嵐使用制限は1件だけ登録する", () => {
    const state = initializeGame({
      playerIds: [ALICE, BOB],
      decks: [
        [c, c, c, ...Array(37).fill(card("BSTS01-M01"))],
        Array(40).fill(card("BSTH08-X02")),
      ],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });

    expect(
      state.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "restrict_use" &&
          ce.sourceDefinitionId === "BSTS01-CX01"
      )
    ).toHaveLength(1);
  });

  it("owns_contract_card は提示レベルではなくデッキ採用レベルでこのカードとの契約を判定する", () => {
    const rimuruInDeck = createCardInstance(c, {
      instanceId: "rimuru-in-deck",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [rimuruInDeck],
    });

    expect(
      state.players.find((p) => p.id === ALICE)?.contractCardNo
    ).toBeNull();
    expect(
      evaluateCondition(
        state,
        [{ kind: "owns_contract_card", player: "self" }],
        "rimuru-in-deck",
        ALICE,
        getDef
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        state,
        [{ kind: "owns_contract_card", player: "self" }],
        "rimuru-in-deck",
        BOB,
        getDef
      )
    ).toBe(false);
  });

  it("このゲームの間: リムルがフィールドを離れても非暴嵐制限は残る", () => {
    const state = buildRimuruContractState();
    const sourceId = state.activeContinuousEffects.find(
      (ce) => ce.sourceDefinitionId === "BSTS01-CX01"
    )!.sourceInstanceId;
    const afterSourceLeaves = recomputeContinuousEffects({
      ...state,
      cardInstances: state.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === sourceId
          ? { ...cardInstance, zone: "trash" as const }
          : cardInstance
      ),
    });

    expect(
      afterSourceLeaves.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "restrict_use" &&
          ce.sourceDefinitionId === "BSTS01-CX01"
      )
    ).toBe(true);
  });

  it("非暴嵐の召喚/配置/煌臨をブロックし、暴嵐の召喚/煌臨は許可する", () => {
    const nue = createCardInstance(card("BSTH08-X02"), {
      instanceId: "nue-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const ranga = createCardInstance(card("BSTS01-M01"), {
      instanceId: "ranga-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const kia = createCardInstance(card("BSLH01-X02"), {
      instanceId: "kia-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = asMainWithCards(buildRimuruContractState(), [
      nue,
      ranga,
      kia,
    ]);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredMagicActions: () => undefined,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "summon" && action.sourceInstanceId === "nue-hand"
      )
    ).toBe(false);
    expect(
      actions.some(
        (action) =>
          action.kind === "summon" && action.sourceInstanceId === "ranga-hand"
      )
    ).toBe(true);
    expect(
      actions.some(
        (action) =>
          action.kind === "place_nexus" &&
          action.sourceInstanceId === "kia-hand"
      )
    ).toBe(false);
    expect(
      isCardUseRestricted(
        state,
        ALICE,
        kia,
        card("BSLH01-X02"),
        getDef,
        "place_nexus"
      )
    ).toBe(true);
    expect(
      isCardUseRestricted(
        state,
        ALICE,
        nue,
        card("BSTH08-X02"),
        getDef,
        "advent"
      )
    ).toBe(true);
    expect(
      isCardUseRestricted(
        state,
        ALICE,
        ranga,
        card("BSTS01-M01"),
        getDef,
        "advent"
      )
    ).toBe(false);
  });

  it("非暴嵐制限は効果による召喚/フィールド配置にも適用される", () => {
    const nue = createCardInstance(card("BSTH08-X02"), {
      instanceId: "nue-effect-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const ranga = createCardInstance(card("BSTS01-M01"), {
      instanceId: "ranga-effect-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = asMainWithCards(buildRimuruContractState(), [nue, ranga]);
    const action: SummonAction = {
      kind: "summon",
      target: "other",
      zone: "hand",
      count: 1,
      withoutCost: true,
    };

    const afterNue = executeSummonOther(
      state,
      "test:bsts01-cards.test.ts:summon",
      ALICE,
      action,
      "bsts01-cx01-effect-source",
      getDef,
      undefined,
      [{ kind: "reserve_normal", amount: 1 }],
      ["nue-effect-hand"]
    );
    expect(
      afterNue.cardInstances.find((ci) => ci.instanceId === "nue-effect-hand")
        ?.zone
    ).toBe("hand");
    expect(afterNue.log).toContain("effect:summon:hand:no-targets");

    const afterRanga = executeSummonOther(
      state,
      "test:bsts01-cards.test.ts:summon",
      ALICE,
      action,
      "bsts01-cx01-effect-source",
      getDef,
      undefined,
      [{ kind: "reserve_normal", amount: 1 }],
      ["ranga-effect-hand"]
    );
    expect(
      afterRanga.cardInstances.find(
        (ci) => ci.instanceId === "ranga-effect-hand"
      )?.zone
    ).toBe("field");

    const nonBouranNexus = createCardInstance(card("BSLH01-X02"), {
      instanceId: "kia-effect-place",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const bouranNexus = createCardInstance(card("BSTS01-C05"), {
      instanceId: "jura-effect-place",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const placeState = asMainWithCards(buildRimuruContractState(), [
      nonBouranNexus,
      bouranNexus,
    ]);
    const afterBlockedPlace = placeCardFromZoneToField(
      placeState,
      "kia-effect-place",
      getDef
    );
    expect(
      afterBlockedPlace.cardInstances.find(
        (ci) => ci.instanceId === "kia-effect-place"
      )?.zone
    ).toBe("hand");
    expect(afterBlockedPlace.log).toContain(
      "effect:field_place:kia-effect-place:restricted"
    );

    const afterAllowedPlace = placeCardFromZoneToField(
      placeState,
      "jura-effect-place",
      getDef
    );
    expect(
      afterAllowedPlace.cardInstances.find(
        (ci) => ci.instanceId === "jura-effect-place"
      )?.zone
    ).toBe("field");
  });
});

// ════════════════════════════════════════════════════════════════
// M01 ランガ — treat_as / バースト attack_after 召喚 / 召喚時除外+条件付きコア
// ════════════════════════════════════════════════════════════════

describe("BSTS01-M01 ［黒風星狼］ランガ", () => {
  const c = card("BSTS01-M01");

  it("treat_as青 / attack_after バースト(手元送り bounce + 召喚) / 召喚アタック時 除外+条件付きコア", () => {
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);

    // 通常バースト [4,5]（handSource なし）。
    const burst = c.effects!.find(
      (e) =>
        e.timing.kind === "burst" &&
        (e.timing as { handSource?: boolean }).handSource !== true
    )!;
    expect((burst.timing as { trigger?: unknown }).trigger).toContain(
      "アタック後"
    );
    // [0] 相手スピリット/アルティメット2体を手元(set_aside)へ bounce
    expect(burst.steps[0]!.action).toEqual({
      kind: "bounce",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 2,
      },
      destination: "set_aside",
    });
    // [1] この効果発揮後、このカードをコストなし召喚
    expect(burst.steps[1]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
    expect(burst.stub).toBeUndefined();

    // [2] 手札からの直接バースト発動（裁定 2026-06-16, 10_rules/04b）。
    //   handSource:true + handSourceCondition(カウント5以上) + 〔ゲームに1回:同名〕。
    const handBurst = c.effects!.find(
      (e) =>
        e.timing.kind === "burst" &&
        (e.timing as { handSource?: boolean }).handSource === true
    )!;
    expect(handBurst).toBeDefined();
    expect(
      (handBurst.timing as { handSourceCondition?: unknown })
        .handSourceCondition
    ).toEqual([{ kind: "count_value", player: "self", min: 5 }]);
    expect(handBurst.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 1,
    });
    expect(handBurst.textRef).toEqual([2]);

    const onAtk = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        Array.isArray((e.timing as { event: unknown }).event)
    )!;
    expect(onAtk.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    const remove = onAtk.steps[0]!.action;
    expect(remove.kind).toBe("remove_from_game");
    if (remove.kind === "remove_from_game" && "zone" in remove.target) {
      expect(remove.target.zone).toBe("set_aside");
    }
    // 条件付き void→this 2 は field_has(リムル/ゴブタ) でゲート。
    expect(onAtk.steps[1]!.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "リムル" }, { contains: "ゴブタ" }],
      includeSoulState: true,
    });
  });

  it("[board] 召喚/アタック時: 相手の手元カード1枚が除外される", () => {
    const src = createCardInstance(c, {
      instanceId: "ranga-m01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyHeld = createCardInstance(card("BSTS01-C02"), {
      instanceId: "held-m01",
      ownerPlayerId: BOB,
      zone: "set_aside",
    });
    const onAtk = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        Array.isArray((e.timing as { event: unknown }).event)
    )!;
    const before = createEmptyGameState({ cardInstances: [src, enemyHeld] });
    const after = runEffect(before, onAtk, "ranga-m01");
    const held = after.cardInstances.find((x) => x.instanceId === "held-m01")!;
    expect(held.zone).toBe("removed_from_game");
  });

  it("[board] バースト[4,5]: 相手スピリット/アルティメット2体を手元(set_aside)へ送る", () => {
    const src = createCardInstance(c, {
      instanceId: "ranga-burst",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy1 = createCardInstance(card("BSTS01-C02"), {
      instanceId: "enemy1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy2 = createCardInstance(card("BSTS01-C02"), {
      instanceId: "enemy2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const burst = c.effects!.find((e) => e.timing.kind === "burst")!;
    // bounce ステップだけを実行（後続の自カード召喚は別経路）。
    const before = createEmptyGameState({
      cardInstances: [src, enemy1, enemy2],
    });
    const after = flushPendingLeaves(
      runEffect(before, { ...burst, steps: [burst.steps[0]!] }, "ranga-burst"),
      getDef
    );
    const e1 = after.cardInstances.find((x) => x.instanceId === "enemy1")!;
    const e2 = after.cardInstances.find((x) => x.instanceId === "enemy2")!;
    expect(e1.zone).toBe("set_aside");
    expect(e2.zone).toBe("set_aside");
    // 手元はオープンゾーン: 手札枚数には加算されない。
    expect(bob(after).handCount).toBe(bob(before).handCount);
  });

  it("[board] バースト後の自己召喚はカードコストを払わず、Lv1維持コアだけを置く", () => {
    const burst = c.effects!.find((e) => e.timing.kind === "burst")!;
    const after = resolveFreeBurstSelfSummon(c, burst, 1, "ranga-free-burst");
    expect(
      after.cardInstances.find(
        (candidate) => candidate.instanceId === "ranga-free-burst"
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(alice(after).reserveNormalCoreCount).toBe(0);
  });

  it("[board] 条件付きコア: リムル/ゴブタ不在ならコアは動かない", () => {
    const src = createCardInstance(c, {
      instanceId: "ranga-m01b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手の手元カードなし → step1 は no-op、step2 は field_has 不成立でコア据え置き。
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ voidNormalCoreCount: 5 }, {}],
    });
    const onAtk = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        Array.isArray((e.timing as { event: unknown }).event)
    )!;
    const after = runEffect(before, onAtk, "ranga-m01b");
    expect(alice(after).voidNormalCoreCount).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════
// M02 ベニマル — treat_as / spirit+ult+nexus 破壊(発揮させない) / 自効果離脱時ライフ除去
// ════════════════════════════════════════════════════════════════

describe("BSTS01-M02 ［侍大将］ベニマル", () => {
  const c = card("BSTS01-M02");

  it("treat_as青 / 召喚アタック時 BP20000以下破壊+ネクサス破壊(発揮させない) / 離脱時ライフ除去", () => {
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);

    const destroy = c.effects![1]!;
    expect(destroy.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    const d0 = destroy.steps[0]!.action;
    expect(d0.kind).toBe("destroy");
    if (d0.kind === "destroy" && "filter" in d0.target) {
      expect(d0.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(d0.target.filter.maxBp).toBe(20000);
      expect(d0.suppressDestroyedEffects).toBe("destroyed_only");
    }
    const d1 = destroy.steps[1]!.action;
    expect(d1.kind).toBe("destroy");
    if (d1.kind === "destroy" && "filter" in d1.target) {
      expect(d1.target.filter.category).toEqual(["nexus"]);
      expect(d1.suppressDestroyedEffects).toBe("destroyed_only");
    }

    const leave = c.effects![2]!;
    expect(leave.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "leave_field",
      cause: "opponent_effect",
      triggerFilter: { category: ["spirit", "ultimate", "nexus"] },
      sourceWhose: "either",
    });
    expect(leave.timingScope).toEqual({ player: "self", period: "attack" });
    expect(leave.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "life", player: "opponent" },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    });
  });

  it("[board] BP20000以下の相手スピリットが破壊予約される (fixed count=1 変種)", () => {
    const src = createCardInstance(c, {
      instanceId: "benimaru-m02",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // C02 リグル: BP3000/4000 ≤ 20000。
    const enemy = createCardInstance(card("BSTS01-C02"), {
      instanceId: "enemy-m02",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const d0 = c.effects![1]!.steps[0]!.action;
    if (d0.kind !== "destroy" || !("filter" in d0.target))
      throw new Error("expected destroy filter");
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: { ...d0.target, count: 1 },
            suppressDestroyedEffects: "destroyed_only",
          },
        },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemy] }),
      fixed,
      "benimaru-m02"
    );
    const enemyAfter = after.cardInstances.find(
      (x) => x.instanceId === "enemy-m02"
    )!;
    expect(enemyAfter.pendingLeaveKind).toBe("destroy");
  });

  it("[board] 自効果離脱トリガーで相手ライフのコア1個がリザーブへ移る", () => {
    const src = createCardInstance(c, {
      instanceId: "benimaru-m02b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [
        {},
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    const after = runEffect(before, c.effects![2]!, "benimaru-m02b");
    expect(bob(after).lifeNormalCoreCount).toBe(4);
    expect(bob(after).reserveNormalCoreCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// M03 シオン — treat_as / [3,4] spirit/ult 限定コアシュート(engine batch2-5) / pay-to-act stub
// ════════════════════════════════════════════════════════════════

describe("BSTS01-M03 ［鬼神］シオン", () => {
  const c = card("BSTS01-M03");

  it("treat_as青 / [3,4] spirit/ult 限定コアシュート3個 (engine batch2-5) / 条件 field_has(ultimate リムル)", () => {
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);
    const gated = c.effects![1]!;
    expect(gated.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      category: ["ultimate"],
      cardNames: [{ contains: "リムル" }],
    });
    // コア除去本体は filter 付き field 源 core_move（stub なし）。
    expect(gated.stub).toBeUndefined();
    const action = gated.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.from.kind).toBe("field");
      if (action.from.kind === "field") {
        expect(action.from.filter?.category).toEqual(["spirit", "ultimate"]);
      }
      expect(action.amount).toBe(3);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// R01 シュナ — 既に done（todo 対象外）だが回帰確認として stub 構造を軽く確認
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// R02 ソウエイ — hand_increase バースト / 召喚時 2ドロー→1破棄(固定) / フラッシュ・スタック回復
// ════════════════════════════════════════════════════════════════

describe("BSTS01-R02 ［隠密統領］ソウエイ", () => {
  const c = card("BSTS01-R02");

  it("hand_increase バースト(void→reserve2+召喚) / 召喚時 2ドロー→1破棄(固定) / 回復は flash+stack 2効果", () => {
    const burst = c.effects!.find((e) => e.timing.kind === "burst")!;
    expect((burst.timing as { trigger?: unknown }).trigger).toContain(
      "手札が増えた"
    );
    expect(burst.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "reserve", player: "self" },
      amount: 2,
    });
    expect(burst.steps[1]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });

    const summon = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "summon"
    )!;
    expect(summon.steps[0]!.action).toEqual({ kind: "draw", count: 2 });
    expect(summon.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: 1,
    });

    // フラッシュ/スタックの2効果が limitGroupId 共有。
    const recovers = c.effects!.filter((e) =>
      e.steps.some((s) => s.action.kind === "recover")
    );
    expect(recovers).toHaveLength(2);
    const modes = recovers.map((e) => (e.timing as { mode?: string }).mode);
    expect(modes).toContain("flash");
    expect(modes).toContain("stack");
    for (const r of recovers) {
      expect(r.limitGroupId).toBe("BSTS01-R02-recover");
      expect(r.condition).toContainEqual({ kind: "min_level", value: 2 });
    }
  });

  it("[board] 召喚時: デッキ上2枚がドローされてデッキを離れる", () => {
    const src = createCardInstance(c, {
      instanceId: "souei-r02",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C02"), {
        instanceId: `deck-r02-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const summon = c.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event: unknown }).event === "summon"
    )!;
    const after = runEffect(
      createEmptyGameState({
        cardInstances: [src, ...deck],
        playerOverrides: [{ deckCount: 5 }, {}],
      }),
      summon,
      "souei-r02"
    );
    const deckLeft = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "deck"
    );
    expect(deckLeft).toHaveLength(3); // 5 - 2 ドロー
  });

  it("[board] バースト後の自己召喚はカードコストを払わず、Lv1維持コアだけを置く", () => {
    const burst = c.effects!.find((e) => e.timing.kind === "burst")!;
    const after = resolveFreeBurstSelfSummon(c, burst, 1, "souei-free-burst");
    expect(
      after.cardInstances.find(
        (candidate) => candidate.instanceId === "souei-free-burst"
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(alice(after).reserveNormalCoreCount).toBe(0);
  });

  it("[board] フラッシュ回復: 疲労状態の自スピリットが回復する", () => {
    const src = createCardInstance(c, {
      instanceId: "souei-r02b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const flash = c.effects!.find(
      (e) =>
        e.steps.some((s) => s.action.kind === "recover") &&
        (e.timing as { mode?: string }).mode === "flash"
    )!;
    expect(src.exhaustState).toBe("exhausted");
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src] }),
      flash,
      "souei-r02b"
    );
    const recovered = after.cardInstances.find(
      (x) => x.instanceId === "souei-r02b"
    )!;
    expect(recovered.exhaustState).toBe("recovered");
  });
});

// ════════════════════════════════════════════════════════════════
// R03 暴食之王 — フラッシュ vanish（コア→リザーブ既定）/ suppress / ブレイヴ残存不可
// ════════════════════════════════════════════════════════════════

describe("BSTS01-R03 アルティメットスキル『暴食之王』", () => {
  const c = card("BSTS01-R03");

  it("手札にあるこのカードは相手によって自分のライフが減ったときコスト不要で使用できる", () => {
    expect(c.effects).toHaveLength(2);
    const grant = c.effects![0]!;
    expect(grant.applicability).toEqual({ zone: "hand" });
    expect(grant.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "reduce_life",
      cause: ["opponent_effect", "battle"],
    });
    expect(grant.executionMode).toBe("optional");
    const action = grant.steps[0]!.action;
    expect(action.kind).toBe("use_magic_without_cost");
    if (action.kind === "use_magic_without_cost") {
      expect(action.magicTiming).toBe("flash");
    }
  });

  it("フラッシュ vanish(spirit/ult) は発揮抑止とブレイヴ残存不可を持つ", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("vanish");
    if (action.kind === "vanish" && "filter" in action.target) {
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.suppressDestroyedEffects).toBe("destroyed_only");
      expect(action.braveCannotRemain).toBe(true);
    }
  });

  it("[board] フラッシュ: 相手スピリットが消滅予約される", () => {
    const enemy = createCardInstance(card("BSTS01-C02"), {
      instanceId: "enemy-r03",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const after = runEffect(
      createEmptyGameState({ cardInstances: [enemy] }),
      c.effects![1]!,
      "enemy-r03"
    );
    const enemyAfter = after.cardInstances.find(
      (x) => x.instanceId === "enemy-r03"
    )!;
    // executeVanish はコア→リザーブ override 付きの leave を queue する（pendingLeaveKind="vanish"）。
    expect(enemyAfter.pendingLeaveKind).toBe("vanish");
    expect(after.log.some((l) => l.includes("effect:vanish"))).toBe(true);
    // 消滅対象のコアはリザーブへ（既定挙動）。
    expect(bob(after).reserveNormalCoreCount).toBeGreaterThan(0);
  });

  it("[board] フラッシュ: 消滅対象の離脱時効果は発揮抑止される", () => {
    // C02 は「相手によってフィールドを離れるとき」効果を持つ。
    const enemy = createCardInstance(card("BSTS01-C02"), {
      instanceId: "enemy-r03-suppress",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      cardInstances: [enemy],
      playerOverrides: [
        {},
        { trashNormalCoreCount: 3, reserveNormalCoreCount: 0 },
      ],
    });

    const afterVanish = runEffect(before, c.effects![1]!, "enemy-r03-suppress");
    const pending = afterVanish.pendingLeaveEntities.find(
      (p) => p.instanceId === "enemy-r03-suppress"
    );
    expect(pending?.kind).toBe("vanish");
    expect(pending?.suppressDestroyedEffects).toBe("destroyed_only");

    const flushed = flushPendingLeaves(afterVanish, getDef);
    const queued = collectAndQueueTriggerReactions({
      beforeState: afterVanish,
      afterState: flushed,
      source: "action_resolution",
      chainId: pending?.chainId ?? null,
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: fieldEffectLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      queued.pendingTriggeredEffects.some(
        (effect) =>
          effect.eventKind === "leave_field" &&
          effect.relatedInstanceId === "enemy-r03-suppress"
      )
    ).toBe(false);
    expect(bob(queued).trashNormalCoreCount).toBe(3);
    expect(bob(queued).reserveNormalCoreCount).toBe(2);
  });

  it("[board] フラッシュ: 合体先を消滅させるとブレイヴは残せずトラッシュへ移動する", () => {
    const host = createCardInstance(card("BSTS01-C02"), {
      instanceId: "host-r03-brave",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: ["brave-r03"],
    });
    const brave = createCardInstance(card("BSAZ01-C18"), {
      instanceId: "brave-r03",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-r03-brave",
    });
    const before = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });

    const afterVanish = runEffect(before, c.effects![1]!, "host-r03-brave");
    const pending = afterVanish.pendingLeaveEntities.find(
      (p) => p.instanceId === "host-r03-brave"
    );
    expect(pending?.kind).toBe("vanish");
    expect(pending?.forceBraveSendWithHost).toBe(true);

    const flushed = flushPendingLeaves(afterVanish, getDef);
    const hostAfter = flushed.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "host-r03-brave"
    )!;
    const braveAfter = flushed.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "brave-r03"
    )!;
    expect(flushed.pendingBraveLeaveChoice).toBeNull();
    expect(hostAfter.zone).toBe("trash");
    expect(braveAfter.zone).toBe("trash");
    expect(hostAfter.attachedChildrenIds).toEqual([]);
    expect(braveAfter.attachedToInstanceId).toBeNull();
    expect(bob(flushed).reserveNormalCoreCount).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════
// X01 神之怒リムル — 煌臨宣言(P3-89) + 動的floor範囲破壊 needs-dsl で empty
// ════════════════════════════════════════════════════════════════

describe("BSTS01-X01 ［神之怒］リムル=テンペスト", () => {
  const c = card("BSTS01-X01");

  it("契約煌臨 adventData が配線（both_attack_step / contract）/ [3,4]破壊は動的上限レンジ + cards_from_ref 連動報酬で stub 解消", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.soulCoreDest).toBe("trash");
    expect(c.adventData!.adventCondition.minCost).toBeUndefined();
    expect(c.adventData!.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 3 },
    ]);
    const ev = c.effects![0]!;
    expect(ev.timing).toEqual({
      kind: "card_event",
      event: ["summon", "advent"],
    });
    // 動的上限破壊 (count.max=count_value/2, maxCost:8) + per-target 報酬。
    // 盤面検証は bsts01-x01-count-dynamic-destroy.test.ts。
    expect(ev.stub).toBeUndefined();
    expect(ev.steps).toHaveLength(3);
    const destroy = ev.steps[0]!;
    expect(destroy.id).toBe("destroyed");
    if (
      destroy.action.kind === "destroy" &&
      destroy.action.target.kind === "filter"
    ) {
      expect(destroy.action.target.count).toEqual({
        min: 0,
        max: { source: { kind: "count_value", player: "self" }, divisor: 2 },
      });
      expect(destroy.action.target.filter?.maxCost).toBe(8);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// X02 覚醒魔王リムル — 煌臨時 core gather + 暴嵐召喚 / アタック時 創界神含む2つまで破壊
// ════════════════════════════════════════════════════════════════

describe("BSTS01-X02 ［覚醒魔王］リムル=テンペスト", () => {
  const c = card("BSTS01-X02");

  it("契約煌臨 adventData 配線(own_turn/contract/spirit+ultimate) / 煌臨時 core gather + 暴嵐召喚 / アタック時破壊", () => {
    expect(c.cardNo).toBe("BSTS01-X02");
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventVariant).toBe("contract");
    expect(c.adventData!.adventTiming).toBe("own_turn");
    expect(c.adventData!.adventCondition.targetCategory).toEqual([
      "spirit",
      "ultimate",
    ]);
    expect(c.adventData!.adventCondition.minCost).toBeUndefined();
    expect(c.adventData!.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 8 },
    ]);
    // 《召喚条件：魂状態を含む自分の「リムル=テンペスト」1枚以上》= declarative summonCondition
    // （詳細は専用 describe で runtime 判定をテスト）。
    expect(c.summonCondition?.[0]).toMatchObject({
      kind: "field_has",
      cardNames: [{ contains: "リムル=テンペスト" }],
    });
    expect(c.effects).toHaveLength(2);
    const advent = c.effects![0]!;
    expect(advent.timing).toEqual({ kind: "card_event", event: "advent" });
    expect(advent.executionMode).toBe("optional");
    expect(advent.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(advent.condition).toEqual([{ kind: "min_level", value: 3 }]);
    const gather = advent.steps[0]!.action;
    expect(gather.kind).toBe("core_distribute");
    if (gather.kind === "core_distribute") {
      expect(gather.from).toEqual({ kind: "non_life_normal_self" });
      expect(gather.to).toEqual({ kind: "source_card" });
      expect(gather.amount).toBe("all");
      expect(gather.mode).toBe("player_choice");
      expect(gather.effectKind).toBe("normal_only");
    }
    const summon = advent.steps[1]!;
    expect(summon.connector).toBe("conditional_result");
    expect(summon.targetSelectionTiming).toBe("on_step");
    expect(summon.action.kind).toBe("summon");
    if (summon.action.kind === "summon") {
      expect(summon.action.costModifier).toBe("free");
      expect(summon.action.target).toEqual({
        kind: "from_zone",
        zone: "trash",
        filter: { category: ["spirit"], tribes: ["暴嵐"] },
        count: {
          min: 0,
          max: {
            source: {
              kind: "step_numeric_amount",
              stepId: "x02-awaken-core-gather",
            },
            divisor: 3,
            cap: 5,
          },
        },
      });
    }
    const atk = c.effects![1]!;
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    const d = atk.steps[0]!.action;
    expect(d.kind).toBe("destroy");
    if (d.kind === "destroy" && "filter" in d.target) {
      expect(d.target.filter.category).toEqual(["spirit", "ultimate", "nexus"]);
      expect(d.target.filter.targetsGrandwalker).toBe(true);
      expect(d.target.count).toEqual({ min: 0, max: 2 });
    }
    // 条件付き防止不可: カウント10以上 ∧ Lv4以上で unpreventable。
    expect(atk.stub).toBeUndefined();
    expect(atk.preventionLevel).toBe("unpreventable");
    expect(atk.preventionLevelCondition).toEqual([
      { kind: "count_value", player: "self", min: 10 },
      { kind: "min_level", value: 4 },
    ]);
  });

  it("[board] アタック時破壊 (fixed count=1 変種) で相手スピリットが破壊予約される", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru-x02",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(card("BSTS01-C02"), {
      instanceId: "enemy-x02",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const d = c.effects![1]!.steps[0]!.action;
    if (d.kind !== "destroy" || !("filter" in d.target))
      throw new Error("expected destroy filter");
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        { action: { kind: "destroy", target: { ...d.target, count: 1 } } },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [src, enemy] }),
      fixed,
      "rimuru-x02"
    );
    const enemyAfter = after.cardInstances.find(
      (x) => x.instanceId === "enemy-x02"
    )!;
    expect(enemyAfter.pendingLeaveKind).toBe("destroy");
  });

  it("[board] 煌臨時: life と soul を除いた通常コアすべてを置き、置いた数÷3まで暴嵐を召喚できる", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru-x02-core-gather",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const fieldSource = createCardInstance(card("BSTS01-C02"), {
      instanceId: "x02-field-core-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const summonA = createCardInstance(card("BSTS01-C02"), {
      instanceId: "x02-summon-a",
      ownerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
    });
    const summonB = createCardInstance(card("BSTS01-C03"), {
      instanceId: "x02-summon-b",
      ownerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
    });
    const summonC = createCardInstance(card("BSTS01-C06"), {
      instanceId: "x02-non-spirit",
      ownerPlayerId: ALICE,
      zone: "trash",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src, fieldSource, summonA, summonB, summonC],
      playerOverrides: [
        {
          reserveNormalCoreCount: 4,
          trashNormalCoreCount: 2,
          lifeNormalCoreCount: 5,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const opened = executeEffect({
      chainId: "test:bsts01-cards:2149",
      state: before,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "rimuru-x02-core-gather",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const afterDistribute = opened;

    expect(afterDistribute.pendingCoreDistribution).toBeNull();
    expect(afterDistribute.pendingStepOptionalTargetSelection).not.toBeNull();
    const chooser = afterDistribute.pendingStepOptionalTargetSelection!;
    expect(chooser.requiredTargetCount).toBe(0);
    expect(chooser.maxTargetCount).toBe(2);
    expect(chooser.candidateInstanceIds.sort()).toEqual([
      "x02-summon-a",
      "x02-summon-b",
    ]);

    const resolveSummon = getLegalActions({
      state: afterDistribute,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_target_selection"
    );
    if (
      !resolveSummon ||
      resolveSummon.kind !== "resolve_pending_step_optional_target_selection"
    ) {
      throw new Error(
        "resolve_pending_step_optional_target_selection not found"
      );
    }

    const afterSummonPending = applyLegalAction({
      state: afterDistribute,
      action: resolveSummon,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["x02-summon-a", "x02-summon-b"],
    }).state;

    const resolvePlacement = getLegalActions({
      state: afterSummonPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(resolvePlacement).toBeDefined();
    const afterSummon = applyLegalAction({
      state: afterSummonPending,
      action: resolvePlacement!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "x02-summon-a",
          placements: [
            {
              kind: "card_normal",
              instanceId: "rimuru-x02-core-gather",
              amount: 1,
            },
          ],
        },
        {
          destinationInstanceId: "x02-summon-b",
          placements: [
            {
              kind: "card_normal",
              instanceId: "rimuru-x02-core-gather",
              amount: 1,
            },
          ],
        },
      ],
    }).state;

    expect(alice(afterSummon).reserveNormalCoreCount).toBe(0);
    expect(alice(afterSummon).trashNormalCoreCount).toBe(0);
    expect(alice(afterSummon).lifeNormalCoreCount).toBe(5);
    expect(alice(afterSummon).reserveSoulCoreCount).toBe(1);
    expect(alice(afterSummon).soulCoreLocation).toEqual({ kind: "reserve" });
    expect(
      afterSummon.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "rimuru-x02-core-gather"
      )!.normalCoreCount
    ).toBe(7);
    expect(
      afterSummon.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "x02-field-core-source"
      )!.normalCoreCount
    ).toBe(0);
    expect(
      afterSummon.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "x02-summon-a"
      )!.zone
    ).toBe("field");
    expect(
      afterSummon.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "x02-summon-a"
      )!.normalCoreCount
    ).toBe(1);
    expect(
      afterSummon.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "x02-summon-b"
      )!.zone
    ).toBe("field");
    expect(
      afterSummon.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "x02-summon-b"
      )!.normalCoreCount
    ).toBe(1);
    expect(
      afterSummon.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "x02-non-spirit"
      )!.zone
    ).toBe("trash");
  });

  it("[board] 煌臨時: 〔ターンに1回:同名〕で同ターン2回目は発揮できない", () => {
    const regs = generateTriggeredEffectRegistrations(c);
    const regIndex = regs.findIndex(
      (registration) =>
        registration.effectCategory === "triggered" &&
        registration.effectIndex === 0
    );
    expect(regIndex).toBeGreaterThanOrEqual(0);
    const registration = regs[regIndex]!;
    const usageLimit = registration.usageLimit;
    expect(usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const effectLabel = getStableEffectLabel(
      registration.sourceKind,
      regIndex,
      registration
    );

    const makeX02 = (instanceId: string) =>
      createCardInstance(c, {
        instanceId,
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "ultimate",
        normalCoreCount: 1,
      });
    const makeAdventPending = (
      pendingId: string,
      instanceId: string
    ): PendingTriggeredEffect =>
      ({
        pendingId,
        eventKind: "advent",
        actingPlayerId: ALICE,
        source: "action_resolution",
        chainId: "test:bsts01-cards:2304",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: instanceId,
        amount: null,
        step: "main",
        window: "default",
        resolvedSourceInstanceIds: [],
        declaredFromPrivateZone: true,
        declaredSourceInstanceId: instanceId,
        declaredSourceDefinitionId: c.cardNo,
        declaredSourceKind: "ultimate",
        declaredRegistrationIndex: regIndex,
      }) as PendingTriggeredEffect;

    const firstSource = makeX02("rimuru-x02-limit-a");
    const secondSource = makeX02("rimuru-x02-limit-b");
    const base = createEmptyGameState({
      cardInstances: [firstSource, secondSource],
      playerOverrides: [
        { reserveNormalCoreCount: 3, trashNormalCoreCount: 3 },
        {},
      ],
    });
    expect(
      canUseEffectByUsageLimit({
        state: base,
        sourceInstanceId: firstSource.instanceId,
        sourceDefinitionId: c.cardNo,
        getCardDefinitionById: getDef,
        effectLabel,
        usageLimit: usageLimit!,
      })
    ).toBe(true);

    const afterFirstUse: GameState = {
      ...base,
      effectUsageRecords: recordEffectUsage({
        state: base,
        sourceInstanceId: firstSource.instanceId,
        sourceDefinitionId: c.cardNo,
        effectLabel,
        duration: "turn",
      }),
    };
    expect(
      canUseEffectByUsageLimit({
        state: afterFirstUse,
        sourceInstanceId: secondSource.instanceId,
        sourceDefinitionId: c.cardNo,
        getCardDefinitionById: getDef,
        effectLabel,
        usageLimit: usageLimit!,
      })
    ).toBe(false);

    const secondQueued: GameState = {
      ...afterFirstUse,
      pendingTriggeredEffects: [
        makeAdventPending(
          "rimuru-x02-limit-second-pending",
          secondSource.instanceId
        ),
      ],
    };
    const secondActions = getLegalActions({
      state: secondQueued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : [],
    }).filter((action) => action.kind === "resolve_pending_triggered_effect");
    expect(
      secondActions.some(
        (action) => !("skipOnly" in action && action.skipOnly === true)
      )
    ).toBe(false);
    const skipOnly = secondActions.find(
      (action) => "skipOnly" in action && action.skipOnly === true
    );
    expect(skipOnly).toBeDefined();

    const skipped = applyLegalAction({
      state: secondQueued,
      action: skipOnly!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : [],
    }).state;
    expect(skipped.pendingTriggeredEffects).toHaveLength(0);
    expect(skipped.pendingCoreDistribution).toBeNull();
    expect(alice(skipped).reserveNormalCoreCount).toBe(3);
    expect(alice(skipped).trashNormalCoreCount).toBe(3);
    expect(
      skipped.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === secondSource.instanceId
      )!.normalCoreCount
    ).toBe(1);
  });

  it.each(["protected", "independent", "empty", "cap"] as const)(
    "[board] 煌臨時: %s でもHUDを経由せず、全数達成時だけ召喚へ進む",
    (variant) => {
      const otherDef =
        variant === "independent"
          ? ALL_CARDS.find((definition) => definition.grandwalkerData)!
          : card("BSTS01-C02");
      const src = createCardInstance(c, {
        instanceId: "gather",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const other = createCardInstance(otherDef, {
        instanceId: "other",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: variant === "empty" ? 0 : 2,
      });
      const before = createEmptyGameState({
        cardInstances: [
          src,
          other,
          ...Array.from({ length: 6 }, (_, i) =>
            createCardInstance(card("BSTS01-C02"), {
              instanceId: `summon-${i}`,
              ownerPlayerId: ALICE,
              zone: "trash",
              normalCoreCount: 0,
            })
          ),
        ],
        playerOverrides: [
          {
            reserveNormalCoreCount:
              variant === "empty" ? 0 : variant === "cap" ? 16 : 4,
            trashNormalCoreCount: variant === "empty" ? 0 : 2,
          },
          {},
        ],
      });
      if (variant === "protected")
        before.activeContinuousEffects.push({
          effectId: "protect",
          sourceInstanceId: "other",
          sourceDefinitionId: otherDef.cardNo,
          actingPlayerId: ALICE,
          targetInstanceId: "other",
          modifierTag: "prevent_normal_core_move",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
        });
      const after = runEffect(before, c.effects![0]!, "gather");
      expect(after.pendingCoreDistribution).toBeNull();
      expect(
        after.cardInstances.find((x) => x.instanceId === "gather")!
          .normalCoreCount
      ).toBe(variant === "empty" ? 1 : variant === "cap" ? 21 : 7);
      expect(alice(after).reserveNormalCoreCount).toBe(0);
      expect(alice(after).trashNormalCoreCount).toBe(0);
      if (variant === "protected" || variant === "empty") {
        expect(after.pendingStepOptionalTargetSelection).toBeNull();
      } else {
        expect(after.pendingStepOptionalTargetSelection?.maxTargetCount).toBe(
          variant === "cap" ? 5 : 2
        );
      }
      if (variant === "protected" || variant === "independent")
        expect(
          after.cardInstances.find((x) => x.instanceId === "other")!
            .normalCoreCount
        ).toBe(2);
    }
  );
});

// ════════════════════════════════════════════════════════════════
// X03 ヴェルドラ — treat_as / leave_field バースト(重疲労2+デッキ下+召喚) / 『アタック時』自バースト発揮
// ════════════════════════════════════════════════════════════════

describe("BSTS01-X03 ［暴風竜］ヴェルドラ", () => {
  const c = card("BSTS01-X03");

  it("treat_as青 / leave_field バースト(重疲労2+疲労状態デッキ下+召喚)", () => {
    expect(c.effects![0]!.steps[0]!.action).toEqual(treatAsBlue);
    const burst = c.effects!.find((e) => e.timing.kind === "burst")!;
    expect((burst.timing as { trigger?: unknown }).trigger).toContain(
      "自分のスピリットがフィールドを離れた"
    );
    const exhaust = burst.steps[0]!.action;
    expect(exhaust.kind).toBe("exhaust");
    if (exhaust.kind === "exhaust") {
      expect(exhaust.degree).toBe("heavy_exhaust");
      if ("filter" in exhaust.target) {
        expect(exhaust.target.filter.category).toEqual(["spirit", "ultimate"]);
        expect(exhaust.target.count).toBe(2);
      }
    }
    // 「疲労状態の」送デッキ対象限定は exhaustState:"exhausted" で強制（stub 解消）。
    const sendStep = burst.steps[1]!.action;
    expect(sendStep.kind).toBe("send_to_deck");
    if (sendStep.kind === "send_to_deck" && "filter" in sendStep.target) {
      expect(sendStep.target.filter.exhaustState).toBe("exhausted");
    }
    expect(burst.steps[2]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
    expect(burst.stub).toBeUndefined();
  });

  it("[board] バースト 重疲労ステップ(fixed count=1 変種)で相手スピリットが重疲労する", () => {
    // 本体は count:2（非対話 executeEffect では多体選択が自動解決されないため、
    // 重疲労機構の盤面変化は fixed count=1 変種で検証する。BSDB01 board test と同方針）。
    const enemy = createCardInstance(card("BSTS01-C02"), {
      instanceId: "ex-x03-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const burst = c.effects!.find((e) => e.timing.kind === "burst")!;
    const exhaustAction = burst.steps[0]!.action;
    if (exhaustAction.kind !== "exhaust" || !("filter" in exhaustAction.target))
      throw new Error("expected exhaust filter action");
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "exhaust",
            target: { ...exhaustAction.target, count: 1 },
            degree: "heavy_exhaust",
          },
        },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [enemy] }),
      fixed,
      "ex-x03-1"
    );
    const ex = after.cardInstances.find((x) => x.instanceId === "ex-x03-1")!;
    expect(ex.exhaustState).toBe("heavily_exhausted");
  });

  it("[board] バースト後の自己召喚はカードコストを払わず、Lv1維持コアだけを置く", () => {
    const burst = c.effects!.find((e) => e.timing.kind === "burst")!;
    const after = resolveFreeBurstSelfSummon(c, burst, 2, "veldora-free-burst");
    expect(
      after.cardInstances.find(
        (candidate) => candidate.instanceId === "veldora-free-burst"
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(alice(after).reserveNormalCoreCount).toBe(0);
  });

  it("[6,7]『アタック時』自バースト発揮 = バースト steps をアタック誘発で複製(任意)", () => {
    const attackEffect = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.executionMode === "optional"
    )!;
    expect(attackEffect).toBeDefined();
    expect((attackEffect.timing as { event?: unknown }).event).toBe("attack");
    expect(attackEffect.textRef).toEqual([6, 7]);
    // バースト本体と同じ steps（重疲労2 → 疲労状態デッキ下(任意) → 自召喚）。
    expect(attackEffect.steps[0]!.action.kind).toBe("exhaust");
    expect(attackEffect.steps[1]!.action.kind).toBe("send_to_deck");
    expect(attackEffect.steps[2]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
    });
  });

  it("[board] 場のヴェルドラが自バースト発揮しても summon{self} は no-op(二重召喚しない)", () => {
    // ヴェルドラ自身を場に置き(アタック時=既に場)、[6,7] を fixed count=1 変種で発火。
    // 相手スピリットは重疲労し、ヴェルドラは場に1体のまま(executeSummonSelf 場在チェックで no-op)。
    const veldora = createCardInstance(c, {
      instanceId: "x03-self",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(card("BSTS01-C02"), {
      instanceId: "ex-x03-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "exhaust",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: 1,
            },
            degree: "heavy_exhaust",
          },
        },
        {
          action: { kind: "summon", target: { kind: "self" } },
          connector: "sequential",
        },
      ],
    };
    const after = runEffect(
      createEmptyGameState({ cardInstances: [veldora, enemy] }),
      fixed,
      "x03-self"
    );
    const ex = after.cardInstances.find((x) => x.instanceId === "ex-x03-2")!;
    expect(ex.exhaustState).toBe("heavily_exhausted");
    // 自召喚は no-op: ヴェルドラ instance は1体のまま、場に残る。
    const veldoraInstances = after.cardInstances.filter(
      (x) => x.definitionId === veldora.definitionId
    );
    expect(veldoraInstances).toHaveLength(1);
    expect(veldoraInstances[0]!.zone).toBe("field");
  });
});

// 《召喚条件：魂状態を含む自分の「X」N体以上》の declarative summonCondition。
// 裁定 2026-06-13（10_rules/08a）: 『魂状態を含む自分の「X」』= 〔通常フィールドの「X」〕∪〔魂状態の「X」〕。
// 魂状態カードは zone:"field" のまま soulStateInstanceIds に入るが、無印スコープでは数えないため
// field_has に includeSoulState:true を付けて opt-in する（包含スコープ単体検証は
// name-reference-inclusion-scope.test.ts）。canSummonUltimate が evaluateCondition で宣言前判定する。
describe("BSTS01-X02 《召喚条件：魂状態を含む自分の「リムル=テンペスト」1枚以上》", () => {
  const x02 = card("BSTS01-X02");
  const evalOpts = (instId: string) => ({
    sourceInstanceId: instId,
    evaluateCondition,
  });

  function setup(rimuru: "none" | "field" | "soul"): GameState {
    const insts = [
      createCardInstance(x02, {
        instanceId: "x02-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
    ];
    const soulIds: string[] = [];
    if (rimuru !== "none") {
      // BSTS01-CX01 の name は "リムル=テンペスト"（contains で一致）。
      insts.push(
        createCardInstance(card("BSTS01-CX01"), {
          instanceId: "rimuru-f1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: rimuru === "soul" ? 0 : 1,
        })
      );
      if (rimuru === "soul") soulIds.push("rimuru-f1");
    }
    return createEmptyGameState({
      cardInstances: insts,
      playerOverrides: [{ soulStateInstanceIds: soulIds }, {}],
    });
  }

  it("summonCondition が field_has「リムル=テンペスト」で宣言される", () => {
    expect(x02.summonCondition?.[0]).toMatchObject({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "リムル=テンペスト" }],
      minCount: 1,
    });
  });

  it("「リムル=テンペスト」不在では召喚不可", () => {
    expect(
      canSummonUltimate(setup("none"), ALICE, x02, getDef, evalOpts("x02-1"))
    ).toBe(false);
  });

  it("通常フィールドの「リムル=テンペスト」で召喚可", () => {
    expect(
      canSummonUltimate(setup("field"), ALICE, x02, getDef, evalOpts("x02-1"))
    ).toBe(true);
  });

  it("魂状態の「リムル=テンペスト」も『魂状態を含む』として数え召喚可（裁定 2026-06-13）", () => {
    const s = setup("soul");
    expect(
      s.players.find((p) => p.id === ALICE)!.soulStateInstanceIds
    ).toContain("rimuru-f1");
    expect(canSummonUltimate(s, ALICE, x02, getDef, evalOpts("x02-1"))).toBe(
      true
    );
  });
});

describe("BSFT01-X01 《召喚条件：C5以上＆魂状態を含む自分の「ルーシィ」1体以上》", () => {
  const x01 = card("BSFT01-X01");
  const evalOpts = (instId: string) => ({
    sourceInstanceId: instId,
    evaluateCondition,
  });

  function setup(count: number, lucy: "none" | "field" | "soul"): GameState {
    const insts = [
      createCardInstance(x01, {
        instanceId: "x01-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
    ];
    const soulIds: string[] = [];
    if (lucy !== "none") {
      // BSFT01-CX01 の name は "ルーシィ・ハートフィリア"（contains "ルーシィ" で一致）。
      insts.push(
        createCardInstance(card("BSFT01-CX01"), {
          instanceId: "lucy-f1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: lucy === "soul" ? 0 : 1,
        })
      );
      if (lucy === "soul") soulIds.push("lucy-f1");
    }
    return createEmptyGameState({
      cardInstances: insts,
      playerOverrides: [
        { countValue: count, soulStateInstanceIds: soulIds },
        {},
      ],
    });
  }

  it("summonCondition が count_value>=5 ＋ field_has「ルーシィ」で宣言される", () => {
    expect(x01.summonCondition).toMatchObject([
      { kind: "count_value", player: "self", min: 5 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ルーシィ" }],
        minCount: 1,
      },
    ]);
  });

  it("カウント4（<5）では「ルーシィ」在場でも召喚不可", () => {
    expect(
      canSummonUltimate(
        setup(4, "field"),
        ALICE,
        x01,
        getDef,
        evalOpts("x01-1")
      )
    ).toBe(false);
  });

  it("カウント5でも「ルーシィ」不在では召喚不可", () => {
    expect(
      canSummonUltimate(setup(5, "none"), ALICE, x01, getDef, evalOpts("x01-1"))
    ).toBe(false);
  });

  it("カウント5＋通常フィールドの「ルーシィ」で召喚可", () => {
    expect(
      canSummonUltimate(
        setup(5, "field"),
        ALICE,
        x01,
        getDef,
        evalOpts("x01-1")
      )
    ).toBe(true);
  });

  it("カウント5＋魂状態の「ルーシィ」も『魂状態を含む』として数え召喚可（裁定 2026-06-13）", () => {
    expect(
      canSummonUltimate(setup(5, "soul"), ALICE, x01, getDef, evalOpts("x01-1"))
    ).toBe(true);
  });
});
