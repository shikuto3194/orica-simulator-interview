import { describe, expect, it } from "vitest";
import {
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "../src";
import { executeEffectImmunity } from "../src/effect/structured-continuous-effects";
import { executeBpModify } from "../src/effect/structured-modifiers";
import { executeSymbolAdd } from "../src/effect/structured-combat";
import {
  continuousEffectReadInputState,
  memoizeContinuousEffectRead,
} from "../src/effect/continuous-effect-read";
import {
  getBpModifierTotal,
  getSymbolAdditions,
} from "../src/legal/legal-actions-shared";

const def: CardDefinition = {
  cardNo: "CE-READ",
  name: "CE read",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [],
  keywordTags: [],
};
const getDef = (id: string) => (id === def.cardNo ? def : undefined);

function fixture(kind: "bp" | "symbols", matching = true): GameState {
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "s",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  });
  state = executeEffectImmunity(
    state,
    "alice",
    {
      target: {
        player: "self",
        count: -1,
        filter: {
          category: ["spirit"],
          zone: ["field"],
          ...(kind === "bp"
            ? matching
              ? { minBp: 0 }
              : { maxBp: 2000 }
            : matching
              ? { minSymbolCount: 1 }
              : { maxSymbolCount: 0 }),
        },
      },
      duration: { scope: "turn" },
      sourcePlayerScope: "self",
    },
    "s",
    getDef
  );
  return state;
}

function grant(state: GameState, kind: "bp" | "symbols"): GameState {
  if (kind === "bp") {
    return executeBpModify(
      state,
      "alice",
      {
        target: { player: "self", category: ["spirit"], count: -1 },
        amount: 1000,
        duration: { scope: "turn" },
      },
      "s",
      getDef
    );
  }
  return executeSymbolAdd(
    state,
    "alice",
    {
      target: { player: "self", category: ["spirit"], count: -1 },
      symbol: "blue",
      duration: { scope: "turn" },
      continuousTarget: {
        kind: "filter",
        player: "self",
        zone: "field",
        count: "all",
        filter: { category: ["spirit"] },
      },
    },
    "s",
    getDef
  );
}

describe("continuous effect dependency reads", () => {
  it.each(["bp", "symbols"] as const)(
    "%s dependencies share completed subsets while keeping immunity and every other CE",
    (kind) => {
      let state = fixture(kind);
      for (let n = 1; n <= 8; n++) {
        state = grant(state, kind);
        let lookups = 0;
        const observation = buildAiObservation({
          state,
          viewpointPlayerId: "alice",
          getCardDefinitionById: (id) => {
            lookups++;
            return getDef(id);
          },
        });
        expect(observation.cards[0]?.effectiveBp).toBe(3000);
        expect(
          observation.cards[0]?.effectiveSymbolBundles.reduce(
            (sum, bundle) => sum + bundle.count,
            0
          )
        ).toBe(1);
        // Operation count, not a wall-clock assertion: the former factorial
        // expansion already needs 273,988 lookups at seven BP grants.
        expect(lookups).toBeLessThanOrEqual(40000);
      }
    }
  );

  it.each(["bp", "symbols"] as const)(
    "%s grants still apply when the live resistance filter does not match",
    (kind) => {
      let state = fixture(kind, false);
      for (let n = 0; n < 8; n++) state = grant(state, kind);
      const observation = buildAiObservation({
        state,
        viewpointPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(observation.cards[0]?.effectiveBp).toBe(
        kind === "bp" ? 11000 : 3000
      );
      expect(
        observation.cards[0]?.effectiveSymbolBundles.reduce(
          (sum, bundle) => sum + bundle.count,
          0
        )
      ).toBe(kind === "symbols" ? 9 : 1);
    }
  );

  it("independent reads see in-place CE changes, another lookup and caller-owned symbol bundles", () => {
    const state = grant(fixture("bp", false), "bp");
    const target = {
      controllerPlayerId: "alice",
      definitionId: def.cardNo,
      instanceId: "s",
    };
    expect(getBpModifierTotal(state, "s", target, getDef)).toBe(1000);
    const ce = state.activeContinuousEffects.find(
      (effect) => effect.modifierTag === "bp_modifier"
    )!;
    ce.modifierAmount = 2000;
    expect(getBpModifierTotal(state, "s", target, getDef)).toBe(2000);
    expect(
      getBpModifierTotal(state, "s", target, (id) => {
        const definition = getDef(id);
        return definition
          ? {
              ...definition,
              levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
            }
          : undefined;
      })
    ).toBe(0);

    const symbols = grant(fixture("symbols", false), "symbols");
    memoizeContinuousEffectRead(symbols, Symbol("caller"), [], () => {
      const first = getSymbolAdditions(symbols, "s", getDef);
      first[0]!.push("red");
      first.push(["green"]);
      expect(getSymbolAdditions(symbols, "s", getDef)).toEqual([["blue"]]);
    });
    memoizeContinuousEffectRead(state, Symbol("caller"), [], () => {
      expect(getBpModifierTotal(state, "s", undefined, getDef)).toBe(0);
      expect(getBpModifierTotal(state, "s", target, getDef)).toBe(2000);
      expect(
        getBpModifierTotal(
          state,
          "s",
          { ...target, controllerPlayerId: "bob" },
          getDef
        )
      ).toBe(0);
      expect(
        getBpModifierTotal(state, "s", target, (id) => {
          const definition = getDef(id);
          return definition
            ? {
                ...definition,
                levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
              }
            : undefined;
        })
      ).toBe(0);
      const otherState = { ...state, activeContinuousEffects: [] };
      expect(getBpModifierTotal(otherState, "s", target, getDef)).toBe(0);
    });
  });

  it("shares only derived views and never retains a scope after lookup failure", () => {
    const state = grant(grant(fixture("bp"), "bp"), "bp");
    const [first, second] = state.activeContinuousEffects.slice(-2);
    const operation = Symbol("test read");
    memoizeContinuousEffectRead(state, operation, [], () => {
      const a = continuousEffectReadInputState(
        continuousEffectReadInputState(state, first!.effectId),
        second!.effectId
      );
      const b = continuousEffectReadInputState(
        continuousEffectReadInputState(state, second!.effectId),
        first!.effectId
      );
      expect(a).toBe(b);
      expect(a.activeContinuousEffects).toEqual(
        state.activeContinuousEffects.slice(0, -2)
      );
      const unrelated = { ...state };
      expect(
        continuousEffectReadInputState(unrelated, first!.effectId)
      ).not.toBe(continuousEffectReadInputState(state, first!.effectId));
      return undefined;
    });
    const target = {
      controllerPlayerId: "alice",
      definitionId: def.cardNo,
      instanceId: "s",
    };
    expect(() =>
      getBpModifierTotal(state, "s", target, () => {
        throw new Error("lookup failed");
      })
    ).toThrow("lookup failed");
    expect(getBpModifierTotal(state, "s", target, getDef)).toBe(0);
    const outsideA = continuousEffectReadInputState(state, first!.effectId);
    expect(continuousEffectReadInputState(state, first!.effectId)).not.toBe(
      outsideA
    );
  });
});
