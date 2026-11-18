import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  advanceStep,
  getKnownDeckCards,
  syncKnownDeckCardsForStateTransition,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  sanitizeStateForViewer,
  evaluateCondition,
  findRevealedEffect,
  findMovedToTrashAutoEffect,
} from "../src";
import type { GameState, Zone } from "../src";
import { getEffectiveCategory } from "../src/mechanics/act-as-spirit";
import { matchesOracleCondition } from "../src/mechanics/oracle-system";
import {
  getDeckHandCards,
  getFaceUpDeckIds,
} from "../src/effect/card-access-rules";
import { moveCardZone } from "../src/core/core-system";
import { useAttackAsAction } from "../src/battle/battle-actions";
import { isCardIdentityPublicForDisclosure } from "../src/public-disclosure";

const lookup = (no: string) => ALL_CARDS.find((c) => c.cardNo === no);
const def = (no: string) => lookup(no)!;
const make = (
  no: string,
  id: string,
  zone: Zone = "field",
  owner = "player-1",
  cores = 1
) =>
  createCardInstance(def(no), {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? cores : 0,
  });
const run = (state: GameState, no: string, index = 0, ids?: string[]) =>
  accept(
    executeEffect({
      chainId: "test:bsth10-cards:43",
      state,
      effect: def(no).effects![index]!,
      effectIndex: index,
      sourceInstanceId: "source",
      actingPlayerId: "player-1",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      ...(ids ? { targetInstanceIds: ids } : {}),
    })
  );
function accept(state: GameState): GameState {
  for (let i = 0; i < 12 && state.pendingStepOptionalChoice; i++) {
    const actor = state.pendingStepOptionalChoice.choosingPlayerId;
    const action = getLegalActions({
      state,
      actingPlayerId: actor,
      getCardDefinitionById: lookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }
  return state;
}
function order(state: GameState): GameState {
  if (!state.pendingDeckReveal) return state;
  const action = getLegalActions({
    state,
    actingPlayerId: "player-1",
    getCardDefinitionById: lookup,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    deckRevealRemainderOrder: state.pendingDeckReveal.revealedCardInstanceIds,
  }).state;
}

describe("BSTH10 原文と盤面", () => {
  it("BSTH10 の『できる』誘発は効果全体で選択し、先頭手順を二重に任意化しない", () => {
    const optionalEffects = [
      ["BSTH10-C01", 0],
      ["BSTH10-C02", 0],
      ["BSTH10-C03", 0],
      ["BSTH10-C04", 0],
      ["BSTH10-M01", 0],
      ["BSTH10-M02", 1],
      ["BSTH10-R01", 0],
      ["BSTH10-R02", 0],
      ["BSTH10-X02", 1],
      ["BSTH10-X02", 2],
    ] as const;

    for (const [cardNo, effectIndex] of optionalEffects) {
      const effect = def(cardNo).effects![effectIndex]!;
      expect(effect.executionMode, `${cardNo} effects[${effectIndex}]`).toBe(
        "optional"
      );
      expect(
        effect.steps[0]?.executionMode,
        `${cardNo} effects[${effectIndex}] root step`
      ).not.toBe("optional");
    }
  });

  it("BSTH10-R03 はサグメを無料配置し、Lv2に必要な5コアまで追加する", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-R03", "source", "in_use"),
        make("BSTH10-X03", "placed", "trash"),
      ],
    });
    const result = run({ ...state, step: "attack" }, "BSTH10-R03", 1, [
      "placed",
    ]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "placed")?.zone,
      JSON.stringify(result.log)
    ).toBe("field");
    expect(
      result.cardInstances.find((c) => c.instanceId === "placed")
        ?.normalCoreCount,
      JSON.stringify(result.log)
    ).toBe(5);
  });
  it("BSTH10-X05 のLv4効果は相手の攻撃時に1体をデッキ下へ支払わせる", () => {
    const base = createEmptyGameState({
      cardInstances: [
        make("BSTH10-X05", "source", "field", "player-1", 2),
        make("BSTH10-C04", "attacker", "field", "player-2"),
        make("BSTH10-C03", "payment", "field", "player-2"),
        make("BSTH10-C01", "tail", "deck", "player-2"),
      ],
    });
    const state = rebuildContinuousEffectsFromField(
      {
        ...base,
        turnNumber: 2,
        step: "attack",
        window: "none",
        activePlayerId: "player-2",
      },
      lookup
    );
    const result = useAttackAsAction({
      state,
      actingPlayerId: "player-2",
      sourceInstanceId: "attacker",
      battleDestroyCostSourceInstanceIds: ["payment"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    expect(
      result.cardInstances
        .filter((c) => c.zone === "deck" && c.ownerPlayerId === "player-2")
        .map((c) => c.instanceId)
    ).toEqual(["tail", "payment"]);
  });
  it("BSTH10-C01 鈴仙は相手の低コスト手札を捨て、残り5枚なら2枚引く", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-C01", "source"),
        make("BSTH10-C03", "discard", "hand", "player-2"),
        ...Array.from({ length: 5 }, (_, i) =>
          make("BSTH10-X02", `h${i}`, "hand", "player-2")
        ),
        make("BSTH10-X02", "d1", "deck"),
        make("BSTH10-X02", "d2", "deck"),
      ],
    });
    const result = run(
      {
        ...state,
        players: state.players.map((p) =>
          p.id === "player-2" ? { ...p, handCount: 6 } : p
        ),
      },
      "BSTH10-C01"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "discard")?.zone
    ).toBe("trash");
    expect(
      result.cardInstances
        .filter((c) => c.instanceId.startsWith("h"))
        .map((c) => c.zone)
    ).toEqual(["hand", "hand", "hand", "hand", "hand"]);
    expect(
      result.cardInstances
        .filter((c) => ["d1", "d2"].includes(c.instanceId))
        .map((c) => c.zone)
    ).toEqual(["hand", "hand"]);
  });
  it("BSTH10-C02 霊夢は破棄候補が無ければトラッシュから2コアを置く", () => {
    let state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-C02", "source"),
        make("BSTH10-X02", "h", "hand", "player-2"),
      ],
    });
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "player-1" ? { ...p, trashNormalCoreCount: 2 } : p
      ),
    };
    const result = run(state, "BSTH10-C02");
    expect(
      result.cardInstances.find((c) => c.instanceId === "source")
        ?.normalCoreCount
    ).toBe(3);
    expect(result.players[0]!.trashNormalCoreCount).toBe(0);
  });
  it("BSTH10-C04 魔理沙は5枚を私的に見て、オープンを発生させない", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-C04", "source"),
        ...Array.from({ length: 5 }, (_, i) =>
          make("BSTH10-C01", `d${i}`, "deck")
        ),
      ],
    });
    const result = run(state, "BSTH10-C04");
    expect(result.pendingDeckReveal?.revealTo).toBe("self");
    expect(result.pendingDeckReveal?.revealedCardInstanceIds).toHaveLength(5);
    expect(
      sanitizeStateForViewer(result, "player-2").cardInstances.filter(
        (c) => c.definitionId === "BSTH10-C01"
      )
    ).toHaveLength(0);
  });
  it("BSTH10-M02 効果召喚なら2体まで純化する", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-M02", "source"),
        make("BSTH10-C04", "a", "field", "player-2"),
        make("BSTH10-C03", "b", "field", "player-2"),
      ],
    });
    const result = accept(
      executeEffect({
        chainId: "test:bsth10-cards:251",
        state,
        effect: def("BSTH10-M02").effects![1]!,
        sourceInstanceId: "source",
        actingPlayerId: "player-1",
        getCardDefinitionById: lookup,
        triggerCause: "self_effect",
        choiceIndex: 1,
        targetInstanceIds: ["a", "b"],
        getRegisteredTriggeredEffectActions: () => [],
      })
    );
    expect(
      result.cardInstances
        .filter((c) => c.ownerPlayerId === "player-2")
        .every((c) => c.faceDown)
    ).toBe(true);
  });
  it("BSTH10-R01 清蘭はコスト4以下を純化する", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-R01", "source"),
        make("BSTH10-C04", "low", "field", "player-2"),
        make("BSTH10-X02", "high", "field", "player-2"),
      ],
    });
    const result = run(state, "BSTH10-R01", 0, ["low"]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "low")?.faceDown
    ).toBe(true);
    expect(
      result.cardInstances.find((c) => c.instanceId === "high")?.faceDown
    ).toBe(false);
  });
  it("BSTH10-R02 鈴瑚は4枚閲覧から最大2枚を交換する選択を作る", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-R02", "source"),
        make("BSTH10-C03", "h", "hand"),
        ...Array.from({ length: 4 }, (_, i) =>
          make("BSTH10-C01", `d${i}`, "deck")
        ),
      ],
    });
    const result = run(state, "BSTH10-R02");
    expect(result.pendingDeckReveal?.revealedCardInstanceIds).toHaveLength(4);
    expect(result.pendingDeckReveal?.revealTo).toBe("self");
  });
  it("BSTH10-R03 黒の自分の効果による公開/ミルだけが回収対象になる", () => {
    const state = createEmptyGameState({
      cardInstances: [make("BSTH10-R03", "source", "deck")],
    });
    const context = {
      sourcePlayerId: "player-1",
      sourceColors: ["black"] as const,
      fromZone: "deck" as const,
    };
    expect(
      findRevealedEffect(state, "source", def("BSTH10-R03"), lookup, context)
        ?.disposition
    ).toMatchObject({ kind: "move", destination: "hand" });
    expect(
      findMovedToTrashAutoEffect(
        state,
        "source",
        def("BSTH10-R03"),
        lookup,
        context
      )?.bonusSteps
    ).toHaveLength(1);
    expect(
      findRevealedEffect(state, "source", def("BSTH10-R03"), lookup, {
        ...context,
        sourcePlayerId: "player-2",
      })
    ).toBeUndefined();
  });
  it("BSTH10-X01 神域は上3枚を公開し、自分だけが対象系統を手札として扱う", () => {
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        cardInstances: [
          make("BSTH10-X01", "source", "field", "player-1", 3),
          ...Array.from({ length: 5 }, (_, i) =>
            make("BSTH10-C01", `d${i}`, "deck")
          ),
        ],
      }),
      lookup
    );
    expect(getFaceUpDeckIds(state, "player-1")).toEqual(["d0", "d1", "d2"]);
    expect(isCardIdentityPublicForDisclosure(state, "d0")).toBe(true);
    expect(isCardIdentityPublicForDisclosure(state, "d3")).toBe(false);
    expect(getDeckHandCards(state, "player-1", lookup)).toHaveLength(3);
    const clause = [
      { kind: "cards_in_zone", zone: "hand", player: "self", min: 3 },
    ] as const;
    expect(
      evaluateCondition(state, [...clause], "source", "player-1", lookup)
    ).toBe(true);
    expect(
      evaluateCondition(
        state,
        [{ kind: "cards_in_zone", zone: "hand", player: "opponent", min: 1 }],
        "source",
        "player-2",
        lookup
      )
    ).toBe(false);
    expect(
      sanitizeStateForViewer(state, "player-2").cardInstances.filter(
        (c) => c.zone === "deck" && c.definitionId === "BSTH10-C01"
      )
    ).toHaveLength(3);
    expect(
      getFaceUpDeckIds(moveCardZone(state, "d0", "hand"), "player-1")
    ).toEqual(["d1", "d2", "d3"]);
  });
  it("BSTH10-X01 神域は通常ドロー直後に新しい上3枚の公開位置を双方へ配送する", () => {
    const base = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        cardInstances: [
          make("BSTH10-X01", "source", "field", "player-1", 3),
          ...Array.from({ length: 5 }, (_, i) =>
            make("BSTH10-C01", `draw${i}`, "deck")
          ),
        ],
      }),
      lookup
    );
    const initial = syncKnownDeckCardsForStateTransition({
      before: base,
      after: base,
      actorPlayerId: "player-1",
    });
    const after = advanceStep(
      { ...initial, step: "core", window: "none", turnNumber: 3 },
      lookup,
      () => []
    );
    expect(after.step).toBe("draw");
    expect(getFaceUpDeckIds(after, "player-1")).toEqual([
      "draw1",
      "draw2",
      "draw3",
    ]);
    expect(
      getKnownDeckCards(after).map((entry) => entry.indexFromBottom)
    ).toEqual([1, 2, 3]);
    for (const viewer of ["player-1", "player-2"]) {
      const view = sanitizeStateForViewer(after, viewer);
      expect(
        view.knownDeckCards?.map((entry) => entry.indexFromBottom)
      ).toEqual([1, 2, 3]);
      expect(
        view.cardInstances.filter(
          (card) =>
            card.zone === "deck" && card.definitionId !== "_hidden_card_"
        )
      ).toHaveLength(3);
    }
    // 後で神域を失っても、一度公開された位置の知識は消さない。
    expect(
      getKnownDeckCards({ ...after, activeContinuousEffects: [] })
    ).toHaveLength(3);
  });
  it("BSTH10-X02 純狐は純化し、相手が残るバトル終了時に回復する", () => {
    const state = createEmptyGameState({
      cardInstances: [
        {
          ...make("BSTH10-X02", "source", "field", "player-1", 2),
          exhaustState: "exhausted",
        },
        make("BSTH10-C03", "target", "field", "player-2"),
        make("BSTH10-C04", "remaining", "field", "player-2"),
      ],
    });
    const purified = run({ ...state, step: "attack" }, "BSTH10-X02", 1, [
      "target",
    ]);
    expect(
      purified.cardInstances.find((c) => c.instanceId === "target")?.faceDown
    ).toBe(true);
    expect(
      run(purified, "BSTH10-X02", 2).cardInstances.find(
        (c) => c.instanceId === "source"
      )?.exhaustState
    ).toBe("recovered");
  });
  it("BSTH10-X04 ドレミーは物理手札のみ5枚まで破棄する", () => {
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        cardInstances: [
          make("BSTH10-X04", "source", "field", "player-1", 3),
          make("BSTH10-X01", "domain", "field", "player-1", 3),
          ...Array.from({ length: 3 }, (_, i) =>
            make("BSTH10-C01", `d${i}`, "deck")
          ),
          ...Array.from({ length: 5 }, (_, i) =>
            make("BSTH10-C01", `h${i}`, "hand")
          ),
        ],
      }),
      lookup
    );
    const result = run({ ...state, step: "end" }, "BSTH10-X04");
    expect(result.cardInstances.filter((c) => c.zone === "hand")).toHaveLength(
      5
    );
    expect(result.pendingZoneSelection).toBeNull();
  });
  it("14枚の番号は重複せず、原文・効果を保持する", () => {
    const cards = ALL_CARDS.filter((c) => c.cardNo.startsWith("BSTH10-"));
    expect(cards).toHaveLength(14);
    expect(new Set(cards.map((c) => c.cardNo)).size).toBe(14);
    expect(cards.every((c) => c.textLines.length > 0)).toBe(true);
  });

  it("BSTH10-C02 霊夢は場のスピリットとして参照されず神託にも一致しない", () => {
    const source = make("BSTH10-C02", "source");
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [source] }),
      lookup
    );
    expect(
      getEffectiveCategory(state, source, def("BSTH10-C02"))
    ).toBeUndefined();
    expect(
      matchesOracleCondition(
        def("BSTH10-C02"),
        { categories: ["spirit"], colors: ["black"], colorCount: "mono" },
        { state, card: source }
      )
    ).toBe(false);
  });

  it("BSTH10-C03 早苗は3枚＋2枚でスリーカードだけを発揮し、手札とデッキを元の行き先へ戻す", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-C03", "source"),
        make("BSTH10-C01", "d1", "deck"),
        make("BSTH10-C02", "d2", "deck"),
        make("BSTH10-M01", "d3", "deck"),
        make("BSTH10-X02", "draw", "deck"),
        make("BSTH10-R01", "tail", "deck"),
        make("BSTH10-C04", "h1", "hand"),
        make("BSTH10-M02", "h2", "hand"),
      ],
    });
    const before = state.players.find((p) => p.id === "player-1")!;
    const result = order(run(state, "BSTH10-C03"));
    const after = result.players.find((p) => p.id === "player-1")!;
    expect(
      after.reserveNormalCoreCount - before.reserveNormalCoreCount,
      JSON.stringify({
        log: result.log,
        pending: Object.entries(result).filter(
          ([k, v]) =>
            k.startsWith("pending") && v && (!Array.isArray(v) || v.length)
        ),
      })
    ).toBe(1);
    expect(after.trashNormalCoreCount).toBe(before.trashNormalCoreCount);
    expect(
      result.cardInstances.find((c) => c.instanceId === "draw")?.zone
    ).toBe("hand");
    expect(
      result.cardInstances
        .filter((c) => ["h1", "h2"].includes(c.instanceId))
        .every((c) => c.zone === "hand")
    ).toBe(true);
    const deck = result.cardInstances
      .filter((c) => c.zone === "deck")
      .map((c) => c.instanceId);
    expect(deck[0]).toBe("tail");
    expect(new Set(deck.slice(1))).toEqual(new Set(["d1", "d2", "d3"]));
  });

  it("BSTH10-M01 純化はコアをリザーブへ戻し、離脱を発生させず双方が内容を確認できる", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-M01", "source"),
        make("BSTH10-C04", "target", "field", "player-2", 3),
      ],
    });
    const before = state.players.find(
      (p) => p.id === "player-2"
    )!.reserveNormalCoreCount;
    const result = run(state, "BSTH10-M01", 0, ["target"]);
    const card = result.cardInstances.find((c) => c.instanceId === "target")!;
    expect(card.zone).toBe("field");
    expect(
      card.faceDown,
      JSON.stringify({
        log: result.log,
        pending: Object.entries(result).filter(
          ([k, v]) =>
            k.startsWith("pending") && v && (!Array.isArray(v) || v.length)
        ),
      })
    ).toBe(true);
    expect(card.normalCoreCount).toBe(0);
    expect(isCardIdentityPublicForDisclosure(result, "target")).toBe(true);
    expect(
      result.players.find((p) => p.id === "player-2")!.reserveNormalCoreCount
    ).toBe(before + 3);
    expect(result.pendingLeaveEntities).toEqual([]);
    expect(
      getEffectiveCategory(result, card, def("BSTH10-C04"))
    ).toBeUndefined();
    expect(
      sanitizeStateForViewer(result, "player-1").cardInstances.find(
        (c) => c.instanceId === "target"
      )?.definitionId
    ).toBe("BSTH10-C04");
  });

  it("BSTH10-X03 サグメはスタート後にアタックステップを追加する", () => {
    const state = createEmptyGameState({
      cardInstances: [
        make("BSTH10-X03", "source", "field", "player-1", 5),
        make("BSTH10-X02", "ultimate"),
      ],
    });
    const result = run({ ...state, step: "start" }, "BSTH10-X03");
    expect(result.pendingExtraSteps).toEqual(["attack"]);
  });
});
