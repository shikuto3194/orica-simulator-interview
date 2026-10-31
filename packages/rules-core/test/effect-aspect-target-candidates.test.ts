import { describe, expect, it } from "vitest";
import {
  buildAiObservation,
  applyLegalAction,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type Action,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src";
import { getAvailableFieldCardEffectLegalActions } from "../src/legal/legal-actions-availability";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";
import { executeEffectImmunity } from "../src/effect/structured-continuous-effects";
import { resolveTargets } from "../src/effect/native-target-resolution";

const card: CardDefinition = {
  cardNo: "ASPECT-TARGET",
  name: "Aspect target",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [],
  keywordTags: [],
};

function fixture(
  operation: "bp_modify" | "symbol_add",
  aspect: "bp" | "symbols",
  actor = "alice",
  scope: "self" | "any" | "opponent" = "opponent"
) {
  const action: Action = {
    kind: operation,
    target: {
      kind: "filter",
      player: "either",
      zone: "field",
      excludeSelf: true,
      count: 1,
      filter: { category: ["spirit"] },
    },
    duration: { scope: "turn" },
    ...(operation === "bp_modify"
      ? { amount: 1000 }
      : { symbol: "blue" as const }),
  } as Action;
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    steps: [{ action }],
  };
  const source: CardDefinition = {
    ...card,
    cardNo: "ASPECT-SOURCE",
    effects: [effect],
  };
  const getDef = (id: string) =>
    id === source.cardNo ? source : id === card.cardNo ? card : undefined;
  let state: GameState = {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    step: "main",
    activePlayerId: actor,
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: actor,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(card, {
        instanceId: "immune",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(card, {
        instanceId: "normal",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  };
  state = executeEffectImmunity(
    state,
    "bob",
    {
      target: { player: "self", selfCard: true, count: 1 },
      sourceScope: { restrictedAspects: [aspect] },
      sourcePlayerScope: scope,
      duration: { scope: "turn" },
    },
    "immune",
    getDef
  );
  const lookup = buildFieldCardEffectLookup([source]);
  const registration = lookup(source.cardNo)![0]!;
  const options = {
    state,
    actingPlayerId: actor,
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: lookup,
    getRegisteredTriggeredEffectActions: () => undefined,
  };
  return { action, effect, source, state, getDef, registration, options };
}

describe("部分免疫の通常対象候補と作用の一致", () => {
  for (const operation of ["bp_modify", "symbol_add"] as const) {
    for (const actor of ["alice", "bob"]) {
      for (const scope of ["self", "any", "opponent"] as const) {
        it.each(["bp", "symbols"] as const)(
          `${operation} / ${actor} / ${scope} / %s: 実登録・合法行動・native対象・最終盤面を照合する`,
          (aspect) => {
            const f = fixture(operation, aspect, actor, scope);
            const matching =
              (operation === "bp_modify" ? "bp" : "symbols") === aspect &&
              (scope === "any" ||
                (scope === "self" ? actor === "bob" : actor !== "bob"));
            const expected = matching ? ["normal"] : ["immune", "normal"];
            const legal = getAvailableFieldCardEffectLegalActions(
              f.options
            ).find((entry) => entry.sourceInstanceId === "source")!;
            expect(legal).toMatchObject({
              can: true,
              requiredTargetCount: 1,
              candidateTargetInstanceIds: expected,
            });
            expect(
              getCandidateTargetInstanceIds(f.state, actor, f.registration, {
                sourceInstanceId: "source",
                getCardDefinitionById: f.getDef,
              })
            ).toEqual(expected);
            expect(
              resolveTargets(
                f.action,
                f.state,
                actor,
                "source",
                f.getDef,
                {},
                undefined,
                f.source
              )
            ).toEqual(expected.slice(0, 1));
            const after = executeEffect({
              chainId: `aspect:${operation}:${aspect}:${actor}:${scope}`,
              state: f.state,
              effect: f.effect,
              sourceInstanceId: "source",
              actingPlayerId: actor,
              getCardDefinitionById: f.getDef,
              targetInstanceIds: [expected[0]!],
            });
            const observation = buildAiObservation({
              state: after,
              viewpointPlayerId: "alice",
              getCardDefinitionById: f.getDef,
            });
            expect(
              observation.cards.find(
                (token) => token.instanceId === expected[0]
              )?.effectiveBp
            ).toBe(operation === "bp_modify" ? 4000 : 3000);
            expect(
              observation.cards.find(
                (token) => token.instanceId === expected[0]
              )?.effectiveSymbolBundles
            ).toEqual(
              operation === "symbol_add"
                ? [
                    { colors: ["red"], count: 1 },
                    { colors: ["blue"], count: 1 },
                  ]
                : [{ colors: ["red"], count: 1 }]
            );
          }
        );
      }
    }
  }
  for (const operation of ["bp_modify", "symbol_add"] as const) {
    const aspect = operation === "bp_modify" ? "bp" : "symbols";
    it(`${operation}: 全候補が免疫でも通常効果の空撃ちを維持する`, () => {
      const f = fixture(operation, aspect);
      const state = {
        ...f.state,
        cardInstances: f.state.cardInstances.filter(
          (entry) => entry.instanceId !== "normal"
        ),
      };
      const legal = getAvailableFieldCardEffectLegalActions({
        ...f.options,
        state,
      }).find((entry) => entry.sourceInstanceId === "source");
      expect(legal).toMatchObject({
        can: true,
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
      });
    });
    it.each(["bp", "symbols"] as const)(
      `${operation} / %s: ことで構文は免疫で対象0なら使用できない`,
      (immunityAspect) => {
        const f = fixture(operation, immunityAspect);
        const state = {
          ...f.state,
          cardInstances: f.state.cardInstances.filter(
            (entry) => entry.instanceId !== "normal"
          ),
        };
        const source: CardDefinition = {
          ...f.source,
          effects: [
            {
              ...f.effect,
              steps: [
                { action: { kind: "pay_cost", amount: 1 } },
                { connector: "conditional_cost", action: f.action },
              ],
            },
          ],
        };
        const getDef = (id: string) =>
          id === source.cardNo ? source : f.getDef(id);
        const lookup = buildFieldCardEffectLookup([source]);
        expect(lookup(source.cardNo)![0]!.targetGatedByConditionalCost).toBe(
          true
        );
        const legal = getAvailableFieldCardEffectLegalActions({
          ...f.options,
          state,
          getCardDefinitionById: getDef,
          getRegisteredFieldCardEffectActions: lookup,
        }).filter((entry) => entry.sourceInstanceId === "source" && entry.can);
        expect(legal).toHaveLength(immunityAspect === aspect ? 0 : 1);
      }
    );
    it(`${operation}: on_step候補から免疫対象を除外し、選択した対象へ作用する`, () => {
      const f = fixture(operation, aspect);
      const state = {
        ...f.state,
        cardInstances: [
          ...f.state.cardInstances,
          createCardInstance(card, {
            instanceId: "normal-2",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      const effect: Effect = {
        ...f.effect,
        steps: [{ ...f.effect.steps[0]!, targetSelectionTiming: "on_step" }],
      };
      const after = executeEffect({
        chainId: `aspect:on-step:${operation}`,
        state,
        effect,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: f.getDef,
      });
      expect(
        after.pendingStepOptionalTargetSelection?.candidateInstanceIds
      ).toEqual(["normal", "normal-2"]);
      const lookups = {
        getCardDefinitionById: f.getDef,
        getRegisteredTriggeredEffectActions: () => undefined,
      };
      const legal = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (entry) =>
          entry.kind === "resolve_pending_step_optional_target_selection"
      )!;
      expect(legal).toBeDefined();
      const result = applyLegalAction({
        state: after,
        action: legal,
        targetInstanceIds: ["normal"],
        ...lookups,
      }).state;
      expect(result.pendingStepOptionalTargetSelection).toBeNull();
      const token = buildAiObservation({
        state: result,
        viewpointPlayerId: "alice",
        getCardDefinitionById: f.getDef,
      }).cards.find((entry) => entry.instanceId === "normal")!;
      expect(token.effectiveBp).toBe(operation === "bp_modify" ? 4000 : 3000);
      expect(token.effectiveSymbolBundles).toEqual(
        operation === "symbol_add"
          ? [
              { colors: ["red"], count: 1 },
              { colors: ["blue"], count: 1 },
            ]
          : [{ colors: ["red"], count: 1 }]
      );
    });
    it(`${operation}: 選択後に免疫を得た対象だけを除外して残りへ部分解決する`, () => {
      const f = fixture(operation, aspect);
      const before = { ...f.state, activeContinuousEffects: [] };
      const ids = getCandidateTargetInstanceIds(
        before,
        "alice",
        f.registration,
        { sourceInstanceId: "source", getCardDefinitionById: f.getDef }
      );
      expect(ids).toEqual(["immune", "normal"]);
      const action = {
        ...f.action,
        target: {
          kind: "filter",
          player: "opponent",
          zone: "field",
          count: 2,
          filter: { category: ["spirit"] },
        },
      } as Action;
      const after = executeEffect({
        chainId: `aspect:late-immunity:${operation}`,
        state: f.state,
        effect: { ...f.effect, steps: [{ action }] },
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: f.getDef,
        targetInstanceIds: ids,
      });
      for (const viewer of ["alice", "bob"]) {
        const observation = buildAiObservation({
          state: after,
          viewpointPlayerId: viewer,
          getCardDefinitionById: f.getDef,
        });
        expect(
          observation.cards.find((entry) => entry.instanceId === "immune")
        ).toMatchObject({
          effectiveBp: 3000,
          effectiveSymbolBundles: [{ colors: ["red"], count: 1 }],
        });
        expect(
          observation.cards.find((entry) => entry.instanceId === "normal")
        ).toMatchObject({
          effectiveBp: operation === "bp_modify" ? 4000 : 3000,
          effectiveSymbolBundles:
            operation === "symbol_add"
              ? [
                  { colors: ["red"], count: 1 },
                  { colors: ["blue"], count: 1 },
                ]
              : [{ colors: ["red"], count: 1 }],
        });
      }
    });
  }
  it("BPとシンボルの対象グループが別々のaspectを保持する", () => {
    const f = fixture("bp_modify", "bp");
    const symbol = fixture("symbol_add", "bp").action;
    const source = {
      ...f.source,
      effects: [
        {
          ...f.effect,
          steps: [
            { id: "bp", action: f.action },
            { id: "symbols", action: symbol },
          ],
        },
      ],
    };
    const getDef = (id: string) =>
      id === source.cardNo ? source : f.getDef(id);
    const lookup = buildFieldCardEffectLookup([source]);
    const registration = lookup(source.cardNo)![0]!;
    expect(
      registration.targetGroups?.map((group) => group.targetEffectAspect)
    ).toEqual(["bp", "symbols"]);
    const legal = getAvailableFieldCardEffectLegalActions({
      ...f.options,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: lookup,
    }).find((entry) => entry.sourceInstanceId === "source")!;
    expect(
      legal.targetGroups?.map((group) => group.candidateTargetInstanceIds)
    ).toEqual([["normal"], ["immune", "normal"]]);
  });
  it("choice変種も操作ごとのaspectと候補を保持する", () => {
    const f = fixture("bp_modify", "bp");
    const source = {
      ...f.source,
      effects: [
        {
          ...f.effect,
          steps: [
            {
              action: f.action,
              choice: [
                { label: "Symbol", action: fixture("symbol_add", "bp").action },
              ],
            },
          ],
        },
      ],
    };
    const getDef = (id: string) =>
      id === source.cardNo ? source : f.getDef(id);
    const lookup = buildFieldCardEffectLookup([source]);
    const registration = lookup(source.cardNo)![0]!;
    expect(
      registration.choices?.map((choice) => choice.targetEffectAspect)
    ).toEqual(["bp", "symbols"]);
    const legal = getAvailableFieldCardEffectLegalActions({
      ...f.options,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: lookup,
    }).filter((entry) => entry.sourceInstanceId === "source");
    expect(legal.map((entry) => entry.candidateTargetInstanceIds)).toEqual([
      ["normal"],
      ["immune", "normal"],
    ]);
  });
});
