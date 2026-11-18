import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type GameState,
} from "../src";
const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
};
function setup(reserve = 1, lastCard = "BSRK01-C01") {
  const cards = [
    ["source", "BSTH04-C01", "alice", "field", 2],
    ["tax", "BSRK01-C02", "bob", "field", 0],
    ["nexus", "BSTH04-XX01", "alice", "deck", 0],
    ["spirit", "BSTH04-C01", "alice", "deck", 0],
    ["rest", lastCard, "alice", "deck", 0],
  ] as const;
  let state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: reserve, deckCount: 3, handCount: 0 },
        {},
      ],
      cardInstances: cards.map(
        ([instanceId, no, ownerPlayerId, zone, normalCoreCount]) =>
          createCardInstance(getCardDefinitionById(no)!, {
            instanceId,
            ownerPlayerId,
            zone,
            normalCoreCount,
          })
      ),
    }),
    activePlayerId: "alice",
    step: "main" as const,
  };
  state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
  return state;
}
function open(reserve = 1, lastCard = "BSRK01-C01") {
  const state = setup(reserve, lastCard);
  return executeEffect({
    chainId: "test:deck-reveal-hand-gain-event:52",
    state,
    effect: getCardDefinitionById("BSTH04-C01")!.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    ...lookups,
  });
}
function action(state: GameState) {
  const a = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
  if (!a || a.kind !== "resolve_pending_deck_reveal_pick")
    throw new Error("missing pick");
  return a;
}
function pick(
  state: GameState,
  ids: string[],
  paymentSources?: Parameters<typeof applyLegalAction>[0]["paymentSources"]
) {
  return applyLegalAction({
    state,
    action: action(state),
    selectedDeckRevealCardIds: ids,
    ...(paymentSources ? { paymentSources } : {}),
    ...lookups,
  }).state;
}
describe("BSTH04-C01 / BSRK01-C02 手札増加1イベントの対価", () => {
  it("最初の回収枠に対象がなくても、次の枠で支払って回収できる", () => {
    const initial = setup();
    initial.cardInstances = initial.cardInstances.map((c) =>
      c.instanceId === "nexus"
        ? createCardInstance(getCardDefinitionById("BSRK01-C01")!, {
            instanceId: "nexus",
            ownerPlayerId: "alice",
            zone: "deck",
          })
        : c
    );
    let state = executeEffect({
      chainId: "test:deck-reveal-hand-gain-event:96",
      state: initial,
      effect: getCardDefinitionById("BSTH04-C01")!.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(action(state).candidateCardInstanceIds).toEqual([]);
    state = pick(state, []);
    expect(action(state).handGainCost).toBe(1);
    state = pick(state, ["spirit"], [{ kind: "reserve", amount: 1 }]);
    expect(state.players[0]!.handCount).toBe(1);
  });
  it("本文を拒否して破棄したカード自身の回収には別の支払いを選べる", () => {
    let state = pick(open(1, "BSTH01-R12"), []);
    state = pick(state, []);
    state = pick(state, []);
    expect(state.pendingDeckReveal?.origin).toBe("trash");
    expect(action(state).handGainCost).toBe(1);
    state = pick(state, ["rest"], [{ kind: "reserve", amount: 1 }]);
    expect(state.players[0]!.handCount).toBe(1);
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
  });
  it("強制回収でも支払いを断ると全回収枠が抑止され、3枚とも残り札として破棄", () => {
    let state = open();
    expect(action(state).handGainCost).toBe(1);
    expect(action(state).canSkip).toBe(true);
    state = pick(state, []);
    expect(action(state).candidateCardInstanceIds).toEqual([]);
    state = pick(state, []);
    expect(state.pendingDeckReveal).toBeNull();
    expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
    expect(state.players[0]!.handCount).toBe(0);
    for (const id of ["nexus", "spirit", "rest"])
      expect(state.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
        "trash"
      );
  });
  it("1コストを1回払い、導界者と幻想・起幻の2枠を回収する", () => {
    let state = pick(open(), ["nexus"], [{ kind: "reserve", amount: 1 }]);
    expect(action(state).handGainCost ?? 0).toBe(0);
    expect(action(state).canSkip).toBe(false);
    expect(action(state).candidateCardInstanceIds).toContain("spirit");
    state = pick(state, ["spirit"]);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(0);
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
    expect(state.players[0]!.handCount).toBe(2);
    expect(state.cardInstances.find((c) => c.instanceId === "rest")?.zone).toBe(
      "trash"
    );
  });
  it("リザーブが空でもフィールドのコアを選んで支払える", () => {
    let state = open(0);
    expect(action(state).candidateCardInstanceIds).toContain("nexus");
    state = pick(
      state,
      ["nexus"],
      [{ kind: "card", instanceId: "source", amount: 1 }]
    );
    state = pick(state, ["spirit"]);
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")
        ?.normalCoreCount
    ).toBe(1);
    expect(state.players[0]!.handCount).toBe(2);
  });
  it("公開されたカード自身の回収は別イベントで、本文の2枠とは支払いを共有しない", () => {
    // BSTH01-R12 の白/紫/赤の効果による公開時回収。チルノは紫。
    let state = open(2, "BSTH01-R12");
    expect(state.pendingDeckReveal?.phase).toBe("revealed_choice");
    state = pick(state, ["rest"], [{ kind: "reserve", amount: 1 }]);
    expect(action(state).handGainCost).toBe(1);
    state = pick(state, ["nexus"], [{ kind: "reserve", amount: 1 }]);
    state = pick(state, ["spirit"]);
    expect(state.players[0]!.trashNormalCoreCount).toBe(2);
    expect(state.players[0]!.handCount).toBe(3);
  });
  it("カード自身の回収だけ支払い、本文は拒否できる", () => {
    let state = pick(
      open(2, "BSTH01-R12"),
      ["rest"],
      [{ kind: "reserve", amount: 1 }]
    );
    state = pick(state, []);
    state = pick(state, []);
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
    expect(state.players[0]!.handCount).toBe(1);
    expect(
      state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
    ).toBe("trash");
  });
});

describe("BSTH04-C12 効果ドローの対価", () => {
  it("別stepの独立したドローへ支払いを流用せず、後のドローだけ拒否できる", () => {
    const effect = {
      timing: { kind: "activated" as const, mode: "main" as const },
      steps: [
        { action: { kind: "draw" as const, count: 1 } },
        { action: { kind: "draw" as const, count: 1 } },
      ],
    };
    let state = executeEffect({
      chainId: "test:deck-reveal-hand-gain-event:199",
      state: setup(),
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
    });
    const resolve = (allocations: Record<string, number>) => {
      const a = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "resolve_core_source_allocation")!;
      state = applyLegalAction({
        state,
        action: a,
        coreSourceAllocations: allocations,
        ...lookups,
      }).state;
    };
    resolve({ reserve: 1 });
    expect(state.players[0]!.handCount).toBe(1);
    expect(state.pendingCoreSourceAllocation).not.toBeNull();
    resolve({});
    expect(state.players[0]!.handCount).toBe(1);
    expect(state.pendingCoreSourceAllocation).toBeNull();
  });
  it("BSAZ01-C01の合体中+1枚も合計2枚の1イベントで、対価は1回", () => {
    const def = getCardDefinitionById("BSAZ01-C01")!;
    const source = createCardInstance(def, {
      instanceId: "bonus",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const brave = createCardInstance(getCardDefinitionById("BSAZ01-C18")!, {
      instanceId: "brave",
      ownerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: "bonus",
    });
    source.attachedChildrenIds = ["brave"];
    let state = executeEffect({
      chainId: "test:deck-reveal-hand-gain-event:241",
      state: {
        ...setup(),
        cardInstances: [...setup().cardInstances, source, brave],
      },
      effect: def.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "bonus",
      actingPlayerId: "alice",
      ...lookups,
    });
    const a = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    state = applyLegalAction({
      state,
      action: a,
      coreSourceAllocations: { reserve: 1 },
      ...lookups,
    }).state;
    expect(state.pendingCoreSourceAllocation).toBeNull();
    expect(state.players[0]!.handCount).toBe(2);
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
  });
  it("通常ドローステップの1枚ドローには対価を要求しない", () => {
    const state = advanceStep(
      { ...setup(), step: "core", turnNumber: 3 },
      getCardDefinitionById,
      () => []
    );
    expect(state.pendingCoreSourceAllocation).toBeNull();
    expect(state.players[0]!.handCount).toBe(1);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
  });
  function draw() {
    const def = getCardDefinitionById("BSTH04-C12")!;
    const state = setup();
    return executeEffect({
      chainId: "test:deck-reveal-hand-gain-event:280",
      state: {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          createCardInstance(def, {
            instanceId: "draw",
            ownerPlayerId: "alice",
            zone: "in_use",
          }),
        ],
      },
      effect: def.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "draw",
      actingPlayerId: "alice",
      ...lookups,
    });
  }
  it.each([true, false])("2枚ドローも1イベント。支払い=%s", (pay) => {
    const state = draw();
    expect(state.players[0]!.handCount).toBe(0);
    expect(state.players[0]!.deckCount).toBe(3);
    expect(state.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
    const a = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    const after = applyLegalAction({
      state,
      action: a,
      coreSourceAllocations: pay ? { reserve: 1 } : {},
      ...lookups,
    }).state;
    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(after.players[0]!.handCount).toBe(pay ? 2 : 0);
    expect(after.players[0]!.deckCount).toBe(pay ? 1 : 3);
    expect(after.players[0]!.trashNormalCoreCount).toBe(pay ? 1 : 0);
  });
});
