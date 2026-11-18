/**
 * BSAZ02-C05「オクタンティス」effects[0,1,2] 検証。
 *
 * 原文 (textLines[2,3,7,8,10,11]):
 *   フラッシュ『お互いのアタックステップ』
 *   手札にあるこのカードは、召喚できる。
 *   Lv3-Lv4『このアルティメットのアタック/ブロック時』
 *   BP15000以下の相手のスピリット/アルティメットか相手のバースト1つをデッキの下に戻す。
 *   この効果は相手の効果で防げない。
 *   Lv4
 *   このアルティメットは相手のスピリットの効果を受けない。
 *
 * 検証点:
 *  - effects[0]: フラッシュ自己召喚（BSAZ02-C07 / BSES01-C02 precedent と同型）。
 *  - effects[1]: 「BP以下1体 か 相手バースト1つ」を choice で二択表現。デフォルト分岐
 *    (choiceIndex省略) は send_to_deck、choiceIndex:1 は discard_set_burst の新設
 *    destination:"deck_bottom"（ENGINE-discard-set-burst-deck-bottom-destination、
 *    本 cluster で新設。DiscardAction.destination の deck_bottom reset パターンを
 *    discard_set_burst 側にも展開）。
 *  - effects[2]: 相手のスピリットの効果を受けない（BSLH01-C08 precedent と同型）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { executeDiscardSetBurst } from "../src/mechanics/burst-system";
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
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const C05 = card("BSAZ02-C05");

function srcC05(cores: number) {
  const src = createCardInstance(C05, {
    instanceId: "src-c05",
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
    attachedToInstanceId: "src-c05",
  });
}

function runEffect(
  state: GameState,
  effectIndex: number,
  choiceIndex?: number
): GameState {
  return executeEffect({
    chainId: "test:bsaz02-c05-octantis:79",
    state,
    effect: C05.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-c05",
    actingPlayerId: ALICE,
    choiceIndex,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

describe("BSAZ02-C05 effects[1]（アタック/ブロック時: BP15000以下1体 か 相手バースト1つをデッキ下へ）", () => {
  it("デフォルト分岐: BP15000以下の相手をデッキの下へ送る", () => {
    const src = srcC05(1); // Lv3
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-spirit",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), opp],
    });
    const after = flushPendingLeaves(runEffect(state, 1), getDef);
    const moved = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit"
    )!;
    expect(moved.zone).toBe("deck");
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.deckCount).toBe(41);
  });

  it("choiceIndex:1 分岐: 相手のセット中バースト1つをデッキの下へ送る（setBurstStatesから除去）", () => {
    const src = srcC05(1); // Lv3
    const burstCard = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-burst",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "burst",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), burstCard],
    });
    const state: GameState = {
      ...base,
      setBurstStates: [{ playerId: BOB, cardInstanceId: "opp-burst" }],
    };
    const after = runEffect(state, 1, 1);
    expect(after.setBurstStates).toHaveLength(0);
    const moved = after.cardInstances.find(
      (c) => c.instanceId === "opp-burst"
    )!;
    expect(moved.zone).toBe("deck");
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.deckCount).toBe(41);
  });
});

describe("executeDiscardSetBurst destination:'deck_bottom' プリミティブ", () => {
  it("セット中バーストをデッキへ送り deckCount を加算、setBurstStates から消える", () => {
    const burstCard = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-burst-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "burst",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [burstCard],
    });
    const state: GameState = {
      ...base,
      setBurstStates: [{ playerId: BOB, cardInstanceId: "bob-burst-0" }],
    };
    const result = executeDiscardSetBurst(state, BOB, 1, getDef, "deck_bottom");
    expect(result.setBurstStates).toHaveLength(0);
    const moved = result.cardInstances.find(
      (c) => c.instanceId === "bob-burst-0"
    )!;
    expect(moved.zone).toBe("deck");
    const bob = result.players.find((p) => p.id === BOB)!;
    expect(bob.deckCount).toBe(41);
  });
});

describe("BSAZ02-C05 effects[2]（Lv4: 相手のスピリットの効果を受けない）", () => {
  it("相手スピリット発生源には免疫が成立し、相手アルティメット発生源には成立しない", () => {
    const src = srcC05(3); // Lv4
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 2);
    const target = after.cardInstances.find((c) => c.instanceId === "src-c05")!;

    const spiritSource = card("BSDB01-C05");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: spiritSource,
      })
    ).toBe(true);

    const ultimateSource = card("BSAZ02-C01");
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: ultimateSource,
      })
    ).toBe(false);
  });
});
