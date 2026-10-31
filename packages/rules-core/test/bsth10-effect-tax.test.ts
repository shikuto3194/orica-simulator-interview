import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, Effect, GameState } from "../src";
import { withRequiredEffectCost } from "../src/effect/card-access-rules";

const base = (id: string) => ALL_CARDS.find((c) => c.cardNo === id)!;
const colored = (no: string): CardDefinition => ({
  ...base("BSTH10-C04"),
  cardNo: no,
  colors: ["red"],
  effects: [],
});
const definitions = [
  colored("red-spirit"),
  {
    ...base("BSTH10-X03"),
    cardNo: "red-god",
    colors: ["red"],
  } as CardDefinition,
];
const lookup = (id: string) =>
  definitions.find((c) => c.cardNo === id) ??
  ALL_CARDS.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
};
const effect = (event: "summon" | "place"): Effect => ({
  timing: { kind: "card_event", event },
  heading:
    event === "summon"
      ? "『このスピリットの召喚時』"
      : "『このネクサスの配置時』",
  steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
});
function board(tax: string, source: string, owner: string, copies = 1) {
  const card = (
    no: string,
    id: string,
    player: string,
    zone: "field" | "deck",
    cores: number
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  const state = createEmptyGameState({
    cardInstances: [
      ...Array.from({ length: copies }, (_, i) =>
        card(tax, `tax${i}`, "player-1", "field", 1)
      ),
      card(source, "source", owner, "field", 3),
      card("BSTH10-C03", "drawn", owner, "deck", 0),
    ],
  });
  return rebuildContinuousEffectsFromField(
    {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        handCount: 0,
        reserveNormalCoreCount: 5,
      })),
    },
    lookup
  );
}
function resolve(
  state: GameState,
  actor: string,
  choice: "execute" | "decline"
) {
  const action = getLegalActions({
    state,
    actingPlayerId: actor,
    ...options,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  )!;
  expect(action).toBeDefined();
  return applyLegalAction({ state, action, ...options }).state;
}
describe("BSTH10 清蘭・鈴瑚の効果発揮コスト", () => {
  it.each(["advent", "attack"])(
    "BSDB01-R02 の複合煌臨/アタック見出しの%sを区別する",
    (eventAction) => {
      const state = board("BSTH10-R02", "BSDB01-R02", "player-2");
      state.cardInstances.push(
        ...["drawn2", "drawn3"].map((instanceId) =>
          createCardInstance(base("BSTH10-C03"), {
            instanceId,
            ownerPlayerId: "player-2",
            zone: "deck",
          })
        )
      );
      const result = executeEffect({
        chainId: "test:bsth10-effect-tax:109",
        state,
        effect: base("BSDB01-R02").effects![0]!,
        sourceInstanceId: "source",
        actingPlayerId: "player-2",
        effectEventAction: eventAction,
        ...options,
      });
      // 実カードの最初の任意処理はドロー。煌臨時だけ、その前に2コストの支払いを挿入する。
      expect(result.pendingStepOptionalChoice?.stepIndex).toBe(0);
      expect(
        withRequiredEffectCost(
          state,
          base("BSDB01-R02").effects![0]!,
          state.cardInstances.find((c) => c.instanceId === "source"),
          "player-2",
          lookup,
          eventAction
        ).steps[0]?.action.kind
      ).toBe(eventAction === "advent" ? "pay_cost" : "draw");
      let current = result;
      if (eventAction === "advent") {
        current = resolve(current, "player-2", "execute");
        const payment = getLegalActions({
          state: current,
          actingPlayerId: "player-2",
          ...options,
        }).find((a) => a.kind === "resolve_core_source_allocation")!;
        current = applyLegalAction({
          state: current,
          action: payment,
          coreSourceAllocations: { source: 2 },
          ...options,
        }).state;
      }
      current = resolve(current, "player-2", "execute");
      const discard = getLegalActions({
        state: current,
        actingPlayerId: "player-2",
        ...options,
      }).find((a) => a.kind === "resolve_pending_zone_selection")!;
      expect(discard, JSON.stringify(current.log)).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: discard,
        selectedZoneCardIds: ["drawn", "drawn2"],
        ...options,
      }).state;
      expect(
        current.cardInstances
          .filter((c) => c.ownerPlayerId === "player-2" && c.zone === "hand")
          .map((c) => c.instanceId)
      ).toEqual(["drawn3"]);
      expect(current.players[1]!.trashNormalCoreCount).toBe(
        eventAction === "advent" ? 2 : 0
      );
    }
  );
  it.each(["attack", "block"])(
    "複合アタック/ブロック見出しの%s時を区別する",
    (eventAction) => {
      const state = board("BSTH10-R01", "red-spirit", "player-2");
      const result = executeEffect({
        chainId: "test:bsth10-effect-tax:171",
        state,
        effect: {
          ...effect("summon"),
          timing: { kind: "card_event", event: ["attack", "block"] },
          heading: "『このスピリットのアタック/ブロック時』",
        },
        sourceInstanceId: "source",
        actingPlayerId: "player-2",
        effectEventAction: eventAction,
        ...options,
      });
      if (eventAction === "attack")
        expect(result.pendingStepOptionalChoice).not.toBeNull();
      else {
        expect(result.pendingStepOptionalChoice).toBeNull();
        expect(
          result.cardInstances.find((c) => c.instanceId === "drawn")?.zone
        ).toBe("hand");
      }
    }
  );
  it.each(["player-1", "player-2"])(
    "清蘭は%sの召喚時効果を支払い後に解決する",
    (actor) => {
      const state = board("BSTH10-R01", "red-spirit", actor);
      const pending = executeEffect({
        chainId: "test:bsth10-effect-tax:197",
        state,
        effect: effect("summon"),
        sourceInstanceId: "source",
        actingPlayerId: actor,
        ...options,
      });
      expect(pending.pendingStepOptionalChoice).not.toBeNull();
      let result = resolve(pending, actor, "execute");
      const payment = getLegalActions({
        state: result,
        actingPlayerId: actor,
        ...options,
      }).find((a) => a.kind === "resolve_core_source_allocation");
      expect(payment).toBeDefined();
      result = applyLegalAction({
        state: result,
        action: payment!,
        coreSourceAllocations: { source: 1 },
        ...options,
      }).state;
      expect(
        result.cardInstances.find((c) => c.instanceId === "drawn")?.zone,
        JSON.stringify(result.log)
      ).toBe("hand");
      expect(
        result.players.find((p) => p.id === actor)?.trashNormalCoreCount
      ).toBe(1);
      expect(
        result.activeContinuousEffects.filter(
          (ce) => ce.modifierTag === "required_effect_cost"
        )
      ).toHaveLength(2);
    }
  );
  it("支払いを辞退したら召喚時効果を解決しない", () => {
    const state = board("BSTH10-R01", "red-spirit", "player-2");
    const pending = executeEffect({
      chainId: "test:bsth10-effect-tax:234",
      state,
      effect: effect("summon"),
      sourceInstanceId: "source",
      actingPlayerId: "player-2",
      ...options,
    });
    const result = resolve(pending, "player-2", "decline");
    expect(
      result.cardInstances.find((c) => c.instanceId === "drawn")?.zone
    ).toBe("deck");
  });
  it("黒1色は種類を失ってもラベル課金の対象外", () => {
    const state = board("BSTH10-R01", "BSTH10-C02", "player-2");
    const result = executeEffect({
      chainId: "test:bsth10-effect-tax:248",
      state,
      effect: effect("summon"),
      sourceInstanceId: "source",
      actingPlayerId: "player-2",
      ...options,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "drawn")?.zone
    ).toBe("hand");
    expect(result.players[1]!.trashNormalCoreCount).toBe(0);
  });
  it("鈴瑚2体でも創界神の配置時効果の追加支払いは2だけ", () => {
    const state = board("BSTH10-R02", "red-god", "player-2", 2);
    const wrapped = withRequiredEffectCost(
      state,
      effect("place"),
      state.cardInstances.find((c) => c.instanceId === "source"),
      "player-2",
      lookup
    );
    expect(wrapped.steps[0]?.action).toMatchObject({
      kind: "pay_cost",
      amount: 2,
    });
  });
});
