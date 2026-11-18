import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSAZ02-X01「タルシス」effects 検証。
 *
 * 原文 (textLines[0,2,3,5,7,8,10,11]):
 *   《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》
 *   フラッシュ『お互いのアタックステップ』
 *   〔ターンに1回：同名〕手札にあるこのカードは召喚できる。このとき、「ヴァース」が
 *   あるとき、召喚条件を無視し、軽減シンボルすべてを満たす。
 *   【アルドノアドライブ：1】（このアルティメットの下にアルドノアドライブを1枚まで
 *   置ける。あるとき、以下の効果を得る）
 *   Lv3-Lv4-Lv5
 *   相手は、このアルティメットをマジック以外の効果の対象にできず、含めない。
 *   Lv4-Lv5『お互いのスタートステップ』
 *   〔重複不可〕自分は、ターンプレイヤーのデッキの上から5枚内容を見る。その後、
 *   好きなようにデッキの上と下に戻す。
 *
 * 検証点:
 *  - effects[0]/[1]: フラッシュ召喚2effect定義。「このとき」＝flash summon 実行時限定の
 *    バイパスなので、ヴァースあり分岐は SummonAction 単発の ignoreSummonCondition フラグ
 *    (costModifier:"full_reduction" と併用) で表現し、permanent CE は使わない（通常メイン
 *    フェイズ召喚の legal action 列挙には一切影響しないことも検証する）。
 *    ヴァースなし = 通常召喚（summonCondition が通常どおり効く）。
 *  - effects[2]（アルドノアドライブLv3-5継続）: effect_immunity(sourceScope.categories から
 *    マジックを除く全カテゴリ) で、マジック発生源には免疫不成立・非マジック発生源には免疫成立。
 *  - effects[3]/[4]（アルドノアドライブLv4-5スタートステップ）: deck_reveal(revealCount:5,
 *    picks:[], remainder:"top_or_bottom") の pending 生成、自分/相手スタートステップの
 *    2 effect 排他登録 (limitGroupId 共有)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getAvailableHandCardLegalActions } from "../src/legal/legal-actions-availability";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { filterTargetsByTargetAcquisitionGate } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "alice";
const BOB = "bob";
const X01 = card("BSAZ02-X01");
// 「ヴァース」を名前に含む導界者ネクサス (フィクスチャ用)。
const VERSE_NEXUS = card("BSAZ02-X04");
const FILLER = card("BSAZ02-M01");

function underFiller(hostId: string) {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: `under-drive-${hostId}`,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostId,
  });
}

function srcX01(hostId: string, cores: number) {
  const src = createCardInstance(X01, {
    instanceId: hostId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: `under-drive-${hostId}`,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function buildState(
  cardInstances: GameState["cardInstances"],
  overrides?: Partial<GameState>
): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    activePlayerId: ALICE,
    step: "main",
    cardInstances,
    ...overrides,
  };
}

describe("BSAZ02-X01 effects[0,1]（『このとき』＝flash summon 実行時限定の召喚条件バイパス、通常召喚経路への非漏出）", () => {
  it("「ヴァース」があっても、通常メインフェイズの手札召喚 legal action は召喚条件不成立のままバイパスされない（『このとき』のスコープ外）", () => {
    const verse = createCardInstance(VERSE_NEXUS, {
      instanceId: "verse-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const otherCf = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "field-cf",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const x01Hand = createCardInstance(X01, {
      instanceId: "x01-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = rebuildContinuousEffectsFromField(
      buildState([verse, otherCf, x01Hand]),
      getCardDefinitionById
    );
    const actions = getAvailableHandCardLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    });
    const normalSummon = actions.find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "x01-hand"
    );
    expect(normalSummon).toBeUndefined();
  });

  it("「ヴァース」も既存「ＣＦ」アルティメットも無ければ、通常メインフェイズの手札召喚 legal action が出る（summonCondition が本来満たされているケース）", () => {
    const x01Hand = createCardInstance(X01, {
      instanceId: "x01-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = rebuildContinuousEffectsFromField(
      buildState([x01Hand], {
        players: createEmptyGameState({
          playerIds: [ALICE, BOB],
          playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
        }).players,
      }),
      getCardDefinitionById
    );
    const actions = getAvailableHandCardLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    });
    const normalSummon = actions.find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "x01-hand"
    );
    expect(normalSummon).toBeDefined();
  });
});

describe("BSAZ02-X01 effects[0,1]（フラッシュ『お互いのアタックステップ』手札からの召喚 steps 詳細）", () => {
  it("effects[1]: ヴァースあり分岐は costModifier:full_reduction + ignoreSummonCondition:true の summon（この summon action 単発限定のバイパス）", () => {
    const effect = X01.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "flash" &&
        e.condition?.some((c) => c.kind === "field_has")
    )!;
    expect(effect).toBeDefined();
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "full_reduction",
      ignoreSummonCondition: true,
    });
  });

  it("effects[2]: ヴァースなし分岐は通常の summon（costModifier無し）", () => {
    const effect = X01.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "flash" &&
        e.condition?.some((c) => c.kind === "field_lacks")
    )!;
    expect(effect).toBeDefined();
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
    });
  });

  it("ヴァースがある状態でフラッシュ召喚を実行すると、（summonCondition が本来不成立でも）召喚条件を無視して場に出て、コストは軽減シンボル分(cost7-シンボル5=2)だけ支払われる（0への強制軽減ではない、ENGINE-summon-symbol-reduction-cost裁定準拠）", () => {
    const verse = createCardInstance(VERSE_NEXUS, {
      instanceId: "verse-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const otherCf = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "field-cf",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const x01Hand = createCardInstance(X01, {
      instanceId: "x01-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = rebuildContinuousEffectsFromField(
      buildState([verse, otherCf, x01Hand]),
      getCardDefinitionById
    );

    const flashEffect = X01.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "flash" &&
        e.condition?.some((c) => c.kind === "field_has")
    )!;
    const effectIndex = X01.effects!.indexOf(flashEffect);

    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bsaz02-x01-tarshis:232",
      state,
      effect: flashEffect,
      effectIndex,
      sourceInstanceId: "x01-hand",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const summoned = after.cardInstances.find(
      (c) => c.instanceId === "x01-hand"
    )!;
    expect(summoned.zone).toBe("field");
    // cost = printedCost(7) - requestedSlotCount(白3+究極2=5) = 2 (0への強制軽減ではない)。
    // reserve 減少分はこの cost(2) + Lv3 の召喚時最低コア配置(requiredCores:1) = 3 になるため、
    // cost 自体は auto-payment ログの cost= で個別に検証する。
    expect(
      after.log.some((l) =>
        l.startsWith(`effect:summon:x01-hand:self:self:from=hand:cost=2:`)
      )
    ).toBe(true);
  });
});

describe("BSAZ02-X01 effects[2]（アルドノアドライブLv3-5: マジック以外の効果の対象にできず、含めない）", () => {
  it.each(["explicit_target", "include_all"] as const)(
    "%s は非マジックの防げない効果にも適用し、マジックは通す",
    (intent) => {
      const state = rebuildContinuousEffectsFromField(
        buildState([srcX01("target", 1), underFiller("target")]),
        getCardDefinitionById
      );
      for (const sourceNo of [
        "BSAZ01-C03",
        "BSAZ02-C01",
        "BSDB01-C05",
        "BSAZ02-C09",
      ]) {
        const source = {
          actingPlayerId: BOB,
          sourceDefinitionId: sourceNo,
          cause: "effect" as const,
          prevention: {
            resistance: "unpreventable" as const,
            targetLockBypass: { kind: "none" as const },
          },
        };
        expect(
          filterTargetsByTargetAcquisitionGate(
            state,
            ["target"],
            source,
            intent,
            getCardDefinitionById
          )
        ).toEqual(sourceNo === "BSAZ01-C03" ? ["target"] : []);
        expect(
          filterTargetsByTargetAcquisitionGate(
            state,
            ["target"],
            {
              ...source,
              prevention: {
                ...source.prevention,
                targetLockBypass: { kind: "all_effects" },
              },
            },
            intent,
            getCardDefinitionById
          )
        ).toEqual(["target"]);
      }
    }
  );
  it("マジック発生源には免疫が成立しない（効果が着弾する）", () => {
    const src = srcX01("src-x01", 1); // Lv3
    const state = buildState([src, underFiller("src-x01")]);
    const effectIndex = X01.effects!.findIndex(
      (e) =>
        e.timing.kind === "continuous" &&
        e.steps.some((s) => s.action.kind === "effect_resistance")
    );
    const after = executeEffect({
      chainId: "test:bsaz02-x01-tarshis:317",
      state,
      effect: X01.effects![effectIndex]!,
      effectIndex,
      sourceInstanceId: "src-x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const target = after.cardInstances.find((c) => c.instanceId === "src-x01")!;

    const opponentMagic = card("BSAZ01-C03");
    expect(opponentMagic.printedCategory).toBe("magic");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: opponentMagic,
      })
    ).toBe(false);
  });

  it("非マジック発生源にも効果を受けない耐性自体は付けない", () => {
    const src = srcX01("src-x01", 1); // Lv3
    const state = buildState([src, underFiller("src-x01")]);
    const effectIndex = X01.effects!.findIndex(
      (e) =>
        e.timing.kind === "continuous" &&
        e.steps.some((s) => s.action.kind === "effect_resistance")
    );
    const after = executeEffect({
      chainId: "test:bsaz02-x01-tarshis:345",
      state,
      effect: X01.effects![effectIndex]!,
      effectIndex,
      sourceInstanceId: "src-x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const target = after.cardInstances.find((c) => c.instanceId === "src-x01")!;

    const opponentSpirit = card("BSDB01-C05");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: opponentSpirit,
      })
    ).toBe(false);
  });
});

describe("BSAZ02-X01 effects[3,4]（アルドノアドライブLv4-5: お互いのスタートステップ、ターンプレイヤーのデッキ上5枚を見て上下に戻す）", () => {
  it("自分のスタートステップ: deck_reveal(revealCount:5, picks:[], remainder:top_or_bottom) の pending が立つ", () => {
    const src = srcX01("src-x01", 3); // Lv4
    const deckCards = Array.from({ length: 8 }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller("src-x01"), ...deckCards],
        playerOverrides: [{ deckCount: 8 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const effect = X01.effects!.find(
      (e) =>
        e.timing.kind === "phase" &&
        e.timing.step === "start" &&
        e.timing.whose === "self"
    )!;
    expect(effect).toBeDefined();
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "deck_reveal",
      revealCount: 5,
      revealTo: "self",
      picks: [],
      remainder: "top_bottom_split",
    });

    const effectIndex = X01.effects!.indexOf(effect);
    const after = executeEffect({
      chainId: "test:bsaz02-x01-tarshis:401",
      state,
      effect,
      effectIndex,
      sourceInstanceId: "src-x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingDeckReveal).not.toBeNull();
    expect(after.pendingDeckReveal!.revealedCardInstanceIds).toHaveLength(5);
    expect(after.pendingDeckReveal!.remainder).toBe("top_bottom_split");

    // 上下配置を確定（全5枚をデッキ下へ）。
    const resolved = applyLegalAction({
      state: after,
      action: {
        kind: "resolve_pending_deck_reveal_order",
        actionId: "order",
        can: true,
        reason: "",
        actingPlayerId: ALICE,
        pendingId: after.pendingDeckReveal!.pendingId,
        remainingCardInstanceIds:
          after.pendingDeckReveal!.revealedCardInstanceIds,
        remainder: "top_bottom_split",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      deckRevealRemainderOrder:
        after.pendingDeckReveal!.revealedCardInstanceIds,
      deckRevealRemainderPlacements: Object.fromEntries(
        after.pendingDeckReveal!.revealedCardInstanceIds.map((id) => [
          id,
          "bottom",
        ])
      ),
    }).state;
    expect(resolved.pendingDeckReveal).toBeNull();
    const alicePlayer = resolved.players.find((p) => p.id === ALICE)!;
    expect(alicePlayer.deckCount).toBe(8);
  });

  it("相手のスタートステップ: 相手のデッキを対象に deck_reveal(player:opponent) が発揮される", () => {
    const src = srcX01("src-x01", 3); // Lv4
    const bobDeck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `bob-deck-${i}`,
        ownerPlayerId: BOB,
        zone: "deck",
      })
    );
    const state = buildState([src, underFiller("src-x01"), ...bobDeck]);
    const effect = X01.effects!.find(
      (e) =>
        e.timing.kind === "phase" &&
        e.timing.step === "start" &&
        e.timing.whose === "opponent"
    )!;
    expect(effect).toBeDefined();
    expect(effect.steps[0]!.action).toEqual({
      kind: "deck_reveal",
      player: "opponent",
      revealCount: 5,
      revealTo: "self",
      picks: [],
      remainder: "top_bottom_split",
    });

    const effectIndex = X01.effects!.indexOf(effect);
    const after = executeEffect({
      chainId: "test:bsaz02-x01-tarshis:471",
      state,
      effect,
      effectIndex,
      sourceInstanceId: "src-x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingDeckReveal).not.toBeNull();
    expect(after.pendingDeckReveal!.actingPlayerId).toBe(ALICE);
    expect(after.pendingDeckReveal!.revealedCardInstanceIds).toHaveLength(5);
    for (const id of after.pendingDeckReveal!.revealedCardInstanceIds) {
      const c = after.cardInstances.find((x) => x.instanceId === id)!;
      expect(c.ownerPlayerId).toBe(BOB);
    }
  });
});
