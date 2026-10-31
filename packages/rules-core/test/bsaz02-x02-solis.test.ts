/**
 * BSAZ02-X02「ソリス」effects[0,1,2] 検証。
 *
 * 原文 (textLines[2,4,5,7,8,10,11]):
 *   【アルドノアドライブ：1】（このアルティメットの下にアルドノアドライブを1枚まで置ける。
 *   あるとき、以下の効果を得る）
 *   Lv3-Lv4-Lv5 フラッシュ『お互いのアタックステップ』
 *   ターンに1回、コスト5以下の相手のスピリットすべてを破壊できる。
 *   Lv4-Lv5『このアルティメットのアタック時』
 *   自分は相手の手札を、内容を見ないで、3枚破棄するか、3枚になるように破棄する。その後、
 *   相手のライフのコア1個をトラッシュに置ける。
 *   Lv5『自分のアタックステップ』
 *   ターンの最初のバトル終了後まで、相手はスタック効果を発揮できない。
 *
 * 検証点:
 *  - effects[0]: コスト5以下の相手スピリットのみ全破壊。コスト6の相手スピリットは残る。
 *  - effects[1]: discard(count:3, targetHandSize:3, unseen:true) が
 *    「3枚破棄するか3枚になるように破棄する(少ない方)」を正しく表す
 *    (structured-zone-ops.ts effectiveCount の count/targetHandSize 併用キャップ、
 *    本カードで新設)。その後の core_move (life→trash) は任意 ("置ける")。
 *  - effects[2]: 自分のアタックステップに restrict_stack(opponent,
 *    duration:{scope:battle, untilTurnEnd:true}) が登録される。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { filterRestrictedTimings } from "../src/legal/legal-actions-shared";
import { applyLegalAction, buildTriggeredEffectLookup } from "../src";

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

const ALICE = "player-1";
const BOB = "player-2";
const X02 = card("BSAZ02-X02");

function srcX02(cores: number) {
  const src = createCardInstance(X02, {
    instanceId: "src-x02",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
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
    attachedToInstanceId: "src-x02",
  });
}

function runEffect(
  state: GameState,
  effectIndex: number,
  extra?: Partial<Parameters<typeof executeEffect>[0]>
): GameState {
  return executeEffect({
    chainId: "test:bsaz02-x02-solis:80",
    state,
    effect: X02.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-x02",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    ...extra,
  });
}

describe("BSAZ02-X02 effects[0]（フラッシュ: コスト5以下の相手スピリット全破壊）", () => {
  it("コスト3/5の相手スピリットは破壊され、コスト6は残る", () => {
    const src = srcX02(1); // Lv3
    const cheap = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-cheap",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const expensive = createCardInstance(card("BSAZ01-X01"), {
      instanceId: "opp-expensive",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), cheap, expensive],
    });
    const after = runEffect(state, 0);

    const cheapCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-cheap"
    )!;
    const expensiveCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-expensive"
    )!;
    expect(
      cheapCard.zone !== "field" || cheapCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    expect(expensiveCard.zone).toBe("field");
    expect(expensiveCard.pendingLeaveKind).toBeNull();
  });
});

describe("BSAZ02-X02 effects[1]（アタック時: 手札3枚破棄 or 3枚になるよう破棄 + 任意ライフコアトラッシュ）", () => {
  it("固定3枚の選択: 相手手札10枚 → 7枚", () => {
    const src = srcX02(3); // Lv4
    const hand = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(card("BSDB01-C05"), {
        instanceId: `bob-hand-${i}`,
        ownerPlayerId: BOB,
        zone: "hand",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), ...hand],
      playerOverrides: [{}, { handCount: 10 }],
    });
    const discarded = runEffect(state, 1, { choiceIndex: 0 });
    const bobHandLeft = discarded.cardInstances.filter(
      (c) => c.ownerPlayerId === BOB && c.zone === "hand"
    );
    expect(bobHandLeft).toHaveLength(7);
    // 後続 core_move は executionMode:"optional" のため execute/decline の
    // pending choice が立つ。「置ける」= 実行を選べば発揮される。
    expect(discarded.pendingStepOptionalChoice).not.toBeNull();
    const after = applyLegalAction({
      state: discarded,
      action: {
        kind: "resolve_pending_step_optional_choice",
        choice: "execute",
        pendingId: discarded.pendingStepOptionalChoice!.pendingId,
        actingPlayerId: discarded.pendingStepOptionalChoice!.choosingPlayerId,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    }).state;
    expect(after.pendingStepOptionalChoice ?? null).toBeNull();
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(4); // 実行を選べばライフコアがトラッシュへ
  });

  it("3枚になるまでの選択: 相手手札4枚 → 3枚", () => {
    const src = srcX02(3); // Lv4
    const hand = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSDB01-C05"), {
        instanceId: `bob-hand-${i}`,
        ownerPlayerId: BOB,
        zone: "hand",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), ...hand],
      playerOverrides: [{}, { handCount: 4 }],
    });
    const after = runEffect(state, 1, { choiceIndex: 1 });
    const bobHandLeft = after.cardInstances.filter(
      (c) => c.ownerPlayerId === BOB && c.zone === "hand"
    );
    expect(bobHandLeft).toHaveLength(3);
  });

  it("3枚になるまでの選択: 相手手札2枚 → 2枚", () => {
    const src = srcX02(3); // Lv4
    const hand = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(card("BSDB01-C05"), {
        instanceId: `bob-hand-${i}`,
        ownerPlayerId: BOB,
        zone: "hand",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), ...hand],
      playerOverrides: [{}, { handCount: 2 }],
    });
    const after = runEffect(state, 1, { choiceIndex: 1 });
    const bobHandLeft = after.cardInstances.filter(
      (c) => c.ownerPlayerId === BOB && c.zone === "hand"
    );
    expect(bobHandLeft).toHaveLength(2);
  });
});

describe("BSAZ02-X02 effects[2]（自分のアタックステップ開始時: 相手のスタック効果を抑止）", () => {
  it("restrict_stack(opponent) が最初のバトル終了後まで継続される", () => {
    const src = srcX02(4); // Lv5
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(
      {
        ...state,
        step: "attack",
        activePlayerId: ALICE,
        cardInstances: [
          ...state.cardInstances,
          createCardInstance(card("BSAZ02-C15"), {
            instanceId: "stack-source",
            ownerPlayerId: BOB,
            zone: "hand",
          }),
        ],
      },
      2
    );
    expect(
      filterRestrictedTimings(
        ["stack"],
        after,
        BOB,
        null,
        getDef,
        null,
        "hand",
        "stack-source"
      )
    ).toEqual([]);
    expect(
      filterRestrictedTimings(
        ["stack"],
        after,
        ALICE,
        null,
        getDef,
        null,
        "hand",
        "stack-source"
      )
    ).toEqual(["stack"]);
  });
});
