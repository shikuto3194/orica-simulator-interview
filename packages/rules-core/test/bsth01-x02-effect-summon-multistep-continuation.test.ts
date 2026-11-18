/**
 * BSTH01-X02 [紅魔郷]霧雨 魔理沙 召喚時:
 * 「自分のデッキを上から6枚オープンする。その中/手札/手元/トラッシュにあるカード名：
 * 「ミニ八卦炉」1枚と、カード名：「魔理沙の箒」1枚を召喚コストを0として召喚する。
 * 残ったオープンしたカードは破棄する。」
 *
 * ENGINE-brave-combine-multistep-continuation (2026-07-18): 1体目の「ミニ八卦炉」召喚が
 * ブレイヴのため pendingBraveCombineChoice(effectSummon) を開いて step ループが中断する。
 * 解決後に2体目「魔理沙の箒」の summon step へ戻る継続機構
 * (PendingBraveCombineChoice.effectSummon.continuation、effect-interpreter.ts /
 * pending-action-handlers.ts) が無ければ2体目は召喚されない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src/runtime";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState, LegalAction } from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup(
  ALL_CARDS as CardDefinition[]
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function combineChoiceActions(
  state: GameState
): Extract<LegalAction, { kind: "resolve_brave_combine_choice" }>[] {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
  }).filter(
    (a): a is Extract<LegalAction, { kind: "resolve_brave_combine_choice" }> =>
      a.kind === "resolve_brave_combine_choice"
  );
}

function resolveRequiredPlacement(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).find(
    (
      candidate
    ): candidate is Extract<
      LegalAction,
      { kind: "resolve_pending_multi_placement" }
    > => candidate.kind === "resolve_pending_multi_placement"
  );
  expect(action).toBeDefined();
  if (!action) throw new Error("expected pending multi-placement action");

  return applyLegalAction({
    state,
    action,
    multiPlacementAllocations: action.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements:
        target.minimumCoreCount > 0
          ? [{ kind: "reserve_normal", amount: target.minimumCoreCount }]
          : [],
    })),
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).state;
}

describe("BSTH01-X02 召喚時: ミニ八卦炉+魔理沙の箒 コスト0召喚 (合体選択→継続機構)", () => {
  const marisa = card("BSTH01-X02");
  const hakkero = card("BSTH01-R03");
  const broom = card("BSTH01-R02");
  const filler = card("BSTH01-C01");

  function setup(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const source = createCardInstance(marisa, {
      instanceId: "x02-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const hakkeroInstance = createCardInstance(hakkero, {
      instanceId: "hakkero-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const broomInstance = createCardInstance(broom, {
      instanceId: "broom-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deck = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(filler, {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, hakkeroInstance, broomInstance, ...deck],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 6, reserveNormalCoreCount: 5 } : p
      ),
    };
  }

  it("本文の『召喚コストを0として』を、通常の支払い規則を残す override:0 で表す", () => {
    const [reveal, hakkeroSummon, broomSummon] = marisa.effects![0]!.steps;
    expect(reveal!.action.kind).toBe("deck_reveal");
    expect(hakkeroSummon!.action).toMatchObject({
      kind: "summon",
      costModifier: { override: 0 },
    });
    expect(broomSummon!.action).toMatchObject({
      kind: "summon",
      costModifier: { override: 0 },
    });
  });

  it("1体目 (ミニ八卦炉) 合体選択が pending になり、2体目 (魔理沙の箒) はまだ召喚されない", () => {
    const state = setup();
    const afterEffect = executeEffect({
      chainId: "test:bsth01-x02-effect-summon-multistep-continuation:145",
      state,
      effect: marisa.effects![0]!,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    expect(afterEffect.pendingBraveCombineChoice?.braveInstanceId).toBe(
      "hakkero-hand-1"
    );
    expect(
      afterEffect.pendingBraveCombineChoice?.effectSummon?.continuation
    ).toBeDefined();
    expect(
      afterEffect.cardInstances.find((c) => c.instanceId === "hakkero-hand-1")
        ?.zone
    ).toBe("field");
    // 2体目はまだ手札のまま (継続機構が無ければこのままトラッシュ確定に落ちる=バグ)
    expect(
      afterEffect.cardInstances.find((c) => c.instanceId === "broom-hand-1")
        ?.zone
    ).toBe("hand");
    // 基準コストは0。ここでは進入時の最低Lvコア選択がまだ未発生なので、
    // 支払い段階のリザーブは変化しない。
    expect(
      afterEffect.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(5);
    // オープンした6枚は即トラッシュ (revealed zone 専用対応不要)
    for (let i = 0; i < 6; i++) {
      expect(
        afterEffect.cardInstances.find((c) => c.instanceId === `deck-${i}`)
          ?.zone
      ).toBe("trash");
    }
  });

  it("1体目の合体選択を解決すると、継続機構で2体目の summon step が実行され、進入時コア配置まで完走する", () => {
    const state = setup();
    const afterEffect = executeEffect({
      chainId: "test:bsth01-x02-effect-summon-multistep-continuation:185",
      state,
      effect: marisa.effects![0]!,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const firstChoice = combineChoiceActions(afterEffect).find(
      (a) => a.chosenHostInstanceId === "x02-1"
    );
    expect(firstChoice).toBeDefined();
    const afterFirstChoice = applyLegalAction({
      state: afterEffect,
      action: firstChoice!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;

    // ミニ八卦炉は X02 へ合体済み
    expect(
      afterFirstChoice.cardInstances.find(
        (c) => c.instanceId === "hakkero-hand-1"
      )?.attachedToInstanceId
    ).toBe("x02-1");

    // 継続機構により2体目「魔理沙の箒」の summon step が実行され、再び合体選択 pending。
    expect(afterFirstChoice.pendingBraveCombineChoice?.braveInstanceId).toBe(
      "broom-hand-1"
    );
    const secondChoice = combineChoiceActions(afterFirstChoice).find(
      (a) => a.chosenHostInstanceId === null
    );
    expect(secondChoice).toBeDefined();

    const afterSecondChoice = applyLegalAction({
      state: afterFirstChoice,
      action: secondChoice!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;

    // コスト0は召喚コスト支払いだけを置換する。ブレイヴをスピリット状態で
    // 残すなら、通常どおり最低Lv1コアを置く pending を解決して初めて最終盤面となる。
    expect(afterSecondChoice.pendingMultiPlacement?.targets).toMatchObject([
      { instanceId: "broom-hand-1", minimumCoreCount: 1 },
    ]);
    const final = resolveRequiredPlacement(afterSecondChoice);

    const broomAfter = final.cardInstances.find(
      (c) => c.instanceId === "broom-hand-1"
    );
    expect(broomAfter?.zone).toBe("field");
    expect(broomAfter?.attachedToInstanceId ?? null).toBeNull();
    expect(broomAfter?.normalCoreCount).toBe(1);
    expect(final.pendingBraveCombineChoice).toBeNull();
    expect(final.pendingMultiPlacement).toBeNull();
    expect(
      final.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(4);
  });
});
