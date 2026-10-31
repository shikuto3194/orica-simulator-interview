import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbolBundles,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "../src";
import { executeTreatAs } from "../src/effect/structured-cost-gate";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDef = (id: string) => definitions.get(id);
const cx01 = getDef("BSRK01-CX01")!;
const c04 = getDef("BSRK01-C04")!;

function board(hostDefinition: CardDefinition = c04): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(cx01, {
        instanceId: "cx01",
        ownerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "advent-source",
        normalCoreCount: 0,
      }),
      {
        ...createCardInstance(hostDefinition, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        underCards: [{ role: "advent_source", cardInstanceId: "cx01" }],
      },
    ],
  });
}

const bundles = (state: GameState, id: string) => {
  const instance = state.cardInstances.find((card) => card.instanceId === id)!;
  return getEffectiveSymbolBundles(
    state,
    instance,
    getDef(instance.definitionId),
    getDef
  );
};
const reduction = (
  state: GameState,
  symbols: CardDefinition["reductionSymbols"]
) =>
  calculateReduction({
    state,
    actingPlayerId: "alice",
    card: { ...c04, reductionSymbols: symbols },
    getCardDefinitionById: getDef,
  }).totalReduction;

describe("BSRK01-CX01 契約煌臨元の白シンボル", () => {
  it.each(["BSRK01-C04", "BSRK01-R03"])(
    "%s の白扱いは後続の継続効果整理でも残り、元カードの離脱で失効する",
    (hostNo) => {
      let state = rebuildContinuousEffectsFromField(
        board(getDef(hostNo)!),
        getDef
      );
      const original = state.activeContinuousEffects.find(
        (ce) => ce.modifierTag === "treat_as_symbol"
      )!;
      for (let i = 0; i < 3; i++) {
        state = recomputeContinuousEffects(state, getDef);
        expect(bundles(state, "host")).toEqual([
          { colors: ["red", "white"], count: 1 },
        ]);
        expect(state.activeContinuousEffects).toContainEqual(original);
      }
      state = {
        ...state,
        cardInstances: state.cardInstances.map((card) =>
          card.instanceId === "cx01"
            ? { ...card, zone: "trash", zoneRoleName: "spirit" }
            : { ...card, underCards: [] }
        ),
      };
      state = recomputeContinuousEffects(state, getDef);
      expect(bundles(state, "host")).toEqual([{ colors: ["red"], count: 1 }]);
      expect(state.activeContinuousEffects).not.toContainEqual(original);
    }
  );

  it("添付盤面のC04に赤/白1シンボルを与え、軽減枠を二重に満たさない", () => {
    const state = rebuildContinuousEffectsFromField(board(), getDef);
    expect(
      state.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "treat_as_symbol"
      )
    ).toMatchObject([{ sourceInstanceId: "cx01", targetInstanceId: "host" }]);
    expect(bundles(state, "host")).toEqual([
      { colors: ["red", "white"], count: 1 },
    ]);
    expect(reduction(state, ["white"])).toBe(1);
    expect(reduction(state, ["red", "white"])).toBe(1);
    const effect = state.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "treat_as_symbol"
    );
    expect(effect).toMatchObject({
      sourceInstanceId: "cx01",
      targetInstanceId: "host",
    });
    const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
    expect(bundles(rebuilt, "host")).toEqual(bundles(state, "host"));
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "treat_as_symbol"
      )
    ).toHaveLength(1);
  });

  it.each(["normal", "none"])(
    "上カードが%s煌臨なら契約煌臨元効果を発揮しない",
    (variant) => {
      const host = {
        ...c04,
        adventData:
          variant === "none"
            ? undefined
            : { ...c04.adventData!, adventVariant: "normal" as const },
      };
      const lookup = (id: string) => (id === c04.cardNo ? host : getDef(id));
      const state = rebuildContinuousEffectsFromField(board(host), lookup);
      expect(bundles(state, "host")).toEqual([{ colors: ["red"], count: 1 }]);
      expect(reduction(state, ["white"])).toBe(0);
    }
  );

  it("煌臨元が魂状態へ戻ると上カードの白扱いを解除し、魂状態は軽減を供給しない", () => {
    let state = rebuildContinuousEffectsFromField(board(), getDef);
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === "alice"
          ? { ...player, soulStateInstanceIds: ["cx01"] }
          : player
      ),
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "host"
          ? { ...card, underCards: [] }
          : { ...card, zoneRoleName: "soul-state" }
      ),
    };
    state = recomputeAndRebuildContinuousEffects(state, getDef);
    state = recomputeContinuousEffects(state, getDef);
    expect(bundles(state, "cx01")).toEqual([
      { colors: ["red", "white"], count: 1 },
    ]);
    expect(bundles(state, "host")).toEqual([{ colors: ["red"], count: 1 }]);
    expect(reduction(state, ["white"])).toBe(0);
  });

  it("カード自身の扱い変更は煌臨先へ転送しない", () => {
    const state = executeTreatAs(
      board(),
      "alice",
      {
        kind: "treat_as",
        aspect: "symbol",
        asColor: "white",
        appliesToCard: true,
      },
      "cx01"
    );
    expect(bundles(state, "host")).toEqual([{ colors: ["red"], count: 1 }]);
    expect(state.activeContinuousEffects[0]).toMatchObject({
      sourceInstanceId: "cx01",
      targetInstanceId: "cx01",
    });
  });
});
