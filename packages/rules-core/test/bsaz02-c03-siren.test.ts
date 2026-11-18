/**
 * BSAZ02-C03「シレーン」effects[0,1] 検証。
 *
 * 原文 (textLines[0,2,4,5,7,8]):
 *   《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》
 *   【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで
 *   置ける。あるとき、以下の効果を得る）
 *   Lv3『このアルティメットの召喚時』ボイドからコア1個をこのアルティメットに置ける。
 *   Lv3 コスト6以下の相手のスピリット/アルティメットは、アタック/ブロックできず、
 *   相手の「デッキオープン効果」は発揮されない。
 *
 * 検証点:
 *  - summonCondition: BSAZ02-C01/C02/C04 precedent と同型 (exact-zero field_has)。
 *  - effects[0]: card_event:summon + executionMode:optional + core_move(void→this_card)、
 *    アルドノアドライブゲート付き。
 *  - effects[1]: prevent_battle(filter, maxCost:6, attack+block) は動的フィルタの単一 global CE
 *    (targetInstanceId 未設定、structured-continuous-effects.ts executePreventBattle
 *    isDynamicEligible が maxCost/minCost を許可するよう拡張済み) として登録され、
 *    登録後に場へ出たコスト6以下の相手カードも動的に (matchesGlobalCETargetFilter 経由で)
 *    アタック不可判定される。コスト7には成立しない。
 *  - suppress_effect(filter, count:"all") は dynamic global CE (targetInstanceId 未設定、
 *    native-ce-registration-handlers.ts:1260) として登録され、
 *    metadata.effectFilter.containsActionKinds=["deck_reveal"] を保持する。
 *  - EffectTargetFilter.containsActionKinds (新設 primitive) が deck_reveal action を含む
 *    effect の descriptor には一致し、含まない effect の descriptor には一致しない
 *    (matchesEffectTargetFilter 単体検証)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { matchesEffectTargetFilter } from "../src";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import { deriveSuppressionEffectDescriptor } from "../src/effect/structured-effect-registrations";
import { executeReevaluationCheck } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "player-1";
const BOB = "player-2";
const C03 = card("BSAZ02-C03");

/** cost だけを可変にした合成テスト用スピリット定義（maxCost 境界検証専用）。 */
function cheapUnitDef(cost: number): CardDefinition {
  const cardNo = `TEST-COST-${cost}-UNIT`;
  const def: CardDefinition = {
    ...card("BSDB01-C05"),
    cardNo,
    cost,
    effects: [],
    summonCondition: undefined,
  };
  cardNoMap.set(cardNo, def);
  return def;
}

function srcC03() {
  const src = createCardInstance(C03, {
    instanceId: "src-c03",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv3
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller() {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: "under-drive",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "src-c03",
  });
}

function runEffect(state: GameState, effectIndex: number): GameState {
  return executeEffect({
    chainId: "test:bsaz02-c03-siren:95",
    state,
    effect: C03.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-c03",
    actingPlayerId: ALICE,
    getCardDefinitionById: (id) => cardNoMap.get(id),
  });
}

describe("BSAZ02-C03 summonCondition", () => {
  it("自分の系統：CFのアルティメットが0体のときのみ召喚条件を満たす（field_has exact-zero）", () => {
    expect(C03.summonCondition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ]);
  });
});

describe("BSAZ02-C03 effects[0]（Lv3召喚時: ボイドからコア1個を置ける）", () => {
  it("アルドノアドライブがあるとき、任意でボイド→this_card へコア1個移動する", () => {
    const src = srcC03();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
      playerOverrides: [{ voidNormalCoreCount: 3 }, {}],
    });
    const after = runEffect(state, 0);
    const target = after.cardInstances.find((c) => c.instanceId === "src-c03")!;
    expect(target.normalCoreCount).toBe(2);
    expect(after.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      2
    );
  });

  it("アルドノアドライブが無いとき（下カード無し）は発揮されない", () => {
    const src = createCardInstance(C03, {
      instanceId: "src-c03",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [{ voidNormalCoreCount: 3 }, {}],
    });
    const after = runEffect(state, 0);
    const target = after.cardInstances.find((c) => c.instanceId === "src-c03")!;
    expect(target.normalCoreCount).toBe(1);
    expect(after.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      3
    );
  });
});

describe("BSAZ02-C03 effects[1]（Lv3継続: コスト6以下の相手はアタック/ブロック不可＋デッキオープン効果不発）", () => {
  it("prevent_battle は targetInstanceId 未設定・targetFilter.maxCost:6 の動的 global CE として単一登録される", () => {
    const after = runEffect(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [srcC03(), underFiller()],
      }),
      1
    );
    const pb = after.activeContinuousEffects.filter(
      (ce) => !ce.targetInstanceId && ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(1);
    expect(pb[0]!.targetFilter).toMatchObject({
      player: "opponent",
      category: ["spirit", "ultimate"],
      maxCost: 6,
    });
  });

  it("登録後に場へ出たコスト6の相手カードも動的にアタック不可判定される（snapshot ではなく再評価）", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [srcC03(), underFiller()],
      }),
      (id) => cardNoMap.get(id)
    );
    // 登録時点では bob-unit は場に存在しない。後から召喚された想定で state に直接追加する。
    const bobUnit = createCardInstance(cheapUnitDef(6), {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const withLateArrival: GameState = {
      ...rebuilt,
      activePlayerId: BOB,
      step: "attack",
      window: "none",
      cardInstances: [...rebuilt.cardInstances, bobUnit],
    };
    expect(
      getAttackDeclarationBlockReason({
        state: withLateArrival,
        actingPlayerId: BOB,
        sourceInstanceId: "bob-unit",
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).not.toBeNull();
  });

  it("コスト7の相手には（後から場に出ても）prevent_battle が成立しない", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [srcC03(), underFiller()],
      }),
      (id) => cardNoMap.get(id)
    );
    const bobUnit = createCardInstance(cheapUnitDef(7), {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const withLateArrival: GameState = {
      ...rebuilt,
      activePlayerId: BOB,
      step: "attack",
      window: "none",
      cardInstances: [...rebuilt.cardInstances, bobUnit],
    };
    expect(
      getAttackDeclarationBlockReason({
        state: withLateArrival,
        actingPlayerId: BOB,
        sourceInstanceId: "bob-unit",
        getCardDefinitionById: (id) => cardNoMap.get(id),
      })
    ).toBeNull();
  });

  it.each(["field", "hand", "trash"] as const)(
    "コスト7以上の %s のマジックでも相手のデッキオープン効果は発揮されない",
    (zone) => {
      const def = {
        ...card("BSAZ01-C03"),
        cardNo: "TEST-HIGH-COST-OPEN",
        cost: 8,
        effects: [],
      };
      cardNoMap.set(def.cardNo, def);
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          srcC03(),
          underFiller(),
          createCardInstance(def, {
            instanceId: "open-source",
            ownerPlayerId: BOB,
            zone,
          }),
          createCardInstance(card("BSAZ01-C01"), {
            instanceId: "deck",
            ownerPlayerId: BOB,
            zone: "deck",
          }),
        ],
        playerOverrides: [{}, { deckCount: 1 }],
      });
      const protectedState = runEffect(state, 1);
      const descriptor = deriveSuppressionEffectDescriptor({
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 1,
              picks: [{ count: 1 }],
              remainder: "bottom",
            },
          },
        ],
      });
      expect(
        executeReevaluationCheck({
          state: protectedState,
          checkKind: "effect_suppression",
          sourceInstanceId: "open-source",
          targetInstanceIds: [],
          sourcePreventionLevel: "none",
          suppressionEffectDescriptor: descriptor,
          getCardDefinitionById: (id) => cardNoMap.get(id),
        })
      ).toBe(false);
    }
  );

  it("effect_suppression は deck_reveal 指定を保持し、発揮元コストを限定しない", () => {
    const after = runEffect(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [srcC03(), underFiller()],
      }),
      1
    );
    const suppression = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.sourceInstanceId === "src-c03"
    );
    expect(suppression).toBeDefined();
    expect(suppression!.targetInstanceId).toBeUndefined();
    const metadata = suppression!.metadata as {
      suppressTargetFilter?: { maxCost?: number; category?: string[] };
      suppressTargetPlayer?: string;
      effectFilter?: { containsActionKinds?: string[] };
    };
    expect(metadata.suppressTargetFilter?.maxCost).toBeUndefined();
    expect(metadata.suppressTargetPlayer).toBe("opponent");
    expect(metadata.effectFilter?.containsActionKinds).toEqual(["deck_reveal"]);
  });
});

describe("EffectTargetFilter.containsActionKinds（新設 primitive 単体検証）", () => {
  it("deck_reveal action を含む effect の descriptor には一致する", () => {
    const descriptor = deriveSuppressionEffectDescriptor({
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 5,
            picks: [{ count: 1 }],
            remainder: "bottom",
          },
        },
      ],
    });
    expect(descriptor.containsActionKinds).toContain("deck_reveal");
    expect(
      matchesEffectTargetFilter(
        { containsActionKinds: ["deck_reveal"] },
        descriptor
      )
    ).toBe(true);
  });

  it("deck_reveal を含まない effect の descriptor には一致しない", () => {
    const descriptor = deriveSuppressionEffectDescriptor({
      timing: { kind: "card_event", event: "summon" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    });
    expect(descriptor.containsActionKinds).not.toContain("deck_reveal");
    expect(
      matchesEffectTargetFilter(
        { containsActionKinds: ["deck_reveal"] },
        descriptor
      )
    ).toBe(false);
  });

  it("choice 分岐内の deck_reveal も再帰的に検出する", () => {
    const descriptor = deriveSuppressionEffectDescriptor({
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: { kind: "noop" },
          choice: [
            { action: { kind: "draw", count: 1 } },
            {
              action: {
                kind: "deck_reveal",
                revealCount: 3,
                picks: [{ count: 1 }],
                remainder: "trash",
              },
            },
          ],
        },
      ],
    });
    expect(descriptor.containsActionKinds).toContain("deck_reveal");
  });
});
