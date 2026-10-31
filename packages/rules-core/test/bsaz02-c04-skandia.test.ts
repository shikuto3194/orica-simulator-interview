/**
 * BSAZ02-C04「スカンディア」effects[0,1] 検証。
 *
 * 原文 (textLines[2,4,5,7,8]):
 *   【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで
 *   置ける。あるとき、以下の効果を得る）
 *   Lv3-Lv4
 *   このアルティメットは、ブロックされず、合体スピリット/マジック以外の効果を受けない。
 *   Lv3-Lv4 フラッシュ『お互いのアタックステップ』
 *   ターンに1回、コスト4以下の相手のスピリット/ネクサス1つをデッキの下に戻せる。
 *   そうしたとき、相手の手札1枚を内容を見ないで破棄する。
 *
 * 検証点:
 *  - effects[0]: unblockable CE 登録 + effect_immunity(sourceScope.excludeCombined:true)。
 *    「合体スピリット/マジック以外の効果を受けない」= immunitySourceScope に新設した
 *    `excludeCombined` と `excludeCombinedCategories:[spirit]` で合体スピリットだけを除外し、
 *    を使い、categories はマジックを除く全カテゴリ (spirit/brave/ultimate/nexus) を列挙する。
 *    非合体スピリット/アルティメット/ネクサス発生源は免疫成立、マジック発生源・合体スピリット
 *    発生源は免疫不成立（効果が着弾する）ことを確認する。
 *  - effects[1]: send_to_deck(maxCost:4, position:bottom) 成功時 (ref_succeeded) のみ
 *    discard(unseen:true) が発火する。対象0件（コスト条件を満たす相手カードなし）のときは
 *    破棄も発生しない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const C04 = card("BSAZ02-C04");

function srcC04() {
  const src = createCardInstance(C04, {
    instanceId: "src-c04",
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
    attachedToInstanceId: "src-c04",
  });
}

function runEffect(state: GameState, effectIndex: number): GameState {
  return executeEffect({
    chainId: "test:bsaz02-c04-skandia:75",
    state,
    effect: C04.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-c04",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

describe("BSAZ02-C04 effects[0]（Lv3-4継続: ブロックされず + 合体スピリット/マジック以外の効果を受けない）", () => {
  it("合体アルティメットの効果には免疫が成立する", () => {
    const state = runEffect(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [srcC04(), underFiller()],
      }),
      0
    );
    const ultimate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "combined-ultimate",
      ownerPlayerId: BOB,
      zone: "field",
      attachedChildrenIds: ["brave"],
    });
    const target = state.cardInstances.find((c) => c.instanceId === "src-c04")!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        BOB,
        "none",
        { instance: ultimate, definition: card("BSAZ02-C01") },
        getDef
      )
    ).toBe(true);
  });
  it("unblockable CE が登録される", () => {
    const src = srcC04();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 0);
    const ub = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "unblockable" && ce.targetInstanceId === "src-c04"
    );
    expect(ub).toBeDefined();
  });

  it("非合体の相手スピリット/アルティメット/ネクサス発生源には免疫が成立する", () => {
    const src = srcC04();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 0);
    const target = after.cardInstances.find((c) => c.instanceId === "src-c04")!;

    const opponentSpirit = card("BSDB01-C05"); // 非合体スピリット
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: opponentSpirit,
      })
    ).toBe(true);

    const opponentUltimate: CardDefinition = {
      ...card("BSAZ02-C01"),
      printedCategory: "ultimate",
    };
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: opponentUltimate,
      })
    ).toBe(true);
  });

  it("マジック発生源には免疫が成立しない（効果が着弾する）", () => {
    const src = srcC04();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 0);
    const target = after.cardInstances.find((c) => c.instanceId === "src-c04")!;

    const opponentMagic = card("BSAZ01-C03"); // printedCategory: "magic"
    expect(opponentMagic.printedCategory).toBe("magic");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: opponentMagic,
      })
    ).toBe(false);
  });

  it("合体状態のスピリット発生源には免疫が成立しない（excludeCombined、効果が着弾する）", () => {
    const src = srcC04();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 0);
    const target = after.cardInstances.find((c) => c.instanceId === "src-c04")!;

    const combinedSpiritInstance = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-combined-spirit",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["opp-brave-dummy"],
    });
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        instance: combinedSpiritInstance,
        definition: card("BSDB01-C05"),
      })
    ).toBe(false);

    // 対照: 同じ定義でも非合体なら免疫成立。
    const nonCombinedSpiritInstance = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-plain-spirit",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        instance: nonCombinedSpiritInstance,
        definition: card("BSDB01-C05"),
      })
    ).toBe(true);
  });
});

describe("BSAZ02-C04 effects[1]（Lv3-4フラッシュ『お互いのアタックステップ』: コスト4以下1体をデッキ下へ、成功時のみ相手手札1枚を見ないで破棄）", () => {
  function bobHand() {
    return [
      createCardInstance(card("BSDB01-C05"), {
        instanceId: "bob-hand-1",
        ownerPlayerId: BOB,
        zone: "hand",
      }),
      createCardInstance(card("BSDB01-C05"), {
        instanceId: "bob-hand-2",
        ownerPlayerId: BOB,
        zone: "hand",
      }),
    ];
  }

  it("コスト4以下の相手スピリットをデッキ下へ戻し、相手手札が1枚減る（内容を見ないで破棄）", () => {
    const src = srcC04();
    const oppSpirit = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-spirit",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), oppSpirit, ...bobHand()],
    });
    const bobDeckBefore = state.players.find((p) => p.id === BOB)!.deckCount;

    const after = flushPendingLeaves(runEffect(state, 1), getDef);

    const oppCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit"
    )!;
    expect(oppCard.zone).toBe("deck");
    const bobAfter = after.players.find((p) => p.id === BOB)!;
    expect(bobAfter.deckCount).toBe(bobDeckBefore + 1);
    const bobHandAfter = after.cardInstances.filter(
      (c) => c.ownerPlayerId === BOB && c.zone === "hand"
    );
    expect(bobHandAfter).toHaveLength(1);
  });

  it("コスト4以下の対象が存在しないときは何も起きない（送還も破棄も発生しない）", () => {
    const src = srcC04();
    const oppExpensive = createCardInstance(card("BSAZ01-C13"), {
      // BSAZ01-C13: printedCategory:"nexus", cost:8（フィルタ maxCost:4 を満たさない）
      instanceId: "opp-expensive",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), oppExpensive, ...bobHand()],
    });

    const after = runEffect(state, 1);

    const oppCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-expensive"
    )!;
    expect(oppCard.zone).toBe("field");
    const bobHandAfter = after.cardInstances.filter(
      (c) => c.ownerPlayerId === BOB && c.zone === "hand"
    );
    expect(bobHandAfter).toHaveLength(2);
  });
});
