import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src/runtime";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookup = (id: string) => cards.find((card) => card.cardNo === id);
const deps = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
const actions = (state: GameState) =>
  ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
function act(
  state: GameState,
  matches: (action: LegalAction) => boolean,
  skipOptionalEffect = false
) {
  const legal = actions(state);
  const action = legal.find(matches);
  expect(
    action,
    JSON.stringify({ legal, log: state.log.slice(-10) })
  ).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...deps,
    skipOptionalEffect,
    ...(action?.kind === "place_nexus"
      ? {
          paymentSources: [
            { kind: "reserve" as const, amount: action.finalCost },
          ],
        }
      : {}),
  }).state;
}
function closeStack(state: GameState) {
  for (let n = 0; state.stackWindow && n < 12; n++)
    state = act(state, (action) => action.kind === "pass_stack");
  expect(state.stackWindow).toBeNull();
  return state;
}
function resolve(state: GameState, pendingId: string, skip = false) {
  if (
    actions(state).some(
      (a) => a.kind === "select_pending_to_resolve" && a.pendingId === pendingId
    )
  )
    state = act(
      state,
      (a) => a.kind === "select_pending_to_resolve" && a.pendingId === pendingId
    );
  return closeStack(
    act(
      state,
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pendingId,
      skip
    )
  );
}

// ユーザー保存 2026-11-15T10:36:48.212Z の公開カード・デッキからの移動順を再現。
// 保存時には配置イベントが終了済みなので、過去イベントを復活させず、新たな配置から検証する。
function fixture(deck = ["BSTH06-R02", "BSTH06-C03", "BSTH09-TR01(A)"]) {
  const make = (no: string, id: string, zone: "hand" | "deck", owner = "bob") =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
    });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { handCount: 4 },
        {
          reserveNormalCoreCount: 4,
          voidNormalCoreCount: 20,
          deckCount: deck.length,
          handCount: 1,
        },
      ],
      cardInstances: [
        make("BSTH06-X01", "card-45", "hand"),
        ...deck.map((no, i) => make(no, `card-${46 + i}`, "deck")),
        ...Array.from({ length: 4 }, (_, i) =>
          make("BSTH06-C01", `opponent-${i}`, "hand", "alice")
        ),
      ],
    }),
    activePlayerId: "bob",
    turnNumber: 1,
    step: "main",
    window: "none",
  } as GameState;
}
function place(state: GameState) {
  return closeStack(
    act(
      state,
      (a) => a.kind === "place_nexus" && a.sourceInstanceId === "card-45"
    )
  );
}

describe("BSTH06-X01: 配置時導託と同時誘発の条件境界", () => {
  it("導託後に配置時を使ったターンは、同名2枚目の配置時を再使用しない", () => {
    const initial = fixture();
    initial.players = initial.players.map((player) =>
      player.id === "bob"
        ? { ...player, reserveNormalCoreCount: 8, handCount: 2 }
        : player
    );
    initial.cardInstances.push(
      createCardInstance(lookup("BSTH06-X01")!, {
        instanceId: "second",
        ownerPlayerId: "bob",
        zone: "hand",
      })
    );
    let state = place(initial);
    state = resolve(
      state,
      state.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "placement_oracle"
      )!.pendingId
    );
    state = resolve(
      state,
      state.pendingTriggeredEffects.find((p) => p.eventKind === "place")!
        .pendingId
    );
    state = closeStack(
      act(
        state,
        (action) =>
          action.kind === "place_nexus" && action.sourceInstanceId === "second"
      )
    );
    expect(
      state.cardInstances.find((card) => card.instanceId === "second")?.zone
    ).toBe("field");
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(
      state.cardInstances.filter(
        (card) => card.ownerPlayerId === "alice" && card.zone === "set_aside"
      )
    ).toHaveLength(4);
  });
  it("元スナップショットのように配置事象が終了済みの保存から、過去の配置時を作り直さない", () => {
    const before = fixture();
    const saved: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((card) =>
        card.instanceId === "card-45"
          ? { ...card, zone: "field", normalCoreCount: 1 }
          : card.ownerPlayerId === "bob"
            ? { ...card, zone: "trash" }
            : card
      ),
    };
    const restored = JSON.parse(JSON.stringify(saved)) as GameState;
    expect(restored.pendingTriggeredEffects).toHaveLength(0);
    expect(
      actions(restored).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" ||
          action.kind === "select_pending_to_resolve"
      )
    ).toBe(false);
  });
  it.each([true, false])(
    "導託辞退/地霊不一致では空の配置時候補を残さない (辞退=%s)",
    (skip) => {
      let state = place(
        fixture(
          skip
            ? undefined
            : ["BSTH09-TR01(A)", "BSTH09-TR01(A)", "BSTH09-TR01(A)"]
        )
      );
      const oracle = state.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "placement_oracle"
      )!;
      expect(oracle).toBeDefined();
      state = resolve(state, oracle.pendingId, skip);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(
        state.cardInstances.filter(
          (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
        )
      ).toHaveLength(4);
    }
  );

  it("導託コア対象外の地霊マジックでも、トラッシュの地霊カード条件を満たす", () => {
    let state = place(
      fixture(["BSTH06-R02", "BSTH09-TR01(A)", "BSTH09-TR01(A)"])
    );
    const oracle = state.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "placement_oracle"
    )!;
    state = resolve(state, oracle.pendingId);
    expect(
      state.cardInstances.find((c) => c.instanceId === "card-45")
        ?.normalCoreCount
    ).toBe(0);
    const placement = state.pendingTriggeredEffects.find(
      (p) => p.eventKind === "place"
    );
    expect(placement).toBeDefined();
    state = resolve(state, placement!.pendingId);
    expect(
      state.cardInstances.filter(
        (c) => c.ownerPlayerId === "alice" && c.zone === "set_aside"
      )
    ).toHaveLength(4);
  });

  it("保存データの3枚を導託で置いた後、配置時効果で相手手札4枚を手元へ置く", () => {
    let state = place(fixture());
    const oracle = state.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "placement_oracle"
    )!;
    expect(oracle).toBeDefined();
    expect(
      actions(state).some(
        (a) =>
          a.sourceInstanceId === "card-45" && a.registrationIndex !== undefined
      )
    ).toBe(false);
    state = resolve(JSON.parse(JSON.stringify(state)), oracle.pendingId);
    expect(
      state.cardInstances.find((c) => c.instanceId === "card-45")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      state.cardInstances
        .filter((c) => c.zone === "trash")
        .map((c) => c.definitionId)
    ).toEqual(["BSTH06-R02", "BSTH06-C03", "BSTH09-TR01(A)"]);
    const placement = state.pendingTriggeredEffects.find(
      (p) => p.eventKind === "place"
    );
    expect(placement).toBeDefined();
    state = resolve(state, placement!.pendingId);
    expect(
      state.cardInstances.filter(
        (c) => c.ownerPlayerId === "alice" && c.zone === "set_aside"
      )
    ).toHaveLength(4);
    expect(
      state.cardInstances.filter(
        (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
      )
    ).toHaveLength(0);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
});
